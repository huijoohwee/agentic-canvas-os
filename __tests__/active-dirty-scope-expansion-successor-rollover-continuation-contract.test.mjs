import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  advanceSuccessorRolloverReplacement,
  advanceSuccessorRolloverRetirement,
  beginSuccessorRolloverReplacement,
  buildSuccessorRolloverReplacementPlan,
  buildSuccessorRolloverRetirementPlan,
  createSuccessorRolloverJournal,
} from "../scripts/active-dirty-scope-expansion-successor-rollover-contract.mjs";
import {
  authorizeSuccessorRolloverContinuation,
  buildSuccessorRolloverContinuationPlan,
  normalizeSuccessorRolloverContinuationAuthorization,
  normalizeSuccessorRolloverContinuationPlan,
  requireSuccessorRolloverContinuationJournal,
} from "../scripts/active-dirty-scope-expansion-successor-rollover-continuation-contract.mjs";
import {
  buildSuccessorRolloverContinuationFrame,
  captureSuccessorRolloverProtectedControllerAdvance,
  normalizeSuccessorRolloverContinuationFrame,
  requireSuccessorRolloverContinuationFrame,
} from "../scripts/active-dirty-scope-expansion-successor-rollover-continuation-frame.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);
const C1 = digest("1"), C2 = digest("2"), C3 = digest("3");
const SOURCE_FENCE = sha("a"), HISTORICAL_BASE = sha("b"), C3_BASE = sha("c");
const REPAIRED_MAIN = sha("d"), LATER_MAIN = sha("e");
const OPERATOR = "recovery-controller-session";
const SOURCE = ["path:a.mjs", "path:b.mjs", "semantic:commerce"];
const STALE = ["path:a.mjs", "path:b.mjs", "path:c.mjs",
  "path:device-branch-lib.mjs", "semantic:commerce"];
const TARGET = ["path:a.mjs", "path:b.mjs", "path:c.mjs", "semantic:commerce"];

test("seals distinct historical-bind and protected-controller proofs plus static authority", () => {
  const fixture = prepared();
  assert.equal(fixture.frame.historicalBindProof.sourceBaseSha, HISTORICAL_BASE);
  assert.equal(fixture.frame.historicalBindProof.targetBaseSha, C3_BASE);
  assert.deepEqual(fixture.frame.historicalBindProof.preservedChangedPaths,
    ["a.mjs", "b.mjs", "c.mjs"]);
  assert.equal(fixture.frame.protectedControllerAdvance.sourceCanonicalBaseSha, C3_BASE);
  assert.equal(fixture.frame.protectedControllerAdvance.protectedMainSha, REPAIRED_MAIN);
  assert.notEqual(fixture.frame.historicalBindProof.targetBaseSha,
    fixture.frame.protectedControllerAdvance.protectedMainSha);
  assert.equal(fixture.plan.exactAuthorization,
    `authorize active-dirty-scope-expansion-successor-rollover-continue ${fixture.plan.planDigest}`);
  assert.deepEqual(normalizeSuccessorRolloverContinuationFrame(fixture.frame, {
    replacementPlan: fixture.replacementPlan,
    journal: fixture.journal,
  }), fixture.frame);
  assert.deepEqual(normalizeSuccessorRolloverContinuationPlan(fixture.plan), fixture.plan);
  const authority = authorizeSuccessorRolloverContinuation({
    plan: fixture.plan,
    authorization: fixture.plan.exactAuthorization,
  });
  assert.deepEqual(normalizeSuccessorRolloverContinuationAuthorization(authority, {
    plan: fixture.plan,
  }), authority);
  assert.throws(() => normalizeSuccessorRolloverContinuationAuthorization(
    structuredClone(authority),
  ), /authorization plan join/u);
  assert.throws(() => authorizeSuccessorRolloverContinuation({
    plan: fixture.plan,
    authorization: "authorize active-dirty-scope-expansion-successor-rollover-continue wrong",
  }), /requires exact authorization/u);
});

test("rejects owner, C3, review-request, and protected-controller drift", () => {
  const fixture = prepared();
  const build = overrides => buildSuccessorRolloverContinuationFrame({
    replacementPlan: fixture.replacementPlan,
    journal: fixture.journal,
    owner: fixture.owner,
    replacementClaim: fixture.liveClaim,
    reviewRequest: fixture.reviewRequest,
    protectedControllerAdvance: fixture.controllerAdvance,
    repairedControllerDigest: digest("9"),
    ...overrides,
  });
  assert.throws(() => build({ owner: { ...fixture.owner, leaseDigest: digest("f") } }),
    /unchanged owner/u);
  assert.throws(() => build({ replacementClaim: {
    ...fixture.liveClaim, reviewRequestId: fixture.replacementPlan.sourceReviewRequestId,
  } }), /exact promoted replacement claim/u);
  assert.throws(() => build({ reviewRequest: {
    ...fixture.reviewRequest, baseSha: C3_BASE,
  } }), /unchanged review request/u);
  assert.throws(() => captureSuccessorRolloverProtectedControllerAdvance({
    replacementPlan: fixture.replacementPlan,
    controllerHeadSha: REPAIRED_MAIN,
    controllerOriginMainSha: REPAIRED_MAIN,
    protectedMainSha: REPAIRED_MAIN,
    controllerStatus: " M scripts/controller.mjs",
    gitText: gitReader(["scripts/controller-fix.mjs"]),
  }), /clean protected-controller/u);
  assert.throws(() => captureSuccessorRolloverProtectedControllerAdvance({
    replacementPlan: fixture.replacementPlan,
    controllerHeadSha: REPAIRED_MAIN,
    controllerOriginMainSha: REPAIRED_MAIN,
    protectedMainSha: REPAIRED_MAIN,
    controllerStatus: "",
    gitText: gitReader(["a.mjs"]),
  }), /admitted recovery write set|changed paths/u);
  const controllerDrift = build({ repairedControllerDigest: digest("8") });
  assert.throws(() => requireSuccessorRolloverContinuationFrame({
    planned: fixture.frame,
    observed: controllerDrift,
    replacementPlan: fixture.replacementPlan,
    journal: fixture.journal,
    gitText: gitReader([]),
  }), /repairedControllerDigest drift/u);
});

test("accepts exact replay or a monotonic journal descendant with the sealed prefix", () => {
  const fixture = prepared();
  assert.equal(requireSuccessorRolloverContinuationJournal({
    plan: fixture.plan,
    journal: fixture.journal,
  }).replacement.status, "replacement-promoted");
  const authority = {
    claimId: C3,
    claimDigest: digest("8"),
    claimLedgerRevision: digest("9"),
    transitionCounter: 2,
    canonicalBaseSha: C3_BASE,
    laneRevision: SOURCE_FENCE,
    writeSetDigest: fixture.replacementPlan.target.writeSetDigest,
    manifestDigest: fixture.replacementPlan.target.manifestDigest,
    leaseEpoch: 1,
    reviewRequestId: fixture.replacementPlan.sourceReviewRequestId,
    expiresAt: "2099-08-30T02:00:00.000Z",
    authorityDigest: digest("a"),
  };
  const descendant = advanceSuccessorRolloverReplacement(
    fixture.journal,
    "replacement-bound",
    { authority, receiptDigest: digest("b") },
  );
  assert.equal(requireSuccessorRolloverContinuationJournal({
    plan: fixture.plan,
    journal: descendant,
  }).replacement.status, "replacement-bound");
  const drifted = promotedJournal(fixture.retiredJournal, fixture.replacementPlan, digest("f"));
  assert.throws(() => requireSuccessorRolloverContinuationJournal({
    plan: fixture.plan,
    journal: drifted,
  }), /monotonic continuation journal/u);
});

test("allows a later disjoint main without changing the sealed cloud bind base", () => {
  const fixture = prepared();
  const laterAdvance = captureSuccessorRolloverProtectedControllerAdvance({
    replacementPlan: fixture.replacementPlan,
    controllerHeadSha: LATER_MAIN,
    controllerOriginMainSha: LATER_MAIN,
    protectedMainSha: LATER_MAIN,
    controllerStatus: "",
    gitText: gitReader(["docs/unrelated.md", "scripts/controller-fix.mjs"], sha("7")),
  });
  const observed = buildSuccessorRolloverContinuationFrame({
    replacementPlan: fixture.replacementPlan,
    journal: fixture.journal,
    owner: fixture.owner,
    replacementClaim: fixture.liveClaim,
    reviewRequest: fixture.reviewRequest,
    protectedControllerAdvance: laterAdvance,
    repairedControllerDigest: digest("9"),
  });
  const accepted = requireSuccessorRolloverContinuationFrame({
    planned: fixture.frame,
    observed,
    replacementPlan: fixture.replacementPlan,
    journal: fixture.journal,
    gitText: gitReader([]),
  });
  assert.equal(accepted.protectedControllerAdvance.protectedMainSha, LATER_MAIN);
  assert.equal(accepted.historicalBindProof.targetBaseSha, C3_BASE);
});

function prepared() {
  const retirementPlan = buildSuccessorRolloverRetirementPlan({
    observation: retirementObservation(),
    operatorSessionId: OPERATOR,
  });
  let retiredJournal = createSuccessorRolloverJournal(
    retirementPlan,
    retirementPlan.exactAuthorization,
  );
  const retired = retirementValues(retirementPlan);
  retiredJournal = advanceSuccessorRolloverRetirement(retiredJournal, retired);
  const replacementPlan = buildSuccessorRolloverReplacementPlan({
    observation: replacementObservation(retirementPlan, retired),
    targetManifest: targetManifest(),
    operatorSessionId: OPERATOR,
    retirementJournal: retiredJournal,
  });
  const journal = promotedJournal(retiredJournal, replacementPlan, digest("6"));
  const promoted = journal.replacement.phases["replacement-promoted"].values;
  const owner = {
    schema: "agentic-active-dirty-scope-expansion-successor-rollover-owner-frame/v1",
    repositoryPathDigest: digest("7"),
    branch: replacementPlan.branch,
    sourceSessionId: retirementPlan.observation.sourceSessionId,
    headSha: SOURCE_FENCE,
    remoteHeadSha: SOURCE_FENCE,
    leaseDigest: replacementPlan.observation.sourceLeaseDigest,
    dirtDigest: replacementPlan.observation.sourceDirtDigest,
    intentDigest: replacementPlan.observation.sourceIntentDigest,
    intentStatus: "source-retired",
    changedPaths: retirementPlan.observation.sourceChangedPaths,
    changedPathsDigest: digestValue(retirementPlan.observation.sourceChangedPaths),
  };
  const liveClaim = {
    schema: "agentic-active-dirty-scope-expansion-successor-rollover-claim-frame/v1",
    claimId: promoted.claim.claimId,
    claimDigest: promoted.claim.claimDigest,
    claimLedgerRevision: promoted.claim.claimLedgerRevision,
    transitionCounter: promoted.claim.transitionCounter,
    state: promoted.claim.state,
    predecessorClaimId: promoted.claim.predecessorClaimId,
    canonicalBaseSha: promoted.claim.canonicalBaseSha,
    laneRevision: promoted.claim.laneRevision,
    writeSetDigest: promoted.claim.writeSetDigest,
    leaseEpoch: promoted.claim.leaseEpoch,
    reviewRequestId: null,
    expiresAt: promoted.claim.expiresAt,
    operationReceiptDigest: promoted.receiptDigest,
  };
  const reviewRequest = {
    schema: "agentic-active-dirty-scope-expansion-successor-rollover-review-frame/v1",
    reviewRequestId: replacementPlan.sourceReviewRequestId,
    pullRequestNumber: retirementPlan.observation.pullRequestNumber,
    nodeId: retirementPlan.observation.pullRequestNodeId,
    state: "OPEN",
    isDraft: true,
    branch: replacementPlan.branch,
    headSha: SOURCE_FENCE,
    baseBranch: "main",
    baseSha: HISTORICAL_BASE,
    markerDigest: replacementPlan.observation.pullRequestMarkerDigest,
    bodyDigest: replacementPlan.observation.pullRequestBodyDigest,
  };
  const controllerAdvance = captureSuccessorRolloverProtectedControllerAdvance({
    replacementPlan,
    controllerHeadSha: REPAIRED_MAIN,
    controllerOriginMainSha: REPAIRED_MAIN,
    protectedMainSha: REPAIRED_MAIN,
    controllerStatus: "",
    gitText: gitReader(["scripts/controller-fix.mjs"]),
  });
  const frame = buildSuccessorRolloverContinuationFrame({
    replacementPlan,
    journal,
    owner,
    replacementClaim: liveClaim,
    reviewRequest,
    protectedControllerAdvance: controllerAdvance,
    repairedControllerDigest: digest("9"),
  });
  const plan = buildSuccessorRolloverContinuationPlan({
    replacementPlan,
    journal,
    frame,
    operatorSessionId: OPERATOR,
  });
  return { retirementPlan, retiredJournal, replacementPlan, journal, owner, liveClaim,
    reviewRequest, controllerAdvance, frame, plan };
}

function promotedJournal(retiredJournal, replacementPlan, claimReceipt) {
  let journal = beginSuccessorRolloverReplacement(
    retiredJournal,
    replacementPlan,
    replacementPlan.exactAuthorization,
  );
  const replacementClaim = {
    claimId: C3,
    claimDigest: digest("4"),
    ledgerRevision: sha("3"),
    claimLedgerRevision: digest("5"),
    transitionCounter: 1,
    state: "current",
    predecessorClaimId: null,
    canonicalBaseSha: C3_BASE,
    laneRevision: SOURCE_FENCE,
    writeSetDigest: replacementPlan.target.writeSetDigest,
    leaseEpoch: 1,
    expiresAt: "2099-08-30T01:00:00.000Z",
  };
  journal = advanceSuccessorRolloverReplacement(journal, "replacement-claimed", {
    claim: replacementClaim,
    receiptDigest: claimReceipt,
  });
  return advanceSuccessorRolloverReplacement(journal, "replacement-promoted", {
    claim: replacementClaim,
    promoted: false,
    receiptDigest: claimReceipt,
  });
}

function retirementObservation() {
  const sourceIdentityCore = {
    repositoryId: "github-repository:1",
    actorId: "github-user:1",
    deviceId: "device:pseudonymous",
    sessionId: "session:pseudonymous",
    workItemId: "work-item:pseudonymous",
  };
  const core = {
    schema: "agentic-active-dirty-scope-expansion-successor-rollover-retirement-observation/v2",
    sourceClaimIdentity: {
      ...sourceIdentityCore,
      identityDigest: digestValue(sourceIdentityCore),
    },
    controllerDigest: digest("a"),
    protectedMainSha: C3_BASE,
    protectedMainTreeSha: sha("f"),
    protectedMainAdvanceDigest: digest("b"),
    protectedMainChangedPaths: ["device-branch-lib.mjs"],
    branch: "agent/device/commerce",
    sourceSessionId: "source-session",
    semanticScope: "commerce",
    sourceFenceSha: SOURCE_FENCE,
    sourceLeaseDigest: digest("c"),
    sourceClaimId: C1,
    sourceClaimDigest: digest("d"),
    sourceReviewRequestId: "github-pull-request:PR_808",
    sourceWriteSetDigest: digestValue(SOURCE),
    sourceManifestDigest: digest("e"),
    sourceDeclaredWriteSet: SOURCE,
    sourceDirtDigest: digest("f"),
    sourceChangedPaths: ["a.mjs"],
    sourceIntentDigest: digest("4"),
    sourceIntentPlanDigest: digest("5"),
    sourceIntentStatus: "source-retired",
    sourceRetirementReceiptDigest: digest("6"),
    staleSuccessorClaimId: C2,
    staleSuccessorClaimDigest: digest("7"),
    staleSuccessorTransitionDigest: digest("8"),
    staleSuccessorTransitionCounter: 1,
    staleSuccessorState: "waiting-successor",
    staleSuccessorPredecessorClaimId: C1,
    staleTargetCanonicalBaseSha: HISTORICAL_BASE,
    staleTargetWriteSetDigest: digestValue(STALE),
    staleTargetManifestDigest: digest("9"),
    staleTargetDeclaredWriteSet: STALE,
    staleExpiresAt: "2099-08-30T00:00:00.000Z",
    pullRequestNumber: 808,
    pullRequestNodeId: "PR_808",
    pullRequestMarkerDigest: digest("a"),
    pullRequestBodyDigest: digest("b"),
  };
  return { ...core, observationDigest: digestValue(core) };
}

function retirementValues(plan) {
  return {
    schema: "agentic-active-dirty-scope-expansion-successor-rollover-retirement/v1",
    staleSuccessorClaimId: plan.staleSuccessorClaimId,
    priorClaimDigest: plan.observation.staleSuccessorClaimDigest,
    retiredClaimDigest: digest("d"),
    retirementTransitionDigest: digest("e"),
    transitionCounter: 2,
    state: "retired",
    reason: "successor-rollover",
    receiptDigest: digest("f"),
  };
}

function replacementObservation(retirementPlan, retirement) {
  const source = retirementPlan.observation;
  const core = {
    schema: "agentic-active-dirty-scope-expansion-successor-rollover-replacement-observation/v2",
    sourceClaimIdentity: source.sourceClaimIdentity,
    controllerDigest: digest("1"),
    protectedMainSha: C3_BASE,
    protectedMainTreeSha: sha("1"),
    protectedMainAdvanceDigest: digest("1"),
    protectedMainChangedPaths: ["device-branch-lib.mjs"],
    branch: source.branch,
    sourceLeaseDigest: source.sourceLeaseDigest,
    sourceDirtDigest: source.sourceDirtDigest,
    sourceIntentDigest: source.sourceIntentDigest,
    pullRequestMarkerDigest: source.pullRequestMarkerDigest,
    pullRequestBodyDigest: source.pullRequestBodyDigest,
    staleSuccessorClaimId: source.staleSuccessorClaimId,
    staleRetirementClaimDigest: retirement.retiredClaimDigest,
    staleRetirementTransitionDigest: retirement.retirementTransitionDigest,
    staleRetirementTransitionCounter: retirement.transitionCounter,
    staleRetirementReceiptDigest: retirement.receiptDigest,
  };
  return { ...core, observationDigest: digestValue(core) };
}

function targetManifest() {
  const declaredWriteSet = [...TARGET].sort();
  return {
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "commerce",
    declaredWriteSet,
    writeSetDigest: digestValue(declaredWriteSet),
    manifestDigest: digest("3"),
  };
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
