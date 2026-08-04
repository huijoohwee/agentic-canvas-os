import { readFileSync } from "node:fs";

const BASELINE_MANIFEST = JSON.parse(readFileSync(
  new URL(
    "../../docs/schemas/agentic-sdlc-guideline-baseline.v1.json",
    import.meta.url,
  ),
  "utf8",
));
export const RUN_SCHEMA = JSON.parse(readFileSync(
  new URL(
    "../../docs/schemas/agentic-sdlc-run.v1.schema.json",
    import.meta.url,
  ),
  "utf8",
));
export const RULE_BINDINGS = BASELINE_MANIFEST.executionFindingRuleBindings;
const AUTHORING_SOURCE = BASELINE_MANIFEST.documents.find(
  ({ role }) => role === "authoring",
);
const EXECUTION_SOURCE = BASELINE_MANIFEST.documents.find(
  ({ role }) => role === "execution",
);
const NAMED_CHECK = "node --test __tests__/feature.test.mjs";
const EXISTING_LANE = "npm run check";
const PROPERTY_CHECK = "node --test __tests__/feature.property.test.mjs";
const ARTIFACT_REVISION = "artifact-revision-001";
const CHANGED_ARTIFACTS = [
  "__tests__/feature.test.mjs",
  "src/feature.mjs",
];
const BUDGETS = {
  tokens: 100,
  iterations: 3,
  wallClockMs: 10_000,
  contextTokens: 2_000,
};
const CONSUMPTION = {
  tokens: 20,
  iterations: 1,
  wallClockMs: 100,
  contextTokens: 200,
};
const GRANTS = [
  {
    class: "local-write",
    intendedUse: "Write the feature and its automated test.",
    scope: [...CHANGED_ARTIFACTS],
  },
  {
    class: "local-execute",
    intendedUse: "Run the named, property, and existing verification checks.",
    scope: [NAMED_CHECK, EXISTING_LANE, PROPERTY_CHECK],
  },
];
const VCC = {
  conditionId: "VCC-1",
  criterionId: "AC-1",
  endState: "The feature preserves stable ordering.",
  statedCheck: NAMED_CHECK,
  constraint: "Every generated case preserves the invariant.",
  behaviorClaims: ["stable-ordering"],
  correctnessProperties: [{
    propertyId: "PROP-1",
    propertyClass: "invariant",
    statement: "Generated cases preserve stable ordering.",
    iterations: 50,
    shrinking: true,
  }],
};
const PROPERTY_OBLIGATION = {
  propertyId: "PROP-1",
  propertyClass: "invariant",
  iterations: 50,
  shrinking: true,
};
const PROPERTY_RESULT = {
  propertyId: "PROP-1",
  propertyClass: "invariant",
  iterations: 50,
  shrinking: true,
  ran: true,
  passed: true,
  checkName: PROPERTY_CHECK,
  checkRunId: "property-check-run-001",
  recordedResult: {
    exitCode: 0,
    status: "passed",
    summary: "50 generated property cases passed",
    counts: resultCounts(50, 0),
    checkRunId: "property-check-run-001",
    artifactRevision: ARTIFACT_REVISION,
  },
  artifactRevision: ARTIFACT_REVISION,
};

function guidelineLoadEvents() {
  const always = ["scope--neutrality-contract", "module-index"];
  return [
    loadEvent("authoring", "phase-4", null, 4, [
      "conformance-findings", "readiness-ladder", ...always,
    ]),
    loadEvent("execution", "run-start", null, 5, [
      "boundary-with-the-authoring-set", "agent-roles--independence",
      "specification-to-task-bridge", ...always,
    ]),
    loadEvent("execution", "task-derivation", null, 4, [
      "specification-to-task-bridge", "task-model", ...always,
    ]),
    loadEvent("execution", "dispatch", "1", 6, [
      "task-model", "execution-contract", "tool-permission--blast-radius",
      "per-task-budgets", ...always,
    ]),
    loadEvent("execution", "implementation", "1", 5, [
      "execution-contract", "verification-strategy",
      "tool-permission--blast-radius", ...always,
    ]),
    loadEvent("execution", "verification", "1", 4, [
      "verification-strategy", "execution-conformance-findings", ...always,
    ]),
  ];
}

function loadEvent(guideline, stage, subjectId, tokens, loadedSectionAnchors) {
  return {
    eventId: `${guideline}:${stage}:${subjectId ?? "run"}`,
    guideline,
    stage,
    subjectId,
    tokens,
    loadedSectionAnchors,
  };
}

export function canonicalRun() {
  const namedResult = {
    exitCode: 0,
    status: "passed",
    summary: "1 test passed",
    counts: resultCounts(1, 0),
    checkRunId: "check-run-001",
    artifactRevision: ARTIFACT_REVISION,
  };
  const existingResult = {
    exitCode: 0,
    status: "passed",
    summary: "Existing verification lane passed",
    counts: resultCounts(1, 0),
    checkRunId: "existing-check-run-001",
    artifactRevision: ARTIFACT_REVISION,
  };
  return {
    schema: "agentic-sdlc-run/v1",
    runId: "adversarial-run-001",
    ruleBindings: structuredClone(RULE_BINDINGS),
    authoringBaseline: {
      status: "baselined",
      digest: "7b3f9003ea9aed2761469e71d4ac017726d1b34ea973dc875b0896d020b5341a",
      vccRevision: "derivation-001",
      openBlockerCount: 0,
      prdReference: "PRD-1",
      tadReference: "TAD-1",
      existingVerificationLane: EXISTING_LANE,
      attestation: {
        authorityId: "acos-dev-authoring-v1",
        algorithm: "ed25519",
        signature: "Xw5buQVEDej5aQguGMtO6tNf7b8TtKwC7n9VmIWzeAx8BOZ36wzBx1asMuewhM180h+gw7VVRdV4VIHKS8xuAA==",
      },
    },
    guidelineBaseline: {
      authoring: {
        version: AUTHORING_SOURCE.version,
        revision: BASELINE_MANIFEST.repository.revision,
        digest: AUTHORING_SOURCE.sha256,
      },
      execution: {
        version: EXECUTION_SOURCE.version,
        revision: BASELINE_MANIFEST.repository.revision,
        digest: EXECUTION_SOURCE.sha256,
      },
    },
    derivationRevision: "derivation-001",
    evaluator: {
      mechanismId: "evaluator:deterministic-check",
      mechanismType: "deterministic-check",
      mechanismDigest: "a".repeat(64),
      implementerMechanismId: "implementer:task-worker",
      implementerMechanismDigest: "b".repeat(64),
    },
    specTokenEstimate: 1_000,
    deployBoundary: {
      lane: "authoring",
      state: "closed",
      operatorInstructionReference: null,
    },
    vccs: [structuredClone(VCC)],
    tasks: [{
      taskId: "1",
      text: "stable-ordering",
      kind: "feature",
      codeBearing: true,
      behaviorKinds: ["ordering"],
      behaviorClaims: ["stable-ordering"],
      subtasks: [],
      vccIds: ["VCC-1"],
      criterionIds: ["AC-1"],
      dependencyIds: [],
      waveId: "1",
      writeSet: [...CHANGED_ARTIFACTS],
      observedChangedArtifacts: [...CHANGED_ARTIFACTS],
      sizing: {
        withinSingleBudget: true,
        verifiableOutcomeCount: 1,
        coherentVccGroup: true,
      },
      lane: "authoring",
      namedCheck: NAMED_CHECK,
      existingVerificationLane: EXISTING_LANE,
      propertyObligations: [structuredClone(PROPERTY_OBLIGATION)],
      capabilityGrants: structuredClone(GRANTS),
      budgets: { ...BUDGETS },
      circuitBreaker: {
        progressCheck: NAMED_CHECK,
        maxConsecutiveNoProgress: 2,
      },
      capabilityEvents: [
        capabilityEvent(1, "local-write", "src/feature.mjs", "write-src-001"),
        capabilityEvent(2, "local-write", "__tests__/feature.test.mjs",
          "write-test-001"),
        capabilityEvent(3, "local-execute", NAMED_CHECK, "check-run-001"),
        capabilityEvent(4, "local-execute", EXISTING_LANE,
          "existing-check-run-001"),
        capabilityEvent(5, "local-execute", PROPERTY_CHECK,
          "property-check-run-001"),
      ],
      budgetEvents: Object.entries(CONSUMPTION).map(
        ([field, value], index) => ({
          ordinal: index + 1,
          action: "consume",
          field,
          value,
          reason: null,
          operatorDecisionReference: null,
        }),
      ),
      verdict: {
        role: "evaluator",
        mechanismId: "evaluator:deterministic-check",
        evaluatedFromSurfacedOutput: true,
        modifiedArtifacts: false,
      },
      state: "verified",
    }],
    transitions: [
      transition(1, "not-started", "queued", "orchestrator"),
      transition(2, "queued", "ready", "orchestrator"),
      transition(3, "ready", "in-progress", "orchestrator"),
      transition(4, "in-progress", "verified", "evaluator"),
    ],
    dispatches: [{
      taskId: "1",
      taskText: "stable-ordering",
      subtasks: [],
      sourceVccs: [structuredClone(VCC)],
      criterionIds: ["AC-1"],
      capabilityGrants: structuredClone(GRANTS),
      budgets: { ...BUDGETS },
      circuitBreaker: {
        progressCheck: NAMED_CHECK,
        maxConsecutiveNoProgress: 2,
      },
      lane: "authoring",
      namedCheck: NAMED_CHECK,
      existingVerificationLane: EXISTING_LANE,
      propertyObligations: [structuredClone(PROPERTY_OBLIGATION)],
      priorFindings: [],
      derivationRevision: "derivation-001",
    }],
    returns: [{
      taskId: "1",
      implementerMechanismId: "implementer:task-worker",
      implementerMechanismDigest: "b".repeat(64),
      namedCheck: NAMED_CHECK,
      checkRunId: "check-run-001",
      namedCheckResult: { ...namedResult },
      existingVerificationLane: EXISTING_LANE,
      existingVerificationResult: { ...existingResult },
      changedArtifacts: [...CHANGED_ARTIFACTS],
      constraintViolations: [],
      consumption: { ...CONSUMPTION },
      automatedTests: {
        addedOrExtended: true,
        artifacts: ["__tests__/feature.test.mjs"],
      },
      attempts: [{
        iteration: 1,
        progress: true,
        idempotencyKey: "task-1-attempt-1",
        approachId: "implement-stable-ordering",
        diagnosis: null,
        appliedEffectIds: ["write-src-001", "write-test-001"],
        replayedEffectIds: [],
      }],
      failingFirstWitness: null,
      propertyResults: [structuredClone(PROPERTY_RESULT)],
      artifactRevision: ARTIFACT_REVISION,
      idempotencyKey: "task-1-attempt-1",
    }],
    evidence: [{
      evidenceId: "evidence-001",
      conditionId: "VCC-1",
      taskId: "1",
      checkName: NAMED_CHECK,
      checkRunId: "check-run-001",
      recordedResult: { ...namedResult },
      surface: "authoring",
      artifactRevision: ARTIFACT_REVISION,
    }],
    persistedTerminals: [{
      taskId: "1",
      state: "verified",
      transitionOrdinal: 4,
      ledgerRevision: "ledger-revision-001",
      checkpointDigest: "d".repeat(64),
      partialState: null,
    }],
    persistence: {
      outsideWorkingContext: true,
      storageReference: "ledger://adversarial-run-001",
      reconstructable: true,
      checkpointDigest: "d".repeat(64),
      writerMechanismId: "orchestrator:persistence-writer",
      writerMechanismDigest: "c".repeat(64),
      readerMechanismId: "evaluator:reconstruction-reader",
      readerMechanismDigest: "e".repeat(64),
      reconstructionCheck: {
        checkRunId: "reconstruction-check-001",
        status: "passed",
        exitCode: 0,
        summary: "Checkpoint reconstructed from external storage.",
        counts: resultCounts(1, 0),
        artifactRevision: "d".repeat(64),
      },
      attestation: {
        authorityId: "acos-dev-persistence-v1",
        algorithm: "ed25519",
        signature: "/ApIdMAfQ58sIN7/k13uHTr4P0fzF8kz3NhDJOG1umkN5qUVrAQ4TB2Bfo+1GOWDZC/Qb06RFxaPtert+hD4BQ==",
      },
      persistedTransitionRefs: ["1:4"],
      persistedComponents: [
        "task-states",
        "transitions",
        "evidence-references",
        "findings",
        "budget-consumption",
      ],
      redispatchedVerifiedTaskIds: [],
    },
    recoveryEvents: [],
    humanGateEvents: [],
    outboundTransmissions: [],
    priorTasks: [],
    priorFindings: [],
    consumption: { ...CONSUMPTION },
    guidelineLoadCost: {
      events: guidelineLoadEvents(),
    },
    operatorDecisions: [],
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

function capabilityEvent(ordinal, capabilityClass, artifact, operationId = null) {
  return {
    ordinal,
    action: "use",
    capabilityClass,
    actorRole: "implementer",
    artifact,
    operationId,
    operatorDecisionReference: null,
  };
}

export function transition(ordinal, from, to, role) {
  return {
    taskId: "1",
    ordinal,
    sequence: ordinal,
    from,
    to,
    role,
    mechanismId: role === "evaluator"
      ? "evaluator:deterministic-check"
      : "orchestrator:scheduler",
    reason: null,
    operatorDecisionReference: null,
    artifactRevision: ARTIFACT_REVISION,
  };
}

export function addPrematureDependentTask(run) {
  const secondPaths = [
    "__tests__/second.test.mjs",
    "src/second.mjs",
  ];
  const secondVcc = structuredClone(VCC);
  secondVcc.conditionId = "VCC-2";
  secondVcc.criterionId = "AC-2";
  secondVcc.correctnessProperties[0].propertyId = "PROP-2";
  run.vccs.push(secondVcc);

  const secondTask = structuredClone(run.tasks[0]);
  Object.assign(secondTask, {
    taskId: "2",
    text: "Implement the dependent outcome.",
    vccIds: ["VCC-2"],
    criterionIds: ["AC-2"],
    dependencyIds: ["1"],
    waveId: "2",
    writeSet: secondPaths,
    observedChangedArtifacts: secondPaths,
  });
  secondTask.propertyObligations[0].propertyId = "PROP-2";
  secondTask.capabilityGrants[0].scope = secondPaths;
  secondTask.capabilityEvents[0].artifact = "src/second.mjs";
  secondTask.capabilityEvents[0].operationId = "write-src-002";
  secondTask.capabilityEvents[1].artifact = "__tests__/second.test.mjs";
  secondTask.capabilityEvents[1].operationId = "write-test-002";
  secondTask.capabilityEvents[2].operationId = "check-run-002";
  secondTask.capabilityEvents[3].operationId = "existing-check-run-002";
  secondTask.capabilityEvents[4].operationId = "property-check-run-002";
  run.tasks.push(secondTask);

  const secondDispatch = structuredClone(run.dispatches[0]);
  Object.assign(secondDispatch, {
    taskId: "2",
    taskText: secondTask.text,
    sourceVccs: [structuredClone(secondVcc)],
    criterionIds: ["AC-2"],
  });
  secondDispatch.propertyObligations[0].propertyId = "PROP-2";
  secondDispatch.capabilityGrants[0].scope = secondPaths;
  run.dispatches.push(secondDispatch);

  const secondReturn = structuredClone(run.returns[0]);
  Object.assign(secondReturn, {
    taskId: "2",
    checkRunId: "check-run-002",
    changedArtifacts: secondPaths,
    idempotencyKey: "task-2-attempt-1",
  });
  secondReturn.namedCheckResult.checkRunId = "check-run-002";
  secondReturn.existingVerificationResult.checkRunId =
    "existing-check-run-002";
  secondReturn.automatedTests.artifacts = ["__tests__/second.test.mjs"];
  secondReturn.attempts[0].idempotencyKey = "task-2-attempt-1";
  secondReturn.attempts[0].appliedEffectIds = [
    "write-src-002",
    "write-test-002",
  ];
  secondReturn.propertyResults[0].propertyId = "PROP-2";
  secondReturn.propertyResults[0].checkRunId = "property-check-run-002";
  secondReturn.propertyResults[0].recordedResult.checkRunId =
    "property-check-run-002";
  run.returns.push(secondReturn);

  const firstTransitions = run.transitions;
  [1, 2, 3, 7].forEach((sequence, index) => {
    firstTransitions[index].sequence = sequence;
  });
  const secondTransitions = firstTransitions.map((item, index) => ({
    ...structuredClone(item),
    taskId: "2",
    sequence: [4, 5, 6, 8][index],
  }));
  run.transitions = [...firstTransitions, ...secondTransitions]
    .sort((left, right) => left.sequence - right.sequence);

  const secondEvidence = structuredClone(run.evidence[0]);
  Object.assign(secondEvidence, {
    evidenceId: "evidence-002",
    conditionId: "VCC-2",
    taskId: "2",
    checkRunId: "check-run-002",
    recordedResult: structuredClone(secondReturn.namedCheckResult),
  });
  run.evidence.push(secondEvidence);
  run.persistedTerminals.push({
    ...structuredClone(run.persistedTerminals[0]),
    taskId: "2",
  });
  run.persistence.persistedTransitionRefs.push("2:4");
  for (const field of Object.keys(run.consumption)) {
    run.consumption[field] *= 2;
  }
}
