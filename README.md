# Prefrontal · Governed context as a product

The default development branch is `main`. The governed-context validation matrix
runs on relevant changes to `main`. The Pages build places the browser workspace
at the site root and preserves the earlier presentation under `presentation/`.
Deployment status belongs to the exact workflow run, not to source-file presence.

## Browser context workspace

The [browser workspace](workspace/index.html) starts empty. A person can add or
import context, inspect structural validation, save on this device, find records,
compose a point of view and export the consumer payload without editing code.
The optional synthetic demo uses a separate workspace and never silently merges
with user records. [Open the published workspace](https://yashumani.github.io/Prefrontal-LLM-ASD-STE100/)
when the main-branch Pages deployment has completed.

Read the [nontechnical quickstart](workspace/guides/quickstart.html),
[developer and adapter guide](workspace/guides/developer.html) and
[storage and scaling guide](workspace/guides/scaling.html). The writing is
ASD-STE100-inspired; formal compliance has not been assessed.

This is a static open-source project workspace. User records stay in browser
localStorage on one device, profile and origin; the application does not upload
them. This is not shared persistence, a secure vault, a backup or a hosted
private/commercial SaaS backend. There are no credential-entry fields, content
analytics, automatic source ingestion, paid model calls or live LLM. Local rules
orchestrate context processing and delivery only. Downstream consumers own their
task logic, native execution and answers.

The `prefrontal.context.v1` profile keeps atomic source, measure, dimension,
member and guidance records, and adds typed term, business event, policy and
document records with pinned relationships. JSON, bounded YAML and the defined
Markdown profile preserve the same canonical fields and narrative. IDs survive
name edits; changed content creates a new version. Point-of-view composition
resolves required records instead of materializing Cartesian combinations.

`prefrontal.workspace.v1.user` and `prefrontal.workspace.v1.demo` are separate
localStorage keys. Saved status requires successful write/readback. Export a
versioned workspace backup for recovery or transfer. Recovery validates before
explicit replacement and rejects a different mode. Quota and conflict errors
remain visibly unsaved. Classification is metadata, not a browser ACL. Local
review notes are unauthenticated attestations, not backend approval.
Pages projects on the same `owner.github.io` origin share browser storage access;
a repository URL path is not a storage or security boundary.
Unreadable stored data stays unchanged. Only a validated, explicitly confirmed
same-mode backup can replace the captured corrupt value; ordinary saves cannot.
Recovery stops if another tab changes that value or stores a valid workspace.

Build the assembled site before previewing its workspace, guides and preserved
presentation routes:

```text
node scripts/build-pages.cjs
python -m http.server 8192 --bind 127.0.0.1 --directory _site
```

Open `http://127.0.0.1:8192/`. The browser app is also source-previewable at
`workspace/`, but that folder alone does not contain the assembled presentation.
Asset and guide links must work beneath the repository's Pages subpath.

The actual Python bridge validates a browser backup or consumer payload. Only a
full workspace backup can stage retained original submissions and proposals:

```text
python -B -m pilot.browser_workspace --input browser-backup.json --validate-only
python -B -m pilot.browser_workspace --input browser-backup.json --output-root .validation/browser-stage --workspace example-workspace
```

Use the actual downloaded file and the operator's intended workspace. Staging
creates a new local output directory; it does not import into a registry, approve
meaning, publish a release, call a model or execute a source. Missing original
source paths stay explicit and need operator review. A browser consumer preview
has `execution_authorized: false`; governed admission, exact human review,
release, current authority checks and native permissions remain required.
Authoring search can include drafts and is separate from approved consumer search.

Your workspace is **not evaluated**. The separate fixed synthetic evaluator below
does not award scores to arbitrary user records. The browser profile admits at
most 1,000 record versions and 1,000 captured original files within 2 MiB of
saved backup state, including history and originals; record, dependency and
closure limits also apply. Actual workload evidence and migrations are described
in the scaling guide. These bounds do not establish warehouse or unlimited scale.

For the additive v0.3 composable context profile, start with
[LLM_HANDOFF.md](LLM_HANDOFF.md), [AGENTS.md](AGENTS.md) and the
[composable profile contract](pilot/COMPOSABLE.md). The LLM workflow is bounded
search, exact dependency resolution, current validation and admitted native use.
Readable typed IDs, JSON/bounded block YAML/Markdown views and generated proposals
remain subject to exact human review; structural validity never establishes approval.
Existing knowledge/metric databases and the [knowledge MCP connection](pilot/CODEX.md)
remain separate. See the composable guide for installation, CLI/native examples,
limits and qualification evidence.

## Context quality evaluation preview

This development branch adds a proposed context scorecard and a dedicated local
quality panel. It reports measured checks, their coverage and evidence, with
separate states for failures, missing measurements and stale evaluations.
Security and critical semantic failures block acceptance; there is no blended
quality index or claimed model uplift. The supplied gross-additions benchmark
uses synthetic orders and explicitly simulated approval.

```powershell
$evaluation = python -B -m pilot.context_evaluation --output-root .validation/context-evaluation | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Evaluation failed; inspect its error.' }
python -B -m pilot.context_quality_ui --report $evaluation.report_path --port 8191
```

Open `http://127.0.0.1:8191/`. This panel reads the generated evaluation and its
current bindings; it does not start the separate sales pilot or a hosted service.
See [evaluation definitions, installation and limits](pilot/CONTEXT_EVALUATION.md).

Prefrontal includes a runnable, MIT-licensed governed-context reference in
[`pilot/`](pilot/README.md): propose source-bound knowledge, review exact versions,
publish a dependency set, and deliver current permitted context to a consumer.
Start with `python -m pilot.knowledge_demo`; Python 3.9 or newer and the standard
library are sufficient. See the [agent guide](pilot/AGENT_WORKFLOW.md),
[knowledge interface](pilot/KNOWLEDGE.md), and [release evidence](pilot/RELEASE_VALIDATION.md).

[Open the preserved pitch](https://yashumani.github.io/Prefrontal-LLM-ASD-STE100/presentation/).

This 16-slide presentation sells a proposed context product and a bounded pilot. The first four slides explain the buyer problem, product and investment case. Slide five shows the complete architecture. Developer detail follows: submissions, review, canonical IDs, semantic layers, model decisions, controlled delivery, economics and implementation gates.

## Leadership rework

The October 7 rework covers slides 1–4, 14 and 15. It keeps the CFPA design, shared SVG motion, 16-slide narrative and all 31 topics.

Each revised slide has a connected SVG mechanism and three leadership takeaways. The investment slide retains all four calculated break-even values. The reference cost inputs and original developer sections remain available. Validation covers every diagram stage, desktop and mobile containment, the static fallback, and both 16-page PDF exports.

The opening states what buyers receive, the repeated work to measure, the governed reuse mechanism and the funding rule. Slide 14 compares the current process and candidate on the same held-out workload. Slide 15 follows the seven delivery stages, including repair, launch approval and change qualification. The leadership claims remain proposed outcomes to test.

The product accepts structured submissions from humans and agent loops. Human reviewers approve meaning for an exact record version. A context agent organizes approved records into Data, Metric, Ontology and Interpretation layers. Canonical IDs connect the layers. A controlled MCP server delivers permitted context to independent applications. New meaning and feedback return through preparation and review. Consumers control their own actions.

## Brand reference

The design follows the supplied `cfpa-use-case-journey-v7.zip`. Its `Index.html` establishes white paper, black text, pale-gray surfaces, red `#EE001E`, bold sans-serif headings, rounded cards, pill controls and semantic SVG highlights. The deck uses locally available Arial. It executes no reference application scripts or backend code. The pitch uses the supplied planning content as a reference, with evidence boundaries below.

## Investment case

Slide four states an illustrative year-one break-even requirement. Invented inputs: 1,000 accepted tasks per month, 80% acceptance, $1,000 monthly overhead and $5,000 setup over 12 months. These require about $1.13 benefit per attempt across 1,250 monthly attempts. This is a hurdle to test, not a quote or forecast.

The editable worksheet begins with equal digital cost, handling time and acceptance for the current and proposed process. The proposed process adds operating overhead. This neutral case costs more. Buyers can inspect positive, negative and lower-acceptance scenarios.

```text
Attempts = monthly accepted-task target / acceptance rate
Recurring cost = attempts × (digital cost + handling minutes × hourly rate / 60) + fixed cost
Year-one net difference = 12 × monthly recurring difference − one-time setup
```

Digital cost includes inference, retrieval, warehouse queries, tools and variable infrastructure. Handling includes review, rework and escalation. Fixed cost includes seats, licenses, adapters and operations. Compare existing allocated and incremental costs consistently. Count each cost once. An accepted task meets the owner's task and quality criteria. Positive economics cannot override quality or access gates.

## Alignment with the supplied v7 plan

The existing stack is reported by the user and the supplied planning reference. Live connections have not been verified. The proposal extends Looker, LookML, Zenlytics and custom apps. It does not replace ERP systems or the warehouse.

LookML remains the native source for approved measures and query logic. A proposed Metric Passport binds its canonical ID and version to the LookML project, model, Explore, view, measure and Git revision, or a certified SQL revision. It records the owner, population, grain, unit, time window, exceptions, evidence and access. The consumer executes queries in its native service. New interpretations return to review.

A source or consumer adapter must qualify its real API or MCP interface, identity mapping, source authorization, validity, revocation and failure behavior. A context ID grants no access. Permissions do not transfer automatically across products. Existing custom apps may provide submission and review workflows after qualification.

The proposal maps to the reference's eight context capabilities:

| Existing plan capability | Proposed product contribution | Acceptance still required |
|---|---|---|
| One approved metric definition | Canonical identity and native LookML source binding | Verify the source revision and formula parity |
| Certified SQL and answers | Deliver approved query references for native execution | Test known questions, current access and data validity |
| SME knowledge library | Load relevant, approved expert context | Check source support and bounded retrieval |
| Triage and escalation | Typed model decisions under a code harness | Qualify routing and appropriate abstention |
| Compliance gate | Delivery policy checks and explicit consumer responsibilities | Test source and consumer permissions before execution |
| Continuous QA | Owner-approved gold truth and standing regression cases | Exercise normal, stale, conflict and denial paths |
| Auditability | Source, validator, date and exact approved version | Read back persistent evidence end to end |
| Reviewed learning | Corrections and expert drafts reenter submission and review | Prevent drafts from silently becoming approved facts |

The seven delivery stages are Intake/Vetting, Product Requirements, Product Design, Development, Testing, Launch and Maintenance. Catalog reuse precedes custom development. Pilot approval needs a named sponsor, reviewer, source owner, scope, setup ceiling, recurring budget and success criteria. Security/compliance review and leadership go/no-go precede operational launch. Change control, drift checks and value realization continue after launch.

The v7 Best Practices section and cost scoring remain unapproved guidance. Candidate controls include deterministic methods, qualified model routing, bounded prompts and outputs, cache validity, batching when deadlines permit, step/retry limits, warehouse billing controls and license/role fit. The deck imports no vendor savings percentage or internal negotiated rate. Compare the same accepted workload, include cache writes/reads and storage, seats/concurrency, query charges, model calls, human review and operations, and retain failed or queued tasks in the evidence.

## V7 cost section

Three linked slides reproduce the supplied cost work. The planner carries six task presets, eight public example model-rate records and editable call assumptions. The hidden-work slide separates visible writing from instructions, tools, documents, history, thinking, retries and cache writes. The budget slide shows cost per person and per team, model settings and task routing. The eight SVG visuals include the token flow, summary token/cost bars, iceberg, repeated calls, cost categories, monthly budget, settings dials and model routes.

Developer detail includes the fourteen source setting rows and six task-setting examples. These are unapproved reference advice. A schema does not eliminate every format error. Sampling does not guarantee identical answers. Resolution must qualify against the task. Model labels and rate values reproduce the supplied file; they are not verified current vendor availability, pricing or contract terms. Enter actual rates before using the estimate.

The six preset task totals match the supplied calculation. The estimate prices each call, growing history, cache reads, the first-call cache-write premium and output. It applies batch and region multipliers once, then adds a retry allowance. Cache writes have their own cost line. The question-and-answer comparison consistently applies tokenizer and region factors, correcting omissions in the source. Token-flow inputs consistently show task totals. Token fields are baseline estimates; use a tokenizer factor of one for measured target-model counts.

The source Flash rate is future-dated. Its Pro rate omits the stated long-context tier. Source cache eligibility is broad and excludes real expiry and storage rules. These limits appear in developer detail. The model-only estimate excludes warehouse, seats, hosting, setup and human review. Keep it separate from the full accepted-task investment worksheet. No model calls run in this browser calculator.

## View and present

Arrow keys move between slides. **Slides** opens the overview. **Full screen** enlarges the deck. **Print / PDF** prints all 16 leadership slides.

The header switches between **Leader** and **Developer**. Leader view presents the consolidated mechanism. Developer view keeps all 31 original topics in expandable sections. Topic buttons open the relevant section directly. The first four slides and full architecture on slide five retain their original purpose. The cost suite combines task cost, hidden work, monthly budget, and call anatomy on one slide; its six presets, eight charts, 14 setting rows, six recommendations, editable rates and full-cost worksheet remain available.

The supplied `vz-motion-kit.zip` is the motion reference. Plain SVG elements use `document.createElementNS`; canvas measures node labels. One shared `requestAnimationFrame` dispatcher advances stages and samples positions along directed paths. An `IntersectionObserver` runs only visible, allowed figures. Each figure's **Pause motion** control stops all motion and shows the complete static mechanism. OS reduced motion does the same. Manual stage arrows let a presenter inspect one step. No stage intervals, outside chart libraries, or independent SVG animation clocks run.

`index.html` is a generated, self-contained page with inline CSS, JavaScript and JSON. It works offline without external assets. To reuse it in Apps Script, paste it into an HTML file named **Index**. The build rejects template scriptlet markers. This change does not deploy an Apps Script backend or implement the proposed context product.

Twelve slides now use focused architecture diagrams. Slides 1–4 explain the product, repeated work, governed service and funding decision. Slides 7–11 and 13 zoom into its operating mechanisms. Slide 14 compares baseline and candidate evidence. Slide 15 follows the seven-stage delivery plan. The same diagram stays visible in both audience views. Seven developer explanations add the agent steps, inputs, outputs and authority limits. The chosen model proposes typed signals; the code harness checks them. Human reviewers approve meaning and owners authorize releases. These are proposed capabilities, not an implemented agent runtime.

Printing always exports the 16-slide Leader narrative. Developer detail remains inspectable in the web page and native disclosures in the no-JavaScript fallback. This avoids expanding the print deck back into 31 pages.

## Consolidation coverage

| Slide | Topics retained |
|---|---|
| 1–5 | Product, problem, service, investment, complete architecture |
| 6 | Existing stack and eight context capabilities |
| 7 | Submission contract, STE-inspired preparation, human review |
| 8 | Canonical IDs, source mapping, four semantic categories |
| 9 | Bounded model decisions and memory lifecycle |
| 10 | Authorized delivery and failure contracts |
| 11 | Controlled evolution and four browser contract examples |
| 12 | Call anatomy, model cost planner, hidden work, monthly budget |
| 13 | Full operating cost, cost controls, investment worksheet |
| 14 | Pilot acceptance and current proof boundary |
| 15 | Seven delivery stages, development gates, bounded pilot offer |
| 16 | Eight primary references |

Source record hashes verify that all 31 original slide records remain exact. Consolidated diagrams are new proposed mappings; their labels distinguish them from reference material. Prices, settings and outcomes remain editable examples, not verified quotes or measured product savings. Writing remains **STE-inspired**; full ASD-STE100 compliance has not been checked.

## Edit and verify

- `presentation-content.json`: slide copy, submission template, architecture, cost inputs and references.
- `presentation-shell.html`: authored shell; `index.html` is the generated single-file page.
- `app.js`, `diagrams.js`, `mini-architectures.js`, `motion-runtime.js`, `styles.css`: interface and shared SVG motion.
- `cost-lab.js`, `cost-lab.css`: shared editable cost estimates and eight SVG charts.
- `scripts/build-static.cjs`: no-JavaScript presentation generation in `index.html`.
- `scripts/check-static.mjs`: static content, architecture and brand contracts.
- `scripts/verify-browser.cjs`: real Chromium arithmetic, geometry, motion, mobile, print and static checks.
- `scripts/verify-v7.cjs`: source cost goldens, independent arithmetic and visual/control checks.

Serve the canonical repository:

```powershell
python -m http.server 8893 --bind 127.0.0.1
```

Validate from another terminal:

```powershell
node --check mini-architectures.js
node --check app.js
node --check diagrams.js
node --check scripts/build-static.cjs
node --check scripts/verify-browser.cjs
node scripts/build-static.cjs
node scripts/build-static.cjs --check
node scripts/check-static.mjs
node scripts/check-coverage.cjs
node scripts/verify-browser.cjs
```

Browser validation needs Playwright and Chromium. Set `PREFRONTAL_PLAYWRIGHT_MODULE` to use an existing installation. Set `PREFRONTAL_BASE_URL` to test the published deck. The generated page also works at a local `file:` URL because it embeds the content.

## Publication and proof boundaries

A [local context-lifecycle pilot](pilot/README.md) now provides a separate Python
skeleton for deterministic lifecycle and maintenance tests. It uses synthetic data,
simulated reviewers and a JSON-lines interface. Run `python -m pilot.demo` to retain
SQLite/audit evidence; run `python -m unittest pilot.test_context_pilot -v` for its
acceptance cases. It is separate from the published presentation and does not
qualify the proposed enterprise product, live adapters, MCP or hybrid search.

The additive [knowledge reference interface](pilot/KNOWLEDGE.md) applies the same
review/publication controls to source-bound claims without requiring a metric,
period, currency, or all four semantic categories in every release. The
[agent workflow](pilot/AGENT_WORKFLOW.md) explains ingestion, evidence use,
corrections, and maintenance. Run all reference acceptance cases with
`python -m unittest discover -s pilot -t . -p 'test_*.py' -v`.

Reference acceptance covers metric and general-knowledge lifecycle cases,
scripted adapter/harness checks, and repository-source preparation. Run `python -m pilot.knowledge_demo` for
a self-contained knowledge database, source snapshot, targeted retrieval, and
reviewed correction. Model calls are opt-in and separate from deterministic CI;
scripted harness acceptance does not establish live agent effectiveness or human
review effort. The source workflow retains reproducible test/demo evidence for
each tested revision. The opt-in repository rehearsal uses two real documentation
files and 12 fixed questions. Its saved answers pass in both arms after a disclosed
citation-annotation correction; it establishes no speed or quality advantage.
The [MIT license](LICENSE) covers this repository's source.

The Pages workflow validates the browser workspace and preserves the earlier presentation, then assembles an explicit public-file allowlist from `main`. The workspace is the site entrypoint; the presentation stays under `presentation/`. User workspaces, the private corpus and Sheet, research, supplied ZIPs, local architecture sidecars, PDFs and screenshots are not included in the public package.

Working artifacts include the presentation and local reference code for persistent
admission, exact-version review, atomic publication, and checked delivery. Real
identity and decision-model qualification, semantic retrieval quality, hosted MCP,
enterprise adapters, infrastructure recovery/load, and customer return remain
unverified operating-product capabilities.

The writing is inspired by ASD-STE100. Full compliance has not been checked. Primary standards guide the proposal; they do not certify it. No flawless-operation, future-proofing, cost-saving or model-parity guarantee is claimed.

## Continuous scrolling presentation

Open `story.html` for the full 16-chapter story. The header links both formats at the current chapter. Diagrams stay beside stage explanations on wide screens; scrolling selects their authored stages. On smaller screens the story stacks vertically. All developer disclosures start open, and all four cost views appear in sequence. Pause and OS reduced-motion settings keep diagrams legible at rest. Both HTML files work offline.

Both formats use `presentation-content.json` and the same renderers. Run `node scripts/build-static.cjs` after edits; its `--check` flag verifies both generated files. Run `node scripts/verify-story.cjs` alongside the existing deck suite. Story print output includes expanded detail; use the original deck for the 16-page print layout. Search is proposed, not a deployed backend.

The scrolling view also has a 3D depth toggle, scroll-driven perspective, and a numbered step guide. Select a step to move to its explanation. Diagram text and all source material remain intact. Pausing motion, choosing flat view or using OS reduced motion removes perspective; narrow screens keep the diagram flat for legibility. The existing motion dispatcher drives depth, so no extra animation loop is created.

## Supervised engineering consumer

See [the supervised consumer contract](pilot/SUPERVISED.md) for bounded task
outputs, current task evidence and atomic multirecord delivery through the
existing local knowledge registry. Prior frozen rehearsal source and results
remain unchanged.

For current-repository retrieval in a normal Codex session, see the
[local Codex connection](pilot/CODEX.md). It uses scoped read-only MCP tools and
keeps new guide review/publication separate.
