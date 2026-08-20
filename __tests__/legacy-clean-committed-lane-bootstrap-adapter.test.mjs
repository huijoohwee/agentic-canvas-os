import test from "node:test";
import assert from "node:assert/strict";

import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { normalizeCloudAuthority } from "../scripts/scoped-lane-admission-lib.mjs";
import {
  createLegacyBootstrapRecoveryRequest,
  findRecoverableLegacyBootstrapClaim,
  legacyBootstrapRecoveryEvidenceDigest,
  projectRecoveredLegacyBootstrapResult,
  requireRecoveredLegacyBootstrapClaim,
} from "../scripts/legacy-clean-committed-lane-bootstrap-adapter-lib.mjs";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const CLAIM_ID = "c".repeat(64);
const FENCE_REVISION = "d".repeat(64);
const OPERATION_RECEIPT_DIGEST = "e".repeat(64);
const IDENTITY_DIGEST = "f".repeat(64);
const BRANCH = "agent/device.local/legacy-bootstrap-response-loss-adoption";
const DECLARED_WRITE_SCOPE = normalizeWriteSet([
  "path:scripts/legacy-clean-committed-lane-bootstrap-adapter.mjs",
  "semantic:legacy-bootstrap-response-loss-adoption",
]);
const REQUEST = Object.freeze({
  targetRepository: "owner/repository",
  ledgerRepository: "owner/repository",
  sessionId: "session-1",
  deviceId: "device.local",
  semanticScope: "legacy-bootstrap-response-loss-adoption",
  branch: BRANCH,
  expectedBaseSha: BASE_SHA,
  expectedHeadSha: HEAD_SHA,
  declaredWriteScope: DECLARED_WRITE_SCOPE,
  writeSetDigest: digestValue(DECLARED_WRITE_SCOPE),
});
const IDENTITY = Object.freeze({ identityDigest: IDENTITY_DIGEST });
const CHECKPOINT = Object.freeze({
  schema: "agentic-legacy-clean-committed-lane-bootstrap-checkpoint/v1",
  status: "prepared",
  identity: IDENTITY,
  outputs: {},
});

function claim(overrides = {}) {
  return {
    claimId: CLAIM_ID,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "current",
    writeAuthority: true,
    scopeReserved: true,
    deviceId: pseudonymousIdentifier("device", REQUEST.deviceId),
    sessionId: pseudonymousIdentifier("session", REQUEST.sessionId),
    workItemId: pseudonymousIdentifier("work-item", REQUEST.branch),
    canonicalBaseRevision: BASE_SHA,
    laneRevision: BASE_SHA,
    declaredWriteScope: DECLARED_WRITE_SCOPE,
    writeSetDigest: REQUEST.writeSetDigest,
    leaseEpoch: 1,
    transitionCounter: 1,
    heartbeatCounter: 0,
    reviewRequestId: null,
    predecessorClaimId: null,
    expiresAt: "2099-01-01T00:00:00.000Z",
    fenceRevision: FENCE_REVISION,
    transitionDigest: "1".repeat(64),
    operationReceiptDigest: OPERATION_RECEIPT_DIGEST,
    integrationReceiptDigest: null,
    integration: null,
    ...overrides,
  };
}

test("prepared bootstrap adopts only its exact response-ahead claim", () => {
  const exact = claim();
  assert.equal(findRecoverableLegacyBootstrapClaim({
    claims: [claim({ claimId: "0".repeat(64), sessionId: "session:foreign" }), exact],
    request: REQUEST,
    checkpoint: CHECKPOINT,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), exact);
  assert.equal(findRecoverableLegacyBootstrapClaim({
    claims: [exact],
    request: REQUEST,
    checkpoint: { ...CHECKPOINT, outputs: { cloudClaim: {} } },
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), null);
});

test("dormant response-ahead recovery request is content-bound and stable", () => {
  const dormant = claim({ state: "dormant-preserved", writeAuthority: false });
  const request = createLegacyBootstrapRecoveryRequest({
    claim: dormant,
    request: REQUEST,
    identity: IDENTITY,
  });
  assert.equal(request.claimId, CLAIM_ID);
  assert.equal(request.expectedFenceRevision, FENCE_REVISION);
  assert.equal(request.expectedTransitionCounter, 1);
  assert.equal(request.mode, "recovery");
  assert.equal(request.recoveryEvidenceDigest,
    legacyBootstrapRecoveryEvidenceDigest({ request: REQUEST, identity: IDENTITY }));
  assert.match(request.idempotencyKey,
    /^legacy-bootstrap-response-loss-recovery:[0-9a-f]{64}:[0-9a-f]{64}$/u);
});

test("recovery adoption accepts only the exact counter-plus-one authority", () => {
  const dormant = claim({ state: "dormant-preserved", writeAuthority: false });
  const recovered = claim({
    transitionCounter: 2,
    fenceRevision: "2".repeat(64),
    transitionDigest: "3".repeat(64),
    recovery: {
      evidenceDigest: legacyBootstrapRecoveryEvidenceDigest({
        request: REQUEST,
        identity: IDENTITY,
      }),
    },
  });
  assert.equal(requireRecoveredLegacyBootstrapClaim({
    claim: recovered,
    sourceClaim: dormant,
    request: REQUEST,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), recovered);
  const result = projectRecoveredLegacyBootstrapResult({
    statusResult: { ledgerRevision: "3".repeat(40), ledgerDigest: "4".repeat(64) },
    claim: recovered,
  });
  assert.equal(result.action, "continue");
  assert.equal(result.claimDigest, recovered.fenceRevision);
  const authority = normalizeCloudAuthority({
    ledgerRepository: REQUEST.ledgerRepository,
    targetRepository: REQUEST.targetRepository,
    result,
  }, {
    canonicalBaseSha: BASE_SHA,
    manifest: {
      declaredWriteSet: DECLARED_WRITE_SCOPE,
      writeSetDigest: REQUEST.writeSetDigest,
    },
  });
  assert.equal(authority.state, "active");
  assert.equal(authority.claimId, CLAIM_ID);
  assert.throws(() => requireRecoveredLegacyBootstrapClaim({
    claim: { ...recovered, laneRevision: HEAD_SHA },
    sourceClaim: dormant,
    request: REQUEST,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), /changed its exact response-loss subject/u);
});

test("recovered response-ahead authority remains attributable on replay", () => {
  const recovered = claim({
    transitionCounter: 2,
    fenceRevision: "2".repeat(64),
    transitionDigest: "3".repeat(64),
    recovery: {
      evidenceDigest: legacyBootstrapRecoveryEvidenceDigest({
        request: REQUEST,
        identity: IDENTITY,
      }),
    },
  });
  assert.equal(findRecoverableLegacyBootstrapClaim({
    claims: [recovered],
    request: REQUEST,
    checkpoint: CHECKPOINT,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), recovered);
});
