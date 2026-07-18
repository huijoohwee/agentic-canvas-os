---
title: "Function Calling Runtime Contract"
graphId: "md:function-calling-runtime"
doc_type: "Runtime Contract"
date: "2026-07-19"
lang: "en-US"
schema: "function-calling-runtime-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "bounded direct function-call orchestration policy for Agentic Canvas OS"
runtime_scope: "provider-neutral controller, OpenAI Responses adapter, policy-enforcing Knowgrph MCP tool gateway, and durable reviewed execution receipts"
runtime_claim: "direct calls, durable reviewed continuation, and one native deduplicated run-note mutation are runtime-ready offline in Dev; live provider, remote Worker, Prod, and Cloudflare execution remain unverified"
runtime_owner: "../agent-api/src/function-calling.js; ../agent-api/src/function-calling-manager.js; ../agent-api/src/function-execution-receipts.js; ../agent-api/src/openai-responses-function-adapter.js; ../agent-api/src/knowgrph-function-gateway.js; ../agent-api/src/knowgrph-function-tools.js"
runtime_proof: "../__tests__/function-calling.test.mjs; ../__tests__/function-calling-continuation.test.mjs; ../__tests__/function-execution-receipts.test.mjs; ../__tests__/openai-function-gateway.test.mjs; ../scripts/function-gateway-run-note-proof.mjs"
external_pattern_source: "https://developers.openai.com/api/docs/guides/function-calling"
durable_storage_source: "https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/"
external_source_policy: "concept reference only; forbid copied code, examples, prompts, schemas, fixtures, tests, or prose"
publish_policy: "Dev-only until explicit operator approval"
---

# Function Calling Runtime

The direct-call runtime gives a model a bounded catalog of application-owned functions and returns each requested result to the same active response chain. The repository owns validation, selection policy, call correlation, continuation, limits, cost evidence, and sanitized readiness. Injected adapters own provider translation and the real tool gateway owns authorization and execution.

The cited OpenAI guide informs the capability class only. The controller, canonical vocabulary, schemas, tests, and documentation are independently authored. Exact provider or model support is declared by an adapter; the runtime never guesses support from a model name.

## Concrete Dev Wiring

`POST /api/function-call` is the authenticated application entry point. The caller supplies only a bounded run id, prompt, selection mode, and parallel preference; unknown fields, including caller-authored approval arrays, are rejected. A reviewed call returns `202` with a manager-issued resume token and safe interruption metadata. `POST /api/function-call/resume` accepts that token, a bounded decision, and a signed reviewer token; caller-authored review ids, stored state, response ids, reasoning, call ids, tool definitions, and approval arrays remain forbidden. The application registry exposes independently authored `read_agentic_os_status` and `update_agent_run_note` functions only when each exact name appears in `KNOWGRPH_FUNCTION_TOOL_ALLOWLIST`.

The OpenAI adapter sends strict application declarations through the Responses protocol, preserves opaque reasoning items, continues by `previous_response_id`, correlates `function_call_output` with the original call id, and translates returned usage into the repository cost log. Its static instructions and stable function declarations precede changing prompt and tool-result content. Configuration fails closed unless the server supplies `OPENAI_FUNCTION_CALLING_MODEL`, the named API-key binding, and uncached-input, cached-input, cache-write, and output rates; source does not embed a provider pricing table, multiplier, or credential.

Required and forced selections apply until the first valid gateway call completes. The continuation request then uses automatic selection so the provider can produce final output; the controller retains the original run-level requirement in evidence and still rejects a repeated forced call.

The Knowgrph gateway maps the application names to exact `knowgrph.os.status` and `knowgrph.run_manifest.note.update` MCP tools. It checks the allowlist, direct caller, immutable risk and idempotency metadata, exact arguments, tool-input guardrail, strict reduced output, tool-output guardrail, and upstream evidence before completion. Model-visible names never become arbitrary MCP dispatch authority. The run-note mapping is intrinsically review-required; environment configuration can add review to the read path but cannot remove review from the mutation. Before either reviewed call pauses, the gateway reserves a durable execution receipt while the Function Calling manager stores the exact response id, opaque reasoning items, pending call identity, counters, and costs.

After exact signed review, the gateway persists the authorized arguments and a stable call-scoped idempotency key before MCP execution. The key travels in namespaced MCP request metadata and the transport header. The native per-run Durable Object atomically replaces `operatorNote` and stores a seven-day receipt in the same transaction. An uncertain retry reuses that key, receives `replayed` without a second revision, and completes only when Knowgrph echoes the exact key and request digest. A completed Agentic receipt then returns its stored strict output without another MCP call. The cross-repository proof runs both source owners locally with zero provider calls; it does not prove the deployed remote Worker.

Readiness reports adapter key presence, pricing readiness, model, protocol, bounds, gateway allowlist, and counters without returning secrets. Configuration is not live proof: `providerExecutionStatus` remains `unverified` until a bounded provider run returns actual response identity, usage, function call, gateway result, continuation, and final output.

| Server binding | Purpose |
|---|---|
| `OPENAI_FUNCTION_CALLING_MODEL` | Explicit model selected by the operator; no model-name capability inference. |
| `OPENAI_FUNCTION_CALLING_API_KEY_ENV` | Name of the server-side key binding; defaults to `OPENAI_API_KEY`. |
| `OPENAI_FUNCTION_CALLING_INPUT_USD_PER_MILLION` | Current uncached-input rate used only for returned usage estimation. |
| `OPENAI_FUNCTION_CALLING_CACHED_INPUT_USD_PER_MILLION` | Current cached-input rate used only for returned usage estimation. |
| `OPENAI_FUNCTION_CALLING_CACHE_WRITE_USD_PER_MILLION` | Current cache-write rate used only for returned usage estimation. |
| `OPENAI_FUNCTION_CALLING_OUTPUT_USD_PER_MILLION` | Current output rate used only for returned usage estimation. |
| `KNOWGRPH_FUNCTION_TOOL_ALLOWLIST` | Exact comma-separated application function names enabled for this runtime. |
| `KNOWGRPH_FUNCTION_REVIEW_REQUIRED` | Enabled read functions that application policy additionally pauses; `update_agent_run_note` remains review-required even when omitted. |
| `AGENT_REVIEW_JWT_SECRET` | Separate server-side key for exact-scoped reviewer evidence; never the session key. |
| `AGENT_STATE` | Per-review, per-conversation, per-function-run, and per-execution-receipt Durable Object binding used for atomic consume or claim transitions. |
| `KNOWGRPH_MCP_ENDPOINT` | Existing Knowgrph MCP owner; no new proxy is introduced. |
| `KNOWGRPH_MCP_FUNCTION_BEARER_TOKEN` | Optional server-managed service credential for an authenticated MCP owner. |

## Ownership Boundary

| Owner | Responsibility | Forbidden claim |
|---|---|---|
| Model adapter | Translate the canonical request into the selected provider protocol, normalize response items, and return actual usage. | Configuration alone does not prove a provider accepted functions or continued a response. |
| Function-calling controller | Validate strict declarations, selection policy, response identity, reasoning replay, call ids, bounds, and final evidence. | It does not invent tools, grant permission, execute provider output as code, or retain reasoning items. |
| Function-calling manager | Reserve run identity, persist private reviewed-call checkpoints, issue opaque resume tokens, atomically claim resume work, and settle or retain retryable state. | It does not authenticate reviewer intent, mutate tool policy, replay prior provider work, or expose the stored checkpoint. |
| Execution-receipt runtime | Reserve reviewed call identity, persist authorization before side effects, issue one stable downstream idempotency key, fence claimants, and replay terminal output. | A local receipt cannot prove a remote mutation; mutating tools must return matching native receipt evidence. |
| Tool Search controller | Supply only direct or already-loaded definitions from the active revision-bound session. | Loading a definition never grants underlying execution permission. |
| Tool gateway | Revalidate identity, arguments, risk, approvals, output, audit hooks, and cost under the real tool owner. | Session authentication, model selection, or a function declaration is not action approval. |
| Programmatic controller | Optionally reduce predictable read-only multi-call stages in a provider-hosted sandbox. | Hosted programs do not replace the direct path for writes, approvals, semantic judgment, or native evidence. |

## Typed Contract

`run` accepts a run id, JSON-compatible input, explicit capabilities, current tool records, a selection policy, a parallel-call preference, and an optional abort signal. Review evidence enters only the review-resolution owner; it is never model input or a generic Function Calling request field. Every tool has one globally unique name, an explicit application revision, an independently authored description, strict object parameters, a strict output schema, direct-caller policy, risk and review metadata, and executable argument and output validators.

Only the provider-facing function fields leave the controller. Risk, review state, validators, output schemas, and owner metadata stay application-side. The adapter maps provider wire names and encoded arguments into the canonical camel-case items used here.

A normalized model turn contains a response id, completed status, actual cost log, and typed items. Supported active-loop items are opaque reasoning, function calls, and one final message. A function call contains a unique call id, exact tool name, and JSON arguments. The gateway result becomes a `function_call_output` with that same call id. Reasoning items returned beside calls are passed into the next turn with the correlated outputs and previous response id. They remain transient for uninterrupted calls. When an idempotent call pauses for review, the manager persists those items only inside the bounded private checkpoint required to resume the same chain; they are never returned by either HTTP endpoint or the completed result.

The manager binds every checkpoint to the complete normalized tool-policy fingerprint. A reviewed call must be the only call in its model turn and must be idempotent. Current-definition drift, concurrent claims, expired state, wrong resume tokens, consumed review state, and non-idempotent review pauses fail closed. Malformed resolution or reviewer authentication failures occur before atomic review consumption, so the manager retains the same continuation for a valid retry without invoking MCP or advancing the model. Once review succeeds, its audit and exact authorized arguments transfer into the durable execution receipt before any MCP call. Later uncertain transport or output failure remains retryable through that receipt instead of asking the model or reviewer to recreate prior state.

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
| Validate | Run, capabilities, strict tools, and choice | Immutable request or typed rejection | Unknown request fields, missing adapter, gateway, continuation, reasoning replay, or requested parallel capability block before spend. |
| Advance | Initial request or previous response plus reasoning and correlated outputs | Provider-normalized turn and actual model cost | Incomplete, malformed, cost-unreported, replayed, or unsupported items block. |
| Select | Function calls and choice policy | Eligible exact tool records | Unknown, direct-disabled, disallowed-subset, forced-name, or parallel violation blocks. |
| Execute | Validated arguments, direct caller identity, and policy metadata | Gateway envelope with typed output and cost | Tool guardrail denial, invalid arguments or output, timeout, or size overflow blocks; one idempotent reviewed call may pause. |
| Persist | Exact prior response, opaque reasoning, pending call and review state, fingerprints, counters, and costs | Private expiry-bounded checkpoint plus public resume token | Parallel reviewed calls, non-idempotent review, size overflow, conflict, or failed atomic write blocks. |
| Resume | Public resume token plus exact signed reviewer evidence | Atomically claimed private checkpoint and gateway resolution | Wrong token, expiry, claim conflict, definition drift, consumed review, or mismatched action blocks; pre-consumption resolution or authentication failure remains retryable. |
| Fence | Authorized arguments, review audit, call policy, and current receipt | Durable idempotency key plus one atomic execution claim | Identity drift, competing claim, expired record, or missing authorization blocks before MCP. |
| Receipt | Strict output and optional native downstream receipt | Durable terminal output or typed retryable block | Mutating results require exact key and request-digest echo; missing or mismatched evidence never completes locally. |
| Continue | Previous response id, reasoning items, and same-id outputs | Next model turn | Turn, call, duplicate-id, abort, or timeout limit blocks. |
| Finalize | One final message after required calls | Final output, compact evidence, and separate costs | No reasoning or intermediate payload is returned. |

The gateway envelope may complete, pause, or return a typed policy block. A block keeps its reason and returned cost evidence; the controller never converts it into a synthetic tool result or retries it automatically. The manager is the sole long-delay continuation owner. A fresh Worker resumes the stored response chain only after atomic claim and gateway-owned review resolution, then deletes terminal state. No model or tool work before the pause is replayed.

## Bounds And Cost Evidence

Defaults allow eight model turns, 32 total calls, eight calls per parallel batch, 128 visible functions, 100,000 serialized schema characters, 200,000 serialized characters per tool result, and 60 seconds per model or gateway stage. Private review checkpoints expire after 24 hours. Resume claims expire after one hour, which exceeds the controller's maximum sequential stage budget and prevents a second manager from recovering a still-running claim. Execution receipts expire after seven days and their active claims after 60 seconds. Duplicate active run ids serialize, duplicate call ids fail, and exact completed receipts replay instead of repeating an action.

Every attempted model turn and gateway execution must return the repository cost-log fields, including provider cache status and both cached and cache-write token counts. The adapter subtracts both reported categories from ordinary uncached input before applying the separately configured rates, so cache writes are neither omitted nor double-counted. Preflight blocks report explicit `not-run` zero state. An attempted operation without usable cost evidence reports nullable `unreported` state instead of claiming zero spend. Model and gateway costs remain separate so an unknown tool charge cannot hide behind known model usage.

`providerExecutionStatus` stays `unverified` in `/api/ready`. Offline adapter, native Knowgrph, and cross-repository tests prove request translation, policy enforcement, receipt recovery, and one local source-owned mutation without spending. They do not prove a live model, provider cache result, remote Worker, Prod, or Cloudflare execution.

## VCCs

- Given a strict direct function, when the adapter returns reasoning plus one call, then the gateway receives the exact call identity, the next turn receives that reasoning plus a same-id output and previous response id, and the completed result excludes reasoning and intermediate payloads.
- Given automatic, required, none, forced, or allowed selection, when a response violates the selected policy, then the controller blocks before an unauthorized gateway action.
- Given parallel output, missing capabilities, lax schemas, unknown or repeated calls, invalid arguments or outputs, approval denial, excess bounds, abort, or timeout, when the controller evaluates the run, then it returns typed evidence with honest model and gateway cost states.
- Given a caller-authored approval array, when the HTTP boundary validates it, then the field is rejected before model or gateway execution.
- Given application policy requiring review on the concrete status function, when exact signed reviewer evidence resolves its stored action, then input and output guardrails bracket the sole MCP call and replay cannot execute it again.
- Given `update_agent_run_note` is allowlisted without a review override, when the gateway compiles its policy, then approval remains required and a false caller policy blocks before MCP.
- Given a long review delay and a fresh Worker manager, when the exact resume token and signed reviewer evidence arrive, then the manager atomically claims the private checkpoint, uses the stored prior response, opaque reasoning, and same call id, executes MCP once, and removes terminal state.
- Given an approved reviewed mutation, when the gateway is ready to call MCP, then an authorized durable receipt and stable idempotency key already exist; one claimant executes, an uncertain retry reuses the key, and completion requires matching native downstream evidence.
- Given a completed reviewed execution, when a fresh Worker receives the same exact run and call identity, then it returns the stored strict output without consuming review state or invoking MCP again.
- Given malformed resolution, invalid reviewer authentication, a competing resume, expiry, multiple calls beside a review, or changed tool policy, when resume is attempted, then no model or tool executes and only pre-consumption resolution or authentication failure retains retryable state.
- Given an unconfigured Worker, when readiness is read, then contract, adapter, gateway, and bounds remain visible without a secret value or live-provider claim.
- Given configured offline transports, when OpenAI returns reasoning plus a strict function call, then the application calls only `knowgrph.os.status`, replays the opaque reasoning and same-id output with the prior response id, and returns final text plus actual model usage and zero-cost gateway evidence.

VCC: run `npm run function-gateway:check` and the affected app and Worker tests; require zero failures, exact call-id continuation, one claimant, stable-key retry, native-receipt enforcement for mutations, terminal replay, application-owned tool exposure, no reasoning or secret return, no unapproved live call, no Prod mirror mutation, and no Cloudflare action.
