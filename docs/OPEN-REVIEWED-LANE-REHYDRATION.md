---
title: "Open reviewed lane rehydration"
graphId: "md:open-reviewed-lane-rehydration"
doc_type: "Lifecycle Capability"
date: "2026-08-14"
lang: "en-US"
schema: "agentic-open-reviewed-lane-rehydration-doc/v2"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/open-reviewed-lane-rehydration.mjs"
runtime_proof: "../__tests__/open-reviewed-lane-rehydration.test.mjs"
---

# Open reviewed lane rehydration

This controller restores only missing local projections of one exact open, reviewed,
cloud-backed lane. Its provider-neutral contract joins opaque actor, target-repository,
coordination-ledger, and review identities from producer-emittable public claim fields. A provider
adapter derives those opaque identities and supplies read-only Git, review, cloud-status, and
writer-registry observations. The target repository must equal the provider-observed review
subject. The independently validated ledger repository may be different and is passed unchanged
to the cloud-status boundary; ledger storage never becomes target-source identity.

It requires an authenticated same-repository owner, an open non-draft pull request with no
auto-merge request or merge-queue entry, its exact valid `review_ready` writer marker, one
integrated then dormant scope-reserving cloud claim, an exact remote head and bounded
protected-main refresh chain, and clean current canonical `main`. The target worktree must be
absent. Either the local branch and marker-identical writer lease are both absent, or both already
exist as exact preexisting projections while their recorded target worktree remains absent. A
branch-only, lease-only, mismatched, multiply owned, or registered-worktree state fails closed. The
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
widens it by replanning after local effects exist. Its local-projection mode binds the exact absent
or preexisting branch and lease slices. Before local mutation, run writes a digest-bound `0600`
journal below the Git common directory and revalidates the complete plan under the writer-registry
lock. In all-absent mode it creates the exact local ref with a zero-old-object compare-and-swap,
registers the clean attached worktree without force, then inserts the marker-identical
`review_ready` lease by writer-registry CAS while preserving every peer entry. In worktree-only
mode the exact branch and lease phases are recorded as adopted no-ops: run performs no ref write,
lease rewrite, or lease sidecar synthesis and creates only the missing registered worktree. The
all-absent CAS sidecar binds the actual full
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

Each phase has a typed durable attempt and receipt, including whether its projection was created
or adopted. The final mutation set contains only `registered-worktree` in worktree-only mode and
the three created local projections in all-absent mode. Full provider, remote, cloud, canonical, and
local evidence is re-read before lease insertion, after it, and on completed replay. Rollback is
available only before lease insertion and runs under the shared writer-registry lock. It removes
only an operation-attributed exact clean worktree and exact ref, after proving canonical identity
and the exact target/branch registration slice; target drift is retained for owner recovery. It never
prunes registrations or force-removes a worktree. The controller
does not reconcile a thrown synchronous Git create into ownership merely because an exact ref or
worktree appeared; only the command's successful return followed by its durable phase can authorize rollback.
Preexisting branch and lease projections are never rollback targets.
The controller
does not fetch, push, edit or close a pull request, continue or retire a cloud claim, enable
auto-merge, integrate, deploy, or grant source-mutation authority. Its typed receipt reports only
local branch, registered-worktree, and writer-lease projection effects. After rehydration, an
owner may separately arm the exact SQUASH candidate immediately before the reviewed-forward-child
controller; auto-merge is deliberately not armed while the local substrate is absent.
