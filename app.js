"use strict";
document.documentElement.classList.remove("no-js");

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const byId = id => document.getElementById(id);
let deckData;
let current = 0;
let showingOverview = false;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let motionPaused = reducedMotion.matches;
let motionOverride = false;
let printing = false;
const panels = [];
const navButtons = [];
const mechanisms = [];

function syncMotion() {
  const paused = motionPaused || reducedMotion.matches;
  byId("motion-toggle").textContent = reducedMotion.matches ? "Motion off" : paused ? "Play motion" : "Pause motion";
  byId("motion-toggle").disabled = reducedMotion.matches;
  byId("motion-toggle").setAttribute("aria-pressed", String(paused));
  mechanisms.forEach(controller => controller.setAllowed(!paused && !printing && !showingOverview && !document.hidden && controller.figure.closest(".slide") === panels[current]));
}

function createMechanism(kind, onStage = () => {}) {
  const figure = element("figure", "mechanism-figure");
  const svg = typeof kind === "string" ? window.ContextDiagrams.create(kind) : kind;
  const groups = [...svg.querySelectorAll("[data-step]")];
  const stages = [...svg.querySelectorAll("[data-stage]")];
  const caption = element("figcaption", "stage-caption");
  const heading = element("strong", "stage-title");
  const detail = element("p", "stage-detail");
  const controls = element("div", "stage-controls");
  const previous = element("button", "stage-prev", "← Stage");
  const next = element("button", "stage-next", "Stage →");
  previous.type = next.type = "button";
  previous.setAttribute("aria-label", "Previous diagram stage");
  next.setAttribute("aria-label", "Next diagram stage");
  const count = element("span", "stage-count");
  controls.append(previous, count, next);
  caption.append(heading, detail, controls);
  if (svg.classList.contains("industry-svg-flow")) {
    const viewport = element("div", "diagram-viewport");
    viewport.tabIndex = 0;
    viewport.setAttribute("role", "region");
    viewport.setAttribute("aria-label", "Industry workflow diagram. Scroll horizontally on a small screen.");
    viewport.append(svg);
    figure.append(viewport, element("p", "diagram-scroll-hint", "Swipe the diagram to follow the workflow. Focus it and use arrow keys to scroll."), caption);
  } else figure.append(svg, caption);
  let cursor = 0, visible = false, allowed = false, timer = null;
  const select = index => {
    cursor = (index + stages.length) % stages.length;
    const stage = stages[cursor];
    groups.forEach(group => group.classList.toggle("is-current", group.dataset.step === stage.dataset.step));
    svg.dataset.currentStep = stage.dataset.step;
    heading.textContent = stage.dataset.stage;
    detail.textContent = stage.dataset.stageDetail;
    count.textContent = `${cursor + 1} / ${stages.length}`;
    onStage(cursor);
  };
  const reconcile = () => {
    const play = allowed && visible;
    svg.dataset.playing = String(play);
    if (play && timer === null) {
      svg.unpauseAnimations?.();
      timer = window.setInterval(() => select(cursor + 1), 2400);
    } else if (!play) {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      svg.pauseAnimations?.();
    }
  };
  const controller = { figure, setAllowed(value) { allowed = value; reconcile(); } };
  const manualStep = delta => {
    motionPaused = true;
    motionOverride = true;
    syncMotion();
    select(cursor + delta);
  };
  previous.addEventListener("click", () => manualStep(-1));
  next.addEventListener("click", () => manualStep(1));
  figure.selectStage = index => manualStep(index - cursor);
  select(0);
  reconcile();
  // The observer supplies visibility changes; no per-frame JavaScript runs.
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .25;
    reconcile();
  }, { threshold: [0, .25] });
  observer.observe(svg);
  mechanisms.push(controller);
  return figure;
}

function renderItems(items = []) {
  const group = element("div", "items");
  for (const item of items) {
    const card = element("article", "item");
    card.append(element("h3", "", item.title), element("p", "", item.text));
    group.append(card);
  }
  return group;
}

function coreVisual() {
  const visual = element("div", "core-visual");
  visual.append(createMechanism("cover"));
  return visual;
}

function industryCitation(sector, compact = false) {
  const link = element("a", "industry-citation", compact ? sector.shortName + " · source" : sector.metric.sourceTitle);
  const url = new URL(sector.metric.sourceUrl);
  if (url.protocol !== "https:") throw new Error("Industry evidence must use HTTPS.");
  link.href = url.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function industryHero() {
  const visual = element("div", "industry-hero-visual");
  visual.append(createMechanism(window.ContextDiagrams.createIndustry("atlas", deckData.industries)));
  const sources = element("div", "atlas-sources");
  deckData.industries.forEach(sector => sources.append(industryCitation(sector, true)));
  visual.append(sources);
  return visual;
}

function industryMetric(sector, overview = false) {
  const card = element("article", "industry-metric");
  card.dataset.sector = sector.id;
  card.style.setProperty("--sector", sector.color);
  if (overview) card.append(element("h3", "sector-name", sector.name));
  card.append(element("strong", "metric-value", sector.metric.value), element("p", "metric-label", sector.metric.label), window.ContextDiagrams.createIndustry("metric", sector), element("p", "metric-period", sector.metric.period), element("p", "metric-scope", sector.metric.scope), industryCitation(sector));
  return card;
}

function industryOverview() {
  const grid = element("div", "industry-overview-grid");
  deckData.industries.forEach(sector => {
    const card = industryMetric(sector, true);
    const button = element("button", "industry-open-case", "Follow the workflow →");
    button.type = "button";
    button.addEventListener("click", () => showSlide(deckData.slides.findIndex(slide => slide.industry === sector.id)));
    card.append(button);
    grid.append(card);
  });
  return grid;
}

function industryCase(slide) {
  const sector = deckData.industries.find(item => item.id === slide.industry);
  const wrap = element("div", "industry-case");
  wrap.dataset.sector = sector.id;
  wrap.style.setProperty("--sector", sector.color);
  const intro = element("div", "industry-case-intro");
  const story = element("div", "industry-story");
  for (const [label, text] of [["The context problem", sector.problem], ["The proposed solution", sector.solution]]) {
    const block = element("article", "industry-story-block");
    block.append(element("h3", "", label), element("p", "", text));
    story.append(block);
  }
  story.append(element("p", "industry-owner-note", sector.humanGate), element("p", "industry-term", sector.metric.definition));
  intro.append(industryMetric(sector), story);
  wrap.append(intro, createMechanism(window.ContextDiagrams.createIndustry("flow", sector)), element("p", "industry-limit", sector.metric.limitation));
  return wrap;
}

function industryBridge() {
  const wrap = element("div", "industry-bridge");
  const selector = element("div", "sector-selector");
  selector.setAttribute("aria-label", "Choose the industry workflow");
  const grid = element("div", "industry-bridge-grid");
  const story = element("div", "bridge-story");
  const task = element("h3", "bridge-task");
  const evidence = element("ul", "bridge-evidence");
  const output = element("p", "bridge-output");
  const owner = element("strong", "bridge-owner");
  const test = element("p", "bridge-test");
  story.append(element("span", "design-label", "ILLUSTRATIVE TASK"), task, element("h4", "", "Context to carry"), evidence, element("h4", "", "Reviewable output"), output, element("h4", "", "Responsible owner"), owner, element("h4", "", "Proof still needed"), test);
  const buttons = deckData.industries.map((sector, i) => {
    const button = element("button", "", sector.shortName);
    button.type = "button";
    button.dataset.sector = sector.id;
    button.style.setProperty("--sector", sector.color);
    button.addEventListener("click", () => figure.selectStage(i));
    selector.append(button);
    return button;
  });
  const figure = createMechanism(window.ContextDiagrams.createIndustry("atlas", deckData.industries), index => {
    const sector = deckData.industries[index];
    buttons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
    wrap.dataset.sector = sector?.id || "shared";
    task.textContent = sector?.task || "Reuse the checks. Preserve the boundaries.";
    evidence.replaceChildren(...(sector?.inputs || ["Correct entity", "Current and historical dates", "Conditions and unresolved conflicts", "Evidence and verification status", "Scope, owner and action authority"]).map(value => element("li", "", value)));
    output.textContent = sector?.output || "An evidence-linked result for one authorized task. Private records stay inside the approved vault.";
    owner.textContent = sector?.owner || "The responsible domain owner";
    test.textContent = sector?.test || "Prove identity separation, meaning preservation and permission enforcement before increasing autonomy.";
  });
  grid.append(figure, story);
  wrap.append(selector, grid);
  return wrap;
}

function flowVisual() {
  const wrap = element("div", "");
  wrap.append(createMechanism("pipeline"), element("div", "trust-boundary", "A retrieved instruction cannot grant permission."));
  return wrap;
}

function memoryVisual() {
  const stack = element("div", "memory-stack");
  stack.append(createMechanism("memory"));
  return stack;
}

function routerVisual() {
  const visual = element("div", "router-visual");
  visual.append(createMechanism("router"),
    element("p", "router-rule", "Application code checks permissions before retrieval or action. Model confidence cannot override this check."));
  return visual;
}

function contractVisual() {
  const code = element("pre", "contract-card");
  code.textContent = `record: claim-017\nsource: policy-v3, paragraph 4\nproject: example-project\nvalid_from: 2026-09-01\nstatus: supported\nclaim: Keep reports for 30 days.\nexception: Keep disputed reports\n           until review ends.\nauthority: read-only\n\nFormat can change through migration.\nMeaning and permissions must survive.`;
  code.setAttribute("aria-label", "Illustrative context record with source, project, date, status, claim, exception and authority");
  return code;
}

function steVisual(slide) {
  const wrap = element("div");
  const example = element("div", "ste-example");
  for (const [label, text] of [
    ["ORIGINAL · ILLUSTRATIVE", "Reports should be retained for a period of 30 days, except where a dispute remains open, in which case retention continues until the review concludes."],
    ["STE-INSPIRED VIEW", "Keep reports for 30 days. If a dispute remains open, keep the report until the review ends."]
  ]) {
    const panel = element("div", "example-panel");
    panel.append(element("span", "label", label), element("p", "", text));
    example.append(panel);
  }
  wrap.append(example, renderItems(slide.items));
  return wrap;
}

const fixture = Object.freeze({
  id: "claim-017", source: "policy-v3:p4", project: "example-project",
  validFrom: "2026-09-01", claim: "Keep reports for 30 days.",
  exception: "Keep disputed reports until review ends.", permission: "read-only"
});
const adaptFixture = kind => {
  const candidate = { ...fixture };
  if (kind === "lost-evidence") { delete candidate.source; delete candidate.validFrom; }
  if (kind === "lost-exception") candidate.exception = "";
  if (kind === "permission-change") candidate.permission = "write";
  return candidate;
};

function upgradeVisual() {
  const wrap = element("div", "upgrade-layout");
  const controls = element("div", "upgrade-controls");
  controls.append(element("span", "demo-label", "ILLUSTRATIVE CONTRACT CHECKS"));
  const label = element("label", "", "Choose a proposed component change");
  label.htmlFor = "upgrade-kind";
  const select = element("select");
  select.id = "upgrade-kind";
  for (const [value, text] of [
    ["compatible", "New component preserves the contract"],
    ["lost-evidence", "New component drops evidence and dates"],
    ["lost-exception", "New summary drops an exception"],
    ["permission-change", "New agent tries to expand permission"]
  ]) { const option = element("option", "", text); option.value = value; select.append(option); }
  const run = element("button", "primary-button", "Run illustrative checks");
  run.type = "button";
  controls.append(label, select, element("p", "demo-caption", "This runs browser rules on one example record. It does not test a real model or prove production reliability."), run,
    element("pre", "demo-record", "ORIGINAL RECORD\nsource  policy-v3:p4\ndate    2026-09-01\nscope   example-project\nrule    30 days + dispute exception\naccess  read-only"));
  const results = element("div", "upgrade-results");
  results.setAttribute("aria-live", "polite");
  const summary = element("div", "demo-summary", "Run a scenario to inspect what the upgrade must preserve.");
  const checks = element("ul", "demo-checks");
  const evidence = element("p", "fixture-evidence", "The original record remains unchanged in every scenario. Real upgrade tests must cover many tasks and failure cases.");
  results.append(summary, checks, evidence);
  const evaluate = () => {
    const candidate = adaptFixture(select.value);
    const rows = [
      ["Source reference survives", candidate.source === fixture.source],
      ["Validity date survives", candidate.validFrom === fixture.validFrom],
      ["Project scope survives", candidate.project === fixture.project],
      ["Claim and exception survive", candidate.claim === fixture.claim && candidate.exception === fixture.exception],
      ["Permission stays within authority", candidate.permission === fixture.permission]
    ];
    checks.replaceChildren();
    for (const [description, passed] of rows) {
      const row = element("li");
      row.append(element("span", `check-mark ${passed ? "pass" : "fail"}`, passed ? "PASS" : "FAIL"), element("span", "", description));
      checks.append(row);
    }
    const accepted = rows.every(([, passed]) => passed);
    summary.dataset.outcome = accepted ? "accept" : "reject";
    summary.textContent = accepted ? "Example checks pass. Real evaluation is still required." : "Reject this example upgrade. Keep the current component.";
    evidence.textContent = `Example result: ${rows.filter(([, passed]) => passed).length} of ${rows.length} checks pass. No model was called. Original source, scope and permission remain unchanged.`;
  };
  run.addEventListener("click", evaluate);
  select.addEventListener("change", () => {
    checks.replaceChildren(); delete summary.dataset.outcome;
    summary.textContent = "Scenario changed. Run the checks for this scenario.";
    evidence.textContent = "No real model or external service is connected.";
  });
  wrap.append(controls, results);
  return wrap;
}

function sourcesVisual(sources = deckData.sources) {
  const group = element("div", "source-grid");
  for (const source of sources) {
    const card = element("article", "source-card");
    const link = element("a", "", source.title);
    const url = new URL(source.url);
    if (url.protocol !== "https:") throw new Error("Sources must use HTTPS.");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    card.append(link, element("p", "", source.note));
    group.append(card);
  }
  return group;
}

function renderSlide(slide, i) {
  const panel = element("section", `slide type-${slide.type}`);
  panel.id = `panel-${slide.id}`;
  panel.dataset.slide = slide.id;
  panel.setAttribute("aria-labelledby", `title-${slide.id}`);
  panel.hidden = true;
  const heading = element(i === 0 ? "h1" : "h2", "", slide.title);
  heading.id = `title-${slide.id}`;
  const eyebrow = element("p", "eyebrow", slide.eyebrow);
  const lead = element("p", "lead", slide.lead);
  if (slide.type === "cover") {
    const grid = element("div", "cover-grid");
    const words = element("div");
    const tags = element("div", "cover-tags");
    (slide.items || []).forEach(item => tags.append(element("span", "", item.title)));
    words.append(eyebrow, heading, lead, tags);
    grid.append(words, industryHero()); panel.append(grid);
  } else {
    panel.append(eyebrow, heading, lead);
    const visuals = { foundation: coreVisual, contract: contractVisual, pipeline: flowVisual, memory: memoryVisual, router: routerVisual };
    if (visuals[slide.type]) {
      const grid = element("div", "diagram-grid");
      grid.append(visuals[slide.type](), renderItems(slide.items)); panel.append(grid);
    } else if (slide.type === "ste") panel.append(steVisual(slide));
    else if (slide.type === "industry-overview") panel.append(industryOverview());
    else if (slide.type === "industry-case") panel.append(industryCase(slide));
    else if (slide.type === "industry-bridge") panel.append(industryBridge());
    else if (slide.type === "industry-sources") panel.append(sourcesVisual(deckData.industrySources));
    else if (slide.type === "upgrade") panel.append(upgradeVisual());
    else if (slide.type === "sources") panel.append(sourcesVisual());
    else panel.append(renderItems(slide.items));
  }
  if (slide.note) panel.append(element("p", "slide-note", slide.note));
  return panel;
}

function setOverview(show) {
  showingOverview = show;
  byId("overview").hidden = !show;
  byId("deck").hidden = show;
  byId("deck").style.display = show ? "none" : "";
  byId("overview-toggle").setAttribute("aria-expanded", String(show));
  if (show) byId("overview").querySelector("button")?.focus();
  syncMotion();
}

function showSlide(index, updateHash = true) {
  current = Math.max(0, Math.min(index, panels.length - 1));
  setOverview(false);
  panels.forEach((panel, i) => { panel.hidden = i !== current; });
  navButtons.forEach((button, i) => {
    if (i === current) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  const title = panels[current].querySelector("h1,h2");
  document.querySelector(".skip").href = `#${title.id}`;
  byId("slide-count").textContent = `${String(current + 1).padStart(2, "0")} / ${String(panels.length).padStart(2, "0")}`;
  byId("progress").style.width = `${(current + 1) / panels.length * 100}%`;
  byId("previous").disabled = current === 0;
  byId("next").disabled = current === panels.length - 1;
  document.title = `${deckData.slides[current].title} | Context that lasts`;
  if (updateHash) history.replaceState(null, "", `#${deckData.slides[current].id}`);
  syncMotion();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function indexFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  return deckData.slides.findIndex(slide => slide.id === id);
}

async function initialize() {
  try {
    const response = await fetch("presentation-content.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Content request failed (${response.status}).`);
    deckData = await response.json();
    if (!Array.isArray(deckData.slides) || !deckData.slides.length || !Array.isArray(deckData.sources)) throw new Error("The content file is incomplete.");
    const deck = byId("deck"); deck.replaceChildren();
    deckData.slides.forEach((slide, i) => {
      const panel = renderSlide(slide, i); panels.push(panel); deck.append(panel);
      const button = element("button", "nav-item"); button.type = "button";
      const navLabel = slide.industry ? deckData.industries.find(sector => sector.id === slide.industry).shortName + " workflow" : slide.eyebrow.split(" · ")[0];
      button.append(element("span", "nav-index", String(i + 1).padStart(2, "0")), element("span", "", navLabel));
      button.addEventListener("click", () => showSlide(i));
      navButtons.push(button); byId("slide-nav").append(button);
      const overview = element("button", "overview-card"); overview.type = "button";
      overview.append(element("span", "", `${String(i + 1).padStart(2, "0")} / ${slide.eyebrow}`), element("strong", "", slide.title));
      overview.addEventListener("click", () => showSlide(i)); byId("overview").append(overview);
    });
    deck.setAttribute("aria-busy", "false");
    showSlide(Math.max(0, indexFromHash()), false);
    byId("previous").addEventListener("click", () => showSlide(current - 1));
    byId("next").addEventListener("click", () => showSlide(current + 1));
    byId("overview-toggle").addEventListener("click", () => setOverview(!showingOverview));
    byId("print").addEventListener("click", () => window.print());
    byId("motion-toggle").addEventListener("click", () => { motionPaused = !motionPaused; motionOverride = true; syncMotion(); });
    reducedMotion.addEventListener("change", event => { if (!motionOverride) motionPaused = event.matches; syncMotion(); });
    document.addEventListener("visibilitychange", syncMotion);
    window.addEventListener("beforeprint", () => { printing = true; syncMotion(); });
    window.addEventListener("afterprint", () => { printing = false; syncMotion(); });
    byId("fullscreen").addEventListener("click", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      } catch { byId("fullscreen").textContent = "Unavailable"; }
    });
    document.addEventListener("fullscreenchange", () => { byId("fullscreen").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen"; });
    window.addEventListener("hashchange", () => { const index = indexFromHash(); if (index >= 0) showSlide(index, false); });
    document.addEventListener("keydown", event => {
      if (event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) || event.target.isContentEditable || event.target.closest(".diagram-viewport")) return;
      if (event.key === "Escape" && showingOverview) { setOverview(false); byId("overview-toggle").focus(); }
      if (showingOverview || event.target.tagName === "BUTTON" && event.key === " ") return;
      const routes = { ArrowRight: current + 1, PageDown: current + 1, ArrowLeft: current - 1, PageUp: current - 1, Home: 0, End: panels.length - 1 };
      if (Object.hasOwn(routes, event.key)) { event.preventDefault(); showSlide(routes[event.key]); }
    });
  } catch (error) {
    const failure = element("div", "empty-error");
    failure.append(element("h1", "", "The slides could not load."), element("p", "", "Serve this folder over HTTP, or reload the published page. Keep index.html, styles.css, app.js, diagrams.js and presentation-content.json together."), element("p", "", error.message));
    byId("deck").replaceChildren(failure); byId("deck").setAttribute("aria-busy", "false");
  }
}
initialize();
