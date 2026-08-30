---
title: "Active Owned Dirt Current-Base Reanchor"
graphId: "md:agentic-active-owned-dirt-current-base-reanchor"
doc_type: "Runtime Contract"
date: "2026-08-30"
lang: "en-US"
schema: "agentic-active-owned-dirt-current-base-reanchor/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact-authorized deterministic current-base reanchor for one active admitted dirty lane"
runtime_scope: "read-only planning, current task-capability proof, immutable dirt snapshot, deterministic protected-base coordination, remote ref reanchor, cloud successor transition, local authority CAS, pull-request projection, private replay journal, and terminal verification"
runtime_claim: "preserves the exact staged, unstaged, deleted, and untracked source overlay while advancing one disjoint lane to the current protected base"
runtime_owner: "../scripts/active-owned-dirt-current-base-reanchor-contract.mjs; ../scripts/active-owned-dirt-current-base-reanchor-controller.mjs; ../scripts/active-owned-dirt-current-base-reanchor-repository-adapter.mjs; ../scripts/active-owned-dirt-current-base-reanchor.mjs"
runtime_proof: "../__tests__/active-owned-dirt-current-base-reanchor.test.mjs"
publish_policy: "Dev authoring-authority maintenance only; authored-content review, protected integration, Production release, deployment, and cleanup remain separately gated"
---
<!-- Responsibility: Define the exact active-owned-dirt current-protected-base reanchor boundary. -->

# Active owned dirt current-base reanchor

## Purpose

This controller advances one still-owned dirty task lane from its historical
canonical base to the exact current protected-main revision. The source local
lease is `active` and `admitted`, its cloud claim is the exact current active
claim, its task capability remains available, and its attached registered
worktree contains only in-scope staged, unstaged, deleted, or untracked work.
The lane has not been abandoned, handed off, reviewed, merged, or cleaned.

The operation is deliberately narrower than a merge or conflict resolver. It
is available only when every path changed on protected main since the source
base is disjoint from the lane's unchanged declared write scope. It creates a
content-neutral coordination commit whose tree is current protected main,
then reapplies the already-owned index and worktree overlay exactly. The lane
therefore receives current untouched content without turning dirty work into
an authored commit.

## Sealed topology and projection

The plan fixes one meaning for each revision and tree:

| Symbol | Sealed meaning |
|---|---|
| \(B\) | Historical canonical base in the source local lease, cloud claim, review, and task lane. |
| \(F\) | Exact source fence and lane head: an empty coordination commit with sole parent \(B\) and tree equal to `tree(B)`. |
| \(P\) | Exact current protected revision; protected observations agree and \(B\) is its strict ancestor. |
| \(I_1\) | Complete source index tree, including absence, object identity, type, and mode. |
| \(W_1\) | Complete source worktree tree, including tracked deletions and untracked entries. |
| \(C\) | Deterministic reanchor coordination commit with parents `[F, P]` and tree `tree(P)`. |
| \(I_2\) | Exact post-reanchor index overlay on \(C\). |
| \(W_2\) | Exact post-reanchor worktree overlay on \(C\). |

Read-only planning joins the registered worktree, local branch, remote branch,
pull request, local lease, current cloud claim, task-authority binding, and Git
state at \(F\). It proves the fence is empty over \(B\), captures the complete
`B..P` protected path inventory, and requires every changed protected path to
be disjoint from the full admitted path write set. Parent and child scopes
overlap for this test. The manifest and write-set digests remain unchanged,
and all source dirt is sealed separately. Out-of-scope dirt, an unmerged index,
unsupported entry types, protected/admitted-scope overlap, a non-empty fence,
a non-descendant protected head, missing or ambiguous cloud authority, or any
identity disagreement fails closed.

For every repository path \(p\), entry equality includes absence, mode, object
type, and blob identity. The reanchor projection is:

```text
I2(p) = I1(p), when I1(p) differs from B(p); otherwise P(p)
W2(p) = W1(p), when W1(p) differs from B(p); otherwise P(p)

tree(C)    = tree(P)
parents(C) = [F, P]
```

A staged edit remains staged, an unstaged edit remains unstaged, a deletion
remains absent, and an untracked entry remains untracked. Every other path
advances to \(P\). The disjointness proof means the controller never chooses
between a protected edit and a source edit and never creates conflict stages.

## Read-only plan and exact authorization

Planning captures the full evidence twice and requires the observations to
agree. It does not create a Git object, ref, snapshot, journal, lock, claim, or
provider mutation. The CLI's only planning write is a new owner-only mode-`0600`
plan at a caller-selected path outside every repository worktree and Git
directory. The journal path is also external and private, but the repository
adapter alone validates, locks, creates, and compare-and-swap updates it.

```sh
node scripts/active-owned-dirt-current-base-reanchor.mjs plan \
  --repository=<absolute-dirty-worktree> \
  --session=<exact-source-session> \
  --task-authority=<absolute-external-current-capability> \
  --journal=<absolute-external-private-journal> \
  --output=<absolute-external-private-plan> \
  --ttl-seconds=1800 \
  --json
```

The normalized plan binds the source base, fence, claim, local lease, dirt,
manifest, write set, protected target, coordination commit, successor cloud
epoch, provider projection, task continuation, controller witness, expiry, and
every permitted effect. Execution requires this byte-exact statement:

```text
authorize active-owned-dirt-current-base-reanchor <planDigest>
```

No authorization for another recovery operation, broad instruction, earlier
plan digest, or whitespace variant substitutes for it.

```sh
node scripts/active-owned-dirt-current-base-reanchor.mjs run \
  --repository=<absolute-dirty-worktree> \
  --session=<exact-source-session> \
  --task-authority=<absolute-external-current-capability> \
  --journal=<absolute-external-private-journal> \
  --plan=<absolute-external-private-plan> \
  --authorization='authorize active-owned-dirt-current-base-reanchor <planDigest>' \
  --json
```

Plans expire at the earliest of their sealed TTL, source local-lease expiry,
and source cloud-claim expiry. The requested TTL defaults to 1,800 seconds and
may be set from 60 through 86,400 seconds. Execution re-observes all mutable
evidence and rejects expired or drifted plans before reserving the successor.
The reservation itself is not write authority. The controller retires the
exact source and promotes the exact reserved successor before any Git ref
effect. A later new effect requires that same successor to be current, live,
and operation-derived; an expired same-claim successor is recovered and its
original review binding is reauthenticated before work continues.

## Authorized effect sequence and replay

After validating the plan and exact authorization, the controller advances
one private journal through digest-bound compare-and-swap phases:

1. prove possession of the currently bound task capability;
2. snapshot \(F/I_1/W_1\) into an immutable, structurally reachable recovery artifact;
3. prepare the exact coordination commit \(C\) and target overlays \(I_2/W_2\);
4. reserve the exact same-scope successor in `waiting-successor` at canonical
   base \(P\) and lane revision \(C\), using the full authenticated ledger
   history to seal its collision-free cloud epoch before any Git ref changes;
5. retire the exact source claim through the sealed successor transition;
6. promote that successor to live `current` write authority;
7. move the local task ref, `HEAD`, index, and worktree to \(C/I_2/W_2\);
8. compare-and-swap the remote task ref from \(F\) to \(C\), then bind the
   successor active to the same exact draft review;
9. compare-and-swap the local lease and task continuation to the sealed successor authority;
10. project the pull-request base and replace only its hidden writer marker
    through an exact provider ETag/`If-Match` conditional update;
11. verify the snapshot, ancestry, overlays, refs, review, cloud authority, local authority, and marker; and
12. persist the terminal `authoring-authority-reanchored` receipt.

The plan seals stable operation keys and target digests for every effect.
Response-loss replay adopts only an already-observed exact target state. It
does not synthesize a different commit, repeat a non-idempotent transition,
overwrite foreign journal state, or widen the plan. The source task capability
must be authorized before the first snapshot or reanchor mutation. Already
applied local or remote Git targets may be adopted without repeating their
effects. Before any new Git, local-registry, pull-request, or verification
effect, the same successor is recovered if necessary, rebound to the original
review, and remotely verified. The local registry file and its parent directory
are durably synchronized before the later journal checkpoint.

The durable replay boundary is a completed Git child effect (including loss of
its response), not arbitrary process death while Git owns its index lock. A
lock-free partial checkout is recoverable only when every sealed disposition,
the ignored-path retention proof, and the protected target all match a
recognized source-or-target state. The controller never removes or assumes
ownership of `.git/index.lock`; an unresolved Git lock or any unrecognized
partial state fails closed for repository-owned lock adjudication.

## Completion and non-authority

Completion means the active lane now has mutation authority at \(P/C\), its
remote and provider projections agree, and every source-authored index and
worktree entry remains exact. The lane is intentionally still dirty. The
coordination commit contains `tree(P)` and therefore no authored content.

The controller does not author a content commit, resolve semantic conflicts,
mark the review ready, approve or merge the pull request, mutate protected
main, publish Production content, deploy, clean dirt, delete the recovery
snapshot, remove the worktree, or delete a branch. Ordinary authoring and
`device:review`, protected integration, release authorization, deployment, and
exact cleanup retain their existing gates.

## Why neighboring routes do not apply

| Route | Why it does not own this topology |
|---|---|
| `retired-abandoned-owned-dirt-successor-recovery` | Its cloud owner is terminally retired as `abandoned`; this source owner and capability are still current. |
| `terminal-handoff-owned-dirt-successor-recovery` | It recovers a terminal `handoff`; this operation keeps the same live task continuation. |
| `planned-owned-dirt-scope-expansion-recovery` | It requires a locally `planned` lane and a strict scope expansion; this lane is admitted and its manifest is unchanged. |
| ordinary resume or heartbeat | They may refresh projections but cannot replace the canonical base, coordination fence, cloud authority, review base, and dirty checkout atomically. |

## Focused verification

```sh
node --test __tests__/active-owned-dirt-current-base-reanchor.test.mjs
```

The focused proof covers the exact topology and authorization, double-read
planning, private external plan and journal boundaries, deterministic commit
and overlay construction, staged/unstaged/deleted/untracked preservation,
protected-path disjointness, local and remote compare-and-swap behavior, cloud
successor and task-continuation projection, pull-request base and marker
replacement, journal replay, drift rejection, and the absence of authored
commit, review, merge, deployment, or cleanup authority.
