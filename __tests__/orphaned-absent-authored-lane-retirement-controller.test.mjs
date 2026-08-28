import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createController }
  from "../scripts/orphaned-absent-authored-lane-retirement-controller.mjs";
import { retirementJournalOperationKey, retirementTerminalEvidenceDigest }
  from "../scripts/orphaned-absent-authored-lane-retirement-contract.mjs";
import { orphanedAbsentAuthoredStableEvidenceDigest }
  from "../scripts/orphaned-absent-authored-lane-retirement-evidence.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { retirementRequestDigest }
  from "../scripts/orphaned-absent-authored-lane-retirement-store.mjs";

const sha = value => value.repeat(40).slice(0, 40);
const digest = value => value.repeat(64).slice(0, 64);

test("planning double-reads one stable subject and refuses drift before persistence", async () => {
  const fixture = fakeRuntime({ driftSecondObservation: true });

  await assert.rejects(fixture.controller.plan(), /drifted across the read-only planning fence/u);
  assert.equal(fixture.readState(), null);
  assert.deepEqual(fixture.effects, ["observe", "observe"]);
});

test("wrong exact authorization has zero provider or cloud effects", async () => {
  const fixture = fakeRuntime();
  const plan = await fixture.controller.plan();

  await assert.rejects(fixture.controller.run({
    planDigest: plan.planDigest,
    authorization: `${plan.exactAuthorization}-wrong`,
  }), /Exact authorization required/u);
  assert.deepEqual(fixture.mutations, []);
  assert.equal(fixture.readState().phase, "planned");
});

test("closes before retirement, adopts both response losses, and replays terminally", async () => {
  const fixture = fakeRuntime({ loseCloseResponse: true, loseRetirementResponse: true });
  const plan = await fixture.controller.plan();
  const receipt = await fixture.controller.run({
    planDigest: plan.planDigest,
    authorization: plan.exactAuthorization,
  });

  assert.equal(receipt.status, "complete");
  assert.deepEqual(fixture.mutations, ["close-pr", "retire-claim"]);
  assert.deepEqual(fixture.effects.filter(value =>
    ["close-pr", "revalidate-dormant", "retire-claim", "verify-terminal"].includes(value)),
  ["close-pr", "revalidate-dormant", "retire-claim", "verify-terminal"]);
  assert.equal(fixture.readState().receipts["pull-request-closed"].disposition,
    "adopted-response-loss");
  assert.equal(fixture.readState().receipts["claim-retired"].disposition,
    "adopted-response-loss");

  const replay = await fixture.controller.run({
    planDigest: plan.planDigest,
    authorization: plan.exactAuthorization,
  });
  assert.equal(replay.receiptDigest, receipt.receiptDigest);
  assert.deepEqual(fixture.mutations, ["close-pr", "retire-claim"]);
  assert.equal(fixture.effects.filter(value => value === "verify-terminal").length, 2);
  assert.equal(fixture.readState().phase, "complete");
});

test("terminal verification gates completion and a retry finishes without repeating effects", async () => {
  const fixture = fakeRuntime({ failFirstTerminalVerification: true });
  const plan = await fixture.controller.plan();

  await assert.rejects(fixture.controller.run({
    planDigest: plan.planDigest,
    authorization: plan.exactAuthorization,
  }), /terminal evidence unavailable/u);
  assert.equal(fixture.readState().phase, "claim-retired");
  assert.deepEqual(fixture.mutations, ["close-pr", "retire-claim"]);

  const receipt = await fixture.controller.run({
    planDigest: plan.planDigest,
    authorization: plan.exactAuthorization,
  });
  assert.equal(receipt.status, "complete");
  assert.deepEqual(fixture.mutations, ["close-pr", "retire-claim"]);
  assert.equal(fixture.readState().phase, "complete");
});

function fakeRuntime({ driftSecondObservation = false, loseCloseResponse = false,
  loseRetirementResponse = false, failFirstTerminalVerification = false } = {}) {
  const evidence = evidenceFixture();
  const effects = [];
  const mutations = [];
  let observationCount = 0;
  let state = null;
  let pullClosed = false;
  let claimRetired = false;
  let terminalAttempts = 0;
  const operationReceiptDigest = digest("2");
  const terminalEntryDigest = digest("3");
  const adapter = {
    async observe() {
      effects.push("observe");
      observationCount += 1;
      if (driftSecondObservation && observationCount === 2) {
        return { ...evidence, stableEvidenceDigest: digest("0") };
      }
      return evidence;
    },
    readState: () => state,
    writeState({ expected, next }) {
      assert.equal(state?.stateDigest || null, expected?.stateDigest || null);
      state = next;
      return state;
    },
    withLock: async (_context, action) => action(),
    async classifyPullRequest(plan) {
      effects.push("classify-pr");
      return pullClosed ? { state: "complete", values: {
        operationKey: retirementJournalOperationKey(plan, "pull-request-closed"),
        pullRequestNumber: evidence.pullRequest.number,
        pullRequestNodeId: evidence.pullRequest.nodeId,
        closedAt: "2026-08-28T15:47:30.000Z",
        disposition: loseCloseResponse ? "adopted-response-loss" : "projected",
        providerMutation: true,
      } } : { state: "pending" };
    },
    async closePullRequest() {
      assert.equal(claimRetired, false);
      effects.push("close-pr");
      mutations.push("close-pr");
      pullClosed = true;
      if (loseCloseResponse) throw new Error("provider response lost after exact close");
    },
    async revalidateDormantClaim() {
      assert.equal(pullClosed, true);
      assert.equal(claimRetired, false);
      effects.push("revalidate-dormant");
    },
    async classifyClaim(plan) {
      effects.push("classify-claim");
      return claimRetired ? { state: "complete", values: {
        operationKey: retirementJournalOperationKey(plan, "claim-retired"),
        claimId: evidence.claim.claimId,
        requestDigest: retirementRequestDigest(plan),
        operationReceiptDigest,
        terminalEntryDigest,
        disposition: loseRetirementResponse ? "adopted-response-loss" : "projected",
        cloudMutation: true,
      } } : { state: "pending" };
    },
    async retireClaim() {
      assert.equal(pullClosed, true);
      effects.push("retire-claim");
      mutations.push("retire-claim");
      claimRetired = true;
      if (loseRetirementResponse) throw new Error("cloud response lost after exact retirement");
    },
    async verifyTerminal(plan) {
      assert.equal(pullClosed, true);
      assert.equal(claimRetired, true);
      effects.push("verify-terminal");
      terminalAttempts += 1;
      if (failFirstTerminalVerification && terminalAttempts === 1) {
        throw new Error("terminal evidence unavailable");
      }
      return { terminalEvidenceDigest: retirementTerminalEvidenceDigest(plan, {
        operationReceiptDigest, terminalEntryDigest,
      }) };
    },
  };
  return { controller: createController({ adapter }), effects, mutations, readState: () => state };
}

function evidenceFixture() {
  const baseSha = sha("1");
  const fenceSha = sha("2");
  const headSha = sha("3");
  const headTreeSha = sha("4");
  const baseTreeSha = sha("0");
  const scope = "runtime-readiness-promotion-6095";
  const branch = "agent/katrinas-macbook-pro.local/runtime-readiness-promotion-6095";
  const changedPath = "docs/runtime-readiness-contract.md";
  const declaredWriteSet = [`path:${changedPath}`, `semantic:${scope}`];
  const writeSetDigest = digestValue(declaredWriteSet);
  const claimId = digest("1");
  const claimDigest = digest("2");
  const nodeId = "PR_node_868";
  const marker = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 504,
    sessionId: "owner-session", device: "owner-device", scope, branch, baseSha, fenceSha,
    admission: { status: "admitted", semanticScope: scope, declaredWriteSet,
      writeSetDigest, manifestDigest: digest("3") },
    cloudAuthority: { ledgerRepository: "owner/controller", targetRepository: "owner/repo",
      claimId, claimDigest, canonicalBaseSha: baseSha, laneRevision: fenceSha,
      writeSetDigest, reviewRequestId: `github-pull-request:${nodeId}`, leaseEpoch: 1,
      operationReceiptDigest: digest("7"), transitionCounter: 2, state: "active",
      expiresAt: "2026-08-28T15:46:15.000Z" },
    taskAuthority: { schema: "agentic-task-authority-binding/v1",
      authoritySubjectId: "urn:agentic-task:subject", proofAdapterId: "urn:agentic-proof:test",
      generation: 1, publicKey: "public-key", publicKeyDigest: digest("4"),
      laneBindingDigest: digest("5"), bindingDigest: digest("6") },
  };
  const commits = [{ sha: headSha, parentSha: fenceSha, treeSha: headTreeSha,
    changedPaths: [changedPath], message: `chore(${scope}): preserve authored lane\n\n`
      + `Agentic-Task: ${scope}\nAgentic-Scope: ${scope}\nAgentic-Lease-Epoch: 1\n`
      + "Agentic-Mechanism: Agentic Canvas OS protected integration" }];
  const authoredRange = { fenceSha, fenceParentSha: baseSha, fenceTreeSha: baseTreeSha,
    baseTreeSha, headSha, headTreeSha, commits,
    changedPaths: [changedPath] };
  authoredRange.rangeDigest = digestValue(authoredRange);
  const absence = { registeredWorktreeMatches: [], localBranchPresent: false,
    writerLeaseMatches: [], privateTaskArtifactMatches: [], registryDigest: digest("7"),
    localRefsDigest: digest("8"), writerLeaseRegistryDigest: digest("9"),
    privateTaskInventoryDigest: digest("a") };
  absence.absenceDigest = digestValue(absence);
  const evidence = {
    observedAt: "2026-08-28T15:47:00.000Z",
    repository: { fullName: "owner/repo", id: 101, nodeId: "repo-node",
      originUrlDigest: digest("b"), gitCommonDirectoryDigest: digest("c") },
    controller: { branch: "main", headSha: sha("5"), originMainSha: sha("5"),
      remoteMainSha: sha("5"), clean: true, protected: true,
      protectionDigest: digest("0"), runtimeDigest: digest("d") },
    actor: { id: 102, login: "owner" },
    pullRequest: { number: 868, nodeId, url: "https://github.com/owner/repo/pull/868",
      state: "OPEN", isDraft: true, mergedAt: null, closedAt: null, branch, headSha,
      baseRef: "main", baseSha, authorLogin: "owner", headRepository: "owner/repo",
      baseRepository: "owner/repo", restAutoMergeRequest: null, autoMergeRequest: null,
      isInMergeQueue: false, mergeQueueEntry: null, immutableDigest: digest("e"),
      markerDigest: digestValue(marker) },
    marker,
    claim: { claimId, claimDigest, transitionDigest: digest("b"),
      operationReceiptDigest: digest("7"),
      state: "dormant-preserved", recordedState: "current",
      writeAuthority: false, scopeReserved: true, actorId: "github-user:102",
      repositoryId: "github-repository:repo-node",
      workItemId: pseudonymousIdentifier("work-item", scope),
      deviceId: pseudonymousIdentifier("device", marker.device),
      sessionId: pseudonymousIdentifier("session", marker.sessionId), canonicalBaseRevision: baseSha,
      laneRevision: fenceSha, declaredWriteScope: declaredWriteSet, writeSetDigest,
      leaseEpoch: 1, transitionCounter: 2,
      reviewRequestId: `github-pull-request:${nodeId}`,
      expiresAt: "2026-08-28T15:46:15.000Z", integration: null },
    cloud: { ledgerRepository: "owner/controller", ledgerRevision: sha("6"),
      ledgerDigest: digest("f"), sequence: 10 },
    authoredRange, absence, remote: { branch, headSha },
  };
  evidence.stableEvidenceDigest = orphanedAbsentAuthoredStableEvidenceDigest(evidence);
  return evidence;
}
