"""Acceptance tests for the local lifecycle, including independent process use."""

import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from .consumers import consume
from .context_pilot import ContextError, Registry, digest
from .native_sales import NativeSales
from .sample_domain import METRIC, PRINCIPALS, REQUEST, WORKSPACE, records, submit_and_review


ROOT = Path(__file__).resolve().parents[1]


class Acceptance(unittest.TestCase):
    def setUp(self):
        validation_root = ROOT / ".validation"
        validation_root.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="context-pilot-test-", dir=validation_root)
        self.directory = Path(self.temp.name)
        self.sources = self.directory / "sources"
        shutil.copytree(ROOT / "pilot" / "fixtures", self.sources)
        self.database = self.directory / "registry.sqlite3"
        self.now = datetime.now(timezone.utc)
        self.clock = lambda: self.now
        self.registry = Registry(self.database, self.sources, PRINCIPALS, self.clock)
        self.native = NativeSales(self.sources)
        self.bodies = records(self.registry, self.now)
        self.manifest = {b["id"]: b["version"] for b in self.bodies}

    def tearDown(self):
        self.registry.close()
        self.temp.cleanup()

    def start(self):
        submit_and_review(self.registry, self.bodies)
        self.registry.publish("release-owner", WORKSPACE, "r1", self.manifest)

    def request(self, actor="agent", **changes):
        return self.registry.dispatch(actor, {**REQUEST, **changes})

    def assert_code(self, code, function, *args):
        with self.assertRaises(ContextError) as raised:
            function(*args)
        self.assertEqual(code, raised.exception.code)

    def test_three_consumers_same_contract_and_native_result(self):
        self.start()
        outputs = [consume(kind, self.registry.dispatch, self.native.query)
                   for kind in ("agent", "chatbot", "workflow")]
        self.assertTrue(all(o["result"]["value_cents"] == 330000 for o in outputs))
        self.assertEqual(outputs[0]["context"], outputs[1]["context"])
        self.assertEqual(outputs[1]["context"], outputs[2]["context"])
        self.assertTrue(outputs[2]["output"]["matched"])
        self.assertEqual(4, len(outputs[0]["context"]["records"]))

    def test_durable_restart_preserves_bundle_review_and_audit(self):
        self.start()
        expected = self.request()["context"]
        audit_before = self.registry.audit()
        with Registry(self.database, self.sources, PRINCIPALS, self.clock) as restarted:
            self.assertEqual(expected, restarted.dispatch("agent", REQUEST)["context"])
            self.assertEqual(audit_before, restarted.audit()[:len(audit_before)])
            self.assertTrue(all(item["reviewed_by"] == "reviewer" for item in expected["records"]))

    def test_malformed_records_never_enter_registry(self):
        for change in ({"layer": []}, {"version": True}, {"claim": ""},
                       {"evidence": []}, {"valid_until": "no"}, {"content": {}}):
            with self.subTest(change=change):
                self.assert_code("invalid_record", self.registry.submit, "domain-owner",
                                 {**self.bodies[0], **change})
        self.assertEqual(0, self.registry.db.execute("SELECT COUNT(*) FROM records").fetchone()[0])
        self.assertIsNone(self.registry.active_release(WORKSPACE))

    def test_source_escape_rejected(self):
        body = copy.deepcopy(self.bodies[0])
        body["evidence"][0]["path"] = "../registry.sqlite3"
        self.assert_code("invalid_source", self.registry.submit, "domain-owner", body)

    def test_immutable_version_and_idempotent_submission(self):
        original = self.registry.submit("domain-owner", self.bodies[0])
        self.assertEqual(original, self.registry.submit("domain-owner", self.bodies[0]))
        self.assertEqual(1, len(self.registry.audit()))
        changed = {**self.bodies[0], "claim": "Different meaning"}
        self.assert_code("immutable_version", self.registry.submit, "domain-owner", changed)

    def test_roles_cannot_submit_approve_or_publish_for_each_other(self):
        self.assert_code("access_denied", self.registry.submit, "agent", self.bodies[0])
        receipt = self.registry.submit("domain-owner", self.bodies[0])
        self.assert_code("access_denied", self.registry.approve, "domain-owner", WORKSPACE,
                         "data:orders", 1, receipt)
        self.assert_code("access_denied", self.registry.publish, "reviewer", WORKSPACE,
                         "bad", self.manifest)

    def test_self_approval_denied_even_with_both_roles(self):
        self.registry.principals["domain-owner"]["roles"].append("reviewer")
        receipt = self.registry.submit("domain-owner", self.bodies[0])
        self.assert_code("self_approval", self.registry.approve, "domain-owner", WORKSPACE,
                         "data:orders", 1, receipt)

    def test_approval_binds_full_content_and_version(self):
        self.start()
        original = self.bodies[1]
        changed = {**original, "version": 2, "classification": "restricted"}
        self.registry.submit("domain-owner", changed)
        self.assert_code("approval_hash_mismatch", self.registry.approve, "reviewer", WORKSPACE,
                         METRIC, 2, digest(original))
        self.assert_code("unapproved", self.registry.publish, "release-owner", WORKSPACE,
                         "bad", {**self.manifest, METRIC: 2})
        self.assertEqual("r1", self.registry.active_release(WORKSPACE))

    def test_rejection_and_request_changes_require_new_version(self):
        for index, decision in ((0, "rejected"), (1, "changes_requested")):
            body = self.bodies[index]
            receipt = self.registry.submit("domain-owner", body)
            self.registry.hold_review("reviewer", WORKSPACE, body["id"], 1, receipt, decision)
            self.assert_code("review_blocked", self.registry.approve, "reviewer", WORKSPACE,
                             body["id"], 1, receipt)
        self.assertIsNone(self.registry.active_release(WORKSPACE))

    def test_unapproved_interpretation_cannot_publish(self):
        submit_and_review(self.registry, self.bodies[:3])
        self.registry.submit("domain-owner", self.bodies[3])
        self.assert_code("unapproved", self.registry.publish, "release-owner", WORKSPACE,
                         "bad", self.manifest)
        self.assertIsNone(self.registry.active_release(WORKSPACE))

    def test_incomplete_layers_cannot_publish(self):
        submit_and_review(self.registry, self.bodies)
        self.assert_code("incomplete_layers", self.registry.publish, "release-owner", WORKSPACE,
                         "bad", {"data:orders": 1})

    def test_broken_dependency_keeps_previous_valid_release(self):
        self.start()
        changed = copy.deepcopy(self.bodies[1])
        changed["version"] = 2
        changed["dependencies"] = [{"id": "data:missing", "version": 1}]
        submit_and_review(self.registry, [changed])
        self.assert_code("dependency_mismatch", self.registry.publish, "release-owner", WORKSPACE,
                         "bad", {**self.manifest, METRIC: 2})
        self.assertTrue(self.request()["ok"])
        self.assertEqual("r1", self.registry.active_release(WORKSPACE))

    def test_dependency_cycle_cannot_publish(self):
        changed = copy.deepcopy(self.bodies)
        changed[2]["dependencies"] = [{"id": changed[2]["id"], "version": 1}]
        submit_and_review(self.registry, changed)
        self.assert_code("dependency_cycle", self.registry.publish, "release-owner", WORKSPACE,
                         "bad", self.manifest)

    def test_publication_fault_rolls_back_release_pointer_and_audit(self):
        self.start()
        original_event = self.registry._event

        def fail_on_publish(actor, workspace, action, details):
            if action == "published":
                raise RuntimeError("injected disk-write failure")
            original_event(actor, workspace, action, details)

        before = self.registry.audit()
        with patch.object(self.registry, "_event", side_effect=fail_on_publish):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                self.registry.publish("release-owner", WORKSPACE, "r2", self.manifest)
        self.assertEqual("r1", self.registry.active_release(WORKSPACE))
        self.assertIsNone(self.registry.db.execute("SELECT name FROM releases WHERE name='r2'").fetchone())
        self.assertEqual(before, self.registry.audit())
        self.assertTrue(self.request()["ok"])

    def test_source_drift_denies_and_exposes_transitive_maintenance_impact(self):
        self.start()
        (self.sources / "orders.json").write_text("{}", encoding="utf-8")
        self.assertEqual({"ok": False, "error": "stale_source"}, self.request())
        self.assertEqual(4, len(self.registry.impact(WORKSPACE, "orders.json")))
        self.assertEqual(2, len(self.registry.impact(WORKSPACE, "net_revenue.sql")))

    def test_source_removed_denies(self):
        self.start()
        (self.sources / "orders.json").unlink()
        self.assertEqual({"ok": False, "error": "source_unavailable"}, self.request())

    def test_correction_requires_review_and_publication_before_recovery(self):
        self.start()
        path = self.sources / "orders.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["orders"][0]["gross_cents"] += 10000
        path.write_text(json.dumps(data), encoding="utf-8")
        self.assertFalse(self.request()["ok"])
        versions = {key: value + 1 for key, value in self.manifest.items()}
        updated = records(self.registry, self.now, versions)
        manifest = submit_and_review(self.registry, updated)
        self.assertFalse(self.request()["ok"])
        self.registry.publish("release-owner", WORKSPACE, "r2", manifest)
        output = consume("workflow", self.registry.dispatch, self.native.query)
        self.assertEqual(340000, output["result"]["value_cents"])
        self.assertTrue(all(item["record"]["version"] == 2 for item in output["context"]["records"]))

    def test_expiry_and_old_release_reactivation_denied(self):
        self.start()
        self.now += timedelta(days=30)
        self.assertEqual("outside_validity", self.request()["error"])
        self.assert_code("outside_validity", self.registry.publish, "release-owner", WORKSPACE,
                         "r1", self.manifest)

    def test_mixed_offset_expiry_uses_instant_order(self):
        # The lexical minimum is later: 05:00Z vs 01:00-05:00 (=06:00Z).
        end = self.now + timedelta(days=2)
        early = end.replace(hour=5, minute=0, second=0, microsecond=0)
        late = early + timedelta(hours=1)
        self.bodies[0]["valid_until"] = early.isoformat()
        self.bodies[1]["valid_until"] = late.astimezone(timezone(timedelta(hours=-5))).isoformat()
        self.start()
        self.assertEqual(early, datetime.fromisoformat(self.request()["context"]["valid_until"]))

    def test_record_revocation_blocks_transitive_context_and_cached_use(self):
        self.start()
        old = self.request()["context"]
        self.registry.revoke("reviewer", WORKSPACE, "data:orders", 1)
        self.assertEqual({"ok": False, "error": "revoked"}, self.request())
        self.assert_code("revoked", self.native.query, "agent", old, self.registry.dispatch)
        self.assert_code("revoked", self.registry.approve, "reviewer", WORKSPACE,
                         "data:orders", 1, digest(self.bodies[0]))

    def test_unknown_and_cross_workspace_principals_denied_without_payload(self):
        self.start()
        for actor, changes in (("unknown", {}), ("outsider", {}),
                               ("agent", {"workspace": "another-lab"})):
            self.assertEqual({"ok": False, "error": "access_denied"}, self.request(actor, **changes))

    def test_record_classification_and_current_consumer_grants_checked(self):
        self.bodies[0]["classification"] = "restricted"
        self.start()
        self.assertEqual({"ok": False, "error": "access_denied"}, self.request())
        self.registry.principals["agent"]["classifications"].append("restricted")
        old = self.request()["context"]
        self.registry.principals["agent"]["roles"] = []
        self.assert_code("access_denied", self.native.query, "agent", old, self.registry.dispatch)

    def test_native_permissions_are_independent_of_context_access(self):
        self.start()
        old = self.request()["context"]
        self.native.allowed.remove("agent")
        self.assertTrue(self.request()["ok"])
        self.assert_code("source_access_denied", self.native.query, "agent", old, self.registry.dispatch)

    def test_wrong_period_unit_and_unknown_metric_do_not_guess(self):
        self.start()
        for changes, error in (({"period": "2026-08"}, "scope_mismatch"),
                               ({"unit": "EUR"}, "scope_mismatch"),
                               ({"metric_id": "net sales"}, "metric_unavailable")):
            self.assertEqual({"ok": False, "error": error}, self.request(**changes))

    def test_malformed_requests_deny_without_crashing(self):
        self.start()
        for request in ([], None, {}, {**REQUEST, "workspace": {}},
                        {**REQUEST, "workspace": []}, {**REQUEST, "unit": True}):
            self.assertEqual({"ok": False, "error": "invalid_request"},
                             self.registry.dispatch("agent", request))
        self.assertTrue(self.request()["ok"])

    def test_feedback_is_pending_and_cannot_mutate_approved_meaning(self):
        self.start()
        expected = self.request()["context"]
        self.registry.feedback("chatbot", WORKSPACE, "r1", "Please explain returns.")
        self.assertEqual(expected, self.request()["context"])
        events = self.registry.audit()
        self.assertEqual(1, sum(e["action"] == "feedback_pending_review" for e in events))

    def test_database_content_tampering_detected(self):
        self.start()
        with self.registry.db:
            changed = {**self.bodies[0], "claim": "Edited outside versioning"}
            self.registry.db.execute("UPDATE records SET body=? WHERE id='data:orders'",
                                     (json.dumps(changed),))
        self.assertEqual({"ok": False, "error": "integrity_failure"}, self.request())

    def test_release_name_cannot_rebind_manifest(self):
        self.start()
        updated = copy.deepcopy(self.bodies[3])
        updated["version"] = 2
        submit_and_review(self.registry, [updated])
        self.assert_code("immutable_release", self.registry.publish, "release-owner", WORKSPACE,
                         "r1", {**self.manifest, updated["id"]: 2})

    def test_separate_process_json_contract_recovers_after_bad_input(self):
        self.start()
        expected = self.request()["context"]
        command = [sys.executable, "-m", "pilot.cli", "--database", str(self.database),
                   "--source-root", str(self.sources), "--principal", "chatbot"]
        result = subprocess.run(command, input="{bad\n" + json.dumps({**REQUEST, "workspace": {}})
                                + "\n" + json.dumps(REQUEST) + "\n", text=True,
                                capture_output=True, cwd=ROOT, timeout=15)
        self.assertEqual(0, result.returncode, result.stderr)
        lines = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual({"ok": False, "error": "invalid_json"}, lines[0])
        self.assertEqual({"ok": False, "error": "invalid_request"}, lines[1])
        self.assertEqual(expected, lines[2]["context"])

    def test_record_request_manifest_and_bundle_size_limits(self):
        large = {**self.bodies[0], "claim": "x" * 8193}
        self.assert_code("record_too_large", self.registry.submit, "domain-owner", large)
        self.start()
        self.assertEqual("invalid_request", self.request(metric_id="x" * 4097)["error"])
        self.assert_code("invalid_manifest", self.registry.publish, "release-owner", WORKSPACE,
                         "bad", {"id-" + str(i): 1 for i in range(17)})
        with patch("pilot.context_pilot.MAX_BUNDLE_BYTES", 100):
            self.assertEqual({"ok": False, "error": "bundle_too_large"}, self.request())

    def test_newly_reviewed_malformed_source_fails_without_uncaught_exception(self):
        for data in ([], {"workspace": WORKSPACE, "period": "2026-09", "unit": "USD cents",
                          "orders": [{}]}):
            with self.subTest(data=data):
                (self.sources / "orders.json").write_text(json.dumps(data), encoding="utf-8")
                count = self.registry.db.execute("SELECT COUNT(*) FROM releases").fetchone()[0]
                version = count + 1
                bodies = records(self.registry, self.now,
                                 {key: version for key in self.manifest})
                manifest = submit_and_review(self.registry, bodies)
                self.registry.publish("release-owner", WORKSPACE, "r" + str(version), manifest)
                self.assert_code("invalid_source_data", consume, "agent",
                                 self.registry.dispatch, self.native.query)

    def test_native_revision_must_equal_bound_source_hash(self):
        self.bodies[1]["content"]["native_revision"] = "unchecked-label"
        submit_and_review(self.registry, self.bodies)
        self.assert_code("source_binding_mismatch", self.registry.publish,
                         "release-owner", WORKSPACE, "bad", self.manifest)

    def search(self, query, actor="agent", **changes):
        request = {"operation": "context.search", "workspace": WORKSPACE,
                   "query": query, "period": "2026-09", "unit": "USD", **changes}
        return self.registry.dispatch(actor, request)

    def test_exact_and_keyword_search_resolve_current_context(self):
        self.start()
        for query, method in ((METRIC, "exact"), ("net sales", "keyword")):
            response = self.search(query)
            self.assertTrue(response["ok"], response)
            self.assertEqual(method, response["search"]["candidates"][0]["match"])
            self.assertEqual(self.request()["context"], response["search"]["context"])

    def test_search_abstains_for_unknown_ambiguous_and_wrong_scope(self):
        self.start()
        for query, changes, code in (("unknown thing", {}, "no_match"),
                                     ("synthetic", {}, "ambiguous_match"),
                                     (METRIC, {"period": "2026-08"}, "scope_mismatch"),
                                     ("", {}, "invalid_request")):
            self.assertEqual({"ok": False, "error": code}, self.search(query, **changes))

    def test_search_cannot_leak_after_access_revocation_or_source_drift(self):
        self.start()
        self.assertEqual({"ok": False, "error": "access_denied"}, self.search("net sales", "outsider"))
        (self.sources / "orders.json").write_text("{}", encoding="utf-8")
        self.assertEqual({"ok": False, "error": "stale_source"}, self.search("net sales"))

    def test_stale_index_cannot_bypass_record_resolution_and_can_rebuild(self):
        self.start()
        with self.registry.db:
            self.registry.db.execute("UPDATE search_refs SET version=99 WHERE record_id=?", (METRIC,))
        self.assertEqual({"ok": False, "error": "stale_index"}, self.search(METRIC))
        self.registry.publish("release-owner", WORKSPACE, "r1", self.manifest)
        self.assertTrue(self.search(METRIC)["ok"])

    def test_revoked_input_is_denied_through_search_index(self):
        self.start()
        self.registry.revoke("reviewer", WORKSPACE, "data:orders", 1)
        self.assertEqual({"ok": False, "error": "revoked"}, self.search("net sales"))

    def test_reviewed_source_integer_overflow_is_controlled(self):
        path = self.sources / "orders.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["orders"][0]["gross_cents"] = 9223372036854775808
        path.write_text(json.dumps(data), encoding="utf-8")
        self.bodies = records(self.registry, self.now)
        self.start()
        self.assert_code("invalid_source_data", consume, "agent", self.registry.dispatch, self.native.query)

    def test_native_query_has_a_finite_execution_budget(self):
        (self.sources / "net_revenue.sql").write_text(
            "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100000000) "
            "SELECT SUM(x) FROM n;", encoding="utf-8")
        self.bodies = records(self.registry, self.now)
        self.start()
        self.assert_code("invalid_native_query", consume, "agent", self.registry.dispatch, self.native.query)

    def test_index_text_corruption_is_controlled(self):
        self.start()
        with self.registry.db:
            self.registry.db.execute("UPDATE search_refs SET tokens='[]'")
        self.assertEqual({"ok": False, "error": "stale_index"}, self.search(METRIC))

    def test_search_ignores_unrelated_content_fields_when_resolving_concepts(self):
        self.bodies[0]["content"]["concept"] = []
        self.start()
        self.assertEqual({"ok": False, "error": "ambiguous_match"}, self.search("synthetic"))
        self.assertTrue(self.search("net sales")["ok"])

    def test_malformed_audit_scope_and_nonstring_keys_do_not_crash(self):
        self.start()
        self.assertEqual({"ok": False, "error": "access_denied"},
                         self.registry.dispatch("agent", {**REQUEST, "workspace": "\ud800"}))
        self.assertEqual({"ok": False, "error": "invalid_request"},
                         self.registry.dispatch("agent", {**REQUEST, 1: "unsupported"}))


if __name__ == "__main__":
    unittest.main()
