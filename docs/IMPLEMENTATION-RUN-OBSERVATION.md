---
title: "Implementation Run Observation"
graphId: "md:implementation-run-observation"
doc_type: "Product Runtime Contract"
date: "2026-09-05"
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

This ACOS product surface specifies the native wire invocation
`/adlc.observe #adlc-observability @implementation-run @canvas @runtime-proof`
and tool `agentic-graph.adlc.observe`. It grants no lifecycle authority: the
pinned `agentic-os` ADLC harness is the only lifecycle owner. Observation is
not an Evaluator, runner, release controller, graph store, dashboard, or renderer.

## Receipt boundary

The native observer reads `state.result.adlcLedger` joined to one
`adlc.ledger_bound` event at `ledgerRevision + 1`. The receipt has exactly eight
fields. This syntax-only example uses zero hashes with no source or authority;
it is not an authentic receipt or runtime proof:

```yaml
schema: "adlc-ledger-receipt/v1"
canonicalSchema: "adlc-run/v1"
artifact: "opaque-ledger-reference"
digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
bytes: 2
canonicalRunId: "run-id"
ledgerRevision: 1
acosRevision: "0000000000000000000000000000000000000000"
```

The digest grammar is `sha256:<64-lowercase-hex>`. Real receipts bind exact
artifact bytes, digest, canonical run identity, positive integer ledger revision,
and the captured plan's exact 40-hex evaluator revision. `bytes` is an integer
at least 2; hashes and counts must match the artifact, not this example.
`canonicalSchema` identifies the original ledger bytes, never a renamed copy.

The request fields are `invocation`, `runId`, `view`, `expectedRevision`, `expectedLedgerDigest`, `cursor`, and `limit`.
The route requires action `/adlc.observe`, semantic `#adlc-observability`, and bindings ordered as `@implementation-run`, `@canvas`, `@runtime-proof`.

The result is `agentic-graph-adlc-observation/v1` with `source`, `status`, `conformance`, `projection`, `cache`, and `economics`. It validates and projects
the supplied receipt; it never repairs, grades, promotes, or mutates it.
`source.receiptSchema` preserves the wrapper identity and `source.canonicalSchema`
preserves the original source schema. Native conformance summaries use
`agentic-graph-adlc-conformance-summary/v1` without asserting a native producer.

## Historical read compatibility

The single agentic-graph historical adapter may read an unchanged
`state.result.agenticSdlcLedger`, seven-field `agentic-sdlc-ledger-receipt/v1`,
and `agentic_sdlc.ledger_bound` event together. It accepts original
`agentic-sdlc-run/v1` bytes only with their exact clean, pinned historical
evaluator. A native receipt can identify that same original source through
`canonicalSchema`; its result field and event remain native. Dual fields, mixed
receipt/event identities, duplicate binding revisions, schema or digest drift,
and missing provenance fail closed. Historical bytes and receipts are never rewritten.
Former tool and invocation aliases are not advertised or dispatched.

## Evaluator availability

The current source owner has no native canonical-run evaluator for `adlc-run/v1`.
It remains a reserved source identity: native observation returns nonretryable
`adlc_evaluator_unavailable` before artifact binding or projection and produces
no conformance claim. A historical revision without its evaluator returns the
same unavailable result; the adapter never invents a loader, installs a fallback,
or recreates a lifecycle owner. Successful historical observation reports only
that source's conformance. Graph's protected implementation and exact ACOS docs
pin remain prerequisites for cross-repository parity.

## Existing Canvas projection

The complete node vocabulary is `run`, `criterion`, `vcc`, `task`, `transition`, `dispatch`, `return`, `check`, `evidence`, `finding`, `budget`, `receipt`, `gate`, and `checkpoint`.

The complete edge vocabulary is `defines`, `covers`, `dependsOn`, `transitionsTo`, `dispatchedAs`, `returnedAs`, `verifiedBy`, `evidencedBy`, `consumes`, `gatedBy`, and `persistedAs`.
The bounded views are `overview`, `plan`, `execution`, `evidence`, `economics`, `recovery`, `receipts`, and `full`.

Nodes order by type rank then id; edges order by relation rank, source, target, then id. A truncated placeholder carries `properties.stub=true`. Projection uses
`adlc-canvas-projection/v1` and `kgSchema: "kgc-computing-flow/v1"`
through existing KGC, GraphData, and Canvas owners.

## Non-promoting states

Only the named Evaluator may set `verified`. agentic-graph `delivery_ready` is a review handoff only; never translate it into `verified`, merged, accepted, or deployed.
`deployed` requires the existing exact product release receipts; observation creates no authorization, deployment attempt, or publication evidence.

## Economics and proof boundary

The focused source contract records exact zeros for network calls, model calls,
prompt tokens, completion tokens, and estimated cost. It is spec-complete, not
runtime-ready. It does not claim current-guideline, protected agentic-graph,
cross-device, Prod, or Cloudflare runtime parity. Live source authenticity and
rendering remain separate evidence.
