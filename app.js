"use strict";
document.documentElement.classList.remove("no-js");

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const byId = id => document.getElementById(id);
const storyMode = document.body.dataset.presentation === 'story';
let deckData;
let current = 0;
let slideRequest = 0;
let showingOverview = false;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let motionPaused = false;
let printing = false;
const panels = [];
const navButtons = [];
const mechanisms = [];

function syncMotion() {
  const state = window.ContextMotion.state();
  motionPaused = state.paused;
  const paused = state.stopped;
  document.body.classList.toggle('motion-paused', paused);
  document.querySelectorAll('[data-motion]').forEach(button => {
    button.textContent = reducedMotion.matches ? 'Motion off' : paused ? 'Play motion' : 'Pause motion';
    button.disabled = reducedMotion.matches;
    button.setAttribute('aria-pressed', String(paused));
  });
  mechanisms.forEach(controller => controller.setAllowed(!paused && !showingOverview && !document.hidden && (storyMode || controller.figure.closest('.slide') === panels[current])));
}

function createMechanism(kind, onStage = () => {}) {
  const figure = element('figure', 'mechanism-figure');
  const svg = typeof kind === 'string' ? window.ContextDiagrams.create(kind) : kind;
  const groups = [...svg.querySelectorAll('[data-step]')];
  const stages = [...svg.querySelectorAll('[data-stage]')];
  const caption = element('figcaption', 'stage-caption');
  const heading = element('strong', 'stage-title');
  const detail = element('p', 'stage-detail');
  const controls = element('div', 'stage-controls');
  const previous = element('button', 'stage-prev', '← Stage');
  const next = element('button', 'stage-next', 'Stage →');
  const pause = element('button', 'figure-motion', 'Pause motion');
  pause.dataset.motion = '';
  previous.type = next.type = pause.type = 'button';
  previous.setAttribute('aria-label','Previous diagram stage');
  next.setAttribute('aria-label','Next diagram stage');
  const count = element('span','stage-count');
  controls.append(previous,count,next,pause);
  caption.append(heading,detail,controls);
  const viewport = element('div', 'diagram-viewport' + (svg.classList.contains('architecture-svg') ? ' architecture-viewport' : ''));
  viewport.tabIndex=0; viewport.setAttribute('role','region');
  viewport.setAttribute('aria-label','Workflow diagram. Scroll horizontally on a small screen.');
  const panHint=element('p','diagram-pan-hint','Full diagram → Scroll sideways to follow every stage.');
  viewport.append(svg);figure.append(panHint,viewport,caption);
  // Native path geometry supplies packet positions. No independent SMIL clocks.
  const packets = [...svg.querySelectorAll('.m-dot')].map(dot => {
    const ref=dot.dataset.path || dot.querySelector('mpath')?.getAttribute('href');
    const path=ref && svg.querySelector(ref);
    dot.replaceChildren();
    if (!path) return null;
    const length=path.getTotalLength();
    const points=Array.from({length:81},(_,i)=>{const p=path.getPointAtLength(length*i/80);return [p.x,p.y];});
    return {dot,points};
  }).filter(Boolean);
  let cursor=0,base=0,lastTime=0;
  const select=index=>{
    cursor=(index+stages.length)%stages.length;
    const stage=stages[cursor];if(!stage)return;
    svg.classList.remove('is-static');
    groups.forEach(group=>group.classList.toggle('is-current',(group.dataset.steps || group.dataset.step).split(',').includes(stage.dataset.step)));
    svg.dataset.currentStep=stage.dataset.step;
    heading.textContent=stage.dataset.stage;detail.textContent=stage.dataset.stageDetail;
    count.textContent=`${cursor+1} / ${stages.length}`;onStage(cursor);
  };
  const finalFrame=()=>{
    svg.classList.add('is-static');svg.dataset.playing='false';
    heading.textContent='Complete mechanism';detail.textContent='Read every stage. Use the arrows to inspect one stage.';
  };
  const runtime=window.ContextMotion.register({element:svg,staticFrame:finalFrame,frame:t=>{
    lastTime=t;svg.dataset.playing='true';svg.dataset.elapsed=String(t);
    const nextCursor=storyMode && figure.dataset.scrollStage !== undefined ? Number(figure.dataset.scrollStage) : Math.floor((t-base)/2.4)%stages.length;
    if(nextCursor!==cursor||svg.classList.contains('is-static'))select(nextCursor);
    packets.forEach(({dot,points},i)=>{const f=((t/1.6+i*.17)%1)*80,j=Math.floor(f),r=f-j,a=points[j],b=points[Math.min(j+1,80)];dot.setAttribute('transform',`translate(${a[0]+(b[0]-a[0])*r} ${a[1]+(b[1]-a[1])*r})`);});
  }});
  const manualStep=delta=>{window.ContextMotion.setPaused(true);select(cursor+delta);base=lastTime-cursor*2.4;};
  previous.addEventListener('click',()=>manualStep(-1));next.addEventListener('click',()=>manualStep(1));
  figure.selectStage=index=>manualStep(index-cursor);
  figure.scrollStage=index=>{figure.dataset.scrollStage=String(index);if(!motionPaused&&!reducedMotion.matches&&!printing){select(index);svg.dataset.playing='true';}};
  select(0);
  mechanisms.push({figure,setAllowed(value){svg.dataset.playing=String(value);runtime.setAllowed(value);if(!value&& (motionPaused||reducedMotion.matches||printing))finalFrame();}});
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
  visual.append(createMechanism(window.ContextDiagrams.createIndustry("product", deckData.pitch)));
  visual.append(element("p", "product-status", deckData.pitch.maturity));
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
  story.append(element("p", "industry-value-note", "Buyer goal to test: " + sector.benefit + " " + sector.buyerMetric), element("p", "industry-owner-note", sector.humanGate), element("p", "industry-term", sector.metric.definition));
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
    element("p", "router-rule", "The harness enforces policy and checks output schema. Human reviewers approve new meaning."));
  return visual;
}

function contractVisual() {
  const code = element("pre", "contract-card");
  code.textContent = `canonical_id: interpretation:reports-retention\nversion: 3\nworkspace: operations\nsource: policy-v3, paragraph 4\nvalid_from: 2026-09-01\nstatus: approved\nclaim: Keep reports for 30 days.\nexception: Keep disputed reports\n           until review ends.\ninput_refs: [data:reports-policy@3]\nreview: owner + exact content hash\naccess: operations-readers\n\nIDs identify records. IDs grant no access.`;
  code.setAttribute("aria-label", "Illustrative context record with source, project, date, status, claim, exception and authority");
  return code;
}

function steVisual(slide) {
  const wrap = element("div");
  const example = element("div", "ste-example");
  for (const [label, text] of [
    ["ORIGINAL · ILLUSTRATIVE", "Reports should be retained for a period of 30 days, except where a dispute remains open, in which case retention continues until the review concludes."],
    ["STE-INSPIRED VIEW", "You should keep reports for 30 days. If a dispute remains open, you should keep the report until the review ends."]
  ]) {
    const panel = element("div", "example-panel");
    panel.append(element("span", "label", label), element("p", "", text));
    example.append(panel);
  }
  wrap.append(example);
  if (slide.infographic) wrap.append(createMechanism(window.ContextDiagrams.createInfographic(slide.infographic)));
  else wrap.append(renderItems(slide.items));
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

function conferenceVisual() {
  const conference = deckData.pitch.conference;
  const wrap = element("div", "conference-insights");
  const grid = element("div", "conference-grid");
  conference.insights.forEach(insight => {
    const card = element("article", "conference-insight");
    card.append(element("span", "design-label", "FIELD INSIGHT · EXHIBITS " + insight.exhibits), element("h3", "", insight.title), element("p", "", insight.observation), element("h4", "", "Product implication"), element("p", "", insight.application));
    grid.append(card);
  });
  const link = element("a", "conference-citation", conference.title);
  link.href = conference.url; link.target = "_blank"; link.rel = "noopener noreferrer";
  wrap.append(grid, element("p", "conference-scope", conference.eventDate + " · " + conference.exhibits + " exhibits. " + conference.scope), link);
  return wrap;
}

function valueVisual() {
  const grid = element("div", "value-grid");
  deckData.pitch.lenses.forEach(lens => {
    const card = element("article", "value-lens");
    card.dataset.lens = lens.id; card.style.setProperty("--sector", lens.color);
    card.append(element("span", "value-name", lens.name), element("h3", "", lens.goal), element("p", "value-mechanism", lens.mechanism), element("h4", "", "Measure"), element("p", "value-measure", lens.measure), element("p", "value-guardrail", lens.guardrail));
    grid.append(card);
  });
  return grid;
}

function proofVisual() {
  const grid = element("div", "proof-grid");
  deckData.pitch.scorecard.forEach(plan => {
    const card = element("article", "proof-card");
    card.dataset.lens = plan.id;
    card.append(element("h3", "", plan.name), element("h4", "", "Measure"), element("p", "", plan.metric), element("h4", "", "Trial"), element("p", "", plan.trial), element("h4", "", "Expansion gate"), element("p", "proof-decision", plan.decision));
    grid.append(card);
  });
  return grid;
}

function businessCaseVisual() {
  const model = deckData.pitch.businessCase;
  const wrap = element("div", "business-case");
  const grid = element("div", "business-case-grid");
  const controls = element("div", "business-case-controls");
  const inputs = new Map();
  const labels = {target:"Accepted tasks / month",hourly:"Handling cost / hour ($)",setup:"One-time setup ($)",baselineCost:"Digital cost / attempt ($)",candidateCost:"Digital cost / attempt ($)",baselineMinutes:"Handling minutes / attempt",candidateMinutes:"Handling minutes / attempt",baselineAcceptance:"Accepted attempts (%)",candidateAcceptance:"Accepted attempts (%)",baselineFixed:"Fixed cost / month ($)",candidateFixed:"Fixed cost / month ($)"};
  const group = (title,keys) => {
    const fieldset = element("fieldset", "business-case-group");
    fieldset.append(element("legend", "", title));
    keys.forEach(key => {
      const label = element("label", "", labels[key]);
      const input = element("input", "");
      input.type = "number"; input.id = "bc-" + key; input.value = model.defaults[key]; input.min = key === 'target' ? '1' : key.includes('Acceptance') ? '.01' : '0'; input.step = "any";
      if(key.includes('Acceptance')) input.max = '100';
      label.htmlFor = input.id; label.append(input); fieldset.append(label); inputs.set(key,input);
    });
    return fieldset;
  };
  controls.append(group("Example assumptions · USD",['target','hourly','setup']));
  const comparison = element("div", "business-case-comparison");
  comparison.append(group("Current process",['baselineCost','baselineMinutes','baselineAcceptance','baselineFixed']),group("Proposed process",['candidateCost','candidateMinutes','candidateAcceptance','candidateFixed']));
  controls.append(comparison);
  const results = element("div", "business-case-results");
  const resultLabels = {baseline:'Current recurring / month',candidate:'Proposed recurring / month',difference:'Recurring difference / month',yearOne:'Year-one net difference'};
  const outputs = new Map();
  for(const [key,label] of Object.entries(resultLabels)){
    const card = element("div", "business-case-result");
    const output = element("strong", ""); output.dataset.result = key;
    card.append(element("span", "", label),output); outputs.set(key,output);
    if(key==='baseline'||key==='candidate'){
      const unit = element("span", "business-case-unit"); unit.dataset.result = key+'Unit'; outputs.set(key+'Unit',unit); card.append(unit);
    }
    results.append(card);
  }
  const status = element("p", "business-case-status"); status.setAttribute("aria-live", "polite");
  const error = element("p", "business-case-error"); error.setAttribute("role", "alert"); error.hidden = true;
  const resultSide = element("div", "business-case-result-side"); resultSide.append(results,status,error);
  grid.append(controls,resultSide);
  wrap.append(grid,element("p", "business-case-definition",model.definition),element("p", "business-case-formula",model.formula),element("p", "business-case-scope",model.costScope),element("p", "business-case-note",model.limitation));
  const money = new Intl.NumberFormat('en-US',{style:'currency',currency:model.currency,maximumFractionDigits:2});
  const update = () => {
    const values = Object.fromEntries([...inputs].map(([key,input])=>[key,input.value.trim() === '' ? NaN : Number(input.value)]));
    const invalid = Object.values(values).some(value=>!Number.isFinite(value)||value<0)||values.target<=0||['baselineAcceptance','candidateAcceptance'].some(key=>values[key]<=0||values[key]>100);
    const monthly = prefix => values.target/(values[prefix+'Acceptance']/100)*(values[prefix+'Cost']+values[prefix+'Minutes']*values.hourly/60)+values[prefix+'Fixed'];
    const baseline=monthly('baseline'),candidate=monthly('candidate'),difference=baseline-candidate;
    const totals={baseline,candidate,difference,yearOne:12*difference-values.setup,baselineUnit:baseline/values.target,candidateUnit:candidate/values.target};
    if(invalid||Object.values(totals).some(value=>!Number.isFinite(value))){
      wrap.dataset.state='invalid';results.hidden=true;status.textContent='';error.hidden=false;
      error.textContent='Enter finite, nonnegative costs and a positive task target. Acceptance must be greater than 0% and at most 100%. Keep values within a calculable range.';
      outputs.forEach(output=>{output.textContent='';delete output.dataset.value;});
      return;
    }
    wrap.dataset.state='illustrative'; results.hidden=false;error.hidden=true;
    results.dataset.outcome=difference<0?'higher-cost':'lower-cost';
    for(const [key,value] of Object.entries(totals)){
      const output=outputs.get(key); output.dataset.value=String(value); output.textContent=money.format(value)+(key.endsWith('Unit')?' / accepted task':'');
    }
    status.textContent=difference<0?'These assumptions produce higher recurring cost. Revisit the case before committing.':'These assumptions produce lower recurring cost. Validate the inputs and all quality gates in a pilot.';
    if(values.candidateAcceptance<values.baselineAcceptance) status.textContent+=' The proposed acceptance assumption is lower; inspect that quality trade-off.';
    if(totals.yearOne<0)status.textContent+=' One-time setup exceeds the first-year recurring difference.';
  };
  inputs.forEach(input=>input.addEventListener('input',update)); update();
  return wrap;
}

function leadershipCaseVisual(compact = false) {
  const a = deckData.pitch.economicHurdle;
  const attempts = a.acceptedTarget / (a.acceptancePercent / 100);
  const monthlyRequired = a.monthlyOverhead + a.setup / a.months;
  const perAttempt = monthlyRequired / attempts;
  const handlingMinutes = perAttempt / (a.hourly / 60);
  const wrap = element('div', 'leadership-case' + (compact ? ' leadership-case-compact' : ''));
  const hero = element('div', 'investment-hurdle');
  hero.append(element('span', 'design-label', 'ILLUSTRATIVE BREAK-EVEN REQUIREMENT · USD'));
  const amount = element('strong', 'hurdle-amount', '$' + perAttempt.toFixed(2));
  amount.dataset.hurdle = 'perAttempt'; amount.dataset.value = String(perAttempt);
  hero.append(amount, element('p', 'hurdle-unit', 'required benefit per attempt in year one'));
  const assumptions = element('p', 'hurdle-assumptions', `${a.acceptedTarget.toLocaleString()} accepted tasks/month · ${a.acceptancePercent}% accepted attempts · $${a.monthlyOverhead.toLocaleString()} monthly overhead · $${a.setup.toLocaleString()} setup over ${a.months} months`);
  const supporting = element('div', 'hurdle-support');
  for (const [key,value,label] of [['attempts',attempts,'attempts per month'],['monthlyRequired',monthlyRequired,'required benefit per month'],['handlingMinutes',handlingMinutes,`handling minutes per attempt at $${a.hourly}/hour`]]) {
    const row=element('span'); row.dataset.hurdle=key; row.dataset.value=String(value);
    row.textContent=(key==='monthlyRequired'?'$':'') + value.toLocaleString('en-US',{maximumFractionDigits:2}) + ' ' + label;
    supporting.append(row);
  }
  hero.append(assumptions,supporting,element('p','hurdle-definition','Benefit may come from lower operating cost or separately evidenced business value. Avoid counting the same benefit twice.'));
  const lenses=element('div','executive-lenses');
  deckData.pitch.lenses.forEach(lens=>{
    const card=element('article','executive-lens'); card.style.setProperty('--sector',lens.color); card.dataset.lens=lens.id;
    card.append(element('h3','',lens.name),element('p','',lens.goal)); lenses.append(card);
  });
  wrap.append(hero);
  if (!compact) wrap.append(lenses);
  return wrap;
}

function submissionVisual(slide) {
  const wrap=element('div','submission-layout');
  const region=element('div','submission-table-region');region.tabIndex=0;region.setAttribute('role','region');region.setAttribute('aria-label','Illustrative submission review table');
  const table=element('table','submission-table');
  table.append(element('caption','','One proposed record · original evidence remains attached'));
  const head=element('thead'), tr=element('tr');
  ['Field','Illustrative value','Reviewer check'].forEach(label=>{const th=element('th','',label);th.scope='col';tr.append(th);});head.append(tr);table.append(head);
  const body=element('tbody');
  deckData.submission.forEach(row=>{const tr=element('tr'),th=element('th','',row.field);th.scope='row';tr.append(th,element('td','',row.value),element('td','',row.check));body.append(tr);});
  table.append(body);region.append(table);wrap.append(region,renderItems(slide.items));return wrap;
}

function presenterDetail(slide) {
  const details = element("details", "presenter-detail");
  details.append(element("summary", "", "Presenter detail"), renderItems(slide.items));
  return details;
}

function pitchSignals(slide) {
  const group = element('div', 'pitch-signals');
  group.setAttribute('aria-label', 'Leadership takeaways');
  (slide.pitchSignals || []).forEach(signal => {
    const card = element('article', 'pitch-signal');
    card.append(element('h3', '', signal.title), element('p', '', signal.text));
    group.append(card);
  });
  return group;
}

function miniPitchVisual(slide) {
  const wrap = element('div', 'mini-focus-visual pitch-mechanism');
  wrap.append(createMechanism(window.ContextMiniArchitectures.create(slide.miniArchitecture)));
  wrap.append(element('p', 'provenance', slide.miniArchitecture.provenance || 'Proposal · not from the reference slides'));
  if (slide.type === 'leadership-case') wrap.append(leadershipCaseVisual(true));
  if (slide.pitchSignals?.length) wrap.append(pitchSignals(slide));
  if (slide.items.length) {
    const detail = presenterDetail(slide);
    detail.classList.add('dev');
    wrap.append(detail);
  }
  return wrap;
}

function developerDetails(slide) {
  const wrap=element('div','dev developer-content');
  wrap.append(element('p','detail-intro','Developer view keeps every original topic. Open a section for contracts, examples, checks, and source detail.'));
  slide.sections.forEach(source=>{
    const disclosure=element('details','developer-topic');disclosure.dataset.sourceSlide=source.id;
    disclosure.append(element('summary','',source.title));
    const section=renderSlide(source,1);section.hidden=false;section.classList.remove('slide');section.classList.add('developer-section');section.removeAttribute('data-slide');section.id='detail-'+source.id;section.removeAttribute('aria-labelledby');section.setAttribute('aria-label',source.title);
    section.querySelector('.eyebrow')?.remove();section.querySelector('h2')?.remove();
    const presenter=section.querySelector('.presenter-detail');if(presenter)presenter.open=true;
    if(source.items.length&&!section.querySelector('.items'))section.append(renderItems(source.items));
    disclosure.append(section);wrap.append(disclosure);
  });return wrap;
}
function consolidatedVisual(slide) {
  const wrap=element('div','consolidated-visual');
  const diagram=element('div',slide.miniArchitecture?'mini-focus-visual':'leadonly');
  diagram.append(createMechanism(slide.miniArchitecture ? window.ContextMiniArchitectures.create(slide.miniArchitecture) : window.ContextDiagrams.createInfographic(slide.infographic)));
  diagram.append(element('p','provenance',(slide.miniArchitecture || slide.infographic).provenance || 'Proposal · not from the reference slides'));
  if (slide.pitchSignals?.length) diagram.append(pitchSignals(slide));
  if (slide.agentExplanation) {
    const agent=slide.agentExplanation;
    const strip=element('div','agent-role-strip');
    strip.dataset.agentExplanation=slide.id;
    strip.append(element('strong','',agent.title),element('p','',agent.definition));
    diagram.append(strip);
    const detail=element('details','dev agent-detail developer-topic');
    detail.append(element('summary','','Agent responsibilities and decision evidence'));
    const body=element('div','agent-detail-body');
    const steps=element('ol','agent-steps');
    agent.steps.forEach(step=>{const row=element('li','');row.append(element('strong','',step.title),element('p','',step.text));steps.append(row);});
    body.append(steps);
    const contract=element('div','agent-contract');
    [['Inputs',agent.inputs],['Outputs',agent.outputs],['Authority limits',agent.limits]].forEach(([title,values])=>{
      const column=element('section','');column.append(element('h3','',title));const list=element('ul','');values.forEach(value=>list.append(element('li','',value)));column.append(list);contract.append(column);
    });
    body.append(contract);detail.append(body);diagram.append(detail);
  }
  const strip=element('div','topic-strip');
  slide.sections.forEach((source,i)=>{const chip=element('button','',slide.detailLabels?.[i]||source.title);chip.type='button';chip.addEventListener('click',()=>{byId('audience-dev').click();const topic=wrap.querySelector('[data-source-slide="'+source.id+'"]');topic.open=true;topic.scrollIntoView({block:'start',behavior:'instant'});});strip.append(chip);});
  if(slide.miniArchitecture){const map=element('button','full-map-link','Full architecture ↗');map.type='button';map.addEventListener('click',()=>showSlide(deckData.slides.findIndex(s=>s.id==='full-architecture')));strip.append(map);}
  diagram.append(strip);wrap.append(diagram,developerDetails(slide));return wrap;
}
function costSuite(slide) {
  const wrap=element('div','cost-suite');
  const selector=element('div','suite-tabs');selector.setAttribute('role','group');selector.setAttribute('aria-label','Cost infographic view');
  const pages=element('div','suite-pages');
  const views=[['planner','Task cost'],['hidden','Hidden work'],['budget','Monthly budget'],['anatomy','Call anatomy']];
  views.forEach(([view,label],i)=>{
    const button=element('button','',label);button.type='button';button.dataset.costView=view;button.setAttribute('aria-pressed',String(i===0));
    const page=element('div','suite-page');page.dataset.costPage=view;page.hidden=i!==0;
    if(view==='anatomy')page.append(createMechanism(window.ContextDiagrams.createTokenCost(slide.sections[0].tokenCost)));
    else page.append(window.ContextCostLab.create(view,deckData.costLab));
    button.addEventListener('click',()=>{[...pages.children].forEach(p=>p.hidden=p!==page);[...selector.children].forEach(b=>b.setAttribute('aria-pressed',String(b===button)));syncMotion();});
    selector.append(button);pages.append(page);
  });wrap.append(selector,pages,element('p','provenance','Reference examples · CFP&A v7 cost section. Editable assumptions; no measured product savings.'));
  const source=element('details','dev developer-topic');source.append(element('summary','','Original cost explanations and token assumptions'));
  slide.sections.forEach(section=>{const block=element('article','cost-source-copy');block.dataset.sourceSlide=section.id;block.append(element('h3','',section.title),element('p','',section.lead),renderItems(section.items));if(section.note)block.append(element('p','',section.note));source.append(block);});wrap.append(source);return wrap;
}

function renderSlide(slide, i) {
  const panel = element("section", `slide type-${slide.type}`);
  if (slide.miniArchitecture) panel.classList.add('has-mini-architecture');
  if (slide.pitchSignals?.length) panel.classList.add('has-pitch-signals');
  panel.id = `panel-${slide.id}`;
  panel.dataset.slide = slide.id;
  panel.setAttribute("aria-labelledby", `title-${slide.id}`);
  panel.hidden = true;
  const heading = element(i === 0 ? "h1" : "h2", "", slide.title);
  heading.id = `title-${slide.id}`;
  const eyebrow = element("p", "eyebrow", slide.eyebrow);
  const lead = element("p", "lead", slide.lead);
  if (slide.miniArchitecture && slide.type !== 'consolidated') {
    panel.append(eyebrow, heading, lead, miniPitchVisual(slide));
  } else if (slide.type === "cover") {
    const grid = element("div", "cover-grid");
    const words = element("div");
    const tags = element("div", "cover-tags");
    (slide.items || []).forEach(item => tags.append(element("span", "", item.title)));
    words.append(eyebrow, heading, lead, tags);
    grid.append(words, industryHero()); panel.append(grid);
  } else {
    panel.append(eyebrow, heading, lead);
    const visuals = { foundation: coreVisual, contract: contractVisual, pipeline: flowVisual, memory: memoryVisual, router: routerVisual };
    if (slide.type === "cost-suite") panel.append(costSuite(slide));
    else if (slide.type === "consolidated") panel.append(consolidatedVisual(slide));
    else if (slide.infographic) {
      panel.classList.add("has-infographic");
      panel.append(slide.type === "ste" ? steVisual(slide) : createMechanism(window.ContextDiagrams.createInfographic(slide.infographic)));
      if (slide.items.length) panel.append(presenterDetail(slide));
    } else if (slide.tokenCost) panel.append(createMechanism(window.ContextDiagrams.createTokenCost(slide.tokenCost)));
    else if (slide.type === "cost-lab") panel.append(window.ContextCostLab.create(slide.costView, deckData.costLab));
    else if (visuals[slide.type]) {
      const grid = element("div", "diagram-grid");
      grid.append(visuals[slide.type](), renderItems(slide.items)); panel.append(grid);
    } else if (slide.type === "ste") panel.append(steVisual(slide));
    else if (slide.type === "industry-overview") panel.append(industryOverview());
    else if (slide.type === "industry-case") panel.append(industryCase(slide));
    else if (slide.type === "industry-bridge") panel.append(industryBridge());
    else if (slide.type === "industry-sources") panel.append(sourcesVisual(deckData.industrySources));
    else if (slide.type === "pitch-insights") panel.append(conferenceVisual());
    else if (slide.type === "pitch-value") panel.append(valueVisual());
    else if (slide.type === "pitch-proof") panel.append(proofVisual());
    else if (slide.type === "pitch-calculator") panel.append(businessCaseVisual());
    else if (slide.type === "leadership-case") panel.append(leadershipCaseVisual());
    else if (slide.type === "submission") panel.append(submissionVisual(slide));
    else if (slide.type === "product-flow") panel.append(createMechanism(window.ContextDiagrams.createProductFlow(slide.flow)),renderItems(slide.items));
    else if (slide.type === "architecture") {
      panel.append(createMechanism(window.ContextDiagrams.createArchitecture(deckData.architecture)), element("p", "architecture-legend", deckData.architecture.legend));
    }
    else if (slide.type === "upgrade") panel.append(upgradeVisual());
    else if (slide.type === "sources") panel.append(sourcesVisual());
    else panel.append(renderItems(slide.items));
  }
  if(i===0){
    const audience=element('p','product-audience','For AI, data and governance teams');
    const actions=element('div','product-actions');
    [['primary-action','Explore the architecture ↗','full-architecture'],['secondary-action','Review the pilot →','pilot-acceptance']].forEach(([cls,label,id])=>{
      const link=element('a',cls,label);link.href='#'+id;actions.append(link);
    });
    lead.after(audience,actions);
  }
  if (slide.note) panel.append(element("p", "slide-note", slide.note));
  if(!slide.miniArchitecture&&!slide.sections&&slide.items.length&&['cover','leadership-case'].includes(slide.type)) {
    const detail=presenterDetail(slide);detail.classList.add('dev');panel.append(detail);
  }
  return panel;
}

function setOverview(show) {
  showingOverview = show;
  byId("overview").hidden = !show;
  byId("deck").hidden = show;
  byId("deck").style.display = show ? "none" : "";
  byId("overview-toggle").setAttribute("aria-expanded", String(show));
  if (show) byId("overview").querySelector("button")?.focus();
  window.ContextMotion.setSuspended(show || printing);
  syncMotion();
}

function showSlide(index, updateHash = true) {
  const next = Math.max(0, Math.min(index, panels.length - 1));
  const request = ++slideRequest;
  current = next;
  if(storyMode){current=next;window.ContextStory.navigate(current,updateHash);return;}
  const update=()=>{
  if(request!==slideRequest)return;
  current=next;
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
  document.querySelector(".presentation-format").href = `story.html#${deckData.slides[current].id}`;
  if (updateHash) history.replaceState(null, "", `#${deckData.slides[current].id}`);
  syncMotion();
  window.scrollTo({ top: 0, behavior: "instant" });
  };
  if(updateHash && !showingOverview) window.ContextMotion.transition(update);
  else { update(); window.ContextMotion.arrive(panels[current].querySelector('h1,h2')); }
}

function indexFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  return deckData.slides.findIndex(slide => slide.id === id || slide.covers?.includes(id));
}

async function initialize() {
  try {
    deckData = JSON.parse(byId("presentation-data").textContent);
    if (!Array.isArray(deckData.slides) || !deckData.slides.length || !Array.isArray(deckData.sources)) throw new Error("The content file is incomplete.");
    const deck = byId("deck"); deck.replaceChildren();
    deckData.slides.forEach((slide, i) => {
      const panel = renderSlide(slide, i); panels.push(panel); deck.append(panel);
      const button = element("button", "nav-item"); button.type = "button";
      const navLabels = { 'opening-thesis':'The product', 'fragmented-context':'The recurring problem', 'product-overview':'One context service', 'investment-case':'Why fund it', 'full-architecture':'Full architecture', 'submission-template':'Submission contract', 'meaning-preserving-ste':'Clear review language', 'human-review-routes':'Human governance', 'context-contract':'Canonical identities', 'semantic-layers':'Four semantic layers', 'bounded-decision-router':'Model and harness', 'layered-memory':'Memory lifecycle', 'secure-delivery':'Secure MCP delivery', 'controlled-evolution':'Controlled upgrades', 'context-capabilities':'Eight capabilities', 'call-cost-anatomy':'What a call carries', 'cost-workbench':'Model cost planner', 'cost-hidden-work':'Hidden model work', 'cost-budget-routing':'Monthly model budget', 'operating-cost':'Full operating cost', 'value-assumptions':'Investment worksheet', 'pilot-acceptance':'Pilot proof', 'upgrade-example':'Contract demo', 'evidence-boundary':'Current readiness', 'development-gates':'Build path', 'next-decisions':'The pilot offer', 'failure-contracts':'Failure behavior', 'primary-sources':'Primary references' };
      const navLabel = navLabels[slide.id] || slide.eyebrow;
      button.append(element("span", "nav-index", String(i + 1).padStart(2, "0")), element("span", "", navLabel));
      button.addEventListener("click", () => showSlide(i));
      navButtons.push(button); byId("slide-nav").append(button);
      const overview = element("button", "overview-card"); overview.type = "button";
      overview.append(element("span", "", `${String(i + 1).padStart(2, "0")} / ${slide.eyebrow}`), element("strong", "", slide.title));
      overview.addEventListener("click", () => showSlide(i)); byId("overview").append(overview);
    });
    deck.setAttribute("aria-busy", "false");
    window.ContextMotion.subscribe(syncMotion);
    if(storyMode) window.ContextStory.initialize({panels,data:deckData,onChapter:index=>{current=index;syncMotion();}});
    showSlide(Math.max(0, indexFromHash()), false);
    if(storyMode && (!location.hash || location.hash==='#why-prefrontal')) document.getElementById(location.hash?'why-prefrontal':'product-start')?.scrollIntoView({behavior:'instant',block:'start'});
    byId("previous").addEventListener("click", () => showSlide(current - 1));
    byId("next").addEventListener("click", () => showSlide(current + 1));
    byId("overview-toggle").addEventListener("click", () => setOverview(!showingOverview));
    byId("print").addEventListener("click", () => window.print());
    document.addEventListener('click',event=>{
      if(event.target.closest('[data-motion]')) window.ContextMotion.setPaused(!window.ContextMotion.state().paused);
      const view=event.target.closest('[data-view]');
      if(view){document.body.classList.toggle('devview',view.dataset.view==='dev');document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===view)));syncMotion();}
    });
    document.addEventListener("visibilitychange", syncMotion);
    window.addEventListener("beforeprint", () => { printing = true; window.ContextMotion.setSuspended(true); syncMotion(); });
    window.addEventListener("afterprint", () => { printing = false; window.ContextMotion.setSuspended(showingOverview); syncMotion(); });
    byId("fullscreen").addEventListener("click", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      } catch { byId("fullscreen").textContent = "Unavailable"; }
    });
    document.addEventListener("fullscreenchange", () => { byId("fullscreen").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen"; });
    window.addEventListener("hashchange", () => { const index = indexFromHash(); if (index >= 0) showSlide(index, false); });
    document.addEventListener("keydown", event => {
      if(storyMode) return;
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
