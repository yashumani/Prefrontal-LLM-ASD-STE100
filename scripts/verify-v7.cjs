"use strict";
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const near=(actual,expected,label)=>assert(Math.abs(actual-expected)<1e-8,`${label}: expected ${expected}, got ${actual}`);
const golden={chat:[5,.055335,11.62035],summary:[2,.08768319,9.20673495],sql:[9,.23386275,49.1111775],agent:[24,4.67075136,294.25733568],batch:[1,.00007956,1.67076],code:[72,5.1213624,215.0972208]};
function verifyModel(deck){
 const sandbox={window:{}};vm.runInNewContext(fs.readFileSync('cost-lab.js','utf8'),sandbox);const calc=sandbox.window.ContextCostLab.calculate;
 for(const p of deck.costLab.presets){const m=deck.costLab.models.find(m=>m.id===p.model);const r=calc(p.a,{...m,people:p.people,perDay:p.perDay,days:21,batchMultiplier:p.batch?.5:1});assert(r.valid);assert.equal(r.calls.length,golden[p.id][0]);near(r.cost,golden[p.id][1],p.id+' task');near(r.person,golden[p.id][2],p.id+' month');near(r.team,r.person*p.people,p.id+' team');near(Object.values(r.cat).reduce((s,n)=>s+n,0)+r.cacheWrite,r.cost,p.id+' breakdown');}
 const a={qWords:75,sys:100,tools:0,doc:200,turns:2,steps:2,res:30,stepOut:20,think:40,ansWords:75,retry:0,cache:0};const o={in:2,cr:.2,out:10,wr:1.25,tok:1};
 const r=calc(a,o);assert.equal(r.tin,2200);assert.equal(r.tout,400);near(r.cost,.0084,'hand-worked four-call example');
 const c=calc({...a,cache:50,retry:10},o);near(c.tcached,750,'cached input');near(c.cacheWrite,.00015,'first-call write');near(c.cost,.00792,'cache and retry');near(calc({...a,cache:50,retry:10},{...o,batchMultiplier:.5,residencyMultiplier:1.1}).cost,.004356,'factors applied once');
 near(calc(a,{...o,historyMode:'none'}).cost,.0074,'no earlier history');
 const noCache=calc({...a,cache:50},{...o,cacheEligible:false});near(noCache.cost,r.cost,'ineligible cache');assert.equal(noCache.tcached,0);assert.equal(noCache.cacheWrite,0);
 for(const [key,value] of [['turns',0],['steps',1.5],['qWords',''],['doc',-1],['cache',101],['think',Infinity]])assert.equal(calc({...a,[key]:value},o).valid,false,key+' invalid');
 assert.equal(calc({...a,turns:501,steps:2},o).valid,false,'call ceiling');assert.equal(calc(a,{...o,days:-1}).valid,false,'negative usage');assert.equal(calc(a,{...o,inputRate:NaN}).valid,false,'invalid price');near(calc(a,{...o,perDay:0}).team,0,'zero usage');
 console.log('V7 model checks: PASS (six source goldens; independent four-call arithmetic; cache eligibility/writes; factors once; history; monthly scope; invalid-input rejection)');
}
async function verifyVisuals(page,deck,goto,staticMode=false){
 const prefix=staticMode?'#static-':'#panel-';
 const views=[['call-cost-anatomy','planner'],['call-cost-anatomy','hidden'],['call-cost-anatomy','budget']];
 for(const [id,view]of views){if(!staticMode){await goto(page,id);await page.locator('.suite-tabs [data-cost-view="'+view+'"]').click();}const lab=page.locator(prefix+id+' .cost-lab[data-cost-view="'+view+'"]');assert.equal(await lab.count(),1);if(staticMode){for(const disclosure of await lab.locator('xpath=ancestor::details').all())if(await disclosure.getAttribute('open')===null)await disclosure.locator(':scope>summary').click();assert(await lab.isVisible(),'Static cost detail must be reachable through native disclosures.');}assert.match(await lab.innerText(),/model token cost only/i);assert.match(await lab.innerText(),/example|default/i);assert.equal(await lab.locator('.cl-error').count(),0);for(const chart of await lab.locator('svg.cl-chart').all()){assert(await chart.locator('title').textContent());assert(await chart.locator('desc').textContent());const outside=await chart.evaluate(svg=>{const v=svg.viewBox.baseVal;return [...svg.querySelectorAll('text')].filter(t=>{const b=t.getBBox();return b.x<v.x-1||b.y<v.y-1||b.x+b.width>v.x+v.width+1||b.y+b.height>v.y+v.height+1}).map(t=>t.textContent)});assert.deepEqual(outside,[],view+' chart labels');}}
 const names=await page.locator((staticMode?'.static-presentation ':'#deck ')+'.cl-chart').evaluateAll(svgs=>svgs.map(s=>s.dataset.chart).sort());assert.deepEqual(names,['cost-breakdown','cost-iceberg','model-routing','monthly-budget','repeat-calls','settings-dials','summary-token-bars','token-flow'].sort());
 if(staticMode){near(Number(await page.locator('#static-call-cost-anatomy .cost-lab[data-cost-view="planner"] [data-cost-value="task"]').getAttribute('data-number')),golden.summary[1],'static summary');return;}
 await goto(page,'call-cost-anatomy');await page.locator('.suite-tabs [data-cost-view="planner"]').click();const planner=page.locator('#panel-call-cost-anatomy .suite-page[data-cost-page="planner"] .cost-lab');
 assert.equal(await planner.locator('[data-cost-preset]').count(),6);
 for(const p of deck.costLab.presets){await planner.locator('[data-cost-preset="'+p.id+'"]').click();near(Number(await planner.locator('[data-cost-value="task"]').getAttribute('data-number')),golden[p.id][1],p.id+' UI');near(Number(await planner.locator('[data-cost-value="calls"]').getAttribute('data-number')),golden[p.id][0],p.id+' UI calls');}
 await planner.locator('[data-cost-preset="summary"]').click();
 await page.locator('[data-view="dev"]').click();await planner.locator('.cl-details').first().locator('summary').click();const controls=planner.locator('.cl-details').first();
 await controls.locator('[data-cost-field="inputRate"]').fill('');assert(await planner.locator('.cl-error').isVisible());assert.equal(await planner.locator('[data-cost-value="task"]').count(),0,'invalid estimate is hidden');await controls.locator('[data-cost-field="inputRate"]').fill('3');near(Number(await planner.locator('[data-cost-value="task"]').getAttribute('data-number')),golden.summary[1],'recovery');
 await controls.locator('[data-cost-field="cacheEligible"]').uncheck();assert.equal(Number(await planner.locator('[data-cost-value="cached-tokens"]').getAttribute('data-number')),0);await controls.locator('[data-cost-field="cacheEligible"]').check();
 await controls.locator('[data-cost-field="outputRate"]').fill('30');const task=Number(await planner.locator('[data-cost-value="task"]').getAttribute('data-number'));assert(task>golden.summary[1]);
 await controls.locator('summary').click();await page.locator('.suite-tabs [data-cost-view="budget"]').click();const budget=page.locator('#panel-call-cost-anatomy .suite-page[data-cost-page="budget"] .cost-lab');near(Number(await budget.locator('[data-cost-value="team"]').getAttribute('data-number')),task*5*21*20,'shared edited rate');
 await budget.locator('.cl-knobs [data-cost-field="people"]').fill('40');near(Number(await budget.locator('[data-cost-value="team"]').getAttribute('data-number')),task*5*21*40,'team update');
 await page.locator('.suite-tabs [data-cost-view="hidden"]').click();const hidden=page.locator('#panel-call-cost-anatomy .suite-page[data-cost-page="hidden"] .cost-lab');assert.equal(await hidden.locator('.cl-knobs [data-cost-field="preset"]').inputValue(),'summary');await hidden.locator('.cl-knobs [data-cost-field="steps"]').fill('0');assert(await hidden.locator('.cl-error').isVisible());await hidden.locator('.cl-knobs [data-cost-field="steps"]').fill('1');assert.equal(await hidden.locator('.cl-error').count(),0);
 await page.locator('.suite-tabs [data-cost-view="planner"]').click();await planner.locator('[data-cost-preset="summary"]').click();near(Number(await planner.locator('[data-cost-value="task"]').getAttribute('data-number')),golden.summary[1],'restore defaults');
 console.log('V7 visual checks: PASS (consolidated cost views; eight cost charts; six UI presets; synchronized rates/usage; invalid estimates hidden; recovery; static defaults)');
}
module.exports={verifyModel,verifyVisuals};
if(require.main===module)verifyModel(JSON.parse(fs.readFileSync('presentation-content.json','utf8')));
