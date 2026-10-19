# Supervised engineering consumer

`pilot.task_contract` and `pilot.supervised` add a bounded local engineering
consumer to the existing knowledge registry. The original factual rehearsal
remains compatible. These modules do not authenticate users, approve records,
change grants, or authorize a native service action.

## Output contract

`context.task-result.v2` uses one single-line JSON envelope per task (NDJSON),
in the requested order. Each **original** line is at most 8192 UTF-8 bytes;
each request body must fit both its original spelling and the dispatcher's
4096-byte canonical spelling. A batch of N tasks is bounded by N * 8193 bytes,
including line delimiters, with at most twelve tasks. No text is normalized,
repaired, shortened or silently dropped before admission. Duplicate keys,
nonfinite numbers, excessive nesting, unknown fields and mismatched task IDs,
evidence IDs, roles, operations or citations are rejected.

This is a new framing contract. The earlier six-task experiment used an 8192-byte
aggregate envelope and failed. Its results remain failed; v2 does not rescore it.
Every envelope and current task state is checked before the first generated operation.
An invalid later envelope prevents earlier proposals from executing.

An envelope has exactly `contract`, `task_id`, `evidence_id`, `status`, `summary`,
`requests`, `steps`, `citations` and `missing_evidence`. See `response_schema()`
for structural types and limits, and `validate_stream()` for original-byte and
task-binding checks that JSON Schema alone cannot express.

- `ready`: at least one permitted executable local request, with no missing
  prerequisite. Submitting an unapproved proposal can be ready; approving or
  publishing that new proposal is a separate human decision.
- `blocked`: missing evidence/prerequisites are explicit. Only current read or
  health requests may execute; proposed mutations remain `draft_only`.
- `abstain`: evidence cannot establish the requested capability; no requests and
  explicit missing evidence. A local fixture cannot supply enterprise identity.

These labels describe the requested local artifact. They never grant action
authority. Content correctness and practical usefulness need separate assessment.

## Task-scoped evidence and multirecord retrieval

The operator constructs one `TaskSession` per task/scenario using a separate
registry and source snapshot when scenarios change sources or grants. Each
session captures an epoch and digest of its current manifest, exact review
receipts, source hashes, validity/revocation status and relevant local principals.
Public metadata includes actual current-access results, without record text.
The model must return that task's `evidence_id`; evidence from another task or a
changed source, grant, approval, validity window or active release is rejected.

```python
from pilot.supervised import TaskSession, admit_and_execute

session = TaskSession(
    registry, "consumer-guide", "example", "reader",
    ["context:schema", "context:workflow"],
    [("author", "record.submit")], inspector="reviewer",
)
delivery = session.retrieve(["context:schema", "context:workflow"])
# Supply session.public_evidence(), delivery and the output contract to Codex.
# original_text must be the original completed model message, not re-serialized JSON.
results = admit_and_execute(original_text, [session])
```

`retrieve()` calls the existing atomic `knowledge.get(record_ids=[...])` and
retains the actual request/response. No query correction, extra source search,
fallback or partial delivery is performed. Successful delivered records alone
become eligible record citations for that task. Raw-source citations must also
be declared per task; records from another task are not usable citations.
Selecting required records is an explicit caller responsibility, not a semantic
retrieval or autonomous relevance claim.

The controller rechecks current evidence before each executable request and the
registry retains its own current source/access/approval/validity checks. Local
operations keep their individual transactions; this is not a distributed batch
transaction or protection from an operator who can edit local files/SQLite.
Currentness checks themselves record local delivery/denial audit events. Runtime
storage failures or changes between operations can still leave earlier successful
operations committed; batch admission is not a distributed rollback guarantee.
Do not share mutable scenario state or expose this library as a network service.

## Acceptance

Run `python -m unittest discover -s pilot -t . -p 'test_*.py' -v`. Normal tests and
CI never call a model. Tests cover original-byte admission, complete-stream
rejection, task/evidence/citation swaps, multirecord delivery, current source/
grant/review/expiry/release changes, denial without content, unapproved proposal
persistence and independent healthy/drift scenarios. Unit reviewers are simulated.

An opt-in Codex trial must freeze task texts, rubric, code/configuration, source
bytes and exact human decisions before output, retain every original prompt/event
and failure, replay allowed requests through the dispatcher, and inspect durable
state. Independent AI review is separate from human meaning review. Record actual
human minutes only if supplied; machine time does not measure maintenance effort.
No actual enterprise identity, endpoint or field policy is inferred from this
local interface.
