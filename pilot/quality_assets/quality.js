'use strict';
(() => {
  const names = {data:'Data',metric:'Metric',ontology:'Ontology',interpretation:'Interpretation',retrieval:'Retrieval',formats:'Format equivalence',governance:'Governance',runtime:'Runtime'};
  const descriptions = {data:'Source, provenance & freshness',metric:'Formula, unit, grain & filters',ontology:'Identities & relationships',interpretation:'Caveats & evidence · abstention not evaluated'};
  const states = {measured:'Measured',passed:'Passed',failed:'Failed',missing:'Not evaluated',not_evaluated:'Not evaluated',partial:'Partially covered',stale:'Stale',current:'Current'};
  let report = null;
  const $ = id => document.getElementById(id);
  const label = value => states[value] || 'Not evaluated';
  const scoreUnit = check => check.id==='retrieval_precision'?'hits / returned':check.id==='retrieval_recall'?'hits / relevant':'passed / measured';
  function el(tag, text, className) { const node=document.createElement(tag); if(text!==undefined)node.textContent=String(text); if(className)node.className=className; return node; }
  function value(v) { return v===null||v===undefined?'Not evaluated':typeof v==='object'?JSON.stringify(v,null,2):String(v); }
  function badge(state) { return el('span',label(state),'pill '+(state||'missing')); }
  function reset(id) { const node=$(id);node.replaceChildren();return node; }
  function measured(check) {
    const box=el('div',undefined,'measurement');box.append(el('p',check.name,'check-name'));
    const score=check.score||{}, valid=typeof score.value==='number'&&Number.isFinite(score.value)&&score.denominator>0;
    box.append(el('div',valid?`${(score.value*100).toFixed(1).replace(/\.0$/,'')}%`:'Not evaluated','value'+(valid?'':' missing')));
    box.append(el('p',valid?`${value(score.numerator)} / ${value(score.denominator)} ${scoreUnit(check)}`:'No measured denominator','measure-meta'));
    box.append(badge(check.status));
    if(report.currentness?.status==='stale')box.append(el('p','Historical measurement · stale binding','measure-meta stale'));
    return box;
  }
  function renderDimensions() {
    const checks=report.checks||[], layers=reset('layers'), cross=reset('crosscuts');
    for(const layer of Object.keys(names)) {
      const card=el('article',undefined,descriptions[layer]?'layer':'crosscut');
      if(descriptions[layer])card.append(el('p',layer.toUpperCase(),'layer-id'));
      card.append(el('h3',names[layer]));
      if(descriptions[layer])card.append(el('p',descriptions[layer]));
      const group=checks.filter(check=>check.layer===layer);
      if(layer==='runtime') {
        const runtime=report.runtime||{},timing=el('div',undefined,'measurement');
        timing.append(el('p','Fixture wall time','check-name'),el('div',runtime.elapsed_ms===null||runtime.elapsed_ms===undefined?'Not evaluated':`${value(runtime.elapsed_ms)} ms`,'value'+(runtime.elapsed_ms===null||runtime.elapsed_ms===undefined?' missing':'')));
        timing.append(el('p','One recorded fixture run; no service latency distribution.','measure-meta'));
        timing.append(el('p',`Python ${value(runtime.python)} · SQLite ${value(runtime.sqlite)}`,'measure-meta'));
        timing.append(el('p',`Model/API cost: ${value(runtime.model_api_cost)}`,'measure-meta'));card.append(timing);
        if(report.currentness?.status==='stale')card.append(el('p','Historical timing · stale binding','measure-meta stale'));
      }
      else if(group.length)group.forEach(check=>card.append(measured(check)));
      else card.append(el('p','Not evaluated · no reported checks','empty'));
      (descriptions[layer]?layers:cross).append(card);
    }
  }
  function renderCoverage() {
    const body=reset('coverage'), coverage=report.coverage||{};
    $('coverage-summary').textContent=`${value(coverage.executed)} executed / ${value(coverage.planned)} planned cases`;
    for(const check of report.checks||[]) {
      const row=el('tr'),name=el('td',check.name);name.append(el('small',names[check.layer]||check.layer));row.append(name);
      const state=el('td');state.append(badge(check.status));row.append(state);
      row.append(el('td',`${value(check.coverage?.executed)} / ${value(check.coverage?.planned)}`));
      const ratio=el('td',check.score?.denominator>0?`${value(check.score.numerator)} / ${value(check.score.denominator)}`:'Not evaluated');if(check.score?.denominator>0)ratio.append(el('small',scoreUnit(check)));row.append(ratio);body.append(row);
    }
    if(!(report.checks||[]).length) {const row=el('tr'),cell=el('td','No measurements reported.');cell.colSpan=4;row.append(cell);body.append(row);}
  }
  function renderCases() {
    const container=reset('cases'), status=$('status-filter').value, layer=$('layer-filter').value, query=$('case-search').value.trim().toLowerCase();
    let total=0,shown=0;
    for(const check of report?.checks||[])for(const item of check.cases||[]) {
      total++;
      if(status!=='all'&&item.status!==status||layer!=='all'&&check.layer!==layer||query&&!JSON.stringify([item,check.name]).toLowerCase().includes(query))continue;
      shown++;
      const detail=el('details'),summary=el('summary');summary.append(badge(item.status),el('span',item.id,'case-title'),el('span',`${names[check.layer]||check.layer} / ${check.name}`,'case-dimension'));detail.append(summary);
      const body=el('div',undefined,'case-body'), pair=el('div',undefined,'case-values');
      for(const key of ['expected','observed']) {const column=el('div');column.append(el('h4',key),el('pre',value(item[key])));pair.append(column);}body.append(pair,el('h4','Evidence'));
      const evidence=el('ul',undefined,'evidence-list');for(const text of item.evidence||[])evidence.append(el('li',text));if(!evidence.children.length)evidence.append(el('li','No evidence recorded.'));body.append(evidence);
      body.append(el('p',`Elapsed: ${value(item.elapsed_ms)}${item.elapsed_ms===null||item.elapsed_ms===undefined?'':' ms'}`,'small'));
      if((check.limits||[]).length){body.append(el('h4','Check limits'));for(const limit of check.limits)body.append(el('p',limit,'small'));}
      detail.append(body);container.append(detail);
    }
    $('case-count').textContent=`${shown} of ${total} cases shown`;
    if(!shown)container.append(el('p',total?'No cases match these filters.':'No executed cases are available in this report.','empty'));
  }
  function bindRow(target,labelText,content) {const row=el('div');row.append(el('dt',labelText),el('dd',value(content)));target.append(row);}
  function renderReport(data) {
    report=data;
    const fresh=data.currentness||{}, gates=data.gates||[];
    $('gate-heading').textContent={passed:'Gates passed',blocked:'Acceptance blocked',not_evaluated:'Acceptance not evaluated',partial:'Acceptance partially covered',stale:'Acceptance stale'}[data.acceptance]||'Acceptance not evaluated';
    $('gate-banner').dataset.acceptance=data.acceptance||'not_evaluated';
    $('gate-description').textContent=data.acceptance==='passed'?'Reported security and critical semantic gates passed. Scope and coverage still apply.':'A successful measurement cannot compensate for a failed, missing or stale gate.';
    $('freshness').textContent=`${label(fresh.status)} evidence`;
    const gateList=reset('gate-list');
    for(const gate of gates) {const item=el('article',undefined,'gate-item');item.append(badge(gate.status));const copy=el('div');copy.append(el('h3',gate.name));for(const reason of gate.reasons||[])copy.append(el('p',reason));item.append(copy);gateList.append(item);}
    if(!gates.length)gateList.append(el('p','Gates not evaluated.','empty'));
    for(const reason of fresh.reasons||[])gateList.append(el('p',reason,'small stale'));
    renderDimensions();renderCoverage();
    const filter=$('layer-filter'),selected=filter.value;filter.replaceChildren(new Option('All dimensions','all'));for(const key of Object.keys(names))filter.add(new Option(names[key],key));filter.value=selected||'all';renderCases();
    const bindings=reset('bindings');
    for(const [key,v] of [['Run',data.run_id],['Evaluated at',data.evaluated_at],['Server readback',data.server_time],['Currentness checked',fresh.checked_at],['Evidence expires',fresh.expires_at],['Benchmark',data.benchmark?.id],['Benchmark revision',data.benchmark?.revision],['Benchmark SHA-256',data.benchmark?.sha256],['Dataset',data.dataset?.id],['Dataset revision',data.dataset?.revision],['Dataset SHA-256',data.dataset?.sha256],['Dataset records',data.dataset?.record_count],['Synthetic data',data.dataset?.synthetic===true?'Yes':data.dataset?.synthetic===false?'No':null],['Evaluator',data.evaluator?.id],['Evaluator version',data.evaluator?.version],['Evaluator SHA-256',data.evaluator?.sha256],['Catalog revision',data.snapshot?.catalog_revision],['Context SHA-256',data.snapshot?.context_sha256],['Source SHA-256',data.snapshot?.source_sha256],['Fixture review',data.approval?.status]])bindRow(bindings,key,v);
    const model=data.model_comparison||{},modelBox=reset('model');modelBox.append(el('p',label(model.status),'model-status'),el('p',model.reason||'No matched paired model executions were reported.','model-copy'));
    const counts=el('div',undefined,'model-counts');for(const [title,count]of[['Paired executions',model.paired_executions],['Held-out cases',model.held_out_cases]]) {const item=el('div');item.append(el('strong',value(count)),el('span',title));counts.append(item);}modelBox.append(counts);
    const runtime=data.runtime||{};modelBox.append(el('p',`Model calls: ${value(runtime.model_calls)} · Network calls: ${value(runtime.network_calls)} · Model/API cost: ${value(runtime.model_api_cost)}`,'model-copy'));
    modelBox.append(el('p',model.status==='not_evaluated'||!model.paired_executions?'Matched model / prompt / tools / budget: Not evaluated · no paired executions':`Matched model / prompt / tools / budget: ${['model','prompt','tools','budget'].map(key=>model.matched?.[key]===true?'yes':'no').join(' / ')}`,'small'));
    const limits=reset('limits');for(const limit of data.limits||[])limits.append(el('li',limit));if(!(data.limits||[]).length)limits.append(el('li','No additional scope limits were recorded.'));
    $('readback').textContent=`${label(data.status)} report · Read back ${data.server_time||'at server time unavailable'}`;
  }
  function unavailable(message) {
    // Remove the prior pass state after any failed recheck.
    renderReport({status:'not_evaluated',acceptance:'not_evaluated',currentness:{status:'not_evaluated'},checks:[],gates:[],coverage:{planned:null,executed:null},limits:[message]});
    $('readback').textContent=message;
  }
  async function refresh() {
    if($('refresh').disabled)return;
    $('refresh').disabled=true;$('readback').textContent='Rechecking the selected report and its current bindings…';
    try {const response=await fetch('/api/evaluation',{cache:'no-store',credentials:'omit'});if(!response.ok)throw new Error('Report readback is unavailable. Recheck the report with the local evaluator.');const data=await response.json();if(data.schema!=='prefrontal.context.evaluation.v1')throw new Error('The report contract is unavailable.');renderReport(data);}
    catch(error){unavailable(error.message||'Report readback is unavailable.');}
    finally{$('refresh').disabled=false;}
  }
  $('refresh').addEventListener('click',refresh);
  for(const id of ['status-filter','layer-filter'])$(id).addEventListener('change',renderCases);
  $('case-search').addEventListener('input',renderCases);
  window.addEventListener('focus',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  setInterval(()=>{if(!document.hidden)refresh();},30000);
  refresh();
})();
