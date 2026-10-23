/* Real browser acceptance against the assembled Pages site. Failure injection
 * is isolated and labelled; it supplies no successful workspace measurements. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {chromium} = require(process.env.PREFRONTAL_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve('_site');
const output = path.resolve(process.env.PREFRONTAL_BROWSER_OUTPUT || '.validation/workspace/browser');
const prefix = '/Prefrontal-LLM-ASD-STE100/';
const userKey = 'prefrontal.workspace.v1.user';
const mime = {'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.md':'text/plain'};
fs.accessSync(path.join(root,'index.html'));
fs.mkdirSync(output,{recursive:true});
const server = http.createServer((req,res) => {
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405).end();return;}
  let filename;
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if (!pathname.startsWith(prefix)) throw new Error('prefix');
    filename = path.resolve(root,pathname.slice(prefix.length));
    if (filename !== root && !filename.startsWith(root + path.sep)) throw new Error('path');
    if (fs.statSync(filename).isDirectory()) filename = path.join(filename,'index.html');
    const body = fs.readFileSync(filename);
    res.writeHead(200,{'Content-Type':`${mime[path.extname(filename)] || 'application/octet-stream'}; charset=utf-8`,'Cache-Control':'no-store'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {res.writeHead(404).end('Not found');}
});
let browser;
const started = Date.now();
const receipt = {contract:'prefrontal.workspace.browser.acceptance.v1',source:'actual_browser_workflows',created_at:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch},results:[],failure_injections:[]};
const release=JSON.parse(fs.readFileSync(path.join(root,'release.json'),'utf8'));
const publicFiles=['index.html','styles.css','app.mjs','core.mjs','formats.mjs','demo.mjs','benchmark.json',
  'guides/quickstart.html','guides/developer.html','guides/scaling.html','.nojekyll',
  ...['best-practices.html','motion-preview.html','decisions.html','story.html','index.html','styles.css','app.js','diagrams.js','cost-lab.js','cost-lab.css','presentation-content.json'].map(name=>'presentation/'+name)];
assert.deepEqual(release.files.map(file=>file.path).sort(),publicFiles.slice().sort());
function walkPublic(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walkPublic(path.join(dir,entry.name)):[path.relative(root,path.join(dir,entry.name)).split(path.sep).join('/')]);}
assert.deepEqual(walkPublic(root).sort(),[...publicFiles,'release.json'].sort());
for(const file of release.files){const raw=fs.readFileSync(path.join(root,file.path));assert.equal(raw.length,file.bytes);assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),file.sha256);}
assert.equal(release.data_uploads,false);assert.equal(release.backend,'disconnected');
if(process.env.GITHUB_SHA)assert.equal(release.source_commit,process.env.GITHUB_SHA);
receipt.public_build={source_commit:release.source_commit,source_tree_dirty:release.source_tree_dirty,files:publicFiles.length+1,hashes_verified:true,private_artifacts:false};

async function idle(page) {await page.waitForFunction(() => document.body.getAttribute('aria-busy') !== 'true');}
async function stored(page) {return page.evaluate(key => {const raw=localStorage.getItem(key);return raw===null?null:JSON.parse(raw).workspace;},userKey);}
async function saveRecord(page,count) {await page.locator('#validate-record').click();await idle(page);assert.equal(await page.locator('#save-record').isDisabled(),false,await page.locator('#global-message').textContent());await page.locator('#save-record').click();await idle(page);assert.equal((await stored(page)).records.length,count);assert.equal(await page.locator('#save-indicator').textContent(),'Saved on this device');}
async function common(page,kind,id,name) {
  await page.locator('[data-view="build"]').click();
  if(await page.locator('#record-name').inputValue()) {page.once('dialog',d=>d.accept());await page.locator('#new-record').click();}
  await page.locator('#record-kind').selectOption(kind);
  await page.locator('#record-name').fill(name);
  await page.locator('#record-id').fill(id);
  await page.locator('#record-owner').fill('Synthetic test owner');
  await page.locator('#record-description').fill(`Synthetic ${kind} used only for browser acceptance.`);
  await page.locator('#record-narrative').fill('Keep the declared meaning and conditions. No external source or model is connected.');
}
async function clickView(page,view) {await page.locator(`[data-view="${view}"]`).click();await idle(page);}
async function inspect(page,id) {await clickView(page,'find');await page.locator('#search-query').fill(id);await page.locator('#search-form button[type="submit"]').click();await page.getByRole('button',{name:`Inspect ${id}`,exact:true}).click();await idle(page);}
async function downloadText(page,button) {const waiting=page.waitForEvent('download');await page.locator(button).click();const download=await waiting;const file=await download.path();assert(file);return {text:fs.readFileSync(file,'utf8'),name:download.suggestedFilename()};}
function fixture(id,name,narrative='A declared portable example.\r\nKeep this line.\n') {return {schema:'prefrontal.context.v1',id,version:1,layer:'ontology',kind:'term',name,aliases:[],description:'An independently written synthetic import fixture.',narrative,owner:'Synthetic fixture author',classification:'internal',valid_from:'2026-01-01T00:00:00Z',valid_until:null,provenance:[{path:'notes/example.txt',sha256:crypto.createHash('sha256').update('A declared portable example.').digest('hex')}],dependencies:[],spec:{definition:'A bounded example definition.',related_terms:[]}};}
function fixtureCanonical(value) {if(Array.isArray(value))return '['+value.map(fixtureCanonical).join(',')+']';if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+fixtureCanonical(value[key])).join(',')+'}';return JSON.stringify(value);}
function yamlFixture(record) {return Object.entries(record).map(([key,value]) => {
  if(key==='provenance')return `provenance:\n  - path: ${JSON.stringify(value[0].path)}\n    sha256: ${JSON.stringify(value[0].sha256)}`;
  if(key==='spec')return `spec:\n  definition: ${JSON.stringify(value.definition)}\n  related_terms: []`;
  return `${key}: ${JSON.stringify(value)}`;
}).join('\n')+'\n';}
async function importFixture(page,record,format,text,count,asFile=false) {
  await clickView(page,'build');await page.locator('#import-method').click();await page.locator('#import-format').selectOption(format);
  if(asFile)await page.locator('#import-file').setInputFiles({name:`fixture.${format==='markdown'?'md':format}`,mimeType:'text/plain',buffer:Buffer.from(text,'utf8')});
  else await page.locator('#import-text').fill(text);
  await idle(page);await page.locator('#import-form button[type="submit"]').click();await idle(page);
  assert.equal(await page.locator('#save-record').isDisabled(),false,await page.locator('#global-message').textContent());
  await page.locator('#save-record').click();await idle(page);const state=await stored(page);assert.equal(state.records.length,count);
  const actual=state.records.find(r=>r.id===record.id);assert.deepEqual(actual,record);assert(state.submissions.some(s=>s.text===text),'Original import bytes must be retained');
}
async function successFlow(base,width) {
  const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true,isMobile:width<600,hasTouch:width<600});
  const page=await context.newPage();const errors=[],requests=[],unexpected=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{const url=request.url();requests.push({url,method:request.method()});if(!url.startsWith(base)&&!url.startsWith('blob:'))unexpected.push(url);if(request.method()!=='GET')unexpected.push(request.method()+' '+url);});
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('#spec-definition'));await idle(page);
  assert.equal(await page.evaluate(()=>localStorage.length),0);assert.equal(await page.locator('#record-count').textContent(),'0');
  assert.equal(await page.locator('input[type="password"]').count(),0);assert.equal(await page.locator('input[name*="token"],input[name*="secret"],input[name*="credential"]').count(),0);
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle!=='none'),true);
  await page.locator('h1').click();await page.screenshot({path:path.join(output,`empty-${width}.png`),fullPage:false});
  receipt.build=await page.locator('meta[name="prefrontal-build"]').getAttribute('content');
  await common(page,'term','TERM_ORDER','Completed order');await page.locator('#spec-definition').fill('An order whose status is completed.');await saveRecord(page,1);
  const original=await page.evaluate(key=>localStorage.getItem(key),userKey);
  await page.locator('#record-name').fill('Pending second term');await page.locator('#spec-definition').fill('Unfinished meaning');
  await page.locator('#open-demo').click();await idle(page);assert.equal(await page.locator('#demo-notice').isVisible(),true);assert.equal(await page.evaluate(key=>localStorage.getItem(key),userKey),original);
  await clickView(page,'deliver');await page.locator('#compose-measure').selectOption('M_GROSS_ADDS');
  await page.locator('#selector-PERIOD').selectOption('PERIOD_2026_09');await page.locator('#selector-CHANNEL').selectOption('CHANNEL_ONLINE');await page.locator('#selector-PRODUCT').selectOption('PRODUCT_POSTPAID');
  await page.locator('#compose-form button[type="submit"]').click();await idle(page);assert.equal(await page.locator('#consumer-panel').isVisible(),true);
  const demo=JSON.parse(await page.locator('#consumer-payload').textContent());assert.equal(demo.records.length,13);assert.equal(new Set(demo.records.map(x=>x.record.kind)).size,9);assert.equal(new Set(demo.records.map(x=>x.record.layer)).size,4);assert.equal(demo.execution_authorized,false);assert.equal(demo.validation.evaluation,'not_evaluated');
  const demoDownload=await downloadText(page,'#export-consumer');assert.equal(JSON.parse(demoDownload.text).bundle_hash,demo.bundle_hash);
  await clickView(page,'storage');const demoBackup=await downloadText(page,'#export-workspace');
  await page.locator('#return-user').click();await idle(page);assert.equal(await page.locator('#record-name').inputValue(),'Pending second term');assert.equal(await page.locator('#spec-definition').inputValue(),'Unfinished meaning');assert.equal(await page.evaluate(key=>localStorage.getItem(key),userKey),original);
  await inspect(page,'TERM_ORDER');await page.locator('#edit-record').click();assert.equal(await page.locator('#record-id').inputValue(),'TERM_ORDER');assert.equal(await page.locator('#record-id').getAttribute('readonly'),'');
  await page.locator('#record-name').fill('Completed customer order');await saveRecord(page,2);let state=await stored(page);assert.equal(state.records[0].name,'Completed order');assert.equal(state.records[1].id,'TERM_ORDER');assert.equal(state.records[1].version,2);
  await clickView(page,'deliver');await page.locator('#compose-roots').selectOption('TERM_ORDER');await page.locator('#compose-form button[type="submit"]').click();await idle(page);assert.equal(JSON.parse(await page.locator('#consumer-payload').textContent()).records[0].record.version,2);
  await inspect(page,'TERM_ORDER');await page.locator('#reviewer-name').fill('Local synthetic reviewer');await page.locator('#review-confirm').check();await page.locator('#review-form button[type="submit"]').click();await idle(page);assert.match(await page.locator('#record-details').innerText(),/unauthenticated/);
  await clickView(page,'deliver');assert.equal(await page.locator('#consumer-panel').isVisible(),false,'Any state change clears old consumer evidence');
  await page.locator('#compose-form button[type="submit"]').click();await idle(page);const payload=await downloadText(page,'#export-consumer');assert.equal(payload.name,'prefrontal-consumer-context.json');assert.equal(JSON.parse(payload.text).execution_authorized,false);
  await clickView(page,'storage');const beforeWrongSlot=await page.evaluate(key=>localStorage.getItem(key),userKey);await page.locator('#restore-text').fill(demoBackup.text);await page.locator('#restore-form button[type="submit"]').click();await idle(page);assert.equal(await page.locator('#restore-preview').isVisible(),false);assert.equal(await page.evaluate(key=>localStorage.getItem(key),userKey),beforeWrongSlot);
  const backup=await downloadText(page,'#export-workspace');await page.locator('#restore-text').fill(backup.text);await page.locator('#restore-form button[type="submit"]').click();await idle(page);assert.equal(await page.locator('#restore-preview').isVisible(),true);assert.equal(await page.locator('#restore-apply').isDisabled(),true);await page.locator('#restore-confirm').check();await page.locator('#restore-apply').click();await idle(page);assert.equal((await stored(page)).records.length,2);
  let allKinds=null,imports=null,numeric=null;
  if(width===1440) {
    await common(page,'dimension','DIM_COUNT','Count');await page.locator('#spec-value_type').selectOption('integer');await saveRecord(page,3);
    await common(page,'member','DIM_COUNT_THREE','Three');await page.locator('#spec-dimension').selectOption('DIM_COUNT');
    for(const invalid of ['9007199254740990.9','9007199254740992','1e3']) {await page.locator('#spec-value').fill(invalid);await page.locator('#validate-record').click();await idle(page);assert.equal(await page.locator('#save-record').isDisabled(),true);assert.equal((await stored(page)).records.length,3);}
    await page.locator('#spec-value').fill('3');await saveRecord(page,4);assert.equal((await stored(page)).records.find(r=>r.id==='DIM_COUNT_THREE').spec.value,3);numeric=true;
    await common(page,'document','DOC_ORDER','Order instructions');await page.locator('#spec-summary').fill('A document for completed-order handling.');await page.locator('#spec-related').selectOption('TERM_ORDER');await saveRecord(page,5);
    await common(page,'event','EVENT_COMPLETED','Order completed event');await page.locator('#spec-trigger').fill('An order enters the completed state.');await page.locator('#spec-time_field').fill('completed_at');await page.locator('#spec-entities').selectOption('TERM_ORDER');await saveRecord(page,6);
    await common(page,'policy','POLICY_ORDER','Completed-only policy');await page.locator('#spec-rule').fill('Include completed orders. Exclude cancelled orders.');await page.locator('#spec-applies_to').selectOption(['EVENT_COMPLETED','DOC_ORDER']);await saveRecord(page,7);
    await common(page,'source','SOURCE_ORDERS','Order source');await page.locator('#spec-binding').fill('example.orders');await page.locator('#spec-grain').fill('order_id');await page.getByRole('button',{name:'Add a dimension mapping',exact:true}).click();await page.locator('.mapping-dimension').selectOption('DIM_COUNT');await page.locator('.mapping-column').fill('count');
    for(const invalid of ['9007199254740990.9','1e3']) {await page.locator('#spec-freshness_seconds').fill(invalid);await page.locator('#validate-record').click();await idle(page);assert.equal(await page.locator('#save-record').isDisabled(),true);}
    await page.locator('#spec-freshness_seconds').fill('86400');await saveRecord(page,8);
    await common(page,'guidance','GUIDE_ORDER','Order guidance');await page.locator('#spec-qualifiers').fill('Completed orders only.');await page.locator('#spec-caveats').fill('Not a production business definition.');await saveRecord(page,9);
    await common(page,'measure','M_ORDER','Completed order count');await page.locator('#spec-source').selectOption('SOURCE_ORDERS');await page.locator('#spec-expression').fill('count_completed_orders');await page.locator('#spec-required_dimensions').selectOption('DIM_COUNT');await page.locator('#spec-guidance').selectOption('GUIDE_ORDER');await saveRecord(page,10);
    assert.equal(new Set((await stored(page)).records.map(r=>r.kind)).size,9);allKinds=true;
    await clickView(page,'deliver');await page.locator('#compose-measure').selectOption('M_ORDER');await page.locator('#selector-DIM_COUNT').selectOption('DIM_COUNT_THREE');await page.locator('#compose-roots').selectOption('POLICY_ORDER');await page.locator('#compose-form button[type="submit"]').click();await idle(page);assert.equal(JSON.parse(await page.locator('#consumer-payload').textContent()).records.length,9);
    const json=fixture('TERM_JSON_IMPORT','JSON import');const jsonText=JSON.stringify(json,null,2).replace(/\n/g,'\r\n')+'\r\n';await importFixture(page,json,'json',jsonText,11,true);
    const yaml=fixture('TERM_YAML_IMPORT','YAML import');await importFixture(page,yaml,'yaml',yamlFixture(yaml),12);
    const md=fixture('TERM_MARKDOWN_IMPORT','Markdown import','<img src=x onerror="window.__workspaceXss=1">\nKeep this as inert evidence.');const {narrative,...metadata}=md;const mdText='# Prefrontal context record\n\n```json\n'+fixtureCanonical(metadata)+'\n```\n\n## Narrative\n\n'+narrative;await importFixture(page,md,'markdown',mdText,13);imports=true;
    await inspect(page,'TERM_JSON_IMPORT');await page.locator('#submission-details').locator('..').evaluate(el=>el.open=true);assert.match(await page.locator('#submission-details').textContent(),/Original imported record document/);
    await inspect(page,'TERM_MARKDOWN_IMPORT');assert.equal(await page.locator('#stored-record img').count(),0);assert.equal(await page.evaluate(()=>window.__workspaceXss),undefined);
    await clickView(page,'build');await page.locator('#import-method').click();await page.locator('#import-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from([0xc3,0x28])});await idle(page);assert.match(await page.locator('#global-message').textContent(),/not valid UTF-8/);assert.equal(await page.locator('#save-record').isDisabled(),true);assert.equal((await stored(page)).records.length,13);
    await page.locator('#import-format').selectOption('json');await page.locator('#import-text').fill('{"schema":"prefrontal.context.v1","schema":"prefrontal.context.v1"}');await page.locator('#import-form button[type="submit"]').click();await idle(page);assert.equal(await page.locator('#save-record').isDisabled(),true);
    await page.locator('#import-format').selectOption('yaml');await page.locator('#import-text').fill(yamlFixture(fixture('TERM_AMBIGUOUS','Ambiguous import')).replace('name: "Ambiguous import"','name: yes'));await page.locator('#import-form button[type="submit"]').click();await idle(page);assert.equal(await page.locator('#save-record').isDisabled(),true);assert.equal((await stored(page)).records.length,13);
  }
  await clickView(page,'storage');const currentBackup=await downloadText(page,'#export-workspace');assert.equal(JSON.parse(currentBackup.text).contract,'prefrontal.workspace.backup.v1');
  // Navigation is checked at the repository subpath, including preserved content.
  for(const suffix of ['guides/quickstart.html','guides/developer.html','guides/scaling.html','presentation/']) {const response=await page.request.get(base+suffix);assert.equal(response.status(),200,suffix);}
  await clickView(page,'find');await page.locator('#search-query').fill('');await page.locator('#search-form button[type="submit"]').click();if(width===1440){assert.equal(await page.locator('#search-next').isDisabled(),false);await page.locator('#search-next').click();assert.equal(await page.locator('#search-previous').isDisabled(),false);await page.locator('#search-previous').click();}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,`workspace-${width}.png`),fullPage:false});
  // User-triggered reload must recover confirmed persisted records. Accept the
  // browser's unsaved-form prompt because this test intentionally discards its
  // invalid import draft, not source workspace data.
  page.once('dialog',d=>d.accept());await page.reload();await page.waitForFunction(()=>document.querySelector('#spec-definition'));await idle(page);assert.equal(await page.locator('#save-indicator').textContent(),'Saved on this device');assert.equal((await stored(page)).records.length,width===1440?13:2);
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  receipt.results.push({width,mode:width<600?'mobile_emulation':'desktop',fresh_empty:true,guided_save:true,stable_id_version:2,local_review_unverified:true,demo_isolated:true,pending_form_preserved:true,demo_records:13,demo_kinds:9,demo_layers:4,knowledge_payload_download:true,backup_restore_explicit:true,wrong_slot_restore_denied:true,all_nine_guided_types:allKinds,exact_integer_regressions:numeric,three_format_imports:imports,invalid_utf8_rejected:imports,inert_hostile_text:imports,ambiguous_yaml_denied:imports,stored_reload:true,subpath_links:true,no_overflow:true,no_external_requests:true,no_uploads:true,page_errors:errors,request_count:requests.length});
  await context.close();
}
async function failureCases(base) {
  const context=await browser.newContext({viewport:{width:390,height:900}});const page=await context.newPage();await page.goto(base);await page.waitForFunction(()=>document.querySelector('#spec-definition'));await common(page,'term','TERM_PRESERVED','Preserved term');await page.locator('#spec-definition').fill('A preserved synthetic meaning.');await saveRecord(page,1);const before=await page.evaluate(key=>localStorage.getItem(key),userKey);
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.__originalSetItem=original;Storage.prototype.setItem=function(key,value){if(key.startsWith('prefrontal.workspace.v1.'))throw new DOMException('Injected quota denial','QuotaExceededError');return original.call(this,key,value);};});
  await common(page,'term','TERM_MEMORY_ONLY','Memory-only term');await page.locator('#spec-definition').fill('Keep this in memory when quota denies a write.');await page.locator('#validate-record').click();await idle(page);await page.locator('#save-record').click();await idle(page);assert.equal(await page.locator('#save-indicator').textContent(),'Not saved');assert.equal(await page.evaluate(key=>localStorage.getItem(key),userKey),before);await clickView(page,'storage');const backup=await downloadText(page,'#export-workspace');assert.equal(JSON.parse(backup.text).workspace.records.length,2);
  receipt.failure_injections.push({kind:'quota_write_failure',method:'Explicit Storage.prototype.setItem QuotaExceededError injection after a real save',previous_stored_bytes_preserved:true,memory_backup_contains_unsaved_record:true,saved_status:false});await context.close();
  const blocked=await browser.newContext({viewport:{width:360,height:900}});await blocked.addInitScript(()=>{Storage.prototype.getItem=function(){throw new DOMException('Injected storage read denial','SecurityError');};});const failed=await blocked.newPage();await failed.goto(base);await failed.waitForFunction(()=>document.querySelector('#spec-definition'));await idle(failed);assert.equal(await failed.locator('#save-indicator').textContent(),'Not saved');assert.match(await failed.locator('#global-message').textContent(),/storage|Storage/);assert.equal(await failed.locator('#record-count').textContent(),'0');receipt.failure_injections.push({kind:'storage_read_failure',method:'Explicit Storage.prototype.getItem SecurityError injection',empty_memory_state:true,saved_status:false});await blocked.close();
}
async function twoTabConsistency(base) {
  const context=await browser.newContext({viewport:{width:390,height:900},acceptDownloads:true});const first=await context.newPage();await first.goto(base);await first.waitForFunction(()=>document.querySelector('#spec-definition'));
  await common(first,'term','TERM_TABS','Two-tab term');await first.locator('#spec-definition').fill('A term used to test two-tab storage changes.');await saveRecord(first,1);await first.locator('#record-name').fill('Keep this pending user form');await first.locator('#open-demo').click();await idle(first);
  const second=await context.newPage();await second.goto(base);await second.waitForFunction(()=>document.querySelector('#spec-definition'));await clickView(second,'storage');await second.locator('#workspace-name').fill('Updated by second tab');await second.locator('#workspace-form button[type="submit"]').click();await idle(second);
  await first.locator('#return-user').click();await idle(first);await first.waitForFunction(()=>document.querySelector('#save-indicator').textContent==='Not saved');assert.equal(await first.locator('#record-name').inputValue(),'Keep this pending user form');assert.match(await first.locator('#storage-location').textContent(),/Another tab changed/);
  await clickView(first,'storage');first.once('dialog',d=>d.dismiss());await first.locator('#inspect-storage').click();await idle(first);await clickView(first,'build');assert.equal(await first.locator('#record-name').inputValue(),'Keep this pending user form','Cancelled readback must preserve pending form');
  await clickView(first,'storage');first.once('dialog',d=>d.accept());await first.locator('#inspect-storage').click();await idle(first);assert.equal(await first.locator('#workspace-title').textContent(),'Updated by second tab');assert.equal(await first.locator('#save-indicator').textContent(),'Saved on this device');
  await second.evaluate(()=>localStorage.clear());await first.waitForFunction(()=>document.querySelector('#save-indicator').textContent==='Not saved');assert.equal(await first.locator('#record-count').textContent(),'1');const backup=await downloadText(first,'#export-workspace');assert.equal(JSON.parse(backup.text).workspace.records.length,1);assert.equal(await first.evaluate(()=>localStorage.length),0);
  await first.locator('#inspect-storage').click();await idle(first);assert.equal(await first.locator('#save-indicator').textContent(),'Not saved');await first.locator('#workspace-form button[type="submit"]').click();await idle(first);assert.equal(await first.locator('#save-indicator').textContent(),'Saved on this device');assert.equal((await stored(first)).records.length,1);
  receipt.two_tab_consistency={method:'Actual two pages in one browser context; second page saved user workspace while first viewed demo, then called localStorage.clear()',inactive_slot_invalidated:true,pending_form_preserved:true,cancelled_readback_preserves_form:true,explicit_readback_refreshes:true,clear_event_invalidates_saved:true,memory_backup_after_clear:true,explicit_readback_then_resave:true};await context.close();
}
async function corruptSlotRecovery(base) {
  const context=await browser.newContext({viewport:{width:390,height:900},acceptDownloads:true});const seed=await context.newPage();await seed.goto(base);await seed.waitForFunction(()=>document.querySelector('#spec-definition'));await common(seed,'term','TERM_BACKUP','Backup term');await seed.locator('#spec-definition').fill('A term captured in a valid backup.');await saveRecord(seed,1);await clickView(seed,'storage');const validBackup=await downloadText(seed,'#export-workspace');await seed.locator('#open-demo').click();await idle(seed);await clickView(seed,'storage');await seed.locator('#workspace-form button[type="submit"]').click();await idle(seed);const otherSlot=await seed.evaluate(()=>localStorage.getItem('prefrontal.workspace.v1.demo'));
  const broken='{"broken":'+String.fromCharCode(0xd800);await seed.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:userKey,raw:broken});const page=await context.newPage();await page.goto(base);await page.waitForFunction(()=>document.querySelector('#spec-definition'));await idle(page);assert.equal(await page.locator('#save-indicator').textContent(),'Not saved');assert.equal(await page.evaluate(key=>localStorage.getItem(key),userKey),broken);
  await common(page,'term','TERM_UNSAVED','Unstored memory term');await page.locator('#spec-definition').fill('This must not overwrite corrupt stored bytes by ordinary save.');await page.locator('#validate-record').click();await idle(page);await page.locator('#save-record').click();await idle(page);assert.equal(await page.locator('#save-indicator').textContent(),'Not saved');assert.equal(await page.evaluate(key=>localStorage.getItem(key),userKey),broken);
  await clickView(page,'storage');assert.match(await page.locator('#storage-details').textContent(),/invalid Unicode/);await page.locator('#restore-text').fill(validBackup.text);await page.locator('#restore-form button[type="submit"]').click();await idle(page);assert.match(await page.locator('#restore-summary').textContent(),/stored bytes are unreadable/);assert.equal(await page.locator('#restore-apply').isDisabled(),true);
  const changed='{"changed-corrupt":';await seed.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:userKey,raw:changed});await page.locator('#restore-confirm').check();await page.locator('#restore-apply').click();await idle(page);assert.equal(await page.locator('#save-indicator').textContent(),'Not saved');assert.equal(await page.evaluate(key=>localStorage.getItem(key),userKey),changed,'A stale corrupt-state snapshot must not overwrite changed bytes');
  await page.locator('#inspect-storage').click();await idle(page);await page.locator('#restore-form button[type="submit"]').click();await idle(page);assert.equal(await page.locator('#restore-preview').isVisible(),true);await page.locator('#restore-confirm').check();await page.locator('#restore-apply').click();await idle(page);assert.equal(await page.locator('#save-indicator').textContent(),'Saved on this device');assert.equal((await stored(page)).records[0].id,'TERM_BACKUP');assert.equal(await page.evaluate(()=>localStorage.getItem('prefrontal.workspace.v1.demo')),otherSlot);await page.screenshot({path:path.join(output,'corrupt-slot-recovered-390.png'),fullPage:false});
  receipt.corrupt_slot_recovery={method:'Actual malformed JSON with an unpaired UTF-16 surrogate in localStorage, valid backup from prior guided save, then another page changed corrupt bytes after snapshot capture',malformed_unicode_display_does_not_crash:true,ordinary_save_cannot_replace:true,corrupt_bytes_preserved_before_confirmation:true,explicit_warning_and_confirmation:true,changed_snapshot_conflict_denied:true,explicit_readback_and_reconfirmation_recovers:true,other_mode_unchanged:true};await context.close();
}

(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base=`http://127.0.0.1:${server.address().port}${prefix}`;
  try {browser=await chromium.launch({headless:true});receipt.environment.browser=browser.version();for(const width of [1440,390,360])await successFlow(base,width);await failureCases(base);await twoTabConsistency(base);await corruptSlotRecovery(base);receipt.status='passed';receipt.elapsed_seconds=Number(((Date.now()-started)/1000).toFixed(3));fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));}
  finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
