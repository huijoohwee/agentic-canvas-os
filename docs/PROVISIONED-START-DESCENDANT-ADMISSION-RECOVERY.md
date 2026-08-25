---
title: "Provisioned-start descendant admission recovery"
graphId: "md:provisioned-start-descendant-admission-recovery"
doc_type: "Recovery Controller Contract"
date: "2026-08-25"
lang: "en-US"
schema: "agentic-provisioned-start-descendant-admission-recovery-doc/v1"
frontmatter_contract: "required"
status: "focused-tested"
runtime_owner: "../scripts/provisioned-start-descendant-admission-recovery.mjs"
runtime_proof: "../__tests__/provisioned-start-descendant-admission-recovery.test.mjs"
---

# Provisioned-start descendant admission recovery

This controller closes one interrupted root-source startup state. Provisioning
created the task worktree, transition-1 cloud claim, coordination fence, task
binding, and draft pull request, but stopped before cloud binding and final
admission. The exact task then produced a clean linear commit whose declared
paths are already exposed by both its remote branch and draft pull request.

Planning is read-only. It seals the active planned lease, task binding, source
claim, complete non-overlapping cloud inventory, coordination fence, authored
range, commit and tree identities, exact draft review head and body, protected
controller revision, and a mutation-closed boundary. The pull-request head must
equal the local authored descendant; a fence-only review belongs to the
ordinary provisioned-start recovery owner.

Run requires the exact returned statement:

```text
authorize provisioned-start-descendant-admission-recovery <planDigest>
```

The journaled effect order is:

1. verify the source task capability;
2. bind the exact transition-1 claim to the existing descendant and review;
3. atomically project the same planned lease to admitted with content-bound
   integration and preservation receipts;
4. replace only the deterministic writer marker in the existing draft review;
5. freshly verify cloud, registry, Git, and provider joins.

If time alone makes the source claim `dormant-preserved`, the cloud step may
first recover that same claim with a plan-derived recovery digest and then bind
it to the descendant. It cannot create a successor, widen scope, adopt another
owner, change the canonical base, or ignore overlap. Response loss is adopted
only when the live claim is already at the exact target revision and review.

The controller never edits source or index bytes, creates a commit, pushes or
moves a Git ref, changes draft state, merges, deploys, or cleans. Ordinary
`device:review`, protected integration, runtime proof, release, deployment, and
cleanup remain independent operations after its admitted receipt.

```sh
node scripts/provisioned-start-descendant-admission-recovery.mjs plan \
  --repository=/absolute/task-worktree \
  --session=<source-session> \
  --task-authority=/absolute/external-capability.json \
  --output=/absolute/external-plan.json --json

node scripts/provisioned-start-descendant-admission-recovery.mjs run \
  --repository=/absolute/task-worktree \
  --session=<source-session> \
  --task-authority=/absolute/external-capability.json \
  --plan-file=/absolute/external-plan.json \
  --authorize='authorize provisioned-start-descendant-admission-recovery <planDigest>' --json
```

Focused proof covers exact authorization, descendant-head ownership, scope
closure, target cloud identity, admitted projection, ordered effects, and
verification-only replay.
