---
title: "Active-publish Task-authority Successor Reconciliation"
graphId: "md:active-publish-task-authority-successor-reconciliation"
doc_type: "Runtime Contract"
date: "2026-08-15"
lang: "en-US"
schema: "agentic-active-publish-task-authority-successor-reconciliation/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "task-bound registry-only response-loss repair"
runtime_scope: "exact predecessor-to-successor task-authority continuation"
runtime_claim: "repairs only an exact missing task binding and grants no authoring authority"
runtime_owner: "../scripts/active-publish-task-authority-successor-reconciliation.mjs"
runtime_proof: "../__tests__/active-publish-task-authority-successor-reconciliation.test.mjs"
publish_policy: "Dev-only; no review, merge, cleanup, Production, or deployment authority"
---

# Active-publish task-authority successor reconciliation

This controller repairs one narrow response-loss state: an admitted lane has already projected an exact active-publish cloud successor and exact draft pull-request head, but its writer lease still carries the predecessor task binding.

The read-only plan joins the clean registered worktree, exact local/remote/provider head, draft pull request, admitted manifest, predecessor fence and claim, target claim and operation receipt, private capability subject, and a disjoint protected-main advance. The run requires a plan-specific human authorization and re-proves the predecessor capability immediately before its single writer-registry CAS.

The mutation set is exactly the continuation `taskAuthority` binding and `activePublishTaskAuthoritySuccessor` receipt. The controller does not call the cloud provider, edit the pull request, move Git refs, change source bytes, create a claim, grant authoring authority, review, merge, clean a worktree, or deploy. A current or dormant-preserved exact target claim may be bound; any subsequent cloud recovery remains the ordinary lane owner's responsibility.

Completed replay validates and returns the immutable receipt without repeating task proof or registry mutation. Incomplete replay revalidates the sealed subject and adopts only the exact target binding and receipt. A v2 prepared projection seals the predecessor task binding, so a lost registry response can reconstruct the exact pre-CAS lease under two short branch-registry snapshots while unrelated registry revisions remain free to advance. Same-plan legacy v1 journals retain their original schema and phase shapes: `prepared`, `task-authority-verified`, and `registry-attempted` fail closed without writes; exact `registry-projected` and `verified` journals may finish after live target, pull-request, and evidence validation; `complete` is rebuilt and validated before return. A v1 registry response lost before its projected phase was journaled cannot be adopted because the overwritten predecessor binding is absent.

Replay re-observation may change only `observedAt` and its derived `evidenceDigest`. The protected revision, source base, complete changed-path set and digest, provider and claim identities, lease digest, and disjointness from the successor write scope remain exact. Any protected-main advance therefore requires a fresh plan-specific authorization and may supersede only an exact zero-effect legacy v1 `prepared` journal with empty values, after one fresh live-subject reobservation. A v2 journal is never superseded.

Fresh journals use the sealed v2 schema. The admitted legacy conversion records a null prior evidence digest and seals the exact validated v1 journal object in a digest-linked predecessor entry. Malformed or oversized history, repeated plan or evidence identities, cyclic return, v2 predecessors, later phases, nonempty prepared values, or completion-bearing journals are immutable and fail before task proof or registry mutation. Same-plan v1 journals remain v1 and are never silently migrated.
