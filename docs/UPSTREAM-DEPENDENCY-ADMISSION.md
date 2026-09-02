---
title: "Upstream Dependency Admission Runtime"
graphId: "md:upstream-dependency-admission-runtime"
doc_type: "Runtime Contract"
date: "2026-07-30"
lang: "en-US"
schema: "agentic-upstream-dependency-admission/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "provider-neutral upstream dependency admission and bounded continuation"
publish_policy: "protected integration followed by exact-revision explicitly owned non-production deployment only"
runtime_scope: "authenticated application dependency admission, consumer-closure isolation, and disjoint-work continuation"
runtime_claim: "deterministic model-free evaluator behind a bounded authenticated application route; evaluator performs no filesystem, network, repository, release, or deployment mutation"
runtime_proof: "RUNTIME-PROOF.md"
runtime_readiness_policy: "fail-closed"
runtime_readiness_finding: "runtime-readiness-unproven"
guideline_source_version: "1.7.0"
guideline_module_version: "1.0.0"
guideline_source_revision: "389c24aa0d292d292334ce020703b83c8ea55cb6"
guideline_module_digest: "08fc3a2e4525b4a39611167eba6ac11fe4895205d86b6d4005ea1ad17685dad7"
---

# Upstream Dependency Admission Runtime

## Purpose

Prevent a separately owned or not-yet-protected prerequisite from stopping
unrelated work. The runtime admits upstream dependencies before dependent
dispatch, computes the exact affected consumer closure, and continues units
outside that closure.

Prevention is never bypass. The runtime cannot adopt source, infer ownership,
weaken checks, generate a premature projection, integrate, publish, release, or
deploy.

## Typed Input

`evaluateUpstreamDependencies` accepts:

| Field | Type | Requirement |
|---|---|---|
| `evaluationTime` | ISO-8601 instant | Fixed evaluation time; never read implicitly from the clock. |
| `units` | plan unit array | Unique ids, known dependencies, and an acyclic graph. |
| `dependencies` | admission record array | Complete source, owner, fence, evidence, consumer, deadline, fallback, and projection intent. |
| `requestedPlanStop` | boolean | Whether a caller proposes stopping the complete plan. |

Each admission record uses exact source and fence revisions, a SHA-256 closure
digest, named check results, one or more observed owners, direct consumers, a
finite deadline, and an explicit `defer`, `omit`, or protected-equivalent
fallback.

## Typed Output

The frozen `agentic-upstream-dependency-admission-result/v1` result contains:

- one deterministic `eligible`, `deferred`, `blocked`, or `superseded` decision
  per dependency;
- exact waiting and omitted transitive consumer closures;
- units outside those closures that remain ready to continue;
- the earliest finite re-evaluation instant;
- sorted typed findings; and
- a SHA-256 evidence digest over the normalized result.

A `blocked` decision is a valid domain result. The evaluator fails only for a
structurally invalid input contract.

## Decision Rules

- Protected source becomes `eligible` only when exactly one non-overlapping
  owner, current source evidence, and all named checks join
- A projection request is admitted only after that protected-source eligibility
  decision; projection intent cannot promote source state
- A candidate becomes `deferred` only before its finite deadline
- Local-only or missing source remains `blocked`
- Projection requested from anything except protected source raises
  `upstream-projection-premature`
- A stale evidence revision or non-passing check raises
  `upstream-evidence-stale`
- After a deadline, `omit` removes the affected closure, a protected equivalent
  supersedes it, and `defer` fails with `upstream-wait-unbounded`
- A requested plan-wide stop while ready units remain raises
  `upstream-plan-overblocked`

## Runtime Bounds and Cost

The evaluator is model-free and side-effect-free. It reads only its in-memory
input and performs no provider call, paid call, filesystem access, network
access, repository mutation, process launch, publication, or deployment.

For `U` plan units, `D` admission records, and `E` dependency edges, execution
is bounded by graph validation and closure traversal. Cost is local CPU and
memory only; external monetary cost is zero. Invalid structure fails before a
decision is emitted.

## Findings

| Finding | Severity |
|---|---|
| `upstream-source-unadmitted` | blocker |
| `upstream-owner-ambiguous` | blocker |
| `upstream-wait-unbounded` | blocker |
| `upstream-projection-premature` | blocker |
| `upstream-evidence-stale` | blocker |
| `upstream-fallback-invalid` | major |
| `upstream-plan-overblocked` | major |

## Agentic Canvas OS Reference Implementation

The executable owner is
`agent-api/src/upstream-dependency-admission.js`; focused pure-runtime proof is
`__tests__/upstream-dependency-admission.test.mjs`. The implementation maps the
neutral contract into frozen JavaScript records without changing its vocabulary
or authority boundary.

## Application Runtime

The application exposes
`POST /api/upstream-dependency-admission/evaluate` through the existing
Agent-API and Cloudflare Worker. It requires the existing session Bearer token
and accepts at most 512 KiB of JSON.

- `200` returns any structurally valid domain result, including `blocked`
- `400` rejects invalid JSON or invalid admission structure with a typed code
- `401` rejects a missing, invalid, or expired session
- `405` rejects unsupported methods
- `413` rejects a body over the fixed limit
- `501` fails closed when session authentication is not configured

`GET /api/ready` exposes only sanitized route, authentication, source,
continuation, mutation, and model-free execution metadata. It never exposes the
session signing secret.

The guideline revision and module digest bind this implementation to exact
protected source bytes. Any source, implementation, dependency, or focused-proof
drift invalidates this runtime claim until the bound evidence is regenerated and
the focused check passes again.

## Validation

Run:

```sh
npm run upstream-dependency-admission:check
npm run upstream-dependency-admission:application:check
```

The checks cover the pure decisions plus authenticated HTTP routing, sanitized
readiness, valid blocked responses, disjoint continuation, invalid structure,
unsupported methods, and fail-closed missing authentication.

## Dev Deployment

Deployment is a separate product gate. Run only from a clean canonical `main`
at the exact protected source revision accepted through ADLC:

```sh
npm run upstream-dependency-admission:deploy:dev
```

The command reruns application proof and the web build, then invokes the pinned
Wrangler dependency for the `dev` environment with `--keep-vars` and `--strict`.
It preserves remote variables and secrets that this model-free endpoint does
not own and fails on conflicting remote configuration. It cannot deploy an
Agentic Canvas OS production Worker; production remains owned by the protected
consumer product-deployment owner.

`runtime-ready` applies to the evaluator and application route at the recorded
protected source revision. It does not promote evaluated dependencies or
consumers, and it does not establish deployment until an exact-revision Dev
version and live authenticated response are recorded.

## VCC

| Field | Requirement |
|---|---|
| Variables | Fixed evaluation time, plan DAG, dependency records, immutable revisions and digests, deadlines, fallbacks, projection intent. |
| Constraints | Exact identities, one owner, acyclic plan, protected-source projection, bounded deferral, consumer-closure isolation, no authority expansion. |
| Checks | Focused evaluator and application suites, authenticated Worker route, sanitized readiness, documentation contract, neutral-core scan, exact protected guideline revision and digest, exact-main Dev deployment guard. |
