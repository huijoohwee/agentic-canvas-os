---
title: "Agent Toolkit"
graphId: "md:agent-toolkit"
doc_type: "Agent Toolkit Runtime Contract"
date: "2026-07-20"
lang: "en-US"
schema: "agent-toolkit-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-offline-dev"
command: "/agent.toolkit"
semantics: ["#agent-toolkit", "#runtime-ready", "#token-economics"]
bindings: ["@agent-toolkit-observer", "@runtime-proof", "@operator"]
external_dependency: false
telemetry_policy: "bounded metadata only; no prompt, input, output, tool payload, private reasoning, secret, or default network egress"
learning_policy: "evidence-backed review-pending proposal only; no automatic application, training, registry mutation, promotion, or deployment"
improvement_claim: "unverified until exact revision-bound measurements pass an approved cohort policy"
runtime_owners:
  execution: "existing Running Agents, Function Calling, Agent Orchestration, Agent Swarm, or injected application adapter"
  observation: "agent-api/src/agent-toolkit*.js"
  durable_state: "AGENT_STATE through agent-api/src/durable-object-state-store.js"
  evaluation: "application-injected evaluator and dataset identities bound to caller-declared revision digests"
  review: "operator or application-owned review system"
proof:
  - "__tests__/agent-toolkit.test.mjs"
  - "__tests__/durable-agent-state.test.mjs"
  - "__tests__/agent-api-app.test.mjs"
  - "__tests__/cloudflare-worker.test.mjs"
concept_sources:
  - "https://github.com/NVIDIA/NeMo-Agent-Toolkit"
  - "https://docs.nvidia.com/nemo/agent-toolkit/latest/"
  - "https://docs.nvidia.com/nemo/agent-toolkit/latest/improve-workflows/profiler.html"
  - "https://docs.nvidia.com/nemo/agent-toolkit/latest/improve-workflows/optimizer.html"
publish_policy: "Dev-only until explicit operator approval"
---

# Agent Toolkit

Agent Toolkit is a native observer, evaluator, comparison, and learning-proposal
layer for exact agent and team revisions. Its adapter contract is
framework-neutral: an application can wrap a supported runtime without moving
execution, scheduling, tool policy, or final-answer ownership into the Toolkit.
Compatibility is proven per adapter; this contract does not claim universal
framework compatibility.

## Ownership Boundaries

| Concern | Owner | Toolkit boundary |
|---|---|---|
| Agent or team execution | Existing runtime or injected application adapter | Observes metadata; never becomes the runner. |
| Team topology and scheduling | Agent Orchestration or Agent Swarm | Does not invent roles, tasks, branches, or workflows. |
| Model and tool calls | Running Agents and Function Calling | Accepts one owner-reported aggregate cost; never double-counts nested calls. |
| Authorization | Authenticated session plus application authorizer | Fails before evaluator spend or proposal persistence. |
| Evaluation | Injected evaluator plus digest-bound dataset and metric identities | Missing or failed evidence remains `unreported`; quality is never inferred. |
| Learning | Review-pending proposal record | No apply, prompt rewrite, fine-tuning, registry mutation, promotion, or deploy method exists. |

## Exact Adapter Contract

Every run fixes these identities before observation:

- `target`: `agent` or `team`, exact id, revision, and SHA-256 digest;
- `candidate`: exact id, revision, and SHA-256 digest;
- `adapter`: exact id, revision, and SHA-256 digest;
- `profile`: evaluator, dataset, and metric ids, revisions, and SHA-256 digests
  plus `maximize` or `minimize` direction;
- `runId`, `cohortId`, and a bounded operation name.

Those identities are caller-declared and consistency-checked, not looked up in
an internal or external revision registry. An application authorizer must
verify each digest against its trusted source before treating provenance as
verified; the default readiness state is `application-authorizer-required` and
revision provenance otherwise remains `unverified`.

The local `instrument(request, operation, access)` wrapper passes a server-owned
`AbortSignal`, returns the adapter value to its caller, and persists no value or
input. Direct lifecycle methods let an authenticated integration start and
finish metadata spans around work that remains owned elsewhere.

## Lifecycle

| Method or route | Effect | Terminal evidence |
|---|---|---|
| `start` / `POST /api/agent-toolkit/start` | Authorize and reserve one run plus an exact cohort. | Session-owned running record or typed block. |
| `startSpan` / `start-span` | Server-time one bounded nested component span. | Id, parent, kind, operation, component revision, and start time only. |
| `finishSpan` / `finish-span` | Finish an open span using server time. | Status, stable reason code, and observed duration. |
| `complete` / `complete` | Seal the run and append one idempotent cohort sample. | Run duration, status, and one aggregate cost state. |
| `evaluate` / `evaluate` | Reserve a fenced attempt, call the injected evaluator outside durable claims, then commit digest-bound provenance. | Reported score and unique evidence reference, or honest unreported state. |
| `compare` / `compare` | Compare exact baseline and candidate identities inside one cohort. | Deterministic policy checks and `propose` or `hold`. |
| `propose` / `propose` | Persist an evidence-digest-bound proposal. | Immutable `review_pending`, `reviewRequired: true`, `applied: false`. |
| `status` / `status` | Read one sanitized run owned by the session principal. | Metadata-only run, spans, cost, and evaluation state. |

HTTP accepts no caller-owned signal. `instrument` is a library method rather
than a remote execution route, so arbitrary framework payloads and callbacks do
not cross the Worker API.

## Metadata-Only Observability

Stored spans contain component identity, parent relation, operation, timestamps,
duration, status, and a stable reason code. Run evidence contains exact revision
metadata, aggregate cost state, metric provenance, score when reported, and
opaque evidence ids and digests.

The Toolkit does not store prompts, inputs, outputs, tool arguments or results,
headers, secrets, private reasoning, exception messages, or provider state. It
has no exporter and performs no default network egress. Platform logging or an
external observability backend is not claimed by this application-level ledger.
Opaque identifiers use a conservative bounded machine-token grammar, but no
grammar can determine whether a token is sensitive; the application authorizer
must reject secret-bearing identifiers before admission.

Session authentication proves ownership, not telemetry truth. Locally wrapped
server timing is `server-observed`; direct library lifecycle calls are
`application-verified` only at an application-owned trusted boundary. HTTP
lifecycle submissions are always `remote-unverified`, stay visible as such,
and are excluded from comparison and proposal evidence. Digest binding,
application authorization, unique evidence, minimum samples, and same-cohort
rules reduce but cannot eliminate poisoning risk.

## Evaluation And Recommendation

Evaluator work happens after a durable attempt reservation and outside every
Durable Object claim. The evaluator adapter must honor the server-owned
`AbortSignal` and stable idempotency key; timeout or abort leaves an attempt
in-doubt until its lease expires, and any retry reuses that key. Commit requires
the live reservation fence and the metric id, revision, digest, and direction
fixed at run admission. An expired or stale attempt cannot overwrite a newer
result, and one evidence digest cannot satisfy multiple cohort samples.

Comparison uses successful trusted samples for one cohort bound to target,
adapter, operation, profile, and candidate digests. It requires the declared
minimum sample count plus reported quality and cost for both sides, and reports
trusted and excluded-untrusted counts. Arithmetic means feed four explicit
checks:

1. candidate quality meets the direction-aware boundary;
2. candidate quality improvement meets the declared minimum;
3. observed latency regression stays within its ratio;
4. reported aggregate cost regression stays within its ratio.

Missing quality, missing cost, reused evidence, remote-unverified telemetry,
cross-cohort evidence, zero-denominator regressions, or too few trusted samples
produce `hold` or `insufficient-evidence`, never an invented improvement. A
passing comparison is still correlation within the declared cohort, not a
general causal claim. Comparison reads already committed evidence and does not
require a configured evaluator; only new evaluation work does.

## Continuous Learning

Continuous learning is the bounded sequence `evidence -> evaluation ->
comparison -> review-pending proposal`. The proposal binds exact baseline and
candidate revisions to the comparison digest and is idempotent by operation id.
An external reviewer may use that record in its own authorized workflow. The
Toolkit cannot approve or apply it.

## Durability, Bounds, And Recovery

`AGENT_STATE` stores one coordination atom per run and one per cohort. Claims are
short and never cover adapter or evaluator I/O. Its Durable Object adapter
schedules an alarm at the nearest claim or record expiry: the alarm recovers a
live record from an expired claim or physically deletes an expired atom, then
reschedules the next boundary. The in-memory fallback preserves the atomic
interface with logical expiry only and reports no horizontal recovery. Current
defaults:

| Bound | Default |
|---|---:|
| Run retention and fixed deadline | 30 minutes |
| Cohort rolling retention | 7 days |
| Spans per run | 128 |
| Samples per cohort | 64 |
| Proposals per cohort | 16 |
| Evaluator attempts | 2 |
| Adapter or evaluator call timeout | 60 seconds |
| Serialized record ceiling | 300,000 characters |

Run and cohort keys are derived from the authenticated principal, so foreign
principals receive no existence disclosure. The authenticated session must
cover the fixed run deadline. A refreshed token that creates a new session
principal cannot resume the old namespace; longer-lived cohorts require a
stable, tenant-scoped application principal established by the application
authorizer. Cohort samples are bounded; older entries leave the rolling window
instead of creating unbounded Durable Object hotspots.

The library bounds each record and cohort but does not implement a global or
per-principal request quota. Any remotely exposed deployment must add an
application-owned rate limit and object-cardinality quota before it can claim
production abuse resistance; this Dev contract makes no such claim.

## Clean-Room Boundary

The NVIDIA materials in frontmatter inform only the broad capability class:
framework-neutral instrumentation, profiling, evaluation, and optimization.
This implementation was authored against existing repository contracts. It
must not copy or depend on external code, prose, prompts, schemas, CLIs, APIs,
configuration, examples, tests, fixtures, assets, defaults, algorithms,
packages, services, model endpoints, or runtime names.

## Verification

```sh
npm run agent-toolkit:check
npm test
npm run web:build
npm run docs:check
```

VCC: two runtime instances share atomic state, only one evaluator reservation
spends, server-owned timing survives without raw payload retention, digest-bound
cohorts reject untrusted or insufficient evidence, supported evidence produces
only a review-pending proposal, readiness stays sanitized, and no external
package or default egress is added.
