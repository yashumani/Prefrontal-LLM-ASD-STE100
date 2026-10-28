"""Operator-bound local JSON-lines port. Principal names are not authentication.

The process owner selects the database, source root and principal configuration.
Request JSON cannot select an actor or grant. No network listener is provided.
"""

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

from .composable_model import ContextError, MAX_BATCH_RECORDS, MAX_RECORD_BYTES, strict_json, validate_record, digest
from .composable_formats import parse_document, export_document
from .composable_registry import ComposableRegistry


MAX_REQUEST_BYTES = max(MAX_RECORD_BYTES * MAX_BATCH_RECORDS + 65536, 1048576)
MAX_PRINCIPALS_BYTES = 65536
_ID = re.compile(r"[A-Z][A-Z0-9_]{1,95}\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")
OPERATIONS = {
    "context.search": ({"workspace", "query"}, {"layer", "kind", "dimension", "member", "page_size", "cursor"}),
    "context.resolve": ({"workspace", "measure", "selectors"}, set()),
    "context.revalidate": ({"bundle"}, set()),
    "context.validate": ({"record"}, set()),
    "context.export": ({"workspace", "id", "format"}, {"version"}),
    "record.submit": ({"workspace", "record"}, set()),
    "record.importbatch": ({"workspace", "documents"}, set()),
    "record.review": ({"workspace", "id", "version", "expected_hash", "decision"}, set()),
    "release.publish": ({"workspace", "records"}, {"expected_revision"}),
    "record.revoke": ({"workspace", "id", "version"}, set()),
}


def load_principals(path):
    """Reload bounded operator configuration; never return exception contents."""
    try:
        with Path(path).open("rb") as stream:
            raw = stream.read(MAX_PRINCIPALS_BYTES + 1)
        value = strict_json(raw.decode("utf-8"), max_bytes=MAX_PRINCIPALS_BYTES)
        if not isinstance(value, dict) or not value or len(value) > 128:
            raise ValueError()
        for subject, principal in value.items():
            if (not isinstance(subject, str) or not subject.strip() or len(subject) > 100
                    or any(ord(c) < 32 for c in subject)
                    or not isinstance(principal, dict)
                    or set(principal) != {"workspace", "roles", "classifications", "source_bindings"}
                    or not isinstance(principal["workspace"], str) or not principal["workspace"].strip()
                    or len(principal["workspace"]) > 100):
                raise ValueError()
            for key, allowed in (("roles", {"submitter", "reviewer", "releaser", "consumer"}),
                                 ("classifications", {"public", "internal", "restricted"})):
                entries = principal[key]
                if (not isinstance(entries, list) or len(entries) != len(set(entries))
                        or any(not isinstance(item, str) or item not in allowed for item in entries)):
                    raise ValueError()
            bindings = principal["source_bindings"]
            if (not isinstance(bindings, list) or len(bindings) > 128
                    or any(not isinstance(item, str) or not item or len(item) > 128 for item in bindings)
                    or len(bindings) != len(set(bindings))):
                raise ValueError()
        return value
    except (OSError, ValueError, TypeError, UnicodeError, RecursionError, ContextError):
        raise ContextError("access_denied") from None


def _error(code):
    allowed = {"access_denied", "context_unavailable", "invalid_record", "invalid_document",
               "unsupported_format", "invalid_request", "invalid_json", "stale_bundle", "stale_revision",
               "stale_policy", "review_required", "invalid_state", "source_unavailable",
               "source_stale", "source_changed", "unsupported_native_query", "invalid_source",
               "invalid_cursor", "stale_cursor", "storage_unavailable"}
    code = code if code in allowed else "request_failed"
    return {"ok": False, "error": {"code": code, "message": "Request denied."}}


class CLI:
    def __init__(self, database, source_root, principals, principal):
        self.principals_path = Path(principals)
        self.principal = principal
        self.registry = ComposableRegistry(database, source_root, lambda: load_principals(self.principals_path))

    def close(self):
        self.registry.close()

    def execute_line(self, line):
        try:
            request = strict_json(line, max_bytes=MAX_REQUEST_BYTES)
            return {"ok": True, "result": self.handle(request)}
        except ContextError as exc:
            return _error(getattr(exc, "code", "invalid_request"))
        except sqlite3.Error:
            return _error("storage_unavailable")
        except (ValueError, TypeError, KeyError, UnicodeError, RecursionError, OSError, OverflowError):
            return _error("invalid_request")

    def handle(self, request):
        # Even structural validation requires the configured local principal.
        person = self.registry.current_principal(self.principal)
        if not isinstance(request, dict) or request.get("operation") not in OPERATIONS:
            raise ContextError("invalid_request")
        operation = request["operation"]
        required, optional = OPERATIONS[operation]
        keys = set(request) - {"operation"}
        if not required <= keys or not keys <= required | optional:
            raise ContextError("invalid_request")
        fields = {key: value for key, value in request.items() if key != "operation"}
        if "workspace" in fields and fields["workspace"] != person["workspace"]:
            raise ContextError("access_denied")
        if "id" in fields:
            _reference(fields["id"], fields.get("version"))
        if "version" in fields and fields["version"] is None:
            raise ContextError("invalid_request")
        if "expected_hash" in fields and (type(fields["expected_hash"]) is not str or not _HASH.fullmatch(fields["expected_hash"])):
            raise ContextError("invalid_request")
        if "decision" in fields and fields["decision"] not in ("approved", "rejected", "changes_requested"):
            raise ContextError("invalid_request")
        if operation == "release.publish":
            records = fields["records"]
            if type(records) is not list or not 1 <= len(records) <= MAX_BATCH_RECORDS:
                raise ContextError("invalid_request")
            for reference in records:
                if type(reference) is not dict or set(reference) != {"id", "version"}:
                    raise ContextError("invalid_request")
                _reference(reference["id"], reference["version"])
            if "expected_revision" in fields and (type(fields["expected_revision"]) is not int or fields["expected_revision"] < 0):
                raise ContextError("invalid_request")
        actor, registry = self.principal, self.registry
        if operation == "context.search":
            return registry.search(actor, **fields)
        if operation == "context.resolve":
            return registry.resolve(actor, **fields)
        if operation == "context.revalidate":
            return registry.revalidate(actor, fields["bundle"])
        if operation == "context.validate":
            record = validate_record(fields["record"])
            result = registry.validate(actor, record)
            result["structurally_valid"] = True
            result["semantically_approved"] = result.get("approval_state") == "approved"
            return result
        if operation == "context.export":
            selected = registry.get_record(actor, fields["workspace"], fields["id"], fields.get("version"))
            document = export_document(selected, fields["format"])
            current = registry.get_record(actor, fields["workspace"], fields["id"], fields.get("version"))
            if digest(current) != digest(selected):
                raise ContextError("context_unavailable")
            return {"contract": "prefrontal.context.export.v1", "id": selected["id"],
                    "version": selected["version"], "format": fields["format"], "document": document,
                    "content_hash": digest(selected), "provenance": selected["provenance"],
                    "semantic_approval": "approved"}
        if operation == "record.submit":
            record = validate_record(fields["record"])
            content_hash = registry.submit(actor, record)
            return {"id": record["id"], "version": record["version"], "content_hash": content_hash, "state": "proposal"}
        if operation == "record.importbatch":
            documents = fields["documents"]
            if not isinstance(documents, list) or not 1 <= len(documents) <= MAX_BATCH_RECORDS:
                raise ContextError("invalid_request")
            records = []
            for document in documents:
                if not isinstance(document, dict) or set(document) != {"format", "document"}:
                    raise ContextError("invalid_request")
                records.append(parse_document(document["document"], document["format"]))
            hashes = registry.submit_batch(actor, records)
            return {"records": [{"id": record["id"], "version": record["version"], "content_hash": content_hash}
                                for record, content_hash in zip(records, hashes)], "state": "proposal"}
        if operation == "record.review":
            registry.review(actor, fields["workspace"], fields["id"], fields["version"],
                            fields["expected_hash"], fields["decision"])
            return {"reviewed": True, "decision": fields["decision"], "content_hash": fields["expected_hash"]}
        if operation == "release.publish":
            revision = registry.publish(actor, fields["workspace"], fields["records"],
                                        expected_revision=fields.get("expected_revision"))
            return {"catalog_revision": revision}
        registry.revoke(actor, fields["workspace"], fields["id"], fields["version"])
        return {"revoked": True}


def _reference(identifier, version=None):
    if (type(identifier) is not str or not _ID.fullmatch(identifier)
            or version is not None and (type(version) is not int or not 1 <= version <= 9223372036854775807)):
        raise ContextError("invalid_request")


def serve(port, incoming, outgoing):
    """Consume one bounded JSON object per line; drain only an oversized line."""
    while True:
        line = incoming.readline(MAX_REQUEST_BYTES + 2)
        if not line:
            return
        try:
            oversized = len(line.encode("utf-8")) > MAX_REQUEST_BYTES
        except UnicodeError:
            oversized = True
        if oversized:
            while line and not line.endswith("\n"):
                line = incoming.readline(MAX_REQUEST_BYTES + 2)
            response = _error("invalid_request")
        else:
            response = port.execute_line(line)
        outgoing.write(json.dumps(response, ensure_ascii=True, allow_nan=False, separators=(",", ":")) + "\n")
        outgoing.flush()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--principals", required=True)
    parser.add_argument("--principal", required=True)
    args = parser.parse_args(argv)
    try:
        port = CLI(args.database, args.source_root, args.principals, args.principal)
    except (ContextError, OSError, ValueError, sqlite3.Error):
        print(json.dumps(_error("access_denied")), file=sys.stdout)
        return 1
    try:
        serve(port, sys.stdin, sys.stdout)
    finally:
        port.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
