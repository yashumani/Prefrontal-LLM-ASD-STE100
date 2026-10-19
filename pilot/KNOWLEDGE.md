# General knowledge reference interface

The knowledge profile adds source-bound policies, technical decisions, and other
reusable claims beside the existing metric demonstration. It reuses the registry's
version, review, dependency, validity, classification, and publication controls.
It does not execute source queries or interpret a context ID as permission.

The profiles use separate databases. Opening a metric database as knowledge, or
the reverse, fails with `profile_mismatch`. The original `context.get` and
`context.search` metric interfaces remain separate.

## Record

The common envelope has these exact fields:

```json
{
  "id": "context:action-authority",
  "version": 1,
  "workspace": "example",
  "layer": "data",
  "owner": "source-owner",
  "claim": "Context delivery does not authorize consumer actions.",
  "classification": "internal",
  "valid_from": "2026-10-18T00:00:00+00:00",
  "valid_until": "2026-11-18T00:00:00+00:00",
  "evidence": [{"path": "policy.md", "sha256": "<SHA-256 of the original file>"}],
  "dependencies": [],
  "content": {
    "text": "Context delivery does not authorize consumer actions.",
    "topics": ["action authority"],
    "assumptions": [],
    "limits": ["Native services enforce their own permissions."]
  }
}
```

The four `layer` values describe meaning: `data`, `metric`, `ontology`, and
`interpretation`. A knowledge release need not contain every category. Each
record requires original evidence. Derived records reference their input IDs
and exact versions. Interpretation records require assumptions and limits.
`content` has exactly `text`, `topics`, `assumptions`, and `limits`; topics are
nonempty. These knowledge records do not carry executable SQL or metric parameters.

Review binds the entire record, not only its claim. Validity uses timezone-aware
timestamps. Source paths must remain beneath `--source-root`. Limits remain 8 KiB
per record, 16 records per release, 160,000 bytes per bundle, and 1 MiB per source.
The JSON-lines transport bounds individual requests to 4 KiB.

## Local transport

For a self-contained working database and source snapshot, first run:

```powershell
python -m pilot.knowledge_demo
```

The demo prints the path to `evidence.json`, which contains the database, source
root, and principal-configuration paths. Its approvals are explicitly simulated.
It exercises targeted retrieval, unsupported-question abstention, source drift,
reviewed correction, and durable restart. Use the printed paths below.

Supply a trusted local principal map; it is configuration, not authentication:

```json
{
  "author": {"workspace": "example", "roles": ["submitter"]},
  "reviewer": {"workspace": "example", "roles": ["reviewer"]},
  "publisher": {"workspace": "example", "roles": ["publisher"]},
  "reader": {"workspace": "example", "roles": ["consumer"], "classifications": ["internal"]}
}
```

```powershell
python -m pilot.knowledge_cli --database '<database>' --source-root '<sources>' --principals '<principals.json>' --principal reader
```

Send one JSON request per line. Use the appropriate principal for management calls.

| Operation | Additional request fields |
|---|---|
| `record.submit` | `record` containing the whole proposed record |
| `record.review` | `workspace`, `record_id`, `version`, `expected_hash`, `decision`: `approve`, `reject`, or `changes_requested` |
| `release.publish` | `workspace`, `name`, `manifest`: map of record IDs to exact versions |
| `record.revoke` | `workspace`, `record_id`, `version` |
| `knowledge.get` | `workspace`, `record_ids`: nonempty array of requested IDs |
| `knowledge.search` | `workspace`, `query` |
| `knowledge.health` | `workspace`; reviewer role required |
| `knowledge.feedback` | `workspace`, `release`, `text` |

```json
{"operation":"knowledge.get","workspace":"example","record_ids":["context:action-authority"]}
```

Successful reads return a `context.knowledge.v1` bundle with requested records
and their transitive dependency closure. Unrelated knowledge is not appended.
Current evidence, approval, validity, revocation, and access are checked for each
delivered record. The response includes exact versions, reviewer receipts,
source hashes, release identity, expiry, and a bundle hash.

Search uses a derived reference index and delivers through the same current-record
checks. Exact IDs take precedence over all-keyword matches. No-match, ambiguity,
stale-index, or lifecycle failures return a controlled error without record content.
There are no embeddings or semantic relevance claims.

Health checks do not repair, approve, or publish knowledge. They expose deterministic
issues for review; a healthy result does not establish semantic truth.

## Acceptance and limits

Run `python -m unittest discover -s pilot -t . -p 'test_*.py' -v` to exercise both
profiles, including source drift, selected dependency closure, access withdrawal,
review isolation, profile confusion, and another-process consumption. Follow
[AGENT_WORKFLOW.md](AGENT_WORKFLOW.md) for agent behavior and maintenance.

SQLite, source files, principals, and audit are controlled by the local operator.
Do not expose this CLI as a network service. Real identity, production adapters,
semantic contradiction detection, distributed recovery, and human review effort
require separate qualification. The reference interface does not certify those
capabilities or train the consuming model.

## Bounded agent rehearsal

`pilot.rehearsal` compares the same configured Codex consumer on fixed factual
questions using original sources and published Prefrontal records. Calls are
opt-in; normal tests and CI use scripted adapter outputs and never invoke a model.
The real adapter uses the existing Codex login/configuration in read-only mode.

Prepare a local JSON configuration with these exact top-level fields:

```json
{
  "database": "<published knowledge database>",
  "source_root": "<approved source snapshot directory>",
  "principals": "<trusted local principal map>",
  "principal": "reader",
  "workspace": "example",
  "source_paths": ["policy.md"],
  "tasks": [{
    "id": "action-authority",
    "question": "Does receiving context authorize an action?",
    "choices": ["yes", "no", "unverified"],
    "expected_choice": "no",
    "expected_status": "answer",
    "record_citations": ["context:action-authority"],
    "source_citations": ["policy.md"]
  }]
}
```

Expected answers and required citations must be checked against the sources before
the run. They are withheld from the consumer. Use `expected_status: "abstain"`,
`expected_choice: "unverified"`, and empty required citation arrays for a question
that the corpus cannot answer. Caller/source authorization applies to both arms.

```powershell
python -m pilot.rehearsal --config '<reviewed-config.json>' --output '.validation/rehearsal-unique-run' --codex
```

This makes three model calls: a raw-source answer, an agent-selected retrieval
plan, and an answer using the actual retrieval results. The harness never repairs
the agent's chosen queries. It retains prompts, model events, actual reported
token counters when available, source hashes, requests, delivered context,
citations, fixed-choice scores, and call elapsed times in the local evidence
directory. External tool use invalidates the comparison. There are no retries
that silently substitute another model or answer.

Both arms use the same fixed source paths and byte hashes. The routing catalog
uses ordinary dependency/access checks, and out-of-corpus results are withheld.
Source hashes, the active release, and delivered bundles are rechecked before
scoring. Answer tasks require citations; unsupported tasks require abstention.

The maximum is 12 questions, eight sources, 64 KiB of total source bytes, and
128 KiB per model prompt. Questions, choices, and citations have field limits
as well. A failed or timed-out call leaves local diagnostics. Source
updates, permission withdrawal, and review transitions remain separately checked
by the deterministic lifecycle suite. A successful small factual run does not
establish general semantic correctness, productivity savings, provider security,
or human review effort. Record actual supervised review time separately when it
is measured; otherwise leave it unverified.
