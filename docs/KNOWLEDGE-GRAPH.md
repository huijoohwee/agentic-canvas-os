---
title: "Deterministic Codebase Knowledge Graph Contract"
graphId: "md:agentic-canvas-os-deterministic-knowledge-graph"
doc_type: "Runtime Contract"
date: "2026-07-22"
lang: "en-US"
schema: "deterministic-knowledge-graph-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "canonical host invocation grammar and clean-room runtime boundaries for Knowgrph codebase knowledge graphs"
runtime_scope: "bounded local ingestion, deterministic graph queries, and source-backed edge explanations"
runtime_claim: "Agentic Canvas OS owns invocation truth; Knowgrph local MCP owns execution and generated graph snapshots"
runtime_proof: "RUNTIME-PROOF.md"
publish_policy: "Dev-only until explicit operator approval"
invocations:
  - {action: "/knowledge.graph.ingest", semantics: ["#knowledge-graph", "#mcp", "#runtime-ready"], bindings: ["@working-directory", "@knowledge-graph", "@operator", "@runtime-proof"]}
  - {action: "/knowledge.graph.query", semantics: ["#knowledge-graph", "#mcp", "#vcc"], bindings: ["@knowledge-graph", "@runtime-proof"]}
  - {action: "/knowledge.graph.explain", semantics: ["#knowledge-graph", "#mcp", "#vcc"], bindings: ["@knowledge-graph", "@runtime-proof"]}
mcp_dispatch:
  "/knowledge.graph.ingest": "knowgrph.knowledge_graph.ingest"
  "/knowledge.graph.query": "knowgrph.knowledge_graph.query"
  "/knowledge.graph.explain": "knowgrph.knowledge_graph.explain_edge"
external_pattern_sources: ["https://github.com/Graphify-Labs/graphify"]
external_dependency: "forbidden"
---

# Deterministic Codebase Knowledge Graph

## Outcome

One explicit workspace root can be compiled into a bounded local graph covering parser-supported source code, authored documentation, SQL definitions, structured configuration, and text-bearing PDFs. The resulting snapshot is queryable through deterministic lexical and graph operations. Every returned relationship carries a plain explanation plus exact source evidence.

No model, embedding, vector database, hosted index, remote parser, or network fetch participates in ingestion, query, or explanation. Unsupported inputs produce typed omissions; they are never sent to a semantic fallback.

The referenced [Graphify repository](https://github.com/Graphify-Labs/graphify) informs the product-level usefulness of a codebase graph only. This subsystem is clean-room work. Copying or adapting Graphify code, prose, prompts, APIs, schemas, algorithms, parser tables, fixtures, tests, examples, package conventions, generated layouts, or dependency choices is forbidden. The runtime must not import, invoke, install, download, vendor, or require Graphify, its CLI, its packages, or its services.

## Canonical Invocation And Dispatch

| Host invocation | Exact Knowgrph local MCP tool | Boundary |
|---|---|---|
| `/knowledge.graph.ingest #knowledge-graph #mcp #runtime-ready @working-directory @knowledge-graph @operator @runtime-proof` | `knowgrph.knowledge_graph.ingest` | Creates or replaces only the requested generated snapshot under the bounded workspace artifact owner. |
| `/knowledge.graph.query #knowledge-graph #mcp #vcc @knowledge-graph @runtime-proof` | `knowgrph.knowledge_graph.query` | Reads one exact snapshot and returns a bounded deterministically ordered subgraph. |
| `/knowledge.graph.explain #knowledge-graph #mcp #vcc @knowledge-graph @runtime-proof` | `knowgrph.knowledge_graph.explain_edge` | Reads one exact edge and returns its stored explanation and evidence without reparsing or generation. |

The three dictionaries remain the only authority for `/`, `#`, and `@` token identity. This table records the required cross-repository handoff; it is not an alias registry. The host resolves invocation metadata, validates the exact tuple, and then explicitly calls the mapped tool.

`knowgrph.agentic_canvas_os.docs.invoke` performs dictionary lookup only. It returns metadata and never ingests files, opens a graph snapshot, runs a query, explains an edge, mutates an artifact, or grants approval. A successful lookup must not be reported as tool execution.

## Source Boundary

| Source class | Deterministic extraction | Typed boundary |
|---|---|---|
| Parser-supported code | Local concrete or abstract syntax parser emits files, declarations, symbols, imports, calls, inheritance, references, and containment supported by that parser. | Unsupported language or syntax is reported with parser identity and reason; regex guesses do not masquerade as AST facts. |
| Markdown; other text docs | Local structural parser emits a source document, Markdown headings, containment, Markdown links, and bounded non-code text units for lexical query. | Plain-text and unregistered document formats remain inventory-only with typed unsupported diagnostics; code fences and prose references are not promoted to inferred graph relationships. |
| SQL | Local statement parser emits tables, columns, primary keys, foreign-key references, and exact-name cross-file table resolution. | Unrecognized dialect constructs remain typed omissions rather than approximate edges. |
| JSON, YAML, TOML, and registered configs | Local format parser emits source files, JSON object keys and array positions, scalar value types, and structural config sections, blocks, keys, or instruction names. | Raw scalar, assignment, command, and credential values are omitted; configuration never authorizes execution or implies a reference edge. |
| Text-bearing PDF | Local deterministic text extraction feeds page headings, bounded extracted text units, extracted headings, and Markdown-style links into the same structural document parser. | Encrypted, malformed, image-only, or extraction-unavailable input returns a typed gap; zero extracted text does too, while OCR, prose-reference inference, and model fallbacks remain outside this contract. |

The runtime normalizes `@working-directory`, rejects traversal and symlink escape, never scans a home directory or unrelated repository implicitly, and orders admitted workspace-relative paths by a locale-independent ordinal comparator. Every admitted file is bound to its byte digest. Parser identity, parser revision, source digest, and typed diagnostics are part of `@runtime-proof`.

## Graph Snapshot

`@knowledge-graph` identifies one digest-fenced local snapshot view and its bounded manifest. Ingestion atomically replaces only its configured generated artifact; the returned digest identifies the exact content, and a prior digest fails after replacement. The binding is not a database credential, global index, vector store, approval token, or writable source-of-truth graph.

| Record | Required fields | Determinism rule |
|---|---|---|
| Snapshot | schema and contract revisions, source-set digest, graph digest, ordered source/parser manifest, diagnostics, and generated artifact reference | Digest covers canonical data, not timestamps or absolute machine-specific paths. |
| Node | stable id, type, label, workspace-relative source, plus parser-supported qualified identity and span fields where observable | Identity derives only from normalized source evidence and documented canonical fields. |
| Edge | stable id, source id, target id, label, evidence kind, explanation, and parser/source provenance | Identity derives from endpoints, label, extraction rule, source path, and canonical source anchor; duplicate canonical edges collapse deterministically. |
| Evidence | workspace-relative source, line and column span, bounded source excerpt and its digest, parser id and revision, rule id, confidence, and premises where applicable | Evidence must be sufficient to audit the edge without accepting the explanation on trust. |

Every edge has a non-empty deterministic explanation generated from repository-owned templates and its canonical evidence. Explanations never contain model output. An edge that cannot name valid endpoints, label, evidence kind, extraction rule, parser identity, and source evidence is rejected before snapshot publication.

The graph artifact is a canonical local snapshot, not a second authored source store. Re-ingesting unchanged admitted bytes and parser revisions yields the same graph digest and record order. A changed source set or parser revision yields a different proof identity; query and explanation reject a stale digest rather than silently selecting another snapshot.

## Query And Explanation

Query supports bounded normalized lexical search, exact id or label node selection, exact edge-label traversal filters, neighborhoods, impact traversal, shortest paths, and graph summaries. Matching, traversal, limits, tie-breaking, and result ordering are deterministic and versioned. Results include the snapshot digest plus matched or traversed nodes, edges, stored explanations, and evidence; summary mode also returns the artifact diagnostics and parser coverage.

The query tool does not use embeddings, similarity vectors, a vector store, a language model, generated Cypher, or an external graph service. It returns a typed empty or unsupported-query result when the local grammar cannot represent a request.

Explanation accepts exactly one edge id plus the expected snapshot digest. It returns the stored endpoints, edge label, evidence kind, explanation, parser identity and revision, source span and excerpt, confidence, premises, and candidate count. Missing, stale, or malformed edge identity fails closed. Explanation performs no file scan, parser run, inference, model call, network request, or artifact mutation.

## Ownership And Mutation

| Owner | Responsibility | Forbidden ownership |
|---|---|---|
| Agentic Canvas OS | Invocation tokens, binding meaning, semantic proof vocabulary, dispatch mapping, and clean-room boundary. | File parsing, graph persistence, MCP dispatch implementation, source mutation, or deployment. |
| Knowgrph local MCP | Strict tool schemas, bounded workspace admission, local deterministic parsers, canonical graph construction, snapshot storage, query, explanation, and sanitized proof. | A copied Graphify runtime, global index, vector service, model fallback, arbitrary filesystem scan, or deployment path. |
| Operator | Select the workspace and authorize snapshot creation or replacement. | Approval inferred from dictionary lookup, a semantic tag, an existing graph, or a query. |

Ingestion may write only the generated artifact location owned by Knowgrph. It never edits source files, SQL, configuration, documentation, PDFs, Git state, dependency manifests, Prod mirror content, or Cloudflare resources. Query and explanation are read-only and idempotent.

## Runtime And Proof Boundary

Agentic Canvas OS contract readiness requires exact dictionary/frontmatter parity, exact MCP mapping, lookup-versus-execution separation, deterministic and explained-edge requirements, no-vector requirements, and an explicit Graphify no-copy/no-dependency guard.

Combined runtime readiness additionally requires Knowgrph local stdio proof over a repository-owned fixture containing code, Markdown, SQL, config, and a text-bearing PDF. The proof must show repeatable graph digests, AST-backed relationships, source spans, every edge explained, stale-digest rejection, bounded query and path traversal, exact edge explanation, typed unsupported inputs, zero model calls, zero network calls, and no vector-store or Graphify dependency.

Live provider quality, OCR, remote repositories, background indexing, global search, production persistence, Prod mirror mutation, and Cloudflare deployment are outside this contract until separately authorized and evidenced.

## Acceptance Contract

- All five invocation tokens occur exactly once in their canonical dictionary frontmatter and have matching table definitions plus `FACTS.md` direct resolution.
- The three command routes map only to `knowgrph.knowledge_graph.ingest`, `knowgrph.knowledge_graph.query`, and `knowgrph.knowledge_graph.explain_edge`.
- Dictionary resolution remains metadata-only; execution requires a separate explicit local MCP tool call.
- Ingestion is workspace-scoped, local, deterministic, digest-bound, AST-backed for supported code, and typed for unsupported input.
- Every published edge contains deterministic explanation and source evidence, while query and explanation remain vector-free and model-free.
- No Graphify implementation artifact or runtime dependency enters Agentic Canvas OS or Knowgrph.

VCC: run `npm run knowledge-graph-contract:check` and `npm run docs:check`; require zero failures, exact tokens and wire tools, no Graphify dependency, no paid call, no network fetch, no Prod mirror mutation, and no Cloudflare action.
