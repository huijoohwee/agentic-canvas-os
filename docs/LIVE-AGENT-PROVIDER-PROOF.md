---
title: "Bounded Live Agent Provider Proof"
graphId: "md:live-agent-provider-proof"
doc_type: "Runtime Proof Contract"
date: "2026-07-18"
lang: "en-US"
schema: "agent-live-provider-proof-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "explicitly approved OpenAI Responses proof for composed agent delegation, handoff, continuation, usage, and cost"
runtime_scope: "Node-only proof adapter and harness; default Worker wiring is unchanged"
runtime_claim: "one approved command can issue at most three provider requests and records only redacted returned evidence"
runtime_owner: "../agent-api/src/openai-responses-agent-adapter.js; ../agent-api/src/live-agent-provider-proof.js"
runtime_proof: "../__tests__/openai-agent-live-proof.test.mjs; RUNTIME-PROOF.md"
external_pattern_source: "https://developers.openai.com/api/reference/resources/responses/methods/create; https://developers.openai.com/api/docs/guides/conversation-state; https://openai.github.io/openai-agents-js/guides/multi-agent/"
external_source_policy: "concept reference only; forbid copied code, APIs, examples, prompts, schemas, tests, fixtures, or prose"
publish_policy: "Dev-only; no Prod mirror or Cloudflare action"
---

# Bounded Live Agent Provider Proof

This proof connects the repository's source-backed Agent Definitions, Models and Providers, Running Agents, Agent Runtime Composition, and Agent Orchestration owners to one concrete server-side OpenAI Responses adapter. It does not make that provider the default Worker route and does not grant deployment authority.

The external guides inform only the provider capability class: manager-owned delegation, specialist-owned handoff, stored previous-response continuation, and returned usage. Request construction, source fixtures, bounds, evidence, tests, and prose are independently authored here.

## Exact Bound

One invocation runs exactly this sequence:

1. The specialist produces a private delegation result.
2. The manager synthesizes the only public delegation answer.
3. The same specialist takes public ownership through handoff and continues from its first stored response.

The adapter rejects a fourth attempt. Each call has an explicit output-token ceiling, low reasoning effort by default, a 120-second application stage timeout, and stored previous-response continuation. The first turn requests `current_turn`; only the continued specialist turn requests and must receive effective `all_turns` confirmation.

## Configuration And Secret Boundary

The proof fails closed unless the server environment provides an explicit key, model, current per-million-token prices, safe HTTPS or local endpoint, and approval id:

```bash
OPENAI_AGENT_MODEL=<approved-model>
OPENAI_AGENT_REASONING_EFFORT=low
OPENAI_AGENT_INPUT_USD_PER_MILLION=<current-input-price>
OPENAI_AGENT_CACHED_INPUT_USD_PER_MILLION=<current-cached-input-price>
OPENAI_AGENT_OUTPUT_USD_PER_MILLION=<current-output-price>
OPENAI_AGENT_MAX_OUTPUT_TOKENS=512
OPENAI_AGENT_LIVE_PROOF_APPROVAL=<approval-id>
npm run agent-live-provider:proof
```

`OPENAI_AGENT_API_KEY_ENV` may name a different server-side key variable, and `OPENAI_AGENT_ENDPOINT` may select a safe endpoint. The command never prints the key, raw response ids, provider output, reasoning content, or source content. Partial failures expose only attempted and completed call counts plus hashed response/output evidence.

## Proof Result

Success emits one `agent-live-provider-proof/v1` JSON record containing source digests, model and reasoning configuration, exact call and token bounds, ownership transitions, hashed response linkage, returned token usage, provider-reported cache-hit count, and price-derived estimated cost. `RUNTIME-PROOF.md` records the accepted run.

The approved 2026-07-18 run used `gpt-5.6-sol` with low reasoning and completed its three-call ceiling on the first invocation. It returned 576 input tokens, 53 output tokens, zero cached-input hits, and an estimated cost of USD 0.00447 at the explicitly supplied price snapshot. Delegation finished with the manager as final-answer owner; handoff finished with the specialist as owner; the returning specialist confirmed effective `all_turns` and a hash-linked prior response.

Provider-returned usage is evidence for this bounded run only. It does not establish general model quality, durable cross-isolate state, default Worker configuration, or future pricing. Local stable-prefix reuse and provider cached tokens remain different facts.

## VCC

Run `npm run agent-live-provider:check` before the paid command. Require five offline tests to pass, exactly three attempted and completed live calls, specialist-manager-specialist execution order, manager ownership after delegation, specialist ownership after handoff, hashed previous-response linkage, effective `all_turns` on the continued specialist turn, complete returned usage, no secret or raw response id in output, and no Prod mirror or Cloudflare action.
