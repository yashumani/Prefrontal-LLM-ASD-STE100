/* Reproduce browser -> Python proposals and deterministic document parity.
 * All records are synthetic. This script uses no network, model or private data.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemo} from '../workspace/demo.mjs';
import {addRecords,compose,createWorkspace,exportRecord,exportWorkspace,hash,importRecord,prepareRecord} from '../workspace/core.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const parent=path.join(root,'.validation','workspace');
fs.mkdirSync(parent,{recursive:true});
const output=fs.mkdtempSync(path.join(parent,'bridge-'));
const python=process.env.PREFRONTAL_PYTHON||(process.platform==='win32'?'python':'python3');
const runPython=(args,input)=>JSON.parse(execFileSync(python,['-B',...args],{
  cwd:root,input,encoding:'utf8',maxBuffer:16*1024*1024,
  env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1'},
}));
const state=await createDemo();
assert.equal(state.records.length,13);
assert.equal(new Set(state.records.map(record=>record.kind)).size,9);
assert.equal(new Set(state.records.map(record=>record.layer)).size,4);
const backup=path.join(output,'backup.json');
fs.writeFileSync(backup,await exportWorkspace(state),'utf8');
const payload=await compose(state,{measure:'M_GROSS_ADDS',selectors:['CHANNEL_ONLINE','PRODUCT_POSTPAID','PERIOD_2026_09']});
assert.equal(payload.execution_authorized,false);
const consumer=path.join(output,'consumer.json');
fs.writeFileSync(consumer,JSON.stringify(payload),'utf8');
const inspected=runPython(['-m','pilot.browser_workspace','--input',backup,'--validate-only']);
assert.equal(inspected.ok,true);assert.equal(inspected.result.record_count,13);
assert.equal(inspected.result.provenance_files_complete,true);
assert.equal(inspected.result.semantically_approved,false);
const inspectedConsumer=runPython(['-m','pilot.browser_workspace','--input',consumer,'--validate-only']);
assert.equal(inspectedConsumer.ok,true);assert.equal(inspectedConsumer.result.execution_authorized,false);
assert.equal(inspectedConsumer.result.provenance_files_complete,false);
const staged=runPython(['-m','pilot.browser_workspace','--input',backup,'--output-root',path.join(output,'stages'),'--workspace','bridge-synthetic']);
assert.equal(staged.ok,true);assert.equal(staged.result.record_count,13);
assert.equal(staged.result.review_attestations_imported,false);
for(const submission of state.submissions){
  const bytes=fs.readFileSync(path.join(staged.result.source_root,...submission.path.split('/')));
  assert.deepEqual(bytes,Buffer.from(submission.text,'utf8'));
}

// A second workspace tests Unicode, microseconds, offsets and exact CRLF input.
let unicode=createWorkspace('Unicode and CRLF fixture');
const prepared=await prepareRecord(unicode,'term',{
  id:'TERM_UTF8',name:'Café 東京 😀',description:'Synthetic Unicode and newline fixture.',
  narrative:'Keep the original first line.\r\nKeep café, 東京 and 😀.\r\n',
  owner:'Synthetic fixture owner',aliases:[],classification:'internal',
  valid_from:'2026-01-01T00:00:00.123456+05:30',valid_until:'2030-01-01T00:00:00Z',
  spec:{definition:'A synthetic term with café and 東京.',related_terms:[]},
});
const originalImport=JSON.stringify(prepared.record,null,2).replace(/\n/g,'\r\n')+'\r\n';
unicode=await addRecords(unicode,[prepared.record],{
  submissions:[prepared.submission],submissionText:originalImport,format:'json',
});
const unicodeBackup=path.join(output,'unicode-backup.json');
fs.writeFileSync(unicodeBackup,await exportWorkspace(unicode),'utf8');
const stagedUnicode=runPython(['-m','pilot.browser_workspace','--input',unicodeBackup,'--output-root',path.join(output,'unicode-stages'),'--workspace','bridge-unicode']);
assert.equal(stagedUnicode.ok,true);
for(const submission of unicode.submissions){
  assert.deepEqual(fs.readFileSync(path.join(stagedUnicode.result.source_root,...submission.path.split('/'))),Buffer.from(submission.text,'utf8'));
}
assert(unicode.submissions.some(submission=>submission.text.includes('\r\n')&&submission.text.includes('東京')));

const cases=[];
for(const record of [...state.records,...unicode.records])for(const format of ['json','yaml','markdown']){
  cases.push({record,format,document:exportRecord(record,format),sha256:await hash(record)});
}
const pythonParity=String.raw`
import json,sys
from pilot.composable_formats import parse_document,export_document
from pilot.context_pilot import canonical,digest
cases=json.loads(sys.stdin.buffer.read().decode('utf-8'))
result=[]
for case in cases:
    parsed=parse_document(case['document'],case['format'])
    assert canonical(parsed)==canonical(case['record']), (case['record']['id'],case['format'],
        {key:(parsed[key],case['record'][key]) for key in parsed if parsed[key]!=case['record'][key]})
    assert digest(parsed)==case['sha256'], (case['record']['id'],'hash')
    result.append({'id':parsed['id'],'format':case['format'],'document':export_document(parsed,case['format'])})
print(json.dumps(result,ensure_ascii=True))
`;
const pythonDocuments=runPython(['-c',pythonParity],JSON.stringify(cases));
for(let index=0;index<cases.length;index++){
  const source=cases[index],converted=pythonDocuments[index];
  assert.equal(converted.document,source.document,`${converted.id}: deterministic ${converted.format} export`);
  const imported=importRecord(converted.document,converted.format);
  assert.deepEqual(imported,source.record);
  assert.equal(await hash(imported),source.sha256);
}

// Exercise the existing Python import interface with a trusted local fixture
// principal. This creates drafts only; no reviewer, release or native calls.
const pythonImport=String.raw`
import json,sys
from pathlib import Path
from pilot.composable_cli import CLI
from pilot.context_pilot import canonical
stage=Path(sys.argv[1]);root=Path(sys.argv[2])
principals=root/'principals.json'
principals.write_text(canonical({'author':{'workspace':'bridge-synthetic','roles':['submitter'],'classifications':['internal'],'source_bindings':[]}}),encoding='utf-8')
port=CLI(root/'proposal-registry.sqlite3',stage/'sources',principals,'author')
try:
    requests=(stage/'import.requests.jsonl').read_text(encoding='utf-8').splitlines()
    for line in requests:
        response=port.execute_line(line)
        assert response['ok'],response
        assert response['result']['state']=='proposal'
    rows=port.registry.db.execute('SELECT state,reviewer FROM c_records').fetchall()
    assert len(rows)==13 and all(row['state']=='draft' and row['reviewer'] is None for row in rows)
    assert port.registry.db.execute('SELECT count(*) FROM c_heads').fetchone()[0]==0
    print(json.dumps({'records':len(rows),'state':'draft','published_heads':0,'reviewers':0}))
finally:
    port.close()
`;
const imported=runPython(['-c',pythonImport,staged.result.output_path,output]);
const receipt={contract:'prefrontal.browser.bridge-verification.v1',status:'passed',
  synthetic:true,records:state.records.length,kinds:9,layers:4,
  format_roundtrips:cases.length,formats:['json','yaml','markdown'],
  unicode_crlf_original_bytes_preserved:true,canonical_hashes_match:true,
  proposal_registry:imported,authority_imported:false,execution_authorized:false,
  model_calls:0,network_calls:0,output,backup,consumer,stage:staged.result.output_path,
};
fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n','utf8');
console.log(JSON.stringify(receipt));
