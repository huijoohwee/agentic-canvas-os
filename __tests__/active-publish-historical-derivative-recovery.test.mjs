import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digestValue, normalizeRootIntent } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { activePublishHistoricalDerivativeRecoveryDecisionSubject,
  assertActivePublishHistoricalDerivativeRecoveryReadback, buildActivePublishHistoricalDerivativeRecoveryEvidence,
  normalizeActivePublishHistoricalDerivativeRecoveryEvidence } from "../scripts/active-publish-historical-derivative-recovery-evidence.mjs";
import { ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_PHASES,
  advanceActivePublishHistoricalDerivativeRecoveryIntent, authorizeActivePublishHistoricalDerivativeRecoveryPlan,
  buildActivePublishHistoricalDerivativeRecoveryCompletion, buildActivePublishHistoricalDerivativeRecoveryPlan,
  createActivePublishHistoricalDerivativeRecoveryIntent, normalizeActivePublishHistoricalDerivativeRecoveryIntent,
  normalizeActivePublishHistoricalDerivativeRecoveryPlan } from "../scripts/active-publish-historical-derivative-recovery-contract.mjs";
import { createActivePublishHistoricalDerivativeRecoveryController } from "../scripts/active-publish-historical-derivative-recovery-controller.mjs";
import { ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_IMPLEMENTATION_PATHS,
  assertActivePublishHistoricalDerivativeLocalSubject, assertActivePublishHistoricalDerivativeRecoveryResult,
  assertActivePublishHistoricalDerivativeRecoveryLedgerReadback, assertActivePublishHistoricalDerivativeTerminalReceiptJoins, buildActivePublishHistoricalDerivativeRegistryProjection,
  classifyActivePublishHistoricalDerivativeReviewMarker, classifyActivePublishHistoricalDerivativeTransition,
  visibleBodyDigest } from "../scripts/active-publish-historical-derivative-recovery-repository-adapter.mjs";
import { createActivePublishHistoricalDerivativeRecoveryStore } from "../scripts/active-publish-historical-derivative-recovery-store.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability } from "../scripts/task-bound-lane-authority-contract.mjs";
import { projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";
const D = value => digestValue(value);
const S = digit => digit.repeat(40);
const AT = "2026-08-31T03:45:00.000Z";
const REPOSITORY = "owner/repository";
const BRANCH = "agent/device.local/source";
const REVIEW_URL = "https://provider.example/owner/repository/pull/838";
const TASK_CAPABILITY = createTaskAuthorityCapability({
  authoritySubjectId: `urn:agentic-task:${"a".repeat(64)}`,
  issuedAt: "2026-08-31T01:00:00.000Z",
});
function clone(value) { return structuredClone(value); }
function sealed(core, field) { return { ...core, [field]: D(core) }; }
function reseal(value) { const { receiptDigest: _old, ...core } = value;
  return { ...core, receiptDigest: D(core) }; }
function stableLeaseDigest(lease) {
  const { activePublishSuccessorIntent: _intent, heartbeatAt: _heartbeat,
    expiresAt: _expiry, status: _status, ...rest } = lease;
  const cloudAuthority = { ...rest.cloudAuthority };
  delete cloudAuthority.ledgerRevision;
  delete cloudAuthority.ledgerDigest;
  return D({ ...rest, cloudAuthority, status: "active" });
}
function evidenceInput(state = "current") {
  const declaredWriteSet = ["path:scripts/source.mjs", "semantic:source"];
  const admittedPaths = ["scripts/source.mjs"], authoredPaths = ["scripts/source.mjs"];
  const protectedChangedPaths = ["docs/unrelated.md"], writeSetDigest = D(declaredWriteSet);
  const sourceClaimId = D("source-claim"), targetClaimId = D("historical-derivative");
  const sourceOperationReceiptDigest = D("source-operation"), targetOperationReceiptDigest = D("target-operation"), manifestDigest = D("manifest");
  const sourceAuthority = {
    schema: "agentic-lane-cloud-authority/v1", provider: "fixture",
    ledgerRepository: REPOSITORY, targetRepository: REPOSITORY,
    claimId: sourceClaimId, claimDigest: D("source-fence"),
    ledgerRevision: S("7"), ledgerDigest: D("ledger"),
    claimLedgerRevision: D("source-transition"), operationReceiptDigest: sourceOperationReceiptDigest,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    canonicalBaseSha: S("1"), laneRevision: S("3"),
    cloudDeclaredWriteScope: declaredWriteSet, writeSetDigest, manifestDigest,
    deviceId: "device.local", sessionId: "session", reviewRequestId: "review:838",
    leaseEpoch: 1, transitionCounter: 2, heartbeatCounter: 0,
    state: "active", expiresAt: "2026-08-31T04:00:00.000Z",
  };
  const admission = {
    schema: "agentic-lane-admission-lease/v1", status: "admitted",
    semanticScope: "source", declaredWriteSet, manifestDigest, writeSetDigest,
    planReceiptDigest: D("admission-plan"), admissionReceiptDigest: D("admission"),
    existingLaneStateDigest: D("lane-state"), admittedReportDigest: D("admitted-report"),
    preservationReceiptDigest: D("preservation"),
  };
  const leaseWithoutTask = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 1,
    sessionId: "session", device: "device.local", scope: "source", branch: BRANCH,
    worktreePath: "/worktrees/source", baseSha: S("1"), fenceSha: S("3"),
    pullRequestUrl: REVIEW_URL, autoDelivery: false, runtimeRequired: false,
    admission, cloudAuthority: sourceAuthority,
    acquiredAt: "2026-08-31T02:00:00.000Z",
    heartbeatAt: "2026-08-31T03:00:00.000Z",
    expiresAt: "2026-08-31T04:00:00.000Z",
  };
  const sourceTaskAuthority = createTaskAuthorityBinding({
    capability: TASK_CAPABILITY, lease: leaseWithoutTask, boundAt: "2026-08-31T01:01:00.000Z",
  });
  const preIntentLease = { ...leaseWithoutTask, taskAuthority: sourceTaskAuthority };
  const preIntentLeaseDigest = D(preIntentLease);
  const intentCore = {
    schema: "agentic-active-publish-successor-intent/v1", status: "prepared", branch: BRANCH,
    sourceLeaseDigest: preIntentLeaseDigest,
    sourceStableLeaseDigest: stableLeaseDigest(preIntentLease),
    sourceClaimId, sourceClaimDigest: sourceAuthority.claimDigest,
    sourceClaimLedgerRevision: sourceAuthority.claimLedgerRevision,
    sourceCanonicalBaseSha: sourceAuthority.canonicalBaseSha,
    sourceLaneRevision: sourceAuthority.laneRevision, sourceLeaseEpoch: 1,
    sourceTransitionCounter: 2, sourceReviewRequestId: "review:838",
    sourceActorId: "github-user:1", sourceRepositoryId: "repository:R",
    sourceWorkItemId: "work-item:source", sourceEntrySchema: "agentic-cloud-collaboration-entry/v2",
    sourceClaimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    sourceDeviceId: "device.local", sourceSessionId: "session",
    targetCanonicalBaseSha: S("5"), targetHeadSha: S("3"),
    targetPullRequestId: "review:838", targetPullRequestUrl: REVIEW_URL,
    targetPullRequestNumber: 838, targetRepository: REPOSITORY, targetLeaseEpoch: 2,
    admissionSchema: admission.schema, semanticScope: "source", manifestDigest,
    writeSetDigest, admittedReportDigest: admission.admittedReportDigest,
    createdAt: "2026-08-31T03:15:00.000Z", successorClaimId: null,
    successorClaimDigest: null, successorVerificationReceiptDigest: null, completedAt: null,
  };
  const intent = sealed(intentCore, "intentDigest");
  const lease = { ...preIntentLease, activePublishSuccessorIntent: intent };
  const dormant = state === "dormant-preserved";
  const claim = {
    claimId: targetClaimId, fenceRevision: D("target-fence"),
    transitionDigest: D("target-transition"), operationReceiptDigest: targetOperationReceiptDigest,
    actorId: "github-user:1",
    deviceId: pseudonymousIdentifier("device", "device.local"),
    sessionId: pseudonymousIdentifier("session", "session"),
    repositoryId: "repository:R", workItemId: "work-item:source",
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    canonicalBaseRevision: S("5"), laneRevision: S("3"),
    declaredWriteScope: declaredWriteSet, writeSetDigest, leaseEpoch: 2,
    transitionCounter: 3, heartbeatCounter: 0, predecessorClaimId: sourceClaimId,
    reviewRequestId: "review:838", state, recordedState: "current",
    writeAuthority: !dormant, scopeReserved: true,
    expiresAt: dormant ? "2026-08-31T03:30:00.000Z" : "2026-08-31T04:30:00.000Z",
    integrationReceiptDigest: null, integration: null,
  };
  const marker = clone(preIntentLease);
  return {
    observedAt: AT,
    controller: {
      repository: REPOSITORY, headSha: S("8"), treeSha: S("9"),
      originMainSha: S("8"), remoteMainSha: S("8"), clean: true,
      implementationDigest: D("implementation"),
    },
    canonicalAdvance: {
      historicalBaseSha: S("5"), protectedMainSha: S("8"), mergeBases: [S("5")],
      protectedMainDescendant: true, authoredPaths,
      authoredPathsDigest: D(authoredPaths), protectedChangedPaths,
      protectedChangedPathsDigest: D(protectedChangedPaths), noWriteSetOverlap: true,
    },
    lane: {
      repository: REPOSITORY, worktreePath: "/worktrees/source", branch: BRANCH,
      headSha: S("3"), treeSha: S("4"), remoteHeadSha: S("3"),
      statusDigest: D("clean-status"), registered: true, clean: true,
      admittedPaths, admittedPathsDigest: D(admittedPaths),
    },
    sourceLease: {
      lease, leaseDigest: D(lease), preIntentLeaseDigest, status: "active",
      admissionStatus: "admitted", sessionId: "session", device: "device.local",
      scope: "source", branch: BRANCH, epoch: 1, baseSha: S("1"), fenceSha: S("3"),
      pullRequestUrl: REVIEW_URL, manifestDigest, writeSetDigest, declaredWriteSet,
      taskAuthorityBindingDigest: sourceTaskAuthority.bindingDigest,
      cloudAuthorityDigest: D(sourceAuthority), sourceClaimId,
      sourceClaimDigest: sourceAuthority.claimDigest, sourceTransitionCounter: 2,
      sourceOperationReceiptDigest,
    },
    intent,
    review: {
      adapterId: "provider-review/v1", id: "review:838", number: 838, url: REVIEW_URL,
      state: "open", draft: true, autoDeliveryAbsent: true,
      headRepository: REPOSITORY, headBranch: BRANCH, headSha: S("3"),
      baseBranch: "main", baseSha: S("5"), marker, markerDigest: D(marker),
      bodyDigest: D("review-body"), visibleBodyDigest: D("visible-review-body"),
    },
    cloud: {
      ledgerRepository: REPOSITORY, targetRepository: REPOSITORY,
      ledgerRevision: S("7"), ledgerDigest: D("ledger"), ledgerSequence: 11,
      inventoryDigest: D("inventory"), verificationReceiptDigest: D("verification"),
      authenticatedOwner: { id: 1, login: "owner", actorId: "github-user:1" },
      sourceClaimMatches: 0, derivativeMatches: 1, competingClaimIds: [],
      downstreamClaimIds: [], claim,
    },
  };
}
function terminal(plan, state = plan.evidence.cloud.claim.state) {
  const cloudMutation = state === "dormant-preserved";
  const receipts = recoveryReceipts(plan);
  const core = {
    schema: "agentic-active-publish-historical-derivative-recovery-terminal-verification/v1",
    planDigest: plan.planDigest, evidenceDigest: plan.evidenceDigest,
    claimId: plan.evidence.cloud.claim.claimId, sourceLeaseDigest: plan.evidence.sourceLease.leaseDigest,
    targetLeaseDigest: receipts.targetLeaseDigest, taskAuthorityReceiptDigest: receipts.taskAuthorityReceiptDigest,
    successorReceiptDigest: receipts.successorReceiptDigest, registryProjectionReceiptDigest: receipts.registryProjectionReceiptDigest,
    reviewMarkerReceiptDigest: receipts.reviewMarkerReceiptDigest, cloudOperationReceiptDigest: receipts.cloudOperationReceiptDigest,
    cloudVerificationReceiptDigest: receipts.cloudVerificationReceiptDigest,
    visibleBodyDigest: plan.evidence.review.visibleBodyDigest, verifiedAt: AT,
    cloudMutation, providerMutation: true, writerRegistryMutation: true,
    taskAuthorityProjected: true, reviewMarkerProjected: true,
    activePublishSuccessorIntentCleared: true,
    gitMutation: false, refMutation: false, sourceMutation: false, branchMutation: false,
    worktreeMutation: false, integrationMutation: false, mergeMutation: false,
    releaseMutation: false, deploymentMutation: false, retirementMutation: false,
    cleanupMutation: false, newClaim: false, newPullRequest: false,
  };
  return sealed(core, "verificationDigest");
}
function recoveryReceipts(plan) {
  return {
    sourceLeaseDigest: plan.evidence.sourceLease.leaseDigest, targetLeaseDigest: D("target-lease"),
    taskAuthorityReceiptDigest: D("task-authority"), successorReceiptDigest: D("successor"),
    registryProjectionReceiptDigest: D("registry"), reviewMarkerReceiptDigest: D("review-marker"),
    cloudOperationReceiptDigest: D("cloud-operation"), cloudVerificationReceiptDigest: D("cloud-verification"),
  };
}
function phaseValues(phase, plan, state) {
  const values = recoveryReceipts(plan);
  const cloudMutation = state === "dormant-preserved";
  if (phase === "task_authority_verified") {
    return { receiptDigest: values.taskAuthorityReceiptDigest };
  }
  if (phase === "cloud_request_sealed") return { receiptDigest: D("cloud-request") };
  if (phase === "cloud_recovered") return {
    receiptDigest: D("cloud-recovered"), operationReceiptDigest: values.cloudOperationReceiptDigest,
    verificationReceiptDigest: values.cloudVerificationReceiptDigest, cloudMutation,
  };
  if (phase === "registry_projection_prepared") return {
    receiptDigest: D("registry-prepared"), sourceLeaseDigest: values.sourceLeaseDigest,
    targetLeaseDigest: values.targetLeaseDigest,
    taskAuthorityReceiptDigest: values.taskAuthorityReceiptDigest,
    successorReceiptDigest: values.successorReceiptDigest,
    registryProjectionReceiptDigest: values.registryProjectionReceiptDigest,
  };
  if (phase === "registry_projected") return {
    receiptDigest: D("registry-projected"), targetLeaseDigest: values.targetLeaseDigest,
    taskAuthorityReceiptDigest: values.taskAuthorityReceiptDigest,
    successorReceiptDigest: values.successorReceiptDigest,
    registryProjectionReceiptDigest: values.registryProjectionReceiptDigest,
    writerRegistryMutation: true, taskAuthorityProjected: true,
    activePublishSuccessorIntentCleared: true,
  };
  if (phase === "review_marker_projected") return {
    receiptDigest: values.reviewMarkerReceiptDigest,
    visibleBodyDigest: plan.evidence.review.visibleBodyDigest,
    providerMutation: true, reviewMarkerProjected: true,
  };
  if (phase === "verified") return terminal(plan, state);
  return {};
}
test("current and dormant historical derivative evidence is exact and deterministic", () => {
  for (const state of ["current", "dormant-preserved"]) {
    const evidence = buildActivePublishHistoricalDerivativeRecoveryEvidence(evidenceInput(state));
    assert.deepEqual(normalizeActivePublishHistoricalDerivativeRecoveryEvidence(evidence), evidence);
    assert.equal(Object.isFrozen(evidence.cloud.claim.declaredWriteScope), true);
    const observed = buildActivePublishHistoricalDerivativeRecoveryEvidence({
      ...evidenceInput(state), observedAt: "2026-08-31T03:46:00.000Z",
    });
    assert.notEqual(observed.evidenceDigest, evidence.evidenceDigest);
    assert.deepEqual(
      activePublishHistoricalDerivativeRecoveryDecisionSubject(observed),
      activePublishHistoricalDerivativeRecoveryDecisionSubject(evidence),
    );
  }
});
test("lineage, drift, overlap, downstream, and protected overlap fail closed", () => {
  const cases = [
    ["dirty controller", value => { value.controller.clean = false; }],
    ["dirty lane", value => { value.lane.clean = false; }],
    ["remote head", value => { value.lane.remoteHeadSha = S("6"); }],
    ["intent lineage", value => {
      const { intentDigest: _old, ...core } = value.intent;
      value.intent = sealed({ ...core, sourceClaimId: D("foreign") }, "intentDigest");
      value.sourceLease.lease.activePublishSuccessorIntent = clone(value.intent);
      value.sourceLease.leaseDigest = D(value.sourceLease.lease);
    }],
    ["derivative predecessor", value => { value.cloud.claim.predecessorClaimId = D("foreign"); }],
    ["foreign owner", value => { value.cloud.claim.actorId = "actor:B"; }],
    ["competing claim", value => { value.cloud.competingClaimIds = [D("competitor")]; }],
    ["downstream effect", value => { value.cloud.downstreamClaimIds = [D("child")]; }],
    ["protected overlap", value => {
      value.canonicalAdvance.protectedChangedPaths = ["scripts/source.mjs"];
      value.canonicalAdvance.protectedChangedPathsDigest = D(["scripts/source.mjs"]);
    }],
    ["authored outside admission", value => {
      value.canonicalAdvance.authoredPaths = ["scripts/outside.mjs"];
      value.canonicalAdvance.authoredPathsDigest = D(["scripts/outside.mjs"]);
    }],
    ["ambiguous ancestry", value => { value.canonicalAdvance.mergeBases.push(S("1")); }],
    ["non-draft review", value => { value.review.draft = false; }],
    ["marker drift", value => { value.review.markerDigest = D("changed-marker"); }],
  ];
  for (const [label, mutate] of cases) {
    const input = evidenceInput();
    mutate(input);
    assert.throws(() => buildActivePublishHistoricalDerivativeRecoveryEvidence(input), undefined,
      label);
  }
});
test("plan authorization, phase order, and closed completion are exact", () => {
  for (const state of ["current", "dormant-preserved"]) {
    const evidence = buildActivePublishHistoricalDerivativeRecoveryEvidence(evidenceInput(state));
    const plan = buildActivePublishHistoricalDerivativeRecoveryPlan({ evidence, ttlSeconds: 600 });
    assert.deepEqual(normalizeActivePublishHistoricalDerivativeRecoveryPlan(plan), plan);
    assert.equal(plan.exactAuthorization,
      `authorize active-publish-historical-derivative-recovery ${plan.planDigest}`);
    assert.throws(() => authorizeActivePublishHistoricalDerivativeRecoveryPlan(plan, "wrong"),
      /Exact authorization required/);
    const authorization = authorizeActivePublishHistoricalDerivativeRecoveryPlan(
      plan, plan.exactAuthorization,
    );
    let intent = createActivePublishHistoricalDerivativeRecoveryIntent(plan, authorization, AT);
    assert.throws(() => advanceActivePublishHistoricalDerivativeRecoveryIntent(
      intent, "cloud_recovered", { receiptDigest: D("skip") }, AT,
    ), /cannot advance/);
    for (const phase of ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_PHASES) {
      const values = phaseValues(phase, plan, state);
      intent = advanceActivePublishHistoricalDerivativeRecoveryIntent(intent, phase, values, AT);
      assert.deepEqual(
        advanceActivePublishHistoricalDerivativeRecoveryIntent(intent, phase, values, AT), intent,
      );
    }
    assert.deepEqual(normalizeActivePublishHistoricalDerivativeRecoveryIntent(intent), intent);
    const completion = buildActivePublishHistoricalDerivativeRecoveryCompletion(intent);
    assert.equal(completion.cloudMutation, state === "dormant-preserved");
    assert.deepEqual(completion.mutationSet, [
      ...(state === "dormant-preserved" ? ["cloud-same-claim-recovery"] : []),
      "writer-lease-historical-successor-projection",
      "pull-request-hidden-marker-projection",
    ]);
    for (const field of ["providerMutation", "writerRegistryMutation",
      "taskAuthorityProjected", "reviewMarkerProjected", "activePublishSuccessorIntentCleared"]) {
      assert.equal(completion[field], true, field);
    }
    for (const field of ["gitMutation", "refMutation", "sourceMutation", "branchMutation",
      "worktreeMutation", "integrationMutation", "mergeMutation", "releaseMutation",
      "deploymentMutation", "retirementMutation", "cleanupMutation", "newClaim",
      "newPullRequest", "authoringAuthorityGranted"]) {
      assert.equal(completion[field], false, field);
    }
  }
});
function fakeControllerFixture({ state = "current", lostAt = null, rejectAt = null,
  terminalDrift = false } = {}) {
  const calls = Object.fromEntries(["assertSource", "authorizeTask", "sealCloudRequest",
    "recoverCloud", "prepareRegistryProjection", "projectRegistry", "projectReviewMarker",
    "verifyTerminal"].map(name => [name, 0]));
  const mutations = { cloud: 0, registry: 0, marker: 0 };
  const applied = new Set();
  let intent = null;
  const effect = (name, values = {}) => {
    calls[name] += 1;
    if (name === rejectAt) throw new Error(`${name} rejected exact subject`);
    const mutation = name === "recoverCloud" && state === "dormant-preserved" ? "cloud"
      : name === "projectRegistry" ? "registry"
        : name === "projectReviewMarker" ? "marker" : null;
    if (mutation && !applied.has(name)) { applied.add(name); mutations[mutation] += 1; }
    if (name === lostAt && calls[name] === 1) throw new Error(`${name} response lost`);
    return { receiptDigest: D(name), ...values };
  };
  const adapter = {
    readPlanEvidence: async () => buildActivePublishHistoricalDerivativeRecoveryEvidence(evidenceInput(state)),
    assertSource: async () => effect("assertSource"),
    authorizeTask: async plan => effect("authorizeTask", phaseValues("task_authority_verified", plan, state)),
    sealCloudRequest: async plan => effect("sealCloudRequest", phaseValues("cloud_request_sealed", plan, state)),
    recoverCloud: async plan => effect("recoverCloud", phaseValues("cloud_recovered", plan, state)),
    prepareRegistryProjection: async plan => effect("prepareRegistryProjection", phaseValues("registry_projection_prepared", plan, state)),
    projectRegistry: async plan => effect("projectRegistry", phaseValues("registry_projected", plan, state)),
    projectReviewMarker: async plan => effect("projectReviewMarker", phaseValues("review_marker_projected", plan, state)),
    verifyTerminal: async plan => {
      calls.verifyTerminal += 1;
      if (rejectAt === "verifyTerminal") throw new Error("verifyTerminal rejected exact subject");
      if (lostAt === "verifyTerminal" && calls.verifyTerminal === 1) throw new Error("verifyTerminal response lost");
      const result = terminal(plan, state);
      if (terminalDrift && calls.verifyTerminal > 1) {
        const { verificationDigest: _old, ...core } = result;
        const changed = { ...core, verifiedAt: "2026-08-31T03:46:00.000Z" };
        return { ...changed, verificationDigest: D(changed) };
      }
      return result;
    },
  };
  const store = {
    readIntent: () => intent,
    writeIntent: ({ expected, value }) => {
      assert.equal(expected?.intentDigest ?? null, intent?.intentDigest ?? null);
      intent = value;
      return intent;
    },
    withOperationLock: action => action(),
  };
  return { adapter, calls, mutations,
    controller: createActivePublishHistoricalDerivativeRecoveryController({ adapter, store }) };
}
test("current adoption has zero cloud mutation and dormant recovery mutates the same claim once", async () => {
  for (const state of ["current", "dormant-preserved"]) {
    const fixture = fakeControllerFixture({ state });
    const plan = await fixture.controller.plan({ ttlSeconds: 600 });
    const completion = await fixture.controller.run({
      plan, authorization: plan.exactAuthorization,
    });
    assert.equal(completion.claimId, plan.evidence.cloud.claim.claimId);
    assert.equal(completion.cloudMutation, state === "dormant-preserved");
    assert.deepEqual(fixture.mutations, {
      cloud: state === "dormant-preserved" ? 1 : 0, registry: 1, marker: 1,
    });
    const after = { calls: { ...fixture.calls }, mutations: { ...fixture.mutations } };
    const replay = await fixture.controller.run({ plan, authorization: plan.exactAuthorization });
    assert.equal(replay.receiptDigest, completion.receiptDigest);
    assert.deepEqual({ calls: fixture.calls, mutations: fixture.mutations }, after);
  }
});
test("response loss at every boundary resumes idempotently without duplicate mutations", async () => {
  for (const lostAt of ["authorizeTask", "sealCloudRequest", "recoverCloud",
    "prepareRegistryProjection", "projectRegistry", "projectReviewMarker", "verifyTerminal"]) {
    const fixture = fakeControllerFixture({ state: "dormant-preserved", lostAt });
    const plan = await fixture.controller.plan({ ttlSeconds: 600 });
    await assert.rejects(
      fixture.controller.run({ plan, authorization: plan.exactAuthorization }),
      new RegExp(`${lostAt} response lost`), lostAt,
    );
    const completion = await fixture.controller.run({
      plan, authorization: plan.exactAuthorization,
    });
    assert.equal(completion.status, "recovered", lostAt);
    assert.deepEqual(fixture.mutations, { cloud: 1, registry: 1, marker: 1 }, lostAt);
  }
});
test("task capability, registry CAS, marker projection, and terminal drift stop downstream effects", async () => {
  for (const rejectAt of ["authorizeTask", "projectRegistry", "projectReviewMarker",
    "verifyTerminal"]) {
    const fixture = fakeControllerFixture({ state: "dormant-preserved", rejectAt });
    const plan = await fixture.controller.plan({ ttlSeconds: 600 });
    await assert.rejects(
      fixture.controller.run({ plan, authorization: plan.exactAuthorization }),
      new RegExp(`${rejectAt} rejected exact subject`), rejectAt,
    );
    if (rejectAt === "authorizeTask") assert.deepEqual(fixture.mutations,
      { cloud: 0, registry: 0, marker: 0 });
    if (rejectAt === "projectRegistry") assert.deepEqual(fixture.mutations,
      { cloud: 1, registry: 0, marker: 0 });
    if (rejectAt === "projectReviewMarker") assert.deepEqual(fixture.mutations,
      { cloud: 1, registry: 1, marker: 0 });
  }
  const drift = fakeControllerFixture({ terminalDrift: true });
  const plan = await drift.controller.plan({ ttlSeconds: 600 });
  await assert.rejects(
    drift.controller.run({ plan, authorization: plan.exactAuthorization }),
    /terminal evidence drifted/,
  );
});
test("wrong authorization fails before journal and every recovery effect", async () => {
  const fixture = fakeControllerFixture();
  const plan = await fixture.controller.plan({ ttlSeconds: 600 });
  await assert.rejects(fixture.controller.run({ plan, authorization: "wrong" }),
    /Exact authorization required/);
  assert.equal(Object.values(fixture.calls).reduce((sum, value) => sum + value, 0), 0);
  assert.deepEqual(fixture.mutations, { cloud: 0, registry: 0, marker: 0 });
});
test("dead journal lock is recoverable and a live operation remains exclusive", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "historical-derivative-lock-"));
  try {
    const statePath = path.join(root, "intent.json");
    const store = createActivePublishHistoricalDerivativeRecoveryStore({ statePath });
    writeFileSync(`${statePath}.operation.lock`, JSON.stringify({
      operation: "operation", subject: {}, pid: 2_147_483_647, token: "dead-owner",
    }), { mode: 0o600 });
    assert.equal(await store.withOperationLock(() => "recovered"), "recovered");
    await store.withOperationLock(async () => {
      await assert.rejects(store.withOperationLock(() => "unsafe"), /already in progress/);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("CLI plan keeps authorization and private capability out of read-only planning", async () => {
  const { main } = await import("../scripts/active-publish-historical-derivative-recovery.mjs");
  const plan = Object.freeze({ planDigest: D("plan"), exactAuthorization: "authorize exact" });
  const calls = [];
  const dependencies = {
    createAdapter: options => ({ options }),
    createStore: options => ({ options }),
    createController: ({ adapter, store }) => ({
      plan: async options => { calls.push({ adapter, store, options }); return plan; },
    }),
    writePlan: value => calls.push(value),
  };
  const base = ["plan", "--repository=/repo", "--worktree=/worktree", `--branch=${BRANCH}`,
    "--pull-request=838", "--operator-session=session", "--manifest=/tmp/manifest.json",
    "--journal=/tmp/journal.json", "--output=/tmp/plan.json", "--ttl-seconds=600"];
  const result = await main(base, dependencies);
  assert.equal(result.status, "planned");
  assert.equal(result.planDigest, plan.planDigest);
  assert.equal(calls[0].options.ttlSeconds, 600);
  await assert.rejects(main([...base, "--task-authority=/tmp/private"], dependencies),
    /Planning accepts neither authorization nor task capability/);
});
test("repository adapter seams select one cloud effect and seal the exact CAS and marker target", () => {
  const current = buildActivePublishHistoricalDerivativeRecoveryEvidence(evidenceInput());
  const dormant = buildActivePublishHistoricalDerivativeRecoveryEvidence(evidenceInput("dormant-preserved"));
  const resultPlan = buildActivePublishHistoricalDerivativeRecoveryPlan({ evidence: dormant, ttlSeconds: 600 });
  const source = dormant.cloud.claim;
  const sealedRequest = { request: { targetRepository: dormant.cloud.targetRepository, claimId: source.claimId, expectedFenceRevision: source.fenceRevision,
    expectedLedgerRevision: dormant.cloud.ledgerRevision, expectedLedgerDigest: dormant.cloud.ledgerDigest, expectedTransitionCounter: source.transitionCounter,
    mode: "recovery", ttlSeconds: 600, recoveryEvidenceDigest: D("recovery-evidence"), deviceId: dormant.sourceLease.device, sessionId: dormant.sourceLease.sessionId, idempotencyKey: D("cloud-key") } };
  const recovered = { ...dormant.cloud.claim, state: "current", writeAuthority: true,
    transitionCounter: dormant.cloud.claim.transitionCounter + 1, fenceRevision: D("recovered-fence"),
    transitionDigest: D("recovered-transition"), expiresAt: new Date(Date.parse(AT) + 600_000).toISOString() };
  const normalizedRequest = normalizeRootIntent("continue", { ...sealedRequest.request, expiresAt: recovered.expiresAt },
    { actorId: recovered.actorId, deviceId: recovered.deviceId, sessionId: recovered.sessionId }, recovered.repositoryId);
  const { expectedLedgerDigest: _transportCas, ...semanticIntent } = normalizedRequest;
  const operationCore = { schema: "agentic-collaboration-continuation-receipt/v1", operation: "continue", status: "current", repositoryId: recovered.repositoryId,
    claimId: recovered.claimId, claimDigest: recovered.fenceRevision, fenceRevision: recovered.fenceRevision, ledgerRevision: recovered.transitionDigest,
    idempotencyKey: D(sealedRequest.request.idempotencyKey), requestDigest: D({ action: "continue", intent: semanticIntent }), ledgerSequence: 12, evaluationTime: AT };
  const operationReceipt = { ...operationCore, receiptDigest: D(operationCore) }; recovered.operationReceiptDigest = operationReceipt.receiptDigest;
  const providerCore = { schema: "agentic-cloud-collaboration-github-receipt/v1", action: "continue", ledgerRevision: S("a"), ledgerDigest: D("next-ledger"),
    claimId: recovered.claimId, claimDigest: recovered.fenceRevision, contractReceiptDigest: operationReceipt.receiptDigest, sequence: 12, evaluationTime: AT };
  const result = { schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "continue", status: "current", replayed: false,
    ledgerRevision: providerCore.ledgerRevision, claim: recovered, claimDigest: recovered.fenceRevision, operationReceipt, receipt: reseal(providerCore) };
  const returned = assertActivePublishHistoricalDerivativeRecoveryResult(result, resultPlan, sealedRequest, { replayCandidate: false });
  const status = { ledgerRevision: result.ledgerRevision, ledgerDigest: result.receipt.ledgerDigest };
  assert.equal(assertActivePublishHistoricalDerivativeRecoveryLedgerReadback(result, status), status);
  for (const key of ["ledgerRevision", "ledgerDigest"]) assert.throws(() => assertActivePublishHistoricalDerivativeRecoveryLedgerReadback(result, { ...status, [key]: D(key) }), /ledger readback drifted/);
  const wrongKey = clone(result); wrongKey.operationReceipt = reseal({ ...wrongKey.operationReceipt, idempotencyKey: sealedRequest.request.idempotencyKey });
  wrongKey.claim.operationReceiptDigest = wrongKey.operationReceipt.receiptDigest; wrongKey.receipt = reseal({ ...wrongKey.receipt, contractReceiptDigest: wrongKey.operationReceipt.receiptDigest });
  assert.throws(() => assertActivePublishHistoricalDerivativeRecoveryResult(wrongKey, resultPlan, sealedRequest, { replayCandidate: false }), /no exact receipt/);
  for (const mutate of [value => { value.heartbeatCounter += 1; }, value => { value.expiresAt = AT; },
    value => { value.state = "dormant-preserved"; value.writeAuthority = false; }]) { const observed = clone(returned); mutate(observed);
    assert.throws(() => assertActivePublishHistoricalDerivativeRecoveryReadback(returned, observed), /readback|drift/); }
  let effects = 0;
  for (const key of ["controller", "canonicalAdvance", "lane", "sourceLease", "intent", "review"]) { const drifted = clone(current); drifted[key].auditDrift = key;
    assert.throws(() => { assertActivePublishHistoricalDerivativeLocalSubject(drifted, current, `before-${key}`); effects += 1; }, /local source drifted/); }
  assert.equal(effects, 0);
  for (const [claim, disposition] of [[current.cloud.claim, "adopt-current"], [dormant.cloud.claim, "recover-dormant"]])
    assert.equal(classifyActivePublishHistoricalDerivativeTransition(claim, claim), disposition);
  const replay = { ...dormant.cloud.claim, state: "current", writeAuthority: true,
    transitionCounter: dormant.cloud.claim.transitionCounter + 1, fenceRevision: D("recovered-fence"),
    transitionDigest: D("recovered-transition"),
    operationReceiptDigest: D("recovered-operation") };
  assert.equal(classifyActivePublishHistoricalDerivativeTransition(replay,
    dormant.cloud.claim), "replay-recovery");
  const { recordedState: _providerOmission, ...providerCurrent } = current.cloud.claim;
  assert.equal(classifyActivePublishHistoricalDerivativeTransition(providerCurrent, current.cloud.claim), "adopt-current");
  for (const invalid of [{ ...current.cloud.claim, actorId: "github-user:2" },
    { ...current.cloud.claim, writeAuthority: false },
    { ...current.cloud.claim, recordedState: "dormant-preserved" },
    { ...dormant.cloud.claim, writeAuthority: true },
    { ...dormant.cloud.claim, scopeReserved: false }]) assert.throws(() =>
    classifyActivePublishHistoricalDerivativeTransition(invalid, invalid.state === "current"
      ? current.cloud.claim : dormant.cloud.claim), /drift|authority|state/i);
  assert.equal(ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_IMPLEMENTATION_PATHS.length === 6
    && new Set(ACTIVE_PUBLISH_HISTORICAL_DERIVATIVE_RECOVERY_IMPLEMENTATION_PATHS).size === 6, true);
  const sourceDigest = D("source-body"); const targetDigest = D("target-body");
  for (const [observedBodyDigest, disposition] of [[sourceDigest, "project-source"],
    [targetDigest, "adopt-target"]]) assert.deepEqual(
    classifyActivePublishHistoricalDerivativeReviewMarker({ sourceBodyDigest: sourceDigest,
      targetBodyDigest: targetDigest, observedBodyDigest }), { disposition, providerMutation: true });
  assert.throws(() => classifyActivePublishHistoricalDerivativeReviewMarker({
    sourceBodyDigest: sourceDigest, targetBodyDigest: targetDigest,
    observedBodyDigest: D("foreign-body") }), /review marker projection state/);
  const plan = buildActivePublishHistoricalDerivativeRecoveryPlan({ evidence: current });
  const claim = current.cloud.claim;
  const authority = { ...current.sourceLease.lease.cloudAuthority,
    claimId: claim.claimId, claimDigest: claim.fenceRevision,
    claimLedgerRevision: claim.transitionDigest, operationReceiptDigest: claim.operationReceiptDigest,
    canonicalBaseSha: claim.canonicalBaseRevision, laneRevision: claim.laneRevision,
    cloudDeclaredWriteScope: claim.declaredWriteScope, leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter, heartbeatCounter: claim.heartbeatCounter,
    reviewRequestId: claim.reviewRequestId, state: "active", expiresAt: claim.expiresAt };
  const verification = { status: "ready", claimId: claim.claimId,
    claimDigest: authority.claimDigest, receiptDigest: D("cloud-ready") };
  const recoveryCore = { claimId: claim.claimId, authority, claim,
    operationReceiptDigest: claim.operationReceiptDigest, verification,
    verificationReceiptDigest: verification.receiptDigest, recoveredAt: AT,
    expiresAt: claim.expiresAt, disposition: "adopted-current", cloudMutation: false };
  const recovery = { ...recoveryCore, resultDigest: D(recoveryCore) };
  const binding = current.sourceLease.lease.taskAuthority;
  const taskCore = { authoritySubjectId: binding.authoritySubjectId,
    bindingDigest: binding.bindingDigest, proofDigest: D("task-proof"),
    operation: `active-publish-historical-derivative-recovery:${plan.planDigest}`, verifiedAt: AT };
  const taskReceipt = { schema: "agentic-task-authority-verification-receipt/v1",
    status: "verified", proofAdapterId: binding.proofAdapterId, generation: binding.generation,
    ...taskCore, receiptDigest: D(taskCore) };
  const input = { plan, recovery, taskReceipt, sourceLease: current.sourceLease.lease, boundAt: AT };
  const projection = buildActivePublishHistoricalDerivativeRegistryProjection(input);
  assert.deepEqual([projection.targetLease.activePublishSuccessorIntent, projection.targetLease.cloudAuthority.claimId,
    projection.targetLease.taskAuthority.bindingMode, projection.targetLease.taskAuthority.priorBindingDigest],
  [null, claim.claimId, "continuation", current.sourceLease.taskAuthorityBindingDigest]);
  assert.deepEqual(buildActivePublishHistoricalDerivativeRegistryProjection(input), projection);
  for (const changed of [{ ...recovery, claimId: D("foreign-claim") }, { ...recovery, resultDigest: D("tampered-phase") }])
    assert.throws(() => buildActivePublishHistoricalDerivativeRegistryProjection({ ...input, recovery: changed }), /recovery.*drift/i);
  const sourceBody = `Visible\n\n<!-- agentic-writer-lease/v2 ${JSON.stringify(current.review.marker)} -->`;
  const targetBody = updateWriterLeasePullRequestBody(sourceBody, projection.targetLease);
  assert.equal(visibleBodyDigest(targetBody), visibleBodyDigest(sourceBody));
  const markerCore = { schema: "agentic-active-publish-historical-derivative-review-marker/v1", planDigest: plan.planDigest,
    reviewId: plan.evidence.review.id, sourceBodyDigest: plan.evidence.review.bodyDigest, targetBodyDigest: D(targetBody), visibleBodyDigest: plan.evidence.review.visibleBodyDigest,
    targetMarkerDigest: D(projectWriterLeasePullRequestMarker(projection.targetLease)), projectedAt: AT, providerMutation: true, reviewMarkerProjected: true };
  const marker = sealed(markerCore, "receiptDigest");
  const terminalIntent = { phases: { task_authority_verified: { values: taskReceipt }, cloud_recovered: { values: recovery },
    registry_projected: { values: projection }, review_marker_projected: { values: marker } } };
  assert.doesNotThrow(() => assertActivePublishHistoricalDerivativeTerminalReceiptJoins(plan, terminalIntent, projection.targetLease));
  for (const mutate of [...[["reviewId", "review:foreign"], ["sourceBodyDigest", D("foreign-source")], ["visibleBodyDigest", D("foreign-visible")], ["targetMarkerDigest", D("foreign-target")]].map(([key, value]) => context => {
    context.intent.phases.review_marker_projected.values = reseal({ ...context.intent.phases.review_marker_projected.values, [key]: value }); }),
    context => { const receipt = reseal({ ...context.intent.phases.registry_projected.values.registryProjectionReceipt, recoveryReceiptDigest: D("foreign-recovery") }); context.intent.phases.registry_projected.values.registryProjectionReceipt = receipt; context.intent.phases.registry_projected.values.registryProjectionReceiptDigest = receipt.receiptDigest; },
    context => { context.lease.activePublishHistoricalDerivativeRecovery = reseal({ ...context.lease.activePublishHistoricalDerivativeRecovery, cloudOperationReceiptDigest: D("foreign-operation") }); }]) {
    const context = { intent: clone(terminalIntent), lease: clone(projection.targetLease) }; mutate(context);
    assert.throws(() => assertActivePublishHistoricalDerivativeTerminalReceiptJoins(plan, context.intent, context.lease), /embedded receipts|receipt drifted/);
  }
});
