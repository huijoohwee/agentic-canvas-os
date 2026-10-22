---
title: "Planned Admission Owner Release"
graphId: "md:planned-admission-owner-release"
doc_type: "Lifecycle Capability"
date: "2026-08-16"
schema: "agentic-planned-admission-owner-release/v1"
status: "focused-tested"
lang: "en-US"
frontmatter_contract: "required"
authority: "exact-authorized retirement of one abandoned planned admission owner"
runtime_scope: "read-only planning and cloud-provider-local terminal convergence"
runtime_claim: "focused lifecycle proof only; integration, Production, and deployment remain separate"
runtime_owner: "../scripts/planned-admission-owner-release-contract.mjs; ../scripts/planned-admission-owner-release-controller.mjs; ../scripts/planned-admission-owner-release-repository-adapter.mjs; ../scripts/planned-admission-owner-release-store.mjs; ../scripts/planned-admission-owner-release.mjs"
runtime_proof: "../__tests__/planned-admission-owner-release-contract.test.mjs; ../__tests__/planned-admission-owner-release-controller.test.mjs; ../__tests__/planned-admission-owner-release-repository-adapter.test.mjs; ../__tests__/planned-admission-owner-release-cli.test.mjs"
publish_policy: "Dev-only; no protected integration or Production authority"
---
<!-- Responsibility: Define exact release of one abandoned planned admission owner. -->

# Planned Admission Owner Release

This controller repairs one otherwise unresolvable abandoned planned owner: a dormant-preserved cloud claim, an open unmerged draft pull request, and an active planned local lease whose recorded worktree and local branch are both absent.

Planning is read-only. It seals the complete cloud claim and ledger head, provider pull request and remote head, writer-lease registry and original lease, absent source projections, plus a byte-level proof for the dirty pull-request-free successor lane. Execution requires exactly:

`authorize planned-admission-owner-release <planDigest>`

The ordered effects are cloud CAS retirement with reason `abandoned`, closing the pull request unmerged while preserving its remote branch, and CAS release of the stale lease with its complete original projection nested in the terminal receipt. Final verification proves the cloud scope is released and the dirty successor lane is byte-identical. The controller never deletes a worktree, branch, pull request branch, or authored byte and never grants integration, Production, publication, or deployment authority.
