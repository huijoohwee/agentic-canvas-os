---
title: "Opt-In Autonomous Runtime Contract"
graphId: "md:autonomous-runtime-contract"
doc_type: "Runtime Contract"
date: "2026-07-23"
lang: "en-US"
schema: "autonomous-runtime-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "operator-gated source-verified composed agent execution"
runtime_scope: "authenticated single-agent Worker route backed by OpenAI Responses"
runtime_claim: "the Worker can be explicitly configured for bounded composed agent execution while its shipped default remains fail-closed"
runtime_owner: "../agent-api/src/autonomous-runtime-config.js; ../agent-api/src/agent-runtime-handler.js; ../agent-api/src/app.js; ../worker/index.js"
runtime_proof: "../__tests__/autonomous-runtime.test.mjs"
publish_policy: "Dev-only until explicit operator approval and separate bounded live proof"
---

# Opt-In Autonomous Runtime

The Worker exposes one authenticated composed-agent path at `POST /api/agent/run`. The path is absent in effect until an operator explicitly enables it, acknowledges provider spend, supplies one source-bound definition, and aligns the generic model registry with the OpenAI Responses agent adapter. Missing or conflicting configuration returns `runtime_unconfigured` without a provider request.

This route closes the default composition wiring gap. It does not enable Agent Swarm, register a multi-agent workflow, grant MCP tools, approve mutations, deploy a Worker, or turn a session token into spend or mutation authorization.

## Ownership

| Owner | Responsibility |
|---|---|
| Autonomous runtime configuration | Parse explicit enablement, spend, source, model-alignment, and provider-call bounds; expose sanitized issues only. |
| Agent Definition Registry | Register one exact operator definition and re-hash its server-side source before every preparation. |
| Models and Providers | Resolve the exact OpenAI model and complete per-run transport selected by the definition. |
| OpenAI Responses agent adapter | Translate stable instructions plus dynamic input, confirm reasoning context, return usage-derived cost, and enforce the isolate provider-call ceiling. |
| Agent Runtime Composition and Running Agents | Prepare, resolve, execute, continue, bound, and validate the final text result. |
| HTTP handler | Require the existing session token, reject caller-owned agent controls, scope run and conversation identities to the authenticated principal, and return bounded output. |
| Existing Function Calling and Knowgrph gateway | Retain all tool schemas, MCP routing, signed review, idempotency, native receipts, and mutation policy. The autonomous route does not bypass or duplicate them. |

## Required Configuration

Enablement requires all of the following server-side values:

| Group | Required values |
|---|---|
| Operator gate | `AGENT_RUNTIME_ENABLED=true`, `AGENT_RUNTIME_SPEND_APPROVED=true`, and `AGENT_RUNTIME_MAX_PROVIDER_CALLS` from 1 through 64. |
| Agent identity | `AGENT_RUNTIME_AGENT_ID` and `AGENT_RUNTIME_AGENT_REVISION`. |
| Source evidence | `AGENT_RUNTIME_AGENT_SOURCE_URI`, lowercase SHA-256 in `AGENT_RUNTIME_AGENT_SOURCE_SHA256`, and exact JSON source text in `AGENT_RUNTIME_AGENT_SOURCE`. |
| Provider registry | Complete `AGENT_MODEL_*` configuration with provider `openai`, adapter `openai-responses-agent`, delivery `complete`, connection `per-run`, and a present server key binding. |
| Responses adapter | Model, endpoint, key binding, and pricing through `OPENAI_AGENT_*`; model, endpoint, and key-binding name must match `AGENT_MODEL_*`, while reasoning effort and output tokens retain bounded defaults when omitted. |
| Control plane | `KNOWGRPH_MCP_ENDPOINT` names the server-side MCP target; tool execution still remains on the separate reviewed Function Calling path. |
| Authentication | `AGENT_API_JWT_SECRET` for the existing session-token boundary. |

The source text is strict JSON with only `name` and `instructions`:

```json
{
  "name": "Operator Runtime Agent",
  "instructions": [
    { "name": "purpose", "content": "Return one bounded answer." }
  ]
}
```

The application hashes the exact source bytes, compares the configured digest, registers the derived definition, then hashes the bytes again through the definition source verifier on preparation. Source text, instructions, API keys, raw provider response ids, and private reasoning never enter readiness output.

## HTTP Contract

`POST /api/agent/run` accepts exactly:

```json
{
  "runId": "caller-run-id",
  "conversationId": "caller-conversation-id",
  "input": { "task": "Bounded task input" }
}
```

The agent identity, revision, model, source, role, adapter, signal, and policy are server-owned. Unknown fields fail with `400`. A missing or invalid session token fails with `401`. An unconfigured runtime fails with `501` before provider execution. A completed run returns `200` with validated output and reported cost. A bounded execution block returns `409` without exposing internal provider state.

Run and conversation identities are hashed with the authenticated principal before composition. Two principals may use the same public conversation id without sharing previous-response continuation.

## Bounds And Safety

- Provider calls stop at the explicit isolate ceiling; the adapter also enforces configured output tokens.
- Running Agents retains its step, input, state, output, event, conversation, and timeout bounds.
- The route registers a text-only definition. It accepts no caller tool definitions, MCP routes, workflow topology, or review evidence.
- Session authentication grants route access only. It does not authorize a Function Calling review or a Knowgrph mutation.
- Tool use stays on the existing Function Calling route, explicit allowlist, signed human review, durable receipt, and native MCP policy path.
- General provider behavior remains `unverified` until a separately approved bounded live proof records actual usage and continuation evidence.
- No configuration, test, or route in this contract authorizes Prod, Cloudflare deployment, or repeated paid proof calls.

## Readiness And Proof

`GET /api/ready` exposes `autonomousRuntime` with enablement, source-digest match, adapter identity, route, auth mode, provider-call and output-token bounds, sanitized issue codes, and `providerExecutionStatus: "unverified"`. It contains no source content or credential value.

Run the network-free proof:

```bash
npm run autonomous-runtime:check
```

The focused suite proves all-gate admission, source digest mismatch, spend refusal, model mismatch, provider-call bounds, secret redaction, authenticated Worker routing, caller-control rejection, per-principal continuation isolation, exact previous-response continuation, returned usage cost, and zero provider requests while unconfigured.
