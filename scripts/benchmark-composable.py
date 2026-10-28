"""Reproducible synthetic metadata benchmark; no models or warehouse queries.

Each dataset runs in a fresh bounded subprocess. Approvals are simulated, exact
hash decisions by a distinct configured reviewer. No enterprise data is loaded.
"""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import sqlite3
import statistics
import subprocess
import sys
import time
import tracemalloc
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def peak_rss_bytes():
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in (
                    "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                    "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                    "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]

        counter = Counters()
        counter.cb = ctypes.sizeof(counter)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counter), counter.cb):
            return None
        return counter.PeakWorkingSetSize
    try:
        import resource
        value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return value if sys.platform == "darwin" else value * 1024
    except ImportError:
        return None


def worker(size, output, rss_limit):
    from pilot.composable_model import validate_record
    from pilot.composable_registry import ComposableRegistry
    from pilot.context_pilot import digest
    from pilot.context_pilot import ContextError

    started = time.perf_counter()
    root = Path(output)
    root.mkdir(parents=True, exist_ok=False)
    source = root / "domain.md"
    source.write_text("Synthetic metadata benchmark. No warehouse or enterprise records.\n", encoding="utf-8")
    proof = [{"path": source.name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest()}]
    now = datetime.now(timezone.utc)
    base = {"schema": "prefrontal.context.v1", "version": 1, "owner": "synthetic-owner",
            "classification": "internal", "valid_from": (now - timedelta(minutes=1)).isoformat(),
            "valid_until": (now + timedelta(days=1)).isoformat(), "provenance": proof,
            "description": "Synthetic scale fixture", "narrative": "Reviewed fixture narrative; simulated approvals."}

    def record(rid, layer, kind, spec, deps=(), name=None, aliases=()):
        return validate_record(dict(base, id=rid, layer=layer, kind=kind, spec=spec,
                                    name=name or rid, aliases=list(aliases),
                                    dependencies=[{"id": item, "version": 1} for item in deps]))

    records = [record("CHANNEL", "ontology", "dimension", {"value_type": "text"}),
               record("PRODUCT", "ontology", "dimension", {"value_type": "text"}),
               record("PERIOD", "ontology", "dimension", {"value_type": "period"}),
               record("SOURCE_ORDERS", "data", "source", {
                   "binding": "synthetic-orders", "grain": ["order"], "freshness_seconds": 86400,
                   "checked_at": now.isoformat(),
                   "dimensions": {"CHANNEL": "channel", "PRODUCT": "product", "PERIOD": "period"}}),
               record("G_REVIEWED", "interpretation", "guidance", {
                   "qualifiers": ["Synthetic completed activations only"], "caveats": ["Not enterprise evidence"]}),
               record("M_GROSS_ADDS", "metric", "measure", {
                   "source": "SOURCE_ORDERS", "aggregation": "count", "expression": "completed_activations",
                   "required_dimensions": ["PERIOD"], "optional_dimensions": ["CHANNEL", "PRODUCT"],
                   "guidance": ["G_REVIEWED"]}, ["SOURCE_ORDERS", "CHANNEL", "PRODUCT", "PERIOD", "G_REVIEWED"]),
               record("PRODUCT_POSTPAID", "ontology", "member", {
                   "dimension": "PRODUCT", "value": "postpaid", "parents": []}, ["PRODUCT"]),
               record("PERIOD_2026_09", "ontology", "member", {
                   "dimension": "PERIOD", "value": "2026-09", "parents": []}, ["PERIOD"])]
    people = {actor: {"workspace": "scale", "roles": [role], "classifications": ["internal"],
                      "source_bindings": ["synthetic-orders"]}
              for actor, role in (("author", "submitter"), ("reviewer", "reviewer"),
                                  ("releaser", "releaser"), ("reader", "consumer"))}
    database = root / "registry.sqlite3"
    batches = 0
    with ComposableRegistry(database, root, people) as registry:
        def admit(batch):
            nonlocal batches
            registry.submit_batch("author", batch)
            with registry.transaction():
                for body in batch:
                    registry.review("reviewer", "scale", body["id"], 1, digest(body), "approved")
            registry.publish("releaser", "scale", [{"id": body["id"], "version": 1} for body in batch])
            batches += 1

        admit(records)
        seed_started = time.perf_counter()
        for first in range(0, size, 256):
            batch = []
            for index in range(first, min(first + 256, size)):
                rid = "CHANNEL_MEMBER_%06d" % index
                batch.append(record(rid, "ontology", "member", {
                    "dimension": "CHANNEL", "value": "channel-%06d" % index, "parents": []},
                    ["CHANNEL"], name="Synthetic member %06d" % index, aliases=["scaleleaf%06d" % index]))
            admit(batch)
            rss = peak_rss_bytes()
            if rss is not None and rss > rss_limit * 1024 * 1024:
                raise RuntimeError("measured process peak RSS exceeded configured limit")
        seed_seconds = time.perf_counter() - seed_started
        selected = "CHANNEL_MEMBER_%06d" % (size - 1)
        request = [selected, "PRODUCT_POSTPAID", "PERIOD_2026_09"]

        def resolve():
            return registry.resolve("reader", "scale", "M_GROSS_ADDS", request)

        first_bundle = resolve()
        reversed_bundle = registry.resolve("reader", "scale", "M_GROSS_ADDS", list(reversed(request)))
        assert first_bundle["bundle_hash"] == reversed_bundle["bundle_hash"], "selector order changes identity"
        operations = {
            "exact_id_search": lambda: registry.search("reader", "scale", selected),
            "alias_search": lambda: registry.search("reader", "scale", "scaleleaf%06d" % (size - 1)),
            "ranked_first_page": lambda: registry.search("reader", "scale", "synthetic member", dimension="CHANNEL", page_size=20),
            "ranked_targeted_search": lambda: registry.search("reader", "scale", "member %06d" % (size - 1), dimension="CHANNEL", page_size=20),
            "bounded_resolution": resolve,
        }
        measurements = {}
        for name, operation in operations.items():
            probe_started = time.perf_counter_ns()
            try:
                operation()  # successful warm-up explicitly excluded
            except ContextError as error:
                if (name != "ranked_first_page" or error.code != "context_unavailable"
                        or not isinstance(error.__context__, sqlite3.DatabaseError)
                        or str(error.__context__) != "interrupted"):
                    raise
                measurements[name] = {"status": "bounded_denial", "reason": "sqlite_ranking_work_budget",
                    "probe_ms": round((time.perf_counter_ns() - probe_started) / 1e6, 3),
                    "partial_results": False, "timed_samples": 0}
                (root / "measurement-progress.json").write_text(json.dumps(measurements, indent=2) + "\n", encoding="utf-8")
                continue
            samples = []
            for _ in range(20):
                tick = time.perf_counter_ns()
                result = operation()
                samples.append((time.perf_counter_ns() - tick) / 1e6)
                if name.endswith("search"):
                    assert result["results"][0]["id"] == selected
            tracemalloc.start()
            operation()
            _, peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()
            ordered = sorted(samples)
            measurements[name] = {"status": "passed", "samples": len(samples), "median_ms": round(statistics.median(samples), 3),
                                  "p95_ms": round(ordered[18], 3), "max_ms": round(max(samples), 3),
                                  "single_operation_python_peak_bytes": peak}
            (root / "measurement-progress.json").write_text(json.dumps(measurements, indent=2) + "\n", encoding="utf-8")
        rss = peak_rss_bytes()
        assert rss is None or rss <= rss_limit * 1024 * 1024
        return {"status": "completed_with_query_limits" if any(value["status"] != "passed" for value in measurements.values()) else "passed",
                "synthetic_members": size, "canonical_records": size + len(records),
                "materialized_combinations": 0, "submitted_batches": batches,
                "simulated_exact_version_reviews": size + len(records),
                "member_ingest_review_publish_seconds": round(seed_seconds, 3),
                "total_seconds": round(time.perf_counter() - started, 3),
                "database_bytes": database.stat().st_size, "process_peak_rss_bytes": rss,
                "process_peak_rss_limit_mib": rss_limit,
                "resolved_records": len(first_bundle["records"]),
                "resolved_bundle_bytes": len(json.dumps(first_bundle).encode("utf-8")),
                "selector_order_invariant": True, "operations": measurements,
                "source_fact_rows_executed": 0, "llm_calls": 0,
                "approval_note": "Scripted distinct-role approvals; no human effort or semantic truth measurement"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--sizes", default="1000,10000")
    parser.add_argument("--max-seconds", type=int, default=300)
    parser.add_argument("--max-rss-mib", type=int, default=512)
    parser.add_argument("--worker", type=int)
    args = parser.parse_args()
    if args.worker is not None:
        print(json.dumps(worker(args.worker, args.output, args.max_rss_mib), sort_keys=True))
        return
    sizes = [int(value) for value in args.sizes.split(",")]
    if (not sizes or any(value < 1 or value > 100000 for value in sizes)
            or len(set(sizes)) != len(sizes) or not 1 <= args.max_seconds <= 1800
            or not 32 <= args.max_rss_mib <= 4096):
        parser.error("unique sizes 1..100000, per-dataset seconds 1..1800, RSS MiB 32..4096 required")
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    report = {"contract": "prefrontal.synthetic.scale.v1", "created_at_utc": datetime.now(timezone.utc).isoformat(),
              "environment": {"python": sys.version, "platform": platform.platform(), "machine": platform.machine(),
                              "sqlite": sqlite3.sqlite_version, "cpu_count": os.cpu_count()},
              "limits": {"per_dataset_wall_seconds": args.max_seconds, "process_peak_rss_mib": args.max_rss_mib,
                         "rss_limit_enforcement": "measured after each batch and at completion; not an OS hard allocation cap",
                         "search_candidate_budget": 2048, "search_sql_vm_instruction_budget": 20000000,
                         "warmups_per_operation": 1, "timed_samples_per_operation": 20},
              "scope": "Synthetic context metadata; fixed tiny evidence file, no underlying fact-data scale claim",
              "code_sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in
                  [Path(__file__).resolve()] + sorted((Path(__file__).resolve().parents[1] / "pilot").glob("composable_*.py"))},
              "datasets": []}
    failed = False
    for size in sizes:
        command = [sys.executable, "-B", str(Path(__file__).resolve()), "--worker", str(size),
                   "--output", str(output / ("members-%d" % size)), "--max-rss-mib", str(args.max_rss_mib)]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=args.max_seconds)
            if result.returncode:
                item = {"synthetic_members": size, "status": "failed", "stderr": result.stderr[-8000:]}
                failed = True
            else:
                item = json.loads(result.stdout)
        except subprocess.TimeoutExpired:
            item = {"synthetic_members": size, "status": "timeout", "wall_limit_seconds": args.max_seconds}
            failed = True
        report["datasets"].append(item)
        (output / "benchmark.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(item, sort_keys=True), flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
