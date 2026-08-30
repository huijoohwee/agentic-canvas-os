import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  RETIREMENT_PLAN_SCHEMA,
  REPLACEMENT_PLAN_SCHEMA,
  advanceSuccessorRolloverReplacement,
  advanceSuccessorRolloverRetirement,
  authorizeSuccessorRolloverReplacement,
  authorizeSuccessorRolloverRetirement,
  beginSuccessorRolloverReplacement,
  buildSuccessorRolloverCompletion,
  buildSuccessorRolloverReplacementPlan,
  buildSuccessorRolloverRetirementPlan,
  createSuccessorRolloverJournal,
  normalizeSuccessorRolloverJournal,
  normalizeSuccessorRolloverReplacementPlan,
  normalizeSuccessorRolloverRetirementPlan,
  successorRolloverOperationKey,
} from "../scripts/active-dirty-scope-expansion-successor-rollover-contract.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);
const C1 = digest("1"), C2 = digest("2"), C3 = digest("3");
const SOURCE_FENCE = sha("a"), OLD_BASE = sha("b"), CURRENT_MAIN = sha("c");
const OPERATOR = "recovery-controller-session";
const SOURCE = ["path:a.mjs", "path:b.mjs", "semantic:commerce"];
const STALE = ["path:a.mjs", "path:b.mjs", "path:c.mjs", "path:device-branch-lib.mjs", "semantic:commerce"];
const CORRECTED = ["path:a.mjs", "path:b.mjs", "path:c.mjs", "semantic:commerce"];
function sourceClaimIdentity() { const core = { repositoryId: "github-repository:1",
  actorId: "github-user:1", deviceId: "device:pseudonymous", sessionId: "session:pseudonymous",
  workItemId: "work-item:pseudonymous" }; return { ...core, identityDigest: digestValue(core) }; }

function retirementObservation(overrides = {}) {
  const core = {
    schema: "agentic-active-dirty-scope-expansion-successor-rollover-retirement-observation/v1",
    sourceClaimIdentity: sourceClaimIdentity(), controllerDigest: digest("a"),
    protectedMainSha: CURRENT_MAIN, protectedMainTreeSha: sha("d"),
    protectedMainAdvanceDigest: digest("b"),
    protectedMainChangedPaths: ["device-branch-lib.mjs"],
    branch: "agent/device/commerce", sourceSessionId: "source-session", semanticScope: "commerce",
    sourceFenceSha: SOURCE_FENCE, sourceLeaseDigest: digest("c"), sourceClaimId: C1,
    sourceClaimDigest: digest("d"), sourceReviewRequestId: "github-pull-request:PR_808",
    sourceWriteSetDigest: digestValue(SOURCE), sourceManifestDigest: digest("e"),
    sourceDeclaredWriteSet: SOURCE, sourceDirtDigest: digest("f"), sourceChangedPaths: ["a.mjs"],
    sourceIntentDigest: digest("4"), sourceIntentPlanDigest: digest("5"),
    sourceIntentStatus: "source-retired", sourceRetirementReceiptDigest: digest("6"),
    staleSuccessorClaimId: C2, staleSuccessorClaimDigest: digest("7"),
    staleSuccessorTransitionDigest: digest("8"), staleSuccessorTransitionCounter: 1,
    staleSuccessorState: "waiting-successor", staleSuccessorPredecessorClaimId: C1,
    staleTargetCanonicalBaseSha: OLD_BASE, staleTargetWriteSetDigest: digestValue(STALE),
    staleTargetManifestDigest: digest("9"), staleTargetDeclaredWriteSet: STALE,
    staleExpiresAt: "2099-08-30T00:00:00.000Z", pullRequestNumber: 808,
    pullRequestNodeId: "PR_808", pullRequestMarkerDigest: digest("a"),
    pullRequestBodyDigest: digest("b"), observedLedgerRevision: sha("e"),
    observedLedgerDigest: digest("c"), observedLedgerSequence: 88,
    ...overrides,
  };
  delete core.observationDigest;
  return { ...core, observationDigest: digestValue(core) };
}

function retirementValues(plan, overrides = {}) {
  return {
    schema: "agentic-active-dirty-scope-expansion-successor-rollover-retirement/v1",
    staleSuccessorClaimId: plan.staleSuccessorClaimId,
    priorClaimDigest: plan.observation.staleSuccessorClaimDigest,
    retiredClaimDigest: digest("d"), retirementTransitionDigest: digest("e"),
    transitionCounter: plan.observation.staleSuccessorTransitionCounter + 1,
    state: "retired", reason: "successor-rollover", receiptDigest: digest("f"), ...overrides,
  };
}

function replacementObservation(retirementPlan, retirement, overrides = {}) {
  const source = retirementPlan.observation;
  const core = {
    schema: "agentic-active-dirty-scope-expansion-successor-rollover-replacement-observation/v1",
    sourceClaimIdentity: source.sourceClaimIdentity, controllerDigest: digest("1"),
    protectedMainSha: CURRENT_MAIN, protectedMainTreeSha: sha("1"),
    protectedMainAdvanceDigest: digest("1"), protectedMainChangedPaths: ["device-branch-lib.mjs"],
    branch: source.branch,
    sourceLeaseDigest: source.sourceLeaseDigest, sourceDirtDigest: source.sourceDirtDigest,
    sourceIntentDigest: source.sourceIntentDigest, pullRequestMarkerDigest: source.pullRequestMarkerDigest,
    pullRequestBodyDigest: source.pullRequestBodyDigest,
    staleSuccessorClaimId: source.staleSuccessorClaimId,
    staleRetirementClaimDigest: retirement.retiredClaimDigest,
    staleRetirementTransitionDigest: retirement.retirementTransitionDigest,
    staleRetirementTransitionCounter: retirement.transitionCounter,
    staleRetirementReceiptDigest: retirement.receiptDigest,
    observedLedgerRevision: sha("2"), observedLedgerDigest: digest("2"), observedLedgerSequence: 89,
    ...overrides,
  };
  delete core.observationDigest;
  return { ...core, observationDigest: digestValue(core) };
}

function targetManifest(declaredWriteSet = CORRECTED) {
  declaredWriteSet = [...declaredWriteSet].sort();
  return { schema: "agentic-declared-write-scope/v1", semanticScope: "commerce",
    declaredWriteSet, writeSetDigest: digestValue(declaredWriteSet), manifestDigest: digest("3") };
}

function prepared() {
  const retirementPlan = buildSuccessorRolloverRetirementPlan({
    observation: retirementObservation(), operatorSessionId: OPERATOR,
  });
  let journal = createSuccessorRolloverJournal(retirementPlan, retirementPlan.exactAuthorization);
  const retired = retirementValues(retirementPlan);
  journal = advanceSuccessorRolloverRetirement(journal, retired);
  const retiredJournal = journal;
  const replacementPlan = buildSuccessorRolloverReplacementPlan({
    observation: replacementObservation(retirementPlan, retired),
    targetManifest: targetManifest(), operatorSessionId: OPERATOR, retirementJournal: journal,
  });
  journal = beginSuccessorRolloverReplacement(
    journal, replacementPlan, replacementPlan.exactAuthorization,
  );
  return { retirementPlan, retired, replacementPlan, retiredJournal, journal };
}

function claim(plan, { state = "current", transitionCounter = 1 } = {}) {
  return { claimId: C3, claimDigest: digest("4"), ledgerRevision: sha("3"),
    claimLedgerRevision: digest("5"), transitionCounter, state,
    predecessorClaimId: null, canonicalBaseSha: CURRENT_MAIN, laneRevision: SOURCE_FENCE,
    writeSetDigest: plan.target.writeSetDigest, leaseEpoch: 1,
    expiresAt: "2099-08-30T01:00:00.000Z" };
}

function completeJournal() {
  const fixture = prepared();
  let { journal } = fixture;
  const claimed = claim(fixture.replacementPlan);
  journal = advanceSuccessorRolloverReplacement(journal, "replacement-claimed",
    { claim: claimed, receiptDigest: digest("6") });
  journal = advanceSuccessorRolloverReplacement(journal, "replacement-promoted",
    { claim: claimed, promoted: false, receiptDigest: digest("7") });
  const authority = { claimId: C3, claimDigest: digest("8"), claimLedgerRevision: digest("9"),
    transitionCounter: 2, canonicalBaseSha: CURRENT_MAIN, laneRevision: SOURCE_FENCE,
    writeSetDigest: fixture.replacementPlan.target.writeSetDigest,
    manifestDigest: fixture.replacementPlan.target.manifestDigest, leaseEpoch: 1,
    reviewRequestId: fixture.retirementPlan.observation.sourceReviewRequestId,
    expiresAt: "2099-08-30T02:00:00.000Z", authorityDigest: digest("a") };
  journal = advanceSuccessorRolloverReplacement(journal, "replacement-bound",
    { authority, receiptDigest: digest("b") });
  const local = { leaseDigest: digest("7"), sourceIntentDigest: digest("4"),
    replacementIntentDigest: digest("d"), taskAuthorityBindingDigest: digest("e"),
    receiptDigest: digest("f") };
  journal = advanceSuccessorRolloverReplacement(journal, "local-cas", local);
  const marker = { markerDigest: digest("0"), bodyDigest: digest("1"), receiptDigest: digest("2") };
  journal = advanceSuccessorRolloverReplacement(journal, "pr-marker", marker);
  const verifiedCore = { leaseDigest: local.leaseDigest, replacementIntentDigest: local.replacementIntentDigest,
    cloudAuthorityDigest: authority.authorityDigest,
    taskAuthorityBindingDigest: local.taskAuthorityBindingDigest, markerDigest: marker.markerDigest,
    bodyDigest: marker.bodyDigest, dirtDigest: fixture.retirementPlan.observation.sourceDirtDigest,
  };
  const verified = { ...verifiedCore, verificationDigest: digestValue(verifiedCore) };
  journal = advanceSuccessorRolloverReplacement(journal, "verified", verified);
  const receipt = buildSuccessorRolloverCompletion(journal);
  journal = advanceSuccessorRolloverReplacement(journal, "complete", { receipt });
  return { ...fixture, authority, local, marker, verified, receipt, journal };
}

test("seals two independent authorizations, a corrected successor, and custom completion", () => {
  const { retirementPlan, replacementPlan, journal, receipt } = completeJournal();
  assert.equal(retirementPlan.schema, RETIREMENT_PLAN_SCHEMA);
  assert.equal(replacementPlan.schema, REPLACEMENT_PLAN_SCHEMA);
  assert.notEqual(retirementPlan.exactAuthorization, replacementPlan.exactAuthorization);
  assert.equal(replacementPlan.targetCanonicalBaseSha, CURRENT_MAIN);
  assert.equal(replacementPlan.protectedMainSha, CURRENT_MAIN);
  assert.equal(replacementPlan.protectedMainDisjointProof.overlap, "none");
  assert.equal(replacementPlan.replacementPredecessorClaimId, null);
  assert.deepEqual(replacementPlan.sourceClaimIdentity, sourceClaimIdentity());
  assert.deepEqual(normalizeSuccessorRolloverRetirementPlan(retirementPlan), retirementPlan);
  assert.deepEqual(normalizeSuccessorRolloverReplacementPlan(replacementPlan), replacementPlan);
  assert.deepEqual(normalizeSuccessorRolloverJournal(journal), journal);
  assert.equal(journal.retirement.planSnapshot.observation.sourceIntentStatus, "source-retired");
  assert.equal(receipt.schema,
    "agentic-active-dirty-scope-expansion-successor-rollover-completion/v1");
  assert.equal(receipt.status, "successor-replaced");
  assert.notEqual(receipt.replacementIntentDigest,
    retirementPlan.observation.sourceIntentDigest);
});

test("requires exact phase-specific authorization and monotonic operation keys", () => {
  const { retirementPlan, retired, retiredJournal, replacementPlan, journal } = prepared();
  assert.throws(() => authorizeSuccessorRolloverRetirement({
    plan: retirementPlan, authorization: replacementPlan.exactAuthorization,
  }), /exact authorization/u);
  assert.throws(() => authorizeSuccessorRolloverReplacement({
    plan: replacementPlan, authorization: retirementPlan.exactAuthorization,
  }), /exact authorization/u);
  assert.notEqual(successorRolloverOperationKey(retirementPlan, "stale-successor-retired"),
    successorRolloverOperationKey(replacementPlan, "replacement-claimed"));
  assert.throws(() => advanceSuccessorRolloverReplacement(
    journal, "replacement-bound", { authority: {}, receiptDigest: digest("1") },
  ), /skip|progression/iu);
  assert.throws(() => advanceSuccessorRolloverRetirement(retiredJournal, {
    ...retired, observedLedgerDigest: digest("0") }), /stale-successor-retired/u);
});

test("rejects a stale C2 that is not the exact waiting C1 successor", () => {
  const wrongPredecessor = retirementObservation({ staleSuccessorPredecessorClaimId: digest("f") });
  assert.throws(() => buildSuccessorRolloverRetirementPlan({
    observation: wrongPredecessor, operatorSessionId: OPERATOR,
  }), /observation semantics/u);
  const current = retirementObservation({ staleSuccessorState: "current" });
  assert.throws(() => buildSuccessorRolloverRetirementPlan({
    observation: current, operatorSessionId: OPERATOR,
  }), /observation semantics/u);
});

test("requires C1 superset, stale-C2 subset, dirt coverage, and protected-main disjointness", () => {
  const { retirementPlan, retired, retiredJournal } = prepared();
  const observation = replacementObservation(retirementPlan, retired);
  const build = declaredWriteSet => buildSuccessorRolloverReplacementPlan({
    observation, targetManifest: targetManifest(declaredWriteSet),
    operatorSessionId: OPERATOR, retirementJournal: retiredJournal,
  });
  assert.throws(() => build(SOURCE), /strictly expand/u);
  assert.throws(() => build([...STALE, "path:extra.mjs"]), /strict subset/u);
  assert.throws(() => build(STALE), /strict subset|overlaps/u);
  assert.throws(() => build(["path:b.mjs", "path:c.mjs", "semantic:commerce"]),
    /strictly expand|authored bytes/u);
});

test("rejects drift between retirement journal, Phase B observation, and replacement claim", () => {
  const { retirementPlan, retired, replacementPlan, retiredJournal, journal } = prepared();
  const drifted = replacementObservation(retirementPlan, retired, {
    sourceIntentDigest: digest("f"),
  });
  assert.throws(() => buildSuccessorRolloverReplacementPlan({
    observation: drifted, targetManifest: targetManifest(), operatorSessionId: OPERATOR,
    retirementJournal: retiredJournal,
  }), /replacement observation semantics/u);
  assert.throws(() => advanceSuccessorRolloverReplacement(journal, "replacement-claimed", {
    claim: { ...claim(replacementPlan), laneRevision: CURRENT_MAIN }, receiptDigest: digest("1"),
  }), /claim semantics/u);
  const otherCore = { ...sourceClaimIdentity(), actorId: "github-user:other" };
  delete otherCore.identityDigest;
  const identityDrift = replacementObservation(retirementPlan, retired, {
    sourceClaimIdentity: { ...otherCore, identityDigest: digestValue(otherCore) },
  });
  assert.throws(() => buildSuccessorRolloverReplacementPlan({ observation: identityDrift,
    targetManifest: targetManifest(), operatorSessionId: OPERATOR,
    retirementJournal: retiredJournal }), /replacement observation semantics/u);
  const malformedIdentity = retirementObservation({ sourceClaimIdentity: {
    ...sourceClaimIdentity(), identityDigest: digest("f") } });
  assert.throws(() => buildSuccessorRolloverRetirementPlan({
    observation: malformedIdentity, operatorSessionId: OPERATOR }), /identity digest/u);
});
