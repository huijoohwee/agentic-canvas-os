---
title: "Post-Merge Cloud Authority Verification and Terminal Retirement"
graphId: "md:agentic-post-merge-cloud-authority"
doc_type: "Runtime Contract"
date: "2026-08-26"
lang: "en-US"
schema: "agentic-post-merge-cloud-authority-verification/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact integrated-claim retirement after protected merge, with read-only live verification before merge"
runtime_scope: "device integration replay after protected-main merge"
runtime_claim: "Dev integration convergence only; Production and deployment remain separately gated"
runtime_owner: "../scripts/post-merge-cloud-authority-verifier.mjs; ../scripts/post-merge-cloud-authority-controller.mjs; ../scripts/integrated-delivery-terminal-retirement.mjs"
runtime_proof: "../__tests__/post-merge-cloud-authority-verifier.test.mjs; ../__tests__/post-merge-cloud-authority-controller.test.mjs; ../__tests__/integrated-delivery-terminal-retirement.test.mjs"
publish_policy: "protected Dev integration only; no Production or Cloudflare authority"
---
<!-- Responsibility: Define exact post-merge convergence from integrated-preserved to retired. -->

# Post-merge cloud authority verification and terminal retirement

Before merge, the verifier remains the ordinary live, read-only delivery gate.
An open pull request never enters the terminal controller and the controller
cannot create, continue, integrate, or retire a claim on that open-PR path. If
live verification fails while the exact pull request remains open, the original
failure is returned unchanged.

After GitHub reports the exact pull request as merged, leaving its claim in
`integrated-preserved` is not a successful terminal state. The post-merge
controller either proves an existing exact `integrated` retirement or performs
one idempotent `retire` transition through the existing cloud-collaboration
adapter. The transition uses reason `integrated`; no new ledger action or entry
schema is introduced.

## Exact operation run

The stable operation run binds all of the following:

- ledger and target repository names;
- claim ID and exact integration-entry digest;
- derived integration-receipt digest;
- pull-request number, immutable node ID, and review-request identity;
- source branch, reviewed delivery head, and any controller-proven refreshed
  provider head;
- protected merge commit SHA; and
- the post-merge controller schema identity.

The run digest is deterministic. Its raw operation key is
`integrated-delivery-terminal-retirement:<runDigest>`; the existing ledger
contract stores the digest of that key in the retirement entry. The retirement
`bytesDigest` additionally binds the run digest, claim, integration receipt,
pull request, and merge commit. A retry therefore reuses the same semantic
operation even if an unrelated claim advances the ledger head.

The current ledger schema does not have a first-class controller-run field.
Run identity is consequently committed through the existing idempotency-key
and evidence-digest fields and is emitted in the controller receipt. This is a
deliberate compatibility boundary, not authority to add unvalidated fields to
the ledger.

## Required integration and provider evidence

The controller accepts only local `delivery_authorized` authority or the
bounded `review_ready` response-loss case. It validates the complete ledger and
joins the local claim identity to one exact historical integration entry:
canonical base, reviewed head, declared write scope, write-set digest, epoch,
transition counter, review request, focused evidence, dependency closure,
named checks, handoff evidence, operator decision, and integration intent must
all match.

For a delivery-authorized projection, the integration entry's derived contract
receipt must equal the locally projected integration receipt. The exact local
fence entry may be that integration or a validated later
`integrated-preserved` renewal/recovery; its entry digest, claim digest, and
counter must match the local projection. For a review-ready response-loss
projection, the exact local fence entry must be the adjacent reviewed
predecessor of integration, and all five delivery-evidence digests must be
supplied and match. The controller derives the missing integration receipt
from that exact validated entry.

GitHub must independently report one same-repository pull request targeting
`main`. Its URL, number, node ID, review-request identity, branch, head, merged
time, and merge commit are bound. A different merged head is accepted only
through a complete, continuous protected-main refresh receipt from the
reviewed delivery head to the provider head. The verifier independently
recomputes that chain from Git, including commit topology, merge-tree
equivalence, and protected-main ancestry; a caller-shaped receipt is not proof.

Zero or more same-claim `integrated-preserved` continuations may follow the
integration entry. Every continuation must advance exactly one transition,
extend expiry, and be either a valid pre-expiry heartbeat or an evidence-bound
expired recovery while preserving all other claim fields.

## Retirement and readback

Immediately before mutation, the controller uses the latest authoritative
claim fence, transition counter, and ledger digest. It passes the claim's own
device and session identities to the existing authenticated compare-and-swap
adapter. The retirement request preserves the reviewed revision and review
request and copies the integration entry's named-checks, handoff, and receipt
digests exactly.

Success is never inferred from the mutation response. The controller performs
two independent authoritative pull-request and full-ledger readbacks after an
attempt. Both must prove the same pull-request node, merge commit, integration
entry, and terminal retirement entry. Unrelated ledger advancement between
the reads is permitted; a different same-claim terminal identity is not.

If the adapter response is lost or malformed after the compare-and-swap wins,
the same two readbacks recover completion only when the retirement entry's
hashed operation key and `bytesDigest` match this exact run. If another exact
integrated-retirement operation wins the race, the controller may reconcile it
only after both readbacks prove the complete claim, integration receipt, pull
request, and terminal entry. A compatibility retirement is accepted only for
the existing protected push-event key and its exact merge-evidence digest. In
both forms the authoritative retirement time must be at or after GitHub's
merged time; arbitrary, foreign, or pre-merge retirements are rejected. The
result distinguishes `retired`,
`response-loss-recovered`, `concurrent-retirement-reconciled`, and
`already-retired`.

An already-retired replay remains mutation-free but still obtains a second
authoritative readback. An invalid ledger, open-to-closed drift, unmerged pull
request, fork, node mismatch, refreshed-head gap, integration mismatch,
non-integrated retirement, or disagreeing readbacks fails closed.

The controller does not merge or edit a pull request, update a branch, renew or
recreate authority, modify a lease, complete local cleanup, authorize
Production, or deploy Cloudflare. Local completion remains a later consumer of
the exact `integrated-retired` verification receipt.
