---
title: "Source-Correction Successor Task-Binding Reconciliation"
graphId: "md:agentic-source-correction-successor-task-binding-reconciliation"
doc_type: "Runtime Contract"
date: "2026-08-16"
lang: "en-US"
schema: "agentic-source-correction-successor-task-binding-reconciliation-contract/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact source capability plus completed reviewed-lane source-correction receipt"
runtime_scope: "writer-lease registry task-binding continuation only"
runtime_claim: "a same-owner source-correction successor can repair its omitted task binding without changing source, refs, cloud authority, or pull request"
runtime_owner: "../scripts/source-correction-successor-task-binding-reconciliation-contract.mjs; ../scripts/source-correction-successor-task-binding-reconciliation-controller.mjs; ../scripts/source-correction-successor-task-binding-reconciliation-repository-adapter.mjs"
runtime_proof: "../__tests__/source-correction-successor-task-binding-reconciliation.test.mjs"
publish_policy: "protected review required; no deployment or authoring authority"
---

# Source-Correction Successor Task-Binding Reconciliation

## Exact subject

This controller covers one narrow response-loss state. A completed
reviewed-lane-source-correction transaction has activated a same-owner cloud
successor, but the writer lease still carries the predecessor-bound task
authority. The source lane is clean, the draft pull request and provider marker
retain the exact source-correction fence, and the local worktree is either still
ahead of that remote fence or has already published the same head. Both shapes
represent the same missing registry-only continuation when the completed
source-correction receipt, marker, lease, and active successor claim join
exactly.

Planning seals the registered worktree, local and remote heads, pull-request
body and marker, complete source-correction receipt, source lease digest,
predecessor and successor claim identities, and retained binding digest.

## Single effect

Run requires the exact plan authorization and the source lane's existing task
capability. It reconstructs a proof-only source lease by replacing only the
cloud claim ID with the completed source-correction predecessor. The existing
task-authority primitive verifies that binding and continues it to the actual
successor lease.

One registry CAS replaces taskAuthority and records a typed repair receipt.
The receipt grants no authoring authority. Cloud, pull-request, source, Git
refs, merge, integration, and deployment effects are all explicitly false.

Completed receipts are replay-safe: the controller terminally re-verifies the
same local candidate, remote head, pull-request body and marker before adopting
the stored repair.

## Commands

    node scripts/source-correction-successor-task-binding-reconciliation.mjs plan \
      --repository=<source-worktree> \
      --branch=<source-branch> \
      --pull-request=<number> \
      --source-session=<session> \
      --json

    node scripts/source-correction-successor-task-binding-reconciliation.mjs run \
      --repository=<source-worktree> \
      --branch=<source-branch> \
      --pull-request=<number> \
      --source-session=<session> \
      --plan-file=<plan.json> \
      --authorize="authorize source-correction-successor-task-binding-reconciliation <planDigest>" \
      --task-authority=<source-capability.json> \
      --json

Focused validation:

    node --test __tests__/source-correction-successor-task-binding-reconciliation.test.mjs
