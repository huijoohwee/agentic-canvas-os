---
title: "Planned dirty admission recovery"
graphId: "md:planned-dirty-admission-recovery"
doc_type: "Recovery Controller Contract"
date: "2026-08-26"
lang: "en-US"
schema: "agentic-planned-dirty-admission-recovery-doc/v1"
frontmatter_contract: "required"
status: "focused-tested"
runtime_owner: "../scripts/planned-dirty-admission-recovery.mjs"
runtime_proof: "../__tests__/planned-dirty-admission-recovery.test.mjs"
---

# Planned dirty admission recovery

This controller closes one interrupted root-source startup state. Provisioning
created and cloud-bound the exact task worktree, empty coordination fence,
active planned writer lease, task capability, current claim, and draft review,
but stopped before the final preservation receipt and admitted projection. The
same task then produced nonempty in-scope dirt while local, remote, cloud, and
review heads remained at that fence.

The dirt is evidence, not permission to manufacture a commit or erase and
reapply bytes. Planning double-reads and content-binds the complete index,
working-tree, untracked, file-type, mode, conflict, and blob inventory. It also
binds the unchanged scope and manifest, task capability, lease and registry,
claim and stable cloud-authority subject, review identity and hidden marker,
protected controller revision, canonical ancestry, and non-overlapping peer
inventory. Clean lanes, committed descendants, expired or non-writing claims,
out-of-scope paths, conflicts, scope expansion, identity drift, or ambiguous
ownership fail closed and belong to other lifecycle owners.

Planning performs no mutation and returns the exact operator boundary:

```text
authorize planned-dirty-admission-recovery <planDigest>
```

Execution requires the sealed external plan, that byte-exact statement, and
the original external task capability. It revalidates the whole subject before
each effect and permits only:

1. a private replay journal under the Git common directory;
2. one compare-and-swap writer-registry projection from `planned` to
   `admitted`, retaining the exact claim, scope, manifest, owner, branch, base,
   fence, epochs, task binding, expiry, and dirt evidence; and
3. replacement of only the deterministic hidden writer marker in the same
   open draft review.

The admitted projection records a content-bound dirt preservation receipt and
fresh mutation-authority receipt. It does not create an integration record.
Ordinary `device:integrate` remains responsible for validation, commit
creation, publication, protected integration, and runtime reconciliation.

The controller never edits source or index bytes; creates a commit, branch,
claim, worktree, or review; moves local or remote refs; changes draft state or
auto-merge; performs a cloud transition; merges; deploys; releases; or cleans.
The registry and review effects accept only their exact sealed source or exact
deterministic target. A third state fails. Response-loss replay adopts an
already-completed exact effect, and a completed replay freshly verifies the
same stable terminal subject without repeating either mutation.

The marker write uses an immediate exact pre-read, deterministic projection,
and exact post-read of the whole review body; this controller does not claim an
atomic provider compare-and-swap. A provider edit in the final check-to-write
window cannot be excluded, so the owning task and review body must be quiescent.
Observed review edits or lease heartbeats are third states and are not treated
as successors by this controller. Planning also proves that the projected
admitted marker remains within the provider body-size limit before the registry
projection can occur.

```sh
node scripts/planned-dirty-admission-recovery.mjs plan \
  --repository=/absolute/task-worktree \
  --session=<source-session> \
  --output=/absolute/external-plan.json \
  --json

node scripts/planned-dirty-admission-recovery.mjs run \
  --repository=/absolute/task-worktree \
  --session=<source-session> \
  --task-authority=/absolute/external-capability.json \
  --plan-file=/absolute/external-plan.json \
  --authorize='authorize planned-dirty-admission-recovery <planDigest>' \
  --json
```

## Bootstrap exception record

The first version was authored on the isolated branch
`hotfix/planned-dirty-admission-recovery` from protected revision
`f9663ab045ee0331c2ec5548012e8959f67bd804`. Normal root-source admission could
not create its own repair lane because the exact planned dirty lane being
repaired was classified as an unattributed owner ambiguity. The operator
explicitly authorized the one-time phrase
`authorize protected bootstrap hotfix for planned-dirty admission recovery`.

That authorization covers only the isolated eight-file hotfix and ordinary
protected pull-request review. It does not authorize direct protected-main
mutation, hook or branch-protection bypass, force-push, claim or lease edits,
manual ledger or review-marker edits, merge bypass, cleanup, release, or
deployment. Future uses must use this controller's normal exact plan token.
