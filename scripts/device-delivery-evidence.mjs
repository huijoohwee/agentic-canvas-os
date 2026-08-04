import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";

export const DEVICE_DELIVERY_EVIDENCE_SCHEMA =
  "agentic-device-delivery-evidence/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const DEVICE_BRANCH_PATTERN =
  /^agent\/([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/u;
const OPERATIONS = new Set(["integrate", "publish"]);
const DERIVED_DIGEST_FIELDS = Object.freeze([
  "dependencyClosureDigest",
  "namedChecksDigest",
  "handoffEvidenceDigest",
  "operatorDecisionDigest",
  "integrationIntentDigest",
]);

export function createDeviceDeliveryEvidence(input = {}) {
  requireObject(input, "Delivery evidence input");
  for (const field of DERIVED_DIGEST_FIELDS) {
    if (Object.hasOwn(input, field)) {
      throw new Error(`${field} is operation-derived and cannot be supplied by a caller.`);
    }
  }
  if (Object.hasOwn(input, "preimages")) {
    throw new Error("Delivery evidence preimages are operation-derived and cannot be supplied by a caller.");
  }

  const operation = requiredOperation(input.operation);
  const manifest = normalizeAdmissionManifest(input.manifest);
  const authority = normalizeReviewAuthority(input.authority, manifest);
  const branch = requiredBranch(input.branch, {
    deviceId: input.deviceId,
    semanticScope: manifest.semanticScope,
  });
  const headSha = requiredSha(input.headSha, "headSha");
  const headTreeSha = requiredSha(input.headTreeSha, "headTreeSha");
  const pullRequestNumber = positiveInteger(
    input.pullRequestNumber,
    "pullRequestNumber",
  );
  const deviceId = requiredText(input.deviceId, "deviceId");
  const sessionId = requiredText(input.sessionId, "sessionId");

  if (authority.laneRevision !== headSha) {
    throw new Error("Delivery evidence headSha must equal the exact reviewed lane revision.");
  }
  if (authority.deviceId !== deviceId || authority.sessionId !== sessionId) {
    throw new Error("Delivery evidence device and session must equal the reviewed cloud authority.");
  }

  const dependencyClosure = deepFreeze({
    schema: "agentic-protected-integration-dependency-closure/v1",
    targetRepository: authority.targetRepository,
    canonicalBaseSha: authority.canonicalBaseSha,
    candidateRevision: headSha,
    candidateTreeSha: headTreeSha,
    admission: {
      semanticScope: manifest.semanticScope,
      manifestDigest: manifest.manifestDigest,
      writeSetDigest: manifest.writeSetDigest,
      planReceiptDigest: manifest.planReceiptDigest,
      admissionReceiptDigest: manifest.admissionReceiptDigest,
      admittedReportDigest: manifest.admittedReportDigest,
      preservationReceiptDigest: manifest.preservationReceiptDigest,
      existingLaneStateDigest: manifest.existingLaneStateDigest,
    },
  });
  const dependencyClosureDigest = digestValue(dependencyClosure);

  const namedChecks = deepFreeze({
    schema: "agentic-protected-integration-named-checks/v1",
    targetRepository: authority.targetRepository,
    candidateRevision: headSha,
    candidateTreeSha: headTreeSha,
    checks: [{
      name: "repository-check",
      command: "npm run check",
      status: "passed",
      evidenceDigest: authority.focusedEvidenceDigest,
    }],
  });
  const namedChecksDigest = digestValue(namedChecks);

  const handoffEvidence = deepFreeze({
    schema: "agentic-protected-integration-handoff-evidence/v1",
    targetRepository: authority.targetRepository,
    branch,
    pullRequestNumber,
    reviewRequestId: authority.reviewRequestId,
    candidateRevision: headSha,
    candidateTreeSha: headTreeSha,
    claimId: authority.claimId,
    reviewFenceDigest: authority.claimDigest,
    claimLedgerRevision: authority.claimLedgerRevision,
    observedLedgerHeadRevision: authority.ledgerRevision,
    leaseEpoch: authority.leaseEpoch,
    transitionCounter: authority.transitionCounter,
    deviceId,
    sessionId,
    focusedEvidenceDigest: authority.focusedEvidenceDigest,
    manifestDigest: manifest.manifestDigest,
    admittedReportDigest: manifest.admittedReportDigest,
    writeSetDigest: manifest.writeSetDigest,
    dependencyClosureDigest,
    namedChecksDigest,
  });
  const handoffEvidenceDigest = digestValue(handoffEvidence);

  const operatorDecision = deepFreeze({
    schema: "agentic-protected-integration-operator-decision/v1",
    action: "delivery-authorize",
    invocation: `device:${operation}`,
    branch,
    headSha,
    headTreeSha,
    pullRequestNumber,
    deviceId,
    sessionId,
    handoffEvidenceDigest,
  });
  const operatorDecisionDigest = digestValue(operatorDecision);

  const integrationIntent = deepFreeze({
    schema: "agentic-protected-integration-intent/v1",
    target: "protected-canonical-source",
    invocation: `device:${operation}`,
    targetRepository: authority.targetRepository,
    canonicalBaseSha: authority.canonicalBaseSha,
    claimId: authority.claimId,
    reviewRequestId: authority.reviewRequestId,
    laneRevision: headSha,
    candidateTreeSha: headTreeSha,
    writeSetDigest: manifest.writeSetDigest,
    dependencyClosureDigest,
    namedChecksDigest,
    handoffEvidenceDigest,
    operatorDecisionDigest,
  });
  const integrationIntentDigest = digestValue(integrationIntent);

  return deepFreeze({
    schema: DEVICE_DELIVERY_EVIDENCE_SCHEMA,
    operation,
    preimages: {
      dependencyClosure,
      namedChecks,
      handoffEvidence,
      operatorDecision,
      integrationIntent,
    },
    dependencyClosureDigest,
    namedChecksDigest,
    handoffEvidenceDigest,
    operatorDecisionDigest,
    integrationIntentDigest,
  });
}

function normalizeAdmissionManifest(value) {
  requireObject(value, "Delivery admission manifest");
  if (
    value.schema !== "agentic-lane-admission-lease/v1"
    || value.status !== "admitted"
  ) {
    throw new Error("Delivery evidence requires one admitted lane admission lease.");
  }
  const semanticScope = requiredText(value.semanticScope, "manifest.semanticScope");
  const declaredWriteSet = normalizeWriteSet(value.declaredWriteSet);
  if (
    JSON.stringify(declaredWriteSet) !== JSON.stringify(value.declaredWriteSet)
    || !declaredWriteSet.includes(`semantic:${semanticScope}`)
    || !declaredWriteSet.some(item => item.startsWith("path:"))
  ) {
    throw new Error("Delivery admission declaredWriteSet is not its exact normalized semantic and path scope.");
  }
  const writeSetDigest = requiredDigest(value.writeSetDigest, "manifest.writeSetDigest");
  if (digestValue(declaredWriteSet) !== writeSetDigest) {
    throw new Error("Delivery admission writeSetDigest does not bind its declaredWriteSet.");
  }
  const manifestDigest = requiredDigest(value.manifestDigest, "manifest.manifestDigest");
  const sourceManifest = {
    schema: "agentic-declared-write-scope/v1",
    semanticScope,
    paths: declaredWriteSet
      .filter(item => item.startsWith("path:"))
      .map(item => item.slice("path:".length)),
  };
  if (digestValue(sourceManifest) !== manifestDigest) {
    throw new Error("Delivery admission manifestDigest does not bind its declared source manifest.");
  }
  return deepFreeze({
    schema: value.schema,
    status: value.status,
    semanticScope,
    declaredWriteSet,
    writeSetDigest,
    manifestDigest,
    planReceiptDigest: requiredDigest(value.planReceiptDigest, "manifest.planReceiptDigest"),
    admissionReceiptDigest: requiredDigest(
      value.admissionReceiptDigest,
      "manifest.admissionReceiptDigest",
    ),
    admittedReportDigest: requiredDigest(
      value.admittedReportDigest,
      "manifest.admittedReportDigest",
    ),
    preservationReceiptDigest: requiredDigest(
      value.preservationReceiptDigest,
      "manifest.preservationReceiptDigest",
    ),
    existingLaneStateDigest: requiredDigest(
      value.existingLaneStateDigest,
      "manifest.existingLaneStateDigest",
    ),
  });
}

function normalizeReviewAuthority(value, manifest) {
  requireObject(value, "Delivery cloud authority");
  if (
    value.schema !== "agentic-lane-cloud-authority/v1"
    || value.provider !== "github"
    || value.state !== "review_ready"
  ) {
    throw new Error("Delivery evidence requires one exact GitHub review-ready cloud authority.");
  }
  const targetRepository = requiredRepository(
    value.targetRepository,
    "authority.targetRepository",
  );
  const cloudDeclaredWriteScope = normalizeWriteSet(value.cloudDeclaredWriteScope);
  const writeSetDigest = requiredDigest(value.writeSetDigest, "authority.writeSetDigest");
  const manifestDigest = requiredDigest(value.manifestDigest, "authority.manifestDigest");
  if (
    JSON.stringify(cloudDeclaredWriteScope) !== JSON.stringify(manifest.declaredWriteSet)
    || writeSetDigest !== manifest.writeSetDigest
    || manifestDigest !== manifest.manifestDigest
  ) {
    throw new Error("Delivery cloud authority does not join the admitted manifest write scope.");
  }
  return deepFreeze({
    targetRepository,
    claimId: requiredDigest(value.claimId, "authority.claimId"),
    claimDigest: requiredDigest(value.claimDigest, "authority.claimDigest"),
    ledgerRevision: requiredSha(value.ledgerRevision, "authority.ledgerRevision"),
    claimLedgerRevision: requiredDigest(
      value.claimLedgerRevision,
      "authority.claimLedgerRevision",
    ),
    canonicalBaseSha: requiredSha(
      value.canonicalBaseSha,
      "authority.canonicalBaseSha",
    ),
    laneRevision: requiredSha(value.laneRevision, "authority.laneRevision"),
    writeSetDigest,
    deviceId: requiredText(value.deviceId, "authority.deviceId"),
    sessionId: requiredText(value.sessionId, "authority.sessionId"),
    reviewRequestId: requiredText(
      value.reviewRequestId,
      "authority.reviewRequestId",
    ),
    leaseEpoch: positiveInteger(value.leaseEpoch, "authority.leaseEpoch"),
    transitionCounter: positiveInteger(
      value.transitionCounter,
      "authority.transitionCounter",
    ),
    focusedEvidenceDigest: requiredDigest(
      value.focusedEvidenceDigest,
      "authority.focusedEvidenceDigest",
    ),
    manifestDigest,
  });
}

function requiredOperation(value) {
  const operation = requiredText(value, "operation");
  if (!OPERATIONS.has(operation)) {
    throw new Error("operation must be integrate or publish.");
  }
  return operation;
}

function requiredBranch(value, { deviceId, semanticScope }) {
  const branch = requiredText(value, "branch");
  const match = branch.match(DEVICE_BRANCH_PATTERN);
  if (!match || match[1] !== deviceId || match[2] !== semanticScope) {
    throw new Error("branch must exactly join its device and admitted semantic scope.");
  }
  return branch;
}

function requiredRepository(value, field) {
  const repository = requiredText(value, field);
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`${field} must be an owner/repository identity.`);
  }
  return repository;
}

function requiredSha(value, field) {
  const sha = requiredText(value, field);
  if (!SHA_PATTERN.test(sha)) throw new Error(`${field} must be a lowercase 40-character Git SHA.`);
  return sha;
}

function requiredDigest(value, field) {
  const digest = requiredText(value, field);
  if (!DIGEST_PATTERN.test(digest)) {
    throw new Error(`${field} must be a lowercase SHA-256 digest.`);
  }
  return digest;
}

function requiredText(value, field) {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  const normalized = value.normalize("NFC").trim();
  if (!normalized) throw new Error(`${field} must not be empty.`);
  return normalized;
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
