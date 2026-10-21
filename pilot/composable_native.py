"""A bounded, deterministic synthetic count executor; no SQL or model execution."""

import hashlib
from datetime import datetime, timezone
from pathlib import Path

from .composable_model import ContextError, strict_json


MAX_FACT_BYTES = 262144
MAX_FACT_ROWS = 4096
NATIVE_QUERY_ID = "synthetic.completed-orders.count.v1"
DIMENSIONS = {"CHANNEL": "channel", "PRODUCT": "product", "PERIOD": "period"}


def _denied(code="unsupported_native_query"):
    raise ContextError(code)


def _read_facts(source_root, expected_hash):
    root = Path(source_root).resolve()
    path = (root / "orders.json").resolve()
    if root not in path.parents:
        _denied("source_unavailable")
    try:
        with path.open("rb") as stream:
            raw = stream.read(MAX_FACT_BYTES + 1)
        if len(raw) > MAX_FACT_BYTES or hashlib.sha256(raw).hexdigest() != expected_hash:
            _denied("source_changed")
        rows = strict_json(raw.decode("utf-8"), max_bytes=MAX_FACT_BYTES)
    except (OSError, ValueError, UnicodeError):
        _denied("source_unavailable")
    if not isinstance(rows, list) or len(rows) > MAX_FACT_ROWS:
        _denied("invalid_source")
    seen = set()
    for row in rows:
        if (not isinstance(row, dict) or set(row) != {"order", "period", "channel", "product", "status"}
                or any(not isinstance(value, str) or not value or len(value) > 100 for value in row.values())
                or row["order"] in seen or row["channel"] not in {"online", "store"}
                or row["product"] not in {"postpaid", "prepaid"}
                or row["period"] not in {"2026-08", "2026-09"}
                or row["status"] not in {"completed", "cancelled"}):
            _denied("invalid_source")
        seen.add(row["order"])
    return rows


def _source_age(source, clock):
    try:
        checked = datetime.fromisoformat(source["spec"]["checked_at"].replace("Z", "+00:00"))
        now = clock() if clock else datetime.now(timezone.utc)
        age = (now - checked).total_seconds()
        if age < 0 or age > source["spec"]["freshness_seconds"]:
            _denied("source_stale")
        return age
    except (ValueError, TypeError, KeyError):
        _denied("source_stale")


def execute_native(registry, actor, bundle, source_root, *, before_delivery=None, clock=None):
    """Recheck context and independent source authority before read and delivery.

    Only this synthetic source/measure implementation is admitted. Context text
    never becomes executable code. ``before_delivery`` is a trusted test hook.
    """
    current = registry.revalidate(actor, bundle)
    records = {entry["record"]["id"]: entry["record"] for entry in current["records"]}
    measure = records.get(current["measure"]["id"])
    if not measure or measure["kind"] != "measure":
        _denied()
    spec = measure["spec"]
    if (spec.get("aggregation") != "count" or spec.get("expression") != "count_completed_orders"
            or spec.get("required_dimensions") != ["PERIOD"]
            or set(spec.get("optional_dimensions", [])) != {"CHANNEL", "PRODUCT"}):
        _denied()
    source = records.get(spec.get("source"))
    if (not source or source["kind"] != "source" or source["spec"].get("binding") != "synthetic-orders"
            or source["spec"].get("grain") != ["order"] or source["spec"].get("dimensions") != DIMENSIONS):
        _denied()
    for dimension, value_type in (("CHANNEL", "text"), ("PRODUCT", "text"), ("PERIOD", "period")):
        definition = records.get(dimension)
        if (not definition or definition["kind"] != "dimension"
                or definition["spec"] != {"value_type": value_type}):
            _denied()
    selectors = current["selectors"]
    cuts = {}
    for selector in selectors:
        dimension = selector.get("dimension")
        if dimension not in DIMENSIONS or dimension in cuts:
            _denied()
        cuts[dimension] = selector.get("value")
    if "PERIOD" not in cuts:
        _denied()
    registry.authorize_source(actor, "synthetic-orders", current["workspace"])
    _source_age(source, clock)
    hashes = [item["sha256"] for item in source["provenance"] if item["path"] == "orders.json"]
    if len(hashes) != 1:
        _denied("source_unavailable")
    rows = _read_facts(source_root, hashes[0])
    value = sum(1 for row in rows if row["status"] == "completed"
                and all(row[DIMENSIONS[dimension]] == selected for dimension, selected in cuts.items()))
    if before_delivery is not None:
        before_delivery()
    # A validated metadata bundle never grants source execution, nor freezes permission.
    final = registry.revalidate(actor, current)
    registry.authorize_source(actor, "synthetic-orders", final["workspace"])
    if final["bundle_hash"] != current["bundle_hash"]:
        _denied("context_unavailable")
    _read_facts(source_root, hashes[0])
    age = _source_age(source, clock)
    # Source IO is also a boundary: permission can change while reading bytes.
    delivered = registry.revalidate(actor, final)
    registry.authorize_source(actor, "synthetic-orders", delivered["workspace"])
    if delivered["bundle_hash"] != final["bundle_hash"]:
        _denied("context_unavailable")
    final = delivered
    return {"contract": "prefrontal.native.synthetic.v1", "measure": measure["id"], "value": value,
            "unit": "orders", "evidence": {"bundle_hash": final["bundle_hash"],
            "catalog_revision": final["catalog_revision"], "native_query_id": NATIVE_QUERY_ID,
            "source_binding": "synthetic-orders", "source_sha256": hashes[0],
            "provenance": final["provenance"], "selectors": selectors,
            "source_checked_at": source["spec"]["checked_at"], "source_age_seconds": age,
            "context_rechecked_before_delivery": True, "source_authority_rechecked_before_delivery": True}}


def consumer_outputs(result):
    """Three local representations of one computed answer, not deployed agents."""
    common = {"deterministic": True, "value": result["value"], "evidence": result["evidence"]}
    return {"agent": dict(common, role="agent", action="use_evidence"),
            "chatbot": dict(common, role="chatbot", text="Gross adds: %s orders." % result["value"]),
            "workflow": dict(common, role="workflow", event="synthetic_measure_computed")}
