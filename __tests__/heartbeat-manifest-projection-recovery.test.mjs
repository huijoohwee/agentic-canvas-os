import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameCloudSubject,
  reconcileHeartbeatManifestProjection,
  requireCloudAdmission,
} from "../scripts/expired-committed-heartbeat-contract.mjs";
import {
  digestValue,
  normalizeWriteSet,
} from "../scripts/cloud-collaboration-primitives.mjs";

const hex = (character, length) => character.repeat(length);

function fixture({ manifest = "transport" } = {}) {
  const declaredWriteSet = normalizeWriteSet([
    "path:scripts/recovery.mjs",
    "semantic:heartbeat-recovery",
  ]);
  const writeSetDigest = digestValue(declaredWriteSet);
  const admittedManifestDigest = hex("1", 64);
  const transportManifestDigest = digestValue({
    declaredWriteSet,
    writeSetDigest,
  });
  const manifestDigest = manifest === "transport"
    ? transportManifestDigest
    : manifest === "admitted"
      ? admittedManifestDigest
      : manifest;
  const authority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "huijoohwee/agentic-canvas-os",
    targetRepository: "huijoohwee/agentic-canvas-os",
    claimId: hex("2", 64),
    claimDigest: hex("3", 64),
    ledgerRevision: hex("4", 40),
    claimLedgerRevision: hex("5", 64),
    canonicalBaseSha: hex("6", 40),
    laneRevision: hex("7", 40),
    cloudDeclaredWriteScope: declaredWriteSet,
    writeSetDigest,
    deviceId: "device-a",
    sessionId: "session-a",
    reviewRequestId: "github-pull-request:PR_node",
    leaseEpoch: 1,
    transitionCounter: 4,
    state: "active",
    expiresAt: "2026-08-10T12:00:00.000Z",
    manifestDigest,
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    device: authority.deviceId,
    sessionId: authority.sessionId,
    baseSha: authority.canonicalBaseSha,
    fenceSha: authority.laneRevision,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      declaredWriteSet,
      writeSetDigest,
      manifestDigest: admittedManifestDigest,
    },
    cloudAuthority: authority,
  };
  return { admittedManifestDigest, authority, lease, transportManifestDigest };
}

test("exact transport projection is admitted read-only and canonicalized for CAS", () => {
  const source = fixture();
  requireCloudAdmission({
    lease: source.lease,
    instant: new Date("2026-08-10T10:00:00.000Z"),
  });
  const canonical = reconcileHeartbeatManifestProjection({
    renewed: source.authority,
    admittedManifestDigest: source.admittedManifestDigest,
  });
  assert.equal(canonical.manifestDigest, source.admittedManifestDigest);
  assert.equal(source.authority.manifestDigest, source.transportManifestDigest);
  assert.notEqual(canonical, source.authority);
});

test("canonical source and exact transport heartbeat preserve one claim subject", () => {
  const source = fixture({ manifest: "admitted" });
  const renewedTransport = fixture().authority;
  assertSameCloudSubject({
    source: source.authority,
    renewed: {
      ...renewedTransport,
      transitionCounter: source.authority.transitionCounter + 1,
      expiresAt: "2026-08-10T13:00:00.000Z",
    },
    lease: source.lease,
    now: new Date("2026-08-10T10:00:00.000Z"),
  });
});

test("arbitrary and missing source projections remain fail-closed", () => {
  const arbitrary = fixture({ manifest: hex("0", 64) });
  assert.throws(() => requireCloudAdmission({
    lease: arbitrary.lease,
    instant: new Date("2026-08-10T10:00:00.000Z"),
  }), /source cloud manifest differs from its admitted manifest/);

  const missing = fixture();
  delete missing.lease.cloudAuthority.manifestDigest;
  assert.throws(() => requireCloudAdmission({
    lease: missing.lease,
    instant: new Date("2026-08-10T10:00:00.000Z"),
  }), /source cloud manifest differs from its admitted manifest/);
});
