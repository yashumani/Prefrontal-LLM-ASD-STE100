"""Run a reproducible local pilot and retain SQLite, consumers and maintenance evidence."""

import argparse
import hashlib
import json
import shutil
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import perf_counter

from .consumers import consume
from .context_pilot import ContextError, Registry, digest
from .native_sales import NativeSales
from .sample_domain import METRIC, PRINCIPALS, REQUEST, WORKSPACE, records, submit_and_review


ROOT = Path(__file__).resolve().parents[1]


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def file_hashes():
    return {str(p.relative_to(ROOT)).replace("\\", "/"):
            hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((ROOT / "pilot").rglob("*"))
            if p.is_file() and "__pycache__" not in p.parts}


def run(output):
    hashes = file_hashes()
    now = datetime.now(timezone.utc)
    directory = Path(output) / now.strftime("run-%Y%m%dT%H%M%S%fZ")
    directory.mkdir(parents=True, exist_ok=False)
    sources = directory / "sources"
    shutil.copytree(ROOT / "pilot" / "fixtures", sources)
    database = directory / "registry.sqlite3"
    clock_state = [now]
    native = NativeSales(sources)
    scenarios = []
    with Registry(database, sources, PRINCIPALS, lambda: clock_state[0]) as registry:
        def expect_denial(code, actor="agent"):
            response = registry.dispatch(actor, dict(REQUEST))
            if response != {"ok": False, "error": code}:
                raise AssertionError(response)
            return response

        def scenario(name, responsible_roles, function):
            start = perf_counter()
            before = len(registry.audit())
            details = function()
            events = registry.audit()[before:]
            scenarios.append({"scenario": name, "status": "verified",
                              "responsible_roles": responsible_roles,
                              "observed_event_counts": dict(Counter(e["action"] for e in events)),
                              "elapsed_ms": round((perf_counter() - start) * 1000, 3),
                              "human_minutes": None, "details": details})

        manifest = submit_and_review(registry, records(registry, now))
        registry.publish("release-owner", WORKSPACE, "r1", manifest)
        initial = [consume(kind, registry.dispatch, native.query)
                   for kind in ("agent", "chatbot", "workflow")]
        assert all(o["context"] == initial[0]["context"] for o in initial)
        assert all(o["result"]["value_cents"] == 330000 for o in initial)
        write_json(directory / "initial-consumers.json", initial)

        def failed_release():
            try:
                registry.publish("release-owner", WORKSPACE, "incomplete", {"data:orders": 1})
            except ContextError as exc:
                assert exc.code == "incomplete_layers"
            else:
                raise AssertionError("incomplete release accepted")
            assert registry.active_release(WORKSPACE) == "r1"
            assert registry.dispatch("agent", REQUEST)["ok"]
            return {"active_release": "r1", "failure": "incomplete_layers"}

        scenario("failed publication retains valid release", ["release owner"], failed_release)

        def feedback():
            before = registry.dispatch("chatbot", REQUEST)["context"]
            registry.feedback("chatbot", WORKSPACE, "r1", "Please clarify returns.")
            after = registry.dispatch("chatbot", REQUEST)["context"]
            assert before == after
            return {"decision": "pending review", "published_meaning_changed": False}

        scenario("consumer feedback", ["consumer owner", "domain reviewer"], feedback)

        def definition_change():
            nonlocal manifest
            versions = {**manifest, METRIC: 2, "interpretation:net-revenue": 2}
            updated = [body for body in records(registry, now, versions)
                       if body["id"] in {METRIC, "interpretation:net-revenue"}]
            updated[0]["claim"] = "Completed-order net revenue subtracts discounts and returns."
            receipts = {b["id"]: registry.submit("domain-owner", b) for b in updated}
            try:
                registry.publish("release-owner", WORKSPACE, "unreviewed", versions)
            except ContextError as exc:
                assert exc.code == "unapproved"
            else:
                raise AssertionError("unapproved revision accepted")
            assert registry.active_release(WORKSPACE) == "r1"
            for body in updated:
                registry.approve("reviewer", WORKSPACE, body["id"], body["version"], receipts[body["id"]])
            registry.publish("release-owner", WORKSPACE, "r2", versions)
            manifest = versions
            return {"affected_records": [b["id"] for b in updated], "active_release": "r2",
                    "old_approval_reused": False}

        scenario("definition clarification", ["domain owner", "domain reviewer", "release owner"],
                 definition_change)

        def correction():
            nonlocal manifest
            path = sources / "orders.json"
            before_hash = registry.source_hash("orders.json")
            data = json.loads(path.read_text(encoding="utf-8"))
            data["orders"][0]["gross_cents"] += 10000
            write_json(path, data)
            denial = expect_denial("stale_source")
            affected = registry.impact(WORKSPACE, "orders.json")
            assert len(affected) == 4
            versions = {rid: version + 1 for rid, version in manifest.items()}
            manifest = submit_and_review(registry, records(registry, now, versions))
            expect_denial("stale_source")  # Approval alone does not change the active release.
            registry.publish("release-owner", WORKSPACE, "r3", manifest)
            result = consume("workflow", registry.dispatch, native.query)
            assert result["result"]["value_cents"] == 340000
            return {"source_before": before_hash, "source_after": registry.source_hash("orders.json"),
                    "affected_records": affected, "denial": denial,
                    "recovered_value_cents": 340000, "active_release": "r3"}

        scenario("source correction", ["source owner", "domain reviewer", "release owner"], correction)

        def consumer_access_change():
            registry.principals["workflow"]["roles"] = []
            denial = expect_denial("access_denied", "workflow")
            registry.principals["workflow"] = json.loads(json.dumps(PRINCIPALS["workflow"]))
            return {"denial": denial, "fixture_grant_restored_for_next_scenario": True}

        scenario("consumer access revocation", ["platform maintainer"], consumer_access_change)

        def native_access_change():
            bundle = registry.dispatch("chatbot", REQUEST)["context"]
            native.allowed.remove("chatbot")
            try:
                native.query("chatbot", bundle, registry.dispatch)
            except ContextError as exc:
                assert exc.code == "source_access_denied"
            else:
                raise AssertionError("source access not enforced")
            native.allowed.add("chatbot")
            return {"context_access_grants_source_access": False, "denial": "source_access_denied"}

        scenario("native source access revocation", ["source owner", "consumer owner"], native_access_change)

        def expiry():
            clock_state[0] = now + timedelta(days=31)
            denial = expect_denial("outside_validity")
            clock_state[0] = now
            return {"denial": denial, "simulation_clock_reset": True}

        scenario("validity expiry", ["domain reviewer", "platform maintainer"], expiry)

        def withdrawal():
            nonlocal manifest
            record_id = "interpretation:net-revenue"
            cached = registry.dispatch("agent", REQUEST)["context"]
            registry.revoke("reviewer", WORKSPACE, record_id, manifest[record_id])
            expect_denial("revoked")
            try:
                native.query("agent", cached, registry.dispatch)
            except ContextError as exc:
                assert exc.code == "revoked"
            else:
                raise AssertionError("cached bundle survived revocation")
            versions = {**manifest, record_id: manifest[record_id] + 1}
            replacement = [b for b in records(registry, now, versions) if b["id"] == record_id]
            submit_and_review(registry, replacement)
            registry.publish("release-owner", WORKSPACE, "r4", versions)
            manifest = versions
            return {"cached_use_denied": True, "replacement_records": [record_id], "active_release": "r4"}

        scenario("interpretation withdrawal and reviewed replacement",
                 ["domain reviewer", "release owner"], withdrawal)
        final = [consume(kind, registry.dispatch, native.query)
                 for kind in ("agent", "chatbot", "workflow")]
        assert all(o["context"] == final[0]["context"] for o in final)
        assert all(o["result"]["value_cents"] == 340000 for o in final)
        final_bundle = final[0]["context"]
        write_json(directory / "final-consumers.json", final)
        searches = [registry.dispatch("agent", {"operation": "context.search", "workspace": WORKSPACE,
                    "query": query, "period": "2026-09", "unit": "USD"})
                    for query in (METRIC, "net sales")]
        assert all(s["ok"] and s["search"]["context"] == final_bundle for s in searches)
        write_json(directory / "search-baseline.json", searches)

    # Fresh connection verifies durable readback; CLI also exercises a fresh process in tests.
    with Registry(database, sources, PRINCIPALS) as restarted:
        assert restarted.dispatch("agent", REQUEST)["context"] == final_bundle
        audit = restarted.audit()
        write_json(directory / "audit.json", audit)
        assert file_hashes() == hashes, "pilot files changed during the run; evidence is unqualified"
        report = {"scope": "local deterministic synthetic pilot", "created_at": now.isoformat(),
                  "contract": final_bundle["contract"], "code_and_fixture_hashes": hashes,
                  "tested_version_digest": digest(hashes),
                  "simulated_human_approvals": True, "human_effort_measured": False,
                  "operating_cost_measured": False, "llm_calls": 0,
                  "maintenance_scenarios": scenarios, "verified_scenarios": len(scenarios),
                  "consumer_count": 3, "identical_context_bundles": True,
                  "exact_and_keyword_lookup": True, "hybrid_search_qualified": False,
                  "initial_net_revenue_usd": "3300", "corrected_net_revenue_usd": "3400",
                  "durable_readback": True, "active_release": "r4", "manifest": manifest,
                  "bundle_hash": final_bundle["bundle_hash"], "audit_event_count": len(audit),
                  "audit_event_counts": dict(Counter(e["action"] for e in audit)),
                  "database": str(database.resolve()), "source_root": str(sources.resolve()),
                  "limits": ["trusted local identities and simulated approvals",
                             "no network authentication, real MCP or enterprise adapter",
                             "no semantic search, LLM quality, load or distributed concurrency qualification",
                             "source-byte checks detect bound changes, not semantic truth",
                             "human maintenance time, staffing and business return unmeasured"]}
        write_json(directory / "evidence.json", report)
    return directory, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(ROOT / ".validation" / "context-pilot"))
    args = parser.parse_args()
    directory, report = run(args.output)
    print("PASS: 3 consumers, identical context; USD 3300 -> USD 3400 after reviewed correction")
    print("PASS: {} maintenance scenarios; durable SQLite readback; 0 LLM calls".format(
        report["verified_scenarios"]))
    print("Evidence: " + str((directory / "evidence.json").resolve()))


if __name__ == "__main__":
    main()
