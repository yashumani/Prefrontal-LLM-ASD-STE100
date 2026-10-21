"""Additive, bounded SQLite registry for independently composed context records.

Configured local roles are a simulation, not enterprise authentication. Database
and file operators remain trusted. Approved prose is data, never executable
instructions. No selector permutations or whole-catalog manifests are stored.
"""
from contextlib import contextmanager
import copy
import hashlib
import json
from pathlib import Path
import re
import sqlite3

from .context_pilot import ContextError, canonical, digest, parse_time, utc_now, MAX_SOURCE_BYTES
from .composable_model import validate_record
from .composable_search import SearchMixin


CONTRACT = "prefrontal.composition.v1"
MAX_BATCH = 256
MAX_DEPTH = 16
MAX_CLOSURE_RECORDS = 128
MAX_CLOSURE_BYTES = 1048576
MAX_AFFECTED = 2048
DECISIONS = {"approved", "rejected", "changes_requested"}


class ComposableRegistry(SearchMixin):
    """Exact-version review, incremental publication and live context composition."""

    def __init__(self, database, source_root, principals, clock=utc_now):
        self.root = Path(source_root).resolve()
        self.principals = principals if callable(principals) else copy.deepcopy(principals)
        self.clock = clock
        self.db = sqlite3.connect(str(database), isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA busy_timeout=5000")
        self._savepoint = 0
        self._closed = False
        try:
            tables = {row[0] for row in self.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
            if tables:
                if "registry_config" in tables or "c_config" not in tables:
                    raise ContextError("profile_mismatch")
                marker = self.db.execute("SELECT value FROM c_config WHERE key='profile'").fetchone()
                if marker is None or marker[0] != "prefrontal.composable.v1":
                    raise ContextError("profile_mismatch")
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS c_config(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS c_records(
                    workspace TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,
                    body TEXT NOT NULL,hash TEXT NOT NULL,submitter TEXT NOT NULL,
                    state TEXT NOT NULL DEFAULT 'draft',reviewer TEXT,revoked INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(workspace,id,version));
                CREATE TABLE IF NOT EXISTS c_heads(
                    workspace TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,
                    PRIMARY KEY(workspace,id),
                    FOREIGN KEY(workspace,id,version) REFERENCES c_records(workspace,id,version));
                CREATE TABLE IF NOT EXISTS c_meta(workspace TEXT PRIMARY KEY,revision INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS c_dependencies(
                    workspace TEXT NOT NULL,record_id TEXT NOT NULL,version INTEGER NOT NULL,
                    dependency_id TEXT NOT NULL,dependency_version INTEGER NOT NULL,
                    PRIMARY KEY(workspace,record_id,version,dependency_id));
                CREATE INDEX IF NOT EXISTS c_dependencies_reverse
                    ON c_dependencies(workspace,dependency_id,record_id,version);
                CREATE TABLE IF NOT EXISTS c_events(
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,workspace TEXT NOT NULL,
                    actor TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL);
            """)
            stored = self.db.execute("SELECT value FROM c_config WHERE key='profile'").fetchone()
            if stored is not None and stored[0] != "prefrontal.composable.v1":
                raise ContextError("profile_mismatch")
            if stored is None:
                self.db.execute("INSERT INTO c_config VALUES('profile','prefrontal.composable.v1')")
            self._search_schema(self.db)
        except Exception:
            self.db.close()
            raise

    def close(self):
        if not self._closed:
            self.db.close()
            self._closed = True

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    @contextmanager
    def transaction(self):
        """Allow explicit trusted bulk work; nested methods use savepoints."""
        nested = self.db.in_transaction
        self._savepoint += 1
        name = "c_op_" + str(self._savepoint)
        self.db.execute("SAVEPOINT " + name if nested else "BEGIN IMMEDIATE")
        try:
            yield self
            self.db.execute("RELEASE SAVEPOINT " + name if nested else "COMMIT")
        except BaseException:
            if nested:
                self.db.execute("ROLLBACK TO SAVEPOINT " + name)
                self.db.execute("RELEASE SAVEPOINT " + name)
            else:
                self.db.execute("ROLLBACK")
            raise

    def current_principal(self, actor):
        try:
            if not isinstance(actor, str) or not actor:
                raise ValueError()
            people = self.principals() if callable(self.principals) else self.principals
            person = json.loads(canonical(people.get(actor))) if isinstance(people, dict) else None
            if (not isinstance(person, dict) or not isinstance(person.get("workspace"), str)
                    or not person["workspace"] or not isinstance(person.get("roles"), list)
                    or not isinstance(person.get("classifications"), list)):
                raise ValueError()
            return person
        except Exception:
            raise ContextError("access_denied") from None

    def _principal(self, actor, workspace, role):
        person = self.current_principal(actor)
        if person["workspace"] != workspace or role not in person["roles"]:
            raise ContextError("access_denied")
        return person

    def _authority(self, actor, workspace, role="consumer"):
        person = self._principal(actor, workspace, role)
        return person, digest(person)

    def authorize_source(self, actor, binding, workspace=None):
        person = self.current_principal(actor)
        workspace = person["workspace"] if workspace is None else workspace
        person = self._principal(actor, workspace, "consumer")
        if (not isinstance(binding, str) or not isinstance(person.get("source_bindings"), list)
                or binding not in person["source_bindings"]):
            raise ContextError("access_denied")
        return person

    def _path(self, relative):
        if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
            raise ContextError("invalid_source")
        target = (self.root / relative).resolve()
        if self.root not in target.parents:
            raise ContextError("invalid_source")
        return target

    def source_hash(self, relative):
        try:
            with self._path(relative).open("rb") as stream:
                content = stream.read(MAX_SOURCE_BYTES + 1)
            if len(content) > MAX_SOURCE_BYTES:
                raise ContextError("source_too_large")
            return hashlib.sha256(content).hexdigest()
        except OSError:
            raise ContextError("source_unavailable") from None

    def evidence(self, relative):
        return {"path": relative, "sha256": self.source_hash(relative)}

    def _revision(self, workspace):
        row = self.db.execute("SELECT revision FROM c_meta WHERE workspace=?", (workspace,)).fetchone()
        return row[0] if row else 0

    def _row(self, workspace, identifier, version):
        return self.db.execute("SELECT * FROM c_records WHERE workspace=? AND id=? AND version=?",
                               (workspace, identifier, version)).fetchone()

    def _selected(self, workspace, identifier):
        return self.db.execute("SELECT r.* FROM c_heads h JOIN c_records r ON "
                               "r.workspace=h.workspace AND r.id=h.id AND r.version=h.version "
                               "WHERE h.workspace=? AND h.id=?", (workspace, identifier)).fetchone()

    def _event(self, actor, workspace, action, details):
        self.db.execute("INSERT INTO c_events(at,workspace,actor,action,details) VALUES(?,?,?,?,?)",
                        (self.clock().isoformat(), workspace, actor, action, canonical(details)))

    def _check_authority(self, actor, workspace, expected, role="consumer"):
        if self._authority(actor, workspace, role)[1] != expected:
            raise ContextError("access_denied")

    def _check_sources(self, body):
        now = self.clock()
        if (now.tzinfo is None or now < parse_time(body["valid_from"])
                or (body["valid_until"] is not None and now >= parse_time(body["valid_until"]))):
            raise ContextError("context_unavailable")
        for item in body["provenance"]:
            if self.source_hash(item["path"]) != item["sha256"]:
                raise ContextError("context_unavailable")
        if body["kind"] == "source":
            age = (now - parse_time(body["spec"]["checked_at"])).total_seconds()
            if not 0 <= age <= body["spec"]["freshness_seconds"]:
                raise ContextError("context_unavailable")

    def _checked_record(self, actor, workspace, identifier, version, require_active=True, role="consumer"):
        try:
            person = self._principal(actor, workspace, role)
            row = self._row(workspace, identifier, version)
            if row is None or row["state"] != "approved" or row["revoked"] or not row["reviewer"]:
                raise ContextError("context_unavailable")
            if require_active:
                head = self._selected(workspace, identifier)
                if head is None or head["version"] != version:
                    raise ContextError("context_unavailable")
            body = validate_record(json.loads(row["body"]))
            if body["classification"] not in person["classifications"] or digest(body) != row["hash"]:
                raise ContextError("context_unavailable")
            self._check_sources(body)
            return {"record": body, "hash": row["hash"], "reviewer": row["reviewer"]}
        except (ContextError, ValueError, TypeError, KeyError, OSError):
            raise ContextError("context_unavailable") from None

    def _closure(self, actor, workspace, record, *, role="consumer", require_active=True):
        """Traverse every path; a shallow visit never hides a longer invalid path."""
        _, authority = self._authority(actor, workspace, role)
        revision = self._revision(workspace)
        found, versions, depth_cache, visiting = {}, {}, {}, set()
        total_bytes = [0]
        def visit(identifier, version, depth):
            if depth > MAX_DEPTH or (identifier in versions and versions[identifier] != version):
                raise ContextError("context_unavailable")
            key = (identifier, version)
            if key in visiting:
                raise ContextError("context_unavailable")
            if key in depth_cache:
                if depth + depth_cache[key] > MAX_DEPTH:
                    raise ContextError("context_unavailable")
                return depth_cache[key]
            envelope = self._checked_record(actor, workspace, identifier, version, require_active, role)
            versions[identifier] = version
            found[key] = envelope
            total_bytes[0] += len(canonical(envelope).encode("utf-8"))
            if len(found) > MAX_CLOSURE_RECORDS or total_bytes[0] > MAX_CLOSURE_BYTES:
                raise ContextError("context_unavailable")
            visiting.add(key)
            longest = 0
            for dependency in envelope["record"]["dependencies"]:
                longest = max(longest, 1 + visit(dependency["id"], dependency["version"], depth + 1))
            visiting.remove(key)
            depth_cache[key] = longest
            self._compatible(envelope["record"], found)
            return longest
        visit(record["id"], record["version"], 0)
        self._check_authority(actor, workspace, authority, role)
        if self._revision(workspace) != revision:
            raise ContextError("context_unavailable")
        return [found[key] for key in sorted(found)]

    @staticmethod
    def _compatible(body, found):
        deps = {item["id"]: item["version"] for item in body["dependencies"]}
        def linked(identifier, kind):
            version = deps.get(identifier)
            envelope = found.get((identifier, version))
            if envelope is None or envelope["record"]["kind"] != kind:
                raise ContextError("context_unavailable")
            return envelope["record"]
        spec = body["spec"]
        if body["kind"] == "measure":
            source = linked(spec["source"], "source")
            dimensions = spec["required_dimensions"] + spec["optional_dimensions"]
            for identifier in dimensions:
                linked(identifier, "dimension")
                if identifier not in source["spec"]["dimensions"]:
                    raise ContextError("context_unavailable")
            for identifier in spec["guidance"]:
                linked(identifier, "guidance")
            if set(deps) != {spec["source"], *dimensions, *spec["guidance"]}:
                raise ContextError("context_unavailable")
        elif body["kind"] == "member":
            dimension = linked(spec["dimension"], "dimension")
            value, kind = spec["value"], dimension["spec"]["value_type"]
            if ((kind == "integer" and type(value) is not int)
                    or (kind in {"text", "period"} and not isinstance(value, str))
                    or (kind == "period" and not re.fullmatch(r"[0-9]{4}-(?:0[1-9]|1[0-2])", value))):
                raise ContextError("context_unavailable")
            for identifier in spec["parents"]:
                parent = linked(identifier, "member")
                if parent["spec"]["dimension"] != spec["dimension"]:
                    raise ContextError("context_unavailable")
            if set(deps) != {spec["dimension"], *spec["parents"]}:
                raise ContextError("context_unavailable")

    def submit(self, actor, record):
        return self.submit_batch(actor, [record])[0]

    def submit_batch(self, actor, records):
        if not isinstance(records, list) or not 1 <= len(records) <= MAX_BATCH:
            raise ContextError("invalid_batch")
        person = self.current_principal(actor)
        workspace = person["workspace"]
        person, authority = self._authority(actor, workspace, "submitter")
        bodies = [validate_record(item) for item in records]
        if len({(body["id"], body["version"]) for body in bodies}) != len(bodies):
            raise ContextError("invalid_batch")
        hashes = []
        with self.transaction():
            for body in bodies:
                if body["classification"] not in person["classifications"]:
                    raise ContextError("access_denied")
                self._check_sources(body)
                encoded, expected = canonical(body), digest(body)
                existing = self._row(workspace, body["id"], body["version"])
                if existing:
                    if existing["hash"] != expected or existing["body"] != encoded:
                        raise ContextError("immutable_version")
                else:
                    self.db.execute("INSERT INTO c_records(workspace,id,version,body,hash,submitter) VALUES(?,?,?,?,?,?)",
                                    (workspace, body["id"], body["version"], encoded, expected, actor))
                    self.db.executemany("INSERT INTO c_dependencies VALUES(?,?,?,?,?)", [
                        (workspace, body["id"], body["version"], dep["id"], dep["version"]) for dep in body["dependencies"]])
                    self._event(actor, workspace, "submitted", {"id": body["id"], "version": body["version"], "hash": expected})
                hashes.append(expected)
            self._check_authority(actor, workspace, authority, "submitter")
        return hashes

    def review(self, actor, workspace, identifier, version, expected_hash, decision):
        _, authority = self._authority(actor, workspace, "reviewer")
        if decision not in DECISIONS:
            raise ContextError("invalid_decision")
        with self.transaction():
            row = self._row(workspace, identifier, version)
            if (row is None or row["submitter"] == actor or row["state"] != "draft" or row["revoked"]
                    or row["hash"] != expected_hash or digest(json.loads(row["body"])) != expected_hash):
                raise ContextError("review_blocked")
            body = validate_record(json.loads(row["body"]))
            if body["classification"] not in self._principal(actor, workspace, "reviewer")["classifications"]:
                raise ContextError("access_denied")
            self.db.execute("UPDATE c_records SET state=?,reviewer=? WHERE workspace=? AND id=? AND version=?",
                            (decision, actor, workspace, identifier, version))
            self._event(actor, workspace, "reviewed", {"id": identifier, "version": version, "hash": expected_hash, "decision": decision})
            self._check_authority(actor, workspace, authority, "reviewer")
        return {"id": identifier, "version": version, "hash": expected_hash, "decision": decision}

    def _affected(self, workspace, identifiers):
        affected, pending = set(identifiers), list(identifiers)
        while pending:
            identifier = pending.pop()
            rows = self.db.execute("SELECT d.record_id FROM c_dependencies d JOIN c_heads h ON "
                "h.workspace=d.workspace AND h.id=d.record_id AND h.version=d.version "
                "WHERE d.workspace=? AND d.dependency_id=? LIMIT ?", (workspace, identifier, MAX_AFFECTED + 1)).fetchall()
            for row in rows:
                if row[0] not in affected:
                    affected.add(row[0]); pending.append(row[0])
                    if len(affected) > MAX_AFFECTED:
                        raise ContextError("publication_too_large")
        return affected

    def publish(self, actor, workspace, records, expected_revision=None):
        _, authority = self._authority(actor, workspace, "releaser")
        if (not isinstance(records, list) or not 1 <= len(records) <= MAX_BATCH
                or any(not isinstance(item, dict) or set(item) != {"id", "version"}
                       or not isinstance(item["id"], str) or type(item["version"]) is not int for item in records)
                or len({item["id"] for item in records}) != len(records)
                or (expected_revision is not None and (type(expected_revision) is not int or expected_revision < 0))):
            raise ContextError("invalid_publication")
        with self.transaction():
            revision = self._revision(workspace)
            if expected_revision is not None and revision != expected_revision:
                raise ContextError("revision_conflict")
            for item in records:
                self._checked_record(actor, workspace, item["id"], item["version"], False, "releaser")
                head = self._selected(workspace, item["id"])
                if head is not None and item["version"] < head["version"]:
                    raise ContextError("immutable_version")
                self.db.execute("INSERT INTO c_heads VALUES(?,?,?) ON CONFLICT(workspace,id) DO UPDATE SET version=excluded.version",
                                (workspace, item["id"], item["version"]))
            affected = self._affected(workspace, [item["id"] for item in records])
            for identifier in sorted(affected):
                row = self._selected(workspace, identifier)
                self._closure(actor, workspace, json.loads(row["body"]), role="releaser")
            for item in records:
                self._index_record(self.db, workspace, json.loads(self._row(workspace, item["id"], item["version"])["body"]))
            self._check_authority(actor, workspace, authority, "releaser")
            self.db.execute("INSERT INTO c_meta VALUES(?,?) ON CONFLICT(workspace) DO UPDATE SET revision=excluded.revision", (workspace, revision + 1))
            self._event(actor, workspace, "published", {"records": records, "revision": revision + 1})
            self._check_authority(actor, workspace, authority, "releaser")
        return revision + 1

    def revoke(self, actor, workspace, identifier, version):
        _, authority = self._authority(actor, workspace, "releaser")
        with self.transaction():
            row = self._row(workspace, identifier, version)
            if row is None:
                raise ContextError("context_unavailable")
            body = validate_record(json.loads(row["body"]))
            if body["classification"] not in self._principal(actor, workspace, "releaser")["classifications"]:
                raise ContextError("access_denied")
            if not row["revoked"]:
                self.db.execute("UPDATE c_records SET revoked=1 WHERE workspace=? AND id=? AND version=?", (workspace, identifier, version))
                revision = self._revision(workspace) + 1
                self.db.execute("INSERT INTO c_meta VALUES(?,?) ON CONFLICT(workspace) DO UPDATE SET revision=excluded.revision", (workspace, revision))
                self._event(actor, workspace, "revoked", {"id": identifier, "version": version})
            self._check_authority(actor, workspace, authority, "releaser")

    def _lookup(self, actor, workspace, value, kind, dimension=None):
        if not isinstance(value, str) or not value.strip() or len(value) > 256:
            raise ContextError("context_unavailable")
        row = self._selected(workspace, value)
        if row is not None:
            try:
                envelope = self._checked_record(actor, workspace, row["id"], row["version"])
                body = envelope["record"]
                self._closure(actor, workspace, body)
                if body["kind"] == kind and (dimension is None or body["spec"].get("dimension") == dimension):
                    return body
            except ContextError:
                pass
        reference = self.resolve_alias(actor, workspace, value, kind=kind, dimension=dimension)
        return self._checked_record(actor, workspace, reference["id"], reference["version"])["record"]

    def resolve(self, actor, workspace, measure, selectors):
        try:
            _, authority = self._authority(actor, workspace)
            revision = self._revision(workspace)
            if not isinstance(selectors, list) or len(selectors) > 32:
                raise ContextError("context_unavailable")
            metric = self._lookup(actor, workspace, measure, "measure")
            chosen, by_dimension = [], {}
            for selector in selectors:
                dimension = None
                if isinstance(selector, str):
                    token = selector
                elif isinstance(selector, dict) and set(selector) == {"dimension", "member"}:
                    dimension = self._lookup(actor, workspace, selector["dimension"], "dimension")["id"]
                    token = selector["member"]
                else:
                    raise ContextError("context_unavailable")
                member = self._lookup(actor, workspace, token, "member", dimension)
                dimension = member["spec"]["dimension"]
                if dimension in by_dimension:
                    raise ContextError("context_unavailable")
                by_dimension[dimension] = member
                chosen.append(member)
            spec = metric["spec"]
            if (not set(spec["required_dimensions"]) <= set(by_dimension)
                    or not set(by_dimension) <= set(spec["required_dimensions"] + spec["optional_dimensions"])):
                raise ContextError("context_unavailable")
            envelopes = {}
            for body in [metric] + chosen:
                for envelope in self._closure(actor, workspace, body):
                    key = envelope["record"]["id"]
                    if key in envelopes and envelopes[key]["hash"] != envelope["hash"]:
                        raise ContextError("context_unavailable")
                    envelopes[key] = envelope
            if len(envelopes) > MAX_CLOSURE_RECORDS:
                raise ContextError("context_unavailable")
            result = {"contract": CONTRACT, "workspace": workspace,
                      "measure": {"id": metric["id"], "version": metric["version"]},
                      "selectors": sorted([{"dimension": body["spec"]["dimension"], "id": body["id"],
                          "version": body["version"], "value": body["spec"]["value"]} for body in chosen], key=lambda item: (item["dimension"], item["id"])),
                      "records": [envelopes[key] for key in sorted(envelopes)], "catalog_revision": revision,
                      "provenance": sorted([dict(path=path, sha256=sha) for path, sha in {
                          (item["path"], item["sha256"]) for envelope in envelopes.values() for item in envelope["record"]["provenance"]} ], key=lambda item: (item["path"], item["sha256"])),
                      "recheck_at_use": True}
            result["bundle_hash"] = digest(result)
            if len(canonical(result).encode("utf-8")) > MAX_CLOSURE_BYTES:
                raise ContextError("context_unavailable")
            for envelope in envelopes.values():
                self._checked_record(actor, workspace, envelope["record"]["id"], envelope["record"]["version"])
            self._check_authority(actor, workspace, authority)
            if revision != self._revision(workspace):
                raise ContextError("context_unavailable")
            return result
        except (ContextError, KeyError, TypeError, ValueError, sqlite3.Error, RecursionError):
            raise ContextError("context_unavailable") from None

    def revalidate(self, actor, bundle):
        try:
            if (not isinstance(bundle, dict)
                    or set(bundle) != {"contract", "workspace", "measure", "selectors", "records", "catalog_revision", "provenance", "recheck_at_use", "bundle_hash"}
                    or bundle.get("contract") != CONTRACT
                    or bundle.get("bundle_hash") != digest({key: value for key, value in bundle.items() if key != "bundle_hash"})):
                raise ContextError("context_unavailable")
            current = self.resolve(actor, bundle["workspace"], bundle["measure"]["id"], [item["id"] for item in bundle["selectors"]])
            if current["bundle_hash"] != bundle["bundle_hash"]:
                raise ContextError("context_unavailable")
            return current
        except (ContextError, KeyError, TypeError, ValueError):
            raise ContextError("context_unavailable") from None

    def get_record(self, actor, workspace, identifier, version=None):
        if version is None:
            row = self._selected(workspace, identifier)
            if row is None:
                raise ContextError("context_unavailable")
            version = row["version"]
        envelope = self._checked_record(actor, workspace, identifier, version)
        self._closure(actor, workspace, envelope["record"])
        return envelope["record"]

    def validate(self, actor, record):
        person = self.current_principal(actor)
        workspace = person["workspace"]
        person, authority = self._authority(actor, workspace, "submitter")
        try:
            body = validate_record(record)
            if body["classification"] not in person["classifications"]:
                raise ContextError("access_denied")
            expected = digest(body)
            row = self._row(workspace, body["id"], body["version"])
            state = ("revoked" if row["revoked"] else row["state"]) if row is not None and row["hash"] == expected else "unsubmitted"
            head = self._selected(workspace, body["id"])
            result = {"contract": "prefrontal.context.validation.v1", "valid": True, "hash": expected,
                      "approval_state": state, "approved": state == "approved",
                      "active": head is not None and head["version"] == body["version"] and state == "approved"}
        except ContextError as error:
            result = {"contract": "prefrontal.context.validation.v1", "valid": False, "error": error.code,
                      "approval_state": "unsubmitted", "approved": False, "active": False}
        self._check_authority(actor, workspace, authority, "submitter")
        return result


Registry = ComposableRegistry
