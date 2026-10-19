"""Harness checks use scripted outputs; these are not live-model results."""

import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from .knowledge import KnowledgeRegistry
from .knowledge_demo import PRINCIPALS, WORKSPACE, run
from .context_pilot import ContextError
from .rehearsal import CodexModel, grade, run_rehearsal, validate_tasks


class ScriptedModel:
    def __init__(self):
        self.calls = []

    def complete(self, payload):
        self.calls.append({"phase": payload["phase"], "fixture_output": True})
        if payload["phase"] == "route":
            return {"queries": [{"id": "authority", "query": "context:authority"},
                                {"id": "profit", "query": "profitability"}]}
        citation = "authority.md" if payload["phase"] == "raw-answer" else "context:authority"
        return {"answers": [{"id": "authority", "status": "answer", "choice": "no", "citations": [citation]},
                            {"id": "profit", "status": "abstain", "choice": "unverified", "citations": []}]}


class RehearsalAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1] / ".validation"
        root.mkdir(exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(prefix="rehearsal-test-", dir=root)
        cls.directory, cls.evidence = run(cls.temp.name)
        cls.tasks = [
            {"id": "authority", "question": "Does context delivery authorize actions?",
             "choices": ["yes", "no", "unverified"], "expected_choice": "no", "expected_status": "answer",
             "record_citations": ["context:authority"], "source_citations": ["authority.md"]},
            {"id": "profit", "question": "Has profitability been established?",
             "choices": ["yes", "no", "unverified"], "expected_choice": "unverified", "expected_status": "abstain",
             "record_citations": [], "source_citations": []},
        ]

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_harness_records_model_chosen_queries_and_unsupported_abstention(self):
        output = self.directory / "scripted-rehearsal"
        with KnowledgeRegistry(self.evidence["database"], self.evidence["source_root"], PRINCIPALS) as registry:
            model = ScriptedModel()
            report = run_rehearsal(registry, "reader", WORKSPACE, self.tasks,
                                   ["authority.md", "review.md"], model, output)
        self.assertEqual(2, report["raw_passed"])
        self.assertEqual(2, report["prefrontal_passed"])
        self.assertEqual(3, len(report["model_calls"]))
        self.assertEqual("context:authority", report["retrieval_trace"][0]["request"]["query"])
        self.assertEqual({"ok": False, "error": "no_match"}, report["retrieval_trace"][1]["response"])
        self.assertFalse(report["human_effort_measured"])
        self.assertFalse(report["productivity_claim_established"])

    def test_correct_choice_with_invented_citation_does_not_pass(self):
        response = ScriptedModel().complete({"phase": "prefrontal-answer"})
        response["answers"][0]["citations"].append("context:invented")
        scored = grade(self.tasks, response, "knowledge", {"authority": {"context:authority"}, "profit": set()})
        self.assertFalse(scored[0]["passed"])

    def test_missing_or_duplicate_task_is_not_silently_scored(self):
        response = ScriptedModel().complete({"phase": "raw-answer"})
        response["answers"][1] = copy.deepcopy(response["answers"][0])
        with self.assertRaises(ValueError):
            grade(self.tasks, response, "raw", {"authority": {"authority.md"}, "profit": set()})

    def test_answer_without_evidence_and_oversized_questions_are_invalid_configuration(self):
        tasks = copy.deepcopy(self.tasks)
        tasks[0]["record_citations"] = []
        with self.assertRaises(ValueError):
            validate_tasks(tasks)
        tasks = copy.deepcopy(self.tasks)
        tasks[0]["question"] = "q" * 2001
        with self.assertRaises(ValueError):
            validate_tasks(tasks)

    def test_unauthorized_consumer_is_denied_before_any_model_call(self):
        model = ScriptedModel()
        with KnowledgeRegistry(self.evidence["database"], self.evidence["source_root"], PRINCIPALS) as registry:
            with self.assertRaises(ContextError):
                run_rehearsal(registry, "outsider", WORKSPACE, self.tasks, ["authority.md"], model,
                               self.directory / "denied-rehearsal")
        self.assertEqual([], model.calls)

    def test_out_of_corpus_records_are_not_exposed_to_routing_or_answer_model(self):
        payloads = []

        class WrongCorpusModel(ScriptedModel):
            def complete(inner, payload):
                payloads.append(payload)
                if payload["phase"] == "route":
                    return {"queries": [{"id": "authority", "query": "context:review"},
                                        {"id": "profit", "query": "profitability"}]}
                return super().complete(payload)

        with KnowledgeRegistry(self.evidence["database"], self.evidence["source_root"], PRINCIPALS) as registry:
            result = run_rehearsal(registry, "reader", WORKSPACE, self.tasks, ["authority.md"], WrongCorpusModel(),
                                   self.directory / "corpus-rehearsal")
        catalog = next(payload["catalog"] for payload in payloads if payload["phase"] == "route")
        self.assertNotIn("context:review", {entry["id"] for entry in catalog})
        self.assertEqual({"ok": False, "error": "outside_rehearsal_corpus"},
                         result["retrieval_trace"][0]["response"])

    def test_source_change_during_model_call_invalidates_comparison(self):
        source = Path(self.evidence["source_root"]) / "authority.md"
        before = source.read_bytes()

        class ChangingModel(ScriptedModel):
            def complete(inner, payload):
                if payload["phase"] == "prefrontal-answer":
                    source.write_bytes(before + b"Changed.\n")
                return super().complete(payload)

        try:
            with KnowledgeRegistry(self.evidence["database"], self.evidence["source_root"], PRINCIPALS) as registry:
                with self.assertRaisesRegex(ValueError, "source snapshot changed"):
                    run_rehearsal(registry, "reader", WORKSPACE, self.tasks, ["authority.md"], ChangingModel(),
                                   self.directory / "changed-rehearsal")
        finally:
            source.write_bytes(before)

    def test_catalog_hides_internal_claim_with_restricted_dependency(self):
        database = self.directory / "restricted-branch.sqlite3"
        shutil.copy2(self.evidence["database"], database)
        payloads = []

        class ObservingModel(ScriptedModel):
            def complete(inner, payload):
                payloads.append(payload)
                return super().complete(payload)

        with KnowledgeRegistry(database, self.evidence["source_root"], PRINCIPALS) as registry:
            manifest = {entry["id"]: entry["version"]
                        for entry in self.evidence["health_after_correction"]["records"]}
            for record_id in ("context:authority", "context:summary"):
                body = json.loads(registry._row(WORKSPACE, record_id, 2)["body"])
                body["version"] = 3
                if record_id == "context:authority":
                    body["classification"] = "restricted"
                else:
                    body["dependencies"][0]["version"] = 3
                receipt = registry.submit("fixture-author", body)
                registry.approve("fixture-reviewer", WORKSPACE, record_id, 3, receipt)
                manifest[record_id] = 3
            registry.publish("fixture-publisher", WORKSPACE, "restricted", manifest)
            run_rehearsal(registry, "reader", WORKSPACE, self.tasks, ["authority.md", "review.md"], ObservingModel(),
                          self.directory / "restricted-rehearsal")
        catalog = next(payload["catalog"] for payload in payloads if payload["phase"] == "route")
        self.assertEqual({"context:review"}, {entry["id"] for entry in catalog})

    def test_codex_adapter_uses_read_only_mode_and_retains_actual_usage(self):
        events = [
            {"type": "item.completed", "item": {"type": "agent_message", "text": '{"answers":[]}'}},
            {"type": "turn.completed", "usage": {"input_tokens": 31, "output_tokens": 7}},
        ]
        process = SimpleNamespace(returncode=0, stdout="\n".join(json.dumps(event) for event in events), stderr="")
        with patch("pilot.rehearsal.shutil.which", return_value="codex"), \
                patch("pilot.rehearsal.subprocess.run", return_value=process) as execute:
            model = CodexModel(self.directory)
            self.assertEqual({"answers": []}, model.complete({"phase": "fixture"}))
        command = execute.call_args[0][0]
        self.assertIn("read-only", command)
        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", command)
        self.assertEqual({"input_tokens": 31, "output_tokens": 7}, model.calls[0]["usage"])

    def test_codex_tool_use_invalidates_the_comparison(self):
        event = {"type": "item.completed", "item": {"type": "command_execution", "command": "read extra source"}}
        process = SimpleNamespace(returncode=0, stdout=json.dumps(event), stderr="")
        with patch("pilot.rehearsal.shutil.which", return_value="codex"), \
                patch("pilot.rehearsal.subprocess.run", return_value=process):
            model = CodexModel(self.directory)
            with self.assertRaisesRegex(ValueError, "external tool"):
                model.complete({"phase": "fixture"})


if __name__ == "__main__":
    unittest.main()
