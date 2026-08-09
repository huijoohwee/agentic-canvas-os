import test from "node:test";
import assert from "node:assert/strict";

// Responsibility: prove exact PR712 disposition sealing, authorization, replay, and tamper rejection.

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_EVIDENCE_SCHEMA,
  RETIRED_HANDOFF_SUCCESSOR_PORT_DECISION_SCHEMA,
  authorizeRetiredHandoffSuccessorDisposition,
  advanceRetiredHandoffSuccessorDispositionIntent,
  buildRetiredHandoffSuccessorDispositionPlan,
  buildRetiredHandoffSuccessorDispositionReceipt,
  buildRetiredHandoffSuccessorPortDecisionTemplate,
  createRetiredHandoffSuccessorDispositionIntent,
  normalizeRetiredHandoffSuccessorDispositionEvidence,
  normalizeRetiredHandoffSuccessorDispositionIntent,
  normalizeRetiredHandoffSuccessorDispositionPlan,
  normalizeRetiredHandoffSuccessorDispositionReceipt,
  normalizeRetiredHandoffSuccessorPortDecision,
  retiredHandoffSuccessorDispositionOperationKey,
  retiredHandoffSuccessorDispositionSubjectKey,
} from "../scripts/retired-handoff-successor-disposition-contract.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);

function fixtureEvidence() {
  const controllerSha = sha("1");
  const controllerTree = sha("2");
  const finalRevision = sha("3");
  const sourceHead = sha("5");
  const core = {
    schema: RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_EVIDENCE_SCHEMA,
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
      revision: sha("6"),
      blobSha: sha("7"),
      rawDigest: digest("4"),
      rereadRevision: sha("6"),
      rereadBlobSha: sha("7"),
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
      repository: "owner/target",
      pullRequestNumber: 712,
      pullRequestNodeId: "PR_node712",
      state: "OPEN",
      isDraft: true,
      branch: "agent/retired-handoff",
      headSha: sourceHead,
      baseSha: sha("4"),
      bodyDigest: digest("a"),
      providerVersion: "W/etag-source",
      remoteHeadSha: sourceHead,
      handoffMarkerFinalRevision: finalRevision,
      retiredRevisionReachable: true,
    },
    successor: {
      pullRequestNumber: 742,
      pullRequestNodeId: "PR_node742",
      state: "MERGED",
      branch: "agent/merged-successor",
      headSha: sha("8"),
      mergeCommitSha: sha("9"),
      protectedMainSha: sha("a"),
      protectedMainContainsMerge: true,
      requiredChecksDigest: digest("b"),
    },
    local: {
      projectionDigest: digest("c"),
      worktreeCount: 1,
      branchPresent: true,
      leasePresent: false,
      cleanupEligible: false,
    },
    functionalSourceCommits: [
      { sha: finalRevision, patchId: sha("b"), changedPathsDigest: digest("d") },
      { sha: sha("4"), patchId: sha("c"), changedPathsDigest: digest("e") },
      { sha: sourceHead, patchId: sha("d"), changedPathsDigest: digest("f") },
    ],
    successorCommits: [
      { sha: sha("b"), patchId: sha("b"), changedPathsDigest: digest("0") },
      { sha: sha("c"), patchId: sha("e"), changedPathsDigest: digest("1") },
      { sha: sha("d"), patchId: sha("f"), changedPathsDigest: digest("2") },
    ],
  };
  return sealEvidence(core);
}

function fixtureDecision(evidence = fixtureEvidence()) {
  return sealDecision(evidence, [
    {
      sourceCommitSha: evidence.functionalSourceCommits[0].sha,
      kind: "patch-identical",
      successorCommitShas: [evidence.successorCommits[0].sha],
      rationale: null,
    },
    {
      sourceCommitSha: evidence.functionalSourceCommits[1].sha,
      kind: "evolved-in-successor",
      successorCommitShas: [evidence.successorCommits[1].sha, evidence.successorCommits[2].sha],
      rationale: "The successor composes this behavior across its runtime and proof commits.",
    },
    {
      sourceCommitSha: evidence.functionalSourceCommits[2].sha,
      kind: "obsolete-by-successor",
      successorCommitShas: [],
      rationale: "The merged successor makes this source-only bridge unnecessary.",
    },
  ]);
}

function sealEvidence(core) {
  const value = structuredClone(core);
  delete value.evidenceDigest;
  return { ...value, evidenceDigest: digestValue(value) };
}

function sealDecision(evidence, entries) {
  const core = {
    schema: RETIRED_HANDOFF_SUCCESSOR_PORT_DECISION_SCHEMA,
    evidenceDigest: evidence.evidenceDigest,
    entries: structuredClone(entries),
  };
  return { ...core, decisionDigest: digestValue(core) };
}

function fixturePlan() {
  const evidence = fixtureEvidence();
  return { evidence, plan: buildRetiredHandoffSuccessorDispositionPlan({
    evidence,
    portDecision: fixtureDecision(evidence),
  }) };
}

function verifiedFixture() {
  const { evidence, plan } = fixturePlan();
  const authorizationReceipt = authorizeRetiredHandoffSuccessorDisposition({
    plan,
    authorization: plan.exactAuthorization,
  });
  const authorized = createRetiredHandoffSuccessorDispositionIntent({ plan, authorizationReceipt });
  const operationKey = retiredHandoffSuccessorDispositionOperationKey({
    planDigest: plan.planDigest, subjectKey: plan.subjectKey, phase: "verified",
  });
  const verified = advanceRetiredHandoffSuccessorDispositionIntent(authorized, {
    status: "verified",
    values: { operationKey, evidenceDigest: plan.evidenceDigest },
  });
  return { evidence, plan, authorizationReceipt, authorized, verified };
}

test("seals PR712 evidence, a complete port map, exact authorization, phases, and receipt", () => {
  const { evidence, plan, authorizationReceipt, authorized, verified } = verifiedFixture();
  assert.notEqual(evidence.claim.finalRevision, evidence.source.headSha);
  assert.deepEqual(normalizeRetiredHandoffSuccessorDispositionPlan(plan), plan);
  assert.match(plan.exactAuthorization, new RegExp(`${plan.planDigest}$`, "u"));
  assert.equal(authorizationReceipt.planDigest, plan.planDigest);
  assert.equal(authorized.status, "authorized");
  assert.equal(verified.status, "verified");
  assert.deepEqual(advanceRetiredHandoffSuccessorDispositionIntent(verified, {
    status: "verified", values: verified.phases.verified.values,
  }), verified);

  const receipt = buildRetiredHandoffSuccessorDispositionReceipt({ plan, intent: verified, evidence });
  assert.deepEqual(normalizeRetiredHandoffSuccessorDispositionReceipt(receipt), receipt);
  assert.equal(receipt.admissionEffect, "suppress-exact-provider-subject");
  assert.equal(receipt.cleanupEligible, false);
  const completeValues = {
    operationKey: receipt.completeOperationKey,
    evidenceDigest: plan.evidenceDigest,
    receiptDigest: receipt.receiptDigest,
  };
  const complete = advanceRetiredHandoffSuccessorDispositionIntent(verified, {
    status: "complete", values: completeValues,
  });
  assert.equal(complete.status, "complete");
  assert.deepEqual(normalizeRetiredHandoffSuccessorDispositionIntent(complete), complete);
  assert.deepEqual(advanceRetiredHandoffSuccessorDispositionIntent(complete, {
    status: "complete", values: completeValues,
  }), complete);
});

test("emits a digest-bound non-authority residual port template", () => {
  const evidence = fixtureEvidence();
  const template = buildRetiredHandoffSuccessorPortDecisionTemplate(evidence);
  assert.equal(template.status, "operator-input-required");
  assert.equal(template.entries[0].kind, "patch-identical");
  assert.deepEqual(template.requiredOperatorSourceCommitShas, [
    evidence.functionalSourceCommits[1].sha,
    evidence.functionalSourceCommits[2].sha,
  ]);
  assert.throws(() => buildRetiredHandoffSuccessorDispositionPlan({
    evidence, portDecision: template,
  }), /exact keys/u);
});

test("binds an empty terminal coordination revision outside functional port coverage", () => {
  const liveShaped = structuredClone(fixtureEvidence());
  liveShaped.functionalSourceCommits = liveShaped.functionalSourceCommits.slice(1);
  const evidence = sealEvidence(liveShaped);
  assert.notEqual(evidence.claim.finalRevision, evidence.source.headSha);
  assert.doesNotThrow(() => normalizeRetiredHandoffSuccessorDispositionEvidence(evidence));
  const template = buildRetiredHandoffSuccessorPortDecisionTemplate(evidence);
  assert.equal(template.entries.length, evidence.functionalSourceCommits.length);
  assert.equal(template.entries.some(entry => entry.sourceCommitSha === evidence.claim.finalRevision), false);

  const unreachable = structuredClone(evidence);
  unreachable.source.retiredRevisionReachable = false;
  assert.throws(() => normalizeRetiredHandoffSuccessorDispositionEvidence(
    sealEvidence(unreachable),
  ), /semantics/u);
  const markerDrift = structuredClone(evidence);
  markerDrift.source.handoffMarkerFinalRevision = sha("f");
  assert.throws(() => normalizeRetiredHandoffSuccessorDispositionEvidence(
    sealEvidence(markerDrift),
  ), /semantics/u);
});

test("rejects wrong tokens and all evidence or protected-runtime drift", () => {
  const { evidence, plan } = fixturePlan();
  assert.throws(() => authorizeRetiredHandoffSuccessorDisposition({
    plan, authorization: `${plan.exactAuthorization} `,
  }), /exact authorization/u);
  const extra = structuredClone(evidence);
  extra.unexpected = true;
  assert.throws(() => normalizeRetiredHandoffSuccessorDispositionEvidence(extra), /exact keys/u);

  const ledgerDrift = structuredClone(evidence);
  ledgerDrift.ledger.rereadRawDigest = digest("0");
  assert.throws(() => normalizeRetiredHandoffSuccessorDispositionEvidence(
    sealEvidence(ledgerDrift),
  ), /A\/B raw reads/u);
  const runtimeDrift = structuredClone(evidence);
  runtimeDrift.controller.runtimeModuleRootRealpath = "/untrusted/worktree";
  assert.throws(() => normalizeRetiredHandoffSuccessorDispositionEvidence(
    sealEvidence(runtimeDrift),
  ), /protected main runtime/u);
  const reviewDrift = structuredClone(evidence);
  reviewDrift.claim.reviewRequestId = "github-pull-request:another-node";
  assert.throws(() => normalizeRetiredHandoffSuccessorDispositionEvidence(
    sealEvidence(reviewDrift),
  ), /semantics/u);
  const planDrift = structuredClone(plan);
  planDrift.cleanupEligible = true;
  assert.throws(() => normalizeRetiredHandoffSuccessorDispositionPlan(planDrift), /drifted/u);
});

test("requires exact ordered coverage and sound decision-kind invariants", () => {
  const evidence = fixtureEvidence();
  const decision = fixtureDecision(evidence);
  assert.deepEqual(normalizeRetiredHandoffSuccessorPortDecision(decision, evidence), decision);
  assert.throws(() => normalizeRetiredHandoffSuccessorPortDecision(
    sealDecision(evidence, decision.entries.slice(0, 2)), evidence,
  ), /every functional source commit/u);
  assert.throws(() => normalizeRetiredHandoffSuccessorPortDecision(
    sealDecision(evidence, [decision.entries[1], decision.entries[0], decision.entries[2]]), evidence,
  ), /exact functional source commit order/u);

  const badPatch = structuredClone(decision.entries);
  badPatch[0].rationale = "Operator text cannot replace stable patch identity.";
  assert.throws(() => normalizeRetiredHandoffSuccessorPortDecision(
    sealDecision(evidence, badPatch), evidence,
  ), /patch-identical mapping/u);
  const missingRationale = structuredClone(decision.entries);
  missingRationale[1].rationale = null;
  assert.throws(() => normalizeRetiredHandoffSuccessorPortDecision(
    sealDecision(evidence, missingRationale), evidence,
  ), /mapping or rationale/u);
  const obsoleteWithSuccessor = structuredClone(decision.entries);
  obsoleteWithSuccessor[2].successorCommitShas = [evidence.successorCommits[2].sha];
  assert.throws(() => normalizeRetiredHandoffSuccessorPortDecision(
    sealDecision(evidence, obsoleteWithSuccessor), evidence,
  ), /mapping or rationale/u);
});

test("requires an exact reasoned selection among duplicate stable candidates", () => {
  const ambiguous = structuredClone(fixtureEvidence());
  ambiguous.successorCommits.push({
    sha: sha("e"),
    patchId: ambiguous.functionalSourceCommits[0].patchId,
    changedPathsDigest: digest("3"),
  });
  const sealedAmbiguous = sealEvidence(ambiguous);
  const template = buildRetiredHandoffSuccessorPortDecisionTemplate(sealedAmbiguous);
  assert.equal(template.entries[0].kind, null);
  assert.deepEqual(template.entries[0].successorCommitShas, [sha("b"), sha("e")]);
  assert.equal(template.requiredOperatorSourceCommitShas.includes(
    sealedAmbiguous.functionalSourceCommits[0].sha,
  ), true);
  const selected = structuredClone(fixtureDecision(sealedAmbiguous).entries);
  selected[0].rationale = "The first stable candidate is the reachable functional implementation.";
  assert.doesNotThrow(() => normalizeRetiredHandoffSuccessorPortDecision(
    sealDecision(sealedAmbiguous, selected), sealedAmbiguous,
  ));
  const invalidSelection = structuredClone(selected);
  invalidSelection[0].successorCommitShas = [sealedAmbiguous.successorCommits[1].sha];
  assert.throws(() => normalizeRetiredHandoffSuccessorPortDecision(
    sealDecision(sealedAmbiguous, invalidSelection), sealedAmbiguous,
  ), /patch-identical mapping/u);
  const missingSelectionRationale = structuredClone(selected);
  missingSelectionRationale[0].rationale = null;
  assert.throws(() => normalizeRetiredHandoffSuccessorPortDecision(
    sealDecision(sealedAmbiguous, missingSelectionRationale), sealedAmbiguous,
  ), /patch-identical mapping/u);
  const relabeled = structuredClone(selected);
  relabeled[0].kind = "evolved-in-successor";
  assert.throws(() => normalizeRetiredHandoffSuccessorPortDecision(
    sealDecision(sealedAmbiguous, relabeled), sealedAmbiguous,
  ), /must use a stable patch identity/u);
});

test("blocks intent skipping and authorization replay drift", () => {
  const { plan, authorized, verified } = verifiedFixture();
  assert.throws(() => advanceRetiredHandoffSuccessorDispositionIntent(authorized, {
    status: "complete",
    values: {
      operationKey: retiredHandoffSuccessorDispositionOperationKey({
        planDigest: plan.planDigest, subjectKey: plan.subjectKey, phase: "complete",
      }),
      evidenceDigest: plan.evidenceDigest,
      receiptDigest: digest("4"),
    },
  }), /cannot advance/u);
  assert.throws(() => advanceRetiredHandoffSuccessorDispositionIntent(verified, {
    status: "verified",
    values: { ...verified.phases.verified.values, evidenceDigest: digest("5") },
  }), /operation-bound/u);
  const tampered = structuredClone(verified);
  tampered.authorizationDigest = digest("6");
  assert.throws(() => normalizeRetiredHandoffSuccessorDispositionIntent(tampered), /drifted/u);
  const resealed = structuredClone(verified);
  resealed.authorizationDigest = digest("6");
  const resealedCore = structuredClone(resealed);
  delete resealedCore.intentDigest;
  resealed.intentDigest = digestValue(resealedCore);
  assert.throws(() => normalizeRetiredHandoffSuccessorDispositionIntent(resealed), /drifted/u);
});

test("rejects receipt tampering and distinguishes exact subjects and phases", () => {
  const { evidence, plan, verified } = verifiedFixture();
  const receipt = buildRetiredHandoffSuccessorDispositionReceipt({ plan, intent: verified, evidence });
  const extra = structuredClone(receipt);
  extra.providerClosed = true;
  assert.throws(() => normalizeRetiredHandoffSuccessorDispositionReceipt(extra), /exact keys/u);
  const cleanup = structuredClone(receipt);
  cleanup.cleanupEligible = true;
  const cleanupCore = structuredClone(cleanup);
  delete cleanupCore.receiptDigest;
  cleanup.receiptDigest = digestValue(cleanupCore);
  assert.throws(() => normalizeRetiredHandoffSuccessorDispositionReceipt(cleanup), /drifted/u);

  const changed = structuredClone(evidence);
  changed.source.providerVersion = "W/new-etag";
  changed.source.bodyDigest = digest("3");
  const changedEvidence = sealEvidence(changed);
  assert.notEqual(
    retiredHandoffSuccessorDispositionSubjectKey(evidence),
    retiredHandoffSuccessorDispositionSubjectKey(changedEvidence),
  );
  assert.throws(() => buildRetiredHandoffSuccessorDispositionReceipt({
    plan, intent: verified, evidence: changedEvidence,
  }), /exact verified plan/u);
  assert.notEqual(receipt.verifiedOperationKey, receipt.completeOperationKey);
});

test("subject keys bind the merged successor but exclude volatile validation state", () => {
  const evidence = fixtureEvidence();
  const baseline = retiredHandoffSuccessorDispositionSubjectKey(evidence);
  for (const [field, value] of [
    ["pullRequestNodeId", "PR_node742_replaced"],
    ["headSha", sha("e")],
    ["mergeCommitSha", sha("f")],
  ]) {
    const drifted = structuredClone(evidence);
    drifted.successor[field] = value;
    assert.notEqual(retiredHandoffSuccessorDispositionSubjectKey(sealEvidence(drifted)), baseline);
  }

  const refreshed = structuredClone(evidence);
  refreshed.successor.protectedMainSha = sha("f");
  refreshed.successor.requiredChecksDigest = digest("4");
  refreshed.ledger.revision = sha("e");
  refreshed.ledger.rereadRevision = sha("e");
  refreshed.controller.headSha = sha("f");
  refreshed.controller.mainSha = sha("f");
  refreshed.controller.originMainSha = sha("f");
  refreshed.controller.remoteMainSha = sha("f");
  assert.equal(retiredHandoffSuccessorDispositionSubjectKey(sealEvidence(refreshed)), baseline);
});
