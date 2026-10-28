"""Typed knowledge records share exact review, format and dependency controls."""
import copy
import unittest

from .composable_formats import export_document, parse_document
from .composable_model import KIND_LAYERS, validate_record
from .context_pilot import ContextError, canonical
from . import test_composable_registry as registry_fixtures


def knowledge_record(identifier, kind, spec, evidence, dependencies=()):
    body = registry_fixtures.record(identifier, 'guidance', {}, evidence, dependencies)
    body.update(kind=kind, layer=KIND_LAYERS[kind], spec=copy.deepcopy(spec))
    return body


class KnowledgeTypesAcceptance(unittest.TestCase):
    setUp = registry_fixtures.ComposableRegistryAcceptance.setUp
    approved = registry_fixtures.ComposableRegistryAcceptance.approved

    def knowledge(self):
        return [
            knowledge_record('TERM_ORDER', 'term', {
                'definition': 'A submitted request for a product.', 'related_terms': []}, self.evidence),
            knowledge_record('EVENT_COMPLETED', 'event', {
                'trigger': 'The order status becomes completed.', 'time_field': 'completed_at',
                'entities': ['TERM_ORDER', 'DIM_PERIOD']}, self.evidence,
                [('TERM_ORDER', 1), ('DIM_PERIOD', 1)]),
            knowledge_record('DOC_ORDER_RULES', 'document', {
                'media_type': 'text/markdown', 'summary': 'A synthetic order process reference.',
                'related': ['EVENT_COMPLETED']}, self.evidence, [('EVENT_COMPLETED', 1)]),
            knowledge_record('POLICY_COMPLETED', 'policy', {
                'rule': 'Count completed orders only.', 'applies_to': ['TERM_ORDER', 'DOC_ORDER_RULES']},
                self.evidence, [('TERM_ORDER', 1), ('DOC_ORDER_RULES', 1)]),
        ]

    def test_all_four_layers_and_knowledge_types_keep_exact_format_semantics(self):
        for body in self.knowledge():
            body['narrative'] = 'Original evidence: café, 東京.\nKeep this qualifier.'
            normalized = validate_record(body)
            for format in ('json', 'yaml', 'markdown'):
                self.assertEqual(canonical(parse_document(export_document(body, format), format)),
                                 canonical(normalized))

    def test_published_typed_records_are_searchable_and_travel_with_guidance(self):
        items = self.records + self.knowledge()
        guidance = next(body for body in items if body['kind'] == 'guidance')
        guidance['dependencies'] = [{'id': 'POLICY_COMPLETED', 'version': 1}]
        self.approved(items)
        bundle = self.registry.resolve('reader', 'sales', 'MEASURE_NET', ['DIM_COUNTRY_AU', 'DIM_PERIOD_SEP'])
        ids = {item['record']['id'] for item in bundle['records']}
        self.assertTrue({'TERM_ORDER', 'EVENT_COMPLETED', 'DOC_ORDER_RULES', 'POLICY_COMPLETED'} <= ids)
        for body in self.knowledge():
            result = self.registry.search('reader', 'sales', body['id'], kind=body['kind'])
            self.assertEqual(result['results'][0]['id'], body['id'])

    def test_typed_relationships_reject_wrong_targets_at_publication(self):
        wrong = [
            knowledge_record('TERM_BAD', 'term', {'definition': 'A term.',
                'related_terms': ['DIM_PERIOD']}, self.evidence, [('DIM_PERIOD', 1)]),
            knowledge_record('EVENT_BAD', 'event', {'trigger': 'A state changes.',
                'time_field': 'changed_at', 'entities': ['GUIDE_SALES']}, self.evidence, [('GUIDE_SALES', 1)]),
        ]
        self.approved()
        for body in wrong:
            self.approved([body], publish=False)
            with self.assertRaises(ContextError):
                self.registry.publish('releaser', 'sales', [{'id': body['id'], 'version': 1}])
            self.assertIsNone(self.registry._selected('sales', body['id']))

    def test_named_types_require_review_and_current_provenance(self):
        body = self.knowledge()[0]
        self.registry.submit('author', body)
        with self.assertRaises(ContextError):
            self.registry.publish('releaser', 'sales', [{'id': body['id'], 'version': 1}])
        expected = self.registry.submit('author', body)
        self.registry.review('reviewer', 'sales', body['id'], 1, expected, 'approved')
        self.registry.publish('releaser', 'sales', [{'id': body['id'], 'version': 1}])
        self.assertEqual(self.registry.get_record('reader', 'sales', body['id'])['kind'], 'term')
        self.source.write_text('Changed source.', encoding='utf-8')
        with self.assertRaises(ContextError):
            self.registry.get_record('reader', 'sales', body['id'])

    def test_new_kind_filters_do_not_reveal_restricted_metadata(self):
        body = self.knowledge()[0]
        body['classification'] = 'restricted'
        with self.assertRaises(ContextError):
            self.registry.submit('author', body)
        for actor in ('author', 'reviewer', 'releaser'):
            self.people[actor]['classifications'].append('restricted')
        self.approved([body])
        with self.assertRaises(ContextError):
            self.registry.get_record('reader', 'sales', body['id'])
        result = self.registry.search('reader', 'sales', body['id'], kind='term')
        self.assertEqual(result['results'], [])

    def test_unknown_fields_missing_or_duplicate_refs_and_self_links_deny(self):
        for body in self.knowledge():
            unknown = copy.deepcopy(body); unknown['spec']['extra'] = 'unsupported'
            with self.assertRaises(ContextError): validate_record(unknown)
        term = self.knowledge()[0]
        for refs, dependencies in ((['TERM_OTHER'], []),
                                   (['TERM_ORDER'], [('TERM_ORDER', 1)]),
                                   (['TERM_OTHER', 'TERM_OTHER'], [('TERM_OTHER', 1)])):
            changed = copy.deepcopy(term)
            changed['spec']['related_terms'] = refs
            changed['dependencies'] = [{'id': key, 'version': version} for key, version in dependencies]
            with self.assertRaises(ContextError): validate_record(changed)
        policy = self.knowledge()[-1]
        policy['spec']['applies_to'] = []; policy['dependencies'] = []
        with self.assertRaises(ContextError): validate_record(policy)

    def test_policy_and_document_edges_still_reject_cycles(self):
        first = knowledge_record('POLICY_A', 'policy', {'rule': 'A rule.', 'applies_to': ['DOC_A']},
                                 self.evidence, [('DOC_A', 1)])
        second = knowledge_record('DOC_A', 'document', {'media_type': 'text/plain',
            'summary': 'A reference.', 'related': ['POLICY_A']}, self.evidence, [('POLICY_A', 1)])
        self.approved([first, second], publish=False)
        with self.assertRaises(ContextError):
            self.registry.publish('releaser', 'sales', [{'id': 'POLICY_A', 'version': 1}, {'id': 'DOC_A', 'version': 1}])


if __name__ == '__main__':
    unittest.main()
