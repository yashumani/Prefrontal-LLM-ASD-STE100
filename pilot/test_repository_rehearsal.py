"""Preparation checks over real docs; no model calls or human-review evidence."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from .context_pilot import digest
from .knowledge import KnowledgeRegistry
from .repository_rehearsal import PRINCIPALS, ROOT, SOURCE_PATHS, WORKSPACE, prepare
from .rehearsal import grade, validate_tasks


class RepositoryRehearsalPreparation(unittest.TestCase):
    def setUp(self):
        validation = ROOT / ".validation"
        validation.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="repository-preparation-test-", dir=validation)
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def read_json(self, directory, name):
        return json.loads((directory / name).read_text(encoding="utf-8"))

    def copy_document_fixture(self):
        # This is a two-file source fixture, not another repository checkout.
        repository = self.directory / "document-fixture"
        for relative in SOURCE_PATHS:
            destination = repository / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes((ROOT / relative).read_bytes())
        return repository

    def test_real_document_snapshots_and_record_evidence_match_frozen_bytes(self):
        originals = {relative: (ROOT / relative).read_bytes() for relative in SOURCE_PATHS}
        directory, configuration = prepare(self.directory / "prepared", repository_root=ROOT)
        metadata = self.read_json(directory, "preparation.json")
        records = self.read_json(directory, "records.json")
        self.assertEqual(["pilot/README.md", "pilot/AGENT_WORKFLOW.md"], configuration["source_paths"])
        self.assertEqual(configuration, self.read_json(directory, "config.json"))
        self.assertEqual(digest(records), metadata["record_set_hash"])
        self.assertNotEqual(ROOT.resolve(), Path(configuration["source_root"]).resolve())
        self.assertEqual(set(originals), set(metadata["source_hashes"]))
        for relative, content in originals.items():
            with self.subTest(source=relative):
                snapshot = Path(configuration["source_root"]) / relative
                expected_hash = hashlib.sha256(content).hexdigest()
                self.assertEqual(content, snapshot.read_bytes())
                self.assertEqual(expected_hash, metadata["source_hashes"][relative])
                relevant = [record for record in records if record["evidence"][0]["path"] == relative]
                self.assertTrue(relevant)
                for record in relevant:
                    self.assertEqual([{"path": relative, "sha256": expected_hash}], record["evidence"])
                    self.assertIn(record["claim"], " ".join(content.decode("utf-8").split()))

    def test_ten_published_records_and_twelve_fixed_tasks_include_two_abstentions(self):
        directory, configuration = prepare(self.directory / "prepared")
        records = self.read_json(directory, "records.json")
        tasks = {task["id"]: task for task in configuration["tasks"]}
        expected_answers = {
            "registry": "canonical registry", "approval": "no", "action-authority": "no",
            "source-truth": "no", "transport": "no", "retrieval": "no",
            "cached-use": "recheck current context", "untrusted-text": "no", "feedback": "no",
            "source-change": "new review", "actual-profit": "unverified", "identity-provider": "unverified",
        }
        self.assertEqual(12, len(configuration["tasks"]))
        self.assertEqual(expected_answers, {name: task["expected_choice"] for name, task in tasks.items()})
        supported = set(expected_answers) - {"actual-profit", "identity-provider"}
        self.assertEqual({"context:" + name for name in supported}, {record["id"] for record in records})
        self.assertEqual(10, len(records))
        for name, task in tasks.items():
            with self.subTest(task=name):
                self.assertIn(task["expected_choice"], task["choices"])
                if name in supported:
                    self.assertEqual("answer", task["expected_status"])
                    self.assertEqual(["context:" + name], task["record_citations"])
                    self.assertEqual(2 if name == "action-authority" else 1, len(task["source_citations"]))
                    self.assertTrue(set(task["source_citations"]).issubset(SOURCE_PATHS))
                else:
                    self.assertEqual("abstain", task["expected_status"])
                    self.assertEqual([], task["record_citations"])
                    self.assertEqual([], task["source_citations"])
        with KnowledgeRegistry(configuration["database"], configuration["source_root"], PRINCIPALS) as registry:
            self.assertEqual("healthy", registry.health("fixture-reviewer", WORKSPACE)["status"])
            bundle = registry.get_records("codex-consumer", WORKSPACE, ["context:" + name for name in supported])
        self.assertEqual("repository-docs-v1", bundle["release"])
        self.assertEqual({record["id"] for record in records}, {item["record"]["id"] for item in bundle["records"]})

    def test_archive_without_git_preserves_snapshot_and_discloses_simulated_reviews(self):
        repository = self.copy_document_fixture()
        with patch("pilot.repository_rehearsal.subprocess.run", side_effect=FileNotFoundError("git unavailable")):
            directory, configuration = prepare(self.directory / "prepared", repository_root=repository)
        metadata = self.read_json(directory, "preparation.json")
        self.assertIsNone(metadata["source_repository_revision"])
        self.assertTrue(metadata["simulated_human_approvals"])
        self.assertFalse(metadata["human_effort_measured"])
        self.assertEqual(0, metadata["llm_calls_during_preparation"])
        self.assertIn("simulated record reviews", metadata["scope"])
        self.assertEqual("implementation agent checked literal claims against frozen source bytes",
                         metadata["expected_answer_review"])
        # A later edit to the origin must not silently alter this prepared version.
        original = repository / SOURCE_PATHS[0]
        frozen = Path(configuration["source_root"]) / SOURCE_PATHS[0]
        before = frozen.read_bytes()
        original.write_bytes(original.read_bytes() + b"\nLater repository edit.\n")
        self.assertEqual(before, frozen.read_bytes())
        with KnowledgeRegistry(configuration["database"], configuration["source_root"], PRINCIPALS) as registry:
            self.assertEqual("healthy", registry.health("fixture-reviewer", WORKSPACE)["status"])
        audit = self.read_json(directory, "audit.json")
        reviews = [event for event in audit if event["action"] == "approved"]
        self.assertEqual(10, len(reviews))
        self.assertEqual({"fixture-reviewer"}, {event["actor"] for event in reviews})

    def test_changed_source_claim_fails_instead_of_rewriting_expected_answer(self):
        repository = self.copy_document_fixture()
        source = repository / "pilot/README.md"
        old_claim = "One canonical registry owns identity, version and review history."
        changed_claim = "The search index owns identity, version and review history."
        text = source.read_text(encoding="utf-8")
        self.assertEqual(1, text.count(old_claim))
        source.write_text(text.replace(old_claim, changed_claim), encoding="utf-8")
        output = self.directory / "rejected"
        with self.assertRaisesRegex(ValueError, "^expected source claim changed: registry$"):
            prepare(output, repository_root=repository)
        self.assertEqual([], list(output.rglob("config.json")))
        self.assertEqual([], list(output.rglob("preparation.json")))

    def test_public_saved_answers_regrade_against_the_same_published_source_bytes(self):
        report = self.read_json(ROOT / "pilot", "repository-rehearsal-result.json")
        tasks = report["fixed_tasks"]
        validate_tasks(tasks)
        for source, expected in report["source_hashes"].items():
            self.assertEqual(expected, hashlib.sha256((ROOT / source).read_bytes()).hexdigest())
        raw_allowed = {task["id"]: set(SOURCE_PATHS) for task in tasks}
        delivered = {}
        for entry in report["retrieval_trace"]:
            context = entry["response"].get("search", {}).get("context", {})
            delivered[entry["id"]] = {item["record"]["id"] for item in context.get("records", [])}
        for arm, allowed in [("raw", raw_allowed), ("prefrontal", delivered)]:
            answers = {"answers": [row["answer"] for row in report[arm]]}
            self.assertEqual(report[arm], grade(tasks, answers, arm, allowed))
            self.assertEqual(12, report[arm + "_passed"])
        self.assertEqual(11, report["annotation_correction"]["original_raw_passed"])
        self.assertEqual(3, len(report["model_calls"]))
        self.assertTrue(all(call["tools_used"] is False for call in report["model_calls"]))


if __name__ == "__main__":
    unittest.main()
