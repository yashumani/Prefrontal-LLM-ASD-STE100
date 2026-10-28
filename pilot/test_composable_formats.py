"""Canonical composable records and lossless proposal-document profiles."""
import copy
import importlib.util
import json
import unittest

MODEL = None
FORMATS = None
if importlib.util.find_spec('pilot.composable_model'):
    from pilot import composable_model as MODEL
if importlib.util.find_spec('pilot.composable_formats'):
    from pilot import composable_formats as FORMATS


def example(kind='guidance'):
    record = {
        'schema': 'prefrontal.context.v1', 'id': 'SALES_GUIDANCE', 'version': 1,
        'layer': 'interpretation', 'kind': kind, 'name': 'Sales context',
        'aliases': ['Sales guidance'], 'description': 'A reviewed synthetic definition.',
        'narrative': 'Reviewed meaning.\r\n\n## Narrative\n```json\nnot metadata\n```\n café 😀\n',
        'owner': 'sales-owner', 'classification': 'internal',
        'valid_from': '2026-10-21T01:00:00+01:00', 'valid_until': None,
        'provenance': [{'path': 'fixtures/sales.json', 'sha256': 'a' * 64}],
        'dependencies': [],
        'spec': {'qualifiers': ['Completed orders only.'], 'caveats': ['Synthetic source.']},
    }
    if kind == 'source':
        record.update(id='SALES_SOURCE', layer='data', spec={
            'binding': 'sales.orders.v1', 'grain': ['order_id'],
            'freshness_seconds': 3600, 'checked_at': '2026-10-21T01:00:00+01:00',
            'dimensions': {'PERIOD': 'period', 'TERRITORY': 'territory_id'}})
    elif kind == 'dimension':
        record.update(id='TERRITORY', layer='ontology', spec={'value_type': 'text'})
    elif kind == 'member':
        record.update(id='TERRITORY_NORTHEAST', layer='ontology', spec={
            'dimension': 'TERRITORY', 'value': 'T-NE', 'parents': ['TERRITORY_NORTH']},
            dependencies=[{'id': 'TERRITORY', 'version': 1}, {'id': 'TERRITORY_NORTH', 'version': 2}])
    elif kind == 'measure':
        record.update(id='NET_REVENUE', layer='metric', spec={
            'source': 'SALES_SOURCE', 'aggregation': 'sum',
            'expression': 'gross_cents - discount_cents - return_cents',
            'required_dimensions': ['PERIOD'], 'optional_dimensions': ['TERRITORY'],
            'guidance': ['SALES_GUIDANCE']},
            dependencies=[{'id': name, 'version': 1} for name in
                          ['SALES_SOURCE', 'PERIOD', 'TERRITORY', 'SALES_GUIDANCE']])
    return record


class ComposableFormatsTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(MODEL, 'feature missing: shared composable schema')
        self.assertIsNotNone(FORMATS, 'feature missing: lossless composable formats')

    def invalid_record(self, record):
        with self.assertRaises(MODEL.ContextError) as caught:
            MODEL.validate_record(record)
        self.assertEqual(caught.exception.code, 'invalid_record')

    def invalid_document(self, text, format='json'):
        with self.assertRaises(MODEL.ContextError) as caught:
            FORMATS.parse_document(text, format)
        self.assertEqual(caught.exception.code, 'invalid_document')

    def test_all_kinds_validate_as_independent_normalized_records(self):
        for kind in ['source', 'measure', 'dimension', 'member', 'guidance']:
            with self.subTest(kind=kind):
                original = example(kind)
                normalized = MODEL.validate_record(original)
                self.assertEqual(normalized['valid_from'], '2026-10-21T00:00:00Z')
                if kind == 'source':
                    self.assertEqual(normalized['spec']['checked_at'], '2026-10-21T00:00:00Z')
                normalized['aliases'].append('Changed copy')
                self.assertEqual(original, example(kind))

    def test_every_format_preserves_normalized_record_bytes_and_hash(self):
        for kind in ['source', 'measure', 'dimension', 'member', 'guidance']:
            normalized = MODEL.validate_record(example(kind))
            for format in ['json', 'markdown', 'yaml']:
                with self.subTest(kind=kind, format=format):
                    text = FORMATS.export_document(normalized, format)
                    parsed = FORMATS.parse_document(text, format)
                    self.assertEqual(MODEL.canonical(parsed), MODEL.canonical(normalized))
                    self.assertEqual(MODEL.digest(parsed), MODEL.digest(normalized))
                    self.assertEqual(FORMATS.export_document(parsed, format), text)

    def test_markdown_narrative_is_exact_even_with_fences_and_header(self):
        record = example()
        text = FORMATS.export_document(record, 'markdown')
        self.assertTrue(text.endswith(record['narrative']))
        self.assertEqual(FORMATS.parse_document(text, 'markdown')['narrative'], record['narrative'])
        self.assertTrue(text.startswith('# Prefrontal context record\n\n```json\n'))

    def test_yaml_profile_exports_real_block_yaml_not_json_with_an_extension(self):
        text = FORMATS.export_document(example(), 'yaml')
        self.assertFalse(text.lstrip().startswith('{'))
        self.assertIn('schema: "prefrontal.context.v1"\n', text)
        self.assertIn('provenance:\n  - path:', text)
        self.assertEqual(FORMATS.parse_document(text, 'yaml'), MODEL.validate_record(example()))
        for unsupported in ['a: &ref [1]\nb: *ref\n',
                            '!!python/object:foo {}', '{"version": .nan}', 'true # comment']:
            with self.subTest(document=unsupported):
                self.invalid_document(unsupported, 'yaml')

    def human_yaml(self):
        return '''---
# Hand-authored record, not JSON.
schema: prefrontal.context.v1
id: SALES_GUIDANCE
version: 1
layer: interpretation
kind: guidance
name: "Sales context"
aliases:
  - "Sales guidance"
description: "A reviewed synthetic definition."
narrative: |-
  Reviewed meaning.
  Keep this exact line.
owner: sales-owner
classification: internal
valid_from: "2026-10-21T00:00:00Z"
valid_until: null
provenance:
  - path: fixtures/sales.json
    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
dependencies: []
spec:
  qualifiers:
    - "Completed orders only."
  caveats:
    - "Synthetic source."
...
'''

    def test_genuinely_idiomatic_yaml_input_supports_mapping_sequence_and_literal_text(self):
        expected = example()
        expected['narrative'] = 'Reviewed meaning.\nKeep this exact line.'
        try:
            parsed = FORMATS.parse_document(self.human_yaml(), 'yaml')
        except MODEL.ContextError:
            self.fail('feature missing: ordinary human-authored YAML mappings and sequences')
        self.assertEqual(parsed, MODEL.validate_record(expected))
        self.assertEqual(MODEL.digest(parsed), MODEL.digest(MODEL.validate_record(expected)))

    def test_yaml_rejects_unsafe_constructs_and_ambiguous_coercions(self):
        for replacement in ['name: yes', 'name: NO', 'name: on', 'name: Off',
                            'name: 2026-10-21', 'name: 01', 'name: +1', 'name: 1.25',
                            'name: .nan', 'name: &anchor value', 'name: *anchor',
                            'name: !!str value', 'name: value # inline comment']:
            text = self.human_yaml().replace('name: "Sales context"', replacement)
            with self.subTest(replacement=replacement):
                self.invalid_document(text, 'yaml')
        for suffix in ['name: duplicate\n', '<<: value\n', '---\nid: SECOND\n']:
            self.invalid_document(self.human_yaml().replace('...\n', suffix), 'yaml')
        self.invalid_document(self.human_yaml().replace('  qualifiers:', '\tqualifiers:'), 'yaml')
        self.invalid_document(self.human_yaml().replace('  qualifiers:', '   qualifiers:'), 'yaml')

    def test_yaml_nested_duplicate_keys_and_sequence_item_mappings_deny(self):
        for text in [self.human_yaml().replace('    sha256:', '    path: other.json\n    sha256:'),
                     self.human_yaml().replace('  caveats:', '  qualifiers: []\n  caveats:')]:
            self.invalid_document(text, 'yaml')

    def test_yaml_quoted_reserved_words_and_literal_data_are_not_instructions(self):
        text = self.human_yaml().replace('name: "Sales context"', 'name: "yes"')
        text = text.replace('  Keep this exact line.', '  !!tag &anchor *alias are inert narrative.\n  # This is text, not a comment.')
        parsed = FORMATS.parse_document(text, 'yaml')
        self.assertEqual(parsed['name'], 'yes')
        self.assertEqual(parsed['narrative'], 'Reviewed meaning.\n!!tag &anchor *alias are inert narrative.\n# This is text, not a comment.')

    def test_yaml_preserves_crlf_trailing_newlines_and_json_escapes(self):
        for narrative in ['line1\r\nline2\r\n', 'line1\n\n', 'colon: text # data\nnext',
                          '"quoted" \\ path\tand tab', 'café 😀\n終わり']:
            body = example()
            body['narrative'] = narrative
            text = FORMATS.export_document(body, 'yaml')
            self.assertEqual(FORMATS.parse_document(text, 'yaml')['narrative'], narrative)

    def test_yaml_line_endings_are_unambiguous_and_plain_trailing_colons_require_quotes(self):
        expected = FORMATS.parse_document(self.human_yaml(), 'yaml')
        self.assertEqual(FORMATS.parse_document(self.human_yaml().replace('\n', '\r\n'), 'yaml'), expected)
        self.invalid_document(self.human_yaml().replace('Reviewed meaning.', 'Reviewed\rmeaning.'), 'yaml')
        self.invalid_document(self.human_yaml().replace('name: "Sales context"', 'name: unquoted:'), 'yaml')

    def test_yaml_literal_narrative_preserves_whitespace_only_content_lines(self):
        for narrative in ['first\n   \nlast', 'first\n   ', '   \nfirst',
                          'first\n \n  \nlast', 'first\n\t\nlast', 'first\r\nlast\r\n']:
            body = MODEL.validate_record({**example(), 'narrative': narrative})
            parsed = FORMATS.parse_document(FORMATS.export_document(body, 'yaml'), 'yaml')
            self.assertEqual(parsed['narrative'], narrative)
            self.assertEqual(MODEL.digest(parsed), MODEL.digest(body))

    def test_yaml_export_quotes_nonprintable_controls_without_changing_record_hash(self):
        for char in ['\x00', '\x07', '\x1b', '\x7f', '\x80', '\x9f']:
            body = MODEL.validate_record({**example(), 'narrative': 'first\n' + char + 'last'})
            text = FORMATS.export_document(body, 'yaml')
            self.assertNotIn(char, text)
            self.assertEqual(MODEL.digest(FORMATS.parse_document(text, 'yaml')), MODEL.digest(body))

    def test_yaml_rejects_raw_prohibited_controls_even_in_literal_blocks(self):
        for char in ['\x00', '\x07', '\x1b', '\x7f', '\x80', '\x9f']:
            text = self.human_yaml().replace('Keep this exact line.', 'Keep ' + char + ' this line.')
            self.invalid_document(text, 'yaml')
        self.invalid_document('\t' + FORMATS.export_document(example(), 'json'), 'yaml')

    def test_maximum_canonical_record_roundtrips_through_all_formats(self):
        body = example()
        body['valid_from'] = '2026-10-21T00:00:00Z'
        body['narrative'] = 'x'
        count = MODEL.MAX_RECORD_BYTES - len(MODEL.canonical(body).encode('utf-8')) + 1
        body['narrative'] = 'x' * count
        self.assertEqual(len(MODEL.canonical(body).encode('utf-8')), MODEL.MAX_RECORD_BYTES)
        for format in ['json', 'markdown', 'yaml']:
            self.assertEqual(FORMATS.parse_document(FORMATS.export_document(body, format), format), body)

    def test_list_heavy_record_near_canonical_limit_roundtrips_every_format(self):
        body = example()
        body['spec']['qualifiers'] = ['x'] * 15000
        normalized = MODEL.validate_record(body)
        self.assertGreater(len(MODEL.canonical(normalized)), 60000)
        for format in ['json', 'markdown', 'yaml']:
            text = FORMATS.export_document(normalized, format)
            try:
                parsed = FORMATS.parse_document(text, format)
            except MODEL.ContextError:
                self.fail('valid list-heavy record must parse its own ' + format + ' export')
            self.assertEqual(MODEL.digest(parsed), MODEL.digest(normalized))

    def test_markdown_rejects_ambiguous_or_nonprofile_metadata(self):
        valid = FORMATS.export_document(example(), 'markdown')
        for text in ['Intro\n' + valid, valid.replace('```json', '```yaml', 1),
                     valid.replace('## Narrative', '## Body', 1),
                     valid.replace('```json\n{', '```json\n{\n ', 1)]:
            with self.subTest(document=text[:80]):
                self.invalid_document(text, 'markdown')

    def test_approval_or_any_extra_record_field_is_never_imported(self):
        for field in ['approved', 'reviewer', 'release', 'workspace', 'answer']:
            record = example()
            record[field] = True
            self.invalid_record(record)

    def test_missing_fields_and_wrong_layer_kind_are_rejected(self):
        for field in example():
            body = example()
            del body[field]
            self.invalid_record(body)
        for layer in ['metric', 'ontology', 'data', 'anything']:
            body = example()
            body['layer'] = layer
            self.invalid_record(body)

    def test_ids_versions_and_classifications_are_strict(self):
        for field, values in {'id': ['x', 'lowercase', 'A', 'A-B', 'A' * 97],
                              'version': [True, 0, -1, 1.0, '1'],
                              'classification': ['public', 'confidential', True],
                              'schema': ['context.knowledge.v1', None]}.items():
            for value in values:
                body = example()
                body[field] = value
                self.invalid_record(body)

    def test_versions_and_pinned_versions_fit_sqlite_signed_integer_range(self):
        maximum = 2 ** 63 - 1
        body = example()
        body['version'] = maximum
        body['dependencies'] = [{'id': 'SALES_SOURCE', 'version': maximum}]
        self.assertEqual(MODEL.validate_record(body)['version'], maximum)
        for field in ['version', 'dependency']:
            body = example()
            if field == 'version':
                body['version'] = maximum + 1
            else:
                body['dependencies'] = [{'id': 'SALES_SOURCE', 'version': maximum + 1}]
            self.invalid_record(body)
        body = example('source')
        body['spec']['freshness_seconds'] = maximum + 1
        self.invalid_record(body)

    def test_aliases_require_nonempty_unique_casefolded_strings(self):
        for value in [None, 'alias', [''], ['  '], [True], ['Net', 'net'], ['Straße', 'STRASSE']]:
            body = example()
            body['aliases'] = value
            self.invalid_record(body)

    def test_validity_times_are_aware_ordered_and_preserve_instants(self):
        body = example()
        body['valid_until'] = '2026-10-22T02:30:00.123456+02:30'
        self.assertEqual(MODEL.validate_record(body)['valid_until'], '2026-10-22T00:00:00.123456Z')
        for value in ['2026-10-21', '2026-10-21T00:00:00', 'not-a-time', True]:
            body = example()
            body['valid_from'] = value
            self.invalid_record(body)
        for value in ['2026-10-21T00:00:00Z', '2026-10-20T23:59:59Z']:
            body = example()
            body['valid_until'] = value
            self.invalid_record(body)

    def test_timezone_offsets_reject_out_of_range_iso_minutes(self):
        for value in ['2026-10-21T00:00:00+00:60', '2026-10-21T00:00:00-01:99']:
            body = example()
            body['valid_from'] = value
            self.invalid_record(body)

    def test_provenance_is_nonempty_exact_relative_and_digest_bound(self):
        for path in ['/private/file', '../outside', 'a/../outside', './file', 'a//file',
                     'C:/secret', '\\private\\file', 'https://example.invalid/file', 'file\x00']:
            body = example()
            body['provenance'][0]['path'] = path
            self.invalid_record(body)
        for value in [[], [{'path': 'a', 'sha256': 'A' * 64}],
                      [{'path': 'a', 'sha256': 'a' * 63}],
                      [{'path': 'a', 'sha256': 'a' * 64, 'approved': True}]]:
            body = example()
            body['provenance'] = value
            self.invalid_record(body)

    def test_dependencies_are_exact_unique_pinned_refs(self):
        for kind in ['measure', 'member']:
            body = example(kind)
            body['dependencies'].pop()
            self.invalid_record(body)
            body = example(kind)
            body['dependencies'].append({'id': 'UNRELATED', 'version': 1})
            self.invalid_record(body)
        for values in [[{'id': 'SOURCE', 'version': True}],
                       [{'id': 'SOURCE', 'version': 0}],
                       [{'id': 'SOURCE', 'version': 1, 'approved': True}],
                       [{'id': 'SOURCE', 'version': 1}, {'id': 'SOURCE', 'version': 2}]]:
            body = example()
            body['dependencies'] = values
            self.invalid_record(body)

    def test_source_dimensions_are_binding_descriptors_not_dependencies(self):
        source = MODEL.validate_record(example('source'))
        self.assertEqual(source['dependencies'], [])
        for field, value in [('freshness_seconds', True), ('freshness_seconds', 0),
                             ('grain', []), ('grain', ['order_id', 'order_id']),
                             ('dimensions', {'period': 'period'}),
                             ('dimensions', {'PERIOD': 'period;drop table'})]:
            body = example('source')
            body['spec'][field] = value
            self.invalid_record(body)

    def test_spec_fields_and_enumerations_are_exact(self):
        for kind in ['source', 'measure', 'dimension', 'member', 'guidance']:
            body = example(kind)
            body['spec']['extra'] = 'rejected'
            self.invalid_record(body)
        for kind, field, value in [('measure', 'aggregation', 'eval'),
                                   ('dimension', 'value_type', 'decimal'),
                                   ('guidance', 'qualifiers', []), ('guidance', 'caveats', ['']),
                                   ('member', 'value', True), ('member', 'value', 1.0)]:
            body = example(kind)
            body['spec'][field] = value
            self.invalid_record(body)

    def test_member_integer_values_and_guidance_source_deps_are_modeled(self):
        member = example('member')
        member['spec']['value'] = 42
        self.assertEqual(MODEL.validate_record(member)['spec']['value'], 42)
        guide = example()
        guide['dependencies'] = [{'id': 'SALES_SOURCE', 'version': 2}]
        self.assertEqual(MODEL.validate_record(guide)['dependencies'], guide['dependencies'])

    def test_member_ids_are_explicitly_scoped_by_the_exact_dimension_id(self):
        for identifier in ['NORTHEAST', 'PRODUCT_NORTHEAST', 'TERRITORY_']:
            member = example('member')
            member['id'] = identifier
            self.invalid_record(member)

    def test_direct_dependency_limit_and_record_size(self):
        body = example()
        body['dependencies'] = [{'id': 'SOURCE_' + str(i), 'version': 1} for i in range(33)]
        self.invalid_record(body)
        body = example()
        body['narrative'] = 'x' * 65536
        self.invalid_record(body)

    def test_strict_json_rejects_duplicates_nonfinite_surrogates_and_excess_depth(self):
        for text in ['{"a":1,"a":2}', '{"nested":{"a":1,"a":2}}', 'NaN',
                     'Infinity', '-Infinity', '1e999', '"\\ud800"',
                     '[' * 18 + '0' + ']' * 18, '{"x":1} trailing']:
            with self.subTest(document=text[:60]):
                with self.assertRaises(MODEL.ContextError) as caught:
                    MODEL.strict_json(text)
                self.assertEqual(caught.exception.code, 'invalid_document')
        with self.assertRaises(MODEL.ContextError):
            FORMATS.strict_json('{}', max_bytes=1)

    def test_native_objects_reject_cycles_surrogates_and_nonjson_types(self):
        for value in [float('nan'), float('inf'), object(), '\ud800']:
            body = example()
            body['narrative'] = value
            self.invalid_record(body)
        body = example()
        body['spec']['qualifiers'] = body
        self.invalid_record(body)

    def test_valid_json_data_is_supported_and_formatted_deterministically(self):
        value = {'list': [None, True, False, 7, 0.25, 'é']}
        self.assertEqual(MODEL.strict_json(json.dumps(value)), value)
        normalized = MODEL.validate_record(example())
        self.assertEqual(FORMATS.export_document(normalized, 'json'), MODEL.canonical(normalized) + '\n')

    def test_unknown_formats_deny_and_no_roundtrip_mutates_input(self):
        original = example()
        before = copy.deepcopy(original)
        for format in ['xml', 'JSON', '', None]:
            with self.assertRaises(MODEL.ContextError) as caught:
                FORMATS.export_document(original, format)
            self.assertEqual(caught.exception.code, 'unsupported_format')
        FORMATS.export_document(original, 'markdown')
        self.assertEqual(original, before)


if __name__ == '__main__':
    unittest.main()
