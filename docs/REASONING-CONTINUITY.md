---
title: "Agentic Canvas OS Reasoning Continuity Contract"
graphId: "md:agentic-canvas-os-reasoning-continuity"
doc_type: "Runtime Reasoning Continuity Contract"
date: "2026-07-17"
lang: "en-US"
schema: "agentic-reasoning-continuity/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "bounded cross-turn reasoning compatibility, chaining, drift reset, and confirmation"
runtime_scope: "Agent-API volatile reasoning-continuity registry"
runtime_claim: "deterministic local request planning with provider-effective reasoning kept unverified until returned response metadata confirms it"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
runtime_proof: "RUNTIME-PROOF.md"
external_pattern_sources:
  - "https://developers.openai.com/api/docs/guides/reasoning#preserve-reasoning-across-calls"
---

# Reasoning Continuity

Reasoning continuity lets a compatible downstream model reuse available opaque reasoning items from earlier turns when the run's goals, assumptions, and priorities remain unchanged. The implementation is local and provider-neutral. The external reasoning guide informs request and response semantics only; no external code, prompt, example, fixture, or prose is copied.

Persisted reasoning is not raw reasoning text, a chain-of-thought store, durable memory, or a replacement for visible conversation state. The registry retains only normalized invariant fingerprints, the last response identifier, one active-turn correlation token, and bounded counters.

## Runtime Ownership

| Owner | Responsibility | Boundary |
|---|---|---|
| `agent-api/src/reasoning-continuity.js` | Compare stable invariants, plan compatible continuation, serialize active turns, bound retention, and record effective provider context. | No model call, reasoning-text access, durable transcript, provider selection, secret persistence, or deploy. |
| `agent-api/src/app.js` | Expose one injected registry and sanitized readiness state. | Does not claim that a provider used prior reasoning. |
| `worker/index.js` | Reuse only the bounded registry inside one environment isolate. | Auth handlers and MCP clients remain request-scoped; continuity does not cross isolates or deployments. |
| Downstream model owner | Validate model capabilities, apply the request patch, complete the turn with the returned response id and effective context, and emit token and cost evidence. | Live provider continuity stays gated until a bounded provider response confirms it. |

## Typed Contract

Begin input:

```yaml
threadId: non-empty bounded string
goals: non-empty bounded string array
assumptions: bounded string array
priorities: non-empty bounded string array
capabilities:
  previousResponseId: boolean
  reasoningContexts: [current_turn, all_turns]
```

Begin output:

```yaml
turnToken: active-turn correlation string
status: first_turn | preserved | reset | unsupported
stable: boolean
requestedContext: current_turn | all_turns | omitted
previousResponseIdUsed: boolean
requestPatch:
  previous_response_id: optional prior response id
  reasoning:
    context: optional current_turn or all_turns
providerEffectiveContext: unverified
```

Complete input:

```yaml
threadId: original thread id
turnToken: exact active turn token
responseId: returned provider response id
effectiveContext: unreported | current_turn | all_turns
```

Complete output:

```yaml
turns: positive completed-turn count
responseIdStored: true
providerEffectiveContext: unreported | current_turn | all_turns
providerContinuityConfirmed: boolean
```

## Decision Contract

| Condition | Request behavior | Claim |
|---|---|---|
| No completed prior response | Request `current_turn` only when the adapter declares support; omit a previous response id. | `first_turn`; no earlier reasoning exists. |
| Completed prior response and exact stable invariants | When the adapter declares both capabilities, request `all_turns` and include the last response id. | `preserved` request only; provider use remains unverified. |
| Goals, assumptions, or ordered priorities changed | Keep the previous response id when supported so visible conversation can continue, but request `current_turn` when supported. | `reset`; older reasoning is not rendered into the new turn. |
| Required continuation capability missing | Omit unsupported fields instead of guessing or forcing them. | `unsupported`; no preservation claim. |
| Returned effective context is `all_turns` after an `all_turns` request | Store the new response id and increment confirmed continuity. | Provider continuity confirmed for that completed turn. |
| Response metadata is absent | Store the response id with `unreported` effective context. | Provider continuity remains unverified. |

Conversation chaining and reasoning rendering remain separate decisions. A changed invariant does not silently discard visible conversation state, while `current_turn` prevents stale earlier reasoning from being requested for the new invariant set.

## Bounds And Concurrency

| Guard | Default | Failure behavior |
|---|---:|---|
| Threads per isolate | 32 | Evict the least-recent completed thread; never evict an active turn. |
| Completed turns per thread | 64 | Stop and require explicit invalidation before another turn. |
| Invariant items per field | 32 | Reject before request planning. |
| Characters per invariant item | 2,000 | Reject before request planning. |
| Active turns per thread | 1 | Reject concurrent begin; require exact complete or abort. |

An aborted turn never advances the response id or invariant fingerprint. Invalidation rejects an active turn so a concurrent completion cannot revive stale state.

## Privacy And Truth Boundaries

- Never store or return raw reasoning text.
- Never interpret opaque reasoning items or treat them as memory records.
- Never infer support from model name, provider label, response latency, or prior success.
- Never report `all_turns` as effective from the outgoing request alone.
- Never persist response identifiers to source, docs, tests, logs, browser storage, or a durable store through this registry.
- Never share one registry across unrelated environment isolates, deployments, tenants, or caller authorization boundaries.

## Runtime-Ready VCCs

Given one completed turn and unchanged goals, assumptions, and priorities, when the next turn begins with declared continuation support, then the request patch contains the prior response id and requests `all_turns` exactly once.

VCC: run `npm run reasoning-continuity:check`; require eight passing offline tests covering first turn, stable continuation, invariant drift, capability gating, provider confirmation, mismatched confirmation, active-turn serialization, and bounded retention; stop on the first failure with zero provider calls.

Given a changed priority set, when a chained turn begins, then visible conversation chaining may continue through the prior response id while requested reasoning resets to `current_turn`.

VCC: verify `status: reset`, `stable: false`, the prior response id remains present only when declared supported, and no `all_turns` request or confirmation is emitted.

## Promotion Boundary

The bounded registry, request planner, readiness projection, and offline tests are runtime-ready in Dev. A live reasoning-preservation claim remains gated because this Worker forwards to the Knowgrph MCP control plane and does not own the Responses API call. Promotion requires the downstream adapter to declare actual model capabilities, apply the exact patch, return the new response id and effective reasoning context, log tokens and cost, and pass one bounded approved provider run.
