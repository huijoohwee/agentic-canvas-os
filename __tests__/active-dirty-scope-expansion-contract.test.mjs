import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeActiveDirtyScopeExpansion,
  buildActiveDirtyScopeExpansionPlan,
  verifyBoundSuccessor,
  verifyPromotedSuccessor,
  verifyWaitingSuccessor,
} from "../scripts/active-dirty-scope-expansion-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest } from "../scripts/scoped-lane-admission-lib.mjs";

const BASE = "a".repeat(40);
const FENCE = "b".repeat(40);
const CLAIM = "c".repeat(64);
const CLAIM_DIGEST = "d".repeat(64);
const LEDGER = "e".repeat(40);
const TRANSITION = "f".repeat(64);
const BRANCH = "agent/device/protected-head-refresh-controller";
const REVIEW = "github-pull-request:PR_test";

function manifests() {
  const source = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "protected-head-refresh-controller",
    paths: ["scripts/protected-main-refresh-lib.mjs"],
  });
  const target = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "protected-head-refresh-controller",
    paths: [
      "scripts/protected-main-refresh-lib.mjs",
      "scripts/protected-main-refresh-candidate.mjs",
    ],
  });
  return { source, target };
}

function sourceLane() {
  const { source } = manifests();
  const authority = {
    schema: "agentic-lane-cloud-authority/v1",
    claimId: CLAIM,
    claimDigest: CLAIM_DIGEST,
    canonicalBaseSha: BASE,
    laneRevision: FENCE,
    cloudDeclaredWriteScope: source.declaredWriteSet,
    writeSetDigest: source.writeSetDigest,
    transitionCounter: 3,
    reviewRequestId: REVIEW,
    state: "active",
  };
  return {
    branch: BRANCH,
    fenceSha: FENCE,
    claimId: CLAIM,
    claimDigest: CLAIM_DIGEST,
    changedPaths: ["scripts/protected-main-refresh-lib.mjs"],
    untrackedPaths: [],
    dirtyDigest: digestValue({ dirty: true }),
    lease: {
      schema: "agentic-writer-lease/v2",
      status: "active",
      branch: BRANCH,
      scope: "protected-head-refresh-controller",
      baseSha: BASE,
      fenceSha: FENCE,
      admission: {
        schema: "agentic-lane-admission-lease/v1",
        status: "admitted",
        declaredWriteSet: source.declaredWriteSet,
        writeSetDigest: source.writeSetDigest,
        manifestDigest: source.manifestDigest,
      },
      cloudAuthority: authority,
    },
  };
}

function waitingResult(plan, overrides = {}) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "claim",
    claimDigest: "1".repeat(64),
    ledgerRevision: LEDGER,
    receipt: { receiptDigest: "2".repeat(64) },
    claim: {
      claimId: "3".repeat(64),
      state: "waiting-successor",
      predecessorClaimId: plan.sourceClaimId,
      canonicalBaseRevision: plan.targetCanonicalBaseSha,
      laneRevision: plan.sourceFenceSha,
      writeSetDigest: plan.targetWriteSetDigest,
      declaredWriteScope: plan.targetDeclaredWriteSet,
      leaseEpoch: 1,
      transitionCounter: 1,
      transitionDigest: TRANSITION,
      expiresAt: "2026-08-07T12:00:00.000Z",
      ...overrides,
    },
  };
}

test("scope-expansion plan binds active dirty C1 and strict-superset C2", () => {
  const { target } = manifests();
  const plan = buildActiveDirtyScopeExpansionPlan({
    source: sourceLane(),
    targetManifest: target,
    targetCanonicalBaseSha: "4".repeat(40),
  });

  assert.equal(plan.targetCloudLeaseEpoch, 1);
  assert.equal(plan.sourceClaimId, CLAIM);
  assert.equal(plan.targetWriteSetDigest, target.writeSetDigest);
  assert.equal(authorizeActiveDirtyScopeExpansion({
    plan,
    authorization: `authorize scope-expansion ${plan.planDigest}`,
  }).planDigest, plan.planDigest);
  assert.throws(() => authorizeActiveDirtyScopeExpansion({
    plan,
    authorization: "authorize scope-expansion stale",
  }), /exact typed authorization/);

  const waiting = verifyWaitingSuccessor({ plan, result: waitingResult(plan) });
  const promoted = verifyPromotedSuccessor({
    plan,
    waiting,
    result: {
      ...waitingResult(plan),
      action: "continue",
      claimDigest: "5".repeat(64),
      claim: {
        ...waitingResult(plan).claim,
        state: "current",
        transitionCounter: 2,
      },
    },
  });
  assert.equal(promoted.transitionCounter, 2);
  const authority = verifyBoundSuccessor({
    plan,
    reviewRequestId: REVIEW,
    authority: {
      schema: "agentic-lane-cloud-authority/v1",
      claimId: promoted.claimId,
      claimDigest: promoted.claimDigest,
      canonicalBaseSha: plan.targetCanonicalBaseSha,
      laneRevision: plan.sourceFenceSha,
      writeSetDigest: plan.targetWriteSetDigest,
      leaseEpoch: 1,
      transitionCounter: promoted.transitionCounter,
      state: "active",
      reviewRequestId: REVIEW,
    },
  });
  assert.equal(authority.claimId, promoted.claimId);
});

test("scope expansion rejects out-of-scope source dirt and a non-successor C2", () => {
  const { target } = manifests();
  const dirty = sourceLane();
  dirty.changedPaths.push("scripts/outside-scope.mjs");
  assert.throws(() => buildActiveDirtyScopeExpansionPlan({
    source: dirty,
    targetManifest: target,
    targetCanonicalBaseSha: "4".repeat(40),
  }), /outside the currently admitted write set/);

  const plan = buildActiveDirtyScopeExpansionPlan({
    source: sourceLane(), targetManifest: target, targetCanonicalBaseSha: "4".repeat(40),
  });
  assert.throws(() => verifyWaitingSuccessor({
    plan,
    result: waitingResult(plan, { predecessorClaimId: "9".repeat(64) }),
  }), /exact waiting scope-expansion claim/);
});
