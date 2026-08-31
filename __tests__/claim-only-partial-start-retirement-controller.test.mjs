import assert from "node:assert/strict";
import test from "node:test";

import { validateClaimOnlyRetirementTerminal }
  from "../scripts/claim-only-partial-start-retirement-controller.mjs";
import { digestValue }
  from "../scripts/cloud-collaboration-primitives.mjs";
import {
  buildClaimOnlyRetirementRequest, claimOnlyRetirementRequestDigest,
} from "../scripts/claim-only-partial-start-retirement-store.mjs";

const PHASE = "source-retired";
const OPERATION_KEY = "claim-only-retirement-null-normalization";
const EVALUATION_TIME = "2026-08-31T00:00:00.000Z";

test("retirement terminal treats absent optional projections as null but rejects values", () => {
  const { entry, input } = fixture();
  assert.equal(
    validateClaimOnlyRetirementTerminal(input).terminalEntryDigest,
    entry.digest,
  );

  const absent = structuredClone(entry);
  for (const field of ["canonicalDescendantProof", "recovery", "integration"]) {
    delete absent.claimCore[field];
  }
  sealEntry(absent);
  assert.equal(
    validateClaimOnlyRetirementTerminal({ ...input, entry: absent }).terminalEntryDigest,
    absent.digest,
  );

  for (const field of ["canonicalDescendantProof", "recovery", "integration"]) {
    const forged = structuredClone(absent);
    forged.claimCore[field] = { schema: `forged-${field}/v1` };
    sealEntry(forged);
    assert.throws(
      () => validateClaimOnlyRetirementTerminal({ ...input, entry: forged }),
      /terminal semantics/u,
    );
  }
});

function fixture() {
  const claim = {
    claimId: digestValue("source-claim"),
    claimDigest: digestValue("source-fence"),
    actorId: "github-user:1",
    deviceId: "device:source",
    sessionId: "session:source",
    repositoryId: "github-repository:1",
    workItemId: "claim-only-source",
    canonicalBaseRevision: "1".repeat(40),
    declaredWriteScope: ["path:scripts/source.mjs"],
    writeSetDigest: digestValue(["path:scripts/source.mjs"]),
    laneRevision: "2".repeat(40),
    leaseEpoch: 1,
    transitionCounter: 1,
    heartbeatCounter: 0,
    expiresAt: "2026-08-31T01:00:00.000Z",
    evidenceDigest: null,
    predecessorClaimId: null,
    eligibleSince: null,
    handoff: null,
    release: null,
    recovery: null,
    integration: null,
    canonicalDescendantProof: null,
  };
  const plan = {
    planDigest: digestValue("retirement-plan"),
    evidence: { successor: { claimId: digestValue("successor-claim") } },
  };
  const request = buildClaimOnlyRetirementRequest(
    plan, claim, PHASE, "unused", digestValue("unused"),
  );
  const claimCore = {
    claimId: claim.claimId,
    actorId: claim.actorId,
    deviceId: claim.deviceId,
    sessionId: claim.sessionId,
    repositoryId: claim.repositoryId,
    workItemId: claim.workItemId,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    declaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    laneRevision: claim.laneRevision,
    leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter + 1,
    heartbeatCounter: claim.heartbeatCounter,
    state: "retired",
    expiresAt: claim.expiresAt,
    evidenceDigest: null,
    reviewRequestId: null,
    predecessorClaimId: null,
    eligibleSince: null,
    handoff: null,
    release: null,
    recovery: null,
    integration: null,
    canonicalDescendantProof: null,
    retirement: {
      reason: request.reason,
      finalRevision: request.finalRevision,
      reviewRequestId: null,
      bytesDigest: request.bytesDigest,
      namedChecksDigest: request.namedChecksDigest,
      handoffEvidenceDigest: request.handoffEvidenceDigest,
      integrationReceiptDigest: null,
      retiredAt: EVALUATION_TIME,
    },
  };
  const entry = sealEntry({
    schema: "agentic-cloud-collaboration-entry/v2",
    sequence: 3,
    parentDigest: digestValue("parent"),
    action: "retire",
    repositoryId: claim.repositoryId,
    claimId: claim.claimId,
    idempotencyKey: digestValue(OPERATION_KEY),
    requestDigest: claimOnlyRetirementRequestDigest(plan, claim, PHASE),
    evaluationTime: EVALUATION_TIME,
    claimCore,
  });
  return {
    entry,
    input: { entry, plan, claim, phase: PHASE, operationKey: OPERATION_KEY },
  };
}

function sealEntry(entry) {
  entry.claimDigest = digestValue(entry.claimCore);
  const draft = { ...entry };
  delete draft.digest;
  entry.digest = digestValue(draft);
  return entry;
}
