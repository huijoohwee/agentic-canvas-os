import { normalizeJson } from "./json-contract.js";

const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_MAX_STABLE_PREFIX_CHARS = 200_000;
const DEFAULT_MIN_CACHEABLE_TOKENS = 1_024;

function assertNonEmptyText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value;
}

function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
  return value;
}

function canonicalSegments(segments, field) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new TypeError(`${field} must be a non-empty array.`);
  }
  return normalizeJson(segments, field);
}

async function sha256Hex(value) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error("Web Crypto SHA-256 is required for cache-context identity.");
  const bytes = new TextEncoder().encode(value);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function readNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function normalizeCacheUsage({ model = "", usage = {}, estimatedCostUsd = 0 } = {}) {
  const inputDetails = usage.input_tokens_details || usage.prompt_tokens_details || {};
  const promptTokens = readNonNegativeInteger(usage.input_tokens ?? usage.prompt_tokens);
  const completionTokens = readNonNegativeInteger(usage.output_tokens ?? usage.completion_tokens);
  const cachedTokens = readNonNegativeInteger(inputDetails.cached_tokens);
  const cacheWriteTokens = readNonNegativeInteger(inputDetails.cache_write_tokens);
  const providerCacheStatus = cachedTokens > 0
    ? "hit"
    : cacheWriteTokens > 0
      ? "write"
      : promptTokens > 0
        ? "miss"
        : "unreported";

  return Object.freeze({
    model: typeof model === "string" && model.trim() ? model.trim() : "unknown",
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cache_hits: cachedTokens > 0 ? 1 : 0,
    cached_tokens: cachedTokens,
    cache_write_tokens: cacheWriteTokens,
    provider_cache_status: providerCacheStatus,
    estimated_cost_usd: readNonNegativeNumber(estimatedCostUsd),
  });
}

export function createCacheContextRegistry({
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxStablePrefixChars = DEFAULT_MAX_STABLE_PREFIX_CHARS,
  minCacheableTokens = DEFAULT_MIN_CACHEABLE_TOKENS,
} = {}) {
  assertPositiveInteger(maxEntries, "maxEntries");
  assertPositiveInteger(maxStablePrefixChars, "maxStablePrefixChars");
  assertPositiveInteger(minCacheableTokens, "minCacheableTokens");

  const entries = new Map();
  let compileCount = 0;
  let localReuseCount = 0;
  let evictionCount = 0;

  function deleteEntry(handle) {
    if (!entries.delete(handle)) return false;
    evictionCount += 1;
    return true;
  }

  function trimToBound() {
    while (entries.size > maxEntries) deleteEntry(entries.keys().next().value);
  }

  function touch(handle, entry) {
    entries.delete(handle);
    entries.set(handle, entry);
  }

  async function register({ namespace, revision, stablePrefix }) {
    const safeNamespace = assertNonEmptyText(namespace, "namespace");
    const safeRevision = assertNonEmptyText(revision, "revision");
    const canonicalPrefix = canonicalSegments(stablePrefix, "stablePrefix");
    const serializedPrefix = JSON.stringify(canonicalPrefix);
    if (serializedPrefix.length > maxStablePrefixChars) {
      throw new RangeError(`stablePrefix exceeds ${maxStablePrefixChars} characters.`);
    }

    const identity = await sha256Hex(`${safeNamespace}\u0000${safeRevision}\u0000${serializedPrefix}`);
    const handle = `ctx_${identity.slice(0, 40)}`;
    const existing = entries.get(handle);
    if (existing) {
      touch(handle, existing);
      return publicRegistration(existing, "already_registered");
    }

    for (const [candidateHandle, entry] of entries) {
      if (entry.namespace === safeNamespace && entry.revision !== safeRevision) deleteEntry(candidateHandle);
    }

    const routingDigest = await sha256Hex(`routing\u0000${safeRevision}\u0000${serializedPrefix}`);
    const estimatedStablePrefixTokens = Math.ceil(serializedPrefix.length / 4);
    const entry = {
      handle,
      namespace: safeNamespace,
      revision: safeRevision,
      routingKey: `pc_${routingDigest.slice(0, 48)}`,
      stablePrefix: canonicalPrefix,
      stablePrefixDigest: identity,
      estimatedStablePrefixTokens,
      providerEligible: estimatedStablePrefixTokens >= minCacheableTokens,
    };
    compileCount += 1;
    entries.set(handle, entry);
    trimToBound();
    return publicRegistration(entry, "registered");
  }

  function assemble({ handle, dynamicTail }) {
    assertNonEmptyText(handle, "handle");
    const entry = entries.get(handle);
    if (!entry) throw new Error("Cache context is missing, stale, or evicted; register the stable prefix again.");
    const tail = canonicalSegments(dynamicTail, "dynamicTail");
    localReuseCount += 1;
    touch(handle, entry);
    return Object.freeze({
      prompt: Object.freeze([...entry.stablePrefix, ...tail]),
      cache: Object.freeze({
        handle: entry.handle,
        revision: entry.revision,
        routingKey: entry.routingKey,
        stablePrefixDigest: entry.stablePrefixDigest,
        estimatedStablePrefixTokens: entry.estimatedStablePrefixTokens,
        providerEligible: entry.providerEligible,
        localPrefixStatus: "reused",
        providerCacheStatus: "unverified",
      }),
    });
  }

  function invalidate({ handle } = {}) {
    assertNonEmptyText(handle, "handle");
    return deleteEntry(handle);
  }

  function stats() {
    return Object.freeze({
      entries: entries.size,
      maxEntries,
      maxStablePrefixChars,
      minCacheableTokens,
      compileCount,
      localReuseCount,
      evictionCount,
    });
  }

  return Object.freeze({ register, assemble, invalidate, stats });
}

function publicRegistration(entry, status) {
  return Object.freeze({
    handle: entry.handle,
    revision: entry.revision,
    routingKey: entry.routingKey,
    stablePrefixDigest: entry.stablePrefixDigest,
    estimatedStablePrefixTokens: entry.estimatedStablePrefixTokens,
    providerEligible: entry.providerEligible,
    status,
  });
}

export const CACHE_CONTEXT_DEFAULTS = Object.freeze({
  maxEntries: DEFAULT_MAX_ENTRIES,
  maxStablePrefixChars: DEFAULT_MAX_STABLE_PREFIX_CHARS,
  minCacheableTokens: DEFAULT_MIN_CACHEABLE_TOKENS,
});
