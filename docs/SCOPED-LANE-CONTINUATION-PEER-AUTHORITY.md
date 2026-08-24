---
title: "Scoped Lane Continuation Peer Authority"
graphId: "md:scoped-lane-continuation-peer-authority"
doc_type: "Runtime Contract"
date: "2026-08-14"
lang: "en-US"
schema: "agentic-scoped-lane-continuation-peer-authority/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "planned scoped-lane continuation while preserving selected dormant and independently attributed peers"
runtime_scope: "local peer classification, operation-derived delivery-peer binding, and continuation receipt projection"
runtime_claim: "continuation reuses the scoped admission authority classifier and fails closed on uncovered, stale, overlapping, or selection-drifted peers"
runtime_owner: "../scripts/scoped-lane-admission-continuation.mjs; ../scripts/scoped-lane-authority-state.mjs; ../scripts/scoped-lane-admission-lib.mjs; ../scripts/scoped-lane-delivery-peer-authority.mjs"
runtime_proof: "../__tests__/scoped-lane-admission-continuation-peer-authority.test.mjs; ../__tests__/scoped-lane-admission-continuation.test.mjs"
publish_policy: "Dev-only; no Production, publication, cleanup, or deployment authority"
---

# Scoped Lane Continuation Peer Authority

## Purpose

A planned candidate may be resumed without treating every other registered
worktree as dormant. Continuation preserves two distinct peer groups:

- the exact operator-selected dormant lanes, bound by one current preservation
  receipt; and
- unselected lanes whose existing ownership is independently attributable and
  disjoint from the candidate.

The continuation does not expand the dormant selection, adopt a peer, renew a
peer, or infer ownership from cleanliness. Its classification and receipt
semantics are model-, agent-vendor-, and client-neutral. Live claim and review
proof still runs through the repository's provider-specific adapters; another
provider must implement the same typed verification boundary.

## Shared Authority Source

Continuation uses `classifyExistingLane` from the scoped admission authority
owner. It does not maintain a second classification table or reimplement lease,
claim, expiry, semantic-scope, or write-set rules.

The candidate's historical local lease expiry is immutable continuation
identity. It may be earlier than the authenticated cloud expiry, but it may
never be later. Both values must be finite canonical instants. Continuation
rejects local expiry drift instead of extending, heartbeating, or reacquiring
the claim; equality is not required.

For every registered lane other than the candidate and canonical lane, the
classifier receives the exact:

- candidate branch, semantic scope, and normalized declared write set;
- lane path, branch, head, working-byte state, and local lease projection;
- operation-derived evaluation time and complete current claim inventory; and
- operator-bound dormant preservation receipt.

Only `disjoint-attributed` continues. `ambiguous` and `overlapping` stop with the
exact path, classification, and overlap reasons.

## Dormant Selection

The preservation receipt remains operation-derived and must join the current
cloud inventory by ledger revision, ledger digest, and complete inventory
digest. Its operator decision digest must match the continuation request.

Every selected worktree must still classify as `dormant-preserved` and carry
that exact preservation receipt digest. Every receipt-selected path must still
exist in the stable registered snapshot. An unselected peer must carry no
dormant preservation receipt digest. These checks prevent both silent selection
loss and implicit selection broadening.

## Independently Attributed Peers

An unselected lane can continue when the shared classifier proves a disjoint
authority class, including:

- an exact current local lease, admission, and cloud claim joined to the
  operation-derived current inventory;
- an exact expired admitted projection that is disjoint and retains no current
  mutation authority;
- a valid retired or completed preservation projection accepted by the shared
  authority owner; or
- a delivery-transition peer with independent operation-derived proof.

A lease-less lane, a stale local-to-cloud join, structural ambiguity, the same
branch or semantic scope, or an overlapping declared path remains fail-closed.
Expiry can preserve attribution; it never grants mutation authority.

## Delivery-Transition Peers

A local review projection cannot by itself prove a live delivery successor.
Continuation calls the existing delivery peer verifier and requires its result
to be operation-derived. It then binds the verified peer state through
`bindOperationDerivedDeliveryPeerLaneStates`.

Any residual `review-ready-projected` peer is rejected. A delivery-transition
peer continues only after the shared verifier proves the local Git head,
reviewed lease, provider review identity, ledger transition chain, current
claim record, and bounded protected-source relationship. Continuation neither
duplicates that proof nor mutates the peer.

## Stable Digest Projection

The continuation peer-state digest uses the same authority projection as scoped
admission:

```text
path
stateDigest
authorityState
dormantPreservationReceiptDigest
```

Entries are sorted by normalized absolute path. The raw lane state digest keeps
the projection byte-bound; the authority state records the shared classifier or
operation-derived delivery binding. The delivery verification operation receipt
digest is also bound into the preservation and continuation receipts.

## Failure Boundary

Continuation performs no peer repair. Any of the following stops before the
planned lease is annotated as admitted:

- candidate, canonical, registry, protected-source, or peer state drift;
- stale or incomplete cloud inventory joins;
- a missing operator-selected dormant path;
- dormant receipt or selected-lane byte drift;
- ambiguous or overlapping peer classification;
- unproven delivery-transition authority; or
- remote claim overlap with the candidate write set.

The owner must repair or reconcile the failing authority through its own typed
controller. Manual lease edits, claim edits, worktree cleanup, and selection
expansion are outside this contract.

## Focused Proof

```sh
node --test \
  __tests__/scoped-lane-admission-continuation.test.mjs \
  __tests__/scoped-lane-admission-continuation-peer-authority.test.mjs
node --check scripts/scoped-lane-admission-continuation.mjs
npm run docs:check
```

These checks prove the source contract only. They do not authorize integration,
Production release, cleanup, publication, or deployment.
