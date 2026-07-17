---
title: "Agentic Canvas OS Cache Context Contract"
graphId: "md:agentic-canvas-os-cache-context"
doc_type: "Runtime Cache Context Contract"
date: "2026-07-17"
lang: "en-US"
schema: "agentic-cache-context/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "stable prompt-prefix compilation, reuse, invalidation, and cache telemetry"
runtime_scope: "Agent-API volatile cache-context registry"
runtime_claim: "deterministic local stable-prefix reuse with provider cache status kept unverified until returned usage proves a read or write"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
runtime_proof: "RUNTIME-PROOF.md"
external_pattern_sources:
  - "https://developers.openai.com/api/docs/guides/prompt-caching"
---

# Cache Context

Cache context compiles repeated prompt content once, returns an opaque revision-bound handle, and appends changing request content after the stable prefix. The implementation is local and provider-neutral. The external prompt-caching guide informs ordering, identity, eligibility, and telemetry semantics only; no external implementation, prompt, example, fixture, or prose is copied.

## Runtime Ownership

| Owner | Responsibility | Boundary |
|---|---|---|
| `agent-api/src/cache-context.js` | Canonicalize, hash, bound, retain, reuse, invalidate, and measure stable context. | No network, provider call, secret persistence, source mutation, or deploy. |
| `agent-api/src/app.js` | Expose one injected registry and sanitized readiness state. | Does not claim a provider hit. |
| `worker/index.js` | Reuse only the bounded registry inside one environment isolate. | Auth handlers and MCP clients remain request-scoped; no cross-caller MCP session reuse. |
| Downstream model owner | Map the opaque routing key into a supported provider request and return actual usage. | Live provider readiness stays gated until focused downstream proof exists. |

## Typed Contract

Register input:

```yaml
namespace: string
revision: string
stablePrefix: non-empty JSON-compatible array
```

Register output:

```yaml
handle: opaque revision-and-content-bound string
routingKey: opaque stable routing string
stablePrefixDigest: sha256 hex
estimatedStablePrefixTokens: non-negative integer estimate
providerEligible: boolean estimate
status: registered | already_registered
```

Assemble input:

```yaml
handle: opaque registered handle
dynamicTail: non-empty JSON-compatible array
```

Assemble output:

```yaml
prompt: stable prefix followed by dynamic tail
cache:
  localPrefixStatus: reused
  providerCacheStatus: unverified
  revision: string
  routingKey: string
```

## Stable-Prefix Rules

1. Register identity, operating rules, schemas, tools, examples, or other stable segments before request-specific data.
2. Preserve array order and canonicalize object keys so the same logical prefix produces the same digest.
3. Reuse the returned handle for later dynamic tails instead of resupplying and recompiling the stable prefix.
4. Invalidate older entries automatically when the same namespace registers a new revision.
5. Evict least-recent entries when the bounded registry reaches capacity.
6. Treat token eligibility as an estimate only. The default threshold is 1,024 estimated tokens and can be overridden by the owning runtime.

## Cache Truth And Cost Log

Local reuse and provider caching are different facts. A successful local assembly reports `localPrefixStatus: reused` and keeps `providerCacheStatus: unverified`. Only returned provider usage can promote that field to `hit`, `write`, or `miss`.

Every model-bearing consumer records:

| Field | Rule |
|---|---|
| `model` | Actual model id, or `unknown` when usage omits it. |
| `prompt_tokens` | Provider input or prompt token count. |
| `completion_tokens` | Provider output or completion token count. |
| `cache_hits` | `1` only when returned cached tokens are greater than zero; otherwise `0`. |
| `cached_tokens` | Exact returned provider cache-read tokens. |
| `cache_write_tokens` | Exact returned provider cache-write tokens. |
| `provider_cache_status` | `hit`, `write`, `miss`, or `unreported`. |
| `estimated_cost_usd` | Non-negative observed estimate; never silently clamped from a non-zero value. |

## Failure And Invalidation

| Failure | Result |
|---|---|
| Missing, empty, cyclic, undefined, non-finite, or oversized stable input | Reject before registration or provider spend. |
| Missing or evicted handle | Return a typed stale-context error and require registration again. |
| Revision change | Remove prior entries for that namespace before reuse. |
| Registry capacity reached | Evict the least-recent entry; never grow without a bound. |
| Provider usage missing | Keep provider cache status `unreported` or `unverified`; do not infer a hit from latency. |
| Provider adapter absent | Keep live provider readiness gated; local deterministic proof remains valid. |

## Runtime-Ready VCCs

Given one namespace, revision, and stable prefix, when two requests assemble different dynamic tails through the same handle, then the prefix is compiled once, appears first and unchanged in both prompts, and local reuse increments twice.

VCC: run `npm run cache-context:check`; require six passing tests covering exact reuse, idempotent registration, revision invalidation, bounded eviction, eligibility honesty, and cache read/write telemetry; stop on the first failure with zero provider calls.

Given returned provider usage, when telemetry normalization runs, then cache reads and writes remain distinct from local prefix reuse.

VCC: verify positive `cached_tokens` produces one cache hit, positive `cache_write_tokens` produces a write with zero hits, and missing usage never produces a hit claim.

## Promotion Boundary

The stable-prefix registry and offline tests are runtime-ready in Dev. A live provider cache-hit claim remains gated because this Worker forwards to the `knowgrph` MCP control plane and does not own the model request. Promotion requires the downstream model owner to map the routing key through a supported adapter, send an eligible exact prefix, return cache read/write usage, and pass a bounded live test with approved spend.
