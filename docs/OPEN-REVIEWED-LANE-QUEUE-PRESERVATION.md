---
title: "Open Reviewed Lane Queue Preservation"
graphId: "md:open-reviewed-lane-queue-preservation"
doc_type: "Recovery Contract"
date: "2026-08-14"
lang: "en-US"
schema: "agentic-open-reviewed-lane-queue-preservation-doc/v1"
frontmatter_contract: "required"
status: "contract-ready"
authority: "repository-owned outer recovery contract for a reviewed lane with direct waiting successors"
runtime_scope: "one missing registered-worktree projection"
runtime_claim: "receipt-bound local projection recovery that preserves the complete direct waiting queue"
runtime_proof: "focused contract and controller tests"
deploy_policy: "forbidden"
source_docs:
  - "START-WORKFLOW.md"
  - "RELEASE-WORKFLOW.md"
  - "CLOUD-COLLABORATION.md"
  - "OPEN-REVIEWED-LANE-REHYDRATION.md"
---

# Open Reviewed Lane Queue Preservation

## Purpose

This contract restores one missing registered-worktree projection for an open reviewed lane when its exact local branch and writer-lease projection already exist, while preserving every direct waiting successor unchanged.

It wraps the existing open-reviewed-lane rehydration controller. It does not replace, weaken, or duplicate that controller's Git, lease, provider, or receipt validation.

The contract and controller are independent of model vendor, agent runtime, transport, and hosting provider. A repository adapter may translate a provider's review and collaboration projections into the neutral evidence schema, but provider-specific behavior does not enter the outer controller.

## Admission Boundary

The operation is valid only when the sealed inner plan declares:

- local projection mode `worktree-only`;
- an existing exact local branch;
- an existing exact writer-lease projection;
- an absent, safe managed worktree target; and
- inner mutation set `registered-worktree` only.

The preserved queue must be a complete, canonical inventory of direct descendants of the source claim. Every entry must:

- use the current collaboration entry and identity schemas;
- have state `waiting-successor`;
- have `writeAuthority: false` and `scopeReserved: false`;
- have no review request or integration receipt;
- name the source claim as its direct predecessor; and
- retain the source actor and repository identities.

A successor may have an evolved work-item identity and evolved declared scope. This is intentional: queue preservation observes successors; it does not contract, promote, adopt, or rewrite them.

The operation rejects incomplete, duplicate, unordered, malformed, active, writing, reserving, reviewed, integrated, or foreign descendants.

## Stable Queue Evidence

The queue is ordered by lease epoch and then claim ID. Its normative digest binds:

- schema and complete-inventory assertion;
- source-claim identity;
- ledger and target repository identities;
- canonical ordering; and
- every full public waiter projection.

Observed ledger revision and ledger digest remain in the immutable historical evidence. They are not part of the normative queue digest, so an unrelated claim heartbeat may advance the shared ledger without invalidating an otherwise unchanged source and direct-waiter inventory. Any source or waiter content change still fails pre-effect or post-effect revalidation.

## Authorization and Execution

Planning is read-only:

```sh
node scripts/open-reviewed-lane-queue-preservation.mjs plan \
  --repository=<canonical-repository> \
  --worktree=<managed-target-worktree> \
  --pull-request=<review-number>
```

The plan emits one exact authorization statement:

```text
authorize open-reviewed-lane-queue-preservation <plan-digest>
```

Execution requires the unchanged plan artifact and that exact statement:

```sh
node scripts/open-reviewed-lane-queue-preservation.mjs run \
  --repository=<canonical-repository> \
  --worktree=<managed-target-worktree> \
  --pull-request=<review-number> \
  --plan-file=<sealed-plan-file> \
  --authorize='authorize open-reviewed-lane-queue-preservation <plan-digest>'
```

The outer authorization seals the complete inner plan. The controller supplies only the inner plan's already-sealed exact authorization to the inner controller. No free-form, model-derived, or provider-derived authorization is accepted.

## Durable Replay

The outer intent has three states:

1. `prepared` - the exact plan and preserved-queue digest are journaled.
2. `inner-complete` - the exact inner rehydration receipt is journaled.
3. `complete` - the terminal outer receipt is journaled.

If a response is lost after local worktree registration, replay invokes the receipt-bound inner controller again. The inner controller reconciles its own durable journal and returns the same receipt. The outer controller never reconstructs, adopts, or rolls back the inner effect independently.

Before the inner boundary and after terminal verification, the adapter must recapture the complete direct queue and compare its normative digest. Completed replay repeats terminal and queue verification before returning the stored receipt.

## Terminal Receipt

Success returns `attention-required`, not authoring-ready or release-ready. The receipt binds the inner plan and receipt, source claim, complete preserved queue, and exact mutation set.

All of the following remain false:

- remote mutation;
- provider mutation;
- cloud mutation;
- authoring authority;
- cloud-transition authority; and
- integration authority.

The only permitted mutation is local registered-worktree creation. Queue retirement, successor promotion, scope contraction, authoring, integration, merge, push, release, and deployment require their own repository-owned controllers and exact authorizations.

## Adapter Interface

The controller depends only on these injected capabilities:

- `readPlanEvidence()`
- `withOperationLock(...)`
- `readIntent(...)`
- `writeIntent(...)`
- `revalidate(...)`
- `runInner(...)`
- `verifyTerminal(...)`

The repository adapter owns provider projection, stable collaboration inventory reads, durable journal storage, and composition of the existing rehydration adapter. Its filtered view may hide only the exact sealed direct nonwriting, nonreserving waiters from the inner adapter's competing-claim check. The full queue remains visible and sealed at the outer boundary. Any other overlapping, active, reserving, foreign, or malformed claim remains blocking.

## Focused Proof

```sh
node --test __tests__/open-reviewed-lane-queue-preservation.test.mjs
npm run docs:check
```

The focused suite covers exact authorization, evolved successor work items, invalid queue states and identities, adaptive ledger advancement, pre/post queue drift, registered-worktree-only effects, terminal authority denial, and stable replay.
