# Composable context profile

The additive v0.3 profile represents separately reviewed context records and
resolves only the bounded dependency closure required by a task. It separates
search, composition, validation and native use. Its schema identifier is
`prefrontal.context.v1`. Existing metric and general knowledge interfaces remain
separate; this is not an automatic database or record conversion.
The database profile marker is `prefrontal.composable.v1`; it is distinct from
the record schema and `prefrontal.composition.v1` result contract. An existing
knowledge or metric database is rejected rather than converted by a new CLI
flag. Version 0.3.0 names the package/profile work, not a claim that those older
contracts have been silently upgraded.

Start at [LLM_HANDOFF.md](../LLM_HANDOFF.md) for the orchestration workflow and
[AGENTS.md](../AGENTS.md) for repository instructions. Existing
[CODEX.md](CODEX.md), [KNOWLEDGE.md](KNOWLEDGE.md) and
[AGENT_WORKFLOW.md](AGENT_WORKFLOW.md) retain their original scope.

## Meaning, identity and provenance

Canonical IDs such as `M_GROSS_ADDS`, `CHANNEL_ONLINE`, `PRODUCT_POSTPAID` and
`PERIOD_2026_09` are readable references to distinct typed records. IDs match
`[A-Z][A-Z0-9_]{1,95}`. A record defines its meaning and conditions; the model
cannot infer executable logic or grants from the label. Typed dimension/member
and hierarchy relationships keep a channel, product and reporting period from
being interchanged just because their names resemble a question.
A member ID must begin with its exact dimension ID plus `_` and a nonempty
suffix: `CHANNEL_ONLINE` belongs to `CHANNEL`; a dimension named `DIM_COUNTRY`
would require a member such as `DIM_COUNTRY_AU`. The prefix is a structural
constraint; the pinned dimension record still establishes the type and meaning.
The bounded v0.3 hierarchy permits member parents within the same dimension
only. Cross-dimension parent relationships are unsupported and must not be
silently converted into filters. New relationships require a reviewed schema
and matching adapter. The native example selects exact member values; a parent
link alone does not implement a warehouse join or hierarchy rollup.
The registry stores separate measure, source, dimension, member and guidance
records rather than a record for every measure/channel/product/period
permutation. Resolution composes existing approved references under required/
optional dimension and hierarchy checks. This permits reuse without declaring
every possible combination meaningful or every measure executable.

Review binds exact record content. Resolve carries pinned dependencies and
provenance; current validation and the admitted native adapter remain mandatory
before source use. A byte hash identifies content, not semantic truth. Local
principal configuration selects operator-controlled roles/workspace/access; it
is not enterprise authentication or a token supplied by a prompt.

## Record contract

The exact common record fields are `schema`, `id`, `version`, `layer`, `kind`,
`name`, `aliases`, `description`, `narrative`, `owner`, `classification`,
`valid_from`, `valid_until`, `provenance`, `dependencies` and `spec`.
The schema value is `prefrontal.context.v1`; versions are positive integers.
Versions, pinned versions and freshness seconds are exact integers no greater
than `2**63 - 1`.
Classification is `internal` or `restricted`. `valid_from` is timezone-aware;
`valid_until` is null or a later timezone-aware instant. Provenance entries have
exactly `path` and `sha256`; dependencies have exactly `id` and `version`.
Workspace is supplied by the trusted registry/transport scope, not embedded as
record authority. Approval, reviewer, release and generated-answer fields are
not part of the submitted record model.

| Kind / layer | Exact `spec` fields and relationship |
|---|---|
| `source` / `data` | `binding`, `grain`, `freshness_seconds`, `checked_at`, `dimensions`; dimension-to-native-column mappings are binding descriptors |
| `measure` / `metric` | `source`, `aggregation`, `expression`, `required_dimensions`, `optional_dimensions`, `guidance`; referenced records have exact dependency pins |
| `dimension` / `ontology` | `value_type`: `text`, `period` or `integer` |
| `member` / `ontology` | `dimension`, `value`, `parents`; dimension/parent records have exact dependency pins |
| `guidance` / `interpretation` | Nonempty `qualifiers` and `caveats`; narrative remains inert evidence |

The structural validator admits measure aggregation labels `sum`, `count` and
`average`; that does not implement every such calculation. The native adapter
separately admits its exact supported binding and expression. Member type,
hierarchy and current dependency meaning require registry resolution; structural
validation of an isolated member cannot prove those cross-record facts. Owner
is a bounded label, not an owner directory or evidence of human acceptance.

## Document formats

`pilot.composable_model.validate_record(record)` returns a normalized independent
copy after structural checks. It does not create approval or lifecycle state.
`pilot.composable_formats.parse_document(text, format)` parses and validates the
exact supported profile; `export_document(record, format)` generates a view.
Supported format names are exactly `json`, `yaml` and `markdown`. The conversion
helper can represent a valid proposal; it does not make that proposal approved
or retrievable. Approved retrieval/export must pass the registry's lifecycle and
access checks.

| Format | Accepted profile |
|---|---|
| JSON | Strict bounded JSON; export is the canonical record followed by one newline |
| YAML | A bounded YAML 1.2 profile with block mappings/sequences and deterministic block export; strict JSON input is also accepted |
| Markdown | Exact metadata fence and narrative layout below; metadata is strict JSON and narrative is preserved verbatim |

YAML uses two-space indentation, identifier mapping keys, block sequences
(including compact `- id: ...` entries), JSON double-quoted strings, safe plain
ASCII identifier strings, exact decimal integers and lowercase `true`/`false`/
`null`. Blank lines/full-line comments and a single optional `---`/`...` document
boundary are allowed. Ambiguous values such as `yes`, `on`, unquoted dates,
leading-zero numbers and floats must be quoted as strings or deny; there is no
implicit YAML scalar coercion. Tags, anchors, aliases, merge keys and tabs deny.
Inline comments and arbitrary flow syntax also deny; only empty `[]`/`{}` values
are accepted inside block documents. This is a bounded profile, not a general
YAML implementation.

Literal `|-` text is supported with LF joining and no terminal LF. Deterministic
export uses quoted strings when necessary to preserve exact CRLF or trailing-LF
content. Canonical record hashes and narrative strings remain equal across the
supported representations; pretty formatting never changes approval state.
An arbitrary Markdown page, extra surrounding prose or lossy metadata extraction
is not a context record.

The Markdown representation is exactly this structure:

````text
# Prefrontal context record

```json
<canonical record without the narrative field>
```

## Narrative

<the exact narrative string>
````

The parser checks exact re-export. Narrative Unicode, newlines and embedded
fences remain intact; conversion must not silently rewrite the author's prose.
Timezone-aware timestamps normalize to UTC `Z`; aliases are unique after
case-folding. Source dimension-map descriptors are bindings, not dependency
records. Measure/member specification references are exact pinned dependencies.
Provenance paths are POSIX relative paths beneath the configured source root,
bounded to 512 characters; backslashes, colons and `.`/`..` segments are rejected.
Native column/grain identifiers match `[A-Za-z_][A-Za-z0-9_]{0,63}`. A binding
label separately matches `[A-Za-z][A-Za-z0-9_.:-]{0,127}`. These syntax rules
constrain descriptors; they do not authorize a source operation.

Generated views of approved JSON/YAML/Markdown come from the authoritative
record. An edit is a new proposed version, requiring exact independent human review and a
reviewed publication set. Approval fields in submitted document content are
absent/rejected. **Structurally valid does not mean human approved.**

## Bounds

| Resource | Limit |
|---|---:|
| Serialized record | 65,536 bytes (64 KiB) |
| Formatted input/export document | 266,240 bytes; normalized record must still fit 64 KiB |
| Direct dependencies per record | 32 |
| Dependency depth | 16 edges; root depth is 0 |
| Resolved closure | 128 records |
| Resolved bundle | 1,048,576 bytes (1 MiB) |
| Submission/publication batch | 1–256 records |
| Reverse-affected publication set | 2,048 records; excess denies without truncation |
| Search page | 100 results |
| Search query | 16 terms; 256 characters |

Limits are admission/response bounds, not performance guarantees. Registry
metadata scale is separate from fact rows, source query cost, language quality
and enterprise concurrency. A synthetic metadata benchmark does not establish
unlimited composition or warehouse throughput.
The JSON-lines request limit is independently bounded; a maximum-size batch of
maximum-size documents need not fit one transport request. Oversize input denies
rather than being truncated or partially admitted.

## Lifecycle and safe use

Submit complete source-bound proposals, validate structure, inspect a diff, obtain
independent human review of the exact version/hash, then publish a complete
reviewed dependency set. A format roundtrip cannot admit new meaning. Revocation,
expiry, access, source validity and dependency checks still apply at retrieval
and use time. Never silently repair a denial or fall back to an old bundle.

The optional native operation is constrained by approved structured context and
the adapter's own permissions. Narrative is not code. The profile is not a
hosted service, live model integration, enterprise connector or automatic bridge
to the existing knowledge MCP tools. It requires no credentials or workplace
content for its synthetic demonstration.

`pilot.composable_native.execute_native(registry, actor, bundle, source_root)`
is a Python port, separate from JSON-lines management/retrieval. It revalidates
the bundle and independently authorizes `synthetic-orders` before reading and
again before delivery. Only the admitted completed-order count fixture is
implemented: `count_completed_orders`, explicit `PERIOD`, optional `CHANNEL`
and `PRODUCT`, source grain `order`, binding `synthetic-orders`. It reads the
bound `orders.json`, checks its exact hash and bounded rows, and counts matching
completed orders. It executes no narrative, arbitrary expression or SQL.

The native fixture has its own limits: 262,144 source bytes and 4,096 rows,
August/September 2026, online/store, postpaid/prepaid and completed/cancelled.
These are independent of metadata-registry scale. Native result contract
`prefrontal.native.synthetic.v1` includes value/unit, query ID, bundle hash,
catalog revision, source binding/hash, selectors, provenance and source age.
Three deterministic consumer representations reuse the result/evidence; they
are local outputs, not deployed agent/chatbot/workflow services.

## Install and run the local fixture

Use Python 3.9+ in a clean virtual environment with the local build requirements
(`setuptools>=65` and `wheel`) already available. From the repository root:

```text
python -m pip install --no-deps --no-build-isolation .
python -B -m pilot.composable_demo --output-root .validation/composable-demo
```

Installation provides `prefrontal-context`; the equivalent module entrypoint is
`python -B -m pilot.composable_cli`. There are no runtime third-party dependencies
or model/provider calls. The demo's actual argument is `--output-root`; it creates
a new unique run beneath that parent and prints one JSON report, including
`database`, `source_root`, `principals`, `run_dir`, `bundle`, `native` and
`consumers`. It also saves `result.json`, synthetic source files, principal
configuration and individual record documents in the run directory.

Demo review is explicitly simulated by distinct local submitter/reviewer/releaser
fixtures. Running it is not actual independent human review or permission to
approve a real proposal. Its invented gross-adds measure counts completed orders;
it is not a production telecom definition.

To use the printed paths in PowerShell after installation:

```powershell
$demoText = python -B -m pilot.composable_demo --output-root '.validation/composable-demo'
if ($LASTEXITCODE -ne 0) { throw 'Synthetic fixture creation failed.' }
$demo = $demoText | ConvertFrom-Json
$portArgs = @('--database', $demo.database, '--source-root', $demo.source_root,
              '--principals', $demo.principals, '--principal', 'agent')
'{"operation":"context.search","workspace":"composable-demo","query":"gross adds","kind":"measure","page_size":10}' | prefrontal-context @portArgs
'{"operation":"context.resolve","workspace":"composable-demo","measure":"M_GROSS_ADDS","selectors":["CHANNEL_ONLINE","PRODUCT_POSTPAID","PERIOD_2026_09"]}' | prefrontal-context @portArgs
```

Each process reads one JSON request per line and emits one response per line.
The principal and file paths are process-owner configuration; JSON cannot select
an actor, group or permission. Do not edit the demo's principal map to turn a
denial into access. Use the configured consumer role for retrieval.
The map entries have exactly `workspace`, `roles`, `classifications` and
`source_bindings`. A source binding is separate native authority: a principal
can be permitted to inspect metadata while still being denied source execution.
Missing source authority denies; context delivery does not grant it.

Static examples are in [examples/composable](../examples/composable):
[records](../examples/composable/records),
[requests.jsonl](../examples/composable/requests.jsonl),
[principals.json](../examples/composable/principals.json) and
[import-batch.json](../examples/composable/import-batch.json). The import batch
creates proposals only. Static source `checked_at` values are a capture and can
expire; use a new demo run for fresh synthetic evidence, rather than weakening
freshness or treating bundled files as forever current.
The same gross-adds proposal has generated
[JSON](../examples/composable/records/M_GROSS_ADDS.json),
[block YAML](../examples/composable/records/M_GROSS_ADDS.yaml) and
[Markdown](../examples/composable/records/M_GROSS_ADDS.md) views. These files
illustrate authoring/roundtrip formats; their presence is not approval.
This profile binds exact source-file hashes. Changing a bound file invalidates
its old evidence; updating a timestamp or calling it an unchanged business
meaning does not bypass review. A real mutable-source policy needs a separately
reviewed schema/adapter contract. Do not assume another profile's fact-refresh
policy applies.

## JSON-lines requests and orchestration

Every request is a flat object with `operation` and exactly the fields below.
Unknown operations/extra fields fail closed. Workspace must match the configured
principal. Requests do not use the separate knowledge or metric envelopes.

| Operation | Required fields | Optional fields |
|---|---|---|
| `context.search` | `workspace`, `query` | `layer`, `kind`, `dimension`, `member`, `page_size`, `cursor` |
| `context.resolve` | `workspace`, `measure`, `selectors` | None |
| `context.revalidate` | `bundle` | None |
| `context.validate` | `record` | None |
| `context.export` | `workspace`, `id`, `format` | `version` |
| `record.submit` | `workspace`, complete `record` | None |
| `record.importbatch` | `workspace`, `documents`: array of `{format, document}` | None |
| `record.review` | `workspace`, `id`, `version`, `expected_hash`, `decision` | None |
| `release.publish` | `workspace`, `records`: array of `{id, version}` | `expected_revision` |
| `record.revoke` | `workspace`, `id`, `version` | None |

Search/resolve/revalidate/export require the consumer role. Record validation,
submission and batch import use submitter; review uses reviewer; publication
and revocation use releaser. Review decisions are
`approved`, `rejected` or `changes_requested`; review binds the exact content
hash and cannot be performed by its submitter. A publication set is complete
with respect to its pinned dependencies and current reviewed versions. The
operator may bind `expected_revision` to reject a concurrent catalog change.
Incremental publication can update selected active heads while preserving
unrelated heads; dependencies must remain complete and exactly pinned in the
resulting active catalog. Versions are immutable: new content cannot overwrite
an existing ID/version, including after rejection or changes requested.

Search uses a derived SQLite candidate index, ranked exact ID/name/alias and
weighted all-term matching. Each candidate's current access, source validity,
review/revocation and dependency closure is checked before delivery. Search
contract `prefrontal.context.search.v1` returns `results`, `next_cursor` and
`catalog_revision`; each result includes ID/version, layer/kind, name/description,
score and content hash. It exposes no catalog total or protected match hints.
Scores are deterministic lookup ranks, not semantic truth or model relevance.
An ambiguous exact alias denies instead of choosing an interpretation.
An eligible exact canonical ID uses a single-result fast path. A hidden or
unavailable ID does not reveal a protected match and can fall back to normal
visible keyword candidates. Inspect result IDs rather than assuming a query
string resolved to the record it resembles.

Pagination cursors bind the query, filters, principal configuration and catalog
revision; authority/revision changes invalidate them. Source hashes, validity
and expiry are rechecked on each page, so pagination is not a frozen snapshot
across time or source-file changes. Records can become unavailable while the
catalog revision stays the same. After an observed source/currentness denial,
stop dependent use and restart discovery once the underlying reviewed state is
valid again. A cursor never freezes permission or grants continued access.

For a consumer, search narrows candidates; resolve returns
`prefrontal.composition.v1` with the permitted pinned closure. Revalidate the
actual returned bundle, not a hand-written replacement:

```powershell
$resolveLine = '{"operation":"context.resolve","workspace":"composable-demo","measure":"M_GROSS_ADDS","selectors":["CHANNEL_ONLINE","PRODUCT_POSTPAID","PERIOD_2026_09"]}'
$resolved = ($resolveLine | prefrontal-context @portArgs) | ConvertFrom-Json
if (-not $resolved.ok) { throw 'Resolution denied; stop dependent use.' }
$checkLine = @{ operation = 'context.revalidate'; bundle = $resolved.result } | ConvertTo-Json -Depth 100 -Compress
$checked = ($checkLine | prefrontal-context @portArgs) | ConvertFrom-Json
if (-not $checked.ok) { throw 'Current bundle check denied; stop dependent use.' }
```

Use the bundle returned by the current check. It contains workspace, measure
ID/version, sorted typed selectors, record/hash/reviewer envelopes, catalog
revision, deduplicated provenance, `recheck_at_use` and `bundle_hash`. Metadata
and source authority remain separate, and a hash is not a credential.
Revalidation requires the exact current full bundle hash, including catalog
revision and provenance. Even an unrelated publication invalidates a previously
resolved bundle; resolve afresh within the same authorized scope. Do not rewrite
the revision or recompute a client hash to make stale context appear current.

`context.validate(record)` is different: it reports structural validity and the
registry's persisted exact approval state for that record. It does not approve
the record, resolve a task or grant native access. Its field named
`semantically_approved` reflects the stored approval flag; it is not independent
proof of semantic truth or actual human review. Native use remains the Python
`execute_native` port above; the JSON-lines CLI exposes no arbitrary native-query
or SQL operation. The demo shows actual composition, revalidation and native use
for its three synthetic consumer fixtures.

For an explicit Python native-use rehearsal with that run, this PowerShell
example opens its saved bundle and performs another current check before use:

```powershell
$reportPath = Join-Path $demo.run_dir 'result.json'
@'
import json
import sys
from pathlib import Path
from pilot.composable_cli import load_principals
from pilot.composable_model import ContextError
from pilot.composable_registry import ComposableRegistry
from pilot.composable_native import execute_native

report = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
try:
    with ComposableRegistry(report['database'], report['source_root'],
            lambda: load_principals(report['principals'])) as registry:
        current = registry.revalidate('agent', report['bundle'])
        result = execute_native(registry, 'agent', current, report['source_root'])
    print(json.dumps({'ok': True, 'result': result}, allow_nan=False))
except ContextError as error:
    print(json.dumps({'ok': False, 'error': {'code': error.code,
                                          'message': 'Request denied.'}}))
    raise SystemExit(1)
'@ | python -B - $reportPath
```

The saved bundle freezes neither approval nor source permission. Expired,
changed, revoked or unauthorized context stops this example; it does not
reapprove records or modify the source to force success.

Success is `{ "ok": true, "result": ... }`. A controlled denial is
`{ "ok": false, "error": { "code": "<safe code>", "message": "Request denied." } }`.
Examples include `access_denied`, `context_unavailable`, `stale_bundle`,
`stale_revision`, `review_required`, `source_changed`, `source_stale`,
`unsupported_native_query`, `invalid_record`, `invalid_document`,
`unsupported_format` and `invalid_request`. Do not infer protected content from a
denial, echo raw internal exceptions, or retry with broader permissions.

## Export, edit and review

An authorized consumer can request a current approved representation:

```json
{"operation":"context.export","workspace":"composable-demo","id":"M_GROSS_ADDS","format":"yaml"}
```

Keep the returned document as a view of that exact approved record. To change
meaning, create a separate proposal document, increment its version and preserve
or deliberately update source/dependency pins with evidence. Do not overwrite
the approved record or add an approval field to the document. A submitter may
use `context.validate` to inspect structure/stored approval state, then
`record.submit` for a record or `record.importbatch` for exact document strings.
Neither call approves the proposal. An independent reviewer must inspect the
actual content/diff and decide on that exact version/hash; the releaser publishes
the complete resulting dependency set. Generated representations and model
suggestions never bypass those roles.

## Validation status

The existing v0.2 baseline at `daab84ed` passed 165 tests. That is historical
knowledge/metric-profile evidence, not qualification of the new composable
profile.

The captured local demo at
`.validation/composable-demo/run-20261021T181900709939Z-ada9b890/result.json`
resolves **nine records**, records catalog revision **1**, and returns **2
completed orders** for `M_GROSS_ADDS` plus the three explicit selectors. Agent,
chatbot and workflow representations each carry the same value/evidence. The
native query ID is `synthetic.completed-orders.count.v1`; the report records
zero live model/network calls and explicitly simulated distinct-role approval.
This is an observed synthetic result, not human-reviewed telecom meaning or a
production connector. Its source freshness is capture-specific.

Installation, the final complete test count and measured metadata benchmarks
remain to be bound to the final recorded receipts. No new whole-suite count or
scale guarantee is claimed here before those checks complete.

## Reproduce the metadata benchmark

The repository-owned [benchmark script](../scripts/benchmark-composable.py)
measures synthetic registry metadata, not fact execution. Choose a new output
directory:

```text
python -B scripts/benchmark-composable.py --output .validation/composable-benchmark-new --sizes 1000,10000,100000 --max-seconds 300 --max-rss-mib 512
```

`benchmark.json` records Python/platform/SQLite/CPU environment, input sizes,
code hashes, per-dataset status, observed latency and peak resident memory.
Each operation has one warmup and 20 timed samples. The timeout is per dataset;
RSS is measured after batches and completion, not enforced as an OS allocation
cap. Failed/timed-out sizes stay in the result. Scripted distinct-role approvals
measure no actual human review effort or semantic truth. The fixture executes
zero source fact rows and zero model calls; its results establish no warehouse
throughput, hosted service capacity, enterprise concurrency or unlimited scale.
