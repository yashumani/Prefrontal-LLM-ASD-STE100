import { readFile, access } from 'node:fs/promises';
import assert from 'node:assert/strict';

const files = ['index.html', 'styles.css', 'app.js', 'diagrams.js', 'cost-lab.js', 'cost-lab.css', 'presentation-content.json'];
await Promise.all(files.map(file => access(file)));
const deck = JSON.parse(await readFile('presentation-content.json', 'utf8'));
const expectedSlides = [
  ['opening-thesis', 'cover'], ['fragmented-context', 'problem'],
  ['product-overview', 'product-flow'], ['investment-case', 'leadership-case'],
  ['full-architecture', 'architecture'], ['existing-stack', 'product-flow'],
  ['context-capabilities','infographic'], ['submission-template', 'submission'],
  ['meaning-preserving-ste', 'ste'], ['human-review-routes', 'governance'],
  ['context-contract', 'contract'], ['semantic-layers', 'product-flow'],
  ['bounded-decision-router', 'router'], ['layered-memory', 'memory'],
  ['secure-delivery', 'product-flow'], ['controlled-evolution', 'product-flow'],
  ['call-cost-anatomy','token-cost'], ['cost-workbench','cost-lab'], ['cost-hidden-work','cost-lab'], ['cost-budget-routing','cost-lab'], ['operating-cost', 'problem'], ['cost-discipline', 'governance'],
  ['value-assumptions', 'pitch-calculator'],
  ['pilot-acceptance', 'pitch-proof'], ['upgrade-example', 'upgrade'],
  ['evidence-boundary', 'evidence'], ['plan-alignment', 'governance'],
  ['development-gates', 'roadmap'],
  ['next-decisions', 'decisions'], ['failure-contracts', 'governance'],
  ['primary-sources', 'sources']
];
assert.deepEqual(deck.slides.map(slide => [slide.id, slide.type]), expectedSlides, 'The product pitch must move from four leadership slides into slide-five architecture and developer detail.');
assert.equal(new Set(deck.slides.map(slide => slide.id)).size, deck.slides.length, 'Slide IDs must be unique.');
assert(!('industries' in deck) && !('industrySources' in deck), 'The new pitch removes industry-specific examples and evidence.');
assert(!deck.pitch?.conference, 'The new product pitch removes the conference narrative.');
for (const slide of deck.slides) {
  assert.match(slide.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  for (const key of ['eyebrow', 'title', 'lead']) assert.equal(typeof slide[key], 'string');
  assert(Array.isArray(slide.items));
  assert(!/^industry-/.test(slide.type), 'No industry slides belong in this product pitch.');
}
const byId = id => deck.slides.find(slide => slide.id === id);
assert.equal(deck.referenceVersion,'cfpa-use-case-journey-v7.zip');
assert.equal(deck.writing.mode,'STE-inspired');
assert.equal(deck.writing.complianceChecked,false);
assert.equal(deck.costLab.presets.length,6,'Keep all six supplied task examples.');
assert.equal(deck.costLab.models.length,8,'Keep the eight public rate examples.');
assert(!deck.costLab.models.some(model=>model.id==='amp'),'Internal negotiated rates must stay outside the public deck.');
assert.equal(deck.costLab.params.length,14,'Retain the source setting reference.');
assert.equal(deck.costLab.recs.length,6,'Retain all six qualified task-setting examples.');
assert.match(deck.costLab.rateStatus,/not checked|not verified/i);
assert.equal(deck.slides.filter(slide=>slide.infographic).length,10);
assert.equal(deck.slides.filter(slide=>slide.tokenCost).length,1);
const slideText = id => JSON.stringify(byId(id));
assert.match(slideText('opening-thesis'), /Prefrontal/i, 'Leadership must see the product name immediately.');
assert.match(slideText('opening-thesis'), /propos|concept|pilot/i, 'The opening must preserve product maturity.');
assert.match(slideText('product-overview'), /review|govern/i, 'The executive overview must explain the approval boundary.');
assert.match(slideText('investment-case'), /cost|spend|invest|budget|overhead/i, 'The fourth slide must address whether the architecture is worth funding.');
const stackText = slideText('existing-stack');
for (const term of [/Looker/i, /LookML/i, /Zenlytics/i, /custom app/i]) assert.match(stackText, term, 'The integration story must name each part of the existing stack.');
assert.match(stackText, /existing|current|reuse/i, 'The proposal must build on the existing analytics investment.');
assert.match(stackText, /native.{0,35}(?:query|execution)|(?:query|execution).{0,35}native/i, 'The proposed context service must preserve native query execution.');
assert.match(stackText, /adapter/i, 'The proposal must explain the adapter boundary.');
assert.match(stackText, /to verify|must verify|verify.{0,35}(?:adapter|contract|permission)|(?:adapter|contract|permission).{0,35}verif/i, 'The integration must mark adapter contracts and permissions as requiring verification.');
const mappingText = slideText('context-contract') + slideText('submission-template');
for (const term of [/LookML/i, /model/i, /explore/i, /view/i, /measure/i, /Git.{0,25}(?:revision|commit)|(?:revision|commit).{0,25}Git/i]) assert.match(mappingText, term, 'The context contract must map approved metric identities to the versioned LookML source.');
const costText = slideText('cost-discipline') + JSON.stringify(deck.pitch?.businessCase);
for (const term of [/code|SQL/i, /context/i, /cach/i, /valid|fresh|version/i, /retr(?:y|ies)/i, /warehouse|BigQuery/i, /seat|licen[cs]e/i, /human|review/i, /existing|allocated/i, /incremental/i]) assert.match(costText, term, 'The complete cost case must retain deterministic methods, bounded context, valid caches, retries and human, warehouse and licensing costs.');
assert.match(slideText('cost-discipline'), /certified quer.{0,25}unchanged/i, 'Cost controls must preserve certified queries.');
assert.match(slideText('cost-discipline'), /review.{0,30}expert drafts.{0,30}reuse/i, 'Expert drafts must pass review before reuse.');
const routerText = slideText('bounded-decision-router');
for (const term of [/certified query references/i, /native execution/i, /access checks/i, /expert drafts/i, /review/i]) assert.match(routerText, term, 'The routing story must distinguish permission-checked certified query references from expert drafts that require review.');
const planText = slideText('plan-alignment');
assert.match(planText, /seven|7.{0,15}stage/i, 'The proposal must align with the seven-stage delivery journey.');
for (const stage of ['Intake/Vetting', 'Product Requirements', 'Product Design', 'Development', 'Testing', 'Launch', 'Maintenance']) {
  assert(planText.toLowerCase().includes(stage.toLowerCase()), `The proposal must preserve the supplied delivery stage: ${stage}.`);
}
for (const term of [/owner/i, /review|govern/i, /pilot/i, /approv|gate/i]) assert.match(planText, term, 'The delivery plan must retain ownership, governance and pilot approval gates.');
assert.match(slideText('meaning-preserving-ste'), /inspired/i, 'The writing must be described as STE-inspired unless compliance was checked.');
assert.match(slideText('meaning-preserving-ste'), /source|original/i, 'STE preparation must retain the original evidence.');
assert.match(slideText('human-review-routes'), /version/i, 'Human approval must bind to the exact version.');
assert.match(slideText('secure-delivery'), /authoriz|permission|access/i, 'MCP delivery must explain access control.');
for (const state of ['Available now', 'Designed', 'To implement', 'To qualify']) assert(slideText('evidence-boundary').includes(state), `Readiness must distinguish ${state}.`);
const productFlows = deck.slides.filter(slide => slide.type === 'product-flow');
assert.equal(productFlows.length, 5, 'The source deck needs five overview, existing-stack and developer flow diagrams.');
for (const slide of productFlows) {
  assert.equal(slide.flow?.nodes?.length, 4, `${slide.id} needs four readable explanatory stages.`);
  for (const stage of slide.flow.nodes) {
    for (const key of ['title', 'detail']) assert(stage[key]?.trim(), `${slide.id} flow stage needs ${key}.`);
  }
}

const architecture = deck.architecture;
const expectedNodes = ['submissions', 'preparation', 'human-review', 'canonical-registry', 'context-agent', 'decision-model', 'data-layer', 'metric-layer', 'ontology-layer', 'interpretation-layer', 'mcp-delivery', 'consumers'];
assert.equal(architecture?.stages?.length, 5, 'The full architecture needs five explanatory stages.');
assert.deepEqual(architecture.nodes.map(node => node.id).sort(), [...expectedNodes].sort(), 'The architecture must retain submission, approval, identity, model/harness, four context layers and secure consumption.');
for (const stage of architecture.stages) {
  for (const key of ['title', 'detail']) assert(stage[key]?.trim(), `Each architecture stage needs ${key}.`);
}
for (const node of architecture.nodes) {
  assert(Number.isInteger(node.step) && node.step >= 0 && node.step < architecture.stages.length, `${node.id} must belong to an explanatory stage.`);
  assert(node.title?.trim() && node.lines?.length, `${node.id} must retain its readable explanation.`);
  assert(node.lines.every(line => typeof line === 'string' && line.trim()));
  for (const key of ['x', 'y', 'width', 'height']) assert(Number.isFinite(node[key]), `${node.id}.${key} must be a finite SVG coordinate.`);
  assert(node.width > 0 && node.height > 0, `${node.id} must have a visible box.`);
}
const expectedConnections = {
  'submit-prepare': ['submissions', 'preparation'], 'prepare-review': ['preparation', 'human-review'],
  'review-registry': ['human-review', 'canonical-registry'], 'revise-preparation': ['human-review', 'preparation'],
  'registry-agent': ['canonical-registry', 'context-agent'], 'derived-review': ['context-agent', 'preparation'],
  'ask-model': ['context-agent', 'decision-model'], 'decision-signals': ['decision-model', 'context-agent'],
  'place-ontology-layer': ['context-agent', 'ontology-layer'], 'place-data-layer': ['context-agent', 'data-layer'],
  'place-metric-layer': ['context-agent', 'metric-layer'], 'place-interpretation-layer': ['context-agent', 'interpretation-layer'],
  'publish-ontology-layer': ['ontology-layer', 'mcp-delivery'], 'publish-data-layer': ['data-layer', 'mcp-delivery'],
  'publish-metric-layer': ['metric-layer', 'mcp-delivery'], 'publish-interpretation-layer': ['interpretation-layer', 'mcp-delivery'],
  'deliver-consumer': ['mcp-delivery', 'consumers'], 'feedback-submission': ['consumers', 'submissions']
};
assert.deepEqual(Object.fromEntries(architecture.edges.map(edge => [edge.id, [edge.from, edge.to]])), expectedConnections, 'The architecture must preserve each intake, approval, bounded decision, layer, delivery and reviewed feedback relationship.');
assert.equal(new Set(architecture.edges.map(edge => edge.id)).size, architecture.edges.length, 'Each architecture connector needs a unique ID.');
for (const edge of architecture.edges) {
  assert(Number.isInteger(edge.step) && edge.step >= 0 && edge.step < architecture.stages.length);
  assert.match(edge.path, /^M\s*[\d.-]/, `${edge.id} must retain a real SVG connector path.`);
}
const nodeText = id => { const node = architecture.nodes.find(item => item.id === id); return [node.title, ...node.lines].join(' '); };
assert.match(nodeText('submissions'), /template|evidence|submission/i);
assert.match(nodeText('preparation'), /STE|source|original/i);
assert.match(nodeText('human-review'), /human|review|approve/i);
assert.match(nodeText('canonical-registry'), /ID|version/i);
assert.match(nodeText('context-agent'), /harness|typed|bounded/i, 'The harness must constrain orchestration.');
assert.match(nodeText('decision-model'), /choice|yes|score|calibrat/i, 'The chosen model must expose decision signals and calibration limits.');
assert.match(nodeText('mcp-delivery'), /MCP|authoriz|publish/i);
assert.match([architecture.policy?.title, architecture.policy?.detail].join(' '), /outside|external/i, 'Policy authority must remain outside the model.');
for (const key of ['review', 'legend']) assert.equal(typeof architecture[key], 'string');
assert.match(architecture.review, /owner|human|review/i);

const pitch = deck.pitch;
const lenses = ['cost', 'performance', 'accuracy', 'trust'];
assert.equal(pitch?.productName, 'Prefrontal');
assert.match(pitch.maturity, /concept|proposed|pilot/i);
assert.deepEqual(pitch.scorecard.map(card => card.id), lenses, 'The pilot must measure cost, performance, accuracy and trust.');
for (const card of pitch.scorecard) {
  for (const key of ['name', 'metric', 'trial', 'decision']) assert(card[key]?.trim(), `${card.id} proof needs ${key}.`);
}
const assumptions = pitch.businessCase.defaults;
const assumptionKeys = ['target', 'hourly', 'setup', 'baselineCost', 'candidateCost', 'baselineMinutes', 'candidateMinutes', 'baselineAcceptance', 'candidateAcceptance', 'baselineFixed', 'candidateFixed'];
assert.deepEqual(Object.keys(assumptions).sort(), [...assumptionKeys].sort(), 'The cost model must state operating, handling, quality and setup assumptions.');
for (const key of assumptionKeys) assert(Number.isFinite(assumptions[key]) && assumptions[key] >= 0);
for (const key of ['baselineAcceptance', 'candidateAcceptance']) assert(assumptions[key] > 0 && assumptions[key] <= 100);
assert(assumptions.target > 0);
assert.equal(assumptions.baselineCost, assumptions.candidateCost, 'Neutral defaults must assume no inference savings.');
assert.equal(assumptions.baselineMinutes, assumptions.candidateMinutes, 'Neutral defaults must assume no handling savings.');
assert.equal(assumptions.baselineAcceptance, assumptions.candidateAcceptance, 'Neutral defaults must assume no quality uplift.');
assert(assumptions.candidateFixed > assumptions.baselineFixed && assumptions.setup > 0, 'The neutral scenario must include context-service overhead and setup cost.');
const hurdle = pitch.economicHurdle;
assert.deepEqual(Object.keys(hurdle).sort(), ['acceptedTarget', 'acceptancePercent', 'monthlyOverhead', 'setup', 'months', 'hourly'].sort(), 'The leadership hurdle must declare all assumptions.');
assert.equal(hurdle.acceptedTarget, assumptions.target);
assert.equal(hurdle.acceptancePercent, assumptions.baselineAcceptance);
assert.equal(hurdle.monthlyOverhead, assumptions.candidateFixed - assumptions.baselineFixed);
assert.equal(hurdle.setup, assumptions.setup);
assert.equal(hurdle.hourly, assumptions.hourly);
assert.equal(hurdle.months, 12);
assert.equal(pitch.businessCase.currency, 'USD');
for (const key of ['formula', 'definition', 'limitation', 'costScope']) assert(pitch.businessCase[key]?.trim(), `The calculator needs its ${key}.`);
assert.equal(deck.sources.length, 8, 'The appendix needs the five standards references and three official analytics-stack references.');
for (const source of deck.sources) { assert.equal(new URL(source.url).protocol, 'https:'); assert(source.title?.trim()); }
assert.equal(new Set(deck.sources.map(source => source.url)).size, deck.sources.length, 'References must be distinct.');
for (const topic of [/looker.*lookml|lookml.*looker/i, /looker.*extension|extension.*looker/i, /bigquery.*cost|cost.*bigquery/i]) {
  assert(deck.sources.some(source => topic.test(source.title + ' ' + source.url) && /(?:^|\.)cloud\.google\.com$/.test(new URL(source.url).hostname)), 'Stack and cost facts need official Google Cloud sources.');
}

const html = await readFile('index.html', 'utf8');
const styles = await readFile('styles.css', 'utf8');
assert.match(styles, /--red\s*:\s*#EE001E\s*[;}]/i, 'The agreed brand accent must retain #EE001E.');
assert.match(styles, /--paper\s*:\s*#fff(?:fff)?\s*[;}]/i, 'The agreed brand paper token must be white.');
assert(html.includes('href="styles.css"') && html.includes('src="app.js"') && html.includes('src="diagrams.js"'), 'Assets must use project-relative paths.');
assert(html.includes('static-presentation'), 'A complete JavaScript-disabled fallback is required.');
for (const slide of deck.slides) assert(html.includes(`id="static-${slide.id}"`), `Static fallback is missing ${slide.id}.`);
const svgClasses = [...html.matchAll(/<svg\b[^>]*\bclass=["']([^"']+)["'][^>]*>/g)].map(match => match[1].split(/\s+/));
assert.equal(svgClasses.filter(classes => classes.includes('motion-diagram')).length, 20, 'Static fallback must retain all twenty staged diagrams.');
assert.equal(svgClasses.filter(classes => classes.includes('architecture-svg')).length, 1, 'Exactly one complete architecture SVG belongs on slide five.');
assert.equal(svgClasses.filter(classes => classes.includes('product-flow-svg')).length, 5, 'The product needs five readable overview, existing-stack and developer flow diagrams.');
for (const id of expectedNodes) assert(html.includes(`data-node="${id}"`), `Static architecture is missing ${id}.`);
for (const edge of architecture.edges) assert(html.includes(`data-edge="${edge.id}"`), `Static architecture is missing ${edge.id}.`);
assert(html.includes('data-policy="external"') && html.includes('data-review="owner"'), 'The static architecture must preserve independent policy and human review.');
assert(!/<animateMotion\b/.test(html), 'The JavaScript-disabled fallback must contain no native animation.');
console.log(`Static checks: PASS (${deck.slides.length} product-first slides; four leadership slides; one full 12-node architecture on slide five; ${architecture.edges.length} directed connections; five product flow diagrams; existing-stack adapter and LookML mapping boundaries; certified-query and reviewed-draft distinction; complete cost scope and seven-stage governance alignment; neutral cost assumptions; four pilot dimensions; ${deck.sources.length} primary references; twenty static SVG diagrams; supplied white/red brand tokens; complete no-JS fallback)`);
