---
title: "Orchestration Projection"
graphId: "md:orchestration-projection-contract"
doc_type: "Runtime Contract"
date: "2026-08-19"
lang: "en-US"
schema: "agentic-orchestration-projection-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
---

# Orchestration Projection

The orchestration projector is a Dev-only local transform. It reads existing ACOS receipts and emits one Markdown projection document for Knowgrph Storyboard import. It does not run receipt emitters, call model providers, reach the network, deploy, mutate Git, write under `docs/`, or create a production mirror.

## Receipt capture inputs

Capture stdout-emitted receipts before running the projector:

- `worktree:lifecycle:check` to `<Projection_Output_Root>/receipts/worktree-lifecycle-report.v1.json`
- `workspace:parallelism:check` to `<Projection_Output_Root>/receipts/workspace-parallelism-report.v1.json`
- `coordination:schedule` to `<Projection_Output_Root>/receipts/coordination-scheduler-report.v1.json`
- `collaboration:gate` to `<Projection_Output_Root>/receipts/collaboration-gate-result.v2.json`

The projector reads these in-place receipts:

- local runtime readiness at `<Runtime_State_Root>/knowgrph-local-runtime/readiness.json`
- writer lease registry at `<Git_Common_Dir>/agentic-canvas-os/writer-leases.json`

`AGENTIC_ORCHESTRATION_PROJECTION_STATE_ROOT` is the only output-root override. Without it, output resolves below the workspace runtime-state root, outside the repository working tree.

## Failure reasons

- `input-absent`: a required receipt, authored axis, or registry is missing.
- `malformed-json`: a receipt file is not JSON.
- `schema-id-mismatch`: the observed receipt schema differs from the expected schema.
- `schema-validation-failed`: a formal schema or structural receipt check failed.
- `stale-observation`: a timestamped receipt is older than the authored lease TTL bound relative to the newest observation.
- `budget-exceeded`: the rendered projection would exceed the line budget.

## Projection document contract

Every emitted document carries these authored frontmatter keys: `title`, `graphId`, `doc_type`, `date`, `lang`, `schema`, `frontmatter_contract`, and `status`. It also carries the Dev-only publish policy, `canvas2dRenderer: "storyboard"`, and Knowgrph's parser-owned `kgCanvas2dRenderer: "storyboard"` so opening the document resolves to Storyboard with no renderer control.

The projection contains only schema-id and timestamp provenance. It must not emit filesystem paths, account names, ports, session identifiers, localhost URLs, sibling assets, or credential-shaped tokens.

## Dashboard rollup semantics

The existing Knowgrph `Dashboard_Surface` can build its fixed, schema-agnostic
model from the graph represented by a generated Projection_Document. This is a
read-only rendering boundary: the projector does not select a Dashboard renderer,
add a renderer mode, or alter Dashboard metrics.

- `nodes` - **Orchestration meaning.** The count of emitted orchestration stage
  cards: one node for every attained stage in every projected lane. It changes
  whenever the projected card count changes.
- `edges` - **Generic only.** The graph relationship count. The current
  Projection_Document emits no edges, so this is `0`; it does not represent lane
  dependencies, coordination waves, or stage transitions.
- `density` - **Generic only.** The Dashboard's graph-density calculation from
  edges and possible directed node pairs. With no projected edges it is `0%`; it
  is not a completion, capacity, or parallelism measure.
- `signals` - **Generic only.** The Dashboard's count of numeric-property fields
  plus output/media-classified properties. For this projection it describes the
  generic card-property shape (including numeric `order`), not orchestration
  health, failures, or readiness.
- `grid` - **Generic only.** The shared Dashboard canvas-grid presentation
  setting supplied by Knowgrph schema configuration. It carries no orchestration
  state.

## Deferred increments

Raw receipt drill-down is deferred to the receipt table increment. Formal JSON Schemas for the four structurally validated receipts remain a non-goal for this projector and belong to each receipt emitter owner. A later deferred increment must revise the projection schema id rather than extend the current version in place.

The whole-value provenance rule and Dev-only operating scope are policy requirements reviewed with this document rather than automated by the projector.

## Duplicate-logic advisory

`npm run orchestration:projection:duplicate-logic:advisory` performs a local, deterministic comparison of function bodies across the six projector modules. It reports identical bodies as advisory findings and always completes without changing the aggregate `check` outcome. The report has no network, deployment, Cloudflare, Git-mutation, or runtime-state side effects; findings require maintainer review because semantic duplication cannot be decided safely from source text alone.
