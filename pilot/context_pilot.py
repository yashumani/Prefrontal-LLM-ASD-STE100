"""A local registry and delivery contract with explicit lifecycle checks.

Principals are trusted local test configuration, not authenticated identities.
SQLite/files are writable by the local operator: this is not a security boundary
against someone who can edit the database, source tree, or this program.
"""

import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


LAYERS = {"data", "metric", "ontology", "interpretation"}
CLASSIFICATIONS = {"internal", "restricted"}
CONTRACT = "context.bundle.v1"
MAX_RECORD_BYTES = 8192
MAX_RECORDS = 16
MAX_BUNDLE_BYTES = 160000
MAX_SOURCE_BYTES = 1048576
MAX_REQUEST_BYTES = 4096


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def search_tokens(body):
    text = body["id"] + " " + body["claim"] + " " + canonical(body["content"])
    return canonical(sorted(set(re.findall(r"[a-z0-9]+", text.casefold()))))


def utc_now():
    return datetime.now(timezone.utc)


def parse_time(value):
    moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if moment.tzinfo is None:
        raise ValueError("timezone required")
    return moment


class ContextError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class Registry:
    def __init__(self, database, source_root, principals, clock=utc_now):
        self.root = Path(source_root).resolve()
        self.principals = json.loads(canonical(principals))
        self.clock = clock
        self.db = sqlite3.connect(str(database))
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS records (
                workspace TEXT, id TEXT, version INTEGER, body TEXT, hash TEXT,
                submitter TEXT, revoked INTEGER DEFAULT 0, review_state TEXT DEFAULT 'draft',
                PRIMARY KEY(workspace, id, version));
            CREATE TABLE IF NOT EXISTS approvals (
                workspace TEXT, id TEXT, version INTEGER, hash TEXT, reviewer TEXT,
                PRIMARY KEY(workspace, id, version));
            CREATE TABLE IF NOT EXISTS releases (
                workspace TEXT, name TEXT, manifest TEXT, hash TEXT,
                PRIMARY KEY(workspace, name));
            CREATE TABLE IF NOT EXISTS active (
                workspace TEXT PRIMARY KEY, release TEXT);
            CREATE TABLE IF NOT EXISTS search_refs (
                workspace TEXT, release TEXT, record_id TEXT, version INTEGER, tokens TEXT,
                PRIMARY KEY(workspace, release, record_id));
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, actor TEXT,
                workspace TEXT, action TEXT, details TEXT);
        """)

    def close(self):
        self.db.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _event(self, actor, workspace, action, details):
        self.db.execute(
            "INSERT INTO events(at,actor,workspace,action,details) VALUES(?,?,?,?,?)",
            (self.clock().isoformat(), actor, workspace, action, canonical(details)),
        )

    def _principal(self, actor, workspace, role):
        person = self.principals.get(actor, {})
        if person.get("workspace") != workspace or role not in person.get("roles", []):
            raise ContextError("access_denied")
        return person

    def _path(self, relative):
        if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
            raise ContextError("invalid_source")
        path = (self.root / relative).resolve()
        if self.root not in path.parents:
            raise ContextError("invalid_source")
        return path

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

    def _validate_body(self, body):
        required = {"id", "version", "workspace", "layer", "owner", "claim",
                    "classification", "valid_from", "valid_until", "evidence",
                    "dependencies", "content"}
        if not isinstance(body, dict) or set(body) != required:
            raise ContextError("invalid_record")
        if (not isinstance(body["id"], str)
                or not re.fullmatch(r"[a-z][a-z0-9_.:-]{1,100}", body["id"])
                or type(body["version"]) is not int or body["version"] < 1
                or not isinstance(body["workspace"], str) or not body["workspace"]
                or not isinstance(body["layer"], str) or body["layer"] not in LAYERS
                or not isinstance(body["classification"], str)
                or body["classification"] not in CLASSIFICATIONS
                or any(not isinstance(body[key], str) or not body[key].strip()
                       for key in ("owner", "claim"))
                or not isinstance(body["content"], dict)):
            raise ContextError("invalid_record")
        try:
            if parse_time(body["valid_from"]) >= parse_time(body["valid_until"]):
                raise ValueError("invalid interval")
            if len(canonical(body).encode("utf-8")) > MAX_RECORD_BYTES:
                raise ContextError("record_too_large")
        except (ValueError, TypeError, AttributeError):
            raise ContextError("invalid_record") from None
        evidence = body["evidence"]
        deps = body["dependencies"]
        if not isinstance(evidence, list) or not evidence or not isinstance(deps, list):
            raise ContextError("invalid_record")
        for item in evidence:
            if (not isinstance(item, dict) or set(item) != {"path", "sha256"}
                    or not isinstance(item["sha256"], str)
                    or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"])):
                raise ContextError("invalid_record")
            self._path(item["path"])
        for dep in deps:
            if (not isinstance(dep, dict) or set(dep) != {"id", "version"}
                    or not isinstance(dep["id"], str)
                    or type(dep["version"]) is not int or dep["version"] < 1):
                raise ContextError("invalid_record")
        if len({(d["id"], d["version"]) for d in deps}) != len(deps):
            raise ContextError("invalid_record")
        if body["layer"] != "data" and not deps:
            raise ContextError("missing_dependencies")
        content_fields = {
            "data": {"source", "unit", "period", "grain"},
            "metric": {"unit", "period", "grain", "population", "exceptions",
                       "formula", "native_query", "native_revision"},
            "ontology": {"aliases", "concept"},
            "interpretation": {"assumptions", "limits"},
        }
        if not content_fields[body["layer"]].issubset(body["content"]):
            raise ContextError("invalid_record")
        list_fields = {"aliases", "assumptions", "limits"}
        for key in content_fields[body["layer"]]:
            value = body["content"][key]
            if key in list_fields:
                if (not isinstance(value, list) or not value
                        or any(not isinstance(v, str) or not v.strip() for v in value)):
                    raise ContextError("invalid_record")
            elif not isinstance(value, str) or not value.strip():
                raise ContextError("invalid_record")

    def submit(self, actor, body):
        self._validate_body(body)
        workspace = body["workspace"]
        self._principal(actor, workspace, "submitter")
        identity = (workspace, body["id"], body["version"])
        content_hash = digest(body)
        row = self.db.execute(
            "SELECT hash FROM records WHERE workspace=? AND id=? AND version=?", identity
        ).fetchone()
        if row:
            if row["hash"] == content_hash:
                return content_hash  # Idempotent retry, no new approval or event.
            raise ContextError("immutable_version")
        previous = self.db.execute(
            "SELECT MAX(version) FROM records WHERE workspace=? AND id=?", identity[:2]
        ).fetchone()[0] or 0
        if body["version"] != previous + 1:
            raise ContextError("version_conflict")
        with self.db:
            self.db.execute("INSERT INTO records(workspace,id,version,body,hash,submitter) "
                            "VALUES(?,?,?,?,?,?)",
                            (*identity, canonical(body), content_hash, actor))
            self._event(actor, workspace, "submitted", {"id": body["id"],
                        "version": body["version"], "hash": content_hash})
        return content_hash

    def _row(self, workspace, record_id, version):
        row = self.db.execute(
            "SELECT * FROM records WHERE workspace=? AND id=? AND version=?",
            (workspace, record_id, version),
        ).fetchone()
        if not row:
            raise ContextError("record_unavailable")
        return row

    def _current(self, row, require_approval=True):
        body = json.loads(row["body"])
        if digest(body) != row["hash"]:
            raise ContextError("integrity_failure")
        if row["revoked"]:
            raise ContextError("revoked")
        now = self.clock()
        if now < parse_time(body["valid_from"]) or now >= parse_time(body["valid_until"]):
            raise ContextError("outside_validity")
        for evidence in body["evidence"]:
            if self.source_hash(evidence["path"]) != evidence["sha256"]:
                raise ContextError("stale_source")
        if require_approval:
            approval = self.db.execute(
                "SELECT * FROM approvals WHERE workspace=? AND id=? AND version=?",
                (row["workspace"], row["id"], row["version"]),
            ).fetchone()
            if not approval or approval["hash"] != row["hash"]:
                raise ContextError("unapproved")
        return body

    def approve(self, actor, workspace, record_id, version, expected_hash):
        self._principal(actor, workspace, "reviewer")
        row = self._row(workspace, record_id, version)
        if row["submitter"] == actor:
            raise ContextError("self_approval")
        if expected_hash != row["hash"]:
            raise ContextError("approval_hash_mismatch")
        if row["review_state"] in {"rejected", "changes_requested"}:
            raise ContextError("review_blocked")
        self._current(row, require_approval=False)
        with self.db:
            prior = self.db.execute(
                "SELECT hash FROM approvals WHERE workspace=? AND id=? AND version=?",
                (workspace, record_id, version),
            ).fetchone()
            if prior:
                if prior[0] != expected_hash:
                    raise ContextError("integrity_failure")
                return
            self.db.execute("INSERT INTO approvals VALUES(?,?,?,?,?)",
                            (workspace, record_id, version, expected_hash, actor))
            self.db.execute("UPDATE records SET review_state='approved' "
                            "WHERE workspace=? AND id=? AND version=?",
                            (workspace, record_id, version))
            self._event(actor, workspace, "approved", {"id": record_id,
                        "version": version, "hash": expected_hash})

    def hold_review(self, actor, workspace, record_id, version, expected_hash, decision):
        self._principal(actor, workspace, "reviewer")
        if decision not in {"rejected", "changes_requested"}:
            raise ContextError("invalid_decision")
        row = self._row(workspace, record_id, version)
        if expected_hash != row["hash"]:
            raise ContextError("approval_hash_mismatch")
        if row["review_state"] != "draft":
            raise ContextError("review_blocked")
        with self.db:
            self.db.execute("UPDATE records SET review_state=? "
                            "WHERE workspace=? AND id=? AND version=?",
                            (decision, workspace, record_id, version))
            self._event(actor, workspace, "review_" + decision,
                        {"id": record_id, "version": version, "hash": expected_hash})

    def _bundle(self, workspace, manifest, actor=None):
        if not isinstance(manifest, dict) or not manifest or len(manifest) > MAX_RECORDS:
            raise ContextError("invalid_manifest")
        bodies = {}
        for record_id, version in manifest.items():
            if not isinstance(record_id, str) or type(version) is not int:
                raise ContextError("invalid_manifest")
            row = self._row(workspace, record_id, version)
            if actor:
                person = self._principal(actor, workspace, "consumer")
                classification = json.loads(row["body"])["classification"]
                if classification not in person.get("classifications", []):
                    raise ContextError("access_denied")
            bodies[record_id] = self._current(row)
        if {body["layer"] for body in bodies.values()} != LAYERS:
            raise ContextError("incomplete_layers")
        visiting, visited = set(), set()

        def visit(record_id):
            if record_id in visiting:
                raise ContextError("dependency_cycle")
            if record_id in visited:
                return
            visiting.add(record_id)
            for dep in bodies[record_id]["dependencies"]:
                if manifest.get(dep["id"]) != dep["version"]:
                    raise ContextError("dependency_mismatch")
                visit(dep["id"])
            visiting.remove(record_id)
            visited.add(record_id)

        for record_id in bodies:
            visit(record_id)
        for body in bodies.values():
            if body["layer"] in {"data", "metric"}:
                key = "source" if body["layer"] == "data" else "native_query"
                evidence = {e["path"]: e["sha256"] for e in body["evidence"]}
                source = body["content"][key]
                if source not in evidence:
                    raise ContextError("source_binding_mismatch")
                if (body["layer"] == "metric"
                        and body["content"]["native_revision"] != evidence[source]):
                    raise ContextError("source_binding_mismatch")
        return bodies

    def publish(self, actor, workspace, name, manifest):
        self._principal(actor, workspace, "publisher")
        if not isinstance(name, str) or not name.strip():
            raise ContextError("invalid_release")
        # Validation, release insert, audit and active-pointer update share a transaction.
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            bodies = self._bundle(workspace, manifest)
            manifest_hash = digest(manifest)
            existing = self.db.execute(
                "SELECT hash FROM releases WHERE workspace=? AND name=?", (workspace, name)
            ).fetchone()
            if existing and existing[0] != manifest_hash:
                raise ContextError("immutable_release")
            if not existing:
                self.db.execute("INSERT INTO releases VALUES(?,?,?,?)",
                                (workspace, name, canonical(manifest), manifest_hash))
            # Derived references, never a second authority. Rebuild even on reactivation.
            self.db.execute("DELETE FROM search_refs WHERE workspace=? AND release=?", (workspace, name))
            self.db.executemany("INSERT INTO search_refs VALUES(?,?,?,?,?)", [
                (workspace, name, rid, body["version"],
                 search_tokens(body))
                for rid, body in bodies.items()])
            self.db.execute("INSERT OR REPLACE INTO active VALUES(?,?)", (workspace, name))
            self._event(actor, workspace, "index_rebuilt", {"release": name, "references": len(bodies)})
            self._event(actor, workspace, "published", {"release": name,
                        "manifest_hash": manifest_hash})

    def active_release(self, workspace):
        row = self.db.execute("SELECT release FROM active WHERE workspace=?", (workspace,)).fetchone()
        return row[0] if row else None

    def revoke(self, actor, workspace, record_id, version):
        self._principal(actor, workspace, "reviewer")
        self._row(workspace, record_id, version)
        with self.db:
            self.db.execute("UPDATE records SET revoked=1 WHERE workspace=? AND id=? AND version=?",
                            (workspace, record_id, version))
            self._event(actor, workspace, "revoked", {"id": record_id, "version": version})

    def feedback(self, actor, workspace, release, text):
        self._principal(actor, workspace, "consumer")
        if not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise ContextError("invalid_feedback")
        if not self.db.execute("SELECT 1 FROM releases WHERE workspace=? AND name=?",
                               (workspace, release)).fetchone():
            raise ContextError("release_unavailable")
        with self.db:
            self._event(actor, workspace, "feedback_pending_review",
                        {"release": release, "text": text})

    def get(self, actor, workspace, metric_id, period, unit):
        self._principal(actor, workspace, "consumer")
        with self.db:
            self.db.execute("BEGIN")
            row = self.db.execute("""SELECT r.* FROM releases r JOIN active a
                ON r.workspace=a.workspace AND r.name=a.release WHERE a.workspace=?""",
                                  (workspace,)).fetchone()
            if not row:
                raise ContextError("release_unavailable")
            manifest = json.loads(row["manifest"])
            if digest(manifest) != row["hash"]:
                raise ContextError("integrity_failure")
            bodies = self._bundle(workspace, manifest, actor)
            metric = bodies.get(metric_id)
            if not metric or metric["layer"] != "metric":
                raise ContextError("metric_unavailable")
            if (metric["content"].get("period") != period
                    or metric["content"].get("unit") != unit):
                raise ContextError("scope_mismatch")
            records = []
            for record_id in sorted(bodies):
                body = bodies[record_id]
                approval = self.db.execute(
                    "SELECT reviewer FROM approvals WHERE workspace=? AND id=? AND version=?",
                    (workspace, record_id, body["version"]),
                ).fetchone()
                records.append({"record": body, "content_hash": digest(body),
                                "reviewed_by": approval[0]})
            output = {"contract": CONTRACT, "workspace": workspace, "release": row["name"],
                      "manifest_hash": row["hash"], "metric_id": metric_id,
                      "period": period, "unit": unit, "records": records,
                      "valid_until": min(parse_time(b["valid_until"])
                                         for b in bodies.values()).isoformat(),
                      "recheck_at_use": True}
            output["bundle_hash"] = digest(output)
            if len(canonical(output).encode("utf-8")) > MAX_BUNDLE_BYTES:
                raise ContextError("bundle_too_large")
            self._event(actor, workspace, "delivered", {"release": row["name"],
                        "bundle_hash": output["bundle_hash"], "metric_id": metric_id})
            return output

    def dispatch(self, actor, request):
        """Transport-neutral boundary; actor is supplied by a trusted local adapter."""
        try:
            if (not isinstance(request, dict)
                    or any(not isinstance(key, str) or not isinstance(value, str)
                           for key, value in request.items())
                    or len(canonical(request).encode("utf-8")) > MAX_REQUEST_BYTES):
                raise ContextError("invalid_request")
            if (request.get("operation") == "context.get" and set(request) ==
                    {"operation", "workspace", "metric_id", "period", "unit"}):
                return {"ok": True, "context": self.get(actor, request["workspace"],
                        request["metric_id"], request["period"], request["unit"])}
            if (request.get("operation") == "context.search" and set(request) ==
                    {"operation", "workspace", "query", "period", "unit"}):
                return {"ok": True, "search": self.search(actor, request["workspace"],
                        request["query"], request["period"], request["unit"])}
            raise ContextError("invalid_request")
        except ContextError as exc:
            # Denied responses have no record/evidence payload; details stay local.
            workspace = request.get("workspace", "") if isinstance(request, dict) else ""
            workspace = workspace[:100] if isinstance(workspace, str) else ""
            workspace = workspace.encode("utf-8", errors="replace").decode("utf-8")
            with self.db:
                self._event(actor, workspace, "denied", {"reason": exc.code})
            return {"ok": False, "error": exc.code}

    def search(self, actor, workspace, query, period, unit):
        """Exact-ID / keyword baseline. No semantic embeddings or relevance claim."""
        self._principal(actor, workspace, "consumer")
        terms = set(re.findall(r"[a-z0-9]+", query.casefold()))
        if not terms or len(query) > 200:
            raise ContextError("invalid_request")
        # Resolve current authority first; candidate text is never returned directly.
        with self.db:
            self.db.execute("BEGIN")
            release = self.active_release(workspace)
            row = self.db.execute("SELECT manifest FROM releases WHERE workspace=? AND name=?",
                                  (workspace, release)).fetchone()
            if not row:
                raise ContextError("release_unavailable")
            manifest = json.loads(row[0])
            bodies = self._bundle(workspace, manifest, actor)
            refs = self.db.execute("SELECT * FROM search_refs WHERE workspace=? AND release=?",
                                   (workspace, release)).fetchall()
            if {r["record_id"]: r["version"] for r in refs} != manifest:
                raise ContextError("stale_index")
            candidates = []
            for ref in refs:
                body = bodies[ref["record_id"]]
                if ref["tokens"] != search_tokens(body):
                    raise ContextError("stale_index")
                exact = query == body["id"]
                if exact or terms.issubset(set(json.loads(ref["tokens"]))):
                    candidates.append({"id": body["id"], "version": body["version"],
                                       "match": "exact" if exact else "keyword"})
            if any(c["match"] == "exact" for c in candidates):
                candidates = [c for c in candidates if c["match"] == "exact"]
            if not candidates:
                raise ContextError("no_match")
            metric_ids = set()
            for candidate in candidates:
                body = bodies[candidate["id"]]
                if body["layer"] == "metric":
                    metric_ids.add(body["id"])
                elif body["layer"] == "ontology":
                    metric_ids.add(body["content"]["concept"])
            if len(metric_ids) != 1:
                raise ContextError("ambiguous_match")
            metric_id = next(iter(metric_ids))
        # A fresh delivery transaction rechecks the active release and all dependencies.
        bundle = self.get(actor, workspace, metric_id, period, unit)
        if bundle["release"] != release:
            raise ContextError("context_changed")
        return {"contract": "context.search.v1", "method": "exact-or-all-keywords",
                "candidates": sorted(candidates, key=lambda c: c["id"]), "context": bundle}

    def impact(self, workspace, source_path):
        """Identify active-release records needing attention after a source change."""
        release = self.active_release(workspace)
        if not release:
            return []
        row = self.db.execute("SELECT manifest FROM releases WHERE workspace=? AND name=?",
                              (workspace, release)).fetchone()
        manifest = json.loads(row[0])
        bodies = {rid: json.loads(self._row(workspace, rid, version)["body"])
                  for rid, version in manifest.items()}
        impacted = {rid for rid, b in bodies.items()
                    if any(e["path"] == source_path for e in b["evidence"])}
        while True:
            expanded = impacted | {rid for rid, b in bodies.items()
                                   if any(d["id"] in impacted for d in b["dependencies"])}
            if expanded == impacted:
                return [{"id": rid, "version": manifest[rid], "owner": bodies[rid]["owner"]}
                        for rid in sorted(impacted)]
            impacted = expanded

    def audit(self):
        return [{**dict(row), "details": json.loads(row["details"])}
                for row in self.db.execute("SELECT * FROM events ORDER BY seq")]
