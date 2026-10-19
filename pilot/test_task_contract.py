"""Admission is all-or-nothing over original, task-bound model output."""

import json
import unittest

from .task_contract import (
    ContractError, MAX_ENVELOPE_BYTES, MAX_TASKS, RESPONSE_CONTRACT,
    response_schema, validate_stream,
)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def scope(number=0):
    return {"task_id": "task-" + str(number), "evidence_id": format(number, "064x"),
            "allowed_requests": [("reader", "knowledge.get"),
                                 ("reader", "knowledge.health"),
                                 ("author", "record.submit")],
            "allowed_citations": [("record", "context:task-" + str(number))]}


def envelope(number=0):
    expected = scope(number)
    return {"contract": RESPONSE_CONTRACT, "task_id": expected["task_id"],
            "evidence_id": expected["evidence_id"], "status": "ready",
            "summary": "Retrieve the reviewed records for this task.",
            "requests": [{"principal": "reader", "mode": "executable", "request": {
                "operation": "knowledge.get", "workspace": "local-pilot",
                "record_ids": ["context:task-" + str(number), "context:schema"]}}],
            "steps": [{"owner": "reader", "action": "Check returned currentness.",
                       "acceptance": "All requested records are current and permitted."}],
            "citations": [{"kind": "record", "id": "context:task-" + str(number)}],
            "missing_evidence": []}


class TaskContractAcceptance(unittest.TestCase):
    def reject(self, value, scopes=None):
        text = value if isinstance(value, str) else encoded(value)
        with self.assertRaises(ContractError):
            validate_stream(text, scopes or [scope()])

    def test_six_ordered_task_scoped_envelopes_are_admitted_together(self):
        values = [envelope(number) for number in range(6)]
        stream = "\n".join(encoded(value) for value in values) + "\n"
        self.assertEqual(values, validate_stream(stream, [scope(number) for number in range(6)]))

    def test_late_invalid_envelope_returns_no_partial_result(self):
        stream = encoded(envelope()) + "\n" + encoded(envelope(1))[:-1]
        marker = object()
        result = marker
        try:
            result = validate_stream(stream, [scope(), scope(1)])
        except ContractError:
            pass
        self.assertIs(marker, result)

    def test_state_digest_cannot_be_swapped_between_tasks(self):
        first, second = envelope(), envelope(1)
        first["evidence_id"], second["evidence_id"] = second["evidence_id"], first["evidence_id"]
        self.reject(encoded(first) + "\n" + encoded(second), [scope(), scope(1)])

    def test_task_order_duplicates_and_extra_tasks_are_rejected(self):
        scopes = [scope(), scope(1)]
        self.reject(encoded(envelope(1)) + "\n" + encoded(envelope()), scopes)
        self.reject(encoded(envelope()) + "\n" + encoded(envelope()), scopes)
        self.reject(encoded(envelope()) + "\n" + encoded(envelope(1)), [scope()])

    def test_original_whitespace_counts_even_when_canonical_json_fits(self):
        line = encoded(envelope())
        self.reject(" " * (MAX_ENVELOPE_BYTES - len(line) + 1) + line)
        exactly = " " * (MAX_ENVELOPE_BYTES - len(line)) + line
        self.assertEqual([envelope()], validate_stream(exactly, [scope()]))

    def test_multibyte_output_is_measured_as_utf8_bytes(self):
        value = envelope()
        value["requests"][0]["request"]["padding"] = "\u4e16" * 1500
        self.assertLess(len(encoded(value["requests"][0]["request"])), 4096)
        self.reject(value)

    def test_original_request_whitespace_cannot_evade_request_byte_limit(self):
        line = encoded(envelope())
        line = line.replace('"operation":"knowledge.get"',
                            '"operation":' + " " * 4096 + '"knowledge.get"')
        self.assertLess(len(line.encode("utf-8")), MAX_ENVELOPE_BYTES)
        self.reject(line)

    def test_dispatcher_ascii_escaping_budget_is_also_enforced(self):
        value = envelope()
        value["requests"][0]["request"]["padding"] = "\u4e16" * 700
        self.assertLess(len(encoded(value["requests"][0]["request"]).encode("utf-8")), 4096)
        self.reject(value)

    def test_duplicate_keys_nonfinite_numbers_and_float_overflow_are_rejected(self):
        line = encoded(envelope())
        self.reject(line.replace('"status":"ready"', '"status":"ready","status":"blocked"'))
        for bad in ("NaN", "Infinity", "-Infinity", "1e999"):
            with self.subTest(number=bad):
                self.reject(line.replace('"operation":"knowledge.get"',
                                         '"number":' + bad + ',"operation":"knowledge.get"'))

    def test_nesting_limit_applies_inside_request_data_and_ignores_string_braces(self):
        value = envelope()
        value["summary"] = "Braces are plain text: " + "{" * 100
        self.assertEqual([value], validate_stream(encoded(value), [scope()]))
        nested = "null"
        for _ in range(35):
            nested = "[" + nested + "]"
        self.reject(encoded(envelope()).replace('"operation":"knowledge.get"',
                                               '"nested":' + nested + ',"operation":"knowledge.get"'))

    def test_request_canonical_size_limit_is_enforced(self):
        value = envelope()
        value["requests"][0]["request"]["padding"] = "a" * 4096
        self.reject(value)

    def test_blocked_mutation_must_remain_a_draft(self):
        value = envelope()
        value["status"] = "blocked"
        value["missing_evidence"] = ["Independent review is not supplied."]
        value["requests"][0] = {"principal": "author", "mode": "executable", "request": {
            "operation": "record.submit", "record": {"claim": "Proposed only."}}}
        self.reject(value)
        value["requests"][0]["mode"] = "draft_only"
        self.assertEqual([value], validate_stream(encoded(value), [scope()]))

    def test_blocked_read_only_diagnostic_is_permitted(self):
        value = envelope()
        value["status"] = "blocked"
        value["missing_evidence"] = ["Fresh source readback is needed."]
        self.assertEqual([value], validate_stream(encoded(value), [scope()]))

    def test_forbidden_operations_and_wrong_principal_are_rejected(self):
        for operation in ("record.approve", "record.revoke", "principal.grant", "external.call"):
            value = envelope()
            value["requests"][0]["request"]["operation"] = operation
            self.reject(value)
        value = envelope()
        value["requests"][0]["principal"] = "someone-else"
        self.reject(value)

    def test_citation_available_to_another_task_is_not_available_here(self):
        first, second = envelope(), envelope(1)
        first["citations"][0]["id"] = "context:task-1"
        self.reject(encoded(first) + "\n" + encoded(second), [scope(), scope(1)])

    def test_status_semantics_are_explicit(self):
        value = envelope()
        value["requests"] = []
        self.reject(value)
        value = envelope()
        value["requests"][0]["mode"] = "draft_only"
        self.reject(value)
        value = envelope()
        value["missing_evidence"] = ["Absent."]
        self.reject(value)
        for status in ("blocked", "abstain"):
            value = envelope()
            value["status"] = status
            self.reject(value)
        value = envelope()
        value.update(status="abstain", requests=[], missing_evidence=["No native identity supplied."])
        self.assertEqual([value], validate_stream(encoded(value), [scope()]))
        value["requests"] = envelope()["requests"]
        self.reject(value)

    def test_exact_fields_bounded_strings_and_single_line_framing(self):
        value = envelope()
        value["unexpected"] = True
        self.reject(value)
        value = envelope()
        value["summary"] = "a" * 221
        self.reject(value)
        value["summary"] = " "
        self.reject(value)
        line = encoded(envelope())
        for text in ("```json\n" + line + "\n```", line + "\n\n", "\n" + line,
                     line + "\r\n", json.dumps(envelope(), indent=2)):
            self.reject(text)

    def test_scope_bounds_and_duplicate_expected_identity(self):
        for scopes in ([], [scope()] * 2, [scope(number) for number in range(MAX_TASKS + 1)]):
            with self.assertRaises(ContractError):
                validate_stream(encoded(envelope()), scopes)
        invalid = scope()
        invalid["allowed_requests"] = [("reviewer", "record.approve")]
        self.reject(envelope(), [invalid])

    def test_request_strings_cannot_spoof_original_body_boundary(self):
        value = envelope()
        value["requests"][0]["request"]["note"] = '"request":{"operation":"record.approve"}}'
        self.assertEqual([value], validate_stream(encoded(value), [scope()]))

    def test_schema_is_fresh_and_names_the_public_contract(self):
        first, second = response_schema(), response_schema()
        self.assertEqual(RESPONSE_CONTRACT, first["properties"]["contract"]["const"])
        first["properties"]["contract"]["const"] = "changed"
        self.assertEqual(RESPONSE_CONTRACT, second["properties"]["contract"]["const"])
        self.assertFalse(first["additionalProperties"])


if __name__ == "__main__":
    unittest.main()
