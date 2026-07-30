import { canonicalRun } from "./agentic-sdlc-canonical-run.mjs";
import { evaluateUpstreamDependencies } from "../../agent-api/src/upstream-dependency-admission.js";
import {
  ADMISSION_OPERATION_PRODUCERS,
  __deriveAdmissionOperationContractsForTests,
  digestAdmissionValue,
  normalizeAdmissionEvidence,
} from "../../scripts/agentic-sdlc/admission-evidence.mjs";
import {
  compareText,
} from "../../scripts/agentic-sdlc/normalize.mjs";

const EVALUATION_TIME = "2026-07-30T00:00:00.000Z";
const EMPTY_DEPENDENCY_CLOSURE = Object.freeze({
  schema: "agentic-upstream-dependency-closure/v1",
  inventoryComplete: true,
  records: Object.freeze([]),
});

export const EMPTY_DEPENDENCY_CLOSURE_DIGEST =
  digestAdmissionValue(EMPTY_DEPENDENCY_CLOSURE);

export function canonicalAdmissionEvidence({
  identities,
  prepare,
  mutate,
} = {}) {
  if (!identities?.policy || !identities?.evaluator || !identities?.schema) {
    throw new TypeError("canonical admission evidence requires all identities");
  }
  const run = canonicalRun();
  const admissionEvidence = {
    authoringBaseline: structuredClone(run.authoringBaseline),
    specificationTokenEstimate: run.specTokenEstimate,
    derivationRevision: run.derivationRevision,
    executionMechanisms: {
      evaluator: {
        mechanismId: run.evaluator.mechanismId,
        mechanismType: run.evaluator.mechanismType,
        mechanismDigest: run.evaluator.mechanismDigest,
      },
      implementer: {
        mechanismId: run.evaluator.implementerMechanismId,
        mechanismType: "task-worker",
        mechanismDigest: run.evaluator.implementerMechanismDigest,
      },
    },
    vccs: structuredClone(run.vccs),
    tasks: run.tasks.map(preDispatchTask),
    collaboration: {
      actorId: "actor:implementer",
      deviceId: "device:local",
      sessionId: "session:admission",
      worktreeId: "worktree:admission",
      branchId: "agent/device/admission",
      scopeId: "scope:admission",
      leaseEpoch: 7,
      fenceRevision: "f".repeat(40),
      status: "active",
      expiresAt: "2026-07-30T01:00:00.000Z",
      declaredWriteScope: ["__tests__/**", "src/**"],
      inventoryComplete: true,
      peerWriters: [],
    },
    dependencies: {
      inventoryComplete: true,
      request: null,
    },
    deployBoundary: {
      lane: run.deployBoundary.lane,
      state: run.deployBoundary.state,
    },
  };
  const sourceIdentity = {
    repository: "huijoohwee/example-project",
    revision: "1".repeat(40),
    tree: "2".repeat(40),
    sourceDigest: digestAdmissionValue({
      repository: "huijoohwee/example-project",
      revision: "1".repeat(40),
      tree: "2".repeat(40),
    }),
    dependencyClosureDigest: EMPTY_DEPENDENCY_CLOSURE_DIGEST,
  };
  const draft = {
    schema: "agentic-sdlc-admission-evidence/v1",
    runId: "admission-run-001",
    requestedStage: "admission",
    evaluationTime: EVALUATION_TIME,
    policyIdentity: structuredClone(identities.policy),
    evaluatorIdentity: structuredClone(identities.evaluator),
    schemaIdentity: structuredClone(identities.schema),
    sourceIdentity,
    operations: [],
    predecessorReceipts: [],
    admissionEvidence,
  };
  if (typeof prepare === "function") prepare(draft);
  const normalized = structuredClone(normalizeAdmissionEvidence(draft));
  const dependencyAdmissionDigest = normalized.admissionEvidence
    .dependencies.request === null
    ? digestAdmissionValue({
      schema: "agentic-upstream-dependency-closure/v1",
      inventoryComplete:
        normalized.admissionEvidence.dependencies.inventoryComplete === true,
      records: [],
    })
    : evaluateUpstreamDependencies(
      normalized.admissionEvidence.dependencies.request,
    ).evidenceDigest;
  normalized.sourceIdentity.dependencyClosureDigest =
    dependencyAdmissionDigest;
  normalized.operations = admissionOperations(
    normalized.admissionEvidence,
    dependencyAdmissionDigest,
  );
  if (typeof mutate === "function") mutate(normalized);
  return normalized;
}

function preDispatchTask(task) {
  return {
    taskId: task.taskId,
    text: task.text,
    kind: task.kind,
    codeBearing: task.codeBearing,
    behaviorKinds: structuredClone(task.behaviorKinds),
    behaviorClaims: structuredClone(task.behaviorClaims),
    vccIds: structuredClone(task.vccIds),
    criterionIds: structuredClone(task.criterionIds),
    dependencyIds: structuredClone(task.dependencyIds),
    waveId: task.waveId,
    writeSet: structuredClone(task.writeSet),
    sizing: structuredClone(task.sizing),
    lane: task.lane,
    namedCheck: task.namedCheck,
    existingVerificationLane: task.existingVerificationLane,
    propertyObligations: structuredClone(task.propertyObligations),
    capabilityGrants: structuredClone(task.capabilityGrants).sort(
      (left, right) =>
        compareText(left.class, right.class)
        || compareText(left.intendedUse, right.intendedUse),
    ),
    budgets: structuredClone(task.budgets),
    circuitBreaker: structuredClone(task.circuitBreaker),
    state: "not-started",
  };
}

function admissionOperations(evidence, dependencyAdmissionDigest) {
  const contracts = __deriveAdmissionOperationContractsForTests(
    evidence,
    dependencyAdmissionDigest,
  );
  return [...contracts].map(([operationId, contract]) => {
    const producer = ADMISSION_OPERATION_PRODUCERS[operationId];
    const terminalResult = {
      ran: true,
      exitCode: 0,
      status: "passed",
      summary: `${operationId} evidence observed`,
      counts: {
        total: 1,
        passed: 1,
        failed: 0,
        errored: 0,
        skipped: 0,
      },
    };
    const evidenceReferences = structuredClone(contract.references);
    return {
      operationId,
      stage: "admission",
      mechanismId: producer.mechanismId,
      actorRole: producer.actorRole,
      inputDigest: contract.inputDigest,
      resultDigest: digestAdmissionValue({
        terminalResult,
        evidenceReferences,
      }),
      terminalResult,
      evidenceReferences,
    };
  });
}
