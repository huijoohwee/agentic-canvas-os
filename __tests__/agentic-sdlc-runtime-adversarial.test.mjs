import assert from "node:assert/strict";
import test from "node:test";

import { FINDING_TYPES } from "../scripts/alignment-audit/finding.mjs";
import {
  inspectTaskTransitions,
  validateExecutionRun,
} from "../scripts/agentic-sdlc/index.mjs";
import {
  addPrematureDependentTask,
  canonicalRun,
  RULE_BINDINGS,
  RUN_SCHEMA,
  transition,
} from "./fixtures/agentic-sdlc-adversarial-run.mjs";

function assertRejected(run, { admission = false } = {}) {
  let result;
  try {
    result = validateExecutionRun(run);
  } catch (error) {
    assert.ok(error instanceof Error);
    return;
  }
  assert.equal(result.runtimeReady, false);
  if (admission) assert.equal(result.admissionReady, false);
}

test("schema-forbidden unknown fields cannot be runtime ready", () => {
  const run = canonicalRun();
  run.unknownProof = "schema-forbidden";
  assertRejected(run, { admission: true });
});

test("syntactically valid fake Rule bindings do not establish provenance", () => {
  const run = canonicalRun();
  for (const findingType of Object.keys(run.ruleBindings)) {
    run.ruleBindings[findingType] = {
      ruleId: "fake-rule#1",
      ruleText: "Fake but syntactically valid rule text.",
    };
  }
  assertRejected(run, { admission: true });
  assert.throws(
    () => validateExecutionRun(run, structuredClone(RULE_BINDINGS)),
    /pinned execution finding bindings/u,
  );
});

test("bogus guideline baselines fail execution admission", () => {
  const run = canonicalRun();
  run.guidelineBaseline.authoring = {
    version: "bogus",
    revision: "9".repeat(40),
    digest: "9".repeat(64),
  };
  run.guidelineBaseline.execution = {
    version: "bogus",
    revision: "8".repeat(40),
    digest: "8".repeat(64),
  };
  assertRejected(run, { admission: true });
});

test("dispatch and evidence cannot prove a drifted VCC payload", () => {
  const run = canonicalRun();
  run.vccs[0].endState = "A different outcome that was never evaluated.";
  run.vccs[0].statedCheck = "command-that-was-never-run";
  run.vccs[0].constraint = "Do not mutate an unrelated system.";
  assertRejected(run);
});

test("a verified return cannot admit constraint violations", () => {
  const run = canonicalRun();
  run.returns[0].constraintViolations = [
    "The VCC constraint was violated.",
  ];
  assertRejected(run);
});

test("task derivation cannot outrun the baselined VCC revision", () => {
  const run = canonicalRun();
  run.derivationRevision = "derivation-stale";
  run.dispatches[0].derivationRevision = "derivation-stale";
  assertRejected(run, { admission: true });
});

test("orphan canonical records cannot disappear during normalization", () => {
  const run = canonicalRun();
  for (const collection of ["dispatches", "returns"]) {
    const record = structuredClone(run[collection][0]);
    record.taskId = "999";
    run[collection].push(record);
  }
  run.transitions.push({
    ...structuredClone(run.transitions[0]),
    taskId: "999",
  });
  run.persistedTerminals.push({
    ...structuredClone(run.persistedTerminals[0]),
    taskId: "999",
  });
  assertRejected(run);
});

test("recorded results bind check-run identity and artifact revision", async (t) => {
  await t.test("stale artifact revision", () => {
    const run = canonicalRun();
    run.returns[0].namedCheckResult.artifactRevision = "stale-revision";
    run.returns[0].existingVerificationResult.artifactRevision =
      "stale-revision";
    run.evidence[0].recordedResult.artifactRevision = "stale-revision";
    assertRejected(run);
  });
  await t.test("mismatched check-run identity", () => {
    const run = canonicalRun();
    run.returns[0].namedCheckResult.checkRunId = "stale-check-run";
    run.evidence[0].recordedResult.checkRunId = "stale-check-run";
    assertRejected(run);
  });
});

test("attempt ordinals and recorded iteration consumption are auditable", async (t) => {
  await t.test("underreported iteration consumption", () => {
    const run = canonicalRun();
    run.returns[0].attempts = [{ iteration: 99, progress: true }];
    run.returns[0].consumption.iterations = 0;
    run.consumption.iterations = 0;
    run.tasks[0].budgetEvents.find(({ field }) => field === "iterations").value = 0;
    assertRejected(run);
  });
  await t.test("out-of-order attempts cannot hide a circuit trip", () => {
    const run = canonicalRun();
    run.returns[0].attempts = [
      { iteration: 1, progress: false },
      { iteration: 3, progress: true },
      { iteration: 2, progress: false },
    ];
    run.returns[0].consumption.iterations = 3;
    run.consumption.iterations = 3;
    run.tasks[0].budgetEvents.find(({ field }) => field === "iterations").value = 3;
    assertRejected(run);
  });
});

test("admissionReady is conservative across pre-execution gates", async (t) => {
  await t.test("unbounded task", () => {
    const run = canonicalRun();
    run.tasks[0].budgets.tokens = 0;
    run.dispatches[0].budgets.tokens = 0;
    assertRejected(run, { admission: true });
  });
  await t.test("open Deploy Boundary", () => {
    const run = canonicalRun();
    run.deployBoundary.state = "open";
    assertRejected(run, { admission: true });
  });
});

test("terminal re-derivation is representable by the canonical schema", () => {
  const transitionSchema = RUN_SCHEMA.$defs.transition;
  assert.ok("rederived" in transitionSchema.properties);
  assert.ok("derivationRevision" in transitionSchema.properties);
  const task = {
    id: "1",
    state: "not-started",
    transitions: [
      transition(1, "not-started", "queued", "orchestrator"),
      transition(2, "queued", "ready", "orchestrator"),
      transition(3, "ready", "in-progress", "orchestrator"),
      transition(4, "in-progress", "verified", "evaluator"),
      {
        ...transition(5, "verified", "not-started", "orchestrator"),
        reason: "The VCC changed.",
        rederived: true,
        derivationRevision: "derivation-002",
      },
    ],
  };
  assert.equal(inspectTaskTransitions(task).valid, true);
});

test("global transition sequencing detects premature dependency readiness", () => {
  const transitionSchema = RUN_SCHEMA.$defs.transition;
  assert.ok("sequence" in transitionSchema.properties);
  assert.ok(transitionSchema.required.includes("sequence"));
  const run = canonicalRun();
  addPrematureDependentTask(run);
  assertRejected(run);
});

test("execution results report zero counts for the complete finding union", () => {
  const result = validateExecutionRun(canonicalRun());
  assert.equal(
    result.runtimeReady,
    true,
    JSON.stringify({
      controlFailures: result.controlFailures,
      findings: result.findings,
    }),
  );
  assert.deepEqual(Object.keys(result.findingCounts), FINDING_TYPES);
  assert.equal(FINDING_TYPES.length, 90);
  assert.ok(Object.values(result.findingCounts).every((count) => count === 0));
});
