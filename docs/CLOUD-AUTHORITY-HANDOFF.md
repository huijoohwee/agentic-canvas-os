---
title: "Cloud Authority Handoff And Reclaim"
graphId: "md:cloud-authority-handoff-and-reclaim"
doc_type: "Lifecycle Capability"
date: "2026-08-03"
lang: "en-US"
schema: "agentic-cloud-authority-handoff-controller/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "Source-owned continuation of expired preserved review lanes"
---

# Cloud Authority Handoff And Reclaim

## Purpose

`scripts/cloud-authority-handoff-controller.mjs` restores or preserves cloud
authority for an exact preserved review lane without changing authored bytes,
rewriting branch history, or synthesizing missing evidence.

The controller is provider-neutral at the core and keeps provider-specific
cloud and review APIs behind a replaceable adapter boundary.

## Supported Outcomes

- `retained-legacy`
- `reclaimed-live`
- `handed-off-live`
- `blocked`

## Required Preconditions

The preserved lane must remain exact and source-owned:

- attached `agent/<device>/<semantic-scope>` branch
- admitted writer lease with preserved review marker
- exact local `HEAD`, remote branch head, PR head, and `reviewHeadSha` parity
- clean worktree
- immutable branch, scope, base, review request, and declared write set
- expired preserved cloud authority in `review_ready`
- authenticated owner authorization
- no competing live overlapping claim

If any condition drifts or becomes ambiguous, the controller returns
`blocked` and performs no mutation.

## Transition Model

### Retain

`retain` proves the preserved lane is still exact and emits a
`retained-legacy` receipt chain without creating a successor claim.

### Reclaim

`reclaim` creates a successor cloud claim by compare-and-swap continuation from
the expired predecessor claim:

1. `claim` with `predecessorClaimId`
2. exact `bind` to the unchanged branch, head, and review projection
3. `review-ready` on the unchanged reviewed head
4. refresh the local review-ready projection through repository-owned lease and
   PR-body APIs

The successor claim must preserve:

- canonical base revision
- exact reviewed head
- declared write set
- review request identity
- monotonic lease epoch

### Handoff

`handoff` follows the same compare-and-swap continuation path but may target a
different successor session or device. When the successor differs from the
current preserved lease owner, the controller emits `handed-off-live` and
leaves local projection rebinding to a recipient-owned repository step.

## Forbidden Behavior

The controller must not:

- synthesize missing claim, fence, scope, revision, or receipt evidence
- edit the cloud ledger or local lease registry directly
- adopt authored files or alter authored content
- rewrite branch history
- weaken validation or bypass review
- perform manual merge, deployment, publication, or Production authorization

## CLI

Run from the preserved review lane worktree:

```sh
node ./scripts/cloud-authority-handoff-controller.mjs reclaim \
  --session="<exact-lease-session-id>" \
  --json
```

Optional successor handoff arguments:

```sh
--successor-session="<recipient-session-id>"
--successor-device="<recipient-device-id>"
```

## Receipts

Each successful run emits operation-derived receipts for:

- preflight validation
- cloud continuation
- local projection refresh when reclaiming the same owner

Each receipt is content-addressed and folded into the final result digest.
