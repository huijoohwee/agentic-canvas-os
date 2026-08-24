---
title: "Active-owned-dirt Task-authority Intent Supersession"
graphId: "md:active-owned-dirt-task-authority-intent-supersession"
doc_type: "Runtime Contract"
date: "2026-08-24"
lang: "en-US"
schema: "agentic-active-owned-dirt-intent-supersession-plan/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact-authorized stale cloud-phase recovery-intent plan supersession"
runtime_scope: "completed task-authority recovery lineage proof and one writer-registry CAS"
runtime_claim: "Dev-only controller proof; integration, cleanup, and deployment remain separately gated"
runtime_owner: "../scripts/active-owned-dirt-task-authority-intent-supersession-contract.mjs; ../scripts/active-owned-dirt-task-authority-intent-supersession-repository-adapter.mjs; ../scripts/active-owned-dirt-task-authority-intent-supersession.mjs"
runtime_proof: "../__tests__/active-owned-dirt-task-authority-intent-supersession.test.mjs"
publish_policy: "Dev-only; no source-byte, cloud, pull-request, merge, cleanup, or deployment authority"
---

# Active-owned-dirt task-authority intent supersession

This controller repairs one response-loss boundary: an active-owned-dirt recovery reached its durable `cloud` phase, then a separately authorized orphaned-task-authority recovery replaced the writer lease binding. The original recovery intent remains valid except for its stale `sourceLeaseDigest`, so normal replay fails closed before the local CAS.

The `plan` command is read-only and binds the current writer lease, cloud-phase intent, pull request, snapshot/cloud receipts, and completed orphaned-authority journal. `run` requires the exact content-bound authorization plus the current task-authority capability. Its only effect is one writer-registry CAS that replaces the intent plan's lease digest and recomputes its plan digest. The lease, task binding, staged bytes, snapshot, cloud claim, refs, pull request, merge state, and deployment state are unchanged.

After a successful supersession, rerun the original active-owned-dirt recovery. It resumes from `cloud`, skips snapshot and cloud mutation, and proceeds with its existing local projection, pull-request marker, and final verification phases.
