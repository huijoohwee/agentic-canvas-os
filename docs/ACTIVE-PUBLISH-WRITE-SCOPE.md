---
title: "Published Lane Scope Compatibility"
graphId: "md:acos-adlc-published-scope-compatibility"
doc_type: "Compatibility Note"
date: "2026-09-01"
lang: "en-US"
schema: "acos-adlc-published-scope-compatibility/v1"
frontmatter_contract: "required"
status: "draft"
owner: "ADLC harness"
delivered_rung: "undocumented"
---
# Published Lane Scope Compatibility

Legacy publish-time scope recovery is retired. ADLC binds scope in the lane
branch, task worktree, pull request, and exact published head. Change scope by
opening a new lane; do not widen a queued lane or copy another lane's authority.
See `CANONICAL-LIFECYCLE.md`.
