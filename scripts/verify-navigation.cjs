'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PREFRONTAL_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PREFRONTAL_BASE_URL||'http://127.0.0.1:8893/';
const catalog=JSON.parse(fs.readFileSync('best-practices.json','utf8'));
const items=catalog.sections.flatMap(s=>s.items);
const resolve=(value,pointer)=>pointer.split('/').slice(1).reduce((value,key)=>value[key.replace(/~1/g,'/').replace(/~0/g,'~')],value);
let sourceChecks=0;const sources={};
function check(text,ref){if(!ref.file.endsWith('.json'))return;sources[ref.file]??=JSON.parse(fs.readFileSync(ref.file,'utf8'));assert.equal(resolve(sources[ref.file],ref.pointer),text,ref.file+ref.pointer);sourceChecks++;}
for(const item of items){check(item.text,item.source);for(const ref of item.references||[])check(item.text,ref);for(const detail of item.details||[])check(detail.text,detail.source);}
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const file of ['index.html','story.html','decisions.html','best-practices.html','motion-preview.html']){
  await page.goto(base+file);await page.waitForSelector('body[data-sidebar-ready=true]');
  assert.equal(await page.locator('.site-sidebar').count(),1,file+' one rail');
  assert.equal(await page.locator('.site-formats a').count(),4,file+' four formats');
  for(const width of [1440,1024,768,375]){
   await page.setViewportSize({width,height:900});
   await page.waitForFunction(()=>document.querySelector('.site-navigation').open===!matchMedia('(max-width:800px)').matches);
   if(width<=800){assert.equal(await page.locator('.site-navigation').getAttribute('open'),null);await page.locator('.sidebar-toggle').click();}
   const geometry=await page.locator('.site-sidebar').evaluate(rail=>{const box=rail.getBoundingClientRect(),sections=rail.querySelector('.sidebar-sections').getBoundingClientRect(),footer=rail.querySelector('.sidebar-bottom').getBoundingClientRect();return {left:box.left,width:box.width,height:box.height,sectionsBottom:sections.bottom,footerTop:footer.top};});
   assert.equal(geometry.left,0);assert(geometry.width<=260&&geometry.height<=900);assert(geometry.sectionsBottom<=geometry.footerTop+1,file+' navigation does not overlap footer');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),file+' document fits '+width);
   const primary=page.locator('.sidebar-actions .primary-action');await primary.scrollIntoViewIfNeeded();assert(await primary.isVisible());
   if(width<=800){await page.keyboard.press('Escape');assert.equal(await page.locator('.site-navigation').getAttribute('open'),null);assert(await page.locator('.sidebar-toggle').evaluate(e=>e===document.activeElement));}
   if(width===1440||width===375)await page.screenshot({path:'.validation/calm-'+file.replace('.html','')+'-'+width+'.png'});
  }
  await page.setViewportSize({width:1440,height:900});
  const duplicate=await page.locator('[id]').evaluateAll(es=>es.map(e=>e.id).filter((id,i,all)=>all.indexOf(id)!==i));assert.deepEqual(duplicate,[],file+' unique IDs');
 }
 await page.goto(base+'index.html#submission-template');await page.locator('#sidebar-topic').selectOption('0');assert(await page.locator('[data-source-slide=submission-template]').getAttribute('open')!==null);
 assert(await page.locator('[data-source-slide=submission-template] .practice-relocation').isVisible());
 assert(!(await page.locator('[data-source-slide=submission-template] .practice-print-original').first().isVisible()));
 const destination=await page.locator('[data-source-slide=submission-template] .practice-relocation a').first().getAttribute('href');
 await page.locator('[data-source-slide=submission-template] .practice-relocation a').first().click();await page.waitForURL('**/'+destination);assert(await page.locator(locationSelector(destination)).isVisible());
 await page.goto(base+'best-practices.html');
 const content=await page.locator('.practice-item').evaluateAll(es=>Object.fromEntries(es.map(e=>[e.id,e.textContent])));
 assert.equal(Object.keys(content).length,items.length);
 for(const item of items){assert(content[item.id].includes(item.title));assert(content[item.id].includes(item.text));for(const detail of item.details||[])assert(content[item.id].includes(detail.text));}
 await page.emulateMedia({media:'print'});assert.equal(await page.locator('.practice-item:visible').count(),items.length,'All practice detail prints');await page.emulateMedia({media:'screen'});
 for(const section of catalog.sections){await page.locator('.practice-chapters a[href="#'+section.id+'"]').click();assert.equal(new URL(page.url()).hash,'#'+section.id);assert(await page.locator('#'+section.id+' h2').isVisible());}
 // All authored paragraph text remains reachable across the story and the reference.
 await page.goto(base+'story.html#call-cost-anatomy');await page.waitForSelector('body[data-story-ready=true]');
 for(const option of ['0','1','2','3']){await page.locator('#sidebar-cost').selectOption(option);assert.equal(await page.locator('.suite-page:visible').count(),4,'Story cost navigation must not hide content');}
 const visibleStory=await page.locator('#deck').innerText();const referenceText=Object.values(content).join('\n');
 const deck=JSON.parse(fs.readFileSync('presentation-content.json','utf8'));
 for(const source of deck.slides.flatMap(s=>s.sections||[s]))for(const item of source.items||[])assert(visibleStory.includes(item.text)||referenceText.includes(item.text),source.id+' text reachable');
 assert.equal(await page.evaluate(()=>ContextMotion.profile.name),'calm');assert.equal(await page.evaluate(()=>ContextMotion.profile.tiltDegrees),1);assert.equal(await page.evaluate(()=>ContextMotion.profile.liftPx),4);
 // Deep links open retained-context disclosures and keep source links available.
 const retained=items.find(item=>!item.move);await page.goto(base+'best-practices.html#'+retained.id);assert(await page.locator('#'+retained.id).isVisible());
 for(const file of ['index.html','story.html','best-practices.html']){
  const offline=await browser.newPage({javaScriptEnabled:false});await offline.goto(pathToFileURL(path.resolve(file)).href);
  if(file==='best-practices.html'){assert.equal(await offline.locator('.practice-item').count(),237);await offline.locator('.practice-reference>summary').first().click();assert(await offline.locator('.practice-reference[open] .practice-item').first().isVisible());}
  else {await offline.locator('.sidebar-actions .primary-action').click();const position=await offline.locator('#static-full-architecture').boundingBox();assert(position.y<=80&&position.y>=-10,'No-JS architecture link arrives');await offline.locator('.sidebar-bottom a:visible').filter({hasText:'Why Prefrontal?'}).click();assert(await offline.locator('#static-why-prefrontal').isVisible());}
  await offline.close();
 }
 const offline=await browser.newPage();let external=0;offline.on('request',r=>{if(/^https?:/.test(r.url()))external++;});await offline.goto(pathToFileURL(path.resolve('best-practices.html')).href);assert.equal(external,0);await offline.close();
 assert.deepEqual(errors,[]);
 fs.writeFileSync('.validation/calm-navigation.json',JSON.stringify({surfaces:5,widths:[1440,1024,768,375],topics:catalog.sections.length,entries:items.length,sourceChecks,errors},null,2));
 console.log(`Navigation and practices: PASS (5 surfaces; 4 widths; left rail; mobile keyboard; no overlap; ${items.length} entries; ${sourceChecks} exact source checks; relocation links; all story cost views; offline/no-JS; calm profile; zero page errors)`);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
function locationSelector(href){return '#'+href.split('#')[1];}
