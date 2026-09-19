---
title: "Sprint Harness MVP"
graphId: "md:agentic-sprint-harness"
doc_type: "Runtime Contract"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-sprint-harness/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "effect-free sprint planning and exact merge-train evidence validation"
runtime_scope: "offline deterministic planning across devices and Git worktrees"
runtime_claim: "planning receipts only; no Git, network, provider, dispatch, integration, or deployment authority"
runtime_owner: "../scripts/sprint-harness-contract.mjs; ../scripts/sprint-harness.mjs"
runtime_proof: "../__tests__/sprint-harness.test.mjs; ../__tests__/sprint-harness-e2e.test.mjs"
publish_policy: "repository review and protected integration remain separately gated"
---
<!-- Responsibility: Define the bounded, zero-effect sprint planning harness. -->

# Sprint harness MVP

This is a zero-dependency planning harness for a solo contributor working from
multiple devices, worktrees, and AI-assisted coding environments. It turns a
small, immutable work graph into deterministic execution waves and a receipt.
It does not run Git commands, contact a network, dispatch agents, or change a
provider.

The bounded MVP optimizes the next useful result:

- one fixed 60-minute sprint timebox;
- disjoint ready units in the same wave;
- dependencies and overlapping paths serialized deterministically;
- immutable stack heads, never automatic rebase, restack, or downstream rewrite;
- source-owner-once conflict resolution;
- exact merge-train evidence that fails closed on drift while preserving authored work;
- estimated time and token economics in every receipt.

## Clone and run

Node.js 22 or newer is the only runtime requirement.

```sh
git clone <repository-url> agentic-canvas-os
cd agentic-canvas-os
node scripts/sprint-harness.mjs demo
node --test __tests__/sprint-harness.test.mjs __tests__/sprint-harness-e2e.test.mjs
```

Plan a JSON file or pipe JSON on standard input:

```sh
node scripts/sprint-harness.mjs plan ./sprint-plan.json
node scripts/sprint-harness.mjs plan - < ./sprint-plan.json
```

Successful commands write one JSON value to standard output. Invalid input
writes a JSON error to standard error and exits nonzero. Repeating an unchanged
plan produces the same receipt.

## Plan contract

```json
{
  "schema": "agentic-sprint-plan/v1",
  "profile": "standalone",
  "sprint": { "id": "first-value", "timeboxMinutes": 60 },
  "units": [
    {
      "id": "source",
      "paths": ["src/source.mjs"],
      "dependsOn": [],
      "immutableHead": { "ref": "refs/heads/source", "sha": "1111111111111111111111111111111111111111" },
      "estimatedMinutes": 20,
      "estimatedTokens": 1200,
      "evidenceDigests": []
    },
    {
      "id": "stacked-child",
      "paths": ["src/child.mjs"],
      "dependsOn": ["source"],
      "immutableHead": { "ref": "refs/heads/stacked-child", "sha": "2222222222222222222222222222222222222222" },
      "estimatedMinutes": 15,
      "estimatedTokens": 800,
      "evidenceDigests": []
    }
  ]
}
```

`profile` is explicit: `standalone`, `fork`, or `enrolled`. The harness never
infers authority or workspace enrollment. Unit IDs, paths, dependencies, and
immutable heads are normalized before hashing. A missing dependency, dependency
cycle, duplicate unit, or invalid timebox fails before a receipt is emitted.

The receipt reports deterministic waves plus planning estimates: planned units
and tokens, wave count, critical-path minutes, time to next value, units per
hour, tokens per unit and minute, reused evidence, avoided downstream restacks,
and overlapping-source conflicts owned once. These values are input-derived
estimates, not production telemetry or billing measurements.

## Worktrees and stacked diffs

Create sibling units from the same reviewed base when their paths are disjoint.
Create a child unit from its reviewed parent head only when the child genuinely
depends on that parent. Record both heads as immutable references. When the
canonical branch advances, validate that the recorded head is still a descendant
or wait; do not rewrite every downstream worktree.

Conflicts return to the source owner once. Downstream units consume a new
immutable source head after it is reviewed. This prevents multiple devices from
re-solving the same conflict and avoids rebase livelock.

## Merge queue and train boundary

Optional merge-train evidence records the exact queue ID, canonical base ref and
SHA, synthetic merge ref and SHA, rebuild ID, ordered members, reviewed member
heads, and evidence digests. The validator compares every field.

Any drift invalidates only the queue/train evidence. Authored commits and
worktrees remain preserved and are not rebased or restacked. A caller may build
fresh evidence from the new canonical base, but this harness deliberately owns
no queue API and performs no provider action. The evidence model is
provider-neutral and works offline.

## Two-wave operating loop

1. Freeze the 60-minute plan, paths, immutable heads, estimates, and evaluator.
2. Run the first wave of disjoint, dependency-ready units in separate worktrees.
3. Evaluate and retain reusable evidence by digest.
4. Run the second wave only after its declared parents pass.
5. Validate exact queue/train evidence at integration time; on drift, rebuild
   evidence without rewriting authored work.

The harness is intentionally small. Lease acquisition, protected-branch policy,
provider queue configuration, agent dispatch, commits, pushes, and deployment
remain owned by the surrounding repository workflow.
