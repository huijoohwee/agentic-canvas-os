import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { buildLaneConvergencePlan } from "../scripts/lane-convergence-transaction-contract.mjs";
import { createLaneConvergenceController } from "../scripts/lane-convergence-transaction-controller.mjs";
import { ACTIONS, ACTION_EFFECTS, CONFIG_SCHEMA,
  describeAgenticCanvasOsLaneConvergenceAdapter }
  from "../scripts/agentic-canvas-os-lane-convergence-adapter-contract.mjs";
import { createAdapter } from "../scripts/agentic-canvas-os-lane-convergence-adapter.mjs";

const SHA_A = "a".repeat(40), SHA_B = "b".repeat(40), SHA_C = "c".repeat(40);

test("descriptor excludes deployment and exposes bounded protected actions", () => {
  const descriptor = describeAgenticCanvasOsLaneConvergenceAdapter();
  assert.equal(descriptor.id, "agentic-canvas-os-protected-lane-convergence");
  assert.deepEqual(descriptor.actions.map(({ action }) => action), Object.values(ACTIONS));
  assert.equal(descriptor.actions.some(({ effects }) => effects.deploymentMutation), false);
});

test("one authorization recovers the response-ahead lane and defers cleanup", async () => {
  const plan = createPlan();
  const state = stateFixture();
  const calls = [];
  const dependencies = {
    async observe() { return snapshot(state); },
    async projectStartAuthority({ subject }) { calls.push(`project:${subject.subjectId}`);
      state.recovered.projectionAligned = true; },
    async admitStart({ subject }) { calls.push(`admit:${subject.subjectId}`);
      state.recovered.admissionStatus = "admitted"; },
    async integrateSource({ subject }) { calls.push(`integrate:${subject.subjectId}`);
      const target = subject.subjectId === "adapter-source" ? state.adapter : state.recovered;
      target.merged = true; target.contained = true; target.pullRequestState = "MERGED";
      target.integrationSha = subject.subjectId === "adapter-source" ? SHA_B : SHA_C; },
    async cleanupWorktree({ subject }) { calls.push(`cleanup:${subject.subjectId}`);
      const target = subject.subjectId === "adapter-source" ? state.adapter : state.recovered;
      target.worktreePresent = false; },
  };
  const adapter = await createAdapter({ plan, configuration: configuration(), dependencies });
  const controller = createLaneConvergenceController({ adapter, journal: memoryJournal(), now: clock() });
  const receipt = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(receipt.transitionCount, 6);
  assert.deepEqual(calls, ["integrate:adapter-source", "project:response-ahead-source",
    "admit:response-ahead-source", "integrate:response-ahead-source",
    "cleanup:response-ahead-source", "cleanup:adapter-source"]);
});

test("configuration rejects an undeclared generic recovery mode", async () => {
  const value = configuration();
  value.subjects[1] = { ...value.subjects[1], recoveryMode: "generic-repair" };
  await assert.rejects(createAdapter({ plan: createPlan(), configuration: value, dependencies: {} }),
    /invalid recovery mode/u);
});

function createPlan() {
  const descriptor = { ...describeAgenticCanvasOsLaneConvergenceAdapter(),
    moduleDigest: "1".repeat(64), configurationDigest: "2".repeat(64) };
  return buildLaneConvergencePlan({ adapter: descriptor, request: {
    schema: "agentic-lane-convergence-request/v1", transactionId: "acos-response-ahead-convergence",
    objective: "Integrate and clean the protected adapter and response-ahead lanes.",
    subjects: [subject("adapter-source", [], false),
      subject("response-ahead-source", ["adapter-source"], true)],
    maxTransitions: 8, terminalReceiptTypes: ["integration", "cleanup"] } });
}
function subject(subjectId, dependencies, recovery) {
  const allowedActions = recovery ? Object.values(ACTIONS)
    : [ACTIONS.integrateSource, ACTIONS.cleanupWorktree];
  const effectCeiling = Object.fromEntries(Object.keys(ACTION_EFFECTS[ACTIONS.integrateSource])
    .map((key) => [key, allowedActions.some((action) => ACTION_EFFECTS[action][key])]));
  return { subjectId, repository: "huijoohwee/agentic-canvas-os",
    lane: `agent/device/${subjectId}`, targetState: "integrated-cleaned", dependencies,
    allowedActions, effectCeiling };
}
function configuration() { return { schema: CONFIG_SCHEMA, controllerRoot: "/controller",
  canonicalRepository: "/workspace/agentic-canvas-os",
  repository: "huijoohwee/agentic-canvas-os", artifactDirectory: "/authority/convergence",
  subjects: [configured("adapter-source", "none"),
    configured("response-ahead-source", "planned-start-response-ahead")] }; }
function configured(subjectId, recoveryMode) { return { subjectId,
  branch: `agent/device/${subjectId}`, worktreePath: `/workspace/${subjectId}`,
  lifecycleRepository: `/workspace/owner-${subjectId}`, sessionId: `${subjectId}-session`,
  taskAuthorityPath: `/authority/${subjectId}.json`,
  pullRequestUrl: `https://github.com/huijoohwee/agentic-canvas-os/pull/${subjectId === "adapter-source" ? 697 : 688}`,
  recoveryMode }; }
function stateFixture() { return {
  adapter: lane("adapter-source", { projectionAligned: true, admissionStatus: "admitted" }),
  recovered: lane("response-ahead-source"),
}; }
function lane(subjectId, overrides = {}) { return { subjectId, worktreePresent: true,
  lifecycleState: "review-ready", admissionStatus: "planned", projectionAligned: false,
  pullRequestState: "OPEN", headSha: SHA_A, integrationSha: null, canonicalSha: SHA_A,
  contained: false, merged: false, ...overrides }; }
function snapshot(state) { return { observedAt: "2026-08-24T00:00:00.000Z",
  subjects: [structuredClone(state.adapter), structuredClone(state.recovered)] }; }
function memoryJournal() { let value = null; return { readIntent() { return value; },
  writeIntent({ expectedIntent, nextIntent }) { assert.equal(value?.intentDigest || null,
    expectedIntent?.intentDigest || null); value = nextIntent; return value; },
  async withOperationLock(action) { return action({ token: digestValue("test") }); } }; }
function clock() { let tick = 0; return () => new Date(Date.parse("2026-08-24T00:00:00.000Z")
  + tick++ * 1000); }
