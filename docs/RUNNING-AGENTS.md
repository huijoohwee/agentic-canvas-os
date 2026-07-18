---
title: "Running Agents Runtime Contract"
graphId: "md:running-agents-runtime"
doc_type: "Runtime Contract"
date: "2026-07-18"
lang: "en-US"
schema: "running-agents-runtime-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "bounded application-turn lifecycle for Agentic Canvas OS"
runtime_scope: "provider-neutral agent loop, continuation policy, pause and resume, and same-loop streaming"
runtime_claim: "local controller is runtime-ready in Dev; previous-response continuation, handoff, and final settlement have bounded live proof while tools, pause, and streaming remain offline-only"
runtime_owner: "../agent-api/src/running-agents.js; ../agent-api/src/running-agent-contract.js"
runtime_proof: "../__tests__/running-agents.test.mjs"
external_pattern_source: "https://developers.openai.com/api/docs/guides/agents/running-agents; https://developers.openai.com/api/docs/guides/function-calling"
external_source_policy: "concept reference only; forbid copied code, examples, prompts, schemas, event fixtures, tests, or prose"
publish_policy: "Dev-only until explicit operator approval"
---

# Running Agents Runtime

The Running Agents runtime owns one bounded application turn from initial agent input to completed, paused, or blocked settlement. It sequences model, tool, and handoff transitions returned by an injected adapter; locks each conversation to one continuation strategy; and exposes incremental events over the same loop used by non-streaming runs.

The cited OpenAI guides inform only the capability class. The controller, vocabulary, response shapes, event envelope, tests, and documentation are independently authored. No provider SDK, agent implementation, example, schema, prompt, fixture, test, or prose is imported or reproduced.

## Ownership Boundary

| Owner | Responsibility | Forbidden claim |
|---|---|---|
| Running Agents controller | Serialize turns, enforce bounds, advance transitions, retain pause state, lock continuation, normalize events, and settle once. | It does not call a provider, execute a tool, choose permissions, persist durable sessions, or infer model support. |
| Agent-step adapter | Advance the selected provider or agent runtime by one normalized stage and return actual continuation and cost evidence. | Configuration alone does not prove a provider call, tool use, handoff, session, or stream. |
| Function Calling controller | Validate and run direct application functions through the real gateway. | The outer loop never duplicates tool schemas, selection policy, approvals, or gateway execution. |
| Programmatic Tool Calling controller | Run eligible hosted-program reductions behind its own capability and isolation gates. | The outer loop never evaluates generated code or weakens direct-call policy. |
| Guardrails and tool gateway | Validate bounded input, output, tool arguments, and results; authorize identity, risk, approval, execution, audit, and tool cost. | An agent transition, guardrail pass, or continuation token grants no tool authority. |
| Durable state owner | Store application history, provider session identity, provider conversation identity, or previous response identity when required. | The in-memory Dev registry is not durable storage or cross-isolate continuity proof. |

## Turn Contract

`createRunningAgentRuntime` receives an optional `advanceAgent` adapter and explicit bounds. A new turn provides:

- a unique `runId`;
- an application `conversationId`;
- the current `agent` identity;
- bounded JSON-compatible `input`;
- exactly one continuation strategy and its matching state;
- an optional abort signal.

The adapter receives the same identifiers plus the turn and step numbers, current agent, current input, canonical continuation state, abort signal, and a bounded event emitter. It returns one of three outcomes:

| Outcome | Required adapter data | Controller behavior |
|---|---|---|
| `continue` | `model`, `tool`, or `handoff` transition; next input; continuation update; optional actual cost | Advance one bounded step; a handoff also changes the active agent. |
| `paused` | Public interruptions, opaque resume state, continuation update, optional actual cost | Store state only inside the runtime and return a new opaque resume token. |
| `completed` | Final JSON output, continuation update, optional actual cost | Settle the turn once and expose only final output, continuation, compact evidence, and honest cost. |

Malformed status, transition, output, history, response identity, interruption, event, cost, or resume state blocks the conversation. Provider-specific wire objects never become the local contract.

## Agent Loop

| Stage | Input | Output | Stop condition |
|---|---|---|---|
| Validate | Run identity, agent, input, continuation | Immutable bounded request or typed rejection | Mixed strategy fields, stale state, reused run id, active conversation, paused conversation, blocked conversation, or missing adapter fails closed. |
| Advance | Current agent, input, strategy state, optional resume resolution | Normalized adapter outcome | Adapter failure, abort, timeout, malformed outcome, or missing continuation update blocks. |
| Continue | Model, tool, or handoff transition | Next agent input and compact transition evidence | Step, input, history, state, event, or conversation-capacity limit blocks. |
| Pause | Interruption list plus opaque adapter state | Public token and interruptions | Raw state remains internal; another turn cannot start until resume or explicit clear. |
| Resume | Exact run, conversation, token, and bounded resolution | The next step of the same turn | Identity mismatch rejects; turn number and aggregate evidence do not reset. |
| Finalize | Completed output | One completed result and terminal event | Intermediate input, tool data, resume state, and adapter response objects are omitted. |

The application-turn controller is deliberately outside provider and tool loops. An adapter may delegate a tool transition to Function Calling, a hosted reduction to Programmatic Tool Calling, or a provider-native handoff, but those owners retain their validation and evidence rules.

## Continuation Strategies

One conversation selects one strategy. The strategy and current state must match on every later turn until the application explicitly clears that conversation.

| Strategy | Canonical state | Update rule | Boundary |
|---|---|---|---|
| `application-history` | Bounded ordered `history` array | Adapter returns the complete next history after every step; caller replays it exactly on the next turn. | Application state owner persists it; the runtime does not silently combine it with provider state. |
| `session` | Stable `sessionId` | Identifier remains unchanged. | Session implementation and durability belong to the injected adapter. |
| `conversation` | Stable `providerConversationId` | Identifier remains unchanged. | Provider conversation creation and storage remain downstream. |
| `previous-response` | Optional first-turn then exact `previousResponseId` | Every adapter outcome supplies the next response id. | Caller returns the exact latest id on the next application turn. |

Submitting fields for more than one strategy is a validation error. Changing strategy, server-state identity, response identity, or replay history inside an active registry is a typed `continuation_mismatch`, preventing accidental duplicate context.

## Streaming

`stream` and `resumeStream` call the same internal drive function as `run` and `resume`. They return:

- `events`, an async iterable of bounded canonical envelopes;
- `completed`, a promise for the same completed, paused, or blocked result as the non-streaming call;
- `cancel`, which aborts the active stage.

Runtime events describe turn start, resume, step completion, pause, completion, and block. An adapter may emit only model deltas, tool start and completion, handoff start and completion, or approval-required events. Each envelope receives controller-owned sequence, run, conversation, turn, and step fields. Provider wire event names, reasoning content, raw tool payloads, and opaque pause state are not passed through automatically.

The event iterable closes only after the loop settles. Consumers must await `completed` before treating the turn as final; receiving a text delta or tool event is not completion. Event validation and limits apply to streaming and non-streaming execution so enabling a stream does not create a second behavior path.

## Pause And Recovery

A pause returns only normalized interruption descriptions and an opaque token. The adapter resume state stays in the isolate-scoped controller. `resume` and `resumeStream` require the exact original run id, conversation id, and token plus a bounded resolution. The next adapter request receives the state and resolution once, while turn number, step count, costs, transitions, and agent history continue from the paused turn.

Starting another run on a paused conversation blocks. A failed active turn marks the conversation blocked because a downstream side effect or provider response may already exist. `clearConversation` is the explicit abandon or recovery boundary and refuses to clear an active turn.

## Bounds And Evidence

Defaults allow 12 adapter steps, 128 application-history items, 200,000 serialized characters for input, state, or output, 32,000 characters per event, 1,024 events, 256 in-memory conversations, and 60 seconds per adapter stage. Recent run identities are retained in a bounded replay fence. Idle conversations may be evicted at capacity; active, paused, and blocked records are not silently discarded.

Every result reports steps, model transitions, tool transitions, handoffs, participating agent identities, logical event count, and aggregate cost. Missing adapter cost is `unreported`, mixed evidence is `partial`, complete returned evidence is `reported`, and preflight failure is `not-run`; attempted work never becomes fabricated zero cost.

Readiness exposes bounds, counters, strategy names, loop owner, same-loop streaming owner, and pause semantics. `providerExecutionStatus` remains `unverified` until a separately approved bounded live adapter run returns provider identity, continuation, events, final settlement, and actual usage.

## VCCs

- Given tool and handoff transitions, when the adapter advances three stages, then one turn reaches final output with exact previous-response progression, changed agent identity, aggregate costs, and no intermediate input in the result.
- Given any strategy, when another strategy or stale state is submitted for the same conversation, then the runtime blocks before another adapter call.
- Given streamed model output, when the terminal stage is still pending, then events arrive incrementally while `completed` remains unsettled; the iterable closes only after terminal settlement.
- Given a pause, when another run starts, then it blocks; when exact resume identity and resolution arrive, then execution continues at the next step of the same turn without exposing opaque state.
- Given duplicate run identity, active concurrency, step overflow, event overflow, abort, timeout, malformed adapter output, or missing configuration, when the controller evaluates the turn, then it fails closed with bounded and honest evidence.
- Given an unconfigured Worker, when readiness is read, then contract, policy, bounds, and counters remain visible while configuration and provider execution remain false or unverified.

VCC: run `npm run running-agents:check` plus the affected app and Worker tests; require zero failures, exact strategy isolation, incremental settlement, same-turn resume, bounded costs and events, no copied artifacts, no paid call, no Prod mirror mutation, and no Cloudflare action.
