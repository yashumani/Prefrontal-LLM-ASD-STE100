# Context evaluation and quality panel implementation plan

> **For agentic workers:** Use subagent-driven development for scoped implementation and independent review. This file records the shared requirements; progress is tracked separately.

**Goal:** Evaluate a bounded governed context workload and inspect actual measurements in a local quality panel.

**Architecture:** A versioned, JSON evaluation contract identifies the benchmark, context/source snapshot, measured checks, coverage, non-compensating gates and freshness. A deterministic gross-additions runner exercises the existing composable registry, formats and native adapter. A separate loopback quality viewer reads these reports and rechecks their current bindings; it is not the presentation, the older live pilot or a hosted application.

**Tech stack:** Python >=3.9 standard library; existing composable interfaces; packaged HTML/CSS/JavaScript; existing Playwright installation for browser verification.

## Global constraints

- Work from main `f489be7ed2b5d09099df120ab88cd99cb5574a07` on `feat/context-evaluation`; preserve other branches, pilot and corpus evidence.
- No merge, external deployment, hosting choice, settings change, private corpus publication, paid/live model calls, external data calls or new credentials.
- No universal index, blended/weighted total, invented model uplift or claims of human semantic approval.
- Distinguish pass, failed, not evaluated, partially covered and stale results. A missing measurement is null, never zero or pass.
- Security violations and critical semantic failures block acceptance independently of other measurements.
- Bind reports to exact benchmark/context/source revisions and evaluation time; detect relevant changes during report readback. Unknown/currently unreadable authority cannot become current/pass.
- Measure source/provenance/freshness; metric formula/unit/grain/filter; ontology identities/relationships; interpretation caveats/evidence/abstention; retrieval precision/recall; format equivalence; governance; runtime latency and model/API cost where actually observed. Name each narrow check and its coverage honestly.
- Model comparisons need matched model, prompt, tools, budget and held-out cases with explicit paired execution counts. No executions means not evaluated.
- Synthetic gross-additions fixtures must have actual independently calculated expected answers and real executions. Keep fixture approval explicitly simulated.
- The quality panel must consume generated reports, expose failures/evidence/coverage/revision and stale state, remain keyboard/mobile usable, and never render source strings as executable HTML.
- Local fixture roles are not enterprise authentication. Bind only loopback, reject unexpected origins/hosts, bound report size and route requests, and expose no arbitrary file path or query execution endpoint.

## Task 1: Evaluation contract and deterministic runner

**Owned files:** `pilot/context_evaluation.py`, `pilot/test_context_evaluation.py` and a small fixture/benchmark file if needed.

**Interface:** Module CLI `python -B -m pilot.context_evaluation --output-root <new-run-parent>` creates a unique run, writes `evaluation.json` plus the operator readback configuration, and prints JSON with `report_path`. Public `load_evaluation(report_path)` returns the validated report with recomputed currentness; a missing report returns an explicit not-evaluated envelope. The return contract is shared with Task 2 before its backend is wired.

- [ ] Add regression cases for correct and wrong gross-additions results, missing checks, security/critical gates, duplicate/malformed report input, context/source/benchmark changes, expired current evidence, and no-model comparisons.
- [ ] Implement real executions with existing registry/search/resolve/revalidate/native and format round trips; independently calculate fixture expected counts from raw fixture rows.
- [ ] Report measured sub-scores with numerator/denominator, planned/executed coverage, per-case expected/observed/evidence and timing. Empty sets stay not evaluated; score values remain per dimension.
- [ ] Implement bounded readback and exact binding/currentness checks without modifying reports or governance when viewing.
- [ ] Run focused tests and capture one reproducible passing fixture plus controlled failed/missing/stale examples.

## Task 2: Local quality UI

**Owned files:** `pilot/context_quality_ui.py`, `pilot/quality_assets/*`, `pilot/test_context_quality_ui.py`, `scripts/verify-context-quality.cjs`.

**Interface:** `python -B -m pilot.context_quality_ui --report <evaluation.json> --port 8191`; fixed loopback GET `/`, `/api/evaluation` and known asset routes. No governance/model/source write endpoints. Readback delegates to Task 1's public loader and exposes explicit server-time currentness.

- [ ] Build a restrained white/red Prefrontal quality workspace: separate layer and cross-cutting measurements, hard-gate ribbon, coverage table, revision/time metadata, model not-evaluated state, filterable case/evidence drill-through.
- [ ] Add HTTP tests for allowed GETs, missing/invalid reports, unexpected host/origin, no path traversal, no write endpoints and response limits.
- [ ] Add browser checks on actual generated reports for pass/failure/missing/stale, no aggregate score, accessible controls, 360px/desktop layout and inert hostile strings.
- [ ] Capture actual screenshots and a machine-readable browser receipt; label any simulated browser interception separately.

## Task 3: Package, documentation and integration qualification

**Owned files:** `README.md`, `LLM_HANDOFF.md`, `pilot/CONTEXT_EVALUATION.md`, `pyproject.toml`, `.github/workflows/pilot.yml` as needed.

- [ ] Document installation, actual commands, per-check semantics/limits, staleness, fixture status, held-out matched comparisons and safe LLM use; cite RAGAS and ARES as methodological references, not certification.
- [ ] Include viewer assets and guide in the wheel and verify from a fresh release archive outside the checkout.
- [ ] Run relevant focused and full pilot tests, actual runner, browser checks and package smoke; inspect the exact scoped diff.
- [ ] Obtain independent contract/security/semantic and UI reviews, fix material findings and repeat covering checks.
- [ ] Commit only the reviewed scoped patch using verified repository identity; report branch, commit, evidence and limitations before any merge. Publication of a PR can be proposed after the patch is reviewable; do not merge in this task.
