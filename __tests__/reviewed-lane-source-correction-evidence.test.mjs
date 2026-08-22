// Responsibility: Prove exact delivery-authorized failed-CI source admission.
import assert from "node:assert/strict";
import test from "node:test";

import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  buildReviewedLaneSourceCorrectionEvidence,
  normalizeReviewedLaneSourceCorrectionEvidence,
} from "../scripts/reviewed-lane-source-correction-evidence.mjs";

const hex = (character, length) => character.repeat(length);

function deliveryFixture({
  authorityState = "delivery_authorized",
  claimState = "integrated-preserved",
  claimTransitionOffset = 0,
} = {}) {
  const branch = "agent/huis-macbook-pro-3.local/source-owner";
  const headSha = hex("a", 40);
  const baseSha = hex("b", 40);
  const declaredWriteSet = normalizeWriteSet([
    "path:scripts/source.mjs",
    "semantic:source-owner",
  ]);
  const writeSetDigest = digestValue(declaredWriteSet);
  const integration = {
    candidateRevision: headSha,
    reviewRequestId: "github-pull-request:PR_node",
    focusedEvidenceDigest: hex("6", 64),
    dependencyClosureDigest: hex("1", 64),
    namedChecksDigest: hex("2", 64),
    handoffEvidenceDigest: hex("3", 64),
    operatorDecisionDigest: hex("4", 64),
    integrationIntentDigest: hex("5", 64),
    integratedAt: "2026-08-22T06:00:00.000Z",
  };
  const authority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "huijoohwee/agentic-canvas-os",
    targetRepository: "huijoohwee/agentic-canvas-os",
    claimId: hex("1", 64),
    claimDigest: hex("2", 64),
    ledgerRevision: hex("c", 40),
    ledgerDigest: hex("3", 64),
    claimLedgerRevision: hex("4", 64),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: hex("f", 64),
    mutationAuthorityEligible: true,
    canonicalBaseSha: baseSha,
    laneRevision: headSha,
    cloudDeclaredWriteScope: declaredWriteSet,
    writeSetDigest,
    deviceId: "huis-macbook-pro-3.local",
    sessionId: "source-session",
    reviewRequestId: integration.reviewRequestId,
    leaseEpoch: 7,
    transitionCounter: 11,
    state: authorityState,
    expiresAt: "2026-08-22T08:00:00.000Z",
    integrationReceiptDigest: hex("f", 64),
    integration,
    focusedEvidenceDigest: integration.focusedEvidenceDigest,
    manifestDigest: hex("7", 64),
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "delivery",
    epoch: 41,
    sessionId: authority.sessionId,
    device: authority.deviceId,
    scope: "source-owner",
    branch,
    worktreePath: "/private/source-owner",
    baseSha,
    fenceSha: hex("9", 40),
    pullRequestUrl: "https://github.com/huijoohwee/agentic-canvas-os/pull/344",
    autoDelivery: true,
    runtimeRequired: true,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: "source-owner",
      declaredWriteSet,
      writeSetDigest,
      manifestDigest: authority.manifestDigest,
      planReceiptDigest: hex("8", 64),
      admissionReceiptDigest: hex("9", 64),
      existingLaneStateDigest: hex("a", 64),
      admittedReportDigest: hex("b", 64),
      preservationReceiptDigest: hex("c", 64),
    },
    cloudAuthority: authority,
    acquiredAt: "2026-08-22T05:00:00.000Z",
    heartbeatAt: "2026-08-22T06:00:00.000Z",
    expiresAt: "2026-08-22T06:30:00.000Z",
    reviewHeadSha: null,
    deliveryHeadSha: headSha,
  };
  const claim = {
    claimId: authority.claimId,
    state: claimState,
    recordedState: "integrated-preserved",
    writeAuthority: false,
    scopeReserved: true,
    actorId: "github-user:8945812",
    repositoryId: "github-repository:R_repo",
    workItemId: `work-item:${hex("d", 64)}`,
    canonicalBaseRevision: baseSha,
    laneRevision: headSha,
    declaredWriteScope: declaredWriteSet,
    writeSetDigest,
    leaseEpoch: authority.leaseEpoch,
    transitionCounter: authority.transitionCounter + claimTransitionOffset,
    reviewRequestId: authority.reviewRequestId,
    fenceRevision: authority.claimDigest,
    transitionDigest: authority.claimLedgerRevision,
    operationReceiptDigest: authority.operationReceiptDigest,
    integrationReceiptDigest: authority.integrationReceiptDigest,
    integration,
    recovery: null,
    deviceId: pseudonymousIdentifier("device", lease.device),
    sessionId: pseudonymousIdentifier("session", lease.sessionId),
  };
  const advance = {
    schema: "agentic-reviewed-lane-protected-advance/v2",
    sourceBaseSha: baseSha,
    pullRequestBaseSha: baseSha,
    currentBaseSha: baseSha,
    changedWriteScope: [],
    changedWriteScopeDigest: digestValue([]),
    disposition: "unchanged",
  };
  return {
    repository: { fullName: authority.targetRepository, nodeId: "R_repo" },
    actor: { id: "8945812", login: "huijoohwee" },
    lease,
    authority,
    claim,
    pullRequest: {
      number: 344,
      nodeId: "PR_node",
      url: lease.pullRequestUrl,
      state: "OPEN",
      isDraft: false,
      headBranch: branch,
      headSha,
      baseBranch: "main",
      baseSha,
      headRepository: authority.targetRepository,
      baseRepository: authority.targetRepository,
      authorLogin: "huijoohwee",
      bodyDigest: hex("e", 64),
      writerMarker: lease,
      autoMergeRequest: null,
      mergeQueueEntry: null,
    },
    localHeadSha: headSha,
    remoteHeadSha: headSha,
    clean: true,
    protectedAdvance: { ...advance, receiptDigest: digestValue(advance) },
  };
}

test("delivery-authorized integrated source is admitted by exact parity", () => {
  const evidence = buildReviewedLaneSourceCorrectionEvidence(deliveryFixture());
  assert.equal(evidence.lease.status, "delivery");
  assert.equal(evidence.lease.reviewHeadSha, evidence.localHeadSha);
  assert.equal(evidence.authority.state, "delivery_authorized");
  assert.equal(evidence.claim.state, "integrated-preserved");
});

test("delivery-authorized source rejects claim transition drift", () => {
  assert.throws(
    () => buildReviewedLaneSourceCorrectionEvidence(
      deliveryFixture({ claimTransitionOffset: 1 }),
    ),
    /reviewed lane identity join is invalid/u,
  );
});

test("expired delivery source accepts the exact dormant projection without a ledger transition", () => {
  const evidence = buildReviewedLaneSourceCorrectionEvidence(deliveryFixture({
    authorityState: "parked",
    claimState: "dormant-preserved",
  }));
  assert.equal(evidence.authority.state, "parked");
  assert.equal(evidence.claim.recordedState, "integrated-preserved");
  assert.equal(evidence.claim.state, "dormant-preserved");
  assert.equal(evidence.claim.transitionCounter, evidence.authority.transitionCounter);
});

test("normalized expired delivery evidence is an idempotent public plan input", () => {
  const evidence = buildReviewedLaneSourceCorrectionEvidence(deliveryFixture({
    authorityState: "parked",
    claimState: "dormant-preserved",
  }));
  assert.deepEqual(normalizeReviewedLaneSourceCorrectionEvidence(evidence), evidence);
});

test("expired delivery source rejects a dormant projection with transition drift", () => {
  assert.throws(
    () => buildReviewedLaneSourceCorrectionEvidence(deliveryFixture({
      authorityState: "parked",
      claimState: "dormant-preserved",
      claimTransitionOffset: 1,
    })),
    /reviewed lane identity join is invalid/u,
  );
});
