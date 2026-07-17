import test from "node:test";
import assert from "node:assert/strict";

import { createCacheContextRegistry, normalizeCacheUsage } from "../agent-api/src/cache-context.js";

const STABLE_PREFIX = [
  { role: "system", content: "Stable identity and operating rules." },
  { role: "developer", content: { tools: ["search", "read"], policy: "read-only" } },
];

test("registers a stable prefix once and reuses it before changing request tails", async () => {
  const registry = createCacheContextRegistry({ minCacheableTokens: 1 });
  const registration = await registry.register({
    namespace: "agent-session",
    revision: "docs-sha-1",
    stablePrefix: STABLE_PREFIX,
  });

  const first = registry.assemble({
    handle: registration.handle,
    dynamicTail: [{ role: "user", content: "First request" }],
  });
  const second = registry.assemble({
    handle: registration.handle,
    dynamicTail: [{ role: "user", content: "Second request" }],
  });

  assert.deepEqual(first.prompt.slice(0, 2), second.prompt.slice(0, 2));
  assert.equal(first.prompt[2].content, "First request");
  assert.equal(second.prompt[2].content, "Second request");
  assert.equal(first.cache.localPrefixStatus, "reused");
  assert.equal(first.cache.providerCacheStatus, "unverified");
  assert.deepEqual(registry.stats(), {
    entries: 1,
    maxEntries: 32,
    maxStablePrefixChars: 200000,
    minCacheableTokens: 1,
    compileCount: 1,
    localReuseCount: 2,
    evictionCount: 0,
  });
});

test("registration is idempotent for an exact prefix", async () => {
  const registry = createCacheContextRegistry();
  const input = { namespace: "shared", revision: "r1", stablePrefix: STABLE_PREFIX };
  const first = await registry.register(input);
  const second = await registry.register(input);

  assert.equal(first.handle, second.handle);
  assert.equal(second.status, "already_registered");
  assert.equal(registry.stats().compileCount, 1);
});

test("a revision change invalidates the prior namespace entry", async () => {
  const registry = createCacheContextRegistry();
  const first = await registry.register({ namespace: "shared", revision: "r1", stablePrefix: STABLE_PREFIX });
  const second = await registry.register({ namespace: "shared", revision: "r2", stablePrefix: STABLE_PREFIX });

  assert.notEqual(first.handle, second.handle);
  assert.throws(
    () => registry.assemble({ handle: first.handle, dynamicTail: [{ role: "user", content: "stale" }] }),
    /missing, stale, or evicted/,
  );
  assert.equal(registry.stats().entries, 1);
  assert.equal(registry.stats().evictionCount, 1);
});

test("bounded registry evicts the least-recent entry", async () => {
  const registry = createCacheContextRegistry({ maxEntries: 2 });
  const first = await registry.register({ namespace: "one", revision: "r1", stablePrefix: STABLE_PREFIX });
  const second = await registry.register({ namespace: "two", revision: "r1", stablePrefix: STABLE_PREFIX });
  registry.assemble({ handle: first.handle, dynamicTail: [{ role: "user", content: "touch" }] });
  await registry.register({ namespace: "three", revision: "r1", stablePrefix: STABLE_PREFIX });

  assert.throws(
    () => registry.assemble({ handle: second.handle, dynamicTail: [{ role: "user", content: "evicted" }] }),
    /missing, stale, or evicted/,
  );
  assert.equal(registry.stats().entries, 2);
});

test("provider eligibility is an estimate and never a hit claim", async () => {
  const registry = createCacheContextRegistry({ minCacheableTokens: 10000 });
  const registration = await registry.register({ namespace: "short", revision: "r1", stablePrefix: STABLE_PREFIX });
  const packet = registry.assemble({
    handle: registration.handle,
    dynamicTail: [{ role: "user", content: "request" }],
  });

  assert.equal(registration.providerEligible, false);
  assert.equal(packet.cache.providerCacheStatus, "unverified");
});

test("normalizes Responses and Chat Completions cache telemetry without conflating local reuse", () => {
  assert.deepEqual(normalizeCacheUsage({
    model: "model-a",
    usage: {
      input_tokens: 2200,
      output_tokens: 120,
      input_tokens_details: { cached_tokens: 1920, cache_write_tokens: 0 },
    },
    estimatedCostUsd: 0.02,
  }), {
    model: "model-a",
    prompt_tokens: 2200,
    completion_tokens: 120,
    cache_hits: 1,
    cached_tokens: 1920,
    cache_write_tokens: 0,
    provider_cache_status: "hit",
    estimated_cost_usd: 0.02,
  });

  const write = normalizeCacheUsage({
    usage: {
      prompt_tokens: 1500,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 1024 },
    },
  });
  assert.equal(write.provider_cache_status, "write");
  assert.equal(write.cache_hits, 0);
});
