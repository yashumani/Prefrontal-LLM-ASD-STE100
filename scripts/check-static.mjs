import { readFile, access } from 'node:fs/promises';
import assert from 'node:assert/strict';

const files = ['index.html', 'styles.css', 'app.js', 'diagrams.js', 'presentation-content.json'];
await Promise.all(files.map(file => access(file)));
const deck = JSON.parse(await readFile('presentation-content.json', 'utf8'));
assert.equal(deck.slides.length, 15, 'Expected the agreed 15-slide presentation.');
assert.equal(new Set(deck.slides.map(slide => slide.id)).size, deck.slides.length, 'Slide IDs must be unique.');
const allowed = new Set(['cover', 'problem', 'foundation', 'contract', 'pipeline', 'memory', 'router', 'ste', 'governance', 'upgrade', 'roadmap', 'evidence', 'decisions', 'sources']);
for (const slide of deck.slides) {
  assert.match(slide.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert(allowed.has(slide.type), `Unsupported slide type: ${slide.type}`);
  for (const key of ['eyebrow', 'title', 'lead']) assert.equal(typeof slide[key], 'string');
  assert(Array.isArray(slide.items));
}
assert(deck.slides.some(slide => slide.type === 'upgrade'), 'The interactive upgrade example is required.');
assert(deck.sources.length > 0, 'The presentation must include primary sources.');
for (const source of deck.sources) assert.equal(new URL(source.url).protocol, 'https:');
const html = await readFile('index.html', 'utf8');
assert(html.includes('href="styles.css"') && html.includes('src="app.js"') && html.includes('src="diagrams.js"'), 'Assets must use project-relative paths.');
console.log(`Static checks: PASS (${deck.slides.length} slides, ${deck.sources.length} source links, ${files.length} site files)`);
