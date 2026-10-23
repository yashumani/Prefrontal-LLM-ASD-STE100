/* Reproducible bounded metadata benchmark. No source facts or model calls. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {createWorkspace,addRecords,validateWorkspace,search,exportWorkspace,hash,canonical,LIMITS} from '../workspace/core.mjs';

const outputIndex=process.argv.indexOf('--output');
const output=path.resolve(outputIndex>=0?process.argv[outputIndex+1]:'.validation/workspace/benchmark.json');
const maxSeconds=30;
const start=performance.now();
const memoryBefore=process.memoryUsage();
const source='Synthetic context metadata benchmark. These terms are generated test fixtures, not business facts.\n';
const sourceHash=await hash(source);
const results=[];
for(const count of [100,1000]) {
  let state=createWorkspace(`Synthetic ${count}-record metadata benchmark`,'user');
  const records=Array.from({length:count},(_,i)=>({
    schema:'prefrontal.context.v1',id:`TERM_BENCH_${String(i).padStart(5,'0')}`,version:1,
    kind:'term',layer:'ontology',name:`Fixture term ${i}`,aliases:[],
    description:`Synthetic metadata in group${i%10}.`,
    narrative:'Generated only to measure bounded metadata handling. No real source rows are included.',
    owner:'Synthetic benchmark',classification:'internal',valid_from:'2026-01-01T00:00:00Z',valid_until:null,
    provenance:[{path:'benchmark/source.txt',sha256:sourceHash}],dependencies:[],
    spec:{definition:`Fixture definition ${i}.`,related_terms:[]},
  }));
  const inserted=performance.now();
  for(let i=0;i<records.length;i+=250) {
    const batch=records.slice(i,i+250);
    state=await addRecords(state,batch,{submissionText:canonical(batch),format:'json',
      submissions:[{path:'benchmark/source.txt',text:source,sha256:sourceHash,format:'form'}]});
    if((performance.now()-start)/1000>maxSeconds)throw new Error('The 30-second benchmark limit was exceeded.');
  }
  const importMs=performance.now()-inserted;
  const validationStart=performance.now();const validity=await validateWorkspace(state);
  const validationMs=performance.now()-validationStart;
  const indexStart=performance.now();const selective=search(state,{query:'group7',kind:'term',page_size:20});
  const firstIndexedQueryMs=performance.now()-indexStart;
  assert.equal(selective.matched_count,count/10);
  const times=[];
  for(let i=0;i<50;i++){const t=performance.now();const result=search(state,{query:'group7',layer:'ontology',kind:'term',page_size:20});assert.equal(result.matched_count,count/10);times.push(performance.now()-t);}
  times.sort((a,b)=>a-b);
  const pageStart=performance.now();let cursor=null,seen=[];
  do{const result=search(state,{page_size:100,cursor});seen.push(...result.items.map(x=>x.record.id));cursor=result.next_cursor;}while(cursor);
  const paginationMs=performance.now()-pageStart;
  assert.equal(new Set(seen).size,count);assert.equal(seen.length,count);
  const exportStart=performance.now();const backup=await exportWorkspace(state);const exportMs=performance.now()-exportStart;
  const bytes=Buffer.byteLength(backup,'utf8');assert(bytes<=LIMITS.workspaceBytes);
  results.push({record_versions:count,records_are_synthetic_metadata:true,captured_originals:state.submissions.length,
    backup_utf8_bytes:bytes,workspace_canonical_utf8_bytes:validity.bytes,import_ms:+importMs.toFixed(3),
    validate_ms:+validationMs.toFixed(3),first_indexed_selective_query_ms:+firstIndexedQueryMs.toFixed(3),
    warm_selective_query_samples:50,warm_selective_query_median_ms:+times[24].toFixed(3),warm_selective_query_p95_ms:+times[47].toFixed(3),
    selective_query:'group7',selective_matches:selective.matched_count,pagination_rows:seen.length,
    full_pagination_ms:+paginationMs.toFixed(3),export_ms:+exportMs.toFixed(3)});
}
const after=process.memoryUsage();
const report={contract:'prefrontal.browser.metadata.benchmark.v1',status:'passed',measured_at:new Date().toISOString(),
  source_hashes:Object.fromEntries(['workspace/core.mjs','workspace/formats.mjs','scripts/benchmark-workspace.mjs'].map(name=>[name,cryptoHash(name)])),
  environment:{node:process.version,os:os.platform(),os_release:os.release(),architecture:os.arch(),cpu:os.cpus()[0]?.model},
  limits:{seconds:maxSeconds,...LIMITS},elapsed_ms:+(performance.now()-start).toFixed(3),
  memory:{measurement:'Node process samples; not a browser peak-memory measurement',rss_before:memoryBefore.rss,rss_after:after.rss,heap_used_before:memoryBefore.heapUsed,heap_used_after:after.heapUsed},
  results,source_data_rows:0,model_calls:0,external_requests:0,
  interpretation:'Measures metadata import, validation, indexed authoring search, pagination and backup. Does not measure native source data, browser quota capacity, concurrent users or enterprise throughput.'};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));

function cryptoHash(name) {
  return createHash('sha256').update(fs.readFileSync(new URL('../'+name,import.meta.url))).digest('hex');
}
