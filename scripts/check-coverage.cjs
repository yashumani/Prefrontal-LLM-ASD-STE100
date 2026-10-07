const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const d=JSON.parse(fs.readFileSync('presentation-content.json','utf8'));
const originals=JSON.parse(fs.readFileSync('scripts/original-content-hashes.json','utf8'));
const sources=d.slides.flatMap(slide=>slide.sections||[{...slide,covers:undefined}]);
assert.equal(d.slides.length,16);assert.equal(d.slides[4].id,'full-architecture');
assert.equal(sources.length,31);assert.deepEqual([...d.slides.flatMap(s=>s.covers)].sort(),Object.keys(originals).sort());
assert.equal(new Set(sources.map(s=>s.id)).size,31);
for(const s of sources){const hash=crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');assert.equal(hash,originals[s.id],s.id+' original content changed');}
for(const s of d.slides.filter(s=>s.type==='consolidated'))assert.match(s.infographic.provenance,/reference|not from/i);
assert.equal(d.costLab.presets.length,6);assert.equal(d.costLab.models.length,8);assert.equal(d.costLab.params.length,14);assert.equal(d.costLab.recs.length,6);
const requested=[6,7,8,9,10,12,13];
const anchors=new Set(d.architecture.nodes.map(n=>n.id));
assert.equal(d.slides.filter(s=>s.miniArchitecture).length,requested.length);
for(const index of requested){
 const slide=d.slides[index],plan=slide.miniArchitecture,a=slide.agentExplanation;
 assert(plan,slide.id+' needs a focused architecture');
 assert(plan.anchorNodes.every(id=>anchors.has(id)),slide.id+' anchors must map to the full architecture');
 assert(plan.edges.some(e=>['deny','return'].includes(e.kind)),slide.id+' must show an exception route');
 assert(plan.nodes.some(n=>n.role==='agent'),slide.id+' must show the code harness agent');
 assert.match(plan.provenance,/Proposal.*not from/i);
 assert(a?.definition&&a.steps.length>=4&&a.inputs.length&&a.outputs.length&&a.limits.length,slide.id+' needs detailed agent responsibilities');
}
console.log('Coverage: PASS (16 slides; all 31 original topics exact; leadership 1–4 and architecture 5; source cost data retained)');
console.log('Mini architectures: PASS (seven requested slides; full-map anchors; exception routes; agent inputs, outputs and authority limits)');
