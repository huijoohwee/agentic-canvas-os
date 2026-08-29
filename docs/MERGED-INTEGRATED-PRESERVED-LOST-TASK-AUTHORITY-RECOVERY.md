---
title: "Merged Integrated-Preserved Lost Task-Authority Recovery"
graphId: "md:merged-integrated-preserved-lost-task-authority-recovery"
doc_type: "Runtime Contract"
date: "2026-08-29"
lang: "en-US"
schema: "agentic-merged-integrated-preserved-lost-task-authority-recovery/v1"
frontmatter_contract: "required"
status: "focused-tested"
---
<!-- Responsibility: Document the one-CAS recovery for lost authority after an immutable merge. -->

# Merged integrated-preserved lost task-authority recovery

This controller is the narrow recovery path for a merged pull request whose
local `review_ready` lease still has a valid immutable delivery lineage, but
whose private task-authority capability was irrecoverably lost before the
normal terminal controller could retire the cloud claim and clean its worktree.

It is not a replacement merge, review, cloud, or cleanup controller. It reads
the exact merged pull request, protected-main refresh topology, integrated-
preserved ledger lineage, and clean registered target worktree twice before it
creates an external journal. Its only repository mutation is one CAS that
replaces `lease.taskAuthority` with an externally held generation-plus-one
handoff binding. The PR marker remains immutable evidence of the original
reviewed binding.

The plan requires a separate 0600 replacement capability. Its authorization is
content-bound and must be supplied literally:

```text
authorize merged-integrated-preserved-lost-task-authority-recovery <planDigest>
```

After a completed handoff, invoke the existing `device:integrate` workflow with
the replacement capability. That unchanged workflow remains solely responsible
for cloud retirement, session completion, canonical synchronization, and exact
worktree cleanup.

The controller forbids source or index changes, commits, refs, PR edits, cloud
mutations, merges, cleanup, deployment, and runtime actions. It accepts a
response-loss replay only when the local registry already contains the exact
plan-derived handoff binding and every non-authority evidence field is stable.
