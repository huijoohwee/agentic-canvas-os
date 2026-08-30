import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCloudTransition,
  createEmptyLedger,
} from "../scripts/cloud-collaboration-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { projectPublicClaim }
  from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  advanceSuccessorRolloverReplacement,
  advanceSuccessorRolloverRetirement,
  beginSuccessorRolloverReplacement,
  buildSuccessorRolloverReplacementPlan,
  buildSuccessorRolloverRetirementPlan,
  createSuccessorRolloverJournal,
  successorRolloverOperationKey,
} from "../scripts/active-dirty-scope-expansion-successor-rollover-contract.mjs";
import {
  SUCCESSOR_ROLLOVER_BOUND_RESPONSE_AHEAD,
  SUCCESSOR_ROLLOVER_PROMOTED_UNBOUND,
  assertSuccessorRolloverBindMutationAllowed,
  assertSuccessorRolloverTerminalControllerIdentity,
  classifySuccessorRolloverBindEvidence,
  projectSuccessorRolloverTerminalVerifiedLease,
  requireSuccessorRolloverSealedBindEvidence,
} from "../scripts/active-dirty-scope-expansion-successor-rollover-bind-evidence.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);
const SOURCE_FENCE = sha("a"), HISTORICAL_BASE = sha("b"), C3_BASE = sha("c");
const SOURCE = ["path:a.mjs", "path:b.mjs", "semantic:commerce"];
const STALE = ["path:a.mjs", "path:b.mjs", "path:c.mjs",
  "path:device-branch-lib.mjs", "semantic:commerce"];
const TARGET = ["path:a.mjs", "path:b.mjs", "path:c.mjs", "semantic:commerce"];
const CLAIM_TIME = "2026-08-30T00:00:00.000Z";
const BIND_TIME = "2026-08-30T00:01:00.000Z";

test("classifies the exact promoted genesis and response-ahead bind", () => {
  const fixture = prepared();
  const unbound = classifySuccessorRolloverBindEvidence({
    plan: fixture.plan,
    journal: fixture.journal,
    ledger: fixture.claimed.ledger,
    candidate: projectPublicClaim(fixture.claimed.claim),
  });
  assert.equal(unbound.disposition, SUCCESSOR_ROLLOVER_PROMOTED_UNBOUND);
  assert.equal(unbound.boundReplacement, null);
  assert.equal(unbound.promotedClaim.claimDigest, fixture.claimed.claim.fenceRevision);
  assert.equal(unbound.promotedClaim.claimLedgerRevision,
    fixture.claimed.claim.ledgerRevision);
  assert.equal(unbound.promotedClaim.operationReceiptDigest,
    fixture.claimed.receipt.receiptDigest);
  assert.equal(fixture.claimed.receipt.schema,
    "agentic-collaboration-claim-receipt/v1");
  assert.equal(assertSuccessorRolloverBindMutationAllowed(unbound.disposition),
    SUCCESSOR_ROLLOVER_PROMOTED_UNBOUND);

  const continued = bind(fixture.plan, fixture.claimed);
  const bound = classifySuccessorRolloverBindEvidence({
    plan: fixture.plan,
    journal: fixture.journal,
    ledger: continued.ledger,
    candidate: projectPublicClaim(continued.claim),
  });
  assert.equal(bound.disposition, SUCCESSOR_ROLLOVER_BOUND_RESPONSE_AHEAD);
  assert.deepEqual(bound.promotedClaim, unbound.promotedClaim);
  assert.equal(bound.boundReplacement.schema,
    "agentic-active-dirty-scope-expansion-successor-rollover-bound-frame/v1");
  assert.equal(bound.boundReplacement.claim.reviewRequestId,
    fixture.plan.sourceReviewRequestId);
  assert.equal(bound.boundReplacement.claim.transitionCounter,
    unbound.promotedClaim.transitionCounter + 1);
  assert.equal(bound.boundReplacement.claim.operationReceiptDigest,
    continued.receipt.receiptDigest);
  assert.deepEqual(bound.boundReplacement.receipt, continued.receipt);
  assert.equal(bound.boundReplacement.receipt.schema,
    "agentic-collaboration-continuation-receipt/v1");
  assert.equal(bound.boundReplacement.receipt.operation, "continue");
  assert.throws(() => assertSuccessorRolloverBindMutationAllowed(bound.disposition),
    /response ahead forbids another bind mutation/u);
});

test("accepts global churn but rejects same-claim, operation, and journal drift", () => {
  const fixture = prepared();
  const claimedCandidate = projectPublicClaim(fixture.claimed.claim);
  const continued = bind(fixture.plan, fixture.claimed);
  const boundCandidate = projectPublicClaim(continued.claim);
  const classify = (ledger, candidate = boundCandidate, journal = fixture.journal) => (
    classifySuccessorRolloverBindEvidence({ plan: fixture.plan, journal, ledger, candidate })
  );

  assert.throws(() => classify(continued.ledger, claimedCandidate),
    /invalid unbound replacement ledger suffix/u);
  assert.throws(() => classify(fixture.claimed.ledger),
    /invalid bound replacement ledger suffix/u);

  const third = bind(fixture.plan, continued, "third-bind-operation");
  assert.throws(() => classify(third.ledger, projectPublicClaim(third.claim)),
    /invalid replacement claim ledger cardinality/u);

  const interposed = unrelatedClaim(fixture.plan, fixture.claimed);
  const responseAfterInterposition = bind(fixture.plan, {
    ledger: interposed.ledger,
    claim: fixture.claimed.claim,
  });
  const churned = classify(responseAfterInterposition.ledger,
    projectPublicClaim(responseAfterInterposition.claim));
  assert.equal(churned.disposition, SUCCESSOR_ROLLOVER_BOUND_RESPONSE_AHEAD);
  assert.equal(churned.boundReplacement.claim.claimDigest,
    responseAfterInterposition.claim.fenceRevision);

  const foreignKey = bind(fixture.plan, fixture.claimed, "foreign-bind-operation");
  assert.throws(() => classify(foreignKey.ledger, projectPublicClaim(foreignKey.claim)),
    /invalid replacement bind operation/u);

  const driftedCandidate = {
    ...boundCandidate,
    operationReceiptDigest: digest("f"),
  };
  assert.throws(() => classify(continued.ledger, driftedCandidate),
    /invalid replacement candidate projection/u);

  const alternateGenesis = claim(fixture.plan, {
    expiresAt: "2099-08-30T02:00:00.000Z",
  });
  assert.throws(() => classifySuccessorRolloverBindEvidence({
    plan: fixture.plan,
    journal: fixture.journal,
    ledger: alternateGenesis.ledger,
    candidate: projectPublicClaim(alternateGenesis.claim),
  }), /invalid replacement genesis join/u);
});

test("post-bind phase guards reject a same-claim transition before local or PR mutation", () => {
  const fixture = prepared();
  const continued = bind(fixture.plan, fixture.claimed);
  const expected = classifySuccessorRolloverBindEvidence({
    plan: fixture.plan,
    journal: fixture.journal,
    ledger: continued.ledger,
    candidate: projectPublicClaim(continued.claim),
  }).boundReplacement;
  const input = {
    plan: fixture.plan,
    journal: fixture.journal,
    ledger: continued.ledger,
    candidate: projectPublicClaim(continued.claim),
    expectedBoundReplacement: expected,
  };
  assert.deepEqual(requireSuccessorRolloverSealedBindEvidence(input).boundReplacement,
    expected);
  const interposed = bind(fixture.plan, continued, "post-bind-transition");
  for (const phase of ["local-cas", "pr-marker"]) {
    assert.throws(() => requireSuccessorRolloverSealedBindEvidence({
      ...input,
      ledger: interposed.ledger,
      candidate: projectPublicClaim(interposed.claim),
    }), /invalid replacement claim ledger cardinality/u, phase);
  }
});

test("terminal verification adopts only a fresh global ledger head", () => {
  const authority = {
    schema: "agentic-lane-cloud-authority/v1",
    claimId: digest("1"),
    claimDigest: digest("2"),
    claimLedgerRevision: digest("3"),
    operationReceiptDigest: digest("4"),
    transitionCounter: 2,
    state: "active",
    reviewRequestId: "github-pull-request:PR_808",
    expiresAt: "2099-08-30T01:00:00.000Z",
    writeSetDigest: digest("5"),
    cloudDeclaredWriteScope: TARGET,
    canonicalBaseSha: C3_BASE,
    laneRevision: SOURCE_FENCE,
    deviceId: "source-device",
    sessionId: "source-session",
    ledgerRevision: sha("1"),
    ledgerDigest: digest("6"),
  };
  const lease = Object.freeze({ schema: "agentic-writer-lease/v2",
    cloudAuthority: Object.freeze(authority) });
  const verifiedAuthority = Object.freeze({ ...authority,
    ledgerRevision: sha("2"), ledgerDigest: digest("7") });
  const projected = projectSuccessorRolloverTerminalVerifiedLease({
    lease, verifiedAuthority,
  });
  assert.notEqual(projected, lease);
  assert.equal(projected.cloudAuthority, verifiedAuthority);
  assert.equal(lease.cloudAuthority.ledgerRevision, sha("1"));
  assert.equal(lease.cloudAuthority.ledgerDigest, digest("6"));

  for (const [key, value] of [
    ["claimDigest", digest("8")],
    ["claimLedgerRevision", digest("9")],
    ["operationReceiptDigest", digest("a")],
    ["transitionCounter", 3],
    ["state", "review_ready"],
    ["reviewRequestId", "github-pull-request:foreign"],
    ["expiresAt", "2099-08-30T02:00:00.000Z"],
    ["writeSetDigest", digest("b")],
    ["cloudDeclaredWriteScope", [...TARGET, "path:foreign.mjs"]],
    ["canonicalBaseSha", sha("d")],
    ["laneRevision", sha("e")],
    ["deviceId", "foreign-device"],
    ["sessionId", "foreign-session"],
    ["claimId", digest("c")],
  ]) {
    assert.throws(() => projectSuccessorRolloverTerminalVerifiedLease({
      lease,
      verifiedAuthority: { ...verifiedAuthority, [key]: value },
    }), /invalid terminal claim-local authority/u, key);
  }
  assert.throws(() => projectSuccessorRolloverTerminalVerifiedLease({
    lease,
    verifiedAuthority: { ...verifiedAuthority, unexpected: true },
  }), /invalid terminal claim-local authority/u);
});

test("terminal controller identity stays bound to its authorized controller", () => {
  const original = digest("1"), repaired = digest("2");
  assert.equal(assertSuccessorRolloverTerminalControllerIdentity({
    continuationPlan: null,
    currentControllerDigest: original,
    originalControllerDigest: original,
  }), original);
  assert.equal(assertSuccessorRolloverTerminalControllerIdentity({
    continuationPlan: { repairedControllerDigest: repaired },
    currentControllerDigest: repaired,
    originalControllerDigest: original,
  }), repaired);
  assert.throws(() => assertSuccessorRolloverTerminalControllerIdentity({
    continuationPlan: null,
    currentControllerDigest: repaired,
    originalControllerDigest: original,
  }), /invalid terminal controller identity/u);
  assert.throws(() => assertSuccessorRolloverTerminalControllerIdentity({
    continuationPlan: { repairedControllerDigest: original },
    currentControllerDigest: repaired,
    originalControllerDigest: original,
  }), /invalid terminal controller identity/u);
  assert.throws(() => assertSuccessorRolloverTerminalControllerIdentity({
    continuationPlan: {},
    currentControllerDigest: original,
    originalControllerDigest: original,
  }), /invalid terminal controller identity/u);
  assert.throws(() => assertSuccessorRolloverTerminalControllerIdentity({}),
    /invalid terminal controller identity/u);
});

function prepared() {
  const retirementPlan = buildSuccessorRolloverRetirementPlan({
    observation: retirementObservation(),
    operatorSessionId: "recovery-controller-session",
  });
  let retiredJournal = createSuccessorRolloverJournal(
    retirementPlan,
    retirementPlan.exactAuthorization,
  );
  const retired = retirementValues(retirementPlan);
  retiredJournal = advanceSuccessorRolloverRetirement(retiredJournal, retired);
  const plan = buildSuccessorRolloverReplacementPlan({
    observation: replacementObservation(retirementPlan, retired),
    targetManifest: targetManifest(),
    operatorSessionId: "recovery-controller-session",
    retirementJournal: retiredJournal,
  });
  const claimed = claim(plan);
  const publicClaim = projectPublicClaim(claimed.claim);
  const storedClaim = {
    claimId: publicClaim.claimId,
    claimDigest: publicClaim.fenceRevision,
    ledgerRevision: sha("3"),
    claimLedgerRevision: publicClaim.transitionDigest,
    transitionCounter: publicClaim.transitionCounter,
    state: publicClaim.state,
    predecessorClaimId: publicClaim.predecessorClaimId,
    canonicalBaseSha: publicClaim.canonicalBaseRevision,
    laneRevision: publicClaim.laneRevision,
    writeSetDigest: publicClaim.writeSetDigest,
    leaseEpoch: publicClaim.leaseEpoch,
    expiresAt: publicClaim.expiresAt,
  };
  let journal = beginSuccessorRolloverReplacement(
    retiredJournal,
    plan,
    plan.exactAuthorization,
  );
  journal = advanceSuccessorRolloverReplacement(journal, "replacement-claimed", {
    claim: storedClaim,
    receiptDigest: claimed.receipt.receiptDigest,
  });
  journal = advanceSuccessorRolloverReplacement(journal, "replacement-promoted", {
    claim: storedClaim,
    promoted: false,
    receiptDigest: claimed.receipt.receiptDigest,
  });
  return { plan, journal, claimed };
}

function claim(plan, { expiresAt = "2099-08-30T01:00:00.000Z" } = {}) {
  const identity = plan.sourceClaimIdentity;
  return applyCloudTransition({
    ledger: createEmptyLedger("github-repository:ledger"),
    action: "claim",
    actor: actor(identity),
    repository: repository(plan),
    evaluationTime: CLAIM_TIME,
    request: {
      workItemId: identity.workItemId,
      canonicalBaseRevision: plan.targetCanonicalBaseSha,
      declaredWriteScope: plan.target.declaredWriteSet,
      laneRevision: plan.sourceFenceSha,
      leaseEpoch: plan.targetCloudLeaseEpoch,
      predecessorClaimId: null,
      canonicalDescendantProof: null,
      expiresAt,
      expectedLedgerDigest: null,
      idempotencyKey: successorRolloverOperationKey(plan, "replacement-claimed"),
    },
  });
}

function bind(plan, prior, idempotencyKey = null) {
  const identity = plan.sourceClaimIdentity;
  return applyCloudTransition({
    ledger: prior.ledger,
    action: "continue",
    actor: actor(identity),
    repository: repository(plan),
    evaluationTime: BIND_TIME,
    request: {
      claimId: prior.claim.claimId,
      expectedFenceRevision: prior.claim.fenceRevision,
      expectedTransitionCounter: prior.claim.transitionCounter,
      expectedLedgerDigest: prior.ledger.headDigest,
      mode: "projection",
      laneRevision: plan.sourceFenceSha,
      reviewRequestId: plan.sourceReviewRequestId,
      idempotencyKey: idempotencyKey
        ?? successorRolloverOperationKey(plan, "replacement-bound"),
    },
  });
}

function unrelatedClaim(plan, prior) {
  const identity = plan.sourceClaimIdentity;
  return applyCloudTransition({
    ledger: prior.ledger,
    action: "claim",
    actor: actor(identity),
    repository: repository(plan),
    evaluationTime: "2026-08-30T00:00:30.000Z",
    request: {
      workItemId: "work-item:unrelated",
      canonicalBaseRevision: plan.targetCanonicalBaseSha,
      declaredWriteScope: ["path:unrelated.mjs", "semantic:unrelated"],
      laneRevision: plan.targetCanonicalBaseSha,
      leaseEpoch: 1,
      predecessorClaimId: null,
      canonicalDescendantProof: null,
      expiresAt: "2099-08-30T01:00:00.000Z",
      expectedLedgerDigest: prior.ledger.headDigest,
      idempotencyKey: "unrelated-claim-operation",
    },
  });
}

function actor(identity) {
  return {
    actorId: identity.actorId,
    deviceId: identity.deviceId,
    sessionId: identity.sessionId,
  };
}

function repository(plan) {
  return {
    repositoryId: plan.sourceClaimIdentity.repositoryId,
    canonicalRevision: plan.targetCanonicalBaseSha,
  };
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
    sourceClaimId: digest("1"),
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
    staleSuccessorClaimId: digest("2"),
    staleSuccessorClaimDigest: digest("7"),
    staleSuccessorTransitionDigest: digest("8"),
    staleSuccessorTransitionCounter: 1,
    staleSuccessorState: "waiting-successor",
    staleSuccessorPredecessorClaimId: digest("1"),
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
