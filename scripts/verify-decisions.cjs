const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PREFRONTAL_PLAYWRIGHT_MODULE||'playwright');
const data=JSON.parse(fs.readFileSync('decision-tree.json','utf8'));
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8893/decisions.html');
 assert.equal(await page.locator('.node').count(),data.nodes.length);
 assert.equal(await page.locator('.route').count(),data.edges.length);
 for(const n of data.nodes){assert(await page.locator('#reference-'+n.id).textContent().then(t=>t.includes(n.detail)));if(n.decision)assert(data.edges.filter(e=>e.source===n.id).length>=2,n.id);}
 const overflow=await page.locator('.node-button').evaluateAll(es=>es.filter(e=>e.scrollHeight>e.clientHeight+1).map(e=>e.textContent));assert.deepEqual(overflow,[]);
 const crossings=await page.evaluate(()=>{const nodes=[...document.querySelectorAll('.node')].map(n=>({id:n.id,x:parseFloat(n.style.left),y:parseFloat(n.style.top)}));const bad=[];document.querySelectorAll('.route').forEach(g=>{const p=g.querySelector('path'),len=p.getTotalLength();for(let k=3;k<len-3;k+=8){const q=p.getPointAtLength(k);const hit=nodes.find(n=>n.id!==g.dataset.from&&n.id!==g.dataset.to&&q.x>n.x+2&&q.x<n.x+298&&q.y>n.y+2&&q.y<n.y+164);if(hit){bad.push(g.dataset.from+' -> '+g.dataset.to+' crosses '+hit.id);break;}}});return bad;});assert.deepEqual(crossings,[]);
 await page.locator('#admit button').click();await page.getByRole('button',{name:'No Deny admission'}).count().then(async count=>{if(count)await page.getByRole('button',{name:'No Deny admission'}).click();else await page.locator('#inspector button').first().click();});
 assert(await page.locator('#inspector').textContent().then(t=>t.length>80));
 await page.locator('.phases a').last().click();await page.waitForTimeout(1000);assert.equal(await page.locator('#change').getAttribute('class'),'node decision active');
 await page.locator('#pause').click();assert.equal(await page.evaluate(()=>ContextMotion.stats().scheduled),false);
 await page.locator('#flat').click();assert(await page.locator('body').getAttribute('class').then(c=>c.includes('flat')));
 await page.locator('.phases a').first().click();await page.waitForTimeout(1000);await page.screenshot({path:'.validation/decisions-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.validation/decisions-mobile.png'});
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>ContextMotion.stats().scheduled),false);
 const staticPage=await browser.newPage({javaScriptEnabled:false});await staticPage.goto(require('node:url').pathToFileURL(require('node:path').resolve('decisions.html')).href);assert.equal(await staticPage.locator('.reference details').count(),data.nodes.length);
 assert.deepEqual(errors,[]);
 console.log(`Decision browser: PASS (${data.nodes.length} nodes, ${data.edges.length} routes; detail coverage, branches, phase navigation, mobile, pause, flat, reduced motion, offline/no-JS; zero page errors)`);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
