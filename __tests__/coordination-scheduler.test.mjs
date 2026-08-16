import test from "node:test";
import assert from "node:assert/strict";
import { buildCoordinationSchedule } from "../scripts/coordination-scheduler-contract.mjs";

const digest = character => character.repeat(64);
const task = (id, overrides = {}) => ({
  id,
  priority: 0,
  dependencies: [],
  declaredWriteSet: [`path:${id}.mjs`, `semantic:${id}`],
  authorityState: "current",
  findings: [],
  ...overrides,
});
const input = tasks => ({ schema: "agentic-coordination-scheduler-input/v1", capacity: 2, tasks });

test("schedules disjoint current claims in one bounded wave", () => {
  const report = buildCoordinationSchedule(input([task("alpha"), task("beta")]));
  assert.deepEqual(report.waves[0].taskIds, ["alpha", "beta"]);
  assert.equal(report.summary.ready, 2);
  assert.equal(report.mutation, false);
  assert.match(report.reportDigest, /^[0-9a-f]{64}$/u);
});

test("keeps a waiting successor non-writing without blocking a disjoint task", () => {
  const report = buildCoordinationSchedule(input([
    task("queued", { authorityState: "waiting-successor" }),
    task("runnable"),
  ]));
  assert.deepEqual(report.ready.map(item => item.taskId), ["runnable"]);
  assert.deepEqual(report.waiting.map(item => item.taskId), ["queued"]);
});

test("records proven disjoint global attention without blocking", () => {
  const report = buildCoordinationSchedule(input([task("candidate", {
    findings: [{
      code: "foreign-attention-required",
      blockScope: "global",
      affectedWriteSet: ["path:foreign.mjs", "semantic:foreign"],
      evidenceDigest: digest("a"),
    }],
  })]));
  assert.equal(report.summary.ready, 1);
  assert.equal(report.nonBlockingAttention.length, 1);
});

test("fails closed when global attention has no disjoint scope proof", () => {
  const report = buildCoordinationSchedule(input([task("candidate", {
    findings: [{ code: "unknown-owner", blockScope: "global", affectedWriteSet: null,
      evidenceDigest: digest("b") }],
  })]));
  assert.equal(report.summary.blocked, 1);
  assert.equal(report.blocked[0].reason, "admission-finding");
});

test("serializes overlapping candidates and respects dependencies", () => {
  const shared = ["path:shared.mjs", "semantic:shared"];
  const report = buildCoordinationSchedule(input([
    task("first", { priority: 2, declaredWriteSet: shared }),
    task("second", { priority: 1, declaredWriteSet: shared }),
    task("child", { dependencies: ["first"] }),
  ]));
  assert.deepEqual(report.waves, [
    { index: 0, taskIds: ["first"] },
    { index: 1, taskIds: ["second", "child"] },
  ]);
});

test("rejects cyclic task graphs before scheduling", () => {
  assert.throws(() => buildCoordinationSchedule(input([
    task("alpha", { dependencies: ["beta"] }),
    task("beta", { dependencies: ["alpha"] }),
  ])), /dependency cycle/u);
});
