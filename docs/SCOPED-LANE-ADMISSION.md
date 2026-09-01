---
title: "Scoped Lane Admission"
graphId: "md:acos-adlc-scoped-lane-admission"
doc_type: "Workflow Contract"
date: "2026-09-01"
lang: "en-US"
schema: "acos-adlc-scoped-lane-admission/v1"
frontmatter_contract: "required"
status: "draft"
owner: "ADLC harness"
delivered_rung: "undocumented"
---
# Scoped Lane Admission

Admission is the pure `planned -> active` ADLC transition. It requires a valid
lowercase scope, fetched protected base, free scope, and available WIP/stack
capacity. Provisioning creates one registered task worktree and one
`agent/<device>/<scope>` branch.

```sh
npm run status
npm run lane -- <scope>
```

Legacy cloud claims, writer leases, admission manifests, per-scenario recovery
controllers, and projection-repair transitions are not admission authority.
See `START-WORKFLOW.md`.
