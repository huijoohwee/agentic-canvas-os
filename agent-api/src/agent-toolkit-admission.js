import { createHash } from "node:crypto";

import { assertIdentifier } from "./agent-toolkit-contract.js";
import { digestToolkitEvidence } from "./agent-toolkit-ledger.js";

const SCHEMA = "agent-toolkit-admission/v1";

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function principalDigest(principalId) {
  return createHash("sha256").update(principalId).digest("hex");
}

function recordId(principalId) {
  return `admission:${principalDigest(principalId)}`;
}

function shardRecordId(principalId, limits) {
  const shard = Number.parseInt(principalDigest(principalId).slice(0, 8), 16) % limits.principalShardCount;
  return `admission-shard:${shard}`;
}

function identityDigest(kind, value) {
  return digestToolkitEvidence([kind, assertIdentifier(value, kind)]);
}

function live(entries, at) {
  return entries.filter((entry) => entry.expiresAt > at);
}

function createRecord(principalId, at, limits) {
  return {
    schema: SCHEMA,
    recordId: recordId(principalId),
    principalDigest: principalDigest(principalId),
    requests: [],
    runs: [],
    cohorts: [],
    updatedAt: new Date(at).toISOString(),
    expiresAt: at + limits.requestWindowMs,
  };
}

function createShardRecord(id, at, limits) {
  return {
    schema: "agent-toolkit-admission-shard/v1",
    recordId: id,
    principals: [],
    updatedAt: new Date(at).toISOString(),
    expiresAt: at + limits.cohortTtlMs,
  };
}

function refresh(record, at, limits) {
  const threshold = at - limits.requestWindowMs;
  record.requests = record.requests.filter((timestamp) => timestamp > threshold);
  record.runs = live(record.runs, at);
  record.cohorts = live(record.cohorts, at);
  return record;
}

function verdict(record, request, at, limits) {
  if (record.requests.length >= limits.maxRequestsPerWindow) {
    const retryAfterMs = Math.max(1, record.requests[0] + limits.requestWindowMs - at);
    return { allowed: false, reasonCode: "rate_limited", retryAfterMs };
  }
  if (request.action === "start" || request.action === "instrument") {
    const runDigest = identityDigest("runId", request.runId);
    const cohortDigest = identityDigest("cohortId", request.cohortId);
    const runKnown = record.runs.some((entry) => entry.digest === runDigest);
    const cohortKnown = record.cohorts.some((entry) => entry.digest === cohortDigest);
    if (!runKnown && record.runs.length >= limits.maxPrincipalRuns) {
      return { allowed: false, reasonCode: "run_quota_exceeded" };
    }
    if (!cohortKnown && record.cohorts.length >= limits.maxPrincipalCohorts) {
      return { allowed: false, reasonCode: "cohort_quota_exceeded" };
    }
    if (!runKnown) record.runs.push({ digest: runDigest, expiresAt: at + limits.runTtlMs });
    if (!cohortKnown) record.cohorts.push({ digest: cohortDigest, expiresAt: at + limits.cohortTtlMs });
  }
  record.requests.push(at);
  return { allowed: true };
}

function finalize(record, at, limits) {
  record.updatedAt = new Date(at).toISOString();
  record.expiresAt = Math.max(
    at + limits.requestWindowMs,
    ...record.runs.map((entry) => entry.expiresAt),
    ...record.cohorts.map((entry) => entry.expiresAt),
  );
  return record;
}

export function createAgentToolkitAdmissionController({ stateStore, now, limits } = {}) {
  if (!stateStore) throw new TypeError("Agent Toolkit admission requires an atomic state store.");
  if (typeof now !== "function") throw new TypeError("Agent Toolkit admission requires a clock.");

  async function mutateRecord(id, at, create, transform) {
    if (!(await stateStore.get(id))) await stateStore.put(create());
    for (let attempt = 1; attempt <= limits.storeClaimAttempts; attempt += 1) {
      const claimId = `admission-claim-${digestToolkitEvidence([id, at, attempt]).slice(0, 48)}`;
      const record = await stateStore.claim(id, claimId, at + limits.storeClaimTtlMs);
      if (!record) {
        if (attempt < limits.storeClaimAttempts) await pause(limits.storeClaimRetryMs);
        continue;
      }
      try {
        const { replacement, result } = transform(record);
        if (!(await stateStore.replace(id, claimId, replacement))) {
          return Object.freeze({ allowed: false, reasonCode: "admission_busy" });
        }
        return Object.freeze(result);
      } catch (error) {
        await stateStore.release(id, claimId);
        throw error;
      }
    }
    return Object.freeze({ allowed: false, reasonCode: "admission_busy" });
  }

  async function reservePrincipal(principalId, at) {
    const id = shardRecordId(principalId, limits);
    const digest = principalDigest(principalId);
    return mutateRecord(id, at, () => createShardRecord(id, at, limits), (record) => {
      record.principals = live(record.principals, at);
      const existing = record.principals.find((entry) => entry.digest === digest);
      if (!existing && record.principals.length >= limits.maxPrincipalsPerShard) {
        record.updatedAt = new Date(at).toISOString();
        record.expiresAt = Math.max(at + limits.requestWindowMs, ...record.principals.map((entry) => entry.expiresAt));
        return {
          replacement: record,
          result: { allowed: false, reasonCode: "principal_quota_exceeded" },
        };
      }
      if (existing) existing.expiresAt = at + limits.cohortTtlMs;
      else record.principals.push({ digest, expiresAt: at + limits.cohortTtlMs });
      record.updatedAt = new Date(at).toISOString();
      record.expiresAt = Math.max(...record.principals.map((entry) => entry.expiresAt));
      return { replacement: record, result: { allowed: true } };
    });
  }

  async function admit(request) {
    const principalId = assertIdentifier(request?.principalId, "principalId");
    const id = recordId(principalId);
    const at = Number(now());
    if (!Number.isFinite(at)) throw new TypeError("now must return a finite timestamp.");
    const existing = await stateStore.get(id);
    if (!existing && request.action !== "start" && request.action !== "instrument") {
      return Object.freeze({ allowed: false, reasonCode: "admission_required" });
    }
    if (!existing) {
      const principal = await reservePrincipal(principalId, at);
      if (!principal.allowed) return principal;
    }
    return mutateRecord(id, at, () => createRecord(principalId, at, limits), (record) => {
      refresh(record, at, limits);
      const result = verdict(record, request, at, limits);
      return { replacement: finalize(record, at, limits), result };
    });
  }

  return Object.freeze({
    admit,
    stats: () => Object.freeze({
      configured: true,
      persistence: stateStore.stats().persistence,
      requestWindowMs: limits.requestWindowMs,
      maxRequestsPerWindow: limits.maxRequestsPerWindow,
      maxPrincipalRuns: limits.maxPrincipalRuns,
      maxPrincipalCohorts: limits.maxPrincipalCohorts,
      principalShardCount: limits.principalShardCount,
      maxPrincipalsPerShard: limits.maxPrincipalsPerShard,
    }),
  });
}
