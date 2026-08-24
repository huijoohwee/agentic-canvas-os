---
title: "Agentic Canvas OS lane convergence adapter"
graphId: "md:agentic-canvas-os-lane-convergence-adapter"
doc_type: "Lifecycle Capability"
date: "2026-08-24"
lang: "en-US"
schema: "agentic-canvas-os-lane-convergence-adapter-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/agentic-canvas-os-lane-convergence-adapter.mjs"
runtime_proof: "../__tests__/agentic-canvas-os-lane-convergence-adapter.test.mjs"
---

# Agentic Canvas OS lane convergence adapter

This adapter binds the generic lane-convergence transaction to protected
Agentic Canvas OS repositories. Configuration names every exact branch,
registered worktree, owning clone, task capability, session, and pull request.
No subject is discovered by prefix, dirt, recency, or inferred ownership.

The adapter supports ordinary integration and cleanup, plus one narrow
`planned-start-response-ahead` recovery. That recovery first invokes the
read-only-planned, task-bound local fence projection, then the provisioned-start
admission controller. If the exact projected claim is dormant, it first invokes
the repository-owned planned-clean committed recovery and requires a live lease
before admission. It never edits a lease or ledger directly. Integration
continues through `device:integrate`; cleanup continues through the owning
worktree-lifecycle controller.

Dependencies must be merged and contained before a dependent source advances.
Cleanup is deferred until every source is merged and contained, so controller
bytes remain available throughout the atomic transaction. Controller scripts
are resolved from canonical main, which survives source-lane cleanup. Production deploy is
outside the action vocabulary and every action declares
`deploymentMutation: false`.

Planning binds the adapter and configuration bytes into one digest. Execution
requires the exact `authorize lane-convergence-transaction <digest>` phrase.
That top-level receipt grants only the bounded internal effects declared for
each transition. Response loss is classified from fresh repository, provider,
and lifecycle observations before any replay.
