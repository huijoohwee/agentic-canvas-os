---
title: "Agentic Goal Completion Runtime"
graphId: "md:agentic-os-goal-completion-runtime"
doc_type: "Runtime Contract"
date: "2026-08-30"
lang: "en-US"
schema: "agentic-os-goal-completion-runtime/v1"
frontmatter_contract: "required"
status: "runtime-ready"
owner: "scripts/goal-completion-runtime-contract.mjs"
delivered_rung: "undocumented"
runtime_readiness_policy: "fail-closed"
runtime_scope: "one read-only advance decision over one declared goal and its recorded outcomes"
runtime_claim: "deterministic planning and heuristic derivation; no dispatch, no mutation, no authority"
runtime_proof: "__tests__/goal-completion-runtime.test.mjs"
publish_policy: "Dev-only; no protected integration, Production, or Cloudflare authority"
invocation:
  action: "/goal.advance"
  semantics: ["#goal-completion"]
  bindings: ["@goal-plan"]
source_docs:
  - "COORDINATION-SCHEDULER.md"
  - "INTEGRATION-ORDER.md"
  - "AGENT-SWARM.md"
  - "LIFECYCLE-MONITORING.md"
  - "PROJECT-RULES.md"
---
<!-- Responsibility: Derive the next non-blocking advance decision for one goal without owning readiness, dispatch, or authority. -->

# Goal Completion Runtime

This runtime answers one question: given a goal, its units, and what happened on previous attempts, what should run next and may the goal continue at all. It is adaptive because priority comes from recorded outcomes rather than a caller guess, and non-blocking because a blocked unit bounds only itself and its dependents.

## Ownership Boundary

This file adds a composition layer. It owns no capability another document already owns, and it introduces no second scheduler, ledger, or authority.

| Concern | Owner | This runtime |
|---|---|---|
| Readiness, dependency waves, blocker localization to dependents, write-set disjointness | `COORDINATION-SCHEDULER.md` | Composes it; never reimplements it |
| Unit state classification and canonical frontier order | `INTEGRATION-ORDER.md` | Consumes the same unit vocabulary |
| Concurrent execution of ready work | `AGENT-SWARM.md` | Emits the ready set; dispatches nothing |
| Waiting for a condition to become true | `LIFECYCLE-MONITORING.md` | Emits `stalled`; owns no timer, sleep, or retry |
| Digests, canonical JSON, write-set normalization | `scripts/cloud-collaboration-primitives.mjs` | Imports them; computes no digest of its own design |
| Claims, leases, integration, release | `START-WORKFLOW.md`, `RELEASE-WORKFLOW.md`, `CANONICAL-LIFECYCLE.md` | Reads nothing and grants nothing |

## Contract

| Rule | Requirement |
|---|---|
| Read-only | Every record carries `mutation: false`. No filesystem write, network call, model call, git operation, lane touch, or dispatch. |
| Deterministic | Integer arithmetic only, no clock, no randomness. Byte-identical input yields an identical `receiptDigest`. |
| Heuristics rank, never admit | A learned weight may reorder the ready set. It cannot admit, gate, unblock, or retire a unit. |
| Gates fail closed | A unit with `gate: true` is refused until `authorizations` names that exact unit. An absent authorization is a refusal, never an assumed yes. |
| Non-blocking | A blocked unit bounds itself and its dependents. The goal stays `continuable` while any unit is ready. |
| Bounded | At most 128 units and 512 recorded outcomes per goal; the scheduler's own capacity bound still applies. |

## Goal Input

`acos-goal-completion-goal/v1` binds `goalId`, `capacity`, `units`, optional `authorizations`, and optional `outcomes`.

Each unit binds `id`, `kind`, `state` (`pending`, `done`, or `abandoned`), optional `gate`, `dependencies`, `declaredWriteSet`, `authorityState`, and optional `findings`. A dependency on a terminal unit is dropped before scheduling, because a completed dependency is no longer a constraint.

Each outcome binds `kind`, `result` (`success` or `failure`), and optional `retries`. Outcomes are observations of past runs; the runtime never fabricates one.

## Heuristic Derivation

`acos-goal-completion-heuristics/v1` groups outcomes by `kind` and derives one integer weight per kind:

```text
weight = clamp(0, 1000, floor(1000 * successes / attempts) - 50 * floor(retries / attempts))
```

A kind with no recorded history receives the neutral prior `500`, so an unproven kind is neither favoured nor buried. A kind that keeps failing or keeps needing retries sinks toward zero but is never removed, because ranking is not admission. The derivation is order-independent: reversing the outcome list yields the same `heuristicsDigest`.

Self-improvement is therefore auditable rather than opaque. Every applied weight ships in the receipt with its attempt and success counts, so any ordering change can be explained and replayed from the same inputs.

## Advance Decision

`acos-goal-completion-receipt/v1` reports `state`, `continuable`, `progress`, `nextUnitIds`, `waves`, `blockedUnits`, `waitingUnits`, `nonBlockingAttention`, `appliedWeights`, and the joined `goalDigest`, `heuristicsDigest`, `scheduleDigest`, and `receiptDigest`.

| State | Meaning |
|---|---|
| `continuable` | At least one unit is ready. Blocked or waiting peers do not stop the goal. |
| `stalled` | Nothing is ready but something is waiting on capacity, write-set contention, or a successor. |
| `blocked` | Nothing is ready and nothing is waiting. Every remaining unit needs an upstream resolution. |
| `complete` | Every unit is terminal. No schedule is produced. |

`nextUnitIds` is ordered by wave, then by descending learned weight, then by id. `progress.completedPermille` keeps progress exact under integer arithmetic.

Overlapping write sets serialize into separate sequential waves rather than becoming blockers; contention is a scheduling fact, not a failure.

## Invocation

```text
/goal.advance #goal-completion @goal-plan
```

```sh
node ./scripts/goal-completion-runtime.mjs plan --input=<goal.json> [--json]
```

The command exits zero when the goal is `continuable` or `complete`, and one when it is `stalled` or `blocked`. A blocked unit elsewhere in the goal never fails the run while a ready unit remains. Exit two is a usage error.

## Proof

`npm run goal-completion:check` runs `__tests__/goal-completion-runtime.test.mjs` and the docs contract.

Proven: neutral prior for unseen kinds, weight rise and fall with recorded results, retry penalty, zero floor, order-independent digests, learned reordering of the ready set, dependent blocking localization, terminal-dependency release, gate refusal and authorized admission, unknown-authorization rejection, wave serialization under overlap, stalled and blocked states, all-terminal completion, receipt determinism, frozen records, and fail-closed rejection of malformed goals and dependency cycles.

Not proven: live concurrent dispatch of the ready set, provider execution, and any protected integration or deployment effect. Those remain owned and gated elsewhere.

## VCC

Given one declared goal, its unit set, and its recorded outcomes, when the goal completion runtime plans an advance, then it performs no mutation, network, model, or dispatch action; derives every weight deterministically from recorded outcomes with a neutral prior for unseen kinds; refuses every unauthorized gated unit; bounds each blocked unit to itself and its dependents; reports `continuable` whenever a ready unit remains; and emits one frozen digest-bound receipt whose `receiptDigest` is identical for byte-identical input.
