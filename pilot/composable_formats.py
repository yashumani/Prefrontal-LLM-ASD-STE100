"""Deterministic lossless proposal documents for the composable record model.

JSON exports canonical JSON followed by LF. YAML is a bounded human-authoring
profile: two-space block mappings/sequences, identifier keys, JSON-doublequoted
strings, safe plain identifiers, exact decimal integers and true/false/null.
Full-line comments, one document marker pair and strip-chomp literal text (|-)
are supported. Ambiguous scalars, tabs, duplicate keys, tags, anchors, aliases,
merge keys, inline comments and arbitrary flow syntax deny. JSON documents and
empty JSON []/{} values remain supported. This is not a general YAML parser.

Markdown is an exact profile, not arbitrary Markdown extraction: one fixed title,
one canonical JSON metadata fence (all fields except narrative), then the exact
modeled narrative after a fixed section delimiter. No Markdown is rendered or
executed. Edits are proposals; formats contain no approval or release state.
"""
import json
import re

from .composable_model import (
    MAX_RECORD_BYTES, MAX_JSON_DEPTH, ContextError, canonical, strict_json, validate_record,
)

# Block-list indentation can be larger than compact JSON (e.g. thousands of
# one-character qualifiers). Keep authoring syntax bounded without excluding a
# valid canonical record's deterministic export.
MAX_DOCUMENT_BYTES = MAX_RECORD_BYTES * 4 + 4096
FORMATS = frozenset({'json', 'markdown', 'yaml'})
MARKDOWN_PREFIX = '# Prefrontal context record\n\n```json\n'
MARKDOWN_NARRATIVE = '\n```\n\n## Narrative\n\n'
_KEY = re.compile(r'[A-Za-z_][A-Za-z0-9_]*\Z')
_PLAIN = re.compile(r'[A-Za-z_][A-Za-z0-9_.:/-]*\Z')
_DECIMAL = re.compile(r'(?:0|-?[1-9][0-9]*)\Z')
_AMBIGUOUS = frozenset({'y', 'n', 'yes', 'no', 'on', 'off', 'true', 'false',
                         'null', 'nan', 'inf', 'infinity'})


def _yaml_error():
    raise ContextError('invalid_document')


def _yaml_printable(text):
    """YAML 1.2 printable characters; this profile uses LF line boundaries."""
    return all(char == '\n' or 0x20 <= ord(char) <= 0x7e or ord(char) == 0x85
               or 0xa0 <= ord(char) <= 0xd7ff or 0xe000 <= ord(char) <= 0xfffd
               or 0x10000 <= ord(char) <= 0x10ffff for char in text)


def _pair(text):
    """Split a mapping only at an unquoted colon followed by space or end."""
    quoted = escaped = False
    for index, char in enumerate(text):
        if quoted:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char == ':' and (index + 1 == len(text) or text[index + 1] == ' '):
            key = text[:index].strip()
            if not _KEY.fullmatch(key):
                _yaml_error()
            return key, text[index + 1:].strip()
    return None


def _yaml_scalar(text):
    if text.startswith('"'):
        value = strict_json(text, max_bytes=MAX_DOCUMENT_BYTES)
        if type(value) is not str:
            _yaml_error()
        return value
    if text in ('[]', '{}'):
        return [] if text == '[]' else {}
    if text in ('true', 'false', 'null'):
        return {'true': True, 'false': False, 'null': None}[text]
    if _DECIMAL.fullmatch(text):
        try:
            return int(text)
        except ValueError:
            _yaml_error()
    if (_PLAIN.fullmatch(text) and not text.endswith(':')
            and text.casefold() not in _AMBIGUOUS):
        return text
    _yaml_error()


class _YamlReader:
    """Small bounded grammar, never object construction or YAML coercion."""

    def __init__(self, text):
        text = text.replace('\r\n', '\n')
        if '\t' in text or '\r' in text:
            _yaml_error()
        self.lines = text.split('\n')

    def skip(self, index):
        while index < len(self.lines):
            line = self.lines[index]
            if line.strip() and not line.lstrip(' ').startswith('#'):
                break
            index += 1
        return index

    def line(self, index):
        raw = self.lines[index]
        indent = len(raw) - len(raw.lstrip(' '))
        if indent % 2:
            _yaml_error()
        return indent, raw[indent:].rstrip()

    def literal(self, index, indent):
        lines = []
        while index < len(self.lines):
            raw = self.lines[index]
            if not raw.strip():
                # Whitespace beyond the required block indentation is actual
                # narrative content, including on an otherwise blank line.
                lines.append(raw[indent:] if len(raw) >= indent else '')
                index += 1
                continue
            current = len(raw) - len(raw.lstrip(' '))
            if current < indent:
                break
            lines.append(raw[indent:])
            index += 1
        # YAML strip-chomping discards terminal line breaks. Quoted strings are
        # required when exact CRLF or trailing-newline content is intended.
        return '\n'.join(lines).rstrip('\n'), index

    def value(self, raw, next_index, indent, depth):
        if raw == '|-':
            return self.literal(next_index, indent + 2)
        if raw:
            return _yaml_scalar(raw), next_index
        child = self.skip(next_index)
        if child >= len(self.lines) or self.line(child)[0] != indent + 2:
            _yaml_error()  # No implicit empty/null values.
        return self.container(child, indent + 2, depth + 1)

    def mapping_item(self, result, text, next_index, indent, depth):
        item = _pair(text)
        if item is None:
            _yaml_error()
        key, raw = item
        if key in result:
            _yaml_error()
        result[key], next_index = self.value(raw, next_index, indent, depth)
        return next_index

    def container(self, index, indent, depth):
        if depth > MAX_JSON_DEPTH:
            _yaml_error()
        index = self.skip(index)
        if index >= len(self.lines) or self.line(index)[0] != indent:
            _yaml_error()
        sequence = self.line(index)[1] == '-' or self.line(index)[1].startswith('- ')
        result = [] if sequence else {}
        while True:
            index = self.skip(index)
            if index >= len(self.lines):
                break
            current, text = self.line(index)
            if current < indent or (indent == 0 and text == '...'):
                break
            if current != indent:
                _yaml_error()
            is_item = text == '-' or text.startswith('- ')
            if is_item != sequence:
                _yaml_error()
            if not sequence:
                index = self.mapping_item(result, text, index + 1, indent, depth)
                continue
            raw = text[1:].strip()
            pair = _pair(raw) if raw else None
            if pair is None:
                value, index = self.value(raw, index + 1, indent, depth)
            else:
                # A compact sequence mapping (`- id: VALUE`) continues at two
                # spaces past the dash; its nested values use four spaces.
                value = {}
                index = self.mapping_item(value, raw, index + 1, indent + 2, depth + 1)
                while True:
                    next_index = self.skip(index)
                    if next_index >= len(self.lines):
                        break
                    following, content = self.line(next_index)
                    if following < indent + 2:
                        break
                    if following != indent + 2:
                        _yaml_error()
                    index = self.mapping_item(value, content, next_index + 1, indent + 2, depth + 1)
            result.append(value)
        return result, index

    def read(self):
        first = self.skip(0)
        if first < len(self.lines) and self.lines[first] == '---':
            first = self.skip(first + 1)
        if first >= len(self.lines):
            _yaml_error()
        value, index = self.container(first, 0, 1)
        index = self.skip(index)
        if index < len(self.lines) and self.lines[index] == '...':
            index = self.skip(index + 1)
        if index != len(self.lines):
            _yaml_error()
        return value


def _yaml_parse(text):
    text = text.replace('\r\n', '\n')
    if not _yaml_printable(text):
        _yaml_error()
    if text.lstrip().startswith(('{', '[')):
        return strict_json(text, max_bytes=MAX_DOCUMENT_BYTES)
    return _YamlReader(text).read()


def _yaml_inline(value):
    return json.dumps(value, ensure_ascii=True, separators=(',', ':'), allow_nan=False)


def _yaml_lines(value, indent=0):
    pad, result = ' ' * indent, []
    if type(value) is dict:
        for key in sorted(value):
            child = value[key]
            if type(child) in (dict, list) and child:
                result.append(pad + key + ':')
                result.extend(_yaml_lines(child, indent + 2))
            elif (key == 'narrative' and type(child) is str and '\n' in child
                  and not child.endswith('\n') and _yaml_printable(child)):
                result.append(pad + key + ': |-')
                result.extend(pad + '  ' + line for line in child.split('\n'))
            else:
                result.append(pad + key + ': ' + _yaml_inline(child))
    else:
        for child in value:
            if type(child) is dict and child:
                nested = _yaml_lines(child, indent + 2)
                result.append(pad + '- ' + nested[0][indent + 2:])
                result.extend(nested[1:])
            elif type(child) is list and child:
                result.append(pad + '-')
                result.extend(_yaml_lines(child, indent + 2))
            else:
                result.append(pad + '- ' + _yaml_inline(child))
    return result


def _format(format):
    if type(format) is not str or format not in FORMATS:
        raise ContextError('unsupported_format')


def export_document(record, format):
    """Return a deterministic representation of one normalized proposal."""
    _format(format)
    body = validate_record(record)
    if format == 'json':
        text = canonical(body) + '\n'
    elif format == 'yaml':
        text = '\n'.join(_yaml_lines(body)) + '\n'
    else:
        narrative = body.pop('narrative')
        text = MARKDOWN_PREFIX + canonical(body) + MARKDOWN_NARRATIVE + narrative
    if len(text.encode('utf-8')) > MAX_DOCUMENT_BYTES:
        raise ContextError('invalid_document')
    return text


def parse_document(text, format):
    """Parse only the documented profile, preserving canonical record bytes."""
    _format(format)
    if type(text) is not str:
        raise ContextError('invalid_document')
    try:
        if len(text.encode('utf-8')) > MAX_DOCUMENT_BYTES:
            raise ContextError('invalid_document')
    except UnicodeError:
        raise ContextError('invalid_document') from None
    if format == 'json':
        return validate_record(strict_json(text, max_bytes=MAX_DOCUMENT_BYTES))
    if format == 'yaml':
        return validate_record(_yaml_parse(text))
    if not text.startswith(MARKDOWN_PREFIX):
        raise ContextError('invalid_document')
    metadata, delimiter, narrative = text[len(MARKDOWN_PREFIX):].partition(MARKDOWN_NARRATIVE)
    if not delimiter:
        raise ContextError('invalid_document')
    body = strict_json(metadata, max_bytes=MAX_DOCUMENT_BYTES)
    if type(body) is not dict or 'narrative' in body:
        raise ContextError('invalid_document')
    body['narrative'] = narrative
    record = validate_record(body)
    if export_document(record, 'markdown') != text:
        raise ContextError('invalid_document')
    return record
