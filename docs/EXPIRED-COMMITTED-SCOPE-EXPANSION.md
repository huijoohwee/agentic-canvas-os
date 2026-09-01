---
title: "Expired Committed Scope Expansion"
graphId: "md:agentic-expired-committed-scope-expansion"
doc_type: "Recovery Controller Contract"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-expired-committed-scope-expansion-plan/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact authorized recovery of one expired admitted clean unpublished scope-expansion commit"
runtime_owner: "../scripts/expired-committed-scope-expansion-contract.mjs; ../scripts/expired-committed-scope-expansion-repository-adapter.mjs; ../scripts/expired-committed-scope-expansion.mjs"
runtime_proof: "../__tests__/expired-committed-scope-expansion.test.mjs"
publish_policy: "Dev authoring-authority maintenance only; review, protected integration, deployment, and cleanup remain separately gated"
---
<!-- Responsibility: Define the disjoint protected-main proof accepted by expired committed scope expansion. -->

# Expired committed scope expansion

This controller recovers one expired, cloud-admitted lane with one clean unpublished commit directly
above its exact remote fence when that commit uses a strict superset of the admitted write scope. It
creates and promotes one exact cloud successor, binds the unchanged draft pull request, replaces the
local lease and task continuation by compare-and-swap, and changes only the hidden writer marker.

Protected main may be represented by either of two sealed proofs:

- the protected revision is already an ancestor of the source fence; or
- the protected revision descends the source base on another line and every changed protected path is
  disjoint from the entire widened target write set.

The second form records the exact protected revision, tree, changed paths, target write set, and
`overlap: "none"`. Both forms also prove that the exact source fence descends the source base.
Planning and execution recapture the proof. Any changed revision, path, tree, ancestry, write-set
digest, overlap, local commit, remote fence, draft review identity, claim, manifest, or lease stops
before a recovery effect.

The operation never rewrites the unpublished commit, changes authored bytes, performs a raw merge,
marks a review ready, merges a pull request, deploys, or cleans a worktree. Its exact authorization is:

```text
authorize expired-committed-scope-expansion <planDigest>
```

Focused verification:

```sh
node --test __tests__/expired-committed-scope-expansion.test.mjs
```
