---
title: "Retired Abandoned Owned Dirt Successor Recovery"
graphId: "md:agentic-retired-abandoned-owned-dirt-successor-recovery"
doc_type: "Runtime Contract"
date: "2026-08-25"
lang: "en-US"
schema: "agentic-retired-abandoned-owned-dirt-successor-recovery/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "receipt-bound deterministic current-base reanchor for one admitted dirty lane whose exact cloud owner is terminally retired as abandoned"
runtime_scope: "read-only planning, source proof, structurally reachable snapshot, deterministic protected-base overlay, coordination merge and push, pull-request reopen, fresh claim and binding, local authority CAS, marker projection, and terminal verification"
runtime_claim: "preserves every source-authored entry while advancing untouched paths to current protected main and restoring scoped Dev mutation authority"
runtime_owner: "../scripts/retired-abandoned-owned-dirt-successor-recovery-contract.mjs; ../scripts/retired-abandoned-owned-dirt-successor-recovery-controller.mjs; ../scripts/retired-abandoned-owned-dirt-successor-recovery-evidence.mjs; ../scripts/retired-abandoned-owned-dirt-successor-recovery-repository-adapter.mjs; ../scripts/retired-abandoned-owned-dirt-successor-recovery.mjs"
runtime_proof: "../__tests__/retired-abandoned-owned-dirt-successor-recovery.test.mjs"
publish_policy: "Dev-only authority recovery; authored-content review, pull-request merge, Production release, deployment, and cleanup remain separately gated"
---
<!-- Responsibility: Define the exact abandoned-terminal dirty-lane current-base recovery boundary. -->

# Retired abandoned owned dirt successor recovery

## Purpose

This controller recovers one registered task lane whose locally `active`,
`admitted` owner still has staged, unstaged, deleted, or untracked work, while
the matching cloud claim is terminally `retired` as `abandoned` and its exact
draft pull request is closed and unmerged.

The controller does not leave that lane on its historical base. After proving
the source capability and snapshotting the complete source state, it
deterministically reanchors the lane onto the exact current protected revision.
It preserves every entry the source changed from its old base, imports the
protected entry everywhere else, records a content-neutral coordination merge,
pushes that reanchor, reopens the same draft review, and establishes fresh
generation-advanced authority.

## Sealed revisions and states

The plan assigns one meaning to each symbol:

| Symbol | Sealed meaning |
|---|---|
| \(B\) | Historical canonical base recorded by the source lease and claim. |
| \(F\) | Source fence and current task-branch head: one empty coordination commit whose sole parent is \(B\) and whose tree equals \(B\)'s tree. |
| \(P\) | Exact current protected-main revision; local `main`, local `origin/main`, authenticated remote `main`, and the controller's protected observation agree on it, and \(B\) is a strict ancestor of \(P\). |
| \(I_1\) | Exact pre-recovery index tree. |
| \(W_1\) | Exact pre-recovery worktree tree, including untracked entries. |
| \(I_2\) | Deterministic post-reanchor index overlay. |
| \(W_2\) | Deterministic post-reanchor worktree overlay. |
| \(C\) | Deterministic coordination merge with tree \(P\) and ordered parents \(F, P\). |
| \(C_2\) | Fresh no-predecessor cloud claim bound to canonical base \(P\), lane revision \(C\), and the reopened review. |

Read-only planning must additionally join all of the following:

- one attached, registered task worktree whose `HEAD`, local task ref, remote
  task ref, closed draft review head, lease fence, and cloud lane revision all
  equal \(F\);
- one local `agentic-writer-lease/v2` lease whose status is `active` and whose
  admission is exactly `admitted`;
- exact entry type, mode, blob, deletion, and untracked evidence for \(I_1\)
  and \(W_1\), fully covered by the target write set;
- one raw-ledger chain whose unique source is `current` and whose exact terminal
  transition is `retired` for reason `abandoned`;
- no live source claim, no already-created successor or recovery claim, and no
  live reservation overlapping the target write set;
- the same closed, unmerged draft review at base \(B\) and head \(F\), with its
  exact writer marker, unchanged non-marker body, and disabled auto-merge;
- a target manifest for the same semantic scope whose normalized write set is
  a strict superset of the source write set and covers every authored path;
- possession of the source task capability at its currently bound generation
  \(g\); and
- a target task capability using the same proof adapter, a distinct authority
  subject, and exactly generation \(g+1\).

Both capability files and the target manifest remain external owner-only
inputs. The controller witness, all Git identities, the complete protected
change set, and the exact same-path protected/source overlap set are sealed into
the plan. Any non-empty fence, non-descendant protected revision, ambiguous
claim history, live overlap, review drift, source state drift, missing
capability, reused subject, skipped generation, or controller drift fails
closed.

The cloud epoch for \(C_2\) is derived from the authenticated ledger under the
fresh-claim contract. It is not copied from the retired claim and is not
hard-coded by this workflow. \(C_2\) names no predecessor.

## Read-only plan and exact authorization

Planning captures the complete evidence twice and requires identical digests.
It creates no recovery directory, lock, journal, snapshot, Git object or ref,
commit, checkout mutation, provider update, or cloud transition. The CLI writes
only the returned plan to the caller-selected external mode-`0600` output.

```sh
node scripts/retired-abandoned-owned-dirt-successor-recovery.mjs plan \
  --repository=<absolute-dirty-worktree> \
  --operator-session=<distinct-successor-session> \
  --source-task-authority=<absolute-external-current-capability> \
  --target-task-authority=<absolute-external-next-generation-capability> \
  --target-manifest=<absolute-external-strict-superset-manifest> \
  --output=<absolute-external-private-plan>
```

The plan discloses and content-binds every allowed mutation: snapshot objects
and ref; coordination merge \(C\); local `HEAD`, index, worktree, and task-ref
transition to \(C/I_2/W_2\); remote task-ref compare-and-swap \(F\rightarrow C\);
review reopen at \(P/C\); fresh claim \(C_2\); local authority rotation; and
writer-marker replacement. Execution requires a fresh plan for the
exact-current evidence and its byte-exact `exactAuthorization`:

```text
authorize retired-abandoned-owned-dirt-successor-recovery <planDigest>
```

No earlier approval, digest from another plan, broad recovery instruction, or
authorization for a neighboring controller substitutes for this statement.

```sh
node scripts/retired-abandoned-owned-dirt-successor-recovery.mjs run \
  --repository=<absolute-dirty-worktree> \
  --operator-session=<distinct-successor-session> \
  --source-task-authority=<absolute-external-current-capability> \
  --target-task-authority=<absolute-external-next-generation-capability> \
  --target-manifest=<absolute-external-strict-superset-manifest> \
  --plan=<absolute-external-private-plan> \
  --authorization='authorize retired-abandoned-owned-dirt-successor-recovery <planDigest>'
```

## Source authorization and immutable snapshot

Authorized execution first proves possession of the currently bound source
capability and records that proof. No snapshot or reanchor effect may precede
source authorization.

The next phase creates a compact, immutable, structurally reachable snapshot of
\(F/I_1/W_1\). Its named recovery ref reaches the source fence, index snapshot,
worktree snapshot, and canonical full-evidence blob through a bounded commit
graph. The snapshot verifies every entry and digest while leaving the live
checkout at \(F/I_1/W_1\). This representation scales independently of commit
message limits and remains the recovery handle for response-loss replay.

## Deterministic current-base overlay

Index and worktree states are overlaid independently. For every path \(p\),
entry equality includes absence, object type, mode, and blob identity:

```text
I2(p) = I1(p), when I1(p) differs from B(p); otherwise P(p)
W2(p) = W1(p), when W1(p) differs from B(p); otherwise P(p)
```

A deletion is an absent source entry and therefore remains deleted. An
untracked path is absent from \(B\), so its \(W_1\) entry remains present.
Regular-file, executable-bit, and symlink distinctions remain exact. Gitlinks
and unsupported live worktree entry types fail closed. Paths untouched by the
source advance to \(P\).

When both protected main and the source changed the same path from \(B\), the
source entry wins in the corresponding \(I_2\) or \(W_2\) state. That path
remains ordinary staged or unstaged dirty work relative to \(C\)'s \(P\) tree.
The controller creates no stage-1/2/3 conflict entries and performs no semantic
conflict resolution. The sealed overlap list remains follow-on work.

The coordination merge is deterministic:

```text
tree(C)    = tree(P)
parents(C) = [F, P]
```

Because \(C\)'s tree is exactly \(P\)'s tree, it contains no authored-content
change. Its second parent makes \(P\) an ancestor of \(C\), while \(I_2/W_2\)
retain the source-authored state as ordinary dirt on that current baseline.

## Authorized effect sequence

After source authorization and the verified snapshot, the controller:

1. creates the exact coordination merge \(C\);
2. changes the local task branch, `HEAD`, index, and worktree exactly from
   \(F/I_1/W_1\) to \(C/I_2/W_2\);
3. compare-and-swap pushes the remote task ref from \(F\) to \(C\);
4. reopens the same draft pull request and verifies exact base \(P\), head
   \(C\), unchanged non-marker body, and disabled auto-merge;
5. derives the fresh ledger epoch and creates \(C_2\) with canonical base
   \(P\), lane revision \(C\), the strict-superset write set, and no predecessor;
6. binds \(C_2\) to the reopened review;
7. proves the distinct generation-advanced target capability and compare-and-swap
   replaces the sealed local lease, admission, cloud projection, session, and
   task-authority binding at the new base and fence;
8. replaces only the hidden writer-lease marker in the pull request; and
9. verifies the snapshot, \(P\)-ancestry, \(C/I_2/W_2\), remote ref, draft
   review, cloud authority, local mutation authority, marker, authored-entry
   preservation, and unresolved-overlap classification.

Stable operation keys and a private journal make each authorized phase
idempotent. Response-loss reconciliation adopts only the exact sealed target
state; it never improvises another merge, ref update, claim, or overlay.

## Completion and non-authority

Completion is `mutation-authority-restored`. It proves that \(P\) is an ancestor
of \(C\), every source-authored \(I_1/W_1\) entry was preserved in \(I_2/W_2\),
and untouched paths now match \(P\). The checkout as a whole did change:
`HEAD`, index, worktree, local task ref, remote task ref, review base/head, and
authority projections now have their disclosed recovery targets.

Same-path protected/source overlaps remain ordinary dirty work and still
require deliberate resolution under the restored authority. Recovery neither
claims that those changes are integrated nor makes the pull request ready.

The controller creates the content-neutral coordination merge \(C\), but no
authored-content commit. It does not merge the pull request, mutate protected
main, publish Production content, deploy, clean source dirt, remove the
worktree, delete a branch or snapshot ref, or authorize any of those actions.
Ordinary authoring, overlap resolution, clean `device:review`, protected
integration, runtime proof, Production authorization, deployment, and exact
cleanup retain their canonical gates.

## Why neighboring recovery routes do not apply

| Route | Why it does not own this topology |
|---|---|
| `terminal-handoff-owned-dirt-successor-recovery` | It requires terminal reason `handoff`, not `abandoned`, and does not own this current-protected-base reanchor. |
| `planned-owned-dirt-scope-expansion-recovery` | It requires a locally `planned` lane, live or scope-reserving predecessor, open draft review, and unchanged fence. |
| `closed-absent-planned-owner-release` | It requires the worktree and branches to be absent and releases only residual planned authority; this source is present, admitted, and dirty. |

Ordinary resume, heartbeat, and active-owned-dirt reclaim require a live
recoverable source claim or another nonterminal topology. None can reinterpret
terminal abandonment or perform this bounded reanchor.

## Focused verification

```sh
node --test \
  __tests__/retired-abandoned-owned-dirt-successor-recovery.test.mjs
```

The focused proof covers the evidence and authorization contracts, the empty
\(F/B\) fence, current protected \(P\), source authorization before effects,
fresh no-predecessor ledger-epoch derivation, scalable snapshot reachability,
deterministic \(C\), and exact local \(I_2/W_2\) projection across protected
adds/deletes, staged and unstaged edits, untracked files, executable files,
symlinks, ignored state, and same-path overlap without unmerged entries. It
also proves planning leaves Git objects, refs, index, worktree, and recovery
state unchanged; authorized materialization and local convergence are exact;
foreign local drift fails before ref movement; CLI artifacts remain external
and private; invalid authorization creates no state; and the controller orders
and replays the remote, review, cloud, registry, marker, and terminal adapter
phases without widening their interfaces.

The focused suite does not simulate live GitHub or cloud-provider transport.
Exact remote force-with-lease, review mutation, cloud claim/bind, local registry
CAS, marker projection, and terminal provider readback remain subject to their
adapter checks and the separately gated governed recovery execution.
