---
title: "Admitted Empty Abandoned Owner Retirement"
graphId: "md:admitted-empty-abandoned-owner-retirement"
doc_type: "Recovery Controller Contract"
date: "2026-08-28"
lang: "en-US"
schema: "agentic-admitted-empty-abandoned-owner-retirement-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "bounded recovery for one expired planned fence-only owner"
runtime_scope: "cloud claim retirement, draft closure, and local lease release"
runtime_claim: "no source, ref, branch, worktree, authored-lane, or deployment mutation"
runtime_proof: "../__tests__/admitted-empty-abandoned-owner-retirement-contract.test.mjs; ../__tests__/admitted-empty-abandoned-owner-retirement-controller.test.mjs; ../__tests__/admitted-empty-abandoned-owner-retirement-repository-adapter.test.mjs; ../__tests__/private-operation-lock.test.mjs"
---

# Admitted Empty Abandoned Owner Retirement

## Purpose

This controller retires one abandoned partial-start lane only when its entire
committed projection is a clean, registered, one-parent, zero-path coordination
commit. A separate authored lane is content-bound and must remain unchanged.
The controller is provider-adapted at the repository boundary; its contract,
state progression, authorization, and preservation semantics are provider
neutral.

The controller does not decide that a lane is abandoned. Planning seals the
exact expired owner, cloud claim, provider review, local lease, controller, and
authored-lane evidence into one durable private state file. Execution requires
the exact human authorization derived from that persisted plan.

## Closed Boundary

The subject must prove all of the following:

- one expired `planned` local lease and its exact expired cloud claim;
- no current write authority and one dormant scope reservation;
- an exact provider device/session identity joined to the local lease owner when
  the cloud projection supplies those identities;
- one clean registered worktree and matching local and remote branch head;
- one empty coordination commit whose parent and tree equal the declared base;
- one open, unmerged, draft review for that exact head;
- one distinct registered authored lane with an unchanged state digest; and
- one clean protected controller revision equal to its fetched canonical ref.

The claim projection is closed to two shapes. The legacy shape keeps
`laneRevision` at the declared base with no `reviewRequestId`. The recovered
PR-bound shape instead requires `laneRevision` to equal the exact subject HEAD
and local fence, plus `reviewRequestId` to equal
`github-pull-request:<provider-node-id>` for that same open draft. Mixed,
missing, foreign, or base-drifted fields are rejected.

The only effects are cloud-claim retirement, provider draft closure, and local
lease release. The subject worktree, local branch, remote branch, Git refs,
commit tree, and authored lane remain preserved. Cleanup is a separate,
recoverable, explicitly authorized lifecycle.

## Stable Authorization Transport

Planning requires an absolute private JSON `--state-path` and atomically stores
the immutable plan before returning it. Running loads that stored plan; it does
not re-plan timestamped evidence. Exact authorization is read from a private,
regular, one-line `--auth-file`, avoiding shell tokenization of the human reply.

```bash
node scripts/admitted-empty-abandoned-owner-retirement.mjs plan \
  --repository=/workspace/repository \
  --subject-worktree=/workspace/empty-subject \
  --authored-worktree=/workspace/authored-source \
  --target-repository=owner/repository \
  --pull-request=123 \
  --claim-id=<sha256> \
  --state-path=/private/recovery/retirement.json \
  --json
```

After an authenticated human supplies the plan's exact reply, store that single
line in a mode-`0600` file and run:

```bash
node scripts/admitted-empty-abandoned-owner-retirement.mjs run \
  --repository=/workspace/repository \
  --subject-worktree=/workspace/empty-subject \
  --authored-worktree=/workspace/authored-source \
  --target-repository=owner/repository \
  --pull-request=123 \
  --claim-id=<sha256> \
  --state-path=/private/recovery/retirement.json \
  --plan-digest=<sha256> \
  --auth-file=/private/recovery/authorization.txt \
  --json
```

Every phase is compare-and-swap persisted. A response-loss retry classifies the
durable cloud, provider, or lease result before repeating an effect. Drift in
the subject, authored lane, controller, provider identity, claim fence, or local
lease blocks further mutation.

## Durable operation serialization

The state journal has one adjacent private operation lock. New owners use the
versioned `agentic-private-operation-lock/v1` record with a process-start
identity, canonical context digest, random token, and acquisition instant.
Acquisition and release use owner-only exclusive files, file and directory
durability, bounded atomic capture, and exact ownership rereads. A live,
identity-ambiguous, malformed, noncanonical, permission-drifted, or
concurrently replaced lock fails closed. A provably dead owner can be captured
without deleting a replacement owner.

One pre-v1 interrupted `authorized` journal may migrate its unversioned lock
only when its exact plan context matches, the owner PID is provably absent, the
sealed controller tree proves that the v1 lock runtime did not yet exist, the
cloud claim is already absent through the plan-bound retirement entry, the
ownership pull request and subject remain exact, and the original external task
capability proves the active lease. The capture is atomic and the immediately
reacquired lock is v1; the controller never authors another unversioned lock.

## Protected-controller continuation

While the cloud claim exists, the protected controller must remain byte- and
revision-exact to the sealed plan. After the exact claim is absent and its
plan-bound retirement ledger entry verifies, remaining provider closure and
local release may continue from a clean protected-main descendant. The current
local `main`, `origin/main`, and live remote `main` must agree; the planned
controller tree object, subject Git and remote fence, pull-request identity,
and active lease remain exact. A distinct authored lane stays byte-exact. Only
an authored lane that was the controller's canonical `main` may advance with
that protected descendant. Every descendant effect re-proves the original task
capability and records controller, authored-lane, retirement-entry, and binding
evidence in its phase receipt. This is ancestry- and evidence-bound recovery,
not an exact-tip parity bypass.

Owner release seals the complete resulting lease core and task-authority
binding into a digest-verified receipt. Terminal replay rejects restored cloud
authority, admission state, receipt drift, lease-field drift, or capability
failure even after provider and local release effects have landed.
