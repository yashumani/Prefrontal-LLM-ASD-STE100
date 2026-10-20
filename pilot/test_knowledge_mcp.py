"""Read-only MCP transport acceptance with simulated local review fixtures.

These tests do not perform a human approval or contact a model/network service.
"""

import copy
import io
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from .context_pilot import ContextError, canonical
from .knowledge import KnowledgeRegistry
from .knowledge_mcp import MCPServer


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = "mcp-acceptance"
PRINCIPALS = {
    "fixture-author": {"workspace": WORKSPACE, "roles": ["submitter"]},
    "fixture-reviewer": {"workspace": WORKSPACE, "roles": ["reviewer"]},
    "fixture-publisher": {"workspace": WORKSPACE, "roles": ["publisher"]},
    "codex-reader": {"workspace": WORKSPACE, "roles": ["consumer"],
                     "classifications": ["internal"]},
}


class KnowledgeMCPAcceptance(unittest.TestCase):
    def setUp(self):
        validation = ROOT / ".validation"
        validation.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="mcp-test-", dir=validation)
        self.directory = Path(self.temp.name)
        self.sources = self.directory / "sources"
        self.sources.mkdir()
        (self.sources / "authority.md").write_text("Native services keep action authority.\n", encoding="utf-8")
        (self.sources / "review.md").write_text("Independent review controls approved meaning.\n", encoding="utf-8")
        (self.sources / "restricted.md").write_text("Restricted fixture source.\n", encoding="utf-8")
        self.database = self.directory / "registry.sqlite3"
        self.principals_path = self.directory / "principals.json"
        self.principals = copy.deepcopy(PRINCIPALS)
        self.write_principals()
        now = datetime.now(timezone.utc)
        with KnowledgeRegistry(self.database, self.sources, self.principals) as registry:
            def record(record_id, source, text, dependencies=None, classification="internal"):
                return {
                    "id": record_id, "version": 1, "workspace": WORKSPACE,
                    "layer": "interpretation" if dependencies else "data", "owner": "fixture-owner",
                    "claim": text, "classification": classification,
                    "valid_from": (now - timedelta(minutes=1)).isoformat(),
                    "valid_until": (now + timedelta(days=1)).isoformat(),
                    "evidence": [registry.evidence(source)], "dependencies": dependencies or [],
                    "content": {"text": text, "topics": [text.casefold()],
                                "assumptions": ["Simulated unit-test review."],
                                "limits": ["No action authorization."]},
                }

            self.authority = record("context:authority", "authority.md", "Native services keep action authority")
            self.review = record("context:review", "review.md", "Independent review controls approved meaning")
            self.summary = record("context:summary", "authority.md", "Dependent summary",
                                  [{"id": self.authority["id"], "version": 1}])
            self.restricted = record("context:restricted", "restricted.md", "Restricted canary payload",
                                     classification="restricted")
            self.guide = record("context:guide", "review.md", "UNAPPROVED GUIDE CANARY")
            published = [self.authority, self.review, self.summary, self.restricted]
            for body in published:
                receipt = registry.submit("fixture-author", body)
                registry.approve("fixture-reviewer", WORKSPACE, body["id"], 1, receipt)
            registry.publish("fixture-publisher", WORKSPACE, "fixture-r1",
                             {body["id"]: 1 for body in published})
            registry.submit("fixture-author", self.guide)
        self.allowed_ids = [body["id"] for body in [self.authority, self.review, self.summary,
                                                   self.restricted, self.guide]]
        self.server = self.make_server()

    def tearDown(self):
        self.temp.cleanup()

    def write_principals(self):
        self.principals_path.write_text(json.dumps(self.principals), encoding="utf-8")

    def make_server(self, **overrides):
        values = {"database": self.database, "source_root": self.sources,
                  "principals_path": self.principals_path, "principal": "codex-reader",
                  "workspace": WORKSPACE, "record_ids": self.allowed_ids}
        values.update(overrides)
        return MCPServer(**values)

    def request(self, method, params=None, request_id=1, server=None):
        value = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            value["params"] = params
        return (server or self.server).handle(value)

    def initialize(self, server=None, protocol="2025-11-25"):
        target = server or self.server
        response = self.request("initialize", {"protocolVersion": protocol, "capabilities": {},
                                "clientInfo": {"name": "unit-test", "version": "1"}}, server=target)
        self.assertNotIn("error", response)
        self.assertIsNone(target.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}))
        return response

    def tool(self, name="prefrontal_get", arguments=None, server=None):
        if arguments is None:
            arguments = {"record_ids": [self.authority["id"]]}
        return self.request("tools/call", {"name": name, "arguments": arguments}, server=server)

    def controlled(self, response, error=None):
        self.assertNotIn("error", response, response)
        result = response["result"]
        self.assertTrue(result["isError"], result)
        data = result["structuredContent"]
        self.assertFalse(data["ok"])
        if error is not None:
            self.assertEqual(error, data["error"])
        self.assertNotIn("context", data)
        self.assertNotIn("search", data)
        return data

    def stream(self, payload, server=None):
        writer = io.BytesIO()
        (server or self.server).serve(io.BytesIO(payload), writer)
        lines = writer.getvalue().splitlines()
        return [json.loads(line.decode("utf-8")) for line in lines]

    def published_state(self):
        tables = ("records", "approvals", "releases", "active", "search_refs", "registry_config")
        with closing(sqlite3.connect(self.database)) as connection:
            return {table: connection.execute("SELECT * FROM " + table + " ORDER BY 1,2").fetchall()
                    for table in tables}

    def test_initialize_negotiates_supported_versions_and_declares_only_tools(self):
        for protocol in ("2025-11-25", "2025-06-18", "2025-03-26", "1900-01-01"):
            with self.subTest(protocol=protocol):
                server = self.make_server()
                response = self.initialize(server, protocol)
                expected = protocol if protocol != "1900-01-01" else "2025-11-25"
                self.assertEqual(expected, response["result"]["protocolVersion"])
                self.assertIn("tools", response["result"]["capabilities"])
                self.assertNotIn("resources", response["result"]["capabilities"])
                self.assertNotIn("prompts", response["result"]["capabilities"])

    def test_lifecycle_requires_initialized_notification_before_tool_use(self):
        self.assertEqual(-32002, self.request("tools/list")["error"]["code"])
        self.request("initialize", {"protocolVersion": "2025-11-25", "capabilities": {},
                                   "clientInfo": {"name": "test", "version": "1"}})
        self.assertEqual(-32002, self.tool()["error"]["code"])
        self.assertIsNone(self.server.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}))
        self.assertTrue(self.tool()["result"]["structuredContent"]["ok"])

    def test_ping_is_available_before_initialization_and_notifications_have_no_reply(self):
        self.assertEqual({}, self.request("ping")["result"])
        self.assertIsNone(self.server.handle({"jsonrpc": "2.0", "method": "notifications/cancelled",
                                             "params": {"requestId": 20}}))

    def test_tools_discovery_exposes_only_read_only_narrow_arguments(self):
        self.initialize()
        tools = {tool["name"]: tool for tool in self.request("tools/list")["result"]["tools"]}
        self.assertEqual({"prefrontal_get", "prefrontal_search"}, set(tools))
        for name, field in (("prefrontal_get", "record_ids"), ("prefrontal_search", "query")):
            with self.subTest(name=name):
                schema = tools[name]["inputSchema"]
                self.assertEqual({field}, set(schema["properties"]))
                self.assertEqual([field], schema["required"])
                self.assertFalse(schema["additionalProperties"])
                self.assertTrue(tools[name]["annotations"]["readOnlyHint"])

    def test_multirecord_get_delivers_exact_current_versions_and_matching_json_text(self):
        self.initialize()
        response = self.tool(arguments={"record_ids": [self.authority["id"], self.review["id"]]})
        result = response["result"]
        self.assertFalse(result.get("isError", False))
        data = result["structuredContent"]
        self.assertTrue(data["ok"], data)
        self.assertEqual(data, json.loads(result["content"][0]["text"]))
        records = {entry["record"]["id"]: entry["record"] for entry in data["context"]["records"]}
        self.assertEqual({self.authority["id"], self.review["id"]}, set(records))
        self.assertEqual(self.authority, records[self.authority["id"]])
        self.assertEqual(self.review, records[self.review["id"]])
        self.assertTrue(data["context"]["recheck_at_use"])

    def test_dependency_closure_is_delivered_when_every_record_is_allowlisted(self):
        self.initialize()
        data = self.tool(arguments={"record_ids": [self.summary["id"]]})["result"]["structuredContent"]
        self.assertTrue(data["ok"], data)
        self.assertEqual({self.summary["id"], self.authority["id"]},
                         {entry["record"]["id"] for entry in data["context"]["records"]})

    def test_source_drift_denies_delivery_on_next_get_and_restoration_recovers(self):
        self.initialize()
        before = self.tool()["result"]["structuredContent"]
        source = self.sources / "authority.md"
        original = source.read_bytes()
        source.write_text("Changed native authority.\n", encoding="utf-8")
        self.controlled(self.tool(), "stale_source")
        source.write_bytes(original)
        self.assertEqual(before, self.tool()["result"]["structuredContent"])

    def test_principal_classification_withdrawal_is_reloaded_per_tool_call(self):
        self.initialize()
        self.assertTrue(self.tool()["result"]["structuredContent"]["ok"])
        self.principals["codex-reader"]["classifications"] = []
        self.write_principals()
        self.controlled(self.tool(), "access_denied")
        self.principals["codex-reader"]["classifications"] = ["internal"]
        self.write_principals()
        self.assertTrue(self.tool()["result"]["structuredContent"]["ok"])

    def test_principal_role_change_denies_current_request_without_management_authority(self):
        self.initialize()
        self.principals["codex-reader"]["roles"] = ["consumer", "reviewer"]
        self.write_principals()
        self.controlled(self.tool())

    def test_current_record_revocation_is_seen_without_server_restart(self):
        self.initialize()
        self.assertTrue(self.tool()["result"]["structuredContent"]["ok"])
        with KnowledgeRegistry(self.database, self.sources, self.principals) as registry:
            registry.revoke("fixture-reviewer", WORKSPACE, self.authority["id"], 1)
        self.controlled(self.tool(), "revoked")

    def test_unapproved_guide_is_never_delivered(self):
        self.initialize()
        response = self.tool(arguments={"record_ids": [self.guide["id"]]})
        self.controlled(response)
        self.assertNotIn("UNAPPROVED GUIDE CANARY", json.dumps(response))
        response = self.tool("prefrontal_search", {"query": self.guide["id"]})
        self.controlled(response, "no_match")
        self.assertNotIn("UNAPPROVED GUIDE CANARY", json.dumps(response))

    def test_restricted_record_and_search_result_do_not_leak_payload(self):
        self.initialize()
        for name, arguments, expected in (
                ("prefrontal_get", {"record_ids": [self.restricted["id"]]}, "access_denied"),
                ("prefrontal_search", {"query": self.restricted["id"]}, "no_match")):
            with self.subTest(name=name):
                response = self.tool(name, arguments)
                self.controlled(response, expected)
                self.assertNotIn("Restricted canary payload", json.dumps(response))

    def test_read_tools_preserve_records_reviews_release_and_principal_configuration(self):
        before = self.published_state()
        principal_bytes = self.principals_path.read_bytes()
        self.initialize()
        self.assertTrue(self.tool()["result"]["structuredContent"]["ok"])
        self.assertTrue(self.tool("prefrontal_search", {"query": self.review["id"]})
                        ["result"]["structuredContent"]["ok"])
        self.assertEqual(before, self.published_state())
        self.assertEqual(principal_bytes, self.principals_path.read_bytes())

    def test_out_of_allowlist_get_is_denied_without_partial_content(self):
        server = self.make_server(record_ids=[self.review["id"]])
        self.initialize(server)
        response = self.tool(arguments={"record_ids": [self.review["id"], self.authority["id"]]}, server=server)
        self.controlled(response, "record_scope_denied")
        self.assertNotIn(self.authority["content"]["text"], json.dumps(response))
        self.assertNotIn(self.review["content"]["text"], json.dumps(response))

    def test_dependency_outside_allowlist_denies_get_and_search_without_partial_content(self):
        server = self.make_server(record_ids=[self.summary["id"]])
        self.initialize(server)
        for name, arguments in (("prefrontal_get", {"record_ids": [self.summary["id"]]}),
                                ("prefrontal_search", {"query": self.summary["id"]})):
            with self.subTest(name=name):
                response = self.tool(name, arguments, server=server)
                self.controlled(response, "record_scope_denied")
                self.assertNotIn(self.authority["content"]["text"], json.dumps(response))
                self.assertNotIn(self.summary["content"]["text"], json.dumps(response))

    def test_search_cannot_deliver_out_of_scope_match(self):
        server = self.make_server(record_ids=[self.review["id"]])
        self.initialize(server)
        response = self.tool("prefrontal_search", {"query": self.authority["id"]}, server=server)
        self.controlled(response, "record_scope_denied")
        self.assertNotIn(self.authority["content"]["text"], json.dumps(response))

    def test_management_or_identity_fields_are_invalid_tool_arguments(self):
        self.initialize()
        before = self.published_state()
        for field, value in (("actor", "fixture-reviewer"), ("principal", "fixture-publisher"),
                             ("workspace", "other"), ("operation", "release.publish"),
                             ("manifest", {"context:authority": 1})):
            with self.subTest(field=field):
                response = self.tool(arguments={"record_ids": [self.authority["id"]], field: value})
                self.controlled(response, "invalid_request")
        for name in ("record.review", "release.publish", "knowledge.feedback", "knowledge.health"):
            with self.subTest(name=name):
                self.assertEqual(-32602, self.tool(name, {})["error"]["code"])
        self.assertEqual(-32601, self.request("release.publish", {})["error"]["code"])
        self.assertEqual(before, self.published_state())

    def test_tool_arguments_reject_invalid_types_counts_duplicates_and_text_bounds(self):
        self.initialize()
        before = self.published_state()
        cases = [
            ("prefrontal_get", {}), ("prefrontal_get", {"record_ids": []}),
            ("prefrontal_get", {"record_ids": "context:authority"}),
            ("prefrontal_get", {"record_ids": [True]}),
            ("prefrontal_get", {"record_ids": [self.authority["id"], self.authority["id"]]}),
            ("prefrontal_get", {"record_ids": ["context:item%d" % index for index in range(17)]}),
            ("prefrontal_get", {"record_ids": ["context:" + "x" * 101]}),
            ("prefrontal_search", {}), ("prefrontal_search", {"query": ""}),
            ("prefrontal_search", {"query": " "}), ("prefrontal_search", {"query": 7}),
            ("prefrontal_search", {"query": "x" * 201}),
            ("prefrontal_search", {"query": "\ud800"}),
            ("prefrontal_search", {"query": "native", "workspace": WORKSPACE}),
        ]
        for name, arguments in cases:
            with self.subTest(name=name, arguments=arguments):
                self.controlled(self.tool(name, arguments), "invalid_request")
        self.assertEqual(before, self.published_state())

    def test_invalid_jsonrpc_envelopes_are_rejected(self):
        invalid = [[], None, {}, {"jsonrpc": "1.0", "id": 1, "method": "ping"},
                   {"jsonrpc": "2.0", "id": True, "method": "ping"},
                   {"jsonrpc": "2.0", "id": None, "method": "ping"},
                   {"jsonrpc": "2.0", "id": 1, "method": 3},
                   {"jsonrpc": "2.0", "id": 1, "method": "ping", "params": []}]
        for message in invalid:
            with self.subTest(message=message):
                response = self.server.handle(message)
                self.assertIn(response["error"]["code"], (-32600, -32602))

    def test_unknown_method_is_rejected_and_unknown_notification_has_no_response(self):
        self.initialize()
        self.assertEqual(-32601, self.request("resources/list")["error"]["code"])
        self.assertIsNone(self.server.handle({"jsonrpc": "2.0", "method": "unknown/notification"}))

    def test_strict_json_rejects_duplicates_nonfinite_invalid_utf8_and_malformed_json(self):
        invalid = [b'{"jsonrpc":"2.0","id":1,"method":"ping","method":"tools/list"}\n',
                   b'{"jsonrpc":"2.0","id":NaN,"method":"ping"}\n',
                   b'{"jsonrpc":"2.0","id":Infinity,"method":"ping"}\n',
                   b'{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":1e999}}\n',
                   b'{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":-Infinity}}\n',
                   b'{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":"\xff"}}\n',
                   b'{invalid json}\n']
        for payload in invalid:
            with self.subTest(payload=payload):
                responses = self.stream(payload)
                self.assertEqual(1, len(responses))
                self.assertEqual(-32700, responses[0]["error"]["code"])

    def test_escaped_surrogate_request_id_is_controlled_and_stream_recovers(self):
        payload = b'{"jsonrpc":"2.0","id":"\\ud800","method":"ping"}\n'
        payload += b'{"jsonrpc":"2.0","id":2,"method":"ping"}\n'
        responses = self.stream(payload)
        self.assertEqual(2, len(responses))
        self.assertIn(responses[0]["error"]["code"], (-32600, -32700))
        self.assertEqual({"jsonrpc": "2.0", "id": 2, "result": {}}, responses[1])

    def test_oversized_line_is_drained_and_next_request_is_processed(self):
        oversized = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping",
                                "params": {"padding": "x" * 9000}}).encode("utf-8")
        valid = json.dumps({"jsonrpc": "2.0", "id": "after-limit", "method": "ping"}).encode("utf-8")
        responses = self.stream(oversized + b"\n" + valid + b"\n")
        self.assertEqual(2, len(responses))
        self.assertIn(responses[0]["error"]["code"], (-32600, -32602))
        self.assertEqual({"jsonrpc": "2.0", "id": "after-limit", "result": {}}, responses[1])

    def test_deep_json_parser_failure_is_controlled_and_next_request_recovers(self):
        # Less than the line limit: this exercises parser depth, not line draining.
        payload = b"[" * 1200 + b"0" + b"]" * 1200 + b"\n"
        payload += b'{"jsonrpc":"2.0","id":2,"method":"ping"}\n'
        responses = self.stream(payload)
        self.assertEqual(2, len(responses))
        self.assertEqual(-32700, responses[0]["error"]["code"])
        self.assertEqual({}, responses[1]["result"])

    def test_request_line_limit_counts_original_utf8_bytes(self):
        value = {"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {"padding": "😀" * 2050}}
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.assertLess(len(payload.decode("utf-8")), 8192)
        self.assertGreater(len(payload), 8192)
        response = self.stream(payload + b"\n")[0]
        self.assertIn(response["error"]["code"], (-32600, -32602))

    def test_explicit_json_depth_boundary_ignores_quoted_brackets(self):
        def nested(count):
            value = 0
            for _ in range(count):
                value = [value]
            return value

        # The request and params objects occupy the first two nesting levels.
        at_limit = {"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {"nested": nested(30)}}
        over_limit = {"jsonrpc": "2.0", "id": 2, "method": "ping", "params": {"nested": nested(31)}}
        quoted = {"jsonrpc": "2.0", "id": 3, "method": "ping",
                  "params": {"text": '[{\\\"' * 100 + '}]' * 100}}
        payload = b"".join(json.dumps(value).encode("utf-8") + b"\n"
                           for value in [at_limit, over_limit, quoted])
        responses = self.stream(payload)
        self.assertEqual({"jsonrpc": "2.0", "id": 1, "result": {}}, responses[0])
        self.assertEqual(-32700, responses[1]["error"]["code"])
        self.assertEqual({"jsonrpc": "2.0", "id": 3, "result": {}}, responses[2])

    def test_successful_dispatch_remains_within_registry_request_byte_limit(self):
        self.initialize()
        captured = []
        original = KnowledgeRegistry.dispatch

        def dispatch(registry, actor, request):
            captured.append((actor, copy.deepcopy(request)))
            return original(registry, actor, request)

        with patch.object(KnowledgeRegistry, "dispatch", dispatch):
            response = self.tool(arguments={"record_ids": [self.authority["id"], self.review["id"]]})
        self.assertTrue(response["result"]["structuredContent"]["ok"])
        self.assertTrue(captured)
        for actor, request in captured:
            self.assertEqual("codex-reader", actor)
            self.assertEqual(WORKSPACE, request["workspace"])
            self.assertIn(request["operation"], ("knowledge.get", "knowledge.search"))
            self.assertLessEqual(len(canonical(request).encode("utf-8")), 4096)

    def test_constructor_requires_existing_database_without_creating_one(self):
        missing = self.directory / "not-created.sqlite3"
        with self.assertRaises(ValueError):
            self.make_server(database=missing)
        self.assertFalse(missing.exists())

    def test_database_removed_after_startup_fails_closed_without_creating_replacement(self):
        self.initialize()
        self.database.unlink()
        self.controlled(self.tool(), "storage_unavailable")
        self.assertFalse(self.database.exists())

    def test_profile_probe_closes_connection_on_success_and_failure(self):
        connections = []
        original_connect = sqlite3.connect

        def tracked_connect(*args, **kwargs):
            connection = original_connect(*args, **kwargs)
            connections.append(connection)
            return connection

        empty = self.directory / "probe-empty.sqlite3"
        empty.write_bytes(b"")
        with patch("pilot.knowledge_mcp.sqlite3.connect", side_effect=tracked_connect):
            self.server._existing_database()
            with patch.object(self.server, "database", empty):
                with self.assertRaises(ContextError):
                    self.server._existing_database()
        self.assertEqual(2, len(connections))
        # Strong references prevent garbage collection from masking a leaked handle.
        for connection in connections:
            with self.assertRaises(sqlite3.ProgrammingError):
                connection.execute("SELECT 1")

    def test_database_replaced_with_empty_file_after_startup_is_not_initialized(self):
        self.initialize()
        self.database.write_bytes(b"")
        self.controlled(self.tool(), "storage_unavailable")
        self.assertEqual(b"", self.database.read_bytes())

    def test_constructor_rejects_existing_empty_database_without_initializing_it(self):
        empty = self.directory / "empty.sqlite3"
        empty.write_bytes(b"")
        with self.assertRaises(ValueError):
            self.make_server(database=empty)
        self.assertEqual(b"", empty.read_bytes())

    def test_constructor_requires_one_consumer_only_identity_and_matching_workspace(self):
        for roles in ([], ["reviewer"], ["consumer", "reviewer"], ["consumer", "publisher"], ["*"]):
            with self.subTest(roles=roles):
                self.principals["codex-reader"]["roles"] = roles
                self.write_principals()
                with self.assertRaises(ValueError):
                    self.make_server()
        self.principals = copy.deepcopy(PRINCIPALS)
        self.write_principals()
        for overrides in ({"principal": "missing-reader"}, {"workspace": "other"},
                          {"record_ids": []}, {"record_ids": [self.authority["id"], self.authority["id"]]}):
            with self.subTest(overrides=overrides):
                with self.assertRaises(ValueError):
                    self.make_server(**overrides)

    def test_corrupt_reloaded_principals_fail_closed_without_payload(self):
        self.initialize()
        self.principals_path.write_text("{invalid", encoding="utf-8")
        response = self.tool()
        self.controlled(response)
        self.assertNotIn(self.authority["content"]["text"], json.dumps(response))

    def test_actual_cli_stdio_round_trip_has_only_jsonrpc_on_stdout(self):
        messages = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                        "clientInfo": {"name": "subprocess-test", "version": "1"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
             "params": {"name": "prefrontal_get", "arguments": {
                 "record_ids": [self.authority["id"], self.review["id"]]}}},
        ]
        command = [sys.executable, "-m", "pilot.knowledge_mcp", "--database", str(self.database),
                   "--source-root", str(self.sources), "--principals", str(self.principals_path),
                   "--principal", "codex-reader", "--workspace", WORKSPACE]
        for record_id in self.allowed_ids:
            command += ["--record-id", record_id]
        process = subprocess.run(command, input=b"".join(json.dumps(message).encode("utf-8") + b"\n"
                                                       for message in messages),
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, timeout=20)
        self.assertEqual(0, process.returncode, process.stderr.decode("utf-8", errors="replace"))
        responses = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual([1, 2, 3], [response["id"] for response in responses])
        data = responses[-1]["result"]["structuredContent"]
        self.assertTrue(data["ok"], data)
        self.assertEqual(2, len(data["context"]["records"]))


if __name__ == "__main__":
    unittest.main()
