---
title: "Authority Handoff Compatibility"
graphId: "md:acos-adlc-authority-handoff-compatibility"
doc_type: "Compatibility Note"
date: "2026-09-01"
lang: "en-US"
schema: "acos-adlc-authority-handoff-compatibility/v1"
frontmatter_contract: "required"
status: "draft"
owner: "ADLC harness"
delivered_rung: "undocumented"
---
# Authority Handoff Compatibility

The legacy cloud writer ledger and recovery adapters are retired. ADLC treats
the lane branch plus pull request as the claim and delegates landing order to
the provider. A local cache, stale marker, expired record, or compatibility
snapshot cannot transfer authority. Stop the old lane and open a new scoped
lane for a new owner. See `CANONICAL-LIFECYCLE.md`.
