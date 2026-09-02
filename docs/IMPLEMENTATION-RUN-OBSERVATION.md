---
title: "Implementation Run Observation"
graphId: "md:implementation-run-observation"
doc_type: "Product Runtime Contract"
date: "2026-09-02"
lang: "en-US"
schema: "agentic-implementation-run-observation/v1"
frontmatter_contract: "required"
status: "spec-complete"
authority: "read-only product projection from an immutable implementation-run receipt"
publish_policy: "Dev-only; no lifecycle, release, deployment, or cleanup authority"
runtime_scope: "documentation contract for receipt validation, bounded Canvas projection, and honest economics"
runtime_claim: "one specified non-promoting observation contract; no live source, renderer, or integration claim"
runtime_proof: "../__tests__/implementation-run-observability-contract.test.mjs"
---

# Implementation Run Observation

This ACOS product surface retains the established wire invocation
`/sdlc.observe #agentic-sdlc-observability @implementation-run @canvas @runtime-proof`
for cross-repository compatibility. The token name grants no Agentic SDLC
lifecycle authority: the pinned `agentic-os` ADLC harness is the only lifecycle
owner. Observation is not an Evaluator, runner, release controller, graph store, dashboard, or renderer.

## Receipt boundary

The observer reads only `state.result.agenticSdlcLedger` with this immutable
receipt shape:

```yaml
schema: "agentic-sdlc-ledger-receipt/v1"
artifact: "opaque-ledger-reference"
digest: "sha256:<64-lowercase-hex>"
bytes: 1
canonicalRunId: "run-id"
ledgerRevision: "immutable-ledger-revision"
acosRevision: "40-character-source-revision"
```

The digest grammar is `sha256:<64-lowercase-hex>`.

The request fields are `runId`, `view`, `expectedRevision`, `expectedLedgerDigest`, `cursor`, and `limit`.
The route requires action `/sdlc.observe`, semantic `#agentic-sdlc-observability`, and bindings ordered as `@implementation-run`, `@canvas`, `@runtime-proof`.

The result is `agenticgraph-agentic-sdlc-observation/v1` with `source`, `status`, `conformance`, `projection`, `cache`, and `economics`. It validates and projects
the supplied receipt; it never repairs, grades, promotes, or mutates it.

## Existing Canvas projection

The complete node vocabulary is `run`, `criterion`, `vcc`, `task`, `transition`, `dispatch`, `return`, `check`, `evidence`, `finding`, `budget`, `receipt`, `gate`, and `checkpoint`.

The complete edge vocabulary is `defines`, `covers`, `dependsOn`, `transitionsTo`, `dispatchedAs`, `returnedAs`, `verifiedBy`, `evidencedBy`, `consumes`, `gatedBy`, and `persistedAs`.
The bounded views are `overview`, `plan`, `execution`, `evidence`, `economics`, `recovery`, `receipts`, and `full`.

Nodes order by type rank then id; edges order by relation rank, source, target, then id. A truncated placeholder carries `properties.stub=true`. Projection uses
`agentic-sdlc-canvas-projection/v1` and `kgSchema: "kgc-computing-flow/v1"`
through existing KGC, GraphData, and Canvas owners.

## Non-promoting states

Only the named Evaluator may set `verified`. Knowgrph `delivery_ready` is a review handoff only; never translate it into `verified`, merged, accepted, or deployed.
`deployed` requires the existing exact product release receipts; observation creates no authorization, deployment attempt, or publication evidence.

## Economics and proof boundary

The focused source contract records exact zeros for network calls, model calls,
prompt tokens, completion tokens, and estimated cost. It is spec-complete, not
runtime-ready. It does not claim current-guideline, protected Knowgrph,
cross-device, Prod, or Cloudflare runtime parity. Live source authenticity and
rendering remain separate evidence.
