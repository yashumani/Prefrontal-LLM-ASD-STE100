# Developer walkthrough coverage

The HTML is a self-contained documentation presentation, not a context service.

- Architecture source: `presentation-content.json` at `21bcd3f89ac19bc51e918c20cc822e483bf5b8ee` (14 nodes, 24 edges).
- Local pilot source: `5bf04d628cc7ac80e740fea0336f1367bf51c1be`; pilot code is not published by this documentation branch.
- Captured replay: `run-20261016T141518799544Z`; tested digest `9ddbd85209a0916bbdfb7e4e260a64ebb6d28611176fffc2aefe2fa35aed7a29`.
- Original Markdown guide: `34f7d6811b34dc29141ff9a29878c8f721d7d869`.

## Node coverage

| Covered | Exact node ID | Exact architecture title | Local status | Source and implementation |
|---|---|---|---|---|
| [x] | `submissions` | Submissions | implemented; see boundary in HTML | pilot/context_pilot.py · Registry.submit, Registry.feedback; pilot/sample_domain.py · records |
| [x] | `preparation` | Prepare + check | implemented; see boundary in HTML | pilot/context_pilot.py · Registry._validate_body, _path, evidence, source_hash, _current |
| [x] | `human-review` | Human review | simulated; see boundary in HTML | pilot/context_pilot.py · Registry.approve, hold_review, revoke |
| [x] | `canonical-registry` | Approved registry | implemented; see boundary in HTML | pilot/context_pilot.py · Registry.__init__, submit, _row, _current, audit |
| [x] | `context-agent` | Context agent + harness | proposed; see boundary in HTML | No autonomous context agent exists. Substitute: pilot/sample_domain.py · records; checks: Registry._validate_body, _bundle, dispatch |
| [x] | `decision-model` | Chosen decision model | proposed; see boundary in HTML | No model call or adapter. pilot/sample_domain.py · records supplies fixed choices; pilot/demo.py · run records llm_calls = 0. |
| [x] | `ontology-layer` | Ontology | implemented; see boundary in HTML | pilot/sample_domain.py · records; Registry._validate_body; Registry.search |
| [x] | `data-layer` | Data | implemented; see boundary in HTML | pilot/sample_domain.py · records; pilot/fixtures/orders.json; Registry.evidence, _current, _bundle |
| [x] | `metric-layer` | Metric | implemented; see boundary in HTML | pilot/sample_domain.py · records; pilot/fixtures/net_revenue.sql; pilot/native_sales.py · NativeSales.query; Registry._bundle |
| [x] | `interpretation-layer` | Interpretation | implemented; see boundary in HTML | pilot/sample_domain.py · records; Registry._validate_body, _bundle, revoke; pilot/demo.py · withdrawal |
| [x] | `mcp-delivery` | Publication + MCP | implemented; see boundary in HTML | pilot/context_pilot.py · Registry.publish, _bundle, get, dispatch; pilot/cli.py · main |
| [x] | `consumers` | Consumer applications | implemented; see boundary in HTML | pilot/consumers.py · consume; pilot/native_sales.py · NativeSales.query; Registry.feedback |
| [x] | `derived-search-index` | Derived search index | implemented; see boundary in HTML | pilot/context_pilot.py · search_tokens; Registry.publish rebuilds search_refs; Registry.search validates it. |
| [x] | `governed-retrieval` | Governed retrieval | implemented; see boundary in HTML | pilot/context_pilot.py · Registry._principal, _current, _bundle, get, dispatch, search |

Every node has purpose, inputs, outputs, developer action, owner responsibility, exact implementation references, source snippets and a status boundary in the HTML node inspector. The trusted-policy banner is cross-cutting, not a fifteenth node. The semantic layers are categories, not a required processing order.

## Example and evidence checks

- [x] Fresh existing demo: 3 consumers, identical context, USD 3300 -> USD 3400, 8 scenarios, durable readback, 0 LLM calls.
- [x] Existing acceptance suite: 42 tests; result OK; 127.053 seconds.
- [x] All 12 pilot file hashes match the captured replay manifest.
- [x] Runnable developer example executed successfully; all 20 Python, 9 JSON and 2 PowerShell snippets parse; SQL is the exact fixture executed by the native service.
- [x] Chromium checks passed: all 14 nodes, 6 replay controls, native clipboard readback, search/empty state, source navigation, presentation/keyboard controls, mobile menu, reduced motion, offline loading and print chapter visibility. Zero page/console errors and automatic network requests.

Verified viewports: 1440x1000, 1024x768, 390x844 and 360x800, with expanded code/scenario details and no page overflow. Visual desktop/mobile screenshots were reviewed locally and are not published. Companion receipt: CONTEXT_LAYER_DEVELOPER_VALIDATION.json. Only documentation artifacts are included; no runtime code or source-fixture changes. Simulated approval/identity, proposed model/agent/MCP/UI, single-month data, source-byte versus semantic truth and unmeasured human cost remain explicit boundaries.

## Delivery boundaries

The self-contained HTML loads offline; external repository links require a connection when opened. Download/open the HTML locally or use its Library attachment; GitHub blob view is source review, not a deployed application. Print retains all ten chapters but only the selected node inspector. This checklist retains the complete node/function mapping. Runtime code remains local-only and the captured replay does not execute inside the browser. Documentation branch is excluded from the Pages deployment workflow. No runtime publication, merge or deployment is included.
