/* Bounded proposal formats shared with pilot/composable_formats.py.
 * No document can import approval, execute text, or construct objects via YAML.
 * This browser profile admits exact safe integers only. It is not general YAML.
 */
export const MAX_RECORD_BYTES = 65536;
export const MAX_DOCUMENT_BYTES = MAX_RECORD_BYTES * 4 + 4096;
export const MAX_JSON_DEPTH = 16;
const fence = String.fromCharCode(96).repeat(3);
export const MARKDOWN_PREFIX = '# Prefrontal context record\n\n' + fence + 'json\n';
export const MARKDOWN_NARRATIVE = '\n' + fence + '\n\n## Narrative\n\n';

export class FormatError extends Error {
  constructor(code = 'invalid_document', message = 'Use a supported, bounded context document.') {
    super(message);
    this.name = 'FormatError';
    this.code = code;
  }
}

function fail(message) { throw new FormatError('invalid_document', message); }
function validUnicode(text) {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('Replace an invalid Unicode character.');
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail('Replace an invalid Unicode character.');
    }
  }
}
export function byteLength(text) {
  if (typeof text !== 'string') fail('Use text for the document.');
  validUnicode(text);
  return new TextEncoder().encode(text).length;
}

// Python sorts strings by Unicode scalar value, not UTF-16 code unit.
function compareKeys(a, b) {
  const left = Array.from(a, char => char.codePointAt(0));
  const right = Array.from(b, char => char.codePointAt(0));
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}
function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
// The repository's context_pilot.canonical uses ensure_ascii=True.
function quotedASCII(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}
function writeCanonical(value, depth, ancestors) {
  if (depth > MAX_JSON_DEPTH) fail('Reduce the document nesting to 16 levels.');
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') { validUnicode(value); return quotedASCII(value); }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail('Use exact integers between the browser safe integer limits.');
    return JSON.stringify(value);
  }
  if (!Array.isArray(value) && !plainObject(value)) fail('Use JSON values only.');
  if (ancestors.has(value)) fail('Remove a circular value.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      // Holes and extra array properties are not JSON data in this profile.
      if (Reflect.ownKeys(value).length !== value.length + 1 ||
          Object.keys(value).length !== value.length ||
          Object.keys(value).some((key, index) => key !== String(index)) ||
          Object.keys(value).some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
        fail('Use a complete plain JSON array.');
      }
      return '[' + value.map(item => writeCanonical(item, depth + 1, ancestors)).join(',') + ']';
    }
    if (Reflect.ownKeys(value).some(key => typeof key !== 'string') ||
        Reflect.ownKeys(value).length !== Object.keys(value).length) fail('Use plain string object fields.');
    return '{' + Object.keys(value).sort(compareKeys).map(key => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || !Object.hasOwn(property, 'value') || !property.enumerable) {
        fail('Use plain JSON fields only.');
      }
      validUnicode(key);
      return quotedASCII(key) + ':' + writeCanonical(property.value, depth + 1, ancestors);
    }).join(',') + '}';
  } finally {
    ancestors.delete(value);
  }
}
export function canonical(value) { return writeCanonical(value, 0, new Set()); }

// A small parser retains keys before assignment, so duplicate keys cannot vanish
// through JSON.parse. Integer tokens are checked before Number conversion.
export function strictJSON(text, maxBytes = MAX_RECORD_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || byteLength(text) > maxBytes) {
    fail('The document is too large. Use a smaller import.');
  }
  let index = 0;
  function space() { while (index < text.length && /[ \t\r\n]/.test(text[index])) index += 1; }
  function string() {
    const start = index;
    if (text[index] !== '"') fail('Use a JSON string.');
    index += 1;
    while (index < text.length) {
      const char = text[index];
      if (char === '"') {
        index += 1;
        let result;
        try { result = JSON.parse(text.slice(start, index)); } catch { fail('Fix the JSON string.'); }
        validUnicode(result);
        return result;
      }
      if (char === '\\') {
        index += 1;
        if (index >= text.length) fail('Finish the JSON escape.');
        if (text[index] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(index + 1, index + 5))) fail('Fix the Unicode escape.');
          index += 5;
        } else {
          if (!/["\\/bfnrt]/.test(text[index])) fail('Use a valid JSON escape.');
          index += 1;
        }
      } else {
        if (char.charCodeAt(0) < 0x20) fail('Escape control characters in JSON strings.');
        index += 1;
      }
    }
    fail('Finish the JSON string.');
  }
  function value(depth) {
    space();
    const char = text[index];
    if (char === '{' || char === '[') {
      if (depth + 1 > MAX_JSON_DEPTH) fail('Reduce the document nesting to 16 levels.');
      const array = char === '[';
      const result = array ? [] : {};
      const seen = new Set();
      const close = array ? ']' : '}';
      index += 1;
      space();
      if (text[index] === close) { index += 1; return result; }
      while (true) {
        space();
        let key;
        if (!array) {
          key = string();
          if (seen.has(key)) fail('Remove a duplicate JSON key: ' + key + '.');
          seen.add(key);
          space();
          if (text[index] !== ':') fail('Add a colon after a JSON key.');
          index += 1;
        }
        const child = value(depth + 1);
        if (array) result.push(child);
        else Object.defineProperty(result, key, {value: child, writable: true, enumerable: true, configurable: true});
        space();
        if (text[index] === close) { index += 1; return result; }
        if (text[index] !== ',') fail('Use a comma between JSON values.');
        index += 1;
      }
    }
    if (char === '"') return string();
    for (const [literal, decoded] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, index)) { index += literal.length; return decoded; }
    }
    const token = /^-?(?:0|[1-9][0-9]*)(?![0-9.eE+-])/.exec(text.slice(index));
    if (!token) fail('Use a JSON value. This browser profile uses exact decimal integers.');
    const number = Number(token[0]);
    if (!Number.isSafeInteger(number)) fail('The integer exceeds the exact browser limit.');
    index += token[0].length;
    return number;
  }
  const result = value(0);
  space();
  if (index !== text.length) fail('Remove text after the JSON value.');
  canonical(result);
  return result;
}

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLAIN = /^[A-Za-z_][A-Za-z0-9_.:/-]*$/;
const DECIMAL = /^(?:0|-?[1-9][0-9]*)$/;
const AMBIGUOUS = new Set(['y', 'n', 'yes', 'no', 'on', 'off', 'true', 'false', 'null', 'nan', 'inf', 'infinity']);
const PY_SPACE = '[\\x09-\\x0d\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const strip = text => text.replace(new RegExp('^' + PY_SPACE + '+|' + PY_SPACE + '+$', 'g'), '');
const rightStrip = text => text.replace(new RegExp(PY_SPACE + '+$', 'g'), '');
function yamlPrintable(text) {
  return Array.from(text).every(char => {
    const point = char.codePointAt(0);
    return char === '\n' || (point >= 0x20 && point <= 0x7e) || point === 0x85 ||
      (point >= 0xa0 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff);
  });
}
function pair(text) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ':' && (index + 1 === text.length || text[index + 1] === ' ')) {
      const key = strip(text.slice(0, index));
      if (!KEY.test(key)) fail('Use identifier keys in the bounded YAML profile.');
      return [key, strip(text.slice(index + 1))];
    }
  }
  return null;
}
function yamlScalar(text) {
  if (text.startsWith('"')) {
    const value = strictJSON(text, MAX_DOCUMENT_BYTES);
    if (typeof value !== 'string') fail('Use a quoted YAML string.');
    return value;
  }
  if (text === '[]') return [];
  if (text === '{}') return {};
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (DECIMAL.test(text)) {
    const number = Number(text);
    if (!Number.isSafeInteger(number)) fail('The integer exceeds the exact browser limit.');
    return number;
  }
  if (PLAIN.test(text) && !text.endsWith(':') && !AMBIGUOUS.has(text.toLowerCase())) return text;
  fail('Quote this YAML value. Use the documented bounded YAML profile.');
}
class YamlReader {
  constructor(text) {
    text = text.replace(/\r\n/g, '\n');
    if (text.includes('\t') || text.includes('\r')) fail('Use two spaces for YAML indentation.');
    this.lines = text.split('\n');
  }
  skip(index) {
    while (index < this.lines.length) {
      const line = this.lines[index];
      if (strip(line) && !line.replace(/^ +/, '').startsWith('#')) break;
      index += 1;
    }
    return index;
  }
  line(index) {
    const raw = this.lines[index];
    const indent = raw.length - raw.replace(/^ +/, '').length;
    if (indent % 2) fail('Use two-space YAML indentation.');
    return [indent, rightStrip(raw.slice(indent))];
  }
  literal(index, indent) {
    const lines = [];
    while (index < this.lines.length) {
      const raw = this.lines[index];
      if (!strip(raw)) {
        lines.push(raw.length >= indent ? raw.slice(indent) : '');
        index += 1;
        continue;
      }
      const current = raw.length - raw.replace(/^ +/, '').length;
      if (current < indent) break;
      lines.push(raw.slice(indent));
      index += 1;
    }
    return [lines.join('\n').replace(/\n+$/, ''), index];
  }
  value(raw, nextIndex, indent, depth) {
    if (raw === '|-') return this.literal(nextIndex, indent + 2);
    if (raw) return [yamlScalar(raw), nextIndex];
    const child = this.skip(nextIndex);
    if (child >= this.lines.length || this.line(child)[0] !== indent + 2) {
      fail('Give this YAML field an explicit value.');
    }
    return this.container(child, indent + 2, depth + 1);
  }
  mappingItem(result, text, nextIndex, indent, depth) {
    const item = pair(text);
    if (!item) fail('Use a YAML mapping key and value.');
    const [key, raw] = item;
    if (Object.hasOwn(result, key)) fail('Remove a duplicate YAML key: ' + key + '.');
    const [child, following] = this.value(raw, nextIndex, indent, depth);
    Object.defineProperty(result, key, {value: child, writable: true, enumerable: true, configurable: true});
    return following;
  }
  container(index, indent, depth) {
    if (depth > MAX_JSON_DEPTH) fail('Reduce the document nesting to 16 levels.');
    index = this.skip(index);
    if (index >= this.lines.length || this.line(index)[0] !== indent) fail('Fix the YAML indentation.');
    const first = this.line(index)[1];
    const sequence = first === '-' || first.startsWith('- ');
    const result = sequence ? [] : {};
    while (true) {
      index = this.skip(index);
      if (index >= this.lines.length) break;
      const [current, text] = this.line(index);
      if (current < indent || (indent === 0 && text === '...')) break;
      if (current !== indent) fail('Fix the YAML indentation.');
      const isItem = text === '-' || text.startsWith('- ');
      if (isItem !== sequence) fail('Do not mix YAML mapping and sequence entries.');
      if (!sequence) {
        index = this.mappingItem(result, text, index + 1, indent, depth);
        continue;
      }
      const raw = strip(text.slice(1));
      const compact = raw ? pair(raw) : null;
      let child;
      if (!compact) [child, index] = this.value(raw, index + 1, indent, depth);
      else {
        child = {};
        index = this.mappingItem(child, raw, index + 1, indent + 2, depth + 1);
        while (true) {
          const nextIndex = this.skip(index);
          if (nextIndex >= this.lines.length) break;
          const [following, content] = this.line(nextIndex);
          if (following < indent + 2) break;
          if (following !== indent + 2) fail('Fix the compact YAML mapping indentation.');
          index = this.mappingItem(child, content, nextIndex + 1, indent + 2, depth + 1);
        }
      }
      result.push(child);
    }
    return [result, index];
  }
  read() {
    let first = this.skip(0);
    if (first < this.lines.length && this.lines[first] === '---') first = this.skip(first + 1);
    if (first >= this.lines.length) fail('Add a YAML document.');
    let [value, index] = this.container(first, 0, 1);
    index = this.skip(index);
    if (index < this.lines.length && this.lines[index] === '...') index = this.skip(index + 1);
    if (index !== this.lines.length) fail('Use one YAML document only.');
    canonical(value);
    return value;
  }
}
function yamlParse(text) {
  text = text.replace(/\r\n/g, '\n');
  if (!yamlPrintable(text)) fail('Escape non-printable YAML characters in JSON-quoted strings.');
  if (/^[{[]/.test(text.replace(new RegExp('^' + PY_SPACE + '+'), ''))) return strictJSON(text, MAX_DOCUMENT_BYTES);
  return new YamlReader(text).read();
}
function yamlInline(value) {
  return canonical(value).replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}
function yamlLines(value, indent = 0) {
  const pad = ' '.repeat(indent);
  const lines = [];
  if (plainObject(value)) {
    for (const key of Object.keys(value).sort(compareKeys)) {
      if (!KEY.test(key)) fail('Use identifier keys in the bounded YAML profile.');
      const child = value[key];
      if ((plainObject(child) || Array.isArray(child)) && Object.keys(child).length) {
        lines.push(pad + key + ':');
        lines.push(...yamlLines(child, indent + 2));
      } else if (key === 'narrative' && typeof child === 'string' && child.includes('\n') &&
                 !child.endsWith('\n') && yamlPrintable(child)) {
        lines.push(pad + key + ': |-');
        lines.push(...child.split('\n').map(line => pad + '  ' + line));
      } else lines.push(pad + key + ': ' + yamlInline(child));
    }
  } else if (Array.isArray(value)) {
    for (const child of value) {
      if (plainObject(child) && Object.keys(child).length) {
        const nested = yamlLines(child, indent + 2);
        lines.push(pad + '- ' + nested[0].slice(indent + 2));
        lines.push(...nested.slice(1));
      } else if (Array.isArray(child) && child.length) {
        lines.push(pad + '-');
        lines.push(...yamlLines(child, indent + 2));
      } else lines.push(pad + '- ' + yamlInline(child));
    }
  } else fail('Use a YAML mapping or sequence at the document root.');
  return lines;
}
function checkFormat(format) {
  if (!['json', 'yaml', 'markdown'].includes(format)) {
    throw new FormatError('unsupported_format', 'Choose JSON, YAML or the context Markdown profile.');
  }
}
export function formatDocument(record, format) {
  checkFormat(format);
  canonical(record);
  if (!plainObject(record)) fail('Use a context record object.');
  let text;
  if (format === 'json') text = canonical(record) + '\n';
  else if (format === 'yaml') text = yamlLines(record).join('\n') + '\n';
  else {
    if (!Object.hasOwn(record, 'narrative') || typeof record.narrative !== 'string') fail('Add the exact narrative field.');
    const metadata = {...record};
    delete metadata.narrative;
    text = MARKDOWN_PREFIX + canonical(metadata) + MARKDOWN_NARRATIVE + record.narrative;
  }
  if (byteLength(text) > MAX_DOCUMENT_BYTES) fail('The document is too large. Use a smaller record.');
  return text;
}
export function parseDocument(text, format) {
  checkFormat(format);
  if (byteLength(text) > MAX_DOCUMENT_BYTES) fail('The document is too large. Use a smaller import.');
  if (format === 'json') return strictJSON(text, MAX_DOCUMENT_BYTES);
  if (format === 'yaml') return yamlParse(text);
  if (!text.startsWith(MARKDOWN_PREFIX)) fail('Use the documented context Markdown profile.');
  const body = text.slice(MARKDOWN_PREFIX.length);
  const position = body.indexOf(MARKDOWN_NARRATIVE);
  if (position < 0) fail('Add the exact Narrative section after the metadata fence.');
  const record = strictJSON(body.slice(0, position), MAX_DOCUMENT_BYTES);
  if (!plainObject(record) || Object.hasOwn(record, 'narrative')) fail('Keep narrative only in the Narrative section.');
  Object.defineProperty(record, 'narrative', {value: body.slice(position + MARKDOWN_NARRATIVE.length),
    writable: true, enumerable: true, configurable: true});
  if (formatDocument(record, 'markdown') !== text) fail('Use canonical metadata in the Markdown profile.');
  return record;
}
