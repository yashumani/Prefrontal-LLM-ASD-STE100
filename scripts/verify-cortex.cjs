'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PREFRONTAL_PLAYWRIGHT_MODULE||'playwright');
const data=JSON.parse(fs.readFileSync('cortex-content.json','utf8'));
const tree=JSON.parse(fs.readFileSync('decision-tree.json','utf8'));
const base=process.env.PREFRONTAL_BASE_URL||'http://127.0.0.1:8893/';
(async()=>{const browser=await chromium.launch();const errors=[];try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 for(const file of ['story.html','decisions.html']){
  await page.goto(base+file);if(file==='story.html')await page.waitForSelector('body[data-story-ready=true]');
  const section=page.locator('.cortex-section');assert.equal(await section.count(),1);
  assert.equal(await section.locator('.cortex-mapping').count(),5);
  for(const m of data.mappings){assert(tree.nodes.some(n=>n.id===m.targetNode));const card=page.locator('#cortex-'+m.id);for(const field of ['region','location','fact','analogy','boundary','designTitle'])assert((await card.textContent()).includes(m[field]),field);for(const id of m.sourceIds){const source=data.sources.find(s=>s.id===id);assert(source);assert.equal(await card.locator(`a[href="${source.url}"]`).count(),1);}}
  assert((await section.textContent()).includes(data.development.text));
  for(const source of data.sources)assert((await section.locator(`a[href="${source.url}"]`).count())>0,source.id+' cited');
  await section.locator('.cortex-stage').scrollIntoViewIfNeeded();await page.waitForTimeout(200);
  const dot=section.locator('.cortex-packet'),first=await dot.getAttribute('cx');await page.waitForTimeout(180);assert.notEqual(await dot.getAttribute('cx'),first,'Path marker moves when visible');
  await section.locator('.cortex-motion').click();const paused=await dot.getAttribute('cx');await page.waitForTimeout(180);assert.equal(await dot.getAttribute('cx'),paused,'Local pause stops this visual');
  await section.locator('.cortex-motion').click();
  const valuation=section.locator('[data-cortex-region="valuation"]');
  await valuation.scrollIntoViewIfNeeded();
  await valuation.evaluate(link=>{
   window.cortexClickSelections=[];let record=false;
   link.addEventListener('click',()=>{record=true;},{once:true});
   addEventListener('scroll',()=>{if(record)window.cortexClickSelections.push(link.closest('.cortex-section').querySelector('[aria-current="location"]')?.dataset.cortexRegion);},{passive:true});
  });
  await valuation.click();assert.equal(await valuation.getAttribute('aria-current'),'location');
  await page.waitForFunction(()=>Math.abs(document.getElementById('cortex-valuation').getBoundingClientRect().top-110)<=2);
  assert.equal(await valuation.getAttribute('aria-current'),'location','Chosen region remains selected after anchor arrival');
  assert((await page.evaluate(()=>window.cortexClickSelections)).every(id=>id==='valuation'),'Intermediate cards cannot override the chosen region');
  await page.locator('#cortex-inhibition').evaluate(card=>card.scrollIntoView({behavior:'instant',block:'start'}));
  await page.waitForFunction(()=>document.querySelector('[data-cortex-region="inhibition"]')?.getAttribute('aria-current')==='location');
  // A wheel gesture cancels a pending smooth journey before its destination.
  await valuation.evaluate(link=>{
   document.documentElement.style.scrollBehavior='smooth';link.click();
   dispatchEvent(new WheelEvent('wheel',{deltaY:-100}));
   document.getElementById('cortex-working-memory').scrollIntoView({behavior:'instant',block:'start'});
   document.documentElement.style.removeProperty('scroll-behavior');
  });
  await page.waitForFunction(()=>document.querySelector('[data-cortex-region="working-memory"]')?.getAttribute('aria-current')==='location');
  await valuation.click();await page.waitForFunction(()=>Math.abs(document.getElementById('cortex-valuation').getBoundingClientRect().top-110)<=2);
  await page.screenshot({path:'.validation/cortex-'+file.replace('.html','')+'-mapping.png'});
  await section.locator('.cortex-stage').scrollIntoViewIfNeeded();await page.screenshot({path:'.validation/cortex-'+file.replace('.html','')+'-visual.png'});
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await dot.evaluate(e=>getComputedStyle(e).display),'none');assert.equal(await section.locator('.cortex-diagram').evaluate(e=>getComputedStyle(e).transform),'none');await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setViewportSize({width:390,height:844});await section.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('#cortex-inhibition').scrollIntoViewIfNeeded();await page.screenshot({path:'.validation/cortex-'+file.replace('.html','')+'-mobile.png'});await page.setViewportSize({width:1440,height:1000});
  const nojs=await browser.newPage({javaScriptEnabled:false});await nojs.goto(pathToFileURL(path.resolve(file)).href);assert.equal(await nojs.locator('.cortex-mapping:visible').count(),5);assert((await nojs.locator('.cortex-section:visible').textContent()).includes(data.development.text));await nojs.close();
 }
 await page.goto(base+'decisions.html#why-prefrontal');await page.locator('#cortex-inhibition .cortex-node-link').click();await page.waitForSelector('#authorized.active');assert((await page.locator('#inspector').textContent()).includes('scope'));
 const offline=await browser.newPage();let requests=0;offline.on('request',r=>{if(/^https?:/.test(r.url()))requests++;});await offline.goto(pathToFileURL(path.resolve('decisions.html')).href);assert.equal(requests,0);await offline.close();
 assert.deepEqual(errors,[]);console.log('Cortex checks: PASS (5 sourced mappings; 9 cited sources; two scrolling views; decision links; motion/pause/reduced motion; mobile; offline/no-JS; zero page errors)');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
