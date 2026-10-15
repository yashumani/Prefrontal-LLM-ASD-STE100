"""Three deterministic clients using only public JSON and source-service ports."""

from .context_pilot import ContextError
from .sample_domain import REQUEST


def consume(kind, context_port, source_port):
    if kind not in {"agent", "chatbot", "workflow"}:
        raise ContextError("unknown_consumer")
    response = context_port(kind, dict(REQUEST))
    if not response["ok"]:
        raise ContextError(response["error"])
    bundle = response["context"]
    # JSON serialization is part of the public boundary; no registry objects cross it.
    result = source_port(kind, bundle, context_port)
    if kind == "agent":
        output = {"observation": result, "proposed_next_step": "request owner review"}
    elif kind == "chatbot":
        output = "September 2026 net revenue: USD {}. Synthetic data.".format(result["value"])
    else:
        output = {"rule": "net revenue >= USD 3000", "matched": result["value_cents"] >= 300000,
                  "action": "record local result"}
    return {"consumer": kind, "context": bundle, "result": result, "output": output}
