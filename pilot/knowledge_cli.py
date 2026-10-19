"""Local operator-controlled JSON-lines knowledge port, not authentication.

The selected principal and role configuration are trusted local inputs. Do not
expose this process as a network server or treat a caller-supplied name as a
verified identity. Approval operations require an actual human reviewer using
their configured principal; this adapter does not generate approval decisions.
"""

import argparse
import json
import sys
from pathlib import Path

from .context_pilot import MAX_REQUEST_BYTES
from .knowledge import KnowledgeRegistry


def _principals(path):
    try:
        with Path(path).open("r", encoding="utf-8") as stream:
            raw = stream.read(65537)
        if len(raw.encode("utf-8")) > 65536:
            raise ValueError("configuration too large")
        value = json.loads(raw)
        if not isinstance(value, dict) or not value:
            raise ValueError("mapping required")
        for name, person in value.items():
            if (not isinstance(name, str) or not name.strip() or len(name) > 100
                    or not isinstance(person, dict)
                    or not {"workspace", "roles"}.issubset(person)
                    or not set(person).issubset({"workspace", "roles", "classifications"})
                    or not isinstance(person["workspace"], str)
                    or not person["workspace"].strip() or len(person["workspace"]) > 100
                    or not isinstance(person["roles"], list) or not person["roles"]
                    or any(not isinstance(role, str)
                           or role not in {"submitter", "reviewer", "publisher", "consumer"}
                           for role in person["roles"])
                    or not isinstance(person.get("classifications", []), list)
                    or any(not isinstance(item, str) or item not in {"internal", "restricted"}
                           for item in person.get("classifications", []))):
                raise ValueError("invalid principal")
            name.encode("utf-8")
            person["workspace"].encode("utf-8")
        return value
    except (OSError, ValueError, TypeError, UnicodeError, RecursionError):
        raise ValueError("invalid local principal configuration") from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--principals", required=True, help="operator-controlled JSON principal mapping")
    parser.add_argument("--principal", required=True, help="trusted local caller identity")
    args = parser.parse_args(argv)
    try:
        principals = _principals(args.principals)
    except ValueError as exc:
        parser.error(str(exc))
    if args.principal not in principals:
        parser.error("principal is absent from local configuration")
    with KnowledgeRegistry(args.database, args.source_root, principals) as registry:
        while True:
            line = sys.stdin.readline(MAX_REQUEST_BYTES + 2)
            if not line:
                break
            try:
                oversized = len(line.encode("utf-8")) > MAX_REQUEST_BYTES
            except UnicodeError:
                oversized = True
            if oversized:
                # Drain only this request; a following valid line remains usable.
                while line and not line.endswith("\n"):
                    line = sys.stdin.readline(MAX_REQUEST_BYTES + 2)
                print(json.dumps({"ok": False, "error": "invalid_request"}), flush=True)
                continue
            try:
                request = json.loads(line)
            except (ValueError, TypeError, RecursionError):
                print(json.dumps({"ok": False, "error": "invalid_json"}), flush=True)
                continue
            print(json.dumps(registry.dispatch(args.principal, request), allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
