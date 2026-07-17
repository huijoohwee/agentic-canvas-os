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

The runtime converts open-ended tool use into bounded application stages while keeping code execution outside the Agentic Canvas OS process. A downstream adapter owns the model request and hosted sandbox. This repository owns capability validation, caller lineage, tool policy, schema checks, limits, cost evidence, and sanitized readiness.

The cited OpenAI guide informs the capability class only. No external implementation, example, prompt, response fixture, or prose is copied. Model eligibility is not inferred from a model family name; the downstream adapter must validate the exact selected model against current provider capabilities.

## Ownership Boundary

| Owner | Responsibility | Forbidden claim |
|---|---|---|
| Model adapter | Request program generation, continue by response identity, normalize returned items, and report actual token and cost fields. | A configured route does not prove hosted execution or context isolation. |
| Hosted sandbox | Execute generated JavaScript in a fresh isolated environment and expose only enabled tools. | Agentic Canvas OS never emulates this boundary with local evaluation, shell, subprocess, or in-process JavaScript execution. |
| Programmatic controller | Validate capability flags and provider attestation, preserve caller lineage, enforce bounds, and dispatch eligible client-owned tool calls. | The controller never executes, persists, logs, or returns generated program source. |
| Tool gateway | Revalidate every argument, permission, risk class, and output under the real tool identity. | Programmatic caller identity never bypasses policy, approval, audit, hooks, or cost controls. |
| Direct-call path | Own writes, approvals, semantic judgment, citations, and final native-artifact validation. | High-impact actions never inherit programmatic eligibility. |

## Typed Contract

The controller accepts one run id, JSON-compatible task input, explicit capability flags, and a tool catalog. Every tool declares caller modes, risk class, idempotency, input and output schemas, and executable validators. Malformed input fails before any provider or tool call.

A normalized hosted turn contains a response id, completed status, actual cost log, fresh-isolation attestation, and typed items. Program items carry code only across the adapter boundary for size and lineage validation. Tool calls must reference a known program. Program outputs must reference the same lineage. Continuation sends only tool results plus the previous response id.

The completed result contains final output, aggregate cost, and compact evidence: model turns, tool count, tool names, hosted-program count, execution boundary, context-isolation attestation, and the fact that intermediate results were not returned. It contains no generated source or intermediate tool payloads.

## Predictable Stages

| Stage | Input | Output | Stop condition |
|---|---|---|---|
| Validate | Run, capabilities, tools, schemas, validators | Normalized immutable request or typed rejection | Missing hosted sandbox, continuation, lineage, adapter, or gateway blocks before spend. |
| Advance | Initial request or previous response id plus tool results | Provider-normalized hosted turn | Provider error, incomplete response, missing cost, or missing attestation blocks. |
| Authorize | Program lineage and requested tool identity | Eligible read-only idempotent call or direct-route requirement | Unknown, direct-only, mutating, approval-sensitive, or non-idempotent tools block. |
| Execute tools | Schema-valid arguments through the injected gateway | Schema-valid bounded results | Tool failure, invalid output, abort, timeout, or result overflow blocks. |
| Continue | Response identity and caller-preserving results | Next hosted turn | Repeated call id, turn limit, call limit, or program-size limit blocks. |
| Finalize | Final message from a provider-attested turn | Output, evidence, and cost log | No source or intermediate result crosses the final result boundary. |

## Bounds And Concurrency

Default limits are eight model turns, 32 tool calls, eight parallel calls, 100,000 program characters, 200,000 serialized characters per tool result, and 60 seconds per provider or tool stage. Duplicate run ids serialize behind one active owner. Duplicate tool-call ids fail instead of repeating completed work.

Parallel execution is allowed only inside the configured batch width and only for independently validated read-only idempotent tools. The controller never automatically retries provider calls or tool calls. A downstream retry policy must name an idempotency rule and remain inside these bounds.

## Cost And Context Evidence

Every hosted turn must report `model`, `prompt_tokens`, `completion_tokens`, `cache_hits`, and `estimated_cost_usd`. The controller aggregates returned values without converting missing evidence to zero. A blocked preflight uses the explicit `not-run` zero-cost state; a failed provider attempt without returned usage reports nullable `unreported` fields instead of a zero-spend claim.

`providerContextIsolation` remains `unverified` in `/api/ready`. A successful injected run may report `provider-attested` only when every turn states that execution was hosted, isolation was fresh, intermediate results remained sandbox-only, and local code execution was false. Offline tests prove enforcement of this evidence contract; they do not prove any live provider environment.

## Selection Rule

Use the programmatic path only for predictable read-only stages whose structured intermediate results can be reduced before final model judgment. Use a direct tool call when one call is enough, the next step requires semantic judgment, a citation or native artifact must be preserved, or the action requires approval or mutation.

## VCCs

- Given two eligible read-only tools, when a provider-attested hosted program requests both, then the gateway validates and runs them within bounds, continuation preserves response and caller identity, and the final result exposes only final output and compact evidence.
- Given missing hosted execution evidence, invalid lineage, a mutating tool, malformed arguments, invalid output, excess turns or calls, duplicate work, timeout, or oversized data, when the controller evaluates the run, then it returns a typed blocked result without local JavaScript execution.
- Given an unconfigured Worker, when `/api/ready` is read, then the contract is visible as ready while execution and provider context isolation remain explicitly unverified.

VCC: run `npm run programmatic-tool-calling:check` and the affected app and Worker tests; require zero failures, no generated code in returned results, no Prod mirror mutation, and no Cloudflare action.
