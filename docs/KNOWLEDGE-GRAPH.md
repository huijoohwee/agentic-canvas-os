---
title: "Native Deterministic Knowledge Graph"
graphId: "md:agentic-canvas-os-deterministic-knowledge-graph"
doc_type: "Runtime Contract"
date: "2026-07-30"
lang: "en-US"
schema: "deterministic-knowledge-graph-contract/v2"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "canonical native parser, graph, query, invocation, and MCP contract"
runtime_scope: "bounded local ingestion, deterministic graph queries, and source-backed edge explanations"
runtime_claim: "Agentic Canvas OS owns and executes one local runtime kernel; dictionary lookup remains metadata-only"
runtime_proof: "RUNTIME-PROOF.md"
publish_policy: "Dev-only until explicit operator approval"
invocations:
  - {action: "/knowledge.graph.ingest", semantics: ["#knowledge-graph", "#mcp", "#runtime-ready"], bindings: ["@working-directory", "@knowledge-graph", "@operator", "@runtime-proof"]}
  - {action: "/knowledge.graph.query", semantics: ["#knowledge-graph", "#mcp", "#vcc"], bindings: ["@knowledge-graph", "@runtime-proof"]}
  - {action: "/knowledge.graph.explain", semantics: ["#knowledge-graph", "#mcp", "#vcc"], bindings: ["@knowledge-graph", "@runtime-proof"]}
mcp_dispatch:
  "/knowledge.graph.ingest": "agentic_canvas_os.knowledge_graph.ingest"
  "/knowledge.graph.query": "agentic_canvas_os.knowledge_graph.query"
  "/knowledge.graph.explain": "agentic_canvas_os.knowledge_graph.explain"
external_dependency: "forbidden"
---

# Native Deterministic Knowledge Graph

## Outcome

One explicit local workspace can be compiled into a queryable graph covering parser-supported code, authored documentation, SQL schemas, structured configuration, and text-bearing PDFs. Ingestion, storage, query, and explanation are native repository modules. They do not call a model, fetch a network resource, create embeddings, use a vector store, or require a remote graph service.

Every relationship has a deterministic explanation and the evidence needed to audit it: source path and digest, parser identity and digest, extraction rule, exact source span, and bounded excerpt. Unsupported or malformed input produces a typed diagnostic instead of a guessed relationship.

## One Runtime, Four Invocation Surfaces

| Surface | Invocation | Native dispatch |
|---|---|---|
| `/` command | `/knowledge.graph.ingest #knowledge-graph #mcp #runtime-ready @working-directory @knowledge-graph @operator @runtime-proof` | `agentic_canvas_os.knowledge_graph.ingest` |
| `/` command | `/knowledge.graph.query #knowledge-graph #mcp #vcc @knowledge-graph @runtime-proof` | `agentic_canvas_os.knowledge_graph.query` |
| `/` command | `/knowledge.graph.explain #knowledge-graph #mcp #vcc @knowledge-graph @runtime-proof` | `agentic_canvas_os.knowledge_graph.explain` |
| MCP | `tools/list` then explicit `tools/call` | The same three tools above, backed by the same runtime instance. |

`#knowledge-graph` supplies semantic identity and `@knowledge-graph` supplies one exact snapshot binding. The command, semantic, and binding dictionaries remain canonical for `/`, `#`, and `@` resolution. Resolution returns metadata only. It never ingests, queries, explains, mutates an artifact, or grants operator approval; execution requires an explicit native tool call.

The stdio entry point is `scripts/knowledge-graph-mcp.mjs`. It emits only newline-delimited JSON-RPC on stdout, reports tool failures as structured results, and requires an explicit artifact root. `src/knowledge-graph/mcp-tools.js` exposes exactly three closed-schema public tools. Parser generation is intentionally internal to ingestion and does not add a fourth tool.

## Parser Generator

A custom parser grammar is inert canonical data with schema `agentic-parser-grammar/v1`. It names an id, version, supported extensions, optional comment prefixes, and bounded ordered extraction rules. A rule is a literal/token sequence that emits either an entity or an observed reference; captures, nesting, relation type, and source selection are declared as data.

Compilation validates a closed grammar, rejects duplicate or unsafe identifiers, canonicalizes it with locale-independent ordering, and returns an immutable `agentic-parser-artifact/v1` value bound to a SHA-256 digest. No source text, function body, dynamic import, evaluation primitive, shell command, or executable generated code enters the artifact.

At ingest time the runtime accepts at most 32 grammar values or stored artifact references. Artifacts are digest-verified before use. The generated tokenizer preserves exact offsets and line/column positions, recognizes declared comments without escaping quoted strings, and produces deterministic entity/reference IR. Brace scopes are represented explicitly. A source line that cannot match the grammar is a bounded diagnostic, not an inferred node.

Generated parsing has deterministic source-byte, code-unit, physical-line, token, rule-work, match, entity, reference, and diagnostic ceilings. Oversized source identity fails before parsing; an in-range work ceiling returns a frozen partial IR with one typed limit diagnostic before the next fact hash.

## Built-In Source Adapters

| Source class | Deterministic output | Typed boundary |
|---|---|---|
| Code | Declarations, containment, imports, calls, inheritance, and observed references for registered JavaScript/TypeScript, Python, Go, Rust, JVM, CLR, C-family, Swift, Ruby, PHP, and shell profiles. | Profiles expose only locally recognized syntax. Unsupported constructs remain omissions; no semantic guess is promoted as AST fact. |
| Markdown and text documents | Nested sections, bounded paragraphs, fenced code blocks, links, autolinks, and relative document targets with exact spans. | Malformed fences and empty documents are diagnostic gaps. Prose inside a code fence does not become a document relationship. |
| SQL | Tables, columns, constraints, indexes, views, alterations, and foreign-key observations from deterministic DDL tokenization. | Unrecognized statements or incomplete constructs remain typed diagnostics. |
| JSON and line configs | Object/key hierarchy plus structural dependency, path, and environment observations for JSON, YAML, TOML, INI, environment, and properties formats. | Invalid JSON is omitted as a typed parse gap. Values do not authorize execution. |
| PDF | Text regions from bounded plain or Flate streams and supported text operands, with byte spans and partial-result diagnostics. | Encrypted, malformed, image-only, over-limit, and unsupported-filter inputs fail closed or return an explicitly partial result. OCR is outside scope. |

All adapters emit the same immutable intermediate representation. It contains parser identity, source identity, ordered entities, observed references, diagnostics, and spans. Graph construction never consumes an untyped adapter-specific side channel.

## Workspace Admission

Ingestion requires a real explicit directory. It rejects a symlink root, never follows symlinks, verifies resolved parents remain beneath the root, and reads only registered source extensions. Built-in ignored directories include version-control metadata, dependency/vendor trees, generated output, caches, and the graph artifact directory.

Admission is bounded by entry count, admitted file count, per-file bytes, total bytes, directory depth, and elapsed time. Paths are workspace-relative and ordered by UTF-8 byte comparison. Each file is read once between before/after metadata checks; drift aborts the ingest. Binary or invalid UTF-8 sources are diagnosed unless the registered adapter consumes bytes directly.

Source files are read-only. Ingestion may write only to the explicit artifact root, which must be a real directory outside any symlink escape and disjoint from the admitted workspace. The runtime never edits code, docs, schemas, configs, PDFs, Git state, package manifests, deployment state, or provider resources.

## Graph Construction

The graph has schema `agentic-knowledge-graph/v1`. Stable ids derive from canonical source-backed fields. Nodes represent files, parser-emitted entities, exact resolved targets, explicit external observations, and ambiguity records. Resolution occurs after all source IR is present:

1. exact path candidates are tested for path-like references;
2. qualified and local symbol indexes are tested for code and schema references;
3. one candidate creates a resolved edge;
4. multiple candidates create an ambiguity node and evidence-bearing candidate edges;
5. no candidate creates an explicit external-observation node.

Every edge passes one evidence factory. Publication rejects an edge without endpoints, kind, deterministic explanation, source digest, parser id and digest, rule id, source span, and excerpt. Explanations are fixed repository-owned templates populated from canonical fields. They are never generated prose. Duplicate canonical edges collapse deterministically.

The snapshot includes ordered sources, parser manifest, diagnostics, nodes, edges, statistics, source-set digest, and zero-call economics. Its graph digest covers canonical content without timestamps or absolute machine paths. Re-ingesting unchanged bytes and parser artifacts yields byte-identical snapshot data and the same digest.

## Storage And Stale Reads

`src/knowledge-graph/snapshot-store.js` writes immutable, content-addressed parser and graph artifacts. A same-digest collision with different bytes is rejected. The current graph pointer is replaced atomically only after the complete snapshot has been synchronized.

Query and explanation require both graph id and expected digest. If the current pointer advances, an older expected digest fails with `snapshot_stale`; the runtime never silently selects another snapshot. Artifact ids and digests are validated before path construction, real paths are contained beneath the configured store, files have size ceilings, and malformed JSON fails closed.

Every loaded snapshot is revalidated after digest verification: source and parser manifests, record ordering, unique ids, endpoint closure, statistics, exact-zero economics, evidence source/parser membership, spans, excerpt digests, candidate ids, and edge identities must all agree before a query can index it.

## Query And Explanation

Query schema `agentic-knowledge-graph-query/v1` supports `summary`, `search`, `node`, `neighbors`, `impact`, `path`, and `match`. Lexical scoring uses normalized exact/prefix/substring terms over canonical node fields. Traversal uses local adjacency maps and bounded breadth-first search with fixed depth and result limits. Edge/node kind filters and tie-breaking are deterministic.

Each result records its operation, exact digest, bounded nodes and edges, and a query plan stating that vector lookup was not used. Path results include the discovered canonical path or an explicit not-found plan. Query never generates a graph language statement or delegates interpretation to another service.

Explanation accepts one exact edge id. It returns the stored edge and evidence without reparsing sources, scanning the workspace, inferring new facts, mutating state, or calling a model. Missing, malformed, or stale identity fails closed.

## Verification Contract

The repository-owned fixtures cover mixed code, docs, SQL, config, generated grammar input, and a text-bearing PDF. Proof requires:

- byte-stable repeat ingestion and a changed digest after source change;
- exact parser-artifact digest verification and inert persisted artifacts;
- stable nodes, edges, spans, evidence, and non-empty explanation for every edge;
- deterministic lexical, neighborhood, impact, path, match, summary, and exact-edge operations;
- typed symlink, binary, unsupported, malformed, encrypted, image-only, over-limit, and stale-digest behavior;
- exactly three native MCP tools with closed top-level schemas and one shared runtime;
- zero model calls, network calls, embeddings, and vector stores;
- no source mutation, provider mutation, production publish, or deployment.

VCC: run `npm run knowledge-graph:check`, `npm run docs:check`, and `npm run check`. Require zero failures and inspect the saved runtime-proof entry before any readiness promotion.
