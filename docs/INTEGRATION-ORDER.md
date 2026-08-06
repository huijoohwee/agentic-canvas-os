---
title: "Dependency-Ordered Integration Contract"
graphId: "md:dependency-ordered-integration-contract"
doc_type: "Integration Workflow Contract"
date: "2026-08-04"
lang: "en-US"
schema: "agentic-integration-order/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "provider-neutral integration ordering and exact-canonical frontier advancement"
publish_policy: "authoring and protected integration only; no deployment authority"
runtime_scope: "integration planning, canonical convergence, and release-frontier sealing"
runtime_claim: "deterministic model-free contract; reading or checking this document causes no repository mutation or deployment"
runtime_proof: "RUNTIME-PROOF.md"
runtime_readiness_policy: "fail-closed"
runtime_readiness_finding: "runtime-readiness-unproven"
guideline_source_version: "1.14.0"
guideline_module_version: "1.0.0"
guideline_source_revision: "8a2e5e0711f7193535b9aac2aee285e0ee705111"
guideline_source_tree: "63c13dcfb3ce01aa60213f4f6fa214bfa0e76778"
guideline_source_digest: "ff4f0dc41209bdacb05001b6fd5a450883736118f89fcff6fab331cedca8c2bd"
git_companion_digest: "c8831f6c6642f89c3e5f51af55523e1e4db1ed08b118840daa0d4f28289806e5"
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

## Cross-Repository Coordination Task

A cross-repository coordination task is a dependency-ordered directed acyclic
graph of immutable per-repository work units. Each unit retains its own
repository, branch, registered worktree, semantic scope, normalized write set
and digest, authenticated claim, authority epoch, fence, review request, source
revision and digest, named checks, and handoff evidence. The group identity is
correlation only: it must not become a shared branch, worktree, lease, claim,
fence, review request, or mutable evidence record.

Every unit is admitted and continued independently through the four
provider-neutral root operations `claim(scope)`, `continue(claim)`,
`integrate(candidate)`, and `retire(claim)`. Disjoint units may progress in the
same dependency wave without a global concurrency cap. Within one repository,
path-prefix overlap serializes work even when an explicit dependency edge is
absent. A waiting successor retains only its ordered non-writing request, while
`dormant-preserved` retains its scope reservation until continuation or retirement.

An edge means the consumer's integration receipt must bind the predecessor's
exact terminal evidence. It does not transfer authority. A candidate advances
only after every dependency is exact, its immutable review identity and
revision still match, named checks pass, handoff evidence resolves, and the
current monotonic compare-and-swap succeeds.

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

This repository maps the neutral contract to its existing lifecycle without
changing the core:

| Neutral concept | Reference implementation |
|---|---|
| Integration Unit ownership | One leased task worktree, semantic scope, branch, source revision, and named focused checks established by `START-WORKFLOW.md`. |
| Integration Frontier | Fetched protected revision plus the paired application, documentation, catalog, policy, and locked-dependency closure. |
| Protected integration receipt | The successful, fenced `device:integrate` result and protected checks. |
| Exact-canonical checks | Checks rerun against fetched protected state, never inferred from a task branch result. |
| Runtime convergence | The repository-owned canonical runtime handoff and exact visible revision proof required by the lifecycle. |
| Release frontier | A sealed input to `RELEASE-WORKFLOW.md`; still subject to candidate review and authenticated release authorization. |

The canonical source unit is JH `huijoohwee.github.io` revision
`8a2e5e0711f7193535b9aac2aee285e0ee705111`, tree
`63c13dcfb3ce01aa60213f4f6fa214bfa0e76778`, guideline digest
`ff4f0dc41209bdacb05001b6fd5a450883736118f89fcff6fab331cedca8c2bd`,
and git-companion digest
`c8831f6c6642f89c3e5f51af55523e1e4db1ed08b118840daa0d4f28289806e5`.
Its immutable unit is the predecessor of the ACOS runtime and registration
unit: `JH guideline/checker -> ACOS coordination/runtime/registration`. Source
drift blocks the consumer before mutation.

Repository lifecycle wrappers are replaceable projections. Start and resume
map to `claim(scope)` or `continue(claim)`; review binds immutable evidence
through `continue(claim)`; protected delivery maps to `integrate(candidate)`;
terminal cleanup becomes eligible only after `retire(claim)` and independent
protected convergence proof. No wrapper creates another root operation or
derives absent operator authority.

For multiple units, create the plan before integration. Integrate successful
dependency waves first, fetch the protected revision after every advancement,
record evidence-backed `already-integrated` or `superseded` dispositions, and
recompute the next wave from the new frontier. An exact branch name, open pull
request, green task-branch check, or local runtime response is not
exact-canonical evidence.

The executable owner is `scripts/integration-order-contract.mjs`; focused tests
are in `__tests__/integration-order-contract.test.mjs`. The executable is pure:
it validates and returns frozen records, and performs no filesystem, network,
repository, merge, release, or deployment mutation.

The `guideline_source_revision` and `guideline_source_digest` frontmatter values
bind this adapter to the fetched protected guideline source and its exact bytes.
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
