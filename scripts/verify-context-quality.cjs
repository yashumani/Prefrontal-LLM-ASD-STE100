'use strict';
// Actual reports are served by the real Python viewer. One intercepted hostility
// check is separate, clearly labelled, and never counted as evaluator evidence.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.PREFRONTAL_PLAYWRIGHT_MODULE||'playwright');
const manifestPath=process.argv[2]||'.validation/evaluation/browser-inputs.json';
const output=path.resolve(process.argv[3]||'.validation/evaluation/browser');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
assert(Array.isArray(manifest)&&manifest.length,'Supply actual report cases in the manifest.');
const receipts=[];
const shown=value=>value===null||value===undefined?'Not evaluated':String(value);
const stateLabel=state=>({measured:'Measured',passed:'Passed',failed:'Failed',missing:'Not evaluated',not_evaluated:'Not evaluated',partial:'Partially covered',stale:'Stale'}[state]||'Not evaluated');
function server(report){
  const code='import json,sys; from pilot.context_quality_ui import create_server; s=create_server(sys.argv[1],0); print(json.dumps({"url":"http://127.0.0.1:%s/"%s.server_port}),flush=True); s.serve_forever()';
  const child=spawn(process.env.PREFRONTAL_PYTHON||'python',['-B','-c',code,path.resolve(report)],{cwd:process.cwd(),stdio:['ignore','pipe','pipe'],windowsHide:true});
  return new Promise((resolve,reject)=>{let data='',errors='';const timeout=setTimeout(()=>{child.kill();reject(new Error('Viewer startup timed out'));},15000);child.stderr.on('data',chunk=>{errors+=chunk;});child.once('error',error=>{clearTimeout(timeout);reject(error);});child.stdout.on('data',chunk=>{data+=chunk;if(data.includes('\n')){clearTimeout(timeout);try{resolve({child,url:JSON.parse(data.trim().split('\n')[0]).url});}catch(error){child.kill();reject(error);}}});child.once('exit',code=>{clearTimeout(timeout);if(!data)reject(new Error(`Viewer stopped (${code}): ${errors}`));});});
}
async function main(){
 fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true});
 try{
  for(const entry of manifest){
   assert(entry.report&&entry.label&&/^[a-z0-9_-]+$/.test(entry.label));
   const live=await server(entry.report);const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
   try{
    const apiResponse=await context.request.get(live.url+'api/evaluation');assert.equal(apiResponse.status(),200);const actual=await apiResponse.json();
    if(entry.acceptance)assert.equal(actual.acceptance,entry.acceptance,entry.label+' actual report acceptance');
    await page.goto(live.url);await page.waitForFunction(()=>document.querySelector('#refresh')?.disabled===false&&document.querySelector('#gate-banner')?.dataset.acceptance);
    assert.equal(await page.locator('#gate-banner').getAttribute('data-acceptance'),actual.acceptance);
    assert.equal(await page.locator('#layers>.layer').count(),4);assert.equal(await page.locator('#crosscuts>.crosscut').count(),4);
    assert.equal(await page.locator('[data-aggregate-score],#aggregate-score,#overall-score').count(),0);
    assert.equal(await page.locator('#coverage tr').count(),Math.max(1,actual.checks.length));
    assert.equal(await page.locator('#coverage-summary').innerText(),`${shown(actual.coverage.executed)} executed / ${shown(actual.coverage.planned)} planned cases`,'coverage unknown counts remain distinct from observed zero');
    assert.equal(await page.locator('#cases details').count(),actual.checks.reduce((n,c)=>n+c.cases.length,0));
    for(const check of actual.checks){
      const measurement=page.locator('.measurement').filter({has:page.locator('.check-name').filter({hasText:check.name})});
      const expected=typeof check.score.value==='number'&&check.score.denominator>0?`${(check.score.value*100).toFixed(1).replace(/\.0$/,'')}%`:'Not evaluated';
      assert.equal(await measurement.locator('.value').innerText(),expected,check.id+' rendered score equals report');
      assert.equal(await measurement.locator('.pill').innerText(),stateLabel(check.status),check.id+' rendered state equals report');
      const unit=check.id==='retrieval_precision'?'hits / returned':check.id==='retrieval_recall'?'hits / relevant':'passed / measured';
      const ratio=check.score.denominator>0?`${shown(check.score.numerator)} / ${shown(check.score.denominator)} ${unit}`:'Not evaluated';
      assert.equal(await measurement.locator('.measure-meta').first().innerText(),check.score.denominator>0?ratio:'No measured denominator',check.id+' ratio units equal report');
      const coverageRow=page.locator('#coverage tr').filter({has:page.locator('td').first().filter({hasText:check.name})});
      assert.equal(await coverageRow.locator('.pill').innerText(),stateLabel(check.status),check.id+' coverage state equals report');
      assert.equal((await coverageRow.locator('td').last().innerText()).replace(/\s+/g,' ').trim(),ratio,check.id+' coverage ratio equals report');
    }
    assert.equal(await page.locator('#model .model-status').innerText(),'Not evaluated');
    const modelCounts=page.locator('#model .model-counts strong');
    assert.equal(await modelCounts.nth(0).innerText(),shown(actual.model_comparison.paired_executions),'paired execution unknown remains distinct from observed zero');
    assert.equal(await modelCounts.nth(1).innerText(),shown(actual.model_comparison.held_out_cases),'held-out unknown remains distinct from observed zero');
    assert.equal(await page.locator('#model .model-copy').nth(1).innerText(),`Model calls: ${shown(actual.runtime.model_calls)} · Network calls: ${shown(actual.runtime.network_calls)} · Model/API cost: ${shown(actual.runtime.model_api_cost)}`,'runtime unknown counts and cost remain distinct from observed zero');
    if(actual.runtime.elapsed_ms!==null)assert((await page.locator('.crosscut').last().innerText()).includes(String(actual.runtime.elapsed_ms)));
    if(actual.currentness.status==='stale')assert(await page.locator('.measure-meta.stale').count()>0);
    await page.getByLabel('Case state',{exact:true}).selectOption('failed');
    assert.equal(await page.locator('#cases details').count(),actual.checks.reduce((n,c)=>n+c.cases.filter(item=>item.status==='failed').length,0));
    await page.getByLabel('Case state',{exact:true}).selectOption('all');
    await page.getByLabel('Find case or evidence',{exact:true}).fill('no-case-with-this-unique-string');assert.equal(await page.locator('#cases details').count(),0);
    await page.getByLabel('Find case or evidence',{exact:true}).fill('');
    await page.getByLabel('Dimension',{exact:true}).selectOption('metric');assert.equal(await page.locator('#cases details').count(),actual.checks.filter(check=>check.layer==='metric').reduce((n,c)=>n+c.cases.length,0));await page.getByLabel('Dimension',{exact:true}).selectOption('all');
    if(actual.checks.some(check=>check.cases.length)){await page.locator('#cases summary').first().focus();await page.keyboard.press('Enter');assert(await page.locator('#cases details').first().getAttribute('open')!==null);assert(await page.locator('#cases pre').first().isVisible());}
    await page.locator('#refresh').focus();assert(await page.locator('#refresh').evaluate(node=>getComputedStyle(node).outlineStyle!=='none'));
    await page.getByRole('button',{name:'Recheck report'}).click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
    const desktop=entry.label+'-desktop.png';await page.screenshot({path:path.join(output,desktop),fullPage:true});
    await page.screenshot({path:path.join(output,entry.label+'-desktop-viewport.png')});
    await page.setViewportSize({width:360,height:800});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'360px page must not overflow');
    const mobile=entry.label+'-mobile.png';await page.screenshot({path:path.join(output,mobile),fullPage:true});
    await page.screenshot({path:path.join(output,entry.label+'-mobile-viewport.png')});
    assert.equal(await page.getByLabel('Case state',{exact:true}).isVisible(),true);assert.equal(errors.length,0,errors.join('\n'));
    receipts.push({label:entry.label,source:'actual_report_readback',scenario_method:entry.evidence||'actual absent report readback',acceptance:actual.acceptance,currentness:actual.currentness.status,checks:actual.checks.length,cases:actual.checks.reduce((n,c)=>n+c.cases.length,0),observed_counts:{coverage:actual.coverage,paired_executions:actual.model_comparison.paired_executions,held_out_cases:actual.model_comparison.held_out_cases,model_calls:actual.runtime.model_calls,network_calls:actual.runtime.network_calls,model_api_cost:actual.runtime.model_api_cost},screenshots:[desktop,mobile,entry.label+'-desktop-viewport.png',entry.label+'-mobile-viewport.png'],desktop:{width:1440,height:1000},mobile:{width:360,height:800},page_errors:errors,checks_passed:['real_api','rendered_acceptance','four_layers','four_crosscuts','coverage','case_counts','actual_scores','per_check_state_and_ratio_units','null_vs_zero_coverage_model_runtime','runtime','model_not_evaluated','failure_filter','dimension_filter','search','keyboard_details','visible_focus','no_aggregate_score','mobile_no_page_overflow','recheck']});
    if(entry===manifest[0]){
      const hostile=structuredClone(actual);hostile.checks[0].cases[0].evidence=['<img src=x onerror="window.__qualityInjected=1">','<script>window.__qualityInjected=1</script>'];
      await page.route('**/api/evaluation',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(hostile)}));
      await page.getByRole('button',{name:'Recheck report'}).click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);await page.locator('#cases summary').first().click();
      assert(await page.locator('.evidence-list').first().innerText().then(text=>text.includes('<img')));assert.equal(await page.locator('#cases img,#cases script').count(),0);assert.equal(await page.evaluate(()=>window.__qualityInjected),undefined);
      await page.route('**/api/evaluation',route=>route.fulfill({status:503,body:'unavailable'}));await page.getByRole('button',{name:'Recheck report'}).click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.equal(await page.locator('#gate-banner').getAttribute('data-acceptance'),'not_evaluated');assert.equal(await page.locator('#cases details').count(),0);
      receipts.push({label:'intercepted-hostile-and-unavailable',source:'browser_interception_only',evaluator_evidence:false,checks_passed:['hostile_evidence_inert_text','failed_readback_clears_previous_acceptance']});
    }
   }finally{await context.close();live.child.kill();}
  }
 }finally{await browser.close();fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify({created_at:new Date().toISOString(),receipt_version:1,results:receipts},null,2)+'\n');}
 console.log(JSON.stringify({ok:true,receipt:path.join(output,'receipt.json'),actual_reports:manifest.length}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
