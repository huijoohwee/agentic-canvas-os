---
title: "Task-Bound Lane Authority"
graphId: "md:acos-adlc-task-bound-lane-authority"
doc_type: "Lifecycle Contract"
date: "2026-09-01"
lang: "en-US"
schema: "acos-adlc-task-bound-lane-authority/v1"
frontmatter_contract: "required"
status: "draft"
owner: "ADLC harness"
delivered_rung: "undocumented"
---
# Task-Bound Lane Authority

ADLC binds one task to one lane branch, registered worktree, pull request, and
exact published head. The binding is observable; it is not a locally minted
capability. Local lane records may improve status output but cannot grant,
transfer, renew, or recover authority.

Use `npm run lane -- <scope>` to create a new binding and `npm run land` to
publish it. A different task or scope requires a new lane. See
`CANONICAL-LIFECYCLE.md`.
