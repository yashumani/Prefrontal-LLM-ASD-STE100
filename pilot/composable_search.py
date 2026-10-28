"""Incremental indexed discovery for the composable context profile.

Only published ID/version references and derived lookup terms enter the index.
Every candidate is checked against its current head, authority, source bindings,
validity and complete dependency closure before any metadata is delivered.

Ranking is deterministic: exact ID > exact name > exact alias > all query tokens.
Token scores use the strongest occurrence per token (name 300, alias 200,
description 100), then canonical ID breaks ties. No relevance model is implied.
An uppercase canonical ID that is currently deliverable and matches the filters
is a direct reference lookup: return that one record without keyword expansion.
An unavailable or filter-excluded ID falls back to permitted keyword discovery.

A dimension filter selects that exact dimension and its direct member records.
A member filter requires a dimension and selects only that exact member ID with
that exact spec.dimension. It does not expand dependent records or combinations.
Cursors are signed, opaque continuation references bound to request parameters,
current principal configuration and the workspace catalog revision. Restart a
search after any catalog or authorization change; there are no total counts.
Each request examines at most 2,048 candidate references. Each ranking query
has a 20,000,000 SQLite VM instruction budget, not a wall-clock guarantee.
Budget exhaustion denies the entire request without partial results or counts;
use an exact ID or narrower query/filter instead of assuming an empty catalog.
"""

import base64
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import unicodedata

from .context_pilot import ContextError, canonical, digest, parse_time
from .composable_model import MAX_CLOSURE_RECORDS, MAX_DEPTH, MAX_BUNDLE_BYTES, KIND_LAYERS, validate_record


SEARCH_CONTRACT = "prefrontal.context.search.v1"
MAX_QUERY_CHARS = 256
MAX_QUERY_TERMS = 16
MAX_PAGE_SIZE = 100
MAX_CURSOR_CHARS = 2048
MAX_SEARCH_CANDIDATES = 2048
MAX_SEARCH_SQL_STEPS = 20000000
_FETCH_SIZE = 128
_ID = re.compile(r"[A-Z][A-Z0-9_]{1,95}\Z")
_LAYERS = {"data", "metric", "ontology", "interpretation"}
_KINDS = frozenset(KIND_LAYERS)
_CURSOR_KEYS = {"v", "b", "a", "r", "s", "i"}
_CLASS_BITS = {"internal": 1, "restricted": 2}


def _normalized(value):
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def _tokens(value):
    return re.findall(r"[^\W_]+", _normalized(value), flags=re.UNICODE)


def _text(value, maximum=MAX_QUERY_CHARS):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ContextError("invalid_request")
    try:
        value.encode("utf-8")
    except UnicodeError:
        raise ContextError("invalid_request") from None
    return value


def _canonical_id(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ContextError("invalid_request")


def _filters(layer, kind, dimension, member):
    if layer is not None and (not isinstance(layer, str) or layer not in _LAYERS):
        raise ContextError("invalid_request")
    if kind is not None and (not isinstance(kind, str) or kind not in _KINDS):
        raise ContextError("invalid_request")
    if dimension is not None:
        _canonical_id(dimension)
    if member is not None:
        _canonical_id(member)
        if dimension is None:
            raise ContextError("invalid_request")
    return {"layer": layer, "kind": kind, "dimension": dimension, "member": member}


def _query(value):
    _text(value)
    terms = _tokens(value)
    if len(terms) > MAX_QUERY_TERMS:
        raise ContextError("invalid_request")
    return _normalized(value), tuple(sorted(set(terms)))


def _exact_terms(record):
    terms = {_normalized(record["id"]): 100000, _normalized(record["name"]): 90000}
    # ID and name may normalize identically; preserve the stronger ID score.
    terms[_normalized(record["id"])] = 100000
    for alias in record["aliases"]:
        term = _normalized(alias)
        terms[term] = max(terms.get(term, 0), 80000)
    return terms


def _weighted_tokens(record):
    values = [(record["name"], 300), (record["description"], 100)]
    values.extend((alias, 200) for alias in record["aliases"])
    output = {}
    for text, weight in values:
        for token in set(_tokens(text)):
            output[token] = max(output.get(token, 0), weight)
    return output


def _record_score(record, exact, tokens):
    score = _exact_terms(record).get(exact, 0)
    weighted = _weighted_tokens(record)
    if tokens and all(token in weighted for token in tokens):
        score = max(score, sum(weighted[token] for token in tokens))
    return score or None


def _record_matches(record, filters):
    if filters["layer"] is not None and record["layer"] != filters["layer"]:
        return False
    if filters["kind"] is not None and record["kind"] != filters["kind"]:
        return False
    dimension = filters["dimension"]
    if dimension is not None:
        if not ((record["kind"] == "dimension" and record["id"] == dimension)
                or (record["kind"] == "member" and record["spec"]["dimension"] == dimension)):
            return False
    member = filters["member"]
    return member is None or (record["kind"] == "member" and record["id"] == member)


class SearchMixin:
    """Requires the registry's live authority, head and closure validation hooks."""

    def _search_schema(self, db):
        # No source snippets or authority copies are persisted in these tables.
        statements = (
            "CREATE TABLE IF NOT EXISTS c_search_refs ("
            "workspace TEXT NOT NULL,record_id TEXT NOT NULL,version INTEGER NOT NULL,"
            "layer TEXT NOT NULL,kind TEXT NOT NULL,dimension TEXT,"
            "classification TEXT NOT NULL,valid_from REAL NOT NULL,valid_until REAL,"
            "PRIMARY KEY(workspace,record_id,version))",
            "CREATE TABLE IF NOT EXISTS c_search_exact ("
            "workspace TEXT NOT NULL,term TEXT NOT NULL,record_id TEXT NOT NULL,"
            "version INTEGER NOT NULL,weight INTEGER NOT NULL,"
            "access_mask INTEGER NOT NULL DEFAULT 0,"
            "PRIMARY KEY(workspace,term,record_id,version))",
            "CREATE INDEX IF NOT EXISTS c_search_exact_lookup "
            "ON c_search_exact(workspace,term,access_mask,record_id,version,weight)",
            "CREATE INDEX IF NOT EXISTS c_search_exact_record "
            "ON c_search_exact(workspace,record_id)",
            "CREATE TABLE IF NOT EXISTS c_search_tokens ("
            "workspace TEXT NOT NULL,token TEXT NOT NULL,record_id TEXT NOT NULL,"
            "version INTEGER NOT NULL,weight INTEGER NOT NULL,"
            "access_mask INTEGER NOT NULL DEFAULT 0,"
            "PRIMARY KEY(workspace,token,record_id,version))",
            "CREATE INDEX IF NOT EXISTS c_search_tokens_lookup "
            "ON c_search_tokens(workspace,token,access_mask,record_id,version,weight)",
            "CREATE INDEX IF NOT EXISTS c_search_tokens_record "
            "ON c_search_tokens(workspace,record_id)",
            "CREATE TABLE IF NOT EXISTS c_search_closure ("
            "workspace TEXT NOT NULL,record_id TEXT NOT NULL,version INTEGER NOT NULL,"
            "dependency_id TEXT NOT NULL,dependency_version INTEGER NOT NULL,"
            "content_hash TEXT NOT NULL,classification TEXT NOT NULL,"
            "valid_from REAL NOT NULL,valid_until REAL,source_checked REAL,source_until REAL,"
            "PRIMARY KEY(workspace,record_id,version,dependency_id))",
            "CREATE TABLE IF NOT EXISTS c_search_config "
            "(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
        )
        for statement in statements:
            db.execute(statement)
        db.execute("INSERT OR IGNORE INTO c_search_config(key,value) VALUES('cursor_key',?)",
                   (secrets.token_hex(32),))

    def _index_record(self, db, workspace, record):
        """Called only inside the registry's atomic publication transaction.

        Replacing an ID removes all obsolete lookup terms without rebuilding any
        unrelated record. Lifecycle tables and current heads remain authoritative.
        """
        record_id, version = record["id"], record["version"]
        closure = self._index_closure(db, workspace, record)
        access_mask = 0
        for body, _ in closure:
            access_mask |= _CLASS_BITS[body["classification"]]
        for table in ("c_search_exact", "c_search_tokens", "c_search_closure", "c_search_refs"):
            db.execute("DELETE FROM " + table + " WHERE workspace=? AND "
                       "record_id=?", (workspace, record_id))
        dimension = record["spec"]["dimension"] if record["kind"] == "member" else None
        db.execute("INSERT INTO c_search_refs VALUES(?,?,?,?,?,?,?,?,?)",
                   (workspace, record_id, version, record["layer"], record["kind"], dimension,
                    record["classification"], parse_time(record["valid_from"]).timestamp(),
                    None if record["valid_until"] is None else parse_time(record["valid_until"]).timestamp()))
        db.executemany("INSERT INTO c_search_exact VALUES(?,?,?,?,?,?)",
                       ((workspace, term, record_id, version, weight, access_mask)
                        for term, weight in sorted(_exact_terms(record).items())))
        db.executemany("INSERT INTO c_search_tokens VALUES(?,?,?,?,?,?)",
                       ((workspace, token, record_id, version, weight, access_mask)
                        for token, weight in sorted(_weighted_tokens(record).items())))
        for body, content_hash in closure:
            checked = (parse_time(body["spec"]["checked_at"]).timestamp()
                       if body["kind"] == "source" else None)
            until = None if body["valid_until"] is None else parse_time(body["valid_until"]).timestamp()
            db.execute("INSERT INTO c_search_closure VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                       (workspace, record_id, version, body["id"], body["version"], content_hash,
                        body["classification"], parse_time(body["valid_from"]).timestamp(), until,
                        checked, None if checked is None else checked + body["spec"]["freshness_seconds"]))

    def _index_closure(self, db, workspace, record):
        """Derive bounded immutable references after publication checked the graph.

        All new heads are already present in the caller's transaction. This
        performs exact-key reads only; it does not infer grants or read sources.
        """
        found, heights, visiting, versions = {}, {}, set(), {}
        size = [0]

        def visit(identifier, version, depth):
            key = identifier, version
            if (depth > MAX_DEPTH or key in visiting
                    or (identifier in versions and versions[identifier] != version)):
                raise ContextError("context_unavailable")
            if key in heights:
                if depth + heights[key] > MAX_DEPTH:
                    raise ContextError("context_unavailable")
                return heights[key]
            row = db.execute("SELECT r.* FROM c_records r JOIN c_heads h ON "
                             "h.workspace=r.workspace AND h.id=r.id AND h.version=r.version "
                             "WHERE r.workspace=? AND r.id=? AND r.version=?",
                             (workspace, identifier, version)).fetchone()
            if (row is None or row["state"] != "approved" or row["revoked"]
                    or not row["reviewer"]):
                raise ContextError("context_unavailable")
            body = validate_record(json.loads(row["body"]))
            if ((body["id"], body["version"]) != key or digest(body) != row["hash"]):
                raise ContextError("context_unavailable")
            found[key] = body, row["hash"]
            versions[identifier] = version
            size[0] += len(row["body"].encode("utf-8"))
            if len(found) > MAX_CLOSURE_RECORDS or size[0] > MAX_BUNDLE_BYTES:
                raise ContextError("context_unavailable")
            visiting.add(key)
            height = max((1 + visit(dep["id"], dep["version"], depth + 1)
                          for dep in body["dependencies"]), default=0)
            visiting.remove(key)
            heights[key] = height
            return height

        visit(record["id"], record["version"], 0)
        return [found[key] for key in sorted(found)]

    def _search_visibility(self, actor, workspace, boundary):
        try:
            person, auth_hash = self._authority(actor, workspace, "consumer")
            if auth_hash != boundary[0]:
                raise ContextError("context_unavailable")
            classes = tuple(sorted(value for value in _CLASS_BITS if value in person["classifications"]))
            allowed = sum(_CLASS_BITS[value] for value in classes)
            masks = tuple(mask for mask in (1, 2, 3) if mask & allowed == mask)
            now = self.clock()
            if now.tzinfo is None or now.utcoffset() is None:
                raise ContextError("context_unavailable")
            return {"classes": classes, "masks": masks, "now": now.timestamp()}
        except (ContextError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
            raise ContextError("context_unavailable") from None

    def _search_boundary(self, actor, workspace):
        try:
            _, auth_hash = self._authority(actor, workspace, "consumer")
            revision = self._revision(workspace)
            if type(revision) is not int or revision < 0:
                raise ContextError("context_unavailable")
            return auth_hash, revision
        except ContextError:
            raise ContextError("context_unavailable") from None

    def _search_current(self, actor, workspace, boundary):
        if self._search_boundary(actor, workspace) != boundary:
            raise ContextError("context_unavailable")

    def _search_candidate(self, actor, workspace, record_id, version):
        envelope = self._checked_record(actor, workspace, record_id, version, require_active=True)
        self._closure(actor, workspace, envelope["record"])
        return envelope

    def _search_delivery(self, actor, workspace, envelopes, boundary):
        for envelope in envelopes:
            body = envelope["record"]
            try:
                fresh = self._search_candidate(actor, workspace, body["id"], body["version"])
                if fresh["hash"] != envelope["hash"]:
                    raise ContextError("context_unavailable")
            except ContextError:
                raise ContextError("context_unavailable") from None
        self._search_current(actor, workspace, boundary)

    def _cursor_key(self):
        row = self.db.execute("SELECT value FROM c_search_config WHERE key='cursor_key'").fetchone()
        try:
            key = bytes.fromhex(row[0])
            if len(key) != 32:
                raise ValueError()
            return key
        except (TypeError, ValueError, IndexError):
            raise ContextError("context_unavailable") from None

    def _make_cursor(self, binding, boundary, score, record_id):
        body = canonical({"v": 1, "b": binding, "a": boundary[0], "r": boundary[1],
                          "s": score, "i": record_id}).encode("utf-8")
        signature = hmac.new(self._cursor_key(), body, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(body + signature).decode("ascii").rstrip("=")

    def _read_cursor(self, cursor, binding, boundary):
        if (not isinstance(cursor, str) or not cursor or len(cursor) > MAX_CURSOR_CHARS
                or not re.fullmatch(r"[A-Za-z0-9_-]+", cursor)):
            raise ContextError("invalid_cursor")
        try:
            raw = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
            if base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=") != cursor:
                raise ValueError()
            body, signature = raw[:-32], raw[-32:]
            if len(signature) != 32 or not hmac.compare_digest(
                    signature, hmac.new(self._cursor_key(), body, hashlib.sha256).digest()):
                raise ValueError()
            value = json.loads(body.decode("utf-8"))
            if (not isinstance(value, dict) or set(value) != _CURSOR_KEYS
                    or type(value["v"]) is not int or value["v"] != 1
                    or value["b"] != binding or not isinstance(value["a"], str)
                    or type(value["r"]) is not int or value["r"] < 0
                    or type(value["s"]) is not int or not 0 < value["s"] <= 100000
                    or not isinstance(value["i"], str) or not _ID.fullmatch(value["i"])):
                raise ValueError()
        except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
            raise ContextError("invalid_cursor") from None
        if (value["a"], value["r"]) != boundary:
            raise ContextError("stale_cursor")
        return value["s"], value["i"]

    def _candidate_rows(self, workspace, exact, tokens, filters, after, limit, visibility, exact_only=False):
        if not visibility["masks"]:
            return []
        masks = ",".join("?" for _ in visibility["masks"])
        parameters = [workspace, exact, *visibility["masks"]]
        unions = ["SELECT record_id,version,weight AS score FROM c_search_exact "
                  "INDEXED BY c_search_exact_lookup WHERE workspace=? AND term=? "
                  "AND access_mask IN (" + masks + ")"]
        if tokens and not exact_only:
            unions.append("SELECT record_id,version,SUM(weight) AS score FROM c_search_tokens "
                          "INDEXED BY c_search_tokens_lookup WHERE workspace=? AND token IN ("
                          + ",".join("?" for _ in tokens) + ") AND access_mask IN (" + masks + ") "
                          "GROUP BY record_id,version HAVING COUNT(*)=?")
            parameters.extend((workspace, *tokens, *visibility["masks"], len(tokens)))
        conditions = ["s.workspace=?", "r.state='approved'", "r.revoked=0"]
        # The first binding is for the reference join, the second for WHERE.
        parameters.extend((workspace, workspace))
        for name in ("layer", "kind"):
            if filters[name] is not None:
                conditions.append("s." + name + "=?")
                parameters.append(filters[name])
        if filters["dimension"] is not None:
            conditions.append("(s.dimension=? OR (s.kind='dimension' AND s.record_id=?))")
            parameters.extend((filters["dimension"], filters["dimension"]))
        if filters["member"] is not None:
            conditions.extend(("s.kind='member'", "s.record_id=?"))
            parameters.append(filters["member"])
        conditions.append("EXISTS (SELECT 1 FROM c_search_closure self WHERE "
                          "self.workspace=s.workspace AND self.record_id=s.record_id AND self.version=s.version "
                          "AND self.dependency_id=s.record_id AND self.dependency_version=s.version)")
        conditions.append("NOT EXISTS (SELECT 1 FROM c_search_closure d "
                          "LEFT JOIN c_heads dh ON dh.workspace=d.workspace AND dh.id=d.dependency_id "
                          "LEFT JOIN c_records dr ON dr.workspace=d.workspace AND dr.id=d.dependency_id "
                          "AND dr.version=d.dependency_version "
                          "WHERE d.workspace=s.workspace AND d.record_id=s.record_id AND d.version=s.version "
                          "AND (dh.version IS NULL OR dh.version<>d.dependency_version OR dr.id IS NULL "
                          "OR dr.state<>'approved' OR dr.revoked<>0 OR dr.reviewer IS NULL "
                          "OR dr.hash<>d.content_hash OR d.classification NOT IN ("
                          + ",".join("?" for _ in visibility["classes"]) + ") "
                          "OR d.valid_from>? OR (d.valid_until IS NOT NULL AND d.valid_until<=?) "
                          "OR (d.source_checked IS NOT NULL AND (d.source_checked>? OR d.source_until<?))))")
        parameters.extend((*visibility["classes"], *(visibility["now"],) * 4))
        sql = ("WITH candidates AS (" + " UNION ALL ".join(unions) + "), ranked AS ("
               "SELECT c.record_id,c.version,MAX(c.score) AS score FROM candidates c "
               # CROSS JOIN fixes candidate-first lookup order; without it SQLite
               # can choose a workspace-wide records traversal for tiny fixtures.
               "CROSS JOIN c_search_refs s ON s.workspace=? AND s.record_id=c.record_id AND s.version=c.version "
               "CROSS JOIN c_heads h ON h.workspace=s.workspace AND h.id=s.record_id AND h.version=s.version "
               "CROSS JOIN c_records r ON r.workspace=h.workspace AND r.id=h.id AND r.version=h.version "
               "WHERE " + " AND ".join(conditions) + " GROUP BY c.record_id,c.version) "
               "SELECT record_id,version,score FROM ranked")
        if after is not None:
            sql += " WHERE (score<? OR (score=? AND record_id>?))"
            parameters.extend((after[0], after[0], after[1]))
        sql += " ORDER BY score DESC,record_id ASC LIMIT ?"
        parameters.append(limit)
        interval = min(1000, MAX_SEARCH_SQL_STEPS)
        steps = [0]

        def progress():
            steps[0] += interval
            return int(steps[0] >= MAX_SEARCH_SQL_STEPS)

        try:
            self.db.set_progress_handler(progress, interval)
            return self.db.execute(sql, parameters).fetchall()
        except sqlite3.DatabaseError:
            raise ContextError("context_unavailable") from None
        finally:
            self.db.set_progress_handler(None, 0)

    def _candidate_batches(self, workspace, exact, tokens, filters, visibility, after=None, exact_only=False):
        """Never treat a resource cutoff as the end of the permitted result set."""
        examined = 0
        while True:
            if examined >= MAX_SEARCH_CANDIDATES:
                raise ContextError("context_unavailable")
            limit = min(_FETCH_SIZE, MAX_SEARCH_CANDIDATES - examined)
            candidates = self._candidate_rows(workspace, exact, tokens, filters, after, limit, visibility,
                                               exact_only=exact_only)
            if not candidates:
                return
            examined += len(candidates)
            yield candidates
            if len(candidates) < limit:
                return
            after = candidates[-1]["score"], candidates[-1]["record_id"]

    def search(self, actor, workspace, query, *, layer=None, kind=None, dimension=None,
               member=None, page_size=20, cursor=None):
        """Return one permission-filtered page, without catalog totals or hints."""
        _text(workspace, 100)
        exact, tokens = _query(query)
        filters = _filters(layer, kind, dimension, member)
        if type(page_size) is not int or not 1 <= page_size <= MAX_PAGE_SIZE:
            raise ContextError("invalid_request")
        boundary = self._search_boundary(actor, workspace)
        visibility = self._search_visibility(actor, workspace, boundary)
        binding = digest({"actor": actor, "workspace": workspace, "query": exact,
                          "filters": filters, "page_size": page_size})
        after = None if cursor is None else self._read_cursor(cursor, binding, boundary)
        if cursor is None and _ID.fullmatch(query.strip()):
            try:
                selected = self._search_candidate(actor, workspace, query.strip(),
                                                   self._selected(workspace, query.strip())["version"])
            except (ContextError, TypeError):
                selected = None
            if (selected is not None and selected["record"]["id"] == query.strip()
                    and _record_matches(selected["record"], filters)):
                self._search_delivery(actor, workspace, [selected], boundary)
                body = selected["record"]
                return {"contract": SEARCH_CONTRACT, "results": [{
                    "id": body["id"], "version": body["version"], "layer": body["layer"],
                    "kind": body["kind"], "name": body["name"], "description": body["description"],
                    "score": 100000, "content_hash": selected["hash"]}],
                    "next_cursor": None, "catalog_revision": boundary[1]}
        visible = []
        for candidates in self._candidate_batches(workspace, exact, tokens, filters, visibility, after):
            for candidate in candidates:
                try:
                    envelope = self._search_candidate(actor, workspace, candidate["record_id"],
                                                      candidate["version"])
                except ContextError:
                    continue
                body = envelope["record"]
                score = _record_score(body, exact, tokens)
                if score != candidate["score"] or not _record_matches(body, filters):
                    continue
                visible.append((envelope, score))
                if len(visible) > page_size:
                    break
            if len(visible) > page_size:
                break
        self._search_delivery(actor, workspace, [entry[0] for entry in visible], boundary)
        page = visible[:page_size]
        results = [{"id": body["id"], "version": body["version"], "layer": body["layer"],
                    "kind": body["kind"], "name": body["name"], "description": body["description"],
                    "score": score, "content_hash": envelope["hash"]}
                   for envelope, score in page for body in (envelope["record"],)]
        next_cursor = None
        if len(visible) > page_size:
            last, score = page[-1]
            next_cursor = self._make_cursor(binding, boundary, score, last["record"]["id"])
        self._search_current(actor, workspace, boundary)
        return {"contract": SEARCH_CONTRACT, "results": results, "next_cursor": next_cursor,
                "catalog_revision": boundary[1]}

    def resolve_alias(self, actor, workspace, text, kind=None, dimension=None):
        """Resolve exact ID/name/alias only when uniquely deliverable now.

        Missing, restricted, stale and ambiguous aliases share the same error.
        This helper supplies a reference; composition revalidates it on use.
        """
        _text(workspace, 100)
        exact, _ = _query(text)
        filters = _filters(None, kind, dimension, None)
        boundary = self._search_boundary(actor, workspace)
        visibility = self._search_visibility(actor, workspace, boundary)
        visible = []
        for candidates in self._candidate_batches(workspace, exact, (), filters, visibility, exact_only=True):
            for candidate in candidates:
                try:
                    envelope = self._search_candidate(actor, workspace, candidate["record_id"],
                                                      candidate["version"])
                except ContextError:
                    continue
                if (exact not in _exact_terms(envelope["record"])
                        or not _record_matches(envelope["record"], filters)):
                    continue
                visible.append(envelope)
                if len(visible) == 2:
                    break
            if len(visible) == 2:
                break
        if len(visible) != 1:
            raise ContextError("context_unavailable")
        self._search_delivery(actor, workspace, visible, boundary)
        body = visible[0]["record"]
        return {"id": body["id"], "version": body["version"]}
