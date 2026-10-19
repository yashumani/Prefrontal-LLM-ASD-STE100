"""Codex adapter protocol checks; subprocess is mocked and no model is called."""

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from .rehearsal import CodexModel


class CodexAdapterChecks(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[1] / ".validation"
        root.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="codex-adapter-test-", dir=root)
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.executable = "C:/fixture-tools/codex.exe"
        self.version = SimpleNamespace(returncode=0, stdout="codex-cli fixture-version\n", stderr="")

    def response(self, events):
        return SimpleNamespace(returncode=0, stdout="\n".join(json.dumps(event) for event in events), stderr="")

    def successful_events(self):
        return [
            {"type": "item.completed", "item": {"type": "agent_message", "text": '{"answers":[]}'}},
            {"type": "turn.completed", "usage": {"input_tokens": 31, "output_tokens": 7}},
        ]

    def test_explicit_selection_applies_to_each_invocation_and_is_recorded(self):
        process = self.response(self.successful_events())
        with patch("pilot.rehearsal.shutil.which") as locate, \
                patch("pilot.rehearsal.subprocess.run", side_effect=[self.version, process, process]) as execute:
            model = CodexModel(self.directory, timeout=42, executable=self.executable,
                               model="fixture-model", reasoning_effort="high")
            self.assertEqual({"answers": []}, model.complete({"phase": "raw-answer"}))
            self.assertEqual({"answers": []}, model.complete({"phase": "prefrontal-answer"}))
        locate.assert_not_called()
        self.assertEqual([self.executable, "--version"], execute.call_args_list[0].args[0])
        self.assertEqual(10, execute.call_args_list[0].kwargs["timeout"])
        expected_command = [self.executable, "exec", "--sandbox", "read-only", "--ephemeral", "--json",
                            "--model", "fixture-model", "-c", 'model_reasoning_effort="high"', "-"]
        self.assertEqual(3, execute.call_count)
        for number, (invocation, recorded) in enumerate(zip(execute.call_args_list[1:], model.calls), start=1):
            with self.subTest(invocation=number):
                self.assertEqual(expected_command, invocation.args[0])
                self.assertEqual(42, invocation.kwargs["timeout"])
                self.assertEqual(self.executable, recorded["executable"])
                self.assertEqual("codex-cli fixture-version", recorded["cli_version"])
                self.assertEqual("fixture-model", recorded["model"])
                self.assertEqual("high", recorded["reasoning_effort"])
                self.assertEqual({"input_tokens": 31, "output_tokens": 7}, recorded["usage"])
                self.assertEqual([], recorded["diagnostics"])
                self.assertFalse(recorded["tools_used"])
                prompt = (self.directory / "model-{}-prompt.txt".format(number)).read_text(encoding="utf-8")
                self.assertEqual(prompt, invocation.kwargs["input"])
                self.assertEqual(len(prompt.encode("utf-8")), recorded["prompt_bytes"])
                self.assertGreaterEqual(recorded["elapsed_ms"], 0)
        self.assertEqual(["raw-answer", "prefrontal-answer"], [call["phase"] for call in model.calls])

    def test_engineering_ndjson_retains_original_text_and_custom_rules(self):
        original = ' {"task":1}  \n{"task":2}\n'
        events = [{"type": "item.completed", "item": {"type": "agent_message", "text": original}},
                  {"type": "turn.completed", "usage": {"input_tokens": 31, "output_tokens": 7}}]
        with patch("pilot.rehearsal.subprocess.run", side_effect=[self.version, self.response(events)]) as execute:
            model = CodexModel(self.directory, executable=self.executable,
                               rules="Bounded engineering NDJSON", response_format="ndjson")
            self.assertEqual(original, model.complete({"phase": "engineering"}))
        self.assertTrue(execute.call_args.kwargs["input"].startswith("Bounded engineering NDJSON\n\n"))
        self.assertEqual(original, json.loads((self.directory / "model-1-events.jsonl").read_text().splitlines()[0])["item"]["text"])

    def test_unknown_response_format_is_rejected_before_invocation(self):
        with patch("pilot.rehearsal.subprocess.run") as execute:
            with self.assertRaisesRegex(ValueError, "response format"):
                CodexModel(self.directory, response_format="repair")
        execute.assert_not_called()

    def test_unspecified_executable_uses_cli_lookup_without_model_overrides(self):
        with patch("pilot.rehearsal.shutil.which", return_value=self.executable) as locate, \
                patch("pilot.rehearsal.subprocess.run",
                      side_effect=[self.version, self.response(self.successful_events())]) as execute:
            model = CodexModel(self.directory)
            model.complete({"phase": "fixture"})
        locate.assert_called_once_with("codex")
        self.assertEqual([self.executable, "exec", "--sandbox", "read-only", "--ephemeral", "--json", "-"],
                         execute.call_args.args[0])
        self.assertIn("inherited", model.calls[0]["model"])
        self.assertIn("inherited", model.calls[0]["reasoning_effort"])

    def test_item_error_diagnostics_are_retained_without_tool_contamination(self):
        diagnostics = ["fixture retry diagnostic", "fixture nonfatal diagnostic"]
        events = [{"type": "item.completed", "item": {"type": "error", "message": message}}
                  for message in diagnostics] + self.successful_events()
        process = self.response(events)
        with patch("pilot.rehearsal.subprocess.run", side_effect=[self.version, process]):
            model = CodexModel(self.directory, executable=self.executable)
            self.assertEqual({"answers": []}, model.complete({"phase": "fixture"}))
        self.assertEqual(diagnostics, model.calls[0]["diagnostics"])
        self.assertFalse(model.calls[0]["tools_used"])
        self.assertEqual(process.stdout, (self.directory / "model-1-events.jsonl").read_text(encoding="utf-8"))

    def test_tool_and_unknown_item_types_invalidate_completed_answers(self):
        for item_type in ("command_execution", "web_search", "mcp_tool_call", "unknown_future_tool"):
            with self.subTest(item_type=item_type):
                events = [{"type": "item.completed", "item": {"type": item_type}}] + self.successful_events()
                with patch("pilot.rehearsal.subprocess.run", side_effect=[self.version, self.response(events)]):
                    model = CodexModel(self.directory, executable=self.executable)
                    with self.assertRaisesRegex(ValueError, "external tool"):
                        model.complete({"phase": "fixture"})
                self.assertEqual([], model.calls)

    def test_answer_without_turn_completion_is_rejected(self):
        events = self.successful_events()[:1]
        with patch("pilot.rehearsal.subprocess.run", side_effect=[self.version, self.response(events)]):
            model = CodexModel(self.directory, executable=self.executable)
            with self.assertRaisesRegex(ValueError, "completed answer"):
                model.complete({"phase": "fixture"})
        self.assertEqual([], model.calls)

    def test_turn_completion_without_answer_is_rejected(self):
        events = self.successful_events()[1:]
        with patch("pilot.rehearsal.subprocess.run", side_effect=[self.version, self.response(events)]):
            model = CodexModel(self.directory, executable=self.executable)
            with self.assertRaisesRegex(ValueError, "completed answer"):
                model.complete({"phase": "fixture"})
        self.assertEqual([], model.calls)

    def test_top_level_error_or_failed_turn_invalidates_an_apparent_answer(self):
        for event_type in ("error", "turn.failed"):
            with self.subTest(event_type=event_type):
                events = self.successful_events() + [{"type": event_type, "message": "fixture fatal error"}]
                with patch("pilot.rehearsal.subprocess.run", side_effect=[self.version, self.response(events)]):
                    model = CodexModel(self.directory, executable=self.executable)
                    with self.assertRaisesRegex(ValueError, "turn failed"):
                        model.complete({"phase": "fixture"})
                self.assertEqual([], model.calls)

    def test_failed_version_check_stops_before_a_model_invocation(self):
        failed_version = SimpleNamespace(returncode=1, stdout="", stderr="fixture CLI unavailable")
        with patch("pilot.rehearsal.subprocess.run", return_value=failed_version) as execute:
            with self.assertRaisesRegex(ValueError, "version check failed"):
                CodexModel(self.directory, executable=self.executable)
        execute.assert_called_once()
        self.assertEqual([self.executable, "--version"], execute.call_args.args[0])
        self.assertEqual([], list(self.directory.iterdir()))


if __name__ == "__main__":
    unittest.main()
