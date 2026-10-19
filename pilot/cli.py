"""JSON-lines context port for another process/session; local identity simulation."""

import argparse
import json
import sys

from .context_pilot import MAX_REQUEST_BYTES, Registry
from .sample_domain import PRINCIPALS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--principal", required=True, help="trusted local fixture identity")
    args = parser.parse_args()
    with Registry(args.database, args.source_root, PRINCIPALS) as registry:
        while True:
            line = sys.stdin.readline(MAX_REQUEST_BYTES + 2)
            if not line:
                break
            if len(line.encode("utf-8")) > MAX_REQUEST_BYTES:
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
