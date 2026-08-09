// Responsibility: Prove exact-subject suppression and fail-closed live receipt validation.
import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import * as Contract from "../scripts/retired-handoff-successor-disposition-contract.mjs";
import {
  applyProviderScopeDispositionReceipts,
  validateLiveProviderScopeDisposition,
} from "../scripts/provider-scope-disposition.mjs";

const digest = character => character.repeat(64);
const sha = character => character.repeat(40);
const artifacts = realContractArtifacts();
const { complete: intent, evidence, plan, receipt } = artifacts;
const subjectKey = plan.subjectKey;
const provider = Object.freeze(Object.fromEntries([
  "repository", "pullRequestNumber", "pullRequestNodeId", "state", "isDraft",
  "branch", "headSha", "baseSha", "bodyDigest", "providerVersion",
].map(key => [key, evidence.source[key]])));
const contract = Object.freeze({
  normalizeRetiredHandoffSuccessorDispositionReceipt: value => Object.freeze({ ...value }),
  normalizeRetiredHandoffSuccessorDispositionIntent: value => Object.freeze({ ...value }),
  normalizeRetiredHandoffSuccessorDispositionEvidence: value => Object.freeze({ ...value }),
  retiredHandoffSuccessorDispositionSubjectKey: () => subjectKey,
});

test("one exact live receipt validates and suppresses only its provider subject", () => {
  const other = Object.freeze({
    ...provider,
    pullRequestNumber: 757,
    pullRequestNodeId: "PR_node_757",
    branch: "agent/device/xr-v2-main-authority-reseal",
    headSha: sha("1"),
    bodyDigest: digest("2"),
    providerVersion: "etag-757",
  });
  const result = applyProviderScopeDispositionReceipts({
    pullRequests: [provider, other],
    receipts: [receipt],
    intents: [intent],
    observations: [evidence],
  }, { contract });

  assert.deepEqual(result.activePullRequests, [other]);
  assert.equal(result.suppressedSubjects.length, 1);
  assert.equal(result.suppressedSubjects[0].subjectKey, subjectKey);
  assert.equal(result.suppressedSubjects[0].classification,
    "retired-handoff-superseded-by-merged-successor");
  assert.equal(result.suppressedSubjects[0].receiptDigest, receipt.receiptDigest);
  assert.equal(result.blockingSubjects.length, 1);
  assert.equal(result.blockingSubjects[0].pullRequestNumber, 757);
  assert.match(result.receiptSetDigest, /^[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(result.activePullRequests), true);
  assert.equal(Object.isFrozen(result.suppressedSubjects), true);
});

test("unrelated snapshot drift is tolerated but durable source drift is blocked", () => {
  const refreshed = resealEvidence({
    ...structuredClone(evidence),
    controller: { ...evidence.controller, headSha: sha("d"), mainSha: sha("d"),
      originMainSha: sha("d"), remoteMainSha: sha("d") },
    ledger: { ...evidence.ledger, revision: sha("e"), rereadRevision: sha("e"), sequence: 1454 },
    source: { ...evidence.source, baseSha: sha("f"), providerVersion: "2026-08-10T00:01:00Z" },
    successor: { ...evidence.successor, protectedMainSha: sha("d"), requiredChecksDigest: digest("3") },
  });
  const validation = validateLiveProviderScopeDisposition({
    receipt, intent, observation: refreshed,
  });
  assert.equal(validation.subjectKey, subjectKey);
  assert.notEqual(validation.evidenceDigest, receipt.evidenceDigest);

  const changedHead = resealEvidence({
    ...structuredClone(evidence),
    source: { ...evidence.source, headSha: sha("e"), remoteHeadSha: sha("e") },
  });
  assert.throws(
    () => validateLiveProviderScopeDisposition({
      receipt, intent, observation: changedHead,
    }),
    /live subject evidence|durable subject changed/u,
  );
});

test("preservation or cleanup-bearing artifacts can never become waivers", () => {
  for (const changedReceipt of [
    { ...receipt, admissionEffect: "block" },
    { ...receipt, cleanupEligible: true },
    { ...receipt, status: "preserved" },
  ]) {
    assert.throws(
      () => validateLiveProviderScopeDisposition({
        receipt: changedReceipt,
        intent,
        observation: evidence,
      }, { contract }),
      /cannot suppress/u,
    );
  }
});

test("a receipt cannot suppress a different head or an absent provider", () => {
  assert.throws(
    () => applyProviderScopeDispositionReceipts({
      pullRequests: [{ ...provider, headSha: sha("e") }],
      receipts: [receipt],
      intents: [intent],
      observations: [evidence],
    }, { contract }),
    /did not match an active provider projection/u,
  );
  assert.throws(
    () => applyProviderScopeDispositionReceipts({
      pullRequests: [],
      receipts: [receipt],
      intents: [intent],
      observations: [evidence],
    }, { contract }),
    /did not match an active provider projection/u,
  );
});

test("duplicate provider or receipt subjects fail closed", () => {
  assert.throws(
    () => applyProviderScopeDispositionReceipts({
      pullRequests: [provider, provider],
    }, { contract }),
    /duplicate subjects/u,
  );
  assert.throws(
    () => applyProviderScopeDispositionReceipts({
      pullRequests: [provider],
      receipts: [receipt, receipt],
      intents: [intent, intent],
      observations: [evidence, evidence],
    }, { contract }),
    /duplicate subjects/u,
  );
});

test("forged receipt or complete-intent bindings fail before suppression", () => {
  for (const [changedReceipt, changedIntent] of [
    [{ ...receipt, portDecisionDigest: digest("4") }, intent],
    [receipt, { ...intent, authorizationDigest: digest("4") }],
    [receipt, { ...intent, phases: {
      ...intent.phases,
      complete: { values: { ...intent.phases.complete.values, receiptDigest: digest("4") } },
    } }],
  ]) {
    assert.throws(
      () => validateLiveProviderScopeDisposition({
        receipt: changedReceipt,
        intent: changedIntent,
        observation: evidence,
      }, { contract }),
      /not backed by its exact complete intent/u,
    );
  }
});

test("a real contract plan, complete intent, receipt, and live evidence validate together", () => {
  const artifacts = realContractArtifacts();
  const validation = validateLiveProviderScopeDisposition({
    receipt: artifacts.receipt,
    intent: artifacts.complete,
    observation: artifacts.evidence,
  });
  assert.equal(validation.status, "valid");
  assert.equal(validation.subjectKey, artifacts.plan.subjectKey);
  assert.equal(validation.intentDigest, artifacts.complete.intentDigest);
  assert.equal(validation.receiptDigest, artifacts.receipt.receiptDigest);
});

function resealEvidence(value) {
  const core = structuredClone(value);
  delete core.evidenceDigest;
  return { ...core, evidenceDigest: digestValue(core) };
}

function realContractArtifacts() {
  const controllerSha = sha("1");
  const controllerTree = sha("2");
  const finalRevision = sha("3");
  const sourceHead = sha("4");
  const evidenceCore = {
    schema: Contract.RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_EVIDENCE_SCHEMA,
    provider: "github",
    repositoryId: "R_target",
    controller: {
      repository: "owner/agentic-canvas-os",
      rootRealpath: "/protected/agentic-canvas-os",
      runtimeModuleRootRealpath: "/protected/agentic-canvas-os",
      headSha: controllerSha,
      headTreeSha: controllerTree,
      mainSha: controllerSha,
      originMainSha: controllerSha,
      remoteMainSha: controllerSha,
      remoteMainTreeSha: controllerTree,
      originUrlDigest: digest("1"),
      statusDigest: digest("2"),
      clean: true,
      runtimeFileSetDigest: digest("3"),
    },
    ledger: {
      repository: "owner/agentic-canvas-os",
      revision: sha("5"),
      blobSha: sha("6"),
      rawDigest: digest("4"),
      rereadRevision: sha("5"),
      rereadBlobSha: sha("6"),
      rereadRawDigest: digest("4"),
      digest: digest("5"),
      sequence: 1453,
    },
    claim: {
      claimId: digest("6"),
      claimDigest: digest("7"),
      transitionDigest: digest("8"),
      transitionCounter: 4,
      state: "retired",
      retirementReason: "handoff",
      finalRevision,
      reviewRequestId: "github-pull-request:PR_node712",
      handoffEvidenceDigest: digest("9"),
      entryDigest: digest("8"),
    },
    source: {
      repository: "owner/knowgrph",
      pullRequestNumber: 712,
      pullRequestNodeId: "PR_node712",
      state: "OPEN",
      isDraft: true,
      branch: "agent/device/xr-v2-production-runtime-readiness-final",
      headSha: sourceHead,
      baseSha: sha("7"),
      bodyDigest: digest("a"),
      providerVersion: "2026-08-10T00:00:00Z",
      remoteHeadSha: sourceHead,
      handoffMarkerFinalRevision: finalRevision,
      retiredRevisionReachable: true,
    },
    successor: {
      pullRequestNumber: 742,
      pullRequestNodeId: "PR_node742",
      state: "MERGED",
      branch: "agent/device/xr-v2-successor",
      headSha: sha("8"),
      mergeCommitSha: sha("9"),
      protectedMainSha: sha("a"),
      protectedMainContainsMerge: true,
      requiredChecksDigest: digest("b"),
    },
    local: {
      projectionDigest: digest("c"),
      worktreeCount: 0,
      branchPresent: false,
      leasePresent: false,
      cleanupEligible: false,
    },
    functionalSourceCommits: [
      { sha: finalRevision, patchId: sha("b"), changedPathsDigest: digest("d") },
    ],
    successorCommits: [
      { sha: sha("c"), patchId: sha("b"), changedPathsDigest: digest("d") },
    ],
  };
  const evidence = Contract.normalizeRetiredHandoffSuccessorDispositionEvidence(
    resealEvidence(evidenceCore),
  );
  const decisionCore = {
    schema: Contract.RETIRED_HANDOFF_SUCCESSOR_PORT_DECISION_SCHEMA,
    evidenceDigest: evidence.evidenceDigest,
    entries: [{
      sourceCommitSha: finalRevision,
      kind: "patch-identical",
      successorCommitShas: [sha("c")],
      rationale: null,
    }],
  };
  const portDecision = {
    ...decisionCore,
    decisionDigest: digestValue(decisionCore),
  };
  const plan = Contract.buildRetiredHandoffSuccessorDispositionPlan({ evidence, portDecision });
  const authorizationReceipt = Contract.authorizeRetiredHandoffSuccessorDisposition({
    plan,
    authorization: plan.exactAuthorization,
  });
  const authorized = Contract.createRetiredHandoffSuccessorDispositionIntent({
    plan,
    authorizationReceipt,
  });
  const verified = Contract.advanceRetiredHandoffSuccessorDispositionIntent(authorized, {
    status: "verified",
    values: {
      operationKey: Contract.retiredHandoffSuccessorDispositionOperationKey({
        planDigest: plan.planDigest,
        subjectKey: plan.subjectKey,
        phase: "verified",
      }),
      evidenceDigest: plan.evidenceDigest,
    },
  });
  const receipt = Contract.buildRetiredHandoffSuccessorDispositionReceipt({
    plan,
    intent: verified,
    evidence,
  });
  const complete = Contract.advanceRetiredHandoffSuccessorDispositionIntent(verified, {
    status: "complete",
    values: {
      operationKey: receipt.completeOperationKey,
      evidenceDigest: plan.evidenceDigest,
      receiptDigest: receipt.receiptDigest,
    },
  });
  return { complete, evidence, plan, receipt };
}
