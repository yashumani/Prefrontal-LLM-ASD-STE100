"""Real local dispatcher acceptance; unit approvals below are simulated."""

import copy
import json
import shutil
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .context_pilot import digest
from .knowledge import KnowledgeRegistry
from .supervised import TaskSession, admit_and_execute


class SupervisedAcceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.sources = self.root / "sources"
        self.sources.mkdir()
        self.now = datetime.now(timezone.utc)
        self.people = {"author": {"workspace": "lab", "roles": ["submitter"]},
                       "simulated-reviewer": {"workspace": "lab", "roles": ["reviewer"]},
                       "publisher": {"workspace": "lab", "roles": ["publisher"]},
                       "consumer": {"workspace": "lab", "roles": ["consumer"], "classifications": ["internal"]}}
        self.database = self.root / "registry.sqlite3"
        self.registry = KnowledgeRegistry(self.database, self.sources, self.people, lambda: self.now)
        self.bodies = []
        for name in ["schema", "workflow"]:
            (self.sources / (name + ".md")).write_text(name + " evidence", encoding="utf-8")
            body = {"id": "context:" + name, "version": 1, "workspace": "lab", "layer": "data",
                    "owner": "owner", "claim": name, "classification": "internal",
                    "valid_from": (self.now - timedelta(minutes=1)).isoformat(),
                    "valid_until": (self.now + timedelta(days=1)).isoformat(),
                    "evidence": [self.registry.evidence(name + ".md")], "dependencies": [],
                    "content": {"text": name, "topics": [name], "assumptions": [], "limits": []}}
            receipt = self.registry.submit("author", body)
            self.registry.approve("simulated-reviewer", "lab", body["id"], 1, receipt)
            self.bodies.append(body)
        self.manifest = {body["id"]: 1 for body in self.bodies}
        self.registry.publish("publisher", "lab", "r1", self.manifest)

    def tearDown(self):
        self.registry.close()
        self.temp.cleanup()

    def session(self, task="task", registry=None):
        return TaskSession(registry or self.registry, task, "lab", "consumer", list(self.manifest),
                           [("author", "record.submit"), ("publisher", "release.publish"),
                            ("consumer", "knowledge.get"), ("consumer", "knowledge.feedback")],
                           observation_id="probe", target_release="r2")

    def answer(self, session, request=None, principal="author", status="ready", mode="executable"):
        proposed = copy.deepcopy(self.bodies[0])
        proposed.update(id="context:proposal", claim="Proposed guidance")
        request = request or {"operation": "record.submit", "record": proposed}
        return {"contract": "context.task-result.v2", "task_id": session.task_id,
                "evidence_id": session.evidence_id, "status": status, "summary": "Proposed task artifact",
                "requests": [{"principal": principal, "mode": mode, "request": request}],
                "steps": [], "citations": [], "missing_evidence": [] if status == "ready" else ["Needs review"]}

    def execute(self, session, answer):
        return admit_and_execute(json.dumps(answer), [session])

    def test_multirecord_delivery_supplies_both_records_without_unrelated_append(self):
        session = self.session()
        result = session.retrieve(["context:schema", "context:workflow"])
        self.assertTrue(result["ok"])
        self.assertEqual(set(self.manifest), {r["record"]["id"] for r in result["context"]["records"]})
        self.assertEqual(2, len(session.contract_scope()["allowed_citations"]) - 1)

    def test_submission_stays_unapproved_and_has_durable_readback(self):
        session = self.session()
        result = self.execute(session, self.answer(session))
        self.assertTrue(result[0]["requests"][0]["response"]["ok"])
        with KnowledgeRegistry(self.database, self.sources, self.people, lambda: self.now) as fresh:
            self.assertEqual("draft", fresh._row("lab", "context:proposal", 1)["review_state"])
            self.assertEqual("r1", fresh.active_release("lab"))
            self.assertEqual(2, fresh.db.execute("SELECT COUNT(*) FROM approvals").fetchone()[0])

    def test_source_drift_after_model_input_blocks_effects(self):
        session = self.session()
        (self.sources / "workflow.md").write_text("changed", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "no longer current"):
            self.execute(session, self.answer(session))
        self.assertEqual(2, self.registry.db.execute("SELECT COUNT(*) FROM records").fetchone()[0])

    def test_grant_revocation_and_expiry_invalidate_captured_evidence(self):
        for kind in ["grant", "revocation", "expiry"]:
            session = self.session()
            if kind == "grant":
                self.registry.principals["consumer"]["classifications"] = []
            elif kind == "revocation":
                self.registry.revoke("simulated-reviewer", "lab", "context:workflow", 1)
            else:
                self.now += timedelta(days=2)
            with self.assertRaisesRegex(ValueError, "no longer current"):
                self.execute(session, self.answer(session))
            if kind == "grant":
                self.registry.principals["consumer"]["classifications"] = ["internal"]
            elif kind == "revocation":
                with self.registry.db:
                    self.registry.db.execute("UPDATE records SET revoked=0 WHERE id='context:workflow'")

    def test_denied_multirecord_get_is_atomic_without_partial_content_or_fallback(self):
        self.registry.principals["consumer"]["classifications"] = []
        session = self.session()
        result = session.retrieve(list(self.manifest))
        self.assertEqual({"ok": False, "error": "access_denied"}, result)
        self.assertEqual([("observation", "probe")], session.contract_scope()["allowed_citations"])
        self.assertEqual(1, len(session.trace))

    def test_probe_denial_can_be_executed_only_as_blocked_current_read(self):
        (self.sources / "workflow.md").write_text("changed", encoding="utf-8")
        session = self.session()
        request = {"operation": "knowledge.get", "workspace": "lab", "record_ids": ["context:workflow"]}
        result = self.execute(session, self.answer(session, request, "consumer", "blocked"))
        self.assertEqual({"ok": False, "error": "stale_source"}, result[0]["requests"][0]["response"])

    def test_late_invalid_request_prevents_earlier_valid_submission(self):
        session = self.session()
        answer = self.answer(session)
        answer["requests"].append({"principal": "consumer", "mode": "executable", "request": {
            "operation": "knowledge.feedback", "workspace": "other", "release": "r1", "text": "issue"}})
        with self.assertRaises(ValueError):
            self.execute(session, answer)
        self.assertEqual(2, self.registry.db.execute("SELECT COUNT(*) FROM records").fetchone()[0])

    def test_draft_is_not_executed(self):
        session = self.session()
        result = self.execute(session, self.answer(session, status="blocked", mode="draft_only"))
        self.assertFalse(result[0]["requests"][0]["executed"])
        self.assertEqual(2, self.registry.db.execute("SELECT COUNT(*) FROM records").fetchone()[0])

    def test_late_bool_manifest_cannot_pass_integer_version_preflight(self):
        session = self.session()
        answer = self.answer(session)
        answer["requests"].append({"principal": "publisher", "mode": "executable", "request": {
            "operation": "release.publish", "workspace": "lab", "name": "r2",
            "manifest": {key: True for key in self.manifest}}})
        with self.assertRaises(ValueError):
            self.execute(session, answer)
        self.assertEqual(2, self.registry.db.execute("SELECT COUNT(*) FROM records").fetchone()[0])

    def test_known_version_conflict_rejects_before_generated_requests(self):
        session = self.session()
        answer = self.answer(session)
        answer["requests"][0]["request"]["record"]["version"] = 2
        with self.assertRaisesRegex(ValueError, "immutable versions"):
            self.execute(session, answer)
        self.assertEqual(2, self.registry.db.execute("SELECT COUNT(*) FROM records").fetchone()[0])

    def test_publication_rechecks_exact_manifest_and_durable_current_pointer(self):
        session = self.session()
        request = {"operation": "release.publish", "workspace": "lab", "name": "r2", "manifest": self.manifest}
        result = self.execute(session, self.answer(session, request, "publisher"))
        self.assertTrue(result[0]["requests"][0]["response"]["ok"])
        with KnowledgeRegistry(self.database, self.sources, self.people, lambda: self.now) as fresh:
            self.assertEqual("r2", fresh.active_release("lab"))
        with self.assertRaisesRegex(ValueError, "no longer current"):
            self.execute(session, self.answer(session))

    def test_task_identity_and_source_scope_cannot_be_swapped(self):
        first, second = self.session("first"), self.session("second")
        with self.assertRaises(ValueError):
            self.execute(second, self.answer(first))
        with self.assertRaises(ValueError):
            first.retrieve(["context:unrelated"])

    def test_drift_scenario_does_not_contaminate_isolated_healthy_task(self):
        other_sources = self.root / "other-sources"
        shutil.copytree(self.sources, other_sources)
        destination = sqlite3.connect(str(self.root / "other.sqlite3"))
        self.registry.db.backup(destination)
        destination.close()
        with KnowledgeRegistry(self.root / "other.sqlite3", other_sources, self.people, lambda: self.now) as other:
            healthy = self.session(registry=other)
            (self.sources / "workflow.md").write_text("drift scenario", encoding="utf-8")
            self.assertEqual("stale_source", self.session().state["current_access"]["error"])
            self.assertTrue(healthy.retrieve(list(self.manifest))["ok"])
            self.assertTrue(self.execute(healthy, self.answer(healthy))[0]["requests"][0]["response"]["ok"])


if __name__ == "__main__":
    unittest.main()
