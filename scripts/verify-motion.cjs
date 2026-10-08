'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PREFRONTAL_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PREFRONTAL_BASE_URL||'http://127.0.0.1:8893/';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 for(const file of ['index.html','story.html','decisions.html']){
  await page.goto(base+file);await page.waitForFunction(()=>Boolean(window.ContextMotion));
  for(const width of [1440,1024,768,375]){
   await page.setViewportSize({width,height:900});await page.evaluate(()=>scrollTo(0,0));
   const action=page.locator(file==='index.html'?'.slide:not([hidden]) .primary-action':'.product-intro .primary-action');
   await action.waitFor({state:'visible'});const box=await action.boundingBox();
   assert(box.y>=0&&box.y+box.height<=900,`${file} primary action above fold at ${width}`);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${file} width ${width}`);
   assert(await page.locator(file==='index.html'?'.product-audience:visible':'.product-kicker').textContent().then(t=>/AI.*data.*governance/i.test(t)),`${file} audience explicit`);
   if(width<=1100)assert.equal(await page.evaluate(()=>ContextMotion.stats().activeDepth),0,'No mobile depth work');
   if(width===1440||width===375)await page.screenshot({path:'.validation/hierarchy-after-'+file.replace('.html','')+'-'+width+'.png'});
  }
  await page.setViewportSize({width:1440,height:960});
  if(file==='index.html'){
   await page.locator('.slide:not([hidden]) .primary-action').click();await page.locator('[data-slide="full-architecture"]:visible').waitFor();
   await page.locator('#next').click();await page.locator('[data-slide="existing-stack"]:visible').waitFor();
   await page.evaluate(()=>{document.getElementById('next').click();document.getElementById('next').click();});
   await page.locator('[data-slide="context-contract"]:visible').waitFor();
  }else{
   const stage=page.locator('.cortex-stage');await stage.scrollIntoViewIfNeeded();await page.waitForTimeout(200);
   await page.locator('.cortex-motion').click();assert.equal(await page.evaluate(()=>ContextMotion.stats().scheduled),false);
   const global=page.locator(file==='story.html'?'#motion-toggle':'#pause');
   assert.equal(await global.getAttribute('aria-pressed'),'true','Cortex pause synchronizes global control');
   await global.click();assert.equal(await page.locator('.cortex-motion').getAttribute('aria-pressed'),'false');
   if(file==='decisions.html'){
    await page.locator('.phases a').first().click();
    // A long native scroll from the cortex section has no fixed completion time.
    // Wait for the selected source to be on screen before asserting its animation.
    await page.waitForFunction(()=>{
     const button=document.querySelector('.node.active .node-button');if(!button)return false;
     const box=button.getBoundingClientRect();
     return box.top>=document.querySelector('header').getBoundingClientRect().bottom&&box.bottom<=innerHeight&&button.dataset.playing==='true';
    });
    await page.locator('#flat').click();assert.equal(await page.evaluate(()=>ContextMotion.state().depth),false);
    const dot=page.locator('.route.selected .flow-dot').first();const position=()=>dot.evaluate(e=>[e.getAttribute('cx'),e.getAttribute('cy')].join(','));
    await page.waitForFunction(()=>document.querySelector('.route.selected .flow-dot')?.hasAttribute('cx'));
    const before=await position();
    await page.waitForFunction(before=>{const d=document.querySelector('.route.selected .flow-dot');return d&&[d.getAttribute('cx'),d.getAttribute('cy')].join(',')!==before;},before);
    assert.notEqual(await position(),before,'Flat retains selected route flow');assert(await dot.isVisible());
    await page.evaluate(()=>document.getElementById('product-start').scrollIntoView({behavior:'instant'}));
    await page.waitForFunction(()=>ContextMotion.stats().scheduled===false);
    await page.setViewportSize({width:375,height:900});await page.locator('#admit button').click();
    assert(await page.locator('.inspector-close').isVisible());const inspector=await page.locator('#inspector').boundingBox();assert(inspector.height<=900*.36+2,'Mobile inspector bounded');
    await page.screenshot({path:'.validation/hierarchy-after-map-mobile.png'});await page.locator('.inspector-close').click();assert(!(await page.locator('#inspector').isVisible()));
   }
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>ContextMotion.stats().scheduled),false);
  assert.equal(await page.evaluate(()=>ContextMotion.stats().activeDepth),0);
  await page.emulateMedia({reducedMotion:'no-preference'});
 }
 await page.goto(base+'motion-preview.html');assert.equal(await page.locator('.variant').count(),3);
 await page.locator('#pause').click();await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>PreviewMotion.stats().scheduled),false);
 // A bounded desktop sample under 4x CPU slowdown; not a device-wide fps claim.
 await page.setViewportSize({width:1440,height:960});await page.goto(base+'story.html#bounded-decision-router');
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Performance.enable');
 await page.waitForTimeout(300);const initial=await cdp.send('Performance.getMetrics');const frames0=await page.evaluate(()=>ContextMotion.stats().frames);
 for(let i=0;i<8;i++){await page.mouse.wheel(0,130);await delay(160);}await delay(600);
 const final=await cdp.send('Performance.getMetrics'),frames1=await page.evaluate(()=>ContextMotion.stats().frames);
 const metrics={};for(const name of ['LayoutCount','RecalcStyleCount','TaskDuration','ScriptDuration'])metrics[name]=final.metrics.find(m=>m.name===name).value-initial.metrics.find(m=>m.name===name).value;
 fs.writeFileSync('.validation/motion-performance.json',JSON.stringify({cpuSlowdown:4,sample:'8 scroll events plus settling',frames:frames1-frames0,metrics,limitation:'Synthetic desktop sample; no universal frame-rate claim.'},null,2));
 assert.deepEqual(errors,[]);
 console.log('Motion and hierarchy: PASS (three surfaces, four widths, primary actions, audience, shared pause, flat route flow, mobile inspector, reduced motion, preview; zero page errors)');
 console.log('Performance sample: '+JSON.stringify(metrics));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
