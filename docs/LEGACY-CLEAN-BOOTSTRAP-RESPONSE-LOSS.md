---
title: "Legacy Clean Bootstrap Response-Loss Adoption"
graphId: "md:legacy-clean-bootstrap-response-loss-adoption"
doc_type: "Recovery Contract"
date: "2026-08-20"
lang: "en-US"
schema: "agentic-legacy-clean-bootstrap-response-loss-adoption/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "same-identity recovery of the bootstrap cloud-claim phase"
runtime_owner: "../scripts/legacy-clean-committed-lane-bootstrap-adapter.mjs; ../scripts/legacy-clean-committed-lane-bootstrap-adapter-lib.mjs"
runtime_proof: "../__tests__/legacy-clean-committed-lane-bootstrap-adapter.test.mjs; ../__tests__/legacy-clean-committed-lane-bootstrap.test.mjs"
publish_policy: "Dev-only; no merge, cleanup, release, or deployment authority"
---

# Legacy Clean Bootstrap Response-Loss Adoption

The legacy clean committed-lane bootstrap can lose the provider response after
its first cloud claim becomes durable but before the `cloudClaim` checkpoint is
projected. Ordinary replay must not classify that exact claim as a foreign
write overlap, and it must not infer ownership from path overlap alone.

## Exact subject

Adoption is available only while the local checkpoint is still `prepared` with
no phase outputs. The live claim must match the checkpointed bootstrap identity
across the target repository, branch-derived work item, device, session,
canonical base, base lane revision, complete normalized write set, lease epoch,
review absence, predecessor absence, and current-entry provenance.

The only accepted cloud states are:

- the initial `current` claim at transition 1;
- that same claim after expiry as `dormant-preserved`; or
- its exact transition-2 recovery carrying the content-bound bootstrap
  recovery evidence digest.

Any second match, phase output, different owner projection, advanced heartbeat,
review identity, predecessor, integration evidence, path set, or revision fails
closed as an ordinary overlap.

## Recovery and replay

A current transition-1 claim replays the existing idempotent claim-and-bind
operation. A dormant claim advances once through `continue(claim)` recovery,
using an idempotency key and evidence digest bound to the immutable bootstrap
identity. Recovery must preserve the claim, base, write set, lease epoch,
heartbeat, and owner identity while advancing exactly one transition and
restoring a future expiry.

If the recovery response is lost, a fresh complete status read may adopt only
that exact counter-plus-one result. The recovered authority is independently
verified before binding the committed head. Normal phase checkpointing then
resumes; no ledger or local registry file is edited directly.

This contract grants no authority to merge, clean another lane, close a pull
request, publish a release, or deploy.
