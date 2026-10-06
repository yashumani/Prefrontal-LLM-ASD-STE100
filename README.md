# Context that can survive change

A browser presentation about developing a precise, governed context layer for a personal agent.

The 15 slides explain the problems, a proposed solution, a versioned context contract, layered memory, Jev-style decisions, STE-inspired writing, human review and development acceptance gates. The upgrade example runs simple browser checks on one illustrative record. It does not call a model or demonstrate production reliability.

## View and present

Open [the presentation](https://yashumani.github.io/Prefrontal-LLM-ASD-STE100/). Arrow keys move between slides. **Slides** opens the overview. The SVG diagrams highlight one stage at a time. Its caption explains the selected stage. **← Stage** and **Stage →** select a stage and pause playback. **Play motion** resumes it. Reduced-motion settings keep diagrams static. **Print / PDF** prints all slides. With JavaScript off, the page shows the complete static deck.

## Reusable motion technique

The diagrams use inline SVG. CSS color variables reach the SVG directly. The current stage has a gold outline. During playback, CSS dims the other stages. Paused diagrams show every stage at full opacity.

Each node declares `data-step`, `data-stage` and `data-stage-detail`. Incoming edges share the destination's step. One generic controller reads these attributes. A timer moves the stage cursor every 2.4 seconds. JavaScript does not animate each frame. The router's captions describe alternative routes; their presentation order does not prescribe an execution sequence.

Native SVG [`animateMotion`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/animateMotion) moves dots along the existing paths. CSS shows dots only on the selected edge during playback. The controller pauses the SVG's native timeline when playback stops.

An [`IntersectionObserver`](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API) permits playback when at least one quarter of the active SVG is visible. Playback also stops in the overview, on hidden slides, when the document is hidden, and during print. There is no offscreen stage timer.

[`prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) disables autoplay and hides dots. Manual stage controls remain available. Printing shows the entire diagram. The static generator includes all 15 slides and four SVGs in a no-JavaScript fallback. It removes the dots and their animation elements.

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
