import assert from "node:assert/strict";
import test from "node:test";

import { inspectTaskGraph } from "../scripts/agentic-sdlc/graph.mjs";
import { validateExecutionRun } from "../scripts/agentic-sdlc/index.mjs";
import { canonicalRun } from "./fixtures/agentic-sdlc-canonical-run.mjs";

test("canonical array order does not change the deterministic result", () => {
  const left = canonicalRun();
  const right = structuredClone(left);
  right.transitions.reverse();
  right.tasks[0].writeSet.reverse();
  right.returns[0].changedArtifacts.reverse();
  right.tasks[0].capabilityGrants[0].scope.reverse();
  right.dispatches[0].capabilityGrants[0].scope.reverse();

  assert.deepEqual(validateExecutionRun(left), validateExecutionRun(right));
});

test("canonical verified replay and aggregate drift fail closed", () => {
  const run = canonicalRun();
  run.transitions.push(transition(
    5,
    "verified",
    "queued",
    "orchestrator",
    "orchestrator:scheduler",
    "artifact-revision-002",
  ));
  run.transitions.at(-1).sequence = 5;
  run.consumption.tokens += 1;
  const result = validateExecutionRun(run);

  assert.equal(result.runtimeReady, false);
  assert.ok(result.findingCounts["state-without-reason"] > 0);
  assert.ok(result.findingCounts["unrecorded-consumption"] > 0);
});

const HARDENING_MUTATIONS = [
  ["scope traversal", (run) => {
    for (const grants of [
      run.tasks[0].capabilityGrants,
      run.dispatches[0].capabilityGrants,
    ]) {
      grants.find(({ class: grantClass }) =>
        grantClass === "local-write").scope = ["src/**", "__tests__/**"];
    }
    for (const artifacts of [
      run.tasks[0].writeSet,
      run.tasks[0].observedChangedArtifacts,
      run.returns[0].changedArtifacts,
    ]) {
      artifacts[artifacts.indexOf("src/feature.mjs")] = "src/../outside.mjs";
    }
    run.tasks[0].capabilityEvents[0].artifact = "src/../outside.mjs";
  }],
  ["contradictory persisted terminal", (run) => {
    run.persistedTerminals.push({
      ...structuredClone(run.persistedTerminals[0]),
      state: "failed",
    });
  }],
  ["successful task after budget exhaustion", (run) => {
    run.tasks[0].budgetEvents.push({
      ordinal: 5,
      action: "exhaust",
      field: "tokens",
      value: 100,
      reason: "Token bound reached.",
      operatorDecisionReference: null,
    });
  }],
  ["criterion with no source VCC", (run) => {
    run.tasks[0].criterionIds.push("AC-UNRESOLVED");
    run.dispatches[0].criterionIds.push("AC-UNRESOLVED");
  }],
  ["contradictory property result", (run) => {
    run.returns[0].propertyResults.push({
      ...structuredClone(run.returns[0].propertyResults[0]),
      ran: false,
      passed: false,
      iterations: 0,
    });
  }],
  ["non-causal transition sequence", (run) => {
    run.transitions.forEach((item, index) => {
      item.sequence = run.transitions.length - index;
    });
  }],
  ["unrecorded guideline load", (run) => {
    run.guidelineLoadCost.events.pop();
  }],
  ["operator refusal without a decision", (run) => {
    run.humanGateEvents.push({
      gateId: "gate-001",
      taskId: "1",
      trigger: "boundary-promotion",
      resolution: "refused",
      operatorDecisionReference: null,
    });
  }],
  ["reused verifier receipt identity", (run) => {
    run.returns[0].existingVerificationResult.checkRunId = "check-run-001";
  }],
  ["contradictory passing summary", (run) => {
    run.returns[0].namedCheckResult.summary = "99 checks failed";
    run.evidence[0].recordedResult.summary = "99 checks failed";
  }],
  ["authoring baseline digest drift", (run) => {
    run.authoringBaseline.digest = "e".repeat(64);
  }],
  ["terminal checkpoint digest drift", (run) => {
    run.persistedTerminals[0].checkpointDigest = "e".repeat(64);
  }],
  ["unknown guideline section anchor", (run) => {
    run.guidelineLoadCost.events[0].loadedSectionAnchors[0] =
      "not-a-real-section";
  }],
  ["missing capability-use receipts", (run) => {
    run.tasks[0].capabilityEvents = [];
  }],
];

test("schema-valid proof laundering mutations fail closed", async (t) => {
  for (const [label, mutate] of HARDENING_MUTATIONS) {
    await t.test(label, () => {
      const run = canonicalRun();
      mutate(run);
      assert.equal(
        validateExecutionRun(run).runtimeReady,
        false,
        `${label} must not be runtime ready`,
      );
    });
  }
});

test("write-conflict identity canonicalizes harmless dot segments", () => {
  const result = inspectTaskGraph([
    {
      id: "1",
      wave: "1",
      dependencies: [],
      declaredWriteSet: ["src/feature.mjs"],
    },
    {
      id: "2",
      wave: "1",
      dependencies: [],
      declaredWriteSet: ["src/./feature.mjs"],
    },
  ]);
  assert.equal(result.writeConflicts.length, 1);
  assert.deepEqual(result.writeConflicts[0].artifacts, ["src/feature.mjs"]);
});

function transition(ordinal, from, to, role, mechanismId, artifactRevision) {
  return {
    taskId: "1",
    ordinal,
    sequence: ordinal,
    from,
    to,
    role,
    mechanismId,
    reason: null,
    operatorDecisionReference: null,
    artifactRevision,
  };
}
