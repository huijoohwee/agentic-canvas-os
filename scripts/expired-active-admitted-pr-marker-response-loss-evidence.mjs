// Responsibility: Prove one sealed active marker repair remains exact after lease expiry.
import {
  canonicalJson,
  digestValue,
  normalizeWriteSet,
  validateLedger,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { normalizeActiveAdmittedPrMarkerResponseLossPlan }
  from "./active-admitted-pr-marker-response-loss-contract.mjs";

export const EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_EVIDENCE_SCHEMA =
  "agentic-expired-active-admitted-pr-marker-response-loss-evidence/v1";

const ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
const PROVIDER_SEMANTICS = "observable-pre-read-edit-post-read";

export function buildExpiredActiveAdmittedPrMarkerResponseLossEvidence(input = {}) {
  const predecessorPlan = normalizeActiveAdmittedPrMarkerResponseLossPlan(
    input.predecessorPlan,
  );
  const observedAt = instant(input.observedAt, "observedAt");
  const currentLedger = ledgerSnapshot(input.currentLedgerSnapshot);
  const cloud = proveExpiredCloud({
    predecessorPlan,
    currentLedger,
    liveCloud: input.liveCloud,
    observedAt,
  });
  const core = normalizeCore({
    schema: EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_EVIDENCE_SCHEMA,
    repository: input.repository,
    observedAt,
    predecessorPlanDigest: predecessorPlan.planDigest,
    predecessorEvidenceDigest: predecessorPlan.evidence.evidenceDigest,
    predecessorPlanSnapshot: predecessorPlan,
    worktree: input.worktree,
    lease: input.lease,
    providerReview: input.providerReview,
    cloud,
    mutationBoundary: input.mutationBoundary || defaultMutationBoundary(),
  });
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeExpiredActiveAdmittedPrMarkerResponseLossEvidence(value) {
  const source = object(value, "evidence");
  const core = normalizeCore(source);
  const rebuilt = deepFreeze({ ...core, evidenceDigest: source.evidenceDigest });
  if (source.evidenceDigest !== digestValue(core)
    || canonicalJson(source) !== canonicalJson(rebuilt)) invalid("canonical evidence");
  return rebuilt;
}

function normalizeCore(value) {
  if (value.schema !== EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_EVIDENCE_SCHEMA) {
    invalid("schema");
  }
  const predecessorPlan = normalizeActiveAdmittedPrMarkerResponseLossPlan(
    value.predecessorPlanSnapshot,
  );
  const predecessor = predecessorPlan.evidence;
  const worktree = normalizeWorktree(value.worktree);
  const lease = normalizeLease(value.lease);
  const providerReview = normalizeProviderReview(value.providerReview);
  const cloud = normalizeCloudProof(value.cloud);
  const observedAt = instant(value.observedAt, "observedAt");
  const core = {
    schema: value.schema,
    repository: text(value.repository, "repository"),
    observedAt,
    predecessorPlanDigest: digest(value.predecessorPlanDigest, "predecessor plan digest"),
    predecessorEvidenceDigest: digest(
      value.predecessorEvidenceDigest,
      "predecessor evidence digest",
    ),
    predecessorPlanSnapshot: predecessorPlan,
    worktree,
    lease,
    providerReview,
    cloud,
    mutationBoundary: normalizeMutationBoundary(value.mutationBoundary),
  };
  if (core.predecessorPlanDigest !== predecessorPlan.planDigest
    || core.predecessorEvidenceDigest !== predecessor.evidenceDigest
    || core.repository !== predecessor.repository
    || Date.parse(observedAt) < Date.parse(lease.expiresAt)
    || lease.admissionStatus !== "admitted"
    || digestValue(withoutAdmissionStatus(lease)) !== digestValue(predecessor.lease)
    || digestValue(worktree) !== digestValue(predecessor.worktree)
    || cloud.claimId !== lease.cloudClaimId
    || cloud.claimId !== predecessor.renewal.claimId
    || cloud.targetClaimDigest !== predecessor.renewal.target.claimDigest
    || cloud.targetEntryDigest !== predecessor.renewal.target.claimLedgerRevision
    || cloud.targetTransitionCounter !== lease.cloudTransitionCounter
    || cloud.targetHeartbeatCounter !== lease.cloudHeartbeatCounter
    || cloud.targetExpiresAt !== lease.expiresAt) {
    invalid("expired predecessor join");
  }
  assertProviderJoin(providerReview, predecessor.providerReview, lease);
  return deepFreeze(core);
}

function proveExpiredCloud({ predecessorPlan, currentLedger, liveCloud, observedAt }) {
  const live = object(liveCloud, "live cloud");
  const predecessor = predecessorPlan.evidence;
  const claimId = predecessor.renewal.claimId;
  const target = predecessor.renewal.target;
  const matches = currentLedger.ledger.entries.filter(entry => (
    entry.claimId === claimId && entry.digest === target.claimLedgerRevision
  ));
  if (matches.length !== 1) invalid("target ledger entry");
  const targetEntry = matches[0];
  const targetIndex = currentLedger.ledger.entries.indexOf(targetEntry);
  const suffix = currentLedger.ledger.entries.slice(targetIndex + 1);
  if (suffix.some(entry => entry.claimId === claimId)) invalid("later same-claim entry");
  assertTargetEntry(targetEntry, predecessor);
  const evaluatedAt = instant(live.evaluatedAt || observedAt, "cloud evaluatedAt");
  if (live.status !== "ready"
    || live.ledgerRevision !== currentLedger.revision
    || live.ledgerDigest !== currentLedger.ledger.headDigest
    || Date.parse(evaluatedAt) < Date.parse(target.expiresAt)) {
    invalid("current cloud observation");
  }
  const targetClaim = normalizeCurrentClaim(live.claim, "target cloud claim");
  assertExpiredClaim(targetClaim, targetEntry, evaluatedAt);
  if (targetClaim.operationReceiptDigest !== target.operationReceiptDigest) {
    invalid("target operation receipt");
  }
  if (!Array.isArray(live.claims)) invalid("current claim inventory");
  const claims = live.claims.map((claim, index) => (
    normalizeCurrentClaim(claim, `current claim ${index}`)
  )).sort((left, right) => left.claimId.localeCompare(right.claimId));
  const inventoryTargets = claims.filter(claim => claim.claimId === claimId);
  if (inventoryTargets.length !== 1
    || digestValue(inventoryTargets[0]) !== digestValue(targetClaim)) {
    invalid("target inventory join");
  }
  const competitors = claims.filter(claim => isCompetitor(claim, targetClaim));
  if (competitors.length) invalid("overlapping cloud competitor");
  const core = {
    claimId,
    evaluatedAt,
    recordedState: "current",
    effectiveState: "dormant-preserved",
    writeAuthority: false,
    scopeReserved: true,
    targetClaimDigest: targetEntry.claimDigest,
    targetEntryDigest: targetEntry.digest,
    targetTransitionCounter: targetEntry.claimCore.transitionCounter,
    targetHeartbeatCounter: targetEntry.claimCore.heartbeatCounter,
    targetExpiresAt: targetEntry.claimCore.expiresAt,
    ledgerRevision: currentLedger.revision,
    ledgerDigest: currentLedger.ledger.headDigest,
    inventoryDigest: digest(live.inventoryDigest, "inventory digest"),
    verificationReceiptDigest: digest(
      live.verificationReceiptDigest,
      "verification receipt digest",
    ),
    targetClaimRecordDigest: digestValue(targetClaim),
    currentClaimInventoryDigest: digestValue(claims),
    currentClaimCount: claims.length,
    unrelatedSuffixEntryCount: suffix.length,
    noLaterSameClaimTransition: true,
    noOverlappingCompetitor: true,
  };
  return deepFreeze({ ...core, cloudProofDigest: digestValue(core) });
}

function normalizeCloudProof(value) {
  const source = object(value, "cloud proof");
  const core = {
    claimId: digest(source.claimId, "cloud claim ID"),
    evaluatedAt: instant(source.evaluatedAt, "cloud evaluatedAt"),
    recordedState: source.recordedState === "current"
      ? "current" : invalid("recorded cloud state"),
    effectiveState: source.effectiveState === "dormant-preserved"
      ? "dormant-preserved" : invalid("effective cloud state"),
    writeAuthority: source.writeAuthority === false
      ? false : invalid("expired write authority"),
    scopeReserved: source.scopeReserved === true
      ? true : invalid("expired scope reservation"),
    targetClaimDigest: digest(source.targetClaimDigest, "target claim digest"),
    targetEntryDigest: digest(source.targetEntryDigest, "target entry digest"),
    targetTransitionCounter: positiveInteger(
      source.targetTransitionCounter,
      "target transition counter",
    ),
    targetHeartbeatCounter: nonnegativeInteger(
      source.targetHeartbeatCounter,
      "target heartbeat counter",
    ),
    targetExpiresAt: instant(source.targetExpiresAt, "target expiry"),
    ledgerRevision: sha(source.ledgerRevision, "current ledger revision"),
    ledgerDigest: digest(source.ledgerDigest, "current ledger digest"),
    inventoryDigest: digest(source.inventoryDigest, "current inventory digest"),
    verificationReceiptDigest: digest(
      source.verificationReceiptDigest,
      "current verification receipt",
    ),
    targetClaimRecordDigest: digest(
      source.targetClaimRecordDigest,
      "target claim record digest",
    ),
    currentClaimInventoryDigest: digest(
      source.currentClaimInventoryDigest,
      "current claim inventory digest",
    ),
    currentClaimCount: positiveInteger(source.currentClaimCount, "current claim count"),
    unrelatedSuffixEntryCount: nonnegativeInteger(
      source.unrelatedSuffixEntryCount,
      "unrelated suffix count",
    ),
    noLaterSameClaimTransition: source.noLaterSameClaimTransition === true,
    noOverlappingCompetitor: source.noOverlappingCompetitor === true,
  };
  if (core.writeAuthority !== false || core.scopeReserved !== true
    || !core.noLaterSameClaimTransition || !core.noOverlappingCompetitor
    || source.cloudProofDigest !== digestValue(core)
    || Date.parse(core.evaluatedAt) < Date.parse(core.targetExpiresAt)) {
    invalid("cloud proof");
  }
  return deepFreeze({ ...core, cloudProofDigest: source.cloudProofDigest });
}

function normalizeWorktree(value) {
  const source = object(value, "worktree");
  const normalized = {
    identityDigest: digest(source.identityDigest, "worktree identity digest"),
    branch: text(source.branch, "worktree branch"),
    headSha: sha(source.headSha, "worktree head"),
    treeSha: sha(source.treeSha, "worktree tree"),
    remoteHeadSha: sha(source.remoteHeadSha, "remote head"),
    protectedMainSha: sha(source.protectedMainSha, "protected main"),
    statusDigest: digest(source.statusDigest, "worktree status digest"),
    registered: source.registered === true,
    clean: source.clean === true,
  };
  if (!normalized.registered || !normalized.clean
    || normalized.headSha !== normalized.remoteHeadSha) invalid("clean worktree");
  return deepFreeze(normalized);
}

function normalizeLease(value) {
  const source = object(value, "lease");
  return deepFreeze({
    leaseDigest: digest(source.leaseDigest, "lease digest"),
    cloudAuthorityDigest: digest(source.cloudAuthorityDigest, "cloud authority digest"),
    admissionDigest: digest(source.admissionDigest, "admission digest"),
    taskAuthorityBindingDigest: digest(
      source.taskAuthorityBindingDigest,
      "task authority binding digest",
    ),
    cloudClaimId: digest(source.cloudClaimId, "lease cloud claim ID"),
    cloudTransitionCounter: positiveInteger(
      source.cloudTransitionCounter,
      "lease cloud transition",
    ),
    cloudHeartbeatCounter: nonnegativeInteger(
      source.cloudHeartbeatCounter,
      "lease cloud heartbeat",
    ),
    status: source.status === "active" ? "active" : invalid("lease status"),
    admissionStatus: source.admissionStatus === "admitted"
      ? "admitted" : invalid("lease admission status"),
    sessionId: text(source.sessionId, "lease session"),
    deviceId: text(source.deviceId, "lease device"),
    scope: text(source.scope, "lease scope"),
    branch: text(source.branch, "lease branch"),
    epoch: positiveInteger(source.epoch, "lease epoch"),
    baseSha: sha(source.baseSha, "lease base"),
    fenceSha: sha(source.fenceSha, "lease fence"),
    heartbeatAt: instant(source.heartbeatAt, "lease heartbeat"),
    expiresAt: instant(source.expiresAt, "lease expiry"),
    providerReviewUrl: text(source.providerReviewUrl, "provider review URL"),
  });
}

function normalizeProviderReview(value) {
  const source = object(value, "provider review");
  const providerState = ["source", "target"].includes(source.providerState)
    ? source.providerState : invalid("provider state");
  const normalized = {
    adapterId: text(source.adapterId, "provider adapter"),
    id: text(source.id, "provider review ID"),
    url: text(source.url, "provider review URL"),
    state: source.state === "open" ? "open" : invalid("provider review state"),
    draft: source.draft === true,
    autoDeliveryAbsent: source.autoDeliveryAbsent === true,
    headRepository: text(source.headRepository, "provider head repository"),
    headBranch: text(source.headBranch, "provider head branch"),
    headSha: sha(source.headSha, "provider head"),
    baseBranch: text(source.baseBranch, "provider base branch"),
    baseSha: sha(source.baseSha, "provider base"),
    providerState,
    currentBodyDigest: digest(source.currentBodyDigest, "current body digest"),
    currentMarkerDigest: digest(source.currentMarkerDigest, "current marker digest"),
    sourceBodyDigest: digest(source.sourceBodyDigest, "source body digest"),
    sourceMarkerDigest: digest(source.sourceMarkerDigest, "source marker digest"),
    targetBodyDigest: digest(source.targetBodyDigest, "target body digest"),
    targetMarkerDigest: digest(source.targetMarkerDigest, "target marker digest"),
    mutationSemantics: source.mutationSemantics === PROVIDER_SEMANTICS
      ? PROVIDER_SEMANTICS : invalid("provider mutation semantics"),
  };
  const expectedBody = providerState === "source"
    ? normalized.sourceBodyDigest : normalized.targetBodyDigest;
  const expectedMarker = providerState === "source"
    ? normalized.sourceMarkerDigest : normalized.targetMarkerDigest;
  if (!normalized.draft || !normalized.autoDeliveryAbsent
    || normalized.currentBodyDigest !== expectedBody
    || normalized.currentMarkerDigest !== expectedMarker
    || normalized.sourceBodyDigest === normalized.targetBodyDigest
    || normalized.sourceMarkerDigest === normalized.targetMarkerDigest) {
    invalid("provider projection state");
  }
  return deepFreeze(normalized);
}

function assertProviderJoin(current, predecessor, lease) {
  const shared = [
    "adapterId", "id", "url", "state", "draft", "autoDeliveryAbsent",
    "headRepository", "headBranch", "headSha", "baseBranch", "baseSha",
    "sourceBodyDigest", "sourceMarkerDigest", "targetBodyDigest",
    "targetMarkerDigest", "mutationSemantics",
  ];
  if (shared.some(field => current[field] !== predecessor[field])
    || current.url !== lease.providerReviewUrl
    || current.headBranch !== lease.branch
    || current.headSha !== lease.fenceSha) invalid("provider predecessor join");
}

function assertTargetEntry(entry, predecessor) {
  const target = predecessor.renewal.target;
  if (entry.schema !== ENTRY_SCHEMA || entry.action !== "continue"
    || entry.claimId !== predecessor.renewal.claimId
    || entry.digest !== target.claimLedgerRevision
    || entry.claimDigest !== target.claimDigest
    || entry.claimCore.transitionCounter !== target.transitionCounter
    || entry.claimCore.heartbeatCounter !== target.heartbeatCounter
    || entry.claimCore.expiresAt !== target.expiresAt) invalid("sealed target entry");
}

function assertExpiredClaim(claim, entry, evaluatedAt) {
  const core = entry.claimCore;
  const stable = [
    "actorId", "repositoryId", "workItemId", "canonicalBaseRevision",
    "laneRevision", "writeSetDigest", "leaseEpoch", "reviewRequestId",
    "predecessorClaimId",
  ];
  if (claim.claimId !== entry.claimId
    || claim.state !== "dormant-preserved" || claim.recordedState !== "current"
    || claim.writeAuthority !== false || claim.scopeReserved !== true
    || claim.fenceRevision !== entry.claimDigest
    || claim.transitionDigest !== entry.digest
    || claim.transitionCounter !== core.transitionCounter
    || claim.heartbeatCounter !== core.heartbeatCounter
    || claim.expiresAt !== core.expiresAt
    || Date.parse(evaluatedAt) < Date.parse(core.expiresAt)
    || stable.some(field => (claim[field] ?? null) !== (core[field] ?? null))
    || digestValue(claim.declaredWriteScope) !== digestValue(core.declaredWriteScope)) {
    invalid("expired target claim");
  }
}

function normalizeCurrentClaim(value, label) {
  const source = object(value, label);
  return deepFreeze({
    claimId: digest(source.claimId, `${label} ID`),
    entrySchema: source.entrySchema === ENTRY_SCHEMA
      ? ENTRY_SCHEMA : invalid(`${label} entry schema`),
    claimIdentitySchema: source.claimIdentitySchema === ENTRY_SCHEMA
      ? ENTRY_SCHEMA : invalid(`${label} identity schema`),
    state: text(source.state, `${label} state`),
    recordedState: text(source.recordedState, `${label} recorded state`),
    writeAuthority: source.writeAuthority === true,
    scopeReserved: source.scopeReserved === true,
    actorId: text(source.actorId, `${label} actor`),
    repositoryId: text(source.repositoryId, `${label} repository`),
    workItemId: text(source.workItemId, `${label} work item`),
    canonicalBaseRevision: sha(source.canonicalBaseRevision, `${label} base`),
    laneRevision: sha(source.laneRevision, `${label} lane revision`),
    declaredWriteScope: normalizeWriteSet(source.declaredWriteScope),
    writeSetDigest: digest(source.writeSetDigest, `${label} write-set digest`),
    leaseEpoch: positiveInteger(source.leaseEpoch, `${label} lease epoch`),
    transitionCounter: positiveInteger(source.transitionCounter, `${label} transition`),
    heartbeatCounter: nonnegativeInteger(source.heartbeatCounter, `${label} heartbeat`),
    reviewRequestId: optionalText(source.reviewRequestId, `${label} review request`),
    predecessorClaimId: optionalDigest(source.predecessorClaimId, `${label} predecessor`),
    expiresAt: instant(source.expiresAt, `${label} expiry`),
    fenceRevision: digest(source.fenceRevision, `${label} fence`),
    transitionDigest: digest(source.transitionDigest, `${label} transition digest`),
    operationReceiptDigest: digest(
      source.operationReceiptDigest,
      `${label} operation receipt`,
    ),
  });
}

function isCompetitor(candidate, target) {
  if (candidate.claimId === target.claimId || candidate.repositoryId !== target.repositoryId) {
    return false;
  }
  return Boolean(target.reviewRequestId && candidate.reviewRequestId === target.reviewRequestId)
    || writeSetsOverlap(candidate.declaredWriteScope, target.declaredWriteScope);
}

function ledgerSnapshot(value) {
  const source = object(value, "current ledger snapshot");
  const revision = sha(source.revision, "current ledger revision");
  const failures = validateLedger(source.ledger);
  if (failures.length) {
    throw new Error(`Expired active admitted PR-marker response-loss ledger is invalid: ${failures.join("; ")}`);
  }
  return deepFreeze({ revision, ledger: source.ledger });
}

function normalizeMutationBoundary(value) {
  const source = object(value, "mutation boundary");
  const expected = defaultMutationBoundary();
  if (canonicalJson(source) !== canonicalJson(expected)) invalid("mutation boundary");
  return expected;
}

function defaultMutationBoundary() {
  return deepFreeze({
    providerReviewBody: true,
    privateJournal: true,
    providerReviewMetadata: false,
    git: false,
    remoteRefs: false,
    writerRegistry: false,
    cloudLedger: false,
    sourceBytes: false,
    authoringAuthority: false,
    integration: false,
    release: false,
    deployment: false,
    cleanup: false,
  });
}

function withoutAdmissionStatus(lease) {
  const { admissionStatus: _admissionStatus, ...projection } = lease;
  return projection;
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) invalid(label);
  return value;
}
function optionalText(value, label) {
  return value === null || value === undefined ? null : text(value, label);
}
function sha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function digest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function optionalDigest(value, label) {
  return value === null || value === undefined ? null : digest(value, label);
}
function instant(value, label) {
  if (!value || new Date(value).toISOString() !== value) invalid(label);
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
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function invalid(label) {
  throw new Error(`Expired active admitted PR-marker response-loss evidence has invalid ${label}.`);
}
