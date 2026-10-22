"""Bounded offline evaluation of the synthetic governed completed-order fixture.

Scores qualify named deterministic checks only. Simulated review, lexical retrieval
and preserved caveats establish neither human semantic approval nor model quality.
"""
import argparse
import copy
import hashlib
import json
import math
import platform
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .composable_cli import load_principals
from .composable_demo import run_demo, WORKSPACE
from .composable_formats import export_document, parse_document
from .composable_model import ContextError
from .composable_native import execute_native
from .composable_registry import ComposableRegistry

SCHEMA = "prefrontal.context.evaluation.v1"
MAX_REPORT_BYTES = 1048576
MAX_BINDING_BYTES = 16777216
BENCHMARK_ID = "synthetic-gross-additions"
BENCHMARK_REVISION = "1"
CODE_FILES = ("context_evaluation.py", "composable_demo.py", "composable_registry.py",
              "composable_native.py", "composable_formats.py", "composable_model.py",
              "composable_search.py", "composable_cli.py", "context_pilot.py")
NATIVE_CASES = (
    ("period", ["PERIOD_2026_09"], {"period": "2026-09"}),
    ("channel", ["PERIOD_2026_09", "CHANNEL_ONLINE"], {"period": "2026-09", "channel": "online"}),
    ("product", ["PERIOD_2026_09", "PRODUCT_POSTPAID"], {"period": "2026-09", "product": "postpaid"}),
    ("combined", ["PERIOD_2026_09", "CHANNEL_ONLINE", "PRODUCT_POSTPAID"],
     {"period": "2026-09", "channel": "online", "product": "postpaid"}),
    ("zero", ["PERIOD_2026_08", "PRODUCT_PREPAID"], {"period": "2026-08", "product": "prepaid"}),
)
# The benchmark is deliberately small and explicit; no universal evaluator/plugin API.
CHECKS = {
    "source": ("data", "Exact provenance, current source and revalidation", True, ["source"]),
    "native": ("metric", "Completed-order formula, unit, grain and filters", True,
               [item[0] for item in NATIVE_CASES]),
    "ontology": ("ontology", "Pinned member identities and dimension relationships", True, ["ontology"]),
    "interpretation": ("interpretation", "Approved guidance qualifier/caveat presence", False, ["interpretation"]),
    "retrieval_precision": ("retrieval", "Judged lexical retrieval precision", False, ["exact", "alias", "absent"]),
    "retrieval_recall": ("retrieval", "Judged lexical retrieval recall", False, ["exact", "alias", "absent"]),
    "formats": ("formats", "Approved JSON/YAML/Markdown record equivalence", True, ["json", "yaml", "markdown"]),
    "security": ("governance", "Denied unauthorized use and unsupported composition", True,
                 ["unknown_actor", "missing_period", "cross_dimension", "native_authority"]),
    "review": ("governance", "Exact review and release evidence (simulated)", True, ["review"]),
    "human_semantics": ("interpretation", "Independent human semantic approval", False, ["human_semantics"]),
}


def _now():
    return datetime.now(timezone.utc)


def _stamp(value):
    return value.isoformat().replace("+00:00", "Z")


def _time(value):
    if not isinstance(value, str):
        raise ValueError("timestamp")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("timezone required")
    return result


def _canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _digest(value):
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _file_hash(path):
    with Path(path).open("rb") as stream:
        raw = stream.read(MAX_BINDING_BYTES + 1)
    if len(raw) > MAX_BINDING_BYTES:
        raise ValueError("binding too large")
    return hashlib.sha256(raw).hexdigest()


def _read_json(path, limit=MAX_REPORT_BYTES):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate key")
            result[key] = value
        return result
    with Path(path).open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("input too large")
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")))
    def bounded(item, depth=0):
        if depth > 30:
            raise ValueError("depth")
        if type(item) is float and not math.isfinite(item):
            raise ValueError("nonfinite number")
        if type(item) is int and abs(item) > 2 ** 63 - 1:
            raise ValueError("integer bound")
        if isinstance(item, dict):
            for child in item.values():
                bounded(child, depth + 1)
        elif isinstance(item, list):
            for child in item:
                bounded(child, depth + 1)
    bounded(value)
    return value


def _write_json(path, value):
    text = json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    if len(text.encode("utf-8")) > MAX_REPORT_BYTES:
        raise ValueError("report too large")
    Path(path).write_text(text, encoding="utf-8")


def _local(root, relative):
    if not isinstance(relative, str) or Path(relative).is_absolute():
        raise ValueError("binding path")
    path = (root / relative).resolve()
    if root not in path.parents:
        raise ValueError("binding escape")
    return path


class _ReadOnlyRegistry(ComposableRegistry):
    """Reuse live resolver checks without initialization/migration or any writes."""
    def __init__(self, database, source_root, principals):
        self.root = Path(source_root).resolve()
        self.principals = principals
        self.clock = _now
        self._closed = False
        self._savepoint = 0
        self.db = sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True,
                                  isolation_level=None, timeout=1)
        self.db.row_factory = sqlite3.Row
        try:
            row = self.db.execute("SELECT value FROM c_config WHERE key='profile'").fetchone()
            if row is None or row[0] != "prefrontal.composable.v1":
                raise ValueError("profile")
            self.db.execute("PRAGMA query_only=ON")
            self.db.execute("BEGIN")
        except Exception:
            self.db.close()
            raise


def _case(identifier, expected, observed, evidence=(), elapsed_ms=None):
    return {"id": identifier, "status": "measured" if _canonical(observed) == _canonical(expected) else "failed",
            "expected": expected, "observed": observed, "evidence": list(evidence),
            "elapsed_ms": elapsed_ms}


def _summarize(identifier, cases):
    layer, name, critical, planned = CHECKS[identifier]
    done = [case for case in cases if case["status"] != "missing"]
    # Retrieval uses set-level hit counts; empty result/relevant sets are undefined.
    if identifier.startswith("retrieval_"):
        field = "returned" if identifier.endswith("precision") else "relevant"
        numerator = sum(case["observed"]["hits"] for case in done)
        denominator = sum(case["expected" if field == "relevant" else "observed"][field] for case in done)
    else:
        numerator = sum(case["status"] == "measured" for case in done)
        denominator = len(done)
    status = ("failed" if any(case["status"] == "failed" for case in cases) else
              "missing" if not done else "partial" if len(done) < len(planned) else "measured")
    return {"id": identifier, "layer": layer, "name": name, "critical": critical,
            "status": status, "score": {"numerator": numerator, "denominator": denominator,
                "value": numerator / denominator if denominator else None},
            "coverage": {"planned": len(planned), "executed": len(done)}, "cases": cases,
            "limits": (["Literal, pre-judged synthetic queries; no semantic relevance judgment."]
                       if identifier.startswith("retrieval_") else
                       ["Checks approved guidance presence only; no generated-answer caveat preservation, entailment or causal judgment."]
                       if identifier == "interpretation" else
                       ["Actual independent human review was not performed."]
                       if identifier == "human_semantics" else ["Bounded synthetic fixture only."])}


def _missing_case(identifier):
    return {"id": identifier, "status": "missing", "expected": None, "observed": None,
            "evidence": ["No execution recorded."], "elapsed_ms": None}


def _gates(report):
    checks = {check["id"]: check for check in report["checks"]}
    gates = []
    for identifier, name, ids in (
            ("security", "Security boundary", ["security"]),
            ("critical", "Critical deterministic semantics", [key for key, value in CHECKS.items()
                                                               if value[2] and key != "security"])):
        states = [checks.get(key, {}).get("status", "missing") for key in ids]
        status = "failed" if "failed" in states else "not_evaluated" if any(
            state in {"missing", "partial"} for state in states) else "passed"
        gates.append({"id": identifier, "name": name, "status": status, "check_ids": ids,
                      "reasons": [key + ": " + checks.get(key, {}).get("status", "missing")
                                  for key in ids if checks.get(key, {}).get("status") != "measured"]})
    current = report["currentness"]
    gates.append({"id": "freshness", "name": "Current exact authority and evidence",
        "status": {"current": "passed", "stale": "stale", "not_evaluated": "not_evaluated"}[current["status"]],
        "check_ids": ["source"], "reasons": current["reasons"]})
    report["gates"] = gates
    report["coverage"] = {field: sum(check["coverage"][field] for check in checks.values())
                          for field in ("planned", "executed")}
    blocked = any(gate["status"] == "failed" for gate in gates)
    if current["status"] == "stale":
        report["status"], report["acceptance"] = "stale", "blocked" if blocked else "stale"
    elif blocked:
        report["status"], report["acceptance"] = "failed", "blocked"
    elif any(gate["status"] == "not_evaluated" for gate in gates):
        report["status"], report["acceptance"] = "missing", "not_evaluated"
    else:
        partial = any(check["status"] in {"missing", "partial"} for check in checks.values())
        failed = any(check["status"] == "failed" for check in checks.values())
        report["status"] = "failed" if failed else "partial" if partial else "measured"
        report["acceptance"] = "partial" if partial or failed else "passed"


def _model_comparison():
    return {"status": "not_evaluated", "paired_executions": 0, "held_out_cases": 0,
        "matched": {"model": False, "prompt": False, "tools": False, "budget": False},
        "uplift": None, "reason": "No matched held-out model executions; deterministic fixture only."}


def _empty(reason):
    return {"schema": SCHEMA, "run_id": None, "evaluated_at": None, "benchmark": None,
        "snapshot": None, "dataset": None, "evaluator": None,
        "approval": {"status": "unknown", "description": "No usable report."},
        "status": "missing", "acceptance": "not_evaluated",
        "currentness": {"status": "not_evaluated", "checked_at": _stamp(_now()),
                        "expires_at": None, "reasons": [reason]},
        "checks": [], "gates": [], "coverage": {"planned": 0, "executed": 0},
        "model_comparison": _model_comparison(), "runtime": {"elapsed_ms": None,
        "model_calls": 0, "network_calls": 0, "model_api_cost": None}, "limits": [reason]}


def run_evaluation(output_root):
    """Create a unique synthetic run, execute bounded checks and persist evidence."""
    started = time.perf_counter()
    demo = run_demo(output_root)
    root = Path(demo["run_dir"])
    cases = {key: [] for key in CHECKS}
    facts = _read_json(root / "sources" / "orders.json")
    # Oracle reads raw rows directly; it never calls the native filter/count helper.
    expected = {identifier: len({row["order"] for row in facts if row["status"] == "completed"
                and all(row[column] == value for column, value in filters.items())})
                for identifier, _, filters in NATIVE_CASES}
    benchmark = {"id": BENCHMARK_ID, "revision": BENCHMARK_REVISION,
        "native_cases": [{"id": identifier, "selectors": selectors, "filters": filters,
                          "expected": expected[identifier]} for identifier, selectors, filters in NATIVE_CASES],
        "required_checks": {key: value[3] for key, value in CHECKS.items()},
        "retrieval": {"exact": ["M_GROSS_ADDS"], "alias": ["M_GROSS_ADDS"], "absent": []},
        "oracle": "Distinct completed order IDs independently counted from raw fixture rows."}
    _write_json(root / "benchmark.json", benchmark)
    with ComposableRegistry(demo["database"], demo["source_root"],
                            lambda: load_principals(demo["principals"])) as registry:
        # Extend only this newly generated synthetic registry with two reviewed
        # fixture members, so the independent oracle includes a true zero case.
        extra = []
        for original, identifier, value in (("PERIOD_2026_09", "PERIOD_2026_08", "2026-08"),
                                              ("PRODUCT_POSTPAID", "PRODUCT_PREPAID", "prepaid")):
            proposal = registry.get_record("agent", WORKSPACE, original)
            proposal["id"], proposal["name"], proposal["spec"]["value"] = identifier, identifier, value
            extra.append(proposal)
        hashes = registry.submit_batch("submitter", extra)
        for proposal, content_hash in zip(extra, hashes):
            registry.review("reviewer", WORKSPACE, proposal["id"], 1, content_hash, "approved")
            _write_json(root / "records" / (proposal["id"] + ".json"), proposal)
        registry.publish("releaser", WORKSPACE, [{"id": item["id"], "version": 1} for item in extra])
        bundle = registry.revalidate("agent", registry.resolve("agent", WORKSPACE, "M_GROSS_ADDS",
                                      ["PERIOD_2026_09", "CHANNEL_ONLINE", "PRODUCT_POSTPAID"]))
        records = {entry["record"]["id"]: entry["record"] for entry in bundle["records"]}
        source = records["SOURCE_ORDERS"]
        cases["source"].append(_case("source", True,
            source["provenance"] == [{"path": "orders.json", "sha256": _file_hash(root / "sources" / "orders.json")}]
            and bundle["recheck_at_use"] is True,
            ["bundle_hash=" + bundle["bundle_hash"], "catalog_revision=" + str(bundle["catalog_revision"])]))
        for identifier, selectors, _ in NATIVE_CASES:
            tick = time.perf_counter()
            try:
                current = registry.revalidate("agent", registry.resolve("agent", WORKSPACE, "M_GROSS_ADDS", selectors))
                result = execute_native(registry, "agent", current, root / "sources")
                observed = {"value": result["value"], "unit": result["unit"]}
                evidence = ["query=" + result["evidence"]["native_query_id"], "bundle=" + current["bundle_hash"],
                            "independent raw-row oracle; completed only; explicit selector cuts"]
            except ContextError as error:
                observed, evidence = {"error": error.code}, ["Execution denied; no answer delivered."]
            cases["native"].append(_case(identifier, {"value": expected[identifier], "unit": "orders"},
                observed, evidence, round((time.perf_counter() - tick) * 1000, 3)))
        expected_links = {"CHANNEL_ONLINE": "CHANNEL", "PRODUCT_POSTPAID": "PRODUCT", "PERIOD_2026_09": "PERIOD"}
        links = {key: records[key]["spec"]["dimension"] for key in expected_links}
        cases["ontology"].append(_case("ontology", expected_links, links,
            ["Exact approved closure pins validated by resolve/revalidate; all fixture parents empty."]))
        guide = records["G_REVIEWED"]["spec"]
        cases["interpretation"].append(_case("interpretation", True,
            bool(guide["qualifiers"] and guide["caveats"] and demo["native"]["evidence"]["provenance"]),
            guide["qualifiers"] + guide["caveats"]))
        for identifier, query in (("exact", "M_GROSS_ADDS"), ("alias", "new completed orders"),
                                  ("absent", "nonexistent benchmark token")):
            tick = time.perf_counter()
            result = registry.search("agent", WORKSPACE, query, kind="measure", page_size=100)
            returned = {item["id"] for item in result["results"]}
            relevant = set(benchmark["retrieval"][identifier])
            counts = {"hits": len(returned & relevant), "returned": len(returned), "relevant": len(relevant)}
            for key in ("retrieval_precision", "retrieval_recall"):
                case = _case(identifier, {"hits": len(relevant), "returned": len(relevant), "relevant": len(relevant)},
                    counts, ["query=" + query, "returned=" + ",".join(sorted(returned)),
                             "judged_relevant=" + ",".join(sorted(relevant))],
                    round((time.perf_counter() - tick) * 1000, 3))
                cases[key].append(case)
        for fmt in ("json", "yaml", "markdown"):
            tick = time.perf_counter()
            approved = registry.get_record("agent", WORKSPACE, "M_GROSS_ADDS")
            document = export_document(approved, fmt)
            parsed = parse_document(document, fmt)
            cases["formats"].append(_case(fmt, _digest(approved), _digest(parsed),
                ["Approved record exported and parsed; narrative compared exactly."],
                round((time.perf_counter() - tick) * 1000, 3)))
        attempts = [
            ("unknown_actor", lambda: registry.resolve("unknown", WORKSPACE, "M_GROSS_ADDS", ["PERIOD_2026_09"])),
            ("missing_period", lambda: registry.resolve("agent", WORKSPACE, "M_GROSS_ADDS", [])),
            ("cross_dimension", lambda: registry.resolve("agent", WORKSPACE, "M_GROSS_ADDS",
                [{"dimension": "CHANNEL", "member": "PRODUCT_POSTPAID"}, "PERIOD_2026_09"])),
            ("native_authority", lambda: execute_native(_NoSourceAuthority(registry), "agent", bundle, root / "sources")),
        ]
        for identifier, action in attempts:
            tick = time.perf_counter()
            try:
                action()
                denied, evidence = False, "UNEXPECTED DELIVERY"
            except ContextError as error:
                denied, evidence = True, "denied=" + error.code
            cases["security"].append(_case(identifier, True, denied, [evidence],
                round((time.perf_counter() - tick) * 1000, 3)))
        rows = registry.db.execute("SELECT state,submitter,reviewer,revoked FROM c_records WHERE workspace=?", (WORKSPACE,)).fetchall()
        cases["review"].append(_case("review", True, len(rows) == 11 and all(
            row["state"] == "approved" and row["submitter"] != row["reviewer"] and not row["revoked"] for row in rows),
            ["Distinct fixture roles; simulated approval only."]))
    cases["human_semantics"] = [_missing_case("human_semantics")]
    expires = _time(source["spec"]["checked_at"]) + timedelta(seconds=source["spec"]["freshness_seconds"])
    config = {"schema": SCHEMA + ".readback", "database": "context.sqlite3", "sources": "sources",
              "principals": "principals.json", "bundle": bundle,
              "files": {path: _file_hash(root / path) for path in
                  ["context.sqlite3", "sources/orders.json", "sources/domain.txt", "principals.json", "benchmark.json"]
                  + ["records/" + key + ".json" for key in sorted(list(records) + [item["id"] for item in extra])]},
              "code": {name: _file_hash(Path(__file__).with_name(name)) for name in CODE_FILES}}
    _write_json(root / "readback.json", config)
    report = {"schema": SCHEMA, "run_id": root.name, "evaluated_at": _stamp(_now()),
        "benchmark": {"id": BENCHMARK_ID, "revision": BENCHMARK_REVISION,
            "sha256": _file_hash(root / "benchmark.json"), "case_count": sum(len(value[3]) for value in CHECKS.values())},
        "snapshot": {"catalog_revision": bundle["catalog_revision"], "context_sha256": bundle["bundle_hash"],
                     "source_sha256": _file_hash(root / "sources" / "orders.json")},
        "dataset": {"id": "synthetic-completed-orders", "revision": "1",
                    "sha256": _file_hash(root / "sources" / "orders.json"), "record_count": len(facts), "synthetic": True},
        "evaluator": {"id": "prefrontal.context_evaluation", "version": "1",
                      "sha256": _file_hash(Path(__file__))},
        "approval": {"status": "simulated", "description": "Distinct local fixture roles; no actual human semantic approval."},
        "currentness": {"status": "current", "checked_at": _stamp(_now()), "expires_at": _stamp(expires), "reasons": []},
        "checks": [_summarize(key, cases[key]) for key in CHECKS], "model_comparison": _model_comparison(),
        "runtime": {"elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
                    "model_calls": 0, "network_calls": 0, "model_api_cost": None,
                    "python": platform.python_version(), "sqlite": sqlite3.sqlite_version},
        "binding": {"config_sha256": _file_hash(root / "readback.json")},
        "limits": ["Only named synthetic deterministic checks; no blended quality score.",
                   "Layer coverage is bounded to this benchmark, not whole-domain correctness.",
                   "No model executions, enterprise authentication or independent human semantic approval."]}
    _gates(report)
    path = root / "evaluation.json"
    _write_json(path, report)
    return {"report_path": str(path.resolve()), "report": report}


class _NoSourceAuthority:
    """Trusted negative probe changes no principal file or stored authority."""
    def __init__(self, registry):
        self.registry = registry

    def revalidate(self, actor, bundle):
        return self.registry.revalidate(actor, bundle)

    def authorize_source(self, actor, binding, workspace=None):
        # Exercise the actual independent authority method using a consumer-only
        # read-only registry view; original configuration is never rewritten.
        people = copy.deepcopy(self.registry.principals())
        people[actor]["source_bindings"] = []
        with _ReadOnlyRegistry(self.registry.db.execute("PRAGMA database_list").fetchone()[2],
                               self.registry.root, people) as view:
            return view.authorize_source(actor, binding, workspace)


def _validate(report):
    if not isinstance(report, dict) or report.get("schema") != SCHEMA:
        raise ValueError("schema")
    _time(report["evaluated_at"])
    _time(report["currentness"]["expires_at"])
    if _time(report["currentness"]["expires_at"]) <= _time(report["evaluated_at"]):
        raise ValueError("expiry precedes evaluation")
    if (report["benchmark"]["case_count"] != sum(len(value[3]) for value in CHECKS.values())
            or type(report["snapshot"]["catalog_revision"]) is not int
            or report["snapshot"]["catalog_revision"] < 1
            or report["dataset"]["synthetic"] is not True
            or type(report["dataset"]["record_count"]) is not int
            or report["dataset"]["record_count"] != 6
            or report["evaluator"]["id"] != "prefrontal.context_evaluation"
            or report["evaluator"]["version"] != "1"):
        raise ValueError("snapshot metadata")
    if report["approval"]["status"] != "simulated":
        raise ValueError("approval claim")
    if report["model_comparison"] != _model_comparison():
        raise ValueError("unmatched model comparison")
    if report["runtime"]["model_calls"] != 0 or report["runtime"]["network_calls"] != 0 or report["runtime"]["model_api_cost"] is not None:
        raise ValueError("unobserved execution/cost")
    elapsed = report["runtime"]["elapsed_ms"]
    if type(elapsed) not in (int, float) or elapsed < 0 or not math.isfinite(elapsed):
        raise ValueError("runtime timing")
    supplied = report["checks"]
    if not isinstance(supplied, list) or len(supplied) > len(CHECKS):
        raise ValueError("check bound")
    found = {}
    for check in supplied:
        key = check["id"]
        if key not in CHECKS or key in found:
            raise ValueError("duplicate/unknown check")
        expected_ids = CHECKS[key][3]
        case_map = {}
        if not isinstance(check["cases"], list) or len(check["cases"]) > len(expected_ids):
            raise ValueError("case bound")
        for case in check["cases"]:
            if case["id"] not in expected_ids or case["id"] in case_map:
                raise ValueError("duplicate/unknown case")
            if case["status"] not in {"measured", "failed", "missing"}:
                raise ValueError("case status")
            if case["status"] == "missing":
                if case["expected"] is not None or case["observed"] is not None:
                    raise ValueError("missing value")
            elif case["status"] != ("measured" if _canonical(case["expected"]) == _canonical(case["observed"]) else "failed"):
                raise ValueError("false pass")
            if case["status"] != "missing":
                if key in {"source", "interpretation", "security", "review"} and case["expected"] is not True:
                    raise ValueError("changed expected assertion")
                if key == "human_semantics":
                    raise ValueError("human execution not implemented")
                if key == "ontology" and case["expected"] != {
                        "CHANNEL_ONLINE": "CHANNEL", "PRODUCT_POSTPAID": "PRODUCT", "PERIOD_2026_09": "PERIOD"}:
                    raise ValueError("ontology expectation")
                if key == "native" and (set(case["expected"]) != {"value", "unit"}
                        or type(case["expected"]["value"]) is not int or case["expected"]["value"] < 0
                        or case["expected"]["unit"] != "orders"):
                    raise ValueError("native expectation")
                if key.startswith("retrieval_"):
                    for field in ("expected", "observed"):
                        counts = case[field]
                        if (not isinstance(counts, dict) or set(counts) != {"hits", "returned", "relevant"}
                                or any(type(value) is not int or value < 0 or value > 100 for value in counts.values())
                                or counts["hits"] > min(counts["returned"], counts["relevant"])):
                            raise ValueError("retrieval counts")
            if not isinstance(case["evidence"], list) or any(not isinstance(item, str) for item in case["evidence"]):
                raise ValueError("case evidence")
            elapsed = case["elapsed_ms"]
            if elapsed is not None and (type(elapsed) not in (float, int) or elapsed < 0 or not math.isfinite(elapsed)):
                raise ValueError("timing")
            case_map[case["id"]] = case
        completed = [case_map.get(identifier, _missing_case(identifier)) for identifier in expected_ids]
        normalized = _summarize(key, completed)
        # Recompute summaries: omitted rows cannot narrow planned denominators.
        found[key] = normalized
    report["checks"] = [found.get(key, _summarize(key, [_missing_case(identifier) for identifier in value[3]]))
                        for key, value in CHECKS.items()]


def load_evaluation(report_path):
    """Validate a bounded report and recompute authority/currentness without writes.

    Missing/malformed reports return an explicit not-evaluated envelope. Valid
    historical measurements remain visible when their current authority is stale.
    Operator-owned reports/configuration are local evidence, not signed attestations.
    """
    try:
        path = Path(report_path).resolve()
        report = _read_json(path)
        _validate(report)
    except (OSError, ValueError, TypeError, KeyError, RecursionError, OverflowError):
        return _empty("Report missing, unreadable or invalid.")
    reasons = []
    try:
        root = path.parent
        config_path = root / "readback.json"
        if _file_hash(config_path) != report["binding"]["config_sha256"]:
            raise ValueError("Readback configuration changed.")
        config = _read_json(config_path)
        if config["schema"] != SCHEMA + ".readback" or set(config["code"]) != set(CODE_FILES):
            raise ValueError("Readback contract changed.")
        for name, expected_hash in config["code"].items():
            if _file_hash(Path(__file__).with_name(name)) != expected_hash:
                reasons.append("Evaluator implementation changed: " + name)
        for name, expected_hash in config["files"].items():
            if _file_hash(_local(root, name)) != expected_hash:
                reasons.append("Bound evidence changed: " + name)
        benchmark_path = root / "benchmark.json"
        benchmark = _read_json(benchmark_path)
        if (report["benchmark"]["id"] != BENCHMARK_ID or report["benchmark"]["revision"] != BENCHMARK_REVISION
                or report["benchmark"]["sha256"] != _file_hash(benchmark_path)
                or benchmark["required_checks"] != {key: value[3] for key, value in CHECKS.items()}):
            reasons.append("Benchmark revision/content changed.")
        # A caller cannot convert a wrong measurement into a pass by changing
        # only its expected answer. The oracle is pinned in benchmark evidence.
        if report["benchmark"]["sha256"] == _file_hash(benchmark_path):
            oracle = {case["id"]: case["expected"] for case in benchmark["native_cases"]}
            for check in report["checks"]:
                for case in check["cases"]:
                    if case["status"] == "missing":
                        continue
                    if check["id"] == "native" and case["expected"] != {"value": oracle[case["id"]], "unit": "orders"}:
                        return _empty("Report expected answer differs from pinned benchmark.")
                    if check["id"].startswith("retrieval_"):
                        count = len(benchmark["retrieval"][case["id"]])
                        if case["expected"] != {"hits": count, "returned": count, "relevant": count}:
                            return _empty("Report retrieval judgments differ from pinned benchmark.")
                        if case["observed"]["relevant"] != count:
                            return _empty("Report observed relevant-set size differs from pinned judgments.")
                    if check["id"] == "formats":
                        measure = next(entry["record"] for entry in config["bundle"]["records"]
                                       if entry["record"]["id"] == "M_GROSS_ADDS")
                        if case["expected"] != _digest(measure):
                            return _empty("Report format expectation differs from pinned approved record.")
        if report["evaluator"]["sha256"] != config["code"]["context_evaluation.py"]:
            raise ValueError("evaluator identity")
        if (report["dataset"]["id"] != "synthetic-completed-orders" or report["dataset"]["revision"] != "1"
                or report["dataset"]["sha256"] != config["files"]["sources/orders.json"]
                or report["dataset"]["sha256"] != report["snapshot"]["source_sha256"]):
            return _empty("Report dataset identity differs from pinned source.")
        database = _local(root, config["database"])
        sources = _local(root, config["sources"])
        principals = _local(root, config["principals"])
        with _ReadOnlyRegistry(database, sources, lambda: load_principals(principals)) as registry:
            current = registry.revalidate("agent", config["bundle"])
            registry.authorize_source("agent", "synthetic-orders", WORKSPACE)
            if current["bundle_hash"] != report["snapshot"]["context_sha256"]:
                reasons.append("Context snapshot changed.")
            if current["catalog_revision"] != report["snapshot"]["catalog_revision"]:
                reasons.append("Catalog revision changed.")
        if _file_hash(root / "sources" / "orders.json") != report["snapshot"]["source_sha256"]:
            reasons.append("Source snapshot changed.")
    except (OSError, ValueError, TypeError, KeyError, ContextError, sqlite3.Error, RecursionError, StopIteration):
        reasons.append("Current authority or bound evidence unavailable/changed.")
    now = _now()
    if now >= _time(report["currentness"]["expires_at"]) or now < _time(report["evaluated_at"]):
        reasons.append("Evaluation evidence expired or evaluation time is in the future.")
    report["currentness"].update(status="stale" if reasons else "current", checked_at=_stamp(now), reasons=reasons)
    _gates(report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", default=".validation/context-evaluation")
    args = parser.parse_args(argv)
    result = run_evaluation(args.output_root)
    print(json.dumps({"report_path": result["report_path"]}, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
