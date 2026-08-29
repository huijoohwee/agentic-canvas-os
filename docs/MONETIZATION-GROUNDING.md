---
title: "Monetization Grounding Contract"
graphId: "md:agentic-canvas-os-monetization-grounding"
doc_type: "Monetization Grounding Contract"
date: "2026-08-28"
lang: "en-US"
schema: "agentic-canvas-os-monetization-grounding/v1"
frontmatter_contract: "required"
status: "spec-complete"
authority: "pain-point-to-first-dollar grounding for what this repository already ships"
runtime_scope: "monetization planning evidence only; no runtime, provider, or deployment claim"
runtime_claim: "reading or resolving this document performs no mutation, spend, or deployment"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
operating_priorities: ["minimum-viable-maximum-value", "time-to-value", "high-ROI", "TCO", "token-economics", "FOSS-first"]
shipped_surface:
  worker: "Cloudflare Worker product tier calling the AgenticGraph control plane over MCP; holds no model provider keys"
  agentic_graph_client: "typed deterministic agentic-graph ingest, parser-generate, query, and edge-explanation client (src/knowgrph-mcp-*.js)"
  canvas: "embedded live agentic-graph canvas with interactive HTML export (web/app.js)"
first_dollar_boundary: "manual concierge delivery from the Dev boundary; production deployment remains separately gated"
---

# Monetization Grounding Contract

This is a grounding contract, not marketing. Every claim below is bound to a
surface this repository already ships or to an explicit evidence obligation
that must be satisfied before spend. It exists so the first revenue decision
optimizes minimum-viable maximum-value and time-to-first-dollar instead of
speculative feature work.

## Pain Point

One provable, paid-for pain: **a developer, consultant, or acquiring team must
understand an unfamiliar codebase quickly and defend the conclusions with
evidence.** Codebase due-diligence, onboarding audits, and architecture
briefs are already purchased today as consulting deliverables and as
code-intelligence subscriptions; demand is provable because buyers currently
pay humans days of effort for the same artifact.

Demand-evidence obligation (fail-closed before any paid pitch):

- name one real prospective paying customer (a person or company with an
  active codebase-understanding need and a budget), not a persona;
- record the artifact they pay for today (audit report, onboarding doc,
  due-diligence brief) and its current cost in hours or dollars; and
- record their acceptance criterion for a replacement deliverable.

## Solution

The deliverable this repository can already produce: a **deterministic,
evidence-backed interactive codebase graph**.

| Shipped surface | Role in the deliverable |
|---|---|
| Agentic-graph MCP client | `/agentic.graph.ingest` compiles the client workspace into a digest-fenced explained-edge snapshot through the knowgrph executable owner; every edge carries source evidence, with zero model or network spend. |
| Query and explanation | `/agentic.graph.query` and `/agentic.graph.explain` answer scoped audit questions with ordered, reproducible evidence instead of model guesses. |
| Embedded canvas | The live canvas renders the snapshot for guided walkthroughs. |
| Interactive HTML export | `web/app.js` exports a self-contained interactive graph file a client can open with no installation, account, or hosted dependency. |

The buyer receives the exported interactive graph plus a short written brief
whose statements cite graph evidence. Determinism is the differentiator: the
same workspace reproduces the same digest-fenced result, so conclusions are
auditable rather than plausible.

## Feature Ranking

Ranked by distance from already-built and by code required before the first
dollar; lower rank must not start before a higher rank has either shipped or
recorded a typed blocking finding.

| Rank | Offer | Distance from built | New code required |
|---|---|---|---|
| 1 | Concierge codebase-audit deliverable: operator runs ingest locally, curates the canvas view, exports the interactive HTML graph, writes the evidence brief, invoices. | Zero - every step uses shipped surfaces. | None. |
| 2 | Repeat-audit retainer: same deliverable re-run per release; digest fencing proves what changed between snapshots. | Zero surface distance; packaging only. | None. |
| 3 | Hosted read-only graph share links through the existing Worker product tier. | Worker tier exists; sharing route and authorization do not. | Minimal, but gated behind the deployment boundary and therefore not a first-dollar path. |
| 4 | Premium demo surfaces (voice studio, XR, game mode) attached to audits. | Contracts exist; sales evidence does not. | Deferred until rank 1 revenue exists. |

## Fastest Path To A Real First Dollar

1. Satisfy the demand-evidence obligation above for one named customer.
2. Produce the rank-1 deliverable for that customer's repository using only
   shipped surfaces: ingest, query, canvas walkthrough, HTML export, brief.
3. Invoice a fixed price anchored to the hours the artifact replaces.
4. Record the transaction evidence (invoice, payment, acceptance) in the
   memory log; only that record upgrades this contract's demand claim from
   provable to proven.

This path requires no deployment, no Prod mirror, no Cloudflare authority, no
model spend, and no new code. A second dollar from a second customer, not more
features, is the required next validation step.

## Boundaries

- This document grants no pricing, deployment, provider, or spend authority.
- Hosted or self-serve offerings (rank 3+) remain closed until the protected
  release path separately authorizes them.
- If the demand-evidence obligation cannot be satisfied, the correct outcome
  is a typed finding recording that the pain point failed validation - not a
  pivot to speculative features.

## VCC

Given the shipped Worker tier, agentic-graph MCP client, canvas, and HTML
export, when the rank-1 concierge deliverable is produced for one named
customer and paid, then the payment evidence is appended to the memory log and
this contract's demand claim is marked proven; stop without deployment,
provider spend, or new surface work.
