---
title: "Deterministic Knowledge Graph Invocation Contract"
graphId: "md:agentic-canvas-os-deterministic-knowledge-graph"
doc_type: "Invocation And Client Contract"
date: "2026-07-30"
lang: "en-US"
schema: "deterministic-knowledge-graph-invocation-contract/v1"
frontmatter_contract: "required"
status: "spec-complete"
authority: "canonical command, semantic, binding, policy, and typed Knowgrph client contract"
runtime_scope: "Agentic Canvas OS metadata resolution and MCP request forwarding"
runtime_claim: "contract/client-ready; Knowgrph owns the executable parser, graph, artifact, query, explanation, import, and Canvas runtime"
runtime_proof: "RUNTIME-PROOF.md"
publish_policy: "Dev-only until exact protected integration and runtime proof"
invocations:
  - {action: "/knowledge.graph.ingest", semantics: ["#knowledge-graph", "#mcp", "#runtime-ready"], bindings: ["@working-directory", "@knowledge-graph", "@operator", "@runtime-proof"]}
  - {action: "/knowledge.graph.query", semantics: ["#knowledge-graph", "#mcp", "#vcc"], bindings: ["@knowledge-graph", "@runtime-proof"]}
  - {action: "/knowledge.graph.explain", semantics: ["#knowledge-graph", "#mcp", "#vcc"], bindings: ["@knowledge-graph", "@runtime-proof"]}
mcp_dispatch:
  "/knowledge.graph.ingest": "knowgrph.knowledge_graph.ingest"
  "/knowledge.graph.query": "knowgrph.knowledge_graph.query"
  "/knowledge.graph.explain": "knowgrph.knowledge_graph.explain_edge"
external_dependency: "forbidden"
---

# Deterministic Knowledge Graph Invocation Contract

## Outcome

Agentic Canvas OS supplies the canonical `/`, `#`, and `@` vocabulary, policy
boundaries, and typed MCP client methods for turning an explicitly selected
codebase plus its docs, SQL schemas, configs, and text-bearing PDFs into a
queryable knowledge graph. Knowgrph owns the executable parser, graph builder,
artifact store, queries, edge explanations, Launch import flows, and Canvas
projection.

The split is deliberate: dictionary resolution returns metadata only. It never
reads a workspace, parses a file, writes an artifact, or implies operator
approval. Execution requires an explicit MCP `tools/call` through the existing
Knowgrph transport.

## Canonical Invocation Mapping

| Agentic Canvas OS invocation | Exact Knowgrph tool |
|---|---|
| `/knowledge.graph.ingest #knowledge-graph #mcp #runtime-ready @working-directory @knowledge-graph @operator @runtime-proof` | `knowgrph.knowledge_graph.ingest` |
| `/knowledge.graph.query #knowledge-graph #mcp #vcc @knowledge-graph @runtime-proof` | `knowgrph.knowledge_graph.query` |
| `/knowledge.graph.explain #knowledge-graph #mcp #vcc @knowledge-graph @runtime-proof` | `knowgrph.knowledge_graph.explain_edge` |

`createKnowgrphKnowledgeGraphClient` binds `ingestKnowledgeGraph`,
`queryKnowledgeGraph`, and `explainKnowledgeGraphEdge` to a host-supplied local
MCP transport. `createKnowgrphMcpClient` exposes the same typed methods only
when its Streamable HTTP endpoint is loopback. Both paths snapshot and validate
the request before any asynchronous boundary, validate response identity and
projection bounds, reject private store paths recursively, and call only the
exact tools above.

## Request Contract

| Operation | Required identity | Optional fields owned by Knowgrph |
|---|---|---|
| Ingest | Exactly one explicit local `rootPath` or canonical credential-free HTTPS `repositoryUrl` | Immutable repository ref, includes, excludes, parser and resource bounds, cache policy, strictness, and an optional source-resolved invocation proof. |
| Query | Non-empty opaque `graphId`, lowercase 64-character `expectedSnapshotDigest`, and one supported `mode` | Lexical query, endpoints, direction, edge labels, depth, result limit, and an optional source-resolved invocation proof. |
| Explain edge | Non-empty opaque `graphId`, lowercase 64-character `expectedSnapshotDigest`, and non-empty `edgeId` | Optional source-resolved invocation proof. |

When present, the invocation proof is versioned and bound to the exact Knowgrph
tool. It carries the resolved action, semantic and binding tokens, the source
revision, the compatible catalog digest, and the separate routing-schema digest.
The client validates this proof shape without freezing the token values; the
source-backed Skills & Commands resolver remains the token authority.

The client validates stable cross-repository identity and safety fields.
Knowgrph's advertised MCP schemas remain authoritative for optional runtime
arguments and operation-specific evidence, preventing Agentic Canvas OS from
becoming a duplicate runtime schema owner.

## Digest Fence

Successful ingestion exposes an opaque `graphId`, exact `snapshotDigest`,
explicit `complete` state and counts, and a bounded read-only `projection` for
Canvas. Artifact filesystem paths stay inside Knowgrph and never cross this
client contract. Query and explanation must send the graph identity and exact
digest as `expectedSnapshotDigest`; successful responses must echo both values,
and edge explanation must echo the requested edge. Missing, malformed,
replaced, stale, or mismatched identity fails closed instead of selecting
another snapshot.

The typed client never invents, normalizes, upgrades, or substitutes a digest.
The artifact and snapshot remain Knowgrph-owned.

## Source And Import Boundary

The existing Knowgrph Toolbar > Launch > Import folder flow remains the
explicit local-corpus acquisition surface. Toolbar > Launch > Import URL opens
the shared FloatingPanel Skills & Commands catalog for the source-backed
knowledge-graph ingestion command. The Canvas resolves that command's `/`,
`#`, and `@` tuple through `knowgrph.agentic_canvas_os.docs.invoke` before the
local knowledge-graph MCP host receives the repository URL. The Launch surface
must not own a second catalog or a hardcoded semantic/binding list.

URL acquisition, when invoked, is a separately bounded network stage that
resolves an immutable source revision before local parsing. Agentic Canvas OS
does not clone, crawl, or fetch. A raw local path is never forwarded through
the generic remote control-plane client.

Source admission, parser generation, language adapters, source scopes,
incremental shards, graph resolution, Canvas projection, and artifact
persistence remain in Knowgrph. Agentic Canvas OS must not add a second parser,
snapshot store, graph query engine, standalone MCP server, or package command
for those concerns.

## Semantic And Evidence Policy

`#knowledge-graph` means deterministic, source-backed structure. Every edge
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
mapping, pre-transport request validation, digest fence, and no-duplicate-runtime
checks pass. That evidence does not make the combined feature runtime-ready.

Combined runtime readiness requires the exact protected Knowgrph revision to
prove bounded ingestion, deterministic output, complete import accounting,
source-scoped resolution, every-edge evidence, local query and explanation,
Canvas projection, and zero model/embedding/vector behavior. Production and
Cloudflare remain outside this contract.

VCC: run `npm run knowledge-graph-contract:check` and `npm run docs:check`.
Require zero failures, no Agentic Canvas OS executable graph runtime, and
separate exact Knowgrph runtime proof before any combined readiness claim.
