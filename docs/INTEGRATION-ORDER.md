---
title: "Dependency-Ordered Integration Contract"
graphId: "md:dependency-ordered-integration-contract"
doc_type: "Integration Workflow Contract"
date: "2026-08-04"
lang: "en-US"
schema: "agentic-integration-order/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "provider-neutral product integration ordering and exact-canonical frontier evidence"
publish_policy: "product planning evidence only; ADLC owns repository integration; no deployment authority"
runtime_scope: "integration planning, canonical convergence, and release-frontier sealing"
runtime_claim: "deterministic model-free contract; reading or checking this document causes no repository mutation or deployment"
runtime_proof: "RUNTIME-PROOF.md"
runtime_readiness_policy: "fail-closed"
runtime_readiness_finding: "runtime-readiness-unproven"
guideline_source_version: "1.23.0"
guideline_module_version: "1.0.0"
guideline_source_revision: "76903aba2a8f8a4e693dd51de580707affb3dfdc"
guideline_source_tree: "609ef617362d4949ede63e56f92c955ebc28ce91"
guideline_source_digest: "1b0e040a3600ca3f8d92517bf42d55830e6192c0acff91fbe3a489d1d392eedd"
git_companion_digest: "7de6a1130f033bbe8fd263b5fc29b9160c96cbdf25723309996058f3de74b516"
---

# Dependency-Ordered Integration Contract

## Purpose

This contract turns a set of independently authored changes into one
deterministic integration plan. It is universal, neutral, implementation
agnostic, and modular: the core requires content identities, dependency
relationships, protected convergence evidence, and explicit state transitions,
but does not prescribe a hosting provider, branch name, deployment platform,
programming language, or agent framework.

The contract covers integration ordering. It does not grant repository mutation,
protected integration, release, publication, or deployment authority.

## Integration Unit

An Integration Unit is one immutable change identity and its minimum execution
contract:

| Field | Requirement |
|---|---|
| `unitId` | Stable identity within the plan. |
| `sourceRevision` | Immutable authored source revision. |
| `changeDigest` | Lowercase SHA-256 digest of the intended change. |
| `writeScopes` | Non-empty owned paths, resources, or semantic scopes. |
| `dependencies` | Other unit ids that must reach a successful terminal state first. |
| `kind` | `control`, `contract`, `source`, `consumer`, or `projection`. |
| `namedChecks` | Focused checks required for the unit. |
| `runtimeImpact` | Whether runtime convergence proof is required after integration. |

Unit ids and change digests are unique. Unknown dependencies, self-dependencies,
and cycles block planning.

## Integration Frontier

The Integration Frontier is the exact canonical revision plus the complete
transitive dependency closure digest against which the next operation is
evaluated. Every state transition names its base frontier. A transition based on
an older frontier is stale and fails closed.

The dependency closure includes every source, contract, configuration,
generated projection, and locked dependency that affects the integrated result.
Moving any member creates a new frontier even when the local unit is unchanged.

## Unit States

| State | Meaning |
|---|---|
| `pending` | Not yet reconciled against the current frontier. |
| `already-integrated` | The current frontier already contains an equivalent change, proven by an equivalence check digest. |
| `superseded` | The current frontier contains a replacement that covers the unit capability, proven by equivalence and capability-coverage digests. |
| `integrated` | The unit advanced the protected canonical frontier and recorded its receipts. |
| `blocked` | A named prerequisite or check failed; downstream mutation stops. |

`already-integrated`, `superseded`, and `integrated` are successful terminal
states. Reintegrating a terminal unit is forbidden. A no-op or supersession is
an evidence-backed disposition, never a guess based on names or timestamps.

## Deterministic Planning Algorithm

1. Normalize and sort units by stable id.
2. Reject duplicate ids, duplicate change digests, missing dependencies,
   self-dependencies, and cycles.
3. Build a directed acyclic graph from dependency to consumer.
4. Select only pending units whose dependencies are successful.
5. Form the next wave from selected units with pairwise-disjoint write scopes.
6. Order each wave by stable unit id.
7. Before each unit transition, compare its base revision with the current
   Integration Frontier.
8. After protected integration, replace the frontier revision and dependency
   closure digest with the protected result.
9. Recompute the remaining waves; never replay a stale precomputed order.

Control, shared-contract, and source-owner units naturally precede their
consumers because consumers declare them as dependencies. Unit kind is
descriptive and must not replace explicit dependency edges.

Disjoint units may run in the same wave. Overlapping write scopes serialize in
stable order even when they have no declared dependency. Parallel execution does
not permit shared ownership, mutable handoffs, or unjoined evidence.

## Exact-Canonical Gate

An integration operation must record:

- its current base frontier revision;
- the new protected canonical revision;
- the complete dependency closure digest;
- a protected integration receipt digest;
- an exact-canonical checks digest;
- a runtime convergence digest when `runtimeImpact` is true.

The protected revision must advance the frontier. A source-only unit rejects a
runtime digest because evidence must remain proportional to impact. A
runtime-impact unit without runtime convergence evidence remains blocked.

The plan digest is SHA-256 over the normalized frontier, units, states, evidence,
and computed waves. Consumers verify it before accepting or changing a plan.

## Recovery

Failure preserves authored units and the last valid frontier. Recovery starts
from a newly observed canonical frontier, revalidates ownership and dependency
closure, and recomputes the plan. It must not force-push, rewrite unrelated
history, reuse a stale receipt, hide a failed check, or apply a downstream alias
for a source-owner conflict.

## Release Frontier

A release frontier may be sealed only when:

- every unit is `already-integrated`, `superseded`, or `integrated`;
- the supplied canonical revision and dependency closure equal the current
  Integration Frontier;
- exact-canonical checks have a content digest;
- runtime convergence has a digest when any unit affects runtime;
- the seal binds the plan digest and all unit dispositions.

The seal is an immutable candidate input. It is not release authorization and
does not deploy, publish, or mutate any target.

## Cross-Repository Lifecycle Boundary

This contract orders product integration units and computes disjoint dependency
waves. It owns no repository claim, worktree, branch, lease, review request,
integration, retirement, canonical synchronization, or cleanup operation. Each
repository executes its own pinned ADLC start and release workflows. A product
dependency edge transfers evidence only; it never transfers lifecycle authority.

## Evidence and Findings

Minimum findings are:

- `integration-order-cycle`
- `integration-before-dependency`
- `canonical-frontier-unverified`
- `duplicate-change-reintegrated`
- `stale-candidate-frontier`

Every finding identifies the plan, affected unit, observed frontier, expected
condition, and blocking result. Human-readable summaries may accompany the
structured evidence but cannot replace it.

## Agentic Canvas OS Reference Implementation

This repository maps the neutral product-planning contract to ADLC-owned
repository evidence without implementing that lifecycle:

| Neutral concept | Reference implementation |
|---|---|
| Integration Unit ownership | One registered ADLC worktree, semantic scope, branch, source revision, and named focused checks established by the pinned ADLC start workflow. |
| Integration Frontier | Caller-supplied protected revision plus the paired application, documentation, catalog, policy, and locked-dependency closure. |
| Protected integration receipt | Opaque current evidence returned by the pinned ADLC release workflow. |
| Exact-canonical checks | Product checks bound to the accepted frontier; remote refresh and repository synchronization remain ADLC-owned. |
| Runtime convergence | The repository-owned canonical runtime handoff and exact visible revision proof required by the lifecycle. |
| Release frontier | A sealed input to the pinned ADLC release workflow; still subject to candidate review and authenticated release authorization. |

For multiple units, create the product plan before repository delivery. Record
only evidence-backed `already-integrated`, `superseded`, or `integrated`
dispositions, then recompute the next wave from the current product frontier.
The installed ADLC release workflow remains the sole owner of candidate review,
protected integration, canonical reconciliation, and cleanup receipts.

The executable owner is `scripts/integration-order-contract.mjs`; focused tests
are in `__tests__/integration-order-contract.test.mjs`. The executable is pure:
it validates and returns frozen records, and performs no filesystem, network,
repository, merge, release, or deployment mutation.

The `guideline_source_revision` and `guideline_source_digest` frontmatter values
bind this adapter to its reviewed guideline source and exact bytes.
A squash, rebase, or other protected merge may change the source revision even
when its content is equivalent; equivalence must be recorded explicitly rather
than inferred. Source drift returns this module to `blocked` until the exact
source and focused evidence are revalidated.

## Validation

Run:

```sh
npm run integration-order:check
```

The check proves deterministic plan identity, dependency ordering, disjoint
waves, cycle and duplicate rejection, stale-frontier rejection, evidence-backed
no-op and supersession, runtime convergence requirements, plan-integrity
validation, release-frontier sealing, neutral-core separation, and immutable
guideline-source provenance. `runtime-ready` applies only to this pure local
contract at the bound source revision; it does not claim protected integration,
canonical runtime convergence, release authorization, publication, or deployment.

## VCC

| Field | Requirement |
|---|---|
| Variables | Immutable units, current canonical revision, dependency closure, unit states, receipts, runtime impact, release frontier. |
| Constraints | DAG ordering, unique change identity, disjoint write scopes per wave, dependencies first, fresh frontier per transition, proportional evidence, no deployment authority. |
| Checks | `npm run integration-order:check`, focused owner checks, exact-canonical checks, runtime convergence when applicable, sealed release-frontier validation. |
