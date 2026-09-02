import { createHash } from "node:crypto";

import {
  COMMERCE_DEPLOYMENT_IDENTITY_SCHEMA,
  productionVersionTag,
  readCommerceDeploymentIdentity,
} from "../agent-api/src/commerce-deployment-identity.js";

export { productionVersionTag };

export const PRODUCTION_REPOSITORY = "huijoohwee/agentic-canvas-os";
export const PRODUCTION_REF = "refs/heads/main";
export const PRODUCTION_BRANCH = "main";
export const PRODUCTION_ENVIRONMENT = "production";
export const PRODUCTION_WORKER = "agentic-canvas-os";
export const PRODUCTION_WORKFLOW_PATH = ".github/workflows/production-release.yml";
export const PRODUCTION_JOB = "production-release";
export const PRODUCTION_CANDIDATE_SCHEMA = "acos-production-release-candidate/v1";
export const PRODUCTION_AUTHORITY_SCHEMA = "acos-github-production-authority/v1";
export const ACTIVE_DEPLOYMENT_SCHEMA = "acos-cloudflare-active-deployment/v1";
export const VERSION_EVIDENCE_SCHEMA = "acos-cloudflare-version-evidence/v1";
export const DEPLOYMENT_RECEIPT_SCHEMA = "acos-production-deployment-receipt/v1";
export const ROLLBACK_RECEIPT_SCHEMA = "acos-production-rollback-receipt/v1";
export const PRESERVE_RECEIPT_SCHEMA = "acos-production-preserve-required-receipt/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const CANDIDATE_KEYS = Object.freeze([
  "bindingTopologyDigest", "candidateDigest", "configurationDigest", "privateProviderContract", "protectedRef",
  "receiptSchema", "repository", "requiredSecrets", "schema", "sourceRevision", "sourceTree",
  "storageCompatibilityRevision", "workerName",
]);
const AUTHORITY_KEYS = Object.freeze([
  "branchProtected", "environment", "environmentId", "event", "headBranch", "headSha",
  "jobId", "jobName", "jobStatus", "repository", "reviewedAt", "reviewerId", "reviewerLogin",
  "runAttempt", "runId", "schema", "workflowPath",
]);
const ACTIVE_KEYS = Object.freeze([
  "deploymentId", "percentage", "releaseManaged", "schema", "storageCompatibilityRevision",
  "unmanagedBindingsAttestationDigest", "unmanagedBindingsDigest", "versionId",
]);
const VERSION_KEYS = Object.freeze([
  "baselineUnmanagedBindingsDigest", "bindingTopologyDigest", "candidateDigest", "configurationDigest",
  "preservedUnmanagedBindingsDigest", "schema", "secretNames", "sourceRevision",
  "storageCompatibilityRevision", "unmanagedBindingsAttestationDigest", "versionId",
  "versionMetadataBindings", "versionTag", "versionTimestamp",
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function digestValue(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function uniqueSortedIdentifiers(values) {
  return Array.isArray(values)
    && values.every((value) => IDENTIFIER_PATTERN.test(value))
    && new Set(values).size === values.length
    && values.every((value, index) => index === 0 || values[index - 1].localeCompare(value) < 0);
}

export function createProductionCandidate(input) {
  const candidate = {
    schema: PRODUCTION_CANDIDATE_SCHEMA,
    repository: PRODUCTION_REPOSITORY,
    protectedRef: PRODUCTION_REF,
    workerName: PRODUCTION_WORKER,
    sourceRevision: input.sourceRevision,
    sourceTree: input.sourceTree,
    configurationDigest: input.configurationDigest,
    bindingTopologyDigest: input.bindingTopologyDigest,
    storageCompatibilityRevision: input.storageCompatibilityRevision,
    requiredSecrets: [...new Set(input.requiredSecrets ?? [])].sort(),
    privateProviderContract: "commerce.acos-admission-provider/v3",
    receiptSchema: "acos-adapter-registration/v2",
  };
  return Object.freeze({ ...candidate, candidateDigest: digestValue(candidate) });
}

export function readProductionCandidate(value) {
  if (!exactKeys(value, CANDIDATE_KEYS)
    || value.schema !== PRODUCTION_CANDIDATE_SCHEMA
    || value.repository !== PRODUCTION_REPOSITORY
    || value.protectedRef !== PRODUCTION_REF
    || value.workerName !== PRODUCTION_WORKER
    || !SHA_PATTERN.test(value.sourceRevision ?? "")
    || !SHA_PATTERN.test(value.sourceTree ?? "")
    || !DIGEST_PATTERN.test(value.configurationDigest ?? "")
    || !DIGEST_PATTERN.test(value.bindingTopologyDigest ?? "")
    || !DIGEST_PATTERN.test(value.storageCompatibilityRevision ?? "")
    || !uniqueSortedIdentifiers(value.requiredSecrets)
    || value.privateProviderContract !== "commerce.acos-admission-provider/v3"
    || value.receiptSchema !== "acos-adapter-registration/v2") return null;
  const { candidateDigest, ...unsigned } = value;
  if (!DIGEST_PATTERN.test(candidateDigest ?? "") || digestValue(unsigned) !== candidateDigest) return null;
  return Object.freeze({ ...value, requiredSecrets: Object.freeze([...value.requiredSecrets]) });
}

export function readProductionAuthority(value, candidate) {
  if (!exactKeys(value, AUTHORITY_KEYS)
    || value.schema !== PRODUCTION_AUTHORITY_SCHEMA
    || value.repository !== PRODUCTION_REPOSITORY
    || value.environment !== PRODUCTION_ENVIRONMENT
    || !Number.isSafeInteger(value.environmentId) || value.environmentId < 1
    || !Number.isSafeInteger(value.reviewerId) || value.reviewerId < 1
    || !IDENTIFIER_PATTERN.test(value.reviewerLogin ?? "") || value.reviewerLogin.endsWith("[bot]")
    || !validTimestamp(value.reviewedAt)
    || !Number.isSafeInteger(value.runId) || value.runId < 1
    || value.runAttempt !== 1
    || value.event !== "workflow_dispatch"
    || value.headBranch !== PRODUCTION_BRANCH
    || value.headSha !== candidate.sourceRevision
    || value.workflowPath !== PRODUCTION_WORKFLOW_PATH
    || !Number.isSafeInteger(value.jobId) || value.jobId < 1
    || value.jobName !== PRODUCTION_JOB
    || value.jobStatus !== "in_progress"
    || value.branchProtected !== true) return null;
  return Object.freeze({ ...value });
}

export function readActiveDeployment(value) {
  if (!exactKeys(value, ACTIVE_KEYS)
    || value.schema !== ACTIVE_DEPLOYMENT_SCHEMA
    || !IDENTIFIER_PATTERN.test(value.deploymentId ?? "")
    || !UUID_PATTERN.test(value.versionId ?? "")
    || value.percentage !== 100
    || typeof value.releaseManaged !== "boolean"
    || !DIGEST_PATTERN.test(value.unmanagedBindingsDigest ?? "")
    || !(value.unmanagedBindingsAttestationDigest === null
      || DIGEST_PATTERN.test(value.unmanagedBindingsAttestationDigest ?? ""))
    || (value.releaseManaged
      ? value.unmanagedBindingsAttestationDigest === null
      : value.unmanagedBindingsAttestationDigest !== null)
    || !(value.storageCompatibilityRevision === null
      || DIGEST_PATTERN.test(value.storageCompatibilityRevision ?? ""))) return null;
  return Object.freeze({ ...value });
}

export function readVersionEvidence(value, candidate) {
  if (!exactKeys(value, VERSION_KEYS)
    || value.schema !== VERSION_EVIDENCE_SCHEMA
    || !UUID_PATTERN.test(value.versionId ?? "")
    || value.versionTag !== productionVersionTag(candidate.candidateDigest)
    || !validTimestamp(value.versionTimestamp)
    || value.sourceRevision !== candidate.sourceRevision
    || value.candidateDigest !== candidate.candidateDigest
    || value.configurationDigest !== candidate.configurationDigest
    || value.bindingTopologyDigest !== candidate.bindingTopologyDigest
    || !DIGEST_PATTERN.test(value.baselineUnmanagedBindingsDigest ?? "")
    || value.preservedUnmanagedBindingsDigest !== value.baselineUnmanagedBindingsDigest
    || value.unmanagedBindingsAttestationDigest !== value.baselineUnmanagedBindingsDigest
    || value.storageCompatibilityRevision !== candidate.storageCompatibilityRevision
    || value.versionMetadataBindings !== 1
    || !uniqueSortedIdentifiers(value.secretNames)
    || value.secretNames.length !== candidate.requiredSecrets.length
    || candidate.requiredSecrets.some((name, index) => value.secretNames[index] !== name)) return null;
  return Object.freeze({ ...value, secretNames: Object.freeze([...value.secretNames]) });
}

export function deploymentIdentityFromVersion(version) {
  const value = {
    schema: COMMERCE_DEPLOYMENT_IDENTITY_SCHEMA,
    sourceRevision: version.sourceRevision,
    candidateDigest: version.candidateDigest,
    versionId: version.versionId,
    versionTag: version.versionTag,
    versionTimestamp: version.versionTimestamp,
  };
  const identity = readCommerceDeploymentIdentity(value);
  if (!identity) throw new TypeError("Cloudflare version does not yield an exact deployment identity.");
  return identity;
}

export function exactDeployment(left, right) {
  return Boolean(left && right
    && left.deploymentId === right.deploymentId
    && left.versionId === right.versionId
    && left.releaseManaged === right.releaseManaged
    && left.storageCompatibilityRevision === right.storageCompatibilityRevision
    && left.unmanagedBindingsDigest === right.unmanagedBindingsDigest
    && left.unmanagedBindingsAttestationDigest === right.unmanagedBindingsAttestationDigest
    && left.percentage === 100
    && right.percentage === 100);
}

function withReceiptDigest(receipt) {
  return Object.freeze({ ...receipt, receiptDigest: digestValue(receipt) });
}

export function createDeploymentReceipt({ candidate, authority, baseline, version, publicReadiness, privateReadiness, completedAt }) {
  return withReceiptDigest({
    schema: DEPLOYMENT_RECEIPT_SCHEMA,
    status: "deployed",
    candidateDigest: candidate.candidateDigest,
    sourceRevision: candidate.sourceRevision,
    versionId: version.versionId,
    versionTag: version.versionTag,
    versionTimestamp: version.versionTimestamp,
    predecessorVersionId: baseline.versionId,
    unmanagedBindingBaseline: {
      digest: version.unmanagedBindingsAttestationDigest,
      authority: baseline.releaseManaged ? "predecessor-attested" : "bootstrap-established",
    },
    authorization: {
      environment: authority.environment,
      reviewerId: authority.reviewerId,
      reviewerLogin: authority.reviewerLogin,
      reviewedAt: authority.reviewedAt,
      runId: authority.runId,
      jobId: authority.jobId,
    },
    publicReadiness,
    privateReadiness,
    completedAt,
  });
}

export function createRollbackReceipt({ candidate, baseline, version, failure, completedAt }) {
  return withReceiptDigest({
    schema: ROLLBACK_RECEIPT_SCHEMA,
    status: "rolled-back",
    candidateDigest: candidate.candidateDigest,
    failedVersionId: version.versionId,
    restoredVersionId: baseline.versionId,
    readinessFailureCode: failure,
    rollbackSafety: "exact-storage-compatible-predecessor",
    unmanagedBindingBaseline: {
      digest: baseline.unmanagedBindingsDigest,
      authority: baseline.releaseManaged ? "predecessor-attested" : "bootstrap-observed",
    },
    completedAt,
  });
}

export function createPreserveReceipt({ candidate, baseline, observedActive, failure, completedAt }) {
  const activeDeployment = observedActive ? {
    deploymentId: observedActive.deploymentId,
    versionId: observedActive.versionId,
    percentage: observedActive.percentage,
    storageCompatibilityRevision: observedActive.storageCompatibilityRevision,
  } : null;
  return withReceiptDigest({
    schema: PRESERVE_RECEIPT_SCHEMA,
    status: "preserve-required",
    candidateDigest: candidate.candidateDigest,
    activeState: activeDeployment ? "observed" : "unknown",
    activeDeployment,
    predecessorVersionId: baseline.versionId,
    unmanagedBindingBaseline: {
      digest: baseline.unmanagedBindingsDigest,
      authority: baseline.releaseManaged ? "predecessor-attested" : "bootstrap-observed",
    },
    readinessFailureCode: failure,
    storageCompatibility: {
      candidate: candidate.storageCompatibilityRevision,
      predecessor: baseline.storageCompatibilityRevision,
      compatible: baseline.storageCompatibilityRevision === candidate.storageCompatibilityRevision,
    },
    forwardRecoveryRequired: true,
    completedAt,
  });
}
