# Prefrontal reference v0.1.0: validation and limits

This MIT-licensed release is a local Python reference for source-bound knowledge,
exact-version review, atomic publication, checked retrieval and reviewed correction.
It also preserves the deterministic sales example. The evidence below supports
that reference scope; operating-product acceptance remains unverified.

## Bounded repository rehearsal

On **2026-10-19**, Codex answered 12 fixed-choice questions about two frozen
repository documents. Preparation created 10 source-bound records with **simulated
fixture reviews** and no model calls. The successful rehearsal used
`gpt-6.1-sol`, reasoning effort `low`, through Codex CLI
`0.163.0-alpha.10.2`: one raw-source answer call and a Prefrontal routing call
followed by an answer call. All three calls reported no tool use.

Both arms selected the expected choice and answer/abstention status on **12/12**
questions. Prefrontal selected the expected exact record ID for 10 questions;
the two unsupported questions returned `no_match` and the answer call abstained.
The routing catalog exposed record IDs and claims, so this measures bounded
selection from a supplied catalog, not open-ended semantic retrieval.

The **original** citation-inclusive score was raw **11/12**, Prefrontal **12/12**.
For `action-authority`, raw correctly answered `no` and cited
`pilot/AGENT_WORKFLOW.md`; the annotation accepted only `pilot/README.md`.
Both frozen documents explicitly say receiving context does not authorize
consumer/external actions. The post-run correction admits either independently
supporting annotated source and grades raw citations on that basis. Offline
regrading of the **same saved answers** gives **12/12 for both arms**. This is an
annotation/grader correction, not another model run or a demonstrated quality gain.

Actual model-reported usage and measured invocation elapsed time:

| Arm | Successful calls | Input tokens | Cached input tokens included in input | Output tokens | Invocation elapsed |
|---|---:|---:|---:|---:|---:|
| Raw sources | 1 | 37,050 | 13,440 | 319 | 17,086.498 ms |
| Prefrontal: route + answer | 2 | 74,838 | 26,880 | 419 | 24,955.545 ms |

Prefrontal used more measured model tokens and invocation time in this run.
Total explicit prompt bytes also differed: 16,246 raw versus 25,338 for
Prefrontal's two calls. Codex inherited CLI instructions and cache overhead;
token counts are not just document size. Each call reported that skill descriptions
were removed after exceeding the skills context budget. These measurements do
not establish a speed, quality, cost-saving or productivity advantage. Invocation
time excludes preparation and human work; no dollar cost or human effort was measured.

An earlier attempt through CLI `0.146.0` rejected the selected model before
producing answers. It is excluded from the three successful calls above, with
its raw diagnostics retained locally.

The sanitized [rehearsal result](repository-rehearsal-result.json) retains the
questions, saved answers, routing, original/corrected scores, source hashes and
usage fingerprints. Full local preparation, prompts, events, source snapshots,
SQLite and original evidence are retained under the ignored run directory
`.validation/repository-rehearsal/run-20261019T044916345310Z/`.

## Version and source identity

The live run used repository base revision
`5f7591677385c41cd39e74a8896617346218ebd2` with local rehearsal/adapter changes.
The local `implementation-at-live-run.json` records those implementation hashes.
This identifies the live-run tree separately from the final release revision;
later grader/documentation changes did not generate new model answers.

| Frozen source | SHA-256 |
|---|---|
| `pilot/README.md` | `9f2c945f047ba9967199770eee187708f5e6a8ced36fe0885892919bc5819d9d` |
| `pilot/AGENT_WORKFLOW.md` | `0b03b662b1ff362550bbc71a5e6186390dd7465254424d297b5a06524da97a8f` |

Hashes identify the exact bytes used; they do not establish semantic truth.

## Deterministic validation and release evidence

Run the local acceptance suite from the repository root:

```sh
python -m unittest discover -s pilot -t . -p 'test_*.py' -v
```

The final local candidate passed after the annotation/grader changes:

```text
Ran 85 tests in 255.138s
OK
```

Both deterministic demos also passed: three metric consumers received identical
context, the reviewed USD 3300 -> USD 3400 correction survived durable readback,
and selected knowledge rejected source drift until a reviewed correction restored
use. Static presentation freshness, contracts and all 31 original topics passed.
The presentation itself was not changed by this release.

The [source workflow](https://github.com/yashumani/Prefrontal-LLM-ASD-STE100/actions/workflows/pilot.yml)
repeats the suite and both demos on Linux with Python 3.9 and 3.13 and Windows
with Python 3.13, without model calls. Match its tested commit to the release tag;
the [v0.1.0 release](https://github.com/yashumani/Prefrontal-LLM-ASD-STE100/releases/tag/v0.1.0)
records the observed hosted result. Local logs and a submitted workflow alone do
not establish a green hosted run or public archive acceptance.

Scripted tests exercise lifecycle, access, drift, rejection, atomic publication,
correction, restart/readback, bounded inputs and rehearsal-harness behavior. They
use fixtures and simulated approvals. The three real model calls separately
exercise the bounded document-answering task. Neither establishes real human
review, human maintenance effort or general agent effectiveness.

## Unverified operating capabilities

Identity and permissions are operator-controlled local configuration. This is
not authenticated enterprise identity or tamper-resistant governance. Hosted MCP,
enterprise source/consumer adapters, hybrid or semantic retrieval, semantic truth,
distributed recovery/load, and customer productivity remain unqualified. Receiving
context grants no external-action authority. Use the CLI locally as documented.

The supplied comparison image was not authenticated as a Karpathy source. Its
attribution and metrics provide no evidence for this release.
