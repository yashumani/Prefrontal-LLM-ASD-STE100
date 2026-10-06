import { readFile, access } from 'node:fs/promises';
import assert from 'node:assert/strict';

const files = ['index.html', 'styles.css', 'app.js', 'diagrams.js', 'presentation-content.json'];
await Promise.all(files.map(file => access(file)));
const deck = JSON.parse(await readFile('presentation-content.json', 'utf8'));
const expectedSectors = ['telecom', 'utilities', 'healthcare', 'hospitality'];
assert.equal(deck.slides.length, 26, 'Expected the agreed 26-slide product pitch and appendix.');
assert.equal(new Set(deck.slides.map(slide => slide.id)).size, deck.slides.length, 'Slide IDs must be unique.');
const allowed = new Set(['cover', 'problem', 'foundation', 'contract', 'pipeline', 'memory', 'router', 'ste', 'governance', 'upgrade', 'roadmap', 'evidence', 'decisions', 'sources', 'industry-overview', 'industry-case', 'industry-bridge', 'industry-sources', 'pitch-insights', 'pitch-value', 'pitch-calculator', 'pitch-proof']);
for (const slide of deck.slides) {
  assert.match(slide.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert(allowed.has(slide.type), `Unsupported slide type: ${slide.type}`);
  for (const key of ['eyebrow', 'title', 'lead']) assert.equal(typeof slide[key], 'string');
  assert(Array.isArray(slide.items));
}
assert(deck.slides.some(slide => slide.type === 'upgrade'), 'The interactive upgrade example is required.');
assert.equal(deck.slides[0].type, 'cover', 'The buyer story must open with the product.');
assert.equal(deck.slides[1].id, 'fragmented-context', 'The product opening must lead into the buyer problem.');
for (const type of ['pitch-insights', 'pitch-value', 'pitch-calculator', 'pitch-proof']) {
  assert.equal(deck.slides.filter(slide => slide.type === type).length, 1, `The buyer story needs one ${type} slide.`);
  assert(deck.slides.findIndex(slide => slide.type === type) < 20, `${type} belongs in the twenty-slide buyer story.`);
}
assert(deck.slides.findIndex(slide => slide.type === 'pitch-insights') < deck.slides.findIndex(slide => slide.type === 'industry-overview'), 'Buyer insights must precede industry examples.');
const expectedLenses = ['cost', 'performance', 'accuracy', 'trust'];
const pitch = deck.pitch;
assert.equal(pitch?.productName, 'Prefrontal', 'The opening must identify the product being pitched.');
assert.match(pitch.maturity, /concept.*pilot/i, 'The pitch must preserve the product concept and pilot maturity.');
assert.match([deck.slides[0].eyebrow, deck.slides[0].title, deck.slides[0].lead].join(' '), /Prefrontal/i, 'The cover must identify the product.');
assert.equal(new URL(pitch.conference.url).protocol, 'https:');
assert.equal(pitch.conference.exhibits, 20, 'The portfolio conference contains twenty supplied exhibit images.');
for (const key of ['title', 'eventDate', 'scope']) assert(pitch.conference[key]?.trim().length > 0, `Conference attribution must include ${key}.`);
assert(pitch.conference.insights.length >= 3, 'The pitch needs specific conference observations and their product implications.');
for (const insight of pitch.conference.insights) {
  for (const key of ['title', 'observation', 'application']) assert(insight[key]?.trim().length > 0, `Each conference insight needs ${key}.`);
  assert(insight.exhibits?.length > 0, 'Conference observations must point to the supplied exhibits.');
}
assert.deepEqual(pitch.lenses.map(lens => lens.id), expectedLenses, 'The buyer value story must explain all four agreed dimensions.');
for (const lens of pitch.lenses) {
  for (const key of ['name', 'goal', 'mechanism', 'measure', 'guardrail']) assert(lens[key]?.trim().length > 0, `${lens.id} must explain ${key}.`);
}
assert.deepEqual(pitch.scorecard.map(card => card.id), expectedLenses, 'Pilot proof must cover each value dimension.');
for (const card of pitch.scorecard) {
  for (const key of ['name', 'metric', 'trial', 'decision']) assert(card[key]?.trim().length > 0, `${card.id} proof must explain ${key}.`);
}
const assumptions = pitch.businessCase.defaults;
const assumptionKeys = ['target', 'hourly', 'setup', 'baselineCost', 'candidateCost', 'baselineMinutes', 'candidateMinutes', 'baselineAcceptance', 'candidateAcceptance', 'baselineFixed', 'candidateFixed'];
assert.deepEqual(Object.keys(assumptions).sort(), [...assumptionKeys].sort(), 'The cost model must state every recurring, handling, acceptance, and setup assumption.');
for (const key of assumptionKeys) assert(Number.isFinite(assumptions[key]) && assumptions[key] >= 0, `${key} default must be finite and nonnegative.`);
for (const key of ['baselineAcceptance', 'candidateAcceptance']) assert(assumptions[key] > 0 && assumptions[key] <= 100, `${key} must be a usable acceptance rate.`);
assert(assumptions.target > 0, 'The monthly accepted-task target must be positive.');
assert.equal(pitch.businessCase.currency, 'USD', 'The cost model must label its currency.');
assert(deck.sources.some(source => source.url === pitch.conference.url), 'The portfolio conference must appear in the reference appendix.');
assert.equal(deck.slides.filter(slide => slide.type === 'industry-overview').length, 1);
assert.equal(deck.slides.filter(slide => slide.type === 'industry-bridge').length, 1);
assert.equal(deck.slides.filter(slide => slide.type === 'industry-sources').length, 1);
assert.equal(deck.slides.filter(slide => slide.type === 'industry-case').length, expectedSectors.length);
assert.deepEqual(deck.industries.map(industry => industry.id).sort(), [...expectedSectors].sort(), 'All four agreed sectors need structured evidence.');
assert.equal(deck.industrySources.length, expectedSectors.length, 'Industry evidence needs four primary references.');
assert.equal(new Set(deck.industrySources.map(source => source.url)).size, expectedSectors.length, 'Industry references must be distinct.');
for (const industry of deck.industries) {
  assert.equal(typeof industry.name, 'string');
  assert(industry.name.trim().length > 0);
  const slide = deck.slides.find(candidate => candidate.id === `${industry.id}-context`);
  assert.equal(slide?.type, 'industry-case', `Missing ${industry.name} case narrative.`);
  assert.equal(slide.industry, industry.id);
  for (const key of ['problem', 'task', 'solution', 'output', 'humanGate', 'owner', 'test']) {
    assert.equal(typeof industry[key], 'string', `${industry.name} must explain ${key}.`);
    assert(industry[key].trim().length > 0, `${industry.name} ${key} cannot be empty.`);
  }
  assert(industry.inputs.length >= 4, `${industry.name} must identify the context needed for its task.`);
  assert.equal(industry.inputLabels.length, industry.inputs.length, 'Diagram labels must preserve every input.');
  assert(slide.lead.trim().length > 30 && slide.note?.trim().length > 30, `${industry.name} needs a readable narrative and its limits.`);
  for (const key of ['value', 'label', 'scope', 'period', 'sourceUrl', 'sourceTitle', 'limitation', 'definition']) {
    assert.equal(typeof industry.metric[key], 'string', `${industry.name} metric.${key} must be explicit text.`);
    assert(industry.metric[key].trim().length > 0, `${industry.name} metric.${key} cannot be empty.`);
  }
  assert.equal(new URL(industry.metric.sourceUrl).protocol, 'https:');
  assert(deck.industrySources.some(source => source.url === industry.metric.sourceUrl && source.title === industry.metric.sourceTitle), `${industry.name} metric must link to an included primary reference.`);
}
const industryById = Object.fromEntries(deck.industries.map(industry => [industry.id, industry]));
assert.deepEqual(industryById.telecom.metric.rates, [100, 123], 'Telecom uses the source growth rate as a 100-to-123 index.');
assert.equal(industryById.utilities.metric.nodeCount * industryById.utilities.metric.unitPerNode, 1700, 'Utility nodes represent the reported 1,700 GW lower bound.');
assert.equal(industryById.utilities.metric.nodeCount, 17);
assert.equal(industryById.utilities.metric.unitPerNode, 100);
assert.match(industryById.utilities.metric.value, /[≥>]\s*1,700\s*GW/, 'Utility capacity must retain its lower-bound qualifier and unit.');
assert.deepEqual(industryById.healthcare.metric.rates, [93, 79], 'The hospital receiving and integration rates must remain distinct.');
assert.deepEqual(industryById.hospitality.metric.rates, [65], 'The dated hospitality survey reports 65%.');
assert.match(industryById.hospitality.metric.scope, /282/, 'The survey respondent population must remain explicit.');
assert(deck.sources.length > 0, 'The presentation must include primary sources.');
assert.equal(deck.sources.length, 13, 'The architecture/source appendix must preserve twelve references and add the portfolio conference.');
for (const source of [...deck.sources, ...deck.industrySources]) {
  assert.equal(new URL(source.url).protocol, 'https:');
  assert.equal(typeof source.title, 'string');
  assert(source.title.trim().length > 0);
}
const html = await readFile('index.html', 'utf8');
assert(html.includes('href="styles.css"') && html.includes('src="app.js"') && html.includes('src="diagrams.js"'), 'Assets must use project-relative paths.');
assert(html.includes('static-presentation'), 'A complete JavaScript-disabled fallback is required.');
for (const slide of deck.slides) assert(html.includes(`id="static-${slide.id}"`), `Static fallback is missing ${slide.id}.`);
const svgClasses = [...html.matchAll(/<svg\b[^>]*\bclass=["']([^"']+)["'][^>]*>/g)].map(match => match[1].split(/\s+/));
assert.equal(svgClasses.filter(classes => classes.includes('motion-diagram')).length, 10, 'Static fallback must preserve all ten staged diagrams.');
assert.equal(svgClasses.filter(classes => classes.includes('insight-chart')).length, 8, 'Static fallback must preserve all eight evidence charts.');
assert(!/<animateMotion\b/.test(html), 'The JavaScript-disabled fallback must contain no native animation.');
console.log(`Static checks: PASS (${deck.slides.length} slides, ${expectedSectors.length} industry cases, ${deck.industrySources.length} industry references, ${deck.sources.length} architecture references, 10 static diagrams, 8 evidence charts, ${files.length} site files)`);
