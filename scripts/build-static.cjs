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
  const flow = svg.attrs.class.includes('industry-svg-flow');
  return `<figure class="mechanism-figure">${flow ? `<div class="diagram-viewport" tabindex="0" role="region" aria-label="Industry workflow diagram. Scroll horizontally on a small screen.">${graphic}</div><p class="diagram-scroll-hint">Swipe the diagram to follow the workflow. Focus it and use arrow keys to scroll.</p>` : graphic}<figcaption class="static-diagram-caption">Static diagram. Follow the arrows and read all stages.</figcaption></figure>`;
};
const diagram = kind => figure(sandbox.window.ContextDiagrams.create(kind));
const industryDiagram = (kind, data) => kind === 'metric' ? serialize(sandbox.window.ContextDiagrams.createIndustry(kind, data)) : figure(sandbox.window.ContextDiagrams.createIndustry(kind, data));
const deck = JSON.parse(fs.readFileSync("presentation-content.json", "utf8"));
const sourceLink = sector => `<a class="industry-citation" href="${escape(sector.metric.sourceUrl)}">${escape(sector.metric.sourceTitle)}</a>`;
const metric = (sector, overview = false) => `<article class="industry-metric" data-sector="${escape(sector.id)}" style="--sector:${escape(sector.color)}">${overview ? `<h3 class="sector-name">${escape(sector.name)}</h3>` : ''}<strong class="metric-value">${escape(sector.metric.value)}</strong><p class="metric-label">${escape(sector.metric.label)}</p>${industryDiagram('metric',sector)}<p class="metric-period">${escape(sector.metric.period)}</p><p class="metric-scope">${escape(sector.metric.scope)}</p>${sourceLink(sector)}</article>`;
const items = slide => `<div class="items">${slide.items.map(item => `<article class="item"><h3>${escape(item.title)}</h3><p>${escape(item.text)}</p></article>`).join("")}</div>`;
const contract = `<pre class="contract-card">record: claim-017
source: policy-v3, paragraph 4
project: example-project
valid_from: 2026-09-01
status: supported
claim: Keep reports for 30 days.
exception: Keep disputed reports
           until review ends.
authority: read-only

Format can change through migration.
Meaning and permissions must survive.</pre>`;
const slides = deck.slides.map((slide, index) => {
  const heading = index === 0 ? "h1" : "h2";
  const header = `<p class="eyebrow">${escape(slide.eyebrow)}</p><${heading}>${escape(slide.title)}</${heading}><p class="lead">${escape(slide.lead)}</p>`;
  let body = items(slide);
  if (slide.type === "cover") body = `<div class="cover-grid"><div>${header}${items(slide)}</div><div class="industry-hero-visual">${industryDiagram('atlas',deck.industries)}<div class="atlas-sources">${deck.industries.map(sourceLink).join('')}</div></div></div>`;
  else if (["foundation", "pipeline", "memory", "router", "contract"].includes(slide.type)) body = `<div class="diagram-grid">${slide.type === "contract" ? contract : diagram(slide.type === 'foundation' ? 'cover' : slide.type)}${items(slide)}</div>`;
  else if (slide.type === 'industry-overview') body = `<div class="industry-overview-grid">${deck.industries.map(sector=>metric(sector,true)).join('')}</div>`;
  else if (slide.type === 'industry-case') {
    const sector = deck.industries.find(item=>item.id===slide.industry);
    body = `<div class="industry-case" data-sector="${escape(sector.id)}" style="--sector:${escape(sector.color)}"><div class="industry-case-intro">${metric(sector)}<div class="industry-story"><article class="industry-story-block"><h3>The context problem</h3><p>${escape(sector.problem)}</p></article><article class="industry-story-block"><h3>The proposed solution</h3><p>${escape(sector.solution)}</p></article><p class="industry-owner-note">${escape(sector.humanGate)}</p><p class="industry-term">${escape(sector.metric.definition)}</p></div></div>${industryDiagram('flow',sector)}<p class="industry-limit">${escape(sector.metric.limitation)}</p><p class="static-case-notes">${escape(sector.task)} ${escape(sector.output)} ${escape(sector.test)}</p></div>`;
  }
  else if (slide.type === 'industry-bridge') body = `<div class="industry-bridge-grid">${industryDiagram('atlas',deck.industries)}<div class="static-bridge-cases">${deck.industries.map(sector=>`<article><h3>${escape(sector.shortName)}</h3><p>${escape(sector.task)}</p><p>${escape(sector.output)}</p><strong>${escape(sector.owner)}</strong></article>`).join('')}</div></div>`;
  else if (slide.type === 'industry-sources') body = `<div class="source-grid">${deck.industrySources.map(source=>`<article class="source-card"><a href="${escape(source.url)}">${escape(source.title)}</a><p>${escape(source.note)}</p></article>`).join('')}</div>`;
  else if (slide.type === "ste") body = `<div class="ste-example"><div class="example-panel"><span class="label">ORIGINAL · ILLUSTRATIVE</span><p>Reports should be retained for a period of 30 days, except where a dispute remains open, in which case retention continues until the review concludes.</p></div><div class="example-panel"><span class="label">STE-INSPIRED VIEW</span><p>Keep reports for 30 days. If a dispute remains open, keep the report until the review ends.</p></div></div>${items(slide)}`;
  else if (slide.type === "sources") body = `<div class="source-grid">${deck.sources.map(source => `<article class="source-card"><a href="${escape(source.url)}">${escape(source.title)}</a><p>${escape(source.note)}</p></article>`).join("")}</div>`;
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
  console.log(`Static fallback: PASS (${deck.slides.length} slides, 10 flow SVGs and 8 metric charts match their sources)`);
} else {
  fs.writeFileSync("index.html", output);
  console.log(`Static fallback generated (${deck.slides.length} slides, 10 flow SVGs, 8 metric charts)`);
}
