"""Strict structural schema for composable context; no approval or source IO.

Validation normalizes aware timestamps to UTC and returns an independent JSON
object. Descriptions and narrative remain inert reviewed text. Cross-record
meaning, current permissions, source truth and approval belong to the registry
and resolver, not this structural validator.
"""
import json
import math
import re
from datetime import datetime, timezone

from .context_pilot import ContextError, canonical, digest

SCHEMA = 'prefrontal.context.v1'
MAX_RECORD_BYTES = 65536
MAX_DIRECT_DEPENDENCIES = 32
MAX_DEPTH = 16
MAX_CLOSURE_RECORDS = 128
MAX_BUNDLE_BYTES = 1048576
MAX_BATCH_RECORDS = 256
MAX_JSON_DEPTH = MAX_DEPTH
MAX_INTEGER = 2 ** 63 - 1
LAYERS = frozenset({'data', 'metric', 'ontology', 'interpretation'})
CLASSIFICATIONS = frozenset({'internal', 'restricted'})
KIND_LAYERS = {'source': 'data', 'measure': 'metric', 'dimension': 'ontology',
               'member': 'ontology', 'guidance': 'interpretation',
               'term': 'ontology', 'event': 'ontology',
               'policy': 'interpretation', 'document': 'data'}
RECORD_FIELDS = frozenset({'schema', 'id', 'version', 'layer', 'kind', 'name',
                           'aliases', 'description', 'narrative', 'owner',
                           'classification', 'valid_from', 'valid_until',
                           'provenance', 'dependencies', 'spec'})
SPEC_FIELDS = {
    'source': frozenset({'binding', 'grain', 'freshness_seconds', 'checked_at', 'dimensions'}),
    'measure': frozenset({'source', 'aggregation', 'expression', 'required_dimensions',
                          'optional_dimensions', 'guidance'}),
    'dimension': frozenset({'value_type'}),
    'member': frozenset({'dimension', 'value', 'parents'}),
    'guidance': frozenset({'qualifiers', 'caveats'}),
    'term': frozenset({'definition', 'related_terms'}),
    'event': frozenset({'trigger', 'time_field', 'entities'}),
    'policy': frozenset({'rule', 'applies_to'}),
    'document': frozenset({'media_type', 'summary', 'related'}),
}
_ID = re.compile(r'[A-Z][A-Z0-9_]{1,95}\Z')
_HASH = re.compile(r'[a-f0-9]{64}\Z')
_COLUMN = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,63}\Z')
_BINDING = re.compile(r'[A-Za-z][A-Za-z0-9_.:-]{0,127}\Z')
_TIME = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
                   r'(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)\Z')


def _fail(code='invalid_record'):
    raise ContextError(code)


def _json_value(value, depth=0, ancestors=None, code='invalid_record'):
    """Reject non-JSON objects, invalid Unicode, cycles and unbounded nesting."""
    if depth > MAX_JSON_DEPTH:
        _fail(code)
    if value is None or type(value) in (bool, int):
        return
    if type(value) is float:
        if not math.isfinite(value):
            _fail(code)
        return
    if type(value) is str:
        try:
            value.encode('utf-8')
        except UnicodeError:
            _fail(code)
        return
    if type(value) not in (dict, list):
        _fail(code)
    ancestors = set() if ancestors is None else ancestors
    identity = id(value)
    if identity in ancestors:
        _fail(code)
    ancestors.add(identity)
    try:
        if type(value) is dict:
            for key, child in value.items():
                if type(key) is not str:
                    _fail(code)
                _json_value(key, depth, ancestors, code)
                _json_value(child, depth + 1, ancestors, code)
        else:
            for child in value:
                _json_value(child, depth + 1, ancestors, code)
    finally:
        ancestors.remove(identity)


def strict_json(text, max_bytes=MAX_RECORD_BYTES):
    """Read bounded strict JSON: duplicate keys, coercions and nonfinite deny.

    The YAML document profile in composable_formats reuses this for explicit
    JSON scalars and JSON-compatible documents. This helper itself is JSON only.
    """
    if type(text) is not str or type(max_bytes) is not int or max_bytes < 1:
        _fail('invalid_document')
    try:
        if len(text.encode('utf-8')) > max_bytes:
            _fail('invalid_document')
    except UnicodeError:
        _fail('invalid_document')
    # Bound the parser's work before json.loads can recurse. Quoted braces and
    # escaped quotes are data and do not contribute to structural depth.
    level, quoted, escaped = 0, False, False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in '[{':
            level += 1
            if level > MAX_JSON_DEPTH:
                _fail('invalid_document')
        elif char in ']}':
            level -= 1
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                _fail('invalid_document')
            result[key] = value
        return result
    def constant(_):
        _fail('invalid_document')
    try:
        value = json.loads(text, object_pairs_hook=pairs, parse_constant=constant)
        _json_value(value, code='invalid_document')
        return value
    except (ValueError, TypeError, UnicodeError, RecursionError, OverflowError):
        _fail('invalid_document')


def _text(value, maximum=MAX_RECORD_BYTES):
    if type(value) is not str or not value.strip() or len(value) > maximum:
        _fail()
    return value


def _id(value):
    if type(value) is not str or not _ID.fullmatch(value):
        _fail()
    return value


def _integer(value):
    if type(value) is not int or not 1 <= value <= MAX_INTEGER:
        _fail()
    return value


def _texts(values, *, nonempty=False, ids=False, folded=False):
    if type(values) is not list or (nonempty and not values):
        _fail()
    for value in values:
        (_id if ids else _text)(value)
    comparison = [v.casefold() for v in values] if folded else values
    if (ids or folded) and len(set(comparison)) != len(comparison):
        _fail()
    return values


def _time(value):
    if type(value) is not str or not _TIME.fullmatch(value):
        _fail()
    try:
        instant = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if instant.tzinfo is None or instant.utcoffset() is None:
            _fail()
        return instant.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
    except (ValueError, OverflowError):
        _fail()


def _provenance(values):
    if type(values) is not list or not values:
        _fail()
    paths = set()
    for entry in values:
        if type(entry) is not dict or set(entry) != {'path', 'sha256'}:
            _fail()
        path, sha = entry['path'], entry['sha256']
        if (type(path) is not str or not path or len(path) > 512
                or path.startswith('/') or '\\' in path or ':' in path
                or any(ord(char) < 32 or ord(char) == 127 for char in path)
                or any(part in ('', '.', '..') or part != part.strip() or len(part) > 128
                       for part in path.split('/'))
                or path in paths or type(sha) is not str or not _HASH.fullmatch(sha)):
            _fail()
        paths.add(path)


def _dependencies(values):
    if type(values) is not list or len(values) > MAX_DIRECT_DEPENDENCIES:
        _fail()
    ids = set()
    for entry in values:
        if type(entry) is not dict or set(entry) != {'id', 'version'}:
            _fail()
        _id(entry['id'])
        _integer(entry['version'])
        if entry['id'] in ids:
            _fail()
        ids.add(entry['id'])
    return ids


def _spec(kind, spec):
    if type(spec) is not dict or set(spec) != SPEC_FIELDS[kind]:
        _fail()
    refs = set()
    if kind == 'source':
        if type(spec['binding']) is not str or not _BINDING.fullmatch(spec['binding']):
            _fail()
        _integer(spec['freshness_seconds'])
        _texts(spec['grain'], nonempty=True)
        if (len(set(spec['grain'])) != len(spec['grain'])
                or any(not _COLUMN.fullmatch(value) for value in spec['grain'])):
            _fail()
        spec['checked_at'] = _time(spec['checked_at'])
        dimensions = spec['dimensions']
        if type(dimensions) is not dict:
            _fail()
        for dimension, column in dimensions.items():
            _id(dimension)
            if type(column) is not str or not _COLUMN.fullmatch(column):
                _fail()
        # Source mappings describe native bindings. They are deliberately not
        # dependency edges, avoiding source/dimension/member cycles.
    elif kind == 'measure':
        refs.add(_id(spec['source']))
        if spec['aggregation'] not in ('sum', 'count', 'average'):
            _fail()
        _text(spec['expression'])
        for field in ('required_dimensions', 'optional_dimensions', 'guidance'):
            _texts(spec[field], ids=True)
            if refs.intersection(spec[field]):
                _fail()
            refs.update(spec[field])
    elif kind == 'dimension':
        if spec['value_type'] not in ('text', 'period', 'integer'):
            _fail()
    elif kind == 'member':
        refs.add(_id(spec['dimension']))
        _texts(spec['parents'], ids=True)
        if refs.intersection(spec['parents']):
            _fail()
        refs.update(spec['parents'])
        if type(spec['value']) is str:
            _text(spec['value'])
        elif type(spec['value']) is not int:
            _fail()
        # The referenced dimension establishes text/period/integer semantics at
        # resolution. A member alone cannot establish that cross-record fact.
    elif kind == 'guidance':
        _texts(spec['qualifiers'], nonempty=True)
        _texts(spec['caveats'], nonempty=True)
    elif kind == 'term':
        _text(spec['definition'])
        refs.update(_texts(spec['related_terms'], ids=True))
    elif kind == 'event':
        _text(spec['trigger'])
        if type(spec['time_field']) is not str or not _COLUMN.fullmatch(spec['time_field']):
            _fail()
        refs.update(_texts(spec['entities'], ids=True))
    elif kind == 'policy':
        _text(spec['rule'])
        refs.update(_texts(spec['applies_to'], nonempty=True, ids=True))
    elif kind == 'document':
        if spec['media_type'] not in ('text/plain', 'text/markdown', 'application/json', 'application/yaml'):
            _fail()
        _text(spec['summary'])
        refs.update(_texts(spec['related'], ids=True))
    return refs


def validate_record(record):
    """Validate one proposal record, returning canonical normalized JSON data.

    Approval, workspace, release, reviewer and generated-answer fields are not
    part of this model. This function never imports lifecycle authority.
    """
    try:
        _json_value(record)
        if type(record) is not dict or set(record) != RECORD_FIELDS:
            _fail()
        # Bound canonical bytes before taking an independent JSON copy.
        encoded = canonical(record)
        if len(encoded.encode('utf-8')) > MAX_RECORD_BYTES:
            _fail()
        body = json.loads(encoded)
        if body['schema'] != SCHEMA:
            _fail()
        _id(body['id'])
        _integer(body['version'])
        if (type(body['kind']) is not str or body['kind'] not in KIND_LAYERS
                or body['layer'] != KIND_LAYERS[body['kind']]
                or body['classification'] not in CLASSIFICATIONS):
            _fail()
        for field in ('name', 'description', 'narrative'):
            _text(body[field])
        _text(body['owner'], maximum=128)
        _texts(body['aliases'], folded=True)
        body['valid_from'] = _time(body['valid_from'])
        if body['valid_until'] is not None:
            body['valid_until'] = _time(body['valid_until'])
            start = datetime.fromisoformat(body['valid_from'].replace('Z', '+00:00'))
            until = datetime.fromisoformat(body['valid_until'].replace('Z', '+00:00'))
            if until <= start:
                _fail()
        _provenance(body['provenance'])
        dependencies = _dependencies(body['dependencies'])
        if body['id'] in dependencies:
            _fail()
        refs = _spec(body['kind'], body['spec'])
        if body['kind'] == 'member':
            prefix = body['spec']['dimension'] + '_'
            if not body['id'].startswith(prefix) or len(body['id']) == len(prefix):
                _fail()
        if body['kind'] != 'guidance' and dependencies != refs:
            _fail()
        if len(canonical(body).encode('utf-8')) > MAX_RECORD_BYTES:
            _fail()
        return body
    except (TypeError, ValueError, KeyError, UnicodeError, RecursionError, OverflowError):
        _fail()
