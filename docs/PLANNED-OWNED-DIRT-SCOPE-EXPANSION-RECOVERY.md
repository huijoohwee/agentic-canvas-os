---
title: "Planned owned-dirt scope-expansion recovery"
graphId: "md:planned-owned-dirt-scope-expansion-recovery"
doc_type: "operations"
version: "1.0.0"
date: "2026-08-22"
lang: "en-US"
schema: "agentic-planned-owned-dirt-scope-expansion-recovery-doc/v1"
frontmatter_contract: "required"
status: "focused-tested"
owner: "Repository lifecycle controller"
local_rung: "runtime-ready"
delivered_rung: "undocumented"
runtime_owner: "../scripts/planned-owned-dirt-scope-expansion-recovery.mjs"
runtime_proof: "../__tests__/planned-owned-dirt-scope-expansion-recovery.test.mjs"
---

# Planned owned-dirt scope-expansion recovery

This controller closes one narrow activation gap. A provisioned task lane can
remain `planned` after its draft pull request and fence exist, while the exact
task owner has already produced modified or untracked bytes at that fence. If
the implementation then needs additional declared paths, ordinary admission,
resume, heartbeat, and active-dirty expansion all fail closed for the right
reason: none owns a planned dirty source-to-successor transition.

The controller replaces only the planned lane's cloud and local authority
projection. It preserves its branch, worktree, HEAD, fence, index, tracked and
untracked bytes, remote ref, draft review identity, and task authority subject.

## Admitted source

Planning requires all of the following:

- one attached, registered task worktree at the recorded fence;
- one `active` v2 writer lease whose admission is exactly `planned`;
- the same recorded session, device, branch, worktree, and task capability;
- an open same-repository draft pull request at the exact fence, with no
  auto-merge request;
- local HEAD, remote task ref, pull-request head, and lane revision equal to
  the fence;
- a source claim that is either current or `dormant-preserved`, retains scope
  reservation, and matches the lease's base, fence, write set, and review;
- modified and untracked evidence fully covered by the source write set;
- a target manifest with the same semantic scope and a strict-superset write
  set that covers every sealed dirty path;
- no other write-authoritative or scope-reserving claim overlapping the target
  write set; and
- the installed controller clean and equal to protected `origin/main`.

Canonical-main drift is rejected. The task-authority successor contract keeps
the lane's base stable, so this operation cannot disguise a rebase or import a
new canonical frontier.

## Plan and authorize

Planning is read-only:

```sh
node "$AGENTIC_CANVAS_OS_ROOT/scripts/planned-owned-dirt-scope-expansion-recovery.mjs" plan \
  --repository="$TASK_WORKTREE" \
  --session="$AGENTIC_SESSION_ID" \
  --target-manifest="<expanded-manifest.json>" --json
```

Persist the returned `plan` outside the repository without editing it. The
operator must then supply the exact returned text:

```text
authorize planned-owned-dirt-scope-expansion-recovery <planDigest>
```

Execution also requires the original external task capability:

```sh
node "$AGENTIC_CANVAS_OS_ROOT/scripts/planned-owned-dirt-scope-expansion-recovery.mjs" run \
  --repository="$TASK_WORKTREE" \
  --session="$AGENTIC_SESSION_ID" \
  --target-manifest="<expanded-manifest.json>" \
  --plan-file="<sealed-plan.json>" \
  --task-authority="<external-capability.json>" \
  --authorize="authorize planned-owned-dirt-scope-expansion-recovery <planDigest>" \
  --json
```

## Mutation sequence

One private journal under the source Git common directory serializes and
records these steps:

1. Verify the typed decision and task proof of possession.
2. Claim a strict-superset, non-writing waiting successor whose predecessor is
   the planned source claim.
3. Retire only the exact source claim as `superseded`, binding its fence,
   review, and sealed owned-dirt digest.
4. Promote the exact waiting successor to current authority.
5. Bind it to the existing draft review request and unchanged fence.
6. Atomically replace the planned source lease with one admitted successor
   lease and a task-authority continuation binding.
7. Replace only the hidden writer-lease marker in the existing pull request.
8. Reverify current cloud authority, local mutation authority, every dirty
   byte and mode, fence/ref identity, and the draft review marker.

Cloud operations use plan-derived idempotency keys. A lost cloud response is
replayed through the same key. A lost local response is adopted only when the
registry contains the exact successor lease and continued task binding. A
marker retry accepts only the exact target marker. A complete journal is
read-only on replay apart from fresh verification.

## Explicit non-authority

The completion receipt reports `mutation-authority-restored`, not review,
integration, runtime, release, or deployment readiness. It grants no mutation
outside the expanded manifest and performs none of the following:

- writing, staging, committing, stashing, resetting, or moving source bytes;
- changing HEAD, a local or remote ref, or pull-request draft state;
- making a review ready, merging, publishing, deploying, or cleaning; or
- transferring the lane, task capability, dirt, or review to another owner.

After recovery, authoring can continue only while the returned mutation
authority remains current. Completion still requires a clean lane and the
ordinary `device:review` and protected integration contracts.

## Focused verification

```sh
node --test \
  __tests__/planned-owned-dirt-scope-expansion-recovery.test.mjs
```

The focused check proves strict-superset and untracked coverage, exact typed
authorization, ordered journaling, terminal non-mutation flags, idempotent
replay, journal compare-and-swap behavior, and CLI capability separation.
