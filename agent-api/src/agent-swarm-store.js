import { assertIdentifier } from "./agent-swarm-contract.js";

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function requireRecord(value, now) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("record must be an object.");
  if (!Number.isFinite(value.expiresAt) || value.expiresAt <= now) {
    throw new TypeError("record.expiresAt must be a future timestamp.");
  }
  return clone(value);
}

export function createAgentSwarmMemoryStore({ now = () => Date.now() } = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function.");
  const records = new Map();
  const claims = new Map();

  function instant() {
    const value = Number(now());
    if (!Number.isFinite(value)) throw new TypeError("now must return a finite timestamp.");
    return value;
  }

  function liveRecord(runId, at) {
    const record = records.get(runId);
    if (!record || record.expiresAt <= at) {
      records.delete(runId);
      return null;
    }
    return record;
  }

  function liveClaim(runId, at) {
    const claim = claims.get(runId);
    if (!claim) return null;
    if (claim.claimExpiresAt <= at || claim.record.expiresAt <= at) {
      claims.delete(runId);
      if (claim.record.expiresAt > at) records.set(runId, claim.record);
      else records.delete(runId);
      return null;
    }
    return claim;
  }

  return Object.freeze({
    async put(value) {
      const at = instant();
      const record = requireRecord(value, at);
      const runId = assertIdentifier(record.runId, "record.runId");
      if (liveClaim(runId, at) || liveRecord(runId, at)) return false;
      records.set(runId, record);
      return true;
    },
    async get(value) {
      const runId = assertIdentifier(value, "runId");
      const at = instant();
      const claim = liveClaim(runId, at);
      return clone(claim?.record || liveRecord(runId, at));
    },
    async claim(value, claimIdValue, claimExpiresAt) {
      const runId = assertIdentifier(value, "runId");
      const claimId = assertIdentifier(claimIdValue, "claimId", 512);
      const at = instant();
      if (!Number.isFinite(claimExpiresAt) || claimExpiresAt <= at) {
        throw new TypeError("claimExpiresAt must be a future timestamp.");
      }
      if (liveClaim(runId, at)) return null;
      const record = liveRecord(runId, at);
      if (!record) return null;
      records.delete(runId);
      claims.set(runId, { claimId, claimExpiresAt, record });
      return clone(record);
    },
    async replace(value, claimIdValue, replacement) {
      const runId = assertIdentifier(value, "runId");
      const claimId = assertIdentifier(claimIdValue, "claimId", 512);
      const at = instant();
      const claim = liveClaim(runId, at);
      if (!claim || claim.claimId !== claimId) return false;
      const record = requireRecord(replacement, at);
      if (record.runId !== runId) throw new TypeError("Replacement run identity changed.");
      claims.delete(runId);
      records.set(runId, record);
      return true;
    },
    async release(value, claimIdValue) {
      const runId = assertIdentifier(value, "runId");
      const claimId = assertIdentifier(claimIdValue, "claimId", 512);
      const at = instant();
      const claim = liveClaim(runId, at);
      if (!claim || claim.claimId !== claimId) return false;
      claims.delete(runId);
      records.set(runId, claim.record);
      return true;
    },
    async commit(value, claimIdValue) {
      const runId = assertIdentifier(value, "runId");
      const claimId = assertIdentifier(claimIdValue, "claimId", 512);
      const at = instant();
      const claim = liveClaim(runId, at);
      if (!claim || claim.claimId !== claimId) return false;
      claims.delete(runId);
      return true;
    },
    async delete(value) {
      const runId = assertIdentifier(value, "runId");
      records.delete(runId);
      claims.delete(runId);
      return true;
    },
    stats: () => Object.freeze({
      persistence: "isolate-memory",
      atomicClaims: true,
      horizontalRecovery: false,
      activeRuns: records.size + claims.size,
    }),
  });
}
