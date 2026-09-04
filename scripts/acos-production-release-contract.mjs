import { createHash } from "node:crypto";

import {
  COMMERCE_ADMISSION_AUTHORITY_REF_PREFIX,
  COMMERCE_ADMISSION_PROVIDER_CONTRACT,
  COMMERCE_ADMISSION_RECEIPT_SCHEMA,
} from "../agent-api/src/commerce-admission-contract.js";
import {
  COMMERCE_DEPLOYMENT_IDENTITY_SCHEMA,
  productionVersionTag,
  readCommerceDeploymentIdentity,
} from "../agent-api/src/commerce-deployment-identity.js";
import { validateProductionReleaseCandidate } from "./production-release-authorization-contract.mjs";

export { productionVersionTag };

export const PRODUCTION_REPOSITORY = "huijoohwee/agentic-canvas-os";
export const PRODUCTION_REF = "refs/heads/main";
export const PRODUCTION_BRANCH = "main";
export const PRODUCTION_ENVIRONMENT = "production";
export const PRODUCTION_WORKER = "agentic-canvas-os";
export const PRODUCTION_PUBLIC_ORIGIN = "https://airvio.co";
export const PRODUCTION_WORKFLOW_PATH = ".github/workflows/production-release.yml";
export const PRODUCTION_JOB = "production-release";
export const PRODUCTION_CANDIDATE_SCHEMA = "acos-production-release-candidate/v1";
export const PRODUCTION_AUTHORITY_SCHEMA = "acos-github-production-authority/v1";
export const ACTIVE_DEPLOYMENT_SCHEMA = "acos-cloudflare-active-deployment/v1";
export const VERSION_EVIDENCE_SCHEMA = "acos-cloudflare-version-evidence/v1";
export const DEPLOYMENT_RECEIPT_SCHEMA = "acos-production-deployment-receipt/v1";
export const PRESERVE_RECEIPT_SCHEMA = "acos-production-preserve-required-receipt/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const OPERATOR_REF_PATTERN = /^operator:\/\/agentic-graph\/commerce-adapter-admission\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const CANDIDATE_KEYS = Object.freeze([
  "bindingTopologyDigest",
  "candidateDigest",
  "configurationDigest",
  "graphAuthority",
  "privateProviderContract",
  "protectedRef",
  "publicReadyOrigin",
  "receiptSchema",
  "releaseCandidate",
  "repository",
  "requiredSecrets",
  "schema",
  "sourceRevision",
  "sourceTree",
  "storageCompatibilityRevision",
  "webArtifactDigest",
  "workerName",
]);
const GRAPH_KEYS = Object.freeze([
  "authorityRef", "evidenceDigest", "issuerRevision", "operatorInstructionRef",
]);
const AUTHORITY_KEYS = Object.freeze([
  "branchProtected", "environment", "environmentId", "event", "headBranch", "headSha",
  "jobId", "jobName", "jobStartedAt", "jobStatus", "repository", "reviewerId", "reviewerLogin",
  "runAttempt", "runId", "schema", "workflowPath",
]);
const ACTIVE_KEYS = Object.freeze([
  "deploymentId", "percentage", "schema", "unmanagedBindingsDigest", "versionId",
]);
const VERSION_KEYS = Object.freeze([
  "baselineUnmanagedBindingsDigest", "bindingTopologyDigest", "candidateDigest", "graphAuthority",
  "preservedUnmanagedBindingsDigest", "schema", "secretNames", "sourceRevision", "versionId",
  "versionMetadataBindings", "versionTag", "versionTimestamp",
]);
const PRESERVE_KEYS = Object.freeze([
  "activeDeployment", "activeState", "candidateDigest", "candidateVersionId", "completedAt",
  "failure", "forwardRecovery", "predecessorVersionId", "receiptDigest", "schema", "status",
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
    && values.length > 0
    && values.every((value) => IDENTIFIER_PATTERN.test(value))
    && new Set(values).size === values.length
    && values.every((value, index) => index === 0 || values[index - 1].localeCompare(value) < 0);
}

function readGraphAuthority(value) {
  if (!exactKeys(value, GRAPH_KEYS)
    || typeof value.authorityRef !== "string"
    || !value.authorityRef.startsWith(COMMERCE_ADMISSION_AUTHORITY_REF_PREFIX)
    || value.authorityRef.length > 384
    || !OPERATOR_REF_PATTERN.test(value.operatorInstructionRef ?? "")
    || !SHA_PATTERN.test(value.issuerRevision ?? "")
    || !DIGEST_PATTERN.test(value.evidenceDigest ?? "")) return null;
  return Object.freeze({ ...value });
}

function readHttpsOrigin(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.origin !== value
      || parsed.origin !== PRODUCTION_PUBLIC_ORIGIN
      || parsed.username || parsed.password || parsed.pathname !== "/"
      || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function createProductionCandidate(input) {
  validateProductionReleaseCandidate(input.releaseCandidate);
  const graphAuthority = readGraphAuthority(input.graphAuthority);
  const publicReadyOrigin = readHttpsOrigin(input.publicReadyOrigin);
  if (!graphAuthority || !publicReadyOrigin) throw new TypeError("Production release inputs are malformed.");
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
    webArtifactDigest: input.webArtifactDigest,
    requiredSecrets: [...new Set(input.requiredSecrets ?? [])].sort(),
    privateProviderContract: COMMERCE_ADMISSION_PROVIDER_CONTRACT,
    receiptSchema: COMMERCE_ADMISSION_RECEIPT_SCHEMA,
    releaseCandidate: input.releaseCandidate,
    graphAuthority,
    publicReadyOrigin,
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
    || !DIGEST_PATTERN.test(value.webArtifactDigest ?? "")
    || !uniqueSortedIdentifiers(value.requiredSecrets)
    || value.privateProviderContract !== COMMERCE_ADMISSION_PROVIDER_CONTRACT
    || value.receiptSchema !== COMMERCE_ADMISSION_RECEIPT_SCHEMA
    || value.releaseCandidate?.agenticCanvasOs?.repository !== PRODUCTION_REPOSITORY
    || value.releaseCandidate?.agenticCanvasOs?.revision !== value.sourceRevision
    || value.releaseCandidate?.agenticCanvasOs?.tree !== value.sourceTree
    || !readGraphAuthority(value.graphAuthority)
    || readHttpsOrigin(value.publicReadyOrigin) !== value.publicReadyOrigin) return null;
  try { validateProductionReleaseCandidate(value.releaseCandidate); } catch { return null; }
  const { candidateDigest, ...unsigned } = value;
  if (!DIGEST_PATTERN.test(candidateDigest ?? "") || digestValue(unsigned) !== candidateDigest) return null;
  return Object.freeze({
    ...value,
    requiredSecrets: Object.freeze([...value.requiredSecrets]),
    graphAuthority: Object.freeze({ ...value.graphAuthority }),
    releaseCandidate: Object.freeze({ ...value.releaseCandidate }),
  });
}

export function readProductionAuthority(value, candidate) {
  if (!exactKeys(value, AUTHORITY_KEYS)
    || value.schema !== PRODUCTION_AUTHORITY_SCHEMA
    || value.repository !== PRODUCTION_REPOSITORY
    || value.environment !== PRODUCTION_ENVIRONMENT
    || !Number.isSafeInteger(value.environmentId) || value.environmentId < 1
    || !Number.isSafeInteger(value.reviewerId) || value.reviewerId < 1
    || !IDENTIFIER_PATTERN.test(value.reviewerLogin ?? "") || value.reviewerLogin.endsWith("[bot]")
    || !validTimestamp(value.jobStartedAt)
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
    || !DIGEST_PATTERN.test(value.unmanagedBindingsDigest ?? "")) return null;
  return Object.freeze({ ...value });
}

export function readVersionEvidence(value, candidate) {
  const graphAuthority = readGraphAuthority(value?.graphAuthority);
  if (!exactKeys(value, VERSION_KEYS)
    || value.schema !== VERSION_EVIDENCE_SCHEMA
    || !UUID_PATTERN.test(value.versionId ?? "")
    || value.versionTag !== productionVersionTag(candidate.candidateDigest)
    || !validTimestamp(value.versionTimestamp)
    || value.sourceRevision !== candidate.sourceRevision
    || value.candidateDigest !== candidate.candidateDigest
    || !graphAuthority
    || canonicalJson(graphAuthority) !== canonicalJson(candidate.graphAuthority)
    || value.bindingTopologyDigest !== candidate.bindingTopologyDigest
    || !DIGEST_PATTERN.test(value.baselineUnmanagedBindingsDigest ?? "")
    || value.preservedUnmanagedBindingsDigest !== value.baselineUnmanagedBindingsDigest
    || value.versionMetadataBindings !== 1
    || !uniqueSortedIdentifiers(value.secretNames)
    || canonicalJson(value.secretNames) !== canonicalJson(candidate.requiredSecrets)) return null;
  return Object.freeze({
    ...value,
    graphAuthority,
    secretNames: Object.freeze([...value.secretNames]),
  });
}

export function deploymentIdentityFromVersion(version) {
  const identity = readCommerceDeploymentIdentity({
    schema: COMMERCE_DEPLOYMENT_IDENTITY_SCHEMA,
    sourceRevision: version.sourceRevision,
    candidateDigest: version.candidateDigest,
    versionId: version.versionId,
    versionTag: version.versionTag,
    versionTimestamp: version.versionTimestamp,
  });
  if (!identity) throw new TypeError("Cloudflare version does not yield an exact deployment identity.");
  return identity;
}

export function exactDeployment(left, right) {
  return Boolean(left && right
    && left.deploymentId === right.deploymentId
    && left.versionId === right.versionId
    && left.unmanagedBindingsDigest === right.unmanagedBindingsDigest
    && left.percentage === 100
    && right.percentage === 100);
}

export function readPreserveReceipt(value, candidate) {
  const active = value?.activeDeployment;
  const candidateVersionValid = UUID_PATTERN.test(value?.candidateVersionId ?? "")
    || (value?.candidateVersionId === null
      && ["candidate_version_identity_invalid", "upload_unconfirmed"].includes(value?.failure));
  const activeValid = active === null || (exactKeys(active, [
    "deploymentId", "percentage", "unmanagedBindingsDigest", "versionId",
  ])
    && IDENTIFIER_PATTERN.test(active.deploymentId ?? "")
    && UUID_PATTERN.test(active.versionId ?? "")
    && active.percentage === 100
    && DIGEST_PATTERN.test(active.unmanagedBindingsDigest ?? ""));
  if (!exactKeys(value, PRESERVE_KEYS)
    || value.schema !== PRESERVE_RECEIPT_SCHEMA
    || value.status !== "preserve-required"
    || value.candidateDigest !== candidate.candidateDigest
    || !candidateVersionValid
    || !UUID_PATTERN.test(value.predecessorVersionId ?? "")
    || !IDENTIFIER_PATTERN.test(value.failure ?? "")
    || !["observed", "unknown"].includes(value.activeState)
    || !activeValid
    || (value.activeState === "observed") !== (active !== null)
    || !exactKeys(value.forwardRecovery, ["mode", "required"])
    || value.forwardRecovery.required !== true
    || value.forwardRecovery.mode !== "reuse-exact-candidate-version"
    || !validTimestamp(value.completedAt)) return null;
  const { receiptDigest, ...unsigned } = value;
  if (!DIGEST_PATTERN.test(receiptDigest ?? "") || digestValue(unsigned) !== receiptDigest) return null;
  return Object.freeze({ ...value });
}

function withReceiptDigest(receipt) {
  return Object.freeze({ ...receipt, receiptDigest: digestValue(receipt) });
}

export function createDeploymentReceipt({
  candidate, authority, baseline, active, version, runtimeReadiness, recoveryReceipt, completedAt,
}) {
  return withReceiptDigest({
    schema: DEPLOYMENT_RECEIPT_SCHEMA,
    status: "deployed",
    candidateDigest: candidate.candidateDigest,
    sourceRevision: candidate.sourceRevision,
    authorizedReleaseCandidateDigest: candidate.releaseCandidate.candidateDigest,
    artifactDigest: candidate.releaseCandidate.artifact.digest,
    immutableManifestDigest: candidate.releaseCandidate.immutableManifest.digest,
    webArtifactDigest: candidate.webArtifactDigest,
    versionId: version.versionId,
    versionTag: version.versionTag,
    versionTimestamp: version.versionTimestamp,
    predecessorVersionId: recoveryReceipt?.predecessorVersionId ?? baseline.versionId,
    activeDeploymentId: active.deploymentId,
    unmanagedBindingsDigest: active.unmanagedBindingsDigest,
    graphAuthority: candidate.graphAuthority,
    recoveryReceiptDigest: recoveryReceipt?.receiptDigest ?? null,
    authorization: {
      environment: authority.environment,
      reviewerId: authority.reviewerId,
      reviewerLogin: authority.reviewerLogin,
      jobStartedAt: authority.jobStartedAt,
      runId: authority.runId,
      jobId: authority.jobId,
    },
    runtimeReadiness,
    completedAt,
  });
}

export function createPreserveReceipt({
  candidate, baseline, observedActive, failure, versionId = null, completedAt,
}) {
  return withReceiptDigest({
    schema: PRESERVE_RECEIPT_SCHEMA,
    status: "preserve-required",
    candidateDigest: candidate.candidateDigest,
    candidateVersionId: versionId,
    activeState: observedActive ? "observed" : "unknown",
    activeDeployment: observedActive ? {
      deploymentId: observedActive.deploymentId,
      versionId: observedActive.versionId,
      percentage: observedActive.percentage,
      unmanagedBindingsDigest: observedActive.unmanagedBindingsDigest,
    } : null,
    predecessorVersionId: baseline.versionId,
    failure,
    forwardRecovery: {
      required: true,
      mode: "reuse-exact-candidate-version",
    },
    completedAt,
  });
}
