// Responsibility: Normalize and prove one device-only owner projection gap.
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import {
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
} from "./writer-lease-lib.mjs";

export const PLANNED_DEVICE_PROJECTION_RECOVERY_EVIDENCE_SCHEMA =
  "agentic-planned-device-projection-recovery-evidence/v1";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function buildPlannedDeviceProjectionRecoveryEvidence(input = {}) {
  const lease = structuredClone(object(input.sourceLease, "source lease"));
  const claim = structuredClone(object(input.claim, "cloud claim"));
  const manifest = normalizeManifest(input.manifest);
  const repository = normalizeRepository(input.repository);
  const review = normalizeReview(input.review);
  const observedAt = instant(input.observedAt, "observation");
  assertSourceLease(lease, repository, observedAt);
  assertFence(repository, lease);
  assertClaim({ claim, lease, manifest, review });
  assertReview({ lease, review });
  const expectedDeviceId = normalizeOwnerIdentifier("device", lease.device);
  const expectedSessionId = normalizeOwnerIdentifier("session", lease.sessionId);
  const sourceDeviceId = text(claim.deviceId, "claim device");
  const sourceSessionId = text(claim.sessionId, "claim session");
  if (sourceDeviceId === expectedDeviceId || sourceSessionId !== expectedSessionId) {
    throw new Error("Recovery requires exactly one device-only owner projection gap.");
  }
  const core = {
    schema: PLANNED_DEVICE_PROJECTION_RECOVERY_EVIDENCE_SCHEMA,
    observedAt,
    sourceLease: lease,
    sourceLeaseDigest: writerLeaseDigest(lease),
    manifest,
    repository,
    review,
    cloud: {
      claim,
      inventoryDigest: digest(input.inventoryDigest, "inventory digest"),
      sourceDeviceId,
      sourceSessionId,
      expectedDeviceId,
      expectedSessionId,
      mismatch: "device-only",
    },
  };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizePlannedDeviceProjectionRecoveryEvidence(value) {
  const source = object(value, "recovery evidence");
  const normalized = buildPlannedDeviceProjectionRecoveryEvidence({
    observedAt: source.observedAt,
    sourceLease: source.sourceLease,
    manifest: source.manifest,
    repository: source.repository,
    review: source.review,
    claim: source.cloud?.claim,
    inventoryDigest: source.cloud?.inventoryDigest,
  });
  if (source.sourceLeaseDigest !== normalized.sourceLeaseDigest
    || source.cloud?.sourceDeviceId !== normalized.cloud.sourceDeviceId
    || source.cloud?.sourceSessionId !== normalized.cloud.sourceSessionId
    || source.cloud?.expectedDeviceId !== normalized.cloud.expectedDeviceId
    || source.cloud?.expectedSessionId !== normalized.cloud.expectedSessionId
    || source.cloud?.mismatch !== "device-only"
    || source.evidenceDigest !== normalized.evidenceDigest
    || JSON.stringify(source) !== JSON.stringify(normalized)) {
    throw new Error("Planned device-projection recovery evidence is not canonical.");
  }
  return normalized;
}

export function normalizeOwnerIdentifier(namespace, value) {
  const candidate = text(value, `${namespace} identity`);
  const prefix = `${namespace}:`;
  if (candidate.startsWith(prefix) && DIGEST_PATTERN.test(candidate.slice(prefix.length))) {
    return candidate;
  }
  return pseudonymousIdentifier(namespace, candidate);
}

function normalizeManifest(value) {
  const manifest = object(value, "manifest");
  const declaredWriteSet = normalizeWriteSet(manifest.declaredWriteSet);
  const writeSetDigest = digest(manifest.writeSetDigest, "manifest write-set digest");
  const manifestDigest = digest(manifest.manifestDigest, "manifest digest");
  if (writeSetDigest !== digestValue(declaredWriteSet)) {
    throw new Error("Manifest write set is not content-derived.");
  }
  return { declaredWriteSet, writeSetDigest, manifestDigest };
}

function normalizeRepository(value) {
  const repository = object(value, "repository evidence");
  return {
    canonicalPath: absolute(repository.canonicalPath, "canonical path"),
    worktreePath: absolute(repository.worktreePath, "worktree path"),
    targetRepository: text(repository.targetRepository, "target repository"),
    branch: text(repository.branch, "branch"),
    baseSha: sha(repository.baseSha, "base"),
    fenceSha: sha(repository.fenceSha, "fence"),
    fenceTreeSha: sha(repository.fenceTreeSha, "fence tree"),
    baseTreeSha: sha(repository.baseTreeSha, "base tree"),
    headSha: sha(repository.headSha, "head"),
    remoteHeadSha: sha(repository.remoteHeadSha, "remote head"),
    clean: repository.clean === true,
    canonicalHeadSha: sha(repository.canonicalHeadSha, "canonical head"),
    canonicalRemoteSha: sha(repository.canonicalRemoteSha, "canonical remote"),
    canonicalClean: repository.canonicalClean === true,
  };
}

function normalizeReview(value) {
  const review = object(value, "review evidence");
  return {
    id: text(review.id, "review id"),
    number: positive(review.number, "review number"),
    url: text(review.url, "review URL"),
    state: text(review.state, "review state"),
    isDraft: review.isDraft === true,
    autoMergeAbsent: review.autoMergeAbsent === true,
    headRepository: text(review.headRepository, "review head repository"),
    headBranch: text(review.headBranch, "review head branch"),
    headSha: sha(review.headSha, "review head"),
    baseBranch: text(review.baseBranch, "review base branch"),
    body: text(review.body, "review body"),
    bodyDigest: digest(review.bodyDigest, "review body digest"),
    markerDigest: digest(review.markerDigest, "review marker digest"),
  };
}

function assertSourceLease(lease, repository, observedAt) {
  if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || lease.admission?.status !== "planned" || !lease.taskAuthority
    || lease.branch !== repository.branch || lease.worktreePath !== repository.worktreePath
    || lease.baseSha !== repository.baseSha || lease.fenceSha !== repository.fenceSha
    || !Number.isFinite(Date.parse(lease.expiresAt))
    || Date.parse(lease.expiresAt) > Date.parse(observedAt)) {
    throw new Error("Recovery requires one exact expired active planned task-bound source lease.");
  }
}

function assertFence(repository, lease) {
  if (!repository.clean || !repository.canonicalClean
    || repository.headSha !== lease.fenceSha
    || repository.remoteHeadSha !== lease.fenceSha
    || repository.fenceTreeSha !== repository.baseTreeSha
    || repository.canonicalHeadSha !== repository.canonicalRemoteSha) {
    throw new Error("Recovery requires a clean fence-only lane and clean current canonical source.");
  }
}

function assertClaim({ claim, lease, manifest, review }) {
  const authority = object(lease.cloudAuthority, "source cloud authority");
  const expectedScope = JSON.stringify(manifest.declaredWriteSet);
  if (claim.state !== "dormant-preserved" || claim.writeAuthority !== false
    || claim.scopeReserved !== true || claim.claimId !== authority.claimId
    || claim.fenceRevision === authority.claimDigest
    || claim.transitionDigest === authority.claimLedgerRevision
    || claim.transitionCounter !== authority.transitionCounter + 1
    || claim.canonicalBaseRevision !== lease.baseSha
    || claim.laneRevision !== lease.fenceSha
    || authority.canonicalBaseSha !== lease.baseSha
    || authority.laneRevision !== lease.baseSha
    || claim.writeSetDigest !== manifest.writeSetDigest
    || JSON.stringify(normalizeWriteSet(claim.declaredWriteScope)) !== expectedScope
    || claim.leaseEpoch !== authority.leaseEpoch
    || claim.deviceId !== authority.deviceId
    || claim.sessionId !== authority.sessionId
    || authority.reviewRequestId !== null
    || claim.reviewRequestId == null
    || claim.reviewRequestId !== `github-pull-request:${review.id}`
    || typeof claim.operationReceiptDigest !== "string"
    || !DIGEST_PATTERN.test(claim.operationReceiptDigest)
    || review.state !== "OPEN" || !review.isDraft || !review.autoMergeAbsent
    || review.headRepository !== authority.targetRepository
    || review.headBranch !== lease.branch || review.headSha !== lease.fenceSha
    || review.baseBranch !== "main" || review.url !== lease.pullRequestUrl) {
    throw new Error("Cloud, review, and lease evidence do not describe one exact partial planned admission.");
  }
}

function assertReview({ lease, review }) {
  const marker = parseWriterLeasePullRequestBody(review.body);
  if (review.bodyDigest !== digestValue(review.body)
    || review.markerDigest !== digestValue(marker)
    || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
    throw new Error("Draft review marker must contain the exact source writer lease.");
  }
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is required.`);
  }
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value;
}
function digest(value, label) {
  const result = text(value, label);
  if (!DIGEST_PATTERN.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}
function sha(value, label) {
  const result = text(value, label);
  if (!SHA_PATTERN.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}
function instant(value, label) {
  const result = text(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} is invalid.`);
  return new Date(result).toISOString();
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`);
  return value;
}
function absolute(value, label) {
  const result = text(value, label);
  if (!result.startsWith("/")) throw new Error(`${label} must be absolute.`);
  return result;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
