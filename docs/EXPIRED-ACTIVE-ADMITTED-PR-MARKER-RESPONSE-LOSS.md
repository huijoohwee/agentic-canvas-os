---
title: "Expired active-admitted pull-request marker response-loss recovery"
graphId: "md:expired-active-admitted-pr-marker-response-loss"
doc_type: "Lifecycle Capability"
date: "2026-08-14"
lang: "en-US"
schema: "agentic-expired-active-admitted-pr-marker-response-loss-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/expired-active-admitted-pr-marker-response-loss.mjs"
runtime_proof: "../__tests__/expired-active-admitted-pr-marker-response-loss.test.mjs"
---

# Expired active-admitted pull-request marker response-loss recovery

This recovery projects one provider-hosted review marker after an admitted lane's
final authorized heartbeat reached the local registry and collaboration ledger,
the provider retained the immediately preceding marker, and the lease then
expired. The core contract is independent of model, agent runtime, repository
host, and deployment provider. Provider-specific observation and mutation stay
behind one injected adapter.

The previously sealed active-state plan is immutable predecessor evidence. It
is not executable after expiry. A new read-only plan joins that predecessor to
fresh expired-state evidence: the same clean registered worktree, exact local
lease, task-authority binding, branch and review fence, source and target marker
digests, and the same latest recorded cloud transition. The public cloud state
must be derived from time alone as dormant-preserved, non-writing, and reserved.
No later transition for the target claim or overlapping writing or reserving
competitor may exist. Unrelated ledger suffixes may advance when the target
projection and competitor proof remain identical.

Run requires fresh proof of possession for the task capability already bound to
the expired lease. The operation is derived from the new plan digest. It does
not migrate, continue, renew, recover, rebind, or disclose task authority. No
human authorization string substitutes for capability possession.

The only external mutation is the review body:

- An exact source body may be updated to the canonical target marker.
- An exact target body is adopted without another provider write.
- A failed update is reconciled only when a fresh read observes the exact target.
- Every third body, marker, identity, head, or queue state fails closed.

The provider seam uses observable pre-read, edit, and post-read checks. It does
not claim server-enforced compare-and-swap semantics. A private, digest-bound
journal is the only local control-plane mutation and makes response-loss replay
deterministic.

The completion receipt states that marker projection is restored while the lane
remains expired and cloud authority remains dormant. It grants no authoring,
registry, Git, source, review-metadata, cloud-transition, integration, release,
deployment, or cleanup authority. Ordinary lifecycle owners must perform any
later recovery, review, integration, release, or deployment transition.
