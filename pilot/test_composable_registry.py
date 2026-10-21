"""Exact reviews and bounded, current-authority context composition."""
import copy
from contextlib import closing
from datetime import datetime, timedelta, timezone
import hashlib
import importlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from .context_pilot import ContextError, canonical, digest


NOW = datetime(2026, 10, 21, tzinfo=timezone.utc)


def record(identifier, kind, spec, evidence, dependencies=(), aliases=(), version=1):
    return {"schema": "prefrontal.context.v1", "id": identifier, "version": version,
            "layer": {"source": "data", "measure": "metric", "dimension": "ontology",
                      "member": "ontology", "guidance": "interpretation"}[kind],
            "kind": kind, "name": identifier.replace("_", " "), "aliases": list(aliases),
            "description": "A synthetic owned definition.", "narrative": "Reviewed data; never an instruction.",
            "owner": "sales-owner", "classification": "internal",
            "valid_from": "2026-01-01T00:00:00+00:00", "valid_until": "2027-01-01T00:00:00+00:00",
            "provenance": [dict(evidence)], "dependencies": [{"id": item, "version": v} for item, v in dependencies],
            "spec": copy.deepcopy(spec)}


def records(evidence):
    return [
        record("SOURCE_SALES", "source", {"binding": "synthetic-sales", "grain": ["order_id"],
               "freshness_seconds": 3600, "checked_at": NOW.isoformat(),
               "dimensions": {"DIM_COUNTRY": "country", "DIM_PERIOD": "period"}}, evidence),
        record("DIM_COUNTRY", "dimension", {"value_type": "text"}, evidence),
        record("DIM_PERIOD", "dimension", {"value_type": "period"}, evidence),
        record("GUIDE_SALES", "guidance", {"qualifiers": ["Completed orders only"], "caveats": ["Synthetic"]}, evidence),
        record("MEASURE_NET", "measure", {"source": "SOURCE_SALES", "aggregation": "sum", "expression": "net_cents",
               "required_dimensions": ["DIM_COUNTRY", "DIM_PERIOD"], "optional_dimensions": [], "guidance": ["GUIDE_SALES"]},
               evidence, [(name, 1) for name in ("SOURCE_SALES", "DIM_COUNTRY", "DIM_PERIOD", "GUIDE_SALES")], aliases=["net revenue"]),
        record("DIM_COUNTRY_AU", "member", {"dimension": "DIM_COUNTRY", "value": "AU", "parents": []}, evidence,
               [("DIM_COUNTRY", 1)], aliases=["Australia"]),
        record("DIM_PERIOD_SEP", "member", {"dimension": "DIM_PERIOD", "value": "2026-09", "parents": []}, evidence,
               [("DIM_PERIOD", 1)], aliases=["September 2026"]),
    ]


class ComposableRegistryAcceptance(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec("pilot.composable_registry"),
                             "Feature missing: additive composable registry")
        self.module = importlib.import_module("pilot.composable_registry")
        scratch = Path(__file__).resolve().parents[1] / ".validation" / "composable-registry-tests"
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "evidence.txt"
        self.source.write_text("Synthetic completed orders only.\n", encoding="utf-8")
        self.evidence = {"path": "evidence.txt", "sha256": hashlib.sha256(self.source.read_bytes()).hexdigest()}
        self.people = {
            name: {"workspace": "sales", "roles": [role], "classifications": ["internal"],
                   "source_bindings": ["synthetic-sales"] if name == "reader" else []}
            for name, role in (("author", "submitter"), ("reviewer", "reviewer"), ("releaser", "releaser"), ("reader", "consumer"))}
        self.clock = [NOW]
        self.database = self.root / "context.sqlite3"
        self.registry = self.module.ComposableRegistry(self.database, self.root,
                                                     lambda: copy.deepcopy(self.people), clock=lambda: self.clock[0])
        self.addCleanup(self.registry.close)
        self.records = records(self.evidence)

    def approved(self, items=None, publish=True):
        items = self.records if items is None else items
        hashes = self.registry.submit_batch("author", items)
        for body, expected in zip(items, hashes):
            self.registry.review("reviewer", "sales", body["id"], body["version"], expected, "approved")
        if publish:
            return self.registry.publish("releaser", "sales", [{"id": body["id"], "version": body["version"]} for body in items])
        return hashes

    def resolve(self, selectors=None):
        return self.registry.resolve("reader", "sales", "MEASURE_NET", ["DIM_COUNTRY_AU", "DIM_PERIOD_SEP"] if selectors is None else selectors)

    def unavailable(self, call, *args):
        with self.assertRaises(ContextError) as failure:
            call(*args)
        self.assertIn(failure.exception.code, {"context_unavailable", "access_denied"})
        return failure.exception.code

    def test_exact_reviews_atomic_publication_and_restart(self):
        self.assertEqual(self.approved(), 1)
        bundle = self.resolve()
        self.assertEqual(bundle["contract"], "prefrontal.composition.v1")
        self.assertEqual(bundle["measure"], {"id": "MEASURE_NET", "version": 1})
        self.assertEqual(len(bundle["records"]), 7)
        self.assertTrue(all(item["reviewer"] == "reviewer" for item in bundle["records"]))
        unsigned = {key: value for key, value in bundle.items() if key != "bundle_hash"}
        self.assertEqual(bundle["bundle_hash"], digest(unsigned))
        self.assertTrue(bundle["recheck_at_use"])
        with self.module.Registry(self.database, self.root, self.people, clock=lambda: NOW) as reopened:
            self.assertEqual(reopened.resolve("reader", "sales", "MEASURE_NET", ["DIM_PERIOD_SEP", "DIM_COUNTRY_AU"])["bundle_hash"], bundle["bundle_hash"])

    def test_record_versions_and_reviews_are_immutable_and_independent(self):
        body = self.records[0]
        expected = self.registry.submit("author", body)
        self.assertEqual(self.registry.submit("author", body), expected)
        changed = copy.deepcopy(body); changed["name"] = "Changed"
        with self.assertRaises(ContextError): self.registry.submit("author", changed)
        self.people["author"]["roles"].append("reviewer")
        with self.assertRaises(ContextError): self.registry.review("author", "sales", body["id"], 1, expected, "approved")
        with self.assertRaises(ContextError): self.registry.review("reviewer", "sales", body["id"], 1, "0" * 64, "approved")
        self.registry.review("reviewer", "sales", body["id"], 1, expected, "changes_requested")
        with self.assertRaises(ContextError): self.registry.publish("releaser", "sales", [{"id": body["id"], "version": 1}])

    def test_batch_submission_rolls_back_on_one_invalid_record(self):
        bad = copy.deepcopy(self.records[1]); bad["id"] = "not-uppercase"
        with self.assertRaises(ContextError): self.registry.submit_batch("author", [self.records[0], bad])
        self.assertEqual(self.registry.db.execute("SELECT count(*) FROM c_records").fetchone()[0], 0)

    def test_aliases_and_selector_order_resolve_without_materialized_permutations(self):
        self.approved()
        first = self.resolve()
        second = self.registry.resolve("reader", "sales", "net revenue", ["September 2026", {"dimension": "DIM_COUNTRY", "member": "Australia"}])
        self.assertEqual(first["bundle_hash"], second["bundle_hash"])
        self.assertEqual(self.registry.db.execute("SELECT count(*) FROM c_records").fetchone()[0], 7)
        self.assertEqual([item["dimension"] for item in first["selectors"]], ["DIM_COUNTRY", "DIM_PERIOD"])

    def test_missing_duplicate_conflicting_and_unsupported_selectors_fail(self):
        self.approved()
        for selectors in (["DIM_COUNTRY_AU"], ["DIM_COUNTRY_AU", "DIM_COUNTRY_AU", "DIM_PERIOD_SEP"],
                          ["Australia", "DIM_COUNTRY_AU", "DIM_PERIOD_SEP"], ["MEASURE_NET", "DIM_PERIOD_SEP"]):
            self.unavailable(self.resolve, selectors)

    def test_incremental_heads_preserve_other_records_and_revision_conflict_is_atomic(self):
        self.approved()
        extra = record("DIM_COUNTRY_NZ", "member", {"dimension": "DIM_COUNTRY", "value": "NZ", "parents": []}, self.evidence, [("DIM_COUNTRY", 1)])
        self.approved([extra], publish=False)
        with self.assertRaises(ContextError): self.registry.publish("releaser", "sales", [{"id": "DIM_COUNTRY_NZ", "version": 1}], expected_revision=0)
        self.assertEqual(self.registry.publish("releaser", "sales", [{"id": "DIM_COUNTRY_NZ", "version": 1}], expected_revision=1), 2)
        self.assertEqual(self.resolve()["catalog_revision"], 2)
        self.assertEqual(self.registry.db.execute("SELECT count(*) FROM c_heads").fetchone()[0], 8)

    def test_revocation_and_source_change_invalidate_previous_bundle(self):
        self.approved()
        bundle = self.resolve()
        self.registry.revoke("releaser", "sales", "DIM_COUNTRY_AU", 1)
        self.unavailable(self.registry.revalidate, "reader", bundle)
        self.unavailable(self.resolve)
        self.source.write_text("Different invented evidence.\n", encoding="utf-8")
        self.unavailable(self.registry.resolve, "reader", "sales", "MEASURE_NET", ["DIM_COUNTRY_AU", "DIM_PERIOD_SEP"])

    def test_expiration_and_freshness_are_rechecked_at_use(self):
        self.approved()
        bundle = self.resolve()
        self.clock[0] = NOW + timedelta(seconds=3601)
        self.unavailable(self.registry.revalidate, "reader", bundle)
        self.clock[0] = datetime(2027, 1, 1, tzinfo=timezone.utc)
        self.unavailable(self.resolve)

    def test_bundle_tampering_and_cross_workspace_use_fail(self):
        self.approved()
        bundle = self.resolve()
        altered = copy.deepcopy(bundle); altered["selectors"][0]["value"] = "other"
        self.unavailable(self.registry.revalidate, "reader", altered)
        self.unavailable(self.registry.resolve, "reader", "other-workspace", "MEASURE_NET", ["DIM_COUNTRY_AU", "DIM_PERIOD_SEP"])

    def test_live_principal_removal_during_delivery_prevents_context(self):
        self.approved()
        original = self.registry.source_hash
        def revoke(path):
            result = original(path)
            self.people.pop("reader", None)
            return result
        self.registry.source_hash = revoke
        self.unavailable(self.resolve)

    def test_metadata_discovery_does_not_grant_native_binding_access(self):
        self.approved()
        self.people["reader"]["source_bindings"] = []
        self.assertEqual(self.resolve()["measure"]["id"], "MEASURE_NET")
        self.unavailable(self.registry.authorize_source, "reader", "synthetic-sales")

    def test_reverse_dependent_incompatible_head_update_is_rejected_atomically(self):
        self.approved()
        dimension = copy.deepcopy(self.records[1]); dimension["version"] = 2
        self.approved([dimension], publish=False)
        with self.assertRaises(ContextError): self.registry.publish("releaser", "sales", [{"id": "DIM_COUNTRY", "version": 2}])
        self.assertEqual(self.resolve()["catalog_revision"], 1)

    def test_member_value_type_and_declared_dependencies_are_compatible(self):
        dimension = copy.deepcopy(self.records[1]); dimension["spec"]["value_type"] = "integer"
        items = [dimension if item["id"] == dimension["id"] else item for item in self.records]
        self.approved(items, publish=False)
        with self.assertRaises(ContextError): self.registry.publish("releaser", "sales", [{"id": item["id"], "version": 1} for item in items])
        self.assertEqual(self.registry.db.execute("SELECT count(*) FROM c_heads").fetchone()[0], 0)

    def test_validation_is_machine_readable_and_never_approves(self):
        result = self.registry.validate("author", self.records[0])
        self.assertTrue(result["valid"])
        self.assertFalse(result["approved"])
        self.assertEqual(result["approval_state"], "unsubmitted")
        self.assertEqual(self.registry.db.execute("SELECT count(*) FROM c_records").fetchone()[0], 0)

    def test_open_ended_validity_remains_usable_under_current_freshness(self):
        for body in self.records:
            body["valid_until"] = None
        self.approved()
        self.assertEqual(self.resolve()["measure"]["id"], "MEASURE_NET")

    def test_old_profile_database_is_rejected_before_composable_tables_are_added(self):
        from .context_pilot import Registry as LegacyRegistry
        import sqlite3
        legacy = self.root / "legacy.sqlite3"
        with LegacyRegistry(legacy, self.root, self.people):
            pass
        before = legacy.read_bytes()
        with self.assertRaises(ContextError) as error:
            self.module.ComposableRegistry(legacy, self.root, self.people)
        self.assertEqual(error.exception.code, "profile_mismatch")
        self.assertEqual(before, legacy.read_bytes())
        with closing(sqlite3.connect(legacy)) as connection:
            self.assertEqual(connection.execute("SELECT count(*) FROM sqlite_master WHERE name LIKE 'c_%'").fetchone()[0], 0)

    def guidance(self, identifier, dependencies=()):
        return record(identifier, "guidance", {"qualifiers": ["Synthetic"], "caveats": ["Fixture only"]},
                      self.evidence, dependencies)

    def publication_blocked(self, items):
        self.approved(items, publish=False)
        before_revision = self.registry._revision("sales")
        before_heads = [tuple(row) for row in self.registry.db.execute("SELECT * FROM c_heads ORDER BY id")]
        before_events = self.registry.db.execute("SELECT count(*) FROM c_events WHERE action='published'").fetchone()[0]
        with self.assertRaises(ContextError):
            self.registry.publish("releaser", "sales", [{"id": item["id"], "version": item["version"]} for item in items])
        self.assertEqual(self.registry._revision("sales"), before_revision)
        self.assertEqual([tuple(row) for row in self.registry.db.execute("SELECT * FROM c_heads ORDER BY id")], before_heads)
        self.assertEqual(self.registry.db.execute("SELECT count(*) FROM c_events WHERE action='published'").fetchone()[0], before_events)

    def test_cross_dimension_parent_relation_cannot_be_published(self):
        # Native execution cuts each selected dimension; an omitted cross-dimension
        # ancestor could otherwise silently broaden a result.
        member = self.records[5]
        member["spec"]["parents"] = ["DIM_PERIOD_SEP"]
        member["dependencies"].append({"id": "DIM_PERIOD_SEP", "version": 1})
        self.publication_blocked(self.records)

    def test_same_dimension_hierarchy_remains_usable(self):
        parent = record("DIM_COUNTRY_ALL", "member", {"dimension": "DIM_COUNTRY", "value": "ALL", "parents": []},
                        self.evidence, [("DIM_COUNTRY", 1)])
        self.records[5]["spec"]["parents"] = [parent["id"]]
        self.records[5]["dependencies"].append({"id": parent["id"], "version": 1})
        self.approved(self.records + [parent])
        self.assertIn(parent["id"], [item["record"]["id"] for item in self.resolve()["records"]])

    def test_dependency_cycle_is_rejected_atomically(self):
        self.publication_blocked([self.guidance("GUIDE_CYCLE_A", [("GUIDE_CYCLE_B", 1)]),
                                  self.guidance("GUIDE_CYCLE_B", [("GUIDE_CYCLE_A", 1)])])

    def test_missing_exact_dependency_is_rejected_atomically(self):
        self.publication_blocked([self.guidance("GUIDE_MISSING", [("GUIDE_ABSENT", 1)])])

    def test_conflicting_dependency_versions_are_rejected_atomically(self):
        first = self.guidance("GUIDE_VERSION")
        second = copy.deepcopy(first); second["version"] = 2
        items = [first, second, self.guidance("GUIDE_OLD", [(first["id"], 1)]),
                 self.guidance("GUIDE_NEW", [(first["id"], 2)]),
                 self.guidance("GUIDE_ROOT", [("GUIDE_OLD", 1), ("GUIDE_NEW", 1)])]
        self.approved(items, publish=False)
        with self.assertRaises(ContextError):
            self.registry.publish("releaser", "sales", [{"id": item["id"], "version": item["version"]} for item in items[1:]])
        self.assertEqual(self.registry._revision("sales"), 0)
        self.assertEqual(self.registry.db.execute("SELECT count(*) FROM c_heads").fetchone()[0], 0)

    def test_depth_bound_checks_longest_path_even_after_shallow_shared_visit(self):
        shared = self.guidance("GUIDE_Z_SHARED")
        chain = [self.guidance("GUIDE_CHAIN_" + str(index),
                              [("GUIDE_CHAIN_" + str(index + 1), 1)] if index < 15 else [(shared["id"], 1)])
                 for index in range(16)]
        root = self.guidance("GUIDE_A_ROOT", [(shared["id"], 1), (chain[0]["id"], 1)])
        self.publication_blocked([root, shared] + chain)

    def test_depth_at_exact_bound_remains_usable(self):
        items = [self.guidance("GUIDE_CHAIN_" + str(index),
                              [("GUIDE_CHAIN_" + str(index + 1), 1)] if index < 16 else []) for index in range(17)]
        self.approved(items)
        self.assertEqual(len(self.registry._closure("reader", "sales", items[0])), 17)

    def test_closure_record_fanout_limit_is_atomic(self):
        leaves = [self.guidance("GUIDE_LEAF_" + str(index)) for index in range(128)]
        branches = [self.guidance("GUIDE_BRANCH_" + str(index),
                                 [(item["id"], 1) for item in leaves[index * 32:(index + 1) * 32]]) for index in range(4)]
        root = self.guidance("GUIDE_A_ROOT", [(item["id"], 1) for item in branches])
        self.publication_blocked([root] + branches + leaves)

    def test_closure_byte_limit_is_atomic(self):
        leaves = [self.guidance("GUIDE_BYTES_" + str(index)) for index in range(24)]
        for item in leaves:
            item["narrative"] = "x" * 45000
        root = self.guidance("GUIDE_A_ROOT", [(item["id"], 1) for item in leaves])
        self.publication_blocked([root] + leaves)

    def test_revalidation_rejects_changed_catalog_revision_and_unknown_fields(self):
        self.approved()
        bundle = self.resolve()
        forged = copy.deepcopy(bundle); forged["unrecognized"] = "must reject"
        forged["bundle_hash"] = digest({key: value for key, value in forged.items() if key != "bundle_hash"})
        self.unavailable(self.registry.revalidate, "reader", forged)
        extra = self.guidance("GUIDE_UNRELATED")
        self.approved([extra])
        self.unavailable(self.registry.revalidate, "reader", bundle)

    def test_publication_rechecks_authority_after_event_clock(self):
        self.approved(publish=False)
        original_event = self.registry._event
        def remove_releaser(*args):
            original_event(*args)
            if args[2] == "published":
                self.people.pop("releaser")
        self.registry._event = remove_releaser
        with self.assertRaises(ContextError):
            self.registry.publish("releaser", "sales", [{"id": item["id"], "version": 1} for item in self.records])
        self.assertEqual(self.registry._revision("sales"), 0)
        self.assertEqual(self.registry.db.execute("SELECT count(*) FROM c_heads").fetchone()[0], 0)
        self.assertEqual(self.registry.db.execute("SELECT count(*) FROM c_events WHERE action='published'").fetchone()[0], 0)

    def test_validation_rechecks_authority_before_approval_state_delivery(self):
        self.approved()
        original_validate = self.module.validate_record
        def remove_author(item):
            result = original_validate(item)
            self.people["author"]["classifications"] = []
            return result
        with patch.object(self.module, "validate_record", side_effect=remove_author):
            with self.assertRaises(ContextError) as failure:
                self.registry.validate("author", self.records[0])
        self.assertEqual(failure.exception.code, "access_denied")

    def test_encoded_bundle_bound_includes_its_hash(self):
        self.approved()
        bundle = self.resolve()
        unsigned_size = len(canonical({key: value for key, value in bundle.items() if key != "bundle_hash"}).encode("utf-8"))
        self.assertGreater(len(canonical(bundle).encode("utf-8")), unsigned_size)
        with patch.object(self.module, "MAX_CLOSURE_BYTES", unsigned_size):
            self.unavailable(self.resolve)

    def test_releaser_cannot_revoke_unpermitted_classification(self):
        for actor in ("author", "reviewer", "releaser"):
            self.people[actor]["classifications"].append("restricted")
        body = self.guidance("GUIDE_RESTRICTED"); body["classification"] = "restricted"
        self.approved([body])
        self.people["releaser"]["classifications"] = ["internal"]
        with self.assertRaises(ContextError):
            self.registry.revoke("releaser", "sales", body["id"], 1)
        self.assertEqual(self.registry._revision("sales"), 1)
        self.assertFalse(self.registry._row("sales", body["id"], 1)["revoked"])


if __name__ == "__main__":
    unittest.main()
