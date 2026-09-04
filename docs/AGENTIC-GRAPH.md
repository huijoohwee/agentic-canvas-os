---
title: "Deterministic Agentic Graph Invocation Contract"
graphId: "md:agentic-canvas-os-deterministic-agentic-graph"
doc_type: "Invocation And Client Contract"
date: "2026-07-30"
lang: "en-US"
schema: "deterministic-agentic-graph-invocation-contract/v1"
frontmatter_contract: "required"
status: "spec-complete"
authority: "canonical command, semantic, binding, policy, and typed agentic-graph client contract"
runtime_scope: "Agentic Canvas OS metadata resolution and MCP request forwarding"
runtime_claim: "contract/client-ready; agentic-graph owns the executable parser, graph, artifact, query, explanation, import, and Canvas runtime"
runtime_proof: "RUNTIME-PROOF.md"
publish_policy: "Dev-only until exact protected integration and runtime proof"
invocations:
  - {action: "/agentic.graph.ingest", semantics: ["#agentic-graph", "#mcp", "#runtime-ready"], bindings: ["@working-directory", "@agentic-graph", "@operator", "@runtime-proof"]}
  - {action: "/agentic.graph.parser.generate", semantics: ["#agentic-graph", "#parser-generation", "#mcp"], bindings: ["@parser-specification", "@runtime-proof"]}
  - {action: "/agentic.graph.query", semantics: ["#agentic-graph", "#mcp", "#vcc"], bindings: ["@agentic-graph", "@runtime-proof"]}
  - {action: "/agentic.graph.explain", semantics: ["#agentic-graph", "#mcp", "#vcc"], bindings: ["@agentic-graph", "@runtime-proof"]}
mcp_dispatch:
  "/agentic.graph.ingest": "agentic-graph.agent_graph.ingest"
  "/agentic.graph.parser.generate": "agentic-graph.agent_graph.parser_generate"
  "/agentic.graph.query": "agentic-graph.agent_graph.query"
  "/agentic.graph.explain": "agentic-graph.agent_graph.explain_edge"
external_dependency: "forbidden"
---

# Deterministic Agentic Graph Invocation Contract

## Outcome

Agentic Canvas OS supplies the canonical `/`, `#`, and `@` vocabulary, policy
boundaries, and typed MCP client methods for turning an explicitly selected
codebase plus its docs, SQL schemas, configs, and text-bearing PDFs into a
queryable agentic graph. agentic-graph owns the executable parser, graph builder,
artifact store, queries, edge explanations, Launch import flows, and Canvas
projection.

The split is deliberate: dictionary resolution returns metadata only. It never
reads a workspace, parses a file, writes an artifact, or implies operator
approval. Execution requires an explicit MCP `tools/call` through the existing
agentic-graph transport.

## Canonical Invocation Mapping

| Agentic Canvas OS invocation | Exact agentic-graph tool |
|---|---|
| `/agentic.graph.ingest #agentic-graph #mcp #runtime-ready @working-directory @agentic-graph @operator @runtime-proof` | `agentic-graph.agent_graph.ingest` |
| `/agentic.graph.parser.generate #agentic-graph #parser-generation #mcp @parser-specification @runtime-proof` | `agentic-graph.agent_graph.parser_generate` |
| `/agentic.graph.query #agentic-graph #mcp #vcc @agentic-graph @runtime-proof` | `agentic-graph.agent_graph.query` |
| `/agentic.graph.explain #agentic-graph #mcp #vcc @agentic-graph @runtime-proof` | `agentic-graph.agent_graph.explain_edge` |

`createAgenticGraphClient` binds `ingestAgenticGraph`,
`generateAgenticGraphParser`, `queryAgenticGraph`, and
`explainAgenticGraphEdge` to a host-supplied local MCP transport.
`createAgenticGraphMcpClient` exposes the same typed methods only when its
Streamable HTTP endpoint is loopback. Both paths snapshot and validate the
request before any asynchronous boundary, validate response identity and
projection bounds, reject private store paths recursively, and call only the
exact tools above.

## Request Contract

| Operation | Required identity | Optional fields owned by agentic-graph |
|---|---|---|
| Ingest | Exactly one explicit local `rootPath` or canonical credential-free HTTPS `repositoryUrl` | Immutable repository ref, includes, excludes, parser and resource bounds, cache policy, strictness, and an optional source-resolved invocation proof. |
| Generate parser | Exactly one of the `default-source` built-in profile or one bounded, non-empty custom `descriptors` array selecting inert source matchers and native adapter identities | Source matchers, declared kinds, adapter fidelity, deterministic priority, and an optional source-resolved invocation proof. |
| Query | Non-empty opaque `graphId`, lowercase 64-character `expectedSnapshotDigest`, and one supported `mode` | Lexical query, endpoints, direction, edge labels, depth, result limit, and an optional source-resolved invocation proof. |
| Explain edge | Non-empty opaque `graphId`, lowercase 64-character `expectedSnapshotDigest`, and non-empty `edgeId` | Optional source-resolved invocation proof. |

When present, the invocation proof is versioned and bound to the exact agentic-graph
tool. It carries the resolved action, semantic and binding tokens, the source
revision, the compatible catalog digest, and the separate routing-schema digest.
The client validates this proof shape without freezing the token values; the
source-backed Skills & Commands resolver remains the token authority.

The client validates stable cross-repository identity and safety fields.
agentic-graph's advertised MCP schemas remain authoritative for optional runtime
arguments and operation-specific evidence, preventing Agentic Canvas OS from
becoming a duplicate runtime schema owner.

## Digest Fence

Successful ingestion exposes an opaque `graphId`, exact `snapshotDigest`,
explicit `complete` state and counts, and a bounded read-only `projection` for
Canvas. Artifact filesystem paths stay inside agentic-graph and never cross this
client contract. Query and explanation must send the graph identity and exact
digest as `expectedSnapshotDigest`; successful responses must echo both values,
and edge explanation must echo the requested edge. Missing, malformed,
replaced, stale, or mismatched identity fails closed instead of selecting
another snapshot.

The typed client never invents, normalizes, upgrades, or substitutes a digest.
The artifact and snapshot remain agentic-graph-owned.

Successful parser generation exposes exactly one canonical inert
`parserRegistry` using the explicit v2 schema and matching
`parserRegistryDigest`. agentic-graph validates native adapter identity and fidelity,
rejects ambiguous matchers, and can compile bounded finite declarative grammar
data for otherwise unregistered syntax into deterministic explained AST
evidence. The typed client validates the grammar shape and version while
agentic-graph remains the semantic compiler owner. The result contains no generated
code, executable payload, private artifact path, adapter implementation, or
implicit ingest. `profile: "default-source"` selects the built-in native source
registry; it is an alternative to `descriptors`, never a download, executable
selection, or implicit network request. A later ingest must resubmit that registry with its exact
expected digest; drift fails closed before discovery.

## Source And Import Boundary

The existing agentic-graph Toolbar > Launch > Import folder flow remains the
explicit local-corpus acquisition surface. Toolbar > Launch > Import URL opens
the shared FloatingPanel Skills & Commands catalog for the source-backed
agentic-graph ingestion command. The Canvas resolves that command's `/`,
`#`, and `@` tuple through `agentic-graph.agentic_canvas_os.docs.invoke` before the
local agentic-graph MCP host receives the repository URL. The Launch surface
must not own a second catalog or a hardcoded semantic/binding list.

URL acquisition, when invoked, is a separately bounded network stage that
resolves an immutable source revision before local parsing. Agentic Canvas OS
does not clone, crawl, or fetch. A raw local path is never forwarded through
the generic remote control-plane client.

Source admission, executable parser generation, language adapters, source
scopes, incremental shards, graph resolution, Canvas projection, and artifact
persistence remain in agentic-graph. Agentic Canvas OS exposes only the canonical
source-backed invocation and typed client contract; it must not add a second
parser, snapshot store, graph query engine, standalone MCP server, or package
command for those concerns.

Parser generation is independently invocable through its exact source-backed
tuple; generation does not ingest a workspace, and ingestion does not silently
generate, select, or upgrade an undeclared parser.

## Semantic And Evidence Policy

`#agentic-graph` means deterministic, source-backed structure. Every edge
must retain a stable identity, fixed explanation, extraction rule, parser
identity, source path and digest, exact span, bounded excerpt evidence,
resolution premises, and ambiguity or confidence state. Unsupported or partial
sources remain typed omissions; they do not become guessed facts.

Parsing and querying use no model, embedding, vector store, similarity lookup,
or remote graph service. Network access is outside parsing and query; it is
permitted only in an explicitly selected and separately evidenced acquisition
stage such as Import URL.

## Readiness Boundary

This repository is contract/client-ready when the dictionaries, exact tool
mapping, pre-transport request validation, parser and snapshot digest fences,
and no-duplicate-runtime checks pass. That evidence does not make the combined
feature runtime-ready.

Combined runtime readiness requires the exact protected agentic-graph revision to
prove bounded ingestion, deterministic output, complete import accounting,
source-scoped resolution, every-edge evidence, local query and explanation,
Canvas projection, and zero model/embedding/vector behavior. Production and
Cloudflare remain outside this contract.

VCC: run `npm run agentic-graph-contract:check` and `npm run docs:check`.
Require zero failures, no Agentic Canvas OS executable graph runtime, and
separate exact agentic-graph runtime proof before any combined readiness claim.
