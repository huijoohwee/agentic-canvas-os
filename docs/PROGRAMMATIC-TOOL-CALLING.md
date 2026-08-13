---
title: "Programmatic Tool Calling Runtime Contract"
graphId: "md:programmatic-tool-calling-runtime"
doc_type: "Runtime Contract"
date: "2026-07-18"
lang: "en-US"
schema: "programmatic-tool-calling-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "bounded hosted-program orchestration policy for Agentic Canvas OS"
runtime_scope: "provider-neutral hosted JavaScript controller and client-owned tool gateway boundary"
runtime_claim: "local controller is runtime-ready; live hosted-sandbox execution and context isolation remain unverified until a downstream adapter attests them"
runtime_owner: "../agent-api/src/programmatic-tool-calling.js"
runtime_proof: "../__tests__/programmatic-tool-calling.test.mjs"
external_pattern_source: "https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling"
external_source_policy: "concept reference only; forbid copied code, examples, prompts, schemas, fixtures, tests, or prose"
publish_policy: "Dev-only until explicit operator approval"
---

# Programmatic Tool Calling Runtime

The runtime converts open-ended tool use into bounded application stages while keeping code execution outside the Agentic Canvas OS process. A downstream adapter owns the model request and hosted sandbox. This repository owns capability validation, caller lineage, whole-turn tool authorization, schema checks, fail-soft settlement for independently safe execution branches, limits, cost evidence, and sanitized readiness.

The cited OpenAI guide informs the capability class only. No external implementation, example, prompt, response fixture, or prose is copied. Model eligibility is not inferred from a model family name; the downstream adapter must validate the exact selected model against current provider capabilities.

## Ownership Boundary

| Owner | Responsibility | Forbidden claim |
|---|---|---|
| Model adapter | Request program generation, continue by response identity, normalize returned items, and report actual token and cost fields. | A configured route does not prove hosted execution or context isolation. |
| Hosted sandbox | Execute generated JavaScript in a fresh isolated environment and expose only enabled tools. | Agentic Canvas OS never emulates this boundary with local evaluation, shell, subprocess, or in-process JavaScript execution. |
| Programmatic controller | Validate capability flags and provider attestation, preserve caller lineage, require an ordered whole-turn authorization decision, enforce bounds, and settle eligible execution branches. | The controller never executes, persists, logs, or returns generated program source or raw branch errors. |
| Tool authorizer | Side-effect-free revalidation of every argument, permission, risk class, approval state, and caller under the real tool identity; return one revision-bound decision per call. | A malformed, missing, failed, denied, or identity-drifted decision blocks the entire turn before any executor call. |
| Tool executor | Execute only authorization-bound, read-only, idempotent, no-approval calls and validate their outputs. | Programmatic caller identity and a prior decision never bypass dispatch-time policy revision checks, audit, hooks, or cost controls; a typed integrity rejection blocks the batch. |
| Direct-call path | Own writes, approvals, semantic judgment, citations, and final native-artifact validation. | High-impact actions never inherit programmatic eligibility. |

## Typed Contract

The controller accepts one run id, JSON-compatible task input, explicit capability flags, a continuation mode, and a client-function catalog. Every function declares its type, specific name and description, `allowedCallers`, risk class, idempotency, approval requirement, object-shaped input and output schemas, and executable validators. Malformed input fails before any provider or tool call. Public declarations advertise an `anyOf` union containing the tool's success schema and the fixed programmatic failure schema, so a hosted program can handle degraded branches without guessing an undocumented shape.

For every hosted turn, local structural, catalog-policy, mutation, approval, idempotency, caller, and argument validation completes for the full call set first. The injected side-effect-free authorizer then receives the full ordered set once and must return exactly one matching `programmatic-tool-authorization/v1` receipt per call. Each receipt binds a stable authorization id and policy revision to the exact run, call, tool, arguments, caller, and local policy snapshot. Only an entirely authorized and identity-matching decision set reaches the executor. A denial or binding drift in the last record therefore has the same zero-execution result as one in the first record.

A normalized hosted turn contains a response id, completed status, actual cost log, fresh-isolation attestation, and typed items. Program items carry generated source, caller identity, and an opaque replay fingerprint only inside the active adapter loop. A nested `function_call` must carry `caller.callerId` equal to a known program `callId`; its client-owned result becomes `function_call_output` with the original call id and structurally unchanged caller object. The adapter alone maps provider wire fields such as `call_id` and `caller_id` to this canonical local camel-case contract and decodes or encodes JSON strings.

Stored continuation sends only new function outputs plus the previous response id. Stateless continuation retains the initial request and every returned program, opaque reasoning, function-call, function-output, and program-output item in order for the active run, then replays that sequence without a previous response id. Neither mode persists or returns generated source, reasoning items, fingerprints, or intermediate payloads after finalization.

After authorization, independent execution branches settle in input order. An ordinary gateway availability exception, invalid output, result overflow, or branch deadline becomes a fixed, sanitized `programmatic-tool-call-failure/v1` output with `retryable: false`; no raw exception, provider label, authorization context, or payload enters the failure output or audit. Successful sibling values remain available, and even an exhausted batch is returned to the hosted program for bounded synthesis. The executor can instead return the runtime's fixed-taxonomy integrity block for a dispatch-time authorization revocation, policy change, approval requirement, or integrity failure; that cancels the batch and blocks the run without model-visible degradation. External cancellation likewise remains a top-level run abort.

The completed result contains final output, aggregate cost, and compact evidence: model turns, requested tool count, tool names, hosted-program count, execution boundary, context-isolation attestation, and a settlement receipt with attempted, dispatched, canceled-before-dispatch, succeeded, failed, deadline, cancellation, batch, partial-batch, exhausted-batch, and fixed-taxonomy audit records. It contains no generated source or intermediate successful tool payloads.

## Predictable Stages

| Stage | Input | Output | Stop condition |
|---|---|---|---|
| Validate | Run, capabilities, tools, schemas, validators | Normalized immutable request or typed rejection | Missing hosted sandbox, continuation, lineage, adapter, authorizer, or executor blocks before spend or tool execution. |
| Advance | Initial request, stored response identity plus new outputs, or full stateless replay | Provider-normalized hosted turn | Provider error, incomplete response, missing cost, missing continuation capability, or missing attestation blocks. |
| Authorize | Full ordered turn, program lineage, requested tool identities, arguments, and local policy snapshot | One ordered authorization-bound record per call | Unknown, direct-only, mutating, approval-sensitive, non-idempotent, invalid, denied, malformed, failed, or stalled authorization blocks with zero executor dispatches. |
| Execute tools | Authorization-bound, schema-valid, independently safe calls through the injected executor | Input-ordered success values or sanitized typed failures | Every branch settles within its deadline; execution failure does not discard or suppress siblings. |
| Continue | Stored response identity or ordered replay plus caller-preserving success/failure results | Next hosted turn | Repeated call id, missing fingerprint, external abort, turn limit, call limit, or program-size limit blocks. |
| Finalize | Final message from a provider-attested turn | Output, evidence, and cost log | No source or intermediate result crosses the final result boundary. |

## Bounds And Concurrency

Default limits are eight model turns, 32 tool calls, eight parallel calls, 100,000 program characters, 200,000 serialized characters per tool result, and 60 seconds per provider turn, whole-turn authorization pass, or execution branch. The timeout is an integer from one through 2,147,483,647 milliseconds, preventing host-timer overflow from silently shortening the bound. Duplicate run ids serialize behind one active owner. Duplicate tool-call ids fail instead of repeating completed work.

Parallel execution is allowed only inside the configured batch width and only after the entire turn is validated and authorized as read-only, idempotent, and approval-free. The controller never automatically retries provider, authorization, or executor calls. A downstream retry policy must name an idempotency rule and remain outside this runtime's single-attempt settlement.

## Cost And Context Evidence

Every hosted turn must report `model`, `prompt_tokens`, `completion_tokens`, `cache_hits`, and `estimated_cost_usd`. The controller aggregates returned values without converting missing evidence to zero. A blocked preflight uses the explicit `not-run` zero-cost state. A failed provider attempt without any returned usage reports nullable `unreported` fields. If earlier attempts returned valid usage before a later unreported attempt, the known totals remain visible with `partially-reported`, `reportedAttempts`, and `unreportedAttempts`; unknown spend is never represented as zero and never erases known spend.

`providerContextIsolation` remains `unverified` in `/api/ready`. A successful injected run may report `provider-attested` only when every turn states that execution was hosted, isolation was fresh, intermediate results remained sandbox-only, and local code execution was false. Offline tests prove enforcement of this evidence contract; they do not prove any live provider environment.

## Selection Rule

`agent-api/src/programmatic-tool-routing.js` makes route selection executable. It chooses the programmatic path only when several calls have predictable control flow and can yield a smaller structured result. It chooses direct calls for a single action, semantic adaptation, missing reduction evidence, citation or native-artifact validation, approval, or mutation. The controller then rechecks every actual call, so route selection never grants tool permission.

## VCCs

- Given two eligible read-only tools, when a provider-attested hosted program requests both, then the authorizer validates the full set before the executor runs them within bounds, stored continuation preserves the prior response identity, stateless continuation replays every opaque item in order, and both preserve exact caller identity while returning only final output and compact evidence.
- Given an ordered call set whose last call is denied or locally invalid, when whole-turn preparation runs, then the runtime returns a typed blocked result and invokes the executor zero times.
- Given mixed or universally failed execution branches after successful authorization, when the bounded fan-out settles, then every call produces an input-ordered success or fixed sanitized failure output, successful siblings survive, exhausted batches remain visible, and the hosted program receives the settlement without an aggregate branch exception.
- Given external cancellation, when branches are active, then branch-local signals abort and the run returns a top-level blocked result with settlement evidence rather than asking the hosted program to continue.
- Given missing hosted execution evidence, continuation capability, fingerprint, lineage, a mutating or approval-sensitive tool, malformed arguments, failed authorization, excess turns or calls, duplicate work, authorization timeout, provider timeout, or oversized program data, when the controller evaluates the run, then it returns a typed blocked result without local JavaScript execution or unauthorized executor dispatch.
- Given a branch exception, invalid output, oversized result, or branch deadline, when failure evidence is projected, then only the fixed reason taxonomy, ordinal branch identity, status, and non-retryable flag are exposed; raw errors and payloads remain private.
- Given an unconfigured Worker, when `/api/ready` is read, then the contract is visible as ready while execution and provider context isolation remain explicitly unverified.
- Given a task-shape packet, when route selection runs, then only predictable multi-call structured reductions select programmatic execution; all authorization, semantic, citation, native-artifact, or single-call cases stay direct.

VCC: run `npm run programmatic-tool-calling:check` and the affected app and Worker tests; require zero failures, no generated code in returned results, no Prod mirror mutation, and no Cloudflare action.
