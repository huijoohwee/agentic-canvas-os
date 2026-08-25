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
  githubLedgerCommandOptions,
  runScopeExpansionLineageMigration } from "../scripts/cloud-authority-scope-expansion-lineage-migration.mjs";

const BASE = "a".repeat(40);
const SOURCE_HEAD = "b".repeat(40);
const REVIEW_HEAD = "c".repeat(40);
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
const ACTOR = Object.freeze({
  actorId: "github-user:1",
  deviceId: "device:legacy-device",
  sessionId: "session:legacy-session",
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
const LIVE_EXPIRY = "2099-08-09T02:00:00.000Z";

function fixture({ retirementPlanDigest = PLAN_RECEIPT } = {}) {
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
    workItemId: TARGET_WORK_ITEM,
    canonicalBaseRevision: BASE,
    declaredWriteScope: TARGET_SCOPE,
    laneRevision: SOURCE_HEAD,
    predecessorClaimId: source.claim.claimId,
    leaseEpoch: 1,
    expiresAt: EXPIRED,
    idempotencyKey: "target-waiting",
  });
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
  const retired = mutate(ledger, "retire", T3, {
    claimId: sourceProjected.claim.claimId,
    expectedFenceRevision: sourceProjected.claim.fenceRevision,
    expectedTransitionCounter: sourceProjected.claim.transitionCounter,
    reason: "superseded",
    finalRevision: SOURCE_HEAD,
    reviewRequestId: REVIEW,
    bytesDigest: digestValue({ ...retirementEvidence, kind: "bytes" }),
    namedChecksDigest: digestValue({ ...retirementEvidence, kind: "checks" }),
    handoffEvidenceDigest: digestValue({ ...retirementEvidence, kind: "handoff" }),
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
  });
  ledger = promoted.ledger;
  const projected = mutate(ledger, "continue", T5, {
    claimId: promoted.claim.claimId,
    expectedFenceRevision: promoted.claim.fenceRevision,
    expectedTransitionCounter: promoted.claim.transitionCounter,
    mode: "projection",
    laneRevision: REVIEW_HEAD,
    reviewRequestId: REVIEW,
    idempotencyKey: "target-projection",
  });
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
  });
  ledger = reviewed.ledger;

  const state = { ledger };
  refreshStatus(state);
  state.lane = legacyLane(state.status.claims.find(claim => claim.claimId === target.claim.claimId));
  return state;
}

function mutate(ledger, action, evaluationTime, request) {
  return applyCloudTransition({
    ledger,
    action,
    actor: ACTOR,
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
    claims: listCurrentClaims(state.ledger, OBSERVED_AT, { repositoryId: REPOSITORY.repositoryId })
      .map(projectClaim),
  };
}

function legacyLane(claim) {
  const authority = authorityFromClaim(claim, "legacy-session");
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
    sessionId: "legacy-session",
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
      sessionId: "legacy-session",
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

function migrationAdapter(state, beforeContinue = () => {}) {
  return createScopeExpansionLineageMigrationAdapter({
    readLane: () => state.lane,
    readActor: () => CLOUD_ACTOR,
    readStatus: () => state.status,
    readLedger: () => state.ledger,
    continueAuthority: ({ request, lineageAdmission }) => {
      beforeContinue();
      return continueExpiredReviewLaneAuthority(
        request, { adapter: handoffAdapter(state), lineageAdmission },
      );
    },
  });
}

function handoffAdapter(state) {
  return {
    readPreservedReviewLane: () => state.lane,
    readAuthenticatedOwner: () => CLOUD_ACTOR,
    readCloudStatus: () => state.status,
    claimSuccessor: ({ predecessor }) => {
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
      state.lane = {
        ...state.lane,
        authority,
        lease: { ...state.lane.lease, cloudAuthority: authority },
        remoteLease: { ...state.lane.remoteLease, cloudAuthority: authority },
      };
      return { receiptDigest: digestValue({ projection: authority.claimId }) };
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
  const adapter = migrationAdapter(state);
  const planned = await runScopeExpansionLineageMigration({ mode: "plan", branch: BRANCH }, { adapter });
  const request = executeRequest(planned.plan);
  const migrated = await runScopeExpansionLineageMigration(request, { adapter });
  assert.equal(migrated.outcome, "migrated-live");
  assert.equal(migrated.successorLeaseEpoch, 2);
  assert.notEqual(migrated.successorClaimId, migrated.predecessorClaimId);
  const replay = await runScopeExpansionLineageMigration(request, { adapter });
  assert.equal(replay.outcome, "already-migrated");
  assert.equal(replay.successorClaimId, migrated.successorClaimId);
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
      /exact standard epoch-2 continuation/u);
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
