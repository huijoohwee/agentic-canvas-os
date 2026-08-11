---
title: "Delivery-authorized base recovery"
graphId: "md:delivery-authorized-base-recovery"
doc_type: "Lifecycle Capability"
date: "2026-08-11"
lang: "en-US"
schema: "agentic-delivery-authorized-base-recovery/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/delivery-authorized-base-recovery.mjs"
runtime_proof: "../__tests__/delivery-authorized-base-recovery.test.mjs"
---

# Delivery-authorized base recovery

This controller repairs one narrow projection failure: an open, ready pull request and its
cloud claim are already bound to current protected `main`, while the exact owner writer
lease still names an older base. The source lease may be `active` or may retain the exact
`delivery` projection from an interrupted terminal integration. It is provider-neutral at
the contract boundary; the repository adapter binds that contract to Git, GitHub, and the
configured collaboration ledger.

The controller never edits source bytes, creates commits, force-pushes, merges, cleans a
worktree, or deploys. It fails closed unless the lane is clean, all local/remote/provider
heads match, both bases are ancestors of the exact head, the delivery diff stays inside
the admitted write set, the ready pull request has no auto-merge request, and the current
cloud projection is `delivery_authorized`, while the exact live claim has naturally become
`dormant-preserved`, remains scope-reserved, and has no write authority.

The immutable delivered head may be followed only by a bounded, tree-equivalent chain of
protected-main refresh merges. The repository evidence adapter verifies every merge and
requires the final refresh main parent to equal the provider's current pull-request base.
The successor claim is based on that provider base and exact refreshed head; the predecessor
claim's canonical base and delivered head remain immutable evidence rather than being
rewritten into the new projection.

Protected `main` may advance after the bound delivery base only when that base remains its
ancestor and every intervening protected path is disjoint from the lane's admitted write set.
The successor deliberately retains the immutable delivery base; refreshing the candidate onto
newer protected `main` remains a later authoring-stage operation.

## Plan

Run the planner from the exact registered owner worktree:

```sh
node scripts/delivery-authorized-base-recovery.mjs plan \
  --repository=/absolute/path/to/owner-worktree \
  --session=exact-owner-session
```

A valid plan returns `status: "planned"` and exactly one authorization statement:

```text
authorize delivery-authorized-base-recovery <planDigest>
```

Any relevant state drift changes the digest or blocks planning. Planning is read-only
apart from explicit remote-ref refreshes.

## Execute

After a human supplies the exact statement, run:

```sh
node scripts/delivery-authorized-base-recovery.mjs run \
  --repository=/absolute/path/to/owner-worktree \
  --session=exact-owner-session \
  --authorize='authorize delivery-authorized-base-recovery <planDigest>'
```

Execution uses a repository-local lock and append-style intent projection. Each effect is
reconciled before it is issued, so retries and lost responses resume from receipts instead
of repeating an unproven mutation. The protected sequence is:

1. demote the existing pull request to draft;
2. create one same-owner waiting successor against the delivery base;
3. retire the receipt-bound predecessor;
4. promote the successor to active;
5. CAS-update the writer lease base and cloud projection;
6. update the pull-request marker; and
7. verify Git, provider, claim, lease, marker, and worktree identities.

The completion receipt preserves the original base, delivery base, predecessor and
successor claims, final lease and marker digests, and the exact plan digest. Release review,
integration, cleanup, and Dev to Production deployment remain separate protected stages.
