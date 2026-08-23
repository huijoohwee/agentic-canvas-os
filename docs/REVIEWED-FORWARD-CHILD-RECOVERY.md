---
title: "Reviewed forward-child recovery"
graphId: "md:reviewed-forward-child-recovery"
doc_type: "Lifecycle Capability"
date: "2026-08-11"
lang: "en-US"
schema: "agentic-reviewed-forward-child-recovery/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/reviewed-forward-child-recovery.mjs; ../scripts/reviewed-forward-child-recovery-journal.mjs"
runtime_proof: "../__tests__/reviewed-forward-child-recovery.test.mjs"
---

# Reviewed forward-child recovery

This maintenance controller restores the exact owner of a reviewed lane when a protected-main
refresh commit is already published above its immutable reviewed revision. It creates one empty,
single-parent child of the published head and moves the same branch forward without rewriting any
reviewed, refresh, or source-tree byte.

The controller is intentionally narrower than normal reviewed-lane delivery. It is eligible only
for a clean, registered `review_ready` lane whose live cloud claim is `dormant-preserved`, whose
provider PR is open, non-draft, same-repository, outside the merge queue, and still has one exact
armed SQUASH auto-merge request. The local branch, remote branch, provider head, writer marker,
reviewed ancestor, refresh chain, cloud claim, and protected main are joined into one path-free plan.
When the lane has more than one protected refresh merge, the pull request's current base is joined to
the newest refresh merge's protected-main parent while every earlier refresh remains ancestry-bound.

## Plan

```bash
node scripts/reviewed-forward-child-recovery.mjs plan \
  --repository=<source-worktree> \
  --source-session=<exact-source-session> \
  --pull-request=<number> \
  --operator-session=<distinct-controller-session>
```

Planning is read-only. The returned `exactAuthorization` binds the source evidence and deterministic
child commit SHA. Execution requires that exact text:

```bash
node scripts/reviewed-forward-child-recovery.mjs run \
  --repository=<source-worktree> \
  --source-session=<exact-source-session> \
  --pull-request=<number> \
  --operator-session=<distinct-controller-session> \
  --authorize='authorize reviewed-forward-child-recovery <planDigest>'
```

## Protected sequence

The durable intent performs and receipt-binds these phases in order:

1. Disable the exact armed auto-merge and verify one matching provider disable event.
2. Materialize the deterministic empty child object without moving a ref.
3. Create one same-owner waiting successor claim at the child.
4. Retire the dormant predecessor, then promote the successor.
5. Compare-and-swap the local ref and publish the ordinary fast-forward remote update.
6. Activate the existing writer lease against the successor claim.
7. Demote the PR to draft, project its exact writer marker, and verify terminal parity.

Every phase first reconciles provider and repository state. A lost response is adopted only when the
effect matches the bound operation. Stale source evidence, another successor, a ref race, a non-fast-
forward publication, marker drift, cancellation ambiguity, or claim drift fails closed.

## Journal generations

Each operator session owns one immutable journal generation under the source branch's journal
directory. The generation identity combines the branch and operator session, so an exact retry
continues the same intent even after the protected sequence advances the branch. A branch-wide
fence serializes every generation.

Completed generations, including the original flat branch-keyed journal, remain untouched as
historical receipts and do not block a later recovery. A non-complete or malformed historical
generation blocks creation of another intent. The controller never migrates, rewrites, deletes, or
uses a completed legacy plan as authority for a new source head.

## Forbidden effects

The controller never changes the source tree, rewrites or force-pushes a commit, merges a PR,
cleans a worktree, releases scope, or deploys. The resulting draft lane must pass normal focused
proof, review, delivery authorization, protected integration, and release gates separately.
