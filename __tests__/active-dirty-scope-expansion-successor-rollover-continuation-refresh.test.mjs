import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  advanceSuccessorRolloverReplacement,
  advanceSuccessorRolloverRetirement,
  beginSuccessorRolloverReplacement,
  buildSuccessorRolloverReplacementPlan,
  buildSuccessorRolloverRetirementPlan,
  createSuccessorRolloverJournal,
  successorRolloverOperationKey,
} from "../scripts/active-dirty-scope-expansion-successor-rollover-contract.mjs";
import { buildSuccessorRolloverContinuationPlan }
  from "../scripts/active-dirty-scope-expansion-successor-rollover-continuation-contract.mjs";
import {
  buildSuccessorRolloverContinuationFrame,
  captureSuccessorRolloverProtectedControllerAdvance,
} from "../scripts/active-dirty-scope-expansion-successor-rollover-continuation-frame.mjs";
import {
  CONTINUATION_REFRESH_PLAN_SCHEMA,
  authorizeSuccessorRolloverContinuationRefresh,
  buildSuccessorRolloverContinuationRefreshFrame,
  buildSuccessorRolloverContinuationRefreshPlan,
  normalizeSuccessorRolloverContinuationRefreshPlan,
  rebuildSuccessorRolloverAuthorizedPrMarkerFrame,
  requireSuccessorRolloverContinuationRefreshJournal,
  requireSuccessorRolloverContinuationRefreshCheckpoint,
} from "../scripts/active-dirty-scope-expansion-successor-rollover-continuation-refresh.mjs";
import { main as runSuccessorRolloverCli }
  from "../scripts/active-dirty-scope-expansion-successor-rollover.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);
const C1 = digest("1"), C2 = digest("2"), C3 = digest("3");
const FENCE = sha("a"), HISTORICAL_BASE = sha("b"), C3_BASE = sha("c");
const PRIOR_MAIN = sha("d"), REFRESHED_MAIN = sha("e"), OPERATOR = "operator";
const SOURCE = ["path:a.mjs", "path:b.mjs", "semantic:commerce"];
const STALE = [...SOURCE.slice(0, 2), "path:c.mjs", "path:device-branch-lib.mjs", "semantic:commerce"];
const TARGET = ["path:a.mjs", "path:b.mjs", "path:c.mjs", "semantic:commerce"];

test("refreshes only the controller proof from an exact live PR-marker checkpoint", () => {
  const value = fixture();
  const frame = refreshFrame(value);
  const plan = buildSuccessorRolloverContinuationRefreshPlan({
    priorPlan: value.priorPlan,
    currentJournal: value.currentJournal,
    frame,
    operatorSessionId: OPERATOR,
  });
  for (const key of ["owner", "replacementClaim", "boundReplacement", "reviewRequest",
    "historicalBindProof"]) assert.deepEqual(frame[key], value.priorFrame[key]);
  assert.equal(frame.repairedControllerDigest, digest("8"));
  assert.equal(frame.protectedControllerAdvance.protectedMainSha, REFRESHED_MAIN);
  assert.equal(plan.schema, CONTINUATION_REFRESH_PLAN_SCHEMA);
  assert.equal(plan.kind, "pr-marker-refresh");
  assert.equal(plan.priorPlanDigest, value.priorPlan.planDigest);
  assert.equal(plan.checkpointJournalDigest, value.currentJournal.journalDigest);
  assert.deepEqual(plan.checkpointJournalSnapshot, value.currentJournal);
  assert.equal(plan.continuationPlanSnapshot.sourceJournalDigest,
    value.priorPlan.sourceJournalDigest);
  assert.deepEqual(plan.continuationPlanSnapshot.sourceJournalSnapshot, value.promotedJournal);
  assert.ok(plan.forbiddenEffects.includes("replacement-bind"));
  assert.ok(plan.forbiddenEffects.includes("atomic-local-lease-intent-supersession"));
  assert.ok(plan.forbiddenEffects.includes("exact-pull-request-marker-replacement"));
  assert.ok(plan.allowedEffects.includes("terminal-verification-reconciliation"));
  assert.equal(plan.allowedEffects.includes("response-loss-reconciliation"), false);
  assert.notEqual(plan.planDigest, value.priorPlan.planDigest);
  assert.equal(plan.exactAuthorization,
    `authorize active-dirty-scope-expansion-successor-rollover-continue ${plan.planDigest}`);
  assert.deepEqual(normalizeSuccessorRolloverContinuationRefreshPlan(plan), plan);
  const authorization = authorizeSuccessorRolloverContinuationRefresh({
    plan, authorization: plan.exactAuthorization,
  });
  assert.equal(authorization.planDigest, plan.planDigest);
  assert.deepEqual(rebuildSuccessorRolloverAuthorizedPrMarkerFrame({ priorPlan: plan,
    currentJournal: value.currentJournal, liveBoundValues: value.boundValues,
    liveLocalValues: value.localValues, livePullRequestValues: value.markerValues,
    protectedControllerAdvance: value.refreshedAdvance,
    repairedControllerDigest: digest("8") }), frame);
  assert.throws(() => rebuildSuccessorRolloverAuthorizedPrMarkerFrame({ priorPlan: value.priorPlan,
    currentJournal: value.currentJournal, liveBoundValues: value.boundValues,
    liveLocalValues: value.localValues, livePullRequestValues: value.markerValues,
    protectedControllerAdvance: value.refreshedAdvance,
    repairedControllerDigest: digest("8") }), /authorized PR-marker frame replay/u);
  assert.equal(requireSuccessorRolloverContinuationRefreshCheckpoint({
    priorPlan: value.priorPlan,
    currentJournal: value.currentJournal,
    liveBoundValues: value.boundValues,
    liveLocalValues: value.localValues,
    livePullRequestValues: value.markerValues,
  }).replacement.status, "pr-marker");
});

test("refresh authority rejects rollback, checkpoint drift, and wrapper tampering", () => {
  const value = fixture(), plan = buildSuccessorRolloverContinuationRefreshPlan({
    priorPlan: value.priorPlan, currentJournal: value.currentJournal,
    frame: refreshFrame(value), operatorSessionId: OPERATOR,
  });
  assert.throws(() => requireSuccessorRolloverContinuationRefreshJournal({
    plan, journal: value.promotedJournal, exactCheckpoint: true,
  }), /exact PR-marker checkpoint/u);
  const drifted = advanceSuccessorRolloverReplacement(value.localJournal, "pr-marker",
    { ...value.markerValues, bodyDigest: digest("2") });
  assert.throws(() => requireSuccessorRolloverContinuationRefreshJournal({
    plan, journal: drifted, exactCheckpoint: true,
  }), /exact PR-marker checkpoint/u);
  const verificationCore = { leaseDigest: value.localValues.leaseDigest,
    replacementIntentDigest: value.localValues.replacementIntentDigest,
    cloudAuthorityDigest: value.boundValues.authority.authorityDigest,
    taskAuthorityBindingDigest: value.localValues.taskAuthorityBindingDigest,
    markerDigest: value.markerValues.markerDigest, bodyDigest: value.markerValues.bodyDigest,
    dirtDigest: value.priorPlan.replacementPlanSnapshot.observation.sourceDirtDigest };
  const verified = advanceSuccessorRolloverReplacement(value.currentJournal, "verified",
    { ...verificationCore, verificationDigest: digestValue(verificationCore) });
  assert.equal(requireSuccessorRolloverContinuationRefreshJournal({
    plan, journal: verified,
  }).replacement.status, "verified");
  assert.throws(() => normalizeSuccessorRolloverContinuationRefreshPlan({
    ...plan, checkpointJournalDigest: digest("3"),
  }), /refresh plan projection/u);
  assert.throws(() => normalizeSuccessorRolloverContinuationRefreshPlan({
    ...plan, continuationPlanDigest: digest("4"),
  }), /refresh plan projection/u);
});

test("rejects non-marker sources and any live durable-phase drift", () => {
  const value = fixture();
  for (const currentJournal of [value.promotedJournal, value.boundJournal, value.localJournal]) {
    assert.throws(() => refreshFrame(value, { currentJournal }), /PR-marker refresh checkpoint/u);
  }
  for (const changed of [
    { liveBoundValues: { ...value.boundValues, receiptDigest: digest("f") } },
    { liveLocalValues: { ...value.localValues, leaseDigest: digest("f") } },
    { livePullRequestValues: { ...value.markerValues, bodyDigest: digest("f") } },
  ]) assert.throws(() => refreshFrame(value, changed), /live PR-marker phase join/u);
  assert.throws(() => refreshFrame(value, { priorPlan: value.unboundPlan }),
    /PR-marker refresh checkpoint/u);
});

test("requires a changed controller identity on a clean descendant", () => {
  const value = fixture();
  assert.throws(() => refreshFrame(value, {
    repairedControllerDigest: value.priorPlan.repairedControllerDigest,
  }), /continuation refresh frame/u);
  assert.throws(() => refreshFrame(value, {
    protectedControllerAdvance: value.priorFrame.protectedControllerAdvance,
  }), /continuation refresh frame/u);
  assert.throws(() => refreshFrame(value, {
    gitText: args => { if (args[0] === "merge-base") throw new Error("not descendant");
      return gitReader([])(args); },
  }), /not descendant/u);
  const frame = refreshFrame(value);
  assert.throws(() => buildSuccessorRolloverContinuationRefreshPlan({
    priorPlan: value.priorPlan,
    currentJournal: value.currentJournal,
    frame: { ...frame, owner: { ...frame.owner, dirtDigest: digest("2") } },
    operatorSessionId: OPERATOR,
  }), /unchanged owner|continuation frame projection/u);
});

test("CLI accepts exactly one continuation source and blocks before a sidecar on journal drift", async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rollover-refresh-cli-"));
  try {
    const repository = path.join(root, "repository"); fs.mkdirSync(repository);
    const files = Object.fromEntries(["journal", "manifest", "prior", "replacement", "run-plan",
      "authority"].map(name => [name, path.join(root, `${name}.json`)]));
    const prior = { planDigest: digest("a"), replacementPlanSnapshot: { planDigest: digest("b") } };
    const runtime = { planDigest: digest("c"), replacementPlanSnapshot: prior.replacementPlanSnapshot,
      sourceJournalSnapshot: { sealed: true } };
    const refreshed = { schema: CONTINUATION_REFRESH_PLAN_SCHEMA, planDigest: digest("e"),
      exactAuthorization: `authorize continue ${digest("e")}`, continuationPlanSnapshot: runtime };
    for (const [name, value] of [["prior", prior], ["replacement", prior.replacementPlanSnapshot],
      ["run-plan", refreshed], ["authority", {}]]) fs.writeFileSync(files[name], `${JSON.stringify(value)}\n`, { mode: 0o600 });
    fs.writeFileSync(files.manifest, "{}\n");
    const output = path.join(root, "refresh.json"), sidecar = path.join(root, "sidecar.json");
    const common = [`--repository=${repository}`, `--state-path=${files.journal}`,
      "--source-session=source", "--pull-request=808", `--operator-session=${OPERATOR}`,
      `--corrected-manifest=${files.manifest}`];
    const adapter = { readRecoveryJournal: async () => ({ status: "pr-marker" }),
      readContinuationFrame: async ({ plan }) => ({ plan }) };
    const dependencies = {
      createAdapter: options => { assert.deepEqual(options.continuationPlan, prior);
        assert.equal(options.refreshContinuationPlan, true); return adapter; },
      createController: () => ({ runReplacement: async () => ({ status: "complete" }) }),
      normalizeContinuationPlan: value => value,
      buildContinuationRefreshPlan: input => { assert.deepEqual(input.priorPlan, prior); return refreshed; },
    };
    await assert.rejects(runSuccessorRolloverCli(["plan-continuation", ...common,
      `--output=${output}`], dependencies), /exactly one/u);
    await assert.rejects(runSuccessorRolloverCli(["plan-continuation", ...common,
      `--replacement-plan=${files.replacement}`, `--prior-continuation=${files.prior}`,
      `--output=${output}`], dependencies), /exactly one/u);
    const planned = await runSuccessorRolloverCli(["plan-continuation", ...common,
      `--prior-continuation=${files.prior}`, `--output=${output}`], dependencies);
    assert.equal(planned.planDigest, refreshed.planDigest);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), refreshed);

    let controllerCalls = 0, frameCalls = 0;
    const runDependencies = { ...dependencies,
      createAdapter: options => { assert.deepEqual(options.continuationPlan, runtime);
        assert.deepEqual(options.continuationRefreshPlan, refreshed); return {
          readRecoveryJournal: async () => ({ status: "replacement-promoted" }),
          readContinuationFrame: async () => { frameCalls += 1;
            throw new Error("frame must not run"); },
        }; },
      createController: () => ({ runReplacement: async () => { controllerCalls += 1; } }),
      authorizeContinuation: () => ({ authorizationDigest: digest("d") }),
      requireContinuationJournal: ({ exactCheckpoint }) => { assert.equal(exactCheckpoint, true);
        throw new Error("journal drift"); },
    };
    await assert.rejects(runSuccessorRolloverCli(["run-continuation", ...common,
      `--plan=${files["run-plan"]}`, `--continuation-state=${sidecar}`,
      `--task-authority=${files.authority}`, `--authorization=${refreshed.exactAuthorization}`],
    runDependencies), /journal drift/u);
    assert.equal(fs.existsSync(sidecar), false);
    assert.equal(frameCalls, 0);
    assert.equal(controllerCalls, 0);

    let journalReads = 0, checkpointReads = 0;
    const raceDependencies = { ...runDependencies,
      createAdapter: () => ({
        readRecoveryJournal: async () => { journalReads += 1; return { status: "pr-marker" }; },
        readContinuationFrame: async () => { frameCalls += 1; return { sealed: true }; },
      }),
      buildContinuationPlan: () => runtime,
      requireContinuationJournal: ({ exactCheckpoint }) => { checkpointReads += 1;
        assert.equal(exactCheckpoint, true); if (checkpointReads === 2) throw new Error("late marker drift"); },
    };
    await assert.rejects(runSuccessorRolloverCli(["run-continuation", ...common,
      `--plan=${files["run-plan"]}`, `--continuation-state=${sidecar}`,
      `--task-authority=${files.authority}`, `--authorization=${refreshed.exactAuthorization}`],
    raceDependencies), /late marker drift/u);
    assert.equal(journalReads, 2);
    assert.equal(frameCalls, 1);
    assert.equal(fs.existsSync(sidecar), false);
    assert.equal(controllerCalls, 0);

    checkpointReads = 0; journalReads = 0;
    const complete = await runSuccessorRolloverCli(["run-continuation", ...common,
      `--plan=${files["run-plan"]}`, `--continuation-state=${sidecar}`,
      `--task-authority=${files.authority}`, `--authorization=${refreshed.exactAuthorization}`],
    { ...raceDependencies, requireContinuationJournal: ({ exactCheckpoint }) => {
      checkpointReads += 1; assert.equal(exactCheckpoint, true);
    } });
    assert.equal(complete.status, "complete");
    assert.equal(journalReads, 2);
    assert.equal(checkpointReads, 2);
    assert.equal(controllerCalls, 1);
    assert.equal(fs.existsSync(sidecar), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function refreshFrame(value, overrides = {}) {
  return buildSuccessorRolloverContinuationRefreshFrame({
    priorPlan: value.priorPlan,
    currentJournal: value.currentJournal,
    liveBoundValues: value.boundValues,
    liveLocalValues: value.localValues,
    livePullRequestValues: value.markerValues,
    protectedControllerAdvance: value.refreshedAdvance,
    repairedControllerDigest: digest("8"),
    gitText: gitReader([]),
    ...overrides,
  });
}

function fixture() {
  const retirementPlan = buildSuccessorRolloverRetirementPlan({
    observation: retirementObservation(), operatorSessionId: OPERATOR,
  });
  let retiredJournal = createSuccessorRolloverJournal(retirementPlan,
    retirementPlan.exactAuthorization);
  const retired = { schema: "agentic-active-dirty-scope-expansion-successor-rollover-retirement/v1",
    staleSuccessorClaimId: C2, priorClaimDigest: retirementPlan.observation.staleSuccessorClaimDigest,
    retiredClaimDigest: digest("d"), retirementTransitionDigest: digest("e"), transitionCounter: 2,
    state: "retired", reason: "successor-rollover", receiptDigest: digest("f") };
  retiredJournal = advanceSuccessorRolloverRetirement(retiredJournal, retired);
  const replacementPlan = buildSuccessorRolloverReplacementPlan({
    observation: replacementObservation(retirementPlan, retired), targetManifest: targetManifest(),
    operatorSessionId: OPERATOR, retirementJournal: retiredJournal,
  });
  let promotedJournal = beginSuccessorRolloverReplacement(retiredJournal, replacementPlan,
    replacementPlan.exactAuthorization);
  const promotedClaim = { claimId: C3, claimDigest: digest("4"), ledgerRevision: sha("3"),
    claimLedgerRevision: digest("5"), transitionCounter: 1, state: "current",
    predecessorClaimId: null, canonicalBaseSha: C3_BASE, laneRevision: FENCE,
    writeSetDigest: replacementPlan.target.writeSetDigest, leaseEpoch: 1,
    expiresAt: "2099-08-30T01:00:00.000Z" };
  const claimValues = { claim: promotedClaim, receiptDigest: digest("6") };
  promotedJournal = advanceSuccessorRolloverReplacement(promotedJournal,
    "replacement-claimed", claimValues);
  promotedJournal = advanceSuccessorRolloverReplacement(promotedJournal,
    "replacement-promoted", { ...claimValues, promoted: false });
  const owner = { schema: "agentic-active-dirty-scope-expansion-successor-rollover-owner-frame/v1",
    repositoryPathDigest: digest("7"), branch: replacementPlan.branch,
    sourceSessionId: retirementPlan.observation.sourceSessionId, headSha: FENCE,
    remoteHeadSha: FENCE, leaseDigest: replacementPlan.observation.sourceLeaseDigest,
    dirtDigest: replacementPlan.observation.sourceDirtDigest,
    intentDigest: replacementPlan.observation.sourceIntentDigest, intentStatus: "source-retired",
    changedPaths: retirementPlan.observation.sourceChangedPaths,
    changedPathsDigest: digestValue(retirementPlan.observation.sourceChangedPaths) };
  const replacementClaim = { schema: "agentic-active-dirty-scope-expansion-successor-rollover-claim-frame/v1",
    ...promotedClaim, reviewRequestId: null, operationReceiptDigest: claimValues.receiptDigest };
  delete replacementClaim.ledgerRevision;
  const reviewRequest = { schema: "agentic-active-dirty-scope-expansion-successor-rollover-review-frame/v1",
    reviewRequestId: replacementPlan.sourceReviewRequestId, pullRequestNumber: 808,
    nodeId: "PR_808", state: "OPEN", isDraft: true, branch: replacementPlan.branch,
    headSha: FENCE, baseBranch: "main", baseSha: HISTORICAL_BASE,
    markerDigest: replacementPlan.observation.pullRequestMarkerDigest,
    bodyDigest: replacementPlan.observation.pullRequestBodyDigest };
  const boundReplacement = boundFrame(replacementPlan, replacementClaim);
  const priorAdvance = controllerAdvance(replacementPlan, PRIOR_MAIN, ["scripts/repair-v3.mjs"]);
  const priorFrame = buildSuccessorRolloverContinuationFrame({ replacementPlan,
    journal: promotedJournal, owner, replacementClaim, boundReplacement, reviewRequest,
    protectedControllerAdvance: priorAdvance, repairedControllerDigest: digest("9") });
  const priorPlan = buildSuccessorRolloverContinuationPlan({ replacementPlan,
    journal: promotedJournal, frame: priorFrame, operatorSessionId: OPERATOR });
  const unboundFrame = buildSuccessorRolloverContinuationFrame({ replacementPlan,
    journal: promotedJournal, owner, replacementClaim, reviewRequest,
    protectedControllerAdvance: priorAdvance, repairedControllerDigest: digest("9") });
  const unboundPlan = buildSuccessorRolloverContinuationPlan({ replacementPlan,
    journal: promotedJournal, frame: unboundFrame, operatorSessionId: OPERATOR });
  const claim = boundReplacement.claim;
  const boundValues = { authority: { claimId: claim.claimId, claimDigest: claim.claimDigest,
    claimLedgerRevision: claim.claimLedgerRevision, transitionCounter: claim.transitionCounter,
    canonicalBaseSha: claim.canonicalBaseSha, laneRevision: claim.laneRevision,
    writeSetDigest: claim.writeSetDigest, manifestDigest: replacementPlan.target.manifestDigest,
    leaseEpoch: claim.leaseEpoch, reviewRequestId: claim.reviewRequestId,
    expiresAt: claim.expiresAt, authorityDigest: digest("a") },
    receiptDigest: boundReplacement.receipt.receiptDigest };
  const boundJournal = advanceSuccessorRolloverReplacement(promotedJournal,
    "replacement-bound", boundValues);
  const localValues = { leaseDigest: digest("b"), sourceIntentDigest: replacementPlan.observation.sourceIntentDigest,
    replacementIntentDigest: digest("c"), taskAuthorityBindingDigest: digest("d"), receiptDigest: digest("e") };
  const localJournal = advanceSuccessorRolloverReplacement(boundJournal, "local-cas", localValues);
  const markerValues = { markerDigest: digest("f"), bodyDigest: digest("0"), receiptDigest: digest("1") };
  const currentJournal = advanceSuccessorRolloverReplacement(localJournal, "pr-marker", markerValues);
  return { promotedJournal, boundJournal, localJournal, currentJournal, boundValues, localValues,
    markerValues, priorFrame, priorPlan, unboundPlan,
    refreshedAdvance: controllerAdvance(replacementPlan, REFRESHED_MAIN, ["scripts/refresh.mjs"]) };
}

function boundFrame(plan, promoted) {
  const claim = { ...promoted, claimDigest: digest("8"), claimLedgerRevision: digest("7"),
    transitionCounter: 2, reviewRequestId: plan.sourceReviewRequestId,
    operationReceiptDigest: digest("0") };
  const identity = plan.sourceClaimIdentity;
  const intent = { repositoryId: identity.repositoryId, actorId: identity.actorId,
    deviceId: identity.deviceId, sessionId: identity.sessionId, claimId: promoted.claimId,
    expectedFenceRevision: promoted.claimDigest, expectedTransitionCounter: promoted.transitionCounter,
    mode: "projection", laneRevision: plan.sourceFenceSha,
    reviewRequestId: plan.sourceReviewRequestId, expiresAt: null, focusedEvidenceDigest: null,
    handoffEvidenceDigest: null, recoveryEvidenceDigest: null };
  const core = { schema: "agentic-collaboration-continuation-receipt/v1", operation: "continue",
    status: "current", repositoryId: identity.repositoryId, claimId: claim.claimId,
    claimDigest: claim.claimDigest, fenceRevision: claim.claimDigest,
    ledgerRevision: claim.claimLedgerRevision, ledgerSequence: 91,
    idempotencyKey: digestValue(successorRolloverOperationKey(plan, "replacement-bound")),
    requestDigest: digestValue({ action: "continue", intent }),
    evaluationTime: "2026-08-30T00:01:00.000Z" };
  const receipt = { ...core, receiptDigest: digestValue(core) };
  return { schema: "agentic-active-dirty-scope-expansion-successor-rollover-bound-frame/v1",
    claim: { ...claim, operationReceiptDigest: receipt.receiptDigest }, receipt };
}

function retirementObservation() {
  const identityCore = { repositoryId: "github-repository:1", actorId: "github-user:1",
    deviceId: "device:1", sessionId: "session:1", workItemId: "work-item:1" };
  const core = { schema: "agentic-active-dirty-scope-expansion-successor-rollover-retirement-observation/v2",
    sourceClaimIdentity: { ...identityCore, identityDigest: digestValue(identityCore) },
    controllerDigest: digest("a"), protectedMainSha: C3_BASE, protectedMainTreeSha: sha("f"),
    protectedMainAdvanceDigest: digest("b"), protectedMainChangedPaths: ["device-branch-lib.mjs"],
    branch: "agent/device/commerce", sourceSessionId: "source-session", semanticScope: "commerce",
    sourceFenceSha: FENCE, sourceLeaseDigest: digest("c"), sourceClaimId: C1,
    sourceClaimDigest: digest("d"), sourceReviewRequestId: "github-pull-request:PR_808",
    sourceWriteSetDigest: digestValue(SOURCE), sourceManifestDigest: digest("e"),
    sourceDeclaredWriteSet: SOURCE, sourceDirtDigest: digest("f"), sourceChangedPaths: ["a.mjs"],
    sourceIntentDigest: digest("4"), sourceIntentPlanDigest: digest("5"),
    sourceIntentStatus: "source-retired", sourceRetirementReceiptDigest: digest("6"),
    staleSuccessorClaimId: C2, staleSuccessorClaimDigest: digest("7"),
    staleSuccessorTransitionDigest: digest("8"), staleSuccessorTransitionCounter: 1,
    staleSuccessorState: "waiting-successor", staleSuccessorPredecessorClaimId: C1,
    staleTargetCanonicalBaseSha: HISTORICAL_BASE, staleTargetWriteSetDigest: digestValue(STALE),
    staleTargetManifestDigest: digest("9"), staleTargetDeclaredWriteSet: STALE,
    staleExpiresAt: "2099-08-30T00:00:00.000Z", pullRequestNumber: 808,
    pullRequestNodeId: "PR_808", pullRequestMarkerDigest: digest("a"),
    pullRequestBodyDigest: digest("b") };
  return { ...core, observationDigest: digestValue(core) };
}

function replacementObservation(retirementPlan, retirement) {
  const source = retirementPlan.observation;
  const core = { schema: "agentic-active-dirty-scope-expansion-successor-rollover-replacement-observation/v2",
    sourceClaimIdentity: source.sourceClaimIdentity, controllerDigest: digest("1"),
    protectedMainSha: C3_BASE, protectedMainTreeSha: sha("1"),
    protectedMainAdvanceDigest: digest("1"), protectedMainChangedPaths: ["device-branch-lib.mjs"],
    branch: source.branch, sourceLeaseDigest: source.sourceLeaseDigest,
    sourceDirtDigest: source.sourceDirtDigest, sourceIntentDigest: source.sourceIntentDigest,
    pullRequestMarkerDigest: source.pullRequestMarkerDigest,
    pullRequestBodyDigest: source.pullRequestBodyDigest, staleSuccessorClaimId: C2,
    staleRetirementClaimDigest: retirement.retiredClaimDigest,
    staleRetirementTransitionDigest: retirement.retirementTransitionDigest,
    staleRetirementTransitionCounter: retirement.transitionCounter,
    staleRetirementReceiptDigest: retirement.receiptDigest };
  return { ...core, observationDigest: digestValue(core) };
}

function targetManifest() {
  const declaredWriteSet = [...TARGET].sort();
  return { schema: "agentic-declared-write-scope/v1", semanticScope: "commerce",
    declaredWriteSet, writeSetDigest: digestValue(declaredWriteSet), manifestDigest: digest("3") };
}

function controllerAdvance(plan, main, changedPaths) {
  return captureSuccessorRolloverProtectedControllerAdvance({ replacementPlan: plan,
    controllerHeadSha: main, controllerOriginMainSha: main, protectedMainSha: main,
    controllerStatus: "", gitText: gitReader(changedPaths) });
}

function gitReader(changedPaths, treeSha = sha("6")) {
  const changed = [...changedPaths].sort();
  return args => {
    if (args[0] === "merge-base") return "";
    if (args[0] === "diff") return `${changed.join("\0")}${changed.length ? "\0" : ""}`;
    if (args[0] === "rev-parse") return treeSha;
    throw new Error(`Unexpected Git call: ${args.join(" ")}`);
  };
}
