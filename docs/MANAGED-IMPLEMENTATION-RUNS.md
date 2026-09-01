---
title: "Managed Implementation Runs"
graphId: "md:acos-adlc-managed-runs"
doc_type: "Workflow Contract"
date: "2026-09-01"
lang: "en-US"
schema: "acos-adlc-managed-runs/v1"
frontmatter_contract: "required"
status: "draft"
owner: "ADLC harness"
delivered_rung: "undocumented"
---
# Managed Implementation Runs

A managed run is one ADLC lane. Its branch, registered worktree, pull request,
exact head, checks, integration proof, and retirement receipt form its bounded
record.

```sh
npm run lane -- <scope>
# author and commit in the printed worktree
npm run land
# after protected integration, from canonical main
npm run reap -- --apply
```

Scenario-specific recovery commands, writer-lease renewal, projection repair,
and one-off lifecycle modules are retired. If a lane is wrong, preserve its
bytes and either correct it within the same published identity before queueing
or open an explicitly new lane. See `START-WORKFLOW.md` and
`RELEASE-WORKFLOW.md`.
