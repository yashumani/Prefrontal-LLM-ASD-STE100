"""The browser bridge preserves evidence and stages proposals, never authority."""
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from . import browser_workspace as bridge
from . import test_composable_registry as registry_fixtures
from .composable_cli import CLI
from .composable_model import validate_record
from .context_pilot import ContextError, canonical, digest


TEXT = 'Synthetic original submission. Café and 東京.\r\nKeep this qualifier.\n'
SOURCE_PATH = 'submissions/original.txt'
EVIDENCE = {'path': SOURCE_PATH, 'sha256': hashlib.sha256(TEXT.encode('utf-8')).hexdigest()}
AT = '2026-10-21T00:00:00Z'


def workspace():
    bodies = [validate_record(body) for body in registry_fixtures.records(EVIDENCE)]
    return {'schema': bridge.WORKSPACE_SCHEMA, 'id': 'workspace-test', 'name': 'Synthetic test',
        'mode': 'user', 'revision': 1, 'records': bodies,
        'submissions': [{'path': SOURCE_PATH, 'text': TEXT, 'sha256': EVIDENCE['sha256'], 'format': 'form'}],
        'reviews': [{'id': bodies[0]['id'], 'version': 1, 'hash': digest(bodies[0]),
                     'reviewer': 'Local author', 'at': AT, 'decision': 'locally_attested'}],
        'trace': [{'at': AT, 'action': 'saved', 'details': {'records': len(bodies)}}],
        'created_at': AT, 'updated_at': AT}


def backup(state=None):
    state = workspace() if state is None else state
    return {'contract': bridge.BACKUP_CONTRACT, 'workspace': state, 'sha256': digest(state)}


def consumer():
    state = workspace()
    body = {'contract': bridge.CONSUMER_CONTRACT,
        'workspace': {key: state[key] for key in ('id', 'name', 'mode', 'revision')},
        'context_updated_at': state['updated_at'],
        'intent': {'measure': {'id': 'MEASURE_NET', 'version': 1}, 'roots': [], 'selectors': [
            {'dimension': 'DIM_COUNTRY', 'id': 'DIM_COUNTRY_AU', 'version': 1, 'value': 'AU'},
            {'dimension': 'DIM_PERIOD', 'id': 'DIM_PERIOD_SEP', 'version': 1, 'value': '2026-09'}]},
        'records': [{'record': record, 'hash': digest(record),
                     'local_review': {'status': 'not_reviewed', 'reviewer': None, 'hash': None}}
                    for record in state['records']],
        'provenance': [dict(EVIDENCE)], 'validation': dict(bridge._VALIDATION),
        'execution_authorized': False, 'recheck_at_use': True}
    body['bundle_hash'] = digest(body)
    return body


def rehash_consumer(body):
    body['bundle_hash'] = digest({key: value for key, value in body.items() if key != 'bundle_hash'})
    return body


class BrowserWorkspaceBridge(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[1] / '.validation' / 'browser-workspace-tests'
        root.mkdir(parents=True, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(dir=root)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def denied(self, document, code=None):
        with self.assertRaises(ContextError) as error:
            bridge.validate_export(canonical(document))
        if code is not None:
            self.assertEqual(error.exception.code, code)

    def test_inspection_checks_original_hashes_without_opening_registry_or_network(self):
        with patch.object(bridge.ComposableRegistry, '__init__', side_effect=AssertionError('No registry')), \
             patch('socket.create_connection', side_effect=AssertionError('No network')):
            result = bridge.validate_export(canonical(backup()))
        summary = result['summary']
        self.assertEqual(summary['record_count'], 7)
        self.assertEqual(summary['source_file_count'], 1)
        self.assertTrue(summary['provenance_files_complete'])
        self.assertFalse(summary['semantically_approved'])
        self.assertFalse(summary['execution_authorized'])
        self.assertEqual(result['submissions'][SOURCE_PATH]['text'], TEXT)

    def test_stage_preserves_original_bytes_and_real_cli_import_remains_draft(self):
        exported = canonical(backup())
        result = bridge.stage_export(exported, self.root / 'output', 'trusted-target')
        stage = Path(result['output_path'])
        self.assertEqual((stage / 'sources' / SOURCE_PATH).read_bytes(), TEXT.encode('utf-8'))
        self.assertEqual((stage / 'backup.json').read_bytes(), exported.encode('utf-8'))
        self.assertFalse(result['review_attestations_imported'])
        self.assertFalse(result['registry_modified'])
        proposals = json.loads((stage / result['proposal_batches'][0]).read_text(encoding='utf-8'))
        self.assertEqual(proposals, workspace()['records'])
        requests = (stage / 'import.requests.jsonl').read_text(encoding='utf-8').splitlines()
        self.assertEqual(json.loads(requests[0])['workspace'], 'trusted-target')
        principals = self.root / 'principals.json'
        principals.write_text(canonical({'author': {'workspace': 'trusted-target', 'roles': ['submitter'],
            'classifications': ['internal'], 'source_bindings': []}}), encoding='utf-8')
        port = CLI(self.root / 'context.sqlite3', stage / 'sources', principals, 'author')
        self.addCleanup(port.close)
        port.registry.clock = lambda: registry_fixtures.NOW
        response = port.execute_line(requests[0])
        self.assertTrue(response['ok'], response)
        self.assertEqual(response['result']['state'], 'proposal')
        states = port.registry.db.execute('SELECT state,reviewer FROM c_records').fetchall()
        self.assertEqual(len(states), 7)
        self.assertTrue(all(row['state'] == 'draft' and row['reviewer'] is None for row in states))
        self.assertEqual(port.registry.db.execute('SELECT count(*) FROM c_heads').fetchone()[0], 0)

    def test_missing_external_originals_are_explicit_not_fabricated(self):
        state = workspace(); state['submissions'] = []
        result = bridge.stage_export(canonical(backup(state)), self.root / 'output', 'target')
        self.assertFalse(result['provenance_files_complete'])
        self.assertEqual(result['missing_source_paths'], [SOURCE_PATH])
        self.assertEqual(list((Path(result['source_root'])).rglob('*')), [])

    def test_workspace_and_source_tampering_deny_stale_local_review_is_not_authority(self):
        document = backup(); document['workspace']['name'] = 'Changed'
        self.denied(document, 'workspace_hash_mismatch')
        state = workspace(); state['submissions'][0]['text'] = 'Forged'
        self.denied(backup(state), 'source_hash_mismatch')
        state = workspace(); state['records'][0]['description'] = 'Changed meaning'
        result = bridge.validate_export(canonical(backup(state)))['summary']
        self.assertEqual(result['stale_local_attestations'], 1)
        self.assertFalse(result['semantically_approved'])

    def test_duplicate_json_keys_floats_unsafe_integers_and_unknown_authority_deny(self):
        text = canonical(backup()).replace('"revision":1', '"revision":1,"revision":1')
        with self.assertRaises(ContextError): bridge.validate_export(text)
        for value in (1.0, 2 ** 53):
            state = workspace(); state['revision'] = value
            self.denied(backup(state))
        state = workspace(); state['approved'] = True
        self.denied(backup(state))
        document = backup(); document['approval'] = 'approved'
        self.denied(document)

    def test_records_must_be_canonically_normalized_and_exact_versions_are_immutable(self):
        state = workspace(); state['records'][1]['valid_from'] = '2026-01-01T00:00:00+00:00'
        self.denied(backup(state))
        state = workspace(); state['records'].append(copy.deepcopy(state['records'][1]))
        self.denied(backup(state))

    def test_missing_pins_wrong_typed_targets_and_cycles_deny(self):
        state = workspace(); state['records'] = [body for body in state['records'] if body['id'] != 'DIM_PERIOD']
        self.denied(backup(state), 'invalid_relationships')
        state = workspace()
        term = copy.deepcopy(state['records'][1]); term.update(id='TERM_BAD', kind='term',
            spec={'definition': 'A term.', 'related_terms': ['DIM_PERIOD']},
            dependencies=[{'id': 'DIM_PERIOD', 'version': 1}])
        state['records'].append(term)
        self.denied(backup(state))
        state = workspace(); guide = next(body for body in state['records'] if body['kind'] == 'guidance')
        guide['dependencies'] = [{'id': 'MEASURE_NET', 'version': 1}]
        self.denied(backup(state), 'invalid_relationships')

    def test_conflicting_pins_on_different_dependency_paths_deny(self):
        state = workspace(); state['reviews'] = []
        guide = next(body for body in state['records'] if body['kind'] == 'guidance')
        dimension = next(body for body in state['records'] if body['id'] == 'DIM_COUNTRY')
        second = copy.deepcopy(dimension); second['version'] = 2
        helper = copy.deepcopy(guide); helper.update(id='GUIDE_SECOND', dependencies=[{'id': 'DIM_COUNTRY', 'version': 2}])
        guide['dependencies'] = [{'id': 'DIM_COUNTRY', 'version': 1}, {'id': 'GUIDE_SECOND', 'version': 1}]
        state['records'].extend([second, helper])
        self.denied(backup(state), 'invalid_relationships')

    def test_unsafe_or_portably_ambiguous_source_paths_never_escape_output(self):
        for path in ('../escape.txt', 'CON', 'folder/name.', 'folder/a?.txt'):
            state = workspace(); state['reviews'] = []
            for record in state['records']: record['provenance'][0]['path'] = path
            state['submissions'][0]['path'] = path
            with self.assertRaises(ContextError):
                bridge.stage_export(canonical(backup(state)), self.root / 'output', 'target')
        self.assertFalse((self.root / 'escape.txt').exists())
        self.assertFalse((self.root / 'output').exists())
        state = workspace()
        second = copy.deepcopy(state['submissions'][0]); second['path'] = SOURCE_PATH.upper()
        state['submissions'].append(second)
        with self.assertRaises(ContextError):
            bridge.stage_export(canonical(backup(state)), self.root / 'output', 'target')

    def test_empty_workspace_stages_without_inventing_records(self):
        state = workspace()
        state.update(records=[], submissions=[], reviews=[], trace=[])
        result = bridge.stage_export(canonical(backup(state)), self.root / 'output', 'target')
        self.assertEqual(result['record_count'], 0)
        self.assertEqual(result['proposal_batches'], [])
        self.assertEqual(Path(result['import_requests']).read_bytes(), b'')

    def test_two_stages_preserve_existing_files_and_use_new_directories(self):
        output = self.root / 'output'; output.mkdir()
        marker = output / 'existing.txt'; marker.write_bytes(b'Keep this work.')
        first = bridge.stage_export(canonical(backup()), output, 'target')
        second = bridge.stage_export(canonical(backup()), output, 'target')
        self.assertNotEqual(first['output_path'], second['output_path'])
        self.assertEqual(marker.read_bytes(), b'Keep this work.')
        self.assertTrue(Path(first['output_path']).is_dir())

    def test_consumer_hashes_selector_contract_and_unverified_authority_are_checked(self):
        payload = consumer()
        summary = bridge.validate_export(canonical(payload))['summary']
        self.assertTrue(summary['relationships_valid'])
        self.assertFalse(summary['provenance_files_complete'])
        self.assertFalse(summary['execution_authorized'])
        payload['records'][0]['record']['description'] = 'Tampered'
        rehash_consumer(payload)
        self.denied(payload, 'record_hash_mismatch')
        payload = consumer(); payload['execution_authorized'] = True
        self.denied(rehash_consumer(payload), 'untrusted_authority')
        payload = consumer(); payload['validation']['semantic_approval'] = 'approved'
        self.denied(rehash_consumer(payload), 'untrusted_authority')
        payload = consumer(); payload['intent']['selectors'].pop()
        self.denied(rehash_consumer(payload), 'invalid_relationships')

    def test_consumer_requires_backup_to_stage_originals_and_rejects_extra_records(self):
        with self.assertRaises(ContextError) as error:
            bridge.stage_export(canonical(consumer()), self.root / 'output', 'target')
        self.assertEqual(error.exception.code, 'workspace_backup_required')
        self.assertFalse((self.root / 'output').exists())
        payload = consumer()
        extra = copy.deepcopy(payload['records'][1]); extra['record']['id'] = 'DIM_EXTRA'
        extra['hash'] = digest(extra['record']); payload['records'].append(extra)
        self.denied(rehash_consumer(payload), 'invalid_relationships')

    def test_cli_is_machine_readable_and_leaves_invalid_exports_unwritten(self):
        source = self.root / 'backup.json'; source.write_bytes(canonical(backup()).encode('utf-8'))
        stream = io.StringIO()
        with patch('sys.stdout', stream):
            status = bridge.main(['--input', str(source), '--validate-only'])
        self.assertEqual(status, 0)
        self.assertTrue(json.loads(stream.getvalue())['result']['structurally_valid'])
        source.write_bytes(b'{"duplicate":1,"duplicate":2}')
        stream = io.StringIO()
        with patch('sys.stdout', stream):
            status = bridge.main(['--input', str(source), '--output-root', str(self.root / 'output'), '--workspace', 'target'])
        self.assertEqual(status, 1)
        self.assertFalse(json.loads(stream.getvalue())['ok'])
        self.assertFalse((self.root / 'output').exists())

    def test_record_count_and_long_dependency_path_limits_deny_without_truncation(self):
        state = workspace(); state.update(records=[], reviews=[])
        template = validate_record(registry_fixtures.records(EVIDENCE)[1])
        for number in range(bridge.MAX_RECORDS + 1):
            body = copy.deepcopy(template); body['id'] = 'DIM_%04d' % number
            state['records'].append(body)
        self.denied(backup(state))
        state = workspace(); state.update(records=[], reviews=[])
        guide = validate_record(registry_fixtures.records(EVIDENCE)[3])
        for number in range(bridge.MAX_DEPTH + 2):
            body = copy.deepcopy(guide); body['id'] = 'GUIDE_%02d' % number
            body['dependencies'] = [] if number == bridge.MAX_DEPTH + 1 else [{'id': 'GUIDE_%02d' % (number + 1), 'version': 1}]
            state['records'].append(body)
        self.denied(backup(state), 'invalid_relationships')


if __name__ == '__main__':
    unittest.main()
