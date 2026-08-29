---
title: "Integrated-preserved draft recovery"
graphId: "md:integrated-preserved-draft-recovery"
doc_type: "Lifecycle Capability"
date: "2026-08-29"
lang: "en-US"
schema: "agentic-integrated-preserved-draft-recovery/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/integrated-preserved-draft-recovery.mjs"
runtime_proof: "../__tests__/integrated-preserved-draft-recovery.test.mjs; ../__tests__/integrated-preserved-draft-lineage-recovery.test.mjs"
---

# Integrated-preserved draft recovery

Use this controller only when a reviewed lane is locally preserved, its exact cloud claim is
`integrated-preserved`, and the ownership pull request is still `OPEN` but incorrectly remains a
draft. The controller repairs that single provider projection before the existing review-ahead
recovery resumes delivery authority.

This is a provider-state recovery, not a source, branch, lease, cloud-claim, merge, deployment, or
cleanup operation. It fails closed unless the existing cloud-authority handoff classifier reports
exactly `review-projection-not-ready` before the transition and no findings after it.

## Plan

Run the planner from the canonical ACOS checkout while naming the preserved target worktree:

```sh
node scripts/integrated-preserved-draft-recovery.mjs plan \
  --repository=/absolute/path/to/preserved-worktree \
  --session=<original-session> \
  --json
```

The plan seals the local lease, task-authority binding, original base identity, reviewed head,
complete matching remote owner marker, pull-request identity, integrated claim, and integration
receipts. The capability must resolve outside both the target worktree and its Git common directory.
An epoch-one claim with a predecessor additionally requires a separately branded, read-only
scope-expansion lineage proof. That proof validates the append-only ledger, source retirement,
target genesis, immediate reviewed-to-integrated edge, exact local and remote projections, stale
writer lease, and terminal non-writer claim. It cannot satisfy lineage-migration admission and
grants no cloud mutation.

The plan deliberately excludes only the pull request's draft bit and volatile global ledger
chronology. Stable lineage identity remains sealed while unrelated append-only ledger advancement
is revalidated on every capture. This makes an
exact cold replay possible after provider response loss without accepting unrelated drift.

## Execute

Use the authorization emitted by that exact plan and the original task-authority capability:

```sh
node scripts/integrated-preserved-draft-recovery.mjs execute \
  --repository=/absolute/path/to/preserved-worktree \
  --session=<original-session> \
  --task-authority=/absolute/path/to/existing-task-authority.json \
  --authorize='authorize integrated-preserved-draft-recovery <plan-digest>' \
  --json
```

Execution obtains the task-bound mutation proof and reviewed-lane entrypoint fence before invoking
the repository-owned `gh pr ready` projection. If the provider response is lost, the controller
first recaptures the sealed draft identity after task proof, then invokes the provider. It adopts
success only after another fresh capture proves the exact sealed identity is unchanged and the draft
bit is false. Projected, response-loss, and already-ready executions share one stable terminal
receipt; attempt-specific task proof, disposition, and provider evidence remain in a separate
execution digest. Replaying the same authorization against that terminal state does not invoke the
provider again.

After this controller succeeds, run the existing `review-ahead-projection-recovery` plan and
execution with the same original task authority. Continue through the normal guarded review,
integration, completion, and exact cleanup workflow; do not manually ready, merge, rebase, force,
rotate authority, or prune the lane.
