---
title: "Expired descendant and untracked scope recovery"
graphId: "md:expired-descendant-untracked-scope-recovery"
doc_type: "Lifecycle Capability"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-expired-descendant-untracked-scope-recovery-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/expired-descendant-untracked-scope-recovery.mjs"
runtime_proof: "../__tests__/expired-descendant-untracked-scope-recovery-contract.test.mjs; ../__tests__/expired-descendant-untracked-scope-recovery-controller.test.mjs; ../__tests__/expired-descendant-untracked-scope-recovery-repository-adapter.test.mjs; ../__tests__/expired-descendant-untracked-scope-recovery-repository-observer.test.mjs; ../__tests__/expired-descendant-untracked-scope-recovery-repository-terminal.test.mjs; ../__tests__/expired-descendant-untracked-scope-recovery-cli.test.mjs"
---

# Expired descendant and untracked scope recovery

This controller restores same-session authoring authority when an admitted task-bound lane has all of these properties at once:

- its cloud claim has naturally become `dormant-preserved`;
- its remote fence is unchanged while local `HEAD` is a strict linear unpublished descendant;
- its stopped owner has both tracked dirt inside the admitted scope and content-sealed untracked files that require a strict scope expansion; and
- the existing draft pull request still carries the same structural writer marker, allowing only ambient ledger revision and ledger digest rotation.

The recovery is intentionally narrower than review or integration. A private task capability creates a fresh content-bound owner-stop receipt. Planning double-reads and seals the commit range, index, tracked patch, untracked file type/mode/blob, strict-superset target manifest, dormant predecessor, raw pull-request body and marker, and clean protected controller implementation.

Exact authorization runs one replay-safe successor chain: waiting successor, predecessor retirement, successor promotion, review binding, and a task-authority-continuing local registry CAS. A distinct monotonic `expiredDescendantUntrackedRecoveryIntents` journal fences every phase and is atomically retired into a terminal receipt; the ordinary active-dirty intent and PR-marker phases are never reused. The pull-request body is not edited. Terminal proof therefore reports `providerProjection: "deferred"`, `pullRequestMutation: false`, and `crossDeviceResumeAuthority: false`. The recovered owner may finish its bytes in the same session; ordinary review must later reconcile the provider marker and independently establish review and integration authority.

The controller never commits, pushes, rewrites refs, merges, deploys, cleans, revives the predecessor, adopts owner bytes, or grants cross-device continuation.
