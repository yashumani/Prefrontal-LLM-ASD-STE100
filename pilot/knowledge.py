"""General knowledge profile of the local governed-context reference registry.

This profile delivers reviewed text and its exact-version evidence dependencies.
It does not execute instructions, evaluate semantic truth, or authorize actions.
The local operator controls the database, files and principal configuration;
these controls are not authentication or a network security boundary.
"""

import json
import re
import sqlite3

from .context_pilot import (
    MAX_BUNDLE_BYTES, MAX_RECORDS, MAX_REQUEST_BYTES, ContextError, Registry,
    canonical, digest, parse_time, search_tokens,
)


KNOWLEDGE_CONTRACT = "context.knowledge.v1"
SEARCH_CONTRACT = "context.knowledge.search.v1"
HEALTH_CONTRACT = "context.knowledge.health.v1"
MAX_SEARCH_CANDIDATES = 8
_RECORD_ID = re.compile(r"[a-z][a-z0-9_.:-]{1,100}")
_HASH = re.compile(r"[a-f0-9]{64}")
_NO_VERSION = object()


def _text(value, maximum=100):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ContextError("invalid_request")
    try:
        value.encode("utf-8")
    except UnicodeError:
        raise ContextError("invalid_request") from None
    return value


def _identity(record_id, version=_NO_VERSION):
    if not isinstance(record_id, str) or not _RECORD_ID.fullmatch(record_id):
        raise ContextError("invalid_request")
    if version is not _NO_VERSION and (type(version) is not int or version < 1):
        raise ContextError("invalid_request")


class KnowledgeRegistry(Registry):
    """Additive text profile; the metric profile remains a separate database."""

    profile = "knowledge"
    required_layers = None

    def _validate_body(self, body):
        self._validate_envelope(body)
        content = body["content"]
        if set(content) != {"text", "topics", "assumptions", "limits"}:
            raise ContextError("invalid_record")
        if not isinstance(content["text"], str) or not content["text"].strip():
            raise ContextError("invalid_record")
        for key in ("topics", "assumptions", "limits"):
            values = content[key]
            if (not isinstance(values, list)
                    or any(not isinstance(value, str) or not value.strip() for value in values)
                    or (key == "topics" and not values)
                    or (body["layer"] == "interpretation" and not values)):
                raise ContextError("invalid_record")

    def _check_native_bindings(self, bodies):
        # General knowledge contains text, never native metric queries.
        return None

    def _manifest(self, value):
        if not isinstance(value, dict) or not value or len(value) > MAX_RECORDS:
            raise ContextError("invalid_manifest")
        for record_id, version in value.items():
            try:
                _identity(record_id, version)
            except ContextError:
                raise ContextError("invalid_manifest") from None
        return value

    def _active_manifest(self, workspace):
        row = self.db.execute(
            "SELECT r.* FROM releases r JOIN active a "
            "ON r.workspace=a.workspace AND r.name=a.release WHERE a.workspace=?",
            (workspace,),
        ).fetchone()
        if row is None:
            raise ContextError("release_unavailable")
        try:
            manifest = self._manifest(json.loads(row["manifest"]))
            if digest(manifest) != row["hash"]:
                raise ContextError("integrity_failure")
        except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
            raise ContextError("integrity_failure") from None
        return row, manifest

    def _record_body(self, row):
        """Check stored shape before passing it to lifecycle or graph checks."""
        try:
            body = json.loads(row["body"])
            if digest(body) != row["hash"]:
                raise ContextError("integrity_failure")
            self._validate_body(body)
            if (body["workspace"], body["id"], body["version"]) != (
                    row["workspace"], row["id"], row["version"]):
                raise ContextError("integrity_failure")
            return body
        except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, RecursionError):
            raise ContextError("integrity_failure") from None
        except ContextError as exc:
            raise ContextError("integrity_failure") from exc

    def _approval(self, row):
        approval = self.db.execute(
            "SELECT hash,reviewer FROM approvals WHERE workspace=? AND id=? AND version=?",
            (row["workspace"], row["id"], row["version"]),
        ).fetchone()
        if not approval or row["review_state"] != "approved":
            raise ContextError("unapproved")
        if (approval["hash"] != row["hash"] or not approval["reviewer"]
                or approval["reviewer"] == row["submitter"]):
            raise ContextError("integrity_failure")
        return approval

    def _selected(self, actor, workspace, manifest, record_ids):
        person = self._principal(actor, workspace, "consumer")
        bodies, rows = {}, {}
        visiting, visited = set(), set()

        def visit(record_id):
            if record_id in visiting:
                raise ContextError("dependency_cycle")
            if record_id in visited:
                return
            if record_id not in manifest:
                raise ContextError("record_unavailable")
            if len(bodies) >= MAX_RECORDS:
                raise ContextError("bundle_too_large")
            row = self._row(workspace, record_id, manifest[record_id])
            body = self._record_body(row)
            if body["classification"] not in person.get("classifications", []):
                raise ContextError("access_denied")
            self._current(row)
            self._approval(row)
            bodies[record_id], rows[record_id] = body, row
            visiting.add(record_id)
            for dep in body["dependencies"]:
                if manifest.get(dep["id"]) != dep["version"]:
                    raise ContextError("dependency_mismatch")
                visit(dep["id"])
            visiting.remove(record_id)
            visited.add(record_id)

        for record_id in record_ids:
            visit(record_id)
        return bodies, rows

    def get_records(self, actor, workspace, record_ids):
        """Deliver only the selected records and exact-version dependency closure.

        An expired or inaccessible unrelated record does not invalidate a selected
        branch of knowledge. Every delivered record is checked again at delivery.
        """
        _text(workspace)
        if not isinstance(record_ids, list) or not record_ids or len(record_ids) > MAX_RECORDS:
            raise ContextError("invalid_request")
        for record_id in record_ids:
            _identity(record_id)
        record_ids = sorted(set(record_ids))
        self._principal(actor, workspace, "consumer")
        with self.db:
            self.db.execute("BEGIN")
            release, manifest = self._active_manifest(workspace)
            bodies, rows = self._selected(actor, workspace, manifest, record_ids)
            records = [{"record": bodies[rid], "content_hash": rows[rid]["hash"],
                        "reviewed_by": self._approval(rows[rid])["reviewer"]}
                       for rid in sorted(bodies)]
            output = {"contract": KNOWLEDGE_CONTRACT, "workspace": workspace,
                      "release": release["name"], "manifest_hash": release["hash"],
                      "requested_ids": record_ids, "records": records,
                      "valid_until": min(parse_time(body["valid_until"])
                                         for body in bodies.values()).isoformat(),
                      "recheck_at_use": True}
            output["bundle_hash"] = digest(output)
            if len(canonical(output).encode("utf-8")) > MAX_BUNDLE_BYTES:
                raise ContextError("bundle_too_large")
            self._event(actor, workspace, "knowledge_delivered", {
                "release": release["name"], "requested_ids": record_ids,
                "bundle_hash": output["bundle_hash"], "records": len(records)})
            return output

    def search_records(self, actor, workspace, query):
        """Deterministic exact-ID / all-keyword lookup, not semantic retrieval."""
        _text(workspace)
        _text(query, 200)
        terms = set(re.findall(r"[a-z0-9]+", query.casefold()))
        if not terms:
            raise ContextError("invalid_request")
        person = self._principal(actor, workspace, "consumer")
        with self.db:
            self.db.execute("BEGIN")
            release, manifest = self._active_manifest(workspace)
            refs = self.db.execute(
                "SELECT * FROM search_refs WHERE workspace=? AND release=?",
                (workspace, release["name"]),
            ).fetchall()
            if {ref["record_id"]: ref["version"] for ref in refs} != manifest:
                raise ContextError("stale_index")
            candidates = []
            for ref in refs:
                body = self._record_body(self._row(workspace, ref["record_id"], ref["version"]))
                if ref["tokens"] != search_tokens(body):
                    raise ContextError("stale_index")
                if body["classification"] not in person.get("classifications", []):
                    continue
                exact = query == body["id"]
                if exact or terms.issubset(set(json.loads(ref["tokens"]))):
                    candidates.append({"id": body["id"], "version": body["version"],
                                       "match": "exact" if exact else "keyword"})
            if any(candidate["match"] == "exact" for candidate in candidates):
                candidates = [candidate for candidate in candidates if candidate["match"] == "exact"]
            if not candidates:
                raise ContextError("no_match")
            if len(candidates) > MAX_SEARCH_CANDIDATES:
                raise ContextError("ambiguous_match")
            candidates.sort(key=lambda candidate: candidate["id"])
            release_name, manifest_hash = release["name"], release["hash"]
        # Recheck current authority rather than returning indexed source text.
        bundle = self.get_records(actor, workspace, [candidate["id"] for candidate in candidates])
        if bundle["release"] != release_name or bundle["manifest_hash"] != manifest_hash:
            raise ContextError("context_changed")
        with self.db:
            self._event(actor, workspace, "knowledge_searched", {
                "release": release_name, "method": "exact-or-all-keywords",
                "candidate_ids": [candidate["id"] for candidate in candidates],
                "bundle_hash": bundle["bundle_hash"]})
        return {"contract": SEARCH_CONTRACT, "method": "exact-or-all-keywords",
                "candidates": candidates, "context": bundle}

    def health(self, actor, workspace):
        """Reviewer diagnostics; never refreshes, approves, or publishes knowledge."""
        _text(workspace)
        self._principal(actor, workspace, "reviewer")
        with self.db:
            self.db.execute("BEGIN")
            try:
                release, manifest = self._active_manifest(workspace)
            except ContextError as exc:
                if exc.code == "release_unavailable":
                    raise
                report = {"contract": HEALTH_CONTRACT, "workspace": workspace,
                          "release": self.active_release(workspace), "status": "blocked",
                          "issues": [{"code": exc.code, "scope": "release"}],
                          "records": [], "blocked_records": [],
                          "semantic_truth_and_conflicts": "unverified; not established by deterministic checks"}
                self._event(actor, workspace, "knowledge_health", {"status": "blocked"})
                return report
            issues, bodies = {}, {}
            for rid, version in manifest.items():
                issues[rid] = []
                try:
                    row = self._row(workspace, rid, version)
                    body = self._record_body(row)
                    bodies[rid] = body
                except ContextError as exc:
                    issues[rid].append(exc.code)
                    continue
                if row["revoked"]:
                    issues[rid].append("revoked")
                if not parse_time(body["valid_from"]) <= self.clock() < parse_time(body["valid_until"]):
                    issues[rid].append("outside_validity")
                for evidence in body["evidence"]:
                    try:
                        if self.source_hash(evidence["path"]) != evidence["sha256"]:
                            issues[rid].append("stale_source")
                    except ContextError as exc:
                        issues[rid].append(exc.code)
                try:
                    self._approval(row)
                except ContextError as exc:
                    issues[rid].append(exc.code)
                if any(manifest.get(dep["id"]) != dep["version"] for dep in body["dependencies"]):
                    issues[rid].append("dependency_mismatch")

            visited, visiting = set(), []

            def inspect(rid):
                if rid in visiting:
                    for cyclic in visiting[visiting.index(rid):]:
                        issues[cyclic].append("dependency_cycle")
                    return
                if rid in visited or rid not in bodies:
                    return
                visiting.append(rid)
                for dep in bodies[rid]["dependencies"]:
                    if dep["id"] in manifest:
                        inspect(dep["id"])
                visiting.pop()
                visited.add(rid)

            for rid in bodies:
                inspect(rid)
            # Propagate invalidity to all consumers of a blocked dependency.
            for _ in range(MAX_RECORDS):
                changed = False
                for rid, body in bodies.items():
                    if (not issues[rid] and any(issues.get(dep["id"], ["missing"])
                                               for dep in body["dependencies"])):
                        issues[rid].append("dependency_blocked")
                        changed = True
                if not changed:
                    break
            blocked = sorted(rid for rid, values in issues.items() if values)
            report = {"contract": HEALTH_CONTRACT, "workspace": workspace,
                      "release": release["name"], "manifest_hash": release["hash"],
                      "status": "blocked" if blocked else "healthy",
                      "records": [{"id": rid, "version": manifest[rid],
                                   "status": "blocked" if issues[rid] else "current",
                                   "issues": sorted(set(issues[rid]))}
                                  for rid in sorted(manifest)],
                      "issues": [{"id": rid, "code": code}
                                 for rid in sorted(issues) for code in sorted(set(issues[rid]))],
                      "blocked_records": blocked,
                      "semantic_truth_and_conflicts": "unverified; not established by deterministic checks"}
            self._event(actor, workspace, "knowledge_health", {
                "release": release["name"], "status": report["status"],
                "blocked_records": blocked})
            return report

    def _denied_request(self, actor, request, code):
        workspace = request.get("workspace", "") if isinstance(request, dict) else ""
        workspace = workspace[:100] if isinstance(workspace, str) else ""
        workspace = workspace.encode("utf-8", errors="replace").decode("utf-8")
        actor = actor[:100] if isinstance(actor, str) else ""
        actor = actor.encode("utf-8", errors="replace").decode("utf-8")
        try:
            with self.db:
                self._event(actor, workspace, "denied", {"reason": code})
        except sqlite3.Error:
            return {"ok": False, "error": "storage_unavailable"}
        return {"ok": False, "error": code}

    def dispatch(self, actor, request):
        """Bounded local adapter boundary; actor never comes from request content."""
        try:
            _text(actor)
            if (not isinstance(request, dict)
                    or not isinstance(request.get("operation"), str)
                    or len(canonical(request).encode("utf-8")) > MAX_REQUEST_BYTES):
                raise ContextError("invalid_request")
            operation = request["operation"]
            fields = {
                "knowledge.get": {"workspace", "record_ids"},
                "knowledge.search": {"workspace", "query"},
                "knowledge.health": {"workspace"},
                "record.submit": {"record"},
                "record.review": {"workspace", "record_id", "version", "expected_hash", "decision"},
                "release.publish": {"workspace", "name", "manifest"},
                "record.revoke": {"workspace", "record_id", "version"},
                "knowledge.feedback": {"workspace", "release", "text"},
            }
            if operation not in fields or set(request) != fields[operation] | {"operation"}:
                raise ContextError("invalid_request")
            if operation == "record.submit":
                content_hash = self.submit(actor, request["record"])
                return {"ok": True, "content_hash": content_hash}
            workspace = _text(request["workspace"])
            if operation == "knowledge.get":
                return {"ok": True, "context": self.get_records(actor, workspace, request["record_ids"])}
            if operation == "knowledge.search":
                return {"ok": True, "search": self.search_records(actor, workspace, request["query"])}
            if operation == "knowledge.health":
                return {"ok": True, "health": self.health(actor, workspace)}
            if operation in {"record.review", "record.revoke"}:
                _identity(request["record_id"], request["version"])
                if operation == "record.revoke":
                    self.revoke(actor, workspace, request["record_id"], request["version"])
                    return {"ok": True, "revoked": True}
                decision = request["decision"]
                if (not isinstance(decision, str) or decision not in {"approve", "reject", "changes_requested"}
                        or not isinstance(request["expected_hash"], str)
                        or not _HASH.fullmatch(request["expected_hash"])):
                    raise ContextError("invalid_request")
                if decision == "approve":
                    self.approve(actor, workspace, request["record_id"], request["version"], request["expected_hash"])
                    state = "approved"
                else:
                    state = "rejected" if decision == "reject" else "changes_requested"
                    self.hold_review(actor, workspace, request["record_id"], request["version"], request["expected_hash"], state)
                return {"ok": True, "review_state": state}
            if operation == "release.publish":
                _text(request["name"])
                self._manifest(request["manifest"])
                self.publish(actor, workspace, request["name"], request["manifest"])
                return {"ok": True, "release": request["name"], "manifest_hash": digest(request["manifest"])}
            _text(request["release"])
            _text(request["text"], 2000)
            self.feedback(actor, workspace, request["release"], request["text"])
            return {"ok": True, "status": "pending_review"}
        except ContextError as exc:
            return self._denied_request(actor, request, exc.code)
        except (ValueError, TypeError, KeyError, IndexError, AttributeError, UnicodeError, OverflowError, RecursionError):
            return self._denied_request(actor, request, "invalid_request")
        except sqlite3.Error:
            # Storage diagnostics belong to the operator, not a context response.
            return {"ok": False, "error": "storage_unavailable"}
