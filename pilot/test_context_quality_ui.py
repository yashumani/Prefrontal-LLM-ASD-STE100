"""HTTP boundary tests; mock reports below are transport fixtures, not measurements."""

import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from .context_quality_ui import MAX_RESPONSE_BYTES, create_server


def transport_report():
    return {"schema": "prefrontal.context.evaluation.v1", "run_id": "transport-fixture",
            "acceptance": "not_evaluated", "status": "missing", "checks": [],
            "currentness": {"status": "not_evaluated"},
            "binding": {"private_operator_path": "must-not-be-served"}}


class QualityHTTPTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parent.parent / ".validation" / "evaluation" / "http-tests"
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.path = Path(self.temp.name) / "evaluation.json"
        self.server = create_server(self.path, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.temp.cleanup()

    def request(self, path="/", method="GET", headers=None, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        conn.request(method, path, body=body, headers=headers or {})
        response = conn.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        conn.close()
        return result

    def test_fixed_assets_are_served_with_browser_security_headers(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        for path, mime in [("/", "text/html"), ("/assets/quality.js", "text/javascript"),
                           ("/assets/quality.css", "text/css")]:
            with self.subTest(path=path):
                status, headers, body = self.request(path)
                self.assertEqual(status, 200)
                self.assertTrue(headers["Content-Type"].startswith(mime))
                self.assertIn("no-store", headers["Cache-Control"])
                self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
                self.assertIn("script-src 'self'", headers["Content-Security-Policy"])
                self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
                self.assertNotIn("Access-Control-Allow-Origin", headers)
                self.assertEqual(int(headers["Content-Length"]), len(body))

    def test_no_directory_query_arbitrary_path_or_execution_routes(self):
        for path in ["/pilot/", "/evaluation.json", "/api/evaluation?path=secret",
                     "/?report=secret", "/assets/../context_quality_ui.py",
                     "/%2e%2e/AGENTS.md", "/api/query", "/api/model", "/assets/"]:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_no_mutation_or_other_methods(self):
        for method in ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT", "HEAD"]:
            with self.subTest(method=method):
                self.assertEqual(self.request("/api/evaluation", method)[0], 405)

    def test_host_and_origin_are_exact_loopback_allowlist(self):
        for host in ["evil.example", "127.0.0.1.evil.example", "localhost", "[::1]:8191"]:
            with self.subTest(host=host):
                self.assertEqual(self.request(headers={"Host": host})[0], 403)
        for origin in ["null", "https://evil.example", "http://127.0.0.1:8192", "http://localhost.evil.example"]:
            with self.subTest(origin=origin):
                self.assertEqual(self.request(headers={"Origin": origin})[0], 403)
        own = "http://localhost:%s" % self.server.server_port
        self.assertEqual(self.request(headers={"Origin": own})[0], 200)

    def test_duplicate_host_and_origin_are_rejected(self):
        for header in ["Host", "Origin"]:
            conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
            conn.putrequest("GET", "/", skip_host=True)
            conn.putheader("Host", "127.0.0.1:%s" % self.server.server_port)
            if header == "Origin":
                conn.putheader("Origin", "http://localhost:%s" % self.server.server_port)
                conn.putheader("Origin", "https://evil.example")
            else:
                conn.putheader("Host", "evil.example")
            conn.endheaders()
            response = conn.getresponse()
            self.assertEqual(response.status, 403)
            response.read()
            conn.close()

    def test_get_body_and_chunked_body_are_rejected(self):
        self.assertEqual(self.request(body=b"query=anything")[0], 400)
        self.assertEqual(self.request(headers={"Transfer-Encoding": "chunked"})[0], 400)

    def test_api_projects_public_fields_and_rechecks_every_request(self):
        first, second = transport_report(), transport_report()
        second["currentness"] = {"status": "stale", "reasons": ["changed"]}
        second["acceptance"] = "stale"
        with patch("pilot.context_quality_ui.load_evaluation", side_effect=[first, second]) as loader:
            status, _, body = self.request("/api/evaluation")
            self.assertEqual(status, 200)
            parsed = json.loads(body)
            self.assertIn("server_time", parsed)
            self.assertNotIn("binding", parsed)
            self.assertNotIn(b"private_operator_path", body)
            self.assertEqual(json.loads(self.request("/api/evaluation")[2])["acceptance"], "stale")
            self.assertEqual(loader.call_count, 2)
            loader.assert_called_with(self.path)

    def test_response_limit_fails_closed(self):
        report = transport_report()
        report["limits"] = ["x" * MAX_RESPONSE_BYTES]
        with patch("pilot.context_quality_ui.load_evaluation", return_value=report):
            status, _, body = self.request("/api/evaluation")
        self.assertEqual(status, 503)
        self.assertLess(len(body), 200)
        self.assertEqual(json.loads(body)["status"], "not_evaluated")

    def test_loader_exceptions_do_not_expose_paths_or_report_bytes(self):
        with patch("pilot.context_quality_ui.load_evaluation", side_effect=ValueError("SECRET /private/path")):
            status, _, body = self.request("/api/evaluation")
        self.assertEqual(status, 503)
        self.assertNotIn(b"SECRET", body)
        self.assertNotIn(b"private", body)

    def test_actual_missing_and_malformed_reports_stay_not_evaluated(self):
        # This integration test uses the real public evaluator loader.
        for content in [None, "not JSON", '{"schema":"x","schema":"y"}']:
            with self.subTest(content=content):
                if content is not None:
                    self.path.write_text(content, encoding="utf-8")
                status, _, body = self.request("/api/evaluation")
                self.assertEqual(status, 200)
                report = json.loads(body)
                self.assertEqual(report["acceptance"], "not_evaluated")
                self.assertEqual(report["currentness"]["status"], "not_evaluated")
                self.assertEqual(report["checks"], [])


if __name__ == "__main__":
    unittest.main()
