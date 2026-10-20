"""Connected launcher guards; all subprocesses mocked, zero model calls."""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from .codex_connected import inspect_events, run_recorded, scoped_command


def process(value, code=0):
    return SimpleNamespace(returncode=code, stdout=value, stderr="")


def catalogs():
    return [process(json.dumps([{"name": "node_repl", "enabled": True}, {"name": "prefrontal", "enabled": True}])),
            process(json.dumps([{"name": "node_repl", "enabled": False}, {"name": "prefrontal", "enabled": True}]))]


def events(text=' {"answer":"current"}\n', server="prefrontal", kind="mcp_tool_call"):
    return "\n".join(json.dumps(e) for e in [
        {"type": "item.completed", "item": {"type": kind, "server": server, "tool": "prefrontal_get",
                                              "arguments": {"record_ids": ["context:workflow"]}}},
        {"type": "item.completed", "item": {"type": "agent_message", "text": text}},
        {"type": "turn.completed", "usage": {"input_tokens": 100, "output_tokens": 30}}])


class ConnectedCodexChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.config = {"database": "registry.sqlite3", "source_root": "sources", "principals": "principals.json",
                       "principal": "reader", "workspace": "lab", "record_ids": ["context:workflow"]}

    def test_inherited_servers_are_disabled_and_isolation_verified(self):
        with patch("pilot.codex_connected.subprocess.run", side_effect=catalogs()) as run:
            command, isolation = scoped_command(self.config, "fixture-codex")
        self.assertIn("mcp_servers.node_repl.enabled=false", command)
        self.assertIn('web_search="disabled"', command)
        self.assertEqual(["prefrontal"], isolation["enabled_servers"])
        self.assertFalse(isolation["shared_configuration_modified"])
        self.assertEqual(2, run.call_count)
        for feature in ["plugins", "apps", "memories", "shell_tool", "unified_exec", "multi_agent"]:
            self.assertIn(feature, command)

    def test_failed_isolation_stops_before_model_call(self):
        with patch("pilot.codex_connected.subprocess.run", side_effect=[catalogs()[0], catalogs()[0]]) as run:
            with self.assertRaisesRegex(ValueError, "isolation"):
                scoped_command(self.config, "fixture-codex")
        self.assertEqual(2, run.call_count)

    def test_unsupported_server_name_is_not_interpolated_into_config(self):
        result = process(json.dumps([{"name": "external.name", "enabled": True}]))
        with patch("pilot.codex_connected.subprocess.run", return_value=result) as run:
            with self.assertRaisesRegex(ValueError, "explicit configuration"):
                scoped_command(self.config, "fixture-codex")
        self.assertEqual(1, run.call_count)

    def test_recorded_run_preserves_original_answer_tool_events_and_usage(self):
        original = ' {"answer":"current"}  \n'
        with patch("pilot.codex_connected.subprocess.run", side_effect=catalogs()+[process(events(original))]) as run:
            text, evidence = run_recorded(self.config, "Use current tool evidence", self.directory/"run", "fixture-codex")
        self.assertEqual(original, text)
        self.assertEqual(original.encode("utf-8"), (self.directory/"run/answer.txt").read_bytes())
        self.assertEqual(1, len(evidence["tool_calls"]))
        self.assertEqual(100, evidence["usage"]["input_tokens"])
        self.assertIn("--ephemeral", run.call_args.args[0])
        self.assertEqual(90, run.call_args.kwargs["timeout"])

    def test_unexpected_native_tool_is_rejected_with_originals_retained(self):
        with patch("pilot.codex_connected.subprocess.run", side_effect=catalogs()+[process(events(kind="command_execution"))]):
            with self.assertRaisesRegex(ValueError, "unexpected external tool"):
                run_recorded(self.config, "Retrieve", self.directory/"run", "fixture-codex")
        self.assertTrue((self.directory/"run/events.jsonl").is_file())
        self.assertFalse((self.directory/"run/evidence.json").exists())

    def test_other_mcp_server_is_not_accepted_as_retrieval_proof(self):
        with self.assertRaisesRegex(ValueError, "read-only scope"):
            inspect_events(events(server="other"))

    def test_answer_without_actual_retrieval_or_completion_is_unverified(self):
        for value in ["\n".join(events().splitlines()[1:]), "\n".join(events().splitlines()[:-1])]:
            with self.assertRaises(ValueError):
                inspect_events(value)

    def test_timeout_retains_partial_events_and_has_no_automatic_retry(self):
        failure = subprocess.TimeoutExpired(["fixture-codex"], 90, output=b'{"partial":true}\n', stderr=b'partial diagnostic')
        with patch("pilot.codex_connected.subprocess.run", side_effect=catalogs()+[failure]) as run:
            with self.assertRaisesRegex(ValueError, "timed out"):
                run_recorded(self.config, "Retrieve", self.directory/"run", "fixture-codex")
        self.assertEqual(3, run.call_count)
        self.assertEqual(b'{"partial":true}\n', (self.directory/"run/events.jsonl").read_bytes())
        self.assertTrue((self.directory/"run/failure.json").is_file())

    def test_prior_evidence_is_never_overwritten(self):
        with patch("pilot.codex_connected.subprocess.run") as run:
            with self.assertRaisesRegex(ValueError, "prior output"):
                run_recorded(self.config, "Retrieve", self.directory, "fixture-codex")
        run.assert_not_called()

    def test_invalid_prompt_or_time_bound_prevents_any_subprocess(self):
        with patch("pilot.codex_connected.subprocess.run") as run:
            for text, timeout in [("", 90), ("x"*131073, 90), ("Retrieve", 91)]:
                with self.assertRaises(ValueError):
                    run_recorded(self.config, text, self.directory/"run", "fixture-codex", timeout=timeout)
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
