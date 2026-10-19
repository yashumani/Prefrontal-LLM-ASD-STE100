"""Reproduce a small knowledge lifecycle with explicitly simulated approvals."""

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .context_pilot import digest
from .demo import file_hashes, write_json
from .knowledge import KnowledgeRegistry


WORKSPACE = "knowledge-lab"
PRINCIPALS = {
    "fixture-author": {"workspace": WORKSPACE, "roles": ["submitter"]},
    "fixture-reviewer": {"workspace": WORKSPACE, "roles": ["reviewer"]},
    "fixture-publisher": {"workspace": WORKSPACE, "roles": ["publisher"]},
    "reader": {"workspace": WORKSPACE, "roles": ["consumer"], "classifications": ["internal"]},
}


def run(output):
    now = datetime.now(timezone.utc)
    directory = Path(output) / now.strftime("run-%Y%m%dT%H%M%S%fZ")
    sources = directory / "sources"
    sources.mkdir(parents=True, exist_ok=False)
    authority = sources / "authority.md"
    authority.write_text("Context delivery does not authorize consumer actions.\n", encoding="utf-8")
    (sources / "review.md").write_text("Changed meaning requires independent review.\n", encoding="utf-8")
    write_json(directory / "principals.json", PRINCIPALS)
    database = directory / "registry.sqlite3"

    with KnowledgeRegistry(database, sources, PRINCIPALS) as registry:
        def record(record_id, source, claim, version=1, dependencies=None):
            return {"id": record_id, "version": version, "workspace": WORKSPACE,
                    "layer": "interpretation" if dependencies else "data", "owner": "fixture-owner",
                    "claim": claim, "classification": "internal", "valid_from": now.isoformat(),
                    "valid_until": (now + timedelta(days=30)).isoformat(),
                    "evidence": [registry.evidence(source)], "dependencies": dependencies or [],
                    "content": {"text": claim, "topics": ["action authority" if source == "authority.md" else "review"],
                                "assumptions": ["Invented reference policy."],
                                "limits": ["No real identity or human approval qualification."]}}

        def fixture_review(bodies):
            for body in bodies:
                receipt = registry.submit("fixture-author", body)
                registry.approve("fixture-reviewer", WORKSPACE, body["id"], body["version"], receipt)

        facts = [record("context:authority", "authority.md", authority.read_text(encoding="utf-8").strip()),
                 record("context:review", "review.md", "Changed meaning requires independent review.")]
        summary = record("context:summary", "authority.md", "Permission must be checked by the action owner.",
                         dependencies=[{"id": "context:authority", "version": 1}])
        initial = facts + [summary]
        fixture_review(initial)
        manifest = {body["id"]: body["version"] for body in initial}
        registry.publish("fixture-publisher", WORKSPACE, "r1", manifest)
        bundle = registry.get_records("reader", WORKSPACE, ["context:summary"])
        if {entry["record"]["id"] for entry in bundle["records"]} != {"context:authority", "context:summary"}:
            raise AssertionError("unrelated record delivered")
        write_json(directory / "initial-context.json", bundle)
        searched = registry.dispatch("reader", {"operation": "knowledge.search", "workspace": WORKSPACE,
                                                 "query": "context:authority"})
        if not searched["ok"]:
            raise AssertionError(searched)
        unknown = registry.dispatch("reader", {"operation": "knowledge.search", "workspace": WORKSPACE,
                                                "query": "profitability"})
        if unknown != {"ok": False, "error": "no_match"}:
            raise AssertionError("unsupported question did not abstain")
        registry.feedback("reader", WORKSPACE, "r1", "Please clarify the action owner's check.")
        if registry.get_records("reader", WORKSPACE, ["context:summary"]) != bundle:
            raise AssertionError("feedback changed published meaning")

        authority.write_text("Context delivery does not authorize actions; recheck source permission at use.\n",
                             encoding="utf-8")
        drift = registry.dispatch("reader", {"operation": "knowledge.get", "workspace": WORKSPACE,
                                             "record_ids": ["context:summary"]})
        if drift != {"ok": False, "error": "stale_source"}:
            raise AssertionError("changed source was delivered")
        blocked = registry.health("fixture-reviewer", WORKSPACE)
        if blocked["status"] != "blocked":
            raise AssertionError("health missed source drift")
        affected = registry.impact(WORKSPACE, "authority.md")
        if {item["id"] for item in affected} != {"context:authority", "context:summary"}:
            raise AssertionError("incorrect maintenance impact")
        revised = [record("context:authority", "authority.md", authority.read_text(encoding="utf-8").strip(), 2),
                   record("context:summary", "authority.md", "Recheck native action permissions at use.", 2,
                          [{"id": "context:authority", "version": 2}])]
        fixture_review(revised)
        manifest.update({body["id"]: 2 for body in revised})
        registry.publish("fixture-publisher", WORKSPACE, "r2", manifest)
        final = registry.get_records("reader", WORKSPACE, ["context:summary"])
        healthy = registry.health("fixture-reviewer", WORKSPACE)
        if healthy["status"] != "healthy":
            raise AssertionError(healthy)
        audit = registry.audit()
        write_json(directory / "final-context.json", final)
        write_json(directory / "audit.json", audit)
    with KnowledgeRegistry(database, sources, PRINCIPALS) as reopened:
        if reopened.get_records("reader", WORKSPACE, ["context:summary"]) != final:
            raise AssertionError("durable readback changed context")
    code = file_hashes()
    report = {"scope": "local deterministic knowledge reference", "created_at": now.isoformat(),
              "code_and_fixture_hashes": code, "tested_version_digest": digest(code),
              "simulated_human_approvals": True, "llm_calls": 0, "human_effort_measured": False,
              "selected_records": 2, "release_records": 3, "unrelated_record_excluded": True,
              "unsupported_question": unknown, "source_drift": drift,
              "affected_records": affected, "correction_review_receipts": len(revised),
              "health_before_correction": blocked, "health_after_correction": healthy,
              "durable_readback": True, "active_release": "r2",
              "source_root": str(sources.resolve()), "database": str(database.resolve()),
              "principals": str((directory / "principals.json").resolve())}
    write_json(directory / "evidence.json", report)
    return directory, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(Path(__file__).resolve().parents[1] / ".validation" / "knowledge"))
    args = parser.parse_args()
    directory, _ = run(args.output)
    print("PASS: selected knowledge and exact dependencies; unrelated context excluded")
    print("PASS: unsupported question abstains; source drift blocks; reviewed correction restores durable use")
    print("Approvals: simulated; LLM calls: 0; human effort: unmeasured")
    print("Evidence: " + str((directory / "evidence.json").resolve()))


if __name__ == "__main__":
    main()
