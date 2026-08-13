import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActiveDirtyScopeExpansionPlan,
} from "../scripts/active-dirty-scope-expansion-contract.mjs";
import {
  createActiveDirtyScopeExpansionControllerAdapter,
  runActiveDirtyScopeExpansion,
} from "../scripts/active-dirty-scope-expansion-controller.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest } from "../scripts/scoped-lane-admission-lib.mjs";

const BASE = "a".repeat(40);
const FENCE = "b".repeat(40);
const C1 = "c".repeat(64);
const C2 = "d".repeat(64);
const BRANCH = "agent/device/protected-head-refresh-controller";
const REVIEW = "github-pull-request:PR_test";

function fixture() {
  const sourceManifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "protected-head-refresh-controller",
    paths: ["scripts/protected-main-refresh-lib.mjs"],
  });
  const targetManifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "protected-head-refresh-controller",
    paths: ["scripts/protected-main-refresh-lib.mjs", "scripts/protected-main-refresh-candidate.mjs"],
  });
  const authority = {
    schema: "agentic-lane-cloud-authority/v1",
    claimId: C1, claimDigest: "e".repeat(64), canonicalBaseSha: BASE,
    laneRevision: FENCE, cloudDeclaredWriteScope: sourceManifest.declaredWriteSet,
    writeSetDigest: sourceManifest.writeSetDigest, leaseEpoch: 1, transitionCounter: 3,
    state: "active", reviewRequestId: REVIEW,
  };
  const lease = {
    schema: "agentic-writer-lease/v2", status: "active", branch: BRANCH,
    scope: "protected-head-refresh-controller", baseSha: BASE, fenceSha: FENCE,
    admission: {
      schema: "agentic-lane-admission-lease/v1", status: "admitted",
      declaredWriteSet: sourceManifest.declaredWriteSet,
      writeSetDigest: sourceManifest.writeSetDigest, manifestDigest: sourceManifest.manifestDigest,
    },
    cloudAuthority: authority,
  };
  const state = {
    source: {
      lease, branch: BRANCH, fenceSha: FENCE, claimId: C1, claimDigest: authority.claimDigest,
      changedPaths: ["scripts/protected-main-refresh-lib.mjs"], untrackedPaths: [],
      dirtyDigest: digestValue({ dirty: true }),
    },
    reviewRequestId: REVIEW,
    targetCanonicalBaseSha: "f".repeat(40),
    sourceStateDigest: "1".repeat(64),
    targetObservationDigest: "2".repeat(64),
  };
  return { state, targetManifest };
}

function waitingResult(plan) {
  return {
    schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "claim",
    claimDigest: "3".repeat(64), ledgerRevision: "4".repeat(40),
    receipt: { receiptDigest: "5".repeat(64) },
    claim: {
      claimId: C2, state: "waiting-successor", predecessorClaimId: plan.sourceClaimId,
      canonicalBaseRevision: plan.targetCanonicalBaseSha, laneRevision: plan.sourceFenceSha,
      writeSetDigest: plan.targetWriteSetDigest, declaredWriteScope: plan.targetDeclaredWriteSet,
      leaseEpoch: 1, transitionCounter: 1, transitionDigest: "6".repeat(64),
      expiresAt: "2026-08-07T12:00:00.000Z",
    },
  };
}

test("controller persists the exact C1 -> waiting C2 -> bound C2 phase sequence", async () => {
  const { state, targetManifest } = fixture();
  const planned = buildActiveDirtyScopeExpansionPlan({
    source: state.source, targetManifest, targetCanonicalBaseSha: state.targetCanonicalBaseSha,
  });
  const trace = [];
  let intent = null;
  const adapter = createActiveDirtyScopeExpansionControllerAdapter({
    readState: () => ({ ...state, intent }),
    beginIntent: ({ plan }) => {
      trace.push("intent");
      intent = {
        status: "intent", planSnapshot: plan, planDigest: plan.planDigest,
        sourceClaimId: plan.sourceClaimId, sourceLeaseDigest: plan.sourceLeaseDigest,
        targetWriteSetDigest: plan.targetWriteSetDigest, targetManifestDigest: plan.targetManifestDigest,
        targetCanonicalBaseSha: plan.targetCanonicalBaseSha, targetLeaseEpoch: 1,
      };
      return intent;
    },
    markIntent: ({ status, ...values }) => {
      trace.push(status);
      intent = { ...intent, status, ...values };
      return intent;
    },
    claimWaitingSuccessor: ({ plan }) => {
      trace.push("claim");
      return waitingResult(plan);
    },
    retireSource: () => {
      trace.push("retire");
      return { receiptDigest: "7".repeat(64) };
    },
    promoteSuccessor: ({ plan }) => {
      trace.push("promote");
      return {
        ...waitingResult(plan), action: "continue", claimDigest: "8".repeat(64),
        receipt: { receiptDigest: "9".repeat(64) },
        claim: { ...waitingResult(plan).claim, state: "current", transitionCounter: 2 },
      };
    },
    bindSuccessor: ({ plan }) => {
      trace.push("bind");
      return {
        receiptDigest: "a".repeat(64),
        authority: {
          schema: "agentic-lane-cloud-authority/v1", claimId: C2, claimDigest: "8".repeat(64),
          canonicalBaseSha: plan.targetCanonicalBaseSha, laneRevision: plan.sourceFenceSha,
          writeSetDigest: plan.targetWriteSetDigest, leaseEpoch: 1, transitionCounter: 2,
          state: "active", reviewRequestId: REVIEW,
        },
      };
    },
    projectLocal: () => {
      trace.push("local");
      const localProjection = { leaseDigest: "b".repeat(64), claimId: C2 };
      intent = {
        ...intent,
        status: "local-cas",
        localProjection,
        localProjectionReceiptDigest: "c".repeat(64),
      };
      return { intent, projection: localProjection, receiptDigest: "c".repeat(64) };
    },
    projectPullRequest: () => {
      trace.push("pr");
      return { projection: { markerDigest: "d".repeat(64) }, receiptDigest: "e".repeat(64) };
    },
    finalize: () => {
      trace.push("complete");
      return { receiptDigest: "f".repeat(64) };
    },
  });

  const result = await runActiveDirtyScopeExpansion({
    targetManifest,
    authorization: `authorize scope-expansion ${planned.planDigest}`,
  }, { adapter });
  assert.equal(result.status, "complete");
  assert.equal(result.receiptDigest, "f".repeat(64));
  assert.deepEqual(trace.filter((phase, index) => (
    phase !== "local-cas" || trace[index - 1] !== "local"
  )), [
    "intent", "claim", "waiting-successor", "retire", "source-retired",
    "promote", "promoted", "bind", "successor-bound", "local",
    "pr", "pr-marker", "complete", "complete",
  ]);
});

test("controller refuses to mutate before the exact plan authorization", async () => {
  const { state, targetManifest } = fixture();
  const adapter = createActiveDirtyScopeExpansionControllerAdapter({
    readState: () => state,
    beginIntent: () => { throw new Error("must not begin"); },
    markIntent: () => { throw new Error("must not mark"); },
    claimWaitingSuccessor: () => { throw new Error("must not claim"); },
    retireSource: () => { throw new Error("must not retire"); },
    promoteSuccessor: () => { throw new Error("must not promote"); },
    bindSuccessor: () => { throw new Error("must not bind"); },
    projectLocal: () => { throw new Error("must not project"); },
    projectPullRequest: () => { throw new Error("must not edit PR"); },
    finalize: () => { throw new Error("must not finalize"); },
  });
  await assert.rejects(() => runActiveDirtyScopeExpansion({ targetManifest }, { adapter }), /exact typed authorization/);
});
