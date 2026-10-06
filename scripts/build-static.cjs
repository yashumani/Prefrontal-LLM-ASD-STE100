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
const diagram = kind => {
  const svg = sandbox.window.ContextDiagrams.create(kind);
  // Static documents never run hidden native particle animation.
  const markup = svg.innerHTML.replace(/<circle class="m-dot"[\s\S]*?<\/circle>/g, "");
  return `<figure class="mechanism-figure"><svg ${Object.entries(svg.attrs).map(([key, value]) => `${key}="${escape(value)}"`).join(" ")}>${markup}</svg><figcaption class="static-diagram-caption">Static diagram. Follow the arrows and read all stages.</figcaption></figure>`;
};
const deck = JSON.parse(fs.readFileSync("presentation-content.json", "utf8"));
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
  if (slide.type === "cover") body = `<div class="cover-grid"><div>${header}${items(slide)}</div>${diagram("cover")}</div>`;
  else if (["pipeline", "memory", "router", "contract"].includes(slide.type)) body = `<div class="diagram-grid">${slide.type === "contract" ? contract : diagram(slide.type)}${items(slide)}</div>`;
  else if (slide.type === "ste") body = `<div class="ste-example"><div class="example-panel"><span class="label">ORIGINAL · ILLUSTRATIVE</span><p>Reports should be retained for a period of 30 days, except where a dispute remains open, in which case retention continues until the review concludes.</p></div><div class="example-panel"><span class="label">STE-INSPIRED VIEW</span><p>Keep reports for 30 days. If a dispute remains open, keep the report until the review ends.</p></div></div>${items(slide)}`;
  else if (slide.type === "sources") body = `<div class="source-grid">${deck.sources.map(source => `<article class="source-card"><a href="${escape(source.url)}">${escape(source.title)}</a><p>${escape(source.note)}</p></article>`).join("")}</div>`;
  else if (slide.type === "upgrade") body = `<div class="diagram-grid">${contract}<div><div class="item"><h3>Illustrative contract checks</h3><p>The browser example accepts a change that preserves the record. It rejects missing evidence, a removed exception, or expanded permission. These checks do not call a model. Enable JavaScript to run the four examples.</p></div>${items(slide)}</div></div>`;
  return `<section class="slide type-${escape(slide.type)}" id="static-${escape(slide.id)}">${slide.type === "cover" ? "" : header}${body}${slide.note ? `<p class="slide-note">${escape(slide.note)}</p>` : ""}</section>`;
}).join("\n");
const start = "<!-- STATIC PRESENTATION START -->";
const end = "<!-- STATIC PRESENTATION END -->";
const html = fs.readFileSync("index.html", "utf8").replace(/\r\n/g, "\n");
assert(html.includes(start) && html.includes(end), "Static presentation markers are required.");
const replacement = `${start}\n  <noscript><main class="static-presentation"><p class="static-intro">Static presentation · all 15 slides. Writing inspired by ASD-STE100; full compliance has not been checked.</p>\n${slides}\n</main></noscript>\n  ${end}`;
const output = html.slice(0, html.indexOf(start)) + replacement + html.slice(html.indexOf(end) + end.length);
if (process.argv.includes("--check")) {
  assert.equal(html, output, "Static deck is stale. Run node scripts/build-static.cjs.");
  console.log("Static fallback: PASS (15 slides and 4 inline SVG diagrams match their sources)");
} else {
  fs.writeFileSync("index.html", output);
  console.log("Static fallback generated (15 slides, 4 inline SVG diagrams)");
}
