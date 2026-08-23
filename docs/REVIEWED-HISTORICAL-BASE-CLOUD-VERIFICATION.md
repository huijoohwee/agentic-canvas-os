---
title: "Reviewed Historical Base Cloud Verification"
graphId: "md:agentic-reviewed-historical-base-cloud-verification"
doc_type: "Runtime Contract"
date: "2026-08-23"
lang: "en-US"
schema: "agentic-reviewed-historical-base-cloud-verification/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "trusted exact-head verification of reviewed historical-base pull requests"
runtime_scope: "read-only ancestry and disjoint-path proof before cloud claim verification"
runtime_claim: "Dev-only verification; no source rewrite, integration, release, deployment, or cleanup authority"
runtime_owner: "../scripts/reviewed-historical-base-cloud-verification.mjs; ../scripts/cloud-collaboration.mjs; ../scripts/github-cloud-collaboration-mapping.mjs"
runtime_proof: "../__tests__/reviewed-historical-base-cloud-verification.test.mjs"
---

# Reviewed Historical Base Cloud Verification

A reviewed claim can remain bound to its immutable historical base while its
pull request targets a newer protected `main`. The trusted event verifier may
use that historical subject only when it fetches the exact event head and base,
proves the claim base is an ancestor of the current protected base, and proves
every intervening protected-base path is disjoint from the reviewed claim's
declared write scope.

The provider mapping requires the reviewed state, exact claim and review
identities, exact reviewed head, and the normalized descendant proof. Missing,
forged, overlapping, non-ancestral, or combined protected-refresh evidence
fails closed. The proof changes verification projection only; it does not
mutate the claim, pull request, branch, base, reviewed bytes, or ledger.
