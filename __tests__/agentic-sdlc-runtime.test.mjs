import assert from "node:assert/strict";
import test from "node:test";

import {
  EXECUTION_FINDING_SEVERITIES,
  EXECUTION_FINDING_TYPES,
  allowedRoleForState,
  allowedTransition,
  inspectTaskTransitions,
  PINNED_EXECUTION_RULE_CATALOG,
} from "../scripts/agentic-sdlc/index.mjs";
import {
  __validateNormalizedExecutionRunForTests as validateExecutionRun,
} from "../scripts/agentic-sdlc/validate-execution-run.mjs";
import { FINDING_TYPES } from "../scripts/alignment-audit/finding.mjs";
import { validRun } from "./fixtures/agentic-sdlc-normalized-run.mjs";

test("a complete execution run is runtime ready, deterministic, and input-immutable", () => {
  const run = deepFreeze(validRun());
  const before = JSON.stringify(run);
  const first = validateExecutionRun(run);
  const second = validateExecutionRun(run);

  assert.equal(first.runtimeReady, true, JSON.stringify({
    controlFailures: first.controlFailures,
    findings: first.findings,
  }));
  assert.equal(first.admissionReady, true);
  assert.deepEqual(first.readiness, {
    localRung: "runtime-ready",
    deliveredRung: "undocumented",
  });
  assert.deepEqual(first.findingComparison, {
    newCount: 0,
    resolvedCount: 0,
    unchangedCount: 0,
    newBlockerCount: 0,
  });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(run), before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.findings.length, 0);
  assert.deepEqual(Object.keys(first.findingCounts), FINDING_TYPES);
  assert.ok(Object.values(first.findingCounts).every((count) => count === 0));
  assert.deepEqual(first.metrics, {
    taskCount: 1,
    vccCount: 1,
    coveredVccCount: 1,
    bridgeCoverageRatio: 1,
    transitionCount: 4,
    terminalTaskCount: 1,
    verifiedTaskCount: 1,
    evidenceReferenceCount: 1,
    satisfiedVccCount: 1,
    satisfiedVccIds: ["VCC-1"],
    graphAcyclic: true,
    stateMachineValid: true,
    boundaryClosed: true,
    persistenceComplete: true,
    humanGatesClosed: true,
    economicsWithinEstimate: true,
    governanceLoadCostTokens: 28,
    consumption: {
      tokens: 20,
      iterations: 1,
      wallClockMs: 100,
      contextTokens: 200,
    },
    totalTokenConsumption: 48,
  });
});

test("rule bindings are mandatory for every execution finding type", () => {
  const run = validRun();
  delete run.ruleBindings["unresumable-run"];
  assert.throws(
    () => validateExecutionRun(run),
    /ruleBindings must supply a canonical Rule ID for: unresumable-run/u,
  );
});

test("synthetic finding anchors are rejected", () => {
  const run = validRun();
  run.ruleBindings["self-graded-verdict"] = "ASDLC-01";
  assert.throws(
    () => validateExecutionRun(run),
    /canonical Rule ID for: self-graded-verdict/u,
  );
});

test("the exported state machine is exact and terminal states are immutable", () => {
  assert.equal(allowedTransition("not-started", "queued"), true);
  assert.equal(allowedTransition("ready", "verified"), false);
  assert.equal(allowedTransition("verified", "queued"), false);
  assert.equal(allowedRoleForState("verified", "evaluator"), true);
  assert.equal(allowedRoleForState("verified", "implementer"), false);

  const task = validRun().tasks[0];
  task.transitions.push({
    ordinal: 5,
    taskId: "1",
    mechanismId: "orchestrator:scheduler",
    artifactRevision: "artifact-revision-002",
    from: "verified",
    to: "queued",
    role: "orchestrator",
  });
  task.state = "queued";
  const inspection = inspectTaskTransitions(task);
  assert.equal(inspection.valid, false);
  assert.ok(inspection.violations.some(({ kind }) => kind === "terminal-transition"));
});

test("code-bearing test claims must name observed, returned test artifacts", () => {
  for (const artifacts of [
    ["src/feature.mjs"],
    ["tests/unobserved.test.mjs"],
  ]) {
    const run = validRun();
    run.tasks[0].return.automatedTests.artifacts = artifacts;
    const result = validateExecutionRun(run);
    assert.ok(result.findingCounts["unsurfaced-result"] > 0);
  }
});

test("correctness properties require a nonempty statement", () => {
  const run = validRun();
  run.vccs[0].correctnessProperties[0].statement = "";
  const result = validateExecutionRun(run);
  assert.ok(result.findingCounts["unproven-property"] > 0);
});

test("boundary-crossing elevation requests remain forbidden while blocked", () => {
  const run = validRun();
  run.tasks[0].state = "blocked";
  run.tasks[0].transitions[3] = {
    ...run.tasks[0].transitions[3],
    to: "blocked",
    role: "orchestrator",
    mechanismId: "orchestrator:scheduler",
    reason: "Boundary elevation was refused.",
  };
  run.tasks[0].capabilityEvents.push({
    ordinal: 3,
    action: "request-elevation",
    capabilityClass: "boundary-crossing",
    actorRole: "implementer",
    operationId: "boundary-request-001",
  });
  const result = validateExecutionRun(run);
  assert.equal(result.metrics.boundaryClosed, false);
  assert.ok(result.controlFailures.includes("boundary-crossed"));
  assert.ok(result.findingCounts["deploy-boundary-breach"] > 0);
});

const FINDING_CASES = [
  ["self-graded-verdict", (run) => {
    run.tasks[0].verdict.mechanismId = "implementer:task-worker";
  }],
  ["unnamed-evaluator", (run) => {
    run.evaluator.mechanismId = "";
  }],
  ["ungrounded-task", (run) => {
    run.tasks[0].sourceVccIds = ["VCC-unknown"];
    run.tasks[0].dispatch.sourceVccs = [{
      id: "VCC-unknown",
      check: run.tasks[0].dispatch.namedCheck,
      constraint: "Unknown source",
    }];
  }],
  ["unexecuted-condition", (run) => {
    run.vccs.push({ id: "VCC-2", criterionId: "AC-2", correctnessProperties: [] });
  }],
  ["task-cycle", (run) => {
    run.tasks[0].dependencies = ["1"];
  }],
  ["concurrent-write-conflict", (run) => {
    const second = structuredClone(run.tasks[0]);
    second.id = "2";
    second.text = "Implement a second coherent outcome.";
    second.dispatch.taskId = "2";
    second.dispatch.text = second.text;
    run.tasks.push(second);
    run.persistence.persistedTransitionRefs.push("2:4");
  }],
  ["state-without-reason", (run) => {
    run.tasks[0].state = "failed";
    run.tasks[0].transitions[3] = {
      ordinal: 4,
      taskId: "1",
      mechanismId: "orchestrator:scheduler",
      artifactRevision: "artifact-revision-001",
      from: "in-progress",
      to: "failed",
      role: "orchestrator",
      reason: "",
    };
  }],
  ["oversized-task", (run) => {
    run.tasks[0].sizing.withinSingleBudget = false;
  }],
  ["unsurfaced-result", (run) => {
    run.tasks[0].return.checkResult.summary = "";
  }],
  ["unenumerated-change", (run) => {
    run.tasks[0].return.changedArtifacts = ["src/feature.mjs"];
  }],
  ["self-escalated-capability", (run) => {
    run.tasks[0].capabilityEvents.push({
      ordinal: 3,
      action: "use",
      capabilityClass: "environment-mutate",
      actorRole: "implementer",
    });
  }],
  ["out-of-scope-write", (run) => {
    run.tasks[0].declaredWriteSet.push("outside/escape.mjs");
    run.tasks[0].observedChangedArtifacts.push("outside/escape.mjs");
    run.tasks[0].return.changedArtifacts.push("outside/escape.mjs");
  }],
  ["ungated-irreversible-operation", (run) => {
    const grant = {
      class: "irreversible",
      uses: ["delete one declared artifact"],
    };
    run.tasks[0].dispatch.capabilityGrants.push(grant);
    run.tasks[0].effectiveCapabilityGrants.push(structuredClone(grant));
    run.tasks[0].capabilityEvents.push({
      ordinal: 3,
      action: "use",
      capabilityClass: "irreversible",
      actorRole: "implementer",
      operationId: "delete-001",
    });
  }],
  ["unbounded-task", (run) => {
    run.tasks[0].dispatch.budgets.tokens = 0;
    run.tasks[0].effectiveBudgets.tokens = 0;
  }],
  ["budget-raised-under-pressure", (run) => {
    run.tasks[0].effectiveBudgets.tokens = 101;
  }],
  ["unrecorded-consumption", (run) => {
    delete run.tasks[0].return.consumption.contextTokens;
  }],
  ["fix-without-witness", (run) => {
    run.tasks[0].kind = "bug-fix";
  }],
  ["unproven-property", (run) => {
    run.tasks[0].return.propertyResults = [];
  }],
  ["evidence-without-run", (run) => {
    run.evidenceReferences[0].checkRunId = "unrelated-check-run";
  }],
  ["unresumable-run", (run) => {
    run.persistence.persistedTransitionRefs = [];
  }],
  ["assumed-operator-decision", (run) => {
    run.humanGateEvents.push({
      id: "gate-001",
      taskId: "1",
      trigger: "scope-change",
      resolution: "approved",
    });
  }],
];

test("table-driven negative fixtures raise every exact execution finding", async (t) => {
  const covered = new Set();
  for (const [findingType, mutate] of FINDING_CASES) {
    await t.test(findingType, () => {
      const run = validRun();
      mutate(run);
      const result = validateExecutionRun(deepFreeze(run));
      const matches = result.findings.filter((finding) =>
        finding.findingType === findingType);
      assert.ok(matches.length > 0, `${findingType} was not raised`);
      for (const finding of matches) {
        assert.equal(finding.severity, EXECUTION_FINDING_SEVERITIES[findingType]);
        assert.ok(PINNED_EXECUTION_RULE_CATALOG[finding.guidelineAnchor]);
        assert.deepEqual(Object.keys(finding), [
          "findingType",
          "severity",
          "guidelineAnchor",
          "artifactReference",
          "evidenceExcerpt",
          "remediation",
        ]);
        assert.ok(finding.evidenceExcerpt.includes(
          PINNED_EXECUTION_RULE_CATALOG[finding.guidelineAnchor],
        ));
      }
      assert.equal(result.findingCounts[findingType], matches.length);
      assert.equal(result.runtimeReady, false);
      covered.add(findingType);
    });
  }
  assert.deepEqual([...covered], EXECUTION_FINDING_TYPES);
});

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
