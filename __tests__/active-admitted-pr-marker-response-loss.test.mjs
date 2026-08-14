import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { applyCloudTransition, createEmptyLedger }
  from "../scripts/cloud-collaboration-contract.mjs";
import { buildActiveAdmittedPrMarkerResponseLossEvidence }
  from "../scripts/active-admitted-pr-marker-response-loss-evidence.mjs";
import {
  ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION,
  buildActiveAdmittedPrMarkerResponseLossPlan,
  normalizeActiveAdmittedPrMarkerResponseLossIntent,
} from "../scripts/active-admitted-pr-marker-response-loss-contract.mjs";
import { createActiveAdmittedPrMarkerResponseLossController }
  from "../scripts/active-admitted-pr-marker-response-loss-controller.mjs";
import { createRepositoryActiveAdmittedPrMarkerResponseLossAdapter }
  from "../scripts/active-admitted-pr-marker-response-loss-repository-adapter.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability }
  from "../scripts/task-bound-lane-authority-contract.mjs";
import { updateWriterLeasePullRequestBody }
  from "../scripts/writer-lease-lib.mjs";

const DIGEST = value => digestValue({ value });
const SHA = value => value.repeat(40);
const BASE_SHA = SHA("1");
const HEAD_SHA = SHA("2");
const TREE_SHA = SHA("3");
const BRANCH = "agent/test-device.local/marker-response-loss";
const REVIEW_URL = "https://provider.test/example/repository/reviews/19";
const REPOSITORY = { repositoryId: "provider-repository:R_target", canonicalRevision: BASE_SHA };
const ACTOR = { actorId: "provider-user:A_owner", deviceId: "test-device.local",
  sessionId: "owner-session" };
const WRITE_SCOPE = ["path:docs/marker-response-loss.md", "semantic:marker-response-loss"];
const TIMES = Object.freeze({
  claim: "2026-08-14T00:00:00.000Z",
  projection: "2026-08-14T00:01:00.000Z",
  source: "2026-08-14T00:02:00.000Z",
  target: "2026-08-14T00:03:00.000Z",
  unrelated: "2026-08-14T00:04:00.000Z",
  observed: "2026-08-14T00:05:00.000Z",
  initialExpiry: "2026-08-14T01:00:00.000Z",
  sourceExpiry: "2026-08-14T02:00:00.000Z",
  targetExpiry: "2026-08-14T03:00:00.000Z",
});

function apply(ledger, action, evaluationTime, request) {
  return applyCloudTransition({ ledger, action, actor: ACTOR, repository: REPOSITORY,
    evaluationTime, request: { ...request, expectedLedgerDigest: ledger.headDigest } });
}

function authority(claim, ledger, revision) {
  return {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "fixture-provider",
    ledgerRepository: "coordination/ledger",
    targetRepository: "example/repository",
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    ledgerRevision: revision,
    ledgerDigest: ledger.headDigest,
    claimLedgerRevision: claim.ledgerRevision,
    entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest,
    canonicalBaseSha: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision,
    cloudDeclaredWriteScope: claim.declaredWriteScope,
    writeSetDigest: claim.writeSetDigest,
    deviceId: ACTOR.deviceId,
    sessionId: ACTOR.sessionId,
    reviewRequestId: claim.reviewRequestId,
    leaseEpoch: claim.leaseEpoch,
    transitionCounter: claim.transitionCounter,
    heartbeatCounter: claim.heartbeatCounter,
    state: "active",
    expiresAt: claim.expiresAt,
  };
}

function evidenceInput({ unrelatedSuffix = true, laterSameClaim = false, malformedLedger = false,
  mismatchedTarget = false } = {}) {
  const empty = createEmptyLedger(REPOSITORY);
  const claimed = apply(empty, "claim", TIMES.claim, {
    workItemId: `work-item:${DIGEST("work-item")}`,
    canonicalBaseRevision: BASE_SHA,
    laneRevision: HEAD_SHA,
    declaredWriteScope: WRITE_SCOPE,
    leaseEpoch: 1,
    expiresAt: TIMES.initialExpiry,
    idempotencyKey: "marker-response-loss-claim",
  });
  const projected = apply(claimed.ledger, "continue", TIMES.projection, {
    claimId: claimed.claim.claimId,
    expectedFenceRevision: claimed.claim.fenceRevision,
    expectedTransitionCounter: claimed.claim.transitionCounter,
    mode: "projection",
    laneRevision: HEAD_SHA,
    reviewRequestId: "provider-review:R_19",
    idempotencyKey: "marker-response-loss-review-projection",
  });
  const firstRenewalKey = ["device-heartbeat", projected.claim.claimId,
    projected.claim.transitionCounter, projected.claim.fenceRevision].join(":");
  const source = apply(projected.ledger, "continue", TIMES.source, {
    claimId: projected.claim.claimId,
    expectedFenceRevision: projected.claim.fenceRevision,
    expectedTransitionCounter: projected.claim.transitionCounter,
    mode: "renewal",
    expiresAt: TIMES.sourceExpiry,
    idempotencyKey: firstRenewalKey,
  });
  const secondRenewalKey = ["device-heartbeat", source.claim.claimId,
    source.claim.transitionCounter, source.claim.fenceRevision].join(":");
  const target = apply(source.ledger, "continue", TIMES.target, {
    claimId: source.claim.claimId,
    expectedFenceRevision: source.claim.fenceRevision,
    expectedTransitionCounter: source.claim.transitionCounter,
    mode: "renewal",
    expiresAt: TIMES.targetExpiry,
    idempotencyKey: secondRenewalKey,
  });
  let currentLedger = target.ledger;
  if (unrelatedSuffix) {
    currentLedger = apply(currentLedger, "claim", TIMES.unrelated, {
      workItemId: `work-item:${DIGEST("unrelated-work-item")}`,
      canonicalBaseRevision: BASE_SHA,
      laneRevision: HEAD_SHA,
      declaredWriteScope: ["path:docs/unrelated.md"],
      leaseEpoch: 1,
      expiresAt: TIMES.targetExpiry,
      idempotencyKey: "unrelated-claim",
    }).ledger;
  }
  if (laterSameClaim) {
    const key = ["device-heartbeat", target.claim.claimId,
      target.claim.transitionCounter, target.claim.fenceRevision].join(":");
    currentLedger = apply(currentLedger, "continue", TIMES.unrelated, {
      claimId: target.claim.claimId,
      expectedFenceRevision: target.claim.fenceRevision,
      expectedTransitionCounter: target.claim.transitionCounter,
      mode: "renewal",
      expiresAt: "2026-08-14T04:00:00.000Z",
      idempotencyKey: key,
    }).ledger;
  }
  if (malformedLedger) {
    currentLedger = structuredClone(currentLedger);
    currentLedger.entries.at(-1).digest = DIGEST("malformed-entry");
  }
  const sourceRevision = SHA("a"), targetRevision = SHA("b");
  const currentRevision = currentLedger === target.ledger ? targetRevision : SHA("c");
  const sourceAuthority = authority(source.claim, source.ledger, sourceRevision);
  const targetAuthority = authority(target.claim, target.ledger, targetRevision);
  if (mismatchedTarget) targetAuthority.claimId = DIGEST("foreign-claim");
  const liveClaim = { ...target.claim, transitionDigest: target.claim.ledgerRevision };
  return {
    repository: "example/repository",
    observedAt: TIMES.observed,
    sourceAuthority,
    targetAuthority,
    sourceLedgerSnapshot: { revision: sourceRevision, ledger: source.ledger },
    targetLedgerSnapshot: { revision: targetRevision, ledger: target.ledger },
    currentLedgerSnapshot: { revision: currentRevision, ledger: currentLedger },
    liveCloud: { status: "ready", noOverlappingCompetitor: true,
      ledgerRevision: currentRevision, ledgerDigest: currentLedger.headDigest,
      claim: liveClaim, inventoryDigest: DIGEST("inventory"),
      verificationReceiptDigest: DIGEST("cloud-verification") },
    worktree: { identityDigest: DIGEST("worktree"), branch: BRANCH, headSha: HEAD_SHA,
      treeSha: TREE_SHA, remoteHeadSha: HEAD_SHA, protectedMainSha: BASE_SHA,
      statusDigest: DIGEST("clean-status"), registered: true, clean: true },
    lease: { leaseDigest: DIGEST("lease"), cloudAuthorityDigest: digestValue(targetAuthority),
      admissionDigest: DIGEST("admission"), taskAuthorityBindingDigest: DIGEST("binding"),
      cloudClaimId: target.claim.claimId, cloudTransitionCounter: target.claim.transitionCounter,
      cloudHeartbeatCounter: target.claim.heartbeatCounter, status: "active",
      sessionId: ACTOR.sessionId, deviceId: ACTOR.deviceId, scope: "marker-response-loss",
      branch: BRANCH, epoch: 7, baseSha: BASE_SHA, fenceSha: HEAD_SHA,
      heartbeatAt: TIMES.target, expiresAt: TIMES.targetExpiry, providerReviewUrl: REVIEW_URL },
    providerReview: { adapterId: "urn:provider-adapter:fixture:v1", id: "R_19", url: REVIEW_URL,
      state: "open", draft: true, autoDeliveryAbsent: true, headRepository: "example/repository",
      headBranch: BRANCH, headSha: HEAD_SHA, baseBranch: "main", baseSha: BASE_SHA,
      sourceBodyDigest: DIGEST("source-body"), sourceMarkerDigest: digestValue(sourceAuthority),
      targetBodyDigest: DIGEST("target-body"), targetMarkerDigest: digestValue(targetAuthority),
      mutationSemantics: "observable-pre-read-edit-post-read" },
  };
}

function evidence(options) {
  return buildActiveAdmittedPrMarkerResponseLossEvidence(evidenceInput(options));
}

function fakeAdapter({ projection = "source", initialIntent = null } = {}) {
  let intent = initialIntent;
  const calls = [];
  const adapter = {
    async readPlanEvidence() { calls.push("plan-evidence"); return evidence(); },
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
        `${ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION}:${plan.planDigest}`);
      return { taskAuthorityReceiptDigest: DIGEST("task"), bindingDigest: DIGEST("binding") };
    },
    async revalidate(_plan, stage) {
      calls.push(`revalidate:${stage}`);
      if (stage === "after-provider-error") {
        if (projection === "response-loss-target") {
          return { providerProjected: true, disposition: "adopted-response-loss",
            providerMutation: false, projectionDigest: DIGEST("target-body") };
        }
        return { providerProjected: false, disposition: "third-body" };
      }
      return stage === "before-provider"
        ? { revalidationDigest: DIGEST("provider-revalidation"),
          providerState: projection === "target" ? "target" : "source" }
        : { revalidationDigest: DIGEST(stage) };
    },
    async projectProviderBody() {
      calls.push("project-provider");
      if (projection.startsWith("response-loss")) throw new Error("provider response lost");
      return { disposition: projection === "target" ? "adopted-response-loss" : "projected",
        providerMutation: projection !== "target", projectionDigest: DIGEST("target-body") };
    },
    async verifyTerminal(_plan, { replay }) {
      calls.push(`verify-terminal:${replay}`);
      return { verificationDigest: DIGEST(`terminal-${replay}`) };
    },
  };
  return { adapter, calls, intent: () => intent };
}

function repositoryAdapterFixture() {
  const input = evidenceInput();
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "marker-response-loss-")));
  const repository = path.join(root, "repository"), gitDirectory = path.join(repository, ".git");
  mkdirSync(gitDirectory, { recursive: true });
  const taskAuthorityFile = path.join(root, "task-authority.json");
  writeFileSync(taskAuthorityFile, "{}\n", { mode: 0o600 });
  const admission = { schema: "agentic-lane-admission-lease/v1", status: "admitted",
    semanticScope: "marker-response-loss", declaredWriteSet: WRITE_SCOPE,
    writeSetDigest: input.targetAuthority.writeSetDigest, manifestDigest: DIGEST("manifest"),
    planReceiptDigest: DIGEST("plan-receipt"), admissionReceiptDigest: DIGEST("admission-receipt"),
    existingLaneStateDigest: DIGEST("existing-lanes"), admittedReportDigest: DIGEST("admitted-report"),
    preservationReceiptDigest: DIGEST("preservation") };
  const leaseCore = { schema: "agentic-writer-lease/v2", status: "active", epoch: 7,
    sessionId: ACTOR.sessionId, device: ACTOR.deviceId, scope: "marker-response-loss", branch: BRANCH,
    worktreePath: repository, baseSha: BASE_SHA, fenceSha: HEAD_SHA, pullRequestUrl: REVIEW_URL,
    autoDelivery: false, runtimeRequired: false, heartbeatAt: TIMES.target,
    expiresAt: TIMES.targetExpiry, admission, cloudAuthority: input.targetAuthority };
  const capability = createTaskAuthorityCapability({ issuedAt: "2026-08-13T00:00:00.000Z" });
  const taskAuthority = createTaskAuthorityBinding({ capability, lease: leaseCore,
    boundAt: "2026-08-13T00:01:00.000Z" });
  const currentLease = { ...leaseCore, taskAuthority };
  const sourceLease = { ...currentLease, heartbeatAt: TIMES.source, expiresAt: TIMES.sourceExpiry,
    cloudAuthority: input.sourceAuthority };
  const sourceBody = updateWriterLeasePullRequestBody("Review body", sourceLease);
  const targetBody = updateWriterLeasePullRequestBody(sourceBody, currentLease);
  const thirdBody = updateWriterLeasePullRequestBody(sourceBody,
    { ...currentLease, heartbeatAt: "2026-08-14T00:03:30.000Z" });
  let providerBody = sourceBody, editMode = "success";
  const edits = [], taskAuthorizations = [];
  const review = () => ({ number: 19, id: "R_19", url: REVIEW_URL, state: "OPEN", isDraft: true,
    headRefName: BRANCH, headRefOid: HEAD_SHA,
    headRepository: { nameWithOwner: "example/repository" }, baseRefName: "main",
    baseRefOid: BASE_SHA, autoMergeRequest: null, body: providerBody });
  const snapshots = new Map([
    [input.sourceLedgerSnapshot.revision, input.sourceLedgerSnapshot],
    [input.targetLedgerSnapshot.revision, input.targetLedgerSnapshot],
    [input.currentLedgerSnapshot.revision, input.currentLedgerSnapshot],
  ]);
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
    readLedgerSnapshot: ({ revision }) => snapshots.get(revision),
    verifyCloud: () => ({ verification: { status: "ready",
      ledgerRevision: input.currentLedgerSnapshot.revision,
      ledgerDigest: input.currentLedgerSnapshot.ledger.headDigest,
      remoteClaimInventoryDigest: DIGEST("inventory"), receiptDigest: DIGEST("verification"),
      verifiedAt: TIMES.observed, inventory: { claims: [input.liveCloud.claim] } } }),
    authorizeTaskMutation(values) {
      taskAuthorizations.push(values);
      return { receiptDigest: DIGEST("task-authorization") };
    },
    now: () => new Date(TIMES.observed),
  };
  const adapter = createRepositoryActiveAdmittedPrMarkerResponseLossAdapter({ repository,
    pullRequestNumber: 19, taskAuthorityFile }, dependencies);
  return { adapter, edits, taskAuthorizations, sourceBody, targetBody,
    body: () => providerBody,
    setBody(value) { providerBody = value; },
    setEditMode(value) { editMode = value; },
    cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

test("evidence proves exactly one renewal and permits only an unrelated ledger suffix", () => {
  const observed = evidence();
  assert.deepEqual([
    observed.renewal.source.transitionCounter,
    observed.renewal.source.heartbeatCounter,
    observed.renewal.target.transitionCounter,
    observed.renewal.target.heartbeatCounter,
    observed.renewal.current.unrelatedSuffixEntryCount,
  ], [3, 1, 4, 2, 1]);
  assert.equal(observed.renewal.current.noOverlappingCompetitor, true);
  assert.equal(observed.renewal.targetAuthorityDigest,
    observed.lease.cloudAuthorityDigest);
});

test("evidence rejects later same-claim renewal, malformed ledger, and joined-subject drift", () => {
  assert.throws(() => evidence({ laterSameClaim: true }), /later same-claim transition/u);
  assert.throws(() => evidence({ malformedLedger: true }), /current ledger is invalid/u);
  assert.throws(() => evidence({ mismatchedTarget: true }), /claim identity/u);
  const mismatchedHead = evidenceInput();
  mismatchedHead.providerReview.headSha = SHA("f");
  assert.throws(() => buildActiveAdmittedPrMarkerResponseLossEvidence(mismatchedHead),
    /marker-only recovery boundary/u);
});

test("repository adapter plans from the exact source, proves task authority, and projects only the body", () => {
  const fixture = repositoryAdapterFixture();
  try {
    const plan = buildActiveAdmittedPrMarkerResponseLossPlan({
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

test("repository adapter adopts an exact target body without a second provider write", () => {
  const fixture = repositoryAdapterFixture();
  try {
    const plan = buildActiveAdmittedPrMarkerResponseLossPlan({
      evidence: fixture.adapter.readPlanEvidence(),
    });
    fixture.setBody(fixture.targetBody);
    assert.equal(fixture.adapter.revalidate(plan, "before-provider").providerState, "target");
    const projected = fixture.adapter.projectProviderBody(plan);
    assert.deepEqual([projected.disposition, projected.providerMutation],
      ["adopted-response-loss", false]);
    assert.equal(fixture.edits.length, 0);
  } finally { fixture.cleanup(); }
});

test("repository adapter reconciles a lost response only when the post-read is the exact target", () => {
  const fixture = repositoryAdapterFixture();
  try {
    const plan = buildActiveAdmittedPrMarkerResponseLossPlan({
      evidence: fixture.adapter.readPlanEvidence(),
    });
    fixture.setEditMode("error-target");
    assert.throws(() => fixture.adapter.projectProviderBody(plan), /provider response lost/u);
    const reconciled = fixture.adapter.revalidate(plan, "after-provider-error");
    assert.deepEqual([reconciled.providerProjected, reconciled.disposition,
      reconciled.providerMutation], [true, "adopted-response-loss", false]);
  } finally { fixture.cleanup(); }
});

test("repository adapter never overwrites or adopts a third provider body after response loss", () => {
  const fixture = repositoryAdapterFixture();
  try {
    const plan = buildActiveAdmittedPrMarkerResponseLossPlan({
      evidence: fixture.adapter.readPlanEvidence(),
    });
    fixture.setEditMode("error-third");
    assert.throws(() => fixture.adapter.projectProviderBody(plan), /provider response lost/u);
    assert.throws(() => fixture.adapter.revalidate(plan, "after-provider-error"),
      /neither the sealed source nor target/u);
    assert.equal(fixture.edits.length, 1);
  } finally { fixture.cleanup(); }
});

test("plan is read-only and seals capability proof to its digest without a human token", async () => {
  const fixture = fakeAdapter();
  const plan = await createActiveAdmittedPrMarkerResponseLossController(fixture.adapter).plan();
  assert.equal(plan.taskAuthorityOperation,
    `${ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION}:${plan.planDigest}`);
  assert.equal(Object.hasOwn(plan, "exactAuthorization"), false);
  assert.deepEqual(fixture.calls, ["plan-evidence"]);
  assert.equal(fixture.intent(), null);
});

test("run verifies task authority, projects one provider body, and grants no other authority", async () => {
  const fixture = fakeAdapter();
  const controller = createActiveAdmittedPrMarkerResponseLossController(fixture.adapter);
  const plan = buildActiveAdmittedPrMarkerResponseLossPlan({ evidence: evidence() });
  const receipt = await controller.run({ plan });
  assert.equal(receipt.status, "projection-restored");
  assert.deepEqual(receipt.mutationSet, ["pull-request-writer-marker"]);
  assert.deepEqual([
    receipt.cloudMutation,
    receipt.writerRegistryMutation,
    receipt.gitMutation,
    receipt.remoteRefMutation,
    receipt.sourceMutation,
    receipt.pullRequestMetadataMutation,
    receipt.authoringAuthorityGranted,
    receipt.integrationAuthorityGranted,
    receipt.deploymentAuthorityGranted,
  ], Array(9).fill(false));
  assert.deepEqual(fixture.calls, [
    "lock", "read-intent", "write:prepared", "revalidate:before-authority", "task-proof",
    "write:authority-verified", "revalidate:before-provider", "write:provider-attempted",
    "project-provider", "write:provider-projected", "verify-terminal:false", "write:complete",
  ]);
  assert.equal(normalizeActiveAdmittedPrMarkerResponseLossIntent(fixture.intent()).status, "complete");
});

test("an already-target provider body completes without widening the mutation boundary", async () => {
  const fixture = fakeAdapter({ projection: "target" });
  const controller = createActiveAdmittedPrMarkerResponseLossController(fixture.adapter);
  const receipt = await controller.run({ plan: await controller.plan() });
  assert.equal(receipt.status, "projection-restored");
  assert.equal(fixture.intent().phases["provider-projected"].values.disposition,
    "adopted-response-loss");
  assert.deepEqual(receipt.mutationSet, ["pull-request-writer-marker"]);
});

test("a lost provider response adopts only an independently observed exact target body", async () => {
  const fixture = fakeAdapter({ projection: "response-loss-target" });
  const controller = createActiveAdmittedPrMarkerResponseLossController(fixture.adapter);
  const receipt = await controller.run({ plan: await controller.plan() });
  assert.equal(receipt.status, "projection-restored");
  assert.equal(fixture.intent().phases["provider-projected"].values.disposition,
    "adopted-response-loss");
  assert.ok(fixture.calls.includes("revalidate:after-provider-error"));
});

test("a third provider body after response loss preserves the attempted journal and fails closed", async () => {
  const fixture = fakeAdapter({ projection: "response-loss-third" });
  const controller = createActiveAdmittedPrMarkerResponseLossController(fixture.adapter);
  const plan = await controller.plan();
  await assert.rejects(() => controller.run({ plan }), /provider response lost/u);
  assert.equal(fixture.intent().status, "provider-attempted");
  assert.equal(fixture.calls.includes("write:provider-projected"), false);
  assert.equal(fixture.calls.includes("verify-terminal:false"), false);
});

test("complete replay performs terminal verification without repeating authority or provider effects", async () => {
  const first = fakeAdapter();
  const controller = createActiveAdmittedPrMarkerResponseLossController(first.adapter);
  const plan = await controller.plan();
  const expected = await controller.run({ plan });
  const replay = fakeAdapter({ initialIntent: first.intent() });
  const replayed = await createActiveAdmittedPrMarkerResponseLossController(replay.adapter).run({ plan });
  assert.equal(replayed.receiptDigest, expected.receiptDigest);
  assert.deepEqual(replay.calls, ["lock", "read-intent", "verify-terminal:true"]);
});
