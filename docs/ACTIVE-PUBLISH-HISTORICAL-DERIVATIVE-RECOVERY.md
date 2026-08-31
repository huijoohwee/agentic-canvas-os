---
title: "Active-publish Historical-derivative Recovery"
graphId: "md:active-publish-historical-derivative-recovery"
doc_type: "Recovery Controller Contract"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-active-publish-historical-derivative-recovery-doc/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "task-bound exact historical-derivative adoption"
runtime_scope: "one prepared v1 active-publish intent and its already-created derivative"
runtime_claim: "adopts only the exact existing derivative without source, Git, claim-creation, review-creation, integration, merge, deployment, or cleanup effects"
runtime_owner: "../scripts/active-publish-historical-derivative-recovery.mjs"
runtime_proof: "../__tests__/active-publish-historical-derivative-recovery.test.mjs"
provider_policy: "provider operations isolated behind injected adapters"
model_policy: "model, agent, client, and provider neutral"
publish_policy: "Dev-only; ordinary protected integration and release remain separate authorized operations"
---

# Active-publish historical-derivative recovery

This controller closes one narrow response-loss state. A clean active lane
durably recorded a prepared v1 `activePublishSuccessorIntent`, and its cloud
publication created the exact derivative requested by that intent. Before the
derivative was projected into the writer registry and hidden pull-request
marker, protected `main` advanced again. The ordinary active-publish rollover
correctly refuses to skip across that historical-base derivative.

Recovery adopts that already-created derivative at its intent-sealed
historical base and unchanged lane head. If it remains current, cloud state is
read only. If it expired to `dormant-preserved`, the controller performs one
authenticated, idempotent same-claim continuation before adoption. It then
continues the existing task authority, compare-and-swap projects the exact
target writer lease, clears only the consumed intent, adds the typed recovery
receipt, and replaces only the hidden writer marker in the same draft review.

The resulting lane still targets the historical protected base. It gains no
right to integrate across the newer protected head. A later ordinary
`device:integrate` invocation must independently re-observe current `main`,
prove its changed paths disjoint from the admitted write set, and obtain all
normal review, integration, runtime, retirement, and cleanup receipts.

## Exact subject

Read-only planning joins all of these facts:

- a clean protected controller and clean, registered, attached source
  worktree with exact local and remote branch heads;
- the active source writer lease, admitted manifest, declared write set,
  private-task binding digest, and exact prepared v1 successor intent;
- the intent-sealed source claim, source base, target historical base, lane
  head, epoch, repository, work item, actor, device, session, scope, draft
  review identity, and provider marker;
- exactly one cloud derivative whose predecessor, base, head, epoch, operation
  receipt, transition, write set, owner, and review identity match the intent;
- a derivative state of either current writing authority or
  `dormant-preserved` with its overlap reservation retained;
- the live protected head as a strict descendant of the historical target
  base, with the complete intervening changed-path digest disjoint from the
  admitted write set; and
- the complete cloud inventory proving no overlapping competitor, ambiguous
  sibling, or downstream successor effect.

The source claim may be absent after successor publication. If present, it
must be the exact sealed predecessor in the only protocol state allowed by the
derivative transition. A similar claim is never adopted. Dirt, detached or
unregistered worktrees, head or tree drift, manifest drift, missing lineage,
a foreign transition, a changed provider review or visible body, auto-delivery
authority, protected-path overlap, an authored path outside admission,
ambiguous ancestry, a competing reservation, or any downstream effect fails
closed before mutation.

## Authorization and closed effects

Planning is read only and emits one plan-bound human statement:

```text
authorize active-publish-historical-derivative-recovery <plan-digest>
```

Run requires that byte-exact statement and the existing external task
capability. The capability proves the source task and authorizes only its
deterministic continuation to the intent-sealed target lease. Credential
material never enters the plan, journal, review body, receipt, or logs.

The allowed mutation set is closed:

1. for a dormant derivative only, one idempotent same-claim cloud continuation;
2. one deterministic task-authority continuation, sealed before registry CAS;
3. one writer-registry CAS from the exact source lease to the exact derivative
   projection, clearing the consumed intent and recording the typed receipt;
4. replacement of only the hidden writer marker in the same draft review; and
5. one private, digest-chained replay journal.

For a current derivative, item 1 is an explicit zero-effect adoption. The
operation never edits source or repository bytes, the index, tree, commits,
local or remote refs, the visible review body, or protected `main`. It never
creates or replaces a claim, branch, worktree, pull request, or review; never
integrates, reviews, merges, publishes, releases, deploys, retires a broader
lane, or cleans a worktree; and grants no authoring or integration authority.

## Replay and failure isolation

The journal advances monotonically through:

```text
authorized
task_authority_verified
cloud_request_sealed
cloud_recovered
registry_projection_prepared
registry_projected
review_marker_projected
verified
complete
```

The optional same-claim request and its idempotency key are sealed before any
cloud call. Current adoption records a typed zero-effect receipt instead. The
registry preparation seals the continued binding, source lease digest, target
lease digest, and recovery receipt before CAS. The CAS accepts only the exact
source projection or its deterministic target. The review update accepts only
the sealed source marker or deterministic target marker and preserves the
visible body byte-for-byte. An already-exact target marker after response loss
retains `providerMutation:true`; replay cannot downgrade the closed effect.

Every external boundary revalidates the sealed subject immediately beside its
effect. A continuation receipt must bind the digest of the sealed request
idempotency key, and its returned N+1 claim must equal the post-effect status
readback, including state, transition, heartbeat, expiry, and ledger identity.
Response loss may adopt only that continuation, the exact registry target, or
the hidden marker target; it may not recalculate around drift. Replay resumes
only the unrecorded phase. Terminal verification recomputes and rejoins the
cloud recovery, task binding, registry projection, embedded recovery and
successor receipts, and the marker's review, source, target, and visible-body
digests against live state. It also rechecks the cleared intent, draft review,
protected ancestry, and unchanged repository projection. A `verified` replay
re-verifies before completion. A durable `complete` replay returns the
immutable completion without task, cloud, registry, provider, Git, or lifecycle
effects.

## CLI

Run the controller from an Agentic Canvas OS checkout. Keep the plan, private
capability, and journal outside every repository.

```sh
node scripts/active-publish-historical-derivative-recovery.mjs plan \
  --repository="$CANONICAL_REPOSITORY" \
  --worktree="$SOURCE_WORKTREE" \
  --branch="$SOURCE_BRANCH" \
  --operator-session="$AGENTIC_SESSION_ID" \
  --pull-request="$SOURCE_PULL_REQUEST" \
  --manifest="$EXTERNAL_MANIFEST" \
  --journal="$EXTERNAL_STATE" \
  --output="$EXTERNAL_PLAN" \
  --ttl-seconds=1800

node scripts/active-publish-historical-derivative-recovery.mjs run \
  --repository="$CANONICAL_REPOSITORY" \
  --worktree="$SOURCE_WORKTREE" \
  --branch="$SOURCE_BRANCH" \
  --operator-session="$AGENTIC_SESSION_ID" \
  --pull-request="$SOURCE_PULL_REQUEST" \
  --manifest="$EXTERNAL_MANIFEST" \
  --journal="$EXTERNAL_STATE" \
  --plan="$EXTERNAL_PLAN" \
  --task-authority="$EXTERNAL_TASK_CAPABILITY" \
  --authorization='authorize active-publish-historical-derivative-recovery <plan-digest>'
```

The Dev proof is focused-tested. It covers exact authorization, zero-cloud
current adoption, single same-claim dormant continuation, response-loss replay
at each external boundary, terminal replay, and fail-closed drift, lineage,
overlap, downstream, provider-marker, task-capability, and registry-CAS cases.
This status is not Production, protected integration, runtime, release,
deployment, claim-retirement, or cleanup evidence.
