/* Browser-local authoring and delivery. No network, execution or approval service. */
import {FormatError, strictJSON, canonical, parseDocument, formatDocument, byteLength} from './formats.mjs';
export {canonical, byteLength};

export const LIMITS = Object.freeze({records:1000, workspaceBytes:2097152, recordBytes:65536,
  directDependencies:32, closureRecords:128, closureBytes:1048576, depth:16,
  pageSize:100, queryChars:256, queryTerms:16, trace:4096});
export const KIND_LAYERS = Object.freeze({source:'data',measure:'metric',dimension:'ontology',member:'ontology',
  guidance:'interpretation',term:'ontology',event:'ontology',policy:'interpretation',document:'data'});
const field = (key,label,type,extra={}) => ({key,label,type,...extra});
export const TYPE_FIELDS = Object.freeze({
  source:[field('binding','Binding name','text',{help:'A descriptor only. No source is connected.'}),field('grain','One row per','list'),field('freshness_seconds','Freshness limit in seconds','number'),field('checked_at','Source check time','text'),field('dimensions','Dimension ID to source column','mapping')],
  measure:[field('source','Source ID','text'),field('aggregation','Aggregation','choice',{options:['count','sum','average']}),field('expression','Expression reference','text'),field('required_dimensions','Required dimension IDs','list'),field('optional_dimensions','Optional dimension IDs','list'),field('guidance','Guidance IDs','list')],
  dimension:[field('value_type','Value type','choice',{options:['text','period','integer']})],
  member:[field('dimension','Dimension ID','text'),field('value','Member value','value'),field('parents','Parent member IDs','list')],
  guidance:[field('qualifiers','Qualifiers','list'),field('caveats','Caveats','list')],
  term:[field('definition','Definition','text'),field('related_terms','Related term IDs','list')],
  event:[field('trigger','Event trigger','text'),field('time_field','Time field','text'),field('entities','Term or dimension IDs','list')],
  policy:[field('rule','Policy rule','text'),field('applies_to','Context IDs this policy covers','list')],
  document:[field('media_type','Document type','choice',{options:['text/plain','text/markdown','application/json','application/yaml']}),field('summary','Document summary','text'),field('related','Related context IDs','list')]
});
const RECORD_FIELDS = ['schema','id','version','layer','kind','name','aliases','description','narrative','owner','classification','valid_from','valid_until','provenance','dependencies','spec'];
const STATE_FIELDS = ['schema','id','name','mode','revision','records','submissions','reviews','trace','created_at','updated_at'];
// A negative any-character lookahead gives Python \Z semantics. JavaScript's
// dollar anchor alone also matches before a final newline.
const ID = /^[A-Z][A-Z0-9_]{1,95}(?![\s\S])/;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,63}(?![\s\S])/;
const HASH = /^[a-f0-9]{64}(?![\s\S])/;
const BINDING = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}(?![\s\S])/;
const WS_ID = /^[a-zA-Z0-9_-]{1,100}(?![\s\S])/;
const MODES = ['user','demo'];
const FORMATS = ['form','json','yaml','markdown'];
const copy = value => JSON.parse(canonical(value));
export class WorkspaceError extends Error {
  constructor(code,message,details={}) { super(message); this.name='WorkspaceError'; this.code=code; this.details=details; }
}
function fail(code,message,details={}) {throw new WorkspaceError(code,message,details);}
function check(condition,message,details={}) {if(!condition) fail('invalid_record',message,details);}
function exact(value,fields,message='Use only the documented fields.') {
  check(value !== null && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join('|')===fields.slice().sort().join('|'),message);
}
function text(value,label,max=65536) {check(typeof value==='string' && value.trim().length>0 && [...value].length<=max,`Enter ${label}.`); return value;}
function identifier(value,label='a valid ID') {check(typeof value==='string'&&ID.test(value),`Enter ${label}. Use uppercase letters, digits and underscores.`);return value;}
function integer(value,label,min=1) {check(Number.isSafeInteger(value)&&value>=min,`Enter ${label} as a whole number from ${min} to ${Number.MAX_SAFE_INTEGER}.`);return value;}
function list(value,label,{ids=false,nonempty=false,aliases=false}={}) {
  check(Array.isArray(value)&&(!nonempty||value.length>0),`Enter ${label} as a list${nonempty?' with at least one value':''}.`);
  for(const item of value) {ids?identifier(item,label):text(item,label); if(aliases) check(/^[\x20-\x7e]+(?![\s\S])/.test(item),'Use ASCII characters for aliases in this browser profile. Names and narrative can use Unicode.');}
  if(ids||aliases) check(new Set(value.map(x=>aliases?x.toLowerCase():x)).size===value.length,`Remove duplicate values from ${label}.`);
  return value;
}
export function normalizeTime(value) {
  check(typeof value==='string','Enter a time with a timezone.');
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  check(m&&m[0]===value,'Enter an ISO time with seconds and a timezone.');
  const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number);
  check(year>=1&&year<=9999&&month>=1&&month<=12&&day>=1&&hour<24&&minute<60&&second<60,'Enter a valid calendar time.');
  const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,0);
  check(date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day,'Enter a valid calendar date.');
  const zoneHour=Number(m[10]||0),zoneMinute=Number(m[11]||0);
  check(zoneHour<24&&zoneMinute<60,'Enter a valid timezone offset.');
  const offset=(zoneHour*60+zoneMinute)*(m[9]==='-'?-1:1);
  date.setTime(date.getTime()-offset*60000);
  check(date.getUTCFullYear()>=1&&date.getUTCFullYear()<=9999,'The UTC date is outside the supported range.');
  const fraction=(m[7]||'').padEnd(6,'0');
  return date.toISOString().slice(0,19)+(Number(fraction)?'.'+fraction:'')+'Z';
}
function instant(value) {const s=normalizeTime(value),m=/\.(\d{6})Z$/.exec(s);return BigInt(Date.parse(s))*1000n+BigInt(m?Number(m[1].slice(3)):0);}
function nowTime() {return normalizeTime(new Date().toISOString());}
export async function hash(value) {
  const source=typeof value==='string'?value:canonical(value);byteLength(source);
  const bytes=new TextEncoder().encode(source);
  if(!globalThis.crypto?.subtle) fail('crypto_unavailable','Use an HTTPS page or a localhost server to calculate hashes.');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
function path(value) {
  check(typeof value==='string'&&value.length>0&&value.length<=512&&!value.startsWith('/')&&!/[\\:\x00-\x1f\x7f]/.test(value),'Use a relative source path.');
  check(value.split('/').every(x=>x&&x!=='.'&&x!=='..'&&x.trim()===x&&x.length<=128),'Use a relative source path without empty or parent segments.');return value;
}
function specRefs(kind,spec) {
  const refs=[];
  exact(spec,TYPE_FIELDS[kind].map(x=>x.key),'Use the documented fields for this context type.');
  if(kind==='source') {
    check(typeof spec.binding==='string'&&BINDING.test(spec.binding),'Enter a binding name. This does not create a connection.');
    list(spec.grain,'grain',{nonempty:true});check(new Set(spec.grain).size===spec.grain.length&&spec.grain.every(x=>COLUMN.test(x)),'Use distinct source column names for grain.');
    integer(spec.freshness_seconds,'freshness seconds');spec.checked_at=normalizeTime(spec.checked_at);
    check(spec.dimensions&&typeof spec.dimensions==='object'&&!Array.isArray(spec.dimensions),'Enter a dimension-to-column mapping.');
    for(const [dim,col] of Object.entries(spec.dimensions)){identifier(dim);check(typeof col==='string'&&COLUMN.test(col),'Use valid source column names in the mapping.');}
  } else if(kind==='measure') {
    refs.push(identifier(spec.source,'a source ID'));check(['count','sum','average'].includes(spec.aggregation),'Select a supported aggregation label.');text(spec.expression,'an expression reference');
    for(const key of ['required_dimensions','optional_dimensions','guidance']){list(spec[key],key,{ids:true});refs.push(...spec[key]);}
    check(new Set(refs).size===refs.length,'Do not repeat a dependency in a measure.');
  } else if(kind==='dimension') check(['text','period','integer'].includes(spec.value_type),'Select a supported dimension value type.');
  else if(kind==='member') {
    refs.push(identifier(spec.dimension,'a dimension ID'));list(spec.parents,'parent member IDs',{ids:true});refs.push(...spec.parents);
    check(new Set(refs).size===refs.length,'Do not repeat the member dimension as a parent.');
    if(typeof spec.value==='string')text(spec.value,'a member value');else check(Number.isSafeInteger(spec.value),'Use text or a safe whole number for the member value.');
  } else if(kind==='guidance') {list(spec.qualifiers,'qualifiers',{nonempty:true});list(spec.caveats,'caveats',{nonempty:true});}
  else if(kind==='term') {text(spec.definition,'a definition');list(spec.related_terms,'related term IDs',{ids:true});refs.push(...spec.related_terms);}
  else if(kind==='event') {text(spec.trigger,'an event trigger');check(typeof spec.time_field==='string'&&COLUMN.test(spec.time_field),'Enter a source time field name.');list(spec.entities,'entity IDs',{ids:true});refs.push(...spec.entities);}
  else if(kind==='policy') {text(spec.rule,'a policy rule');list(spec.applies_to,'covered context IDs',{ids:true,nonempty:true});refs.push(...spec.applies_to);}
  else if(kind==='document') {check(['text/plain','text/markdown','application/json','application/yaml'].includes(spec.media_type),'Select a supported document media type.');text(spec.summary,'a document summary');list(spec.related,'related context IDs',{ids:true});refs.push(...spec.related);}
  return refs;
}
export function referencesFromSpec(kind,spec) {
  check(Object.hasOwn(KIND_LAYERS,kind),'Select a supported context type.');
  return specRefs(kind,copy(spec));
}
export function validateRecord(raw) {
  let record;
  try {record=copy(raw);}catch(error){if(error instanceof WorkspaceError)throw error;fail('invalid_record','Use a bounded JSON record with safe whole numbers.');}
  exact(record,RECORD_FIELDS);
  check(record.schema==='prefrontal.context.v1','Use record schema prefrontal.context.v1.');identifier(record.id);integer(record.version,'a version');
  check(Object.hasOwn(KIND_LAYERS,record.kind)&&record.layer===KIND_LAYERS[record.kind],'Select a context type in its required layer.');
  for(const key of ['name','description','narrative'])text(record[key],key);
  text(record.owner,'an owner',128);list(record.aliases,'aliases',{aliases:true});
  check(['internal','restricted'].includes(record.classification),'Select internal or restricted classification. Browser storage does not enforce access control.');
  record.valid_from=normalizeTime(record.valid_from);
  if(record.valid_until!==null){record.valid_until=normalizeTime(record.valid_until);check(instant(record.valid_until)>instant(record.valid_from),'The end time must follow the start time.');}
  check(Array.isArray(record.provenance)&&record.provenance.length>0,'Add source provenance.');const paths=new Set();
  for(const item of record.provenance){exact(item,['path','sha256']);path(item.path);check(!paths.has(item.path)&&HASH.test(item.sha256),'Use distinct paths and SHA-256 hashes for provenance.');paths.add(item.path);}
  check(Array.isArray(record.dependencies)&&record.dependencies.length<=LIMITS.directDependencies,'Keep direct dependencies within the supported limit.');const depIds=new Set();
  for(const dep of record.dependencies){exact(dep,['id','version']);identifier(dep.id);integer(dep.version,'a dependency version');check(dep.id!==record.id&&!depIds.has(dep.id),'Remove self references and duplicate dependencies.');depIds.add(dep.id);}
  const refs=specRefs(record.kind,record.spec);
  if(record.kind!=='guidance')check(depIds.size===refs.length&&refs.every(x=>depIds.has(x)),'Pin each typed relationship to exactly one dependency version.');
  if(record.kind==='member')check(record.id.startsWith(record.spec.dimension+'_')&&record.id.length>record.spec.dimension.length+1,'A member ID must start with its dimension ID and an underscore.');
  check(byteLength(canonical(record))<=LIMITS.recordBytes,'The record exceeds 64 KiB. Split the context into smaller records.');return record;
}
export function defaultSpec(kind) {
  check(Object.hasOwn(KIND_LAYERS,kind),'Select a supported context type.');
  return copy({source:{binding:'',grain:[],freshness_seconds:86400,checked_at:nowTime(),dimensions:{}},measure:{source:'',aggregation:'count',expression:'',required_dimensions:[],optional_dimensions:[],guidance:[]},dimension:{value_type:'text'},member:{dimension:'',value:'',parents:[]},guidance:{qualifiers:[],caveats:[]},term:{definition:'',related_terms:[]},event:{trigger:'',time_field:'',entities:[]},policy:{rule:'',applies_to:[]},document:{media_type:'text/plain',summary:'',related:[]}}[kind]);
}
export function suggestId(kind,name,dimension='') {
  const token=String(name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64)||'UNTITLED';
  const prefixes={source:'SOURCE',measure:'M',dimension:'DIM',guidance:'GUIDE',term:'TERM',event:'EVENT',policy:'POLICY',document:'DOC'};
  return (kind==='member'?dimension+'_':(prefixes[kind]||'CONTEXT')+'_')+token;
}
export function nextVersion(state,id) {return Math.max(0,...state.records.filter(x=>x.id===id).map(x=>x.version))+1;}
function uid() {return globalThis.crypto?.randomUUID?crypto.randomUUID():`local_${Date.now()}_${Math.random().toString(16).slice(2)}`;}
export function createWorkspace(name='My context workspace',mode='user') {
  text(name,'a workspace name',128);check(MODES.includes(mode),'Select a supported workspace mode.');const at=nowTime();
  return {schema:'prefrontal.workspace.v1',id:uid(),name,mode,revision:0,records:[],submissions:[],reviews:[],trace:[],created_at:at,updated_at:at};
}
export function latestRecords(state) {
  const found=new Map();for(const record of state.records)if(!found.has(record.id)||found.get(record.id).version<record.version)found.set(record.id,record);
  return [...found.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
function recordMap(state) {return new Map(state.records.map(r=>[r.id+'@'+r.version,r]));}
function ensureCompatible(record,byKey) {
  const dependencies=new Map(record.dependencies.map(x=>[x.id,x.version]));
  const linked=(id,kinds)=>{const item=byKey.get(id+'@'+dependencies.get(id));check(item&&(!kinds||kinds.includes(item.kind)),`The ${record.id} relationship to ${id} has a missing or wrong type.`,{id:record.id,target:id});return item;};
  const s=record.spec;
  if(record.kind==='measure') {
    const source=linked(s.source,['source']);for(const id of [...s.required_dimensions,...s.optional_dimensions]){linked(id,['dimension']);check(Object.hasOwn(source.spec.dimensions,id),`Source ${source.id} does not support dimension ${id}.`);}
    for(const id of s.guidance)linked(id,['guidance']);
  } else if(record.kind==='member') {
    const d=linked(s.dimension,['dimension']);const t=d.spec.value_type;
    check((t==='integer'&&Number.isSafeInteger(s.value))||(['text','period'].includes(t)&&typeof s.value==='string'),'The member value does not match its dimension type.');
    if(t==='period')check(/^\d{4}-(0[1-9]|1[0-2])(?![\s\S])/.test(s.value),'Use YYYY-MM for a period member.');
    for(const id of s.parents){const p=linked(id,['member']);check(p.spec.dimension===s.dimension,'A parent member must use the same dimension.');}
  } else if(record.kind==='term')for(const id of s.related_terms)linked(id,['term']);
  else if(record.kind==='event')for(const id of s.entities)linked(id,['term','dimension']);
}
function closure(state,roots) {
  const byKey=recordMap(state),found=new Map(),versions=new Map(),visiting=new Set(),depthCache=new Map();let bytes=0;
  function visit(id,version,depth) {
    if(depth>LIMITS.depth)fail('depth_limit','The dependency path exceeds 16 steps.');
    if(versions.has(id)&&versions.get(id)!==version)fail('version_conflict',`The composition requests different versions of ${id}.`);
    const key=id+'@'+version;
    if(visiting.has(key))fail('dependency_cycle',`The dependency graph returns to ${id}.`);
    if(depthCache.has(key)){if(depth+depthCache.get(key)>LIMITS.depth)fail('depth_limit','The dependency path exceeds 16 steps.');return depthCache.get(key);}
    const r=byKey.get(key);if(!r)fail('missing_dependency',`Add ${id} version ${version} before using this relationship.`,{id,version});
    versions.set(id,version);found.set(key,r);bytes+=byteLength(canonical(r));
    if(found.size>LIMITS.closureRecords||bytes>LIMITS.closureBytes)fail('closure_limit','The dependency set is too large. Use a smaller context set.');
    visiting.add(key);let longest=0;
    for(const dep of r.dependencies)longest=Math.max(longest,1+visit(dep.id,dep.version,depth+1));
    visiting.delete(key);ensureCompatible(r,byKey);depthCache.set(key,longest);return longest;
  }
  for(const r of roots)visit(r.id,r.version,0);
  return [...found.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:a.version-b.version);
}
function validateIdentitiesAndSources(records) {
  const kinds=new Map(),sources=new Map();
  for(const record of records){
    if(kinds.has(record.id)&&kinds.get(record.id)!==record.kind)fail('identity_kind_conflict',`${record.id} already has a different context type. Keep that type or use a new ID.`);
    kinds.set(record.id,record.kind);
    for(const evidence of record.provenance){
      if(sources.has(evidence.path)&&sources.get(evidence.path)!==evidence.sha256)fail('conflicting_provenance',`Source path ${evidence.path} has different hashes. Use a new source path when its bytes change.`);
      sources.set(evidence.path,evidence.sha256);
    }
  }
}
function validateGraph(state) {validateIdentitiesAndSources(state.records);for(const record of state.records)closure(state,[record]);}
function traceState(state,action,details) {
  const next=copy(state);next.revision+=1;integer(next.revision,'a workspace revision',0);next.updated_at=nowTime();
  if(next.trace.length>=LIMITS.trace)fail('trace_limit','The local trace has reached 4,096 steps. Export a backup and move this workspace to the Python path. No saved history was removed.');
  next.trace.push({at:next.updated_at,action,details});
  return next;
}
function boundState(state) {
  if(state.records.length>LIMITS.records)fail('record_limit','The workspace has reached 1,000 record versions. Export it and move larger collections to the Python registry.');
  if(state.submissions.length>LIMITS.records)fail('source_limit','The workspace exceeds 1,000 captured original files. Export it and move larger collections to the Python registry.');
  if(byteLength(canonical(state))>LIMITS.workspaceBytes)fail('workspace_limit','The workspace exceeds 2 MiB. Export it and move larger collections to the Python registry.');
}
export async function prepareRecord(state,kind,values) {
  check(Object.hasOwn(KIND_LAYERS,kind),'Select a supported context type.');
  check(values&&typeof values==='object'&&!Array.isArray(values)&&Object.keys(values).every(key=>['id','name','owner','aliases','description','narrative','classification','valid_from','valid_until','spec','dependencies'].includes(key)),'Use only the documented guided submission fields.');
  const original=canonical(values);const digest=await hash(original);
  const identifierValue=values.id||suggestId(kind,values.name,values.spec?.dimension);
  const version=nextVersion(state,identifierValue);const spec=copy(values.spec||defaultSpec(kind));
  const refs=specRefs(kind,spec);const latest=new Map(latestRecords(state).map(x=>[x.id,x]));
    const previous=latest.get(identifierValue);
    let dependencies;
    if(Object.hasOwn(values,'dependencies'))dependencies=copy(values.dependencies);
    else if(kind==='guidance'&&previous)dependencies=copy(previous.dependencies);
    else {
      // Keep retained pins in their prior array order. A label edit does not
      // authorize upgrading or reordering an existing relationship.
      const selected=new Set(refs);
      dependencies=(previous?.dependencies||[]).filter(pin=>selected.has(pin.id)).map(copy);
      const retained=new Set(dependencies.map(pin=>pin.id));
      for(const id of refs)if(!retained.has(id)){
        const r=latest.get(id);if(!r)fail('missing_dependency',`Add ${id} before using this relationship.`);
        dependencies.push({id,version:r.version});
      }
    }
  const sourcePath=`submissions/${identifierValue.toLowerCase()}-v${version}-${digest.slice(0,12)}.json`;
    const provenance=[...new Map([...(previous?.provenance||[]),{path:sourcePath,sha256:digest}].map(item=>[item.path+'\0'+item.sha256,copy(item)])).values()];
    const record=validateRecord({schema:'prefrontal.context.v1',id:identifierValue,version,kind,layer:KIND_LAYERS[kind],name:values.name,aliases:values.aliases||[],description:values.description,narrative:values.narrative,owner:values.owner,classification:values.classification||'internal',valid_from:values.valid_from||nowTime(),valid_until:values.valid_until||null,provenance,dependencies,spec});
  const validationState={...state,records:[...state.records,record]};validateIdentitiesAndSources(validationState.records);closure(validationState,[record]);
  return {record,submission:{path:sourcePath,text:original,sha256:digest,format:'form'},validation:{valid:true,structural:'valid',relationships:'valid',semantic_approval:'not_verified'}};
}
export function importRecord(text,format) {try{return validateRecord(parseDocument(text,format));}catch(error){if(error instanceof WorkspaceError)throw error;fail(error.code||'invalid_document',error.message||'The document does not use the supported format.');}}
export function exportRecord(record,format) {return formatDocument(validateRecord(record),format);}
export async function addRecords(state,rawRecords,{submissionText=null,format='json',submissions=[]}={}) {
  check(Array.isArray(rawRecords)&&rawRecords.length>0&&rawRecords.length<=LIMITS.records,'Add from 1 to 1,000 context record versions per batch.');
  if(state.records.length+rawRecords.length>LIMITS.records)fail('record_limit','The workspace exceeds 1,000 record versions. Export it and move larger collections to the Python registry.');
  const records=rawRecords.map(validateRecord);const seen=new Set(state.records.map(x=>x.id+'@'+x.version));
  for(const r of records){const key=r.id+'@'+r.version;if(seen.has(key))fail('immutable_version',`${r.id} version ${r.version} already exists. Create a new version.`);seen.add(key);}
  const next=traceState(state,'records_added',{records:records.map(x=>({id:x.id,version:x.version})),local_only:true});next.records.push(...records);
  const originals=submissions.map(copy);
  if(submissionText!==null){check(FORMATS.includes(format),'Select a supported submission format.');check(typeof submissionText==='string','Use original submission text.');const sha256=await hash(submissionText);originals.push({path:`imports/import-${sha256}.txt`,text:submissionText,sha256,format});}
  for(const submission of originals){exact(submission,['path','text','sha256','format']);path(submission.path);check(typeof submission.text==='string'&&FORMATS.includes(submission.format)&&HASH.test(submission.sha256),'Use a complete original submission.');check(await hash(submission.text)===submission.sha256,'The original submission hash does not match its bytes.');
    const old=next.submissions.find(x=>x.path===submission.path);check(!old||canonical(old)===canonical(submission),'A stored source path already has different bytes.');if(!old)next.submissions.push(submission);}
  validateGraph(next);boundState(next);return next;
}
export async function reviewState(state,record) {
  const item=state.reviews.findLast?state.reviews.findLast(x=>x.id===record.id&&x.version===record.version):[...state.reviews].reverse().find(x=>x.id===record.id&&x.version===record.version);
  if(!item)return {status:'not_reviewed',reviewer:null,hash:null};const expected=await hash(validateRecord(record));
  return {status:item.hash===expected?'local_attested':'stale',reviewer:item.reviewer,hash:item.hash,at:item.at,authority:'unverified_local_attestation'};
}
export async function attestRecord(state,id,version,reviewer) {
  text(reviewer,'the local reviewer name',128);const r=state.records.find(x=>x.id===id&&x.version===version);check(r,'Select a stored record version.');closure(state,[r]);
  const next=traceState(state,'local_review_recorded',{id,version,reviewer,authority:'unverified_local_attestation'});
  next.reviews=next.reviews.filter(x=>x.id!==id||x.version!==version);next.reviews.push({id,version,hash:await hash(r),reviewer,at:next.updated_at,decision:'locally_attested'});boundState(next);return next;
}
export async function validateWorkspace(raw) {
  let state;try{state=copy(raw);}catch(error){fail('invalid_workspace','Use a bounded workspace backup with supported JSON values.');}
  exact(state,STATE_FIELDS,'Use workspace schema prefrontal.workspace.v1 with its documented fields.');check(state.schema==='prefrontal.workspace.v1'&&WS_ID.test(state.id)&&MODES.includes(state.mode),'Use a supported workspace ID and mode.');text(state.name,'a workspace name',128);integer(state.revision,'a workspace revision',0);
  for(const key of ['created_at','updated_at'])normalizeTime(state[key]);
  check(instant(state.updated_at)>=instant(state.created_at),'The workspace update time must not precede its creation time.');
  check(Array.isArray(state.records)&&Array.isArray(state.submissions)&&Array.isArray(state.reviews)&&Array.isArray(state.trace),'The workspace collections must be lists.');boundState(state);
  const keys=new Set();for(const rawRecord of state.records){const r=validateRecord(rawRecord);check(canonical(rawRecord)===canonical(r),'Normalize the record timestamps before storing this workspace.');const key=r.id+'@'+r.version;check(!keys.has(key),'Remove duplicate record versions.');keys.add(key);}
  const sources=new Map();for(const s of state.submissions){exact(s,['path','text','sha256','format']);path(s.path);check(typeof s.text==='string'&&FORMATS.includes(s.format)&&HASH.test(s.sha256)&&!sources.has(s.path),'Use distinct original submission paths.');check(await hash(s.text)===s.sha256,'An original submission hash does not match its bytes.');sources.set(s.path,s.sha256);}
  for(const r of state.records)for(const p of r.provenance)if(sources.has(p.path))check(sources.get(p.path)===p.sha256,'Record provenance does not match its stored original submission.');
  const reviews=new Set();for(const r of state.reviews){exact(r,['id','version','hash','reviewer','at','decision']);identifier(r.id);integer(r.version,'a reviewed version');text(r.reviewer,'a reviewer',128);normalizeTime(r.at);check(HASH.test(r.hash)&&r.decision==='locally_attested'&&keys.has(r.id+'@'+r.version),'Use a local review tied to a stored record.');check(!reviews.has(r.id+'@'+r.version),'Use one current local review per record version.');reviews.add(r.id+'@'+r.version);}
  check(state.trace.length<=LIMITS.trace,'The trace exceeds its bounded history.');for(const t of state.trace){exact(t,['at','action','details']);normalizeTime(t.at);text(t.action,'a trace action',80);check(t.details!==null&&typeof t.details==='object'&&!Array.isArray(t.details),'Use structured trace details.');}
  validateGraph(state);
  const missing=state.records.reduce((n,r)=>n+r.provenance.filter(p=>!sources.has(p.path)).length,0);
  return {valid:true,record_count:state.records.length,bytes:byteLength(canonical(state)),warnings:[...(missing?[`${missing} provenance reference(s) have no captured original source file. External sources are disconnected.`]:[]),'Local review does not establish verified human approval.','This workspace has not run a context quality benchmark.']};
}
const indexCache=new WeakMap();
function normalized(value){return value.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();}
function tokens(value){return normalized(value).match(/[\p{L}\p{N}]+/gu)||[];}
function indexFor(state) {
  let index=indexCache.get(state);if(index)return index;
  const records=latestRecords(state),byId=new Map(),exactTerms=new Map(),postings=new Map();
  for(const record of records){byId.set(record.id,record);const weighted=new Map();for(const [value,weight] of [[record.name,300],[record.description,100],...record.aliases.map(x=>[x,200])])for(const token of new Set(tokens(value)))weighted.set(token,Math.max(weighted.get(token)||0,weight));
    for(const [token,weight] of weighted){if(!postings.has(token))postings.set(token,new Map());postings.get(token).set(record.id,weight);}
    for(const [value,weight] of [[record.id,100000],[record.name,90000],...record.aliases.map(x=>[x,80000])]){const term=normalized(value);if(!exactTerms.has(term))exactTerms.set(term,new Map());const entries=exactTerms.get(term);entries.set(record.id,Math.max(entries.get(record.id)||0,weight));}}
  index={records,byId,exactTerms,postings};indexCache.set(state,index);return index;
}
function encodeCursor(value){const source=canonical(value);return btoa(Array.from(new TextEncoder().encode(source),x=>String.fromCharCode(x)).join(''));}
function decodeCursor(value){try{check(typeof value==='string'&&value.length<2048,'The search cursor is invalid.');return strictJSON(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value),x=>x.charCodeAt(0))),2048);}catch(error){fail('invalid_cursor','Restart the search. Its continuation is invalid.');}}
export function search(state,{query='',layer=null,kind=null,dimension=null,page_size=20,cursor=null}={}) {
  check(typeof query==='string'&&query.length<=LIMITS.queryChars,'Use a search of at most 256 characters.');check(Number.isInteger(page_size)&&page_size>=1&&page_size<=LIMITS.pageSize,'Use a page size from 1 to 100.');
  check(layer===null||Object.values(KIND_LAYERS).includes(layer),'Select a valid layer.');check(kind===null||Object.hasOwn(KIND_LAYERS,kind),'Select a valid type.');if(dimension!==null)identifier(dimension);
  const term=normalized(query),parts=[...new Set(tokens(query))].sort();check(parts.length<=LIMITS.queryTerms,'Use at most 16 search terms.');const signature=canonical({id:state.id,revision:state.revision,query:term,layer,kind,dimension,page_size});let offset=0;
  if(cursor){const c=decodeCursor(cursor);if(c.signature!==signature)fail('stale_cursor','The workspace or search changed. Restart the search.');check(Number.isSafeInteger(c.offset)&&c.offset>=0,'Use a valid continuation offset.');offset=c.offset;}
  const index=indexFor(state),scores=new Map();
  if(!term)for(const r of index.records)scores.set(r.id,0);
  else {
    for(const [id,score] of index.exactTerms.get(term)||[])scores.set(id,score);
    if(parts.length){let candidates=null;for(const token of parts){const posting=index.postings.get(token)||new Map();candidates=candidates===null?new Set(posting.keys()):new Set([...candidates].filter(x=>posting.has(x)));}
      for(const id of candidates||[]){const score=parts.reduce((n,t)=>n+index.postings.get(t).get(id),0);scores.set(id,Math.max(scores.get(id)||0,score));}}
  }
  const matches=[...scores].map(([id,score])=>({record:index.byId.get(id),score})).filter(({record:r})=>(layer===null||r.layer===layer)&&(kind===null||r.kind===kind)&&(dimension===null||(r.kind==='dimension'&&r.id===dimension)||(r.kind==='member'&&r.spec.dimension===dimension))).sort((a,b)=>b.score-a.score||(a.record.id<b.record.id?-1:a.record.id>b.record.id?1:0));
  const items=matches.slice(offset,offset+page_size).map(x=>({record:copy(x.record),score:x.score}));
  return {items,matched_count:matches.length,next_cursor:offset+page_size<matches.length?encodeCursor({signature,offset:offset+page_size}):null,revision:state.revision,scope:'local_authoring_drafts_and_attestations',consistency:'Restart after any workspace change.'};
}
function lookup(index,value,kind=null) {
  check(typeof value==='string'&&value.trim(),'Select a context ID.');const exact=index.byId.get(value);if(exact&&(!kind||exact.kind===kind))return exact;
  const n=normalized(value),matches=index.records.filter(r=>(!kind||r.kind===kind)&&[r.name,...r.aliases].some(x=>normalized(x)===n));
  if(matches.length!==1)fail(matches.length?'ambiguous_alias':'missing_record',matches.length?'Use an exact ID. This name matches more than one record.':`The context record ${value} is not available.`);return matches[0];
}
export async function compose(state,{measure=null,selectors=[],roots=[]}={}) {
  await validateWorkspace(state);check(Array.isArray(selectors)&&selectors.length<=32&&Array.isArray(roots)&&roots.length<=32,'Use a bounded set of selectors and context roots.');
  const index=indexFor(state),rootRecords=[],chosen=[],dimensions=new Set();let metric=null;
  if(measure){metric=lookup(index,measure,'measure');rootRecords.push(metric);}
  if(selectors.length&&!metric)fail('missing_measure','Select a measure before adding point-of-view members.');
  for(const token of selectors){const member=lookup(index,typeof token==='string'?token:token.member,'member');if(typeof token!=='string'){exact(token,['dimension','member']);const d=lookup(index,token.dimension,'dimension');check(d.id===member.spec.dimension,'The selector member does not belong to this dimension.');}
    if(dimensions.has(member.spec.dimension))fail('conflicting_selectors','Choose one member per dimension.');dimensions.add(member.spec.dimension);chosen.push(member);rootRecords.push(member);}
  if(metric){const allowed=new Set([...metric.spec.required_dimensions,...metric.spec.optional_dimensions]);check(metric.spec.required_dimensions.every(x=>dimensions.has(x)),'Add one member for each required dimension.');check([...dimensions].every(x=>allowed.has(x)),'This measure does not support one of the selected dimensions.');}
  const extraIds=new Set();for(const id of roots){const r=lookup(index,id);check(!extraIds.has(r.id),'Remove duplicate context roots.');extraIds.add(r.id);rootRecords.push(r);}
  check(rootRecords.length>0,'Select a measure or a context record to export.');const records=closure(state,rootRecords);const at=instant(nowTime());
  for(const r of records){
    if(at<instant(r.valid_from)||(r.valid_until!==null&&at>=instant(r.valid_until)))fail('expired_context',`${r.id} is outside its valid time. Update and review the context.`);
    if(r.kind==='source'){
      const age=at-instant(r.spec.checked_at);
      if(age<0n||age>BigInt(r.spec.freshness_seconds)*1000000n)fail('stale_source',`${r.id} is outside its declared freshness time. Its external binding is still disconnected.`);
    }
  }
  const envelopes=[];for(const r of records)envelopes.push({record:copy(r),hash:await hash(r),local_review:await reviewState(state,r)});
  const provenance=[...new Map(records.flatMap(r=>r.provenance).map(p=>[p.path+'\0'+p.sha256,p])).values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:a.sha256<b.sha256?-1:1);
  const payload={contract:'prefrontal.browser.consumer.v1',workspace:{id:state.id,name:state.name,mode:state.mode,revision:state.revision},context_updated_at:state.updated_at,
    intent:{measure:metric?{id:metric.id,version:metric.version}:null,selectors:chosen.map(r=>({dimension:r.spec.dimension,id:r.id,version:r.version,value:r.spec.value})).sort((a,b)=>a.dimension<b.dimension?-1:a.dimension>b.dimension?1:a.id<b.id?-1:1),roots:[...new Map(rootRecords.map(r=>[r.id,{id:r.id,version:r.version}])).values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)},
    records:envelopes,provenance,validation:{structural:'valid',relationships:'valid',semantic_approval:'not_verified',authority:'browser_local_unverified',source_access:'disconnected',evaluation:'not_evaluated'},execution_authorized:false,recheck_at_use:true};
  payload.bundle_hash=await hash(payload);if(byteLength(canonical(payload))>LIMITS.closureBytes)fail('closure_limit','The consumer payload exceeds 1 MiB. Use a smaller context set.');return payload;
}
export function storageKey(mode='user') {check(MODES.includes(mode),'Select a supported workspace mode.');return 'prefrontal.workspace.v1.'+mode;}
export async function exportWorkspace(state) {await validateWorkspace(state);return canonical({contract:'prefrontal.workspace.backup.v1',workspace:state,sha256:await hash(state)})+'\n';}
export async function importWorkspace(value,{mode='user'}={}) {
  let body;try{body=strictJSON(value,LIMITS.workspaceBytes+4096);}catch(error){fail('invalid_backup','Use a complete supported workspace backup.');}
  exact(body,['contract','workspace','sha256'],'Use a complete versioned workspace backup.');check(body.contract==='prefrontal.workspace.backup.v1'&&HASH.test(body.sha256),'Use workspace backup version 1.');
  if(await hash(body.workspace)!==body.sha256)fail('backup_hash_mismatch','The backup checksum does not match its content.');
  await validateWorkspace(body.workspace);if(body.workspace.mode!==mode)fail('mode_mismatch','Restore a user backup in the user workspace and a demo backup in the demo workspace.');return copy(body.workspace);
}
async function rawStorageHash(raw) {
  // localStorage exposes UTF-16 strings, including malformed data. Hash exact
  // code units for this ephemeral conflict token; do not repair invalid text or
  // reuse this private encoding for canonical record/source provenance hashes.
  if(!globalThis.crypto?.subtle)fail('crypto_unavailable','Use an HTTPS page or localhost to verify stored-state recovery.');
  const bytes=new Uint8Array(raw.length*2);
  for(let index=0;index<raw.length;index++){const unit=raw.charCodeAt(index);bytes[index*2]=unit&255;bytes[index*2+1]=unit>>>8;}
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function loadWorkspace(storage,mode='user') {
  let raw;try{raw=storage.getItem(storageKey(mode));}catch(error){fail('storage_unavailable','Browser storage is unavailable. Keep this work in memory and export a backup.');}
  if(raw===null)return {workspace:null,token:null};
  let workspace;
  try{workspace=await importWorkspace(raw,{mode});}
  catch(error){
    const recoveryToken={kind:'prefrontal.storage.recovery.v1',mode,raw_sha256:await rawStorageHash(raw)};
    fail(error.code||'invalid_backup','Stored data cannot be read. Export current memory work, inspect the raw stored value, then restore a valid backup explicitly.',{...(error.details||{}),recoveryToken});
  }
  return {workspace,token:{id:workspace.id,revision:workspace.revision,sha256:await hash(workspace)}};
}
export async function saveWorkspace(storage,state,token=null,{replace=false}={}) {
  const mode=state.mode,key=storageKey(mode);
  const save=async()=>{
    await validateWorkspace(state);const serialized=await exportWorkspace(state);if(byteLength(serialized)>LIMITS.workspaceBytes)fail('workspace_limit','The saved backup exceeds 2 MiB. Export it and move larger collections to the Python registry.');
    let previous;try{previous=storage.getItem(key);}catch(error){fail('storage_unavailable','Browser storage is unavailable. Export a backup to keep your work.');}
    if(previous===null){if(token!==null)fail('storage_conflict','Stored work changed in another tab. Reload before saving.');}
    else if(token?.kind==='prefrontal.storage.recovery.v1'){
      if(!replace)fail('storage_conflict','Stored data is unreadable. Use explicit backup recovery; an ordinary save cannot replace it.');
      exact(token,['kind','mode','raw_sha256'],'Use the current opaque recovery token.');
      if(token.mode!==mode||!HASH.test(token.raw_sha256)||token.raw_sha256!==await rawStorageHash(previous))fail('storage_conflict','Stored data changed after recovery was prepared. Read it again before restoring.');
      let stillInvalid=false;try{await importWorkspace(previous,{mode});}catch(error){stillInvalid=true;}
      if(!stillInvalid)fail('storage_conflict','A valid workspace is now stored. Read it again before restoring.');
    } else {
      let old;try{old=await importWorkspace(previous,{mode});}catch(error){fail('storage_conflict','Stored work cannot be read. Export your current work before recovery.');}
      if(!token||token.id!==old.id||token.revision!==old.revision||token.sha256!==await hash(old))fail('storage_conflict','Stored work changed in another tab. Reload before saving.');
      if(!replace&&state.id!==old.id)fail('storage_conflict','Use explicit backup recovery to replace a different workspace.');
      if(!replace&&state.revision<old.revision)fail('storage_conflict','The workspace revision went backwards. Reload before saving.');
    }
    try{if(storage.getItem(key)!==previous)fail('storage_conflict','Stored work changed in another tab. Reload before saving.');storage.setItem(key,serialized);if(storage.getItem(key)!==serialized)fail('storage_unconfirmed','The browser did not confirm the saved bytes. Export a backup and reload.');}
    catch(error){if(error instanceof WorkspaceError)throw error;fail('storage_failed','The browser did not save this work. Storage may be full or blocked. Export a backup and keep this tab open.');}
    return {workspace:copy(state),token:{id:state.id,revision:state.revision,sha256:await hash(state)},key,bytes:byteLength(serialized),status:'saved'};
  };
  // Cooperating tabs use a same-origin Web Lock. Older browsers use the explicit
  // optimistic conflict check above; it is not an atomic cross-tab compare/swap.
  if(globalThis.navigator?.locks?.request)return navigator.locks.request(key,save);
  return save();
}
