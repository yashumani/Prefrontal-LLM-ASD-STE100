"""Read-only, loopback quality panel for a single operator-selected report."""

import argparse
import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


MAX_RESPONSE_BYTES = 2 * 1024 * 1024
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/assets/quality.css": ("quality.css", "text/css; charset=utf-8"),
    "/assets/quality.js": ("quality.js", "text/javascript; charset=utf-8"),
}
PUBLIC_FIELDS = (
    "schema", "run_id", "evaluated_at", "benchmark", "snapshot", "approval",
    "status", "acceptance", "currentness", "checks", "gates", "coverage",
    "model_comparison", "runtime", "limits", "dataset", "evaluator",
)
CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; "
       "connect-src 'self'; img-src 'self'; base-uri 'none'; "
       "form-action 'none'; frame-ancestors 'none'; object-src 'none'")


def load_evaluation(report_path):
    # Import here so the transport has no authority over report validation.
    from .context_evaluation import load_evaluation as load
    return load(report_path)


def create_server(report_path, port=8191):
    """Create a loopback-only server. Port zero is useful for isolated tests."""
    report_path = Path(report_path)

    class Handler(BaseHTTPRequestHandler):
        server_version = "PrefrontalQuality/1"
        sys_version = ""

        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, format, *args):
            # URLs and report evidence are not access-log material.
            return

        def _send(self, code, body, content_type="application/json; charset=utf-8"):
            if len(body) > MAX_RESPONSE_BYTES:
                code, body = 503, b'{"error":"response_limit","status":"not_evaluated"}'
                content_type = "application/json; charset=utf-8"
            self.send_response(code)
            for key, value in {
                "Content-Type": content_type, "Content-Length": str(len(body)),
                "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache",
                "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin",
                "Connection": "close",
            }.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def _error(self, code, label):
            self._send(code, json.dumps({"error": label, "status": "not_evaluated"}).encode())

        def _allowed(self):
            port = self.server.server_port
            hosts = {"127.0.0.1:%s" % port, "localhost:%s" % port}
            host_headers = self.headers.get_all("Host", [])
            origin_headers = self.headers.get_all("Origin", [])
            if len(host_headers) != 1 or host_headers[0] not in hosts:
                self._error(403, "unexpected_host")
                return False
            if len(origin_headers) > 1 or (origin_headers and origin_headers[0] not in {
                "http://" + host for host in hosts
            }):
                self._error(403, "unexpected_origin")
                return False
            if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Length", "0") != "0":
                self._error(400, "request_body_not_allowed")
                return False
            return True

        def do_GET(self):
            if not self._allowed():
                return
            if self.path in ASSETS:
                filename, mime = ASSETS[self.path]
                try:
                    body = Path(__file__).with_name("quality_assets").joinpath(filename).read_bytes()
                except OSError:
                    self._error(503, "asset_unavailable")
                    return
                self._send(200, body, mime)
            elif self.path == "/api/evaluation":
                try:
                    report = load_evaluation(report_path)
                    public = {key: report.get(key) for key in PUBLIC_FIELDS}
                    public["server_time"] = datetime.now(timezone.utc).isoformat()
                    body = json.dumps(public, ensure_ascii=True, allow_nan=False).encode("utf-8")
                except Exception:
                    # Do not expose file paths, report bytes, or exception text.
                    self._error(503, "readback_unavailable")
                    return
                self._send(200, body)
            else:
                self._error(404, "route_not_found")

        def _reject_method(self):
            if self._allowed():
                self._error(405, "method_not_allowed")

        do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_TRACE = do_CONNECT = do_HEAD = _reject_method

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--port", type=int, default=8191)
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    server = create_server(args.report, args.port)
    print(json.dumps({"url": "http://127.0.0.1:%s/" % server.server_port}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
