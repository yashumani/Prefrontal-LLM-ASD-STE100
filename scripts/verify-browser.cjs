'use strict';
// Verify the consolidated narrative, retained detail, and supplied motion-kit method.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PREFRONTAL_PLAYWRIGHT_MODULE||'playwright');
const {verifyModel,verifyVisuals}=require('./verify-v7.cjs');
const deck=JSON.parse(fs.readFileSync('presentation-content.json','utf8'));
const base=process.env.PREFRONTAL_BASE_URL||'http://127.0.0.1:8893/';
const near=(a,b)=>assert(Math.abs(a-b)<1e-7,`Expected ${b}, got ${a}`);
const norm=s=>s.replace(/\s+/g,' ').trim();
const pages=pdf=>(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
const focusedIndices=[0,1,2,3,6,7,8,9,10,12,13,14];
const detailedAgentIndices=[6,7,8,9,10,12,13];
const leadershipIndices=[0,1,2,3,13,14];
const hurdle=deck.pitch.economicHurdle;
const hurdleAttempts=hurdle.acceptedTarget/(hurdle.acceptancePercent/100);
const hurdleMonthly=hurdle.monthlyOverhead+hurdle.setup/hurdle.months;
const hurdleValues={attempts:hurdleAttempts,monthlyRequired:hurdleMonthly,perAttempt:hurdleMonthly/hurdleAttempts,handlingMinutes:(hurdleMonthly/hurdleAttempts)/hurdle.hourly*60};
async function checkLeadershipSignals(region,slide){
 const cards=region.locator('.pitch-signals .pitch-signal');
 assert.equal(await cards.count(),slide.pitchSignals.length,slide.id+' leadership takeaway count');
 for(let index=0;index<slide.pitchSignals.length;index++){
  assert(await cards.nth(index).isVisible(),slide.id+' leadership takeaway is visible');
  assert.equal(norm(await cards.nth(index).innerText()),norm(slide.pitchSignals[index].title+' '+slide.pitchSignals[index].text),slide.id+' leadership takeaway retains authored wording');
 }
 if(slide.cortexReference){
  const reference=region.locator('.cortex-intro-reference');assert(await reference.isVisible());
  const referenceBox=await reference.boundingBox(),diagramBox=await region.locator('.mechanism-figure').first().boundingBox();
  assert(referenceBox.y+referenceBox.height<=diagramBox.y+1,'The brain reference precedes architecture in reading order');
  for(const source of slide.cortexReference.sources){const link=reference.locator('a').filter({hasText:source.label});assert(await link.isVisible());assert.equal(await link.getAttribute('href'),source.url);}
  assert.equal(await reference.locator('.cortex-intro-detail').getAttribute('href'),'story.html#why-prefrontal');
 }
}
async function checkEconomicHurdle(region){
 for(const [key,value]of Object.entries(hurdleValues)){
  const output=region.locator('[data-hurdle="'+key+'"]');assert.equal(await output.count(),1,'The economic hurdle retains '+key);
  assert(await output.isVisible(),key+' must remain visible in the leadership pitch');near(Number(await output.getAttribute('data-value')),value);
 }
}
async function main(){
 verifyModel(deck);fs.mkdirSync('.validation',{recursive:true});
 const browser=await chromium.launch();const errors=[];
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 await context.addInitScript(()=>{
  const native=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window),active=new Set();let peak=0,intervals=0;
  window.requestAnimationFrame=fn=>{const id=native(t=>{active.delete(id);fn(t)});active.add(id);peak=Math.max(peak,active.size);return id};
  window.cancelAnimationFrame=id=>{active.delete(id);cancel(id)};
  const interval=window.setInterval.bind(window);window.setInterval=(...args)=>{intervals++;return interval(...args)};
  window.__motionProbe=()=>({scheduled:active.size,peak,intervals});
 });
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 const goto=async(page,id)=>{await page.goto(base+'#'+id);const slide=deck.slides.find(s=>s.id===id||s.covers.includes(id));await page.locator('[data-slide="'+slide.id+'"]').waitFor({state:'visible'});};
 try{
  await goto(p,'opening-thesis');assert.equal(await p.locator('#deck>.slide').count(),16);
  const ids=await p.locator('[id]').evaluateAll(nodes=>nodes.map(n=>n.id));assert.equal(new Set(ids).size,ids.length,'DOM IDs must be unique.');
  const brand=await p.evaluate(()=>({red:getComputedStyle(document.documentElement).getPropertyValue('--red').trim(),background:getComputedStyle(document.body).backgroundColor,font:getComputedStyle(document.body).fontFamily}));
  assert.equal(brand.red.toUpperCase(),'#EE001E');assert.equal(brand.background,'rgb(255, 255, 255)');assert.match(brand.font,/Arial/);
  await p.waitForFunction(()=>ContextMotion.stats().frames>3);
  const first=await p.evaluate(()=>({stats:ContextMotion.stats(),probe:__motionProbe()}));assert.equal(first.stats.active,1);assert.equal(first.probe.peak,1);assert.equal(first.probe.intervals,0);
  await p.locator('#motion-toggle').click();await p.waitForTimeout(120);
  assert.equal(await p.evaluate(()=>ContextMotion.stats().scheduled),false);const frozen=await p.evaluate(()=>ContextMotion.stats().frames);await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>ContextMotion.stats().frames),frozen);
  assert(await p.locator('.slide:visible svg').evaluate(svg=>svg.classList.contains('is-static')),'Pause shows the final static mechanism.');
  await p.locator('#motion-toggle').click();await p.waitForFunction(()=>ContextMotion.stats().active===1);
  const svg=p.locator('.slide:visible svg.motion-diagram');const before=await svg.getAttribute('data-current-step');await p.waitForTimeout(2500);assert.notEqual(await svg.getAttribute('data-current-step'),before,'Shared RAF advances the stage.');
  await p.locator('#sidebar-stage-next').click();assert.equal(await p.evaluate(()=>ContextMotion.stats().scheduled),false);
  await p.locator('#overview-toggle').click();assert.equal(await p.locator('.overview-card').count(),16);assert.equal(await p.evaluate(()=>ContextMotion.stats().active),0);await p.keyboard.press('Escape');
  const containment=[];
  for(const slide of deck.slides){
   await goto(p,slide.id);const node=p.locator('[data-slide="'+slide.id+'"]');assert.equal(norm(await node.locator('h1,h2').first().innerText()),slide.title);
   const size=await p.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));assert(size.w<=1441&&size.h<=901,slide.id+' projected containment '+JSON.stringify(size));containment.push({id:slide.id,...size});
   const violations=await node.locator('svg.motion-diagram').evaluateAll(svgs=>svgs.filter(s=>s.getBoundingClientRect().height>0).flatMap(svg=>[...svg.querySelectorAll('.m-node')].flatMap(g=>{
    const r=g.querySelector(':scope>rect')?.getBoundingClientRect();if(!r)return[];
    return [...g.querySelectorAll('text')].filter(t=>{const b=t.getBoundingClientRect();return b.width>0&&(b.left<r.left+2||b.right>r.right-2||b.top<r.top+2||b.bottom>r.bottom-2)}).map(t=>t.textContent);
   })));assert.deepEqual(violations,[],slide.id+' node labels fit');
   await p.screenshot({path:'.validation/review-'+slide.id+'.png'});
  }
  fs.writeFileSync('.validation/consolidated-containment.json',JSON.stringify(containment,null,2));
  for(const index of leadershipIndices){await goto(p,deck.slides[index].id);await checkLeadershipSignals(p.locator('.slide:visible'),deck.slides[index]);}
  await goto(p,'investment-case');await checkEconomicHurdle(p.locator('.slide:visible'));
  const miniSlides=deck.slides.filter(s=>s.miniArchitecture);
  assert.deepEqual(miniSlides.map(s=>s.id),focusedIndices.map(index=>deck.slides[index].id),'Every requested focused architecture must remain present in deck order.');
  assert.deepEqual(miniSlides.filter(s=>s.agentExplanation).map(s=>s.id),detailedAgentIndices.map(index=>deck.slides[index].id),'Keep all seven complete agent explanations.');
  let miniNodes=0,miniEdges=0,agentExplanations=0;
  for(const slide of miniSlides){
   await goto(p,slide.id);const root=p.locator('.slide:visible .mini-architecture-svg'),plan=slide.miniArchitecture;
   assert.equal(await root.count(),1);assert.equal(await root.locator('[data-node]').count(),plan.nodes.length);assert.equal(await root.locator('[data-edge]').count(),plan.edges.length);
   assert.equal(await root.getAttribute('data-architecture-anchors'),plan.anchorNodes.join(','));
   assert(plan.anchorNodes.every(id=>deck.architecture.nodes.some(n=>n.id===id)),slide.id+' anchors refer to actual full-map nodes');
   assert.equal(await root.locator('[data-boundary=external-policy]').count(),1);
   assert.equal(await root.locator('.stage-meta[data-stage]').count(),plan.stages.length,slide.id+' keeps every explanatory stage');
   const routingViolations=await root.evaluate(svg=>{
    const rects=[...svg.querySelectorAll('.m-node>rect')].map(r=>({id:r.parentElement.dataset.node,r:r.getBBox()}));
    const crossings=[...svg.querySelectorAll('.m-edge>path')].flatMap(path=>{const g=path.parentElement,l=path.getTotalLength();return rects.filter(({id,r})=>id!==g.dataset.from&&id!==g.dataset.to&&Array.from({length:150},(_,i)=>path.getPointAtLength(l*i/149)).some(p=>p.x>r.x+1&&p.x<r.x+r.width-1&&p.y>r.y+1&&p.y<r.y+r.height-1)).map(n=>g.dataset.edge+' crosses '+n.id);});
    const overlaps=[...svg.querySelectorAll('.m-edge text')].flatMap(t=>{const b=t.getBBox();return rects.filter(({r})=>b.x<r.x+r.width&&b.x+b.width>r.x&&b.y<r.y+r.height&&b.y+b.height>r.y).map(n=>t.textContent+' overlaps '+n.id);});
    return [...crossings,...overlaps];
   });assert.deepEqual(routingViolations,[],slide.id+' routes and labels stay clear of unrelated nodes');
   for(const e of plan.edges){const group=root.locator('[data-edge="'+e.id+'"]');assert.equal(await group.getAttribute('data-from'),e.from);assert.equal(await group.getAttribute('data-to'),e.to);assert.equal(await group.locator('.m-dot').count(),e.kind==='reference'?0:1);assert.equal(await group.locator('path[marker-end]').count(),e.kind==='reference'?0:1);}
   for(let step=0;step<plan.stages.length;step++){
    await root.locator('xpath=../..').evaluate((figure,index)=>figure.selectStage(index),step);
    const highlighted=await root.locator('.m-node.is-current').evaluateAll(nodes=>nodes.map(n=>n.dataset.node));
    assert.deepEqual(highlighted,plan.nodes.filter(n=>n.steps.includes(step)).map(n=>n.id),slide.id+' phase highlights actual nodes');
    const highlightedEdges=await root.locator('.m-edge.is-current').evaluateAll(edges=>edges.map(e=>e.dataset.edge));
    assert.deepEqual(highlightedEdges,plan.edges.filter(e=>e.steps.includes(step)).map(e=>e.id),slide.id+' phase highlights actual paths');
   }
   if(slide.agentExplanation){
    const role=p.locator('.slide:visible [data-agent-explanation]');assert.equal(norm(await role.innerText()),norm(slide.agentExplanation.title+' '+slide.agentExplanation.definition));
    await p.locator('[data-view=dev]').click();const detail=p.locator('.slide:visible .agent-detail');await detail.locator('summary').click();
    const agentText=norm(await detail.innerText());for(const value of [...slide.agentExplanation.steps.flatMap(s=>[s.title,s.text]),...slide.agentExplanation.inputs,...slide.agentExplanation.outputs,...slide.agentExplanation.limits])assert(agentText.includes(norm(value)),slide.id+' agent detail retained');
    assert(await root.isVisible(),'Developer retains the focused architecture.');await p.screenshot({path:'.validation/agent-'+slide.id+'.png',fullPage:true});await detail.locator('summary').click();await p.locator('[data-view=leader]').click();agentExplanations++;
   }
   miniNodes+=plan.nodes.length;miniEdges+=plan.edges.length;
  }
  assert.equal(agentExplanations,7);
  await goto(p,'bounded-decision-router');await p.locator('#motion-toggle').click();await p.waitForFunction(()=>ContextMotion.stats().active===1);
  const packet=p.locator('.slide:visible .mini-architecture-svg .m-dot').first();const packetPosition=await packet.getAttribute('transform');await p.waitForTimeout(130);assert.notEqual(await packet.getAttribute('transform'),packetPosition,'Native mini paths move in the shared loop.');await p.locator('#motion-toggle').click();
  await goto(p,'full-architecture');assert.equal(await p.locator('.slide:visible [data-node]').count(),14);assert.equal(await p.locator('.slide:visible [data-edge]').count(),24);assert.equal(await p.locator('.slide:visible [data-policy=external]').count(),1);assert.equal(await p.locator('.slide:visible [data-review=owner]').count(),1);
  let topics=0;
  for(const slide of deck.slides.filter(s=>s.type==='consolidated')){
   await goto(p,slide.id);await p.locator('[data-view=dev]').click();assert(await p.evaluate(()=>document.body.classList.contains('devview')));
   for(const source of slide.sections){
    const detail=p.locator('[data-source-slide="'+source.id+'"]');await detail.locator(':scope>summary').click();assert(await detail.locator('.developer-section').isVisible());
    const text=norm(await detail.textContent());assert(text.includes(norm(source.lead)),source.id+' source lead survives');
    for(const item of source.items){assert(text.includes(norm(item.title)));assert(text.includes(norm(item.text)),source.id+' item survives');}
    if(source.note)assert(text.includes(norm(source.note)),source.id+' uncertainty survives');
    await p.screenshot({path:'.validation/developer-'+source.id+'.png',fullPage:true});await detail.locator(':scope>summary').click();topics++;
   }await p.locator('[data-view=leader]').click();
  }assert.equal(topics,21);
  await goto(p,'submission-template');await p.locator('#sidebar-topic').selectOption('0');assert(await p.evaluate(()=>document.body.classList.contains('devview')));assert(await p.locator('[data-source-slide=submission-template]').getAttribute('open')!==null);
  assert.equal(await p.locator('.submission-table tbody tr').count(),deck.submission.length);
  await p.locator('[data-source-slide=meaning-preserving-ste]>summary').click();const ste=await p.locator('.ste-example').innerText();assert.match(ste,/should/);assert.match(ste,/dispute remains open/);assert.match(ste,/until the review ends/);assert.match(await p.locator('.slide:visible').innerText(),/compliance has not been checked|compliance.*unchecked/i);
  await goto(p,'operating-cost');await p.locator('[data-view=dev]').click();await p.locator('[data-source-slide=value-assumptions]>summary').click();
  const read=async key=>Number(await p.locator('[data-result="'+key+'"]').getAttribute('data-value'));
  near(await read('baseline'),6500);near(await read('candidate'),7500);near(await read('difference'),-1000);near(await read('yearOne'),-17000);
  await p.locator('#bc-candidateMinutes').fill('2');near(await read('candidate'),5000);near(await read('difference'),1500);near(await read('yearOne'),13000);
  for(const [key,value]of [['target','0'],['hourly','-1'],['setup',''],['baselineCost','-1'],['candidateMinutes','-1'],['baselineAcceptance','0'],['candidateAcceptance','101'],['candidateFixed','-1']]){
   await p.locator('#bc-'+key).fill(value);assert(await p.locator('.business-case-error').isVisible());await p.locator('#bc-'+key).fill(String(deck.pitch.businessCase.defaults[key]));
  }await p.locator('#bc-candidateMinutes').fill('4');near(await read('difference'),-1000);
  await goto(p,'controlled-evolution');await p.locator('[data-source-slide=upgrade-example]>summary').click();
  for(const [scenario,outcome]of [['compatible','accept'],['lost-evidence','reject'],['lost-exception','reject'],['permission-change','reject']]){await p.locator('.upgrade-controls select').selectOption(scenario);await p.getByRole('button',{name:'Run illustrative checks'}).click();assert.equal(await p.locator('.demo-summary').getAttribute('data-outcome'),outcome);}
  await p.locator('[data-view=leader]').click();await verifyVisuals(p,deck,goto);await p.locator('[data-view=leader]').click();
  await goto(p,'cost-budget-routing');assert(await p.locator('#panel-call-cost-anatomy').isVisible(),'Old URLs resolve to the consolidated page.');
  await goto(p,'call-cost-anatomy');await p.locator('#sidebar-cost').selectOption({label:'Call anatomy'});assert.equal(await p.locator('.suite-page:visible .m-node').count(),3);
  await p.emulateMedia({reducedMotion:'reduce'});await p.waitForTimeout(120);assert.equal(await p.evaluate(()=>ContextMotion.stats().active),0);assert.equal(await p.evaluate(()=>ContextMotion.stats().scheduled),false);assert(await p.locator('#motion-toggle').isDisabled());assert(await p.locator('.suite-page:visible svg').evaluate(s=>s.classList.contains('is-static')));await p.emulateMedia({reducedMotion:'no-preference'});
  await goto(p,'primary-sources');assert.equal(await p.locator('.slide:visible .source-card a').count(),8);
  await p.setViewportSize({width:390,height:844});
  for(const id of [...new Set(['opening-thesis','full-architecture','call-cost-anatomy','plan-alignment',...deck.slides.filter(s=>s.miniArchitecture).map(s=>s.id)])]){
   await goto(p,id);assert((await p.evaluate(()=>document.documentElement.scrollWidth))<=391,id+' mobile horizontal containment');await p.screenshot({path:'.validation/mobile-'+id+'.png',fullPage:true});
  }
  await goto(p,'submission-template');await p.locator('.sidebar-toggle').click();await p.locator('[data-view=dev]').click();await p.locator('.sidebar-toggle').click();const mobileTopic=p.locator('[data-source-slide=submission-template]');if(await mobileTopic.getAttribute('open')===null)await mobileTopic.locator(':scope>summary').click();assert(await p.locator('.submission-table-region').isVisible());assert((await p.evaluate(()=>document.documentElement.scrollWidth))<=391);await p.locator('.sidebar-toggle').click();await p.locator('[data-view=leader]').click();await p.locator('.sidebar-toggle').click();await p.setViewportSize({width:1440,height:900});
  const pdf=await p.pdf({path:'.validation/architecture-deck.pdf',format:'A4',landscape:true,printBackground:true,preferCSSPageSize:true});assert.equal(pages(pdf),16);
  const offline=await context.newPage();let external=0;offline.on('request',r=>{if(/^https?:/.test(r.url()))external++});offline.on('pageerror',e=>errors.push(e.message));await offline.goto(pathToFileURL(path.resolve('index.html')).href);await offline.locator('[data-slide=opening-thesis]').waitFor({state:'visible'});assert.equal(external,0);await offline.close();
  const staticContext=await browser.newContext({javaScriptEnabled:false,viewport:{width:1440,height:900}});const stat=await staticContext.newPage();await stat.goto(base);
  assert.equal(await stat.locator('.static-presentation>.slide').count(),16);assert.equal(await stat.locator('.static-presentation .developer-topic[data-source-slide]').count(),25);assert.equal(await stat.locator('.static-presentation animateMotion').count(),0);
  assert.equal(await stat.locator('.static-presentation .mini-architecture-svg').count(),12);
  for(const index of leadershipIndices)await checkLeadershipSignals(stat.locator('#static-'+deck.slides[index].id),deck.slides[index]);
  await checkEconomicHurdle(stat.locator('#static-investment-case'));
  const source=stat.locator('[data-source-slide=meaning-preserving-ste]');await source.locator(':scope>summary').click();const presenter=source.locator('.presenter-detail');if(await presenter.count())await presenter.locator('summary').click();assert.match(await source.innerText(),/You should keep reports for 30 days/);
  await verifyVisuals(stat,deck,goto,true);
  const staticPdf=await stat.pdf({path:'.validation/architecture-static-deck.pdf',format:'A4',landscape:true,printBackground:true,preferCSSPageSize:true});assert.equal(pages(staticPdf),16);await staticContext.close();
  assert.deepEqual(errors,[]);assert.equal(await p.locator('animateMotion').count(),0);assert.equal(await p.evaluate(()=>__motionProbe().peak),1);assert.equal(await p.evaluate(()=>__motionProbe().intervals),0);
  console.log(`Mini visual checks: PASS (12 focused diagrams;${miniNodes} nodes;${miniEdges} paths;all node and edge phase highlights;directed and reference routes;7 complete agent explanations;6 leadership takeaway groups;4 economic hurdle values;shared packet motion)`);
  console.log('Browser checks: PASS (16 slides;31 retained topics;21 expanded developer sections plus4 cost topics;leadership takeaways and declared economic hurdle in live/static views;cost math/ROI/invalid cases;14-node24-edge architecture;one RAF and zero intervals;figure pause/reduced motion;all-slide geometry;mobile;offline single-file;no-JS;both16-page PDFs;zero page errors)');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1});
