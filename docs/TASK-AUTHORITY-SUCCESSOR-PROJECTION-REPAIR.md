---
title: "Task Authority Successor Projection Repair"
graphId: "md:task-authority-successor-projection-repair"
doc_type: "Lifecycle Contract"
date: "2026-08-13"
lang: "en-US"
schema: "agentic-task-authority-successor-projection-repair-doc/v1"
frontmatter_contract: "required"
status: "controller-focused-tested"
authority: "exact-authorized continuation of one frozen source-retired successor projection"
runtime_scope: "read-only planning, fenced phase replay, stable terminal verification, and exact archive identity"
runtime_claim: "focused controller proof only; live repository-adapter execution and ordinary authoring remain separately gated"
runtime_owner: "../scripts/task-authority-successor-projection-repair.mjs"
runtime_proof: "../__tests__/task-authority-successor-projection-repair-controller.test.mjs"
publish_policy: "Dev-only; no protected integration, deployment, cleanup, or independent authoring authority"
---
<!-- Responsibility: Document the exact successor-projection repair boundary and replay protocol. -->

# Task Authority Successor Projection Repair

This lifecycle is narrowly for an evidence shape accepted by its contract: a scope-expansion
attempt whose predecessor has already been retired, whose exact waiting successor remains
recoverable, and whose local projection cannot safely continue with the stale predecessor task
binding. It is not a general claim-repair, lease-edit, or worktree-cleanup command.

## Boundary

`plan` is read-only. The repository adapter collects and the contract seals the historical
expansion lineage, current source observation, successor state, private capability verification,
and exact identities needed by the plan. A plan is descriptive and grants no mutation authority.

`run` accepts only the plan's byte-exact authorization. It rebuilds the live plan before entering
the fenced lifecycle. The durable phase order is:

```text
prepared -> projection_prepared -> successor_promoted -> successor_bound
         -> lease_projected -> marker_projected -> expansion_finalized
         -> verified -> complete
```

The controller reconciles live state before each effect and again after every attempted effect.
Only an exact live post-reconciliation receipt advances the journal, including when an effect
response is lost. Projection preparation is journaled before successor promotion. Before
promotion and every later phase, the adapter must independently pass the live irreversibility
barrier. A completed replay is freshly verified and its archive must identify the exact completed
intent and completion receipt.

The lifecycle does not itself authorize edits, staging, commits, merges, pushes, ref movement, or
source deletion. Any successful receipt speaks only for the exact terminal identities it seals.

## Commands

Use absolute paths for the source worktree and the private task-authority capability:

```sh
node scripts/task-authority-successor-projection-repair.mjs plan \
  --source-repository=/absolute/source-worktree \
  --session=<source-session> \
  --task-authority=/absolute/private-capability.json \
  --pull-request=<number> \
  --target-repository=<owner/name> \
  --json
```

Review the returned evidence, `planDigest`, and `exactAuthorization`. If they describe the intended
subject, invoke `run` without changing the printed authorization:

```sh
node scripts/task-authority-successor-projection-repair.mjs run \
  --source-repository=/absolute/source-worktree \
  --session=<source-session> \
  --task-authority=/absolute/private-capability.json \
  --pull-request=<number> \
  --target-repository=<owner/name> \
  --plan-digest=<planDigest> \
  --authorize='authorize task-authority-successor-projection-repair <planDigest>' \
  --json
```

`--target-repository` defaults to `huijoohwee/agentic-canvas-os`. The lifecycle's only accepted TTL
is `7200` seconds, which is also the default. Unknown, duplicate, positional, empty, or
command-inappropriate arguments are rejected.

## Handoff

A `complete` receipt is not authoring permission by itself. Before further writes, use the normal
task-bound lane command to verify the current admitted lease, continuation binding, cloud claim,
pull-request marker, and declared scope. If any terminal identity or source observation differs,
stop and build a new read-only plan rather than editing the registry or replay journal directly.
