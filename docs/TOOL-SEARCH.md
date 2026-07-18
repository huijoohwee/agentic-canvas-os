---
title: "Tool Search Runtime Contract"
graphId: "md:tool-search-runtime"
doc_type: "Runtime Contract"
date: "2026-07-18"
lang: "en-US"
schema: "tool-search-runtime-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "session-scoped deferred tool-definition loading policy for Agentic Canvas OS"
runtime_scope: "provider-neutral client and hosted search validation with exact catalog authorization"
runtime_claim: "local deferred-loading controller is runtime-ready; live provider context reduction remains unverified"
runtime_owner: "../agent-api/src/tool-search.js"
runtime_proof: "../__tests__/tool-search.test.mjs"
external_pattern_source: "https://developers.openai.com/api/docs/guides/tools-tool-search"
external_source_policy: "concept reference only; forbid copied code, examples, prompts, schemas, fixtures, tests, or prose"
publish_policy: "Dev-only until explicit operator approval"
---

# Tool Search Runtime

The runtime keeps full schemas for optional tools out of initial model-visible context and loads only an exact selected subset during an active session. Required direct tools remain fully declared. Deferred namespaces expose a bounded name, description, and tool count; deferred standalone functions expose name and description only.

The cited OpenAI guide informs the capability class only. The controller, vocabulary, validation, tests, and documentation are independently authored. Exact model support is declared by the downstream adapter instead of inferred from a model name.

## Ownership Boundary

| Owner | Responsibility | Forbidden claim |
|---|---|---|
| Session catalog owner | Supply currently granted direct and deferred functions plus namespace metadata for one revision. | No global, disabled, stale, or ungranted tool enters a session. |
| Tool Search controller | Freeze the initial context, bound searches, validate returned definitions, track loaded names, and authorize later calls. | Registration does not prove that a provider reduced tokens or reused a cache prefix. |
| Client search adapter | Rank only metadata supplied for still-unloaded session tools and return exact catalog names plus actual cost fields. | Search never returns a schema, invents a tool, or scans another registry. |
| Hosted search adapter | Normalize returned server-search metadata, canonical definitions, and actual model cost. | Provider output is not trusted without exact catalog equality. |
| Tool gateway | Validate arguments, permission, approval, hooks, audit, execution cost, and result under the real tool identity. | Loading a definition grants no new underlying permission. |
| Programmatic controller | Use direct or already-loaded definitions when starting a hosted program. | A running program cannot initiate Tool Search or bypass the top-level load stage. |

## Session Contract

`open` accepts a session id, catalog revision, client or hosted mode, explicit capability flags, namespaces, and function definitions. Every function has a globally unique name, description, object-shaped parameter schema, strictness flag, caller policy, and explicit deferred state. Namespaced tools are deferred together. Malformed catalogs fail before registration.

The immutable initial context contains:

- complete definitions for non-deferred tools;
- metadata-only summaries for deferred namespaces and standalone functions; and
- one neutral search declaration naming client or hosted execution.

For hosted mode only, `open` also returns an adapter-private catalog containing full definitions and explicit deferral state. The downstream adapter maps that neutral catalog to its current provider request. Client mode receives direct definitions only; its deferred catalog never leaves the controller until selection.

Search output is a separate append-only item. It contains only canonical full definitions selected during that search, so loading a tool never rewrites the frozen initial context. The session catalog remains application-private and is released by `close`.

## Resolution Modes

| Mode | Search owner | Accepted output | Failure boundary |
|---|---|---|---|
| Client | Injected metadata search adapter | Unique names from the still-unloaded candidate set, bounded by the requested limit, plus a complete cost log | Missing adapter, timeout, unknown name, direct-tool name, duplicate, replay, missing cost, or excess result blocks. |
| Hosted | Downstream provider adapter | Server-execution metadata, null provider call identity, exact canonical definitions, and a complete cost log | Client-style metadata, altered schema, invented definition, replay, missing cost, or excess result blocks. |

The controller does not execute a model or search algorithm itself. An unconfigured client adapter remains `configured: false` in readiness while the deterministic contract stays visible. Hosted acceptance proves validation of supplied evidence only, not a live provider call.

## Authorization And Programmatic Use

`authorize` permits a direct tool immediately when its caller policy matches. A deferred tool returns `tool_not_loaded` until a successful search adds its exact definition to that session. Unknown and caller-ineligible tools remain blocked.

Tool Search is a top-level planning stage. A request marked as programmatic cannot call the search resolver. The model or application must load required definitions before starting a hosted program, after which the Programmatic Tool Calling controller revalidates caller, risk, approval, schema, and gateway policy as usual.

## Bounds And Evidence

Defaults allow 32 active sessions, 256 tools per session, nine tools per namespace, eight results per search, 16 searches per session, 100,000 serialized schema characters, and a 10-second client search stage. Event ids are one-use, sessions never evict active work silently, and the runtime does not retry searches.

Every completion reports loaded names, remaining deferred count, immutable-prefix status, and a cost log. Client and hosted adapters must report model, prompt tokens, completion tokens, cache hits, and estimated cost. Preflight blocks use the explicit `not-run` zero-cost state; attempted search without usable cost evidence reports nullable `unreported` fields. `providerContextReduction` remains `unverified` in readiness and offline results.

## VCCs

- Given one direct tool and several deferred tools, when a client search selects one exact name, then only that definition appears in the append-only output, the initial context remains unchanged, and unselected tools stay unauthorized.
- Given hosted output with a changed or invented definition, when the controller validates it, then loading fails without expanding session authorization.
- Given a programmatic caller, when it attempts search before a top-level load, then no adapter runs; after a model-owned search loads an eligible tool, normal programmatic caller policy applies.
- Given absent capabilities, missing adapter, namespace overflow, duplicate event, invalid result, timeout, or closed session, when the controller evaluates the request, then it fails closed inside configured bounds.

VCC: run `npm run tool-search:check` and the affected app and Worker tests; require zero failures, immutable initial context, no unselected schema disclosure, no Prod mirror mutation, and no Cloudflare action.
