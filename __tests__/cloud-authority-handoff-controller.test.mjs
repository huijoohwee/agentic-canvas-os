import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildCloudAuthoritySuccessorClaimRequest,
  CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA,
  continueExpiredReviewLaneAuthority,
  createCloudAuthorityHandoffControllerAdapter,
  createRepositoryCloudAuthorityHandoffControllerAdapter,
} from "../scripts/cloud-authority-handoff-controller.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  CURRENT_CLAIM_INVENTORY_SCHEMA,
  pseudonymousIdentifier,
} from "../scripts/github-cloud-collaboration-mapping.mjs";
import { recoverIntegratedPreservedCloudAuthority }
  from "../scripts/scoped-lane-cloud-authority.mjs";
import { createTaskAuthorityLeaseBinding, writeTaskAuthorityCapability }
  from "../scripts/task-bound-lane-authority-store.mjs";
import { renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const BASE_SHA = "a".repeat(40);
const REVIEW_SHA = "b".repeat(40);
const REFRESHED_SHA = "0".repeat(40);
const REFRESH_MAIN_PARENT_SHA = "f".repeat(40);
const PREDECESSOR_CLAIM_ID = "c".repeat(64);
const PREDECESSOR_CLAIM_DIGEST = "d".repeat(64);
const PREDECESSOR_LEDGER_DIGEST = "e".repeat(64);
const PREDECESSOR_FOCUSED_EVIDENCE = "1".repeat(64);
const SUCCESSOR_CLAIM_ID = "1".repeat(64);
const SUCCESSOR_CLAIM_DIGEST = "2".repeat(64);
const SUCCESSOR_LEDGER_DIGEST = "3".repeat(64);
const MANIFEST_DIGEST = "4".repeat(64);
const WRITE_SET_DIGEST = "5".repeat(64);
const ADMITTED_REPORT_DIGEST = "6".repeat(64);
const CLAIM_RECEIPT_DIGEST = "7".repeat(64);
const REVIEW_RECEIPT_DIGEST = "8".repeat(64);
const PROJECTION_RECEIPT_DIGEST = "9".repeat(64);
const INTEGRATION_RECEIPT_DIGEST = "a".repeat(64);
const RECOVERY_RECEIPT_DIGEST = "b".repeat(64);
const PREDECESSOR_OPERATION_RECEIPT_DIGEST = "0".repeat(64);
const SCOPE_WORK_ITEM_ID = pseudonymousIdentifier("work-item", "legacy-authority-evaluator");
const CLAIM_ONLY_WORK_ITEM_ID = pseudonymousIdentifier(
  "work-item",
  "successful-release-recapture-policy",
);
const CLAIM_ONLY_CLAIM_ID = "6".repeat(64);
const CLOUD_DEVICE_ID = pseudonymousIdentifier("device", "legacy-device");
const CLOUD_SESSION_ID = pseudonymousIdentifier("session", "legacy-session");
const CLAIM_ONLY_SCOPE = Object.freeze([
  "path:docs/CANONICAL-LIFECYCLE.md",
  "semantic:successful-release-recapture-policy",
]);

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
      declaredWriteSet: [
        "path:docs/CANONICAL-LIFECYCLE.md",
        "path:scripts/legacy-authority-evaluator.mjs",
        "semantic:legacy-authority-evaluator",
      ],
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
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      operationReceiptDigest: PREDECESSOR_OPERATION_RECEIPT_DIGEST,
      canonicalBaseSha: BASE_SHA,
      laneRevision: REVIEW_SHA,
      cloudDeclaredWriteScope: [
        "path:docs/CANONICAL-LIFECYCLE.md",
        "path:scripts/legacy-authority-evaluator.mjs",
        "semantic:legacy-authority-evaluator",
      ],
      writeSetDigest: WRITE_SET_DIGEST,
      deviceId: "legacy-device",
      sessionId: "legacy-session",
      reviewRequestId: "github-pull-request:PR_238",
      leaseEpoch: 1,
      transitionCounter: 4,
      state: "review_ready",
      expiresAt: "2026-08-03T07:37:22.000Z",
      focusedEvidenceDigest: PREDECESSOR_FOCUSED_EVIDENCE,
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
      declaredWriteSet: lease.admission.declaredWriteSet,
      writeSetDigest: WRITE_SET_DIGEST,
      admittedReportDigest: ADMITTED_REPORT_DIGEST,
      manifestDigest: MANIFEST_DIGEST,
    },
    authority: lease.cloudAuthority,
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

function successorAuthority(overrides = {}) {
  return {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "example/ledger",
    targetRepository: "example/repo",
    claimId: SUCCESSOR_CLAIM_ID,
    claimDigest: SUCCESSOR_CLAIM_DIGEST,
    ledgerRevision: BASE_SHA,
    claimLedgerRevision: SUCCESSOR_LEDGER_DIGEST,
    canonicalBaseSha: BASE_SHA,
    laneRevision: REVIEW_SHA,
    cloudDeclaredWriteScope: [
      "path:docs/CANONICAL-LIFECYCLE.md",
      "path:scripts/legacy-authority-evaluator.mjs",
      "semantic:legacy-authority-evaluator",
    ],
    writeSetDigest: WRITE_SET_DIGEST,
    deviceId: "legacy-device",
    sessionId: "legacy-session",
    reviewRequestId: "github-pull-request:PR_238",
    leaseEpoch: 2,
    transitionCounter: 3,
    state: "review_ready",
    expiresAt: "2026-08-03T09:07:22.000Z",
    focusedEvidenceDigest: PREDECESSOR_FOCUSED_EVIDENCE,
    ...overrides,
  };
}

function taskBoundPreservedLane(testContext) {
  const directory = mkdtempSync(path.join(realpathSync(tmpdir()), "acos-handoff-binding-"));
  testContext.after(() => rmSync(directory, { recursive: true, force: true }));
  const capabilityPath = path.join(directory, "task-authority.json");
  writeTaskAuthorityCapability({ outputPath: capabilityPath });
  const lane = preservedLane();
  const leaseCore = {
    ...lane.lease, schema: "agentic-writer-lease/v2", epoch: 2, fenceSha: REVIEW_SHA,
    autoDelivery: false, runtimeRequired: false,
    acquiredAt: "2026-08-03T07:00:00.000Z",
    heartbeatAt: lane.authority.expiresAt, expiresAt: lane.authority.expiresAt,
    admission: { ...lane.lease.admission, schema: "agentic-lane-admission-lease/v1",
      semanticScope: lane.lease.scope, planReceiptDigest: "a".repeat(64),
      admissionReceiptDigest: "b".repeat(64), existingLaneStateDigest: "c".repeat(64),
      preservationReceiptDigest: "d".repeat(64) },
  };
  const lease = { ...leaseCore, taskAuthority: createTaskAuthorityLeaseBinding({
    lease: leaseCore, capabilityPath,
  }) };
  return { lane: { ...lane, lease, authority: lease.cloudAuthority }, capabilityPath };
}

function statusResult(claims = [], { includePredecessor = true } = {}) {
  const completeClaims = includePredecessor
    && !claims.some(claim => claim?.claimId === PREDECESSOR_CLAIM_ID)
    ? [predecessorStatusClaim(), ...claims]
    : claims;
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    repositoryId: "github-repository:example",
    claims: completeClaims,
  };
}

function predecessorStatusClaim(overrides = {}) {
  return {
    claimId: PREDECESSOR_CLAIM_ID,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "reviewed",
    actorId: "github-user:1",
    repositoryId: "github-repository:example",
    workItemId: SCOPE_WORK_ITEM_ID,
    canonicalBaseRevision: BASE_SHA,
    laneRevision: REVIEW_SHA,
    declaredWriteScope: preservedLane().manifest.declaredWriteSet,
    writeSetDigest: WRITE_SET_DIGEST,
    leaseEpoch: 1,
    transitionCounter: 4,
    heartbeatCounter: 0,
    reviewRequestId: "github-pull-request:PR_238",
    predecessorClaimId: null,
    expiresAt: "2026-08-03T07:37:22.000Z",
    fenceRevision: PREDECESSOR_CLAIM_DIGEST,
    transitionDigest: PREDECESSOR_LEDGER_DIGEST,
    operationReceiptDigest: PREDECESSOR_OPERATION_RECEIPT_DIGEST,
    integrationReceiptDigest: null,
    integration: null,
    ...overrides,
  };
}

function resumableSuccessorClaim(overrides = {}) {
  return {
    claimId: SUCCESSOR_CLAIM_ID,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "waiting-successor",
    actorId: "github-user:1",
    repositoryId: "github-repository:example",
    workItemId: SCOPE_WORK_ITEM_ID,
    canonicalBaseRevision: BASE_SHA,
    laneRevision: REVIEW_SHA,
    declaredWriteScope: preservedLane().manifest.declaredWriteSet,
    writeSetDigest: WRITE_SET_DIGEST,
    leaseEpoch: 2,
    transitionCounter: 1,
    heartbeatCounter: 0,
    reviewRequestId: null,
    predecessorClaimId: PREDECESSOR_CLAIM_ID,
    expiresAt: "2026-08-03T09:07:22.000Z",
    fenceRevision: SUCCESSOR_CLAIM_DIGEST,
    transitionDigest: SUCCESSOR_LEDGER_DIGEST,
    operationReceiptDigest: CLAIM_RECEIPT_DIGEST,
    integrationReceiptDigest: null,
    integration: null,
    ...overrides,
  };
}

function integratedReplayEvidence() {
  return {
    candidateRevision: REVIEW_SHA,
    reviewRequestId: "github-pull-request:PR_238",
    focusedEvidenceDigest: PREDECESSOR_FOCUSED_EVIDENCE,
    dependencyClosureDigest: "a".repeat(64),
    namedChecksDigest: "b".repeat(64),
    handoffEvidenceDigest: "c".repeat(64),
    operatorDecisionDigest: "d".repeat(64),
    integrationIntentDigest: "e".repeat(64),
    integratedAt: "2026-08-03T08:00:00.000Z",
  };
}

function integratedReplayClaim(overrides = {}) {
  return {
    claimId: PREDECESSOR_CLAIM_ID,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "dormant-preserved",
    writeAuthority: false,
    scopeReserved: true,
    actorId: "github-user:1",
    deviceId: CLOUD_DEVICE_ID,
    sessionId: CLOUD_SESSION_ID,
    repositoryId: "github-repository:example",
    workItemId: SCOPE_WORK_ITEM_ID,
    canonicalBaseRevision: BASE_SHA,
    laneRevision: REVIEW_SHA,
    declaredWriteScope: preservedLane().manifest.declaredWriteSet,
    writeSetDigest: WRITE_SET_DIGEST,
    leaseEpoch: 1,
    transitionCounter: 5,
    heartbeatCounter: 0,
    reviewRequestId: "github-pull-request:PR_238",
    predecessorClaimId: null,
    expiresAt: "2026-08-03T09:07:22.000Z",
    fenceRevision: "f".repeat(64),
    transitionDigest: "0".repeat(64),
    operationReceiptDigest: INTEGRATION_RECEIPT_DIGEST,
    integrationReceiptDigest: INTEGRATION_RECEIPT_DIGEST,
    integration: integratedReplayEvidence(),
    ...overrides,
  };
}

function integratedRecoveryEvidenceDigest(claim = integratedReplayClaim()) {
  return digestValue({
    schema: "agentic-integrated-preserved-recovery-evidence/v1",
    branch: preservedLane().branch,
    claimId: claim.claimId,
    candidateRevision: claim.integration.candidateRevision,
    reviewRequestId: claim.integration.reviewRequestId,
    integrationReceiptDigest: claim.integrationReceiptDigest,
    operationReceiptDigest: claim.operationReceiptDigest,
    manifestDigest: MANIFEST_DIGEST,
    writeSetDigest: WRITE_SET_DIGEST,
  });
}

function recoveredIntegratedReplayClaim(overrides = {}) {
  const source = integratedReplayClaim();
  return {
    ...source,
    state: "integrated-preserved",
    transitionCounter: source.transitionCounter + 1,
    writeAuthority: false,
    scopeReserved: true,
    expiresAt: "2099-08-03T09:07:22.000Z",
    fenceRevision: "2".repeat(64),
    transitionDigest: "3".repeat(64),
    operationReceiptDigest: RECOVERY_RECEIPT_DIGEST,
    recovery: {
      evidenceDigest: integratedRecoveryEvidenceDigest(source),
      recoveredAt: "2026-08-03T08:30:00.000Z",
    },
    ...overrides,
  };
}

function claimOnlyQueuedDerivative(overrides = {}) {
  return {
    claimId: CLAIM_ONLY_CLAIM_ID,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "waiting-successor",
    actorId: "github-user:1",
    deviceId: CLOUD_DEVICE_ID,
    sessionId: pseudonymousIdentifier(
      "session",
      "successful-release-recapture-policy-session",
    ),
    repositoryId: "github-repository:example",
    workItemId: CLAIM_ONLY_WORK_ITEM_ID,
    canonicalBaseRevision: BASE_SHA,
    laneRevision: BASE_SHA,
    declaredWriteScope: CLAIM_ONLY_SCOPE,
    writeSetDigest: digestValue(CLAIM_ONLY_SCOPE),
    leaseEpoch: 1,
    transitionCounter: 1,
    heartbeatCounter: 0,
    writeAuthority: false,
    scopeReserved: false,
    reviewRequestId: null,
    predecessorClaimId: PREDECESSOR_CLAIM_ID,
    expiresAt: "2026-08-03T09:07:22.000Z",
    fenceRevision: "6".repeat(64),
    transitionDigest: "7".repeat(64),
    operationReceiptDigest: "8".repeat(64),
    integrationReceiptDigest: null,
    integration: null,
    recovery: null,
    retirement: null,
    handoff: null,
    release: null,
    ...overrides,
  };
}

function claimAssociationFrame(claimIds = [CLAIM_ONLY_CLAIM_ID], overrides = {}) {
  const core = {
    schema: "agentic-cloud-authority-handoff-claim-associations/v1",
    writerRegistryDigest: "c".repeat(64),
    providerInventoryDigest: "d".repeat(64),
    providerPullRequestCount: 0,
    providerPageCount: 1,
    claims: claimIds.map(claimId => ({
      claimId,
      writerLeaseMatchDigests: [],
      pullRequestMarkerMatchDigests: [],
    })),
    ...overrides,
  };
  return Object.freeze({ ...core, frameDigest: digestValue(core) });
}

function claimAssociationFrameCore(frame) {
  const { frameDigest: _frameDigest, ...core } = frame;
  return core;
}

function cloudStatus(claims, ledgerRevision = BASE_SHA) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    ledgerRevision,
    ledgerDigest: "9".repeat(64),
    claims,
  };
}

function cloudMutation(action, claim, ledgerRevision = BASE_SHA) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action,
    status: claim.state,
    ledgerRevision,
    claimDigest: claim.fenceRevision,
    claim,
    receipt: {
      receiptDigest: "a".repeat(64),
      ledgerDigest: "9".repeat(64),
    },
  };
}

function cloudVerification(claim, claims = [claim]) {
  const evaluationTime = "2026-08-03T08:30:00.000Z";
  const inventoryCore = {
    schema: CURRENT_CLAIM_INVENTORY_SCHEMA,
    ledgerRevision: BASE_SHA,
    ledgerDigest: "9".repeat(64),
    evaluationTime,
    claims: claims.map(value => structuredClone(value))
      .sort((left, right) => left.claimId.localeCompare(right.claimId)),
  };
  const claimInventoryDigest = digestValue(inventoryCore);
  const receiptCore = {
    schema: "agentic-cloud-collaboration-github-verification/v1",
    ok: true,
    ledgerRevision: BASE_SHA,
    ledgerDigest: "9".repeat(64),
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    contractReceiptDigest: "b".repeat(64),
    claimInventoryDigest,
    evaluationTime,
    findings: [],
  };
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "verify",
    status: "ready",
    ledgerRevision: BASE_SHA,
    claimDigest: claim.fenceRevision,
    claim,
    currentClaimInventory: { ...inventoryCore, claimInventoryDigest },
    findings: [],
    receipt: { ...receiptCore, receiptDigest: digestValue(receiptCore) },
  };
}

function integratedDeliveryLane(overrides = {}) {
  const source = preservedLane();
  const authority = integratedReplayAuthority({
    expiresAt: "2026-08-03T09:07:22.000Z",
  });
  const lease = {
    ...source.lease,
    status: "delivery",
    deliveryHeadSha: REVIEW_SHA,
    cloudAuthority: authority,
    expiresAt: authority.expiresAt,
  };
  return {
    ...source,
    lease,
    authority,
    localHeadSha: REVIEW_SHA,
    cloudSubject: {
      deviceId: CLOUD_DEVICE_ID,
      sessionId: CLOUD_SESSION_ID,
    },
    pullRequest: {
      ...source.pullRequest,
      autoMergeRequest: {
        mergeMethod: "SQUASH",
        enabledAt: "2026-08-03T08:01:00.000Z",
        enabledBy: { login: "owner" },
      },
    },
    remoteLease: {
      ...source.remoteLease,
      status: "delivery",
      deliveryHeadSha: REVIEW_SHA,
      cloudAuthority: authority,
    },
    ...overrides,
  };
}

function integratedReplayAuthority(overrides = {}) {
  const claim = integratedReplayClaim();
  return {
    ...preservedLane().authority,
    claimDigest: claim.fenceRevision,
    claimLedgerRevision: claim.transitionDigest,
    ledgerRevision: BASE_SHA,
    ledgerDigest: PREDECESSOR_LEDGER_DIGEST,
    cloudDeclaredWriteScope: claim.declaredWriteScope,
    transitionCounter: claim.transitionCounter,
    state: "delivery_authorized",
    expiresAt: claim.expiresAt,
    operationReceiptDigest: claim.operationReceiptDigest,
    integrationReceiptDigest: claim.integrationReceiptDigest,
    integration: claim.integration,
    manifestDigest: MANIFEST_DIGEST,
    ...overrides,
  };
}

function integratedAuthorityForClaim(claim) {
  return integratedReplayAuthority({
    claimDigest: claim.fenceRevision,
    claimLedgerRevision: claim.transitionDigest,
    transitionCounter: claim.transitionCounter,
    expiresAt: claim.expiresAt,
    operationReceiptDigest: claim.operationReceiptDigest,
    integrationReceiptDigest: claim.integrationReceiptDigest,
    integration: claim.integration,
  });
}

function integratedConvergenceEvidence(
  authority,
  claim = recoveredIntegratedReplayClaim(),
) {
  return Object.freeze({
    schema: "agentic-integrated-replay-convergence-evidence/v1",
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
    fenceRevision: authority.claimDigest,
    claimLedgerRevision: authority.claimLedgerRevision,
    transitionDigest: authority.claimLedgerRevision,
    transitionCounter: authority.transitionCounter,
    state: authority.state,
    expiresAt: authority.expiresAt,
    branch: preservedLane().branch,
    canonicalBaseSha: authority.canonicalBaseSha,
    candidateRevision: authority.laneRevision,
    manifestDigest: authority.manifestDigest,
    writeSetDigest: authority.writeSetDigest,
    leaseEpoch: authority.leaseEpoch,
    reviewRequestId: authority.reviewRequestId,
    focusedEvidenceDigest: authority.focusedEvidenceDigest,
    currentOperationReceiptDigest: authority.operationReceiptDigest,
    integrationReceiptDigest: authority.integrationReceiptDigest,
    integrationEvidenceDigest: digestValue(authority.integration),
    recoveryEvidenceDigest: claim.recovery.evidenceDigest,
    recoveredAt: claim.recovery.recoveredAt,
    currentQueuedDerivativeDisposition: "absent-from-verified-inventory",
    overlappingCurrentClaimIds: [],
    lifecycleAttribution: "not-reconstructed",
    observation: "current-state-only",
  });
}

function integratedRecoveryResult(
  authority = integratedAuthorityForClaim(recoveredIntegratedReplayClaim()),
  claim = recoveredIntegratedReplayClaim(),
) {
  const convergenceEvidence = integratedConvergenceEvidence(authority, claim);
  return {
    authority,
    convergenceEvidence,
    convergenceEvidenceDigest: digestValue(convergenceEvidence),
  };
}

function claimResult({ replayed = false, claimOverrides = {} } = {}) {
  const claim = resumableSuccessorClaim({ state: "active", ...claimOverrides });
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "claim",
    status: claim.state,
    replayed,
    ledgerRevision: BASE_SHA,
    claimDigest: SUCCESSOR_CLAIM_DIGEST,
    claim,
    receipt: {
      receiptDigest: CLAIM_RECEIPT_DIGEST,
      ledgerDigest: PREDECESSOR_LEDGER_DIGEST,
      evaluationTime: "2026-08-03T08:30:00.000Z",
    },
  };
}

function reclaimRequest() {
  return {
    transition: "reclaim",
    branch: "agent/legacy-device/legacy-authority-evaluator",
    sessionId: "legacy-session",
    successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device",
  };
}

function testAdapter(options = {}, calls = []) {
  const read = value => typeof value === "function" ? value() : value;
  return createCloudAuthorityHandoffControllerAdapter({
    readPreservedReviewLane: () => read(options.lane) || preservedLane(),
    readAuthenticatedOwner: () => read(options.actor) || { id: 1, login: "owner" },
    readCloudStatus: () => read(options.status) || statusResult(),
    claimSuccessor: input => {
      calls.push("claim");
      return options.claim ? options.claim(input) : options.claimResult || claimResult();
    },
    bindAndReviewReady: input => {
      calls.push("bind");
      if (options.bind) return options.bind(input);
      return {
        authority: successorAuthority({
          deviceId: input.request.successorDeviceId,
          sessionId: input.request.successorSessionId,
        }),
        verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
      };
    },
    persistReviewProjection: input => {
      calls.push("persist");
      return options.persist?.(input) || { receiptDigest: PROJECTION_RECEIPT_DIGEST };
    },
    recoverIntegratedAuthority: input => {
      calls.push("recover");
      return options.recover?.(input) || integratedRecoveryResult();
    },
    readClaimAssociations: options.associations === undefined
      ? undefined
      : input => typeof options.associations === "function"
        ? options.associations(input)
        : options.associations,
  });
}

test("retain, reclaim, handoff, refresh, and reviewed replay preserve projections", async () => {
  const refreshed = preservedLane({
    refreshedHeadSha: REFRESHED_SHA,
    remoteHeadSha: REFRESHED_SHA,
    protectedMainRefresh: {
      schema: "agentic-protected-main-refresh/v1",
      deliveredHeadSha: REVIEW_SHA,
      refreshedHeadSha: REFRESHED_SHA,
      mainParentSha: REFRESH_MAIN_PARENT_SHA,
    },
    pullRequest: { ...preservedLane().pullRequest, headRefOid: REFRESHED_SHA },
  });
  const reviewed = resumableSuccessorClaim({
    state: "reviewed",
    transitionCounter: 3,
    reviewRequestId: "github-pull-request:PR_238",
  });
  const scenarios = [
    { request: reclaimRequest(), outcome: "reclaimed-live", calls: ["claim", "bind", "persist"] },
    { request: { ...reclaimRequest(), transition: "retain" }, outcome: "retained-legacy", calls: [] },
    {
      request: { ...reclaimRequest(), transition: "handoff", successorSessionId: "new-session", successorDeviceId: "new-device" },
      outcome: "handed-off-live", calls: ["claim", "bind"], projected: false,
    },
    { request: reclaimRequest(), lane: refreshed, outcome: "reclaimed-live", calls: ["claim", "bind", "persist"] },
    {
      request: reclaimRequest(),
      status: statusResult([reviewed]),
      claimResult: claimResult({ replayed: true }),
      outcome: "reclaimed-live",
      calls: ["claim", "bind", "persist"],
    },
  ];
  for (const scenario of scenarios) {
    const calls = [];
    const result = await continueExpiredReviewLaneAuthority(
      scenario.request,
      { adapter: testAdapter(scenario, calls) },
    );
    assert.equal(result.schema, CLOUD_AUTHORITY_HANDOFF_CONTROLLER_RESULT_SCHEMA);
    assert.equal(result.outcome, scenario.outcome);
    assert.deepEqual(calls, scenario.calls);
    if (scenario.projected !== undefined) assert.equal(result.projectionUpdated, scenario.projected);
    assert.equal(result.predecessorClaimId, PREDECESSOR_CLAIM_ID);
  }
});

test("PR337 branch and PR738 scope identities advance only from observed epochs", () => {
  for (const [rawWorkItemId, leaseEpoch] of [
    ["agent/huis-macbook-pro-3.local/legacy-review-ready-retirement", 1],
    ["game-os-core", 4],
  ]) {
    const predecessor = predecessorStatusClaim({
      workItemId: pseudonymousIdentifier("work-item", rawWorkItemId),
      leaseEpoch,
    });
    const result = buildCloudAuthoritySuccessorClaimRequest({
      request: { ...reclaimRequest(), ttlSeconds: 1800 },
      lane: preservedLane(),
      predecessor,
    });
    assert.equal(result.workItemId, predecessor.workItemId);
    assert.equal(result.predecessorClaimId, predecessor.claimId);
    assert.equal(result.leaseEpoch, leaseEpoch + 1);
    assert.notEqual(result.leaseEpoch, 1);
  }
});

test("predecessor, projection, ownership, and overlap drift block before mutation", async () => {
  const identityDrifts = [
    { entrySchema: "agentic-cloud-collaboration-entry/v1" }, { actorId: "github-user:2" },
    { repositoryId: "github-repository:other" }, { workItemId: "raw-work-item" },
    { canonicalBaseRevision: "9".repeat(40) }, { laneRevision: "8".repeat(40) },
    { writeSetDigest: "7".repeat(64) }, { leaseEpoch: 2 },
    { predecessorClaimId: "8".repeat(64) },
    { reviewRequestId: "github-pull-request:PR_other" },
  ];
  const projectionDrifts = [
    { fenceRevision: "7".repeat(64) }, { transitionDigest: "6".repeat(64) },
    { transitionCounter: 5 }, { expiresAt: "2026-08-03T07:38:22.000Z" },
    { operationReceiptDigest: "5".repeat(64) },
  ];
  const cases = [
    { status: statusResult([], { includePredecessor: false }), finding: "missing-predecessor-claim" },
    { status: statusResult([predecessorStatusClaim(), predecessorStatusClaim()]), finding: "duplicate-predecessor-claim" },
    ...identityDrifts.map(drift => ({ status: statusResult([predecessorStatusClaim(drift)]), finding: "predecessor-identity-drift" })),
    ...projectionDrifts.map(drift => ({ status: statusResult([predecessorStatusClaim(drift)]), finding: "predecessor-review-state-drift" })),
    { lane: preservedLane({ remoteHeadSha: "9".repeat(40) }), finding: "exact-head-drift" },
    { actor: { id: 1, login: "other" }, finding: "authenticated-owner-mismatch" },
    { status: statusResult([{ claimId: "a".repeat(64), declaredWriteScope: ["semantic:legacy-authority-evaluator"] }]), finding: "competing-live-claim" },
    { status: statusResult([{ claimId: "a".repeat(64), reviewRequestId: "github-pull-request:PR_238", declaredWriteScope: ["semantic:other"] }]), finding: "review-request-already-live" },
  ];
  for (const scenario of cases) {
    const calls = [];
    const result = await continueExpiredReviewLaneAuthority(
      reclaimRequest(),
      { adapter: testAdapter(scenario, calls) },
    );
    assert.equal(result.outcome, "blocked");
    assert.equal(result.blockingFindings.some(item => item.type === scenario.finding), true);
    assert.deepEqual(calls, []);
  }
});

test("arbitrary fresh claim responses stop before every follow-on mutation", async () => {
  const drifts = [
    { workItemId: pseudonymousIdentifier("work-item", "other") },
    { predecessorClaimId: "8".repeat(64) }, { leaseEpoch: 1 },
    { entrySchema: "agentic-cloud-collaboration-entry/v1" },
    { claimIdentitySchema: "agentic-cloud-collaboration-entry/v1" },
    { actorId: "github-user:2" }, { repositoryId: "github-repository:other" },
    { canonicalBaseRevision: "9".repeat(40) }, { laneRevision: "8".repeat(40) },
    { writeSetDigest: "7".repeat(64) }, { state: "reviewed", reviewRequestId: "github-pull-request:PR_238" },
  ];
  for (const drift of drifts) {
    const calls = [];
    await assert.rejects(
      continueExpiredReviewLaneAuthority(reclaimRequest(), {
        adapter: testAdapter({ claimResult: claimResult({ claimOverrides: drift }) }, calls),
      }),
      /exact observed predecessor identity/u,
    );
    assert.deepEqual(calls, ["claim"]);
  }
});

test("a crash after claim resumes the exact observed successor", async () => {
  const predecessor = predecessorStatusClaim();
  const waiting = resumableSuccessorClaim();
  let claims = [predecessor], attempts = 0, projections = 0;
  const adapter = testAdapter({
    status: () => statusResult(claims),
    claim: () => {
      attempts += 1;
      claims = [predecessor, waiting];
      return claimResult({ replayed: attempts > 1, claimOverrides: { state: "waiting-successor" } });
    },
    bind: () => {
      if (attempts === 1) throw new Error("simulated response loss");
      return { authority: successorAuthority(), verification: { receiptDigest: REVIEW_RECEIPT_DIGEST } };
    },
    persist: () => { projections += 1; },
  });
  await assert.rejects(continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter }), /response loss/u);
  const recovered = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });
  assert.equal(recovered.outcome, "reclaimed-live");
  assert.equal(attempts, 2);
  assert.equal(projections, 1);
});

test("integrated replay is stable and derivative or evidence drift never mutates", async () => {
  const recoveredClaim = recoveredIntegratedReplayClaim();
  let claims = [integratedReplayClaim(), resumableSuccessorClaim()];
  const calls = [];
  const adapter = testAdapter({
    lane: integratedDeliveryLane(),
    status: () => statusResult(claims),
    recover: () => {
      claims = [recoveredClaim];
      return integratedRecoveryResult(integratedAuthorityForClaim(recoveredClaim));
    },
  }, calls);
  const first = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });
  const replay = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });
  assert.equal(first.outcome, "reclaimed-live-replay");
  assert.equal(first.predecessorClaimId, first.successorClaimId);
  assert.equal(first.projectionUpdated, false);
  assert.equal(first.resultDigest, replay.resultDigest);
  const terminalReceipt = first.receipts.find(
    receipt => receipt.kind === "integrated-authority-converged",
  );
  assert.equal(
    terminalReceipt.payload.currentOperationReceiptDigest,
    recoveredClaim.operationReceiptDigest,
  );
  assert.equal(
    terminalReceipt.payload.integrationReceiptDigest,
    recoveredClaim.integrationReceiptDigest,
  );
  assert.deepEqual(calls, ["recover", "recover"]);
  const descendantDrifts = [
    { writeAuthority: true },
    { scopeReserved: false },
    { transitionCounter: integratedReplayAuthority().transitionCounter },
    { fenceRevision: integratedReplayAuthority().claimDigest },
    { transitionDigest: integratedReplayAuthority().claimLedgerRevision },
    { operationReceiptDigest: integratedReplayAuthority().operationReceiptDigest },
    { expiresAt: integratedReplayAuthority().expiresAt },
    { recovery: null },
    { recovery: { ...recoveredClaim.recovery, evidenceDigest: "f".repeat(64) } },
    { recovery: { ...recoveredClaim.recovery, evidenceDigest: "invalid" } },
    { recovery: { ...recoveredClaim.recovery, recoveredAt: "invalid" } },
  ];
  for (const status of [
    statusResult([integratedReplayClaim(), resumableSuccessorClaim({ actorId: "github-user:2" })]),
    statusResult([integratedReplayClaim({ integrationReceiptDigest: null })]),
    statusResult([integratedReplayClaim(), resumableSuccessorClaim(), resumableSuccessorClaim({ claimId: "a".repeat(64) })]),
    ...descendantDrifts.map(drift => statusResult([{ ...recoveredClaim, ...drift }])),
  ]) {
    const blockedCalls = [];
    const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), {
      adapter: testAdapter({ lane: integratedDeliveryLane(), status }, blockedCalls),
    });
    assert.equal(result.outcome, "blocked");
    assert.deepEqual(blockedCalls, []);
  }
});

test("expired delivery replay retires one exact unprojected claim-only derivative", async () => {
  const associationFrame = claimAssociationFrame();
  const associationReads = [];
  const calls = [];
  const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), {
    adapter: testAdapter({
      lane: integratedDeliveryLane(),
      status: statusResult([integratedReplayClaim(), claimOnlyQueuedDerivative()]),
      associations: ({ claimIds }) => {
        associationReads.push(claimIds);
        return associationFrame;
      },
      recover: ({ integratedReplay }) => {
        assert.equal(integratedReplay.queuedClaim.claimId, CLAIM_ONLY_CLAIM_ID);
        assert.equal(integratedReplay.queuedClaimVariant, "claim-only-unprojected");
        assert.equal(integratedReplay.associationFrameDigest, associationFrame.frameDigest);
        return integratedRecoveryResult();
      },
    }, calls),
  });

  assert.equal(result.outcome, "reclaimed-live-replay");
  assert.equal(result.predecessorClaimId, PREDECESSOR_CLAIM_ID);
  assert.equal(result.successorClaimId, PREDECESSOR_CLAIM_ID);
  assert.equal(result.projectionUpdated, false);
  assert.deepEqual(calls, ["recover"]);
  assert.deepEqual(associationReads, [
    [CLAIM_ONLY_CLAIM_ID],
    [CLAIM_ONLY_CLAIM_ID],
  ]);
});

test("integrated delivery replay rejects a foreign successor device or session before effects", async () => {
  const status = statusResult([
    integratedReplayClaim(),
    claimOnlyQueuedDerivative(),
  ]);
  for (const request of [
    { ...reclaimRequest(), successorDeviceId: "foreign-device" },
    { ...reclaimRequest(), successorSessionId: "foreign-session" },
  ]) {
    const calls = [];
    const result = await continueExpiredReviewLaneAuthority(request, {
      adapter: testAdapter({
        lane: integratedDeliveryLane(),
        status,
        associations: claimAssociationFrame(),
      }, calls),
    });
    assert.equal(result.outcome, "blocked");
    assert.deepEqual(calls, []);
  }
});

test("controller rejects arbitrary recovered authority and unsealed convergence evidence", async () => {
  const baseline = integratedRecoveryResult();
  const mismatchedEvidence = {
    ...baseline.convergenceEvidence,
    candidateRevision: "9".repeat(40),
  };
  const variants = [
    {
      ...baseline,
      authority: { ...baseline.authority, deviceId: "foreign-device" },
    },
    {
      ...baseline,
      authority: { ...baseline.authority, sessionId: "foreign-session" },
    },
    {
      ...baseline,
      authority: { ...baseline.authority, manifestDigest: "9".repeat(64) },
    },
    {
      ...baseline,
      authority: { ...baseline.authority, claimDigest: "8".repeat(64) },
    },
    {
      ...baseline,
      authority: { ...baseline.authority, operationReceiptDigest: "7".repeat(64) },
    },
    {
      ...baseline,
      convergenceEvidence: mismatchedEvidence,
      convergenceEvidenceDigest: digestValue(mismatchedEvidence),
    },
    {
      ...baseline,
      convergenceEvidenceDigest: "6".repeat(64),
    },
  ];
  for (const recovered of variants) {
    const calls = [];
    await assert.rejects(
      continueExpiredReviewLaneAuthority(reclaimRequest(), {
        adapter: testAdapter({
          lane: integratedDeliveryLane(),
          status: statusResult([integratedReplayClaim()]),
          recover: () => recovered,
        }, calls),
      }),
      /integrated|convergence|authority/iu,
    );
    assert.deepEqual(calls, ["recover"]);
  }
});

test("delivery replay preserves ordinary review-ready rules and fails closed on projection drift", async () => {
  const source = integratedDeliveryLane();
  const derivative = claimOnlyQueuedDerivative();
  const frame = claimAssociationFrame();
  const laneDrifts = [
    { lane: { ...source, lease: { ...source.lease, status: "review_ready" } }, finding: "lane-not-delivery" },
    { lane: { ...source, localHeadSha: "9".repeat(40) }, finding: "exact-head-drift" },
    { lane: { ...source, remoteHeadSha: "9".repeat(40) }, finding: "exact-head-drift" },
    { lane: { ...source, pullRequest: { ...source.pullRequest, headRefOid: "9".repeat(40) } }, finding: "exact-head-drift" },
    { lane: { ...source, pullRequest: { ...source.pullRequest, isDraft: true } }, finding: "review-projection-not-ready" },
    { lane: { ...source, pullRequest: { ...source.pullRequest, autoMergeRequest: null } }, finding: "integrated-delivery-auto-merge-not-armed" },
    { lane: { ...source, authority: { ...source.authority, state: "review_ready" } }, finding: "integrated-authority-not-delivery-authorized" },
    { lane: { ...source, authority: { ...source.authority, expiresAt: "2099-08-03T09:07:22.000Z" } }, finding: "legacy-authority-still-live" },
    { lane: { ...source, remoteLease: { ...source.remoteLease, status: "review_ready" } }, finding: "owner-marker-drift" },
    { lane: { ...source, lease: { ...source.lease, cloudAuthority: { ...source.authority, claimDigest: "2".repeat(64) } } }, finding: "owner-marker-drift" },
    { lane: { ...source, remoteLease: { ...source.remoteLease, cloudAuthority: { ...source.authority, claimDigest: "2".repeat(64) } } }, finding: "owner-marker-drift" },
  ];
  for (const scenario of laneDrifts) {
    const calls = [];
    const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), {
      adapter: testAdapter({
        lane: scenario.lane,
        status: statusResult([integratedReplayClaim(), derivative]),
        associations: frame,
      }, calls),
    });
    assert.equal(result.outcome, "blocked");
    assert.equal(result.blockingFindings.some(item => item.type === scenario.finding), true);
    assert.deepEqual(calls, []);
  }

  const sourceClaimDrifts = [
    { fenceRevision: "2".repeat(64) },
    { transitionDigest: "3".repeat(64) },
    { transitionCounter: 6 },
    { expiresAt: "2026-08-03T09:08:22.000Z" },
    { operationReceiptDigest: "4".repeat(64) },
    { integrationReceiptDigest: "5".repeat(64) },
    { integration: { ...integratedReplayEvidence(), namedChecksDigest: "6".repeat(64) } },
    { deviceId: pseudonymousIdentifier("device", "other-device") },
    { sessionId: pseudonymousIdentifier("session", "other-session") },
  ];
  for (const drift of sourceClaimDrifts) {
    const calls = [];
    const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), {
      adapter: testAdapter({
        lane: source,
        status: statusResult([
          integratedReplayClaim(drift),
          derivative,
        ]),
        associations: frame,
      }, calls),
    });
    assert.equal(result.outcome, "blocked");
    assert.equal(result.blockingFindings.some(item => item.type === "integrated-replay-drift"), true);
    assert.deepEqual(calls, []);
  }

  const authorityDrifts = [
    { claimDigest: "2".repeat(64) },
    { claimLedgerRevision: "3".repeat(64) },
    { transitionCounter: 6 },
    { expiresAt: "2026-08-03T09:08:22.000Z" },
    { operationReceiptDigest: "4".repeat(64) },
    { integrationReceiptDigest: "5".repeat(64) },
    { integration: { ...integratedReplayEvidence(), namedChecksDigest: "6".repeat(64) } },
    { manifestDigest: "7".repeat(64) },
    { writeSetDigest: "8".repeat(64) },
    { cloudDeclaredWriteScope: ["path:docs/OTHER.md", "semantic:legacy-authority-evaluator"] },
    { deviceId: "other-device" },
    { sessionId: "other-session" },
  ];
  for (const drift of authorityDrifts) {
    const authority = { ...source.authority, ...drift };
    const lane = {
      ...source,
      authority,
      lease: { ...source.lease, cloudAuthority: authority },
      remoteLease: { ...source.remoteLease, cloudAuthority: authority },
    };
    const calls = [];
    const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), {
      adapter: testAdapter({
        lane,
        status: statusResult([integratedReplayClaim(), derivative]),
        associations: frame,
      }, calls),
    });
    assert.equal(result.outcome, "blocked");
    assert.equal(result.blockingFindings.some(item => item.type === "integrated-replay-drift"), true);
    assert.deepEqual(calls, []);
  }

  const derivativeDrifts = [
    { actorId: "github-user:2" },
    { deviceId: "other-device" },
    { workItemId: SCOPE_WORK_ITEM_ID },
    { canonicalBaseRevision: "9".repeat(40) },
    { laneRevision: REVIEW_SHA },
    { leaseEpoch: 2 },
    { transitionCounter: 2 },
    { heartbeatCounter: 1 },
    { writeAuthority: true },
    { scopeReserved: true },
    { reviewRequestId: "github-pull-request:PR_239" },
    { integration: integratedReplayEvidence() },
    { recovery: { mode: "recovery" } },
  ];
  for (const drift of derivativeDrifts) {
    const calls = [];
    const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), {
      adapter: testAdapter({
        lane: source,
        status: statusResult([integratedReplayClaim(), claimOnlyQueuedDerivative(drift)]),
        associations: frame,
      }, calls),
    });
    assert.equal(result.outcome, "blocked");
    assert.equal(result.blockingFindings.some(item => item.type === "integrated-replay-drift"), true);
    assert.deepEqual(calls, []);
  }

  for (const associated of [
    claimAssociationFrame([CLAIM_ONLY_CLAIM_ID], {
      claims: [{
        claimId: CLAIM_ONLY_CLAIM_ID,
        writerLeaseMatchDigests: ["a".repeat(64)],
        pullRequestMarkerMatchDigests: [],
      }],
    }),
    claimAssociationFrame([CLAIM_ONLY_CLAIM_ID], {
      claims: [{
        claimId: CLAIM_ONLY_CLAIM_ID,
        writerLeaseMatchDigests: [],
        pullRequestMarkerMatchDigests: ["b".repeat(64)],
      }],
    }),
  ]) {
    const calls = [];
    const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), {
      adapter: testAdapter({
        lane: source,
        status: statusResult([integratedReplayClaim(), derivative]),
        associations: associated,
      }, calls),
    });
    assert.equal(result.outcome, "blocked");
    assert.equal(result.blockingFindings.some(item => item.type === "integrated-replay-drift"), true);
    assert.deepEqual(calls, []);
  }
});

test("complete claim-only association inventory drift prevents recovery mutation", async () => {
  const initial = claimAssociationFrame();
  const changedFrames = [
    claimAssociationFrame([CLAIM_ONLY_CLAIM_ID], {
      writerRegistryDigest: "e".repeat(64),
    }),
    claimAssociationFrame([CLAIM_ONLY_CLAIM_ID], {
      providerInventoryDigest: "f".repeat(64),
    }),
    claimAssociationFrame([CLAIM_ONLY_CLAIM_ID], {
      providerPullRequestCount: 1,
    }),
    claimAssociationFrame([CLAIM_ONLY_CLAIM_ID], {
      providerPageCount: 2,
    }),
    claimAssociationFrame([CLAIM_ONLY_CLAIM_ID], {
      claims: [{
        claimId: CLAIM_ONLY_CLAIM_ID,
        writerLeaseMatchDigests: ["a".repeat(64)],
        pullRequestMarkerMatchDigests: [],
      }],
    }),
  ];
  for (const changed of changedFrames) {
    let reads = 0;
    const calls = [];
    await assert.rejects(
      continueExpiredReviewLaneAuthority(reclaimRequest(), {
        adapter: testAdapter({
          lane: integratedDeliveryLane(),
          status: statusResult([integratedReplayClaim(), claimOnlyQueuedDerivative()]),
          associations: () => reads++ === 0 ? initial : changed,
        }, calls),
      }),
      /associations changed after preflight/u,
    );
    assert.equal(reads, 2);
    assert.deepEqual(calls, []);
  }
});

test("cloud helper retires the exact claim-only derivative then recovers the same integrated claim", async () => {
  const frame = claimAssociationFrame();
  const helperManifest = {
    ...preservedLane().manifest,
    writeSetDigest: digestValue(preservedLane().manifest.declaredWriteSet),
  };
  const createHarness = (queuedOverrides = {}) => {
    let integrated = integratedReplayClaim({
      writeAuthority: false,
      scopeReserved: true,
      writeSetDigest: helperManifest.writeSetDigest,
    });
    let queued = claimOnlyQueuedDerivative(queuedOverrides);
    let inspections = 0;
    const calls = [];
    return {
      calls,
      get integrated() { return integrated; },
      get queued() { return queued; },
      inspect() {
        inspections += 1;
        return cloudStatus([integrated, ...(queued ? [queued] : [])]);
      },
      invoke({ action, request }) {
        calls.push({ action, request });
        if (action === "retire" && request.claimId === queued?.claimId) {
          const retired = { ...queued, state: "retired" };
          queued = null;
          return cloudMutation("retire", retired);
        }
        if (action === "continue" && request.mode === "recovery"
          && request.claimId === integrated.claimId) {
          integrated = {
            ...integrated,
            state: "integrated-preserved",
            writeAuthority: false,
            scopeReserved: true,
            transitionCounter: integrated.transitionCounter + 1,
            fenceRevision: digestValue({ request, kind: "fence" }),
            transitionDigest: digestValue({ request, kind: "transition" }),
            operationReceiptDigest: digestValue({ request, kind: "operation" }),
            expiresAt: "2099-08-03T09:07:22.000Z",
            recovery: {
              evidenceDigest: request.recoveryEvidenceDigest,
              recoveredAt: "2026-08-03T08:30:00.000Z",
            },
          };
          return cloudMutation("continue", integrated);
        }
        throw new Error(`unexpected cloud operation ${action}:${request.mode || "none"}`);
      },
      verify() {
        return cloudVerification(integrated);
      },
    };
  };
  const authorityFor = claim => integratedReplayAuthority({
    claimDigest: claim.fenceRevision,
    claimLedgerRevision: claim.transitionDigest,
    transitionCounter: claim.transitionCounter,
    expiresAt: claim.expiresAt,
    operationReceiptDigest: claim.operationReceiptDigest,
    writeSetDigest: helperManifest.writeSetDigest,
  });
  const run = harness => recoverIntegratedPreservedCloudAuthority({
    authority: authorityFor(harness.integrated),
    integratedClaim: harness.integrated,
    queuedSuccessor: harness.queued,
    queuedSuccessorVariant: "claim-only-unprojected",
    queuedSuccessorAssociationFrameDigest: frame.frameDigest,
    manifest: helperManifest,
    branch: preservedLane().branch,
    headSha: REVIEW_SHA,
    focusedEvidenceDigest: PREDECESSOR_FOCUSED_EVIDENCE,
    deviceId: "legacy-device",
    sessionId: "legacy-session",
    invoke: harness.invoke,
    inspect: harness.inspect,
    verify: harness.verify,
  });

  const harness = createHarness();
  const sourceAuthority = authorityFor(harness.integrated);
  const result = run(harness);
  assert.deepEqual(harness.calls.map(call => [call.action, call.request.mode || null]), [
    ["retire", null],
    ["continue", "recovery"],
  ]);
  const retire = harness.calls[0].request;
  assert.equal(retire.claimId, CLAIM_ONLY_CLAIM_ID);
  assert.equal(retire.reason, "superseded");
  assert.equal(retire.finalRevision, BASE_SHA);
  assert.equal(result.authority.claimId, PREDECESSOR_CLAIM_ID);
  assert.equal(result.authority.state, "delivery_authorized");
  assert.deepEqual(result.verification.inventory.claims.map(claim => claim.claimId), [
    PREDECESSOR_CLAIM_ID,
  ]);

  const laneTemplate = integratedDeliveryLane();
  const controllerLane = {
    ...laneTemplate,
    manifest: helperManifest,
    authority: sourceAuthority,
    lease: { ...laneTemplate.lease, cloudAuthority: sourceAuthority },
    remoteLease: { ...laneTemplate.remoteLease, cloudAuthority: sourceAuthority },
  };
  const controllerCalls = [];
  const controllerAdapter = testAdapter({
    lane: controllerLane,
    status: () => statusResult([harness.integrated]),
    recover: () => result,
  }, controllerCalls);
  const firstReplay = await continueExpiredReviewLaneAuthority(
    reclaimRequest(),
    { adapter: controllerAdapter },
  );
  const secondReplay = await continueExpiredReviewLaneAuthority(
    reclaimRequest(),
    { adapter: controllerAdapter },
  );
  assert.equal(firstReplay.outcome, "reclaimed-live-replay");
  assert.equal(firstReplay.resultDigest, secondReplay.resultDigest);
  assert.deepEqual(controllerCalls, ["recover", "recover"]);

  const malformed = createHarness({ heartbeatCounter: 1 });
  assert.throws(
    () => run(malformed),
    /claim-only queued derivative drifted/u,
  );
  assert.deepEqual(malformed.calls, []);
});

test("successor ambiguity, competing drift, and replay identity fail closed", async () => {
  for (const status of [
    statusResult([resumableSuccessorClaim({ workItemId: pseudonymousIdentifier("work-item", "other") })]),
    statusResult([resumableSuccessorClaim(), resumableSuccessorClaim({ claimId: "a".repeat(64) })]),
  ]) {
    const calls = [];
    const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), {
      adapter: testAdapter({ status }, calls),
    });
    assert.equal(result.outcome, "blocked");
    assert.deepEqual(calls, []);
  }
  const calls = [];
  await assert.rejects(continueExpiredReviewLaneAuthority(reclaimRequest(), {
    adapter: testAdapter({
      status: statusResult([resumableSuccessorClaim()]),
      claimResult: claimResult({ replayed: true, claimOverrides: { claimId: "a".repeat(64) } }),
    }, calls),
  }), /exact observed predecessor identity/u);
  assert.deepEqual(calls, ["claim"]);
});

test("repository projection atomically continues task authority for a new cloud claim", testContext => {
  const { lane: source, capabilityPath } = taskBoundPreservedLane(testContext);
  const authority = successorAuthority();
  let released = null, updated = null, body = source.pullRequest.body;
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo", sessionId: "legacy-session", environment: {},
    taskAuthorityFile: capabilityPath,
    resolveRealpath: value => value,
    leaseStore: { release(input) {
      released = input;
      updated = { ...input.expectedLease, ...input.values, schema: "agentic-writer-lease/v2",
        status: input.status, heartbeatAt: input.timestamp, expiresAt: input.timestamp };
      return updated;
    } },
    run: (_command, args) => { body = args[args.indexOf("--body") + 1]; },
    ghText: () => JSON.stringify({
      ...source.pullRequest, headRepository: { nameWithOwner: "example/repo" }, body,
    }),
  });
  adapter.persistReviewProjection({ lane: source, authority });
  assert.equal(released.expectedLease, source.lease);
  assert.equal(released.timestamp, authority.expiresAt);
  assert.equal(updated.expiresAt, authority.expiresAt);
  assert.equal(released.values.taskAuthority.bindingMode, "continuation");
  assert.equal(released.values.taskAuthority.priorBindingDigest,
    source.lease.taskAuthority.bindingDigest);
  assert.notEqual(released.values.taskAuthority.bindingDigest,
    source.lease.taskAuthority.bindingDigest);
  assert.equal(updated.taskAuthority.bindingDigest,
    released.values.taskAuthority.bindingDigest);
});

test("repository projection rejects missing successor capability before local or PR mutation", testContext => {
  const { lane: source } = taskBoundPreservedLane(testContext);
  let releases = 0, edits = 0;
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo", sessionId: "legacy-session", environment: {},
    resolveRealpath: value => value,
    leaseStore: { release() { releases += 1; throw new Error("must remain idle"); } },
    run: () => { edits += 1; },
  });
  assert.throws(() => adapter.claimSuccessor({
    request: {}, lane: source, predecessor: {},
  }), /requires its existing capability/u);
  assert.throws(() => adapter.recoverIntegratedAuthority({
    request: {}, lane: source, integratedReplay: {},
  }), /requires its existing capability/u);
  assert.throws(() => adapter.persistReviewProjection({
    lane: source, authority: successorAuthority(),
  }), /task authority capability path must be absolute/u);
  assert.equal(releases, 0);
  assert.equal(edits, 0);
});

test("repository reader preserves the provider pull-request node ID", () => {
  const source = preservedLane();
  const body = renderWriterLeasePullRequestBody(source.lease);
  const pullRequest = {
    id: "PR_238",
    url: source.pullRequest.url,
    state: "OPEN",
    isDraft: false,
    headRefName: source.branch,
    headRefOid: REVIEW_SHA,
    headRepository: { nameWithOwner: "example/repo" },
    baseRefName: "main",
    baseRefOid: BASE_SHA,
    body,
    author: { login: "owner" },
  };
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    resolveRealpath: value => value,
    leaseStore: { read: () => source.lease },
    run: () => {},
    gitText: args => {
      const values = {
        "worktree list --porcelain -z": `worktree /repo\0HEAD ${REVIEW_SHA}\0branch refs/heads/${source.branch}\0\0`,
        "rev-parse --show-toplevel": "/repo",
        "branch --show-current": source.branch,
        "rev-parse HEAD": REVIEW_SHA,
        [`rev-parse refs/remotes/origin/${source.branch}`]: REVIEW_SHA,
        "status --porcelain": "",
      };
      const key = args.join(" ");
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    ghText: () => JSON.stringify(pullRequest),
  });

  const lane = adapter.readPreservedReviewLane({ branch: source.branch });
  assert.equal(lane.pullRequest.id, "PR_238");
});

test("repository adapter seals full-registry and all-PR claim association frames", testContext => {
  const { lane: bound } = taskBoundPreservedLane(testContext);
  const { taskAuthority: _taskAuthority, ...unboundLease } = bound.lease;
  const authority = integratedReplayAuthority({
    expiresAt: "2026-08-03T09:07:22.000Z",
  });
  const lease = {
    ...unboundLease,
    status: "delivery",
    deliveryHeadSha: REVIEW_SHA,
    heartbeatAt: authority.expiresAt,
    expiresAt: authority.expiresAt,
    cloudAuthority: authority,
  };
  const sourcePull = {
    id: "PR_238",
    number: 238,
    url: bound.pullRequest.url,
    state: "OPEN",
    isDraft: false,
    mergedAt: null,
    closedAt: null,
    autoMergeRequest: { mergeMethod: "SQUASH" },
    headRefName: bound.branch,
    headRefOid: REVIEW_SHA,
    headRepository: { nameWithOwner: "example/repo" },
    baseRefName: "main",
    baseRefOid: BASE_SHA,
    body: renderWriterLeasePullRequestBody(lease),
    author: { login: "owner" },
  };
  let registry = {
    schema: "agentic-writer-lease-registry/v1",
    revision: 1,
    leases: { [bound.branch]: lease },
  };
  let providerPulls = [sourcePull];
  let associationMode = "complete";
  let unboundedPage = 0;
  const associationQueries = [];
  const store = {
    read(branch) {
      return branch ? registry.leases[branch] || null : registry;
    },
  };
  const adapter = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository: "/repo",
    sessionId: "legacy-session",
    resolveRealpath: value => value,
    leaseStore: store,
    run: () => {},
    gitText: args => {
      const values = {
        "worktree list --porcelain -z": `worktree /repo\0HEAD ${REVIEW_SHA}\0branch refs/heads/${bound.branch}\0\0`,
        "rev-parse --show-toplevel": "/repo",
        "branch --show-current": bound.branch,
        "rev-parse HEAD": REVIEW_SHA,
        [`rev-parse refs/remotes/origin/${bound.branch}`]: REVIEW_SHA,
        "status --porcelain": "",
      };
      const key = args.join(" ");
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    ghText: args => {
      if (args[0] !== "api" || args[1] !== "graphql") {
        return JSON.stringify(sourcePull);
      }
      associationQueries.push([...args]);
      const after = args.find(value => value.startsWith("after="))?.slice(6) || null;
      const envelope = (nodes, pageInfo) => JSON.stringify({
        data: { repository: { pullRequests: { nodes, pageInfo } } },
      });
      if (associationMode === "malformed") {
        return JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } });
      }
      if (associationMode === "cursor-drift") {
        return envelope(after ? [] : [providerPulls[0]], {
          hasNextPage: true,
          endCursor: "cursor-1",
        });
      }
      if (associationMode === "duplicate") {
        return envelope([providerPulls[0]], {
          hasNextPage: after === null,
          endCursor: after === null ? "cursor-1" : null,
        });
      }
      if (associationMode === "unbounded") {
        unboundedPage += 1;
        return envelope([], {
          hasNextPage: true,
          endCursor: `cursor-${unboundedPage}`,
        });
      }
      return after === null
        ? envelope([providerPulls[0]], {
          hasNextPage: true,
          endCursor: "cursor-1",
        })
        : envelope(providerPulls.slice(1), {
          hasNextPage: false,
          endCursor: null,
        });
    },
  });

  const lane = adapter.readPreservedReviewLane({ branch: bound.branch });
  assert.equal(lane.lease.status, "delivery");
  assert.equal(lane.headSha, REVIEW_SHA);
  assert.equal(lane.localHeadSha, REVIEW_SHA);
  assert.deepEqual(lane.cloudSubject, {
    deviceId: CLOUD_DEVICE_ID,
    sessionId: CLOUD_SESSION_ID,
  });
  const empty = adapter.readClaimAssociations({ claimIds: [CLAIM_ONLY_CLAIM_ID] });
  const firstTraversal = associationQueries.slice(-2);
  assert.equal(firstTraversal.length, 2);
  assert.equal(firstTraversal[0].some(value => value.startsWith("after=")), false);
  assert.equal(firstTraversal[1].some(value => value === "after=cursor-1"), true);
  const graphqlQuery = firstTraversal[0]
    .find(value => value.startsWith("query="))?.slice("query=".length);
  assert.match(graphqlQuery, /\bheadRefOid\s+baseRefName\b/u);
  assert.doesNotMatch(graphqlQuery, /headRefOidbaseRefName/u);
  assert.deepEqual(empty.claims, [{
    claimId: CLAIM_ONLY_CLAIM_ID,
    writerLeaseMatchDigests: [],
    pullRequestMarkerMatchDigests: [],
  }]);
  assert.match(empty.writerRegistryDigest, /^[0-9a-f]{64}$/u);
  assert.match(empty.providerInventoryDigest, /^[0-9a-f]{64}$/u);
  assert.equal(empty.providerPullRequestCount, 1);
  assert.equal(empty.providerPageCount, 2);
  assert.equal(empty.frameDigest, digestValue(claimAssociationFrameCore(empty)));
  assert.deepEqual(
    adapter.readClaimAssociations({ claimIds: [CLAIM_ONLY_CLAIM_ID] }),
    empty,
  );

  const associatedBranch = "agent/legacy-device/claim-only-association";
  const associatedLease = {
    ...lease,
    branch: associatedBranch,
    cloudAuthority: { ...authority, claimId: CLAIM_ONLY_CLAIM_ID },
  };
  registry = {
    ...registry,
    revision: 2,
    leases: { ...registry.leases, [associatedBranch]: associatedLease },
  };
  providerPulls = [...providerPulls, {
    ...sourcePull,
    id: "PR_239",
    number: 239,
    url: "https://github.com/example/repo/pull/239",
    headRefName: associatedBranch,
    body: renderWriterLeasePullRequestBody(associatedLease),
  }];
  const associated = adapter.readClaimAssociations({ claimIds: [CLAIM_ONLY_CLAIM_ID] });
  assert.equal(associated.claims[0].writerLeaseMatchDigests.length, 1);
  assert.equal(associated.claims[0].pullRequestMarkerMatchDigests.length, 1);
  assert.notEqual(associated.frameDigest, empty.frameDigest);
  assert.equal(
    associated.frameDigest,
    digestValue(claimAssociationFrameCore(associated)),
  );
  assert.equal(associated.providerPullRequestCount, 2);
  assert.equal(associated.providerPageCount, 2);

  for (const [mode, pattern] of [
    ["malformed", /pagination|pageInfo|envelope/iu],
    ["cursor-drift", /cursor|pagination/iu],
    ["duplicate", /duplicate.*pull request|pull request.*duplicate/iu],
    ["unbounded", /page.*ceiling|bounded.*pagination|pagination.*limit/iu],
  ]) {
    associationMode = mode;
    unboundedPage = 0;
    assert.throws(
      () => adapter.readClaimAssociations({ claimIds: [CLAIM_ONLY_CLAIM_ID] }),
      pattern,
    );
  }
});
