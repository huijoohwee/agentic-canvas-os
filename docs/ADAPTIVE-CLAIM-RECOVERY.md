---
title: "Adaptive Claim Recovery"
graphId: "md:adaptive-claim-recovery"
doc_type: "Runtime Contract"
date: "2026-08-11"
lang: "en-US"
schema: "agentic-adaptive-claim-recovery-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "provider-neutral early recovery eligibility and fixed-expiry fallback"
runtime_scope: "preserved delivery claims with fenced immutable operations"
runtime_claim: "deterministic terminal evidence can replace unnecessary lease waiting without weakening fail-closed recovery"
runtime_proof: "__tests__/adaptive-claim-recovery-contract.test.mjs"
publish_policy: "protected green main authorizes Dev integration only; Production requires exact-candidate human authorization"
source_docs:
  - "CANONICAL-LIFECYCLE.md"
  - "SCOPED-LANE-ADMISSION.md"
  - "RELEASE-WORKFLOW.md"
---

# Adaptive Claim Recovery

## Purpose

Adaptive claim recovery removes unnecessary fixed waiting when the repository can
prove that an earlier operation cannot write again. The contract is independent
of any source-control host, automation runner, cloud ledger, or deployment
provider. Provider adapters normalize their evidence before the repository
policy evaluates it.

Fixed expiry remains the fallback whenever terminality, identity, or fencing is
ambiguous.

## Safety model

The decision owner is
`scripts/adaptive-claim-recovery-contract.mjs`. It accepts four normalized
evidence groups:

- subject identity: repository, work item, candidate head, and protected main;
- current claim: state, scope reservation, write authority, fence, generation,
  exact heartbeat projection, and expiry;
- prior operation: immutable input identity, bound fence and generation,
  liveness, terminal or revocation receipt, and provider evidence digest;
- current observation: latest fence and generation plus bounded heartbeat
  scheduling values.

Early recovery is eligible only when all of these invariants hold:

```text
candidate identity unchanged
AND protected-main identity unchanged
AND current claim has no write authority
AND current scope remains reserved
AND observed fence and generation equal the current claim
AND observed heartbeat generation equals the current claim
AND prior operation is immutable
AND prior operation is terminal or explicitly revoked
AND current fence differs from the prior operation fence
AND current generation is greater than the prior operation generation
AND neither the operation nor claim has a heartbeat after terminal or revocation proof
```

The resulting decision is content-bound and always carries
`mutationAuthority: false`. It is eligibility evidence for an independently
authorized controller plan, not permission to change claims, refs, pull
requests, worktrees, or deployments.

## Evidence hierarchy

The evaluator uses this precedence:

1. A failed, cancelled, or superseded immutable operation with a terminal
   receipt and newer fence/generation is recoverable immediately.
2. An explicitly revoked immutable operation with a revocation receipt and
   newer fence/generation is recoverable immediately.
3. A `dormant-preserved` claim observed after its exact expiry uses the fixed
   expiry fallback.
4. Every incomplete or ambiguous case waits or blocks.

Heartbeat timing is deliberately non-authoritative. The expected interval and
miss tolerance compute only `nextEvaluationAt`, allowing the controller to ask
for fresh deterministic evidence sooner. Silence never proves that a writer is
dead.

## Forward-child integration

`reviewed-forward-child-recovery-evidence.mjs` accepts either:

- the established `dormant-preserved` source claim; or
- an `integrated-preserved` source claim joined to an exact
  `recoverable-now` adaptive decision.

The adaptive decision must match the same repository, work item, candidate,
protected main, claim ID, claim state, scope reservation, write authority,
fence, and transition counter. Drift fails before a recovery plan or exact
authorization digest is emitted.

The repository adapter consumes an external normalized decision only when
`AGENTIC_ADAPTIVE_RECOVERY_EVIDENCE_PATH` names its exact evidence file. The
decision is re-normalized and joined in-process. The plan digest then binds the
decision before any protected effect. Evidence producers remain separate
provider modules; they must derive immutable terminal or revocation receipts
from their provider and must not treat the external file as mutation authority.

## Recovery and release boundary

Adaptive eligibility changes neither the protected forward-child sequence nor
release authority. Recovery still requires its exact plan authorization,
single-parent empty child, compare-and-swap local and remote publication,
claim retire/promote sequence, lease projection, pull-request draft projection,
and terminal receipt.

Dev integration requires protected green main. Production and Cloudflare remain
behind the repository release controller and a separately sealed exact-candidate
human authorization.
