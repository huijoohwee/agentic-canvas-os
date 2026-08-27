---
title: "Expired active device-review response-loss recovery"
graphId: "md:expired-active-device-review-response-loss"
doc_type: "Lifecycle Capability"
date: "2026-08-27"
lang: "en-US"
schema: "agentic-expired-active-device-review-response-loss-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/expired-active-device-review-response-loss.mjs"
runtime_proof: "../__tests__/expired-active-device-review-response-loss.test.mjs"
---

# Expired active device-review response-loss recovery

This controller closes one bounded response-loss gap in `device:review`. It is
used only when the exact cloud `review_ready` transition is already durably
recorded, the client lost the response before completing the local and provider
projections, and the unchanged local `active` lease later expired. It adopts
the recorded review transition; it never creates, continues, renews, recovers,
or repeats a cloud transition.

The contract and controller are repository-host, model, agent-runtime, and
deployment-provider neutral. Read-only evidence collection and the three
permitted projections are injected through a repository adapter. This keeps the
generic decision boundary small while allowing a provider adapter to implement
its own exact-read, compare-and-swap, and response-loss classification rules.

## Exact subject

`plan` is read-only and seals one unchanged review subject:

- one registered, clean worktree at the exact local, remote, and open draft
  review head, with the original commit, tree, branch, index, and authored bytes
  unchanged;
- one expired local `active` writer lease with admitted scope, exact session and
  device, immutable task-authority binding, claim identity, base, head, epoch,
  write set, review request, and source marker;
- one already-recorded reviewed cloud transition for that same claim and head,
  either still projected as reviewed or projected as `dormant-preserved` from
  time alone;
- no later transition for the claim, no competing claim, and no cloud write
  authority introduced by the recovery;
- one open draft ownership review with exact branch, head, body, and hidden
  marker; and
- deterministic target values for the `review_ready` lease, non-draft review,
  and hidden marker.

Fresh observation time may change only the effective live/dormant projection of
the unchanged terminal ledger entry. Claim identity, transition counter and
digest, review head, task binding, lease subject, provider body, and every
source or Git identity remain exact. Any other drift invalidates the plan.

## Authority and effects

Execution requires both controls:

1. the exact authorization string derived from the normalized plan digest; and
2. proof of possession of the task capability already bound to the expired
   lease.

Neither control substitutes for the other. Verification occurs again under the
operation lock before each permitted projection. The controller may perform
only:

- one compare-and-swap from the sealed expired `active` lease to its exact
  `review_ready` projection;
- one deterministic hidden-marker projection preserving all non-marker bytes;
- one draft-to-ready transition for the exact ownership review; and
- terminal readback of the exact joined target state.

The controller performs zero cloud writes. It does not mutate source bytes, the
index, worktree, commits, local or remote Git refs, claim identity, integration
state, release state, deployment state, or cleanup state. It grants no
authoring, integration, release, deployment, or cleanup authority.

## Response-loss replay

Each permitted mutation has a durable attempted phase. If a local CAS, marker
update, or draft-to-ready call succeeds but its response is lost, the next run
must classify a fresh exact read:

- exact source state permits the still-missing mutation;
- exact target state is adopted without repeating the mutation; and
- every third state fails closed.

A completed intent returns the same digest-bound receipt. Replays never repeat
the reviewed cloud transition and never synthesize a successor claim or lease.
Terminal verification joins the exact review-ready lease, non-draft review,
target marker, branch/head, and already-recorded cloud transition. Its durable
`verified` receipt precedes the pure `complete` projection; completion never
stands in for missing terminal evidence.

After this controller succeeds, the operator may separately rerun the
repository's genuine exact-head check under the existing workflow authority.
That check rerun is not a controller effect and is not implied by the recovery
receipt.

## Operator flow

Persist the read-only plan outside the repository, inspect its exact subject and
effect ceiling, then run with the emitted authorization string and the existing
owner-only task-capability file. Keep that capability private. A successful
receipt proves only recovery of the lost `device:review` projections. Protected
integration, release, deployment, and cleanup remain separate workflows with
their own gates.
