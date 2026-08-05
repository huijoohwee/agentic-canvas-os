import test from "node:test";
import assert from "node:assert/strict";

import {
  CLOUD_AUTHORITY_HANDOFF_RECEIPT_SCHEMA,
  CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA,
  continueExpiredReviewLaneAuthority,
  createCloudAuthorityHandoffControllerAdapter,
  createRepositoryCloudAuthorityHandoffControllerAdapter,
} from "../scripts/cloud-authority-handoff-controller.mjs";
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
const REVIEW_REQUEST_ID = "github-pull-request:PR_238";
const LEGACY_DEVICE_ID = `device:${digestValue({ namespace: "device", value: "legacy-device" })}`;
const LEGACY_SESSION_ID = `session:${digestValue({ namespace: "session", value: "legacy-session" })}`;
const EXPIRED_AT = "2026-08-03T07:37:22.000Z";
const LOCAL_RECOVERED_AT = "2026-08-03T07:07:22.000Z";
const RECOVERED_AT = "2026-08-03T08:37:22.000Z";
const REPLAY_EXPIRED_AT = "2026-08-03T09:07:22.000Z";
const SECOND_RECOVERED_AT = "2026-08-03T09:07:22.000Z";
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

function recoveredAuthority(overrides = {}) {
  return {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "example/ledger",
    targetRepository: "example/repo",
    claimId: PREDECESSOR_CLAIM_ID,
    claimDigest: RECOVERED_CLAIM_DIGEST,
    ledgerRevision: BASE_SHA,
    claimLedgerRevision: RECOVERED_LEDGER_DIGEST,
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
    recoveryReceiptDigest: RECOVERY_RECEIPT_DIGEST,
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
    status: "reviewed",
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
    status: "reviewed",
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
      "skipped transition counter",
      dormantReplayedRecovery(recoveryEvidenceDigest, { transitionCounter: 6 }),
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

test("repository recovery joins omitted public fields from the exact post-CAS cloud claim", async () => {
  const recoveryEvidenceDigest = expectedRecoveryEvidenceDigest();
  const fullClaim = fullRecoveredClaim(recoveryEvidenceDigest);
  const actions = [];
  let listCalls = 0;
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    environment: {},
    leaseStore: {},
    createCloudAdapter: () => ({
      listClaims: async request => {
        listCalls += 1;
        assert.deepEqual(request, { targetRepository: "example/repo" });
        return [fullClaim];
      },
    }),
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
  assert.equal(listCalls, 2);
  assert.deepEqual(result.authority.recovery, fullClaim.recovery);
  assert.equal(result.authority.deviceId, "legacy-device");
  assert.equal(result.authority.sessionId, "legacy-session");
  assert.equal(result.authority.ledgerDigest, RECOVERED_LEDGER_DIGEST);
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
