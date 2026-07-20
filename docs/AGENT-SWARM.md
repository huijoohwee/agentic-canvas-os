---
title: "Agentic Canvas OS Agent Swarm"
graphId: "md:agentic-canvas-os-agent-swarm"
doc_type: "Agent Swarm Runtime Contract"
date: "2026-07-20"
lang: "en-US"
schema: "agent-swarm-runtime-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "provider-neutral dynamic work decomposition, horizontal worker coordination, and base-agent synthesis"
runtime_scope: "goal planning, durable task claims, isolated worker execution, bounded recovery, cancellation, synthesis, observability, and cost evidence"
runtime_claim: "native Dev runtime with dynamic task briefs and atomic worker claims; live provider execution remains separately gated"
runtime_owner:
  - "../agent-api/src/agent-swarm-contract.js"
  - "../agent-api/src/agent-swarm-store.js"
  - "../agent-api/src/agent-swarm-ledger.js"
  - "../agent-api/src/agent-swarm.js"
  - "../agent-api/src/agent-swarm-handler.js"
  - "../agent-api/src/durable-object-state-store.js"
  - "../agent-api/src/app.js"
  - "../worker/agent-state.js"
  - "../worker/index.js"
runtime_proof:
  - "../__tests__/agent-swarm.test.mjs"
  - "../__tests__/durable-agent-state.test.mjs"
  - "../__tests__/agent-api-app.test.mjs"
  - "../__tests__/cloudflare-worker.test.mjs"
publish_policy: "Dev-only until explicit operator approval"
external_pattern_sources:
  - "https://www.kimi.com/help/agent/agent-swarm"
  - "https://www.kimi.com/blog/kimi-k2-5"
  - "https://www.kimi.com/blog/kimi-k2-6"
external_dependency: false
---

# Agent Swarm

Agent Swarm is the native horizontal-scaling runtime for one goal that benefits from independent parallel work. A caller supplies one exact base-agent revision, a goal, bounded input, and an optional concurrency ceiling. The runtime generates task briefs and dependencies for that run, coordinates ephemeral workers through an atomic durable ledger, and lets the base agent produce the only public answer.

No caller supplies specialist roles, a branch catalog, or a handcrafted workflow. The planner may specialize tasks by objective and scoped context, but it cannot register durable agent identities or recursive worker trees.

## Ownership Boundaries

| Owner | Responsibility | Boundary |
|---|---|---|
| Agent Swarm | Dynamic plan validation, task state, leases, retries, dispatch bounds, recovery, cancellation, trace, receipts, and synthesis admission | Does not own definitions, models, tools, provider protocol, prompts, or deployment |
| Agent Definitions | Exact base-agent source and revision resolved through an injected application adapter | Ephemeral workers inherit one verified definition; the swarm does not register per-task definitions |
| Agent Runtime Composition / Running Agents | One worker's bounded model lifecycle when an application adapter chooses them | They do not own fan-out scheduling or the durable swarm ledger |
| Function Calling and tool gateway | Tool schemas, authorization, review, idempotency, and execution receipts | Swarm membership grants no tool capability |
| Agent Orchestration | Explicit manager delegation and conversation handoff through registered workflows | Fixed workflows remain separate from dynamic Agent Swarm runs |
| Kanban collaboration | Durable coordination for named profiles and full OS worker processes | Kanban remains the collaboration SSOT; the swarm ledger owns only one application run |
| Knowgrph | Read-only discovery of source-backed `/`, `#`, and `@` metadata | No duplicate scheduler, task store, worker registry, or readiness owner is added there |

The existing prohibition on fragile hidden subagent swarms remains. Agent Swarm qualifies as runtime-ready only because task state, ownership, recovery, bounds, receipts, and public evidence are explicit. Process-local memory may optimize an active worker but may never become the coordination SSOT.

## Runtime Shape

```text
goal + base agent
        |
        v
dynamic planner -- validates one bounded DAG
        |
        v
durable run ledger -- atomic short claims
        |
        +--> worker A: isolated task context
        +--> worker B: isolated task context
        +--> worker N: isolated task context
        |
        v
base-agent synthesis -- one public answer
```

The diagram describes ownership, not a requirement that every worker share one process. Each worker operation can arrive from a different isolate or host as long as all peers use the same state-store adapter and run identity.

## Input Contract

| Field | Requirement |
|---|---|
| `runId` | Stable, unique application run identity |
| `conversationId` | Base conversation identity; each task derives a separate worker conversation |
| `agent` | Exact `agentId` and `revision` for the base agent |
| `goal` | Non-empty bounded goal |
| `input` | Optional bounded JSON context |
| `maxParallel` | Positive value no greater than application policy |

`roles`, `specialists`, `tasks`, `branches`, and `workflow` are unsupported caller fields. Authorization and exact base-agent resolution run before the planner so denied or stale work creates no model spend or task state. HTTP handlers bind the run to the verified session subject and pass that principal out of band; another session cannot inspect, advance, settle, or cancel it. Start also requires the signed session lifetime to cover the fixed run TTL, so token refresh cannot orphan a still-live run under a new random subject.

## Dynamic Plan Contract

The injected planner returns one `planId`, an optional honest cost log, and one to the configured maximum task count. Every task has only:

- `taskId` for stable identity;
- `objective` for run-specific specialization;
- `dependencies` for readiness ordering; and
- bounded `context` scoped to that objective.

Task ids are unique, dependencies must resolve inside the plan, cycles fail closed, and computed dependency waves cannot exceed the configured bound. V1 performs one planning pass and forbids recursive worker-authored fan-out. This provides dynamic sub-agent creation without an unbounded tree or a second hidden planner.

## Horizontal Worker Contract

`work` obtains a short atomic claim on the run ledger, recovers expired task leases, selects one dependency-ready task, records a deterministic execution identity, and releases the ledger before model or tool execution. Other workers can then claim independent tasks and run at the same time.

Each worker receives only the goal, its task objective and context, completed dependency results, its attempt identity, and the mutation policy. It does not receive sibling private outputs, a shared scratch conversation, or an invented durable role. A stable task conversation prevents one worker's context from contaminating another.

Successful work must attest one of these effects:

| Effect | Proof |
|---|---|
| `read-only` | No mutation receipt is accepted |
| `idempotent` | A durable receipt must carry the stable task-level idempotency key and pass an injected receipt-owner verification |

Mutation-capable adapters remain governed by the existing Function Calling receipt owner. Attempt-specific execution ids fence stale workers, while the task-level idempotency key stays unchanged across retries. Missing, mismatched, self-attested, or unverified receipts fail the task before its output enters synthesis.

## Lifecycle

| Operation | Result |
|---|---|
| `start` | Authorization, atomic run-id reservation, one dynamic plan, and a newly persisted run ledger, or a typed block |
| `work` | One claimed task completion, bounded retry, idle/capacity state, stale result, or typed failure |
| `settle` | Pending state until tasks are terminal, then one base-agent synthesis claim |
| `status` | Secret-free task states, events, metrics, cost, receipts, and final output only after completion |
| `cancel` | Terminal cancellation, local abort propagation, and rejection of late worker output |
| `run` | Bounded local convenience driver over the same public lifecycle; not a separate scheduler |

The Worker exposes authenticated `/api/agent-swarm/{start,work,settle,status,cancel}` routes. They remain `501` until an application injects exact-agent resolver, planner, worker, synthesizer, durable receipt-verifier, and authorizer adapters. JSON callers cannot supply an abort signal. HTTP availability does not configure a provider or authorize spend.

## Recovery And Failure

- Run identity is reserved atomically before planner spend; a unique reservation fence makes commit and cleanup conditional, run-ledger claims are short and atomic, and task execution happens outside the ledger lock.
- Task leases exceed one absolute task-attempt deadline spanning execution and receipt verification. An expired task is retried only under the configured attempt ceiling.
- The fixed run deadline starts at request admission. New task or synthesis claims block before spend unless a full task lease and commit margin fit before that deadline.
- Execution ids are deterministic per task attempt, while the effect idempotency key is stable per task. A late completion loses its fence and returns `stale` without authorizing a duplicate mutation.
- Failed dependencies make their downstream tasks `skipped`; independent successful tasks remain available for partial synthesis.
- Synthesis has its own lease and retry ceiling. Zero completed tasks blocks instead of inventing an answer.
- Cancellation first verifies run ownership, then aborts locally owned task or synthesis controllers, marks pending/running tasks terminal in the ledger, and rejects late output from other processes.
- Provider errors are reduced to typed reason codes; raw error bodies and private worker output never enter public status.

The in-memory store proves local behavior only. The existing `AGENT_STATE` Durable Object adapter supplies atomic cross-isolate claims and horizontal recovery without a new Durable Object class or migration.

## Bounds And Economics

| Default | Value |
|---|---:|
| Tasks | 32 |
| Parallel workers | 8 |
| Attempts per task or synthesis | 2 |
| Dependency waves | 12 |
| Task timeout | 60 seconds |
| Task lease | 90 seconds |
| Run TTL | 30 minutes from request admission |
| Trace events | 512 |
| Durable ledger | 500,000 serialized characters |

Applications may lower these values. Raising them is an explicit policy choice, not compatibility with any external vendor scale claim. The ledger reports peak claimed workers, retries, calls, task states, and dependency evidence instead of presenting claims as measured execution overlap. Focused tests separately observe real overlapping adapter intervals within the cap. One small or sequential plan automatically reports the single-worker fallback.

Planner, worker, and synthesis calls contribute to one aggregate cost record. Missing call-level cost remains `unreported` or `partial`; the runtime never fabricates usage. Authorization precedes the first potentially paid adapter call.

## Public Evidence

Status exposes task objectives, dependencies, wave, state, attempt count, current or final worker id, bounded trace events, peak claimed workers, aggregate cost, and verified output receipts. It never exposes the run-owning principal or intermediate worker output. Only completed synthesis exposes `output`, with the original base-agent revision as `finalAnswerOwner`.

Sanitized `/api/ready` evidence reports configuration flags, state-store persistence, dynamic task model, ephemeral claim identity, base-agent synthesis ownership, bounds, counters, `externalRuntimeDependency: false`, and provider execution `unverified` by default.

## Clean-Room Boundary

The cited Kimi pages are capability inspiration only. This repository does not copy or depend on Kimi code, prompts, API shapes, schemas, examples, tests, task names, limits, UI assets, training methods, provider configuration, or prose. No runtime request is sent to Kimi or Moonshot. Public vendor scale and speed claims are not acceptance targets.

## Verification

Run:

```bash
npm run agent-swarm:check
```

The focused proof covers goal-only dynamic planning, exact-agent resolution, rejection of caller roles and workflows, pre-planning run-id reservation and ABA-safe cleanup, real overlapping worker intervals, concurrency ceilings, deterministic dependency waves, isolated context, single-worker fallback, atomic competing claims, admission-anchored run expiry, full-lease deadline admission, expired-lease recovery across runtime instances, stable retry idempotency, stale-result fencing, task and synthesis cancellation, durable receipt verification, partial synthesis, cost honesty, session-bound Worker routing, sanitized readiness, and Durable Object persistence.

VCC: Given one resolved exact base agent and a goal with at least two independent generated tasks, when distinct workers claim the session-owned durable run, then observed execution intervals overlap without exceeding `maxParallel`; task and synthesis leases remain recoverable and fenced; only dependency results cross worker contexts; the base agent returns the only public output; costs, verified receipts, retries, and peak claims are visible; and no predefined role, caller workflow, copied external artifact, external dependency, paid default, Prod mirror mutation, or Cloudflare deployment occurs.
