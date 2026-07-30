import { createHash } from "node:crypto";
import { compareLexicalText } from "./lexical-compare.mjs";
export const LIFECYCLE_STAGES = Object.freeze([
  "admission", "review", "integration", "runtime",
  "candidate", "authorization", "deployment", "publication",
]);
export const LIFECYCLE_FINDING_TYPES = Object.freeze([
  "runtime-readiness-unproven", "stale-collaboration-fence",
  "parallel-scope-collision", "unreviewed-release-candidate",
  "dependency-closure-drift", "authorization-evidence-unjoined",
  "authorization-interaction-unjoined", "duplicate-release-controller",
  "production-authorization-drift", "post-authorization-rebuild",
  "integration-order-cycle", "integration-before-dependency",
  "canonical-frontier-unverified", "duplicate-change-reintegrated",
  "stale-candidate-frontier", "assumed-operator-decision",
  "unproven-property", "evidence-without-run",
]);
export const LIFECYCLE_FINDING_SEVERITIES = Object.freeze(Object.fromEntries(
  LIFECYCLE_FINDING_TYPES.map((type) =>
    [type, ["duplicate-change-reintegrated", "unproven-property"].includes(type) ? "major" : "blocker"]),
));
const OPERATION_SCHEMA = "agentic-sdlc-lifecycle-operation/v1";
const RECEIPT_SCHEMA = "agentic-sdlc-stage-conformance/v1";
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;
const OPERATION_KEYS = ["schema", "stage", "policy", "subject", "checks", "predecessor", "predecessorDigest", "evidence"];
const POLICY_KEYS = ["repository", "revision", "digest", "guidelineVersion"];
const SUBJECT_KEYS = ["repository", "commit", "tree", "sourceDigest", "dependencyClosureDigest", "collaboration"];
const COLLABORATION_KEYS = ["actorId", "deviceId", "sessionId", "worktreeId", "branchId", "scopeId", "leaseEpoch", "fenceRevision"];
const CHECK_KEYS = ["sequence", "checkId", "subjectCommit", "commandDigest", "resultDigest", "status"];
const RECEIPT_KEYS = ["schema", "claimScope", "stage", "verdict", "ready", "policy", "subject", "evidenceDigest", "predecessorDigest", "findingCounts", "findings", "receiptDigest"];
const COLLABORATIVE_STAGES = new Set(["admission", "review", "integration"]);
const BOUNDARIES = Object.freeze({
  admission: "closed", review: "closed", integration: "closed", runtime: "closed",
  candidate: "closed", authorization: "human-authorized",
  deployment: "authorized", publication: "live-verified",
});
const EVIDENCE_KEYS = Object.freeze({
  admission: ["authoringBaselineDigest", "taskPlanDigest", "evaluatorDigest", "budgetDigest", "namedChecksDigest", "boundary"],
  review: ["predecessorReceiptDigest", "implementationDigest", "implementerDigest", "evaluatorDigest", "verificationDigest", "namedChecksDigest", "boundary"],
  integration: ["predecessorReceiptDigest", "predecessorCommit", "predecessorTree", "predecessorSourceDigest", "predecessorDependencyClosureDigest", "integrationTargetDigest", "overlapPreservationDigest", "overlapDispositionDigest", "namedChecksDigest", "boundary"],
  runtime: ["predecessorReceiptDigest", "sourceDigest", "dependencyClosureDigest", "runtimeDigest", "probesDigest", "namedChecksDigest", "boundary"],
  candidate: ["predecessorReceiptDigest", "sourceDigest", "dependencyClosureDigest", "policyDigest", "targetDigest", "artifactDigest", "manifestDigest", "rollbackTargetDigest", "namedChecksDigest", "boundary"],
  authorization: ["predecessorReceiptDigest", "predecessorEvidenceDigest", "targetDigest", "artifactDigest", "manifestDigest", "humanActorId", "decisionKind", "interactionDigest", "authorizationDigest", "authorityAdapterId", "namedChecksDigest", "boundary"],
  deployment: ["predecessorReceiptDigest", "predecessorEvidenceDigest", "candidateEvidenceDigest", "targetDigest", "artifactDigest", "manifestDigest", "authorizedActorId", "controllerId", "activeControllerId", "controllerLeaseDigest", "deployedArtifactDigest", "namedChecksDigest", "boundary"],
  publication: ["predecessorReceiptDigest", "predecessorEvidenceDigest", "candidateEvidenceDigest", "targetDigest", "deployedArtifactDigest", "controllerId", "observedRuntimeDigest", "probesDigest", "liveVerificationDigest", "publicationIdentitiesDigest", "namedChecksDigest", "liveStatus", "publicationStatus", "boundary"],
});
export function evaluateLifecycleStage(input) {
  return evaluate(input, 0, new WeakSet());
}
export function assertLifecycleStageReady(input) {
  const receipt = evaluateLifecycleStage(input);
  if (!receipt.ready) {
    const error = new Error(`Agentic SDLC ${receipt.stage} lifecycle stage is blocked.`);
    error.code = "AGENTIC_SDLC_LIFECYCLE_BLOCKED";
    error.receipt = receipt;
    throw error;
  }
  return receipt;
}
export function verifyLifecycleStageReceipt(receipt) {
  if (!exact(receipt, RECEIPT_KEYS) || receipt.schema !== RECEIPT_SCHEMA ||
      receipt.claimScope !== "lifecycle-stage" || !LIFECYCLE_STAGES.includes(receipt.stage) ||
      !["verified", "blocked"].includes(receipt.verdict) ||
      receipt.ready !== (receipt.verdict === "verified") ||
      !exact(receipt.findingCounts, LIFECYCLE_FINDING_TYPES) ||
      !Array.isArray(receipt.findings)) return false;
  const observedCounts = Object.fromEntries(
    LIFECYCLE_FINDING_TYPES.map((type) => [type, 0]),
  );
  for (const finding of receipt.findings) {
    if (!exact(finding, ["findingType", "severity", "stage", "artifactReference"]) ||
        !LIFECYCLE_FINDING_TYPES.includes(finding.findingType) ||
        finding.severity !== LIFECYCLE_FINDING_SEVERITIES[finding.findingType] ||
        finding.stage !== receipt.stage || !text(finding.artifactReference)) return false;
    observedCounts[finding.findingType] += 1;
  }
  if (!same(observedCounts, receipt.findingCounts) ||
      receipt.ready !== (receipt.findings.length === 0)) return false;
  const { receiptDigest, ...body } = receipt;
  return DIGEST.test(String(receiptDigest || "")) && receiptDigest === hash(body);
}
function evaluate(input, depth, active) {
  if (!LIFECYCLE_STAGES.includes(input?.stage)) throw new TypeError(`unsupported lifecycle stage: ${String(input?.stage || "")}`);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("lifecycle operation must be an object");
  if (depth >= LIFECYCLE_STAGES.length || active.has(input)) throw new TypeError("invalid lifecycle predecessor chain");
  active.add(input);
  try {
    const findings = [];
    const add = (findingType, artifactReference) => findings.push({ findingType, severity: LIFECYCLE_FINDING_SEVERITIES[findingType], stage: input.stage, artifactReference });
    if (!exact(input, OPERATION_KEYS) || input.schema !== OPERATION_SCHEMA) add("runtime-readiness-unproven", "operation");
    const policy = normalize(input.policy, POLICY_KEYS);
    const subject = normalizeSubject(input.subject);
    const checks = normalizeChecks(input.checks);
    const evidence = normalize(input.evidence, EVIDENCE_KEYS[input.stage], false);
    validatePolicy(input.policy, policy, add);
    validateSubject(input.stage, input.subject, subject, add);
    validateChecks(input.checks, checks, subject, add);
    validateEvidence(input.stage, input.evidence, evidence, checks, add);
    const previous = validatePredecessor(input, policy, subject, add, depth, active);
    validateStage(input.stage, evidence, policy, subject, previous, add);
    const predecessorDigest = input.stage === "admission" ? null : text(input.predecessorDigest);
    const evidenceDigest = hash({ schema: OPERATION_SCHEMA, stage: input.stage, policy, subject, checks, predecessorDigest, evidence });
    findings.sort((left, right) =>
      LIFECYCLE_FINDING_TYPES.indexOf(left.findingType) - LIFECYCLE_FINDING_TYPES.indexOf(right.findingType) ||
      compareLexicalText(left.artifactReference, right.artifactReference));
    const findingCounts = Object.fromEntries(LIFECYCLE_FINDING_TYPES.map((type) =>
      [type, findings.filter((finding) => finding.findingType === type).length]));
    const ready = findings.length === 0;
    const body = {
      schema: RECEIPT_SCHEMA, claimScope: "lifecycle-stage", stage: input.stage,
      verdict: ready ? "verified" : "blocked", ready, policy, subject,
      evidenceDigest, predecessorDigest, findingCounts, findings,
    };
    return freeze({ ...body, receiptDigest: hash(body) });
  } finally {
    active.delete(input);
  }
}
function validatePredecessor(input, policy, subject, add, depth, active) {
  if (input.stage === "admission") {
    if (input.predecessor !== null || input.predecessorDigest !== null) add("runtime-readiness-unproven", "predecessor");
    return null;
  }
  if (!exact(input.predecessor, ["operation", "receipt"])) {
    add("runtime-readiness-unproven", "predecessor");
    return null;
  }
  let receipt;
  try {
    receipt = evaluate(input.predecessor.operation, depth + 1, active);
  } catch {
    add("integration-before-dependency", "predecessor.operation");
    return null;
  }
  const expectedStage = LIFECYCLE_STAGES[LIFECYCLE_STAGES.indexOf(input.stage) - 1];
  if (receipt.stage !== expectedStage || !receipt.ready) add("integration-before-dependency", "predecessor.stage");
  if (!same(input.predecessor.receipt, receipt) || !verifyLifecycleStageReceipt(input.predecessor.receipt) ||
      input.predecessorDigest !== receipt.receiptDigest) add("runtime-readiness-unproven", "predecessor.receipt");
  if (!same(policy, receipt.policy)) add("runtime-readiness-unproven", "policy");
  validateSubjectTransition(input.stage, subject, receipt.subject, add);
  return {
    receipt,
    evidence: normalize(input.predecessor.operation?.evidence, EVIDENCE_KEYS[receipt.stage], false),
  };
}
function validatePolicy(raw, policy, add) {
  if (!exact(raw, POLICY_KEYS) || !REPOSITORY.test(policy.repository) ||
      !SHA.test(policy.revision) || !DIGEST.test(policy.digest) ||
      !VERSION.test(policy.guidelineVersion)) add("runtime-readiness-unproven", "policy");
}
function validateSubject(stage, raw, subject, add) {
  if (!exact(raw, SUBJECT_KEYS) || !REPOSITORY.test(subject.repository) ||
      !SHA.test(subject.commit) || !SHA.test(subject.tree) ||
      !DIGEST.test(subject.sourceDigest) || !DIGEST.test(subject.dependencyClosureDigest)) {
    add("runtime-readiness-unproven", "subject");
  }
  const collaboration = subject.collaboration;
  const valid = exact(raw?.collaboration, COLLABORATION_KEYS) &&
    COLLABORATION_KEYS.filter((key) => !["leaseEpoch", "fenceRevision"].includes(key)).every((key) => text(collaboration?.[key])) &&
    Number.isSafeInteger(collaboration?.leaseEpoch) && collaboration.leaseEpoch > 0 &&
    SHA.test(collaboration?.fenceRevision);
  if (COLLABORATIVE_STAGES.has(stage) ? !valid : raw?.collaboration !== null) add("runtime-readiness-unproven", "subject.collaboration");
}
function validateChecks(raw, checks, subject, add) {
  if (!Array.isArray(raw) || checks.length === 0) return add("evidence-without-run", "checks");
  const ids = new Set();
  checks.forEach((check, index) => {
    if (!exact(raw[index], CHECK_KEYS) || check.sequence !== index + 1 || !check.checkId ||
        ids.has(check.checkId) || check.subjectCommit !== subject.commit ||
        !DIGEST.test(check.commandDigest) || !DIGEST.test(check.resultDigest) ||
        !["passed", "failed"].includes(check.status)) add("evidence-without-run", `checks[${index}]`);
    ids.add(check.checkId);
    if (check.status !== "passed") add("unproven-property", `checks[${index}]`);
  });
}
function validateEvidence(stage, raw, evidence, checks, add) {
  const keys = EVIDENCE_KEYS[stage];
  if (!exact(raw, keys)) add("runtime-readiness-unproven", "evidence");
  for (const key of keys) {
    if (key.endsWith("Digest") && !DIGEST.test(String(evidence[key] || ""))) add("runtime-readiness-unproven", `evidence.${key}`);
    if ((key.endsWith("Commit") || key.endsWith("Tree")) && !SHA.test(String(evidence[key] || ""))) add("runtime-readiness-unproven", `evidence.${key}`);
  }
  if (evidence.namedChecksDigest !== hash(checks)) add("evidence-without-run", "evidence.namedChecksDigest");
  if (evidence.boundary !== BOUNDARIES[stage]) {
    add(["candidate"].includes(stage) ? "unreviewed-release-candidate" :
      ["authorization", "deployment"].includes(stage) ? "production-authorization-drift" :
        "runtime-readiness-unproven", "evidence.boundary");
  }
}
function validateStage(stage, evidence, policy, subject, previous, add) {
  if (stage === "admission") return;
  if (evidence.predecessorReceiptDigest !== previous?.receipt.receiptDigest) add("runtime-readiness-unproven", "evidence.predecessorReceiptDigest");
  const prior = previous?.evidence;
  if (stage === "review" && evidence.evaluatorDigest === evidence.implementerDigest) add("unproven-property", "evidence.evaluatorDigest");
  if (stage === "integration") {
    joins(evidence, priorIdentity(previous?.receipt.subject), {
      predecessorCommit: "canonical-frontier-unverified", predecessorTree: "canonical-frontier-unverified",
      predecessorSourceDigest: "canonical-frontier-unverified",
      predecessorDependencyClosureDigest: "dependency-closure-drift",
    }, add);
  }
  if (stage === "runtime" || stage === "candidate") {
    join(evidence.sourceDigest, subject.sourceDigest, "canonical-frontier-unverified", "evidence.sourceDigest", add);
    join(evidence.dependencyClosureDigest, subject.dependencyClosureDigest, "dependency-closure-drift", "evidence.dependencyClosureDigest", add);
  }
  if (stage === "candidate") join(evidence.policyDigest, policy.digest, "unreviewed-release-candidate", "evidence.policyDigest", add);
  if (stage === "authorization") {
    join(evidence.predecessorEvidenceDigest, previous?.receipt.evidenceDigest, "stale-candidate-frontier", "evidence.predecessorEvidenceDigest", add);
    joins(evidence, prior, { targetDigest: "stale-candidate-frontier", artifactDigest: "stale-candidate-frontier", manifestDigest: "stale-candidate-frontier" }, add);
    if (evidence.decisionKind !== "human") add("assumed-operator-decision", "evidence.decisionKind");
    if (!text(evidence.humanActorId) || !text(evidence.authorityAdapterId)) add("authorization-interaction-unjoined", "evidence");
  }
  if (stage === "deployment") {
    join(evidence.predecessorEvidenceDigest, previous?.receipt.evidenceDigest, "authorization-evidence-unjoined", "evidence.predecessorEvidenceDigest", add);
    joins(evidence, prior, {
      targetDigest: "authorization-evidence-unjoined", artifactDigest: "authorization-evidence-unjoined",
      manifestDigest: "authorization-evidence-unjoined",
    }, add);
    join(evidence.candidateEvidenceDigest, prior?.predecessorEvidenceDigest, "authorization-evidence-unjoined", "evidence.candidateEvidenceDigest", add);
    join(evidence.authorizedActorId, prior?.humanActorId, "authorization-evidence-unjoined", "evidence.authorizedActorId", add);
    join(evidence.deployedArtifactDigest, evidence.artifactDigest, "post-authorization-rebuild", "evidence.deployedArtifactDigest", add);
    if (!text(evidence.controllerId) || evidence.controllerId !== evidence.activeControllerId) add("duplicate-release-controller", "evidence.controllerId");
  }
  if (stage === "publication") {
    join(evidence.predecessorEvidenceDigest, previous?.receipt.evidenceDigest, "production-authorization-drift", "evidence.predecessorEvidenceDigest", add);
    joins(evidence, prior, {
      candidateEvidenceDigest: "production-authorization-drift", targetDigest: "production-authorization-drift",
      deployedArtifactDigest: "production-authorization-drift", controllerId: "production-authorization-drift",
    }, add);
    if (evidence.liveStatus !== "verified") add("runtime-readiness-unproven", "evidence.liveStatus");
    if (evidence.publicationStatus !== "published") add("runtime-readiness-unproven", "evidence.publicationStatus");
  }
}
function validateSubjectTransition(stage, current, previous, add) {
  if (["review", "integration"].includes(stage)) {
    if (!same(current.collaboration, previous.collaboration)) {
      add(current.collaboration?.fenceRevision !== previous.collaboration?.fenceRevision
        ? "stale-collaboration-fence" : "parallel-scope-collision", "subject.collaboration");
    }
    return;
  }
  joins(current, priorIdentity(previous), {
    repository: "canonical-frontier-unverified", commit: "canonical-frontier-unverified", tree: "canonical-frontier-unverified",
    sourceDigest: "canonical-frontier-unverified", dependencyClosureDigest: "dependency-closure-drift",
  }, add);
}
function joins(actual, expected, fields, add) {
  for (const [field, finding] of Object.entries(fields)) join(actual?.[field], expected?.[field], finding, `evidence.${field}`, add);
}

function join(actual, expected, finding, artifact, add) {
  if (actual !== expected) add(finding, artifact);
}
function priorIdentity(subject) {
  return subject ? {
    repository: subject.repository, commit: subject.commit, tree: subject.tree,
    sourceDigest: subject.sourceDigest, dependencyClosureDigest: subject.dependencyClosureDigest,
    predecessorCommit: subject.commit, predecessorTree: subject.tree,
    predecessorSourceDigest: subject.sourceDigest,
    predecessorDependencyClosureDigest: subject.dependencyClosureDigest,
  } : {};
}
function normalizeSubject(value) {
  const subject = normalize(value, SUBJECT_KEYS);
  subject.collaboration = value?.collaboration === null ? null : normalize(value?.collaboration, COLLABORATION_KEYS);
  if (subject.collaboration) subject.collaboration.leaseEpoch = Number(value?.collaboration?.leaseEpoch);
  return subject;
}
function normalizeChecks(value) {
  return Array.isArray(value) ? value.map((check) => {
    const normalized = normalize(check, CHECK_KEYS);
    normalized.sequence = Number(check?.sequence);
    return normalized;
  }) : [];
}
function normalize(value, keys, strings = true) {
  return Object.fromEntries(keys.map((key) => [key, strings ? text(value?.[key]) : (value?.[key] ?? null)]));
}

function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function same(left, right) {
  return canonical(left) === canonical(right);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}
