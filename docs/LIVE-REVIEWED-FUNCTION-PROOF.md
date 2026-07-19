---
title: "Bounded Live Reviewed Function Proof"
graphId: "md:live-reviewed-function-proof"
doc_type: "Runtime Proof Contract"
date: "2026-07-19"
lang: "en-US"
schema: "agentic-live-reviewed-function-proof/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "accepted Dev evidence for one reviewed OpenAI Responses function call and one native Knowgrph mutation"
runtime_scope: "route-free Agentic Canvas OS and Knowgrph Dev Workers only"
runtime_claim: "one approved logical provider run completed in two Responses requests with one signed review, one applied native receipt, and one persisted run-note revision"
runtime_owner: "../scripts/live-function-run-note-proof.mjs; ../worker/index.js"
runtime_proof: "../__tests__/live-function-run-note-proof.test.mjs; ../__tests__/cloudflare-worker.test.mjs; FUNCTION-CALLING.md; RUNTIME-PROOF.md"
external_pattern_source: "https://developers.openai.com/api/docs/guides/function-calling; https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/"
external_source_policy: "concept reference only; forbid copied code, examples, prompts, schemas, fixtures, tests, or prose"
publish_policy: "Dev evidence only; Prod, Pages, and custom-domain deployment remain forbidden without separate approval"
---

# Bounded Live Reviewed Function Proof

The accepted 2026-07-19 run resumed the one already-paused durable continuation instead of starting another provider run. The exact signed reviewer decision authorized one `update_agent_run_note` call. Agentic Canvas OS used a Dev-only Cloudflare Service Binding for the same-zone Knowgrph MCP Worker, while the OpenAI request stayed on the public fetch transport.

## Accepted Result

| Evidence | Returned value |
|---|---|
| Agentic source SHA | `41f3f5a40d7fa49e75cca067eeba9e9d0aeb8ffc` |
| Agentic Dev Worker version | `f5c5999a-5cc5-4637-9663-0a84d08da6c8` |
| Knowgrph Dev Worker version | `e8747308-e6af-4e82-957d-cb9b764d575d` |
| Function run | `dev-provider-proof-function-20260719-live-01` |
| Target manifest | `dev-provider-proof-manifest-20260719-live-01` |
| Provider model | `gpt-5.6-luna` |
| Provider requests | `2` inside `1` logical provider run |
| Function calls | `1` reviewed call |
| Returned usage | `546` input tokens, `55` output tokens, `0` cached or cache-write tokens |
| Provider cache status | `miss` |
| Estimated cost | `USD 0.000876` at the operator-supplied price snapshot |
| Application receipt | `a4baab54-7e64-4f51-999c-65a3315ef0b2`, phase `completed`, replayed `false` |
| Native receipt | `knowgrph-tool-execution-receipt/v1`, status `applied` |
| Persisted result | note revision `1`, text `Reviewed Dev provider proof 20260719-live-01.` |
| Deployment boundary | production deployment `false`; no Prod, Pages, or custom-domain change |

The application and native receipts returned the same idempotency key, `393a640c0ba0ce6192bfa90ad11d25a677373b30609f1f7da0f0cf3ff3f161b2`. Their request digests intentionally differ because each owner hashes its own canonical request boundary. The proof runner then read the target manifest directly from the authenticated Knowgrph Dev endpoint and required revision `1` with the exact note text before reporting success.

## Response Continuation

The provider returned response ids `resp_0414c1a7972634c5006a5c3d09ddec8193a5fea85bbbd27638` and `resp_0414c1a7972634c5006a5c4231d6808193a87f26a8f580dc0a`. The first response contained the forced function request. The second continued that same response chain after the signed review and native result. No resume token, provider reasoning, credential, reviewer token, tool arguments beyond the public proof target, or raw model message is retained here.

## VCC

The accepted proof record had schema `agentic-live-function-run-note-proof/v1`, `ok: true`, `environment: dev`, `logicalProviderRuns: 1`, `providerRequests: 2`, `functionCalls: 1`, `recoveredContinuation: true`, signed approval, a completed application receipt, an applied native receipt, exact persisted revision `1`, and `productionDeploymentPerformed: false`. The repository check passed 311 tests, the web build, the 43-file docs contract, and protected CI/security checks before the exact Dev deployment.

This is evidence for the bounded reviewed function lane only. It does not establish a general cache hit, an unbounded agent loop, multi-region behavior, a default production route, or authorization for another paid run.
