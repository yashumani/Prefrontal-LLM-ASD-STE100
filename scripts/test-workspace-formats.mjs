import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {
  FormatError, MAX_DOCUMENT_BYTES, MARKDOWN_PREFIX, MARKDOWN_NARRATIVE,
  canonical, strictJSON, byteLength, parseDocument, formatDocument,
} from '../workspace/formats.mjs';

let tests = 0;
function test(name, action) {
  action();
  tests += 1;
  console.log('PASS ' + name);
}
function deny(action, code = 'invalid_document') {
  assert.throws(action, error => error instanceof FormatError && error.code === code);
}
const fixture = JSON.parse(readFileSync(new URL('../examples/composable/records/M_GROSS_ADDS.json', import.meta.url), 'utf8'));

test('canonical order and ASCII Unicode match Python contract', () => {
  assert.equal(canonical({z:'café 😀',a:7}), '{"a":7,"z":"caf\\u00e9 \\ud83d\\ude00"}');
  assert.equal(canonical({'😀':1,'\ue000':2}), '{"\\ue000":2,"\\ud83d\\ude00":1}');
});
test('canonical keys are sorted lexically including numeric strings', () => {
  assert.equal(canonical({'2':2,'10':10,'1':1}), '{"1":1,"10":10,"2":2}');
});
test('strict JSON preserves prototype-like keys without prototype changes', () => {
  const parsed = strictJSON('{"__proto__":{"x":1},"constructor":"inert"}');
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(Object.prototype.x, undefined);
  assert.equal(canonical(parsed), '{"__proto__":{"x":1},"constructor":"inert"}');
});
test('strict JSON rejects duplicate and escaped duplicate keys', () => {
  deny(() => strictJSON('{"id":"A","id":"B"}'));
  deny(() => strictJSON('{"a":1,"\\u0061":2}'));
  deny(() => strictJSON('{"outer":{"x":1,"x":2}}'));
});
test('strict JSON rejects fractional exponent and rounded integer input', () => {
  for (const raw of ['1.0','1e0','1E2','1e-10','9007199254740992','-9007199254740992',
    '9007199254740993','9007199254740991.1','-0.0','01','+1','NaN','Infinity','undefined']) {
    deny(() => strictJSON(raw));
  }
  assert.equal(strictJSON('9007199254740991'), Number.MAX_SAFE_INTEGER);
  assert.equal(strictJSON('-9007199254740991'), Number.MIN_SAFE_INTEGER);
});
test('strict JSON rejects trailing malformed syntax and invalid escapes', () => {
  for (const raw of ['{} {}','[1,]','{"x":1,}','{"x" 1}','"\\v"','"\\uZZZZ"','"unterminated',
    'tru','{"a":truefalse}','[1 2]','{"a":1// comment\n}']) deny(() => strictJSON(raw));
});
test('strict JSON preserves exact whitespace inside text', () => {
  assert.equal(strictJSON(' \n\t"  line\\r\\n  next \\t" \r\n'), '  line\r\n  next \t');
});
test('invalid Unicode is rejected before encoding or canonicalization', () => {
  for (const value of ['\ud800','\udc00','A\ud800Z']) {
    deny(() => canonical(value));
    deny(() => strictJSON(JSON.stringify(value)));
    deny(() => byteLength(value));
  }
  assert.equal(byteLength('😀'), 4);
});
test('non-JSON values cycles accessors and sparse arrays are rejected', () => {
  for (const value of [undefined,NaN,Infinity,1.1,1e100,BigInt(1),new Date(),new Set()]) {
    deny(() => canonical(value));
  }
  const cycle = {}; cycle.self = cycle;
  deny(() => canonical(cycle));
  const accessor = {};
  Object.defineProperty(accessor, 'x', {enumerable:true,get(){throw new Error('Getter must not run');}});
  deny(() => canonical(accessor));
  const sparse = new Array(1); sparse.extra = 'value';
  deny(() => canonical(sparse));
});
test('bounded nesting and byte counts are enforced', () => {
  assert.deepEqual(strictJSON('['.repeat(16) + '0' + ']'.repeat(16)), JSON.parse('['.repeat(16) + '0' + ']'.repeat(16)));
  deny(() => strictJSON('['.repeat(17) + '0' + ']'.repeat(17)));
  deny(() => strictJSON('"abc"', 4));
  deny(() => strictJSON('{}', 0));
  deny(() => parseDocument(' '.repeat(MAX_DOCUMENT_BYTES + 1), 'yaml'));
});
test('all formats preserve the real checked-in synthetic proposal', () => {
  for (const format of ['json','yaml','markdown']) {
    const document = formatDocument(fixture, format);
    assert.equal(canonical(parseDocument(document, format)), canonical(fixture));
    assert.equal(formatDocument(fixture, format), document);
  }
});
test('checked-in genuinely authored YAML parses without JSON suffix tricks', () => {
  const document = readFileSync(new URL('../examples/composable/records/M_GROSS_ADDS.yaml', import.meta.url), 'utf8');
  assert(!document.trimStart().startsWith('{'));
  assert.equal(canonical(parseDocument(document, 'yaml')), canonical(fixture));
});
test('idiomatic YAML mappings sequences comments and literal text work', () => {
  const document = [
    '# A documented bounded YAML example', '---', 'id: M_DEMO', 'version: 1',
    'dependencies:', '  - id: SOURCE_DEMO', '    version: 1',
    'aliases:', '  - "new completed orders"', '  - completed_orders',
    'spec:', '  enabled: true', '  optional: null', '  empty: []',
    'narrative: |-', '  First line.', '  # This is literal text.', '    Indented detail.',
    '...', '',
  ].join('\n');
  const parsed = parseDocument(document, 'yaml');
  assert.deepEqual(parsed.dependencies, [{id:'SOURCE_DEMO',version:1}]);
  assert.equal(parsed.narrative, 'First line.\n# This is literal text.\n  Indented detail.');
  assert.equal(parsed.spec.enabled, true);
  assert.equal(parsed.spec.optional, null);
  assert.deepEqual(parsed.spec.empty, []);
});
test('YAML nesting and compact nested sequence mappings preserve data', () => {
  const parsed = parseDocument('items:\n  - id: FIRST\n    fields:\n      - one\n      - two\n  - id: SECOND\n    fields: []\n', 'yaml');
  assert.deepEqual(parsed, {items:[{id:'FIRST',fields:['one','two']},{id:'SECOND',fields:[]}]});
});
test('YAML explicit scalar typing prevents coercion', () => {
  for (const scalar of ['yes','No','ON','off','Y','n','2026-09-01','012','-0','1.0','1e3','.nan',
    'hello world','null # note','value # comment','*alias','&anchor','!tag value','{x: 1}','[one]','<<: value']) {
    deny(() => parseDocument('value: ' + scalar + '\n', 'yaml'));
  }
  assert.deepEqual(parseDocument('value: "2026-09-01"\nyes_text: "yes"\nnull_text: "null"\n', 'yaml'),
    {value:'2026-09-01',yes_text:'yes',null_text:'null'});
});
test('YAML duplicates fail at each mapping shape', () => {
  for (const document of [
    'id: FIRST\nid: SECOND\n',
    'outer:\n  id: FIRST\n  id: SECOND\n',
    'items:\n  - id: FIRST\n    id: SECOND\n',
    '__proto__: one\n__proto__: two\n',
  ]) deny(() => parseDocument(document, 'yaml'));
});
test('YAML aliases tags and merge keys cannot construct shared objects', () => {
  for (const document of [
    'first: &anchor value\nsecond: *anchor\n',
    'value: !!python/object value\n',
    'value:\n  <<: OTHER\n',
    'first: *anchor\n',
  ]) deny(() => parseDocument(document, 'yaml'));
});
test('YAML rejects tabs bare carriage returns odd indentation and implicit values', () => {
  for (const document of ['value:\ttext\n','value: text\rnext: value','outer:\n x: value\n',
    'empty:\n','first: one\n---\nsecond: two\n']) {
    deny(() => parseDocument(document, 'yaml'));
  }
  assert.deepEqual(parseDocument('value: text\r\n', 'yaml'), {value:'text'});
  // Like the Python grammar, marker-only syntax yields an empty mapping.
  // Record validation must reject that mapping as an incomplete proposal.
  assert.deepEqual(parseDocument('---\n...\n', 'yaml'), {});
});
test('YAML literal trailing spaces and blank-line content are preserved', () => {
  const parsed = parseDocument('narrative: |-\n  first  \n    \n  last \n', 'yaml');
  assert.equal(parsed.narrative, 'first  \n  \nlast ');
  assert.equal(parseDocument(formatDocument(parsed, 'yaml'), 'yaml').narrative, parsed.narrative);
});
test('YAML exporter quotes exact CRLF terminal newlines and controls', () => {
  for (const narrative of ['line\r\nnext\r\n','trailing\n','a\tb\u0000c','😀\nlast','line\n  \nlast']) {
    const record = {...fixture,narrative};
    assert.equal(parseDocument(formatDocument(record, 'yaml'), 'yaml').narrative, narrative);
  }
});
test('JSON-compatible YAML remains supported', () => {
  const text = canonical(fixture);
  assert.equal(canonical(parseDocument(text, 'yaml')), text);
  deny(() => parseDocument('{"x":1,"x":2}', 'yaml'));
});
test('Markdown is an exact inert proposal profile', () => {
  const record = {...fixture,narrative:'<script>globalThis.pwned=true</script>\n' + MARKDOWN_NARRATIVE + 'literal\n'};
  const document = formatDocument(record, 'markdown');
  assert.equal(parseDocument(document, 'markdown').narrative, record.narrative);
  assert.equal(globalThis.pwned, undefined);
  deny(() => parseDocument(document.replace('# Prefrontal context record', '# Arbitrary title'), 'markdown'));
  deny(() => parseDocument(document.replace(MARKDOWN_PREFIX, MARKDOWN_PREFIX + ' '), 'markdown'));
  deny(() => parseDocument(MARKDOWN_PREFIX + canonical(record) + MARKDOWN_NARRATIVE + 'text', 'markdown'));
});
test('unsupported formats fail explicitly', () => {
  deny(() => parseDocument('{}', 'yml'), 'unsupported_format');
  deny(() => formatDocument(fixture, 'html'), 'unsupported_format');
});
test('Python parser and exporter agree on canonical bytes in all formats', () => {
  const samples = [
    fixture,
    {...fixture,name:'Gross adds café 😀',narrative:'Line one.\n  Qualifier: café 😀\nLast line.'},
    {...fixture,narrative:'CRLF\r\nand terminal newline\r\n'},
  ];
  const request = samples.map(record => ({record, documents:Object.fromEntries(
    ['json','yaml','markdown'].map(format => [format,formatDocument(record,format)]))}));
  const source = [
    'import json,sys',
    'from pilot.composable_formats import parse_document,export_document',
    'from pilot.context_pilot import canonical',
    'request=json.load(sys.stdin)',
    'result=[]',
    'for sample in request:',
    '    expected=canonical(sample["record"])',
    '    for kind,text in sample["documents"].items():',
    '        assert canonical(parse_document(text,kind))==expected',
    '    result.append({"canonical":expected,"documents":{kind:export_document(sample["record"],kind) for kind in ("json","yaml","markdown")}})',
    'print(json.dumps(result))',
  ].join('\n');
  const result = spawnSync(process.env.PREFRONTAL_PYTHON || 'python', ['-B','-c',source], {
    cwd:new URL('..',import.meta.url), input:JSON.stringify(request), encoding:'utf8',
    env:{...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'},
  });
  assert.equal(result.status,0,result.stderr);
  const responses = JSON.parse(result.stdout);
  responses.forEach((response,index) => {
    assert.equal(response.canonical,canonical(samples[index]));
    for (const [format,document] of Object.entries(response.documents)) {
      assert.equal(canonical(parseDocument(document,format)),response.canonical);
    }
  });
});
console.log(JSON.stringify({status:'passed',tests,contract:'prefrontal.browser.formats.v1',python_cross_runtime:true}));
