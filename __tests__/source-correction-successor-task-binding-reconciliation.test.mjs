import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  AUTHORIZATION_PREFIX, REPAIR_SCHEMA, ZERO_EFFECTS, buildPlan,
} from "../scripts/source-correction-successor-task-binding-reconciliation-contract.mjs";
import { createSourceCorrectionSuccessorTaskBindingReconciliationController }
  from "../scripts/source-correction-successor-task-binding-reconciliation-controller.mjs";
import { currentSuccessorRepair }
  from "../scripts/source-correction-successor-task-binding-reconciliation-repository-adapter.mjs";

const D = value => digestValue({ value });
const S = value => String(value).repeat(40).slice(0, 40);

function evidence(overrides = {}) {
  const core = {
    observedAt: "2026-08-16T15:00:00.000Z",
    repository: "/repo",
    branch: "agent/device/repository-teardown",
    sessionId: "source-session",
    worktreePath: "/repo",
    localHeadSha: S("a"),
    remoteHeadSha: S("b"),
    pullRequest: {
      number: 519,
      url: "https://github.com/example/repo/pull/519",
      state: "OPEN",
      isDraft: true,
      headBranch: "agent/device/repository-teardown",
      headSha: S("b"),
      bodyDigest: D("body"),
    },
    sourceLeaseDigest: D("source-lease"),
    sourceBindingDigest: D("source-binding"),
    predecessorClaimId: D("predecessor"),
    successorClaimId: D("successor"),
    successorLeaseEpoch: 3,
    sourceCorrection: {
      planDigest: D("source-correction-plan"),
      sourceClaimId: D("predecessor"),
      successorClaimId: D("successor"),
      sourceHeadSha: S("b"),
      leaseDigest: D("source-lease"),
      receiptDigest: D("source-correction-receipt"),
    },
    markerDigest: D("marker"),
    terminalRepair: null,
    ...overrides,
  };
  return { ...core, evidenceDigest: digestValue(core) };
}

function repair(plan, overrides = {}) {
  const core = {
    schema: REPAIR_SCHEMA,
    status: "reconciled",
    planDigest: plan.planDigest,
    branch: plan.evidence.branch,
    predecessorClaimId: plan.evidence.predecessorClaimId,
    successorClaimId: plan.evidence.successorClaimId,
    sourceBindingDigest: plan.evidence.sourceBindingDigest,
    targetBindingDigest: D("target-binding"),
    sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
    taskAuthorityReceiptDigest: D("task-authority"),
    reconciledAt: "2026-08-16T15:01:00.000Z",
    ...ZERO_EFFECTS,
    ...overrides,
  };
  return { ...core, receiptDigest: digestValue(core) };
}

function terminal(projected) {
  return {
    targetBindingDigest: projected.targetBindingDigest,
    targetLeaseDigest: D("target-lease"),
    registryRevision: 3733,
    repairReceiptDigest: projected.receiptDigest,
    verifiedAt: "2026-08-16T15:02:00.000Z",
    ...ZERO_EFFECTS,
  };
}

test("requires exact plan authorization before projection", () => {
  const source = evidence();
  const plan = buildPlan(source);
  const adapter = {
    inspect: () => source,
    project: () => assert.fail("must not project"),
    verify: () => assert.fail("must not verify"),
  };
  assert.throws(
    () => createSourceCorrectionSuccessorTaskBindingReconciliationController(adapter).run({
      plan,
      authorization: "authorize something else",
      taskAuthorityFile: "/capability",
    }),
    /Exact authorization required/u,
  );
});

test("rejects source or provider drift before registry CAS", () => {
  const source = evidence();
  const plan = buildPlan(source);
  const drifted = evidence({ localHeadSha: S("c") });
  const adapter = {
    inspect: () => drifted,
    project: () => assert.fail("must not project"),
    verify: () => assert.fail("must not verify"),
  };
  assert.throws(
    () => createSourceCorrectionSuccessorTaskBindingReconciliationController(adapter).run({
      plan,
      authorization: AUTHORIZATION_PREFIX + " " + plan.planDigest,
      taskAuthorityFile: "/capability",
    }),
    /subject changed/u,
  );
});

test("projects one registry-only successor binding and returns a terminal receipt", () => {
  const source = evidence();
  const plan = buildPlan(source);
  const projected = repair(plan);
  let projectCalls = 0;
  const adapter = {
    inspect: () => source,
    project: ({ operation }) => {
      projectCalls += 1;
      assert.match(operation, new RegExp(plan.planDigest, "u"));
      return projected;
    },
    verify: () => terminal(projected),
  };
  const receipt = createSourceCorrectionSuccessorTaskBindingReconciliationController(adapter).run({
    plan,
    authorization: AUTHORIZATION_PREFIX + " " + plan.planDigest,
    taskAuthorityFile: "/capability",
  });
  assert.equal(projectCalls, 1);
  assert.equal(receipt.targetBindingDigest, projected.targetBindingDigest);
  assert.equal(receipt.registryRevision, 3733);
  for (const key of Object.keys(ZERO_EFFECTS)) assert.equal(receipt[key], false);
});

test("adopts an exact terminal repair without repeating CAS", () => {
  const source = evidence();
  const plan = buildPlan(source);
  const projected = repair(plan);
  const adapter = {
    inspect: () => evidence({ terminalRepair: projected }),
    project: () => assert.fail("terminal replay must not project"),
    verify: () => terminal(projected),
  };
  const receipt = createSourceCorrectionSuccessorTaskBindingReconciliationController(adapter).run({
    plan,
    authorization: AUTHORIZATION_PREFIX + " " + plan.planDigest,
    taskAuthorityFile: "/capability",
  });
  assert.equal(receipt.repairReceiptDigest, projected.receiptDigest);
});

test("rejects cross-plan terminal repair adoption", () => {
  const source = evidence();
  const plan = buildPlan(source);
  const otherPlan = buildPlan(evidence({ observedAt: "2026-08-16T15:00:01.000Z" }));
  const projected = repair(otherPlan);
  const adapter = {
    inspect: () => evidence({ terminalRepair: projected }),
    project: () => assert.fail("must not project"),
    verify: () => terminal(projected),
  };
  assert.throws(
    () => createSourceCorrectionSuccessorTaskBindingReconciliationController(adapter).run({
      plan,
      authorization: AUTHORIZATION_PREFIX + " " + plan.planDigest,
      taskAuthorityFile: "/capability",
    }),
    /terminal receipt join/u,
  );
});

test("ignores a valid terminal repair retained from a predecessor successor", () => {
  const plan = buildPlan(evidence());
  const previous = repair(plan, { successorClaimId: D("previous-successor") });
  const lease = {
    cloudAuthority: { claimId: plan.evidence.successorClaimId },
    sourceCorrectionSuccessorTaskBindingReconciliation: previous,
  };
  assert.equal(currentSuccessorRepair(lease), null);
  assert.equal(currentSuccessorRepair({
    ...lease,
    cloudAuthority: { claimId: previous.successorClaimId },
  }).receiptDigest, previous.receiptDigest);
});
