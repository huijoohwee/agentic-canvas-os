---
title: "Open reviewed lane rehydration"
graphId: "md:open-reviewed-lane-rehydration"
doc_type: "Lifecycle Capability"
date: "2026-08-11"
lang: "en-US"
schema: "agentic-open-reviewed-lane-rehydration-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/open-reviewed-lane-rehydration.mjs"
runtime_proof: "../__tests__/open-reviewed-lane-rehydration.test.mjs"
---

# Open reviewed lane rehydration

This controller restores only the missing local projection of one exact open, reviewed,
cloud-backed lane. Its provider-neutral contract joins opaque actor, repository, and review
identities from producer-emittable public claim fields. A provider adapter derives those opaque
identities and supplies read-only Git, review, cloud-status, and writer-registry observations.

It requires an authenticated same-repository owner, an open non-draft pull request with no
auto-merge request or merge-queue entry, its exact valid `review_ready` writer marker, one
integrated then dormant scope-reserving cloud claim, an exact remote head and bounded
protected-main refresh chain, and clean current
canonical `main`. The local branch, target worktree, and writer lease must all be absent. The
target must be an absent safe direct child of the Git-common-dir-derived managed worktree root;
symlinks, files, existing directories, branch/worktree owners, or lease collisions block.

Planning is read-only:

```sh
node scripts/open-reviewed-lane-rehydration.mjs plan \
  --repository=/absolute/canonical/repository \
  --worktree=/absolute/managed/task-worktree \
  --pull-request=344 > /outside/repository/rehydration-plan.json
```

After inspecting the plan, run its exact authorization:

```sh
node scripts/open-reviewed-lane-rehydration.mjs run \
  --repository=/absolute/canonical/repository \
  --worktree=/absolute/managed/task-worktree \
  --pull-request=344 \
  --plan-file=/outside/repository/rehydration-plan.json \
  --authorize='authorize open-reviewed-lane-rehydration <planDigest>'
```

The plan file is the persisted authorization input for bounded response-loss replay; run never
widens it by replanning after local effects exist. Before local mutation, run writes a digest-bound `0600`
journal below the Git common directory and revalidates the complete plan under the writer-registry
lock. It creates the exact local ref with a zero-old-object compare-and-swap and registers the
clean attached worktree without force. The reference adapter then performs an absent-branch and
absent-target writer-registry CAS under that registry's lock, inserting the marker-identical
`review_ready` lease while preserving every peer entry. A durable sidecar binds the actual full
registry revisions and digests: `prepared` is written before replacement and `committed` only
after the exact replacement is re-read. A prepared-only sidecar is never adoption evidence. The authorized plan binds
only canonical identity plus the target branch/path registration and lease slices, so unrelated
peer heartbeats or worktree registrations do not strand replay.
Final provider, cloud, branch, worktree, and target-lease evidence is re-read while the one writer
registry lock remains held through insertion; a cooperative substrate change therefore blocks
before any lease is written. Operation locks are never auto-taken-over or path-unlinked. This
controller intentionally provides no abandoned-lock recovery command: a hard process loss that
leaves either operation or writer-registry lock fails closed for manual evidence review, and the
journal cannot be replayed in a new process until a separately supported owner workflow disposes
that lock. Automatic replay covers synchronous response loss only after committed CAS provenance
and the applicable durable phase or receipt; prepared-only provenance fails closed for manual review.
Journal, sidecar, lock, registry, and target creation checks use path-based `lstat`-then-use under
cooperative operation and registry serialization. Observed symlinks or drift fail closed; hostile
same-user directory-entry replacement after a final path check is outside this guarantee.

Each effect has a typed durable attempt and receipt. Full provider, remote, cloud, canonical, and
local evidence is re-read before lease insertion, after it, and on completed replay. Rollback is
available only before lease insertion and runs under the shared writer-registry lock. It removes
only an operation-attributed exact clean worktree and exact ref, after proving canonical identity
and the exact target/branch registration slice; target drift is retained for owner recovery. It never
prunes registrations or force-removes a worktree. The controller
does not reconcile a thrown synchronous Git create into ownership merely because an exact ref or
worktree appeared; only the command's successful return followed by its durable phase can authorize rollback.
The controller
does not fetch, push, edit or close a pull request, continue or retire a cloud claim, enable
auto-merge, integrate, deploy, or grant source-mutation authority. Its typed receipt reports only
local branch, registered-worktree, and writer-lease projection effects. After rehydration, an
owner may separately arm the exact SQUASH candidate immediately before the reviewed-forward-child
controller; auto-merge is deliberately not armed while the local substrate is absent.
