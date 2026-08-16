import assert from "node:assert/strict";
import test from "node:test";

import { validateCapabilitiesAndBudgets } from "../scripts/agentic-sdlc/capability-budget.mjs";
import { validateRecoveryAndOperator } from "../scripts/agentic-sdlc/recovery-operator.mjs";
import { inspectTaskTransitions } from "../scripts/agentic-sdlc/state-machine.mjs";
import { validateTaskPlan } from "../scripts/agentic-sdlc/task-plan.mjs";
import { validateTaskReturns } from "../scripts/agentic-sdlc/verification.mjs";

test("a source VCC bound caps the matching task budget", () => {
  const findings = [];
  validateCapabilitiesAndBudgets({
    tasks: [{
      id: "1",
      state: "verified",
      dispatch: {
        namedCheck: "node --test",
        capabilityGrants: [],
        sourceVccs: [{
          id: "VCC-1",
          bound: { field: "iterations", maximum: 2 },
        }],
        budgets: {
          tokens: 100,
          iterations: 3,
          wallClockMs: 1_000,
          contextTokens: 500,
        },
        circuitBreaker: {
          progressCheck: "node --test",
          maxConsecutiveNoProgress: 2,
        },
      },
      effectiveBudgets: {},
      capabilityEvents: [],
      budgetEvents: [
        budgetEvent(1, "tokens", 1),
        budgetEvent(2, "iterations", 1),
        budgetEvent(3, "wallClockMs", 1),
        budgetEvent(4, "contextTokens", 1),
      ],
      return: {
        attempts: [{
          iteration: 1,
          progress: true,
          idempotencyKey: "attempt-1",
          approachId: "bounded-approach",
          diagnosis: null,
          appliedEffectIds: [],
          replayedEffectIds: [],
        }],
        idempotencyKey: "attempt-1",
        consumption: {
          tokens: 1,
          iterations: 1,
          wallClockMs: 1,
          contextTokens: 1,
        },
      },
    }],
    collector: collector(findings),
    decisionById: new Map(),
    irreversibleDecisionRefs: new Set(),
  });
  assert.ok(findings.some((finding) =>
    finding.findingType === "unbounded-task"
    && finding.artifactReference === "vcc-bound:VCC-1"));
});

test("duplicate source property identities cannot be collapsed", () => {
  const findings = [];
  validateTaskReturns({
    tasks: [{
      id: "1",
      kind: "documentation",
      codeBearing: false,
      state: "failed",
      behaviorKinds: [],
      sourceVccIds: ["VCC-1"],
      observedChangedArtifacts: [],
      dispatch: {
        namedCheck: "node --test",
        propertyObligations: [{
          id: "PROP-1",
          class: "invariant",
          minimumIterations: 2,
          shrinkingRequired: true,
        }],
        budgets: {
          tokens: 10,
          iterations: 2,
          wallClockMs: 100,
          contextTokens: 100,
        },
      },
      return: validFailedReturn(),
    }],
    collector: collector(findings),
    vccById: new Map([["VCC-1", {
      correctnessProperties: [
        { id: "PROP-1", class: "invariant", statement: "First." },
        { id: "PROP-1", class: "metamorphic", statement: "Second." },
      ],
    }]]),
  });
  assert.ok(findings.some((finding) =>
    finding.findingType === "unproven-property"
      && finding.artifactReference === "property-record-accounting"));
});

test("documentation tasks must prove a predeclared artifact", () => {
  const findings = [];
  const taskReturn = validFailedReturn();
  taskReturn.propertyResults = [];
  validateTaskReturns({
    tasks: [{
      id: "1",
      kind: "documentation",
      codeBearing: false,
      state: "failed",
      behaviorKinds: [],
      sourceVccIds: [],
      declaredWriteSet: [],
      observedChangedArtifacts: [],
      dispatch: {
        namedCheck: "node --test",
        propertyObligations: [],
        budgets: {
          tokens: 10,
          iterations: 2,
          wallClockMs: 100,
          contextTokens: 100,
        },
      },
      return: taskReturn,
    }],
    collector: collector(findings),
    vccById: new Map(),
  });
  assert.ok(findings.some((finding) =>
    finding.findingType === "unsurfaced-result"
    && finding.artifactReference === "documentation-artifact"));
});

test("contradictory duplicate Operator decisions fail the gate", () => {
  const findings = [];
  const decisions = [
    operatorDecision(false),
    operatorDecision(true),
  ];
  const result = validateRecoveryAndOperator({
    run: {
      persistence: {
        outsideWorkingContext: true,
        reconstructable: true,
        storageReference: "ledger://run",
        checkpointDigest: "d".repeat(64),
        persistedTransitionRefs: [],
        persistedComponents: [
          "task-states",
          "transitions",
          "evidence-references",
          "findings",
          "budget-consumption",
        ],
        redispatchedVerifiedTaskIds: [],
      },
      persistedTerminals: [],
      recoveryEvents: [],
      humanGateEvents: [{
        id: "gate-1",
        taskId: "1",
        trigger: "scope-change",
        resolution: "approved",
        decisionRef: "decision-1",
      }],
      operatorDecisions: decisions,
    },
    tasks: [],
    taskById: new Map(),
    decisionById: new Map(decisions.map((item) => [item.id, item])),
    collector: collector(findings),
  });
  assert.equal(result.humanGatesClosed, false);
  assert.ok(findings.some((finding) =>
    finding.findingType === "assumed-operator-decision"));
});

test("ordinary transitions cannot claim re-derivation metadata", () => {
  const task = {
    id: "1",
    state: "queued",
    transitions: [{
      ...edge(1, 1, "not-started", "queued"),
      rederived: true,
      derivationRevision: "derivation-001",
    }],
  };
  const result = inspectTaskTransitions(task);
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(({ kind }) => kind === "invalid-rederivation"));
});

test("dependency readiness uses the latest causal state after re-derivation", () => {
  const findings = [];
  const dependency = makeTask("1", [], [
    edge(1, 1, "not-started", "queued"),
    edge(2, 2, "queued", "ready"),
    edge(3, 3, "ready", "in-progress"),
    edge(4, 4, "in-progress", "verified", "evaluator"),
    {
      ...edge(5, 5, "verified", "not-started"),
      rederived: true,
      reason: "VCC changed.",
      derivationRevision: "derivation-002",
    },
    edge(6, 6, "not-started", "queued"),
    edge(7, 7, "queued", "ready"),
    edge(8, 8, "ready", "in-progress"),
    edge(9, 12, "in-progress", "verified", "evaluator"),
  ]);
  const dependent = makeTask("2", ["1"], [
    edge(1, 9, "not-started", "queued", "orchestrator", "2"),
    edge(2, 10, "queued", "ready", "orchestrator", "2"),
    edge(3, 11, "ready", "in-progress", "orchestrator", "2"),
    edge(4, 13, "in-progress", "verified", "evaluator", "2"),
  ]);
  const tasks = [dependency, dependent];

  validateTaskPlan({
    collector: { add: (findingType, details) =>
      findings.push({ findingType, ...details }) },
    evaluator: {},
    tasks,
    taskById: new Map(tasks.map((item) => [item.id, item])),
    vccs: [],
    vccById: new Map(),
    run: { derivation: { vccRevision: "derivation-002" }, priorTasks: [] },
  });

  assert.ok(findings.some((finding) =>
    finding.findingType === "state-without-reason"
    && finding.ruleId === "task-model#16"
      && finding.artifactReference === "10:1"));
});

test("contradictory prior task identities fail in every input order", () => {
  const priorTasks = [
    { id: "9", text: "Stable task text." },
    { id: "1", text: "Stable task text." },
  ];
  for (const candidate of [priorTasks, [...priorTasks].reverse()]) {
    const findings = [];
    const task = makeTask("1", [], [
      edge(1, 1, "not-started", "queued"),
    ]);
    task.text = "Stable task text.";
    task.state = "queued";
    validateTaskPlan({
      collector: collector(findings),
      evaluator: {},
      tasks: [task],
      taskById: new Map([["1", task]]),
      vccs: [],
      vccById: new Map(),
      run: {
        derivation: { vccRevision: "derivation-001" },
        priorTasks: candidate,
      },
    });
    assert.ok(findings.some((finding) =>
      finding.findingType === "oversized-task"
      && finding.ruleId === "task-model#1"));
  }
});

function makeTask(id, dependencies, transitions) {
  return {
    id,
    text: `Task ${id}`,
    dependencies,
    transitions,
    state: "verified",
    sourceVccIds: [],
    criterionIds: [],
    sizing: {
      withinSingleBudget: true,
      verifiableOutcomeCount: 1,
      coherentVccGroup: true,
    },
    dispatch: {},
    return: {},
    verdict: {},
  };
}

function edge(ordinal, sequence, from, to, role = "orchestrator", taskId = "1") {
  return {
    taskId,
    ordinal,
    sequence,
    from,
    to,
    role,
    mechanismId: role === "evaluator"
      ? "evaluator:deterministic-check"
      : "orchestrator:scheduler",
    reason: null,
    operatorDecisionRef: "",
    artifactRevision: "artifact-revision-001",
  };
}

function budgetEvent(ordinal, field, value) {
  return {
    ordinal,
    action: "consume",
    field,
    value,
    decisionRef: "",
  };
}

function collector(findings) {
  return {
    add: (findingType, details) =>
      findings.push({ findingType, ...details }),
  };
}

function validFailedReturn() {
  return {
    namedCheck: "node --test",
    implementerMechanismId: "implementer",
    implementerMechanismDigest: "implementer-digest",
    checkRunId: "check-1",
    checkResult: {
      ran: true,
      status: "failed",
      exitCode: 1,
      summary: "Expected failing result.",
      counts: resultCounts(0, 1),
      checkRunId: "check-1",
      artifactRevision: "revision-1",
    },
    existingVerificationLane: {
      ran: true,
      status: "failed",
      exitCode: 1,
      summary: "Expected failing lane.",
      counts: resultCounts(0, 1),
      name: "npm test",
      checkRunId: "lane-1",
      artifactRevision: "revision-1",
    },
    changedArtifacts: [],
    automatedTests: { addedOrExtended: false, artifacts: [] },
    constraintViolations: [],
    consumption: {
      tokens: 1,
      iterations: 1,
      wallClockMs: 1,
      contextTokens: 1,
    },
    attempts: [{
      iteration: 1,
      progress: true,
      idempotencyKey: "attempt-1",
      approachId: "expected-failure",
      diagnosis: null,
      appliedEffectIds: [],
      replayedEffectIds: [],
    }],
    failingFirstWitness: null,
    propertyResults: [{
      id: "PROP-1",
      class: "invariant",
      ran: true,
      passed: true,
      iterations: 2,
      shrinkingEnabled: true,
      checkName: "node --test property",
      checkRunId: "property-check-1",
      recordedResult: {
        ran: true,
        status: "passed",
        exitCode: 0,
        summary: "2 property cases passed",
        counts: resultCounts(2, 0),
        checkRunId: "property-check-1",
        artifactRevision: "revision-1",
      },
      artifactRevision: "revision-1",
    }],
    artifactRevision: "revision-1",
    idempotencyKey: "attempt-1",
  };
}

function resultCounts(passed, failed) {
  return {
    total: passed + failed,
    passed,
    failed,
    errored: 0,
    skipped: 0,
  };
}

function operatorDecision(approved) {
  return {
    id: "decision-1",
    role: "operator",
    explicit: true,
    approved,
    taskId: "1",
    occurrenceId: "gate-1",
    decision: approved ? "approve" : "refuse",
    options: ["approve", "refuse"],
    consequences: ["scope changes", "scope stays closed"],
  };
}
