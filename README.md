# Context that can survive change

A browser presentation about developing a precise, governed context layer for a personal agent.

The 15 slides explain the problems, a proposed solution, a versioned context contract, layered memory, Jev-style decisions, STE-inspired writing, human review and development acceptance gates. The upgrade example runs simple browser checks on one illustrative record. It does not call a model or demonstrate production reliability.

## View and present

Use the published GitHub Pages site. Arrow keys move between slides. **Slides** opens the overview. SVG diagrams animate the evidence flow, memory stack and bounded decision routes. **Pause motion** stops animation; reduced-motion settings pause it by default. The memory diagram has selectable layers. **Print / PDF** prints all slides. Links point to the original research and author documentation.

To view locally, serve this folder over HTTP:

```powershell
python -m http.server 8893 --bind 127.0.0.1
```

Open `http://127.0.0.1:8893/`. Opening the HTML as a `file:` URL will not load the content file in browsers that restrict local fetch requests.

## Edit and publish

- `presentation-content.json` contains the slide copy and sources.
- `index.html`, `styles.css`, `app.js` and `diagrams.js` contain the presentation interface and SVG motion graphics.
- `scripts/check-static.mjs` checks the static package.
- `.github/workflows/pages.yml` validates and publishes the five public site files from `feature/context-presentation`.

```powershell
node --check app.js
node --check diagrams.js
node scripts/check-static.mjs
```

The workflow needs GitHub Pages configured to use GitHub Actions. It packages only the five site files. Local research notes and validation artifacts are excluded from the published site. See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Evidence boundary

This is a development proposal. The context layer, model comparisons, personal memory ingestion and real upgrade/recovery tests remain unimplemented. Public model artifacts and framework documentation identify candidates; they do not qualify this system. The writing is inspired by ASD-STE100. Full compliance has not been checked.
