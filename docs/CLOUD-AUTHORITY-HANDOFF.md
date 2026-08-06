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

For an older clean committed lane that has no claim, lease, remote branch, or
review marker, use the separate legacy bootstrap boundary described below.

## Legacy Clean Committed Lane Bootstrap

`scripts/legacy-clean-committed-lane-bootstrap.mjs` wraps an exact existing
commit in attributable coordination projections without changing its commit,
tree, branch attachment, worktree, or authored files. The CLI accepts a
content-bound JSON request and a caller-selected adapter module:

```sh
npm run workspace:legacy-clean-bootstrap -- \
  --request="<absolute-request-json>" \
  --adapter="<absolute-adapter-module>"
```

The adapter module must export `createLegacyBootstrapAdapter()` and implement
the cloud claim, local lease, exact branch publication, draft ownership
request, cloud binding, owner receipt, inspection, verification, and atomic
checkpoint boundaries. Provider resource identifiers stay opaque to the core.

The request pins the target and ledger repository identities, session, device,
semantic scope, registered worktree path, attached agent branch, base commit,
head commit, tree, exact committed changed paths, and normalized declared write
scope. Bootstrap fails before effects when any pinned value drifts, the lane is
dirty or unregistered, ancestry is invalid, a scope owner exists, a live claim
overlaps, or an existing projection lacks the same bootstrap identity.

Each external operation returns a complete content-addressed projection. The
controller inspects the immutable lane again after every operation and writes a
checkpoint before advancing. An interrupted replay reuses only projections
carrying the same identity and exact receipt; missing, changed, or unattributed
state blocks. A completed replay returns the original receipt digest. The core
has no commit, reset, checkout, worktree removal, merge, deployment, or branch
deletion operation.

The absolute worktree path remains a local validation input. Portable receipts
contain only its content-addressed registration digest and never expose the
machine-local path.

The focused proof uses only an in-memory adapter and synthetic paths. It does
not bootstrap or otherwise operate on any preserved real-world legacy lane.

## Supported Outcomes

- `retained-legacy`
- `reclaimed-live`
- `handed-off-live`
- `blocked`

## Required Preconditions

The preserved lane must remain exact and source-owned:

- attached `agent/<device>/<semantic-scope>` branch
- admitted writer lease with preserved review marker
- exact reviewed-head evidence, plus either:
  - exact local `HEAD`, remote branch head, PR head, and `reviewHeadSha` parity; or
  - one bounded protected-`main` refresh chain whose observed local, remote, and PR head all match the same refreshed head while the preserved lease, review marker, and cloud authority stay pinned to the original reviewed head
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

If protected `main` has advanced since the preserved claim expired, reclaim still
continues on the predecessor's recorded base. The controller must never
synthesize the newer protected source revision into the successor claim; it
preserves the original reviewed base and reviewed head. When the attached lane
has only a bounded protected-`main` refresh, reclaim reuses the preserved
review request identity and focused evidence instead of rebinding the successor
claim to the refreshed PR head; the later repository-owned integration path
continues to own the protected-main refresh chain.

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
