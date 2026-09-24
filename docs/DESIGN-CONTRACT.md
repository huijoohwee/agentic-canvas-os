---
title: "Native design enforcement PRD-TAD-ADR-MVP-GTM"
graphId: "md:native-design-enforcement"
doc_type: "PRD-TAD-ADR-MVP-GTM"
date: "2026-09-24"
lang: "en-US"
schema: "agentic-canvas-os-native-design-enforcement/v1"
frontmatter_contract: "required"
status: "source-verified"
version: "0.1.1"
continuity_id: "CANVAS-NATIVE-DESIGN-ENFORCEMENT"
prd_revision: "0.1.1"
tad_revision: "0.1.1"
adr_revision: "0.1.1"
mvp_revision: "0.1.1"
gtm_revision: "0.1.1"
owner: "Canvas control-surface maintainers"
local_rung: "source-verified"
delivered_rung: "pending-protected-integration"
lane: "authoring"
universal_scope: false
load_policy: "on-demand"
---

# Native design enforcement

## PRD

Design adoption needs consistent evidence across human and agent routes. Reuse the policy owner in
`huijoohwee.github.io/guidelines/design-theme-contract.md`, its joined `NATIVE-DESIGN-CONSISTENCY`
record, and `agentic-os/design`. This repository owns only the transport adapter. Acceptance requires
matching domain results across CLI, MCP and WebMCP, a host-pinned policy, and explicit failure when
the installed upstream export is unavailable. Structural success never proves browser appearance.

## TAD

`scripts/design-contract.mjs` forwards bounded arguments to the installed OS CLI. It never updates a
package, reads the bound source itself or adds dictionary aliases. The native invocation is
`/design.check #read-only @input:record.json`; the upstream MCP server owns `design.check` with
`{input: "record.json"}`. Canvas command example:

```sh
node scripts/design-contract.mjs /design.check '#read-only' '@input:record.json'
```

`web/design-contract.mjs` exports `createDesignContractTool` and `registerDesignContractTool`.
An admitted host supplies the `agentic-os/design` module and a reviewed `expectedPolicyDigest`.
The tool `agentic-canvas-os.design_check` receives the same bounded bundle and calls the shared
checker. The host pin cannot be overridden by tool input. Register once on the host's existing
`navigator.modelContext`; dispose the returned registration by aborting its registration signal when its host unmounts. Never clear
another owner's tools. Unsupported WebMCP surfaces fail explicitly; CLI remains the local option.

Flows: author creates source-bound record -> exact native invocation -> shared verifier -> findings ->
existing review owner. Browser input stays in process; no filesystem, model, network, storage or
appearance mutation is performed. MainPanel Settings remains the application owner for text, icons,
density, typography and theme choices. Ideograms retain meaning and accessible labels; Tropical
Playground remains native scene artwork. These concerns live in the policy, never this adapter.

## ADR

Consume one verifier, with an injected browser host seam and a pinned local CLI seam. Duplicating its
rules or silently upgrading an upstream candidate would break source authority. Agentic OS protected
main integrated the checker at `a04c643f78c2ddafcfde766d063f28765996f482`. This repository now
pins that exact archive and lockfile integrity. The CLI and an admitted host can run the shared
checker; automatic browser mounting still requires an application composition owner. No production
or browser-runtime claim follows from this document or its transport tests.

## MVP

Deliver the two adapters, lifecycle/pin/grammar tests and this joined record. Keep them on demand;
zero always-load bytes, no new package beyond the already-declared Agentic OS dependency, no paid infrastructure. At most six files / 30 kB source,
under 600 lines per file and 500 kB per chunk. Shared active-work cap is 75 minutes including upstream
and guideline changes. Local verification: focused adapter tests, docs contract and authored budgets.
The product build remains unchanged until admitted browser composition exists.

The upstream checker and its exact protected merge are integrated. This slice admits its archive
through the existing lockfile and verifies the same bundle through native CLI and injected WebMCP
adapter. A separate browser-composition change must mount the lazy adapter in a supported host and
verify it there. The local application at port 5175 is not this candidate's runtime proof.
Rollback removes the adapter registration and restores the prior source revision; no data migration.

## GTM

This is delivery assurance for existing workspace operators. It introduces no independent product,
price plan, outreach, demand claim or payment. Expected value is less repeated design drift;
measure that through the owning product's pilot. All new execution is local and model-free.

## Observed verification and handoff

The prior adapter checks covered missing upstream/pin, host-pin mismatch, scoped
registration/disposal and exact CLI tuple rejection. This admission also checks the installed
checker export, its locked archive and actual CLI/adapter parity on one source-bound bundle.
`npm run check:source` passed: 973 tests, the web build, docs contract (75 artifacts), and the
authored line budget.
An isolated integration supplied the OS candidate engine to the WebMCP host adapter and a temporary
CLI harness. Both returned the same passing structural result as actual OS MCP stdio for six concerns
and four Graph source files at `414ca9afcea332c7e5f357a850caa9463bb837c5` (56,784 input bytes).
The reviewed policy digest is `28d40ad252ad067e0fd6f0d51c16c4c4d4dc76bbffc80f26101bf0e341e7abce`.
This proves adapter composition with the candidate, not the browser's actual WebMCP implementation.
The adapter follows Graph's existing `registerTool(tool, {signal})` lifecycle at
`canvas/src/features/agent-ready/webMcpLifecycle.mjs` and aborts only its own registration.

The previous pin correctly failed with `design-check-upstream-unadmitted`. The current pin names the
protected upstream merge; package and lockfile changes are limited to that archive and integrity.
Local source checks establish transport parity, not native browser mounting or visual acceptance.
