"""Invented domain and local identities; no real person has approved these records."""

from datetime import timedelta


WORKSPACE = "sales-lab"
METRIC = "metric:net-revenue"
REQUEST = {"operation": "context.get", "workspace": WORKSPACE,
           "metric_id": METRIC, "period": "2026-09", "unit": "USD"}
PRINCIPALS = {
    "domain-owner": {"workspace": WORKSPACE, "roles": ["submitter"]},
    "reviewer": {"workspace": WORKSPACE, "roles": ["reviewer"]},
    "release-owner": {"workspace": WORKSPACE, "roles": ["publisher"]},
    "agent": {"workspace": WORKSPACE, "roles": ["consumer"], "classifications": ["internal"]},
    "chatbot": {"workspace": WORKSPACE, "roles": ["consumer"], "classifications": ["internal"]},
    "workflow": {"workspace": WORKSPACE, "roles": ["consumer"], "classifications": ["internal"]},
    "outsider": {"workspace": "another-lab", "roles": ["consumer"], "classifications": ["internal"]},
}


def records(registry, now, versions=None):
    versions = versions or {"data:orders": 1, METRIC: 1,
                            "ontology:net-sales": 1, "interpretation:net-revenue": 1}

    def reference(record_id):
        return {"id": record_id, "version": versions[record_id]}

    def record(record_id, layer, claim, evidence, dependencies, content):
        return {"id": record_id, "version": versions[record_id], "workspace": WORKSPACE,
                "layer": layer, "owner": "domain-owner", "claim": claim,
                "classification": "internal", "valid_from": now.isoformat(),
                "valid_until": (now + timedelta(days=30)).isoformat(),
                "evidence": [registry.evidence(path) for path in evidence],
                "dependencies": [reference(dep) for dep in dependencies], "content": content}

    return [
        record("data:orders", "data", "Synthetic order snapshot for September 2026.",
               ["orders.json"], [], {"source": "orders.json", "unit": "USD cents",
                "period": "2026-09", "grain": "one row per order"}),
        record(METRIC, "metric", "Net revenue excludes cancelled orders.",
               ["net_revenue.sql", "domain-policy.md"], ["data:orders"],
               {"unit": "USD", "period": "2026-09", "grain": "one row per order",
                "population": "completed orders", "exceptions": "cancelled orders excluded",
                "formula": "gross_cents - discount_cents - return_cents",
                "native_query": "net_revenue.sql",
                "native_revision": registry.source_hash("net_revenue.sql")}),
        record("ontology:net-sales", "ontology", "Net sales names the net-revenue concept.",
               ["domain-policy.md"], ["data:orders"],
               {"aliases": ["net sales"], "concept": METRIC}),
        record("interpretation:net-revenue", "interpretation",
               "Net revenue alone does not establish profitability or explain changes.",
               ["domain-policy.md"], [METRIC, "ontology:net-sales"],
               {"assumptions": ["synthetic orders", "single currency", "September 2026"],
                "limits": ["no profitability conclusion", "no trend explanation"]}),
    ]


def submit_and_review(registry, bodies):
    for body in bodies:
        receipt = registry.submit("domain-owner", body)
        registry.approve("reviewer", WORKSPACE, body["id"], body["version"], receipt)
    return {body["id"]: body["version"] for body in bodies}
