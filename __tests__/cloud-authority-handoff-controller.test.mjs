import test from "node:test";
import assert from "node:assert/strict";

import {
  CLOUD_AUTHORITY_HANDOFF_RECEIPT_SCHEMA,
  CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA,
  continueExpiredReviewLaneAuthority,
  createCloudAuthorityHandoffControllerAdapter,
  createRepositoryCloudAuthorityHandoffControllerAdapter,
} from "../scripts/cloud-authority-handoff-controller.mjs";
import {
  applyCloudTransition,
  createEmptyLedger,
} from "../scripts/cloud-collaboration-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  updateWriterLeasePullRequestBody,
  WRITER_LEASE_SCHEMA,
} from "../scripts/writer-lease-lib.mjs";

const BASE_SHA = "a".repeat(40);
const REVIEW_SHA = "b".repeat(40);
const REFRESHED_SHA = "0".repeat(40);
const PREDECESSOR_CLAIM_ID = "c".repeat(64);
const PREDECESSOR_CLAIM_DIGEST = "d".repeat(64);
const PREDECESSOR_LEDGER_DIGEST = "e".repeat(64);
const FOCUSED_EVIDENCE_DIGEST = "1".repeat(64);
const RECOVERED_CLAIM_DIGEST = "2".repeat(64);
const RECOVERED_LEDGER_DIGEST = "3".repeat(64);
const STATUS_LEDGER_DIGEST = "4".repeat(64);
const MANIFEST_DIGEST = "5".repeat(64);
const WRITE_SET_DIGEST = "6".repeat(64);
const ADMITTED_REPORT_DIGEST = "7".repeat(64);
const RECOVERY_RECEIPT_DIGEST = "8".repeat(64);
const VERIFICATION_RECEIPT_DIGEST = "9".repeat(64);
const PROJECTION_RECEIPT_DIGEST = "f".repeat(64);
const SECOND_RECOVERED_CLAIM_DIGEST = "a".repeat(64);
const SECOND_RECOVERED_LEDGER_DIGEST = "b".repeat(64);
const SECOND_RECOVERY_RECEIPT_DIGEST = "c".repeat(64);
const SECOND_VERIFICATION_RECEIPT_DIGEST = "0".repeat(64);
const THIRD_RECOVERED_CLAIM_DIGEST = digestValue({ fixture: "third-recovered-claim" });
const THIRD_RECOVERED_LEDGER_DIGEST = digestValue({ fixture: "third-recovered-ledger" });
const THIRD_RECOVERY_RECEIPT_DIGEST = digestValue({ fixture: "third-recovery-receipt" });
const THIRD_VERIFICATION_RECEIPT_DIGEST = digestValue({ fixture: "third-verification-receipt" });
const THIRD_LEDGER_SHA = "d".repeat(40);
const READER_LEDGER_SHA = "e".repeat(40);
const REVIEW_REQUEST_ID = "github-pull-request:PR_238";
const LEGACY_DEVICE_ID = `device:${digestValue({ namespace: "device", value: "legacy-device" })}`;
const LEGACY_SESSION_ID = `session:${digestValue({ namespace: "session", value: "legacy-session" })}`;
const EXPIRED_AT = "2026-08-03T07:37:22.000Z";
const LOCAL_RECOVERED_AT = "2026-08-03T07:07:22.000Z";
const RECOVERED_AT = "2026-08-03T08:37:22.000Z";
const REPLAY_EXPIRED_AT = "2026-08-03T09:07:22.000Z";
const SECOND_RECOVERED_AT = "2026-08-03T09:07:22.000Z";
const SECOND_REPLAY_EXPIRED_AT = "2026-08-03T10:07:22.000Z";
const THIRD_RECOVERED_AT = "2026-08-03T10:07:22.000Z";
const RECOVERED_EXPIRES_AT = "2099-08-03T09:07:22.000Z";
const PROJECTION_TIMESTAMP = "2026-08-03T08:38:22.000Z";
const DECLARED_WRITE_SET = [
  "path:docs/CANONICAL-LIFECYCLE.md",
  "path:scripts/legacy-authority-evaluator.mjs",
  "semantic:legacy-authority-evaluator",
];

function ownerIdentifierForTest(namespace, value) {
  return `${namespace}:${digestValue({ namespace, value })}`;
}

function preservedLane(overrides = {}) {
  const lease = {
    status: "review_ready",
    sessionId: "legacy-session",
    device: "legacy-device",
    scope: "legacy-authority-evaluator",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    baseSha: BASE_SHA,
    reviewHeadSha: REVIEW_SHA,
    pullRequestUrl: "https://github.com/example/repo/pull/238",
    admission: {
      status: "admitted",
      declaredWriteSet: DECLARED_WRITE_SET,
      writeSetDigest: WRITE_SET_DIGEST,
      admittedReportDigest: ADMITTED_REPORT_DIGEST,
      manifestDigest: MANIFEST_DIGEST,
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      provider: "github",
      ledgerRepository: "example/ledger",
      targetRepository: "example/repo",
      claimId: PREDECESSOR_CLAIM_ID,
      claimDigest: PREDECESSOR_CLAIM_DIGEST,
      ledgerRevision: BASE_SHA,
      claimLedgerRevision: PREDECESSOR_LEDGER_DIGEST,
      canonicalBaseSha: BASE_SHA,
      laneRevision: REVIEW_SHA,
      cloudDeclaredWriteScope: DECLARED_WRITE_SET,
      writeSetDigest: WRITE_SET_DIGEST,
      deviceId: "legacy-device",
      sessionId: "legacy-session",
      reviewRequestId: REVIEW_REQUEST_ID,
      leaseEpoch: 1,
      transitionCounter: 4,
      state: "review_ready",
      expiresAt: EXPIRED_AT,
      focusedEvidenceDigest: FOCUSED_EVIDENCE_DIGEST,
    },
  };
  return {
    repository: "/repo",
    branch: lease.branch,
    headSha: REVIEW_SHA,
    remoteHeadSha: REVIEW_SHA,
    clean: true,
    baseSha: BASE_SHA,
    lease,
    manifest: {
      declaredWriteSet: DECLARED_WRITE_SET,
      writeSetDigest: WRITE_SET_DIGEST,
      admittedReportDigest: ADMITTED_REPORT_DIGEST,
      manifestDigest: MANIFEST_DIGEST,
    },
    authority: lease.cloudAuthority,
    protectedMainRefresh: null,
    pullRequest: {
      url: lease.pullRequestUrl,
      state: "OPEN",
      isDraft: false,
      headRefName: lease.branch,
      headRefOid: REVIEW_SHA,
      baseRefName: "main",
      body: "<lease-marker>",
      authorLogin: "owner",
    },
    remoteLease: {
      branch: lease.branch,
      baseSha: BASE_SHA,
      scope: lease.scope,
      reviewHeadSha: REVIEW_SHA,
      cloudAuthority: { claimId: PREDECESSOR_CLAIM_ID },
    },
    ...overrides,
  };
}

function predecessorClaim(overrides = {}) {
  return {
    claimId: PREDECESSOR_CLAIM_ID,
    actorId: "github-user:1",
    repositoryId: "github-repository:1",
    workItemId: "work-item:1",
    state: "dormant-preserved",
    writeAuthority: false,
    scopeReserved: true,
    canonicalBaseRevision: BASE_SHA,
    laneRevision: REVIEW_SHA,
    declaredWriteScope: DECLARED_WRITE_SET,
    writeSetDigest: WRITE_SET_DIGEST,
    leaseEpoch: 1,
    transitionCounter: 4,
    deviceId: LEGACY_DEVICE_ID,
    sessionId: LEGACY_SESSION_ID,
    reviewRequestId: REVIEW_REQUEST_ID,
    expiresAt: EXPIRED_AT,
    evidenceDigest: FOCUSED_EVIDENCE_DIGEST,
    fenceRevision: PREDECESSOR_CLAIM_DIGEST,
    transitionDigest: PREDECESSOR_LEDGER_DIGEST,
    ...overrides,
  };
}

function statusResult(claims = [predecessorClaim()]) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    ledgerRevision: BASE_SHA,
    ledgerDigest: STATUS_LEDGER_DIGEST,
    claims,
  };
}

function validatedReaderLedger() {
  const actor = {
    actorId: "github-user:1",
    deviceId: LEGACY_DEVICE_ID,
    sessionId: LEGACY_SESSION_ID,
  };
  const repository = {
    repositoryId: "github-repository:1",
    canonicalRevision: BASE_SHA,
  };
  const claimed = applyCloudTransition({
    ledger: createEmptyLedger("github-repository:ledger"),
    action: "claim",
    actor,
    repository,
    evaluationTime: "2026-08-03T06:00:00.000Z",
    request: {
      workItemId: "work-item:reader",
      canonicalBaseRevision: BASE_SHA,
      declaredWriteScope: DECLARED_WRITE_SET,
      laneRevision: REVIEW_SHA,
      leaseEpoch: 1,
      expiresAt: "2098-08-03T06:00:00.000Z",
      expectedLedgerDigest: createEmptyLedger("github-repository:ledger").headDigest,
      idempotencyKey: "reader-claim",
    },
  });
  const reviewed = applyCloudTransition({
    ledger: claimed.ledger,
    action: "continue",
    actor,
    repository,
    evaluationTime: "2026-08-03T06:10:00.000Z",
    request: {
      claimId: claimed.claim.claimId,
      expectedFenceRevision: claimed.claim.fenceRevision,
      expectedTransitionCounter: claimed.claim.transitionCounter,
      expectedLedgerDigest: claimed.ledger.headDigest,
      mode: "review",
      laneRevision: REVIEW_SHA,
      reviewRequestId: REVIEW_REQUEST_ID,
      focusedEvidenceDigest: FOCUSED_EVIDENCE_DIGEST,
      idempotencyKey: "reader-review",
    },
  });
  const renewed = applyCloudTransition({
    ledger: reviewed.ledger,
    action: "continue",
    actor,
    repository,
    evaluationTime: "2026-08-03T06:20:00.000Z",
    request: {
      claimId: reviewed.claim.claimId,
      expectedFenceRevision: reviewed.claim.fenceRevision,
      expectedTransitionCounter: reviewed.claim.transitionCounter,
      expectedLedgerDigest: reviewed.ledger.headDigest,
      mode: "renewal",
      expiresAt: "2099-08-03T06:00:00.000Z",
      idempotencyKey: "reader-renewal",
    },
  });
  return {
    ledger: renewed.ledger,
    anchor: claimed.claim,
    current: renewed.claim,
  };
}

function recoveredAuthority(overrides = {}) {
  const transitionCounter = overrides.transitionCounter ?? 5;
  const operationReceiptDigest = overrides.operationReceiptDigest ?? (
    transitionCounter === 7
      ? THIRD_RECOVERY_RECEIPT_DIGEST
      : transitionCounter === 6
        ? SECOND_RECOVERY_RECEIPT_DIGEST
        : RECOVERY_RECEIPT_DIGEST
  );
  return {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "example/ledger",
    targetRepository: "example/repo",
    claimId: PREDECESSOR_CLAIM_ID,
    claimDigest: RECOVERED_CLAIM_DIGEST,
    ledgerRevision: BASE_SHA,
    claimLedgerRevision: RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest,
    canonicalBaseSha: BASE_SHA,
    laneRevision: REVIEW_SHA,
    cloudDeclaredWriteScope: DECLARED_WRITE_SET,
    writeSetDigest: WRITE_SET_DIGEST,
    deviceId: "legacy-device",
    sessionId: "legacy-session",
    reviewRequestId: REVIEW_REQUEST_ID,
    leaseEpoch: 1,
    transitionCounter: 5,
    state: "review_ready",
    expiresAt: RECOVERED_EXPIRES_AT,
    focusedEvidenceDigest: FOCUSED_EVIDENCE_DIGEST,
    manifestDigest: MANIFEST_DIGEST,
    ...overrides,
  };
}

function recoveryResult(
  recoveryEvidenceDigest,
  authority = recoveredAuthority(),
  recoveredAt = RECOVERED_AT,
) {
  return {
    authority: {
      ...authority,
      recovery: {
        evidenceDigest: recoveryEvidenceDigest,
        recoveredAt,
      },
    },
    recoveryReceiptDigest: authority.operationReceiptDigest,
    verificationReceiptDigest: VERIFICATION_RECEIPT_DIGEST,
  };
}

function laneWithRecoveryEvidence(recoveryEvidenceDigest) {
  const original = preservedLane();
  const authority = {
    ...original.authority,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: LOCAL_RECOVERED_AT,
    },
  };
  return preservedLane({
    lease: { ...original.lease, cloudAuthority: authority },
    authority,
  });
}

function dormantReplayedRecovery(recoveryEvidenceDigest, overrides = {}) {
  return predecessorClaim({
    state: "dormant-preserved",
    transitionCounter: 5,
    fenceRevision: RECOVERED_CLAIM_DIGEST,
    transitionDigest: RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: RECOVERY_RECEIPT_DIGEST,
    expiresAt: REPLAY_EXPIRED_AT,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: RECOVERED_AT,
    },
    ...overrides,
  });
}

function reviewedReplayedRecovery(recoveryEvidenceDigest, overrides = {}) {
  return predecessorClaim({
    state: "reviewed",
    transitionCounter: 5,
    fenceRevision: RECOVERED_CLAIM_DIGEST,
    transitionDigest: RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: RECOVERY_RECEIPT_DIGEST,
    expiresAt: RECOVERED_EXPIRES_AT,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: RECOVERED_AT,
    },
    ...overrides,
  });
}

function rawRecoveryLineageEntry({
  transitionCounter,
  claimDigest,
  digest,
  recoveredAt,
  expiresAt,
  recoveryEvidenceDigest,
}) {
  return {
    sequence: transitionCounter,
    action: "continue",
    evaluationTime: recoveredAt,
    claimId: PREDECESSOR_CLAIM_ID,
    claimDigest,
    digest,
    claimCore: {
      claimId: PREDECESSOR_CLAIM_ID,
      actorId: "github-user:1",
      deviceId: LEGACY_DEVICE_ID,
      sessionId: LEGACY_SESSION_ID,
      repositoryId: "github-repository:1",
      workItemId: "work-item:1",
      canonicalBaseRevision: BASE_SHA,
      laneRevision: REVIEW_SHA,
      declaredWriteScope: DECLARED_WRITE_SET,
      writeSetDigest: WRITE_SET_DIGEST,
      leaseEpoch: 1,
      transitionCounter,
      state: "reviewed",
      expiresAt,
      evidenceDigest: FOCUSED_EVIDENCE_DIGEST,
      reviewRequestId: REVIEW_REQUEST_ID,
      recovery: {
        evidenceDigest: recoveryEvidenceDigest,
        recoveredAt,
      },
    },
  };
}

function exactRecoveryLineage(recoveryEvidenceDigest, {
  currentExpiresAt = RECOVERED_EXPIRES_AT,
} = {}) {
  return [
    rawRecoveryLineageEntry({
      transitionCounter: 4,
      claimDigest: PREDECESSOR_CLAIM_DIGEST,
      digest: PREDECESSOR_LEDGER_DIGEST,
      recoveredAt: LOCAL_RECOVERED_AT,
      expiresAt: EXPIRED_AT,
      recoveryEvidenceDigest,
    }),
    rawRecoveryLineageEntry({
      transitionCounter: 5,
      claimDigest: RECOVERED_CLAIM_DIGEST,
      digest: RECOVERED_LEDGER_DIGEST,
      recoveredAt: RECOVERED_AT,
      expiresAt: REPLAY_EXPIRED_AT,
      recoveryEvidenceDigest,
    }),
    rawRecoveryLineageEntry({
      transitionCounter: 6,
      claimDigest: SECOND_RECOVERED_CLAIM_DIGEST,
      digest: SECOND_RECOVERED_LEDGER_DIGEST,
      recoveredAt: SECOND_RECOVERED_AT,
      expiresAt: currentExpiresAt,
      recoveryEvidenceDigest,
    }),
  ];
}

function statusWithRecoveryLineage(claim, recoveryEvidenceDigest, options = {}) {
  return {
    ...statusResult([claim]),
    recoveryLineage: exactRecoveryLineage(recoveryEvidenceDigest, options),
  };
}

function publicSecondRecoveryCloudResult(action) {
  const claim = predecessorClaim({
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "reviewed",
    transitionCounter: 6,
    fenceRevision: SECOND_RECOVERED_CLAIM_DIGEST,
    transitionDigest: SECOND_RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
    expiresAt: RECOVERED_EXPIRES_AT,
  });
  delete claim.deviceId;
  delete claim.sessionId;
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action,
    status: action === "verify" ? "ready" : "reviewed",
    ledgerRevision: BASE_SHA,
    claimDigest: SECOND_RECOVERED_CLAIM_DIGEST,
    claim,
    receipt: {
      ledgerDigest: SECOND_RECOVERED_LEDGER_DIGEST,
      receiptDigest: action === "continue"
        ? SECOND_RECOVERY_RECEIPT_DIGEST
        : SECOND_VERIFICATION_RECEIPT_DIGEST,
    },
  };
}

function publicThirdRecoveryCloudResult(action) {
  const claim = predecessorClaim({
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "reviewed",
    transitionCounter: 7,
    fenceRevision: THIRD_RECOVERED_CLAIM_DIGEST,
    transitionDigest: THIRD_RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: THIRD_RECOVERY_RECEIPT_DIGEST,
    expiresAt: RECOVERED_EXPIRES_AT,
  });
  delete claim.deviceId;
  delete claim.sessionId;
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action,
    status: action === "verify" ? "ready" : "reviewed",
    ledgerRevision: THIRD_LEDGER_SHA,
    claimDigest: THIRD_RECOVERED_CLAIM_DIGEST,
    claim,
    receipt: {
      ledgerDigest: THIRD_RECOVERED_LEDGER_DIGEST,
      receiptDigest: action === "continue"
        ? THIRD_RECOVERY_RECEIPT_DIGEST
        : THIRD_VERIFICATION_RECEIPT_DIGEST,
    },
  };
}

function fullThirdRecoveredClaim(recoveryEvidenceDigest) {
  const claim = publicThirdRecoveryCloudResult("continue").claim;
  return {
    ...claim,
    ledgerRevision: claim.transitionDigest,
    deviceId: LEGACY_DEVICE_ID,
    sessionId: LEGACY_SESSION_ID,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: THIRD_RECOVERED_AT,
    },
  };
}

function fullSecondRecoveredClaim(recoveryEvidenceDigest) {
  const claim = publicSecondRecoveryCloudResult("continue").claim;
  return {
    ...claim,
    ledgerRevision: claim.transitionDigest,
    deviceId: LEGACY_DEVICE_ID,
    sessionId: LEGACY_SESSION_ID,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: SECOND_RECOVERED_AT,
    },
  };
}

function publicRecoveryCloudResult(action) {
  const claim = predecessorClaim({
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "reviewed",
    transitionCounter: 5,
    fenceRevision: RECOVERED_CLAIM_DIGEST,
    transitionDigest: RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: RECOVERY_RECEIPT_DIGEST,
    expiresAt: RECOVERED_EXPIRES_AT,
  });
  delete claim.deviceId;
  delete claim.sessionId;
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action,
    status: action === "verify" ? "ready" : "reviewed",
    ledgerRevision: BASE_SHA,
    claimDigest: RECOVERED_CLAIM_DIGEST,
    claim,
    receipt: {
      ledgerDigest: RECOVERED_LEDGER_DIGEST,
      receiptDigest: action === "continue"
        ? RECOVERY_RECEIPT_DIGEST
        : VERIFICATION_RECEIPT_DIGEST,
    },
  };
}

function fullRecoveredClaim(recoveryEvidenceDigest) {
  const claim = publicRecoveryCloudResult("continue").claim;
  return {
    ...claim,
    ledgerRevision: claim.transitionDigest,
    deviceId: LEGACY_DEVICE_ID,
    sessionId: LEGACY_SESSION_ID,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: RECOVERED_AT,
    },
  };
}

function expectedRecoveryEvidenceDigest({
  transition = "reclaim",
  successorDeviceId = "legacy-device",
  successorSessionId = "legacy-session",
} = {}) {
  return digestValue({
    schema: CLOUD_AUTHORITY_HANDOFF_RECEIPT_SCHEMA,
    kind: "preflight",
    payload: {
      branch: "agent/legacy-device/legacy-authority-evaluator",
      transition,
      targetRepository: "example/repo",
      baseSha: BASE_SHA,
      headSha: REVIEW_SHA,
      reviewRequestId: REVIEW_REQUEST_ID,
      predecessorClaimId: PREDECESSOR_CLAIM_ID,
      predecessorLeaseEpoch: 1,
      successorDeviceId,
      successorSessionId,
      actorId: 1,
      blockingFindingDigest: digestValue([]),
    },
  });
}

function admittedWriterLease(authority = preservedLane().authority) {
  return {
    schema: WRITER_LEASE_SCHEMA,
    status: "review_ready",
    epoch: 1,
    sessionId: "legacy-session",
    device: "legacy-device",
    scope: "legacy-authority-evaluator",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    worktreePath: "/repo",
    baseSha: BASE_SHA,
    fenceSha: REVIEW_SHA,
    pullRequestUrl: "https://github.com/example/repo/pull/238",
    autoDelivery: false,
    runtimeRequired: false,
    reviewHeadSha: REVIEW_SHA,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: "legacy-authority-evaluator",
      declaredWriteSet: DECLARED_WRITE_SET,
      writeSetDigest: WRITE_SET_DIGEST,
      manifestDigest: MANIFEST_DIGEST,
      planReceiptDigest: "a".repeat(64),
      admissionReceiptDigest: "b".repeat(64),
      existingLaneStateDigest: "c".repeat(64),
      admittedReportDigest: ADMITTED_REPORT_DIGEST,
      preservationReceiptDigest: "d".repeat(64),
    },
    cloudAuthority: authority,
    acquiredAt: EXPIRED_AT,
    heartbeatAt: EXPIRED_AT,
    expiresAt: EXPIRED_AT,
  };
}

function adapterFor({
  lane = preservedLane(),
  actor = { id: 1, login: "owner" },
  status = statusResult(),
  recoverAuthority = ({ recoveryEvidenceDigest }) => recoveryResult(recoveryEvidenceDigest),
  persistReviewProjection = () => ({ receiptDigest: PROJECTION_RECEIPT_DIGEST }),
} = {}) {
  return createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => lane,
    readAuthenticatedOwner: () => actor,
    readCloudStatus: () => status,
    recoverAuthority,
    persistReviewProjection,
  });
}

function reclaim(adapter, overrides = {}) {
  return continueExpiredReviewLaneAuthority({
    transition: "reclaim",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    sessionId: "legacy-session",
    successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device",
    ...overrides,
  }, { adapter });
}

test("reclaim atomically recovers the exact dormant reviewed claim", async () => {
  const events = [];
  const adapter = adapterFor({
    recoverAuthority: ({ request, lane, predecessor, status, recoveryEvidenceDigest }) => {
      events.push(["recover", request.transition, predecessor.claimId]);
      assert.equal(lane.authority.claimId, predecessor.claimId);
      assert.equal(status.ledgerDigest, STATUS_LEDGER_DIGEST);
      assert.match(recoveryEvidenceDigest, /^[0-9a-f]{64}$/u);
      return recoveryResult(recoveryEvidenceDigest);
    },
    persistReviewProjection: ({ authority }) => {
      events.push(["persist", authority.claimId]);
      return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
  });

  const result = await reclaim(adapter);

  assert.equal(result.schema, CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA);
  assert.equal(result.outcome, "reclaimed-live");
  assert.equal(result.projectionUpdated, true);
  assert.equal(result.predecessorClaimId, PREDECESSOR_CLAIM_ID);
  assert.equal(result.successorClaimId, PREDECESSOR_CLAIM_ID);
  assert.equal(result.successorLeaseEpoch, 1);
  assert.equal(result.successorTransitionCounter, 5);
  assert.deepEqual(events, [
    ["recover", "reclaim", PREDECESSOR_CLAIM_ID],
    ["persist", PREDECESSOR_CLAIM_ID],
  ]);
  assert.equal(result.receipts[1].payload.recoveryReceiptDigest, RECOVERY_RECEIPT_DIGEST);
  assert.equal(result.receipts[1].payload.verificationReceiptDigest, VERIFICATION_RECEIPT_DIGEST);
  assert.equal(result.receipts[1].payload.recoveryEvidenceDigest, expectedRecoveryEvidenceDigest());
});

test("reclaim replays local projection after the exact cloud recovery already completed", async () => {
  let recovered = false;
  let persisted = false;
  const replayedClaim = predecessorClaim({
    state: "reviewed",
    transitionCounter: 5,
    fenceRevision: RECOVERED_CLAIM_DIGEST,
    transitionDigest: RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: RECOVERY_RECEIPT_DIGEST,
    expiresAt: RECOVERED_EXPIRES_AT,
    recovery: {
      evidenceDigest: expectedRecoveryEvidenceDigest(),
      recoveredAt: RECOVERED_AT,
    },
  });
  const result = await reclaim(adapterFor({
    status: statusResult([replayedClaim]),
    recoverAuthority: ({ predecessor, recoveryEvidenceDigest }) => {
      recovered = true;
      assert.equal(predecessor.state, "reviewed");
      assert.equal(predecessor.transitionCounter, 5);
      assert.equal(predecessor.recovery.evidenceDigest, recoveryEvidenceDigest);
      return recoveryResult(recoveryEvidenceDigest);
    },
    persistReviewProjection: () => {
      persisted = true;
      return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
  }));

  assert.equal(result.outcome, "reclaimed-live");
  assert.equal(result.successorClaimId, PREDECESSOR_CLAIM_ID);
  assert.equal(result.successorTransitionCounter, 5);
  assert.equal(recovered, true);
  assert.equal(persisted, true);
});

test("reclaim projects a validated live recovery chain more than one counter ahead", async () => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const lane = laneWithRecoveryEvidence(recoveryEvidenceDigest);
  const predecessor = reviewedReplayedRecovery(recoveryEvidenceDigest, {
    transitionCounter: 6,
    fenceRevision: SECOND_RECOVERED_CLAIM_DIGEST,
    transitionDigest: SECOND_RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: SECOND_RECOVERED_AT,
    },
  });
  let verified = false;
  let persisted = false;
  const result = await reclaim(adapterFor({
    lane,
    status: statusWithRecoveryLineage(predecessor, recoveryEvidenceDigest),
    recoverAuthority: ({ predecessor: observed, recoveryEvidenceDigest: observedEvidence }) => {
      verified = true;
      assert.equal(observed.transitionCounter, 6);
      assert.equal(observed.fenceRevision, SECOND_RECOVERED_CLAIM_DIGEST);
      assert.equal(observedEvidence, recoveryEvidenceDigest);
      return {
        ...recoveryResult(
        recoveryEvidenceDigest,
        recoveredAuthority({
          claimDigest: SECOND_RECOVERED_CLAIM_DIGEST,
          claimLedgerRevision: SECOND_RECOVERED_LEDGER_DIGEST,
          transitionCounter: 6,
        }),
        SECOND_RECOVERED_AT,
        ),
        recoveryReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
      };
    },
    persistReviewProjection: ({ authority }) => {
      persisted = true;
      assert.equal(authority.transitionCounter, 6);
      return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
  }));

  assert.equal(result.outcome, "reclaimed-live");
  assert.equal(result.successorTransitionCounter, 6);
  assert.equal(
    result.receipts[1].payload.recoveryReceiptDigest,
    SECOND_RECOVERY_RECEIPT_DIGEST,
  );
  assert.equal(verified, true);
  assert.equal(persisted, true);
});

test("controller binds the recovery receipt to the returned authority operation", async () => {
  await assert.rejects(
    reclaim(adapterFor({
      recoverAuthority: ({ recoveryEvidenceDigest }) => ({
        ...recoveryResult(recoveryEvidenceDigest),
        recoveryReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
      }),
    })),
    /outside the exact preserved claim/u,
  );
});

test("controller binds a reviewed replay to the exact cloud expiry and recovery time", async t => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const predecessor = reviewedReplayedRecovery(recoveryEvidenceDigest);
  const cases = [
    [
      "different future expiry",
      recoveredAuthority({ expiresAt: "2098-08-03T09:07:22.000Z" }),
      RECOVERED_AT,
    ],
    ["different recovery time", recoveredAuthority(), THIRD_RECOVERED_AT],
  ];
  for (const [name, authority, recoveredAt] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        reclaim(adapterFor({
          status: statusResult([predecessor]),
          recoverAuthority: () => recoveryResult(
            recoveryEvidenceDigest,
            authority,
            recoveredAt,
          ),
        })),
        /outside the exact preserved claim/u,
      );
    });
  }
});

test("recovery-chain lineage drift blocks before verification or projection", async t => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const lane = laneWithRecoveryEvidence(recoveryEvidenceDigest);
  const predecessor = reviewedReplayedRecovery(recoveryEvidenceDigest, {
    transitionCounter: 6,
    fenceRevision: SECOND_RECOVERED_CLAIM_DIGEST,
    transitionDigest: SECOND_RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: SECOND_RECOVERED_AT,
    },
  });
  const cases = [
    ["intervening owner", lineage => {
      lineage[1].claimCore.sessionId = ownerIdentifierForTest("session", "other-session");
    }],
    ["intervening recovery evidence", lineage => {
      lineage[1].claimCore.recovery.evidenceDigest = "0".repeat(64);
    }],
    ["intervening non-recovery continuation", lineage => {
      lineage[1].claimCore.recovery.recoveredAt = LOCAL_RECOVERED_AT;
    }],
    ["intervening review identity", lineage => {
      lineage[1].claimCore.reviewRequestId = "github-pull-request:PR_other";
    }],
    ["missing intermediate", lineage => {
      lineage.splice(1, 1);
    }],
    ["wrong intermediate action", lineage => {
      lineage[1].action = "integrate";
    }],
    ["non-monotonic intermediate expiry", lineage => {
      lineage[1].claimCore.expiresAt = RECOVERED_EXPIRES_AT;
    }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const recoveryLineage = structuredClone(exactRecoveryLineage(recoveryEvidenceDigest));
      mutate(recoveryLineage);
      let verified = false;
      let persisted = false;
      const result = await reclaim(adapterFor({
        lane,
        status: { ...statusResult([predecessor]), recoveryLineage },
        recoverAuthority: () => {
          verified = true;
          throw new Error("drifted recovery lineage must not verify");
        },
        persistReviewProjection: () => {
          persisted = true;
          throw new Error("drifted recovery lineage must not project");
        },
      }));
      assert.equal(result.outcome, "blocked");
      assert.equal(
        result.blockingFindings.some(finding => finding.type === "preserved-claim-drift"),
        true,
      );
      assert.equal(verified, false);
      assert.equal(persisted, false);
    });
  }
});

test("recovery-chain state, clock, and counter overflow drift block before mutation", async t => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const lane = laneWithRecoveryEvidence(recoveryEvidenceDigest);
  const clockCases = [
    reviewedReplayedRecovery(recoveryEvidenceDigest, {
      transitionCounter: 6,
      fenceRevision: SECOND_RECOVERED_CLAIM_DIGEST,
      transitionDigest: SECOND_RECOVERED_LEDGER_DIGEST,
      operationReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
      expiresAt: SECOND_REPLAY_EXPIRED_AT,
      recovery: {
        evidenceDigest: recoveryEvidenceDigest,
        recoveredAt: SECOND_RECOVERED_AT,
      },
    }),
    dormantReplayedRecovery(recoveryEvidenceDigest, {
      transitionCounter: 6,
      fenceRevision: SECOND_RECOVERED_CLAIM_DIGEST,
      transitionDigest: SECOND_RECOVERED_LEDGER_DIGEST,
      operationReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
      expiresAt: RECOVERED_EXPIRES_AT,
      recovery: {
        evidenceDigest: recoveryEvidenceDigest,
        recoveredAt: SECOND_RECOVERED_AT,
      },
    }),
  ];
  for (const predecessor of clockCases) {
    await t.test(`${predecessor.state} clock mismatch`, async () => {
      let mutated = false;
      const result = await reclaim(adapterFor({
        lane,
        status: statusWithRecoveryLineage(predecessor, recoveryEvidenceDigest, {
          currentExpiresAt: predecessor.expiresAt,
        }),
        recoverAuthority: () => {
          mutated = true;
          throw new Error("state/clock drift must not mutate");
        },
      }));
      assert.equal(result.outcome, "blocked");
      assert.equal(mutated, false);
    });
  }

  await t.test("dormant counter overflow", async () => {
    const overflowAuthority = {
      ...lane.authority,
      transitionCounter: Number.MAX_SAFE_INTEGER - 1,
    };
    const overflowLane = preservedLane({
      lease: { ...lane.lease, cloudAuthority: overflowAuthority },
      authority: overflowAuthority,
    });
    const predecessor = dormantReplayedRecovery(recoveryEvidenceDigest, {
      transitionCounter: Number.MAX_SAFE_INTEGER,
    });
    let mutated = false;
    const result = await reclaim(adapterFor({
      lane: overflowLane,
      status: statusResult([predecessor]),
      recoverAuthority: () => {
        mutated = true;
        throw new Error("overflow must block before mutation");
      },
    }));
    assert.equal(result.outcome, "blocked");
    assert.equal(mutated, false);
  });

  await t.test("direct dormant predecessor at max counter", async () => {
    const maxAuthority = {
      ...lane.authority,
      transitionCounter: Number.MAX_SAFE_INTEGER,
    };
    const maxLane = preservedLane({
      lease: { ...lane.lease, cloudAuthority: maxAuthority },
      authority: maxAuthority,
    });
    const predecessor = predecessorClaim({
      transitionCounter: Number.MAX_SAFE_INTEGER,
    });
    let mutated = false;
    const result = await reclaim(adapterFor({
      lane: maxLane,
      status: statusResult([predecessor]),
      recoverAuthority: () => {
        mutated = true;
        throw new Error("max counter must block before recovery");
      },
    }));
    assert.equal(result.outcome, "blocked");
    assert.equal(mutated, false);
  });
});

test("reclaim recovers an exact expired replay whose local projection never completed", async () => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const lane = laneWithRecoveryEvidence(recoveryEvidenceDigest);
  const predecessor = dormantReplayedRecovery(recoveryEvidenceDigest);
  let recovered = false;
  let persisted = false;
  const result = await reclaim(adapterFor({
    lane,
    status: statusResult([predecessor]),
    recoverAuthority: ({ predecessor: observed, recoveryEvidenceDigest: observedEvidence }) => {
      recovered = true;
      assert.equal(observed.transitionCounter, 5);
      assert.equal(observed.fenceRevision, RECOVERED_CLAIM_DIGEST);
      assert.equal(observedEvidence, recoveryEvidenceDigest);
      return recoveryResult(
        recoveryEvidenceDigest,
        recoveredAuthority({
          claimDigest: SECOND_RECOVERED_CLAIM_DIGEST,
          claimLedgerRevision: SECOND_RECOVERED_LEDGER_DIGEST,
          transitionCounter: 6,
        }),
        SECOND_RECOVERED_AT,
      );
    },
    persistReviewProjection: ({ authority }) => {
      persisted = true;
      assert.equal(authority.transitionCounter, 6);
      return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
  }));

  assert.equal(result.outcome, "reclaimed-live");
  assert.equal(result.successorClaimId, PREDECESSOR_CLAIM_ID);
  assert.equal(result.successorTransitionCounter, 6);
  assert.equal(result.receipts[1].payload.successorTransitionCounter, 6);
  assert.equal(recovered, true);
  assert.equal(persisted, true);
});

test("reclaim advances a validated dormant recovery chain from its current counter", async () => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const lane = laneWithRecoveryEvidence(recoveryEvidenceDigest);
  const predecessor = dormantReplayedRecovery(recoveryEvidenceDigest, {
    transitionCounter: 6,
    fenceRevision: SECOND_RECOVERED_CLAIM_DIGEST,
    transitionDigest: SECOND_RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
    expiresAt: SECOND_REPLAY_EXPIRED_AT,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: SECOND_RECOVERED_AT,
    },
  });
  let recovered = false;
  const result = await reclaim(adapterFor({
    lane,
    status: statusWithRecoveryLineage(predecessor, recoveryEvidenceDigest, {
      currentExpiresAt: SECOND_REPLAY_EXPIRED_AT,
    }),
    recoverAuthority: ({ predecessor: observed }) => {
      recovered = true;
      assert.equal(observed.transitionCounter, 6);
      assert.equal(observed.fenceRevision, SECOND_RECOVERED_CLAIM_DIGEST);
      return recoveryResult(
        recoveryEvidenceDigest,
        recoveredAuthority({
          claimDigest: THIRD_RECOVERED_CLAIM_DIGEST,
          claimLedgerRevision: THIRD_RECOVERED_LEDGER_DIGEST,
          transitionCounter: 7,
        }),
        THIRD_RECOVERED_AT,
      );
    },
  }));

  assert.equal(result.outcome, "reclaimed-live");
  assert.equal(result.successorTransitionCounter, 7);
  assert.equal(recovered, true);
});

test("expired replay recovery rejects stale, skipped, or predecessor-reused successors", async () => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const lane = laneWithRecoveryEvidence(recoveryEvidenceDigest);
  const predecessor = dormantReplayedRecovery(recoveryEvidenceDigest);
  const candidates = [
    recoveredAuthority({
      claimDigest: SECOND_RECOVERED_CLAIM_DIGEST,
      claimLedgerRevision: SECOND_RECOVERED_LEDGER_DIGEST,
      transitionCounter: 5,
    }),
    recoveredAuthority({
      claimDigest: SECOND_RECOVERED_CLAIM_DIGEST,
      claimLedgerRevision: SECOND_RECOVERED_LEDGER_DIGEST,
      transitionCounter: 7,
    }),
    recoveredAuthority({
      claimDigest: RECOVERED_CLAIM_DIGEST,
      claimLedgerRevision: SECOND_RECOVERED_LEDGER_DIGEST,
      transitionCounter: 6,
    }),
    recoveredAuthority({
      claimDigest: SECOND_RECOVERED_CLAIM_DIGEST,
      claimLedgerRevision: RECOVERED_LEDGER_DIGEST,
      transitionCounter: 6,
    }),
  ];

  for (const authority of candidates) {
    await assert.rejects(
      reclaim(adapterFor({
        lane,
        status: statusResult([predecessor]),
        recoverAuthority: () => recoveryResult(
          recoveryEvidenceDigest,
          authority,
          SECOND_RECOVERED_AT,
        ),
      })),
      /outside the exact preserved claim/,
    );
  }

  await assert.rejects(
    reclaim(adapterFor({
      lane,
      status: statusResult([predecessor]),
      recoverAuthority: () => recoveryResult(
        recoveryEvidenceDigest,
        recoveredAuthority({
          claimDigest: SECOND_RECOVERED_CLAIM_DIGEST,
          claimLedgerRevision: SECOND_RECOVERED_LEDGER_DIGEST,
          transitionCounter: 6,
        }),
        RECOVERED_AT,
      ),
    })),
    /outside the exact preserved claim/,
  );
});

test("expired replay recovery evidence and structural drift block before mutation", async t => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const lane = laneWithRecoveryEvidence(recoveryEvidenceDigest);
  const cases = [
    [
      "wrong recovery evidence",
      dormantReplayedRecovery("0".repeat(64)),
      "unprojected-recovery-evidence-drift",
    ],
    [
      "non-advancing transition counter",
      dormantReplayedRecovery(recoveryEvidenceDigest, { transitionCounter: 4 }),
      "preserved-claim-drift",
    ],
    [
      "reused predecessor fence",
      dormantReplayedRecovery(recoveryEvidenceDigest, {
        fenceRevision: PREDECESSOR_CLAIM_DIGEST,
      }),
      "preserved-claim-drift",
    ],
    [
      "reused predecessor transition",
      dormantReplayedRecovery(recoveryEvidenceDigest, {
        transitionDigest: PREDECESSOR_LEDGER_DIGEST,
      }),
      "preserved-claim-drift",
    ],
    [
      "missing operation receipt",
      dormantReplayedRecovery(recoveryEvidenceDigest, {
        operationReceiptDigest: null,
      }),
      "preserved-claim-drift",
    ],
    [
      "wrong successor owner",
      dormantReplayedRecovery(recoveryEvidenceDigest, {
        sessionId: ownerIdentifierForTest("session", "other-session"),
      }),
      "preserved-claim-drift",
    ],
    [
      "non-advancing expiry",
      dormantReplayedRecovery(recoveryEvidenceDigest, { expiresAt: EXPIRED_AT }),
      "preserved-claim-drift",
    ],
    [
      "recovery timestamp before local expiry",
      dormantReplayedRecovery(recoveryEvidenceDigest, {
        recovery: {
          evidenceDigest: recoveryEvidenceDigest,
          recoveredAt: LOCAL_RECOVERED_AT,
        },
      }),
      "preserved-claim-drift",
    ],
  ];

  for (const [name, predecessor, expectedFinding] of cases) {
    await t.test(name, async () => {
      let mutated = false;
      let persisted = false;
      const result = await reclaim(adapterFor({
        lane,
        status: statusResult([predecessor]),
        recoverAuthority: () => {
          mutated = true;
          throw new Error("drifted replay must not mutate cloud authority");
        },
        persistReviewProjection: () => {
          persisted = true;
          throw new Error("drifted replay must not update local projection");
        },
      }));
      assert.equal(result.outcome, "blocked");
      assert.equal(
        result.blockingFindings.some(finding => finding.type === expectedFinding),
        true,
      );
      assert.equal(mutated, false);
      assert.equal(persisted, false);
    });
  }

  const retained = await reclaim(adapterFor({
    lane,
    status: statusResult([dormantReplayedRecovery(recoveryEvidenceDigest)]),
    recoverAuthority: () => {
      throw new Error("retain must not mutate an expired replay");
    },
  }), { transition: "retain" });
  assert.equal(retained.outcome, "blocked");
  assert.equal(
    retained.blockingFindings.some(finding => finding.type === "preserved-claim-drift"),
    true,
  );

  let mutated = false;
  const localEvidenceDrift = await reclaim(adapterFor({
    lane: laneWithRecoveryEvidence("0".repeat(64)),
    status: statusResult([dormantReplayedRecovery(recoveryEvidenceDigest)]),
    recoverAuthority: () => {
      mutated = true;
      throw new Error("local evidence drift must block before recovery");
    },
  }));
  assert.equal(localEvidenceDrift.outcome, "blocked");
  assert.equal(
    localEvidenceDrift.blockingFindings.some(
      finding => finding.type === "unprojected-recovery-evidence-drift",
    ),
    true,
  );
  assert.equal(mutated, false);

  const liveGapWithoutLocalEvidence = await reclaim(adapterFor({
    lane: preservedLane(),
    status: statusWithRecoveryLineage(reviewedReplayedRecovery(recoveryEvidenceDigest, {
      transitionCounter: 6,
      fenceRevision: SECOND_RECOVERED_CLAIM_DIGEST,
      transitionDigest: SECOND_RECOVERED_LEDGER_DIGEST,
      operationReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
      recovery: {
        evidenceDigest: recoveryEvidenceDigest,
        recoveredAt: SECOND_RECOVERED_AT,
      },
    }), recoveryEvidenceDigest),
    recoverAuthority: () => {
      mutated = true;
      throw new Error("a recovery gap without the local evidence anchor must not verify");
    },
  }));
  assert.equal(liveGapWithoutLocalEvidence.outcome, "blocked");
  assert.equal(
    liveGapWithoutLocalEvidence.blockingFindings.some(
      finding => finding.type === "unprojected-recovery-evidence-drift",
    ),
    true,
  );
  assert.equal(mutated, false);
});

test("reclaim returns an exact replay after cloud and local projections already completed", async () => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const authority = recoveredAuthority({
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: RECOVERED_AT,
    },
  });
  const original = preservedLane();
  const lane = preservedLane({
    lease: { ...original.lease, cloudAuthority: authority },
    authority,
    remoteLease: {
      ...original.remoteLease,
      cloudAuthority: authority,
    },
  });
  const completedClaim = predecessorClaim({
    state: "reviewed",
    transitionCounter: 5,
    fenceRevision: RECOVERED_CLAIM_DIGEST,
    transitionDigest: RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: RECOVERY_RECEIPT_DIGEST,
    expiresAt: RECOVERED_EXPIRES_AT,
    recovery: authority.recovery,
  });
  let recovered = false;
  let persisted = false;

  const result = await reclaim(adapterFor({
    lane,
    status: statusResult([completedClaim]),
    recoverAuthority: () => {
      recovered = true;
      throw new Error("completed replay must not mutate cloud authority");
    },
    persistReviewProjection: () => {
      persisted = true;
      throw new Error("completed replay must not rewrite its projection");
    },
  }));

  assert.equal(result.outcome, "reclaimed-live-replay");
  assert.equal(result.successorClaimId, PREDECESSOR_CLAIM_ID);
  assert.equal(result.successorTransitionCounter, 5);
  assert.equal(result.projectionUpdated, false);
  assert.equal(result.receipts[0].receiptDigest, recoveryEvidenceDigest);
  assert.equal(result.receipts[1].kind, "projection-replay");
  assert.equal(result.receipts[1].payload.recoveryReceiptDigest, RECOVERY_RECEIPT_DIGEST);
  assert.equal(recovered, false);
  assert.equal(persisted, false);
});

test("reclaim rejects recovered authority whose recovery evidence is not the preflight receipt", async () => {
  await assert.rejects(
    reclaim(adapterFor({
      recoverAuthority: () => recoveryResult("0".repeat(64)),
    })),
    /outside the exact preserved claim/,
  );
});

test("repository replay rejects mismatched cloud recovery evidence before verification", async () => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const replayedClaim = predecessorClaim({
    state: "reviewed",
    transitionCounter: 5,
    fenceRevision: RECOVERED_CLAIM_DIGEST,
    transitionDigest: RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: RECOVERY_RECEIPT_DIGEST,
    expiresAt: RECOVERED_EXPIRES_AT,
    recovery: {
      evidenceDigest: "0".repeat(64),
      recoveredAt: RECOVERED_AT,
    },
  });
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    environment: {},
    leaseStore: { release: () => { throw new Error("unexpected local release"); } },
    createCloudAdapter: () => ({}),
  });

  await assert.rejects(
    adapter.recoverAuthority({
      request: {
        transition: "reclaim",
        ttlSeconds: 1800,
        successorDeviceId: "legacy-device",
        successorSessionId: "legacy-session",
      },
      lane: preservedLane(),
      predecessor: replayedClaim,
      status: statusResult([replayedClaim]),
      recoveryEvidenceDigest,
    }),
    /replayed cloud claim recovery evidence did not match the controller preflight receipt/,
  );
});

test("repository replay verifies a live recovery chain without another cloud mutation", async () => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const lane = laneWithRecoveryEvidence(recoveryEvidenceDigest);
  const predecessor = reviewedReplayedRecovery(recoveryEvidenceDigest, {
    transitionCounter: 6,
    fenceRevision: SECOND_RECOVERED_CLAIM_DIGEST,
    transitionDigest: SECOND_RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: SECOND_RECOVERED_AT,
    },
  });
  const fullClaim = fullSecondRecoveredClaim(recoveryEvidenceDigest);
  const actions = [];
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    environment: {},
    leaseStore: {},
    createCloudAdapter: () => ({ listClaims: async () => [fullClaim] }),
    invokeCloudAction: () => {
      throw new Error("a live reviewed replay must not repeat the recovery mutation");
    },
    invokeCloudVerifier: input => {
      actions.push("verify");
      assert.equal(input.request.expectedClaimDigest, SECOND_RECOVERED_CLAIM_DIGEST);
      return publicSecondRecoveryCloudResult("verify");
    },
  });

  const result = await adapter.recoverAuthority({
    request: {
      transition: "reclaim",
      ttlSeconds: 1800,
      successorDeviceId: "legacy-device",
      successorSessionId: "legacy-session",
    },
    lane,
    predecessor,
    status: statusWithRecoveryLineage(predecessor, recoveryEvidenceDigest),
    recoveryEvidenceDigest,
  });

  assert.deepEqual(actions, ["verify"]);
  assert.equal(result.authority.transitionCounter, 6);
  assert.equal(result.authority.claimDigest, SECOND_RECOVERED_CLAIM_DIGEST);
  assert.equal(result.recoveryReceiptDigest, SECOND_RECOVERY_RECEIPT_DIGEST);
});

test("repository reviewed replay rejects verifier and joined-owner drift", async t => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const lane = laneWithRecoveryEvidence(recoveryEvidenceDigest);
  const predecessor = reviewedReplayedRecovery(recoveryEvidenceDigest, {
    transitionCounter: 6,
    fenceRevision: SECOND_RECOVERED_CLAIM_DIGEST,
    transitionDigest: SECOND_RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: SECOND_RECOVERED_AT,
    },
  });
  const cases = [
    ["counter", ({ result }) => { result.claim.transitionCounter = 7; }],
    ["operation receipt", ({ result }) => {
      result.claim.operationReceiptDigest = "f".repeat(64);
    }],
    ["different future expiry", ({ result }) => {
      result.claim.expiresAt = "2098-08-03T09:07:22.000Z";
    }],
    ["recovery timestamp", ({ fullClaim }) => {
      fullClaim.recovery.recoveredAt = THIRD_RECOVERED_AT;
    }],
    ["result status", ({ result }) => { result.status = "reviewed"; }],
    ["receipt ledger digest", ({ result }) => { result.receipt.ledgerDigest = null; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const result = structuredClone(publicSecondRecoveryCloudResult("verify"));
      const fullClaim = structuredClone(fullSecondRecoveredClaim(recoveryEvidenceDigest));
      mutate({ result, fullClaim });
      const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
        repository: "/repo",
        sessionId: "legacy-session",
        environment: {},
        leaseStore: {},
        createCloudAdapter: () => ({ listClaims: async () => [fullClaim] }),
        invokeCloudAction: () => {
          throw new Error("reviewed replay must not mutate");
        },
        invokeCloudVerifier: () => result,
      });
      await assert.rejects(
        adapter.recoverAuthority({
          request: {
            transition: "reclaim",
            ttlSeconds: 1800,
            successorDeviceId: "legacy-device",
            successorSessionId: "legacy-session",
          },
          lane,
          predecessor,
          status: statusWithRecoveryLineage(predecessor, recoveryEvidenceDigest),
          recoveryEvidenceDigest,
        }),
        /successful verify result|changed while joining|drifted from the exact preserved reviewed claim/u,
      );
    });
  }
});

test("repository dormant recovery starts at the exact current recovery-chain counter", async () => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const lane = laneWithRecoveryEvidence(recoveryEvidenceDigest);
  const predecessor = dormantReplayedRecovery(recoveryEvidenceDigest, {
    transitionCounter: 6,
    fenceRevision: SECOND_RECOVERED_CLAIM_DIGEST,
    transitionDigest: SECOND_RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
    expiresAt: SECOND_REPLAY_EXPIRED_AT,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: SECOND_RECOVERED_AT,
    },
  });
  const fullClaim = fullThirdRecoveredClaim(recoveryEvidenceDigest);
  const actions = [];
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    environment: {},
    leaseStore: {},
    createCloudAdapter: () => ({ listClaims: async () => [fullClaim] }),
    invokeCloudAction: input => {
      actions.push("continue");
      assert.equal(input.request.expectedClaimDigest, SECOND_RECOVERED_CLAIM_DIGEST);
      assert.equal(input.request.expectedTransitionCounter, 6);
      return publicThirdRecoveryCloudResult("continue");
    },
    invokeCloudVerifier: input => {
      actions.push("verify");
      assert.equal(input.request.expectedClaimDigest, THIRD_RECOVERED_CLAIM_DIGEST);
      assert.equal(input.request.expectedLedgerRevision, THIRD_LEDGER_SHA);
      return publicThirdRecoveryCloudResult("verify");
    },
  });

  const result = await adapter.recoverAuthority({
    request: {
      transition: "reclaim",
      ttlSeconds: 1800,
      successorDeviceId: "legacy-device",
      successorSessionId: "legacy-session",
    },
    lane,
    predecessor,
    status: statusWithRecoveryLineage(predecessor, recoveryEvidenceDigest, {
      currentExpiresAt: SECOND_REPLAY_EXPIRED_AT,
    }),
    recoveryEvidenceDigest,
  });

  assert.deepEqual(actions, ["continue", "verify"]);
  assert.equal(result.authority.transitionCounter, 7);
  assert.equal(result.authority.claimDigest, THIRD_RECOVERED_CLAIM_DIGEST);
  assert.equal(result.recoveryReceiptDigest, THIRD_RECOVERY_RECEIPT_DIGEST);
});

test("repository dormant recovery rejects skipped or reused post-CAS identities", async t => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const lane = laneWithRecoveryEvidence(recoveryEvidenceDigest);
  const predecessor = dormantReplayedRecovery(recoveryEvidenceDigest, {
    transitionCounter: 6,
    fenceRevision: SECOND_RECOVERED_CLAIM_DIGEST,
    transitionDigest: SECOND_RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
    expiresAt: SECOND_REPLAY_EXPIRED_AT,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: SECOND_RECOVERED_AT,
    },
  });
  const cases = [
    ["skipped counter", result => {
      result.claim.transitionCounter = 8;
    }],
    ["reused fence", result => {
      result.claimDigest = SECOND_RECOVERED_CLAIM_DIGEST;
      result.claim.fenceRevision = SECOND_RECOVERED_CLAIM_DIGEST;
    }],
    ["reused transition", result => {
      result.claim.transitionDigest = SECOND_RECOVERED_LEDGER_DIGEST;
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const cloudResult = structuredClone(publicThirdRecoveryCloudResult("continue"));
      mutate(cloudResult);
      const fullClaim = {
        ...cloudResult.claim,
        ledgerRevision: cloudResult.claim.transitionDigest,
        deviceId: LEGACY_DEVICE_ID,
        sessionId: LEGACY_SESSION_ID,
        recovery: {
          evidenceDigest: recoveryEvidenceDigest,
          recoveredAt: THIRD_RECOVERED_AT,
        },
      };
      let verifierCalls = 0;
      const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
        repository: "/repo",
        sessionId: "legacy-session",
        environment: {},
        leaseStore: {},
        createCloudAdapter: () => ({ listClaims: async () => [fullClaim] }),
        invokeCloudAction: () => cloudResult,
        invokeCloudVerifier: () => {
          verifierCalls += 1;
          throw new Error("invalid continuation must not verify");
        },
      });
      await assert.rejects(
        adapter.recoverAuthority({
          request: {
            transition: "reclaim",
            ttlSeconds: 1800,
            successorDeviceId: "legacy-device",
            successorSessionId: "legacy-session",
          },
          lane,
          predecessor,
          status: statusWithRecoveryLineage(predecessor, recoveryEvidenceDigest, {
            currentExpiresAt: SECOND_REPLAY_EXPIRED_AT,
          }),
          recoveryEvidenceDigest,
        }),
        /drifted from the exact preserved reviewed claim/u,
      );
      assert.equal(verifierCalls, 0);
    });
  }
});

test("repository recovery-chain guard rejects missing or drifted evidence before cloud calls", async t => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const predecessor = reviewedReplayedRecovery(recoveryEvidenceDigest, {
    transitionCounter: 6,
    fenceRevision: SECOND_RECOVERED_CLAIM_DIGEST,
    transitionDigest: SECOND_RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: SECOND_RECOVERED_AT,
    },
  });
  const cases = [
    ["missing local anchor", preservedLane(), exactRecoveryLineage(recoveryEvidenceDigest)],
    [
      "drifted intervening evidence",
      laneWithRecoveryEvidence(recoveryEvidenceDigest),
      exactRecoveryLineage("0".repeat(64)),
    ],
  ];
  for (const [name, lane, recoveryLineage] of cases) {
    await t.test(name, async () => {
      let cloudCalls = 0;
      const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
        repository: "/repo",
        sessionId: "legacy-session",
        environment: {},
        leaseStore: {},
        createCloudAdapter: () => ({}),
        invokeCloudAction: () => {
          cloudCalls += 1;
          throw new Error("invalid recovery chain must not mutate");
        },
        invokeCloudVerifier: () => {
          cloudCalls += 1;
          throw new Error("invalid recovery chain must not verify");
        },
      });
      await assert.rejects(
        adapter.recoverAuthority({
          request: {
            transition: "reclaim",
            ttlSeconds: 1800,
            successorDeviceId: "legacy-device",
            successorSessionId: "legacy-session",
          },
          lane,
          predecessor,
          status: { ...statusResult([predecessor]), recoveryLineage },
          recoveryEvidenceDigest,
        }),
        /exact controller continuation lineage/,
      );
      assert.equal(cloudCalls, 0);
    });
  }
});

test("repository recovery joins omitted public fields from the exact post-CAS cloud claim", async () => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const fullClaim = fullRecoveredClaim(recoveryEvidenceDigest);
  const actions = [];
  let listCalls = 0;
  const waits = [];
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    environment: {},
    leaseStore: {},
    createCloudAdapter: () => ({
      listClaims: async request => {
        listCalls += 1;
        assert.deepEqual(request, { targetRepository: "example/repo" });
        return listCalls === 1 ? [predecessorClaim()] : [fullClaim];
      },
    }),
    waitForCloudVisibility: async milliseconds => waits.push(milliseconds),
    invokeCloudAction: input => {
      actions.push(input.action);
      return publicRecoveryCloudResult("continue");
    },
    invokeCloudVerifier: () => {
      actions.push("verify");
      return publicRecoveryCloudResult("verify");
    },
  });

  const result = await adapter.recoverAuthority({
    request: {
      transition: "reclaim",
      ttlSeconds: 1800,
      successorDeviceId: "legacy-device",
      successorSessionId: "legacy-session",
    },
    lane: preservedLane(),
    predecessor: predecessorClaim(),
    status: statusResult(),
    recoveryEvidenceDigest,
  });

  assert.deepEqual(actions, ["continue", "verify"]);
  assert.equal(listCalls, 3);
  assert.deepEqual(waits, [250]);
  assert.deepEqual(result.authority.recovery, fullClaim.recovery);
  assert.equal(result.authority.deviceId, "legacy-device");
  assert.equal(result.authority.sessionId, "legacy-session");
  assert.equal(result.authority.ledgerDigest, RECOVERED_LEDGER_DIGEST);
});

test("repository recovery visibility retries are bounded and fail closed on current drift", async t => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const cases = [
    ["permanently stale", () => [predecessorClaim()], 5, [250, 500, 1_000, 2_000]],
    ["temporarily absent", () => [], 5, [250, 500, 1_000, 2_000]],
    ["newer conflicting claim", () => [fullSecondRecoveredClaim(recoveryEvidenceDigest)], 1, []],
    ["same-counter conflicting claim", () => [{
      ...fullRecoveredClaim(recoveryEvidenceDigest),
      fenceRevision: "f".repeat(64),
    }], 1, []],
    ["duplicate stale claim", () => [predecessorClaim(), predecessorClaim()], 1, []],
    ["malformed stale counter", () => [{
      ...predecessorClaim(),
      transitionCounter: null,
    }], 1, []],
  ];
  for (const [name, claims, expectedReads, expectedWaits] of cases) {
    await t.test(name, async () => {
      let actionCalls = 0;
      let verifierCalls = 0;
      let listCalls = 0;
      const waits = [];
      const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
        repository: "/repo",
        sessionId: "legacy-session",
        environment: {},
        leaseStore: {},
        createCloudAdapter: () => ({
          listClaims: async () => {
            listCalls += 1;
            return claims();
          },
        }),
        waitForCloudVisibility: async milliseconds => waits.push(milliseconds),
        invokeCloudAction: () => {
          actionCalls += 1;
          return publicRecoveryCloudResult("continue");
        },
        invokeCloudVerifier: () => {
          verifierCalls += 1;
          return publicRecoveryCloudResult("verify");
        },
      });
      await assert.rejects(
        adapter.recoverAuthority({
          request: {
            transition: "reclaim",
            ttlSeconds: 1800,
            successorDeviceId: "legacy-device",
            successorSessionId: "legacy-session",
          },
          lane: preservedLane(),
          predecessor: predecessorClaim(),
          status: statusResult(),
          recoveryEvidenceDigest,
        }),
        /changed while joining/,
      );
      assert.equal(actionCalls, 1);
      assert.equal(verifierCalls, 0);
      assert.equal(listCalls, expectedReads);
      assert.deepEqual(waits, expectedWaits);
    });
  }
});

test("repository recovery retries verifier visibility without repeating either mutation", async () => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const fullClaim = fullRecoveredClaim(recoveryEvidenceDigest);
  const visibleClaims = [
    [fullClaim],
    [predecessorClaim()],
    [fullClaim],
  ];
  const actions = [];
  const waits = [];
  let listCalls = 0;
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    environment: {},
    leaseStore: {},
    createCloudAdapter: () => ({
      listClaims: async () => visibleClaims[listCalls++],
    }),
    waitForCloudVisibility: async milliseconds => waits.push(milliseconds),
    invokeCloudAction: () => {
      actions.push("continue");
      return publicRecoveryCloudResult("continue");
    },
    invokeCloudVerifier: () => {
      actions.push("verify");
      return publicRecoveryCloudResult("verify");
    },
  });

  const result = await adapter.recoverAuthority({
    request: {
      transition: "reclaim",
      ttlSeconds: 1800,
      successorDeviceId: "legacy-device",
      successorSessionId: "legacy-session",
    },
    lane: preservedLane(),
    predecessor: predecessorClaim(),
    status: statusResult(),
    recoveryEvidenceDigest,
  });

  assert.deepEqual(actions, ["continue", "verify"]);
  assert.equal(listCalls, 3);
  assert.deepEqual(waits, [250]);
  assert.equal(result.authority.claimDigest, RECOVERED_CLAIM_DIGEST);
});

test("repository recovery advances an expired unprojected replay from its immediate predecessor", async () => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const lane = laneWithRecoveryEvidence(recoveryEvidenceDigest);
  const predecessor = dormantReplayedRecovery(recoveryEvidenceDigest);
  const fullClaim = fullSecondRecoveredClaim(recoveryEvidenceDigest);
  const actions = [];
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    environment: {},
    leaseStore: {},
    createCloudAdapter: () => ({
      listClaims: async request => {
        assert.deepEqual(request, { targetRepository: "example/repo" });
        return [fullClaim];
      },
    }),
    invokeCloudAction: input => {
      actions.push(input.action);
      assert.equal(input.request.expectedClaimDigest, RECOVERED_CLAIM_DIGEST);
      assert.equal(input.request.expectedTransitionCounter, 5);
      assert.equal(input.request.expectedLedgerDigest, STATUS_LEDGER_DIGEST);
      assert.equal(input.request.recoveryEvidenceDigest, recoveryEvidenceDigest);
      assert.match(input.request.idempotencyKey, new RegExp(RECOVERED_CLAIM_DIGEST, "u"));
      return publicSecondRecoveryCloudResult("continue");
    },
    invokeCloudVerifier: input => {
      actions.push("verify");
      assert.equal(input.request.expectedClaimDigest, SECOND_RECOVERED_CLAIM_DIGEST);
      return publicSecondRecoveryCloudResult("verify");
    },
  });

  const result = await adapter.recoverAuthority({
    request: {
      transition: "reclaim",
      ttlSeconds: 1800,
      successorDeviceId: "legacy-device",
      successorSessionId: "legacy-session",
    },
    lane,
    predecessor,
    status: statusResult([predecessor]),
    recoveryEvidenceDigest,
  });

  assert.deepEqual(actions, ["continue", "verify"]);
  assert.equal(result.authority.transitionCounter, 6);
  assert.equal(result.authority.claimDigest, SECOND_RECOVERED_CLAIM_DIGEST);
  assert.equal(result.authority.claimLedgerRevision, SECOND_RECOVERED_LEDGER_DIGEST);
  assert.equal(result.recoveryReceiptDigest, SECOND_RECOVERY_RECEIPT_DIGEST);
});

test("repository status joins exact recovery evidence from the owner-enriched cloud claim", async () => {
  const recovery = {
    evidenceDigest: expectedRecoveryEvidenceDigest(),
    recoveredAt: RECOVERED_AT,
  };
  const projectedClaim = predecessorClaim({
    state: "reviewed",
    transitionCounter: 5,
    fenceRevision: RECOVERED_CLAIM_DIGEST,
    transitionDigest: RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: RECOVERY_RECEIPT_DIGEST,
    expiresAt: RECOVERED_EXPIRES_AT,
  });
  delete projectedClaim.deviceId;
  delete projectedClaim.sessionId;
  const status = statusResult([projectedClaim]);
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    leaseStore: {},
    createCloudAdapter: ({ ledgerRepository }) => {
      assert.equal(ledgerRepository, "example/ledger");
      return {
        execute: async (action, request) => {
          assert.equal(action, "status");
          assert.deepEqual(request, { targetRepository: "example/repo" });
          return status;
        },
        listClaims: async request => {
          assert.deepEqual(request, { targetRepository: "example/repo" });
          return [{
            ...projectedClaim,
            ledgerRevision: RECOVERED_LEDGER_DIGEST,
            deviceId: LEGACY_DEVICE_ID,
            sessionId: LEGACY_SESSION_ID,
            recovery,
          }];
        },
      };
    },
  });

  const enriched = await adapter.readCloudStatus({
    ledgerRepository: "example/ledger",
    targetRepository: "example/repo",
  });

  assert.deepEqual(enriched.claims[0].recovery, recovery);
  assert.equal(enriched.claims[0].deviceId, LEGACY_DEVICE_ID);
  assert.equal(enriched.claims[0].sessionId, LEGACY_SESSION_ID);
});

test("repository status reads and validates an exact committed recovery lineage only for N+k", async () => {
  const { ledger, anchor, current } = validatedReaderLedger();
  const projectedClaim = {
    ...current,
    transitionDigest: current.ledgerRevision,
  };
  const status = {
    ...statusResult([projectedClaim]),
    ledgerRevision: READER_LEDGER_SHA,
    ledgerDigest: ledger.headDigest,
  };
  const ghCalls = [];
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    leaseStore: {},
    ghText: args => {
      ghCalls.push(args);
      return JSON.stringify(ledger);
    },
    createCloudAdapter: () => ({
      execute: async () => status,
      listClaims: async () => [current],
    }),
  });

  const enriched = await adapter.readCloudStatus({
    ledgerRepository: "example/ledger",
    targetRepository: "example/repo",
    recoveryAnchor: {
      claimId: anchor.claimId,
      claimDigest: anchor.fenceRevision,
      claimLedgerRevision: anchor.ledgerRevision,
      transitionCounter: anchor.transitionCounter,
    },
  });

  assert.equal(enriched.recoveryLineage.length, 3);
  assert.equal(enriched.recoveryLineage[0].claimDigest, anchor.fenceRevision);
  assert.equal(enriched.recoveryLineage.at(-1).claimDigest, current.fenceRevision);
  assert.equal(ghCalls.length, 1);
  assert.deepEqual(ghCalls[0].slice(0, 1), ["api"]);
  assert.match(ghCalls[0][1], /repos\/example\/ledger\/contents\/.+\?ref=e{40}$/u);
  assert.deepEqual(ghCalls[0].slice(2), [
    "-H",
    "Accept: application/vnd.github.raw+json",
  ]);

  const adjacent = await adapter.readCloudStatus({
    ledgerRepository: "example/ledger",
    targetRepository: "example/repo",
    recoveryAnchor: {
      claimId: anchor.claimId,
      claimDigest: ledger.entries.at(-2).claimDigest,
      claimLedgerRevision: ledger.entries.at(-2).digest,
      transitionCounter: current.transitionCounter - 1,
    },
  });
  assert.equal("recoveryLineage" in adjacent, false);
  assert.equal(ghCalls.length, 1);
});

test("repository status fails closed on malformed or non-exact recovery ledgers", async t => {
  const { ledger, anchor, current } = validatedReaderLedger();
  const projectedClaim = {
    ...current,
    transitionDigest: current.ledgerRevision,
  };
  const invalidLedger = structuredClone(ledger);
  invalidLedger.sequence += 1;
  const cases = [
    ["malformed JSON", "{", ledger.headDigest, /Could not read exact cloud recovery lineage/u],
    ["invalid ledger", JSON.stringify(invalidLedger), ledger.headDigest, /did not match the validated status ledger/u],
    ["head digest mismatch", JSON.stringify(ledger), "0".repeat(64), /did not match the validated status ledger/u],
  ];
  for (const [name, bytes, statusLedgerDigest, expected] of cases) {
    await t.test(name, async () => {
      const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
        repository: "/repo",
        sessionId: "legacy-session",
        leaseStore: {},
        ghText: () => bytes,
        createCloudAdapter: () => ({
          execute: async () => ({
            ...statusResult([projectedClaim]),
            ledgerRevision: READER_LEDGER_SHA,
            ledgerDigest: statusLedgerDigest,
          }),
          listClaims: async () => [current],
        }),
      });
      await assert.rejects(
        adapter.readCloudStatus({
          ledgerRepository: "example/ledger",
          targetRepository: "example/repo",
          recoveryAnchor: {
            claimId: anchor.claimId,
            claimDigest: anchor.fenceRevision,
            claimLedgerRevision: anchor.ledgerRevision,
            transitionCounter: anchor.transitionCounter,
          },
        }),
        expected,
      );
    });
  }
});

test("projection rejects a stale no-op pull-request marker before local lease release", () => {
  const sourceLease = admittedWriterLease();
  const staleBody = updateWriterLeasePullRequestBody("", sourceLease);
  const lane = preservedLane({
    lease: sourceLease,
    authority: sourceLease.cloudAuthority,
    remoteLease: sourceLease,
    pullRequest: {
      ...preservedLane().pullRequest,
      body: staleBody,
    },
  });
  const authority = recoveryResult(expectedRecoveryEvidenceDigest()).authority;
  let edited = false;
  let released = false;
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    environment: {},
    now: () => new Date(PROJECTION_TIMESTAMP),
    leaseStore: {
      release: () => {
        released = true;
        return sourceLease;
      },
    },
    run: (command, args) => {
      assert.equal(command, "gh");
      assert.deepEqual(args.slice(0, 3), ["pr", "edit", lane.pullRequest.url]);
      edited = true;
    },
    ghText: () => JSON.stringify({
      url: lane.pullRequest.url,
      state: "OPEN",
      isDraft: false,
      headRefName: lane.branch,
      headRefOid: REVIEW_SHA,
      headRepository: { nameWithOwner: "example/repo" },
      baseRefName: "main",
      body: staleBody,
    }),
  });

  assert.throws(
    () => adapter.persistReviewProjection({ lane, authority }),
    /Updated pull request body did not preserve the exact review-ready projection/,
  );
  assert.equal(edited, true);
  assert.equal(released, false);
});

test("projection refuses a concurrently changed pull-request marker before remote write", () => {
  const sourceLease = admittedWriterLease();
  const concurrentLease = {
    ...sourceLease,
    heartbeatAt: "2026-08-03T08:37:23.000Z",
  };
  const concurrentBody = updateWriterLeasePullRequestBody("", concurrentLease);
  const lane = preservedLane({
    lease: sourceLease,
    authority: sourceLease.cloudAuthority,
    remoteLease: sourceLease,
    pullRequest: {
      ...preservedLane().pullRequest,
      body: updateWriterLeasePullRequestBody("", sourceLease),
    },
  });
  let edited = false;
  let released = false;
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    environment: {},
    now: () => new Date(PROJECTION_TIMESTAMP),
    leaseStore: {
      release: () => {
        released = true;
        return sourceLease;
      },
    },
    run: () => { edited = true; },
    ghText: () => JSON.stringify({
      url: lane.pullRequest.url,
      state: "OPEN",
      isDraft: false,
      headRefName: lane.branch,
      headRefOid: REVIEW_SHA,
      headRepository: { nameWithOwner: "example/repo" },
      baseRefName: "main",
      body: concurrentBody,
    }),
  });

  assert.throws(
    () => adapter.persistReviewProjection({
      lane,
      authority: recoveryResult(expectedRecoveryEvidenceDigest()).authority,
    }),
    /owner marker changed after recovery preflight/u,
  );
  assert.equal(edited, false);
  assert.equal(released, false);
});

test("retain validates the exact dormant predecessor without cloud mutation", async () => {
  let mutated = false;
  const result = await reclaim(adapterFor({
    recoverAuthority: () => {
      mutated = true;
      return recoveryResult(expectedRecoveryEvidenceDigest());
    },
  }), { transition: "retain" });

  assert.equal(result.outcome, "retained-legacy");
  assert.equal(result.receipts.length, 1);
  assert.equal(mutated, false);
});

test("retain cannot report a recovered live reviewed claim as dormant legacy", async () => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const replayedClaim = fullRecoveredClaim(recoveryEvidenceDigest);
  const result = await reclaim(adapterFor({
    status: statusResult([replayedClaim]),
    recoverAuthority: () => {
      throw new Error("retain must not recover authority");
    },
  }), { transition: "retain" });

  assert.equal(result.outcome, "blocked");
  assert.ok(result.blockingFindings.some(finding => finding.type === "preserved-claim-drift"));
});

test("reclaim accepts an exact protected-main refresh while preserving reviewed identity", async () => {
  const lane = preservedLane({
    refreshedHeadSha: REFRESHED_SHA,
    remoteHeadSha: REFRESHED_SHA,
    protectedMainRefresh: {
      schema: "agentic-protected-main-refresh/v1",
      deliveredHeadSha: REVIEW_SHA,
      refreshedHeadSha: REFRESHED_SHA,
      mainParentSha: "f".repeat(40),
    },
    pullRequest: {
      ...preservedLane().pullRequest,
      headRefOid: REFRESHED_SHA,
    },
  });
  let observedReviewedHead = null;
  const result = await reclaim(adapterFor({
    lane,
    recoverAuthority: ({ lane: recoveredLane, recoveryEvidenceDigest }) => {
      observedReviewedHead = recoveredLane.headSha;
      return recoveryResult(recoveryEvidenceDigest);
    },
  }));

  assert.equal(result.outcome, "reclaimed-live");
  assert.equal(observedReviewedHead, REVIEW_SHA);
  assert.equal(result.reviewedHeadSha, REVIEW_SHA);
});

test("handoff recovers the same claim for a distinct owner without rewriting local projection", async () => {
  let persisted = false;
  const adapter = adapterFor({
    recoverAuthority: ({ recoveryEvidenceDigest }) => recoveryResult(
      recoveryEvidenceDigest,
      recoveredAuthority({
        deviceId: "new-device",
        sessionId: "new-session",
      }),
    ),
    persistReviewProjection: () => {
      persisted = true;
      return { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
  });
  const result = await reclaim(adapter, {
    transition: "handoff",
    successorSessionId: "new-session",
    successorDeviceId: "new-device",
  });

  assert.equal(result.outcome, "handed-off-live");
  assert.equal(result.successorClaimId, PREDECESSOR_CLAIM_ID);
  assert.equal(result.successorLeaseEpoch, 1);
  assert.equal(result.projectionUpdated, false);
  assert.equal(persisted, false);
});

test("handoff replays one live unprojected recovery without repeating projection", async () => {
  const successorDeviceId = "new-device";
  const successorSessionId = "new-session";
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest({
    transition: "handoff",
    successorDeviceId,
    successorSessionId,
  });
  const predecessor = reviewedReplayedRecovery(recoveryEvidenceDigest, {
    deviceId: ownerIdentifierForTest("device", successorDeviceId),
    sessionId: ownerIdentifierForTest("session", successorSessionId),
  });
  let verified = 0;
  let persisted = false;
  const result = await reclaim(adapterFor({
    status: statusResult([predecessor]),
    recoverAuthority: ({ predecessor: observed }) => {
      verified += 1;
      assert.equal(observed.transitionCounter, 5);
      return recoveryResult(
        recoveryEvidenceDigest,
        recoveredAuthority({
          deviceId: successorDeviceId,
          sessionId: successorSessionId,
        }),
      );
    },
    persistReviewProjection: () => {
      persisted = true;
      throw new Error("handoff replay must not project locally");
    },
  }), {
    transition: "handoff",
    successorDeviceId,
    successorSessionId,
  });

  assert.equal(result.outcome, "handed-off-live");
  assert.equal(verified, 1);
  assert.equal(persisted, false);
});

test("handoff fails closed after its unprojected recovery expires or advances again", async t => {
  const successorDeviceId = "new-device";
  const successorSessionId = "new-session";
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest({
    transition: "handoff",
    successorDeviceId,
    successorSessionId,
  });
  const expired = dormantReplayedRecovery(recoveryEvidenceDigest, {
    deviceId: ownerIdentifierForTest("device", successorDeviceId),
    sessionId: ownerIdentifierForTest("session", successorSessionId),
  });
  const advanced = reviewedReplayedRecovery(recoveryEvidenceDigest, {
    transitionCounter: 6,
    fenceRevision: SECOND_RECOVERED_CLAIM_DIGEST,
    transitionDigest: SECOND_RECOVERED_LEDGER_DIGEST,
    operationReceiptDigest: SECOND_RECOVERY_RECEIPT_DIGEST,
    deviceId: ownerIdentifierForTest("device", successorDeviceId),
    sessionId: ownerIdentifierForTest("session", successorSessionId),
    recovery: {
      evidenceDigest: recoveryEvidenceDigest,
      recoveredAt: SECOND_RECOVERED_AT,
    },
  });
  const recoveryLineage = exactRecoveryLineage(recoveryEvidenceDigest);
  for (const entry of recoveryLineage.slice(1)) {
    entry.claimCore.deviceId = ownerIdentifierForTest("device", successorDeviceId);
    entry.claimCore.sessionId = ownerIdentifierForTest("session", successorSessionId);
  }
  const cases = [
    ["expired", statusResult([expired])],
    ["advanced", { ...statusResult([advanced]), recoveryLineage }],
  ];
  for (const [name, status] of cases) {
    await t.test(name, async () => {
      let recovered = false;
      const result = await reclaim(adapterFor({
        status,
        recoverAuthority: () => {
          recovered = true;
          throw new Error("unprojected handoff without a local recovery anchor must block");
        },
      }), {
        transition: "handoff",
        successorDeviceId,
        successorSessionId,
      });
      assert.equal(result.outcome, "blocked");
      assert.equal(
        result.blockingFindings.some(finding => (
          finding.type === "unprojected-recovery-evidence-drift"
        )),
        true,
      );
      assert.equal(recovered, false);
    });
  }
});

test("exact-head drift blocks before recovery", async () => {
  let mutated = false;
  const result = await reclaim(adapterFor({
    lane: preservedLane({ remoteHeadSha: "9".repeat(40) }),
    recoverAuthority: () => {
      mutated = true;
      return recoveryResult(expectedRecoveryEvidenceDigest());
    },
  }));

  assert.equal(result.outcome, "blocked");
  assert.equal(result.blockingFindings.some(item => item.type === "exact-head-drift"), true);
  assert.equal(mutated, false);
});

test("a different overlapping live claim blocks recovery", async () => {
  const result = await reclaim(adapterFor({
    status: statusResult([
      predecessorClaim(),
      {
        claimId: "a".repeat(64),
        declaredWriteScope: ["path:scripts/legacy-authority-evaluator.mjs"],
        reviewRequestId: "github-pull-request:PR_other",
      },
    ]),
  }));

  assert.equal(result.outcome, "blocked");
  assert.equal(result.blockingFindings.some(item => item.type === "competing-live-claim"), true);
});

test("the exact predecessor review identity is allowed but another matching review identity blocks", async () => {
  const allowed = await reclaim(adapterFor());
  assert.equal(allowed.outcome, "reclaimed-live");

  const blocked = await reclaim(adapterFor({
    status: statusResult([
      predecessorClaim(),
      {
        claimId: "a".repeat(64),
        declaredWriteScope: ["semantic:disjoint"],
        reviewRequestId: REVIEW_REQUEST_ID,
      },
    ]),
  }));
  assert.equal(blocked.outcome, "blocked");
  assert.equal(blocked.blockingFindings.some(item => item.type === "review-request-already-live"), true);
});

test("missing, duplicate, live, or drifted predecessor evidence blocks without recovery", async t => {
  const cases = [
    ["missing", [], "preserved-claim-not-unique"],
    ["duplicate", [predecessorClaim(), predecessorClaim()], "preserved-claim-not-unique"],
    ["live", [predecessorClaim({ state: "current", writeAuthority: true })], "preserved-claim-drift"],
    ["fence drift", [predecessorClaim({ fenceRevision: "0".repeat(64) })], "preserved-claim-drift"],
  ];
  for (const [name, claims, expectedFinding] of cases) {
    await t.test(name, async () => {
      let mutated = false;
      const result = await reclaim(adapterFor({
        status: statusResult(claims),
        recoverAuthority: ({ recoveryEvidenceDigest }) => {
          mutated = true;
          return recoveryResult(recoveryEvidenceDigest);
        },
      }));
      assert.equal(result.outcome, "blocked");
      assert.equal(result.blockingFindings.some(item => item.type === expectedFinding), true);
      assert.equal(mutated, false);
    });
  }
});

test("recovery cannot replace the preserved claim or advance its lease epoch", async () => {
  for (const authority of [
    recoveredAuthority({ claimId: "a".repeat(64) }),
    recoveredAuthority({ leaseEpoch: 2 }),
  ]) {
    await assert.rejects(
      reclaim(adapterFor({
        recoverAuthority: ({ recoveryEvidenceDigest }) => recoveryResult(
          recoveryEvidenceDigest,
          authority,
        ),
      })),
      /outside the exact preserved claim/,
    );
  }
});

test("owner mismatch blocks recovery", async () => {
  const result = await reclaim(adapterFor({
    actor: { id: 1, login: "someone-else" },
  }));

  assert.equal(result.outcome, "blocked");
  assert.equal(result.blockingFindings.some(item => item.type === "authenticated-owner-mismatch"), true);
});
