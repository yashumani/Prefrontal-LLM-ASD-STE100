"""Bounded evaluation regressions; fixture reviews remain explicitly simulated."""
import copy
from datetime import timedelta
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from . import context_evaluation as evaluation


class EvaluationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="prefrontal-evaluation-")
        cls.parent = Path(cls.temp.name)
        cls.fixture = evaluation.run_evaluation(cls.parent / "baseline")
        cls.baseline = Path(cls.fixture["report_path"])

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.directory = self.parent / self.id().rsplit(".", 1)[-1]
        shutil.copytree(self.baseline.parent, self.directory)
        self.path = self.directory / "evaluation.json"

    def report(self):
        return json.loads(self.path.read_text(encoding="utf-8"))

    def save(self, report):
        evaluation._write_json(self.path, report)

    def check(self, report, identifier):
        return next(check for check in report["checks"] if check["id"] == identifier)

    def assertStale(self):
        report = evaluation.load_evaluation(self.path)
        self.assertEqual(report["currentness"]["status"], "stale", report)
        self.assertEqual(report["status"], "stale")
        self.assertNotEqual(report["acceptance"], "passed")
        return report

    def test_actual_oracle_filters_zero_and_simulated_approval(self):
        report = evaluation.load_evaluation(self.path)
        self.assertEqual(report["currentness"]["status"], "current")
        native = self.check(report, "native")
        self.assertEqual([case["observed"]["value"] for case in native["cases"]], [4, 3, 3, 2, 0])
        self.assertEqual(native["coverage"], {"planned": 5, "executed": 5})
        self.assertEqual(native["score"]["value"], 1)
        self.assertEqual(report["approval"]["status"], "simulated")
        self.assertEqual(report["acceptance"], "partial")
        self.assertTrue(all(gate["status"] == "passed" for gate in report["gates"]))
        self.assertIsNone(self.check(report, "human_semantics")["score"]["value"])

    def test_wrong_native_result_blocks_despite_other_perfect_scores(self):
        original = evaluation.execute_native
        def wrong(*args, **kwargs):
            result = original(*args, **kwargs)
            result["value"] += 1
            return result
        with patch.object(evaluation, "execute_native", side_effect=wrong):
            produced = evaluation.run_evaluation(self.parent / "wrong-native")
        report = evaluation.load_evaluation(produced["report_path"])
        self.assertEqual(self.check(report, "native")["score"]["value"], 0)
        self.assertEqual(report["acceptance"], "blocked")
        self.assertEqual(self.check(report, "formats")["score"]["value"], 1)

    def test_missing_check_and_case_cannot_shrink_required_coverage(self):
        report = self.report()
        report["checks"] = [check for check in report["checks"] if check["id"] != "security"]
        self.check(report, "native")["cases"].pop()
        self.save(report)
        loaded = evaluation.load_evaluation(self.path)
        self.assertEqual(loaded["acceptance"], "not_evaluated")
        self.assertEqual(self.check(loaded, "security")["status"], "missing")
        self.assertEqual(self.check(loaded, "native")["coverage"], {"planned": 5, "executed": 4})
        self.assertIsNone(self.check(loaded, "security")["score"]["value"])

    def test_security_violation_is_noncompensating(self):
        report = self.report()
        case = self.check(report, "security")["cases"][0]
        case.update(observed=False, status="failed")
        self.save(report)
        loaded = evaluation.load_evaluation(self.path)
        self.assertEqual(loaded["acceptance"], "blocked")
        self.assertEqual(loaded["gates"][0]["status"], "failed")

    def test_actual_source_authority_probe_is_denied(self):
        case = next(case for case in self.check(evaluation.load_evaluation(self.path), "security")["cases"]
                    if case["id"] == "native_authority")
        self.assertEqual(case["observed"], True)
        self.assertIn("denied=access_denied", case["evidence"])

    def test_format_loss_blocks(self):
        original = evaluation.parse_document
        def lossy(document, fmt):
            result = original(document, fmt)
            result["narrative"] += " altered"
            return result
        with patch.object(evaluation, "parse_document", side_effect=lossy):
            produced = evaluation.run_evaluation(self.parent / "lossy-format")
        report = evaluation.load_evaluation(produced["report_path"])
        self.assertEqual(self.check(report, "formats")["score"]["value"], 0)
        self.assertEqual(report["acceptance"], "blocked")

    def test_retrieval_precision_recall_counts_and_empty_denominator(self):
        report = self.report()
        for identifier in ("retrieval_precision", "retrieval_recall"):
            for case in self.check(report, identifier)["cases"]:
                case["observed"] = {"hits": 0, "returned": 0, "relevant": case["expected"]["relevant"]}
                case["status"] = "measured" if case["observed"] == case["expected"] else "failed"
        self.save(report)
        loaded = evaluation.load_evaluation(self.path)
        self.assertIsNone(self.check(loaded, "retrieval_precision")["score"]["value"])
        self.assertEqual(self.check(loaded, "retrieval_recall")["score"]["value"], 0)
        self.assertEqual(self.check(loaded, "retrieval_recall")["coverage"]["executed"], 3)

    def test_false_pass_and_changed_expected_answer_rejected(self):
        for change_status in (False, True):
            report = self.report()
            case = self.check(report, "native")["cases"][0]
            case["expected"]["value"] = 100
            if change_status:
                case["observed"]["value"] = 100
            self.save(report)
            self.assertEqual(evaluation.load_evaluation(self.path)["acceptance"], "not_evaluated")

    def test_duplicate_json_check_and_case_rejected(self):
        original = self.report()
        variants = []
        check_duplicate = copy.deepcopy(original)
        check_duplicate["checks"][1] = copy.deepcopy(check_duplicate["checks"][0])
        variants.append(check_duplicate)
        case_duplicate = copy.deepcopy(original)
        native = self.check(case_duplicate, "native")
        native["cases"][1] = copy.deepcopy(native["cases"][0])
        variants.append(case_duplicate)
        for report in variants:
            self.save(report)
            self.assertEqual(evaluation.load_evaluation(self.path)["status"], "missing")
        self.path.write_text('{"schema":"a","schema":"b"}', encoding="utf-8")
        self.assertEqual(evaluation.load_evaluation(self.path)["acceptance"], "not_evaluated")

    def test_malformed_oversized_nonfinite_input_and_missing(self):
        for content in ('[]', '{', '{"x":NaN}', ' ' * (evaluation.MAX_REPORT_BYTES + 1)):
            self.path.write_text(content, encoding="utf-8")
            self.assertEqual(evaluation.load_evaluation(self.path)["status"], "missing")
        self.assertEqual(evaluation.load_evaluation(self.directory / "absent.json")["acceptance"], "not_evaluated")

    def test_no_model_executions_never_claim_uplift(self):
        report = evaluation.load_evaluation(self.path)
        self.assertEqual(report["model_comparison"]["paired_executions"], 0)
        self.assertEqual(report["model_comparison"]["status"], "not_evaluated")
        self.assertIsNone(report["model_comparison"]["uplift"])
        for changes in ({"uplift": 0.2}, {"paired_executions": 4},
                        {"matched": {"model": True, "prompt": True, "tools": True, "budget": True}}):
            altered = self.report()
            altered["model_comparison"].update(changes)
            self.save(altered)
            self.assertEqual(evaluation.load_evaluation(self.path)["acceptance"], "not_evaluated")

    def test_dataset_identity_and_boolean_impostors_rejected(self):
        original = self.report()
        for field, value in (("sha256", "0" * 64), ("id", "production-orders"), ("revision", "2")):
            report = copy.deepcopy(original)
            report["dataset"][field] = value
            self.save(report)
            self.assertEqual(evaluation.load_evaluation(self.path)["acceptance"], "not_evaluated")
        report = copy.deepcopy(original)
        self.check(report, "security")["cases"][0]["observed"] = 1
        self.save(report)
        self.assertEqual(evaluation.load_evaluation(self.path)["acceptance"], "not_evaluated")

    def test_runtime_nonfinite_negative_and_wrong_retrieval_denominator_rejected(self):
        original = self.report()
        for value in (-1, True, "12"):
            report = copy.deepcopy(original)
            report["runtime"]["elapsed_ms"] = value
            self.save(report)
            self.assertEqual(evaluation.load_evaluation(self.path)["status"], "missing")
        content = json.dumps(original).replace('"elapsed_ms": ' + str(original["runtime"]["elapsed_ms"]),
                                                '"elapsed_ms": 1e999', 1)
        self.path.write_text(content, encoding="utf-8")
        self.assertEqual(evaluation.load_evaluation(self.path)["status"], "missing")
        report = copy.deepcopy(original)
        case = self.check(report, "retrieval_recall")["cases"][0]
        case.update(observed={"hits": 0, "returned": 0, "relevant": 0}, status="failed")
        self.save(report)
        self.assertEqual(evaluation.load_evaluation(self.path)["status"], "missing")

    def test_ontology_and_format_expectations_anchored(self):
        original = self.report()
        for identifier in ("ontology", "formats"):
            report = copy.deepcopy(original)
            case = self.check(report, identifier)["cases"][0]
            case["expected"] = case["observed"] = "invented equal expectation"
            self.save(report)
            self.assertEqual(evaluation.load_evaluation(self.path)["acceptance"], "not_evaluated")

    def test_actual_native_denial_produces_failed_report(self):
        with patch.object(evaluation, "execute_native", side_effect=evaluation.ContextError("context_unavailable")):
            produced = evaluation.run_evaluation(self.parent / "denied-native")
        report = evaluation.load_evaluation(produced["report_path"])
        self.assertEqual(report["acceptance"], "blocked")
        self.assertEqual(self.check(report, "native")["coverage"]["executed"], 5)
        self.assertEqual(self.check(report, "native")["cases"][0]["observed"], {"error": "context_unavailable"})

    def test_source_change_stale_preserves_historical_measurements(self):
        path = self.directory / "sources" / "orders.json"
        path.write_text(path.read_text(encoding="utf-8") + " ", encoding="utf-8")
        report = self.assertStale()
        self.assertEqual(self.check(report, "native")["cases"][3]["observed"]["value"], 2)

    def test_context_view_change_stale(self):
        path = self.directory / "records" / "M_GROSS_ADDS.json"
        path.write_text(path.read_text(encoding="utf-8") + " ", encoding="utf-8")
        self.assertStale()

    def test_benchmark_change_stale(self):
        path = self.directory / "benchmark.json"
        value = json.loads(path.read_text(encoding="utf-8"))
        value["revision"] = "2"
        evaluation._write_json(path, value)
        self.assertStale()

    def test_catalog_change_and_revocation_stale_without_reset(self):
        for sql in ("UPDATE c_meta SET revision=revision+1", "UPDATE c_records SET revoked=1 WHERE id='M_GROSS_ADDS'"):
            with sqlite3.connect(str(self.directory / "context.sqlite3")) as db:
                db.execute(sql)
            before = evaluation._file_hash(self.directory / "context.sqlite3")
            self.assertStale()
            self.assertEqual(evaluation._file_hash(self.directory / "context.sqlite3"), before)

    def test_unreadable_authority_and_source_denial_stale(self):
        path = self.directory / "principals.json"
        people = json.loads(path.read_text(encoding="utf-8"))
        people["agent"]["source_bindings"] = []
        evaluation._write_json(path, people)
        self.assertStale()
        path.unlink()
        self.assertStale()

    def test_expiry_and_future_timestamp_stale(self):
        expiry = evaluation._time(self.report()["currentness"]["expires_at"])
        with patch.object(evaluation, "_now", return_value=expiry + timedelta(seconds=1)):
            self.assertStale()
        with patch.object(evaluation, "_now", return_value=evaluation._time(self.report()["evaluated_at"]) - timedelta(seconds=1)):
            self.assertStale()

    def test_implementation_change_stale(self):
        original = evaluation._file_hash
        def changed(path):
            if Path(path).name == "composable_native.py":
                return "0" * 64
            return original(path)
        with patch.object(evaluation, "_file_hash", side_effect=changed):
            self.assertStale()

    def test_readback_writes_nothing_and_does_not_recreate_missing_database(self):
        before = {str(path.relative_to(self.directory)): evaluation._file_hash(path)
                  for path in self.directory.rglob("*") if path.is_file()}
        evaluation.load_evaluation(self.path)
        after = {str(path.relative_to(self.directory)): evaluation._file_hash(path)
                 for path in self.directory.rglob("*") if path.is_file()}
        self.assertEqual(before, after)
        database = self.directory / "context.sqlite3"
        database.unlink()
        self.assertStale()
        self.assertFalse(database.exists())

    def test_escape_binding_fails_before_external_read(self):
        config_path = self.directory / "readback.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        config["files"] = {"../outside.txt": "0" * 64}
        evaluation._write_json(config_path, config)
        report = self.report()
        report["binding"]["config_sha256"] = evaluation._file_hash(config_path)
        self.save(report)
        original = evaluation._file_hash
        def confined(path):
            self.assertNotEqual(Path(path).name, "outside.txt")
            return original(path)
        with patch.object(evaluation, "_file_hash", side_effect=confined):
            self.assertStale()


if __name__ == "__main__":
    unittest.main()
