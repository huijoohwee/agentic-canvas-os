---
title: "Versioned Application Composition Contract"
graphId: "md:agentic-canvas-os-application-composition"
doc_type: "Runtime Contract"
date: "2026-07-22"
lang: "en-US"
schema: "application-composition-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "provider-neutral composition grammar and ownership boundaries for agent and LLM applications"
runtime_scope: "exact component resolution, compatibility planning, deterministic dependency sequencing, and migration diagnostics"
runtime_claim: "Knowgrph owns the local MCP compiler and bounded sequencer; existing agent, model, tool, integration, policy, and persistence owners retain execution authority"
runtime_proof: "RUNTIME-PROOF.md"
publish_policy: "Dev-only until explicit operator approval"
invocation:
  action: "/application.compose"
  semantics: ["#application-composition", "#runtime-ready"]
  bindings: ["@application-manifest", "@component-catalog", "@integration-profile", "@runtime-proof", "@operator"]
mcp_tools:
  - "knowgrph.application.catalog"
  - "knowgrph.application.plan"
  - "knowgrph.application.execute"
external_dependency: "none"
---

# Versioned Application Composition

## Outcome

One source-backed manifest joins exact agent, model, tool, workflow, memory, guardrail, and integration components through typed interfaces. Planning produces an immutable digest-bound application plan. Execution follows that exact plan as a bounded dependency sequence while every step delegates to its existing runtime owner.

The composition layer is not an agent loop, provider adapter, tool gateway, integration proxy, package manager, workflow engine, or deployment controller. It does not infer a component, choose a newer revision, install a dependency, store credentials, or grant an operation.

The referenced OpenAI Symphony project informs only the desired managed-work outcome. No Symphony code, prose, prompts, APIs, schemas, fixtures, tests, package, service, or runtime dependency is copied or required.

## Canonical Invocation

```text
/application.compose #application-composition @application-manifest @component-catalog @integration-profile @runtime-proof
```

The `/`, `#`, and `@` tokens are host-side invocation aliases and metadata, never MCP wire methods. The host resolves them before calling the exact `knowgrph.application.*` tools.

`@operator` is required only when execution can spend, mutate, use authenticated or external services, or cross another existing approval boundary. Catalog and plan remain read-only and zero-spend. Dictionary resolution exposes metadata; it never grants execution.

## Ownership

| Owner | Responsibility | Forbidden ownership |
|---|---|---|
| Agentic Canvas OS | Invocation grammar, component interface rules, plan invariants, proof vocabulary, and owner separation. | Knowgrph state, provider calls, tool execution, integration transport, secrets, or deployment. |
| Knowgrph local MCP | Bounded catalog projection, exact plan compilation, immutable plan digest, dependency admission, sequencing, and sanitized results. | A second agent loop, provider registry, tool gateway, external proxy, silent retry, automatic migration, or deploy path. |
| Existing runtime owners | Agent definitions, model selection, Running Agents lifecycle, orchestration, tools, guardrails, memory, integration transport, authorization, receipts, and cost. | Treating a composition edge or catalog record as approval. |
| Operator | Authorize paid, mutating, authenticated, external, or otherwise gated execution. | Approval inferred from a valid manifest or plan. |

## Source Contracts

`@application-manifest` is a bounded source-backed document with `id`, exact `revision`, source URI and SHA-256 digest, component slots, dependency edges, entrypoints, outputs, and execution bounds. Every slot names an exact component id and revision. Values such as `latest`, mutable tags, version ranges, fallback chains, embedded code, callbacks, packages, commands, endpoints, headers, environment maps, and credentials are invalid.

`@component-catalog` is a host-owned registry projection. Each immutable record names component id and revision, source digest, interface id and revision, input and output port schemas with their SHA-256 digests, provided and required capabilities, runtime owner id, risk class, and readiness. Registration of different content under the same revision is a conflict. A newer record never changes an existing plan.

`@integration-profile` is an opaque host-owned binding for a third-party or local integration. A manifest may name only profile id, exact profile revision, declared capability id, and exact capability revision. Transport, executable, arguments, endpoint, headers, secret bindings, credentials, session objects, and provider payloads stay with the integration owner. Live schema and capability evidence must still match at execution time.

## Deterministic Plan

| Stage | Input | Output | Fail-closed rule |
|---|---|---|---|
| Validate | Invocation and bounded manifest | Canonical manifest or diagnostics | Unknown fields, duplicate slots, mutable versions, hidden executable or connection data, excessive size, or missing bounds block. |
| Resolve | Exact component and integration references | Immutable resolved records | Missing, disabled, stale, conflicting, or changed records block; no fallback or upgrade is selected. |
| Negotiate | Port schema digests and capabilities | Compatible typed edges | Direction, schema, interface revision, required capability, or risk-policy mismatch blocks. |
| Compile | Resolved slots, edges, entrypoints, and bounds | Deterministically ordered dependency DAG | Cycles, orphan required inputs, unreachable outputs, ambiguous producers, or unknown owners block. Loops remain inside their existing lifecycle or orchestration owner. |
| Lock | Canonical manifest and resolved evidence | `application-composition-plan/v1` plus SHA-256 plan digest | The digest binds manifest source, every exact revision and schema digest, edges, order, owners, and bounds. |

Equivalent JSON object key order cannot change the plan digest. Slot ids and edges have one documented canonical ordering. The plan includes no component source body, instruction text, tool schema body, integration configuration, credential, or provider payload.

## MCP Surface

| Tool | Role | Boundary |
|---|---|---|
| `knowgrph.application.catalog` | Return bounded component and integration metadata plus current exact revisions. | Read-only, zero model spend, sanitized, and no global or copied registry scan; absent negotiated capabilities are unsupported. |
| `knowgrph.application.plan` | Validate the canonical invocation, resolve exact records, negotiate compatibility, compile the DAG, and return its immutable digest. | Read-only; no component execution, persistence mutation, external connection, install, or upgrade. |
| `knowgrph.application.execute` | Revalidate the exact plan and sequence ready dependency steps through injected host-owned runtime adapters. | Bounded and idempotency-fenced; every owner retains its schema, approval, receipt, cost, retry, and side-effect policy. No automatic retry, migration, provider fallback, deploy, or continuation beyond the plan bounds. |

Execution never accepts a caller-supplied adapter, command, endpoint, credential, raw MCP transport, provider object, approval array, or tool result. A step can start only after all declared predecessors have terminal valid outputs and its exact owner and schema evidence still match the plan. A failed, paused, blocked, or approval-required step stops admission of dependents and returns bounded owner evidence without synthesizing success.

## Evolution And Migration

Planning may compare explicitly supplied candidate revisions with an existing plan. Diagnostics classify each candidate as `compatible`, `migration_required`, or `blocked`, name changed interfaces, schemas, capabilities, owners, and risk policy, and leave the current plan unchanged. No candidate is downloaded, installed, selected, persisted, or executed automatically.

Future component kinds use the same port, capability, owner, and evidence contracts instead of adding provider-specific manifest fields. A contract-schema revision requires an explicit migration path and a newly reviewed plan digest. An integration capability revision or live schema digest change always requires replanning before another execution.

## Runtime And Proof Boundary

Runtime readiness requires a Knowgrph local stdio proof that catalogs registered fixtures without spend, produces the same digest for equivalent manifests, blocks drift and incompatibility, executes one bounded offline dependency chain through injected owners, and exposes all three MCP tools with strict schemas. Live provider quality, third-party reachability, external SDK compatibility, paid usage, production operation, and deployment remain unverified until separately authorized and evidenced.

Before catalog or tool availability is claimed, the MCP host and server negotiate and persist the exact mutually supported protocol revision and capability set for that connection. Reconnect renegotiates; an absent capability is unsupported, and this contract does not hard-code a future protocol revision.

## Acceptance Contract

- The exact `/`, `#`, and `@` invocation resolves from canonical dictionaries and Knowgrph rejects any mismatch before planning.
- Exact component, profile, capability, interface, and schema revisions produce one deterministic immutable plan digest.
- Missing, mutable, stale, incompatible, cyclic, orphaned, unreachable, over-bound, or ownerless composition input fails before execution.
- Execution sequences only ready DAG steps and delegates every operation to an existing host-owned runtime with its normal authorization, receipts, costs, and stop behavior.
- Upgrade diagnostics never alter the current plan, install dependencies, retry execution, contact a provider, or deploy.

VCC: run `npm run application-composition-contract:check`, `npm run agent-runtime-composition:check`, `npm run progressive-agents:check`, and `npm run docs:check`; require zero failures, exact invocation tokens, strict owner boundaries, deterministic plan evidence, no external dependency, no paid call, no Prod mirror mutation, and no Cloudflare action.
