---
title: "Planned Recovery PR Marker Reconciliation"
graphId: "md:planned-recovery-pr-marker-reconciliation"
doc_type: "Lifecycle Capability"
date: "2026-08-12"
lang: "en-US"
schema: "agentic-planned-recovery-pr-marker-reconciliation/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact-authorized terminal convergence after provider-first claim retirement"
runtime_scope: "read-only planning and provider-first terminal projection"
runtime_claim: "focused lifecycle proof only; cleanup, integration, and deployment remain separate"
runtime_owner: "../scripts/planned-recovery-pr-marker-reconciliation-contract.mjs; ../scripts/planned-recovery-pr-marker-reconciliation-controller.mjs; ../scripts/planned-recovery-pr-marker-reconciliation-repository-adapter.mjs; ../scripts/planned-recovery-pr-marker-reconciliation.mjs"
runtime_proof: "../__tests__/planned-recovery-pr-marker-reconciliation.test.mjs"
publish_policy: "Dev-only; no protected integration or Production authority"
---
<!-- Responsibility: Define the bounded terminal reconciliation of one retired planned owner. -->

# Planned recovery PR marker reconciliation

This controller closes one exact response-loss gap. A clean planned lane can retain an expired local
lease and an older pull-request marker after its cloud claim has been explicitly retired. Planning is
read-only and emits `authorize planned-recovery-pr-marker-reconciliation <planDigest>`.

Run validates the same worktree, branch, HEAD, tree, remote head, lease, marker, pull request, retired
claim, and operator decision. It accepts only a marker difference confined to `heartbeatAt` and only a
lane with no authored delta from its recorded base. It then closes the draft pull request unmerged,
releases the local lease with an embedded receipt, and projects that released lease to the closed pull
request. Provider closure occurs before local release, making interruption replay observable.

The operation preserves the worktree, local and remote branches, commit, index, and authored bytes.
It does not merge, delete, clean up, recover write authority, alter canonical main, deploy, or authorize
Production. Recoverable cleanup remains a separate exact plan and authorization.

After the released local receipt is digest-validated, the lane may be classified as
`retired-preserved` only when its clean worktree path, branch, fence HEAD, pull-request URL, and
terminal timestamps still match the released lease. This releases its historical scope for a different
successor lane while preserving the original lane; it never makes that preserved lane cleanup-eligible.
