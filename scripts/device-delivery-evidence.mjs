import path from "node:path";
import { CLOUD_COLLABORATION_BOUNDS, digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
export const DEVICE_DELIVERY_EVIDENCE_SCHEMA = "agentic-device-delivery-evidence/v1";
export const REPOSITORY_VALIDATION_EVIDENCE_SCHEMA = "agentic-repository-validation-evidence/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const DEVICE_BRANCH_PATTERN = /^agent\/([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/u;
const OPERATIONS = new Set(["integrate", "publish"]);
const DERIVED_DIGEST_FIELDS = Object.freeze([
  "dependencyClosureDigest",
  "namedChecksDigest",
  "handoffEvidenceDigest",
  "operatorDecisionDigest",
  "integrationIntentDigest",
]);
const validationEvidenceCache = new WeakMap();
export function compactDeviceCloudMutationIdempotencyKey(input) {
  const idempotencyKey = input?.request?.idempotencyKey;
  if (
    typeof idempotencyKey !== "string"
    || idempotencyKey.length <= CLOUD_COLLABORATION_BOUNDS.textCharacters
  ) {
    return input;
  }
  return {
    ...input,
    request: {
      ...input.request,
      idempotencyKey: `device-cloud-mutation:${digestValue(idempotencyKey)}`,
    },
  };
}
export function createRepositoryValidationEvidence({
  gitText, headSha = gitText?.(["rev-parse", "HEAD"]),
  targetMainSha = gitText?.(["rev-parse", "origin/main"]), branch, sessionId, leaseEpoch,
  validatedAt = new Date().toISOString(),
} = {}) {
  if (typeof gitText !== "function") {
    throw new Error("Repository validation evidence requires gitText().");
  }
  const normalizedHeadSha = requiredSha(String(headSha || "").trim(), "validation headSha");
  const normalizedTargetMainSha = requiredSha(
    String(targetMainSha || "").trim(),
    "validation targetMainSha",
  );
  const headTreeSha = requiredSha(
    String(gitText(["rev-parse", `${normalizedHeadSha}^{tree}`]) || "").trim(),
    "validation headTreeSha",
  );
  const targetMainTreeSha = requiredSha(
    String(gitText(["rev-parse", `${normalizedTargetMainSha}^{tree}`]) || "").trim(),
    "validation targetMainTreeSha",
  );
  const packageJsonBlobSha = requiredSha(
    String(gitText(["rev-parse", `${normalizedHeadSha}:package.json`]) || "").trim(),
    "validation packageJsonBlobSha",
  );
  const packageLockBlobSha = requiredSha(
    String(gitText(["rev-parse", `${normalizedHeadSha}:package-lock.json`]) || "").trim(),
    "validation packageLockBlobSha",
  );
  const command = "npm run check";
  const policyDigest = digestValue({
    schema: "agentic-repository-validation-policy/v1",
    command,
    packageJsonBlobSha,
    packageLockBlobSha,
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
  });
  const dependencyClosureDigest = digestValue({
    schema: "agentic-repository-validation-dependency-closure/v1",
    headTreeSha,
    targetMainSha: normalizedTargetMainSha,
    targetMainTreeSha,
    packageJsonBlobSha,
    packageLockBlobSha,
  });
  const core = {
    schema: REPOSITORY_VALIDATION_EVIDENCE_SCHEMA,
    status: "passed",
    command,
    branch: requiredBranchIdentity(branch, "validation branch"),
    sessionId: requiredText(sessionId, "validation sessionId"),
    leaseEpoch: positiveInteger(leaseEpoch, "validation leaseEpoch"),
    headSha: normalizedHeadSha,
    headTreeSha,
    targetMainSha: normalizedTargetMainSha,
    targetMainTreeSha,
    policyDigest,
    dependencyClosureDigest,
    validatedAt: requiredInstant(validatedAt, "validation validatedAt"),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}
export function verifyRepositoryValidationEvidence({
  evidence, gitText, headSha = gitText?.(["rev-parse", "HEAD"]),
  targetMainSha = gitText?.(["rev-parse", "origin/main"]), branch, sessionId,
  leaseEpoch, canonicalBaseSha = targetMainSha,
} = {}) {
  requireObject(evidence, "Repository validation evidence");
  const normalized = normalizeRepositoryValidationEvidence(evidence, {
    headSha: String(headSha || "").trim(),
    headTreeSha: evidence.headTreeSha,
    branch,
    sessionId,
    leaseEpoch,
    canonicalBaseSha,
  });
  const expected = createRepositoryValidationEvidence({
    gitText,
    headSha,
    targetMainSha,
    branch,
    sessionId,
    leaseEpoch,
    validatedAt: evidence.validatedAt,
  });
  if (digestValue(normalized) !== digestValue(expected)) {
    throw new Error(
      "Repository validation evidence no longer matches HEAD, tree, target main, policy, or dependency closure.",
    );
  }
  return expected;
}
export function rememberRepositoryValidationEvidenceForInvocation({ gitText, evidence, repository } = {}) {
  if (typeof gitText !== "function") {
    throw new Error("Repository validation cache requires its exact gitText invocation.");
  }
  const normalized = normalizeRepositoryValidationEvidence(evidence, {
    headSha: evidence?.headSha,
    headTreeSha: evidence?.headTreeSha,
    branch: evidence?.branch,
    sessionId: evidence?.sessionId,
    leaseEpoch: evidence?.leaseEpoch,
    canonicalBaseSha: evidence?.targetMainSha,
  });
  validationEvidenceCache.set(gitText, {
    evidence: normalized,
    repository: path.resolve(requiredText(repository, "validation repository")),
  });
  return normalized;
}
export function reusableRepositoryValidationEvidence({
  gitText,
  branch,
  sessionId,
  leaseEpoch,
  canonicalBaseSha,
  repository,
  now = () => new Date(),
} = {}) {
  if (typeof gitText !== "function") return null;
  const cached = validationEvidenceCache.get(gitText);
  if (!cached) return null;
  validationEvidenceCache.delete(gitText);
  if (cached.repository !== path.resolve(requiredText(repository, "validation repository"))) return null;
  const { evidence } = cached;
  const ageMs = now().getTime() - Date.parse(evidence.validatedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 10 * 60 * 1000) return null;
  if (
    evidence.branch !== requiredBranchIdentity(branch, "validation branch")
    || evidence.sessionId !== requiredText(sessionId, "validation sessionId")
    || evidence.leaseEpoch !== positiveInteger(leaseEpoch, "validation leaseEpoch")
    || evidence.targetMainSha !== requiredSha(canonicalBaseSha, "validation canonicalBaseSha")
  ) {
    return null;
  }
  try {
    const currentSha = (args, field) => requiredSha(String(gitText(args) || "").trim(), field);
    const currentHeadSha = currentSha(["rev-parse", "HEAD"], "validation current HEAD");
    if (currentHeadSha !== evidence.headSha) return null;
    const currentTreeSha = currentSha(
      ["rev-parse", `${currentHeadSha}^{tree}`], "validation current tree",
    );
    if (currentTreeSha !== evidence.headTreeSha) return null;
    const currentTargetMainSha = currentSha(
      ["rev-parse", "origin/main"], "validation current target main",
    );
    if (currentTargetMainSha !== evidence.targetMainSha) return null;
    const currentTargetMainTreeSha = currentSha(
      ["rev-parse", `${currentTargetMainSha}^{tree}`], "validation current target main tree",
    );
    if (currentTargetMainTreeSha !== evidence.targetMainTreeSha) return null;
    return verifyRepositoryValidationEvidence({
      evidence,
      gitText,
      headSha: currentHeadSha,
      targetMainSha: currentTargetMainSha,
      branch,
      sessionId,
      leaseEpoch,
      canonicalBaseSha,
    });
  } catch {
    return null;
  }
}
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
  const validationEvidence = input.validationEvidence
    ? normalizeRepositoryValidationEvidence(input.validationEvidence, {
      headSha,
      headTreeSha,
      branch,
      sessionId,
      leaseEpoch: authority.leaseEpoch,
      canonicalBaseSha: authority.canonicalBaseSha,
    })
    : null;
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
      ...(validationEvidence
        ? { repositoryValidationReceiptDigest: validationEvidence.receiptDigest }
        : {}),
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
      ...(validationEvidence ? { validationEvidence } : {}),
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
function normalizeRepositoryValidationEvidence(
  value,
  { headSha, headTreeSha, branch, sessionId, leaseEpoch, canonicalBaseSha },
) {
  requireObject(value, "Repository validation evidence");
  const exactKeys = [
    "command",
    "branch",
    "dependencyClosureDigest",
    "headSha",
    "headTreeSha",
    "leaseEpoch",
    "policyDigest",
    "receiptDigest",
    "schema",
    "sessionId",
    "status",
    "targetMainSha",
    "targetMainTreeSha",
    "validatedAt",
  ].sort();
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(exactKeys)) {
    throw new Error("Repository validation evidence has an unexpected field shape.");
  }
  const normalized = {
    schema: value.schema,
    status: value.status,
    command: requiredText(value.command, "validation.command"),
    branch: requiredBranchIdentity(value.branch, "validation.branch"),
    sessionId: requiredText(value.sessionId, "validation.sessionId"),
    leaseEpoch: positiveInteger(value.leaseEpoch, "validation.leaseEpoch"),
    headSha: requiredSha(value.headSha, "validation.headSha"),
    headTreeSha: requiredSha(value.headTreeSha, "validation.headTreeSha"),
    targetMainSha: requiredSha(value.targetMainSha, "validation.targetMainSha"),
    targetMainTreeSha: requiredSha(
      value.targetMainTreeSha,
      "validation.targetMainTreeSha",
    ),
    policyDigest: requiredDigest(value.policyDigest, "validation.policyDigest"),
    dependencyClosureDigest: requiredDigest(
      value.dependencyClosureDigest,
      "validation.dependencyClosureDigest",
    ),
    validatedAt: requiredInstant(value.validatedAt, "validation.validatedAt"),
  };
  if (
    normalized.schema !== REPOSITORY_VALIDATION_EVIDENCE_SCHEMA
    || normalized.status !== "passed"
    || normalized.command !== "npm run check"
    || normalized.branch !== requiredBranchIdentity(branch, "validation branch")
    || normalized.sessionId !== requiredText(sessionId, "validation sessionId")
    || normalized.leaseEpoch !== positiveInteger(leaseEpoch, "validation leaseEpoch")
    || normalized.headSha !== headSha
    || normalized.headTreeSha !== headTreeSha
    || normalized.targetMainSha !== requiredSha(
      canonicalBaseSha,
      "validation canonicalBaseSha",
    )
    || requiredDigest(value.receiptDigest, "validation.receiptDigest")
      !== digestValue(normalized)
  ) {
    throw new Error("Repository validation evidence does not bind the delivered head and tree.");
  }
  return deepFreeze({ ...normalized, receiptDigest: value.receiptDigest });
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
function requiredBranchIdentity(value, field) {
  const branch = requiredText(value, field);
  if (!DEVICE_BRANCH_PATTERN.test(branch)) {
    throw new Error(`${field} must be an agent/<device>/<scope> branch.`);
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
function requiredInstant(value, field) {
  const instant = requiredText(value, field);
  const milliseconds = Date.parse(instant);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== instant) {
    throw new Error(`${field} must be a canonical ISO-8601 instant.`);
  }
  return instant;
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
