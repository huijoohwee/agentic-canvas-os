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
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
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
const CONVERGENCE_EVIDENCE_DIGEST = "f".repeat(64);
const PREDECESSOR_OPERATION_RECEIPT_DIGEST = "0".repeat(64);
const SCOPE_WORK_ITEM_ID = pseudonymousIdentifier("work-item", "legacy-authority-evaluator");

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
    actorId: "github-user:1",
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
    operationReceiptDigest: "1".repeat(64),
    integrationReceiptDigest: INTEGRATION_RECEIPT_DIGEST,
    integration: integratedReplayEvidence(),
    ...overrides,
  };
}

function integratedReplayAuthority(overrides = {}) {
  const claim = integratedReplayClaim({
    state: "integrated-preserved",
    transitionCounter: 6,
    expiresAt: "2099-08-03T09:07:22.000Z",
  });
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
    operationReceiptDigest: RECOVERY_RECEIPT_DIGEST,
    integrationReceiptDigest: claim.integrationReceiptDigest,
    integration: claim.integration,
    ...overrides,
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
      return options.recover?.(input) || {
        authority: integratedReplayAuthority(),
        verification: { receiptDigest: REVIEW_RECEIPT_DIGEST },
        convergenceEvidenceDigest: CONVERGENCE_EVIDENCE_DIGEST,
      };
    },
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
  const recoveredClaim = integratedReplayClaim({
    state: "integrated-preserved", transitionCounter: 6,
    expiresAt: "2099-08-03T09:07:22.000Z",
    fenceRevision: integratedReplayAuthority().claimDigest,
    transitionDigest: integratedReplayAuthority().claimLedgerRevision,
    operationReceiptDigest: RECOVERY_RECEIPT_DIGEST,
  });
  let claims = [integratedReplayClaim(), resumableSuccessorClaim()];
  const calls = [];
  const adapter = testAdapter({
    status: () => statusResult(claims),
    recover: () => {
      claims = [recoveredClaim];
      return { authority: integratedReplayAuthority(), convergenceEvidenceDigest: CONVERGENCE_EVIDENCE_DIGEST };
    },
  }, calls);
  const first = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });
  const replay = await continueExpiredReviewLaneAuthority(reclaimRequest(), { adapter });
  assert.equal(first.outcome, "reclaimed-live-replay");
  assert.equal(first.predecessorClaimId, first.successorClaimId);
  assert.equal(first.projectionUpdated, false);
  assert.equal(first.resultDigest, replay.resultDigest);
  assert.deepEqual(calls, ["recover", "recover"]);
  for (const status of [
    statusResult([integratedReplayClaim(), resumableSuccessorClaim({ actorId: "github-user:2" })]),
    statusResult([integratedReplayClaim({ integrationReceiptDigest: null })]),
    statusResult([integratedReplayClaim(), resumableSuccessorClaim(), resumableSuccessorClaim({ claimId: "a".repeat(64) })]),
  ]) {
    const blockedCalls = [];
    const result = await continueExpiredReviewLaneAuthority(reclaimRequest(), {
      adapter: testAdapter({ status }, blockedCalls),
    });
    assert.equal(result.outcome, "blocked");
    assert.deepEqual(blockedCalls, []);
  }
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
