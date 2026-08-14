---
title: "Provider-Neutral Collaborative Runtime Lifecycle"
graphId: "md:provider-neutral-collaborative-runtime-lifecycle"
doc_type: "Lifecycle Contract"
date: "2026-08-14"
lang: "en-US"
schema: "canonical-runtime-lifecycle/v7"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "provider-neutral multi-user, multi-device, parallel authoring, integration, review, authorization, deployment, verification, and rollback semantics"
publish_policy: "protected integration creates no forward-deployment authority; one exact-candidate authenticated human decision is required"
runtime_scope: "source, dependency, policy, review, build, readiness-bound authorization prompting, authorization interaction, authority, target, deployment, verification, publication, and rollback adapters"
runtime_claim: "fenced collaboration, runtime-ready review binding, and joined immutable receipts prevent mutable-ref, cross-device, parallel-controller, and authorization drift"
runtime_proof: "RUNTIME-PROOF.md"
---

# Provider-Neutral Collaborative Runtime Lifecycle

## Authority

The canonical protected source ref at the shared remote is the only cross-user
and cross-device source authority. Local checkouts, worktrees, caches, running
processes, review hosts, branch labels, environment labels, and deployment
timestamps are not source identity. Every participant fetches the authority
independently and compares exact immutable object identities.

This document owns protocol semantics. Source-control, review, build,
authorization-interaction, authority, hosting, and publication products are
replaceable adapters. An adapter is
conforming only when it preserves the identities, receipts, human boundary,
fences, idempotency, drift checks, and fail-closed results defined here.

Protected integration proves integration only. Candidate preparation may start
after verified integration and review, but forward deployment remains closed
until an authenticated human authorizes the exact candidate and target.

## Universal and Adaptive Composition

Lifecycle vocabulary describes capabilities, evidence, transitions, and
authority boundaries. It never depends on a named inference model, agent
product, prompt dialect, vendor, tool, transport, or interface. A conforming
profile may use any inference model or no inference model. Model and provider
metadata is optional observation evidence; it never creates authority or
changes receipt semantics.

Before candidate sealing, each profile declares its required capabilities,
proof surfaces, and versioned decision policy. Adaptive routing, concurrency,
retry, and fallback choices must be bounded by that policy, deterministic for
identical evidence, recorded in digest-bound evidence, and rejected when a
required capability is missing or a downgrade would weaken the profile.

Each adapter owns one responsibility and composes with other adapters only
through typed, closed receipts. The canonical source owner defines each
semantic term once. Duplicate semantic owners, semantic aliases, and
compatibility shims that redefine, bypass, or weaken canonical receipt or
authority semantics are forbidden. Profile-level route names may alias
transports only when they preserve those semantics exactly. Authored lifecycle
contract and runtime implementation files remain fewer than 600 lines; split a
module by responsibility before it reaches that limit.

## Collaboration Identity and Parallelism

Every mutation lane carries this complete identity:

```text
Actor ID
+ Device ID
+ Session ID
+ Worktree ID
+ Branch ID
+ Semantic Scope ID
+ Lease Epoch
+ Fence Revision
```

- Actor, device, session, worktree, branch, and scope are independent
  dimensions; equality in one never implies ownership of another.
- Multiple users, devices, sessions, and worktrees may proceed in parallel only
  when their declared write sets are disjoint and each lane has a current
  lease, monotonic epoch, immutable fence revision, and shared ownership record.
- The same semantic scope, branch, worktree, or artifact serializes. A stale
  writer cannot regain authority from an old lease, local checkout, or process.
- A handoff is valid only after the sender stops and publishes an exact immutable
  revision plus joined evidence. Mutable filesystem transfer is not a handoff.
- Post-baseline authored state stays with its physical lane. Cleanup may remove
  only state whose exact ownership, integration, and retention proof is closed.
- Before convergence, every pre-existing non-canonical work item is inventoried
  by owner, write set, state digest, overlap class, preservation mode, and opaque
  recovery handle. No controller may erase, adopt, or hide it to create cleanliness.
- Overlapping work remains retained in its owning lane or immutable recovery
  object. Disjoint work may be restored only when its state and recovery identity
  still match exactly; ambiguity keeps it retained and blocks the affected scope.
- Integration revalidates the remote fence, scope ownership, declared paths,
  protected checks, and immutable head immediately before mutation.

## Immutable Receipt Chain

| Receipt | Required identity | Authority created |
|---|---|---|
| `Overlap Preservation Receipt` | Convergence base, protected tip, capture adapter, and every observed work item's collaboration tuple, write-set digest, state digest, recovery handle, preservation mode, overlap class, time, and receipt digest | Preservation disposition may be evaluated; no integration, review, or deployment authority |
| `Overlap Disposition Receipt` | Preservation Receipt digest and an exact retained-or-restored observation for every preserved item | Protected convergence may proceed when all work is accounted for |
| `Integration Receipt` | Preservation and Disposition Receipt digests, canonical source revision and tree, full dependency-closure digest, protected checks, evaluator, collaboration tuple, integration target, and receipt digest | Authoring closes; controlled review may begin |
| `Runtime Review Receipt` | Integration Receipt digest, controlled review-surface identity, source and dependency closure, policy digest, probes, reviewer identity, issue time, and expiry | Candidate preparation may begin |
| `Candidate Manifest` | Runtime Review Receipt digest, source and transitive dependencies, policy and target digests, artifact digest, immutable-manifest digest, rollback target, and candidate digest | One immutable candidate exists |
| `Authorization Interaction Receipt` | Candidate and target digests, authenticated human actor, interaction-adapter identity, transport class, declared browser dependency, challenge and response digests, observation time, and receipt digest | A human interaction is observed; no deployment authority |
| `Human Authorization Receipt` | Authorization Interaction Receipt, candidate, and target digests; authenticated human decision reference; authority-adapter identity; issue time; expiry; consumption state; and receipt digest | One forward deployment attempt may begin |
| `Deployment Receipt` | Consumed Authorization Receipt digest, controller fence, deployed artifact, immutable deployment identity, target, and receipt digest | Live verification may begin |
| `State Reconciliation Receipt` | Deployment Receipt digest, state-contract digest, bounded operations, direct readback, counts, content parity, and receipt digest | State compatibility is proven for this deployment |
| `Live Verification Receipt` | Deployment and State Reconciliation Receipt digests, deployed artifact and target identities, immutable-origin probes, public-route probes, observed runtime identity, client-cache convergence, rollback target, and receipt digest | The candidate is live and verified |
| `Publication Receipt` | Live Verification Receipt digest and exact downstream mirror or publication identities | Downstream publication closes |
| `Rollback Receipt` | Failed stage, last-known-good identity, restored deployment and state disposition, probes, terminal result, and receipt digest | Recovery closes without creating forward authority |

Every receipt is typed, immutable, content-addressed, and joined to its
predecessor by digest. Missing or unknown identity fields fail closed.
Preservation proves recoverability only and cannot substitute for integration,
runtime review, or authorization. Runtime review and deployment authorization
are distinct human decisions; neither source review nor a successful build
grants forward-deployment authority.

The interaction adapter and authority adapter are independent modules. A
transport can present and return the exact candidate challenge but cannot grant
authority; the authority adapter can accept a human decision only when the
joined interaction evidence identifies the same human, candidate, and target.
Transport names and products are profile facts, not universal protocol terms.

An authorization prompt is eligible only while the controlled review surface
still reports runtime-ready for the exact Integration Receipt and Candidate
Manifest. It must present the candidate digest, canonical source revision,
release-run reference, controlled review-surface locator, and one exact
candidate-bound response. Prompt presentation creates no authority. Any missing
field, failed probe, expired review, or identity drift blocks the prompt and
requires a fresh runtime review before another human decision.
The local canonical release-owner checkout must remain attached to that same
exact protected revision from prompt preparation through authorization
interaction; a branch flip, repurposed checkout, or local-ref drift in that
owner invalidates the prompt and fails closed.
Terminal interaction adapters that automate the response must capture the exact
printed candidate-bound reply first, then wait for the live input prompt, and
only then send that exact reply. Any reordered or promptless submission fails
closed and creates no authorization evidence.

## End-to-End State Machine

| State | Required transition | Fail-closed invariant |
|---|---|---|
| **Authored** | Fenced task lanes produce verified changes against a declared scope | Unleased, stale-fenced, overlapping, or unexplained mutation cannot integrate |
| **Preserved** | Capture all pre-existing non-canonical work and account for every item as retained or exactly restored | Missing ownership, bytes, write-set, fence, recovery identity, or disposition blocks convergence; overlapping work cannot be auto-restored |
| **Integrated** | Required checks pass and exact reviewed changes converge into the canonical protected source ref | Bypass, mutable head, or unjoined dependency state emits no Integration Receipt |
| **Reviewed** | An operator-controlled surface runs the exact integrated source and full pinned dependency closure | Task-lane, stale-process, dependency, policy, check, or probe mismatch emits no Runtime Review Receipt |
| **Prepared** | Build once and bind review, complete source/dependency closure, policy, target, artifact, manifest, and rollback identities | Mutable refs, labels, timestamps, unresolved dependencies, and "latest" selectors are invalid identity |
| **Awaiting authorization** | A replaceable interaction adapter presents the exact candidate and target challenge without mutating the target | Merge, push, schedule, agent action, prior approval, review, or transport activity cannot substitute for a human decision |
| **Authorized** | An authenticated human authorizes the exact candidate digest for the exact target and the authority adapter joins that decision to the interaction receipt | Authorization is absent by default, actor-bound, target-specific, expiring, non-transferable, and single-consumption |
| **Deployed** | Zero drift is revalidated and the already-built bytes deploy under one target-scoped fence | Rebuild, dependency resolution, retargeting, or source selection after authorization is forbidden |
| **State reconciled** | Bounded compatible state operations complete with direct authoritative readback | Ambiguous, destructive, unreadable, or parity-mismatched state blocks live verification |
| **Verified** | Live identity and critical probes match the authorization and Candidate Manifest | Failed or ambiguous proof triggers recovery and leaves publication closed |
| **Published** | Only the exact Live Verification Receipt is projected to downstream mirrors or surfaces | Publication cannot lead live verification |
| **Rolled back** | The recorded immutable last-known-good deployment is restored and re-probed | Rollback authority never grants forward-deployment authority |

## Controller Concurrency and Replay

The release idempotency key is the target digest plus candidate digest. Exactly
one controller may hold the target-scoped deployment fence. A duplicate dispatch
with the same key coalesces onto the same durable result; a competing candidate,
controller, or target mutation is rejected. Retries resume from receipts and
never rebuild or double-apply a completed stage.

Candidate preparation may run in parallel for different targets or candidates.
Forward deployment to one target serializes even when authoring, review, and
build work occurred on different users, devices, sessions, or providers.
Authorization consumption and terminal result are durable before controller
ownership is released.

## Drift Invalidation

Immediately invalidate review, candidate, or authorization evidence when any of
these identities changes:

- canonical source revision or tree;
- any direct or transitive runtime, build, catalog, schema, or data dependency;
- collaboration fence, integrated scope, preserved-work state, recovery identity,
  overlap class, or preservation disposition;
- policy, interaction-adapter, interaction transport, declared browser
  dependency, authority-adapter, target configuration, or rollback target;
- review, artifact, immutable-manifest, candidate, or predecessor-receipt digest;
- interaction challenge, response, actor, or receipt digest; or authorization
  status, expiry, target, decision identity, or consumption state.
- local canonical release-owner checkout branch, attached protected revision, or
  authorization-prompt handshake state.

Revalidate the canonical source and complete dependency closure immediately
before deployment. A rebuild from unchanged source is still a new candidate.
Source advancement while authorization waits requires a new review, candidate,
and human decision. Expired, malformed, unjoined, machine-generated, replayed,
consumed, or target-mismatched authorization fails closed.
A waiting run superseded by a newer protected source revision is retired
without authorization consumption. The next attempt must refresh the canonical
review owner to that exact protected revision and emit a new candidate digest
before another human decision.

## Production Proof Surfaces

Production verification keeps transport claims separate:

| Proof surface | Claim |
|---|---|
| Controlled review surface | The exact integrated runtime closure was reviewed |
| Immutable deployment origin | The sealed artifact was deployed and observed |
| Public target route | Routing, edge policy, caching, and public behavior work |
| Authoritative state readback | Stored state matches the state contract |
| Browser client | User-visible behavior and persisted client state converge |
| Publication mirror | The verified release identity was projected downstream |

No surface substitutes for another. A successful immutable origin cannot claim
public routing. A successful public route cannot prove state readback. A mirror
cannot prove deployment. Profiles declare the required surfaces, and each emits
operation-derived evidence joined to the same candidate.

Probe the immutable deployment origin before public aliases. Separately verify
every required public route. When the target serves an identity marker through
multiple transports, require byte-identical marker bytes for the same release.
Where prior client bytes can survive promotion, require returning-client cache
or service-worker convergence to the authorized source identity without
removing unrelated client storage.

Stateful promotion uses bounded idempotent expand, migrate, and contract
operations with direct authoritative readback. Record expected and observed
counts plus content or path-hash parity. Code rollback and state rollback remain
separate dispositions because restoring code does not reverse state.

Terminal cleanup removes only clean, integrated, completion-proven task lanes.
Active, parked, dirty, divergent, ambiguous, and unrelated lanes remain
preserved. A release is not terminal until controller, verification,
publication or rollback, receipt persistence, and cleanup dispositions are all
recorded.

## Runtime-Ready Acceptance

Runtime readiness requires:

- one exact joined receipt chain through the highest claimed stage;
- exact accounting for every pre-existing non-canonical work item, with
  overlapping work retained and every recovery handle still resolvable;
- a clean canonical checkout at the fetched protected source identity;
- current leases and fences for all contributing scopes;
- reproducible dependency resolution and build output;
- complete source, dependency, policy, target, artifact, and manifest identity;
- one joined Authorization Interaction Receipt and authenticated human
  authorization for the deployed candidate and target;
- one target-scoped deployment controller with durable idempotency evidence;
- one Deployment Receipt and, where state is present, one State Reconciliation
  Receipt with direct authoritative readback;
- successful immutable-origin, required public-route, browser, client-cache,
  health, critical-path, and observed-identity proof for the declared profile;
- a retained immutable rollback target and successful rollback probe when used;
- publication after live verification and ownership-safe cleanup disposition;
- no unexplained spend, secret exposure, cross-scope mutation, mirror lead, or
  authorization drift.

Absent identity, ambiguous ownership, stale fences, failed checks, failed probes,
duplicate controllers, incomplete dependency closure, or authorization drift
reports `blocked`; prose, local state, and provider success labels cannot report
`runtime-ready`.

## Ownership

| Concern | Owner |
|---|---|
| Universal lifecycle semantics and receipt chain | This document |
| Task activation, leases, fences, and handoff | Session-start contract |
| Integration, candidate, deployment, verification, and rollback stage detail | Release workflow contract |
| Concrete source-control, review, approval, build, hosting, and mirror behavior | Reference implementation adapters |
| Human decision interaction transport | Replaceable Interaction Adapter |
| Human forward-deployment decision | Authenticated Operator |

## VCC

Given fenced authoring lanes across multiple actors, devices, sessions, and
worktrees, including safely retained overlapping work, when preservation and
disposition receipts account for every observed item and protected integration
emits one exact Integration Receipt,
an operator reviews the exact dependency closure, a controller builds one
immutable candidate, and an authenticated human authorizes that candidate for
the target, then exactly one idempotent controller deploys the same bytes,
proves live identity, publishes only after verification, and leaves every
participant able to converge independently. Any loss, unsafe restoration, scope
collision, stale fence, dependency, policy, target, artifact, authorization,
controller, or live-proof drift fails closed or restores the last-known-good
deployment.
