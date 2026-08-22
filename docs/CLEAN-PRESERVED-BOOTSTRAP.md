---
title: "Clean Retired-Preserved Bootstrap Maintenance"
graphId: "md:agentic-clean-preserved-bootstrap"
doc_type: "Runtime Contract"
date: "2026-08-10"
lang: "en-US"
schema: "agentic-clean-preserved-bootstrap-contract/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "candidate-bound root-source admission from an immutable retired-preserved owner"
runtime_scope: "maintenance evidence normalization and root-source bootstrap authorization only"
runtime_claim: "a clean retired-preserved lane can own preservation evidence without manufactured dirt; ordinary clean lanes remain blocked"
runtime_owner: "../scripts/scoped-lane-bootstrap-maintenance.mjs; ../scripts/scoped-lane-bootstrap-authorization.mjs; ../scripts/scoped-lane-admission.mjs"
runtime_proof: "../__tests__/scoped-lane-clean-preservation-bootstrap.test.mjs; ../__tests__/scoped-lane-bootstrap-admission.test.mjs"
publish_policy: "Dev-only; no integration, cleanup, deployment, or production authority"
---

# Clean Retired-Preserved Bootstrap Maintenance

## Purpose

A root-source bootstrap may be blocked even when the only trusted maintenance
owner has already completed provider-first local retirement and is intentionally
preserved. Requiring new dirty bytes in that situation rewards manufactured
dirt and discards stronger existing evidence.

This contract admits the immutable owner as maintenance evidence. It does not
make the owner writable again and does not weaken candidate admission.

## Exact Eligibility

The maintenance source must be one registered worktree and must satisfy exactly
one closed mode:

| Mode | Required evidence |
|---|---|
| Dirty maintenance | Dirty, unleased, nonempty changed paths, and every changed path inside the exact maintenance manifest. |
| Canonical dirty maintenance | The registered primary `main` worktree is dirty and unleased, its HEAD is equal to or an ancestor of fetched `origin/main`, and every changed path remains in the exact maintenance manifest. |
| Clean retired preservation | Clean, zero changed paths, exactly one matching lease, and exactly one normalized `agentic-local-review-retirement-receipt/v1`, `agentic-retired-planned-admission-owner-receipt/v1`, or `agentic-planned-recovery-pr-marker-local-release/v1` proving `retired-preserved`. |

The clean mode normalizes the single applicable retirement receipt owner, then
binds its receipt digest into the maintenance content and state digests. The
inspector rereads registration, branch, HEAD, status, manifest, lease registry,
and retirement receipt from the actual source. Conflicting receipt owners and
caller-provided booleans are not authority.

Canonical dirty maintenance is an even narrower bootstrap-only source: the
authorization derives `canonical-dirty-main` from the actual primary `main`
worktree and its content-bound state. It creates one clean detached candidate
without moving or cleaning the canonical changes; a generic dirty-main flag is
never sufficient.

The normalizer accepts historical dirty-maintenance proofs whose digest predates
the `retiredPreserved` field only after recomputing their exact historical
digest. This preserves already-issued immutable receipts; it does not map an
old or unknown state into the clean retired mode.

## Fail-Closed Boundaries

The bootstrap is rejected when any of these conditions holds:

- the clean lane has no valid retirement receipt or has more than one lease;
- a current cloud claim contradicts the terminal local retirement;
- the clean lane has any index, working-tree, or untracked change;
- a dirty lane has a lease, no changed path, or a path outside its manifest;
- registration, branch, HEAD, manifest digest, content digest, state digest, or
  retirement receipt changes between inspection and authorization;
- the candidate claim, actor, base, target, scope, write set, ledger, expiry, or
  preserved-lane inventory differs from the candidate-bound operator decision.

## Non-Authority

Successful maintenance proof authorizes only the existing candidate-bound
bootstrap evaluation. It does not authorize edits to the maintenance source,
claim recovery, pull-request mutation, integration, cleanup, branch deletion,
deployment, or production release. The retired source worktree, branch,
commits, index, working bytes, claim history, and pull request remain preserved.

## Focused Proof

Run from the repository root:

```sh
node --test \
  __tests__/scoped-lane-clean-preservation-bootstrap.test.mjs \
  __tests__/scoped-lane-bootstrap-admission.test.mjs
```

The proof covers eligible clean retirement, rejection of ordinary clean and
leased dirty sources, continued dirty-unleased behavior, exact validation of
historical proof digests, and the absence of authority for a fresh clean
worktree.
