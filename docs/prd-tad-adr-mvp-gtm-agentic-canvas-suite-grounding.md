---
title: "Agentic Canvas Suite - Codebase Grounding"
graphId: "md:agentic-canvas-suite-codebase-grounding"
doc_type: "Codebase Grounding Record"
version: "0.3.0"
date: "2026-10-11"
lang: "en-US"
schema: "agentic-canvas-suite-codebase-grounding/v1"
status: "spec-complete"
frontmatter_contract: "required"
owner: "Product and documentation maintainers"
continuity_id: "PRD-TAD-ADR-AGENTIC-CANVAS-SUITE-001"
joined_revision: "0.3.0"
local_rung: "spec-complete"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
worktree_id: "device-0232231d4a19--canvas-suite-prd"
agent_id: "codex-canvas-suite-review"
source_revision: "f44e8d2d42b857bc5bc1658a50fcc5a7ce81b877"
---
# Codebase Grounding Record

## Revisions

| Repository | Exact revision and relation |
|---|---|
| Canvas OS | `f44e8d2d42b857bc5bc1658a50fcc5a7ce81b877`; lane base, with local pin update. Canonical local `main` is `45c132b6c9297141dc3b63427427e83ea6df8b34`, one commit behind this observed origin base. |
| Graph integrated base | `99f964934caaccc99e72473dc7e70af57a8860af`; Canvas pin targets this exact revision. |
| Graph readiness E2E candidate | `ea66716254da82cf5a25f5cba0388cf0b4372ef4`; local affected validation passed with the two-route mobile browser E2E. This candidate is not represented as protected integration. |
| Agentic OS | `abcca45be8a0bfd7dcd5e17ab253ec7631d74507`; Canvas package pin `3846c48dba4b40702451640e3e78e6bcc91408f4`. |
| Commerce OS | `29672c3145d191def6189cee45327edaea0d6b77`; Canvas Worker pin `a632166eb8e4258f55301b5089aa78da663e0d21`. |
| Authoring guidelines | `82835ac37d524643faa6b9703cb077ea9474ab15`, version 3.4.0. |

## Claim-to-source joins

| Claim | Source paths | Disposition |
|---|---|---|
| Canvas launches Graph's native workspace. | Canvas `config/observability-workspace.json`, `scripts/dev.mjs`, `web/observability-workspace.mjs`; Graph `canvas/vite.observability.config.ts`. | Pin/build identity confirmed locally; hosted runtime unverified. |
| Local tools retain source evidence. | Graph `mcp/agent-graph/runtime.mjs`, `mcp/agent-graph/query.mjs`, `mcp/README.md`, `canvas/viteAgentGraphBridge.ts`, `canvas/src/features/observability-workspace/host.mjs`. | Source confirmed; buyer run unverified. |
| Both requested browser routes use existing owners. | Graph `canvas/scripts/run_production_runtime_readiness_e2e.mjs`, `canvas/scripts/run-runtime-readiness-demo.mjs`, and `docs/TESTING.md`. | `npm run ci:affected` passed 11/11 owner checks at candidate `ea66716254da82cf5a25f5cba0388cf0b4372ef4`, including Observability map/exact-hash read and `/81rv10/` demo activation at 390 x 844. |
| Canvas also has a separate Worker evidence route. | Canvas `worker/source-evidence-extension.js`, `worker/index.js`, `wrangler.jsonc`. | Source confirmed; object bucket/rate limiter make it unsuitable for this local MVP. |
| Product deployment and money effects have separate owners. | Canvas `docs/FACTS.md`; Graph `docs/agentic-graph-acos-deploy-runbook.md`, `docs/production-rollback-baseline.md`; Commerce `README.md`, `docs/deploy-boundary-register.json`. | Confirmed as policy; no effect performed. |
| ADLC source and product deployment are separate. | OS `docs/START-WORKFLOW.md`, `docs/RELEASE-WORKFLOW.md`, `guides/DEPLOY-WORKFLOW.md`. | Confirmed; no publish/deploy requested. |
| Agentic OS readiness, docs, and module budgets pass at the pinned revision. | Agentic OS `guides/SYSTEM-PROMPT-RUNTIME.md`, `docs/START-WORKFLOW.md`, `docs/adlc-guidelines.md`, `docs/RELEASE-WORKFLOW.md`; check `npm run evals`. | `npm run evals` passed at `abcca45be8a0bfd7dcd5e17ab253ec7631d74507`: readiness proof, docs budget, and 49/49 module budget checks. |

## Live retained mission observation

At `http://127.0.0.1:5175/observability/index.html`, the live workspace was opened, Graph was selected, and **Read retained observation** loaded the existing `/.workspace/workflow-b1990265b70aad35bc4926868b3d28f0/agent-mission.manifest.json` in read-only mode. The manifest binds Graph revision `99f964934caaccc99e72473dc7e70af57a8860af` and tree `54048b3714e3c89f6efa54acdd7c869ab94e81a3`; its active local allocation points to candidate `ea66716254da82cf5a25f5cba0388cf0b4372ef4`, has `authority:false`, and contains no release evidence. The rendered mission dashboard shows no linked sources, `failed / unevaluated`, a partial trace, and an unknown evaluation score. This is a local workflow observation, not deployed-runtime proof. No manifest or Canvas view preference was changed.

## Gaps

Graph's exact E2E output used loopback ports 50922 and 50923 for this run, reported source revision `99f964934caaccc99e72473dc7e70af57a8860af`, mapped ten files under `src/runtime`, and exact-read `src/runtime/bounded-json.ts` at SHA-256 `d4c8d503c910cbcfed18ceec7cfaf4474f8b4a1cf57dc75ff34b00b1749dfb4b`. Browser errors and cross-origin requests were zero; the candidate and canonical Graph worktrees remained unchanged. Demo activation issued local filesystem list/write/reveal requests to its isolated catalog and no model-like request. It tolerated only the documented optional workspace-readme 404.

The mobile run kept document width at 390 px, but recorded nested markdown controls extending to x=1039. The smoke checks page overflow, not whether every toolbar control can be reached on touch. Two-device digest parity, assistive-technology use, and offline replay remain unverified. `npm run ci:affected` passed at Graph candidate `ea66716254da82cf5a25f5cba0388cf0b4372ef4` with 11/11 registered checks; receipt: `/Users/huijoohwee/Documents/GitHub/.workspace/.artifacts/agent-observability-economy-20260916/validation-65d979ddbf5cf70d59ff044a/validation-last.json`.

On the Canvas authoring lane, `npm run docs:check` passed with 78 artifacts. `npm run build` passed with Graph source `99f964934caaccc99e72473dc7e70af57a8860af`; the largest emitted JS chunk was 446,699 bytes and all JS chunks stayed below 500,000 bytes. The generated local build is not protected release evidence.

No protected publication, Dev/Production deployment, live production readback, payment, or rollback effect occurred. Runtime-ready and deployed-production verdicts remain false/unverified.
