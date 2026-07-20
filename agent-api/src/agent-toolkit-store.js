import { assertIdentifier } from "./agent-toolkit-contract.js";

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

export function createAgentToolkitMemoryStore({ now = () => Date.now() } = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function.");
  const records = new Map();
  const claims = new Map();

  function instant() {
    const value = Number(now());
    if (!Number.isFinite(value)) throw new TypeError("now must return a finite timestamp.");
    return value;
  }

  function liveRecord(recordId, at) {
    const record = records.get(recordId);
    if (!record || record.expiresAt <= at) {
      records.delete(recordId);
      return null;
    }
    return record;
  }

  function liveClaim(recordId, at) {
    const claim = claims.get(recordId);
    if (!claim) return null;
    if (claim.claimExpiresAt <= at || claim.record.expiresAt <= at) {
      claims.delete(recordId);
      if (claim.record.expiresAt > at) records.set(recordId, claim.record);
      else records.delete(recordId);
      return null;
    }
    return claim;
  }

  return Object.freeze({
    async put(value) {
      const at = instant();
      const record = requireRecord(value, at);
      const recordId = assertIdentifier(record.recordId, "record.recordId", 512);
      if (liveClaim(recordId, at) || liveRecord(recordId, at)) return false;
      records.set(recordId, record);
      return true;
    },
    async get(value) {
      const recordId = assertIdentifier(value, "recordId", 512);
      const at = instant();
      const claim = liveClaim(recordId, at);
      return clone(claim?.record || liveRecord(recordId, at));
    },
    async claim(value, claimIdValue, claimExpiresAt) {
      const recordId = assertIdentifier(value, "recordId", 512);
      const claimId = assertIdentifier(claimIdValue, "claimId", 512);
      const at = instant();
      if (!Number.isFinite(claimExpiresAt) || claimExpiresAt <= at) {
        throw new TypeError("claimExpiresAt must be a future timestamp.");
      }
      if (liveClaim(recordId, at)) return null;
      const record = liveRecord(recordId, at);
      if (!record) return null;
      records.delete(recordId);
      claims.set(recordId, { claimId, claimExpiresAt, record });
      return clone(record);
    },
    async replace(value, claimIdValue, replacement) {
      const recordId = assertIdentifier(value, "recordId", 512);
      const claimId = assertIdentifier(claimIdValue, "claimId", 512);
      const at = instant();
      const claim = liveClaim(recordId, at);
      if (!claim || claim.claimId !== claimId) return false;
      const record = requireRecord(replacement, at);
      if (record.recordId !== recordId) throw new TypeError("Replacement record identity changed.");
      claims.delete(recordId);
      records.set(recordId, record);
      return true;
    },
    async release(value, claimIdValue) {
      const recordId = assertIdentifier(value, "recordId", 512);
      const claimId = assertIdentifier(claimIdValue, "claimId", 512);
      const at = instant();
      const claim = liveClaim(recordId, at);
      if (!claim || claim.claimId !== claimId) return false;
      claims.delete(recordId);
      records.set(recordId, claim.record);
      return true;
    },
    async delete(value) {
      const recordId = assertIdentifier(value, "recordId", 512);
      records.delete(recordId);
      claims.delete(recordId);
      return true;
    },
    stats: () => Object.freeze({
      persistence: "isolate-memory",
      atomicClaims: true,
      horizontalRecovery: false,
      records: records.size + claims.size,
    }),
  });
}
