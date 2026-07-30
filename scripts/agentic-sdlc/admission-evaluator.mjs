import {
  ADMISSION_ENFORCED_STAGES,
  ADMISSION_RECEIPT_SCHEMA,
  ADMISSION_STAGE_EVIDENCE_SCHEMA,
  ADMISSION_UNEVALUATED_STAGES,
  digestAdmissionValue,
  normalizeAdmissionEvidence,
} from "./admission-evidence.mjs";
import { evaluateAdmissionDomain } from "./admission-domain.mjs";
import {
  ADMISSION_FINDING_TYPES,
  admissionFindingRuleId,
  admissionFindingSeverity,
  compareAdmissionFindings,
  createAdmissionFindingCollector,
} from "./admission-findings.mjs";
import {
  assertAdmissionStageReceiptSchema,
  inspectAdmissionEvidenceSchema,
} from "./admission-schema-validation.mjs";
import {
  array,
  deepFreeze,
  object,
  sameStableValue,
  text,
} from "./normalize.mjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export function evaluateAdmissionEvidence(input, identities) {
  assertAdmissionIdentities(input, identities);
  const collector = createAdmissionFindingCollector();
  const rawSchemaInspection = inspectAdmissionEvidenceSchema(input);
  const normalized = normalizeAdmissionEvidence(input);
  const normalizedSchemaInspection =
    inspectAdmissionEvidenceSchema(normalized);
  if (!rawSchemaInspection.valid || !normalizedSchemaInspection.valid) {
    collector.add("runtime-readiness-unproven", {
      artifactReference: "admission-input-schema",
      evidenceExcerpt: [...new Set([
        ...rawSchemaInspection.errors,
        ...normalizedSchemaInspection.errors,
      ])].sort().join("; "),
    });
  }

  const evaluation = evaluateAdmissionDomain(normalized, collector);
  const findingResult = collector.finalize();
  const stageEvidence = createStageEvidence(normalized, evaluation);
  const inputEvidenceDigest = digestAdmissionValue(normalized);
  const findingSetDigest = digestAdmissionValue({
    findingCounts: findingResult.findingCounts,
    findings: findingResult.findings,
  });
  const stageEvidenceDigest = digestAdmissionValue(stageEvidence);
  const ready = findingResult.findings.length === 0;
  const body = {
    schema: ADMISSION_RECEIPT_SCHEMA,
    runId: text(normalized.runId),
    stage: "admission",
    verdict: ready ? "verified" : "blocked",
    ready,
    policyRevision: identities.policy.revision,
    policyDigest: identities.policy.digest,
    evaluatorRevision: identities.evaluator.revision,
    evaluatorDigest: identities.evaluator.digest,
    schemaRevision: identities.schema.revision,
    schemaDigest: identities.schema.digest,
    sourceRevision: normalized.sourceIdentity.revision,
    dependencyClosureDigest:
      normalized.sourceIdentity.dependencyClosureDigest,
    inputEvidenceDigest,
    predecessorReceiptDigest: "not-applicable",
    findingCounts: findingResult.findingCounts,
    findings: findingResult.findings,
    findingSetDigest,
    stageEvidence,
    stageEvidenceDigest,
    enforcedStages: ADMISSION_ENFORCED_STAGES,
    unevaluatedStages: ADMISSION_UNEVALUATED_STAGES,
  };
  const receipt = deepFreeze({
    ...body,
    receiptDigest: digestAdmissionValue(body),
  });
  assertAdmissionStageReceiptSchema(receipt);
  if (!verifyAdmissionStageReceipt(
    receipt,
    identities,
    normalized.sourceIdentity,
  )) {
    throw new TypeError("Admission receipt failed deterministic self-verification.");
  }
  return receipt;
}

export function verifyAdmissionStageReceipt(
  receipt,
  identities,
  sourceIdentity,
) {
  try {
    assertAdmissionStageReceiptSchema(receipt);
  } catch {
    return false;
  }
  if (
    !identities?.policy
    || !identities?.evaluator
    || !identities?.schema
    || !sourceIdentity
    || receipt.policyRevision !== identities.policy.revision
    || receipt.policyDigest !== identities.policy.digest
    || receipt.evaluatorRevision !== identities.evaluator.revision
    || receipt.evaluatorDigest !== identities.evaluator.digest
    || receipt.schemaRevision !== identities.schema.revision
    || receipt.schemaDigest !== identities.schema.digest
    || receipt.sourceRevision !== sourceIdentity.revision
    || receipt.dependencyClosureDigest
      !== sourceIdentity.dependencyClosureDigest
    || receipt.ready !== (receipt.verdict === "verified")
    || receipt.ready !== (receipt.findings.length === 0)
    || !sameStableValue(receipt.enforcedStages, ADMISSION_ENFORCED_STAGES)
    || !sameStableValue(
      receipt.unevaluatedStages,
      ADMISSION_UNEVALUATED_STAGES,
    )
    || receipt.dependencyClosureDigest
      !== receipt.stageEvidence.dependencyAdmissionDigest
    || receipt.stageEvidence.coverage.covered
      > receipt.stageEvidence.coverage.total
    || (
      receipt.ready
      && (
        receipt.stageEvidence.inventoryComplete !== true
        || receipt.stageEvidence.coverage.total < 1
        || receipt.stageEvidence.coverage.covered
          !== receipt.stageEvidence.coverage.total
      )
    )
  ) return false;

  const ordered = [...receipt.findings].sort(compareAdmissionFindings);
  if (!sameStableValue(ordered, receipt.findings)) return false;
  const counts = Object.fromEntries(
    ADMISSION_FINDING_TYPES.map((findingType) => [findingType, 0]),
  );
  for (const finding of receipt.findings) {
    if (
      !ADMISSION_FINDING_TYPES.includes(finding.findingType)
      || finding.severity !== admissionFindingSeverity(finding.findingType)
      || finding.guidelineAnchor
        !== admissionFindingRuleId(finding.findingType)
    ) return false;
    counts[finding.findingType] += 1;
  }
  if (!sameStableValue(counts, receipt.findingCounts)) return false;
  if (receipt.findingSetDigest !== digestAdmissionValue({
    findingCounts: receipt.findingCounts,
    findings: receipt.findings,
  })) return false;
  if (
    receipt.stageEvidenceDigest
    !== digestAdmissionValue(receipt.stageEvidence)
  ) return false;
  const { receiptDigest, ...body } = receipt;
  return receiptDigest === digestAdmissionValue(body);
}

function createStageEvidence(input, evaluation) {
  const evidence = object(input.admissionEvidence);
  const tasks = array(evidence.tasks).map(object);
  return deepFreeze({
    schema: ADMISSION_STAGE_EVIDENCE_SCHEMA,
    inventoryComplete: evidence.dependencies?.inventoryComplete === true,
    authoringBaselineDigest: evaluation.expectedBaselineDigest,
    taskPlanDigest: digestAdmissionValue({
      derivationRevision: evidence.derivationRevision,
      tasks,
    }),
    vccTaskClosureDigest: digestAdmissionValue({
      vccs: evidence.vccs,
      tasks: tasks.map(({ taskId, vccIds, criterionIds }) => ({
        taskId,
        vccIds,
        criterionIds,
      })),
    }),
    budgetDigest: digestAdmissionValue(
      tasks.map(({ taskId, budgets, circuitBreaker }) => ({
        taskId,
        budgets,
        circuitBreaker,
      })),
    ),
    capabilityGrantDigest: digestAdmissionValue(
      tasks.map(({ taskId, capabilityGrants }) => ({
        taskId,
        capabilityGrants,
      })),
    ),
    collaborationIdentityDigest:
      digestAdmissionValue(evidence.collaboration),
    dependencyAdmissionDigest: evaluation.dependencyAdmissionDigest,
    evaluatorDigest:
      digestAdmissionValue(evidence.executionMechanisms),
    namedChecksDigest: digestAdmissionValue(
      tasks.map(({ taskId, namedCheck, existingVerificationLane }) => ({
        taskId,
        namedCheck,
        existingVerificationLane,
      })),
    ),
    coverage: {
      covered: evaluation.coveredVccCount,
      total: evaluation.vccCount,
    },
  });
}

function assertAdmissionIdentities(input, identities) {
  for (const [field, code] of [
    ["policy", "AGENTIC_SDLC_POLICY_IDENTITY_UNAVAILABLE"],
    ["evaluator", "AGENTIC_SDLC_EVALUATOR_IDENTITY_UNAVAILABLE"],
    ["schema", "AGENTIC_SDLC_SCHEMA_IDENTITY_UNAVAILABLE"],
  ]) {
    const supplied = input?.[`${field}Identity`];
    const expected = identities?.[field];
    if (!expected || !sameStableValue(supplied, expected)) {
      const error = new Error(
        `Admission ${field} identity does not match the immutable repository-owned closure.`,
      );
      error.code = code;
      throw error;
    }
  }
  const source = input?.sourceIdentity;
  const sourceEnvelope = {
    repository: text(source?.repository),
    revision: text(source?.revision),
    tree: text(source?.tree),
  };
  if (
    !source
    || source.repository !== sourceEnvelope.repository
    || source.revision !== sourceEnvelope.revision
    || source.tree !== sourceEnvelope.tree
    || !REPOSITORY_PATTERN.test(sourceEnvelope.repository)
    || !SHA_PATTERN.test(sourceEnvelope.revision)
    || !SHA_PATTERN.test(sourceEnvelope.tree)
    || !DIGEST_PATTERN.test(text(source.sourceDigest))
    || !DIGEST_PATTERN.test(text(source.dependencyClosureDigest))
    || source.sourceDigest !== text(source.sourceDigest)
    || source.dependencyClosureDigest
      !== text(source.dependencyClosureDigest)
    || source.sourceDigest !== digestAdmissionValue(sourceEnvelope)
  ) {
    const error = new Error(
      "Admission source and dependency identities are unavailable.",
    );
    error.code = "AGENTIC_SDLC_SOURCE_IDENTITY_UNAVAILABLE";
    throw error;
  }
}

export {
  ADMISSION_ENFORCED_STAGES,
  ADMISSION_FINDING_TYPES,
  ADMISSION_UNEVALUATED_STAGES,
  normalizeAdmissionEvidence,
};
