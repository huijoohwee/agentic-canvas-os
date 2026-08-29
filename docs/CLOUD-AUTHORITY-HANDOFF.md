---
title: "Cloud Authority Handoff And Reclaim"
graphId: "md:cloud-authority-handoff-and-reclaim"
doc_type: "Lifecycle Capability"
date: "2026-08-09"
lang: "en-US"
schema: "agentic-cloud-authority-handoff-controller/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "Source-owned continuation of expired preserved review lanes"
runtime_owner: "../scripts/cloud-authority-handoff-controller.mjs; ../scripts/cloud-authority-handoff-lineage.mjs; ../scripts/cloud-authority-scope-expansion-lineage-contract.mjs; ../scripts/cloud-authority-scope-expansion-lineage-migration.mjs"
runtime_proof: "../__tests__/cloud-authority-handoff-controller.test.mjs; ../__tests__/cloud-authority-scope-expansion-lineage-migration.test.mjs"
---

# Cloud Authority Handoff And Reclaim

Expired review lanes that never had an admission or cloud-authority projection
use the separate, provider-first contract in
[`LOCAL-REVIEW-RETIREMENT.md`](./LOCAL-REVIEW-RETIREMENT.md). That controller
fails closed for any cloud-backed lane; this handoff controller remains the
only owner for current or recoverable cloud claims.

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

### Exact Integrated-Delivery Replay

`reclaim` also has one narrow replay branch for an already integrated lane whose
local and pull-request projections are still in `delivery`. This branch is
selected only after the live cloud inventory proves the same claim carries the
immutable integration receipt. It requires an expired local
`delivery_authorized` authority, exact `deliveryHeadSha` parity across local
HEAD, remote branch, pull-request head, and the admitted authority, an open
non-draft pull request with protected SQUASH auto-merge still armed, the exact
remote owner marker, and the authenticated original owner. The requested
successor device and session must equal the historical local lease, so this
replay cannot transfer the integrated claim to another same-actor device or
session. The ordinary
`review_ready` validation remains unchanged for every non-delivery replay.
The cloud subject may be either the exact expired integrated transition joined
field-for-field to that historical local projection, or the same claim's live
`delivery_authorized` recovery descendant. The descendant must have a strictly
higher transition counter, future expiry, new fence, transition, and current
operation receipt, plus operation-derived recovery evidence; its claim,
actor/device/session, base, candidate, scope, epoch, review identity,
integration receipt, and complete integration evidence remain byte-exact. No
other live-ahead shape is accepted, and the local/marker delivery projection
remains unchanged as historical input.

The recovery evidence digest is recomputed from the historical delivery
authority's claim, candidate, review, integration receipt, current operation
receipt, branch, manifest, and write-set identities. The returned verified
authority must then reproduce the permitted parked-to-live descendant (or the
already-live transition exactly on rerun), and its final convergence object and
digest must reproduce the current fence, transition, counter, expiry,
operation receipt, immutable integration evidence, recovery digest, and
canonical recovery time.

The integrated replay may dispose of one direct queued derivative only in one
of two closed shapes:

- the existing exact same-work-item successor; or
- one claim-only, unprojected derivative at transition 1 / heartbeat 0 whose
  non-writing waiting state names the integrated claim as predecessor, uses the
  same actor, device, and repository, stays at the integrated claim's canonical
  base, overlaps the admitted path set, and has no writer-lease or pull-request
  marker association.

The second shape is not a general successor relaxation. It must use a distinct
work item, remain byte- and provider-unprojected, and pass two identical full
registry/provider association reads before any cloud effect. Provider inventory
uses the complete paginated pull-request connection rather than a fixed result
limit; missing page metadata, repeated cursors or pull requests, or a bounded
page-ceiling breach fails closed. The final association read is repeated while
holding the shared writer-registry serialization fence through the exact cloud
retirement/recovery CAS. A competing repository-owned admission must therefore
either appear in that sealed registry/provider frame or advance the queued
claim and lose the exact fence/counter CAS. Multiple direct
derivatives, any local or provider association, review/integration/recovery
evidence, heartbeat or transition movement, identity drift, disjoint scope, or
association drift blocks before mutation. The controller retires the exact
queued claim as `superseded`, then recovers or renews only the original
integrated claim. Its successful public receipt is derived from that final
same-claim authority, not from the ephemeral queued derivative, so a terminal
rerun is digest-identical after the derivative disappears. It does not edit
source, refs, local leases, pull-request content, merge state, or task bindings.

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

## Historical Scope-Expansion Lineage Migration

The ordinary handoff validator remains strict: a v2 epoch-1 claim must have no
predecessor. One repository-owned migration admits only either of two complete
historical shapes created when an active dirty lane or an authorized
reviewed-handoff recovery expanded its declared scope through a waiting
successor. It does not rewrite either claim or make predecessor-bearing epoch-1
claims generally valid.

`scripts/cloud-authority-scope-expansion-lineage-migration.mjs` proves all of
the following before it can call this controller:

- one valid append-only v2 ledger and an exact current status digest
- one epoch-1 target genesis whose predecessor is the earlier source claim
- a strict source-scope subset with the same actor, device, repository, base,
  and initial lane revision
- either the active-dirty identity pair (same session, distinct work item) and
  its portable-plan retirement digests, or the reviewed-recovery identity pair
  (distinct authorized successor session, same work item) and retirement
  digests recomputed from its exact source-retired operation key
- a content-bound historical-variant name in the migration plan; mixed identity
  and retirement-receipt variants fail closed
- when protected `main` refreshes the pull request after review, an exact
  protected-main refresh receipt joining the reviewed head, delivery head, and
  main parent; local review identity stays on the reviewed head while remote and
  pull-request parity stays on the delivery head
- exact clean review-lane, owner, pull-request, manifest, authority, and cloud
  projection parity, with no competing overlapping claim

The execute phase revalidates the saved plan against current bytes and requires
the exact text `authorize lineage-migration <planDigest>`. It then mints a
process-local authorization and admission bound to the exact reclaim execution
intent, current claim transition, local authority, and ledger revision. Their
identity lives only in module-private weak registries; serialization, property
copying, and symbol reflection cannot reconstruct either capability.
For a reviewed historical claim, the existing handoff controller creates a
normal epoch-2 successor, retires the historical claim through the standard
root operation, restores the unchanged review projection, and persists it
through repository-owned APIs. If the preserved writer lease is task-bound,
that same repository transaction authenticates the existing external
capability and continues its binding to the new cloud claim. The capability is
never copied into the lease, rotated, or replaced; only its public binding is
projected. A missing, insecure, or mismatched capability fails before cloud
continuation. When the authorized plan instead ends at the exact integrated
child of the local reviewed transition, the controller uses
the already-validated predecessor capability to recover that same claim as
epoch 1. It does not mint a successor or replace the immutable integration
receipt. Post-recovery verification keeps the exact local and remote reviewed
projection as historical evidence, requires it to be the integrated
transition's immediate parent, and proves the current cloud claim preserves
the immutable integration evidence. A rerun returns `already-migrated` while
that recovered epoch-1 claim remains live. If the same verified claim expires
again, the migration reissues its process-local lineage admission against the
current dormant transition and invokes the repository-owned integrated-replay
recovery again. The claim ID, epoch, predecessor, and immutable integration
receipt remain unchanged; no generic reclaim or extra epoch is created. An
epoch-2 successor remains an idempotent `already-migrated` result.

This migration is reclaim-only. The execution session, successor session, and
successor device must equal the exact preserved lease session and device before
the controller is called. A distinct recipient blocks with no cloud mutation;
recipient handoff requires its own end-to-end projection owner and is outside
this migration capability.

Immediately before successor claim, the controller's second lane read must
rejoin the complete plan and the request session/device to the current local
and pull-request marker owner. Success and `already-migrated` replay require
both markers to carry one stable normalized successor authority across every
canonical field, including ledger and claim digests, manifest digest, device,
session, transition counter, expiry, operation receipt, and integration state.
If execution stops after the local lease update but before the marker update,
replay blocks without attesting migration or appending another transition until
the two repository-owned projections converge.

The CLI requires a canonical `agent/<device>/<scope>` branch before it starts a
subprocess. Repository execution resolves one real worktree root, verifies that
exact registered branch worktree, and uses only explicit protected-main and
agent-branch fetch refspecs. JSON failures redact every GitHub token family,
credentialed URLs, and local paths, suppress child-process stderr, and cap the
public diagnostic length.

Authoritative GitHub contents and blob reads use the repository's bounded 64
MiB text-command envelope. This admits the provider ledger response above
Node's default child-output limit while preserving the contents-API/blob
fallback and a finite subprocess memory bound.

Plan first, without mutation:

```sh
node ./scripts/cloud-authority-scope-expansion-lineage-migration.mjs plan \
  --session="<exact-lease-session-id>" \
  --branch="agent/<device>/<semantic-scope>" \
  --json > "<lineage-plan-result.json>"
```

After inspecting the receipt-bound plan, execute that exact plan:

```sh
node ./scripts/cloud-authority-scope-expansion-lineage-migration.mjs execute \
  --session="<exact-lease-session-id>" \
  --task-authority="<existing-absolute-capability-path>" \
  --plan-file="<lineage-plan-result.json>" \
  --authorize="authorize lineage-migration <planDigest>" \
  --json
```

Plan, authorization, ephemeral admission, continuation, and migrated-state
receipts are content-addressed. None grants integration, merge, deployment,
publication, Production, or worktree cleanup authority.

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
