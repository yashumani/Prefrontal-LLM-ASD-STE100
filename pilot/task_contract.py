"""Pure admission checks for bounded, task-scoped model output.

Admission validates the complete original NDJSON stream before returning any
envelope. It grants no authority and performs no registry or external actions.
"""

import json
import math
import re


RESPONSE_CONTRACT = "context.task-result.v2"
MAX_ENVELOPE_BYTES = 8192
MAX_TASKS = 12
MAX_REQUEST_BYTES = 4096
MAX_JSON_DEPTH = 32
_DIGEST = re.compile(r"[a-f0-9]{64}")
_OPERATIONS = {"record.submit", "release.publish", "knowledge.feedback",
               "knowledge.get", "knowledge.health"}
_READ_ONLY = {"knowledge.get", "knowledge.health"}
_FIELDS = {"contract", "task_id", "evidence_id", "status", "summary", "requests",
           "steps", "citations", "missing_evidence"}


class ContractError(ValueError):
    """The entire proposed response is inadmissible; no task was accepted."""


def _fail(message):
    raise ContractError(message)


def _text(value, maximum, label):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        _fail("invalid " + label)
    try:
        value.encode("utf-8")
    except UnicodeError:
        _fail("invalid UTF-8 in " + label)
    return value


def _utf8(value, label):
    try:
        return value.encode("utf-8")
    except UnicodeError:
        _fail("invalid UTF-8 in " + label)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail("duplicate JSON key")
        result[key] = value
    return result


def _constant(value):
    _fail("nonfinite JSON number")


def _float(value):
    result = float(value)
    if not math.isfinite(result):
        _fail("nonfinite JSON number")
    return result


def _check_depth(line):
    depth, quoted, escaped = 0, False, False
    for character in line:
        if quoted:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                quoted = False
        elif character == '"':
            quoted = True
        elif character in "[{":
            depth += 1
            if depth > MAX_JSON_DEPTH:
                _fail("JSON nesting exceeds limit")
        elif character in "]}":
            depth -= 1


def _load(line):
    _check_depth(line)
    try:
        return json.loads(line, object_pairs_hook=_pairs,
                          parse_constant=_constant, parse_float=_float)
    except (TypeError, ValueError, RecursionError) as error:
        if isinstance(error, ContractError):
            raise
        _fail("invalid JSON envelope")


def _request_spans(line):
    """Recover the original request object spelling after strict JSON parsing.

    A decoder walks the known envelope wrappers; request bodies are decoded as
    complete values, so braces and the word 'request' in strings cannot spoof
    the byte check. Whitespace inside each body remains part of its spelling.
    """
    decoder = json.JSONDecoder()

    def skip(index):
        while index < len(line) and line[index] in " \t\r\n":
            index += 1
        return index

    def fields(index):
        index = skip(index) + 1
        while True:
            index = skip(index)
            if line[index] == "}":
                return
            key, index = decoder.raw_decode(line, index)
            index = skip(index) + 1  # Colon was checked by the strict parser.
            start = skip(index)
            value, end = decoder.raw_decode(line, start)
            yield key, start, end, value
            index = skip(end)
            if line[index] == "}":
                return
            index += 1

    for key, start, end, value in fields(0):
        if key != "requests":
            continue
        index = skip(start + 1)
        spans = []
        for _ in value:
            wrapper, wrapper_end = decoder.raw_decode(line, index)
            for field, body_start, body_end, _ in fields(index):
                if field == "request":
                    spans.append(line[body_start:body_end])
            index = skip(wrapper_end)
            if index < end and line[index] == ",":
                index = skip(index + 1)
        return spans
    return []


def _scope(scope):
    if not isinstance(scope, dict):
        _fail("invalid task scope")
    task_id = _text(scope.get("task_id"), 100, "scope task_id")
    evidence_id = scope.get("evidence_id")
    if not isinstance(evidence_id, str) or not _DIGEST.fullmatch(evidence_id):
        _fail("invalid scope evidence_id")
    result = {"task_id": task_id, "evidence_id": evidence_id}
    for name in ("allowed_requests", "allowed_citations"):
        entries = scope.get(name)
        if not isinstance(entries, list) or len(entries) > 64:
            _fail("invalid " + name)
        checked = set()
        for entry in entries:
            if not isinstance(entry, (tuple, list)) or len(entry) != 2:
                _fail("invalid " + name)
            first = _text(entry[0], 100, name)
            second = _text(entry[1], 300, name)
            if name == "allowed_requests" and second not in _OPERATIONS:
                _fail("forbidden scope operation")
            if name == "allowed_citations" and first not in {"source", "record", "observation"}:
                _fail("invalid citation kind in scope")
            checked.add((first, second))
        result[name] = checked
    return result


def _list(value, maximum, label):
    if not isinstance(value, list) or len(value) > maximum:
        _fail("invalid " + label)
    return value


def _envelope(value, line, scope):
    if not isinstance(value, dict) or set(value) != _FIELDS:
        _fail("unexpected envelope fields")
    if value["contract"] != RESPONSE_CONTRACT:
        _fail("wrong response contract")
    if value["task_id"] != scope["task_id"]:
        _fail("wrong task order or identity")
    if value["evidence_id"] != scope["evidence_id"]:
        _fail("task evidence identity mismatch")
    status = value["status"]
    if status not in ("ready", "blocked", "abstain"):
        _fail("invalid status")
    _text(value["summary"], 220, "summary")
    missing = _list(value["missing_evidence"], 12, "missing_evidence")
    for entry in missing:
        _text(entry, 600, "missing evidence")
    requests = _list(value["requests"], 3, "requests")
    if status == "ready" and (missing or not requests):
        _fail("ready requires executable requests and no missing evidence")
    if status in {"blocked", "abstain"} and not missing:
        _fail("blocked or abstain requires missing evidence")
    if status == "abstain" and requests:
        _fail("abstain forbids requests")
    for entry in requests:
        if not isinstance(entry, dict) or set(entry) != {"principal", "mode", "request"}:
            _fail("invalid request wrapper")
        principal = _text(entry["principal"], 100, "principal")
        mode, body = entry["mode"], entry["request"]
        if mode not in ("executable", "draft_only") or not isinstance(body, dict):
            _fail("invalid request mode or body")
        operation = body.get("operation")
        if not isinstance(operation, str) or operation not in _OPERATIONS:
            _fail("forbidden request operation")
        if (principal, operation) not in scope["allowed_requests"]:
            _fail("request principal or operation outside task scope")
        if status == "ready" and mode != "executable":
            _fail("ready requires executable requests")
        if status == "blocked" and mode == "executable" and operation not in _READ_ONLY:
            _fail("blocked mutations must remain draft_only")
        # Match KnowledgeRegistry.dispatch's canonical request spelling too.
        encoded = json.dumps(body, ensure_ascii=True, sort_keys=True,
                             separators=(",", ":"), allow_nan=False)
        if len(_utf8(encoded, "request")) > MAX_REQUEST_BYTES:
            _fail("canonical request exceeds byte limit")
    for spelling in _request_spans(line):
        if len(_utf8(spelling, "request")) > MAX_REQUEST_BYTES:
            _fail("original request exceeds byte limit")
    for step in _list(value["steps"], 6, "steps"):
        if not isinstance(step, dict) or set(step) != {"owner", "action", "acceptance"}:
            _fail("invalid step fields")
        _text(step["owner"], 100, "step owner")
        _text(step["action"], 600, "step action")
        _text(step["acceptance"], 600, "step acceptance")
    for citation in _list(value["citations"], 16, "citations"):
        if not isinstance(citation, dict) or set(citation) != {"kind", "id"}:
            _fail("invalid citation fields")
        kind = citation["kind"]
        if kind not in ("source", "record", "observation"):
            _fail("invalid citation kind")
        identity = _text(citation["id"], 300, "citation id")
        if (kind, identity) not in scope["allowed_citations"]:
            _fail("citation outside task scope")


def validate_stream(text, task_scopes):
    """Return all envelopes only if the entire original stream is admissible.

    ``task_scopes`` is ordered and binds each task to an exact evidence digest,
    a list of permitted ``(principal, operation)`` pairs, and a list of permitted
    ``(kind, citation_id)`` pairs. This validates proposals, never dispatches them.
    """
    if not isinstance(text, str):
        _fail("response must be text")
    if not isinstance(task_scopes, list) or not 1 <= len(task_scopes) <= MAX_TASKS:
        _fail("invalid task count")
    scopes = [_scope(scope) for scope in task_scopes]
    if len({scope["task_id"] for scope in scopes}) != len(scopes):
        _fail("duplicate expected task")
    if len(_utf8(text, "response")) > len(scopes) * (MAX_ENVELOPE_BYTES + 1):
        _fail("response stream exceeds byte limit")
    # NDJSON uses LF. Reject CR/Unicode line separators instead of normalizing
    # their spelling and accidentally changing the original-byte contract.
    if "\r" in text or any(character in text for character in ("\u0085", "\u2028", "\u2029")):
        _fail("unsupported line separator")
    lines = text.split("\n")
    if lines[-1] == "":
        lines.pop()
    if len(lines) != len(scopes) or any(not line.strip() for line in lines):
        _fail("expected exactly one nonblank line per task")
    outputs = []
    for line, scope in zip(lines, scopes):
        if len(_utf8(line, "envelope")) > MAX_ENVELOPE_BYTES:
            _fail("original envelope exceeds byte limit")
        envelope = _load(line)
        _envelope(envelope, line, scope)
        outputs.append(envelope)
    return outputs


def response_schema():
    """Return the structural JSON Schema for one envelope.

    Original UTF-8 limits, complete-stream admission, and caller-specific
    principal/evidence/citation bindings additionally require validate_stream.
    """
    def string(maximum):
        return {"type": "string", "minLength": 1, "maxLength": maximum,
                "pattern": "\\S"}

    def object_schema(properties):
        return {"type": "object", "additionalProperties": False,
                "required": list(properties), "properties": properties}

    request = object_schema({
        "principal": string(100),
        "mode": {"enum": ["executable", "draft_only"]},
        "request": {"type": "object", "required": ["operation"],
                    "properties": {"operation": {"enum": sorted(_OPERATIONS)}}},
    })
    schema = object_schema({
        "contract": {"const": RESPONSE_CONTRACT},
        "task_id": string(100),
        "evidence_id": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
        "status": {"enum": ["ready", "blocked", "abstain"]},
        "summary": string(220),
        "requests": {"type": "array", "maxItems": 3, "items": request},
        "steps": {"type": "array", "maxItems": 6, "items": object_schema({
            "owner": string(100), "action": string(600), "acceptance": string(600)})},
        "citations": {"type": "array", "maxItems": 16, "items": object_schema({
            "kind": {"enum": ["source", "record", "observation"]}, "id": string(300)})},
        "missing_evidence": {"type": "array", "maxItems": 12, "items": string(600)},
    })
    schema["allOf"] = [
        {"if": {"properties": {"status": {"const": "ready"}}},
         "then": {"properties": {
             "missing_evidence": {"maxItems": 0},
             "requests": {"minItems": 1, "items": {
                 "properties": {"mode": {"const": "executable"}}}},
         }}},
        {"if": {"properties": {"status": {"const": "blocked"}}},
         "then": {"properties": {
             "missing_evidence": {"minItems": 1},
             "requests": {"items": {
                 "if": {"properties": {"mode": {"const": "executable"}}},
                 "then": {"properties": {"request": {"properties": {
                     "operation": {"enum": sorted(_READ_ONLY)}}}}},
             }},
         }}},
        {"if": {"properties": {"status": {"const": "abstain"}}},
         "then": {"properties": {"missing_evidence": {"minItems": 1},
                                 "requests": {"maxItems": 0}}}},
    ]
    return schema
