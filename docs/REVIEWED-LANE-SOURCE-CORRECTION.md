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
- either the original protected base or a descendant whose intervening changed
  path scope is proven disjoint from the lane's admitted write set;
- an open, non-draft, unqueued pull request with exactly one matching writer
  marker; and
- a distinct operator session and byte-exact authorization statement.

The public plan is path-portable. It contains neither the worktree path nor the
raw pull-request body. It binds stable repository identities, the body digest,
the protected-base advance receipt, and a path-free writer-marker projection
instead. Planning creates no journal, lock, claim, lease, or provider mutation.

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
| `source_retired` | Retire the reviewed predecessor with exact head, review, byte, and handoff evidence. |
| `successor_current` | Promote only after the predecessor is absent from live inventory. |
| `lease_activated` | Use the exact predecessor lease digest and claim ID to CAS-project the unbound current authority into the same source-session lease. |
| `pr_drafted` | Convert the unchanged pull request to draft and write exactly one active marker. |
| `verified` | Prove source bytes/head, remote, claim, lease, PR, and marker terminal equality. |
| `complete` | Seal the authoring-restored receipt without integration authority. |

Each phase reconciles live state before issuing an effect. The journal uses an
entrypoint lock and compare-and-swap writes. A lost response can adopt only the
same plan-derived successor or projection. Source retirement precedes successor
promotion, so the operation never creates two current writers.

## Evidence boundary

Focused tests prove exact authorization, strict identity joins, path redaction,
phase ordering, response-ahead adoption, terminal replay, and zero effect on
invalid authority. They use injected provider effects and do not mutate a live
claim or pull request. A live `run` is required for any selected reviewed lane.
Even then, merge, protected integration, deployment, runtime, browser, and
physical-device proof remain separate gates.
