import { readFileSync } from "node:fs";

const GUIDELINE_BASELINE = JSON.parse(readFileSync(
  new URL(
    "../../docs/schemas/agentic-sdlc-guideline-baseline.v1.json",
    import.meta.url,
  ),
  "utf8",
));
const RULE_BINDINGS = deepFreeze(
  structuredClone(GUIDELINE_BASELINE.executionFindingRuleBindings),
);

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
  const namedCheck = "node --test __tests__/feature.test.mjs";
  const existingLane = "npm run check";
  const propertyCheck = "node --test __tests__/feature.property.test.mjs";
  const artifactRevision = "artifact-revision-001";
  const changedArtifacts = [
    "__tests__/feature.test.mjs",
    "src/feature.mjs",
  ];
  const budgets = {
    tokens: 100,
    iterations: 3,
    wallClockMs: 10_000,
    contextTokens: 2_000,
  };
  const grants = [
    {
      class: "local-write",
      intendedUse: "Write the feature and its automated test.",
      scope: [...changedArtifacts],
    },
    {
      class: "local-execute",
      intendedUse: "Run the named, property, and existing verification checks.",
      scope: [namedCheck, existingLane, propertyCheck],
    },
  ];
  const vcc = {
    conditionId: "VCC-1",
    criterionId: "AC-1",
    endState: "The feature preserves stable ordering.",
    statedCheck: namedCheck,
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
  const namedResult = {
    exitCode: 0,
    status: "passed",
    summary: "1 test passed",
    counts: resultCounts(1, 0),
    checkRunId: "check-run-001",
    artifactRevision,
  };
  const existingResult = {
    exitCode: 0,
    status: "passed",
    summary: "Existing verification lane passed",
    counts: resultCounts(1, 0),
    checkRunId: "existing-check-run-001",
    artifactRevision,
  };
  const consumption = {
    tokens: 20,
    iterations: 1,
    wallClockMs: 100,
    contextTokens: 200,
  };
  return {
    schema: "agentic-sdlc-run/v1",
    runId: "canonical-run-001",
    ruleBindings: structuredClone(RULE_BINDINGS),
    authoringBaseline: {
      status: "baselined",
      digest: "7b3f9003ea9aed2761469e71d4ac017726d1b34ea973dc875b0896d020b5341a",
      vccRevision: "derivation-001",
      openBlockerCount: 0,
      prdReference: "PRD-1",
      tadReference: "TAD-1",
      existingVerificationLane: existingLane,
      attestation: {
        authorityId: "acos-dev-authoring-v1",
        algorithm: "ed25519",
        signature: "Xw5buQVEDej5aQguGMtO6tNf7b8TtKwC7n9VmIWzeAx8BOZ36wzBx1asMuewhM180h+gw7VVRdV4VIHKS8xuAA==",
      },
    },
    guidelineBaseline: {
      authoring: {
        version: GUIDELINE_BASELINE.documents.find(
          ({ role }) => role === "authoring",
        ).version,
        revision: GUIDELINE_BASELINE.repository.revision,
        digest: GUIDELINE_BASELINE.documents.find(
          ({ role }) => role === "authoring",
        ).sha256,
      },
      execution: {
        version: GUIDELINE_BASELINE.documents.find(
          ({ role }) => role === "execution",
        ).version,
        revision: GUIDELINE_BASELINE.repository.revision,
        digest: GUIDELINE_BASELINE.documents.find(
          ({ role }) => role === "execution",
        ).sha256,
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
    vccs: [vcc],
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
      writeSet: [...changedArtifacts],
      observedChangedArtifacts: [...changedArtifacts],
      sizing: {
        withinSingleBudget: true,
        verifiableOutcomeCount: 1,
        coherentVccGroup: true,
      },
      lane: "authoring",
      namedCheck,
      existingVerificationLane: existingLane,
      propertyObligations: [{
        propertyId: "PROP-1",
        propertyClass: "invariant",
        iterations: 50,
        shrinking: true,
      }],
      capabilityGrants: structuredClone(grants),
      budgets: { ...budgets },
      circuitBreaker: {
        progressCheck: namedCheck,
        maxConsecutiveNoProgress: 2,
      },
      capabilityEvents: [
        capabilityEvent(1, "local-write", "src/feature.mjs", "write-src-001"),
        capabilityEvent(2, "local-write", "__tests__/feature.test.mjs",
          "write-test-001"),
        capabilityEvent(3, "local-execute", namedCheck, "check-run-001"),
        capabilityEvent(4, "local-execute", existingLane,
          "existing-check-run-001"),
        capabilityEvent(5, "local-execute", propertyCheck,
          "property-check-run-001"),
      ],
      budgetEvents: Object.entries(consumption).map(
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
      transition(1, "not-started", "queued", "orchestrator",
        "orchestrator:scheduler", artifactRevision),
      transition(2, "queued", "ready", "orchestrator",
        "orchestrator:scheduler", artifactRevision),
      transition(3, "ready", "in-progress", "orchestrator",
        "orchestrator:scheduler", artifactRevision),
      transition(4, "in-progress", "verified", "evaluator",
        "evaluator:deterministic-check", artifactRevision),
    ],
    dispatches: [{
      taskId: "1",
      taskText: "stable-ordering",
      subtasks: [],
      sourceVccs: [structuredClone(vcc)],
      criterionIds: ["AC-1"],
      capabilityGrants: structuredClone(grants),
      budgets: { ...budgets },
      circuitBreaker: {
        progressCheck: namedCheck,
        maxConsecutiveNoProgress: 2,
      },
      lane: "authoring",
      namedCheck,
      existingVerificationLane: existingLane,
      propertyObligations: [{
        propertyId: "PROP-1",
        propertyClass: "invariant",
        iterations: 50,
        shrinking: true,
      }],
      priorFindings: [],
      derivationRevision: "derivation-001",
    }],
    returns: [{
      taskId: "1",
      implementerMechanismId: "implementer:task-worker",
      implementerMechanismDigest: "b".repeat(64),
      namedCheck,
      checkRunId: "check-run-001",
      namedCheckResult: { ...namedResult },
      existingVerificationLane: existingLane,
      existingVerificationResult: { ...existingResult },
      changedArtifacts: [...changedArtifacts],
      constraintViolations: [],
      consumption: { ...consumption },
      artifactRevision,
      idempotencyKey: "task-1-attempt-1",
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
      propertyResults: [{
        propertyId: "PROP-1",
        propertyClass: "invariant",
        iterations: 50,
        shrinking: true,
        ran: true,
        passed: true,
        checkName: propertyCheck,
        checkRunId: "property-check-run-001",
        recordedResult: {
          exitCode: 0,
          status: "passed",
          summary: "50 generated property cases passed",
          counts: resultCounts(50, 0),
          checkRunId: "property-check-run-001",
          artifactRevision,
        },
        artifactRevision,
      }],
    }],
    evidence: [{
      evidenceId: "evidence-001",
      conditionId: "VCC-1",
      taskId: "1",
      checkName: namedCheck,
      checkRunId: "check-run-001",
      recordedResult: { ...namedResult },
      surface: "authoring",
      artifactRevision,
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
      storageReference: "ledger://canonical-run-001",
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
        signature: "51FKXYL5msrLjbst+jD42ozy+uLIban2ccNQVIBFePJnTodjuNlUHKXrHGqHmmNFLJ9sJSLB/pQWyz3Ktq60DA==",
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
    consumption: { ...consumption },
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
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
