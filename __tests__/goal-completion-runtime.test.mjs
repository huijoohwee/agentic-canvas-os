import test from "node:test";
import assert from "node:assert/strict";

import {
  BASE_WEIGHT,
  GATE_FINDING,
  GOAL_SCHEMA,
  PRIORITY_CEILING,
  RETRY_PENALTY,
  deriveHeuristics,
  planGoalAdvance,
  weightForKind,
} from "../scripts/goal-completion-runtime-contract.mjs";

const scope = (name) => [`path:${name}`];

const unit = (id, overrides = {}) => ({
  id,
  kind: "docs",
  state: "pending",
  dependencies: [],
  declaredWriteSet: scope(id),
  authorityState: "current",
  ...overrides,
});

const goal = (units, overrides = {}) => ({
  schema: GOAL_SCHEMA,
  goalId: "g1",
  capacity: 4,
  units,
  ...overrides,
});

test("an unseen kind gets the neutral prior rather than a guess", () => {
  const heuristics = deriveHeuristics([]);
  assert.equal(heuristics.observedOutcomes, 0);
  assert.deepEqual(heuristics.weights, []);
  assert.equal(weightForKind(heuristics, "anything"), BASE_WEIGHT);
  assert.match(heuristics.heuristicsDigest, /^[0-9a-f]{64}$/);
});

test("weights rise with success, fall with failure, and are penalised by retries", () => {
  const clean = deriveHeuristics([
    { kind: "a", result: "success" },
    { kind: "a", result: "success" },
  ]);
  assert.equal(weightForKind(clean, "a"), PRIORITY_CEILING);

  const mixed = deriveHeuristics([
    { kind: "b", result: "success" },
    { kind: "b", result: "failure" },
  ]);
  assert.equal(weightForKind(mixed, "b"), PRIORITY_CEILING / 2);

  const retried = deriveHeuristics([
    { kind: "c", result: "success", retries: 2 },
    { kind: "c", result: "success", retries: 2 },
  ]);
  assert.equal(weightForKind(retried, "c"), PRIORITY_CEILING - RETRY_PENALTY * 2);

  const failing = deriveHeuristics([{ kind: "d", result: "failure", retries: 40 }]);
  assert.equal(weightForKind(failing, "d"), 0, "weight floors at zero, never negative");
});

test("heuristics are deterministic and order-independent", () => {
  const outcomes = [
    { kind: "a", result: "success" },
    { kind: "b", result: "failure" },
    { kind: "a", result: "failure", retries: 1 },
  ];
  const first = deriveHeuristics(outcomes);
  const second = deriveHeuristics([...outcomes].reverse());
  assert.equal(first.heuristicsDigest, second.heuristicsDigest);
  assert.deepEqual(first.weights, second.weights);
});

test("learned weight reorders the ready set without changing admission", () => {
  const outcomes = [
    { kind: "fast", result: "success" },
    { kind: "slow", result: "failure" },
  ];
  // Both units are independent, so both are admitted; only order changes.
  const receipt = planGoalAdvance(goal(
    [unit("slow-unit", { kind: "slow" }), unit("fast-unit", { kind: "fast" })],
    { outcomes },
  ));
  assert.equal(receipt.state, "continuable");
  assert.deepEqual(receipt.nextUnitIds, ["fast-unit", "slow-unit"]);
  assert.equal(receipt.progress.ready, 2);
  assert.equal(receipt.progress.blocked, 0);
});

test("a blocked unit bounds itself and its dependents while the goal continues", () => {
  const receipt = planGoalAdvance(goal([
    unit("blocked-root", { authorityState: "retired" }),
    unit("dependent", { dependencies: ["blocked-root"] }),
    unit("unrelated"),
  ]));
  assert.equal(receipt.state, "continuable");
  assert.equal(receipt.continuable, true, "an unrelated ready unit keeps the goal moving");
  assert.deepEqual(receipt.nextUnitIds, ["unrelated"]);
  const blockedIds = receipt.blockedUnits.map((item) => item.unitId).sort();
  assert.deepEqual(blockedIds, ["blocked-root", "dependent"]);
  assert.equal(
    receipt.blockedUnits.find((item) => item.unitId === "dependent").reason,
    "dependency-blocked",
  );
});

test("a terminal dependency stops constraining its dependent", () => {
  const receipt = planGoalAdvance(goal([
    unit("finished", { state: "done" }),
    unit("next", { dependencies: ["finished"] }),
  ]));
  assert.deepEqual(receipt.nextUnitIds, ["next"]);
  assert.equal(receipt.progress.done, 1);
  assert.equal(receipt.progress.completedPermille, 500);
});

test("a gated unit fails closed until its exact authorization is supplied", () => {
  const gated = [unit("deploy", { gate: true }), unit("safe")];
  const refused = planGoalAdvance(goal(gated));
  assert.deepEqual(refused.nextUnitIds, ["safe"]);
  const block = refused.blockedUnits.find((item) => item.unitId === "deploy");
  assert.ok(block, "an unauthorized gate must not be scheduled");
  assert.deepEqual(block.related, [GATE_FINDING]);

  const authorized = planGoalAdvance(goal(gated, { authorizations: ["deploy"] }));
  assert.deepEqual([...authorized.nextUnitIds].sort(), ["deploy", "safe"]);
  assert.equal(authorized.progress.blocked, 0);
});

test("an authorization for an unknown unit is rejected rather than ignored", () => {
  assert.throws(
    () => planGoalAdvance(goal([unit("a")], { authorizations: ["ghost"] })),
    /authorization for unknown unit ghost/,
  );
});

test("overlapping write sets serialize into separate waves, never into blocked", () => {
  const receipt = planGoalAdvance(goal(
    [unit("one", { declaredWriteSet: scope("shared") }),
      unit("two", { declaredWriteSet: scope("shared") })],
    { capacity: 4 },
  ));
  // Overlap is a same-wave exclusion, so both units stay admitted and are
  // ordered across sequential waves. Contention never becomes a blocker.
  assert.equal(receipt.progress.ready, 2);
  assert.equal(receipt.progress.blocked, 0);
  assert.equal(receipt.waves.length, 2);
  assert.deepEqual(receipt.waves.map((wave) => wave.taskIds), [["one"], ["two"]]);
  assert.equal(receipt.state, "continuable");
});

test("no ready unit reports stalled or blocked rather than complete", () => {
  const stalled = planGoalAdvance(goal([
    unit("waiter", { authorityState: "waiting-successor" }),
  ]));
  assert.equal(stalled.state, "stalled");
  assert.equal(stalled.continuable, false);

  const dead = planGoalAdvance(goal([unit("gone", { authorityState: "retired" })]));
  assert.equal(dead.state, "blocked");
  assert.equal(dead.continuable, false);
});

test("an all-terminal goal completes without inventing a schedule", () => {
  const complete = planGoalAdvance(goal([
    unit("a", { state: "done" }), unit("b", { state: "done" }),
  ]));
  assert.equal(complete.state, "complete");
  assert.equal(complete.scheduleDigest, null);
  assert.equal(complete.progress.completedPermille, 1_000);
  assert.deepEqual(complete.nextUnitIds, []);

  const abandoned = planGoalAdvance(goal([unit("x", { state: "abandoned" })]));
  assert.equal(abandoned.state, "blocked");
});

test("the receipt is digest-bound, frozen, and claims no mutation authority", () => {
  const input = goal([unit("a"), unit("b")]);
  const first = planGoalAdvance(input);
  const second = planGoalAdvance(input);
  assert.equal(first.receiptDigest, second.receiptDigest, "byte-identical input, identical receipt");
  assert.match(first.goalDigest, /^[0-9a-f]{64}$/);
  assert.equal(first.mutation, false);
  assert.ok(Object.isFrozen(first));
  assert.throws(() => { first.state = "complete"; }, TypeError);
});

test("a changed outcome set changes the receipt digest", () => {
  const units = [unit("a", { kind: "k" })];
  const before = planGoalAdvance(goal(units));
  const after = planGoalAdvance(goal(units, {
    outcomes: [{ kind: "k", result: "failure" }],
  }));
  assert.notEqual(before.receiptDigest, after.receiptDigest);
  assert.equal(before.appliedWeights.length, 0);
  assert.equal(after.appliedWeights.length, 1);
});

test("malformed goals fail closed", () => {
  for (const [mutate, pattern] of [
    [(g) => ({ ...g, schema: "other/v1" }), /invalid schema/],
    [(g) => ({ ...g, capacity: 0 }), /invalid capacity/],
    [(g) => ({ ...g, units: [] }), /invalid units/],
    [(g) => ({ ...g, units: [unit("a"), unit("a")] }), /duplicate unit id/],
    [(g) => ({ ...g, units: [unit("a", { dependencies: ["a"] })] }), /dependencies for a/],
    [(g) => ({ ...g, units: [unit("a", { state: "maybe" })] }), /state for a/],
    [(g) => ({ ...g, outcomes: [{ kind: "k", result: "perhaps" }] }), /outcome\[0\]\.result/],
  ]) {
    assert.throws(() => planGoalAdvance(mutate(goal([unit("a")]))), pattern);
  }
});

test("a dependency cycle is rejected by the owning scheduler", () => {
  assert.throws(() => planGoalAdvance(goal([
    unit("a", { dependencies: ["b"] }),
    unit("b", { dependencies: ["a"] }),
  ])), /cycle/);
});
