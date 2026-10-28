"""Checkout portability and real YAML proposal admission, without approval."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from .composable_formats import parse_document
from .composable_registry import ComposableRegistry
from .context_pilot import ContextError, parse_time


class ComposableCheckoutTests(unittest.TestCase):
    def setUp(self):
        self.example = Path(__file__).resolve().parents[1] / 'examples' / 'composable'
        self.records = [parse_document(path.read_text(encoding='utf-8'), 'json')
                        for path in sorted((self.example / 'records').glob('*.json'))]

    def test_checkout_provenance_bytes_survive_platform_line_endings(self):
        self.assertEqual(len(self.records), 9)
        for record in self.records:
            for item in record['provenance']:
                raw = (self.example / 'sources' / item['path']).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), item['sha256'], record['id'])

    def test_human_yaml_batch_is_admitted_only_as_unapproved_proposals(self):
        yaml = (self.example / 'records' / 'M_GROSS_ADDS.yaml').read_text(encoding='utf-8')
        self.assertTrue(yaml.startswith('schema:') or '\nschema:' in yaml)
        replacement = parse_document(yaml, 'yaml')
        records = [replacement if record['id'] == replacement['id'] else record for record in self.records]
        people = json.loads((self.example / 'principals.json').read_text(encoding='utf-8'))
        source = next(record for record in records if record['kind'] == 'source')
        # Fixed fixture clock qualifies this historical proposal, not current data.
        moment = parse_time(source['spec']['checked_at'])
        with tempfile.TemporaryDirectory(prefix='prefrontal-checkout-') as scratch:
            with ComposableRegistry(Path(scratch) / 'registry.sqlite3', self.example / 'sources',
                                    people, clock=lambda: moment) as registry:
                hashes = registry.submit_batch('submitter', records)
                self.assertEqual(len(hashes), 9)
                self.assertEqual({row[0] for row in registry.db.execute('SELECT state FROM c_records')}, {'draft'})
                with self.assertRaises(ContextError):
                    registry.publish('releaser', 'composable-demo',
                                     [{'id': record['id'], 'version': record['version']} for record in records])


if __name__ == '__main__':
    unittest.main()
