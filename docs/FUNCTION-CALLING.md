---
title: "Function Calling Runtime Contract"
graphId: "md:function-calling-runtime"
doc_type: "Runtime Contract"
date: "2026-07-18"
lang: "en-US"
schema: "function-calling-runtime-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "bounded direct function-call orchestration policy for Agentic Canvas OS"
runtime_scope: "provider-neutral model adapter and application tool-gateway loop"
runtime_claim: "local direct-call controller is runtime-ready; live provider execution and gateway integration remain unverified"
runtime_owner: "../agent-api/src/function-calling.js"
runtime_proof: "../__tests__/function-calling.test.mjs"
external_pattern_source: "https://developers.openai.com/api/docs/guides/function-calling"
external_source_policy: "concept reference only; forbid copied code, examples, prompts, schemas, fixtures, tests, or prose"
publish_policy: "Dev-only until explicit operator approval"
---

# Function Calling Runtime

The direct-call runtime gives a model a bounded catalog of application-owned functions and returns each requested result to the same active response chain. The repository owns validation, selection policy, call correlation, continuation, limits, cost evidence, and sanitized readiness. Injected adapters own provider translation and the real tool gateway owns authorization and execution.

The cited OpenAI guide informs the capability class only. The controller, canonical vocabulary, schemas, tests, and documentation are independently authored. Exact provider or model support is declared by an adapter; the runtime never guesses support from a model name.

## Ownership Boundary

| Owner | Responsibility | Forbidden claim |
|---|---|---|
| Model adapter | Translate the canonical request into the selected provider protocol, normalize response items, and return actual usage. | Configuration alone does not prove a provider accepted functions or continued a response. |
| Function-calling controller | Validate strict declarations, selection policy, response identity, reasoning replay, call ids, bounds, and final evidence. | It does not invent tools, grant permission, execute provider output as code, or retain reasoning items. |
| Tool Search controller | Supply only direct or already-loaded definitions from the active revision-bound session. | Loading a definition never grants underlying execution permission. |
| Tool gateway | Revalidate identity, arguments, risk, approvals, output, audit hooks, and cost under the real tool owner. | Session authentication, model selection, or a function declaration is not action approval. |
| Programmatic controller | Optionally reduce predictable read-only multi-call stages in a provider-hosted sandbox. | Hosted programs do not replace the direct path for writes, approvals, semantic judgment, or native evidence. |

## Typed Contract

`run` accepts a run id, JSON-compatible input, explicit capabilities, current tool records, a selection policy, a parallel-call preference, approval references, and an optional abort signal. Approval references reach both adapters, but neither authentication nor reference presence grants an action. Every tool has one globally unique name, an independently authored description, strict object parameters, a strict output schema, direct-caller policy, risk and approval metadata, and executable argument and output validators.

Only the provider-facing function fields leave the controller. Risk, approvals, validators, output schemas, and owner metadata stay application-side. The adapter maps provider wire names and encoded arguments into the canonical camel-case items used here.

A normalized model turn contains a response id, completed status, actual cost log, and typed items. Supported active-loop items are opaque reasoning, function calls, and one final message. A function call contains a unique call id, exact tool name, and JSON arguments. The gateway result becomes a `function_call_output` with that same call id. Reasoning items returned beside calls are passed into the next turn with the correlated outputs and previous response id, but are neither persisted nor returned in the completed result.

The final result contains only final output, aggregate model cost, aggregate gateway cost, and compact evidence. Provider reasoning, intermediate arguments, tool results, and approval data do not cross that boundary.

## Strict Schemas

Every declaration must opt into strict validation. Each object node rejects extra properties and lists every declared property exactly once as required. Optional values use a nullable value type instead of omitting the property from `required`. Nested objects, arrays, combinators, and definitions are checked recursively before a model or gateway call.

The local strict check is a fail-closed contract, not a provider-schema clone. Provider-specific keyword support remains the adapter's responsibility. A provider that cannot satisfy the declared strict capability must block before spend rather than silently downgrade validation.

## Selection And Parallel Policy

| Mode | Local behavior |
|---|---|
| `auto` | The model may return final output or one or more eligible function calls. |
| `required` | At least one eligible function call must complete before final output. |
| `none` | Any function call is a typed policy violation. |
| `forced` | The named function must be called exactly once before final output. |
| `allowed` | Calls stay inside an explicit subset; the subset may be optional or require at least one call. |

The full stable declaration list can remain unchanged while `allowed` narrows one turn's callable subset, preserving the cache-context owner's stable-prefix boundary. The controller still receives only definitions authorized for the active Tool Search session.

Parallel calls require both an explicit request and adapter capability. Disabling parallel calls permits at most one call in a turn. Enabling them still honors the controller's call total and batch-width limits; it never expands permissions or changes approval requirements.

## Application Gateway Loop

| Stage | Input | Output | Stop condition |
|---|---|---|---|
| Validate | Run, capabilities, strict tools, choice, approvals | Immutable request or typed rejection | Missing adapter, gateway, continuation, reasoning replay, or requested parallel capability blocks before spend. |
| Advance | Initial request or previous response plus reasoning and correlated outputs | Provider-normalized turn and actual model cost | Incomplete, malformed, cost-unreported, replayed, or unsupported items block. |
| Select | Function calls and choice policy | Eligible exact tool records | Unknown, direct-disabled, disallowed-subset, forced-name, or parallel violation blocks. |
| Execute | Validated arguments, direct caller identity, approvals, policy metadata | Gateway envelope with typed output and cost | Gateway denial, missing approval, invalid arguments or output, timeout, or size overflow blocks. |
| Continue | Previous response id, reasoning items, and same-id outputs | Next model turn | Turn, call, duplicate-id, abort, or timeout limit blocks. |
| Finalize | One final message after required calls | Final output, compact evidence, and separate costs | No reasoning or intermediate payload is returned. |

The gateway envelope may complete or return a typed policy block. A block keeps its reason and returned cost evidence; the controller never converts it into a synthetic tool result or retries it automatically.

## Bounds And Cost Evidence

Defaults allow eight model turns, 32 total calls, eight calls per parallel batch, 128 visible functions, 100,000 serialized schema characters, 200,000 serialized characters per tool result, and 60 seconds per model or gateway stage. Duplicate active run ids serialize and duplicate call ids fail instead of replaying an action.

Every attempted model turn and gateway execution must return the repository cost-log fields, including provider cache status and cache token counts. Preflight blocks report explicit `not-run` zero state. An attempted operation without usable cost evidence reports nullable `unreported` state instead of claiming zero spend. Model and gateway costs remain separate so an unknown tool charge cannot hide behind known model usage.

`providerExecutionStatus` stays `unverified` in `/api/ready`. Offline adapter tests prove the controller's enforcement only; they do not prove a live model, provider cache result, external data source, or deployed gateway.

## VCCs

- Given a strict direct function, when the adapter returns reasoning plus one call, then the gateway receives the exact call identity, the next turn receives that reasoning plus a same-id output and previous response id, and the completed result excludes reasoning and intermediate payloads.
- Given automatic, required, none, forced, or allowed selection, when a response violates the selected policy, then the controller blocks before an unauthorized gateway action.
- Given parallel output, missing capabilities, lax schemas, unknown or repeated calls, invalid arguments or outputs, approval denial, excess bounds, abort, or timeout, when the controller evaluates the run, then it returns typed evidence with honest model and gateway cost states.
- Given an unconfigured Worker, when readiness is read, then the contract and bounds are visible while adapter, gateway, and live provider execution remain unverified.

VCC: run `npm run function-calling:check` and the affected app and Worker tests; require zero failures, exact call-id continuation, no reasoning-item return, no paid live call, no Prod mirror mutation, and no Cloudflare action.
