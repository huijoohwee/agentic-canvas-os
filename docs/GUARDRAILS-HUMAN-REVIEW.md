---
title: "Guardrails And Human Review Runtime Contract"
graphId: "md:guardrails-human-review-runtime"
doc_type: "Runtime Contract"
date: "2026-07-18"
lang: "en-US"
schema: "guardrails-human-review-runtime-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "provider-neutral automatic validation and human-review state for Agentic Canvas OS"
runtime_scope: "input, output, and tool guardrails plus sensitive-action approval interruptions"
runtime_claim: "blocking automatic checks and same-turn approve, reject, or edit review are executable in Dev; the default Worker has no application evaluator and its review store is isolate-memory only"
runtime_owner: "../agent-api/src/guardrails-human-review.js"
runtime_proof: "../__tests__/guardrails-human-review.test.mjs"
external_pattern_source: "https://developers.openai.com/api/docs/guides/agents/guardrails-approvals"
external_source_policy: "concept reference only; forbid copied code, examples, prompts, schemas, fixtures, tests, or prose"
publish_policy: "Dev-only until explicit operator approval"
---

# Guardrails And Human Review Runtime

The Guardrails and Human Review runtime gives the existing agent stack one application-owned control boundary. Automatic checks validate or transform bounded values. Human review records a proposed sensitive action, pauses through Running Agents, and consumes one typed approve, reject, or edit decision before the same turn continues.

The cited OpenAI guide informs only the capability split between automatic validation and review-gated actions. Local APIs, state identities, bounds, result shapes, tests, and prose are independently authored. No external SDK implementation, sample, prompt, schema, fixture, test, or documentation text is imported or reproduced.

## Ownership Boundary

| Owner | Responsibility | Forbidden claim |
|---|---|---|
| Agent Definitions | Store source-verified guardrail references for `input`, `output`, `tool-input`, or `tool-output`. | A reference does not execute a check or grant approval. |
| Guardrails and Human Review runtime | Sequence application checks, return sanitized evidence, record review state, and consume one decision. | It does not execute a model, function, MCP call, shell command, payment, mutation, or deployment. |
| Agent Runtime Composition | Run referenced input checks before the adapter and output checks before definition validation and public return. | Composition does not move tool policy away from the tool owner. |
| Function tool or MCP gateway | Invoke tool-input checks before execution and tool-output checks before the result re-enters the model. | Agent-level input or output checks cannot substitute for a side-effect boundary. |
| Running Agents | Hold adapter pause state, expose bounded interruptions, and resume the same turn with the exact token and decision. | A new turn, conversation, or run id cannot impersonate a paused action. |
| Application review surface | Show the proposed action and collect an authenticated operator or policy decision. | Model output, a semantic tag, or a guardrail pass is not human approval. |
| Review-state store | Atomically put and consume review records. | The default in-memory store does not prove cross-process durability. |

## Automatic Validation

The runtime accepts one exact run, conversation, agent revision, stage, ordered guardrail list, and bounded JSON value. Tool stages also require the exact call id, function name, and risk class.

| Stage | Placement | Valid result | Stop condition |
|---|---|---|---|
| `input` | Before the composed agent adapter begins. | Passed or transformed input becomes the only adapter input. | Missing evaluator, rejection, exception, malformed verdict, duplicate reference, or bound breach blocks before execution. |
| `output` | After the adapter settles and before Agent Definition output validation. | Passed or transformed output proceeds to the registered output contract. | Rejection or failed redaction prevents public completion. |
| `tool-input` | Beside the real function or MCP gateway, before side effects. | Validated arguments may continue to normal authorization and approval policy. | Agent input success never bypasses a tool-input failure. |
| `tool-output` | Beside the real gateway, before tool data re-enters the agent loop. | Validated or transformed result may become function-call output. | Unsafe or malformed tool output remains blocked. |

Checks run in declared order and are blocking. A later check sees only the value returned by the prior check. Compact evidence includes the check identity, pass state, and whether a transformation occurred; it excludes the checked value and evaluator-internal evidence from blocked public results.

The runtime intentionally does not start speculative model or tool work while validation is incomplete. An application may introduce concurrency only in a higher owner that can prove cancellation, cost, and side-effect safety.

## Human Review State

A review request binds the proposed action to a run, conversation, exact agent revision, action id, action kind, name, risk class, bounded payload, expiry, and SHA-256 action digest. The review store retains the full record. The adapter receives:

- one `approval` interruption containing the inspectable bounded action and expiry;
- one JSON-compatible resume-state packet containing only the review, run, conversation, and action-digest identities.

Running Agents keeps the resume state opaque to its public paused result and returns its own resume token. The application displays the interruption, gathers a decision, and resumes the same run and conversation. The adapter passes the internal state and external resolution to `resolveReview`.

| Decision | Runtime result | Execution rule |
|---|---|---|
| `approve` | Original action plus immutable audit event. | The owning gateway may continue only after its normal policy checks. |
| `reject` | Rejected status plus immutable audit event. | The action is never executed; the adapter returns a safe terminal or alternative result. |
| `edit` | Edited action, audit event, and `requiresValidation: true`. | Tool-input validation and gateway authorization must run again on the edited payload. |

The store consumes a record before returning a decision. Replays, identity drift, digest mismatch, missing records, expired state, malformed decisions, and capacity exhaustion fail closed. A decision never authorizes another action, call id, run, conversation, or agent revision.

## Delayed Review Boundary

The resume packet is serializable, but complete delayed resumption has two storage layers:

1. the Guardrails and Human Review owner needs an atomic store that survives for the intended review window;
2. the Running Agents owner needs the paused turn and adapter continuation state for the same run.

The repository default uses a bounded isolate-memory review store and the current in-memory Running Agents controller. It proves same-process pause and resume, including streaming settlement through the shared loop. It does not claim restart-safe or multi-region durable review. A production adapter must inject durable atomic state for both owners and prove exact-identity recovery before readiness can be promoted.

## Integration Flow

```mermaid
flowchart LR
  input["Bounded agent input"]
  inputGuard["Input guardrails"]
  agent["Running Agents adapter"]
  toolGuard["Tool-input guardrails"]
  review["Human review interruption"]
  gateway["Real tool gateway"]
  outputGuard["Output guardrails"]
  final["Validated final output"]

  input --> inputGuard --> agent --> toolGuard
  toolGuard --> review --> gateway --> agent
  agent --> outputGuard --> final
```

An adapter requesting review returns the runtime's paused packet directly to Running Agents. On resume it resolves the decision, revalidates any edited action, and only then calls the real gateway. Streaming uses the same pause state and settlement path; it does not create a second approval registry.

## Bounds And Readiness

| Bound | Default |
|---|---:|
| Serialized value or action payload | 200,000 characters |
| Guardrail references per stage | 64 |
| Pending in-memory reviews | 256 |
| Review lifetime | 24 hours |

`GET /api/ready` reports stage names, decision names, evaluator and store configuration, counters, limits, and isolate-memory persistence. It returns no checked values, proposed action payloads, reviewer reasons, credentials, or pending review records. The default Worker reports the contract ready and review store present, but automatic evaluator configuration false and provider execution `unverified`.

## Acceptance Contract

- Given ordered input or output references, when every application check passes, then the composed adapter or final validator receives only the final checked value.
- Given a rejected or failed input check, when a composed run starts, then no agent adapter executes.
- Given a tool stage, when validation runs, then exact call identity and risk accompany the bounded value and no agent-level pass bypasses the gateway.
- Given a sensitive action, when review is requested, then Running Agents pauses with one inspectable interruption and opaque internal state.
- Given an exact approve, reject, or edit resolution, when the same run resumes, then the record is consumed once, an audit event is returned, and edited payloads require validation again.
- Given replay, expiry, identity drift, missing evaluator, malformed state, unknown fields, or capacity breach, when the controller runs, then it fails closed without model, tool, mutation, payment, Prod, or Cloudflare action.

VCC: run `npm run guardrails-human-review:check`, `npm run agent-definitions:check`, `npm run agent-runtime-composition:check`, and the app and Worker readiness tests; require automatic input/output sequencing, tool-adjacent stages, transformation, rejection, same-turn pause/resume, approve/reject/edit, replay and expiry rejection, sanitized readiness, zero paid calls, no Prod mirror mutation, and no Cloudflare action.
