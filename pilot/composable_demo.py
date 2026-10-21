"""Reproducible offline composition fixture; approvals are explicitly simulated."""

import argparse
import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .composable_model import SCHEMA, validate_record
from .composable_formats import export_document
from .composable_registry import ComposableRegistry
from .composable_native import execute_native, consumer_outputs


WORKSPACE = "composable-demo"
SELECTORS = ["CHANNEL_ONLINE", "PRODUCT_POSTPAID", "PERIOD_2026_09"]
FACTS = [
    {"order": "o1", "period": "2026-09", "channel": "online", "product": "postpaid", "status": "completed"},
    {"order": "o2", "period": "2026-09", "channel": "online", "product": "postpaid", "status": "completed"},
    {"order": "o3", "period": "2026-09", "channel": "online", "product": "prepaid", "status": "completed"},
    {"order": "o4", "period": "2026-09", "channel": "store", "product": "postpaid", "status": "completed"},
    {"order": "o5", "period": "2026-08", "channel": "online", "product": "postpaid", "status": "completed"},
    {"order": "o6", "period": "2026-09", "channel": "online", "product": "postpaid", "status": "cancelled"},
]


def principal_fixture():
    def person(role):
        return {"workspace": WORKSPACE, "roles": [role], "classifications": ["internal"],
                "source_bindings": ["synthetic-orders"]}
    return {"submitter": person("submitter"), "reviewer": person("reviewer"),
            "releaser": person("releaser"), "agent": person("consumer"),
            "chatbot": person("consumer"), "workflow": person("consumer")}


def demo_records(source_root, now=None):
    """Create proposals referring to existing synthetic files; no implicit approval."""
    root = Path(source_root)
    now = now or datetime.now(timezone.utc)
    stamp = now.isoformat().replace("+00:00", "Z")
    provenance = lambda path: [{"path": path, "sha256": hashlib.sha256((root / path).read_bytes()).hexdigest()}]
    def record(identifier, kind, spec, dependencies=(), path="domain.txt", name=None, aliases=()):
        layers = {"source": "data", "measure": "metric", "dimension": "ontology",
                  "member": "ontology", "guidance": "interpretation"}
        return validate_record({"schema": SCHEMA, "id": identifier, "version": 1,
            "layer": layers[kind], "kind": kind, "name": name or identifier.replace("_", " ").title(),
            "aliases": list(aliases), "description": "Illustrative synthetic " + kind + ".",
            "narrative": "Offline example only. Exact-version approval is simulated by distinct fixture roles.",
            "owner": "synthetic-domain-owner", "classification": "internal",
            "valid_from": "2026-01-01T00:00:00Z", "valid_until": None,
            "provenance": provenance(path),
            "dependencies": [{"id": item, "version": 1} for item in dependencies], "spec": spec})
    records = [record("SOURCE_ORDERS", "source", {"binding": "synthetic-orders", "grain": ["order"],
        "freshness_seconds": 86400, "checked_at": stamp,
        "dimensions": {"CHANNEL": "channel", "PRODUCT": "product", "PERIOD": "period"}}, path="orders.json")]
    for dimension in ("CHANNEL", "PRODUCT", "PERIOD"):
        records.append(record(dimension, "dimension", {"value_type": "period" if dimension == "PERIOD" else "text"}))
    for identifier, dimension, value in (("CHANNEL_ONLINE", "CHANNEL", "online"),
            ("PRODUCT_POSTPAID", "PRODUCT", "postpaid"), ("PERIOD_2026_09", "PERIOD", "2026-09")):
        records.append(record(identifier, "member", {"dimension": dimension, "value": value, "parents": []},
                              dependencies=[dimension]))
    records.append(record("G_REVIEWED", "guidance", {"qualifiers": ["Completed synthetic orders only."],
        "caveats": ["Illustrative gross adds count; not a production telecom definition or causal explanation."]}))
    records.append(record("M_GROSS_ADDS", "measure", {"source": "SOURCE_ORDERS", "aggregation": "count",
        "expression": "count_completed_orders", "required_dimensions": ["PERIOD"],
        "optional_dimensions": ["CHANNEL", "PRODUCT"], "guidance": ["G_REVIEWED"]},
        dependencies=["SOURCE_ORDERS", "PERIOD", "CHANNEL", "PRODUCT", "G_REVIEWED"],
        name="Gross adds", aliases=["new completed orders"]))
    return records


def run_demo(output_root):
    """Create a unique new run and actually execute all three consumer fixtures."""
    parent = Path(output_root)
    parent.mkdir(parents=True, exist_ok=True)
    directory = parent / ("run-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ-") + uuid.uuid4().hex[:8])
    directory.mkdir(exist_ok=False)
    sources, record_root = directory / "sources", directory / "records"
    sources.mkdir()
    record_root.mkdir()
    (sources / "orders.json").write_text(json.dumps(FACTS, indent=2) + "\n", encoding="utf-8")
    (sources / "domain.txt").write_text("Synthetic completed-order count. Required period; optional channel/product.\n"
        "No live model, connector, enterprise identity or actual human approval is used.\n", encoding="utf-8")
    principals_path = directory / "principals.json"
    principals_path.write_text(json.dumps(principal_fixture(), indent=2) + "\n", encoding="utf-8")
    records = demo_records(sources)
    for record in records:
        (record_root / (record["id"] + ".json")).write_text(export_document(record, "json"), encoding="utf-8")
    database = directory / "context.sqlite3"
    # A separate submitter, reviewer and releaser are fixture simulations only.
    from .composable_cli import load_principals
    with ComposableRegistry(database, sources, lambda: load_principals(principals_path)) as registry:
        hashes = registry.submit_batch("submitter", records)
        for record, content_hash in zip(records, hashes):
            registry.review("reviewer", WORKSPACE, record["id"], record["version"], content_hash, "approved")
        revision = registry.publish("releaser", WORKSPACE, [{"id": record["id"], "version": 1} for record in records])
        consumers = {}
        native = None
        bundle = None
        for actor in ("agent", "chatbot", "workflow"):
            current_bundle = registry.resolve(actor, WORKSPACE, "M_GROSS_ADDS", SELECTORS)
            result = execute_native(registry, actor, current_bundle, sources)
            consumers[actor] = consumer_outputs(result)[actor]
            if actor == "agent":
                native, bundle = result, current_bundle
    report = {"contract": "prefrontal.composable.demo.v1", "run_dir": str(directory.resolve()),
              "database": str(database.resolve()), "source_root": str(sources.resolve()),
              "principals": str(principals_path.resolve()), "catalog_revision": revision,
              "bundle": bundle, "native": native, "consumers": consumers,
              "approval_simulation": "distinct local submitter/reviewer/releaser fixtures",
              "live_model_calls": 0, "network_calls": 0, "native_expected_count": 2}
    (directory / "result.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", default=".validation/composable-demo")
    args = parser.parse_args(argv)
    print(json.dumps(run_demo(args.output_root), allow_nan=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
