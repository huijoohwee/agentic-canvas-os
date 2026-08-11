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
The successor claim, local lease, and writer marker are based on the exact protected `main`
observed by the authorized plan and the exact refreshed head. The provider's older pull-
request base remains separate delivery evidence; it is never represented as the current
protected source. The predecessor claim's canonical base and delivered head remain immutable
evidence rather than being rewritten into the new projection.

Replay tolerates unrelated global-ledger movement only after freshly rejoining the exact
authorized predecessor claim and proving that no other scope-reserved claim overlaps the
declared write set. Predecessor identity, fence, transition, integration, or overlapping-write
drift still fails closed.

Protected `main` may advance after the bound delivery base only when that base remains its
ancestor and every intervening protected path is disjoint from the lane's admitted write set.
The successor deliberately retains the protected source observed by the authorized plan. The
older delivery base remains bound for authored-diff and refresh-chain proof; refreshing the
candidate beyond that protected source remains a later authoring-stage operation.
When protected `main` advances before a partial authorized replay creates its successor, the
adapter may derive the live protected source only after proving the plan source is its ancestor
and every intervening changed path is disjoint from the admitted write set. That derived SHA is
then bound consistently through the successor claim, local lease, and ownership marker.

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
2. create one same-owner waiting successor against the protected source;
3. retire the receipt-bound predecessor;
4. promote the successor to active;
5. CAS-update the writer lease base and cloud projection;
6. update the pull-request marker; and
7. verify Git, provider, claim, lease, marker, and worktree identities.

The completion receipt preserves the original base, delivery base, predecessor and
successor claims, final lease and marker digests, and the exact plan digest. Release review,
integration, cleanup, and Dev to Production deployment remain separate protected stages.
