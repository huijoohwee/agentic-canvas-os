import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyCloudTransition, createEmptyLedger } from "../scripts/cloud-collaboration-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { buildActiveAdmittedPrMarkerResponseLossEvidence } from "../scripts/active-admitted-pr-marker-response-loss-evidence.mjs";
import { buildActiveAdmittedPrMarkerResponseLossPlan } from "../scripts/active-admitted-pr-marker-response-loss-contract.mjs";
import { buildExpiredActiveAdmittedPrMarkerResponseLossEvidence } from "../scripts/expired-active-admitted-pr-marker-response-loss-evidence.mjs";
import {
  EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION,
  buildExpiredActiveAdmittedPrMarkerResponseLossPlan,
  normalizeExpiredActiveAdmittedPrMarkerResponseLossIntent,
} from "../scripts/expired-active-admitted-pr-marker-response-loss-contract.mjs";
import { createExpiredActiveAdmittedPrMarkerResponseLossController } from "../scripts/expired-active-admitted-pr-marker-response-loss-controller.mjs";
import { createRepositoryExpiredActiveAdmittedPrMarkerResponseLossAdapter } from "../scripts/expired-active-admitted-pr-marker-response-loss-repository-adapter.mjs";
import {
  parseExpiredActiveAdmittedPrMarkerResponseLossArguments,
  runExpiredActiveAdmittedPrMarkerResponseLoss,
} from "../scripts/expired-active-admitted-pr-marker-response-loss.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability } from "../scripts/task-bound-lane-authority-contract.mjs";
import {
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";
const DIGEST = value => digestValue({ value });
const SHA = value => value.repeat(40);
const BASE_SHA = SHA("1"), HEAD_SHA = SHA("2"), TREE_SHA = SHA("3");
const BRANCH = "agent/test-device.local/expired-marker-response-loss";
const REVIEW_URL = "https://provider.test/example/repository/reviews/19";
const REPOSITORY = { repositoryId: "provider-repository:R_target", canonicalRevision: BASE_SHA };
const ACTOR = { actorId: "provider-user:A_owner", deviceId: "test-device.local",
  sessionId: "owner-session" };
const WRITE_SCOPE = ["path:docs/expired-marker-response-loss.md",
  "semantic:expired-marker-response-loss"];
const TIMES = Object.freeze({
  claim: "2026-08-14T00:00:00.000Z", projection: "2026-08-14T00:01:00.000Z",
  source: "2026-08-14T00:02:00.000Z", target: "2026-08-14T00:03:00.000Z",
  unrelated: "2026-08-14T00:04:00.000Z", activeObserved: "2026-08-14T00:05:00.000Z",
  expiredObserved: "2026-08-14T04:05:00.000Z", initialExpiry: "2026-08-14T01:00:00.000Z",
  sourceExpiry: "2026-08-14T02:00:00.000Z", targetExpiry: "2026-08-14T03:00:00.000Z",
});
function apply(ledger, action, evaluationTime, request) {
  return applyCloudTransition({
    ledger,
    action,
    actor: ACTOR,
    repository: REPOSITORY,
    evaluationTime,
    request: { ...request, expectedLedgerDigest: ledger.headDigest },
  });
}
function authority(claim, ledger, revision) {
  return {
    schema: "agentic-lane-cloud-authority/v1", provider: "fixture-provider",
    ledgerRepository: "coordination/ledger", targetRepository: "example/repository",
    claimId: claim.claimId, claimDigest: claim.fenceRevision, ledgerRevision: revision,
    ledgerDigest: ledger.headDigest, claimLedgerRevision: claim.ledgerRevision,
    entrySchema: claim.entrySchema, claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest,
    canonicalBaseSha: claim.canonicalBaseRevision, laneRevision: claim.laneRevision,
    cloudDeclaredWriteScope: claim.declaredWriteScope, writeSetDigest: claim.writeSetDigest,
    deviceId: ACTOR.deviceId, sessionId: ACTOR.sessionId,
    reviewRequestId: claim.reviewRequestId, leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter, heartbeatCounter: claim.heartbeatCounter,
    state: "active", expiresAt: claim.expiresAt,
  };
}
function activeFixture() {
  const empty = createEmptyLedger(REPOSITORY);
  const claimed = apply(empty, "claim", TIMES.claim, {
    workItemId: `work-item:${DIGEST("work-item")}`,
    canonicalBaseRevision: BASE_SHA,
    laneRevision: HEAD_SHA,
    declaredWriteScope: WRITE_SCOPE,
    leaseEpoch: 1,
    expiresAt: TIMES.initialExpiry,
    idempotencyKey: "expired-marker-claim",
  });
  const projected = apply(claimed.ledger, "continue", TIMES.projection, {
    claimId: claimed.claim.claimId,
    expectedFenceRevision: claimed.claim.fenceRevision,
    expectedTransitionCounter: claimed.claim.transitionCounter,
    mode: "projection",
    laneRevision: HEAD_SHA,
    reviewRequestId: "provider-review:R_19",
    idempotencyKey: "expired-marker-review-projection",
  });
  const sourceKey = ["device-heartbeat", projected.claim.claimId,
    projected.claim.transitionCounter, projected.claim.fenceRevision].join(":");
  const source = apply(projected.ledger, "continue", TIMES.source, {
    claimId: projected.claim.claimId,
    expectedFenceRevision: projected.claim.fenceRevision,
    expectedTransitionCounter: projected.claim.transitionCounter,
    mode: "renewal",
    expiresAt: TIMES.sourceExpiry,
    idempotencyKey: sourceKey,
  });
  const targetKey = ["device-heartbeat", source.claim.claimId,
    source.claim.transitionCounter, source.claim.fenceRevision].join(":");
  const target = apply(source.ledger, "continue", TIMES.target, {
    claimId: source.claim.claimId,
    expectedFenceRevision: source.claim.fenceRevision,
    expectedTransitionCounter: source.claim.transitionCounter,
    mode: "renewal",
    expiresAt: TIMES.targetExpiry,
    idempotencyKey: targetKey,
  });
  const sourceRevision = SHA("a"), targetRevision = SHA("b");
  const sourceAuthority = authority(source.claim, source.ledger, sourceRevision);
  const targetAuthority = authority(target.claim, target.ledger, targetRevision);
  const liveClaim = { ...target.claim, transitionDigest: target.claim.ledgerRevision };
  const input = {
    repository: "example/repository", observedAt: TIMES.activeObserved,
    sourceAuthority, targetAuthority,
    sourceLedgerSnapshot: { revision: sourceRevision, ledger: source.ledger },
    targetLedgerSnapshot: { revision: targetRevision, ledger: target.ledger },
    currentLedgerSnapshot: { revision: targetRevision, ledger: target.ledger },
    liveCloud: { status: "ready", noOverlappingCompetitor: true,
      ledgerRevision: targetRevision, ledgerDigest: target.ledger.headDigest,
      claim: liveClaim, inventoryDigest: DIGEST("active-inventory"),
      verificationReceiptDigest: DIGEST("active-verification") },
    worktree: {
      identityDigest: DIGEST("worktree"), branch: BRANCH, headSha: HEAD_SHA,
      treeSha: TREE_SHA, remoteHeadSha: HEAD_SHA, protectedMainSha: BASE_SHA,
      statusDigest: DIGEST("clean-status"), registered: true, clean: true,
    },
    lease: {
      leaseDigest: DIGEST("lease"), cloudAuthorityDigest: digestValue(targetAuthority),
      admissionDigest: DIGEST("admission"), taskAuthorityBindingDigest: DIGEST("binding"),
      cloudClaimId: target.claim.claimId,
      cloudTransitionCounter: target.claim.transitionCounter,
      cloudHeartbeatCounter: target.claim.heartbeatCounter, status: "active",
      sessionId: ACTOR.sessionId, deviceId: ACTOR.deviceId,
      scope: "expired-marker-response-loss", branch: BRANCH, epoch: 7,
      baseSha: BASE_SHA, fenceSha: HEAD_SHA, heartbeatAt: TIMES.target,
      expiresAt: TIMES.targetExpiry, providerReviewUrl: REVIEW_URL,
    },
    providerReview: {
      adapterId: "urn:provider-adapter:fixture:v1", id: "R_19", url: REVIEW_URL,
      state: "open", draft: true, autoDeliveryAbsent: true,
      headRepository: "example/repository", headBranch: BRANCH, headSha: HEAD_SHA,
      baseBranch: "main", baseSha: BASE_SHA, sourceBodyDigest: DIGEST("source-body"),
      sourceMarkerDigest: digestValue(sourceAuthority),
      targetBodyDigest: DIGEST("target-body"), targetMarkerDigest: digestValue(targetAuthority),
      mutationSemantics: "observable-pre-read-edit-post-read",
    },
  };
  return { input, source, target };
}
function activePlan(fixture = activeFixture()) {
  return buildActiveAdmittedPrMarkerResponseLossPlan({
    evidence: buildActiveAdmittedPrMarkerResponseLossEvidence(fixture.input),
  });
}
function expiredInput({ providerState = "source", unrelatedSuffix = true,
  laterSameClaim = false, overlappingClaim = false,
  observedAt = TIMES.expiredObserved, active = activeFixture() } = {}) {
  const predecessorPlan = activePlan(active);
  let currentLedger = active.target.ledger;
  if (unrelatedSuffix) {
    currentLedger = apply(currentLedger, "claim", TIMES.unrelated, {
      workItemId: `work-item:${DIGEST("unrelated-work-item")}`,
      canonicalBaseRevision: BASE_SHA,
      laneRevision: HEAD_SHA,
      declaredWriteScope: ["path:docs/unrelated.md"],
      leaseEpoch: 1,
      expiresAt: TIMES.targetExpiry,
      idempotencyKey: "expired-unrelated-claim",
    }).ledger;
  }
  if (laterSameClaim) {
    const key = ["device-heartbeat", active.target.claim.claimId,
      active.target.claim.transitionCounter, active.target.claim.fenceRevision].join(":");
    currentLedger = apply(currentLedger, "continue", TIMES.unrelated, {
      claimId: active.target.claim.claimId,
      expectedFenceRevision: active.target.claim.fenceRevision,
      expectedTransitionCounter: active.target.claim.transitionCounter,
      mode: "renewal",
      expiresAt: "2026-08-14T04:00:00.000Z",
      idempotencyKey: key,
    }).ledger;
  }
  const predecessor = predecessorPlan.evidence;
  const targetClaim = {
    ...active.input.liveCloud.claim,
    state: "dormant-preserved",
    recordedState: "current",
    writeAuthority: false,
    scopeReserved: true,
  };
  const claims = [targetClaim];
  if (overlappingClaim) {
    claims.push({
      ...targetClaim,
      claimId: DIGEST("overlapping-claim"),
      actorId: "provider-user:A_competitor",
      workItemId: `work-item:${DIGEST("overlapping-work-item")}`,
      fenceRevision: DIGEST("overlapping-fence"),
      transitionDigest: DIGEST("overlapping-transition"),
      operationReceiptDigest: DIGEST("overlapping-operation"),
    });
  }
  const review = predecessor.providerReview;
  const currentRevision = currentLedger === active.target.ledger ? SHA("b") : SHA("c");
  return {
    predecessorPlan,
    repository: predecessor.repository,
    observedAt,
    currentLedgerSnapshot: { revision: currentRevision, ledger: currentLedger },
    liveCloud: {
      status: "ready",
      evaluatedAt: observedAt,
      ledgerRevision: currentRevision,
      ledgerDigest: currentLedger.headDigest,
      inventoryDigest: digestValue(claims),
      verificationReceiptDigest: DIGEST("expired-verification"),
      claim: targetClaim,
      claims,
    },
    worktree: predecessor.worktree,
    lease: { ...predecessor.lease, admissionStatus: "admitted" },
    providerReview: {
      ...review,
      providerState,
      currentBodyDigest: providerState === "source"
        ? review.sourceBodyDigest : review.targetBodyDigest,
      currentMarkerDigest: providerState === "source"
        ? review.sourceMarkerDigest : review.targetMarkerDigest,
    },
  };
}
function evidence(options) {
  return buildExpiredActiveAdmittedPrMarkerResponseLossEvidence(expiredInput(options));
}
function fakeAdapter({ projection = "source", initialIntent = null } = {}) {
  let intent = initialIntent;
  const calls = [];
  const observed = evidence({ providerState: projection === "target" ? "target" : "source" });
  const targetDigest = observed.providerReview.targetBodyDigest;
  const adapter = {
    async readPlanEvidence() { calls.push("plan-evidence"); return observed; },
    async withOperationLock(action) { calls.push("lock"); return action(); },
    async readIntent() { calls.push("read-intent"); return intent; },
    async writeIntent({ expected, value }) {
      assert.equal(intent, expected);
      intent = value;
      calls.push(`write:${value.status}`);
    },
    async authorizeTask(plan) {
      calls.push("task-proof");
      assert.equal(plan.taskAuthorityOperation,
        `${EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION}:${plan.planDigest}`);
      return { taskAuthorityReceiptDigest: DIGEST("task"),
        bindingDigest: observed.lease.taskAuthorityBindingDigest };
    },
    async revalidate(_plan, stage) {
      calls.push(`revalidate:${stage}`);
      if (stage === "after-provider-error") {
        return projection === "response-loss-target"
          ? { providerProjected: true, disposition: "adopted-response-loss",
            providerMutation: false, projectionDigest: targetDigest }
          : { providerProjected: false, disposition: "third-body" };
      }
      return { revalidationDigest: DIGEST(stage),
        providerState: projection === "target" ? "target" : "source" };
    },
    async projectProviderBody() {
      calls.push("project-provider");
      if (projection.startsWith("response-loss")) throw new Error("provider response lost");
      return { disposition: projection === "target" ? "adopted-response-loss" : "projected",
        providerMutation: projection !== "target", projectionDigest: targetDigest };
    },
    async verifyTerminal(_plan, { replay }) {
      calls.push(`verify-terminal:${replay}`);
      return { verificationDigest: DIGEST(`terminal-${replay}`) };
    },
  };
  return { adapter, calls, intent: () => intent };
}
function leaseEvidence(value) {
  return {
    leaseDigest: writerLeaseDigest(value),
    cloudAuthorityDigest: digestValue(value.cloudAuthority),
    admissionDigest: digestValue(value.admission),
    taskAuthorityBindingDigest: value.taskAuthority.bindingDigest,
    cloudClaimId: value.cloudAuthority.claimId,
    cloudTransitionCounter: value.cloudAuthority.transitionCounter,
    cloudHeartbeatCounter: value.cloudAuthority.heartbeatCounter,
    status: value.status,
    sessionId: value.sessionId,
    deviceId: value.device,
    scope: value.scope,
    branch: value.branch,
    epoch: value.epoch,
    baseSha: value.baseSha,
    fenceSha: value.fenceSha,
    heartbeatAt: value.heartbeatAt,
    expiresAt: value.expiresAt,
    providerReviewUrl: value.pullRequestUrl,
  };
}
function repositoryFixture({ taskCapability = true } = {}) {
  const active = activeFixture();
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "expired-marker-")));
  const repository = path.join(root, "repository"), gitDirectory = path.join(repository, ".git");
  mkdirSync(gitDirectory, { recursive: true });
  const taskAuthorityFile = path.join(root, "task-authority.json");
  writeFileSync(taskAuthorityFile, "{}\n", { mode: 0o600 });
  const admission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: "expired-marker-response-loss",
    declaredWriteSet: WRITE_SCOPE,
    writeSetDigest: active.input.targetAuthority.writeSetDigest,
    manifestDigest: DIGEST("manifest"),
    planReceiptDigest: DIGEST("plan-receipt"),
    admissionReceiptDigest: DIGEST("admission-receipt"),
    existingLaneStateDigest: DIGEST("existing-lanes"),
    admittedReportDigest: DIGEST("admitted-report"),
    preservationReceiptDigest: DIGEST("preservation"),
  };
  const leaseCore = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 7,
    sessionId: ACTOR.sessionId,
    device: ACTOR.deviceId,
    scope: "expired-marker-response-loss",
    branch: BRANCH,
    worktreePath: repository,
    baseSha: BASE_SHA,
    fenceSha: HEAD_SHA,
    pullRequestUrl: REVIEW_URL,
    autoDelivery: false,
    runtimeRequired: false,
    heartbeatAt: TIMES.target,
    expiresAt: TIMES.targetExpiry,
    admission,
    cloudAuthority: active.input.targetAuthority,
  };
  const capability = createTaskAuthorityCapability({ issuedAt: "2026-08-13T00:00:00.000Z" });
  const taskAuthority = createTaskAuthorityBinding({
    capability,
    lease: leaseCore,
    boundAt: "2026-08-13T00:01:00.000Z",
  });
  const currentLease = { ...leaseCore, taskAuthority };
  const sourceLease = { ...currentLease, heartbeatAt: TIMES.source,
    expiresAt: TIMES.sourceExpiry, cloudAuthority: active.input.sourceAuthority };
  const sourceBody = updateWriterLeasePullRequestBody("Review body", sourceLease);
  const targetBody = updateWriterLeasePullRequestBody(sourceBody, currentLease);
  const thirdBody = updateWriterLeasePullRequestBody(sourceBody,
    { ...currentLease, heartbeatAt: "2026-08-14T00:03:30.000Z" });
  const registered = { path: repository, head: HEAD_SHA, branch: `refs/heads/${BRANCH}` };
  active.input.worktree = { identityDigest: digestValue(registered), branch: BRANCH,
    headSha: HEAD_SHA, treeSha: TREE_SHA, remoteHeadSha: HEAD_SHA,
    protectedMainSha: BASE_SHA, statusDigest: digestValue(""), registered: true, clean: true };
  active.input.lease = leaseEvidence(currentLease);
  active.input.providerReview = {
    ...active.input.providerReview,
    adapterId: "github-cli-pull-request-body/v1",
    sourceBodyDigest: digestValue(sourceBody),
    sourceMarkerDigest: digestValue(parseWriterLeasePullRequestBody(sourceBody)),
    targetBodyDigest: digestValue(targetBody),
    targetMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(currentLease)),
  };
  const predecessorPlan = activePlan(active);
  let providerBody = sourceBody, editMode = "success";
  const edits = [], taskAuthorizations = [];
  const review = () => ({ number: 19, id: "R_19", url: REVIEW_URL, state: "OPEN",
    isDraft: true, headRefName: BRANCH, headRefOid: HEAD_SHA,
    headRepository: { nameWithOwner: "example/repository" }, baseRefName: "main",
    baseRefOid: BASE_SHA, autoMergeRequest: null, body: providerBody });
  const dormant = { ...active.input.liveCloud.claim, state: "dormant-preserved",
    writeAuthority: false, scopeReserved: true };
  const dependencies = {
    git(argumentsList) {
      const command = argumentsList.join(" ");
      if (command === "branch --show-current") return BRANCH;
      if (command === "rev-parse --git-common-dir") return ".git";
      if (command === "worktree list --porcelain -z") {
        return `worktree ${repository}\0HEAD ${HEAD_SHA}\0branch refs/heads/${BRANCH}\0`;
      }
      if (command === "rev-parse HEAD") return HEAD_SHA;
      if (command === "rev-parse HEAD^{tree}") return TREE_SHA;
      if (command === "rev-parse origin/main") return BASE_SHA;
      if (command === "status --porcelain=v1 --untracked-files=all") return "";
      if (command === `ls-remote --heads origin refs/heads/${BRANCH}`) {
        return `${HEAD_SHA}\trefs/heads/${BRANCH}`;
      }
      throw new Error(`Unexpected git call: ${command}`);
    },
    gh(argumentsList) {
      if (argumentsList[0] === "pr") return JSON.stringify(review());
      if (argumentsList[0] === "repo") return "example/repository";
      throw new Error(`Unexpected provider read: ${argumentsList.join(" ")}`);
    },
    execute(command, argumentsList) {
      assert.equal(command, "gh");
      edits.push([...argumentsList]);
      const body = argumentsList[argumentsList.indexOf("--body") + 1];
      providerBody = editMode === "error-third" ? thirdBody : body;
      if (editMode.startsWith("error-")) throw new Error("provider response lost");
      return "";
    },
    leaseStore: { read: () => currentLease },
    readCloudStatus: () => ({ schema: "agentic-cloud-collaboration-result/v1",
      ok: true, action: "status", status: "ready", claims: [dormant],
      ledgerRevision: active.input.currentLedgerSnapshot.revision,
      ledgerDigest: active.input.currentLedgerSnapshot.ledger.headDigest }),
    readLedgerSnapshot: () => active.input.currentLedgerSnapshot,
    authorizeTaskMutation(values) {
      taskAuthorizations.push(values);
      return { receiptDigest: DIGEST("task-authorization") };
    },
    now: () => new Date(TIMES.expiredObserved),
  };
  const adapter = createRepositoryExpiredActiveAdmittedPrMarkerResponseLossAdapter({
    repository,
    pullRequestNumber: 19,
    taskAuthorityFile: taskCapability ? taskAuthorityFile : null,
    predecessorPlan,
  }, dependencies);
  return { adapter, predecessorPlan, edits, taskAuthorizations, sourceBody, targetBody,
    body: () => providerBody, setBody(value) { providerBody = value; },
    setEditMode(value) { editMode = value; },
    cleanup() { rmSync(root, { recursive: true, force: true }); } };
}
test("expired evidence preserves a full predecessor and permits only unrelated suffixes", () => {
  const observed = evidence();
  assert.equal(observed.predecessorPlanSnapshot.planDigest, observed.predecessorPlanDigest);
  assert.equal(observed.cloud.effectiveState, "dormant-preserved");
  assert.deepEqual([observed.cloud.writeAuthority, observed.cloud.scopeReserved,
    observed.cloud.unrelatedSuffixEntryCount], [false, true, 1]);
  assert.equal(observed.mutationBoundary.providerReviewBody, true);
  assert.equal(observed.mutationBoundary.cloudLedger, false);
});
test("expired evidence rejects early observation, same-claim suffix, overlap, and provider drift", () => {
  assert.throws(() => evidence({ observedAt: TIMES.activeObserved }), /current cloud observation/u);
  assert.throws(() => evidence({ laterSameClaim: true }), /later same-claim entry/u);
  assert.throws(() => evidence({ overlappingClaim: true }), /overlapping cloud competitor/u);
  const drifted = expiredInput();
  drifted.providerReview.currentBodyDigest = DIGEST("third-body");
  assert.throws(() => buildExpiredActiveAdmittedPrMarkerResponseLossEvidence(drifted),
    /provider projection state/u);
});
test("controller seals capability proof and grants only provider-body journaled recovery", async () => {
  const fixture = fakeAdapter();
  const controller = createExpiredActiveAdmittedPrMarkerResponseLossController(fixture.adapter);
  const plan = await controller.plan();
  assert.equal(plan.taskAuthorityOperation,
    `${EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION}:${plan.planDigest}`);
  assert.equal(Object.hasOwn(plan, "exactAuthorization"), false);
  const receipt = await controller.run({ plan });
  assert.equal(receipt.status, "projection-restored-expired");
  assert.deepEqual(receipt.mutationSet, ["provider-review-body"]);
  assert.equal(receipt.privateJournalMutation, true);
  assert.deepEqual([
    receipt.cloudMutation, receipt.writerRegistryMutation, receipt.gitMutation,
    receipt.remoteRefMutation, receipt.sourceMutation,
    receipt.providerReviewMetadataMutation, receipt.authoringAuthorityGranted,
    receipt.integrationAuthorityGranted, receipt.releaseAuthorityGranted,
    receipt.deploymentAuthorityGranted, receipt.cleanupAuthorityGranted,
  ], Array(11).fill(false));
  assert.deepEqual(fixture.calls, ["plan-evidence", "lock", "read-intent",
    "write:prepared", "revalidate:before-authority", "task-proof",
    "write:authority-verified", "revalidate:before-provider",
    "write:provider-attempted", "project-provider", "write:provider-projected",
    "verify-terminal:false", "write:complete"]);
});
test("controller adopts target and response loss, rejects a third body, and replays terminally", async () => {
  const target = fakeAdapter({ projection: "target" });
  const targetController = createExpiredActiveAdmittedPrMarkerResponseLossController(target.adapter);
  const targetReceipt = await targetController.run({ plan: await targetController.plan() });
  assert.equal(targetReceipt.providerDisposition, "adopted-response-loss");
  assert.equal(targetReceipt.providerMutation, false);
  const lost = fakeAdapter({ projection: "response-loss-target" });
  const lostController = createExpiredActiveAdmittedPrMarkerResponseLossController(lost.adapter);
  const expected = await lostController.run({ plan: await lostController.plan() });
  assert.ok(lost.calls.includes("revalidate:after-provider-error"));
  const replay = fakeAdapter({ initialIntent: lost.intent() });
  const replayed = await createExpiredActiveAdmittedPrMarkerResponseLossController(replay.adapter)
    .run({ plan: lost.intent().planSnapshot });
  assert.equal(replayed.receiptDigest, expected.receiptDigest);
  assert.deepEqual(replay.calls, ["lock", "read-intent", "verify-terminal:true"]);
  const third = fakeAdapter({ projection: "response-loss-third" });
  const thirdController = createExpiredActiveAdmittedPrMarkerResponseLossController(third.adapter);
  const thirdPlan = await thirdController.plan();
  await assert.rejects(() => thirdController.run({ plan: thirdPlan }), /provider response lost/u);
  assert.equal(normalizeExpiredActiveAdmittedPrMarkerResponseLossIntent(third.intent()).status,
    "provider-attempted");
});
test("repository adapter proves capability and performs only canonical body projection", () => {
  const fixture = repositoryFixture();
  try {
    const plan = buildExpiredActiveAdmittedPrMarkerResponseLossPlan({
      evidence: fixture.adapter.readPlanEvidence(),
    });
    const authority = fixture.adapter.authorizeTask(plan);
    assert.equal(authority.taskAuthorityReceiptDigest, DIGEST("task-authorization"));
    assert.equal(fixture.taskAuthorizations[0].operation, plan.taskAuthorityOperation);
    assert.equal(fixture.adapter.revalidate(plan, "before-provider").providerState, "source");
    const projected = fixture.adapter.projectProviderBody(plan);
    assert.deepEqual([projected.disposition, projected.providerMutation], ["projected", true]);
    assert.equal(fixture.body(), fixture.targetBody);
    assert.equal(fixture.edits.length, 1);
    assert.match(fixture.adapter.verifyTerminal(plan).verificationDigest, /^[0-9a-f]{64}$/u);
  } finally { fixture.cleanup(); }
});
test("repository adapter adopts exact target/response loss and rejects drift or missing capability", () => {
  const target = repositoryFixture();
  try {
    const plan = buildExpiredActiveAdmittedPrMarkerResponseLossPlan({
      evidence: target.adapter.readPlanEvidence(),
    });
    target.setBody(target.targetBody);
    assert.deepEqual(target.adapter.projectProviderBody(plan), {
      disposition: "adopted-response-loss",
      providerMutation: false,
      projectionDigest: plan.evidence.providerReview.targetBodyDigest,
    });
    assert.equal(target.edits.length, 0);
  } finally { target.cleanup(); }
  const lost = repositoryFixture();
  try {
    const plan = buildExpiredActiveAdmittedPrMarkerResponseLossPlan({
      evidence: lost.adapter.readPlanEvidence(),
    });
    lost.setEditMode("error-target");
    assert.throws(() => lost.adapter.projectProviderBody(plan), /provider response lost/u);
    assert.equal(lost.adapter.revalidate(plan, "after-provider-error").providerProjected, true);
  } finally { lost.cleanup(); }
  const drift = repositoryFixture();
  try {
    const plan = buildExpiredActiveAdmittedPrMarkerResponseLossPlan({
      evidence: drift.adapter.readPlanEvidence(),
    });
    drift.setEditMode("error-third");
    assert.throws(() => drift.adapter.projectProviderBody(plan), /provider response lost/u);
    assert.throws(() => drift.adapter.revalidate(plan, "after-provider-error"),
      /neither the sealed source nor target/u);
  } finally { drift.cleanup(); }
  const missing = repositoryFixture({ taskCapability: false });
  try {
    const plan = buildExpiredActiveAdmittedPrMarkerResponseLossPlan({
      evidence: missing.adapter.readPlanEvidence(),
    });
    assert.throws(() => missing.adapter.authorizeTask(plan), /requires --task-authority/u);
  } finally { missing.cleanup(); }
});
test("CLI requires sealed predecessor/plan files and keeps dependencies injectable", async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "expired-marker-cli-")));
  try {
    const predecessor = activePlan(), plan = buildExpiredActiveAdmittedPrMarkerResponseLossPlan({
      evidence: evidence(),
    });
    const predecessorFile = path.join(root, "predecessor.json");
    const planFile = path.join(root, "plan.json");
    writeFileSync(predecessorFile, JSON.stringify(predecessor));
    writeFileSync(planFile, JSON.stringify(plan));
    const planned = parseExpiredActiveAdmittedPrMarkerResponseLossArguments([
      "plan", `--repository=${root}`, "--pull-request=19",
      `--predecessor-plan-file=${predecessorFile}`, "--json",
    ]);
    const runnable = parseExpiredActiveAdmittedPrMarkerResponseLossArguments([
      "run", `--repository=${root}`, "--pull-request=19", `--plan-file=${planFile}`,
      `--task-authority=${path.join(root, "capability.json")}`,
    ]);
    assert.equal(planned.predecessorPlan.planDigest, predecessor.planDigest);
    assert.equal(runnable.plan.planDigest, plan.planDigest);
    assert.throws(() => parseExpiredActiveAdmittedPrMarkerResponseLossArguments([
      "run", `--repository=${root}`, "--pull-request=19", `--plan-file=${planFile}`,
    ]), /task-authority is required/u);
    const calls = [];
    const result = await runExpiredActiveAdmittedPrMarkerResponseLoss({
      ...runnable,
      mode: "run",
    }, {
      createAdapter(options) { calls.push(["adapter", options]); return {}; },
      createController() {
        return { run: async ({ plan: received }) => {
          calls.push(["run", received.planDigest]);
          return { status: "stubbed" };
        } };
      },
    });
    assert.equal(result.status, "stubbed");
    assert.equal(calls[0][1].taskAuthorityFile, runnable.taskAuthorityFile);
    assert.deepEqual(calls[1], ["run", plan.planDigest]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
