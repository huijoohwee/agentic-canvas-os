// Responsibility: Seal the exact current-cloud/expired-local owned-dirt continuation subject.
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import {
  assertActiveOwnedDirtWithinWriteSet,
  normalizeActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export const CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_EVIDENCE_SCHEMA =
  "agentic-current-cloud-expired-local-owned-dirt-continuation-evidence/v1";

export function buildCurrentCloudExpiredLocalOwnedDirtContinuationEvidence(input = {}) {
  const core = normalizeCore({
    schema: CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_EVIDENCE_SCHEMA,
    repository: input.repository,
    observedAt: input.observedAt,
    lease: input.lease,
    leaseDigest: input.leaseDigest ?? writerLeaseDigest(input.lease),
    cloudClaim: input.cloudClaim,
    cloudObservation: input.cloudObservation,
    ownedDirt: input.ownedDirt,
    taskCapabilityDigest: input.taskCapabilityDigest,
    mutationBoundary: input.mutationBoundary ?? defaultMutationBoundary(),
  });
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeCurrentCloudExpiredLocalOwnedDirtContinuationEvidence(value) {
  const source = record(value, "evidence");
  const core = normalizeCore(source);
  const rebuilt = deepFreeze({ ...core, evidenceDigest: source.evidenceDigest });
  if (digest(source.evidenceDigest, "evidence digest") !== digestValue(core)
    || canonicalJson(source) !== canonicalJson(rebuilt)) invalid("canonical evidence");
  return rebuilt;
}

function normalizeCore(value) {
  if (value.schema !== CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_EVIDENCE_SCHEMA) {
    invalid("schema");
  }
  const observedAt = instant(value.observedAt, "observedAt");
  const lease = normalizeLease(value.lease);
  const leaseDigest = digest(value.leaseDigest, "lease digest");
  const cloudClaim = normalizeCloudClaim(value.cloudClaim);
  const cloudObservation = normalizeCloudObservation(value.cloudObservation);
  const ownedDirt = assertActiveOwnedDirtWithinWriteSet({
    evidence: normalizeActiveOwnedDirtEvidence(value.ownedDirt),
    declaredWriteSet: lease.admission.declaredWriteSet,
  });
  const core = {
    schema: value.schema,
    repository: text(value.repository, "repository"),
    observedAt,
    lease,
    leaseDigest,
    cloudClaim,
    cloudObservation,
    ownedDirt,
    taskCapabilityDigest: digest(value.taskCapabilityDigest, "task capability digest"),
    mutationBoundary: normalizeMutationBoundary(value.mutationBoundary),
  };
  assertJoinedSubject(core);
  return deepFreeze(core);
}

function normalizeLease(value) {
  const source = structuredClone(record(value, "writer lease"));
  const admission = record(source.admission, "lease admission");
  const authority = record(source.cloudAuthority, "lease cloud authority");
  const declaredWriteSet = normalizeWriteSet(admission.declaredWriteSet);
  if (source.status !== "active" || admission.status !== "admitted") invalid("admitted lease");
  text(source.branch, "lease branch");
  text(source.sessionId, "lease session");
  text(source.device, "lease device");
  sha(source.baseSha, "lease base SHA");
  sha(source.fenceSha, "lease fence SHA");
  positiveInteger(source.epoch, "lease epoch");
  instant(source.heartbeatAt, "lease heartbeat");
  instant(source.expiresAt, "lease expiry");
  digest(admission.manifestDigest, "manifest digest");
  digest(admission.writeSetDigest, "write-set digest");
  digest(authority.claimId, "lease claim ID");
  digest(authority.claimDigest, "lease claim digest");
  positiveInteger(authority.leaseEpoch, "cloud lease epoch");
  nonnegativeInteger(authority.transitionCounter, "cloud transition counter");
  nonnegativeInteger(authority.heartbeatCounter ?? 0, "cloud heartbeat counter");
  if (admission.writeSetDigest !== digestValue(declaredWriteSet)) invalid("lease write set");
  source.admission = { ...admission, declaredWriteSet };
  return deepFreeze(source);
}

function normalizeCloudClaim(value) {
  const source = structuredClone(record(value, "current cloud claim"));
  if (source.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || source.claimIdentitySchema !== "agentic-cloud-collaboration-entry/v2"
    || source.state !== "current" || source.writeAuthority !== true
    || source.scopeReserved !== true) invalid("current cloud authority");
  digest(source.claimId, "cloud claim ID");
  digest(source.fenceRevision, "cloud claim digest");
  digest(source.transitionDigest, "cloud transition digest");
  digest(source.operationReceiptDigest, "cloud operation receipt digest");
  sha(source.canonicalBaseRevision, "cloud base SHA");
  sha(source.laneRevision, "cloud lane SHA");
  positiveInteger(source.leaseEpoch, "cloud lease epoch");
  nonnegativeInteger(source.transitionCounter, "cloud transition counter");
  nonnegativeInteger(source.heartbeatCounter ?? 0, "cloud heartbeat counter");
  instant(source.expiresAt, "cloud expiry");
  source.declaredWriteScope = normalizeWriteSet(source.declaredWriteScope);
  if (source.writeSetDigest !== digestValue(source.declaredWriteScope)) invalid("cloud write set");
  return deepFreeze(source);
}

function normalizeCloudObservation(value) {
  const source = record(value, "cloud observation");
  const core = {
    status: source.status === "ready" ? "ready" : invalid("cloud observation status"),
    evaluatedAt: instant(source.evaluatedAt, "cloud evaluatedAt"),
    ledgerRevision: sha(source.ledgerRevision, "cloud ledger revision"),
    ledgerDigest: digest(source.ledgerDigest, "cloud ledger digest"),
    inventoryDigest: digest(source.inventoryDigest, "cloud inventory digest"),
    verificationReceiptDigest: digest(
      source.verificationReceiptDigest,
      "cloud verification receipt digest",
    ),
    overlappingClaimIds: array(source.overlappingClaimIds, "overlapping claim IDs")
      .map((item) => digest(item, "overlapping claim ID")).sort(),
  };
  if (core.overlappingClaimIds.length > 0) invalid("overlapping cloud claim");
  return deepFreeze(core);
}

function assertJoinedSubject(subject) {
  const { lease, leaseDigest, cloudClaim: claim, cloudObservation: cloud, ownedDirt } = subject;
  const authority = lease.cloudAuthority;
  if (writerLeaseDigest(lease) !== leaseDigest
    || Date.parse(lease.expiresAt) > Date.parse(subject.observedAt)
    || Date.parse(claim.expiresAt) <= Date.parse(subject.observedAt)
    || cloud.evaluatedAt !== subject.observedAt
    || claim.claimId !== authority.claimId
    || claim.fenceRevision !== authority.claimDigest
    || claim.canonicalBaseRevision !== lease.baseSha
    || claim.laneRevision !== lease.fenceSha
    || claim.leaseEpoch !== authority.leaseEpoch
    || claim.transitionCounter !== authority.transitionCounter
    || (claim.heartbeatCounter ?? 0) !== (authority.heartbeatCounter ?? 0)
    || claim.writeSetDigest !== lease.admission.writeSetDigest
    || subject.taskCapabilityDigest !== lease.taskAuthority?.bindingDigest
    || canonicalJson(claim.declaredWriteScope)
      !== canonicalJson(lease.admission.declaredWriteSet)
    || ownedDirt.headSha !== lease.fenceSha) {
    invalid("cloud, lease, or owned-dirt join");
  }
}

function defaultMutationBoundary() {
  return {
    allowedMutations: ["writer-lease-registry-cas"],
    forbiddenEffects: [
      "cloud-mutation", "source-mutation", "git-mutation", "remote-ref-mutation",
      "pull-request-mutation", "new-claim", "new-worktree", "deployment", "cleanup",
    ],
  };
}

function normalizeMutationBoundary(value) {
  const source = record(value, "mutation boundary");
  const allowedMutations = array(source.allowedMutations, "allowed mutations");
  const forbiddenEffects = array(source.forbiddenEffects, "forbidden effects");
  if (canonicalJson(allowedMutations) !== canonicalJson(defaultMutationBoundary().allowedMutations)
    || canonicalJson(forbiddenEffects) !== canonicalJson(defaultMutationBoundary().forbiddenEffects)) {
    invalid("mutation boundary");
  }
  return deepFreeze({ allowedMutations: [...allowedMutations], forbiddenEffects: [...forbiddenEffects] });
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function array(value, label) { if (!Array.isArray(value)) invalid(label); return value; }
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) invalid(label);
  return value;
}
function digest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function sha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function instant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(label);
  return value;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
function invalid(label) {
  throw new Error(`Current-cloud expired-local owned-dirt evidence has invalid ${label}.`);
}
