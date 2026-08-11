---
title: "Protected Head Refresh Check Rollup Projection"
graphId: "md:agentic-protected-head-refresh-check-rollup"
doc_type: "Runtime Contract"
date: "2026-08-11"
lang: "en-US"
schema: "agentic-protected-head-refresh-check-rollup/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "operation-bound projection of exact successful workflow-dispatch checks into pull-request mergeability"
runtime_scope: "protected-head refresh CI evidence projection and GraphQL rollup verification"
runtime_claim: "Dev integration proof only; Production and deployment authority remain separately gated"
runtime_owner: "../scripts/protected-head-refresh-github-provider.mjs"
runtime_proof: "../__tests__/protected-head-refresh-provider.test.mjs"
publish_policy: "protected Dev integration only; no Production or Cloudflare authority"
---
<!-- Responsibility: Define the provenance and fail-closed boundary for protected-refresh CI rollup projections. -->

# Protected head refresh check rollup projection

GitHub can expose a successful `workflow_dispatch` check suite through the Checks
REST API while omitting that suite from the pull request's
`Commit.statusCheckRollup`. The protected-refresh controller treats the suite as
source evidence, not mergeability evidence.

After exact candidate authorization, the controller projects each required
successful source check into the pull request's GitHub Actions check suite. Each
projection binds the operation ID, candidate SHA, context, workflow run, check
suite, and source check-run ID in canonical JSON. The external ID is unique to
that operation and source check.

The projected contexts are exactly `test`, `build`, `docs-contract`,
`collaboration-integration`, and `agentic-sdlc-policy-runtime`. A projection is
accepted only when its name, candidate, source identity, GitHub Actions app,
terminal success, details URL, title, and evidence bytes all match. Foreign or
duplicate operation projections fail closed.

GitHub may normalize the requested Actions workflow URL to the canonical
`https://github.com/<owner>/<repository>/runs/<check-run-id>` URL. The controller
accepts only the requested URL or that exact repository-and-check-run binding.

Before completing the sole operation-owned `cloud-collaboration` gate, the
controller queries the candidate's GraphQL status-check rollup and requires the
exact projected check-run IDs plus the still-pending cloud gate to be visible.
The cloud gate remains the last success mutation. Interrupted execution is
idempotent: exact projections are reused; drift is rejected.

If GitHub merges the exact re-authorized candidate while that sole owned gate
is still pending, merged replay may complete only that existing check. It first
reproves the deterministic candidate and refresh chain, exact target base,
retained SQUASH authorization and human merger, merged commit, candidate
workflow, successful source CI run and check suite, current branch protection,
absence of a synchronize run, cloud authority, and the unchanged operation
check ID. It repeats the mutable proofs after CI reconciliation immediately
before completing the check. An absent, foreign, duplicate, terminal, replaced,
or partially completed check remains fail closed. Protected main may have
advanced after the exact merge; replay proves the immutable merge instead of
requiring the old target SHA to remain the current tip.

Passing focused tests proves only this bounded Dev contract. It does not grant
Production authorization, Cloudflare deployment, cleanup, or release authority.
