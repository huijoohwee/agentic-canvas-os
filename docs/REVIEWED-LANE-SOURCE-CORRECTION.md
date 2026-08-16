---
title: "Reviewed Lane Source Correction"
graphId: "md:reviewed-lane-source-correction"
doc_type: "Lifecycle Capability"
date: "2026-08-10"
lang: "en-US"
schema: "agentic-reviewed-lane-source-correction-plan/v1"
frontmatter_contract: "required"
status: "source-ready"
authority: "Exact same-owner reviewed-to-authoring correction"
runtime_owner: "../scripts/reviewed-lane-source-correction.mjs; ../scripts/reviewed-lane-source-correction-controller.mjs; ../scripts/reviewed-lane-source-correction-repository-adapter.mjs"
runtime_proof: "../__tests__/reviewed-lane-source-correction.test.mjs"
---

# Reviewed Lane Source Correction

## Purpose

This controller reopens one exact reviewed lane for correction by its original
source session. It changes no source byte, commit, branch head, or remote ref.
It replaces the reviewed cloud claim with one same-owner current successor,
changes the existing pull request back to draft, and projects the matching
active writer lease. The source owner can then make a normal scoped correction
and return through `device:review`.

This operation does not merge, integrate, deploy, close a pull request, delete
a ref, remove a worktree, acquire another semantic scope, or grant the operator
session source-write authority.

## Source admission

Planning is read-only and requires all of the following:

- one registered, clean worktree attached to its exact agent branch;
- identical local, remote, pull-request, lease-review, cloud, and claim heads;
- an admitted `review_ready` local lease owned by the supplied source session;
- an exact reviewed or dormant-preserved cloud claim with the same actor,
  repository, work item, base, scope, device, session, and review request;
- either exact local/cloud review projection equality, or one integration
  response-loss split where the local lease and PR marker retain transition N
  while the private claim records `integrated-preserved` at N+1, its public
  projection is `integrated-preserved` or, after expiry, `dormant-preserved`,
  write authority is false, scope remains reserved, and the fence, integration
  candidate, review evidence, operation receipt, and integration receipt join
  exactly;
- the same integrated split may be wrapped by exactly one authenticated recovery
  transition at N+2 when its recovery evidence is present and the integration
  receipt remains unchanged; any additional or foreign progress is rejected;
- one completed same-claim reviewed recovery may instead leave the untouched PR
  marker at transition N while the local lease and provider claim are transition
  N+1. Admission requires the typed zero-effect local repair, reconstruction of
  the marker-bound predecessor lease digest, and the content-digested completed
  recovery journal whose terminal receipt names the same claim, local repair,
  cloud recovery, task proof, target lease, and registry revision;
- if a later source-correction successor task-binding reconciliation has already
  repaired that lane, the same-claim split proof is no longer reconstructed from
  the current marker. Admission accepts only the exact joined successor state:
  the PR marker and local lease name the same cloud claim, digest, transition,
  operation receipt, and task-authority binding, while the typed reconciliation
  receipt proves predecessor claim, successor claim, target binding, and zero
  cloud, PR, source, Git, merge, integration, and deployment effects;
- a separately fetched protected `main` head that is either the source base or
  a descendant whose intervening changed path scope is proven disjoint from the
  lane's admitted write set; the PR `baseRefOid` remains independently bound to
  the source base and is not treated as the current protected head;
- an open, non-draft, unqueued pull request with exactly one matching writer
  marker and no auto-merge request; and
- a distinct operator session and byte-exact authorization statement.

The public plan is path-portable. It contains neither the worktree path nor the
raw pull-request body. It binds stable repository identities, the body digest,
the `v2` source evidence and protected-advance receipts (including source, PR,
and current protected base), and a path-free writer-marker projection instead.
Planning creates no journal, lock, claim, lease, or provider mutation.
The controller reads the complete source evidence twice and requires an
identical evidence digest before emitting a plan.

## Commands

Plan from protected controller bytes:

```sh
node scripts/reviewed-lane-source-correction.mjs plan \
  --repository=/absolute/registered/source-worktree \
  --source-session=codex-source-owner \
  --operator-session=codex-correction-operator \
  --pull-request=344
```

The result includes `planDigest` and:

```text
authorize reviewed-lane-source-correction <planDigest>
```

Run only that exact plan:

```sh
node scripts/reviewed-lane-source-correction.mjs run \
  --repository=/absolute/registered/source-worktree \
  --source-session=codex-source-owner \
  --operator-session=codex-correction-operator \
  --pull-request=344 \
  --authorize='authorize reviewed-lane-source-correction <planDigest>'
```

## Durable transition

| Phase | Required effect or proof |
| --- | --- |
| `prepared` | Persist the exact path-free plan and authorization. |
| `successor_waiting` | Claim one same-owner, same-head successor at source cloud epoch + 1. |
| `source_retired` | Replay one idempotent retirement. An integrated predecessor uses reason `integrated` and its exact integration receipt, named-checks, and handoff evidence. |
| `successor_current` | Promote only after the predecessor is absent from live inventory. |
| `lease_activated` | Bind the promoted current successor to the unchanged PR identity through one projection continuation, then use the exact predecessor lease digest and claim ID to CAS-project it into the same source-session lease. |
| `pr_drafted` | Convert the unchanged pull request to draft and write exactly one active marker. |
| `verified` | Prove source bytes/head, remote, claim, lease, PR, and marker terminal equality. |
| `complete` | Seal the authoring-restored receipt without integration authority. |

Each phase reconciles live state before issuing an effect. The journal uses an
entrypoint lock and compare-and-swap writes. A lost retirement response replays
the same idempotency key instead of inferring success from absence; other lost
responses can adopt only the same plan-derived successor or projection. Source
retirement precedes successor promotion, so the operation never creates two
current writers.

Completed journals replay only when the caller presents the original exact
authorization. If the same branch later returns to a fresh reviewed source state
and the current read-only evidence produces a different plan, the controller may
supersede the completed journal only after validating the new exact
authorization inside the same fence. This prevents stale branch-keyed completion
from masking a later same-lane source-correction cycle while preserving terminal
replay for the original plan.

## Evidence boundary

Focused tests prove exact authorization, strict identity joins, path redaction,
phase ordering, response-ahead adoption, terminal replay, and zero effect on
invalid authority. They use injected provider effects and do not mutate a live
claim or pull request. A live `run` is required for any selected reviewed lane.
Even then, merge, protected integration, deployment, runtime, browser, and
physical-device proof remain separate gates.
