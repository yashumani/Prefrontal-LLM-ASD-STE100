"""Offline acceptance for the operator-bound CLI and native composition demo."""

import importlib
import importlib.util
import json
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import patch


class ComposablePortAcceptance(unittest.TestCase):
    def setUp(self):
        for name in ("composable_cli", "composable_demo", "composable_native"):
            self.assertIsNotNone(importlib.util.find_spec("pilot." + name),
                                 "missing composable CLI/native feature: " + name)
        self.cli_module = importlib.import_module("pilot.composable_cli")
        self.demo_module = importlib.import_module("pilot.composable_demo")
        self.native_module = importlib.import_module("pilot.composable_native")
        validation = Path(__file__).resolve().parents[1] / ".validation"
        validation.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="composable-port-", dir=str(validation))
        self.addCleanup(self.temp.cleanup)
        self.demo = self.demo_module.run_demo(Path(self.temp.name))
        self.root = Path(self.demo["run_dir"])
        self.principals_path = Path(self.demo["principals"])
        self.port = self.cli_module.CLI(self.demo["database"], self.demo["source_root"],
                                       self.principals_path, "agent")
        self.addCleanup(self.port.close)

    def request(self, operation, **fields):
        return self.port.execute_line(json.dumps(dict(operation=operation, **fields)))

    def resolve(self):
        result = self.request("context.resolve", workspace="composable-demo",
                              measure="M_GROSS_ADDS", selectors=["CHANNEL_ONLINE",
                              "PRODUCT_POSTPAID", "PERIOD_2026_09"])
        self.assertTrue(result["ok"], result)
        return result["result"]

    def test_three_consumers_share_real_native_result_and_evidence(self):
        self.assertEqual(self.demo["native"]["value"], 2)
        self.assertEqual(set(self.demo["consumers"]), {"agent", "chatbot", "workflow"})
        for result in self.demo["consumers"].values():
            self.assertTrue(result["deterministic"])
            self.assertEqual(result["value"], 2)
            self.assertEqual(result["evidence"]["bundle_hash"], self.demo["native"]["evidence"]["bundle_hash"])
        self.assertEqual(self.demo["live_model_calls"], 0)

    def test_duplicate_nonfinite_deep_oversized_and_actor_requests_deny_safely(self):
        for line in ('{"operation":"context.search","operation":"record.revoke"}',
                     '{"operation":"context.search","query":NaN}',
                     '[' * 40 + '0' + ']' * 40,
                     '"' + 'x' * 1100000 + '"',
                     '{"operation":"context.search","actor":"reviewer","workspace":"composable-demo","query":"adds"}'):
            result = self.port.execute_line(line)
            self.assertFalse(result["ok"], result)
            self.assertNotIn("reviewer", json.dumps(result))

    def test_principals_reload_and_denied_lookup_does_not_disclose_records(self):
        self.resolve()
        principals = json.loads(self.principals_path.read_text(encoding="utf-8"))
        del principals["agent"]
        self.principals_path.write_text(json.dumps(principals), encoding="utf-8")
        response = self.request("context.resolve", workspace="composable-demo",
                                measure="M_GROSS_ADDS", selectors=["PERIOD_2026_09"])
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "access_denied")
        self.assertNotIn("M_GROSS_ADDS", json.dumps(response))

    def test_search_resolve_and_approved_export_are_machine_usable(self):
        search = self.request("context.search", workspace="composable-demo", query="gross adds", page_size=10)
        self.assertTrue(search["ok"], search)
        self.assertTrue(any(row["id"] == "M_GROSS_ADDS" for row in search["result"]["results"]))
        self.assertIn("bundle_hash", self.resolve())
        exported = self.request("context.export", workspace="composable-demo", id="M_GROSS_ADDS", format="json")
        self.assertTrue(exported["ok"], exported)
        self.assertEqual(json.loads(exported["result"]["document"])["id"], "M_GROSS_ADDS")
        self.assertIn("content_hash", exported["result"])

    def test_validation_separates_structure_from_semantic_approval(self):
        record = json.loads((self.root / "records" / "M_GROSS_ADDS.json").read_text(encoding="utf-8"))
        record["version"] = 2
        record["description"] = "An unreviewed proposal."
        submitter = self.cli_module.CLI(self.demo["database"], self.demo["source_root"],
                                        self.principals_path, "submitter")
        self.addCleanup(submitter.close)
        response = submitter.execute_line(json.dumps({"operation": "context.validate", "record": record}))
        self.assertTrue(response["ok"], response)
        self.assertTrue(response["result"]["structurally_valid"])
        self.assertFalse(response["result"]["semantically_approved"])

    def test_native_rechecks_bundle_revocation_after_resolution(self):
        bundle = self.resolve()
        from pilot.composable_registry import ComposableRegistry
        from pilot.composable_model import ContextError
        provider = lambda: self.cli_module.load_principals(self.principals_path)
        with ComposableRegistry(self.demo["database"], self.demo["source_root"], provider) as registry:
            registry.revoke("releaser", "composable-demo", "M_GROSS_ADDS", 1)
            with self.assertRaises(ContextError):
                self.native_module.execute_native(registry, "agent", bundle, self.demo["source_root"])

    def test_native_source_grant_is_independent_and_rechecked_before_delivery(self):
        bundle = self.resolve()
        from pilot.composable_registry import ComposableRegistry
        from pilot.composable_model import ContextError
        provider = lambda: self.cli_module.load_principals(self.principals_path)
        with ComposableRegistry(self.demo["database"], self.demo["source_root"], provider) as registry:
            def remove_source_grant():
                principals = provider()
                principals["agent"]["source_bindings"] = []
                self.principals_path.write_text(json.dumps(principals), encoding="utf-8")
            with self.assertRaises(ContextError):
                self.native_module.execute_native(registry, "agent", bundle, self.demo["source_root"],
                                                  before_delivery=remove_source_grant)
            self.assertTrue(self.resolve(), "metadata remains independently discoverable")
            with self.assertRaises(ContextError):
                self.native_module.execute_native(registry, "agent", bundle, self.demo["source_root"])

    def test_required_period_cut_is_not_invented(self):
        response = self.request("context.resolve", workspace="composable-demo",
                                measure="M_GROSS_ADDS", selectors=["CHANNEL_ONLINE"])
        self.assertFalse(response["ok"], response)

    def test_native_freshness_is_rechecked_before_delivery(self):
        bundle = self.resolve()
        from pilot.composable_registry import ComposableRegistry
        from pilot.composable_model import ContextError
        provider = lambda: self.cli_module.load_principals(self.principals_path)
        now = [datetime.now(timezone.utc)]
        with ComposableRegistry(self.demo["database"], self.demo["source_root"], provider) as registry:
            def advance_time():
                now[0] += timedelta(days=2)
            with self.assertRaises(ContextError):
                self.native_module.execute_native(registry, "agent", bundle, self.demo["source_root"],
                    clock=lambda: now[0], before_delivery=advance_time)

    def test_native_final_read_source_permission_race_denies_delivery(self):
        bundle = self.resolve()
        from pilot.composable_registry import ComposableRegistry
        from pilot.composable_model import ContextError
        provider = lambda: self.cli_module.load_principals(self.principals_path)
        original = self.native_module._read_facts
        calls = [0]
        def read_then_revoke(*args):
            rows = original(*args)
            calls[0] += 1
            if calls[0] == 2:
                principals = provider()
                principals["agent"]["source_bindings"] = []
                self.principals_path.write_text(json.dumps(principals), encoding="utf-8")
            return rows
        with ComposableRegistry(self.demo["database"], self.demo["source_root"], provider) as registry:
            with patch.object(self.native_module, "_read_facts", read_then_revoke):
                with self.assertRaises(ContextError):
                    self.native_module.execute_native(registry, "agent", bundle, self.demo["source_root"])
        self.assertEqual(calls[0], 2)

    def test_native_final_read_context_revocation_race_denies_delivery(self):
        bundle = self.resolve()
        from pilot.composable_registry import ComposableRegistry
        from pilot.composable_model import ContextError
        provider = lambda: self.cli_module.load_principals(self.principals_path)
        original = self.native_module._read_facts
        calls = [0]
        with ComposableRegistry(self.demo["database"], self.demo["source_root"], provider) as registry:
            def read_then_revoke(*args):
                rows = original(*args)
                calls[0] += 1
                if calls[0] == 2:
                    registry.revoke("releaser", "composable-demo", "M_GROSS_ADDS", 1)
                return rows
            with patch.object(self.native_module, "_read_facts", read_then_revoke):
                with self.assertRaises(ContextError):
                    self.native_module.execute_native(registry, "agent", bundle, self.demo["source_root"])
        self.assertEqual(calls[0], 2)

    def test_imports_are_proposals_and_cannot_publish_without_exact_review(self):
        record = json.loads((self.root / "records" / "G_REVIEWED.json").read_text(encoding="utf-8"))
        record["version"] = 2
        submitter = self.cli_module.CLI(self.demo["database"], self.demo["source_root"], self.principals_path, "submitter")
        releaser = self.cli_module.CLI(self.demo["database"], self.demo["source_root"], self.principals_path, "releaser")
        self.addCleanup(submitter.close)
        self.addCleanup(releaser.close)
        request = {"operation": "record.importbatch", "workspace": "composable-demo",
                   "documents": [{"format": "json", "document": json.dumps(record)}]}
        imported = submitter.execute_line(json.dumps(request))
        self.assertTrue(imported["ok"], imported)
        self.assertEqual(imported["result"]["state"], "proposal")
        denied = releaser.execute_line(json.dumps({"operation": "release.publish", "workspace": "composable-demo",
                                                   "records": [{"id": "G_REVIEWED", "version": 2}]}))
        self.assertFalse(denied["ok"], denied)

    def test_native_rejects_approved_but_unsupported_source_grain(self):
        from pilot.composable_registry import ComposableRegistry
        from pilot.composable_model import ContextError
        source = json.loads((self.root / "records" / "SOURCE_ORDERS.json").read_text(encoding="utf-8"))
        measure = json.loads((self.root / "records" / "M_GROSS_ADDS.json").read_text(encoding="utf-8"))
        source["version"] = measure["version"] = 2
        source["spec"]["grain"] = ["order", "product"]
        next(item for item in measure["dependencies"] if item["id"] == "SOURCE_ORDERS")["version"] = 2
        provider = lambda: self.cli_module.load_principals(self.principals_path)
        with ComposableRegistry(self.demo["database"], self.demo["source_root"], provider) as registry:
            records = [source, measure]
            hashes = registry.submit_batch("submitter", records)
            for record, expected_hash in zip(records, hashes):
                registry.review("reviewer", "composable-demo", record["id"], 2, expected_hash, "approved")
            registry.publish("releaser", "composable-demo", [{"id": record["id"], "version": 2} for record in records])
            bundle = registry.resolve("agent", "composable-demo", "M_GROSS_ADDS",
                                      ["PERIOD_2026_09", "CHANNEL_ONLINE", "PRODUCT_POSTPAID"])
            with self.assertRaises(ContextError) as caught:
                self.native_module.execute_native(registry, "agent", bundle, self.demo["source_root"])
            self.assertEqual(caught.exception.code, "unsupported_native_query")

    def _approved_dimension_type_change(self, dimension, member_id, value_type, value):
        from pilot.composable_registry import ComposableRegistry
        records = [json.loads((self.root / "records" / (identifier + ".json")).read_text(encoding="utf-8"))
                   for identifier in (dimension, member_id, "M_GROSS_ADDS")]
        for record in records:
            record["version"] = 2
            for dependency in record["dependencies"]:
                if dependency["id"] == dimension:
                    dependency["version"] = 2
        records[0]["spec"]["value_type"] = value_type
        records[1]["spec"]["value"] = value
        provider = lambda: self.cli_module.load_principals(self.principals_path)
        with ComposableRegistry(self.demo["database"], self.demo["source_root"], provider) as registry:
            hashes = registry.submit_batch("submitter", records)
            for record, expected_hash in zip(records, hashes):
                registry.review("reviewer", "composable-demo", record["id"], 2, expected_hash, "approved")
            registry.publish("releaser", "composable-demo", [{"id": record["id"], "version": 2} for record in records])
            return registry.resolve("agent", "composable-demo", "M_GROSS_ADDS",
                                     ["PERIOD_2026_09", "CHANNEL_ONLINE", "PRODUCT_POSTPAID"])

    def test_native_rejects_reviewed_integer_channel_binding(self):
        from pilot.composable_registry import ComposableRegistry
        from pilot.composable_model import ContextError
        bundle = self._approved_dimension_type_change("CHANNEL", "CHANNEL_ONLINE", "integer", 1)
        provider = lambda: self.cli_module.load_principals(self.principals_path)
        with ComposableRegistry(self.demo["database"], self.demo["source_root"], provider) as registry:
            with self.assertRaises(ContextError) as caught:
                self.native_module.execute_native(registry, "agent", bundle, self.demo["source_root"])
            self.assertEqual(caught.exception.code, "unsupported_native_query")

    def test_native_rejects_reviewed_text_period_binding(self):
        from pilot.composable_registry import ComposableRegistry
        from pilot.composable_model import ContextError
        bundle = self._approved_dimension_type_change("PERIOD", "PERIOD_2026_09", "text", "not-a-period")
        provider = lambda: self.cli_module.load_principals(self.principals_path)
        with ComposableRegistry(self.demo["database"], self.demo["source_root"], provider) as registry:
            with self.assertRaises(ContextError) as caught:
                self.native_module.execute_native(registry, "agent", bundle, self.demo["source_root"])
            self.assertEqual(caught.exception.code, "unsupported_native_query")

    def test_native_fact_shape_cardinality_and_byte_bounds(self):
        import hashlib
        from pilot.composable_model import ContextError
        facts_path = Path(self.demo["source_root"]) / "orders.json"
        rows = json.loads(facts_path.read_text(encoding="utf-8"))
        invalid_inputs = [json.dumps(rows + [rows[0]]).encode(),
                          json.dumps([dict(rows[0], cost="private")]).encode(),
                          b" " * (self.native_module.MAX_FACT_BYTES + 1)]
        for raw in invalid_inputs:
            facts_path.write_bytes(raw)
            with self.assertRaises(ContextError):
                self.native_module._read_facts(self.demo["source_root"], hashlib.sha256(raw).hexdigest())

    def test_current_bundle_revalidation_is_a_separate_cli_operation(self):
        bundle = self.resolve()
        result = self.request("context.revalidate", bundle=bundle)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["result"]["bundle_hash"], bundle["bundle_hash"])

    def test_oversized_line_is_drained_without_consuming_next_request(self):
        line = "x" * (self.cli_module.MAX_REQUEST_BYTES + 10) + "\n"
        good = json.dumps({"operation": "context.search", "workspace": "composable-demo", "query": "adds"})
        output = io.StringIO()
        self.cli_module.serve(self.port, io.StringIO(line + good + "\n"), output)
        responses = [json.loads(item) for item in output.getvalue().splitlines()]
        self.assertEqual(len(responses), 2)
        self.assertFalse(responses[0]["ok"])
        self.assertTrue(responses[1]["ok"], responses)

    def test_search_cursor_error_codes_allow_safe_restart(self):
        result = self.request("context.search", workspace="composable-demo", query="synthetic", page_size=1)
        self.assertTrue(result["ok"], result)
        cursor = result["result"]["next_cursor"]
        self.assertIsNotNone(cursor)
        principals = json.loads(self.principals_path.read_text(encoding="utf-8"))
        principals["agent"]["source_bindings"] = []
        self.principals_path.write_text(json.dumps(principals), encoding="utf-8")
        result = self.request("context.search", workspace="composable-demo", query="synthetic", page_size=1, cursor=cursor)
        self.assertFalse(result["ok"], result)
        self.assertEqual(result["error"]["code"], "stale_cursor")

    def test_module_entry_accepts_json_lines_and_recovers_after_bad_line(self):
        command = [sys.executable, "-B", "-m", "pilot.composable_cli", "--database", self.demo["database"],
                   "--source-root", self.demo["source_root"], "--principals", self.demo["principals"],
                   "--principal", "agent"]
        good = json.dumps({"operation": "context.search", "workspace": "composable-demo", "query": "adds"})
        process = subprocess.run(command, input="{bad}\n" + good + "\n", text=True,
                                 capture_output=True, check=True)
        responses = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual(len(responses), 2)
        self.assertFalse(responses[0]["ok"])
        self.assertTrue(responses[1]["ok"], responses)

    def test_malformed_identifier_and_boolean_version_do_not_escape_or_revoke(self):
        for principal, operation, fields in (
            ("agent", "context.export", {"id": [], "format": "json"}),
            ("agent", "context.export", {"id": "M_GROSS_ADDS", "version": True, "format": "json"}),
            ("agent", "context.export", {"id": "M_GROSS_ADDS", "version": 2 ** 80, "format": "json"}),
            ("reviewer", "record.review", {"id": {}, "version": 1, "expected_hash": "a" * 64, "decision": "approved"}),
            ("releaser", "record.revoke", {"id": "M_GROSS_ADDS", "version": True}),
            ("releaser", "record.revoke", {"id": "M_GROSS_ADDS", "version": []}),
        ):
            port = self.cli_module.CLI(self.demo["database"], self.demo["source_root"], self.principals_path, principal)
            try:
                try:
                    result = port.execute_line(json.dumps(dict(operation=operation, workspace="composable-demo", **fields)))
                except Exception as exc:
                    self.fail("malformed request escaped safe machine boundary: " + type(exc).__name__)
                self.assertFalse(result["ok"], result)
                self.assertEqual(result["error"]["code"], "invalid_request")
            finally:
                port.close()
        self.assertTrue(self.resolve())

    def test_sql_binding_attack_line_does_not_kill_cli_process(self):
        command = [sys.executable, "-B", "-m", "pilot.composable_cli", "--database", self.demo["database"],
                   "--source-root", self.demo["source_root"], "--principals", self.demo["principals"], "--principal", "agent"]
        bad = json.dumps({"operation": "context.export", "workspace": "composable-demo", "id": [], "format": "json"})
        huge = json.dumps({"operation": "context.export", "workspace": "composable-demo", "id": "M_GROSS_ADDS",
                           "version": 2 ** 80, "format": "json"})
        good = json.dumps({"operation": "context.search", "workspace": "composable-demo", "query": "adds"})
        process = subprocess.run(command, input=bad + "\n" + huge + "\n" + good + "\n", text=True, capture_output=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        responses = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual(len(responses), 3)
        self.assertFalse(responses[0]["ok"])
        self.assertFalse(responses[1]["ok"])
        self.assertTrue(responses[2]["ok"], responses)

    def test_checked_in_human_yaml_and_markdown_equal_json_proposal(self):
        from pilot.composable_formats import parse_document
        from pilot.composable_model import digest
        examples = Path(__file__).resolve().parents[1] / "examples" / "composable" / "records"
        record = parse_document((examples / "M_GROSS_ADDS.json").read_text(encoding="utf-8"), "json")
        yaml = (examples / "M_GROSS_ADDS.yaml").read_text(encoding="utf-8")
        self.assertIn("- id:", yaml)
        self.assertIn("narrative: |-", yaml)
        self.assertEqual(digest(parse_document(yaml, "yaml")), digest(record))
        markdown = (examples / "M_GROSS_ADDS.md").read_text(encoding="utf-8")
        self.assertEqual(digest(parse_document(markdown, "markdown")), digest(record))


if __name__ == "__main__":
    unittest.main()
