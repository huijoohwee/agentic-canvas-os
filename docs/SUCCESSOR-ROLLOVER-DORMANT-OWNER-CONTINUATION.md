---
title: "Successor Rollover Dormant Owner Continuation"
graphId: "md:agentic-successor-rollover-dormant-owner-continuation"
doc_type: "Recovery Controller Contract"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-successor-rollover-dormant-owner-continuation-plan/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact same-claim continuation after terminal waiting-bridge retirement and successor promotion"
runtime_owner: "../scripts/successor-rollover-dormant-owner-continuation-contract.mjs; ../scripts/successor-rollover-dormant-owner-continuation-controller.mjs; ../scripts/successor-rollover-dormant-owner-continuation-evidence.mjs; ../scripts/successor-rollover-dormant-owner-continuation-repository-adapter.mjs; ../scripts/successor-rollover-dormant-owner-continuation-store.mjs; ../scripts/successor-rollover-dormant-owner-continuation.mjs"
runtime_proof: "../__tests__/successor-rollover-dormant-owner-continuation-contract.test.mjs; ../__tests__/successor-rollover-dormant-owner-continuation-controller.test.mjs; ../__tests__/successor-rollover-dormant-owner-continuation-repository-adapter.test.mjs; ../__tests__/successor-rollover-dormant-owner-continuation-cli.test.mjs"
publish_policy: "Dev authoring-authority maintenance only; reanchor, review, protected integration, deployment, and cleanup remain separately gated"
---
<!-- Responsibility: Define same-owner recovery without reopening rollover topology. -->

# Successor rollover dormant owner continuation

This controller restores one expired dormant owner after a temporary claim-only waiting bridge has
been terminally retired and its existing successor terminally promoted. It is deliberately a
same-claim continuation. It creates no claim, predecessor, branch, commit, pull request, or new scope.

Planning joins all of the following exact evidence:

- the normalized historical successor-rollover continuation plan and its monotonic journal;
- the unchanged full rollover tombstone and embedded receipt in the writer registry;
- a completed `claim-only-existing-successor-promotion` private journal;
- the dormant anchor claim, retired bridge, promoted disjoint successor, and absence of an overlapping
  reserved peer;
- the registered dirty worktree, exact admitted path set, unchanged index/worktree/untracked bytes,
  source lease, bound task capability, and historical review-base proof;
- the exact open draft pull request, hidden marker, body remainder, head, base, and no delivery request;
  and
- a clean current protected-main controller whose advance is disjoint from the owner scope.

Execution consumes this exact statement:

```text
authorize successor-rollover-dormant-owner-continuation <planDigest>
```

It verifies the current capability, performs one authenticated dormant recovery of the same claim,
compare-and-swap projects only the renewed cloud authority, local epoch, expiry, and continuation
binding, and conditionally replaces only the pull-request writer marker. The complete rollover
tombstone must remain byte-equivalent through every registry mutation. A response-loss replay adopts
only the exact recovered claim, local lease, or provider body already described by the plan. The
cloud result is handed directly to local projection; a restart after that phase reconstructs it from
read-only provider status and never issues a second continuation effect. Replay reads its sealed
journal before choosing the phase-specific live proof, and a complete replay re-verifies the terminal
claim, lease, and marker.

Plans and journals are owner-only `0600` files outside the target repository, Git directory, and
clean controller repository. Existing parent paths are resolved before containment checks, the
journal compare-and-swap holds an exclusive adjacent lock, and execution accepts only the TTL sealed
by the plan. The controller forbids new-claim, retirement, promotion, Git, source, review-state,
merge, deployment, cleanup, and tombstone effects. Current-base reanchoring and ordinary protected
delivery remain later independent controllers.

Focused verification:

```sh
node --test __tests__/successor-rollover-dormant-owner-continuation-*.test.mjs
```
