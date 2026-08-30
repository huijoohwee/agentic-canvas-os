// Proves the lane-authority deadlock is unreachable: ordinary lane progress no
// longer strands a binding, and a binding that is already stranded has an exit
// that cannot change who holds authority.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  TASK_AUTHORITY_BINDING_MODES,
  assertTaskAuthorityBinding,
  createTaskAuthorityBinding,
  createTaskAuthorityCapability,
  createTaskAuthorityTransitionPlan,
  normalizeStableLaneIdentity,
  taskAuthorityLaneBindingShape,
} from "../scripts/task-bound-lane-authority-contract.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const CLAIM_A = "c".repeat(64);
const CLAIM_B = "d".repeat(64);

const lease = (overrides = {}) => ({
  branch: "agent/device-one/harness-scope",
  scope: "harness-scope",
  device: "device-one",
  epoch: 1,
  baseSha: SHA_A,
  status: "active",
  fenceSha: null,
  cloudAuthority: { claimId: CLAIM_A },
  ...overrides,
});

const capability = createTaskAuthorityCapability();
const bind = (target = lease()) => createTaskAuthorityBinding({ capability, lease: target });

test("the durable binding covers only operands the lifecycle never changes", () => {
  assert.deepEqual(Object.keys(normalizeStableLaneIdentity(lease())).sort(),
    ["branch", "device", "scope"]);
});

test("a re-minted claim, moved base, or advanced epoch no longer strands the lease", () => {
  const binding = bind();
  for (const drift of [
    { cloudAuthority: { claimId: CLAIM_B } },
    { baseSha: SHA_B },
    { epoch: 2 },
    { epoch: 7, baseSha: SHA_B, cloudAuthority: { claimId: CLAIM_B } },
  ]) {
    const moved = lease(drift);
    assert.equal(taskAuthorityLaneBindingShape({ binding, lease: moved }), "stable");
    assert.doesNotThrow(() => assertTaskAuthorityBinding({ binding, lease: moved }),
      `lane drift ${JSON.stringify(drift)} must not strand the binding`);
  }
});

test("a different lane is still refused, so narrowing removed no boundary", () => {
  const binding = bind();
  for (const foreign of [
    { branch: "agent/device-one/other-scope", scope: "other-scope" },
    { branch: "agent/device-two/harness-scope", device: "device-two" },
  ]) {
    assert.throws(() => assertTaskAuthorityBinding({ binding, lease: lease(foreign) }),
      /does not match the writer lease lane/);
  }
});

test("a legacy full-lane binding stays valid until its lane moves, then names its exit", () => {
  const subject = lease();
  // The pre-narrowing shape: a digest over branch, scope, device, epoch, baseSha,
  // and cloudClaimId. Already-issued bindings must not be invalidated.
  const legacy = {
    ...bind(),
    laneBindingDigest: null,
  };
  const legacyLane = {
    ...normalizeStableLaneIdentity(subject),
    epoch: subject.epoch,
    baseSha: subject.baseSha,
    cloudClaimId: subject.cloudAuthority.claimId,
  };
  legacy.laneBindingDigest = digest(legacyLane);
  legacy.bindingDigest = digest(Object.fromEntries(
    Object.entries(legacy).filter(([key]) => key !== "bindingDigest"),
  ));

  assert.equal(taskAuthorityLaneBindingShape({ binding: legacy, lease: subject }), "legacy");
  assert.doesNotThrow(() => assertTaskAuthorityBinding({ binding: legacy, lease: subject }));

  const moved = lease({ cloudAuthority: { claimId: CLAIM_B } });
  assert.equal(taskAuthorityLaneBindingShape({ binding: legacy, lease: moved }), "drifted");
  assert.throws(() => assertTaskAuthorityBinding({ binding: legacy, lease: moved }),
    /plan and run a task-bound-lane-rebind/);
});

test("rebind is a declared mode and transition, so the drifted state has an edge", () => {
  assert.ok(TASK_AUTHORITY_BINDING_MODES.includes("rebind"));
  const binding = bind();
  const plan = createTaskAuthorityTransitionPlan({
    operation: "rebind",
    lease: lease({ cloudAuthority: { claimId: CLAIM_B } }),
    headSha: SHA_B,
    worktreeStateDigest: "e".repeat(64),
    targetCapability: capability,
    currentBinding: binding,
  });
  assert.equal(plan.operation, "rebind");
  assert.match(plan.exactAuthorization, /^authorize task-bound-lane-rebind [0-9a-f]{64}$/);
  assert.equal(plan.currentBindingDigest, binding.bindingDigest);
  // The plan still records the full volatile lane, so the authorization names the
  // exact lane state it re-anchors to.
  assert.equal(plan.lane.cloudClaimId, CLAIM_B);
  assert.equal(plan.lane.baseSha, SHA_A);
});

test("rebind can never become a handoff", () => {
  const binding = bind();
  const base = {
    operation: "rebind",
    lease: lease(),
    headSha: SHA_B,
    worktreeStateDigest: "e".repeat(64),
    currentBinding: binding,
  };
  assert.throws(() => createTaskAuthorityTransitionPlan({
    ...base, targetCapability: createTaskAuthorityCapability(),
  }), /same authority subject/);
  assert.throws(() => createTaskAuthorityTransitionPlan({
    ...base,
    targetCapability: createTaskAuthorityCapability({
      authoritySubjectId: capability.authoritySubjectId, generation: 2,
    }),
  }), /generation must not advance|same authority subject|bound public key/);
  assert.throws(() => createTaskAuthorityTransitionPlan({
    ...base, targetCapability: capability, currentBinding: null,
  }), /Rebind requires current task authority/);
});

test("a rebound binding carries its plan and its predecessor", () => {
  const previous = bind();
  const rebound = createTaskAuthorityBinding({
    capability,
    lease: lease({ epoch: 2, cloudAuthority: { claimId: CLAIM_B } }),
    bindingMode: "rebind",
    transitionPlanDigest: "f".repeat(64),
    priorBindingDigest: previous.bindingDigest,
  });
  assert.equal(rebound.bindingMode, "rebind");
  assert.equal(rebound.priorBindingDigest, previous.bindingDigest);
  assert.equal(rebound.authoritySubjectId, previous.authoritySubjectId);
  assert.equal(rebound.generation, previous.generation);
  // Same stable lane, so the rebound digest equals the one it replaced.
  assert.equal(rebound.laneBindingDigest, previous.laneBindingDigest);
});

test("rebind re-anchors authority without touching lease liveness", () => {
  // Expiry and drift must not be jointly unrecoverable, so rebind is permitted on
  // an expired lease. It must therefore confer no liveness: the rebound lease is
  // still expired and still needs renewal before it can record anything.
  const expired = lease({ expiresAt: "2026-08-30T13:20:31.000Z" });
  const rebound = createTaskAuthorityBinding({
    capability,
    lease: expired,
    bindingMode: "rebind",
    transitionPlanDigest: "f".repeat(64),
    priorBindingDigest: bind().bindingDigest,
  });
  assert.equal(Object.keys(rebound).includes("expiresAt"), false,
    "a binding carries no liveness field it could extend");
  assert.equal(expired.expiresAt, "2026-08-30T13:20:31.000Z");
  assert.equal(expired.status, "active", "rebind changes neither status nor expiry");
  assert.equal(taskAuthorityLaneBindingShape({ binding: rebound, lease: expired }), "stable");
});

test("rebind without transition evidence is rejected", () => {
  assert.throws(() => createTaskAuthorityBinding({
    capability, lease: lease(), bindingMode: "rebind",
    priorBindingDigest: bind().bindingDigest,
  }), /transition plan digest/);
  assert.throws(() => createTaskAuthorityBinding({
    capability, lease: lease(), bindingMode: "rebind",
    transitionPlanDigest: "f".repeat(64),
  }), /prior binding digest/);
});

function digest(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonical(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}
