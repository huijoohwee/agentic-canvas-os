---
title: "Active-publish Successor Dormant Recovery"
graphId: "md:active-publish-successor-dormant-recovery"
doc_type: "Recovery Controller Contract"
date: "2026-08-15"
lang: "en-US"
schema: "agentic-active-publish-successor-dormant-recovery-doc/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "task-bound exact-successor recovery"
runtime_scope: "one dormant active-publish successor claim and its replaceable projections"
runtime_claim: "recovers the existing successor without Git, source, claim, review, integration, cleanup, release, or deployment effects"
runtime_owner: "../scripts/active-publish-successor-dormant-recovery.mjs"
runtime_proof: "../__tests__/active-publish-successor-dormant-recovery.test.mjs"
provider_policy: "provider operations isolated behind injected adapters"
model_policy: "model, agent, client, and provider neutral"
publish_policy: "Dev-only; protected integration remains a separate exact-candidate lifecycle operation"
---

# Active-publish successor dormant recovery

This controller closes one narrow response-loss state. An active-publish
transaction already created exactly one successor claim for an existing source
lane. That successor was durably bound to the intended canonical base, source
head, declared scope, task identity, and existing draft review request, but the
local writer lease and hidden review marker did not receive the final
projection. The successor later expired to `dormant-preserved` while retaining
its overlap reservation.

Recovery continues that same successor claim and restores its two replaceable
projections. It does not create a claim, branch, worktree, commit, pull request,
or review. The terminal proof emits the standard current mutation-authority
receipt for the existing ordinary owner; the recovery operation itself grants
no source-authoring, integration, cleanup, publication, Production,
Cloudflare, or deployment authority.

## Exact subject

Read-only planning joins all of these identities:

- one clean, registered, attached source worktree and its exact writer lease;
- the existing branch, source fence, remote head, and draft review head;
- the ordered protected-main refresh chain and a changed-path digest proving it
  is disjoint from the admitted write set;
- the admitted semantic scope, declared write set, write-set digest, and
  manifest digest;
- the source claim and exactly one derivative successor claim;
- the source and successor actor, repository, work item, device, session,
  task-authority lineage, epochs, canonical bases, and review identity;
- the protected-main advance that made the successor necessary; and
- the complete cloud inventory, including absence of a competing overlapping
  reservation.

The successor must be `dormant-preserved`, non-writing, and scope-reserving.
Its recorded predecessor, transition counter, fence, operation receipt, base,
lane revision, and declared scope must match the durable active-publish intent.
The draft review request must still be the same provider object and must have no
auto-merge request.

Missing or duplicate successors, foreign progress, task-binding drift, a
changed review head or body, a changed Git projection, dirty bytes, an authored
range, manifest drift, an overlapping reservation, or a different protected
advance fails closed. A merely similar claim or review is never adopted.

## Authorization and closed effects

Planning is read-only and emits one plan-bound human statement:

```text
authorize active-publish-successor-dormant-recovery <plan-digest>
```

Run requires that byte-exact statement and the existing private task-authority
capability. The capability is verified immediately before the cloud request;
credential material never enters the plan, journal, review body, receipt, or
logs.

The allowed mutation set is closed:

1. one idempotent authenticated recovery continuation on the existing
   successor claim;
2. one compare-and-swap projection of the recovered successor into the source
   lane writer lease;
3. replacement of only the hidden writer marker in the same draft review body;
4. one private digest-chained replay journal.

The operation preserves repository bytes, HEAD, index, tree, local and remote
branch refs, review identity and visible body, source claim, successor claim,
semantic scope, manifest, task identity, session, and device. The cloud
transition counter advances exactly once while the heartbeat counter does not
advance; an ordinary heartbeat is not accepted as recovery. No new cloud claim
is permitted.

## Replay and failure isolation

The journal advances monotonically through:

```text
authorized
task_authority_verified
cloud_request_sealed
cloud_recovered
lease_projected
review_marker_projected
verified
complete
```

The cloud request and idempotency key are sealed before provider mutation. A
lost response may adopt only the same successor at counter plus one with the
exact operation receipt and recovered authority. The lease compare-and-swap
accepts only the sealed source lease or its deterministic target. The review
projection accepts only the sealed source marker or deterministic target
marker, while preserving the visible body byte-for-byte.

GitHub does not provide conditional unsafe body updates. The marker projection
therefore holds the repository writer-registry fence across its full
read/edit/read sandwich. Out-of-band review-body edits are outside this
cooperative transaction and must remain paused until its terminal receipt.

Every effect boundary revalidates the sealed subject. A failure stops at its
durable phase; replay resumes that phase without repeating earlier effects.
Terminal verification joins cloud authority, lease projection, hidden marker,
review identity, protected revision, and unchanged repository projection. A
run resuming from `verified` repeats terminal verification before completing.
Once `complete` is durable, replay returns the immutable receipt without
renewing or mutating anything.

Independent peer failures are reported as bounded findings and do not erase a
verified exact subject. Subject ambiguity, overlap, or mutation drift remains a
hard failure. This fail-soft fan-out rule preserves unrelated lanes without
weakening the single-writer invariant.

## CLI

Run the protected controller from an Agentic Canvas OS checkout. Keep the plan,
private capability, and optional journal outside repositories.

```sh
node scripts/active-publish-successor-dormant-recovery.mjs plan \
  --repository="$CANONICAL_REPOSITORY" \
  --worktree="$SOURCE_WORKTREE" \
  --branch="$SOURCE_BRANCH" \
  --operator-session="$AGENTIC_SESSION_ID" \
  --pull-request="$SOURCE_PULL_REQUEST" \
  --manifest="$EXTERNAL_MANIFEST" \
  --journal="$EXTERNAL_STATE" \
  --output="$EXTERNAL_PLAN"

node scripts/active-publish-successor-dormant-recovery.mjs run \
  --repository="$CANONICAL_REPOSITORY" \
  --worktree="$SOURCE_WORKTREE" \
  --branch="$SOURCE_BRANCH" \
  --operator-session="$AGENTIC_SESSION_ID" \
  --pull-request="$SOURCE_PULL_REQUEST" \
  --manifest="$EXTERNAL_MANIFEST" \
  --journal="$EXTERNAL_STATE" \
  --plan="$EXTERNAL_PLAN" \
  --task-authority="$EXTERNAL_TASK_CAPABILITY" \
  --authorization='authorize active-publish-successor-dormant-recovery <plan-digest>'
```

The terminal receipt names the unchanged successor claim and review, the
recovered cloud authority, writer-lease and hidden-marker receipts, terminal
verification, and the closed mutation set. It explicitly denies Git, source,
new-claim, new-review, integration, cleanup, publication, and deployment
effects. Ordinary protected review and integration remain separate operations.
