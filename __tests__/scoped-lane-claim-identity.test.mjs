import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_CLAIM_ENTRY_SCHEMA,
  HISTORICAL_CLAIM_ENTRY_SCHEMA,
  claimProvenanceMatches,
  normalizeClaimProvenance,
} from "../scripts/scoped-lane-claim-provenance.mjs";

const claimId = "a".repeat(64);
const operationReceiptDigest = "b".repeat(64);

function currentClaim(overrides = {}) {
  return {
    claimId,
    entrySchema: CURRENT_CLAIM_ENTRY_SCHEMA,
    claimIdentitySchema: CURRENT_CLAIM_ENTRY_SCHEMA,
    operationReceiptDigest,
    deviceId: "device-a",
    sessionId: "session-a",
    ...overrides,
  };
}

function historicalClaim(overrides = {}) {
  return {
    claimId,
    entrySchema: HISTORICAL_CLAIM_ENTRY_SCHEMA,
    claimIdentitySchema: HISTORICAL_CLAIM_ENTRY_SCHEMA,
    operationReceiptDigest: null,
    deviceId: "device-a",
    sessionId: "session-a",
    ...overrides,
  };
}

test("claim provenance requires explicit supported schemas and operation receipts", () => {
  assert.throws(
    () => normalizeClaimProvenance({ claimIdentitySchema: CURRENT_CLAIM_ENTRY_SCHEMA }),
    /entrySchema is unsupported/,
  );
  assert.throws(
    () => normalizeClaimProvenance(currentClaim({ operationReceiptDigest: null })),
    /requires an operation receipt digest/,
  );
  assert.throws(
    () => normalizeClaimProvenance(historicalClaim({
      claimIdentitySchema: CURRENT_CLAIM_ENTRY_SCHEMA,
    })),
    /cannot postdate its historical entry/,
  );
});

test("native v2 claim identity remains immutable across local device rotation", () => {
  const remote = currentClaim();
  const local = currentClaim({ deviceId: "device-b", sessionId: "session-b" });
  assert.equal(claimProvenanceMatches(remote, local), true);
});

test("continued v1-origin identity remains valid in a current v2 entry", () => {
  const remote = currentClaim({
    claimIdentitySchema: HISTORICAL_CLAIM_ENTRY_SCHEMA,
  });
  const local = currentClaim({
    claimIdentitySchema: HISTORICAL_CLAIM_ENTRY_SCHEMA,
    deviceId: "replacement-device",
    sessionId: "replacement-session",
  });
  assert.equal(claimProvenanceMatches(remote, local), true);
});

test("raw v1 claims are historical-only, but remain eligible for peer preservation", () => {
  const remote = historicalClaim();
  const local = historicalClaim({ deviceId: "device-b", sessionId: "session-b" });
  assert.equal(claimProvenanceMatches(remote, local), false);
  assert.equal(
    claimProvenanceMatches(remote, local, { requireCurrentEntry: false }),
    true,
  );
});

test("claim, identity schema, and operation receipt substitutions fail closed", () => {
  const remote = currentClaim();
  assert.equal(claimProvenanceMatches(remote, currentClaim({ claimId: "c".repeat(64) })), false);
  assert.equal(claimProvenanceMatches(remote, currentClaim({
    claimIdentitySchema: HISTORICAL_CLAIM_ENTRY_SCHEMA,
  })), false);
  assert.equal(claimProvenanceMatches(remote, currentClaim({
    operationReceiptDigest: "d".repeat(64),
  })), false);
  assert.equal(claimProvenanceMatches(remote, historicalClaim(), {
    requireCurrentEntry: false,
  }), false);
});
