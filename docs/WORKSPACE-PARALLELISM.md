---
title: "Agentic Canvas OS Workspace Parallelism Contract"
graphId: "md:agentic-canvas-os-workspace-parallelism"
doc_type: "Workspace Parallelism Contract"
date: "2026-09-01"
lang: "en-US"
schema: "agentic-canvas-os-workspace-parallelism/v2"
frontmatter_contract: "required"
status: "draft"
owner: "ADLC harness"
delivered_rung: "undocumented"
---
<!-- Responsibility: Preserve concurrent workspace bytes while ADLC owns each repository lane. -->

# Workspace Parallelism Contract

Concurrent sessions across sibling repositories, devices, worktrees, and cloud
placements are the intended mode. Placement is not Git authority. Each
repository independently applies the lifecycle in
[`CANONICAL-LIFECYCLE.md`](./CANONICAL-LIFECYCLE.md).

## Rules

| Rule | Requirement |
|---|---|
| One branch, one registered worktree | A branch is active in at most one registered worktree. |
| One task, one ADLC lane | Scope is expressed by the `agent/<device>/<scope>` branch and its pull request. |
| Disjoint concurrency | Distinct lanes may run concurrently; global serialization is not the safety model. |
| Main is read-only | Canonical `main` is the runtime and synchronization owner, never the authoring surface. |
| Dirty bytes are evidence | Modified and untracked paths are preserved and block destructive cleanup; they are never an implicit claim. |
| Provider owns ordering | Published lanes do not repeatedly restack to chase protected `main`. |
| Proof precedes retirement | An exact ADLC integration proof is required before removing one clean lane. |
| Exact cleanup only | Cleanup names one worktree and branch. Broad prune, force, stash, reset, or inferred ownership is forbidden. |

## Read-Only Inventory

```sh
git worktree list --porcelain
npm run status
npm run reap
npm run worktree:lifecycle:check -- --json
```

The compatibility lifecycle report is observational. It may classify a lane as
needing attention, but it cannot grant writer authority or make dirty bytes
cleanup-eligible.

## Completion

After protected integration, run `npm run reap` and inspect its proof. ACOS's
committed profile retains every cleanup effect, so no survey result authorizes
retirement. Keep all paths and refs intact until a target-specific authenticated
cleanup receipt authorizes one exact lane; other dirty or active lanes remain
untouched in every case.
