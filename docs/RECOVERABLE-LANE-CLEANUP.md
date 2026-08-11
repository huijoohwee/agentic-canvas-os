---
title: "Recoverable Lane Cleanup Journal Routing"
graphId: "md:recoverable-lane-cleanup-journal-routing"
doc_type: "Lifecycle Capability"
date: "2026-08-12"
lang: "en-US"
schema: "agentic-recoverable-lane-cleanup-evidence/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "Subject-routed discovery of historical dormant-preservation receipts"
runtime_owner: "../scripts/recoverable-lane-cleanup-repository-adapter.mjs"
runtime_proof: "../__tests__/recoverable-lane-cleanup-repository-adapter.test.mjs"
publish_policy: "Cleanup planning only; exact cleanup authorization remains required"
---
<!-- Responsibility: Define fail-closed subject routing for historical cleanup journals. -->

# Recoverable lane cleanup

Recoverable cleanup routes historical dormant-preservation journals by their
exact selected worktree subject before validating the full journal. Unrelated
historical journals therefore cannot block a clean lane's cleanup plan merely
because their embedded controller paths have become stale.

A journal that selects the cleanup target by worktree path, branch, head SHA,
and tree SHA is still normalized completely. Malformed JSON, ambiguous subject
records, and malformed target-matching journals fail closed. Cleanup continues to require terminal
local and remote authority, an exact plan authorization, a verified Git bundle,
durable worktree and Git-directory snapshots, and non-force removal.
