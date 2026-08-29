import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { applyCloudTransition, createEmptyLedger, digestValue,
  listCurrentClaims } from "../scripts/cloud-collaboration-contract.mjs";
import { continueExpiredReviewLaneAuthority } from "../scripts/cloud-authority-handoff-controller.mjs";
import { authorizeScopeExpansionLineageMigration, buildScopeExpansionLineageAdmission,
  buildScopeExpansionLineageMigrationPlan, sanitizeCloudAuthorityDiagnostic,
  scopeExpansionLineageAdmissionMatches, verifyScopeExpansionLineageMigrationPlan,
} from "../scripts/cloud-authority-scope-expansion-lineage-contract.mjs";
import { createScopeExpansionLineageMigrationAdapter,
  createRepositoryScopeExpansionLineageMigrationAdapter,
  githubLedgerCommandOptions,
  runScopeExpansionLineageMigration } from "../scripts/cloud-authority-scope-expansion-lineage-migration.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";

const BASE = "a".repeat(40);
const SOURCE_HEAD = "b".repeat(40);
const REVIEW_HEAD = "c".repeat(40);
const REFRESHED_HEAD = "7".repeat(40);
const REFRESH_MAIN_PARENT = "8".repeat(40);
const REVIEW = "github-pull-request:PR_scope_expansion";
const BRANCH = "agent/legacy-device/game-os-core";
const PLAN_RECEIPT = "d".repeat(64);
const MANIFEST_DIGEST = "e".repeat(64);
const FOCUSED_EVIDENCE = "f".repeat(64);
const SOURCE_WORK_ITEM = `work-item:${"1".repeat(64)}`;
const TARGET_WORK_ITEM = `work-item:${"2".repeat(64)}`;
const SOURCE_SCOPE = ["path:docs/game.md", "semantic:game-os-core"];
const TARGET_SCOPE = [
  "path:docs/game.md",
  "path:scripts/game-runtime.mjs",
  "semantic:game-os-core",
];
const ACTIVE_DIRTY_LINEAGE = "active-dirty-scope-expansion";
const REVIEWED_RECOVERY_LINEAGE = "reviewed-terminal-handoff-scope-expansion-recovery";
const ACTOR = Object.freeze({
  actorId: "github-user:1",
  deviceId: "device:legacy-device",
  sessionId: "session:legacy-session",
});
const SUCCESSOR_ACTOR = Object.freeze({
  ...ACTOR, sessionId: pseudonymousIdentifier("session", "successor-session"),
});
const REPOSITORY = Object.freeze({
  repositoryId: "github-repository:example",
  canonicalRevision: BASE,
});
const CLOUD_ACTOR = Object.freeze({ id: 1, login: "owner" });
const T0 = "2020-01-01T00:00:00.000Z";
const T1 = "2020-01-01T00:10:00.000Z";
const T2 = "2020-01-01T00:20:00.000Z";
const T3 = "2020-01-01T00:30:00.000Z";
const T4 = "2020-01-01T00:40:00.000Z";
const T5 = "2020-01-01T00:50:00.000Z";
const EXPIRED = "2020-01-02T00:00:00.000Z";
const OBSERVED_AT = "2026-08-09T00:00:00.000Z";
const MIGRATION_TIMES = [
  "2026-08-09T01:00:00.000Z",
  "2026-08-09T01:01:00.000Z",
  "2026-08-09T01:02:00.000Z",
  "2026-08-09T01:03:00.000Z",
  "2026-08-09T01:04:00.000Z",
];
const LIVE_EXPIRY = "2026-08-09T02:00:00.000Z";
const REPEATED_RECOVERY_EXPIRY = "2026-08-09T04:00:00.000Z";
const REPEATED_RECOVERY_AT = "2026-08-09T03:10:00.000Z";

function fixture({
  retirementPlanDigest = PLAN_RECEIPT,
  lineageVariant = ACTIVE_DIRTY_LINEAGE,
  retirementVariant = lineageVariant,
  integrated = false,
} = {}) {
  const reviewedRecovery = lineageVariant === REVIEWED_RECOVERY_LINEAGE;
  const targetActor = reviewedRecovery ? SUCCESSOR_ACTOR : ACTOR;
  const targetSessionId = reviewedRecovery ? "successor-session" : "legacy-session";
  let ledger = createEmptyLedger("github-repository:ledger");
  const source = mutate(ledger, "claim", T0, {
    workItemId: SOURCE_WORK_ITEM,
    canonicalBaseRevision: BASE,
    declaredWriteScope: SOURCE_SCOPE,
    laneRevision: SOURCE_HEAD,
    leaseEpoch: 1,
    expiresAt: EXPIRED,
    idempotencyKey: "source-claim",
  });
  ledger = source.ledger;
  const sourceProjected = mutate(ledger, "continue", T1, {
    claimId: source.claim.claimId,
    expectedFenceRevision: source.claim.fenceRevision,
    expectedTransitionCounter: source.claim.transitionCounter,
    mode: "projection",
    laneRevision: SOURCE_HEAD,
    reviewRequestId: REVIEW,
    idempotencyKey: "source-projection",
  });
  ledger = sourceProjected.ledger;
  const target = mutate(ledger, "claim", T2, {
    workItemId: reviewedRecovery ? SOURCE_WORK_ITEM : TARGET_WORK_ITEM,
    canonicalBaseRevision: BASE,
    declaredWriteScope: TARGET_SCOPE,
    laneRevision: SOURCE_HEAD,
    predecessorClaimId: source.claim.claimId,
    leaseEpoch: 1,
    expiresAt: EXPIRED,
    idempotencyKey: "target-waiting",
  }, targetActor);
  ledger = target.ledger;
  const retirementEvidence = {
    schema: "agentic-active-dirty-scope-expansion-cloud-evidence/v1",
    phase: "source-retired",
    planDigest: retirementPlanDigest,
    sourceClaimId: source.claim.claimId,
    successorClaimId: target.claim.claimId,
    sourceFenceSha: SOURCE_HEAD,
    targetWriteSetDigest: target.claim.writeSetDigest,
  };
  const recoveryPhase = "source-retired";
  const recoveryOperationKey = `${REVIEWED_RECOVERY_LINEAGE}:${recoveryPhase}:${digestValue({
    planDigest: retirementPlanDigest, phase: recoveryPhase,
  })}`;
  const activeDirtyDigests = {
    bytesDigest: digestValue({ ...retirementEvidence, kind: "bytes" }),
    namedChecksDigest: digestValue({ ...retirementEvidence, kind: "checks" }),
    handoffEvidenceDigest: digestValue({ ...retirementEvidence, kind: "handoff" }),
  };
  const reviewedRecoveryDigests = {
    bytesDigest: digestValue({ operationKey: recoveryOperationKey, kind: "bytes" }),
    namedChecksDigest: digestValue({ operationKey: recoveryOperationKey, kind: "checks" }),
    handoffEvidenceDigest: digestValue({
      operationKey: recoveryOperationKey, successor: target.claim.claimId,
    }),
  };
  const retirementDigests = retirementVariant === REVIEWED_RECOVERY_LINEAGE
    ? reviewedRecoveryDigests : activeDirtyDigests;
  const retired = mutate(ledger, "retire", T3, {
    claimId: sourceProjected.claim.claimId,
    expectedFenceRevision: sourceProjected.claim.fenceRevision,
    expectedTransitionCounter: sourceProjected.claim.transitionCounter,
    reason: "superseded",
    finalRevision: SOURCE_HEAD,
    reviewRequestId: REVIEW,
    ...retirementDigests,
    idempotencyKey: "source-retirement",
  });
  ledger = retired.ledger;
  const promoted = mutate(ledger, "continue", T4, {
    claimId: target.claim.claimId,
    expectedFenceRevision: target.claim.fenceRevision,
    expectedTransitionCounter: target.claim.transitionCounter,
    mode: "promote",
    expiresAt: EXPIRED,
    idempotencyKey: "target-promote",
  }, targetActor);
  ledger = promoted.ledger;
  const projected = mutate(ledger, "continue", T5, {
    claimId: promoted.claim.claimId,
    expectedFenceRevision: promoted.claim.fenceRevision,
    expectedTransitionCounter: promoted.claim.transitionCounter,
    mode: "projection",
    laneRevision: REVIEW_HEAD,
    reviewRequestId: REVIEW,
    idempotencyKey: "target-projection",
  }, targetActor);
  ledger = projected.ledger;
  const reviewed = mutate(ledger, "continue", "2020-01-01T01:00:00.000Z", {
    claimId: projected.claim.claimId,
    expectedFenceRevision: projected.claim.fenceRevision,
    expectedTransitionCounter: projected.claim.transitionCounter,
    mode: "review",
    laneRevision: REVIEW_HEAD,
    reviewRequestId: REVIEW,
    focusedEvidenceDigest: FOCUSED_EVIDENCE,
    idempotencyKey: "target-review",
  }, targetActor);
  ledger = reviewed.ledger;

  const state = { ledger, observedAt: OBSERVED_AT, integratedRecoveryCount: 0 };
  refreshStatus(state);
  state.lane = legacyLane(
    state.status.claims.find(claim => claim.claimId === target.claim.claimId),
    targetSessionId,
  );
  if (integrated) {
    const integratedResult = mutate(ledger, "integrate", "2020-01-01T01:10:00.000Z", {
      claimId: reviewed.claim.claimId,
      expectedFenceRevision: reviewed.claim.fenceRevision,
      expectedTransitionCounter: reviewed.claim.transitionCounter,
      candidateRevision: REVIEW_HEAD,
      reviewRequestId: REVIEW,
      focusedEvidenceDigest: FOCUSED_EVIDENCE,
      dependencyClosureDigest: digestValue({ integration: "dependencies" }),
      namedChecksDigest: digestValue({ integration: "checks" }),
      handoffEvidenceDigest: digestValue({ integration: "handoff" }),
      operatorDecisionDigest: digestValue({ integration: "operator" }),
      integrationIntentDigest: digestValue({ integration: "intent" }),
      idempotencyKey: "target-integrate",
    }, targetActor);
    state.ledger = integratedResult.ledger;
    refreshStatus(state);
  }
  return state;
}

function mutate(ledger, action, evaluationTime, request, actor = ACTOR) {
  return applyCloudTransition({
    ledger,
    action,
    actor,
    repository: REPOSITORY,
    evaluationTime,
    request: { ...request, expectedLedgerDigest: ledger.headDigest },
  });
}

function refreshStatus(state) {
  state.status = {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    repositoryId: REPOSITORY.repositoryId,
    ledgerRevision: revision(`ledger-${state.ledger.sequence}`),
    ledgerDigest: state.ledger.headDigest,
    claims: listCurrentClaims(state.ledger, state.observedAt, { repositoryId: REPOSITORY.repositoryId })
      .map(projectClaim),
  };
}

function legacyLane(claim, sessionId = "legacy-session") {
  const authority = authorityFromClaim(claim, sessionId);
  const admission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: "game-os-core",
    declaredWriteSet: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    manifestDigest: MANIFEST_DIGEST,
    planReceiptDigest: PLAN_RECEIPT,
    admissionReceiptDigest: "1".repeat(64),
    existingLaneStateDigest: "2".repeat(64),
    admittedReportDigest: "3".repeat(64),
    preservationReceiptDigest: "4".repeat(64),
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "review_ready",
    sessionId,
    device: "legacy-device",
    scope: "game-os-core",
    branch: BRANCH,
    baseSha: BASE,
    fenceSha: SOURCE_HEAD,
    reviewHeadSha: REVIEW_HEAD,
    pullRequestUrl: "https://github.com/example/repo/pull/1",
    admission,
    cloudAuthority: authority,
  };
  return {
    repository: "/repo",
    branch: BRANCH,
    headSha: REVIEW_HEAD,
    remoteHeadSha: REVIEW_HEAD,
    clean: true,
    baseSha: BASE,
    lease,
    manifest: {
      declaredWriteSet: claim.declaredWriteScope,
      writeSetDigest: claim.writeSetDigest,
      manifestDigest: MANIFEST_DIGEST,
      admittedReportDigest: admission.admittedReportDigest,
    },
    authority,
    pullRequest: {
      url: lease.pullRequestUrl,
      state: "OPEN",
      isDraft: false,
      headRefName: BRANCH,
      headRefOid: REVIEW_HEAD,
      baseRefName: "main",
      body: "<marker>",
      authorLogin: "owner",
    },
    remoteLease: {
      status: "review_ready",
      branch: BRANCH,
      baseSha: BASE,
      scope: "game-os-core",
      sessionId,
      device: "legacy-device",
      reviewHeadSha: REVIEW_HEAD,
      cloudAuthority: authority,
    },
  };
}

function authorityFromClaim(claim, sessionId) {
  return {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "example/ledger",
    targetRepository: "example/repo",
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    ledgerRevision: revision(`authority-${claim.transitionCounter}`),
    ledgerDigest: "5".repeat(64),
    claimLedgerRevision: claim.transitionDigest,
    entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest,
    mutationAuthorityEligible: true,
    canonicalBaseSha: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision,
    cloudDeclaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    deviceId: "legacy-device",
    sessionId,
    reviewRequestId: claim.reviewRequestId,
    leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter,
    state: "review_ready",
    expiresAt: claim.expiresAt,
    focusedEvidenceDigest: claim.evidenceDigest || FOCUSED_EVIDENCE,
    integrationReceiptDigest: null,
    integration: null,
    manifestDigest: MANIFEST_DIGEST,
  };
}

function recoveredIntegratedAuthority(claim, sessionId) {
  return {
    ...authorityFromClaim(claim, sessionId),
    claimDigest: claim.fenceRevision,
    claimLedgerRevision: claim.transitionDigest,
    operationReceiptDigest: claim.operationReceiptDigest,
    transitionCounter: claim.transitionCounter,
    expiresAt: claim.expiresAt,
    state: "delivery_authorized",
    integrationReceiptDigest: claim.integrationReceiptDigest,
    integration: claim.integration,
  };
}

function migrationAdapter(state, beforeContinue = () => {}) {
  return createScopeExpansionLineageMigrationAdapter({
    readLane: () => state.lane,
    readActor: () => CLOUD_ACTOR,
    readStatus: () => state.status,
    readLedger: () => state.ledger,
    continueAuthority: async ({ request, lineageAdmission }) => {
      beforeContinue();
      state.lastContinued = await continueExpiredReviewLaneAuthority(
        request, { adapter: handoffAdapter(state), lineageAdmission },
      );
      return state.lastContinued;
    },
  });
}

function repositoryMigrationAdapter(state, taskAuthorityFile = "/private/tmp/task-authority.json") {
  const repositoryAdapter = createRepositoryScopeExpansionLineageMigrationAdapter({
    repository: process.cwd(),
    sessionId: state.lane.lease.sessionId,
    taskAuthorityFile,
    createHandoffAdapter: input => {
      state.handoffFactoryInput = input;
      return handoffAdapter(state);
    },
    ghText: () => JSON.stringify({
      content: Buffer.from(JSON.stringify(state.ledger)).toString("base64"),
    }),
  });
  return createScopeExpansionLineageMigrationAdapter({
    readLane: input => repositoryAdapter.readLane(input),
    readActor: input => repositoryAdapter.readActor(input),
    readStatus: input => repositoryAdapter.readStatus(input),
    readLedger: input => repositoryAdapter.readLedger(input),
    continueAuthority: async input => {
      state.lastLineageAdmission = input.lineageAdmission;
      state.lastContinuationRequest = input.request;
      state.lastContinued = await repositoryAdapter.continueAuthority(input);
      return state.lastContinued;
    },
  });
}

function handoffAdapter(state) {
  const calls = state.handoffCalls ||= [];
  return {
    readPreservedReviewLane: () => state.lane,
    readAuthenticatedOwner: () => CLOUD_ACTOR,
    readCloudStatus: () => state.status,
    claimSuccessor: ({ predecessor }) => {
      calls.push("claim");
      const result = mutate(state.ledger, "claim", MIGRATION_TIMES[0], {
        workItemId: predecessor.workItemId,
        canonicalBaseRevision: predecessor.canonicalBaseRevision,
        declaredWriteScope: predecessor.declaredWriteScope,
        laneRevision: predecessor.laneRevision,
        predecessorClaimId: predecessor.claimId,
        leaseEpoch: 2,
        expiresAt: LIVE_EXPIRY,
        idempotencyKey: "migration-successor-claim",
      });
      state.ledger = result.ledger;
      refreshStatus(state);
      return cloudResult("claim", result, state.status);
    },
    bindAndReviewReady: ({ claimResult }) => {
      calls.push("bind");
      let successor = claimResult.claim;
      const predecessor = state.status.claims.find(claim => claim.claimId === successor.predecessorClaimId);
      let result = mutate(state.ledger, "retire", MIGRATION_TIMES[1], {
        claimId: predecessor.claimId,
        expectedFenceRevision: predecessor.fenceRevision,
        expectedTransitionCounter: predecessor.transitionCounter,
        reason: "superseded",
        finalRevision: predecessor.laneRevision,
        reviewRequestId: predecessor.reviewRequestId,
        bytesDigest: digestValue({ migration: "bytes" }),
        namedChecksDigest: digestValue({ migration: "checks" }),
        handoffEvidenceDigest: digestValue({ migration: "handoff" }),
        idempotencyKey: "migration-predecessor-retire",
      });
      state.ledger = result.ledger;
      result = mutate(state.ledger, "continue", MIGRATION_TIMES[2], {
        claimId: successor.claimId,
        expectedFenceRevision: successor.fenceRevision,
        expectedTransitionCounter: successor.transitionCounter,
        mode: "promote",
        expiresAt: LIVE_EXPIRY,
        idempotencyKey: "migration-successor-promote",
      });
      state.ledger = result.ledger;
      successor = result.claim;
      result = mutate(state.ledger, "continue", MIGRATION_TIMES[3], {
        claimId: successor.claimId,
        expectedFenceRevision: successor.fenceRevision,
        expectedTransitionCounter: successor.transitionCounter,
        mode: "projection",
        laneRevision: REVIEW_HEAD,
        reviewRequestId: REVIEW,
        idempotencyKey: "migration-successor-projection",
      });
      state.ledger = result.ledger;
      successor = result.claim;
      result = mutate(state.ledger, "continue", MIGRATION_TIMES[4], {
        claimId: successor.claimId,
        expectedFenceRevision: successor.fenceRevision,
        expectedTransitionCounter: successor.transitionCounter,
        mode: "review",
        laneRevision: REVIEW_HEAD,
        reviewRequestId: REVIEW,
        focusedEvidenceDigest: FOCUSED_EVIDENCE,
        idempotencyKey: "migration-successor-review",
      });
      state.ledger = result.ledger;
      refreshStatus(state);
      const reviewed = state.status.claims.find(claim => claim.claimId === successor.claimId);
      return {
        authority: authorityFromClaim(reviewed, "legacy-session"),
        verification: { receiptDigest: digestValue({ review: reviewed.claimId }) },
      };
    },
    persistReviewProjection: ({ authority }) => {
      calls.push("persist");
      state.lane = {
        ...state.lane,
        authority,
        lease: { ...state.lane.lease, cloudAuthority: authority },
        remoteLease: { ...state.lane.remoteLease, cloudAuthority: authority },
      };
      return { receiptDigest: digestValue({ projection: authority.claimId }) };
    },
    recoverIntegratedAuthority: ({ integratedReplay }) => {
      calls.push("recover");
      const claim = integratedReplay.claim;
      const repeatedRecovery = state.integratedRecoveryCount > 0;
      const result = mutate(state.ledger, "continue",
        repeatedRecovery ? REPEATED_RECOVERY_AT : "2026-08-09T01:10:00.000Z", {
        claimId: claim.claimId,
        expectedFenceRevision: claim.fenceRevision,
        expectedTransitionCounter: claim.transitionCounter,
        mode: "recovery",
        expiresAt: repeatedRecovery ? REPEATED_RECOVERY_EXPIRY : LIVE_EXPIRY,
        recoveryEvidenceDigest: digestValue({ recovery: claim.claimId }),
        deviceId: SUCCESSOR_ACTOR.deviceId,
        sessionId: SUCCESSOR_ACTOR.sessionId,
        idempotencyKey: `target-integrated-recovery-${claim.transitionCounter}`,
      }, SUCCESSOR_ACTOR);
      state.integratedRecoveryCount += 1;
      state.ledger = result.ledger;
      refreshStatus(state);
      const recovered = state.status.claims.find(value => value.claimId === claim.claimId);
      const authority = recoveredIntegratedAuthority(recovered, state.lane.lease.sessionId);
      return {
        authority,
        convergenceEvidenceDigest: digestValue({ convergence: authority.claimLedgerRevision }),
      };
    },
  };
}

function cloudResult(action, result, status) {
  const claim = projectClaim(result.claim);
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action,
    status: claim.state,
    replayed: false,
    ledgerRevision: status.ledgerRevision,
    ledgerDigest: status.ledgerDigest,
    claimDigest: result.claimDigest,
    claim,
    receipt: result.receipt,
  };
}

function projectClaim(claim) {
  return {
    ...claim,
    transitionDigest: claim.transitionDigest || claim.ledgerRevision,
  };
}

function revision(label) {
  return digestValue({ label }).slice(0, 40);
}

function executeRequest(plan, overrides = {}) {
  return {
    mode: "execute", branch: BRANCH, sessionId: "legacy-session",
    successorSessionId: "legacy-session", successorDeviceId: "legacy-device", plan,
    authorization: `authorize lineage-migration ${plan.planDigest}`, ...overrides,
  };
}

function executionIntent(plan) {
  const core = {
    schema: "agentic-cloud-authority-scope-expansion-lineage-execution-intent/v1",
    planDigest: plan.planDigest, transition: "reclaim", branch: BRANCH,
    sessionId: "legacy-session", successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device", ttlSeconds: 1_800,
  };
  return { ...core, executionIntentDigest: digestValue(core) };
}

test("plan proves the exact portable scope-expansion retirement chain", async () => {
  const state = fixture();
  const result = await runScopeExpansionLineageMigration({
    mode: "plan",
    branch: BRANCH,
  }, { adapter: migrationAdapter(state) });
  assert.equal(result.outcome, "planned");
  assert.equal(result.plan.historicalVariant, ACTIVE_DIRTY_LINEAGE);
  assert.equal(result.plan.scopeExpansionPlanDigest, PLAN_RECEIPT);
  assert.equal(result.plan.legacyClaimId, state.lane.authority.claimId);
  assert.equal(result.plan.successorLeaseEpoch, 2);
  assert.equal(buildScopeExpansionLineageMigrationPlan({
    lane: state.lane,
    actor: CLOUD_ACTOR,
    status: state.status,
    ledger: state.ledger,
  }).planDigest, result.planDigest);
});

test("plan admits the exact reviewed scope-recovery lineage variant", () => {
  const state = fixture({ lineageVariant: REVIEWED_RECOVERY_LINEAGE });
  const plan = buildScopeExpansionLineageMigrationPlan({
    lane: state.lane, actor: CLOUD_ACTOR, status: state.status, ledger: state.ledger,
  });

  assert.equal(plan.historicalVariant, REVIEWED_RECOVERY_LINEAGE);
  assert.equal(plan.workItemId, plan.sourceWorkItemId);
});

test("plan content-binds an exact protected-main refresh between review and delivery heads", () => {
  const state = fixture({ lineageVariant: REVIEWED_RECOVERY_LINEAGE });
  const protectedMainRefresh = {
    schema: "agentic-protected-main-refresh/v1",
    deliveredHeadSha: REVIEW_HEAD,
    refreshedHeadSha: REFRESHED_HEAD,
    mainParentSha: REFRESH_MAIN_PARENT,
  };
  state.lane = {
    ...state.lane,
    refreshedHeadSha: REFRESHED_HEAD,
    remoteHeadSha: REFRESHED_HEAD,
    protectedMainRefresh,
    pullRequest: { ...state.lane.pullRequest, headRefOid: REFRESHED_HEAD },
  };
  const plan = buildScopeExpansionLineageMigrationPlan({
    lane: state.lane, actor: CLOUD_ACTOR, status: state.status, ledger: state.ledger,
  });
  assert.equal(plan.reviewedHeadSha, REVIEW_HEAD);
  assert.equal(plan.deliveryHeadSha, REFRESHED_HEAD);
  assert.deepEqual(plan.protectedMainRefresh, protectedMainRefresh);

  state.lane.protectedMainRefresh = {
    ...protectedMainRefresh, deliveredHeadSha: SOURCE_HEAD,
  };
  assert.throws(() => buildScopeExpansionLineageMigrationPlan({
    lane: state.lane, actor: CLOUD_ACTOR, status: state.status, ledger: state.ledger,
  }), /does not join/u);
});

test("mixed historical lineage identities and retirement receipts remain rejected", () => {
  for (const [lineageVariant, retirementVariant] of [
    [ACTIVE_DIRTY_LINEAGE, REVIEWED_RECOVERY_LINEAGE],
    [REVIEWED_RECOVERY_LINEAGE, ACTIVE_DIRTY_LINEAGE],
  ]) {
    const state = fixture({ lineageVariant, retirementVariant });
    assert.throws(() => buildScopeExpansionLineageMigrationPlan({
      lane: state.lane, actor: CLOUD_ACTOR, status: state.status, ledger: state.ledger,
    }), /retirement .* does not bind/u);
  }
});

test("GitHub ledger reads retain provider responses larger than Node's default buffer", () => {
  const outputBytes = 2 * 1024 * 1024;
  const options = githubLedgerCommandOptions(process.cwd());
  const output = execFileSync(process.execPath, [
    "-e",
    'process.stdout.write("x".repeat(Number(process.argv[1])))',
    String(outputBytes),
  ], options);

  assert.equal(output.length, outputBytes);
  assert.ok(options.maxBuffer > outputBytes);
});

test("execute uses the existing handoff controller and replays the standard epoch-2 successor", async () => {
  const state = fixture();
  const adapter = repositoryMigrationAdapter(state);
  const planned = await runScopeExpansionLineageMigration({ mode: "plan", branch: BRANCH }, { adapter });
  const before = { lane: state.lane, status: state.status };
  const predecessor = before.status.claims.find(claim => claim.claimId === planned.predecessorClaimId);
  assert.equal(predecessor.state, "dormant-preserved");
  const request = executeRequest(planned.plan);
  const migrated = await runScopeExpansionLineageMigration(request, { adapter });
  assert.equal(migrated.outcome, "migrated-live");
  assert.equal(migrated.successorLeaseEpoch, 2);
  assert.notEqual(migrated.successorClaimId, migrated.predecessorClaimId);
  assert.equal(state.handoffFactoryInput.taskAuthorityFile, "/private/tmp/task-authority.json");
  assert.equal(state.lastContinued.outcome, "reclaimed-live");
  assert.deepEqual(state.lastContinued.blockingFindings, []);
  assert.equal(state.lastContinued.projectionUpdated, true);
  assert.deepEqual(state.handoffCalls, ["claim", "bind", "persist"]);
  assert.equal(scopeExpansionLineageAdmissionMatches({
    admission: state.lastLineageAdmission, claim: predecessor, lane: before.lane,
    status: before.status, repositoryId: before.status.repositoryId,
    request: state.lastContinuationRequest,
  }), true);
  const replay = await runScopeExpansionLineageMigration(request, { adapter });
  assert.equal(replay.outcome, "already-migrated");
  assert.equal(replay.successorClaimId, migrated.successorClaimId);
});

test("integrated lineage recovery converges the same epoch-1 claim and replays idempotently", async () => {
  const state = fixture({ lineageVariant: REVIEWED_RECOVERY_LINEAGE, integrated: true });
  state.observedAt = "2020-01-01T01:11:00.000Z";
  refreshStatus(state);
  const adapter = repositoryMigrationAdapter(state);
  const planned = await runScopeExpansionLineageMigration(
    { mode: "plan", branch: BRANCH }, { adapter },
  );
  const before = { lane: state.lane, status: state.status };
  const predecessor = before.status.claims.find(claim => claim.claimId === planned.predecessorClaimId);
  assert.equal(predecessor.state, "integrated-preserved");
  const request = executeRequest(planned.plan, {
    sessionId: "successor-session",
    successorSessionId: "successor-session",
  });
  const recovered = await runScopeExpansionLineageMigration(request, { adapter });
  assert.equal(recovered.outcome, "integrated-replay-recovered");
  assert.equal(recovered.successorClaimId, recovered.predecessorClaimId);
  assert.equal(recovered.successorLeaseEpoch, 1);
  assert.equal(state.lastContinued.outcome, "reclaimed-live-replay");
  assert.deepEqual(state.lastContinued.blockingFindings, []);
  assert.equal(state.lastContinued.projectionUpdated, false);
  assert.deepEqual(state.handoffCalls, ["recover"]);
  assert.equal(scopeExpansionLineageAdmissionMatches({
    admission: state.lastLineageAdmission, claim: predecessor, lane: before.lane,
    status: before.status, repositoryId: before.status.repositoryId,
    request: state.lastContinuationRequest,
  }), true);
  const sequence = state.ledger.sequence;
  const replay = await runScopeExpansionLineageMigration(request, { adapter });
  assert.equal(replay.outcome, "already-migrated");
  assert.equal(replay.successorClaimId, recovered.predecessorClaimId);
  assert.equal(replay.successorLeaseEpoch, 1);
  assert.equal(state.ledger.sequence, sequence);
});

test("integrated lineage recovery converges again after the recovered claim expires", async () => {
  const state = fixture({ lineageVariant: REVIEWED_RECOVERY_LINEAGE, integrated: true });
  const adapter = migrationAdapter(state);
  const planned = await runScopeExpansionLineageMigration(
    { mode: "plan", branch: BRANCH }, { adapter },
  );
  const request = executeRequest(planned.plan, {
    sessionId: "successor-session",
    successorSessionId: "successor-session",
  });
  const first = await runScopeExpansionLineageMigration(request, { adapter });
  assert.equal(first.outcome, "integrated-replay-recovered");

  state.observedAt = "2026-08-09T03:00:00.000Z";
  refreshStatus(state);
  const dormant = state.status.claims.find(claim => claim.claimId === first.successorClaimId);
  assert.equal(dormant.state, "dormant-preserved");
  const sequence = state.ledger.sequence;

  const repeated = await runScopeExpansionLineageMigration(request, { adapter });
  assert.equal(repeated.outcome, "integrated-replay-recovered");
  assert.equal(repeated.successorClaimId, first.successorClaimId);
  assert.equal(repeated.successorLeaseEpoch, 1);
  assert.equal(state.ledger.sequence, sequence + 1);
  assert.equal(state.integratedRecoveryCount, 2);
});

test("integrated lineage rejects a local projection outside the reviewed-to-integrated edge", () => {
  const state = fixture({ lineageVariant: REVIEWED_RECOVERY_LINEAGE, integrated: true });
  const unrelated = state.ledger.entries[0];
  const authority = {
    ...state.lane.authority,
    claimDigest: unrelated.claimDigest,
    claimLedgerRevision: unrelated.digest,
    transitionCounter: unrelated.claimCore.transitionCounter,
  };
  state.lane = {
    ...state.lane,
    authority,
    lease: { ...state.lane.lease, cloudAuthority: authority },
    remoteLease: { ...state.lane.remoteLease, cloudAuthority: authority },
  };
  assert.throws(() => buildScopeExpansionLineageMigrationPlan({
    lane: state.lane, actor: CLOUD_ACTOR, status: state.status, ledger: state.ledger,
  }), /exact transition in the legacy claim lineage/u);
});

test("interrupted local-before-remote projection never attests migrated replay", async () => {
  for (const staleField of ["legacy", "ledgerDigest", "manifestDigest"]) {
    const state = fixture(), adapter = migrationAdapter(state), legacy = state.lane.remoteLease;
    const planned = await runScopeExpansionLineageMigration({ mode: "plan", branch: BRANCH }, { adapter });
    await runScopeExpansionLineageMigration(executeRequest(planned.plan), { adapter });
    const cloudAuthority = staleField === "legacy" ? legacy.cloudAuthority
      : { ...state.lane.remoteLease.cloudAuthority, [staleField]: "0".repeat(64) };
    state.lane = { ...state.lane, remoteLease: { ...state.lane.remoteLease, cloudAuthority } };
    const sequenceBeforeReplay = state.ledger.sequence;
    await assert.rejects(runScopeExpansionLineageMigration(executeRequest(planned.plan), { adapter }),
      /no exact standard migration successor/u);
    assert.equal(state.ledger.sequence, sequenceBeforeReplay);
  }
});

test("reflection-copied authorization and admission capabilities are inert", async () => {
  const state = fixture();
  const plan = buildScopeExpansionLineageMigrationPlan({
    lane: state.lane, actor: CLOUD_ACTOR, status: state.status, ledger: state.ledger,
  });
  const verified = verifyScopeExpansionLineageMigrationPlan({
    plan, lane: state.lane, actor: CLOUD_ACTOR, status: state.status, ledger: state.ledger,
  });
  const intent = executionIntent(plan);
  const authorization = authorizeScopeExpansionLineageMigration({
    plan, executionIntent: intent, authorization: `authorize lineage-migration ${plan.planDigest}`,
  });
  const reflected = Object.create(Object.getPrototypeOf(authorization),
    Object.getOwnPropertyDescriptors(authorization));
  assert.throws(() => buildScopeExpansionLineageAdmission({
    verified, authorization: reflected, executionIntent: intent,
    lane: state.lane, status: state.status,
  }), /branded authorization/u);
  const admission = buildScopeExpansionLineageAdmission({
    verified, authorization, executionIntent: intent, lane: state.lane, status: state.status,
  });
  const reflectedAdmission = Object.create(Object.getPrototypeOf(admission),
    Object.getOwnPropertyDescriptors(admission));
  const claim = state.status.claims.find(value => value.claimId === plan.legacyClaimId);
  assert.equal(scopeExpansionLineageAdmissionMatches({
    admission: reflectedAdmission, claim, lane: state.lane, status: state.status,
    repositoryId: state.status.repositoryId, request: executeRequest(plan),
  }), false);
});

test("second-read remote owner drift blocks before successor claim", async () => {
  for (const [field, value] of [["sessionId", "raced-session"], ["device", "raced-device"]]) {
    const state = fixture();
    const adapter = migrationAdapter(state, () => {
      state.lane = { ...state.lane, remoteLease: { ...state.lane.remoteLease, [field]: value } };
    });
    const planned = await runScopeExpansionLineageMigration({ mode: "plan", branch: BRANCH }, { adapter });
    const sequenceBefore = state.ledger.sequence;
    await assert.rejects(runScopeExpansionLineageMigration(executeRequest(planned.plan), { adapter }),
      /exact standard successor or integrated replay continuation/u);
    assert.equal(state.ledger.sequence, sequenceBefore);
  }
});

test("malformed branch blocks before an adapter can observe the repository", async () => {
  let reads = 0;
  const fail = () => { reads += 1; throw new Error("adapter must stay idle"); };
  const adapter = createScopeExpansionLineageMigrationAdapter({
    readLane: fail, readActor: fail, readStatus: fail, readLedger: fail, continueAuthority: fail,
  });
  await assert.rejects(
    runScopeExpansionLineageMigration({ mode: "plan", branch: `${BRANCH}:refs/heads/main` }, { adapter }),
    /canonical agent\/device\/scope/u,
  );
  assert.equal(reads, 0);
});

test("public diagnostics redact credentials and suppress subprocess output", () => {
  const token = `ghs_${"secret".repeat(8)}`;
  const message = sanitizeCloudAuthorityDiagnostic(new Error(
    `https://owner:${token}@github.com/repo /Users/operator/private ${"x".repeat(300)}`,
  ));
  assert.doesNotMatch(message, /secret|owner:|\/Users\/operator/u);
  assert.ok(message.length <= 240);
  const commandError = Object.assign(new Error("unsafe"), { stderr: Buffer.from(token) });
  assert.equal(sanitizeCloudAuthorityDiagnostic(commandError),
    "External command failed without public diagnostics.");
});

test("execute rejects every distinct recipient identity before cloud mutation", async () => {
  const state = fixture();
  const adapter = migrationAdapter(state);
  const planned = await runScopeExpansionLineageMigration({ mode: "plan", branch: BRANCH }, { adapter });
  const baseline = executeRequest(planned.plan);
  const identityDrifts = [
    { sessionId: "recipient-session" },
    { successorSessionId: "recipient-session" },
    { successorDeviceId: "recipient-device" },
  ];
  const sequenceBefore = state.ledger.sequence;
  for (const drift of identityDrifts) {
    await assert.rejects(
      runScopeExpansionLineageMigration({ ...baseline, ...drift }, { adapter }),
      /only same-owner reclaim/u,
    );
    assert.equal(state.ledger.sequence, sequenceBefore);
  }
});

test("receipt, authorization, and ordinary admission drift stop before continuation", async () => {
  const drifted = fixture({ retirementPlanDigest: "9".repeat(64) });
  await assert.rejects(
    runScopeExpansionLineageMigration({ mode: "plan", branch: BRANCH }, {
      adapter: migrationAdapter(drifted),
    }),
    /does not bind the portable plan receipt/u,
  );

  const state = fixture();
  const adapter = migrationAdapter(state);
  const planned = await runScopeExpansionLineageMigration({ mode: "plan", branch: BRANCH }, { adapter });
  const sequenceBeforeDefaultReclaim = state.ledger.sequence;
  const defaultReclaim = await continueExpiredReviewLaneAuthority({
    transition: "reclaim",
    branch: BRANCH,
    sessionId: "legacy-session",
    successorSessionId: "legacy-session",
    successorDeviceId: "legacy-device",
    ttlSeconds: 1_800,
  }, { adapter: handoffAdapter(state) });
  assert.equal(defaultReclaim.outcome, "blocked");
  assert.equal(state.ledger.sequence, sequenceBeforeDefaultReclaim);
  await assert.rejects(
    runScopeExpansionLineageMigration({
      mode: "execute",
      branch: BRANCH,
      sessionId: "legacy-session",
      successorDeviceId: "legacy-device",
      plan: planned.plan,
      authorization: "authorize lineage-migration stale",
    }, { adapter }),
    /exact typed authorization/u,
  );
  const claim = state.status.claims.find(candidate => candidate.claimId === planned.plan.legacyClaimId);
  assert.equal(scopeExpansionLineageAdmissionMatches({
    admission: null, claim, lane: state.lane, status: state.status,
    repositoryId: state.status.repositoryId, request: executeRequest(planned.plan),
  }), false);
  assert.equal(state.lane.authority.leaseEpoch, 1);
});
