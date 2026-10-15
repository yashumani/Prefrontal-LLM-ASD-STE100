"""A separate toy source service. Native query permissions remain source-owned."""

import hashlib
import json
import sqlite3
from decimal import Decimal
from pathlib import Path

from .context_pilot import ContextError, digest
from .sample_domain import METRIC, REQUEST, WORKSPACE


class NativeSales:
    def __init__(self, source_root):
        self.root = Path(source_root)
        # Deliberately separate from context permissions.
        self.allowed = {"agent", "chatbot", "workflow"}

    def query(self, actor, bundle, context_port):
        if actor not in self.allowed:
            raise ContextError("source_access_denied")
        # A bundle is a use-time snapshot, never a reusable permission token.
        checked = context_port(actor, dict(REQUEST))
        if not checked["ok"]:
            raise ContextError(checked["error"])
        if checked["context"]["bundle_hash"] != bundle.get("bundle_hash"):
            raise ContextError("context_changed")
        content = {key: value for key, value in bundle.items() if key != "bundle_hash"}
        if digest(content) != bundle["bundle_hash"]:
            raise ContextError("integrity_failure")
        records = {item["record"]["id"]: item["record"] for item in bundle["records"]}
        metric = records[METRIC]
        if metric["content"].get("native_query") != "net_revenue.sql":
            raise ContextError("query_binding_mismatch")
        # The native service owns these paths and executes its own source query.
        try:
            data_bytes = (self.root / "orders.json").read_bytes()
            sql_bytes = (self.root / "net_revenue.sql").read_bytes()
        except OSError:
            raise ContextError("source_unavailable") from None
        bindings = {e["path"]: e["sha256"] for b in records.values() for e in b["evidence"]}
        for name, raw in (("orders.json", data_bytes), ("net_revenue.sql", sql_bytes)):
            if hashlib.sha256(raw).hexdigest() != bindings.get(name):
                raise ContextError("stale_source")
        if metric["content"].get("native_revision") != bindings.get("net_revenue.sql"):
            raise ContextError("query_binding_mismatch")
        try:
            data = json.loads(data_bytes)
        except (ValueError, UnicodeError):
            raise ContextError("invalid_source_data") from None
        if not isinstance(data, dict):
            raise ContextError("invalid_source_data")
        if (data.get("workspace") != WORKSPACE or data.get("period") != bundle["period"]
                or data.get("unit") != "USD cents" or bundle["unit"] != "USD"):
            raise ContextError("source_scope_mismatch")
        orders = data.get("orders", [])
        fields = ("gross_cents", "discount_cents", "return_cents")
        if (not isinstance(orders, list) or not orders
                or any(not isinstance(order, dict)
                       or set(order) != {"id", "status", *fields}
                       or not isinstance(order["id"], str) or not order["id"]
                       or order["status"] not in ("completed", "cancelled")
                       for order in orders)
                or len({order["id"] for order in orders}) != len(orders)):
            raise ContextError("invalid_source_data")
        if any(type(order[field]) is not int or not 0 <= order[field] <= 9223372036854775807
               for order in orders for field in fields):
            raise ContextError("invalid_source_data")
        with sqlite3.connect(":memory:") as db:
            db.execute("CREATE TABLE orders(id TEXT, status TEXT, gross_cents INTEGER,"
                       "discount_cents INTEGER, return_cents INTEGER)")
            db.executemany("INSERT INTO orders VALUES(?,?,?,?,?)", [
                (o["id"], o["status"], o["gross_cents"], o["discount_cents"], o["return_cents"])
                for o in orders])
            db.execute("PRAGMA query_only=ON")
            ticks = iter(range(1000))
            db.set_progress_handler(lambda: next(ticks, None) is None, 1000)
            try:
                rows = db.execute(sql_bytes.decode("utf-8")).fetchall()
                if len(rows) != 1 or len(rows[0]) != 1:
                    raise ContextError("invalid_query_result")
                value = rows[0][0]
            except (sqlite3.Error, UnicodeError):
                raise ContextError("invalid_native_query") from None
        if type(value) is not int:
            raise ContextError("invalid_query_result")
        return {"value": str(Decimal(value) / Decimal(100)), "value_cents": value,
                "unit": "USD", "period": bundle["period"],
                "bundle_hash": bundle["bundle_hash"]}
