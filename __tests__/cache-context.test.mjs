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

test("registration is idempotent and skips routing hashing for an exact prefix hit", async (t) => {
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  const hashing = t.mock.method(globalThis.crypto.subtle, "digest", digest);
  const registry = createCacheContextRegistry();
  const input = { namespace: "shared", revision: "r1", stablePrefix: STABLE_PREFIX };
  const first = await registry.register(input);
  const second = await registry.register(input);

  assert.equal(first.handle, second.handle);
  assert.equal(second.status, "already_registered");
  assert.equal(registry.stats().compileCount, 1);
  assert.equal(hashing.mock.callCount(), 3);
});

test("concurrent exact registrations share hashing and compile once", async (t) => {
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  const hashing = t.mock.method(globalThis.crypto.subtle, "digest", digest);
  const registry = createCacheContextRegistry();
  const input = { namespace: "shared", revision: "r1", stablePrefix: STABLE_PREFIX };
  const registrations = await Promise.all(Array.from({ length: 20 }, () => registry.register(input)));

  assert.equal(new Set(registrations.map(({ handle }) => handle)).size, 1);
  assert.equal(registrations.filter(({ status }) => status === "registered").length, 1);
  assert.equal(hashing.mock.callCount(), 2);
  assert.equal(registry.stats().compileCount, 1);
});

test("a slow older revision cannot overwrite a completed newer registration", async (t) => {
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  const deferred = Promise.withResolvers();
  const entered = Promise.withResolvers();
  t.mock.method(globalThis.crypto.subtle, "digest", async (algorithm, bytes) => {
    if (new TextDecoder().decode(bytes).startsWith("routing\u0000r1\u0000")) {
      entered.resolve();
      await deferred.promise;
    }
    return digest(algorithm, bytes);
  });
  const registry = createCacheContextRegistry();
  const input = { namespace: "shared", revision: "r1", stablePrefix: STABLE_PREFIX };
  const stale = assert.rejects(registry.register(input), /superseded/);
  await entered.promise;
  const current = await registry.register({ ...input, revision: "r2" });
  deferred.resolve();
  await stale;

  assert.equal(registry.assemble({ handle: current.handle, dynamicTail: ["request"] }).cache.revision, "r2");
  assert.equal(registry.stats().entries, 1);
  assert.equal(registry.stats().compileCount, 1);
  const later = await registry.register(input);
  assert.equal(later.revision, "r1");
  assert.throws(() => registry.assemble({ handle: current.handle, dynamicTail: ["stale"] }), /stale/);
});

test("pending registration memory is bounded and released after hashing fails", async (t) => {
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  const deferred = Promise.withResolvers();
  const hashing = t.mock.method(globalThis.crypto.subtle, "digest", async (algorithm, bytes) => {
    await deferred.promise;
    return digest(algorithm, bytes);
  });
  const registry = createCacheContextRegistry({ maxEntries: 1 });
  const input = { namespace: "shared", revision: "r1", stablePrefix: STABLE_PREFIX };
  const first = assert.rejects(registry.register(input), /hash failed/);
  const duplicate = assert.rejects(registry.register(input), /hash failed/);
  await assert.rejects(registry.register({ ...input, namespace: "other" }), /capacity/);
  deferred.reject(new Error("hash failed"));
  await Promise.all([first, duplicate]);
  assert.equal(hashing.mock.callCount(), 1, "a failed identity hash must not leave routing work in flight");
  t.mock.restoreAll();

  const registration = await registry.register(input);
  assert.equal(registration.status, "registered");
  assert.equal(registry.stats().entries, 1);
});

test("routing hashing retains its registration slot until failure settles", async (t) => {
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  const entered = Promise.withResolvers();
  const routing = Promise.withResolvers();
  t.mock.method(globalThis.crypto.subtle, "digest", async (algorithm, bytes) => {
    if (new TextDecoder().decode(bytes).startsWith("routing\u0000")) {
      entered.resolve();
      await routing.promise;
    }
    return digest(algorithm, bytes);
  });
  const registry = createCacheContextRegistry({ maxEntries: 1 });
  const input = { namespace: "shared", revision: "r1", stablePrefix: STABLE_PREFIX };
  const failure = assert.rejects(registry.register(input), /routing failed/);
  await entered.promise;
  await assert.rejects(registry.register({ ...input, namespace: "other" }), /capacity/);
  routing.reject(new Error("routing failed"));
  await failure;
  t.mock.restoreAll();

  assert.equal((await registry.register(input)).status, "registered");
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
