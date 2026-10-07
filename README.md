# Prefrontal · Governed context as a product

[Open the pitch](https://yashumani.github.io/Prefrontal-LLM-ASD-STE100/).

This 26-slide presentation sells a proposed context product and a bounded pilot. The first four slides explain the buyer problem, product and investment case. Slide five shows the complete architecture. Developer detail follows: submissions, review, canonical IDs, semantic layers, model decisions, controlled delivery, economics and implementation gates.

The product accepts structured submissions from humans and agent loops. Human reviewers approve meaning for an exact record version. A context agent organizes approved records into Data, Metric, Ontology and Interpretation layers. Canonical IDs connect the layers. A controlled MCP server delivers permitted context to independent applications. New meaning and feedback return through preparation and review. Consumers control their own actions.

## Brand reference

The design follows the supplied `cfpa-use-case-journey-v6.zip`. Its `Index.html` establishes white paper, black text, pale-gray surfaces, red `#EE001E`, bold sans-serif headings, rounded cards, pill controls and semantic SVG highlights. The deck uses locally available Arial. It imports no reference application scripts, backend code or backend behavior. The pitch uses the supplied planning content as a reference, with evidence boundaries below.

## Investment case

Slide four states an illustrative year-one break-even requirement. Invented inputs: 1,000 accepted tasks per month, 80% acceptance, $1,000 monthly overhead and $5,000 setup over 12 months. These require about $1.13 benefit per attempt across 1,250 monthly attempts. This is a hurdle to test, not a quote or forecast.

The editable worksheet begins with equal digital cost, handling time and acceptance for the current and proposed process. The proposed process adds operating overhead. This neutral case costs more. Buyers can inspect positive, negative and lower-acceptance scenarios.

```text
Attempts = monthly accepted-task target / acceptance rate
Recurring cost = attempts × (digital cost + handling minutes × hourly rate / 60) + fixed cost
Year-one net difference = 12 × monthly recurring difference − one-time setup
```

Digital cost includes inference, retrieval, warehouse queries, tools and variable infrastructure. Handling includes review, rework and escalation. Fixed cost includes seats, licenses, adapters and operations. Compare existing allocated and incremental costs consistently. Count each cost once. An accepted task meets the owner's task and quality criteria. Positive economics cannot override quality or access gates.

## Alignment with the supplied v6 plan

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

The v6 Best Practices section and cost scoring remain unapproved guidance. Candidate controls include deterministic methods, qualified model routing, bounded prompts and outputs, cache validity, batching when deadlines permit, step/retry limits, warehouse billing controls and license/role fit. The deck imports no vendor savings percentage or internal rate. Compare the same accepted workload, include cache writes/reads and storage, seats/concurrency, query charges, model calls, human review and operations, and retain failed or queued tasks in the evidence.

## View and present

Arrow keys move between slides. **Slides** opens the overview. **Full screen** enlarges the deck. **Print / PDF** prints all 26 slides.

Nine inline SVG diagrams share one stage controller. **Stage →** and **← Stage** select a stage and pause playback. **Play motion** resumes it. JavaScript moves the cursor every 2.4 seconds. Native SVG `animateMotion` moves dots along the visible directed paths. CSS highlights the current stage.

An `IntersectionObserver` permits playback only when at least one quarter of the active SVG is visible. Playback pauses on hidden slides, in the overview, when the document is hidden and during print. Reduced-motion settings keep diagrams still. At most one stage timer runs.

On small screens, architecture and workflow diagrams scroll within a focusable viewport. Focus the diagram and use arrow keys to scroll. The submission table also scrolls horizontally. The full no-JavaScript deck retains all copy, diagrams and the worked economic example.

## Edit and verify

- `presentation-content.json`: slide copy, submission template, architecture, cost inputs and references.
- `app.js`, `diagrams.js`, `styles.css`: presentation interface and motion graphics.
- `scripts/build-static.cjs`: no-JavaScript presentation generation in `index.html`.
- `scripts/check-static.mjs`: static content, architecture and brand contracts.
- `scripts/verify-browser.cjs`: real Chromium arithmetic, geometry, motion, mobile, print and static checks.

Serve the canonical repository:

```powershell
python -m http.server 8893 --bind 127.0.0.1
```

Validate from another terminal:

```powershell
node --check app.js
node --check diagrams.js
node --check scripts/build-static.cjs
node --check scripts/verify-browser.cjs
node scripts/build-static.cjs
node scripts/build-static.cjs --check
node scripts/check-static.mjs
node scripts/verify-browser.cjs
```

Browser validation needs Playwright and Chromium. Set `PREFRONTAL_PLAYWRIGHT_MODULE` to use an existing installation. Set `PREFRONTAL_TEST_URL` to test the published deck. A `file:` URL can prevent loading the JSON; use HTTP.

## Publication and proof boundaries

The existing Pages workflow validates and publishes the five public files from `feature/context-presentation`. It checks freshness, syntax and browser acceptance before deployment. Research, the supplied ZIP, local architecture sidecars, PDFs and screenshots remain outside the public package.

Working artifacts: the presentation, illustrative browser checks, editable worksheet and checked local architecture viewer. Still to implement and qualify: persistent admission, real decision-model integration, calibration, record-level authorization, MCP service, recovery, load and customer return.

The writing is inspired by ASD-STE100. Full compliance has not been checked. Primary standards guide the proposal; they do not certify it. No flawless-operation, future-proofing, cost-saving or model-parity guarantee is claimed.
