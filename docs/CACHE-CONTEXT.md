---
title: "Agentic Canvas OS Cache Context Contract"
graphId: "md:agentic-canvas-os-cache-context"
doc_type: "Runtime Cache Context Contract"
date: "2026-09-11"
lang: "en-US"
schema: "agentic-cache-context/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "Canvas integration of the pinned OS stable-prefix runtime"
runtime_scope: "Agent-API volatile cache-context registry"
runtime_claim: "deterministic local stable-prefix reuse with provider cache status kept unverified until returned usage proves a read or write"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
runtime_proof: "RUNTIME-PROOF.md"
external_pattern_sources:
  - "https://developers.openai.com/api/docs/guides/prompt-caching"
---

# Cache Context

The portable implementation and API contract moved to `agentic-os/context/prefix`.
Read the pinned `node_modules/agentic-os/guides/CONTEXT.md` on demand for
`NATIVE-CONTEXT-001@1.0.0`, API shapes, limits, migration provenance and source checks.
The OS guide is the shared owner; this document owns only Canvas integration.

`agent-api/src/app.js` imports the public package subpath and accepts an injected
registry. The Worker retains one bounded registry per environment isolate. The
readiness response exposes sanitized policy/counters and keeps provider evidence
unverified. Model capability mapping and actual provider response evidence remain
with the downstream model owner. Scope registries to the caller authorization boundary.

The lockfile pins the exact OS source revision. There is no fallback implementation
or remote code loader. `agent-api/src/json-contract.js` preserves existing Canvas
JSON imports as a tested re-export of `agentic-os/context/json`; normalization has
one authored implementation upstream. No product deployment topology changes.

## Validation

Run `npm run cache-context:check` for Canvas application injection and readiness.
The migrated behavior suite is packaged in OS; run its `npm run context:check`.
Run Canvas `npm run check` for all local suites, web build and document/line budgets.
Worker bundle validation establishes platform compatibility only. Provider cache
hits, effective reasoning context and production readiness still require owner
evidence. Dev integration grants no production mirror, Cloudflare or payment effect.
