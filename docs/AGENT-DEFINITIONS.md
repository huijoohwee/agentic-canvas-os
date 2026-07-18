---
title: "Agent Definitions Runtime Contract"
graphId: "md:agent-definitions-runtime"
doc_type: "Runtime Contract"
date: "2026-07-18"
lang: "en-US"
schema: "agent-definitions-runtime-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "provider-neutral agent definition registry for Agentic Canvas OS"
runtime_scope: "model and instruction ownership plus reference-only tools, guardrails, MCP servers, handoffs, and structured output"
runtime_claim: "local registration, preparation, revision fencing, capability authorization, and output validation are runtime-ready in Dev; downstream agent execution and live provider behavior remain unverified"
runtime_owner: "../agent-api/src/agent-definitions.js"
runtime_proof: "../__tests__/agent-definitions.test.mjs"
external_pattern_source: "https://developers.openai.com/api/docs/guides/agents/define-agents"
external_source_policy: "concept reference only; forbid copied code, examples, prompts, schemas, fixtures, tests, or prose"
publish_policy: "Dev-only until explicit operator approval"
---

# Agent Definitions Runtime

The Agent Definition Registry makes one specialist configuration the stable unit passed into the existing Agentic Canvas OS execution stack. A definition owns its identity, model route, ordered instruction blocks, and optional references to tools, guardrails, MCP servers, handoff targets, and an output schema. It does not execute a model or grant itself any capability.

The cited OpenAI guide informs only the capability category. Local field names, registration rules, preparation packets, validation results, bounds, tests, and prose are independently authored. No external SDK implementation, code sample, prompt, schema, fixture, test, or documentation text is imported or reproduced.

## Ownership Boundary

| Owner | Responsibility | Forbidden claim |
|---|---|---|
| Agent Definition Registry | Validate, freeze, revision-fence, register, prepare, and remove bounded agent definitions. | Registration is not model execution, provider configuration, or permission. |
| Application capability authorizer | Revalidate every tool, guardrail, MCP server, and structured-output schema reference for the prepared agent revision. | A definition reference cannot mint a grant, credential, endpoint, or approval. |
| Running Agents adapter | Consume a prepared packet and drive the bounded application turn. | The definition registry does not duplicate loop, streaming, pause, continuation, or cost ownership. |
| Tool, guardrail, and MCP owners | Resolve definitions and enforce policy, approvals, execution, audit, and cost. | Agent metadata cannot weaken the existing real owner. |
| Structured-output validator | Check a bounded JSON result against the application-owned schema identity. | A declared schema id does not prove validation or provider conformance. |
| Provider adapter | Translate the prepared model route and instructions to an eligible provider request and return actual usage. | Local preparation never proves a provider call or model behavior. |

## Definition Contract

Every registration requires `id`, `revision`, `name`, a model route, and at least one ordered instruction block. Optional behavior remains reference-only.

| Field | Local shape | Runtime rule |
|---|---|---|
| Identity | `id`, `revision`, `name` | Identity is bounded and immutable. Reusing a revision with different content fails; a new revision replaces the prior active revision. |
| Model | `provider`, `protocol`, `model` | The route is descriptive configuration only. Credentials, endpoints, arbitrary settings, and provider objects are rejected as unknown fields. |
| Instructions | Ordered `{ name, content }[]` | Names are unique, content is bounded, order is preserved, and no hidden dynamic function enters the registry. |
| Tools | `{ name, loading }[]` | `loading` is `direct` or `deferred`; the actual Function Calling or Tool Search owner still resolves and authorizes it. |
| Guardrails | `{ name, stage }[]` | Input and output references identify application-owned checks; they never replace tool approval or gateway policy. |
| MCP servers | `{ name }[]` | Only logical names are accepted. Transport endpoints, credentials, and client objects stay in the MCP owner. |
| Handoffs | `{ targetAgentId, summary }[]` | Self-handoffs and duplicate targets fail at registration; missing targets fail at preparation; the target's active revision is recorded. |
| Output | Text mode or `{ mode: structured, schemaId }` | Structured results remain invalid until the injected application validator accepts the bounded JSON value. |

Unknown fields fail closed at each definition layer. This keeps secrets, executable callbacks, provider wire objects, and embedded agent implementations outside the stable packet.

## Preparation Flow

| Stage | Input | Output | Stop condition |
|---|---|---|---|
| Resolve | Agent id and optional exact revision | Active immutable definition | Unknown agent or stale revision blocks. |
| Authorize | Tool, guardrail, MCP server, and output-schema references | One explicit application decision per reference | Missing authorizer, authorizer failure, or any denial blocks the whole packet. |
| Verify handoffs | Declared target ids | Target id, active revision, name, and summary | Missing target blocks; target configuration is never embedded recursively. |
| Prepare | Validated definition plus decisions | Immutable runtime packet and compact evidence | No adapter or provider call occurs. |
| Execute downstream | Prepared packet | Running Agents lifecycle | Execution is outside this registry and remains unverified until the actual adapter reports it. |

Capability decisions may run concurrently, but preparation settles once and returns no partial ready packet. The evidence reports only the number of authorized references, verified targets, the downstream execution owner, and an honest `unverified` provider status.

## Revision And Capacity Rules

The registry keeps one active revision per agent id. Registering identical content at the same revision is idempotent. Registering different content under the same revision returns a conflict. A changed revision atomically replaces the active definition, and callers requesting the old revision receive a stale-revision block.

Definitions are isolate-scoped and capacity-bounded. The registry does not silently evict an agent because eviction could invalidate a handoff between validation and execution. Applications must remove a definition explicitly or create a larger registry after reviewing memory and ownership impact.

## Structured Output Validation

Text agents accept only bounded strings. Structured agents normalize bounded JSON and call the injected validator with the exact agent id, revision, schema id, and output. The validator may return success or bounded issue text. Missing validators, thrown validator errors, invalid results, oversized output, and oversized issue evidence remain typed blocked outcomes.

Schema identities are authorized during preparation and validated again at final output. This separation prevents a declared output contract from becoming either a capability grant or a fabricated proof that the provider returned conforming data.

## Default Bounds

| Bound | Default |
|---|---:|
| Active agents | 64 |
| Instruction blocks per agent | 16 |
| References per optional behavior family | 64 |
| Serialized definition | 200,000 characters |
| Combined instruction content | 100,000 characters |
| Final output | 200,000 characters |
| Structured validation issues | 20,000 characters |

All bounds are explicit positive integers at registry construction. Readiness exposes configuration flags, limits, and counters without definition content, instruction text, endpoints, or credentials.

## Acceptance Contract

- Given a minimal definition, when it is registered and prepared, then the result preserves exact model and instruction order in a frozen packet with empty optional behavior.
- Given optional references, when the application authorizes every reference and all handoff targets exist, then preparation returns one complete packet without resolving credentials or executing a capability.
- Given a missing authorizer, denial, unknown handoff, stale revision, duplicate identity, unknown field, or capacity breach, when preparation or registration runs, then it fails closed with a typed reason.
- Given text or structured output, when validation runs, then only a bounded string or application-validator-approved JSON result becomes valid.
- Given default Worker construction, when readiness is read, then the contract and bounds are visible while definition configuration is false and provider execution remains `unverified`.

VCC: run `npm run agent-definitions:check` plus the affected app and Worker tests; require zero failures, immutable packets, explicit revision fencing, reference-only capabilities, target verification, structured-output validation, bounded counters, no copied artifacts, no paid call, no Prod mirror mutation, and no Cloudflare action.
