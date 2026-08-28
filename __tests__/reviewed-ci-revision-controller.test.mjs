import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  advanceReviewedCiRevisionIntent,
  buildReviewedCiRevisionPlan,
  buildReviewedCiTerminalVerification,
  createReviewedCiRevisionIntentMarker,
  createReviewedCiRevisionPullRequestBootstrap,
  reviewedCiRevisionProviderBoundaryDigest,
  reviewedCiRevisionSourceProjectionBodyDigest,
} from "../scripts/reviewed-ci-revision-contract.mjs";
import {
  createReviewedCiRevisionControllerAdapter,
  projectReviewedCiRemoteActive,
  reviewedCiRevisionOperationKey,
  ReviewedCiRevisionEpochDriftError,
  runReviewedCiRevisionRecovery,
} from "../scripts/reviewed-ci-revision-controller.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { sourceFixture } from "./reviewed-ci-revision-contract.test.mjs";
import {
  integrateSession,
  renderProtectedMainRefreshCommitMessage,
} from "../scripts/device-integrate-lib.mjs";
import { review } from "../scripts/device-branch-lib.mjs";
import { assertAdmissionMutationAuthority } from "../scripts/scoped-lane-admission-state.mjs";
import {
  beginReviewedLaneRevisionIntent,
  readReviewedLaneRevisionIntent,
  supersedePreparedReviewedLaneRevisionIntent,
} from "../scripts/reviewed-lane-revision-fence.mjs";
import { createWriterLeaseStore } from "../scripts/writer-lease-lib.mjs";
import {
  casWriterLeaseProjection,
  writerLeaseDigest,
} from "../scripts/writer-lease-registry-cas.mjs";

const D = value => String(value).repeat(64);

function harness({ failClaimOnce = false, driftAt = null, responseAheadAt = null,
  wrongAheadKey = false, deliveryAt = null, derivativeState = "waiting-successor",
  epochDrifts = 0, failRemoteOnce = false, failAbortOnce = false } = {}) {
  const source = sourceFixture();
  const plan = buildReviewedCiRevisionPlan({ source });
  const calls = [];
  let stored = null;
  let claimAttempts = 0;
  let finalReceipt = null;
  let archive = null;
  let remainingEpochDrifts = epochDrifts;
  let remoteWritten = false, abortAttempts = 0, derivativeRetired = false;
  const operation = name => reviewedCiRevisionOperationKey(plan, name);
  const successor = { claimId: D(2), claimDigest: D(3), transitionCounter: 4,
    operationReceiptDigest: D(4), requestDigest: D(5), receiptDigest: D(6),
    ledgerDigest: D(7), state: "waiting-successor",
    canonicalBaseSha: plan.successorCanonicalBaseSha, laneRevision: plan.sourceHeadSha,
    leaseEpoch: plan.successorCloudLeaseEpoch };
  const bootstrap = createReviewedCiRevisionPullRequestBootstrap(plan);
  const providerBoundaryDigest = reviewedCiRevisionProviderBoundaryDigest(plan);
  const replacement = { operationKey: operation("create-replacement-pr"),
    pullRequestNumber: 345, pullRequestNodeId: "PR_replacement",
    url: "https://github.com/owner/repository/pull/345", state: "OPEN", isDraft: true,
    title: bootstrap.title, bodyDigest: bootstrap.bodyDigest,
    providerDisposition: "created", providerBoundaryDigest,
    headSha: plan.sourceHeadSha, baseSha: plan.observedProtectedMainSha,
    authorLogin: "owner" };
  const promotedAuthority = { ...source.authority, claimId: successor.claimId,
    claimDigest: D(9), state: "active", transitionCounter: 5,
    operationReceiptDigest: D("a"), reviewRequestId: null, focusedEvidenceDigest: null };
  const boundAuthority = { ...promotedAuthority, claimDigest: D("b"), transitionCounter: 6,
    operationReceiptDigest: D("c"), reviewRequestId: "github-pull-request:PR_replacement" };
  function valuesFor(method, intent) {
    if (method === "projectRecoveryIntent") return { operationKey: operation("intent-marker"),
      pullRequestNodeId: plan.pullRequestNodeId,
      markerDigest: digestValue(createReviewedCiRevisionIntentMarker(plan)),
      writerMarkerDigest: plan.sourceWriterMarkerDigest,
      bodyDigest: reviewedCiRevisionSourceProjectionBodyDigest(plan) };
    if (method === "claimSuccessor") return { ...successor, operationKey: operation("claim") };
    if (method === "retireSource") return { operationKey: operation("retire-source"),
      sourceClaimId: plan.sourceClaimId, successorClaimId: successor.claimId,
      receiptDigest: D("e"), operationReceiptDigest: D("f"), ledgerDigest: D(1), state: "retired" };
    if (method === "closeSourcePullRequest") return { operationKey: operation("close-source-pr"),
      pullRequestNumber: plan.pullRequestNumber, pullRequestNodeId: plan.pullRequestNodeId,
      url: plan.pullRequestUrl, state: "CLOSED", closedAt: "2026-08-09T00:00:01.000Z",
      mergedAt: null, headSha: plan.sourceHeadSha, baseSha: plan.successorCanonicalBaseSha,
      bodyDigest: intent.sourceProjection.values.bodyDigest, bodyDisposition: "recovery-projection",
      providerDisposition: "closed", providerBoundaryDigest };
    if (method === "createRevisionPullRequest") return replacement;
    if (method === "promoteSuccessor") return { ...successor,
      operationKey: operation("promote-successor"), state: "current", claimDigest: D(9),
      transitionCounter: 5, receiptDigest: D(2), operationReceiptDigest: D("a"),
      authority: promotedAuthority, authorityDigest: digestValue(promotedAuthority) };
    if (method === "bindSuccessor") return { operationKey: operation("bind-successor"),
      authority: boundAuthority, authorityDigest: digestValue(boundAuthority),
      claimId: successor.claimId, claimDigest: boundAuthority.claimDigest,
      transitionCounter: boundAuthority.transitionCounter,
      operationReceiptDigest: boundAuthority.operationReceiptDigest,
      receiptDigest: boundAuthority.operationReceiptDigest, verificationReceiptDigest: D(3),
      verifiedAt: source.verification.verifiedAt };
    if (intent.pullRequestProjectionCandidate) {
      return intent.pullRequestProjectionCandidate.values;
    }
    const terminalVerification = buildReviewedCiTerminalVerification({
      authorityDigest: digestValue(boundAuthority), receiptDigest: D("d"),
      verifiedAt: "2026-08-09T00:00:02.000Z", expiresAt: boundAuthority.expiresAt,
    });
    const projection = projectReviewedCiRemoteActive({ plan, intent, lease: source.lease,
      epoch: 13 + calls.filter(value => value === "prepare-pr-marker").length,
      terminalVerification });
    finalReceipt = projection.finalReceipt;
    return { operationKey: operation("active-pr-marker"), pullRequestNodeId: replacement.pullRequestNodeId,
      bodyDigest: projection.bodyDigest, writerMarker: projection.writerMarker,
      recoveryMarker: projection.recoveryMarker, localProjection: projection.localProjection,
      activeLease: projection.intendedLease, finalReceipt: projection.finalReceipt,
      remoteProofDigest: projection.remoteProofDigest };
  }
  function deliveryEvidence() {
    const derivative = derivativeRetired ? null : { claimId: successor.claimId, claimDigest: successor.claimDigest,
      transitionCounter: successor.transitionCounter, operationReceiptDigest: successor.operationReceiptDigest,
      state: derivativeState, predecessorClaimId: plan.sourceClaimId, actorId: plan.sourceActorId,
      repositoryId: plan.sourceRepositoryId, workItemId: plan.sourceWorkItemId,
      deviceId: plan.sourceDeviceId, sessionId: plan.sourceSessionId,
      canonicalBaseSha: plan.successorCanonicalBaseSha, laneRevision: plan.sourceHeadSha,
      writeSetDigest: plan.writeSetDigest, leaseEpoch: plan.successorCloudLeaseEpoch };
    const core = { schema: "agentic-reviewed-ci-revision-delivery-won/v1",
      sourceClaimId: plan.sourceClaimId, sourceState: "integrated-preserved",
      sourcePullRequestNodeId: plan.pullRequestNodeId, sourcePullRequestState: "OPEN",
      sourceMergedAt: null, deliveryReceiptDigest: D(4), derivative };
    return { ...core, evidenceDigest: digestValue(core) };
  }
  const adapter = createReviewedCiRevisionControllerAdapter({
    async assertExecutionFence() { calls.push("fence"); },
    async readState() { return archive ? { archive } : stored ? { intent: stored } : { source, ttlSeconds: 1_800 }; },
    async beginIntent({ intent }) { calls.push("begin"); stored = intent; return stored; },
    async advanceIntent({ next }) { calls.push(`cas:${next.status}`); stored = next; return stored; },
    async reconcilePhase({ phase }) {
      calls.push(`reconcile:${phase}`);
      if (driftAt === phase) throw new Error("foreign owner drift");
    },
    async reconcileTransition({ intent, method, operationKey }) {
      calls.push(`transition:${method}`);
      if (driftAt === intent.status) throw new Error("foreign owner drift");
      if (deliveryAt === method) return { kind: "delivery-won", evidence: deliveryEvidence() };
      if (method === "projectPullRequest" && remoteWritten) return {
        kind: "response-ahead", operationKey,
        values: intent.pullRequestProjectionCandidate.values };
      if (responseAheadAt === method || (failClaimOnce && method === "claimSuccessor" && claimAttempts === 1)) {
        const exact = wrongAheadKey ? `${operationKey}:foreign` : operationKey;
        return { kind: "response-ahead", operationKey: exact,
          values: { ...valuesFor(method, intent), operationKey: exact } };
      }
      return { kind: "pending" };
    },
    async projectRecoveryIntent({ intent }) { calls.push("intent-marker"); return valuesFor("projectRecoveryIntent", intent); },
    async claimSuccessor() {
      calls.push("claim");
      claimAttempts += 1;
      if (failClaimOnce && claimAttempts === 1) throw new Error("response lost");
      return valuesFor("claimSuccessor");
    },
    async retireSource({ intent }) { calls.push("retire"); return valuesFor("retireSource", intent); },
    async closeSourcePullRequest({ intent }) { calls.push("close"); return valuesFor("closeSourcePullRequest", intent); },
    async createRevisionPullRequest({ intent }) { calls.push("create-pr"); return valuesFor("createRevisionPullRequest", intent); },
    async promoteSuccessor({ intent }) { calls.push("promote"); return valuesFor("promoteSuccessor", intent); },
    async bindSuccessor({ intent }) { calls.push("bind"); return valuesFor("bindSuccessor", intent); },
    async preparePullRequestProjection({ intent }) {
      calls.push("prepare-pr-marker"); return valuesFor("projectPullRequest", intent);
    },
    async projectPullRequest({ plan: currentPlan, intent }) {
      calls.push("pr-marker");
      assert.equal(currentPlan.planDigest, plan.planDigest);
      remoteWritten = true;
      if (failRemoteOnce && calls.filter(value => value === "pr-marker").length === 1) {
        throw new Error("response lost after exact remote write");
      }
      return valuesFor("projectPullRequest", intent);
    },
    async activateLocal({ plan: currentPlan, intent }) {
      calls.push("local-active");
      if (remainingEpochDrifts > 0) {
        remainingEpochDrifts -= 1;
        throw new ReviewedCiRevisionEpochDriftError();
      }
      const { localProjection } = intent.pullRequestProjection.values;
      stored = advanceReviewedCiRevisionIntent(intent, {
        status: "local-active",
        values: { localProjection, finalReceiptDigest: finalReceipt.receiptDigest },
      });
      return stored;
    },
    async abortDeliveryWon({ evidence }) {
      calls.push(`abort:${evidence.derivative?.state || "none"}`);
      abortAttempts += 1;
      derivativeRetired = true;
      if (failAbortOnce && abortAttempts === 1) throw new Error("crash after derivative retire");
      const derivative = evidence.derivative;
      const core = { schema: "agentic-reviewed-ci-revision-delivery-abort/v1",
        sourceClaimId: plan.sourceClaimId, sourceState: evidence.sourceState,
        sourceLeaseDigest: plan.sourceLeaseDigest,
        deliveryReceiptDigest: evidence.deliveryReceiptDigest,
        derivativeClaimId: derivative?.claimId ?? null,
        derivativeInitialState: derivative?.state ?? null,
        derivativeFinalState: derivative ? "retired" : null,
        retirementReason: derivative ? "abandoned" : null, cleanupReceiptDigest: D(5),
        sourcePullRequestNodeId: plan.pullRequestNodeId, sourcePullRequestState: "OPEN",
        sourceMergedAt: null, journalState: "cleanup-complete",
        cleanupIntentDigest: stored.abortCleanup.cleanupIntentDigest };
      return { ...core, receiptDigest: digestValue(core) };
    },
    async archiveRecovery({ archive: next }) { calls.push(`archive:${next.status}`);
      archive = next; stored = null; return archive; },
    async finalize() { calls.push("finalize-read-only"); return finalReceipt; },
  });
  return {
    adapter, plan, calls,
    stored: () => stored,
    authorization: `authorize reviewed-ci-revision-recovery ${plan.planDigest}`,
  };
}

test("retires reviewed cloud authority before closing source PR and activates local last", async () => {
  const run = harness();
  const result = await runReviewedCiRevisionRecovery({ authorization: run.authorization }, { adapter: run.adapter });
  assert.equal(result.status, "recovered");
  assert.ok(run.calls.indexOf("claim") < run.calls.indexOf("retire"));
  assert.ok(run.calls.indexOf("retire") < run.calls.indexOf("close"));
  assert.ok(run.calls.indexOf("close") < run.calls.indexOf("create-pr"));
  assert.ok(run.calls.indexOf("pr-marker") < run.calls.indexOf("local-active"));
  assert.ok(run.calls.indexOf("local-active") < run.calls.indexOf("finalize-read-only"));
  assert.equal(run.calls.some(value => value === "cas:complete"), false);
});

test("claim response loss adopts only the exact same-key response-ahead result", async () => {
  const run = harness({ failClaimOnce: true });
  const result = await runReviewedCiRevisionRecovery(
    { authorization: run.authorization }, { adapter: run.adapter });
  assert.equal(result.status, "recovered");
  assert.equal(run.calls.filter(value => value === "intent-marker").length, 1);
  assert.equal(run.calls.filter(value => value === "claim").length, 1);
});

test("bind and remote-marker response-ahead replay skip duplicate mutation", async () => {
  for (const [method, mutation] of [["bindSuccessor", "bind"], ["projectPullRequest", "pr-marker"]]) {
    const run = harness({ responseAheadAt: method });
    assert.equal((await runReviewedCiRevisionRecovery(
      { authorization: run.authorization }, { adapter: run.adapter })).status, "recovered");
    assert.equal(run.calls.includes(mutation), false);
  }
});

test("remote response loss adopts the one durable pre-write candidate", async () => {
  const run = harness({ failRemoteOnce: true });
  assert.equal((await runReviewedCiRevisionRecovery(
    { authorization: run.authorization }, { adapter: run.adapter })).status, "recovered");
  assert.equal(run.calls.filter(value => value === "prepare-pr-marker").length, 1);
  assert.equal(run.calls.filter(value => value === "pr-marker").length, 1);
});

test("response-ahead replay rejects a foreign operation key", async () => {
  const run = harness({ responseAheadAt: "bindSuccessor", wrongAheadKey: true });
  await assert.rejects(runReviewedCiRevisionRecovery(
    { authorization: run.authorization }, { adapter: run.adapter }), /operation key drifted/);
  assert.equal(run.calls.includes("bind"), false);
});

test("delivery-won abort retires exact waiting or current derivative without closing source PR", async () => {
  for (const state of ["waiting-successor", "current"]) {
    const run = harness({ deliveryAt: "retireSource", derivativeState: state });
    const result = await runReviewedCiRevisionRecovery(
      { authorization: run.authorization }, { adapter: run.adapter });
    assert.equal(result.status, "aborted-delivery-won");
    assert.ok(run.calls.includes(`abort:${state}`));
    assert.equal(run.calls.includes("retire"), false);
    assert.equal(run.calls.includes("close"), false);
    assert.equal(run.calls.includes("create-pr"), false);
  }
});

test("abort replay uses durable derivative evidence after the live derivative disappears", async () => {
  const run = harness({ deliveryAt: "retireSource", failAbortOnce: true });
  await assert.rejects(runReviewedCiRevisionRecovery(
    { authorization: run.authorization }, { adapter: run.adapter }), /crash after derivative retire/);
  assert.equal(run.stored().abortCleanup.evidence.derivative.state, "waiting-successor");
  const recovered = await runReviewedCiRevisionRecovery(
    { authorization: run.authorization }, { adapter: run.adapter });
  assert.equal(recovered.status, "aborted-delivery-won");
  assert.equal(run.calls.includes("close"), false);
  const replayed = await runReviewedCiRevisionRecovery(
    { authorization: run.authorization }, { adapter: run.adapter });
  assert.equal(replayed.archiveReceiptDigest, recovered.archiveReceiptDigest);
});

test("terminal CAS epoch drift reprojects remotely with a bounded retry", async () => {
  const recovered = harness({ epochDrifts: 1 });
  assert.equal((await runReviewedCiRevisionRecovery(
    { authorization: recovered.authorization }, { adapter: recovered.adapter })).status, "recovered");
  assert.equal(recovered.calls.filter(value => value === "pr-marker").length, 2);
  assert.equal(recovered.calls.filter(value => value === "cas:remote-active").length, 3);
  const exhausted = harness({ epochDrifts: 4 });
  await assert.rejects(runReviewedCiRevisionRecovery(
    { authorization: exhausted.authorization }, { adapter: exhausted.adapter }),
  error => error?.code === "REVIEWED_CI_REVISION_EPOCH_DRIFT");
  assert.equal(exhausted.calls.filter(value => value === "pr-marker").length, 4);
});

test("live reconciliation blocks foreign-owner drift before mutation", async () => {
  const run = harness({ driftAt: "intent" });
  await assert.rejects(
    runReviewedCiRevisionRecovery({ authorization: run.authorization }, { adapter: run.adapter }),
    /foreign owner/,
  );
  assert.equal(run.calls.includes("intent-marker"), false);
});

test("review-ready source loses a delivery CAS before any integration write", () => {
  const source = sourceFixture(), trace = [];
  const lease = { ...source.lease, autoDelivery: false, runtimeRequired: false };
  const gitText = integrationGit(source, lease);
  assert.throws(() => integrateSession({
    invocationPath: lease.worktreePath, repo: lease.worktreePath, gitText,
    ghText: () => JSON.stringify({ state: "OPEN", baseRefName: "main",
      url: lease.pullRequestUrl, headRefOid: source.headSha, mergeCommit: null }),
    leaseStore: { read: branch => branch ? lease : { leases: { [lease.branch]: lease } } },
    sessionId: lease.sessionId, run: (...args) => trace.push(["run", ...args]),
    runText: () => "", publishTask: () => trace.push(["publish"]), completeTask() {},
    runtime: "none", buildDeliveryEvidence: () => Object.fromEntries(
      ["dependencyClosureDigest", "namedChecksDigest", "handoffEvidenceDigest",
        "operatorDecisionDigest", "integrationIntentDigest"].map(key => [key, "9".repeat(64)])),
    authorizeCloudDelivery() { trace.push(["authorize"]); throw new Error("delivery CAS lost"); },
  }), /delivery CAS lost/);
  assert.deepEqual(trace, [["authorize"]]);
  assert.throws(() => assertAdmissionMutationAuthority({ lease,
    cloudAuthority: lease.cloudAuthority,
    remoteAuthorityVerification: { verifiedAt: source.verification.verifiedAt } }), /current joined/);
});

test("active local mismatch enters integration writes before cloud verification", () => {
  const source = sourceFixture(), trace = [];
  const lease = { ...source.lease, status: "active", integration: {
    commitSha: source.headSha,
    commitMessage: "fix(reviewed-ci-revision-recovery): test active refresh",
  } };
  assert.throws(() => integrateSession({
    invocationPath: lease.worktreePath, repo: lease.worktreePath,
    gitText: integrationGit(source, lease), ghText: () => "{}",
    leaseStore: { read: branch => branch ? lease : { leases: { [lease.branch]: lease } } },
    sessionId: lease.sessionId, run: (file, args) => trace.push(`${file} ${args.join(" ")}`),
    runText: () => "", publishTask: () => trace.push("publish"), completeTask() {}, runtime: "none",
    verifyCloudAuthority() { trace.push("verify-cloud"); throw new Error("stop after pre-auth writes"); },
  }), /stop after pre-auth writes/);
  assert.ok(trace.includes("git fetch origin main"));
  assert.ok(trace.includes(`git merge -m ${renderProtectedMainRefreshCommitMessage({
    subject: lease.integration.commitMessage,
    branch: lease.branch,
    lease,
  })} origin/main`));
  assert.equal(trace.filter(command => command.startsWith("git merge -m ")).length, 1);
  assert.ok(trace.indexOf("publish") < trace.indexOf("verify-cloud"));
});

test("shared review replay can overwrite a marker after its one cloud verification", () => {
  const source = sourceFixture(), lease = { ...source.lease, worktreePath: process.cwd() };
  let liveBody = source.pullRequest.body, reviewReads = 0;
  const finalMarker = "<!-- agentic-reviewed-ci-revision-recovery/v1 FINAL -->";
  const gitText = args => {
    const command = args.join(" ");
    if (command === "branch --show-current") return lease.branch;
    if (command === "worktree list --porcelain -z") return [
      `worktree ${lease.worktreePath}\0HEAD ${source.headSha}\0branch refs/heads/${lease.branch}`,
    ].join("\0\0");
    if (command === "rev-parse HEAD") return source.headSha;
    if (command === "log -1 --pretty=%s") { liveBody = `${liveBody}\n${finalMarker}`; return "fix: stale replay"; }
    return "";
  };
  const ghText = args => {
    if (args[1] === "list") return JSON.stringify([{ number: 344, headRefName: lease.branch,
      url: lease.pullRequestUrl, isDraft: false }]);
    reviewReads += 1;
    return JSON.stringify({ url: lease.pullRequestUrl, state: "OPEN", isDraft: false,
      headRefName: lease.branch, headRefOid: source.headSha,
      headRepository: { nameWithOwner: source.repository }, baseRefName: "main",
      baseRefOid: source.remoteMainSha, body: liveBody });
  };
  review({ invocationPath: lease.worktreePath, repo: lease.worktreePath, gitText,
    gitOptional: () => `${source.headSha}\trefs/heads/${lease.branch}`,
    ghText, ghOptional: () => lease.pullRequestUrl,
    leaseStore: { read: () => lease }, sessionId: lease.sessionId,
    reviewReadyCloudAuthority() {}, verifyReviewReadyCloudAuthority() { return {}; },
    run(file, args) {
      if (file === "gh" && args.includes("--body")) liveBody = args[args.indexOf("--body") + 1];
    }, log() {} });
  assert.ok(reviewReads >= 2);
  assert.doesNotMatch(liveBody, /FINAL/u);
});

test("completed forward-child recovery supersedes only its prepared revision intent", () => {
  const source = sourceFixture();
  const gitCommonDirectory = mkdtempSync(path.join(os.tmpdir(), "reviewed-intent-supersession-"));
  const registryDirectory = path.join(gitCommonDirectory, "agentic-canvas-os");
  mkdirSync(registryDirectory, { recursive: true });
  writeFileSync(path.join(registryDirectory, "writer-leases.json"), `${JSON.stringify({
    schema: "agentic-writer-lease-registry/v2",
    revision: 1,
    leases: { [source.lease.branch]: source.lease },
  })}\n`);
  const leaseStore = createWriterLeaseStore({ gitCommonDir: gitCommonDirectory });
  const identity = {
    leaseStore,
    branch: source.lease.branch,
    entrypoint: "reviewed-lane-revision",
    operationDigest: D(8),
    expectedLeaseDigest: writerLeaseDigest(source.lease),
    expectedClaimId: source.lease.cloudAuthority.claimId,
    planDigest: D(9),
    intent: { revisionIntent: { planSnapshot: { sourceHeadSha: source.headSha } } },
  };
  try {
    const intent = beginReviewedLaneRevisionIntent(identity);
    const childHeadSha = "d".repeat(40);
    const successorClaimId = D(2);
    const claimDigest = D(3);
    const claimLedgerRevision = D(4);
    const recoverySourceCommit = [
      `tree ${"a".repeat(40)}`,
      `parent ${source.headSha}`,
      "author Test <test@example.com> 0 +0000",
      "committer Test <test@example.com> 0 +0000",
      "",
      "Protected head refresh",
      "",
    ].join("\n");
    const recoverySourceHeadSha = createHash("sha1")
      .update(`commit ${Buffer.byteLength(recoverySourceCommit)}\0`)
      .update(recoverySourceCommit)
      .digest("hex");
    const projected = casWriterLeaseProjection({
      leaseStore,
      branch: source.lease.branch,
      expectedLeaseDigest: writerLeaseDigest(source.lease),
      expectedClaimId: source.lease.cloudAuthority.claimId,
      values: {
        status: "active",
        fenceSha: childHeadSha,
        reviewHeadSha: null,
        cloudAuthority: {
          ...source.lease.cloudAuthority,
          claimId: successorClaimId,
          claimDigest,
          claimLedgerRevision,
          laneRevision: childHeadSha,
          transitionCounter: 4,
          state: "active",
        },
      },
    }).lease;
    const completionCore = {
      schema: "agentic-reviewed-forward-child-recovery-completion/v1",
      status: "authoring-restored",
      planDigest: D(5),
      sourceClaimId: source.lease.cloudAuthority.claimId,
      sourceHeadSha: recoverySourceHeadSha,
      childHeadSha,
      autoMergeCancellationDigest: D(6),
      successorClaimId,
      successorClaimDigest: claimDigest,
      leaseDigest: D(7),
      pullRequestDigest: D(8),
      verificationDigest: D(9),
      disposition: "same-owner-forward-child-authoring-restored",
    };
    const recoveryCompletion = {
      ...completionCore,
      receiptDigest: digestValue(completionCore),
    };
    const currentClaim = {
      claimId: successorClaimId,
      state: "current",
      predecessorClaimId: null,
      canonicalBaseRevision: projected.baseSha,
      laneRevision: childHeadSha,
      writeSetDigest: projected.admission.writeSetDigest,
      transitionCounter: 4,
      reviewRequestId: projected.cloudAuthority.reviewRequestId,
      fenceRevision: claimDigest,
      transitionDigest: claimLedgerRevision,
    };
    assert.throws(() => supersedePreparedReviewedLaneRevisionIntent({
      leaseStore,
      branch: source.lease.branch,
      expectedIntentDigest: intent.intentDigest,
      recoveryCompletion: { ...recoveryCompletion, childHeadSha: "e".repeat(40) },
      currentClaim,
    }), /receipt digest is invalid/u);
    const superseded = supersedePreparedReviewedLaneRevisionIntent({
      leaseStore,
      branch: source.lease.branch,
      expectedIntentDigest: intent.intentDigest,
      recoveryCompletion,
      recoverySourceCommit,
      currentClaim,
    });
    assert.equal(superseded.status, "superseded");
    assert.equal(superseded.currentClaimId, successorClaimId);
    assert.equal(readReviewedLaneRevisionIntent({
      leaseStore,
      branch: source.lease.branch,
    }).values.supersession.recoveryReceiptDigest, recoveryCompletion.receiptDigest);
  } finally {
    rmSync(gitCommonDirectory, { recursive: true, force: true });
  }
});

function integrationGit(source, lease) {
  return args => {
    const command = args.join(" ");
    if (command === "branch --show-current") return lease.branch;
    if (command === "worktree list --porcelain -z") return [
      `worktree /workspace/main\0HEAD ${source.remoteMainSha}\0branch refs/heads/main`,
      `worktree ${lease.worktreePath}\0HEAD ${source.headSha}\0branch refs/heads/${lease.branch}`,
    ].join("\0\0");
    if (command === "log --first-parent --no-merges -1 --format=%s "
      + `${source.remoteMainSha}..${source.headSha}`) return "fix(reviewed-ci): recover failed check";
    if (command === `rev-parse ${source.headSha}^{tree}`) return source.treeSha;
    if (command === "rev-parse HEAD" || command === "rev-parse HEAD^{tree}") return source.headSha;
    return "";
  };
}
