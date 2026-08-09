---
title: "Local Review-Ready Retirement"
graphId: "md:local-review-ready-retirement"
doc_type: "Lifecycle Capability"
date: "2026-08-08"
lang: "en-US"
schema: "agentic-local-review-retirement-receipt/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "provider-first terminalization of exact expired local-only review reservations"
---

# Local Review-Ready Retirement

This controller releases one expired, local-only `review_ready` reservation while
preserving its worktree, branch, pull-request object, commits, index, working
bytes, and remote branch. It exists for pre-cloud legacy lanes that cannot use
the current cloud reclaim, handoff, integration, or retirement controllers.

It does not merge, deploy, delete, detach, reset, stash, switch, rewrite, or
clean up the lane. A successful lane is `retired-preserved` and remains
permanently ineligible for lifecycle cleanup.

## Exact eligibility

All conditions are mandatory:

- the source is a registered, attached, non-canonical worktree;
- the worktree and index are clean and its branch, `HEAD`, tree, and remote
  branch are stable across repeated inspection;
- one unambiguous `agentic-writer-lease/v2` owns the exact path and branch;
- the lease is exactly `review_ready`, its expiry is in the past, and its
  `reviewHeadSha` equals the local, remote, and pull-request head;
- the requested source session, expected head, and expected pull request match
  the lease exactly, while a distinct repository-owned operator session owns
  the dormant-preservation proof;
- neither `admission` nor `cloudAuthority` exists on the lease;
- the pull request is repository-owned, non-draft, unmerged, based on `main`,
  and has the exact source branch and head;
- repository-owned cloud `status` returns a current bounded inventory;
- repository owner authentication and `verifyDormantPreservation()` prove that
  no current claim matches the worktree, branch, semantic scope, or pull
  request; and
- the operator supplies an exact decision digest, an outside-repository receipt
  path, and the explicit acknowledgement flag.

A live lease, dirty or detached lane, forked pull request, head drift, current
cloud claim, admitted/cloud-backed lease, ambiguous worktree, merged pull
request, or closed unmarked pull request fails closed.

Cloud-backed review lanes remain owned by the cloud-authority handoff and
reclaim controllers. This command must never bypass them.

## Direct CLI

There is intentionally no `package.json` alias. Invoke the repository-owned
controller directly:

```sh
node scripts/legacy-review-ready-retirement.mjs \
  --repository=/absolute/path/to/exact-worktree \
  --target-repository=owner/repository \
  --ledger-repository=huijoohwee/agentic-canvas-os \
  --source-session=exact-legacy-owning-session \
  --operator-session=current-repository-operator-session \
  --expected-head=0123456789abcdef0123456789abcdef01234567 \
  --expected-pr=https://github.com/owner/repository/pull/123 \
  --operator-decision-digest=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --receipt=/absolute/outside/repository/local-review-retirement.json \
  --acknowledge-local-review-retirement \
  --json
```

The receipt path and its lock must be outside both the source worktree and Git
common directory. `--expected-pr=123` is also accepted; the controller derives
and verifies the exact canonical GitHub URL.

## Provider-first transaction

The controller performs this bounded order:

1. Double-capture registered lane, local lease, remote branch, and pull request.
2. Obtain operation-derived cloud inventory and owner-authenticated dormant
   preservation evidence for the operator session.
3. Persist a prepared receipt whose stable intent binds source bytes, lease,
   provider identity, preservation policy, and operator decision.
4. Project the anticipated `released` writer marker without changing the local
   lease.
5. Append one independent `agentic-local-review-retirement-intent/v1` marker.
6. Under the local lease-registry lock, recheck the exact source lease and use
   the captured GitHub ETag to conditionally update and close the exact pull
   request without deleting its branch.
7. Re-read the closed, unmerged pull request and require exactly one source-
   derived writer marker plus one retirement marker.
8. Re-run cloud inventory and dormant preservation against the closed provider
   checkpoint; any newly current claim blocks local release.
9. Use the existing locked `release({ expectedLease })` compare-and-swap to set
   only the local lease terminal fields and content-bound receipt.
10. Re-read every Git identity and write the completed external receipt.

The released lease preserves every original field. Only `status`,
`heartbeatAt`, `expiresAt`, and `localReviewRetirement` change. The complete
receipt uses schema `agentic-local-review-retirement-receipt/v1` and binds:

- source worktree, branch, head, tree, index, working-tree, remote-head, source
  lease timing, full source-lease digest, and released writer projection;
- exact pull-request number, node identity, repositories, branches, and head;
- operator decision and immutable preservation policy;
- cloud inventory and dormant-preservation receipt digests;
- provider body and terminal/writer marker digests; and
- the canonical retirement instant.

## Crash and replay behavior

Each partial state has one safe continuation:

| Observed checkpoint | Next action |
| --- | --- |
| Prepared receipt only | Revalidate all evidence, then perform provider closure. |
| Open PR with exact markers | Revalidate and close the same PR. |
| Closed PR with exact markers, source lease still `review_ready` | Perform only the exact lease CAS and final verification. |
| Released lease with valid receipt and closed marked PR | Return idempotent success; restore a missing external receipt only. |
| Closed PR without the exact marker, conflicting marker, changed head, or changed lease | Fail closed without another mutation. |

The stable intent excludes changing cloud timestamps, so a provider-completed
replay can obtain fresh inventory evidence without changing its marker identity.

## Admission and lifecycle projection

A cryptographically valid released lane projects as `retired-preserved` only
while its path, branch, head, clean bytes, lease identity, and receipt still
match. Admission then treats its historical semantic scope and write set as
released for a successor on a different branch.

The preserved branch itself remains reserved. A candidate using the same branch
is overlapping, and any current cloud claim matching the historical scope,
branch, or pull request invalidates retired attribution.

Lifecycle reports include `retired-preserved` as a safe preservation state with
`cleanupEligible: false`. `cleanupCompletedWorktree()` continues to accept only
`cleanup-ready`; it rejects retired lanes.

## Focused proof

Run the bounded suites directly:

```sh
node --test __tests__/legacy-review-ready-retirement.test.mjs
node --test __tests__/scoped-lane-authority-state.test.mjs
node --test __tests__/worktree-lifecycle.test.mjs
```

Tests use in-memory provider/lease adapters and temporary state. They never
terminalize a real pull request or existing lane.
