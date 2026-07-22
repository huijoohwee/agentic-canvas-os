---
title: "Skill Evolution Optimization Contract"
graphId: "md:agentic-canvas-os-skill-evolution"
doc_type: "Runtime Contract"
date: "2026-07-22"
lang: "en-US"
schema: "agentic-skill-evolution/v1"
frontmatter_contract: "required"
status: "spec-complete"
authority: "canonical skill-evolution invocation, optimization semantics, and review-only handoff"
publish_policy: "Dev-only; no automatic skill write, Prod mirror mutation, or Cloudflare authority"
runtime_scope: "canonical contract and validating MCP client transport for bounded resumable skill-text optimization"
runtime_claim: "spec-complete ACOS contract and fail-closed transport validation; executable optimization remains unproven until exact integrated Knowgrph tests are cited"
runtime_proof: "RUNTIME-PROOF.md"
invocation:
  action: "/skill.evolve"
  semantics: ["#skill-evolution"]
  bindings: ["@skill-catalog", "@skill-policy", "@runtime-proof", "@operator"]
mcp_tool: "knowgrph.skill.evolve"
external_pattern_sources:
  - "https://github.com/microsoft/SkillOpt"
external_dependency: "forbidden"
---

# Skill Evolution Optimization Contract

## Outcome

Skill text can improve through a bounded sequence of training batches, mini-batches, and held-out validation gates while the executor and any underlying model remain frozen. The only successful terminal artifact is a review-pending proposal. The harness never applies the proposal, changes model weights, merges code, releases, or deploys.

This contract adapts the general idea of optimizing instructions around a frozen agent into an original Agentic Canvas OS and Knowgrph design. Microsoft SkillOpt is a capability reference only. No SkillOpt code, prose, prompt, schema, algorithm, test, fixture, example, default, package, service, generated artifact, or repository layout is copied or required.

## Canonical Invocation

```text
/skill.evolve #skill-evolution @skill-catalog @skill-policy @runtime-proof @operator
```

The three dictionaries remain the only `/`, `#`, and `@` token owners. This contract adds no `/skill.train`, `#skill-training`, binding alias, hidden registry, or second dispatcher. Dictionary resolution supplies metadata; it does not authorize spend, persistence, skill mutation, release, or deployment.

## Ownership

| Owner | Responsibility | Forbidden ownership |
|---|---|---|
| Agentic Canvas OS | Invocation tokens, request and result contract, clean-room boundary, validation requirements, review-only handoff, and focused contract proof. | Candidate execution, durable optimization scheduling, a second skill registry, or direct canonical skill writes. |
| Knowgrph local MCP | `knowgrph.skill.evolve`, immutable run admission, resumable state, deterministic batching, injected adapters, budgets, validation gates, cost evidence, and proposal artifact. | Invocation aliases, model-weight updates, automatic skill apply, merge, release, or deployment. |
| Frozen executor adapter | Run exact skill candidates against referenced training cases and return typed evidence. | Fine-tuning, gradient updates, optimizer state, provider-specific authority, or unbounded calls. |
| Candidate adapter | Propose bounded text mutations from training evidence only. | Validation-case access, canonical writes, hidden prompts, or exceeding mutation and spend limits. |
| Held-out evaluator | Exclusively resolve validation references, own isolated validation rollouts through the frozen executor, compute the declared metric and gates, and return aggregate evidence and cost. | Giving the candidate adapter validation references, payloads, outputs, scores, per-case traces, or evaluator state. |
| Operator | Authorize `start`, `step`, and `cancel`, inspect evidence, and separately decide whether a review-pending proposal may enter `/skill.manage`. | Approval inferred from metric improvement or terminal run state. |

Agent Toolkit may receive metadata-only observations after a step. It does not own epoch scheduling, candidate text, dataset splits, validation gates, proposal persistence, or skill writes.

## Operation Contract

One MCP tool uses a strict operation discriminator:

| Operation | Required state | Effect |
|---|---|---|
| `plan` | Complete source-bound specification. | Validate the deterministic schedule and exact candidate, adapter-call, mutation-operation, and changed-character ceilings; admit token, cost, and duration only as hard run caps, without persistence, adapter calls, or model spend. |
| `start` | Complete source-bound specification plus operator authority. | Verify the exact sources, registered gates, and per-method usage envelopes, then persist one immutable admitted run at revision `1`; do not execute a training, candidate, or validation step. |
| `step` | `runId`, current `expectedRevision`, and operator authority. | Execute at most one mini-batch candidate update or one held-out validation checkpoint, then persist exactly one successor revision. |
| `status` | `runId`. | Return one bounded read-only snapshot without an adapter call or state change. |
| `cancel` | `runId`, current `expectedRevision`, and operator authority. | Mark the run canceled at exactly one successor revision; retain evidence and start no later work. |

`step` is the sole optimization progress boundary. A caller resumes by reading `status` and supplying its exact `revision` as the next `expectedRevision`. Stale revisions, concurrent mutation, operation replay with different input, and unknown fields fail closed. Operator authority is rechecked even for an idempotent replay; possession of a prior key never becomes lasting authorization.

## Request Contract

Every request uses `knowgrph-skill-evolution-request/v1` and includes:

```text
schema: "knowgrph-skill-evolution-request/v1"
operation: "plan" | "start" | "step" | "status" | "cancel"
invocation:
  command: "/skill.evolve"
  semantics: ["#skill-evolution"]
  bindings: ["@skill-catalog", "@skill-policy", "@runtime-proof", "@operator"]
```

`plan` and `start` additionally require:

```text
sourceRevision: 40-hex Git revision
baseline: { skillId, revision, digest, artifactRef, normalizedChars }
executor: { id, revision, digest }
candidateAdapter: { id, revision, digest }
dataset:
  training: [{ id, digest, ref }]
  validation: [{ id, digest, ref }]
evaluator:
  { id, revision, digest, metric: { id, direction, threshold } }
schedule:
  { epochs, batchSize, miniBatchSize,
    learningRate: { initial, decay, floor }, seed }
validation:
  { minDelta, patience, requiredGates: [string] }
bounds:
  { maxCandidates, maxAdapterCalls, maxMutationOperations,
    maxChangedChars, maxTokens, maxCostUsd, maxDurationMs }
idempotencyKey: non-empty string
```

`direction` is exactly `maximize` or `minimize`. `baseline.normalizedChars`, `epochs`, `batchSize`, `miniBatchSize`, `validation.patience`, `maxCandidates`, `maxAdapterCalls`, `maxMutationOperations`, `maxChangedChars`, `maxTokens`, and `maxDurationMs` are positive finite integers. Metric threshold is finite; `minDelta` and `maxCostUsd` are finite and non-negative. `validation.requiredGates` is a non-empty array of unique non-empty registered ids, and `seed` is a non-empty string. `learningRate.initial` is greater than zero and at most one, `learningRate.decay` is greater than zero and at most one, and `learningRate.floor` is non-negative and no greater than `initial`. `miniBatchSize` is less than or equal to `batchSize`.

`step` and `cancel` require `{ runId, expectedRevision, idempotencyKey }`; `expectedRevision` is a positive integer. `status` requires `{ runId }` and is read-only. The runtime may accept transport-owned authentication and execution metadata outside tool arguments, but no request may contain a provider credential or model key.

## Source And Dataset Gates

`sourceRevision` binds the baseline artifact, catalog contract, executor, candidate adapter, dataset manifest, evaluator, and policy observed at admission. A source-verifier capability resolves the exact 40-hex revision and verifies every supplied digest before `start` and again before each mutating step. Its exact result also registers the permitted gate ids and a maximum token, USD-cost, and duration envelope for each execution method. Any change to that verified result is source drift. A moving branch, mutable alias, digest mismatch, missing artifact, normalized-character mismatch, executor drift, candidate-adapter drift, unknown gate, or malformed envelope blocks before paid adapter work.

Training and validation entries are non-empty, source-backed references. Their normalized ids, digests, and resolved artifact identities must be pairwise disjoint. Duplicate training entries, duplicate validation entries, or any cross-split overlap is invalid. The held-out evaluator alone resolves validation references and owns their isolated frozen-executor rollouts. The candidate adapter receives no validation reference, payload, output, score, per-case trace, aggregate gate result, or evaluator state before or after promotion.

Raw examples, model outputs, private reasoning, credentials, and provider payloads are ephemeral. Durable run state retains references, digests, aggregate scores, gate results, bounded cost evidence, and the final review artifact only.

## Epoch, Batch, And Mini-Batch Semantics

- `epochs` is the maximum number of complete deterministic passes over the training references.
- `batchSize` is the maximum number of ordered training cases grouped as one batch inside an epoch.
- `miniBatchSize` is the maximum number of cases consumed by one candidate-update step and must not exceed `batchSize`.
- The seed and immutable training manifest determine one reproducible order. An epoch partitions that order into batches, then partitions each batch into mini-batches without dropping or duplicating a case.
- A full-batch run has `batchSize` and `miniBatchSize` at least as large as the training set. A mini-batch run advances one smaller partition per `step`.
- Completing all mini-batches in an epoch schedules one held-out validation checkpoint as the next `step`. A new epoch cannot begin until that checkpoint is persisted.

`learningRate` is a text-mutation schedule, never a gradient, optimizer coefficient, or model-training parameter. The current epoch rate is `max(floor, initial * decay^epoch)`, where `epoch` is zero-based and the first epoch uses exponent zero. For one candidate step, its rate budget is the greater of one character and the floor of `baseline.normalizedChars` multiplied by the current epoch rate. The accepted diff must also remain within the run's remaining `maxChangedChars` and `maxMutationOperations`. The candidate adapter returns ordered, non-overlapping canonical hunks shaped as `{ start, deleteText, insertText }`; the runtime normalizes newlines and independently computes operation count, inserted-plus-deleted characters, and the successor normalized length from those hunks. Adapter-reported aggregate mutation counts are not trusted. Before advancement, the separately isolated source verifier must materialize the canonical parent and candidate artifacts, confirm every deletion, apply the hunks, and attest the recomputed length, digest, and candidate-reference binding.

The immutable `baseline` is the admitted skill source. `champion` starts as that baseline and means the best candidate accepted by held-out validation. `workingCandidate` is run-local resumable state: it starts from the champion and changes only through training mini-batch steps. `promotedCandidate` is non-null only when the most recent validation checkpoint promoted working candidate; that transition atomically makes it champion. A later training step or failed checkpoint clears promoted candidate, and a failed checkpoint resets working candidate to champion. None of these identities writes the canonical skill.

## Validation Gates

`validation.requiredGates` contains unique registered gate ids. Unknown, unavailable, duplicate, skipped, or non-passing gates block promotion. At minimum, the selected policy must cover schema validity, skill security, semantic preservation, focused behavior, and cost or latency regression where applicable.

At each epoch checkpoint, the evaluator scores working candidate and champion against the exact same held-out references and evaluator digest. Metric threshold has direction-specific meaning:

- For `maximize`, threshold passes when `workingScore >= threshold`; directional improvement requires both `workingScore > championScore` and `workingScore - championScore >= minDelta`.
- For `minimize`, threshold passes when `workingScore <= threshold`; directional improvement requires both `workingScore < championScore` and `championScore - workingScore >= minDelta`.

Scores must be finite. The explicit strict comparison is always required, so equality never promotes even when `minDelta` is zero. The working candidate becomes promoted candidate and champion only when:

1. its threshold and strict directional-improvement formulas pass;
2. every required gate passes;
3. executor, source, dataset, evaluator, and policy digests remain unchanged; and
4. every call, mutation, character, token, cost, duration, and candidate bound remains satisfied.

A failed checkpoint resets working candidate to champion. `patience` counts consecutive checkpoints without an accepted promotion; reaching it stops the run with `plateau`. Validation evidence never feeds a later candidate proposal.

The evaluator's validation executor calls, evaluator calls, tokens, cost, and duration consume the same run bounds as training. Accounting exposes separate `training` and `validation` phase totals whose sums equal the run totals. Validation work cannot be hidden, attributed to training, or treated as zero-cost unless its measured values are zero.

## Bounds And Fail-Before-Spend

`plan` computes exact batches, mini-batches, candidate count, candidate-adapter calls, training rollouts, validation rollouts, evaluator calls, mutation-operation and changed-character ceilings, and the total adapter-call ceiling before spend. `maxAdapterCalls` includes candidate-adapter, frozen-executor, and evaluator invocations in both phases. It rejects a schedule whose exact structural, candidate, call, or mutation ceiling exceeds its declared cap. Token, cost, and duration are not precomputed worst-case estimates in `plan`: `maxTokens`, `maxCostUsd`, and `maxDurationMs` remain hard run caps. At `start`, exact source-bound per-call usage envelopes multiplied by exact planned call counts must fit those caps. Before each later call, its envelope must fit the remaining budget; exact returned usage is checked against both, while missing or unverifiable usage is conservatively charged at the full envelope. USD arithmetic is canonicalized to 12 decimal places.

Before external work, a mutating transition durably checkpoints an in-flight intent at the current revision. Each capability call receives a deterministic transition id, call id, input digest, deadline, ordinal, and state fence. Source-bound adapters must make the call id idempotent so a crash retry cannot spend twice. The runtime renews its claim after every call, rechecks the fence before commit, and atomically stores the successor plus replay evidence. A same-process `cancel` aborts active capability work and atomically records both step and cancel replays; a different process cannot claim that active transition and fails closed.

The canonical host exposes five exact capabilities in distinct sanitized subprocesses: authorization, source verification (including artifact mutation verification), training execution, candidate proposal, and held-out validation/evaluation. Exchanges are bounded JSON and carry only role-specific inputs. The host denies adapter filesystem writes, child processes, worker threads, native add-ons, and inherited secrets; network access is not an OS-sandboxed boundary. Adapter modules therefore remain trusted, repository-contained, SHA-256 pinned, and restricted by contract to inference-only execution. The immutable safety flags attest what this orchestrator performed; they are not a proof about hostile code outside that boundary.

No loop is implicit. Stop reasons are typed and include `completed`, `plateau`, `budget_exhausted`, `timeout`, `gate_failed`, `source_drift`, `adapter_failed`, and `canceled`. Retry consumes no hidden allowance; a replay with the same idempotency key returns the original transition, while changed input returns `idempotency_conflict`.

## Result Contract

Every successful tool call returns `knowgrph-skill-evolution-result/v1` with:

```text
runId, revision, operation,
status: "planned" | "ready" | "running" | "review_pending" |
        "stopped" | "canceled" | "failed",
invocation, sourceRevision, baseline, executor, candidateAdapter,
dataset, evaluator,
plan: { epochs, batchSize, miniBatchSize, learningRate,
        batchesPerEpoch, miniBatchesPerEpoch, maxCandidateCalls },
progress: { epoch, batch, miniBatch, candidatesEvaluated },
workingCandidate, champion, promotedCandidate,
metrics: { baseline, workingCandidate, champion, promotedCandidate },
validation: { disjoint, gateResults, staleEpochs },
cost: { adapterCalls, mutationOperations, changedChars,
        tokens, costUsd, durationMs,
        byPhase: {
          training: { adapterCalls, tokens, costUsd, durationMs },
          validation: { adapterCalls, tokens, costUsd, durationMs }
        } },
stopReason, proposal, errors,
applied: false,
modelWeightsMutated: false,
deploymentAttempted: false
```

`plan` returns `runId: null`, `revision: 0`, and `status: "planned"` because it persists no state. `start` returns a non-empty `runId`, `revision: 1`, and `status: "ready"`. Later operations return the exact current durable revision.

Whenever non-null, `baseline`, `executor`, `candidateAdapter`, `dataset`, and `evaluator` retain exactly their source-bound request shapes above; a non-null plan retains exactly the projected plan shape in the result contract.

Candidate snapshots use one exact shape:

```text
{ candidateRef: string, diffRef: string | null,
  digest: 64-hex, parentDigest: 64-hex | null }
```

For resolved `planned`, `ready`, `running`, `review_pending`, `stopped`, and `canceled` results, working candidate and champion are non-null candidate snapshots; plan and start project baseline into both. Promoted candidate is nullable in every status because it describes only the latest checkpoint outcome. A review-pending proposal may therefore reference champion while promoted candidate is null after a later non-promoting checkpoint.

A pre-admission or not-found `failed` result still contains every top-level field. It may use null for `runId`, `sourceRevision`, baseline, executor, candidate adapter, dataset, evaluator, plan, working candidate, champion, and promoted candidate when no run or complete specification resolved. Revision is zero when run id is null. Progress, metrics, validation, cost, errors, and all three safety flags remain fully typed; failed results contain at least one error. A failure projected from an existing run retains its exact resolved identities and revision.

Metrics are exactly `{ baseline, workingCandidate, champion, promotedCandidate }`, with each value a finite number or null. Cost is exactly:

```text
{ adapterCalls, mutationOperations, changedChars, tokens, costUsd, durationMs,
  byPhase: {
    training: { adapterCalls, tokens, costUsd, durationMs },
    validation: { adapterCalls, tokens, costUsd, durationMs }
  } }
```

Counts and durations are non-negative integers and costs are finite non-negative numbers. Total adapter calls, tokens, cost, and duration equal the corresponding training-plus-validation values.

`errors` contains typed `{ code, field, message }` entries and no stack, secret, raw example, or provider payload. Admission and transition failures include `invalid_request`, `invocation_mismatch`, `unauthorized`, `source_revision_invalid`, `source_drift`, `dataset_overlap`, `schedule_invalid`, `bound_exceeded`, `cost_unverified`, `gate_failed`, `stale_revision`, `transition_in_progress`, `lease_lost`, `timeout`, `idempotency_conflict`, and `adapter_failed` as applicable.

Only a successful terminal evaluation may set `status: "review_pending"` and return:

```text
proposal: { status: "review_pending", candidateRef, diffRef, digest }
```

Every other state returns `proposal: null`. A review-pending proposal references champion only after at least one promoted candidate differs from baseline. All states return `applied: false`, `modelWeightsMutated: false`, and `deploymentAttempted: false`. `/skill.manage` remains the separate reviewed persistence owner after the operator inspects the proposal.

## VCCs

| VCC | Observable proof |
|---|---|
| Invocation is singular | Exact command, semantic, four bindings, skill id, and MCP tool resolve once; training aliases are absent. |
| Plan is bounded | Exact mini-batch, candidate, adapter-call, mutation-operation, and changed-character ceilings fit before `start`; token, cost, and duration remain hard run caps enforced at adapter-call boundaries rather than estimated totals. |
| Resume is fenced | One `step` advances one unit and one revision; stale `expectedRevision` and conflicting replay fail. |
| External calls are retry-safe | Durable transition intent, deterministic call ids, adapter call-id idempotency, deadlines, claim renewal, and atomic replay commits bound every mutation. |
| Splits are held out | Cross-split identity overlap fails; the evaluator alone owns isolated validation rollouts and the candidate adapter receives no validation evidence. |
| Capabilities are separated | Authorization, source verification, training execution, candidate proposal, and held-out work exchange bounded role-specific JSON in separate host processes. |
| Learning rate is textual | Candidate diffs obey rate, changed-character, and mutation-operation limits without a model-training API. |
| Mutation evidence is artifact-bound | A separate source verifier applies hunks to trusted parent text and recomputes candidate length, digest, and reference binding before advancement. |
| Candidate roles do not blur | Working candidate is run-local, champion is held-out-approved, promoted candidate passed the latest checkpoint, and none is an applied skill. |
| Validation governs promotion | Directional threshold and delta formulas pass strictly; equality cannot promote at zero `minDelta`, and any failed gate resets working candidate to champion. |
| Validation cost is visible | Training and validation phase accounting sums exactly to bounded run totals. |
| Patience stops | Consecutive non-improving checkpoints stop at the declared `patience` bound. |
| Handoff is review-only | Success returns `review_pending`, while apply, weight mutation, merge, release, and deployment flags remain false. |
| Clean-room boundary holds | No SkillOpt implementation artifact or dependency is present. |

## Promotion Boundary

The ACOS invocation contract is spec-complete and its client transport is fail-closed under model-free tests. This is not Skill Evolution runtime proof. Runtime-ready promotion requires `RUNTIME-PROOF.md` to cite the exact integrated ACOS and Knowgrph revisions plus exact passing Knowgrph local MCP, persistence, adapter-isolation, validation, idempotency, budget, and no-write test commands. Until those citations exist, executable optimization remains gated. No result proves general skill quality, provider availability, production behavior, or deployment.
