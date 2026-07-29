---
title: "Provider-Neutral Collaborative Runtime Lifecycle"
graphId: "md:provider-neutral-collaborative-runtime-lifecycle"
doc_type: "Lifecycle Contract"
date: "2026-07-29"
lang: "en-US"
schema: "canonical-runtime-lifecycle/v3"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "provider-neutral multi-user, multi-device, parallel authoring, integration, review, authorization, deployment, verification, and rollback semantics"
publish_policy: "protected integration creates no forward-deployment authority; one exact-candidate authenticated human decision is required"
runtime_scope: "source, dependency, policy, review, build, authorization, target, deployment, verification, publication, and rollback adapters"
runtime_claim: "fenced collaboration and joined immutable receipts prevent mutable-ref, cross-device, parallel-controller, and authorization drift"
runtime_proof: "RUNTIME-PROOF.md"
---

# Provider-Neutral Collaborative Runtime Lifecycle

## Authority

The canonical protected source ref at the shared remote is the only cross-user
and cross-device source authority. Local checkouts, worktrees, caches, running
processes, review hosts, branch labels, environment labels, and deployment
timestamps are not source identity. Every participant fetches the authority
independently and compares exact immutable object identities.

This document owns protocol semantics. Source-control, review, build, approval,
hosting, and publication products are replaceable adapters. An adapter is
conforming only when it preserves the identities, receipts, human boundary,
fences, idempotency, drift checks, and fail-closed results defined here.

Protected integration proves integration only. Candidate preparation may start
after verified integration and review, but forward deployment remains closed
until an authenticated human authorizes the exact candidate and target.

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
| `Human Authorization Receipt` | Candidate digest, target digest, authenticated human decision reference, authority-adapter identity, issue time, expiry, consumption state, and receipt digest | One forward deployment attempt may begin |
| `Live Verification Receipt` | Authorization Receipt digest, deployed artifact and target identities, observed runtime identity, health and critical-path probes, rollback target, and receipt digest | The candidate is live and verified |
| `Publication Receipt` | Live Verification Receipt digest and exact downstream mirror or publication identities | Downstream publication closes |

Every receipt is typed, immutable, content-addressed, and joined to its
predecessor by digest. Missing or unknown identity fields fail closed.
Preservation proves recoverability only and cannot substitute for integration,
runtime review, or authorization. Runtime review and deployment authorization
are distinct human decisions; neither source review nor a successful build
grants forward-deployment authority.

## End-to-End State Machine

| State | Required transition | Fail-closed invariant |
|---|---|---|
| **Authored** | Fenced task lanes produce verified changes against a declared scope | Unleased, stale-fenced, overlapping, or unexplained mutation cannot integrate |
| **Preserved** | Capture all pre-existing non-canonical work and account for every item as retained or exactly restored | Missing ownership, bytes, write-set, fence, recovery identity, or disposition blocks convergence; overlapping work cannot be auto-restored |
| **Integrated** | Required checks pass and exact reviewed changes converge into the canonical protected source ref | Bypass, mutable head, or unjoined dependency state emits no Integration Receipt |
| **Reviewed** | An operator-controlled surface runs the exact integrated source and full pinned dependency closure | Task-lane, stale-process, dependency, policy, check, or probe mismatch emits no Runtime Review Receipt |
| **Prepared** | Build once and bind review, complete source/dependency closure, policy, target, artifact, manifest, and rollback identities | Mutable refs, labels, timestamps, unresolved dependencies, and "latest" selectors are invalid identity |
| **Awaiting authorization** | Candidate preparation completes without mutating the target | Merge, push, schedule, agent action, prior approval, or review cannot substitute for a human decision |
| **Authorized** | An authenticated human authorizes the exact candidate digest for the exact target | Authorization is absent by default, target-specific, expiring, non-transferable, and single-consumption |
| **Deployed** | Zero drift is revalidated and the already-built bytes deploy under one target-scoped fence | Rebuild, dependency resolution, retargeting, or source selection after authorization is forbidden |
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
- policy, authority-adapter, target configuration, or rollback target;
- review, artifact, immutable-manifest, candidate, or predecessor-receipt digest;
- authorization status, expiry, target, decision identity, or consumption state.

Revalidate the canonical source and complete dependency closure immediately
before deployment. A rebuild from unchanged source is still a new candidate.
Source advancement while authorization waits requires a new review, candidate,
and human decision. Expired, malformed, unjoined, machine-generated, replayed,
consumed, or target-mismatched authorization fails closed.

## Runtime-Ready Acceptance

Runtime readiness requires:

- one exact joined receipt chain through the highest claimed stage;
- exact accounting for every pre-existing non-canonical work item, with
  overlapping work retained and every recovery handle still resolvable;
- a clean canonical checkout at the fetched protected source identity;
- current leases and fences for all contributing scopes;
- reproducible dependency resolution and build output;
- complete source, dependency, policy, target, artifact, and manifest identity;
- one authenticated human authorization for the deployed candidate and target;
- one target-scoped deployment controller with durable idempotency evidence;
- successful live health, critical-path, and observed-identity proof;
- a retained immutable rollback target and successful rollback probe when used;
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
| Human forward-deployment decision | Authenticated Operator |

## Reference Implementation Mapping

The current Agentic Canvas OS / Knowgrph profile maps the neutral protocol as
follows. These names are implementation facts, not universal lifecycle terms.

| Neutral term | Current reference implementation |
|---|---|
| Canonical protected source ref | GitHub `origin/main` with protected pull-request integration |
| Collaboration identity | `agent/<device>/<semantic-scope>`, `agentic-writer-lease/v2`, lease epoch, claim SHA, draft ownership pull request, and authenticated pull-request actor |
| Overlap preservation | Registered worktree and pull-request ownership for active lanes; a locked, content-addressed stash plus durable recovery ref only when canonical review requires temporary isolation; exact digest verification before any safe restoration |
| Integration Receipt | Protected merge SHA, paired immutable manifest, required checks, lease and pull-request evidence |
| Controlled runtime review | Repository-owned localhost runtime supervised by Agentic Canvas OS `turn:end` |
| Runtime Review Receipt | `agentic-local-review-candidate/v1` |
| Candidate Manifest | `agentic-production-release-candidate/v1`, binding Knowgrph, Agentic Canvas OS, catalog, mirror, artifact, and immutable-manifest identities |
| Human authority adapter | Protected GitHub `production` environment with an authenticated required reviewer |
| Deployment adapter | Knowgrph repository-owned Cloudflare release controller |
| Publication adapter | Generated `huijoohwee` mirror, published only after live verification |
| Production targets | `https://airvio.co` and `https://airvio.co/knowgrph` |

Each device fetches `origin` independently. The registered `main` checkout is
the automation-owned synchronization and runtime lane; task worktrees are
mutation lanes only. `npm run sync:workspace` validates changed revisions in
disposable worktrees and permits only clean fast-forward convergence. Ahead,
diverged, dirty, remote-unavailable, or failed candidates preserve the prior
last-known-good checkout and content-addressed diagnostics. Blind pull, reset,
rebase, stash, force checkout, and destructive cleanup are not recovery.

`device:integrate` publishes through protected integration, waits for the exact
PR head to merge, records durable completion, fast-forwards canonical source,
and delegates runtime review to `turn:end`. That receipt is review evidence, not
Production authorization. Knowgrph may then build once and wait at the protected
GitHub environment. After an authenticated human decision, the controller
revalidates every bound identity without rebuilding, deploys under one
environment concurrency lock, proves both production routes, then publishes the
exact verified mirror.

Agentic Canvas OS owns no independent production Worker. Knowgrph is the sole
forward-deployment and rollback owner for `airvio.co`. Failed post-deploy probes
restore the captured successful Cloudflare deployment and leave the mirror at
its last-known-good revision. Stateful changes use backward-compatible
expand/migrate/contract stages because code rollback does not reverse data.

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
