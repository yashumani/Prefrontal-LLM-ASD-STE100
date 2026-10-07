"use strict";
// Build the no-JavaScript deck from the same authored copy and SVG factory.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const sandbox = { window: {}, document: { createElementNS(ns, tag) {
  assert.equal(tag, "svg");
  return { attrs: {}, style: {}, innerHTML: "", setAttribute(name, value) { this.attrs[name] = value; } };
} } };
vm.runInNewContext(fs.readFileSync("diagrams.js", "utf8"), sandbox, { timeout: 1000 });
const serialize = svg => {
  // Static documents never run hidden native particle animation.
  const markup = svg.innerHTML.replace(/<circle class="m-dot"[\s\S]*?<\/circle>/g, "");
  return `<svg ${Object.entries(svg.attrs).map(([key, value]) => `${key}="${escape(value)}"`).join(" ")}>${markup}</svg>`;
};
const figure = svg => {
  const graphic = serialize(svg);
  const architecture = svg.attrs.class.includes('architecture-svg');
  const flow = architecture || svg.attrs.class.includes('product-flow-svg');
  return `<figure class="mechanism-figure">${flow ? `<div class="diagram-viewport${architecture?' architecture-viewport':''}" tabindex="0" role="region" aria-label="${architecture?'Full architecture':'Context'} workflow diagram. Scroll horizontally on a small screen.">${graphic}</div><p class="diagram-scroll-hint">Swipe the diagram to follow the workflow. Focus it and use arrow keys to scroll.</p>` : graphic}<figcaption class="static-diagram-caption">Static diagram. Follow the arrows and read all stages.</figcaption></figure>`;
};
const diagram = kind => figure(sandbox.window.ContextDiagrams.create(kind));
const industryDiagram = (kind, data) => kind === 'metric' ? serialize(sandbox.window.ContextDiagrams.createIndustry(kind, data)) : figure(sandbox.window.ContextDiagrams.createIndustry(kind, data));
const deck = JSON.parse(fs.readFileSync("presentation-content.json", "utf8"));
const sourceLink = sector => `<a class="industry-citation" href="${escape(sector.metric.sourceUrl)}">${escape(sector.metric.sourceTitle)}</a>`;
const metric = (sector, overview = false) => `<article class="industry-metric" data-sector="${escape(sector.id)}" style="--sector:${escape(sector.color)}">${overview ? `<h3 class="sector-name">${escape(sector.name)}</h3>` : ''}<strong class="metric-value">${escape(sector.metric.value)}</strong><p class="metric-label">${escape(sector.metric.label)}</p>${industryDiagram('metric',sector)}<p class="metric-period">${escape(sector.metric.period)}</p><p class="metric-scope">${escape(sector.metric.scope)}</p>${sourceLink(sector)}</article>`;
const items = slide => `<div class="items">${slide.items.map(item => `<article class="item"><h3>${escape(item.title)}</h3><p>${escape(item.text)}</p></article>`).join("")}</div>`;
const conference = () => `<div class="conference-insights"><div class="conference-grid">${deck.pitch.conference.insights.map(insight=>`<article class="conference-insight"><span class="design-label">FIELD INSIGHT · EXHIBITS ${escape(insight.exhibits)}</span><h3>${escape(insight.title)}</h3><p>${escape(insight.observation)}</p><h4>Product implication</h4><p>${escape(insight.application)}</p></article>`).join('')}</div><p class="conference-scope">${escape(deck.pitch.conference.eventDate)} · ${deck.pitch.conference.exhibits} exhibits. ${escape(deck.pitch.conference.scope)}</p><a class="conference-citation" href="${escape(deck.pitch.conference.url)}">${escape(deck.pitch.conference.title)}</a></div>`;
const value = () => `<div class="value-grid">${deck.pitch.lenses.map(lens=>`<article class="value-lens" data-lens="${escape(lens.id)}" style="--sector:${escape(lens.color)}"><span class="value-name">${escape(lens.name)}</span><h3>${escape(lens.goal)}</h3><p class="value-mechanism">${escape(lens.mechanism)}</p><h4>Measure</h4><p class="value-measure">${escape(lens.measure)}</p><p class="value-guardrail">${escape(lens.guardrail)}</p></article>`).join('')}</div>`;
const proof = () => `<div class="proof-grid">${deck.pitch.scorecard.map(plan=>`<article class="proof-card" data-lens="${escape(plan.id)}"><h3>${escape(plan.name)}</h3><h4>Measure</h4><p>${escape(plan.metric)}</p><h4>Trial</h4><p>${escape(plan.trial)}</p><h4>Expansion gate</h4><p class="proof-decision">${escape(plan.decision)}</p></article>`).join('')}</div>`;
const businessCase = () => {
  const model=deck.pitch.businessCase,a=model.defaults;
  const monthly=prefix=>a.target/(a[prefix+'Acceptance']/100)*(a[prefix+'Cost']+a[prefix+'Minutes']*a.hourly/60)+a[prefix+'Fixed'];
  const baseline=monthly('baseline'),candidate=monthly('candidate'),difference=baseline-candidate;
  const totals={baseline,candidate,difference,yearOne:12*difference-a.setup,baselineUnit:baseline/a.target,candidateUnit:candidate/a.target};
  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:model.currency,maximumFractionDigits:2});
  const labels={target:'Accepted tasks / month',hourly:'Handling cost / hour ($)',setup:'One-time setup ($)',baselineCost:'Current digital cost / attempt ($)',candidateCost:'Proposed digital cost / attempt ($)',baselineMinutes:'Current handling minutes / attempt',candidateMinutes:'Proposed handling minutes / attempt',baselineAcceptance:'Current accepted attempts (%)',candidateAcceptance:'Proposed accepted attempts (%)',baselineFixed:'Current fixed cost / month ($)',candidateFixed:'Proposed fixed cost / month ($)'};
  const resultLabels={baseline:'Current recurring / month',candidate:'Proposed recurring / month',difference:'Recurring difference / month',yearOne:'Year-one net difference',baselineUnit:'Current cost / accepted task',candidateUnit:'Proposed cost / accepted task'};
  return `<div class="business-case-static"><div class="business-case-grid"><table class="assumption-table"><caption>Invented example assumptions · USD</caption><tbody>${Object.entries(a).map(([key,v])=>`<tr><th scope="row">${escape(labels[key])}</th><td data-assumption="${key}" data-value="${v}">${escape(v)}</td></tr>`).join('')}</tbody></table><div class="business-case-results" data-outcome="${difference<0?'higher-cost':'lower-cost'}">${Object.entries(totals).map(([key,v])=>`<div class="business-case-result"><span>${resultLabels[key]}</span><strong data-result="${key}" data-value="${v}">${money.format(v)}</strong></div>`).join('')}</div></div><p class="business-case-definition">${escape(model.definition)}</p><p class="business-case-formula">${escape(model.formula)}</p><p class="business-case-scope">${escape(model.costScope)}</p><p class="business-case-note">${escape(model.limitation)}</p></div>`;
};
const leadership = () => {
  const a=deck.pitch.economicHurdle,attempts=a.acceptedTarget/(a.acceptancePercent/100),monthlyRequired=a.monthlyOverhead+a.setup/a.months,perAttempt=monthlyRequired/attempts,handlingMinutes=perAttempt/(a.hourly/60);
  return `<div class="leadership-case"><div class="investment-hurdle"><span class="design-label">ILLUSTRATIVE BREAK-EVEN REQUIREMENT · USD</span><strong class="hurdle-amount" data-hurdle="perAttempt" data-value="${perAttempt}">$${perAttempt.toFixed(2)}</strong><p class="hurdle-unit">required benefit per attempt in year one</p><p class="hurdle-assumptions">${a.acceptedTarget.toLocaleString('en-US')} accepted tasks/month · ${a.acceptancePercent}% accepted attempts · $${a.monthlyOverhead.toLocaleString('en-US')} monthly overhead · $${a.setup.toLocaleString('en-US')} setup over ${a.months} months</p><div class="hurdle-support">${[['attempts',attempts,'attempts per month'],['monthlyRequired',monthlyRequired,'required benefit per month'],['handlingMinutes',handlingMinutes,'handling minutes per attempt at $60/hour']].map(([key,v,label])=>`<span data-hurdle="${key}" data-value="${v}">${key==='monthlyRequired'?'$':''}${v.toLocaleString('en-US',{maximumFractionDigits:2})} ${label}</span>`).join('')}</div><p class="hurdle-definition">Benefit may come from lower operating cost or separately evidenced business value. Avoid counting the same benefit twice.</p></div><div class="executive-lenses">${deck.pitch.lenses.map(l=>`<article class="executive-lens" data-lens="${l.id}" style="--sector:${l.color}"><h3>${escape(l.name)}</h3><p>${escape(l.goal)}</p></article>`).join('')}</div></div>`;
};
const submission = slide => `<div class="submission-layout"><div class="submission-table-region" tabindex="0" role="region" aria-label="Illustrative submission review table"><table class="submission-table"><caption>One proposed record · original evidence remains attached</caption><thead><tr><th scope="col">Field</th><th scope="col">Illustrative value</th><th scope="col">Reviewer check</th></tr></thead><tbody>${deck.submission.map(r=>`<tr><th scope="row">${escape(r.field)}</th><td>${escape(r.value)}</td><td>${escape(r.check)}</td></tr>`).join('')}</tbody></table></div>${items(slide)}</div>`;
const contract = `<pre class="contract-card">canonical_id: interpretation:reports-retention
version: 3
workspace: operations
source: policy-v3, paragraph 4
valid_from: 2026-09-01
status: approved
claim: Keep reports for 30 days.
exception: Keep disputed reports
           until review ends.
input_refs: [data:reports-policy@3]
review: owner + exact content hash
access: operations-readers

IDs identify records. IDs grant no access.</pre>`;
const slides = deck.slides.map((slide, index) => {
  const heading = index === 0 ? "h1" : "h2";
  const header = `<p class="eyebrow">${escape(slide.eyebrow)}</p><${heading}>${escape(slide.title)}</${heading}><p class="lead">${escape(slide.lead)}</p>`;
  let body = items(slide);
  if (slide.type === "cover") body = `<div class="cover-grid"><div>${header}${items(slide)}</div><div class="industry-hero-visual">${industryDiagram('product',deck.pitch)}<p class="product-status">${escape(deck.pitch.maturity)}</p></div></div>`;
  else if (["foundation", "pipeline", "memory", "router", "contract"].includes(slide.type)) body = `<div class="diagram-grid">${slide.type === "contract" ? contract : diagram(slide.type === 'foundation' ? 'cover' : slide.type)}${items(slide)}</div>`;
  else if (slide.type === 'industry-overview') body = `<div class="industry-overview-grid">${deck.industries.map(sector=>metric(sector,true)).join('')}</div>`;
  else if (slide.type === 'industry-case') {
    const sector = deck.industries.find(item=>item.id===slide.industry);
    body = `<div class="industry-case" data-sector="${escape(sector.id)}" style="--sector:${escape(sector.color)}"><div class="industry-case-intro">${metric(sector)}<div class="industry-story"><article class="industry-story-block"><h3>The context problem</h3><p>${escape(sector.problem)}</p></article><article class="industry-story-block"><h3>The proposed solution</h3><p>${escape(sector.solution)}</p></article><p class="industry-value-note">Buyer goal to test: ${escape(sector.benefit)} ${escape(sector.buyerMetric)}</p><p class="industry-owner-note">${escape(sector.humanGate)}</p><p class="industry-term">${escape(sector.metric.definition)}</p></div></div>${industryDiagram('flow',sector)}<p class="industry-limit">${escape(sector.metric.limitation)}</p><p class="static-case-notes">${escape(sector.task)} ${escape(sector.output)} ${escape(sector.test)}</p></div>`;
  }
  else if (slide.type === 'industry-bridge') body = `<div class="industry-bridge-grid">${industryDiagram('atlas',deck.industries)}<div class="static-bridge-cases">${deck.industries.map(sector=>`<article><h3>${escape(sector.shortName)}</h3><p>${escape(sector.task)}</p><p>${escape(sector.output)}</p><strong>${escape(sector.owner)}</strong></article>`).join('')}</div></div>`;
  else if (slide.type === 'industry-sources') body = `<div class="source-grid">${deck.industrySources.map(source=>`<article class="source-card"><a href="${escape(source.url)}">${escape(source.title)}</a><p>${escape(source.note)}</p></article>`).join('')}</div>`;
  else if (slide.type === "ste") body = `<div class="ste-example"><div class="example-panel"><span class="label">ORIGINAL · ILLUSTRATIVE</span><p>Reports should be retained for a period of 30 days, except where a dispute remains open, in which case retention continues until the review concludes.</p></div><div class="example-panel"><span class="label">STE-INSPIRED VIEW</span><p>Keep reports for 30 days. If a dispute remains open, keep the report until the review ends.</p></div></div>${items(slide)}`;
  else if (slide.type === "sources") body = `<div class="source-grid">${deck.sources.map(source => `<article class="source-card"><a href="${escape(source.url)}">${escape(source.title)}</a><p>${escape(source.note)}</p></article>`).join("")}</div>`;
  else if (slide.type === 'pitch-insights') body = conference();
  else if (slide.type === 'pitch-value') body = value();
  else if (slide.type === 'pitch-proof') body = proof();
  else if (slide.type === 'pitch-calculator') body = businessCase();
  else if (slide.type === 'leadership-case') body = leadership();
  else if (slide.type === 'submission') body = submission(slide);
  else if (slide.type === 'product-flow') body = figure(sandbox.window.ContextDiagrams.createProductFlow(slide.flow)) + items(slide);
  else if (slide.type === 'architecture') body = figure(sandbox.window.ContextDiagrams.createArchitecture(deck.architecture)) + `<p class="architecture-legend">${escape(deck.architecture.legend)}</p>`;
  else if (slide.type === "upgrade") body = `<div class="diagram-grid">${contract}<div><div class="item"><h3>Illustrative contract checks</h3><p>The browser example accepts a change that preserves the record. It rejects missing evidence, a removed exception, or expanded permission. These checks do not call a model. Enable JavaScript to run the four examples.</p></div>${items(slide)}</div></div>`;
  return `<section class="slide type-${escape(slide.type)}" id="static-${escape(slide.id)}">${slide.type === "cover" ? "" : header}${body}${slide.note ? `<p class="slide-note">${escape(slide.note)}</p>` : ""}</section>`;
}).join("\n");
const start = "<!-- STATIC PRESENTATION START -->";
const end = "<!-- STATIC PRESENTATION END -->";
const html = fs.readFileSync("index.html", "utf8").replace(/\r\n/g, "\n");
assert(html.includes(start) && html.includes(end), "Static presentation markers are required.");
const replacement = `${start}\n  <noscript><main class="static-presentation"><p class="static-intro">Static presentation · all ${deck.slides.length} slides. Writing inspired by ASD-STE100; full compliance has not been checked.</p>\n${slides}\n</main></noscript>\n  ${end}`;
const output = html.slice(0, html.indexOf(start)) + replacement + html.slice(html.indexOf(end) + end.length);
if (process.argv.includes("--check")) {
  assert.equal(html, output, "Static deck is stale. Run node scripts/build-static.cjs.");
  const flows = (output.match(/<svg[^>]*class="[^"]*motion-diagram/g)||[]).length;
  console.log(`Static fallback: PASS (${deck.slides.length} slides, ${flows} flow SVGs match their sources)`);
} else {
  fs.writeFileSync("index.html", output);
  const flows = (output.match(/<svg[^>]*class="[^"]*motion-diagram/g)||[]).length;
  console.log(`Static fallback generated (${deck.slides.length} slides, ${flows} flow SVGs)`);
}
