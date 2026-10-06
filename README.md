# Connect the context. Keep control.

A browser presentation about developing a precise, governed context layer across four industry workflows.

The 22 slides connect telecommunications, electricity utilities, healthcare and hospitality to a proposed context layer. Sourced infographics show industry pressure. Each case follows a task through its evidence, authority check and reviewable result. The architecture slides cover a versioned context contract, layered memory, Jev-style decisions, STE-inspired writing, human review and development gates. The upgrade example runs simple browser checks on one illustrative record. It does not call a model or demonstrate production reliability.

## Industry evidence and linked workflows

Each chart keeps its date, population, unit and primary source. The signals use different units and populations. They must not be ranked, averaged or combined into one score.

| Industry | Observed signal | Proposed workflow |
|---|---|---|
| Telecommunications | Global mobile network data traffic grew 23% from Q2 2025 to Q2 2026, including fixed wireless access. [Ericsson](https://www.ericsson.com/en/reports-and-papers/mobility-report/dataforecasts/mobile-traffic-update) | Connect an alert to the affected service, dated telemetry, changes and approved runbook. |
| Electricity utilities | At least 1,700 GW of advanced-stage renewable projects awaited connection globally in 2025. This is a capacity lower bound. [IEA](https://www.iea.org/reports/modernising-grids-in-the-age-of-electricity/executive-summary) | Assemble a connection review brief with current studies, model revisions and unresolved prerequisites. |
| Healthcare | In 2025, 93% of U.S. non-federal acute-care hospitals reported receiving outside summary records; 79% reported integration. These are weighted capability estimates. [ONC](https://healthit.gov/data/quickstats/electronic-health-information-exchange-hospitals/) | Draft a cited handoff with patient identity, observation dates, conflicts and clinician ownership. |
| Hospitality | 65% of 282 hotelier respondents reported staffing shortages in a survey conducted from 6 December 2024 to 3 January 2025. This dated, self-reported result is not a hotel census. [AHLA / Hireology](https://www.ahla.com/news/65-surveyed-hotels-report-staffing-shortages) | Carry an open guest request across shifts with verified status, owner, existing promises and escalation rules. |

The workflows are design proposals. The sources do not prove missing-context rates or operational benefits. The interactive **Same checks. Separate vaults.** slide connects each workflow to identity, time, conditions, evidence and authority. It keeps the industry records and permissions separate. Selecting an industry pauses playback and updates its task, evidence, owner, output and proposed acceptance check.

## View and present

Open [the presentation](https://yashumani.github.io/Prefrontal-LLM-ASD-STE100/). Arrow keys move between slides. **Slides** opens the overview. The SVG diagrams highlight one stage at a time. Its caption explains the selected stage. **← Stage** and **Stage →** select a stage and pause playback. **Play motion** resumes it. Reduced-motion settings keep diagrams static. **Print / PDF** prints all slides. With JavaScript off, the page shows the complete static deck.

On a small screen, swipe within an industry workflow diagram to read its labels. Keyboard users can focus that diagram and scroll with the arrow keys. The stage caption remains below the diagram.

## Reusable motion technique

The diagrams use inline SVG. CSS color variables reach the SVG directly. The current stage has a gold outline. During playback, CSS dims the other stages. Paused diagrams show every stage at full opacity.

Each node declares `data-step`, `data-stage` and `data-stage-detail`. Incoming edges share the destination's step. One generic controller reads these attributes. A timer moves the stage cursor every 2.4 seconds. JavaScript does not animate each frame. The router's captions describe alternative routes; their presentation order does not prescribe an execution sequence.

Native SVG [`animateMotion`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/animateMotion) moves dots along the existing paths. CSS shows dots only on the selected edge during playback. The controller pauses the SVG's native timeline when playback stops.

An [`IntersectionObserver`](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API) permits playback when at least one quarter of the active SVG is visible. Playback also stops in the overview, on hidden slides, when the document is hidden, and during print. There is no offscreen stage timer.

[`prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) disables autoplay and hides dots. Manual stage controls remain available. Printing shows the entire diagram. The static generator includes all 22 slides, ten staged SVG diagrams and eight evidence charts in a no-JavaScript fallback. It removes the travelling dots and their animation elements. The evidence charts show the same final values at rest. CSS alone handles their brief entry animation.

To view locally, serve this folder over HTTP:

```powershell
python -m http.server 8893 --bind 127.0.0.1
```

Open `http://127.0.0.1:8893/`. Opening the HTML as a `file:` URL will not load the content file in browsers that restrict local fetch requests.

## Edit and publish

- `presentation-content.json` contains the slide copy and sources.
- `index.html`, `styles.css`, `app.js` and `diagrams.js` contain the presentation interface and SVG motion graphics.
- `scripts/check-static.mjs` checks the static package.
- `scripts/build-static.cjs` regenerates the no-JavaScript fallback from the slide copy and SVG factory.
- `scripts/verify-browser.cjs` checks the deck and playback behavior in Chromium.
- `.github/workflows/pages.yml` validates and publishes the five public site files from `feature/context-presentation`.

```powershell
node --check app.js
node --check diagrams.js
node scripts/build-static.cjs
node scripts/build-static.cjs --check
node scripts/check-static.mjs
node scripts/verify-browser.cjs
```

Browser validation needs Playwright and its Chromium browser. The workflow installs pinned Playwright validation tools, runs the static and browser checks, then publishes the five site files. A local run needs the HTTP server shown above. Set `PREFRONTAL_PLAYWRIGHT_MODULE` if Playwright is available outside this repository. Set `PREFRONTAL_TEST_URL` to check a deployed site.

The workflow needs GitHub Pages configured to use GitHub Actions. Local research notes and validation artifacts are excluded from the published site. See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Evidence boundary

This is a development proposal. The context layer, model comparisons, personal memory ingestion and real upgrade/recovery tests remain unimplemented. Public model artifacts and framework documentation identify candidates; they do not qualify this system. The writing is inspired by ASD-STE100. Full compliance has not been checked.
