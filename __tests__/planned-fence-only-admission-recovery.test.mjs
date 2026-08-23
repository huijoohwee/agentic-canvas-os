import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { buildPlannedFenceOnlyAdmissionRecoveryEvidence }
  from "../scripts/planned-fence-only-admission-recovery-evidence.mjs";
import {
  advancePlannedFenceOnlyAdmissionRecoveryIntent,
  buildPlannedFenceOnlyAdmissionRecoveryPlan,
  createPlannedFenceOnlyAdmissionRecoveryIntent,
  normalizePlannedFenceOnlyAdmissionRecoveryIntent,
} from "../scripts/planned-fence-only-admission-recovery-contract.mjs";
import { createPlannedFenceOnlyAdmissionRecoveryController }
  from "../scripts/planned-fence-only-admission-recovery-controller.mjs";
import { createPlannedFenceOnlyAdmissionRecoveryCloudAdapter }
  from "../scripts/planned-fence-only-admission-recovery-cloud-adapter.mjs";
import { createPlannedFenceOnlyAdmissionRecoveryStore }
  from "../scripts/planned-fence-only-admission-recovery-store.mjs";
import {
  assertPlannedFenceOnlyRecoveryReplay,
  plannedFenceOnlyLocalProjectionMatches,
  projectPlannedFenceOnlyRecoveryLease,
  visibleReviewBodyDigest,
} from "../scripts/planned-fence-only-admission-recovery-repository-adapter.mjs";
import { parsePlannedFenceOnlyAdmissionRecoveryArguments }
  from "../scripts/planned-fence-only-admission-recovery.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "../scripts/scoped-lane-admission-lib.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability }
  from "../scripts/task-bound-lane-authority-contract.mjs";
import { parseWriterLeasePullRequestBody, updateWriterLeasePullRequestBody }
  from "../scripts/writer-lease-lib.mjs";
import { pseudonymousIdentifier }
  from "../scripts/github-cloud-collaboration-mapping.mjs";

const D = value => digestValue({ value });
const S = value => value.repeat(40);
const BASE = S("1");
const FENCE = S("2");
const TREE = S("3");
const BRANCH = "agent/test-device.local/planned-fence-only-admission-recovery";
const SCOPE = "planned-fence-only-admission-recovery";
const SESSION = "test-session";
const DEVICE = "test-device.local";
const CLOUD_SESSION = pseudonymousIdentifier("session", SESSION);
const CLOUD_DEVICE = pseudonymousIdentifier("device", DEVICE);
const REPOSITORY = "owner/repository";
const REVIEW = "PR_fixture";
const CLOUD_REVIEW = `github-pull-request:${REVIEW}`;
const EXPIRED = "2026-08-14T01:00:00.000Z";
const OBSERVED = "2026-08-14T02:00:00.000Z";
const RECOVERED = "2026-08-14T03:00:00.000Z";
const TARGET_EXPIRY = "2026-08-14T04:00:00.000Z";
const CAPABILITY = createTaskAuthorityCapability({ issuedAt: "2026-08-14T00:00:00.000Z" });

function fixture() {
  const manifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: SCOPE,
    paths: ["docs/recovery.md"],
  });
  const claim = {
    claimId: D("source-claim"),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "dormant-preserved",
    actorId: "provider-user:A",
    repositoryId: "provider-repository:R",
    workItemId: "work-item:recovery",
    deviceId: CLOUD_DEVICE,
    sessionId: CLOUD_SESSION,
    canonicalBaseRevision: BASE,
    laneRevision: FENCE,
    declaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    leaseEpoch: 1,
    transitionCounter: 3,
    heartbeatCounter: 0,
    reviewRequestId: CLOUD_REVIEW,
    expiresAt: EXPIRED,
    fenceRevision: D("source-fence"),
    transitionDigest: D("source-transition"),
    operationReceiptDigest: D("source-operation"),
    scopeReserved: true,
    writeAuthority: false,
  };
  const cloudAuthority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "fixture-provider",
    ledgerRepository: "coordination/ledger",
    targetRepository: REPOSITORY,
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    ledgerRevision: S("4"),
    ledgerDigest: D("source-ledger"),
    claimLedgerRevision: claim.transitionDigest,
    entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest,
    canonicalBaseSha: BASE,
    laneRevision: FENCE,
    cloudDeclaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    manifestDigest: manifest.manifestDigest,
    deviceId: CLOUD_DEVICE,
    sessionId: CLOUD_SESSION,
    reviewRequestId: CLOUD_REVIEW,
    leaseEpoch: 1,
    transitionCounter: 3,
    state: "active",
    expiresAt: EXPIRED,
  };
  let lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    sessionId: SESSION,
    device: DEVICE,
    scope: SCOPE,
    branch: BRANCH,
    worktreePath: "/tmp/recovery-candidate",
    baseSha: BASE,
    epoch: 7,
    fenceSha: FENCE,
    pullRequestUrl: "https://provider.test/owner/repository/reviews/1",
    heartbeatAt: "2026-08-14T00:30:00.000Z",
    expiresAt: EXPIRED,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "planned",
      semanticScope: SCOPE,
      declaredWriteSet: manifest.declaredWriteSet,
      manifestDigest: manifest.manifestDigest,
      writeSetDigest: manifest.writeSetDigest,
      planReceiptDigest: D("plan-receipt"),
      admissionReceiptDigest: D("admission-receipt"),
      existingLaneStateDigest: D("existing-lane-state"),
    },
    cloudAuthority,
  };
  lease = { ...lease, taskAuthority: createTaskAuthorityBinding({
    capability: CAPABILITY, lease, boundAt: "2026-08-14T00:10:00.000Z",
  }) };
  const body = updateWriterLeasePullRequestBody("## Coordination\n", lease);
  const review = {
    adapterId: "github-cli-hidden-writer-marker/v1",
    id: REVIEW,
    number: 1,
    url: lease.pullRequestUrl,
    state: "OPEN",
    draft: true,
    autoMergeAbsent: true,
    headRepository: REPOSITORY,
    headBranch: BRANCH,
    headSha: FENCE,
    baseBranch: "main",
    baseSha: BASE,
    body,
    bodyDigest: digestValue(body),
    visibleBodyDigest: visibleReviewBodyDigest(body),
    markerDigest: digestValue(parseWriterLeasePullRequestBody(body)),
  };
  const input = {
    observedAt: OBSERVED,
    repository: { id: REPOSITORY, candidatePath: lease.worktreePath,
      canonicalPath: "/tmp/recovery-canonical" },
    sourceLease: lease,
    manifest,
    fence: { branch: BRANCH, headSha: FENCE, treeSha: TREE, parentSha: BASE,
      baseTreeSha: TREE, remoteHeadSha: FENCE, changedPaths: [] },
    localProjection: { mode: "attached", mutationSet: [], branch: BRANCH,
      targetPath: lease.worktreePath, headSha: FENCE, localRefSha: FENCE,
      worktreeRegistered: true, worktreePathPresent: true, worktreeHeadSha: FENCE,
      worktreeTreeSha: TREE, worktreeClean: true, statusDigest: D("candidate-status"),
      branchOwnerCount: 1, targetRecordCount: 1,
      registrationDigest: D("registration"), targetObservationDigest: D("target") },
    canonical: { registered: true, clean: true, branch: "main", headSha: BASE,
      treeSha: TREE, remoteHeadSha: BASE, statusDigest: D("canonical-status") },
    protectedMainAdvance: { baseSha: BASE, baseTreeSha: TREE, headSha: BASE,
      headTreeSha: TREE, baseIsAncestor: true, commitCount: 0, changedPaths: [],
      changedWriteSet: [], disjointFromManifest: true },
    review,
    cloud: { status: "ready", ledgerRevision: S("5"), ledgerDigest: D("ledger"),
      inventoryDigest: D("inventory"), claim, overlappingClaimIds: [] },
  };
  const evidence = buildPlannedFenceOnlyAdmissionRecoveryEvidence(input);
  return { input, evidence, plan: buildPlannedFenceOnlyAdmissionRecoveryPlan({ evidence }),
    lease, manifest, claim, review };
}

function targetAuthority(source) {
  return {
    ...source,
    claimDigest: D("target-fence"),
    ledgerRevision: S("6"),
    ledgerDigest: D("target-ledger"),
    claimLedgerRevision: D("target-transition"),
    operationReceiptDigest: D("target-operation"),
    transitionCounter: source.transitionCounter + 1,
    heartbeatCounter: source.heartbeatCounter ?? 0,
    expiresAt: TARGET_EXPIRY,
    state: "active",
  };
}

function phaseValues(plan) {
  const authority = targetAuthority(plan.evidence.sourceLease.cloudAuthority);
  const sealedTransportDigest = D("sealed-transport");
  const semanticOperationDigest = D("semantic-operation");
  const idempotencyKey = D("idempotency");
  const local = plan.evidence.localProjection;
  const prepared = { mode: local.mode, mutationSet: plan.localMutationSet,
    branch: local.branch, targetPath: local.targetPath, headSha: local.headSha,
    sourceProjectionDigest: plan.evidence.localProjectionDigest,
    protectedMainAdvanceDigest: plan.evidence.protectedMainAdvance.advanceDigest,
    rollbackBoundary: "before-cloud-request-sealed" };
  const restoredBase = { mode: local.mode, mutationSet: plan.localMutationSet,
    branch: local.branch, targetPath: local.targetPath, headSha: local.headSha,
    branchProjectionDigest: D("branch-projection"),
    worktreeProjectionDigest: D("worktree-projection"),
    rollbackBoundary: "before-cloud-request-sealed" };
  const restoredProjection = { schema: "agentic-planned-fence-only-local-projection-restored/v1",
    planDigest: plan.planDigest, mode: restoredBase.mode, mutationSet: restoredBase.mutationSet,
    branch: restoredBase.branch, targetPath: restoredBase.targetPath, headSha: restoredBase.headSha,
    branchProjectionDigest: restoredBase.branchProjectionDigest,
    worktreeProjectionDigest: restoredBase.worktreeProjectionDigest };
  const restored = { ...restoredBase, restoredProjectionDigest: digestValue(restoredProjection) };
  const targetClaimDigest = D("target-claim");
  const leaseDigest = D("target-lease");
  const bodyDigest = D("target-body");
  const markerDigest = D("target-marker");
  const overlappingClaimIdsDigest = digestValue([]);
  const terminalTarget = { schema: "agentic-planned-fence-only-terminal-target/v1",
    planDigest: plan.planDigest, bodyDigest, leaseDigest,
    localProjectionDigest: restored.restoredProjectionDigest, markerDigest,
    overlappingClaimIdsDigest, targetClaimDigest };
  return {
    task: { taskAuthorityReceiptDigest: D("task-proof"),
      bindingDigest: plan.evidence.sourceLease.taskAuthority.bindingDigest },
    prepared,
    restored,
    request: { sealedTransportDigest, idempotencyKey,
      expectedFenceRevision: plan.evidence.cloud.claim.fenceRevision,
      expectedTransitionCounter: plan.evidence.cloud.claim.transitionCounter,
      ttlSeconds: plan.ttlSeconds, recoveryEvidenceDigest: plan.evidence.evidenceDigest },
    cloud: { authority, authorityDigest: digestValue(authority),
      verificationReceiptDigest: D("cloud-verification"), inventoryDigest: D("target-inventory"),
      operationReceiptDigest: authority.operationReceiptDigest,
      providerReceiptDigest: D("provider-receipt"), idempotencyKey,
      sealedTransportDigest, semanticOperationDigest, targetClaimDigest,
      transitionCounter: authority.transitionCounter,
      expiresAt: authority.expiresAt, recoveredAt: RECOVERED, disposition: "projected" },
    lease: { leaseDigest, recoveryReceiptDigest: D("lease-receipt"),
      heartbeatAt: RECOVERED, expiresAt: TARGET_EXPIRY, disposition: "projected" },
    marker: { bodyDigest, visibleBodyDigest: plan.evidence.review.visibleBodyDigest,
      markerDigest, disposition: "projected", providerMutation: true },
    verified: { bodyDigest, cloudVerificationReceiptDigest: D("terminal-cloud"),
      inventoryDigest: D("terminal-inventory"), leaseDigest,
      localProjectionDigest: restored.restoredProjectionDigest, markerDigest,
      overlappingClaimIdsDigest, targetClaimDigest,
      terminalTargetDigest: digestValue(terminalTarget) },
  };
}

function fakeController(plan, { initialIntent = null, terminal = null } = {}) {
  let intent = initialIntent;
  const values = phaseValues(plan);
  const calls = [];
  const adapter = Object.fromEntries([
    ["readPlanEvidence", async () => plan.evidence],
    ["assertSource", async (_plan, stage) => { calls.push(`source:${stage}`); return plan.evidence; }],
    ["authorizeTask", async () => { calls.push("task"); return values.task; }],
    ["prepareLocalProjection", async () => { calls.push("prepare"); return values.prepared; }],
    ["restoreLocalProjection", async () => { calls.push("restore"); return values.restored; }],
    ["sealCloudRequest", async () => { calls.push("seal"); return values.request; }],
    ["recoverCloud", async () => { calls.push("cloud"); return values.cloud; }],
    ["projectLease", async () => { calls.push("lease"); return values.lease; }],
    ["projectReviewMarker", async () => { calls.push("marker"); return values.marker; }],
    ["verifyTerminal", async () => { calls.push("verify"); return terminal || values.verified; }],
  ]);
  const store = {
    readIntent: () => intent,
    writeIntent: ({ expected, value }) => { assert.deepEqual(intent, expected); intent = value; return value; },
    withOperationLock: callback => callback(),
  };
  return { controller: createPlannedFenceOnlyAdmissionRecoveryController({ adapter, store }),
    calls, intent: () => intent, values };
}

function intentAtVerified(plan) {
  const values = phaseValues(plan);
  let intent = createPlannedFenceOnlyAdmissionRecoveryIntent(plan, plan.exactAuthorization);
  for (const [status, value] of [["task_authority_verified", values.task],
    ["local_projection_prepared", values.prepared],
    ["local_projection_restored", values.restored],
    ["cloud_request_sealed", values.request], ["cloud_recovered", values.cloud],
    ["lease_projected", values.lease], ["review_marker_projected", values.marker],
    ["verified", values.verified]]) {
    intent = advancePlannedFenceOnlyAdmissionRecoveryIntent(intent, { status, values: value });
  }
  return intent;
}

test("evidence seals only an expired clean fence-only planned subject", () => {
  const { input, plan } = fixture();
  assert.match(plan.exactAuthorization,
    /^authorize planned-fence-only-admission-recovery [0-9a-f]{64}$/u);
  for (const mutate of [
    value => { value.sourceLease.expiresAt = "invalid"; },
    value => { value.localProjection.worktreeClean = false; },
    value => { value.fence.changedPaths = ["docs/recovery.md"]; },
    value => { value.review.draft = false; },
    value => { value.review.autoMergeAbsent = false; },
    value => { value.cloud.claim.operationReceiptDigest = D("foreign-operation"); },
    value => { value.cloud.overlappingClaimIds = [D("competitor")]; },
  ]) {
    const changed = structuredClone(input);
    mutate(changed);
    assert.throws(() => buildPlannedFenceOnlyAdmissionRecoveryEvidence(changed));
  }
});

test("legacy source heartbeat omission means zero and rejects nonzero drift", () => {
  const { input } = fixture();
  assert.equal(Object.hasOwn(input.sourceLease.cloudAuthority, "heartbeatCounter"), false);
  assert.equal(buildPlannedFenceOnlyAdmissionRecoveryEvidence(input)
    .sourceLease.cloudAuthority.heartbeatCounter, undefined);

  const nonzeroCloud = structuredClone(input);
  nonzeroCloud.cloud.claim.heartbeatCounter = 1;
  assert.throws(() => buildPlannedFenceOnlyAdmissionRecoveryEvidence(nonzeroCloud));

  const explicitCounter = structuredClone(input);
  explicitCounter.sourceLease.cloudAuthority.heartbeatCounter = 4;
  explicitCounter.cloud.claim.heartbeatCounter = 4;
  explicitCounter.review.body = updateWriterLeasePullRequestBody(
    "## Coordination\n", explicitCounter.sourceLease,
  );
  explicitCounter.review.bodyDigest = digestValue(explicitCounter.review.body);
  explicitCounter.review.visibleBodyDigest = visibleReviewBodyDigest(explicitCounter.review.body);
  explicitCounter.review.markerDigest = digestValue(
    parseWriterLeasePullRequestBody(explicitCounter.review.body),
  );
  assert.equal(buildPlannedFenceOnlyAdmissionRecoveryEvidence(explicitCounter)
    .cloud.claim.heartbeatCounter, 4);

  explicitCounter.cloud.claim.heartbeatCounter = 5;
  assert.throws(() => buildPlannedFenceOnlyAdmissionRecoveryEvidence(explicitCounter));
});

test("replay permits only a disjoint descendant canonical advance", () => {
  const { plan } = fixture();
  const current = structuredClone(plan.evidence);
  const headSha = S("9");
  const headTreeSha = S("8");
  const changedPaths = ["scripts/disjoint.mjs"];
  const changedWriteSet = changedPaths.map(candidate => `path:${candidate}`);
  current.canonical = { ...current.canonical, headSha, treeSha: headTreeSha,
    remoteHeadSha: headSha };
  current.protectedMainAdvance = { ...current.protectedMainAdvance,
    headSha, headTreeSha, commitCount: 1, changedPaths, changedWriteSet,
    changedPathsDigest: digestValue(changedPaths),
    changedWriteSetDigest: digestValue(changedWriteSet),
    disjointFromManifest: true };
  current.protectedMainAdvance.advanceDigest = digestValue(Object.fromEntries(
    Object.entries(current.protectedMainAdvance).filter(([key]) => key !== "advanceDigest"),
  ));

  assert.doesNotThrow(() => assertPlannedFenceOnlyRecoveryReplay({
    sealed: plan.evidence, current, isAncestor: () => true, stage: "replay",
  }));
  assert.throws(() => assertPlannedFenceOnlyRecoveryReplay({
    sealed: plan.evidence, current, isAncestor: () => false, stage: "replay",
  }), /protected main drifted/u);

  const overlapping = structuredClone(current);
  overlapping.protectedMainAdvance.changedWriteSet = plan.evidence.manifest.declaredWriteSet;
  assert.throws(() => assertPlannedFenceOnlyRecoveryReplay({
    sealed: plan.evidence, current: overlapping, isAncestor: () => true, stage: "replay",
  }), /protected main drifted/u);

  const foreign = structuredClone(current);
  foreign.review.number += 1;
  assert.throws(() => assertPlannedFenceOnlyRecoveryReplay({
    sealed: plan.evidence, current: foreign, isAncestor: () => true, stage: "replay",
  }), /source drifted/u);
});

test("local replay ignores only unrelated worktree registry movement", () => {
  const { plan } = fixture();
  const expected = plan.evidence.localProjection;
  assert.equal(plannedFenceOnlyLocalProjectionMatches(expected, {
    ...expected, registrationDigest: D("later-registry"),
  }), true);
  assert.equal(plannedFenceOnlyLocalProjectionMatches(expected, {
    ...expected, targetObservationDigest: D("foreign-target"),
  }), false);
  assert.equal(plannedFenceOnlyLocalProjectionMatches(expected, {
    ...expected, headSha: S("9"),
  }), false);
});

test("raw GitHub review identities normalize only for the repository adapter", () => {
  const { input } = fixture();
  assert.equal(buildPlannedFenceOnlyAdmissionRecoveryEvidence(input)
    .sourceLease.cloudAuthority.reviewRequestId, CLOUD_REVIEW);

  const wrongIdentity = structuredClone(input);
  wrongIdentity.review.id = "PR_foreign";
  assert.throws(() => buildPlannedFenceOnlyAdmissionRecoveryEvidence(wrongIdentity));

  const foreignAdapter = structuredClone(input);
  foreignAdapter.review.adapterId = "fixture-review-adapter/v1";
  assert.throws(() => buildPlannedFenceOnlyAdmissionRecoveryEvidence(foreignAdapter));
});

test("controller completes once, denies authority, and replays durable completion", async () => {
  const { plan } = fixture();
  const state = fakeController(plan);
  const completion = await state.controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(completion.status, "recovered-planned-fence-only");
  assert.equal(completion.admissionStatus, "planned");
  assert.equal(completion.authoringAuthority, false);
  assert.equal(completion.mutationAuthorityGranted, false);
  assert.equal(completion.deploymentAuthority, false);
  const calls = [...state.calls];
  assert.deepEqual(await state.controller.run({ plan, authorization: plan.exactAuthorization }), completion);
  assert.deepEqual(state.calls, calls);
  assert.throws(() => normalizePlannedFenceOnlyAdmissionRecoveryIntent({
    ...state.intent(), completion: { ...completion, authoringAuthority: true },
  }));
});

test("verified replay revalidates and rejects terminal drift", async () => {
  const { plan } = fixture();
  const intent = intentAtVerified(plan);
  const state = fakeController(plan, { initialIntent: intent,
    terminal: { ...phaseValues(plan).verified, markerDigest: D("drift") } });
  await assert.rejects(state.controller.run({ plan, authorization: plan.exactAuthorization }),
    /terminal target lineage|terminal evidence drifted/u);
  assert.equal(state.intent().status, "verified");
});

test("cloud recovery joins the exact operation and provider receipts", () => {
  const { plan, claim } = fixture();
  let result;
  const inspect = () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
    action: "status", status: "ready", ledgerRevision: S("5"), ledgerDigest: D("ledger"),
    claims: [claim] });
  const verify = ({ authority }) => ({ authority, verification: { status: "ready",
    inventory: { claims: [result.claim] }, receiptDigest: D("verification"),
    remoteClaimInventoryDigest: D("verified-inventory"), verifiedAt: RECOVERED } });
  const adapter = createPlannedFenceOnlyAdmissionRecoveryCloudAdapter({
    inspect,
    invoke: () => result,
    verify,
  });
  const sealed = adapter.sealRequest(plan);
  assert.deepEqual(Object.keys(sealed).sort(), [
    "expectedFenceRevision", "expectedTransitionCounter", "idempotencyKey",
    "recoveryEvidenceDigest", "sealedTransportDigest", "ttlSeconds",
  ]);
  const expiresAt = new Date(Date.parse(RECOVERED) + plan.ttlSeconds * 1_000).toISOString();
  const requestDigest = digestValue({ action: "continue", intent: {
    repositoryId: claim.repositoryId, actorId: claim.actorId, deviceId: DEVICE,
    sessionId: SESSION, claimId: claim.claimId, expectedFenceRevision: claim.fenceRevision,
    expectedTransitionCounter: claim.transitionCounter, mode: "recovery", laneRevision: null,
    reviewRequestId: null, expiresAt, focusedEvidenceDigest: null, handoffEvidenceDigest: null,
    recoveryEvidenceDigest: plan.evidence.evidenceDigest,
  } });
  const target = { ...claim, state: "current", writeAuthority: true, transitionCounter: 4,
    expiresAt, fenceRevision: D("target-fence"), transitionDigest: D("target-transition") };
  const operationCore = { schema: "agentic-collaboration-continuation-receipt/v1",
    operation: "continue", status: "current", repositoryId: claim.repositoryId,
    claimId: claim.claimId, claimDigest: target.fenceRevision, fenceRevision: target.fenceRevision,
    ledgerRevision: target.transitionDigest, ledgerSequence: 4, idempotencyKey: sealed.idempotencyKey,
    requestDigest, evaluationTime: RECOVERED };
  const operationReceipt = { ...operationCore, receiptDigest: digestValue(operationCore) };
  target.operationReceiptDigest = operationReceipt.receiptDigest;
  const providerCore = { schema: "agentic-cloud-collaboration-github-receipt/v1",
    action: "continue", ledgerRevision: S("7"), ledgerDigest: D("provider-ledger"),
    claimId: claim.claimId, claimDigest: target.fenceRevision,
    contractReceiptDigest: operationReceipt.receiptDigest, sequence: 4, evaluationTime: RECOVERED };
  result = { schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "continue",
    status: "current", replayed: false, attempts: 1, ledgerRevision: providerCore.ledgerRevision,
    claim: target, claimDigest: target.fenceRevision, operationReceipt,
    receipt: { ...providerCore, receiptDigest: digestValue(providerCore) } };
  const recovered = adapter.recover({ plan, sealedRequest: sealed });
  assert.equal(recovered.operationReceiptDigest, operationReceipt.receiptDigest);
  assert.equal(recovered.semanticOperationDigest, requestDigest);
  const forged = structuredClone(result);
  forged.operationReceipt.requestDigest = D("foreign-request");
  assert.throws(() => createPlannedFenceOnlyAdmissionRecoveryCloudAdapter({
    inspect, invoke: () => forged, verify,
  }).recover({ plan, sealedRequest: sealed }), /same-claim dormant recovery result/u);
});

test("same-review competitor blocks even when its write set is disjoint", () => {
  const { lease, manifest, claim } = fixture();
  const competitor = { ...claim, claimId: D("competitor"),
    declaredWriteScope: ["path:docs/disjoint.md"], writeSetDigest: D("disjoint"),
    fenceRevision: D("competitor-fence"), transitionDigest: D("competitor-transition"),
    operationReceiptDigest: D("competitor-operation"), state: "current", writeAuthority: true };
  const inspect = () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
    action: "status", status: "ready", ledgerRevision: S("8"), ledgerDigest: D("ledger"),
    claims: [claim, competitor] });
  assert.throws(() => createPlannedFenceOnlyAdmissionRecoveryCloudAdapter({ inspect })
    .inspectDormant({ sourceAuthority: lease.cloudAuthority, sourceLease: lease, manifest }),
  /overlapping cloud reservation/u);
});

test("dormant inspection joins opaque cloud owners to local lease labels", () => {
  const { lease, manifest, claim } = fixture();
  const opaqueDevice = pseudonymousIdentifier("device", lease.device);
  const opaqueSession = pseudonymousIdentifier("session", lease.sessionId);
  const projectedClaim = { ...claim, deviceId: opaqueDevice, sessionId: opaqueSession };
  const projectedLease = structuredClone(lease);
  projectedLease.cloudAuthority.deviceId = opaqueDevice;
  projectedLease.cloudAuthority.sessionId = opaqueSession;
  const inspect = () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
    action: "status", status: "ready", ledgerRevision: S("8"), ledgerDigest: D("ledger"),
    claims: [projectedClaim] });
  const evidence = createPlannedFenceOnlyAdmissionRecoveryCloudAdapter({ inspect })
    .inspectDormant({ sourceAuthority: projectedLease.cloudAuthority,
      sourceLease: projectedLease, manifest });
  assert.equal(evidence.claim.deviceId, opaqueDevice);
  assert.equal(evidence.claim.sessionId, opaqueSession);
});

test("lease projection preserves lane identity and changes only recovery fields", () => {
  const { lease, plan } = fixture();
  const authority = targetAuthority(lease.cloudAuthority);
  const receipt = { recoveredAt: RECOVERED };
  const target = projectPlannedFenceOnlyRecoveryLease({ sourceLease: lease,
    recoveredAuthority: authority, recoveryReceipt: receipt });
  for (const key of ["branch", "scope", "device", "sessionId", "epoch", "baseSha", "fenceSha",
    "worktreePath", "pullRequestUrl", "taskAuthority", "admission"]) {
    assert.deepEqual(target[key], lease[key]);
  }
  assert.equal(target.cloudAuthority, authority);
  assert.equal(target.heartbeatAt, RECOVERED);
  assert.equal(plan.evidence.sourceLeaseDigest, digestValue(lease));
});

test("CLI requires private external artifacts and preserves the state path", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "planned-fence-cli-"));
  const repository = path.join(root, "repository");
  mkdirSync(repository);
  const manifest = path.join(root, "manifest.json");
  const plan = path.join(root, "plan.json");
  const capability = path.join(root, "capability.json");
  for (const file of [manifest, plan, capability]) writeFileSync(file, "{}", { mode: 0o600 });
  const state = path.join(root, "state.json");
  const parsed = parsePlannedFenceOnlyAdmissionRecoveryArguments(["run",
    `--repository=${repository}`, `--worktree=${path.join(root, "target")}`,
    `--branch=${BRANCH}`, `--session=${SESSION}`, `--manifest=${manifest}`,
    `--state-path=${state}`, `--plan-file=${plan}`, `--task-authority=${capability}`,
    "--authorize=authorize planned-fence-only-admission-recovery deadbeef", "--json"]);
  assert.equal(parsed.statePath, state);
  assert.equal(parsed.ttlSeconds, 3600);
  assert.equal(parsed.json, true);
  chmodSync(manifest, 0o644);
  assert.throws(() => parsePlannedFenceOnlyAdmissionRecoveryArguments(["plan",
    `--repository=${repository}`, `--worktree=${path.join(root, "target")}`,
    `--branch=${BRANCH}`, `--session=${SESSION}`, `--manifest=${manifest}`]));
  rmSync(root, { recursive: true });
});

test("store recovers only a dead private lock and retains live-owner exclusion", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "planned-fence-store-"));
  const state = path.join(root, "state.json");
  const store = createPlannedFenceOnlyAdmissionRecoveryStore({
    gitCommonDir: root, branch: BRANCH, statePath: state,
  });
  const lock = `${state}.lock`;
  writeFileSync(lock, JSON.stringify({
    schema: "agentic-planned-fence-only-admission-recovery-lock/v1",
    pid: 999_999, processIdentity: "dead process", token: "dead-owner", createdAt: OBSERVED,
  }), { mode: 0o600 });
  assert.equal(await store.withOperationLock(async () => "recovered"), "recovered");
  await store.withOperationLock(async () => {
    await assert.rejects(store.withOperationLock(async () => "unsafe"), /owns this journal/u);
  });
  rmSync(root, { recursive: true });
});
