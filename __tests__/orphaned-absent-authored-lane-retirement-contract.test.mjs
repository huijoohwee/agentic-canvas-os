import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  advanceState,
  authorizePlan,
  buildCompletionReceipt,
  buildPlan,
  createState,
  normalizePlan,
  normalizeState,
  PHASES,
  PRESERVATION,
  RECEIPT_SCHEMA,
  retirementJournalOperationKey,
  retirementTerminalEvidenceDigest,
} from "../scripts/orphaned-absent-authored-lane-retirement-contract.mjs";
import { orphanedAbsentAuthoredStableEvidenceDigest }
  from "../scripts/orphaned-absent-authored-lane-retirement-evidence.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { retirementRequestDigest }
  from "../scripts/orphaned-absent-authored-lane-retirement-store.mjs";

const sha = value => value.repeat(40).slice(0, 40);
const digest = value => value.repeat(64).slice(0, 64);

test("plan seals the exact authorization, close-first effects, and preservation boundary", () => {
  const plan = buildPlan(evidenceFixture());

  assert.equal(normalizePlan(plan).planDigest, plan.planDigest);
  assert.equal(authorizePlan(plan, plan.exactAuthorization).planDigest, plan.planDigest);
  assert.match(plan.exactAuthorization,
    /^authorize orphaned-absent-authored-lane-retirement [0-9a-f]{64}$/u);
  assert.deepEqual(plan.effects,
    ["close-exact-draft-pull-request", "retire-exact-dormant-cloud-claim"]);
  assert.deepEqual(plan.preservation, PRESERVATION);
  assert.deepEqual(PHASES,
    ["planned", "authorized", "pull-request-closed", "claim-retired", "verified", "complete"]);

  for (const authorization of ["", "authorize orphaned-absent-authored-lane-retirement",
    `${plan.exactAuthorization} `]) {
    assert.throws(() => authorizePlan(plan, authorization), /Exact authorization required/u);
  }

  const drifted = structuredClone(plan);
  drifted.evidence.remote.headSha = sha("f");
  assert.throws(() => normalizePlan(drifted), /invalid|drifted|identity/u);
});

test("plan rejects a foreign owner identity and a non-empty coordination fence", () => {
  const foreignOwner = evidenceFixture();
  foreignOwner.claim.deviceId = pseudonymousIdentifier("device", "foreign-device");
  foreignOwner.stableEvidenceDigest = orphanedAbsentAuthoredStableEvidenceDigest(foreignOwner);
  assert.throws(() => buildPlan(foreignOwner), /do not form one identity/u);

  const changedFence = evidenceFixture();
  changedFence.authoredRange.fenceTreeSha = sha("f");
  const rangeCore = { ...changedFence.authoredRange };
  delete rangeCore.rangeDigest;
  changedFence.authoredRange.rangeDigest = digestValue(rangeCore);
  changedFence.stableEvidenceDigest = orphanedAbsentAuthoredStableEvidenceDigest(changedFence);
  assert.throws(() => buildPlan(changedFence), /incomplete or drifted/u);
});

test("state admits only the exact next phase and content-bound receipt schema", () => {
  const plan = buildPlan(evidenceFixture());
  const planned = createState(plan);
  assert.equal(normalizeState(planned).phase, "planned");
  assert.throws(() => advanceState(planned, "claim-retired", claimValues(plan)),
    /cannot advance/u);

  const authorized = advanceState(planned, "authorized", authorizationValues(plan));
  assert.equal(authorized.receipts.authorized.schema, RECEIPT_SCHEMA);
  assert.deepEqual(Object.keys(authorized.receipts), ["authorized"]);

  const unexpected = structuredClone(authorized);
  unexpected.receipts.authorized.unexpectedAuthority = true;
  resealReceipt(unexpected.receipts.authorized);
  resealState(unexpected);
  assert.throws(() => normalizeState(unexpected), /authorized receipt/u);

  const closed = advanceState(authorized, "pull-request-closed", closeValues(plan));
  const foreignCloseKey = structuredClone(closed);
  foreignCloseKey.receipts["pull-request-closed"].operationKey = digest("f");
  resealReceipt(foreignCloseKey.receipts["pull-request-closed"]);
  resealState(foreignCloseKey);
  assert.throws(() => normalizeState(foreignCloseKey), /operation key|closure join/u);
  const reordered = structuredClone(closed);
  reordered.receipts = {
    "pull-request-closed": reordered.receipts["pull-request-closed"],
    authorized: reordered.receipts.authorized,
  };
  resealState(reordered);
  assert.throws(() => normalizeState(reordered), /out of order/u);

  const wrongPhase = structuredClone(closed);
  wrongPhase.receipts["pull-request-closed"].phase = "claim-retired";
  resealReceipt(wrongPhase.receipts["pull-request-closed"]);
  resealState(wrongPhase);
  assert.throws(() => normalizeState(wrongPhase), /pull-request-closed receipt/u);

  const retired = advanceState(closed, "claim-retired", claimValues(plan));
  const foreignRequest = structuredClone(retired);
  foreignRequest.receipts["claim-retired"].requestDigest = digest("f");
  resealReceipt(foreignRequest.receipts["claim-retired"]);
  resealState(foreignRequest);
  assert.throws(() => normalizeState(foreignRequest), /retirement join/u);
});

test("completion receipt joins every effect receipt and rejects a resealed foreign terminal", () => {
  const plan = buildPlan(evidenceFixture());
  let state = createState(plan);
  state = advanceState(state, "authorized", authorizationValues(plan));
  state = advanceState(state, "pull-request-closed", closeValues(plan));
  state = advanceState(state, "claim-retired", claimValues(plan));
  state = advanceState(state, "verified",
    verificationValues(plan, state.receipts["claim-retired"]));

  const receipt = buildCompletionReceipt(state);
  assert.equal(receipt.planDigest, plan.planDigest);
  assert.equal(receipt.pullRequestCloseReceiptDigest,
    state.receipts["pull-request-closed"].receiptDigest);
  assert.equal(receipt.claimRetirementReceiptDigest,
    state.receipts["claim-retired"].receiptDigest);
  assert.equal(receipt.terminalEvidenceDigest, state.receipts.verified.terminalEvidenceDigest);

  state = advanceState(state, "complete", { receipt });
  assert.equal(normalizeState(state).receipts.complete.receipt.receiptDigest,
    receipt.receiptDigest);

  const crossed = structuredClone(state);
  crossed.receipts.complete.receipt.status = "foreign";
  resealCompletion(crossed.receipts.complete.receipt);
  resealReceipt(crossed.receipts.complete);
  resealState(crossed);
  assert.throws(() => normalizeState(crossed), /complete receipt/u);

  const foreignVerification = structuredClone(state);
  foreignVerification.phase = "verified";
  delete foreignVerification.receipts.complete;
  foreignVerification.receipts.verified.terminalEvidenceDigest = digest("f");
  resealReceipt(foreignVerification.receipts.verified);
  resealState(foreignVerification);
  assert.throws(() => normalizeState(foreignVerification), /terminal evidence join/u);
});

function authorizationValues(plan) {
  return { authorizationDigest: digestValue({
    planDigest: plan.planDigest, authorization: plan.exactAuthorization,
  }) };
}

function closeValues(plan) {
  return {
    operationKey: retirementJournalOperationKey(plan, "pull-request-closed"),
    pullRequestNumber: plan.evidence.pullRequest.number,
    pullRequestNodeId: plan.evidence.pullRequest.nodeId,
    closedAt: "2026-08-28T15:47:30.000Z",
    disposition: "projected",
    providerMutation: true,
  };
}

function claimValues(plan) {
  return {
    operationKey: retirementJournalOperationKey(plan, "claim-retired"),
    claimId: plan.evidence.claim.claimId,
    requestDigest: retirementRequestDigest(plan),
    operationReceiptDigest: digest("8"),
    terminalEntryDigest: digest("9"),
    disposition: "projected",
    cloudMutation: true,
  };
}

function verificationValues(plan, claimRetirement) {
  return { terminalEvidenceDigest: retirementTerminalEvidenceDigest(plan, claimRetirement) };
}

function resealReceipt(receipt) {
  const core = { ...receipt };
  delete core.receiptDigest;
  receipt.receiptDigest = digestValue(core);
}

function resealCompletion(receipt) {
  const core = { ...receipt };
  delete core.receiptDigest;
  receipt.receiptDigest = digestValue(core);
}

function resealState(state) {
  const core = { ...state };
  delete core.stateDigest;
  state.stateDigest = digestValue(core);
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
    sessionId: "owner-session", device: "owner-device", scope, branch,
    baseSha, fenceSha,
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
