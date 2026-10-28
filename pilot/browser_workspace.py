"""Validate browser exports and stage proposals without importing authority.

This is a local file adapter, not a server, connector, reviewer or source query
executor. Browser attestations and checksums identify local evidence only. The
governed registry must independently admit, review, publish and revalidate it.
"""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import tempfile
import uuid

from .composable_model import (
    MAX_BATCH_RECORDS, MAX_BUNDLE_BYTES, MAX_CLOSURE_RECORDS, MAX_DEPTH,
    _provenance, _time, strict_json, validate_record,
)
from .composable_registry import ComposableRegistry
from .context_pilot import ContextError, canonical, digest


BACKUP_CONTRACT = 'prefrontal.workspace.backup.v1'
WORKSPACE_SCHEMA = 'prefrontal.workspace.v1'
CONSUMER_CONTRACT = 'prefrontal.browser.consumer.v1'
ADAPTER_CONTRACT = 'prefrontal.browser.proposal-stage.v1'
MAX_WORKSPACE_BYTES = 2 * 1024 * 1024
MAX_EXPORT_BYTES = MAX_WORKSPACE_BYTES + 4096
MAX_RECORDS = 1000
MAX_TRACE = 4096
MAX_SAFE_INTEGER = 2 ** 53 - 1
_HASH = re.compile(r'[a-f0-9]{64}\Z')
_ID = re.compile(r'[A-Z][A-Z0-9_]{1,95}\Z')
_WORKSPACE_ID = re.compile(r'[A-Za-z0-9_-]{1,100}\Z')
_WORKSPACE_FIELDS = {'schema', 'id', 'name', 'mode', 'revision', 'records',
                     'submissions', 'reviews', 'trace', 'created_at', 'updated_at'}
_VALIDATION = {'structural': 'valid', 'relationships': 'valid',
               'semantic_approval': 'not_verified', 'authority': 'browser_local_unverified',
               'source_access': 'disconnected', 'evaluation': 'not_evaluated'}


def _deny(code='invalid_browser_export'):
    raise ContextError(code)


def _fields(value, expected):
    if type(value) is not dict or set(value) != set(expected):
        _deny()


def _text(value, maximum=65536, empty=False):
    if type(value) is not str or len(value) > maximum or (not empty and not value.strip()):
        _deny()
    return value


def _integer(value, minimum=0):
    if type(value) is not int or not minimum <= value <= MAX_SAFE_INTEGER:
        _deny()
    return value


def _safe_numbers(value):
    """Browser interchange has exact integers only; never round a JSON value."""
    if type(value) is float or type(value) is int and abs(value) > MAX_SAFE_INTEGER:
        _deny()
    if type(value) is dict:
        for item in value.values():
            _safe_numbers(item)
    elif type(value) is list:
        for item in value:
            _safe_numbers(item)


def _hash(value):
    if type(value) is not str or not _HASH.fullmatch(value):
        _deny()
    return value


def _time_string(value):
    _time(value)  # Validate the same aware calendar syntax without changing raw hash input.
    return value


def _reference(value):
    _fields(value, {'id', 'version'})
    if type(value['id']) is not str or not _ID.fullmatch(value['id']):
        _deny()
    _integer(value['version'], 1)
    return value['id'], value['version']


def validate_records(records):
    """Check proposals and every exact dependency closure, without source IO."""
    if type(records) is not list or len(records) > MAX_RECORDS:
        _deny()
    bodies = [validate_record(body) for body in records]
    by_key, identity_kinds = {}, {}
    for original, body in zip(records, bodies):
        # Browser record hashes must name precisely the core's normalized body.
        if canonical(original) != canonical(body):
            _deny()
        key = body['id'], body['version']
        if key in by_key:
            _deny()
        prior_kind = identity_kinds.setdefault(body['id'], body['kind'])
        if prior_kind != body['kind']:
            _deny()
        by_key[key] = body
    for root in bodies:
        found, visiting, versions, depths = {}, set(), {}, {}
        total_bytes = [0]

        def visit(identifier, version, depth):
            key = identifier, version
            if depth > MAX_DEPTH or key in visiting:
                _deny('invalid_relationships')
            if identifier in versions and versions[identifier] != version:
                _deny('invalid_relationships')
            versions[identifier] = version
            if key in depths:
                if depth + depths[key] > MAX_DEPTH:
                    _deny('invalid_relationships')
                return depths[key]
            body = by_key.get(key)
            if body is None:
                _deny('invalid_relationships')
            found[key] = {'record': body}
            total_bytes[0] += len(canonical(body).encode('utf-8'))
            if len(found) > MAX_CLOSURE_RECORDS or total_bytes[0] > MAX_BUNDLE_BYTES:
                _deny('invalid_relationships')
            visiting.add(key)
            longest = 0
            for dependency in body['dependencies']:
                longest = max(longest, 1 + visit(dependency['id'], dependency['version'], depth + 1))
            visiting.remove(key)
            ComposableRegistry._compatible(body, found)
            depths[key] = longest
            return longest

        visit(root['id'], root['version'], 0)
    return bodies


def _submissions(values):
    if type(values) is not list or len(values) > MAX_RECORDS:
        _deny()
    found = {}
    for item in values:
        _fields(item, {'path', 'text', 'sha256', 'format'})
        _provenance([{'path': item['path'], 'sha256': item['sha256']}])
        _text(item['text'], maximum=MAX_WORKSPACE_BYTES, empty=True)
        if item['format'] not in ('form', 'json', 'yaml', 'markdown') or item['path'] in found:
            _deny()
        if hashlib.sha256(item['text'].encode('utf-8')).hexdigest() != item['sha256']:
            _deny('source_hash_mismatch')
        found[item['path']] = item
    return found


def _review(values, records):
    if type(values) is not list or len(values) > MAX_RECORDS:
        _deny()
    found = {(body['id'], body['version']): body for body in records}
    seen = set()
    for item in values:
        _fields(item, {'id', 'version', 'hash', 'reviewer', 'at', 'decision'})
        key = _reference({'id': item['id'], 'version': item['version']})
        _text(item['reviewer'], maximum=128)
        _time_string(item['at'])
        if item['decision'] != 'locally_attested' or key not in found or key in seen:
            _deny('invalid_local_attestation')
        _hash(item['hash']); seen.add(key)


def _workspace(state):
    _fields(state, _WORKSPACE_FIELDS)
    if (state['schema'] != WORKSPACE_SCHEMA or state['mode'] not in ('user', 'demo')
            or len(canonical(state).encode('utf-8')) > MAX_WORKSPACE_BYTES):
        _deny()
    if type(state['id']) is not str or not _WORKSPACE_ID.fullmatch(state['id']):
        _deny()
    _text(state['name'], maximum=128)
    _integer(state['revision'])
    _time_string(state['created_at']); _time_string(state['updated_at'])
    if datetime.fromisoformat(state['updated_at'].replace('Z', '+00:00')) < datetime.fromisoformat(state['created_at'].replace('Z', '+00:00')):
        _deny()
    records = validate_records(state['records'])
    submissions = _submissions(state['submissions'])
    _review(state['reviews'], records)
    if type(state['trace']) is not list or len(state['trace']) > MAX_TRACE:
        _deny()
    for event in state['trace']:
        _fields(event, {'at', 'action', 'details'})
        _time_string(event['at'])
        _text(event['action'], maximum=80)
        if type(event['details']) is not dict:
            _deny()
    missing = set()
    for body in records:
        for evidence in body['provenance']:
            source = submissions.get(evidence['path'])
            if source is None:
                missing.add(evidence['path'])
            elif source['sha256'] != evidence['sha256']:
                _deny('source_hash_mismatch')
    return records, submissions, sorted(missing)


def _consumer(body):
    _fields(body, {'contract', 'workspace', 'context_updated_at', 'intent', 'records',
                  'provenance', 'validation', 'execution_authorized', 'recheck_at_use', 'bundle_hash'})
    _fields(body['workspace'], {'id', 'name', 'mode', 'revision'})
    _text(body['workspace']['id'], maximum=128)
    _text(body['workspace']['name'], maximum=128)
    _integer(body['workspace']['revision'])
    if body['workspace']['mode'] not in ('user', 'demo'):
        _deny()
    _time_string(body['context_updated_at'])
    if (body['execution_authorized'] is not False or body['recheck_at_use'] is not True
            or body['validation'] != _VALIDATION or len(canonical(body).encode('utf-8')) > MAX_BUNDLE_BYTES):
        _deny('untrusted_authority')
    unsigned = {key: value for key, value in body.items() if key != 'bundle_hash'}
    if _hash(body['bundle_hash']) != digest(unsigned):
        _deny('bundle_hash_mismatch')
    if type(body['records']) is not list or not 1 <= len(body['records']) <= MAX_CLOSURE_RECORDS:
        _deny()
    records = []
    for envelope in body['records']:
        _fields(envelope, {'record', 'hash', 'local_review'})
        record = validate_record(envelope['record'])
        if _hash(envelope['hash']) != digest(record):
            _deny('record_hash_mismatch')
        review = envelope['local_review']
        if type(review) is not dict or review.get('status') not in ('not_reviewed', 'local_attested', 'stale'):
            _deny()
        # These fields describe untrusted local evidence, never registry review.
        if review['status'] == 'not_reviewed':
            _fields(review, {'status', 'reviewer', 'hash'})
            if review['reviewer'] is not None or review['hash'] is not None:
                _deny('invalid_local_attestation')
        else:
            _fields(review, {'status', 'reviewer', 'hash', 'at', 'authority'})
            _text(review['reviewer'], maximum=128)
            _time_string(review['at']); _hash(review['hash'])
            if review['authority'] != 'unverified_local_attestation':
                _deny('untrusted_authority')
            if review['status'] == 'local_attested' and review['hash'] != envelope['hash']:
                _deny('invalid_local_attestation')
        records.append(envelope['record'])
    records = validate_records(records)
    found = {(record['id'], record['version']): record for record in records}
    by_id = {record['id']: record for record in records}
    if len(by_id) != len(records):
        _deny('invalid_relationships')
    _fields(body['intent'], {'measure', 'selectors', 'roots'})
    intent = body['intent']
    roots = []
    if type(intent['roots']) is not list or len(intent['roots']) > MAX_CLOSURE_RECORDS:
        _deny()
    for root in intent['roots']:
        key = _reference(root)
        if key not in found or key in roots:
            _deny('invalid_relationships')
        roots.append(key)
    metric = None
    if intent['measure'] is not None:
        key = _reference(intent['measure'])
        metric = found.get(key)
        if metric is None or metric['kind'] != 'measure':
            _deny('invalid_relationships')
        roots.append(key)
    if type(intent['selectors']) is not list or len(intent['selectors']) > 32:
        _deny()
    selected = set()
    for selector in intent['selectors']:
        _fields(selector, {'dimension', 'id', 'version', 'value'})
        key = _reference({'id': selector['id'], 'version': selector['version']})
        member = found.get(key)
        dimension = selector['dimension']
        if (metric is None or member is None or member['kind'] != 'member'
                or member['spec']['dimension'] != dimension or dimension in selected
                or member['spec']['value'] != selector['value']
                or dimension not in metric['spec']['required_dimensions'] + metric['spec']['optional_dimensions']):
            _deny('invalid_relationships')
        selected.add(dimension); roots.append(key)
    if metric is not None and not set(metric['spec']['required_dimensions']) <= selected:
        _deny('invalid_relationships')
    if not roots:
        _deny('invalid_relationships')
    reached = set()
    def visit(key):
        if key in reached: return
        reached.add(key)
        for dependency in found[key]['dependencies']:
            visit((dependency['id'], dependency['version']))
    for key in roots: visit(key)
    if reached != set(found):
        _deny('invalid_relationships')
    _provenance(body['provenance'])
    expected = {(item['path'], item['sha256']) for record in records for item in record['provenance']}
    actual = {(item['path'], item['sha256']) for item in body['provenance']}
    if expected != actual:
        _deny('source_hash_mismatch')
    return records, {}, sorted({path for path, _ in expected})


def validate_export(text):
    """Return an inspection; it never promotes browser claims to authority."""
    try:
        document = strict_json(text, max_bytes=MAX_EXPORT_BYTES)
        _safe_numbers(document)
        if type(document) is not dict:
            _deny()
        if document.get('contract') == BACKUP_CONTRACT:
            _fields(document, {'contract', 'workspace', 'sha256'})
            if _hash(document['sha256']) != digest(document['workspace']):
                _deny('workspace_hash_mismatch')
            records, submissions, missing = _workspace(document['workspace'])
            reviews = len(document['workspace']['reviews'])
            hashes = {(body['id'], body['version']): digest(body) for body in records}
            stale_reviews = sum(item['hash'] != hashes[(item['id'], item['version'])]
                                for item in document['workspace']['reviews'])
        elif document.get('contract') == CONSUMER_CONTRACT:
            records, submissions, missing = _consumer(document)
            reviews = sum(envelope['local_review']['status'] == 'local_attested' for envelope in document['records'])
            stale_reviews = sum(envelope['local_review']['status'] == 'stale' for envelope in document['records'])
        else:
            _deny()
        return {'document': document, 'records': records, 'submissions': submissions,
                'summary': {'contract': ADAPTER_CONTRACT, 'input_contract': document['contract'],
                    'structurally_valid': True, 'relationships_valid': True,
                    'semantically_approved': False, 'execution_authorized': False,
                    'approval_state': 'pending_independent_review', 'source_access': 'disconnected',
                    'record_count': len(records), 'source_file_count': len(submissions),
                    'provenance_files_complete': not missing, 'missing_source_paths': missing,
                    'untrusted_local_attestations': reviews,
                    'stale_local_attestations': stale_reviews, 'model_calls': 0, 'network_calls': 0}}
    except ContextError:
        raise
    except (KeyError, TypeError, ValueError, OverflowError, RecursionError, UnicodeError):
        _deny()


def _portable_paths(submissions):
    """Refuse paths that could alias or address devices on Windows."""
    seen = set()
    reserved = {'CON', 'PRN', 'AUX', 'NUL'} | {'COM' + str(n) for n in range(1, 10)} | {'LPT' + str(n) for n in range(1, 10)}
    for path in submissions:
        folded = path.casefold()
        if folded in seen:
            _deny('unsupported_source_path')
        seen.add(folded)
        for part in path.split('/'):
            if part.endswith('.') or any(char in '<>"|?*' for char in part) or part.split('.')[0].upper() in reserved:
                _deny('unsupported_source_path')


def stage_export(text, output_root, workspace):
    """Create a new proposal stage only; never open a registry or overwrite work."""
    inspected = validate_export(text)
    if inspected['document']['contract'] != BACKUP_CONTRACT:
        _deny('workspace_backup_required')
    _text(workspace, maximum=100)
    if any(ord(char) < 32 for char in workspace):
        _deny()
    _portable_paths(inspected['submissions'])
    parent = Path(output_root).resolve()
    parent.mkdir(parents=True, exist_ok=True)
    name = 'stage-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + uuid.uuid4().hex[:8]
    target = parent / name
    # Only a uniquely created child of the explicit output root is temporary.
    with tempfile.TemporaryDirectory(prefix='.proposal-stage-', dir=parent) as scratch:
        stage = Path(scratch).resolve()
        if stage.parent != parent:
            _deny('storage_unavailable')
        sources = stage / 'sources'; sources.mkdir()
        for path, item in inspected['submissions'].items():
            output = sources.joinpath(*path.split('/'))
            output.parent.mkdir(parents=True, exist_ok=True)
            with output.open('xb') as stream:
                stream.write(item['text'].encode('utf-8'))
        proposals = stage / 'proposals'; proposals.mkdir()
        requests, parts = [], []
        for offset in range(0, len(inspected['records']), MAX_BATCH_RECORDS):
            batch = inspected['records'][offset:offset + MAX_BATCH_RECORDS]
            part = 'part-%04d.json' % (len(parts) + 1)
            (proposals / part).write_bytes((canonical(batch) + '\n').encode('utf-8'))
            parts.append('proposals/' + part)
            requests.append(canonical({'operation': 'record.importbatch', 'workspace': workspace,
                'documents': [{'format': 'json', 'document': canonical(body) + '\n'} for body in batch]}))
        (stage / 'import.requests.jsonl').write_bytes(''.join(line + '\n' for line in requests).encode('utf-8'))
        (stage / 'backup.json').write_bytes(text.encode('utf-8'))
        summary = copy.deepcopy(inspected['summary'])
        summary.update({'output_path': str(target), 'target_workspace': workspace,
                        'source_root': str(target / 'sources'), 'proposal_batches': parts,
                        'import_requests': str(target / 'import.requests.jsonl'),
                        'review_attestations_imported': False, 'registry_modified': False})
        (stage / 'manifest.json').write_bytes((canonical(summary) + '\n').encode('utf-8'))
        stage.rename(target)
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description='Validate a browser export or stage local proposals. This command does not approve or execute context.')
    parser.add_argument('--input', required=True, help='Workspace backup or browser consumer JSON file.')
    parser.add_argument('--validate-only', action='store_true', help='Inspect without writing files.')
    parser.add_argument('--output-root', help='Parent for a new unique proposal stage; requires a workspace backup.')
    parser.add_argument('--workspace', help='Trusted target workspace name for future import requests.')
    args = parser.parse_args(argv)
    if args.validate_only and (args.output_root or args.workspace) or not args.validate_only and not (args.output_root and args.workspace):
        parser.error('Use --validate-only, or use both --output-root and --workspace.')
    try:
        with Path(args.input).open('rb') as stream:
            raw = stream.read(MAX_EXPORT_BYTES + 1)
        text = raw.decode('utf-8')
        result = validate_export(text)['summary'] if args.validate_only else stage_export(text, args.output_root, args.workspace)
        print(json.dumps({'ok': True, 'result': result}, sort_keys=True))
        return 0
    except (ContextError, OSError, UnicodeError) as error:
        code = error.code if isinstance(error, ContextError) else 'export_or_storage_unavailable'
        print(json.dumps({'ok': False, 'error': {'code': code,
            'message': 'Cannot process this export. Keep the original file and check its format, hashes, references and output location.'}}, sort_keys=True))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
