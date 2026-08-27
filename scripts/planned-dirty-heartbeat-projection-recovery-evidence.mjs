// Responsibility: Seal one exact lost cloud heartbeat and its projection-only local successor.
import {
  assertActiveOwnedDirtWithinWriteSet,
  normalizeActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";
import { canonicalJson, digestValue, normalizeWriteSet }
  from "./cloud-collaboration-primitives.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import {
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export const EVIDENCE_SCHEMA =
  "agentic-planned-dirty-heartbeat-projection-recovery-evidence/v1";
export const PROJECTION_SCHEMA =
  "agentic-planned-dirty-heartbeat-projection/v1";
export const RECOVERY_RECEIPT_SCHEMA =
  "agentic-planned-dirty-heartbeat-projection-recovery-receipt/v1";

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const BODY_LIMIT = 65_536;

export function buildPlannedDirtyHeartbeatProjectionRecoveryEvidence(input = {}) {
  const observedAt = instant(input.observedAt, "observation");
  const sourceLease = normalizeSourceLease(input.sourceLease);
  const sourceLeaseDigest = writerLeaseDigest(sourceLease);
  const targetCloudAuthority = normalizeCloudAuthority(input.targetCloudAuthority, true);
  const ownedDirt = assertActiveOwnedDirtWithinWriteSet({
    evidence: normalizeActiveOwnedDirtEvidence(input.ownedDirt),
    declaredWriteSet: sourceLease.admission.declaredWriteSet,
  });
  const projection = buildProjection({ sourceLease, targetCloudAuthority, observedAt });
  const recoveryReceipt = buildRegistryOnlyReceipt({
    sourceLeaseDigest,
    sourceAuthorityDigest: projection.sourceAuthorityDigest,
    targetAuthorityDigest: projection.targetAuthorityDigest,
    projectionDigest: projection.projectionDigest,
    dirtDigest: ownedDirt.evidenceDigest,
    projectedAt: observedAt,
  });
  const targetLease = deepFreeze({
    ...sourceLease,
    cloudAuthority: targetCloudAuthority,
    heartbeatAt: projection.heartbeatAt,
    expiresAt: projection.expiresAt,
    plannedDirtyHeartbeatProjectionRecovery: recoveryReceipt,
  });
  validateTargetLease({ sourceLease, targetLease, recoveryReceipt });

  const repository = normalizeRepository(input.repository);
  const registry = normalizeRegistry(input.registry, sourceLeaseDigest);
  const pullRequest = normalizePullRequest(input.pullRequest);
  const sourceMarker = projectWriterLeasePullRequestMarker(sourceLease);
  const observedMarker = parseWriterLeasePullRequestBody(pullRequest.body);
  const targetMarker = projectWriterLeasePullRequestMarker(targetLease);
  const targetBody = updateWriterLeasePullRequestBody(pullRequest.body, targetLease);
  if (Buffer.byteLength(targetBody) > BODY_LIMIT) invalid("bounded full target marker body");

  assertJoinedSource({ sourceLease, repository, pullRequest, ownedDirt,
    sourceMarker, observedMarker });
  const targetHeartbeatCounter = nonnegative(input.inventoryHeartbeatCounter,
    "verified inventory heartbeat counter");
  if (targetHeartbeatCounter !== targetCloudAuthority.heartbeatCounter) {
    invalid("inventory-backed target heartbeat counter");
  }

  const core = {
    schema: EVIDENCE_SCHEMA,
    observedAt,
    repositoryPathDigest: digest(input.repositoryPathDigest, "repository path digest"),
    sourceLease,
    sourceLeaseDigest,
    targetLease,
    targetLeaseDigest: writerLeaseDigest(targetLease),
    registry,
    repository,
    ownedDirt,
    dirtDigest: ownedDirt.evidenceDigest,
    pullRequest,
    sourceBodyDigest: digestValue(pullRequest.body),
    targetBody,
    targetBodyDigest: digestValue(targetBody),
    sourceMarkerDigest: digestValue(sourceMarker),
    targetMarkerDigest: digestValue(targetMarker),
    targetCloudAuthority,
    targetCloudAuthorityDigest: digestValue(targetCloudAuthority),
    inventoryHeartbeatCounter: targetHeartbeatCounter,
    cloudVerificationReceiptDigest: digest(input.cloudVerificationReceiptDigest,
      "cloud verification receipt digest"),
    mutationAuthorityReceiptDigest: digest(input.mutationAuthorityReceiptDigest,
      "mutation-authority receipt digest"),
    projection,
    recoveryReceipt,
  };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizePlannedDirtyHeartbeatProjectionRecoveryEvidence(value) {
  const source = record(value, "recovery evidence");
  const normalized = buildPlannedDirtyHeartbeatProjectionRecoveryEvidence({
    observedAt: source.observedAt,
    repositoryPathDigest: source.repositoryPathDigest,
    sourceLease: source.sourceLease,
    targetCloudAuthority: source.targetCloudAuthority,
    ownedDirt: source.ownedDirt,
    registry: source.registry,
    repository: source.repository,
    pullRequest: source.pullRequest,
    inventoryHeartbeatCounter: source.inventoryHeartbeatCounter,
    cloudVerificationReceiptDigest: source.cloudVerificationReceiptDigest,
    mutationAuthorityReceiptDigest: source.mutationAuthorityReceiptDigest,
  });
  if (canonicalJson(source) !== canonicalJson(normalized)) invalid("canonical evidence");
  return normalized;
}

export function requireSameRecoveryOwnedDirt(expected, observed) {
  const left = normalizeActiveOwnedDirtEvidence(expected);
  const right = normalizeActiveOwnedDirtEvidence(observed);
  if (left.evidenceDigest !== right.evidenceDigest) {
    invalid("unchanged planned dirty bytes, modes, paths, and index");
  }
  return right;
}

export function buildProjection({ sourceLease, targetCloudAuthority, observedAt }) {
  const source = normalizeCloudAuthority(sourceLease.cloudAuthority, false);
  const target = normalizeCloudAuthority(targetCloudAuthority, true);
  const sourceHeartbeat = source.heartbeatCounter ?? 0;
  if (canonicalJson(stableAuthority(source)) !== canonicalJson(stableAuthority(target))) {
    invalid("immutable cloud claim identity, scope, base, fence, review, or integration");
  }
  if (target.transitionCounter !== source.transitionCounter + 1
    || target.heartbeatCounter !== sourceHeartbeat + 1) {
    invalid("exact one-transition one-heartbeat successor");
  }
  const changing = ["claimDigest", "claimLedgerRevision", "operationReceiptDigest",
    "ledgerRevision", "ledgerDigest"];
  if (changing.some(field => target[field] === source[field])
    || Date.parse(target.expiresAt) <= Date.parse(source.expiresAt)) {
    invalid("strictly renewed cloud heartbeat fields and expiry");
  }
  const heartbeatAt = instant(observedAt, "projection heartbeat");
  const sourceTtl = Date.parse(sourceLease.expiresAt) - Date.parse(sourceLease.heartbeatAt);
  if (!Number.isSafeInteger(sourceTtl) || sourceTtl < 1) invalid("positive source local TTL");
  const expiresAt = new Date(Math.min(
    Date.parse(heartbeatAt) + sourceTtl,
    Date.parse(target.expiresAt),
  )).toISOString();
  if (Date.parse(expiresAt) <= Date.parse(sourceLease.expiresAt)
    || Date.parse(expiresAt) <= Date.parse(heartbeatAt)
    || Date.parse(expiresAt) > Date.parse(target.expiresAt)
    || Date.parse(expiresAt) - Date.parse(heartbeatAt) > sourceTtl) {
    invalid("growing TTL-capped local heartbeat window");
  }
  const core = {
    schema: PROJECTION_SCHEMA,
    sourceAuthorityDigest: digestValue(sourceLease.cloudAuthority),
    targetAuthorityDigest: digestValue(target),
    sourceTransitionCounter: source.transitionCounter,
    targetTransitionCounter: target.transitionCounter,
    sourceHeartbeatCounter: sourceHeartbeat,
    targetHeartbeatCounter: target.heartbeatCounter,
    sourceHeartbeatAt: sourceLease.heartbeatAt,
    sourceExpiresAt: sourceLease.expiresAt,
    heartbeatAt,
    expiresAt,
    sourceTtlMs: sourceTtl,
  };
  return deepFreeze({ ...core, projectionDigest: digestValue(core) });
}

function buildRegistryOnlyReceipt(values) {
  const core = {
    schema: RECOVERY_RECEIPT_SCHEMA,
    operation: "planned-dirty-heartbeat-projection-recovery",
    sourceLeaseDigest: digest(values.sourceLeaseDigest, "receipt source lease digest"),
    sourceAuthorityDigest: digest(values.sourceAuthorityDigest,
      "receipt source authority digest"),
    targetAuthorityDigest: digest(values.targetAuthorityDigest,
      "receipt target authority digest"),
    projectionDigest: digest(values.projectionDigest, "receipt projection digest"),
    dirtDigest: digest(values.dirtDigest, "receipt dirt digest"),
    projectedAt: instant(values.projectedAt, "receipt projectedAt"),
    cloudMutation: false,
    gitMutation: false,
    sourceMutation: false,
    pullRequestStateMutation: false,
    integrationMutation: false,
    deploymentMutation: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizeSourceLease(value) {
  const lease = structuredClone(record(value, "source writer lease"));
  if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || lease.admission?.schema !== "agentic-lane-admission-lease/v1"
    || lease.admission.status !== "planned"
    || (lease.integration !== null && lease.integration !== undefined)
    || lease.plannedDirtyHeartbeatProjectionRecovery !== undefined) {
    invalid("active unrecovered planned source lease without integration");
  }
  for (const [candidate, label] of [[lease.sessionId, "lease session"],
    [lease.device, "lease device"], [lease.scope, "lease scope"],
    [lease.branch, "lease branch"], [lease.worktreePath, "lease worktree"],
    [lease.pullRequestUrl, "lease pull request"]]) text(candidate, label);
  positive(lease.epoch, "local lease epoch");
  sha(lease.baseSha, "lease base"); sha(lease.fenceSha, "lease fence");
  instant(lease.heartbeatAt, "lease heartbeat"); instant(lease.expiresAt, "lease expiry");
  lease.cloudAuthority = normalizeCloudAuthority(lease.cloudAuthority, false);
  lease.admission.declaredWriteSet = normalizeWriteSet(lease.admission.declaredWriteSet);
  if (lease.admission.semanticScope !== lease.scope
    || lease.admission.writeSetDigest !== digestValue(lease.admission.declaredWriteSet)
    || lease.admission.writeSetDigest !== lease.cloudAuthority.writeSetDigest
    || lease.admission.manifestDigest !== lease.cloudAuthority.manifestDigest) {
    invalid("planned admission and cloud scope");
  }
  lease.taskAuthority = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  return deepFreeze(lease);
}

function normalizeCloudAuthority(value, requireHeartbeat) {
  const authority = structuredClone(record(value, "cloud authority"));
  if (authority.schema !== "agentic-lane-cloud-authority/v1"
    || authority.state !== "active" || authority.mutationAuthorityEligible !== true
    || authority.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || authority.claimIdentitySchema !== authority.entrySchema
    || (authority.integrationReceiptDigest !== null
      && authority.integrationReceiptDigest !== undefined)
    || (authority.integration !== null && authority.integration !== undefined)) {
    invalid("active non-integrated cloud authority");
  }
  for (const [candidate, label] of [[authority.provider, "provider"],
    [authority.ledgerRepository, "ledger repository"],
    [authority.targetRepository, "target repository"], [authority.deviceId, "device"],
    [authority.sessionId, "session"], [authority.reviewRequestId, "review request"]]) {
    text(candidate, label);
  }
  for (const [candidate, label] of [[authority.claimId, "claim ID"],
    [authority.claimDigest, "claim digest"], [authority.ledgerDigest, "ledger digest"],
    [authority.claimLedgerRevision, "transition digest"],
    [authority.operationReceiptDigest, "operation receipt"],
    [authority.writeSetDigest, "write set"], [authority.manifestDigest, "manifest"]]) {
    digest(candidate, label);
  }
  sha(authority.ledgerRevision, "ledger revision");
  sha(authority.canonicalBaseSha, "authority base");
  sha(authority.laneRevision, "authority lane");
  positive(authority.leaseEpoch, "cloud lease epoch");
  positive(authority.transitionCounter, "transition counter");
  if (requireHeartbeat || authority.heartbeatCounter !== undefined) {
    nonnegative(authority.heartbeatCounter, "heartbeat counter");
  }
  instant(authority.expiresAt, "authority expiry");
  authority.cloudDeclaredWriteScope = normalizeWriteSet(authority.cloudDeclaredWriteScope);
  if (authority.writeSetDigest !== digestValue(authority.cloudDeclaredWriteScope)) {
    invalid("content-derived cloud write set");
  }
  return deepFreeze(authority);
}

function stableAuthority(value) {
  const copy = structuredClone(value);
  for (const key of ["claimDigest", "ledgerRevision", "ledgerDigest",
    "claimLedgerRevision", "operationReceiptDigest", "transitionCounter",
    "heartbeatCounter", "expiresAt"]) delete copy[key];
  return copy;
}

function normalizeRepository(value) {
  const source = record(value, "repository evidence");
  return deepFreeze({
    branch: text(source.branch, "repository branch"),
    headSha: sha(source.headSha, "HEAD"),
    localRefSha: sha(source.localRefSha, "local ref"),
    remoteRefSha: sha(source.remoteRefSha, "remote ref"),
    registered: source.registered === true,
  });
}

function normalizeRegistry(value, leaseDigest) {
  const source = record(value, "registry evidence");
  const result = {
    schema: source.schema,
    revision: nonnegative(source.revision, "registry revision"),
    registryDigest: digest(source.registryDigest, "registry digest"),
    leaseDigest: digest(source.leaseDigest, "registry lease digest"),
  };
  if (result.schema !== "agentic-writer-lease-registry/v2"
    || result.leaseDigest !== leaseDigest) invalid("source writer registry");
  return deepFreeze(result);
}

function normalizePullRequest(value) {
  const source = record(value, "pull request evidence");
  if (typeof source.body !== "string" || Buffer.byteLength(source.body) > BODY_LIMIT) {
    invalid("bounded source pull-request body");
  }
  return deepFreeze({
    id: text(source.id, "pull-request ID"),
    number: positive(source.number, "pull-request number"),
    url: text(source.url, "pull-request URL"),
    state: text(source.state, "pull-request state"),
    isDraft: source.isDraft === true,
    autoMergeRequest: source.autoMergeRequest ?? null,
    headRepository: text(source.headRepository, "pull-request head repository"),
    headRefName: text(source.headRefName, "pull-request head branch"),
    headRefOid: sha(source.headRefOid, "pull-request head"),
    baseRefName: text(source.baseRefName, "pull-request base branch"),
    body: source.body,
  });
}

function assertJoinedSource({ sourceLease, repository, pullRequest, ownedDirt,
  sourceMarker, observedMarker }) {
  const authority = sourceLease.cloudAuthority;
  if (!repository.registered || repository.branch !== sourceLease.branch
    || repository.headSha !== sourceLease.fenceSha
    || repository.localRefSha !== sourceLease.fenceSha
    || repository.remoteRefSha !== sourceLease.fenceSha
    || ownedDirt.headSha !== sourceLease.fenceSha
    || pullRequest.state !== "OPEN" || !pullRequest.isDraft
    || pullRequest.autoMergeRequest !== null
    || pullRequest.url !== sourceLease.pullRequestUrl
    || pullRequest.headRepository !== authority.targetRepository
    || pullRequest.headRefName !== sourceLease.branch
    || pullRequest.headRefOid !== sourceLease.fenceSha
    || pullRequest.baseRefName !== "main"
    || authority.deviceId !== sourceLease.device
    || authority.sessionId !== sourceLease.sessionId
    || authority.canonicalBaseSha !== sourceLease.baseSha
    || authority.laneRevision !== sourceLease.fenceSha
    || authority.reviewRequestId !== `github-pull-request:${pullRequest.id}`
    || digestValue(observedMarker) !== digestValue(sourceMarker)) {
    invalid("joined source lease, dirt, refs, cloud claim, and draft review");
  }
}

function validateTargetLease({ sourceLease, targetLease, recoveryReceipt }) {
  const strip = lease => {
    const copy = structuredClone(lease);
    delete copy.cloudAuthority; delete copy.heartbeatAt; delete copy.expiresAt;
    delete copy.plannedDirtyHeartbeatProjectionRecovery;
    return copy;
  };
  if (canonicalJson(strip(sourceLease)) !== canonicalJson(strip(targetLease))
    || targetLease.admission.status !== "planned"
    || targetLease.plannedDirtyHeartbeatProjectionRecovery.receiptDigest
      !== recoveryReceipt.receiptDigest) invalid("projection-only target lease");
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function sha(value, label) {
  if (!SHA.test(String(value || ""))) invalid(label);
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegative(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function instant(value, label) {
  if (!value || new Date(value).toISOString() !== value) invalid(label);
  return value;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function invalid(label) {
  throw new Error(`Planned-dirty heartbeat projection recovery has invalid ${label}.`);
}
