"""Indexed discovery acceptance against the real composable registry.

The index is a candidate reference, never permission or lifecycle authority.
"""

import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from .composable_search import SEARCH_CONTRACT
from .composable_registry import ComposableRegistry
from .context_pilot import ContextError


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = "search-lab"


class ComposableSearchAcceptance(unittest.TestCase):
    def setUp(self):
        validation = ROOT / ".validation"
        validation.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="search-", dir=validation)
        self.directory = Path(self.temp.name)
        self.sources = self.directory / "sources"
        self.sources.mkdir()
        self.source = self.sources / "evidence.txt"
        self.source.write_text("Public synthetic registry search evidence.\n", encoding="utf-8")
        self.now = datetime(2026, 10, 21, 12, tzinfo=timezone.utc)
        self.principals = {
            actor: {"workspace": WORKSPACE, "roles": [role],
                    "classifications": ["internal", "restricted"], "source_bindings": []}
            for actor, role in (("author", "submitter"), ("reviewer", "reviewer"),
                                ("releaser", "releaser"), ("reader", "consumer"))
        }
        self.principals["reader"]["classifications"] = ["internal"]
        self.registry = ComposableRegistry(self.directory / "registry.sqlite3", self.sources,
                                           self.principals, clock=lambda: self.now)

    def tearDown(self):
        self.registry.close()
        self.temp.cleanup()

    def record(self, record_id, name=None, *, aliases=None, description="Synthetic dimension.",
               version=1, classification="internal", dependencies=None, dimension=None):
        body = {
            "schema": "prefrontal.context.v1",
            "id": record_id, "version": version, "layer": "ontology",
            "kind": "member" if dimension else "dimension", "name": name or record_id,
            "aliases": aliases or [], "description": description,
            "narrative": "Synthetic fixture; no semantic relevance claim.",
            "owner": "fixture-owner", "classification": classification,
            "valid_from": (self.now - timedelta(days=1)).isoformat(),
            "valid_until": (self.now + timedelta(days=1)).isoformat(),
            "provenance": [{"path": "evidence.txt", "sha256":
                            hashlib.sha256(self.source.read_bytes()).hexdigest()}],
            "dependencies": dependencies or [], "spec": {"value_type": "text"},
        }
        if dimension:
            body["spec"] = {"dimension": dimension, "value": name or record_id, "parents": []}
            body["dependencies"] = dependencies or [{"id": dimension, "version": 1}]
        return body

    def publish(self, *records):
        for record in records:
            receipt = self.registry.submit("author", record)
            self.registry.review("reviewer", WORKSPACE, record["id"], record["version"],
                                 receipt, "approved")
        return self.registry.publish("releaser", WORKSPACE,
                                     [{"id": body["id"], "version": body["version"]}
                                      for body in records])

    def search(self, query, **fields):
        return self.registry.search("reader", WORKSPACE, query, **fields)

    def ids(self, result):
        return [item["id"] for item in result["results"]]

    def assert_error(self, code, function, *args, **kwargs):
        with self.assertRaises(ContextError) as caught:
            function(*args, **kwargs)
        self.assertEqual(code, caught.exception.code)
        self.assertEqual(code, str(caught.exception))

    def test_ranked_search_contract_exact_id_name_alias_and_tokens(self):
        self.publish(
            self.record("ALPHA", "Revenue"),
            self.record("BETA", "Other", aliases=["Revenue"]),
            self.record("GAMMA", "Revenue movement"),
            self.record("DELTA", "Another", description="Revenue movement explained."),
        )
        result = self.search("Revenue")
        self.assertEqual(SEARCH_CONTRACT, result["contract"])
        self.assertEqual(["ALPHA", "BETA", "GAMMA", "DELTA"], self.ids(result))
        self.assertEqual({"contract", "results", "next_cursor", "catalog_revision"}, set(result))
        self.assertEqual({"id", "version", "layer", "kind", "name", "description", "score",
                          "content_hash"}, set(result["results"][0]))
        self.assertEqual(["ALPHA"], self.ids(self.search("alpha")))
        self.assertEqual(["GAMMA", "DELTA"], self.ids(self.search("revenue movement")))
        self.assertGreater(result["results"][0]["score"], result["results"][1]["score"])
        self.assertGreater(result["results"][1]["score"], result["results"][2]["score"])
        self.assertIsNone(result["next_cursor"])

    def test_hidden_exact_candidate_does_not_hide_visible_token_match(self):
        self.publish(self.record("SECRET", "Restricted name", classification="restricted"),
                     self.record("VISIBLE", "Secret observations"))
        result = self.search("SECRET")
        self.assertEqual(["VISIBLE"], self.ids(result))
        self.assertNotIn("Restricted name", json.dumps(result))
        self.assertNotIn("count", json.dumps(result))

    def test_visible_canonical_id_uses_bounded_point_lookup_without_keyword_ranking(self):
        self.publish(self.record("ALPHA", "Primary definition"),
                     self.record("BRAVO", "ALPHA", aliases=["Alpha definition"]))
        with patch.object(self.registry, "_candidate_rows", side_effect=AssertionError("ranking invoked")):
            result = self.search("ALPHA", page_size=1)
        self.assertEqual(["ALPHA"], self.ids(result))
        self.assertEqual(100000, result["results"][0]["score"])
        self.assertIsNone(result["next_cursor"])
        self.assertEqual([], self.search("ALPHA", kind="member")["results"])

    def test_stable_ties_and_permission_filtered_pagination(self):
        self.publish(*(self.record(name, "Shared label", classification=(
            "restricted" if name == "BRAVO" else "internal"))
            for name in ("DELTA", "CHARLIE", "BRAVO", "ALPHA")))
        first = self.search("shared", page_size=2)
        self.assertEqual(["ALPHA", "CHARLIE"], self.ids(first))
        self.assertIsInstance(first["next_cursor"], str)
        second = self.search("shared", page_size=2, cursor=first["next_cursor"])
        self.assertEqual(["DELTA"], self.ids(second))
        self.assertIsNone(second["next_cursor"])
        self.assertEqual(first["catalog_revision"], second["catalog_revision"])
        self.assertEqual(first, self.search("shared", page_size=2))

    def test_alias_collisions_consider_only_current_deliverable_scope(self):
        self.publish(self.record("PUBLIC", "First", aliases=["COMMON"]),
                     self.record("HIDDEN", "Second", aliases=["common"],
                                 classification="restricted"))
        self.assertEqual({"id": "PUBLIC", "version": 1},
                         self.registry.resolve_alias("reader", WORKSPACE, "Common"))
        self.publish(self.record("SECOND", "Third", aliases=["common"]))
        self.assert_error("context_unavailable", self.registry.resolve_alias,
                          "reader", WORKSPACE, "Common")
        self.assert_error("context_unavailable", self.registry.resolve_alias,
                          "reader", WORKSPACE, "missing alias")
        self.assertEqual(["PUBLIC", "SECOND"], self.ids(self.search("common")))

    def test_member_alias_resolution_is_dimension_scoped(self):
        self.publish(self.record("DIM_CHANNEL", "Channel"), self.record("DIM_PRODUCT", "Product"),
                     self.record("DIM_CHANNEL_ONLINE", "Online channel", aliases=["Online"],
                                 dimension="DIM_CHANNEL"),
                     self.record("DIM_PRODUCT_ONLINE", "Online product", aliases=["Online"],
                                 dimension="DIM_PRODUCT"))
        self.assert_error("context_unavailable", self.registry.resolve_alias,
                          "reader", WORKSPACE, "Online", kind="member")
        self.assertEqual({"id": "DIM_CHANNEL_ONLINE", "version": 1}, self.registry.resolve_alias(
            "reader", WORKSPACE, "ONLINE", kind="member", dimension="DIM_CHANNEL"))

    def test_drafts_and_approved_unpublished_records_never_enter_index(self):
        draft = self.record("DRAFT", "Unpublished secret")
        receipt = self.registry.submit("author", draft)
        self.assertEqual([], self.search("unpublished")["results"])
        self.registry.review("reviewer", WORKSPACE, "DRAFT", 1, receipt, "approved")
        self.assertEqual([], self.search("unpublished")["results"])
        self.assertEqual(0, self.registry.db.execute(
            "SELECT COUNT(*) FROM c_search_refs WHERE workspace=?", (WORKSPACE,)).fetchone()[0])

    def test_obsolete_names_aliases_and_stale_index_rows_never_deliver(self):
        old = self.record("REPLACED", "Old label", aliases=["obsolete alias"])
        self.publish(old)
        new = self.record("REPLACED", "New label", aliases=["current alias"], version=2)
        self.publish(new)
        self.assertEqual([], self.search("obsolete alias")["results"])
        self.assert_error("context_unavailable", self.registry.resolve_alias,
                          "reader", WORKSPACE, "obsolete alias")
        self.assertEqual(["REPLACED"], self.ids(self.search("current alias")))
        # Deliberately stale derived references must still fail the active-head join.
        self.registry.db.execute(
            "INSERT INTO c_search_exact(workspace,term,record_id,version,weight) VALUES(?,?,?,?,?)",
            (WORKSPACE, "obsolete alias", "REPLACED", 1, 80000))
        self.registry.db.commit()
        self.assertEqual([], self.search("obsolete alias")["results"])

    def test_revocation_expiry_and_source_drift_are_rechecked(self):
        base = self.record("DIM_COUNTRY", "Country")
        member = self.record("DIM_COUNTRY_AU", "Australia", aliases=["AU"], dimension="DIM_COUNTRY")
        self.publish(base, member)
        self.assertEqual(["DIM_COUNTRY_AU"], self.ids(self.search("Australia")))
        self.registry.revoke("releaser", WORKSPACE, "DIM_COUNTRY", 1)
        self.assertEqual([], self.search("Australia")["results"])
        self.assert_error("context_unavailable", self.registry.resolve_alias,
                          "reader", WORKSPACE, "AU")
        standalone = self.record("TIME_BOUND", "Expires")
        self.publish(standalone)
        self.now += timedelta(days=2)
        self.assertEqual([], self.search("Expires")["results"])
        self.now -= timedelta(days=2)
        self.source.write_text("Changed evidence.\n", encoding="utf-8")
        self.assertEqual([], self.search("Expires")["results"])

    def test_restricted_dependency_hides_public_metadata(self):
        self.publish(self.record("DIM_SECRET", "Restricted dimension", classification="restricted"),
                     self.record("DIM_SECRET_PUBLIC", "Public-looking secret alias", aliases=["discoverme"],
                                 dimension="DIM_SECRET"))
        self.assertEqual([], self.search("discoverme")["results"])
        self.assert_error("context_unavailable", self.registry.resolve_alias,
                          "reader", WORKSPACE, "discoverme")

    def test_dimension_and_member_filters_are_exact_and_bounded(self):
        self.publish(self.record("DIM_COUNTRY", "Country"), self.record("DIM_REGION", "Region"),
                     self.record("DIM_COUNTRY_AU", "Shared member", dimension="DIM_COUNTRY"),
                     self.record("DIM_REGION_AU", "Shared member", dimension="DIM_REGION"))
        self.assertEqual(["DIM_COUNTRY_AU"], self.ids(self.search(
            "shared", dimension="DIM_COUNTRY", member="DIM_COUNTRY_AU")))
        self.assertEqual([], self.search("shared", dimension="DIM_REGION", member="DIM_COUNTRY_AU")["results"])
        self.assertEqual(["DIM_COUNTRY_AU"], self.ids(self.search("shared", dimension="DIM_COUNTRY")))
        self.assertEqual([], self.search("shared", layer="data")["results"])
        self.assertEqual([], self.search("shared", kind="dimension")["results"])
        self.assert_error("invalid_request", self.search, "shared", member="DIM_COUNTRY_AU")
        self.assert_error("invalid_request", self.search, "shared", dimension="dim_country")
        self.assert_error("invalid_request", self.search, "shared", kind="unknown")

    def test_cursor_is_opaque_strict_and_bound_to_query_filters_page_and_actor(self):
        self.publish(*(self.record(name, "Shared item") for name in ("ALPHA", "BRAVO", "CHARLIE")))
        cursor = self.search("shared", page_size=1)["next_cursor"]
        self.assertLess(len(cursor), 2048)
        for fields in ({"page_size": 2}, {"page_size": 1, "layer": "ontology"},
                       {"page_size": 1, "kind": "dimension"}):
            self.assert_error("invalid_cursor", self.search, "shared", cursor=cursor, **fields)
        self.assert_error("invalid_cursor", self.search, "item", page_size=1, cursor=cursor)
        for invalid in (cursor + "x", "", "x" * 2049, True, {"id": "ALPHA"}):
            self.assert_error("invalid_cursor", self.search, "shared", page_size=1, cursor=invalid)

    def test_catalog_change_and_current_authorization_change_invalidate_cursor(self):
        self.publish(*(self.record(name, "Shared item") for name in ("ALPHA", "BRAVO", "CHARLIE")))
        cursor = self.search("shared", page_size=1)["next_cursor"]
        self.publish(self.record("UNRELATED", "Another item"))
        self.assert_error("stale_cursor", self.search, "shared", page_size=1, cursor=cursor)
        cursor = self.search("shared", page_size=1)["next_cursor"]
        self.registry.principals["reader"]["classifications"].append("restricted")
        self.assert_error("stale_cursor", self.search, "shared", page_size=1, cursor=cursor)
        self.registry.principals["reader"]["roles"] = []
        self.assert_error("context_unavailable", self.search, "shared")

    def test_cursor_survives_reopen_without_catalog_or_authority_change(self):
        self.publish(*(self.record(name, "Shared item") for name in ("ALPHA", "BRAVO", "CHARLIE")))
        first = self.search("shared", page_size=1)
        self.registry.close()
        self.registry = ComposableRegistry(self.directory / "registry.sqlite3", self.sources,
                                           self.principals, clock=lambda: self.now)
        second = self.search("shared", page_size=1, cursor=first["next_cursor"])
        self.assertEqual(["BRAVO"], self.ids(second))

    def test_index_and_search_preserve_other_workspaces_and_are_read_only(self):
        self.publish(self.record("ALPHA", "Shared item"))
        other_people = {
            actor: {**person, "workspace": "other-lab"}
            for actor, person in self.principals.items()
        }
        other = ComposableRegistry(self.directory / "registry.sqlite3", self.sources,
                                    other_people, clock=lambda: self.now)
        try:
            body = self.record("ALPHA", "Protected other workspace")
            receipt = other.submit("author", body)
            other.review("reviewer", "other-lab", "ALPHA", 1, receipt, "approved")
            other.publish("releaser", "other-lab", [{"id": "ALPHA", "version": 1}])
            self.assertEqual([], self.search("protected")["results"])
            self.assert_error("context_unavailable", self.registry.search,
                              "reader", "other-lab", "protected")
            queries = []
            self.registry.db.set_trace_callback(queries.append)
            self.search("shared")
            self.registry.resolve_alias("reader", WORKSPACE, "Shared item")
            self.registry.db.set_trace_callback(None)
            self.assertFalse(any(sql.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))
                                 for sql in queries))
            self.assertEqual(2, self.registry.db.execute(
                "SELECT COUNT(*) FROM c_search_refs").fetchone()[0])
        finally:
            other.close()

    def test_returned_closures_are_rechecked_before_delivery(self):
        self.publish(self.record("ALPHA", "Shared item"))
        closure = self.registry._closure
        calls = []

        def drift_after_first(*args, **kwargs):
            result = closure(*args, **kwargs)
            calls.append(1)
            if len(calls) == 1:
                self.source.write_text("Source changed during search.\n", encoding="utf-8")
            return result

        with patch.object(self.registry, "_closure", side_effect=drift_after_first):
            self.assert_error("context_unavailable", self.search, "shared")

    def test_invalid_request_limits_fail_without_querying_catalog(self):
        for query in ("", " ", "x" * 257, " ".join("term%d" % i for i in range(17)),
                      None, [], "\ud800"):
            self.assert_error("invalid_request", self.search, query)
        for size in (0, -1, 101, True, 1.5, "1"):
            self.assert_error("invalid_request", self.search, "valid", page_size=size)

    def test_candidate_budget_denies_search_and_alias_without_partial_delivery(self):
        drift = self.sources / "drift.txt"
        drift.write_text("Approved synthetic evidence.\n", encoding="utf-8")
        records = [self.record("ALPHA", "Visible", aliases=["Shared"]),
                   self.record("BRAVO", "Public one", aliases=["Shared"]),
                   self.record("CHARLIE", "Public two", aliases=["Shared"])]
        for body in records[1:]:
            body["provenance"] = [{"path": "drift.txt", "sha256":
                                   hashlib.sha256(drift.read_bytes()).hexdigest()}]
        self.publish(*records)
        drift.write_text("Source changed after publication.\n", encoding="utf-8")
        candidate = self.registry._search_candidate
        with patch("pilot.composable_search.MAX_SEARCH_CANDIDATES", 2, create=True):
            with patch.object(self.registry, "_search_candidate", wraps=candidate) as checked:
                self.assert_error("context_unavailable", self.search, "shared")
                self.assertLessEqual(checked.call_count, 2)
            with patch.object(self.registry, "_search_candidate", wraps=candidate) as checked:
                self.assert_error("context_unavailable", self.registry.resolve_alias,
                                  "reader", WORKSPACE, "Shared")
                self.assertLessEqual(checked.call_count, 2)
        self.assertEqual(["ALPHA"], self.ids(self.search("shared")))
        self.assertEqual({"id": "ALPHA", "version": 1},
                         self.registry.resolve_alias("reader", WORKSPACE, "Shared"))

    def assert_filtered_before_budget(self, query):
        candidate = self.registry._search_candidate
        with patch("pilot.composable_search.MAX_SEARCH_CANDIDATES", 2):
            with patch.object(self.registry, "_search_candidate", wraps=candidate) as checked:
                self.assertEqual(self.search("unmatched"), self.search(query))
                self.assertEqual(0, checked.call_count)
            with patch.object(self.registry, "_search_candidate", wraps=candidate) as checked:
                self.assert_error("context_unavailable", self.registry.resolve_alias,
                                  "reader", WORKSPACE, query)
                self.assertEqual(0, checked.call_count)

    def test_restricted_matches_are_filtered_before_candidate_budget(self):
        self.publish(*(self.record("HIDDEN_%d" % i, "Protected marker", aliases=["Protected"],
                                   classification="restricted") for i in range(3)))
        self.assert_filtered_before_budget("Protected")

    def test_transitively_restricted_dependencies_are_filtered_before_budget(self):
        self.publish(self.record("DIM_SECRET", "Restricted", classification="restricted"),
                     self.record("DIM_SECRET_PARENT", "Parent", dimension="DIM_SECRET"))
        children = []
        for index in range(3):
            body = self.record("DIM_SECRET_CHILD%d" % index, "Protected branch", aliases=["Protected"],
                               dimension="DIM_SECRET")
            body["spec"]["parents"] = ["DIM_SECRET_PARENT"]
            body["dependencies"].append({"id": "DIM_SECRET_PARENT", "version": 1})
            children.append(body)
        self.publish(*children)
        self.assert_filtered_before_budget("Protected")

    def test_revoked_dependencies_are_filtered_before_candidate_budget(self):
        self.publish(self.record("DIM_COUNTRY", "Country"), *(self.record(
            "DIM_COUNTRY_CHILD%d" % index, "Revoked branch", aliases=["Revoked"], dimension="DIM_COUNTRY")
            for index in range(3)))
        self.registry.revoke("releaser", WORKSPACE, "DIM_COUNTRY", 1)
        self.assert_filtered_before_budget("Revoked")

    def test_expired_dependencies_are_filtered_before_candidate_budget(self):
        dimension = self.record("DIM_COUNTRY", "Country")
        dimension["valid_until"] = (self.now + timedelta(hours=1)).isoformat()
        self.publish(dimension, *(self.record(
            "DIM_COUNTRY_CHILD%d" % index, "Expired branch", aliases=["Expired"], dimension="DIM_COUNTRY")
            for index in range(3)))
        self.now += timedelta(hours=2)
        self.assert_filtered_before_budget("Expired")

    def test_sql_budget_interrupts_and_always_clears_progress_handler(self):
        self.publish(self.record("ALPHA", "Indexed item", aliases=["Shared"]))
        with patch("pilot.composable_search.MAX_SEARCH_SQL_STEPS", 1, create=True):
            self.assert_error("context_unavailable", self.search, "indexed")
            # This statement bypasses the search wrapper; a leaked one-step
            # progress handler would interrupt it as well.
            self.assertEqual(1, self.registry.db.execute("SELECT 1").fetchone()[0])
            self.assert_error("context_unavailable", self.registry.resolve_alias,
                              "reader", WORKSPACE, "Shared")
            self.assertEqual(1, self.registry.db.execute("SELECT 1").fetchone()[0])
        self.assertEqual(["ALPHA"], self.ids(self.search("ALPHA")))

    def test_candidate_queries_use_inverted_lookup_and_active_head_indexes(self):
        self.publish(self.record("ALPHA", "Indexed item"))
        statements = []
        self.registry.db.set_trace_callback(statements.append)
        self.assertEqual(["ALPHA"], self.ids(self.search("indexed")))
        self.registry.db.set_trace_callback(None)
        lookups = [sql for sql in statements if "c_search_tokens" in sql and sql.lstrip().upper().startswith("WITH")]
        self.assertTrue(lookups, statements)
        plan = self.registry.db.execute("EXPLAIN QUERY PLAN " + lookups[0]).fetchall()
        descriptions = "\n".join(str(row[3]) for row in plan)
        self.assertIn("c_search_tokens_lookup", descriptions)
        self.assertNotIn("SCAN c_records", descriptions)
        self.assertNotIn("SCAN c_heads", descriptions)
        self.assertIn("(workspace=? AND id=? AND version=?)", descriptions)


if __name__ == "__main__":
    unittest.main()
