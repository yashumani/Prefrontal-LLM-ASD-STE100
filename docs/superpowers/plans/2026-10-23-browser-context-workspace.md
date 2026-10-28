# Browser context workspace delivery

Base: `0497db5d5f9bc60e9a032d77c4b5a39d4ab6b1ae` on `main`.
Branch: `feat/browser-context-workspace`.

## Frozen scope

Deliver an open-source static context workspace for GitHub Pages. Start empty.
Keep the optional synthetic demo in a separate workspace and storage key.
Guided forms must let a nontechnical person add/import, validate, save, find,
compose and export context without code edits. Preserve the existing Python
registry, evaluation, pilot, real-corpus evidence and presentation.

Canonical record fields and JSON/Markdown/bounded-YAML semantics remain shared
with `prefrontal.context.v1`. Extend the typed model with glossary terms,
business events, policies and supporting documents. Keep pinned references and
atomic IDs; a changed display name creates a new version under the same ID.
Compose selectors at consumption. Never store Cartesian permutations.

Browser storage is origin/device-local, bounded and explicitly named. Save
means a write and readback succeeded. Export a versioned recovery archive.
Handle quota/unavailable storage, conflicts and invalid imports honestly.
Local attestation is not authenticated human approval or a registry release.
The browser consumer contract is a proposal preview with execution unauthorized.
Source text hashes do not establish external facts or native binding freshness.

The local context agent performs deterministic context orchestration only.
No model calls, credential fields, analytics, automatic uploads or source-query
execution. Downstream consumers own task logic and execution permissions.
User context is not evaluated by the fixed six-row synthetic benchmark.

## Architecture and ownership

- `workspace/core.mjs`, `formats.mjs`, `demo.mjs`: bounded context engine,
  canonical formats, local storage/recovery and explicit synthetic sample.
- `workspace/index.html`, `app.mjs`, `styles.css`: guided, accessible UI with
  persistent submission -> processing -> storage -> consumption transparency.
- `pilot/browser_workspace.py`: validate and stage proposals and original
  submissions for the governed Python path; never import browser authority.
- `workspace/guides/`: nontechnical quickstart, extension contract and measured
  scaling/migration boundaries. `AGENTS.md` and `LLM_HANDOFF.md` link this role.
- `scripts/build-pages.cjs`: explicit public-asset allowlist; workspace at site
  root, unchanged presentation under `presentation/`; no private artifacts.
- Pages workflow: build/test PRs; publish only reviewed main through the existing
  Pages mechanism, with no security or account changes.

## Acceptance and evidence

1. Fresh visitor has a usable empty workspace; demo never changes user state.
2. Guided add/import -> validate -> save -> search -> compose -> export works.
3. All four layers and the nine named record kinds have valid typed references.
4. Submission, original bytes, validation, storage location/ID/version and actual
   consumer payload are visible. Storage and connections are truthful.
5. Save/quota/recovery/concurrency and stable-ID changes have regression tests.
6. Canonical cross-language record hashes, formats and proposal bridge pass.
7. Browser workflow passes at 360/390 CSS pixels, desktop and repository subpath.
8. Clean release archive install and Python regressions pass; bounds are measured.
9. Push scoped PR and provide a short review-ready result before merge. After
   review direction, verify exact-main CI and the live Pages URL through normal
   deployment. No hosted backend or separate release is in scope.

Use simple, consistent STE-inspired language. Do not claim standard compliance,
unlimited scale, semantic approval, measured model uplift or secure browser ACLs.
