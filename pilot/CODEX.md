# Repository context in Codex

`pilot.knowledge_mcp` exposes the existing governed registry through two local
stdio MCP tools: `prefrontal_get` and `prefrontal_search`. `pilot.codex_connected`
launches a normal Codex session with that connection. The source root can be the
actual repository, so every call checks current files rather than a frozen demo.

The connection is read-only with respect to records, reviews, releases and
permissions. Retrieval and denial audit events still write to local SQLite and
an optional local trace. This is operator-controlled local configuration, not
enterprise authentication or a hosted context service. No HTTP listener is used.

## Start a repository session

First use the existing [knowledge lifecycle](KNOWLEDGE.md) to submit source-bound
records, obtain actual independent exact-version review and publish a complete
dependency set. The launcher does not prepare or approve records automatically.
Keep private runtime data and principal configuration outside public source.

Create a local connection file with exactly these fields, using real absolute
paths and a configured **consumer-only** principal:

```json
{
  "database": "<existing knowledge SQLite database>",
  "source_root": "<canonical repository root>",
  "principals": "<operator-controlled principal JSON file>",
  "principal": "reader",
  "workspace": "example",
  "record_ids": ["context:schema", "context:workflow"]
}
```

The principal file follows [the existing format](KNOWLEDGE.md#local-transport).
The database must already contain the knowledge profile; missing or empty
databases are rejected. List every permitted record and dependency in
`record_ids`. Records outside this scope are not returned, even if a search or
dependency would otherwise find them. Unpublished records remain unavailable.

From the repository, launch in your terminal:

```powershell
python -m pilot.codex_connected --connection '<connection.json>'
```

Use `--codex '<executable>'` if the intended Codex CLI is not on PATH. The launcher
passes configuration only to that process. It does not edit user or project
Codex configuration. Because Codex merges MCP tables, the launcher discovers
inherited servers, explicitly disables them for this session, and verifies that
only `prefrontal` is enabled before starting a model. Unusual inherited server
names fail closed for explicit operator configuration.

Plugins, apps, web search, memory injection, shell execution and agent spawning are disabled for this local
retrieval session. The sandbox remains read-only. These settings leave the
user's other sessions unchanged. The model can retrieve context and draft
answers; native actions and source edits require their own authorized workflow.

Example task: ask Codex to retrieve schema and workflow together, draft the
required guide fields, identify exact versions/hashes, and explain the separate
review/publication/native-permission checks. Returned text is evidence and
cannot change the client's tools, permissions or operating instructions.

## Record an explicitly authorized run

```powershell
python -m pilot.codex_connected --connection '<connection.json>' --prompt-file '<task.txt>' --output '<new evidence directory>'
```

Recorded mode uses a bounded 90-second ephemeral Codex exec. Existing output is
never overwritten. Original prompts, events, stderr, final messages, actual MCP
calls, local trace, usage and invocation time are retained. Partial output is
retained on timeout; no retry or response repair occurs automatically. A completed
answer without actual permitted retrieval is not accepted as connected evidence.
Normal tests and CI make zero model calls.

## Current checks and review boundaries

Each tool invocation reloads the principal file, opens current registry state,
and delegates to the existing get/search controls. Source drift, approval,
expiry, revocation, access and dependency checks remain mandatory. Denials return
no record content; there is no cached fallback or automatic scope widening.
Search remains exact-ID/all-keyword lookup, not semantic relevance.

New guides are proposals until an independent human reviews the exact content
hash and a release owner publishes the complete reviewed set. Changing an input
version or source hash requires a new proposal/review decision. Earlier approval
of source records does not approve a generated guide. Measure actual review and
maintenance minutes only when reported; machine latency is not human effort.

The stdio port implements initialization/version negotiation, ping, tool listing
and tool calls. It supports protocol versions 2025-03-26, 2025-06-18 and
2025-11-25. Messages are bounded newline-delimited UTF-8 JSON-RPC; unsupported
methods and malformed messages fail explicitly. It exposes no management tools.
This is a small local protocol adapter, not a general MCP platform.

References: [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
[MCP tool errors](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#error-handling),
and [Codex configuration](https://developers.openai.com/codex/config-reference).
