'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PREFRONTAL_PLAYWRIGHT_MODULE||'playwright');
const data=JSON.parse(fs.readFileSync('presentation-content.json','utf8'));
const base=process.env.PREFRONTAL_BASE_URL||'http://127.0.0.1:8893/';
(async()=>{const browser=await chromium.launch();const errors=[];try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'story.html');await page.waitForSelector('body[data-story-ready=true]');
 assert.equal(await page.locator('#deck>.slide:visible').count(),16);
 assert.equal(await page.locator('#deck details:not([open])').count(),0);
 assert.equal(await page.locator('.suite-page:visible').count(),4);
 assert(await page.locator('.presentation-format').getAttribute('href').then(x=>x.startsWith('index.html')));
 const allText=await page.locator('#deck').textContent();
 for(const slide of data.slides){assert(allText.includes(slide.title),slide.id+' heading retained');for(const section of slide.sections||[]){assert(allText.includes(section.title),section.id+' source topic retained');}}
 // Authoritative source paragraphs are present, including hidden-detail alternatives.
 for(const slide of data.slides.flatMap(s=>s.sections||[s]))for(const item of slide.items||[]){assert(allText.includes(item.text),slide.id+' item retained: '+item.title);}
 assert.equal(await page.locator('.story-chapters a').count(),16);
 const duplicate=await page.locator('[id]').evaluateAll(nodes=>nodes.map(n=>n.id).filter((id,i,all)=>all.indexOf(id)!==i));assert.deepEqual(duplicate,[]);
 const first=page.locator('.story-scene').first(),cards=first.locator('.story-step');
 assert((await cards.count())>=4);
 await cards.nth(2).scrollIntoViewIfNeeded();await page.waitForTimeout(350);
 assert.equal(await first.locator('figure').getAttribute('data-scroll-stage'),'2','Scroll selects the matching authored stage.');
 await page.waitForFunction(()=>document.querySelector('.story-scene svg').dataset.currentStep==='2');
 const stickyBox=await first.locator('figure').boundingBox();assert(stickyBox.y>=70&&stickyBox.y<150&&stickyBox.y+stickyBox.height<1000,'Diagram remains beside the active insight.');
 await page.locator('#motion-toggle').click();assert.equal(await page.evaluate(()=>ContextMotion.stats().scheduled),false);
 await cards.nth(3).scrollIntoViewIfNeeded();assert(await first.locator('svg').evaluate(s=>s.classList.contains('is-static')));
 await page.locator('#motion-toggle').click();
 for(const index of [0,4,8,9,11,12,13,15]){
  await page.goto(base+'story.html#'+data.slides[index].id);await page.waitForSelector('body[data-story-ready=true]');
  assert.equal(await page.locator('.story-chapters a[aria-current]').getAttribute('href'),'#'+data.slides[index].id);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Desktop width '+index);
  await page.screenshot({path:'.validation/story-'+(index+1)+'.png'});
 }
 await page.goto(base+'story.html#bounded-decision-router');await page.waitForSelector('body[data-story-ready=true]');
 const start=await page.evaluate(()=>scrollY);await page.keyboard.press('PageDown');await page.waitForTimeout(250);assert((await page.evaluate(()=>scrollY))>start,'PageDown retains native scrolling');
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>ContextMotion.stats().scheduled===false);assert.equal(await page.evaluate(()=>ContextMotion.stats().scheduled),false);assert(await page.locator('#motion-toggle').isDisabled());
 await page.emulateMedia({reducedMotion:'no-preference'});
 for(const width of [390,768]){await page.setViewportSize({width,height:844});for(const index of [0,4,8,11,12,15]){await page.goto(base+'story.html#'+data.slides[index].id);await page.waitForSelector('body[data-story-ready=true]');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile overflow '+index+' width'+width);}await page.goto(base+'story.html#bounded-decision-router');await page.waitForSelector('body[data-story-ready=true]');await page.screenshot({path:'.validation/story-mobile-'+width+'.png'});}
 const offline=await context.newPage();let requests=0;offline.on('request',r=>{if(/^https?:/.test(r.url()))requests++;});await offline.goto(pathToFileURL(path.resolve('story.html')).href);await offline.waitForSelector('body[data-story-ready=true]');assert.equal(requests,0);await offline.close();
 const staticContext=await browser.newContext({javaScriptEnabled:false});const stat=await staticContext.newPage();await stat.goto(base+'story.html');assert.equal(await stat.locator('.static-presentation>.slide').count(),16);assert.equal(await stat.locator('.static-presentation details:not([open])').count(),0);assert.equal(await stat.locator('.dev:visible').count(),await stat.locator('.dev').count());await staticContext.close();
 assert.deepEqual(errors,[]);console.log('Scrolling story: PASS (16 chapters; all source topics and item text; expanded detail; four cost views; scroll-stage binding; pause/reduced motion; native keyboard scroll; desktop/mobile; offline and no-JS; zero page errors)');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
