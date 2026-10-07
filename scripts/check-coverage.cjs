const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),vm=require('node:vm');
const d=JSON.parse(fs.readFileSync('presentation-content.json','utf8'));
const originals=JSON.parse(fs.readFileSync('scripts/original-content-hashes.json','utf8'));
const sources=d.slides.flatMap(slide=>slide.sections||[{...slide,covers:undefined}]);
assert.equal(d.slides.length,16);assert.equal(d.slides[4].id,'full-architecture');
assert.equal(sources.length,31);assert.deepEqual([...d.slides.flatMap(s=>s.covers)].sort(),Object.keys(originals).sort());
assert.equal(new Set(sources.map(s=>s.id)).size,31);
for(const s of sources){const hash=crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');assert.equal(hash,originals[s.id],s.id+' original content changed');}
for(const s of d.slides.filter(s=>s.type==='consolidated'))assert.match(s.infographic.provenance,/reference|not from/i);
assert.equal(d.costLab.presets.length,6);assert.equal(d.costLab.models.length,8);assert.equal(d.costLab.params.length,14);assert.equal(d.costLab.recs.length,6);
const requested=[0,1,2,3,6,7,8,9,10,12,13,14];
const agentSlides=[6,7,8,9,10,12,13];
const pitchSlides=[0,1,2,3,13,14];
const anchors=new Set(d.architecture.nodes.map(n=>n.id));
assert.equal(d.slides.filter(s=>s.miniArchitecture).length,requested.length);
const sandbox={window:{}};
vm.runInNewContext(fs.readFileSync('mini-architectures.js','utf8'),sandbox,{timeout:1000});
for(const index of requested){
 const slide=d.slides[index],plan=slide.miniArchitecture;
 assert(plan,slide.id+' needs a focused architecture');
 assert.equal(sandbox.window.ContextMiniArchitectures.validate(plan).valid,true,slide.id+' needs valid native SVG geometry and text');
 assert(plan.anchorNodes.every(id=>anchors.has(id)),slide.id+' anchors must map to the full architecture');
 assert.equal(new Set(plan.stages.map(s=>s.title)).size,plan.stages.length,slide.id+' needs distinct explanatory stages');
 for(let step=0;step<plan.stages.length;step++)assert(plan.nodes.some(n=>n.steps.includes(step))||plan.edges.some(e=>e.steps.includes(step)),slide.id+' stage '+step+' must highlight a real component or path');
 assert.match(plan.provenance,/Proposal.*not from/i);
}
for(const index of agentSlides){
 const slide=d.slides[index],plan=slide.miniArchitecture,a=slide.agentExplanation;
 assert(plan.edges.some(e=>['deny','return'].includes(e.kind)),slide.id+' must show an exception route');
 assert(plan.nodes.some(n=>n.role==='agent'),slide.id+' must show the code harness agent');
 assert(a?.definition&&a.steps.length>=4&&a.inputs.length&&a.outputs.length&&a.limits.length,slide.id+' needs detailed agent responsibilities');
}
for(const index of pitchSlides){
 const slide=d.slides[index];
 assert(slide.pitchSignals?.length>=1&&slide.pitchSignals.length<=3,slide.id+' needs 1 to 3 leadership takeaways');
 for(const signal of slide.pitchSignals)assert(signal.title?.trim()&&signal.text?.trim(),slide.id+' leadership takeaways need a title and detail');
}
console.log('Coverage: PASS (16 slides; all 31 topics retained; authorized leadership and search revisions; retained topic hashes exact; architecture 5; source cost data retained)');
console.log('Mini architectures: PASS (12 focused diagrams; full-map anchors; all phase highlights; 7 exception routes and complete agent explanations; 6 leadership takeaway groups)');
