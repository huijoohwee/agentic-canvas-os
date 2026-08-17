// Responsibility: normalize one provider-neutral proof that an empty draft owns only a dormant cloud scope.
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";

export const DORMANT_EMPTY_COORDINATION_RETIREMENT_EVIDENCE_SCHEMA =
  "agentic-dormant-empty-coordination-retirement-evidence/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function buildDormantEmptyCoordinationRetirementEvidence(input) {
  const normalized = normalizeCore(input);
  return deepFreeze({ ...normalized, evidenceDigest: digestValue(normalized) });
}

export function normalizeDormantEmptyCoordinationRetirementEvidence(value) {
  object(value, "retirement evidence");
  const normalized = buildDormantEmptyCoordinationRetirementEvidence(value);
  if (value.evidenceDigest !== normalized.evidenceDigest) {
    throw new Error("Dormant empty coordination evidence digest is invalid.");
  }
  return normalized;
}

export function assertDormantEmptyCoordinationRetirementEvidence(value) {
  return normalizeDormantEmptyCoordinationRetirementEvidence(value);
}

function normalizeCore(value) {
  object(value, "retirement evidence");
  if (value.schema !== DORMANT_EMPTY_COORDINATION_RETIREMENT_EVIDENCE_SCHEMA) {
    throw new Error("Unsupported dormant empty coordination evidence schema.");
  }
  const controller = normalizeController(value.controller);
  const canonical = normalizeCanonical(value.canonical);
  const pullRequest = normalizePullRequest(value.pullRequest);
  const claim = normalizeClaim(value.claim, "source claim");
  const waitingSuccessor = normalizeClaim(value.waitingSuccessor, "waiting successor");
  const localAbsence = normalizeLocalAbsence(value.localAbsence);
  const cloud = normalizeCloud(value.cloud);
  assertJoins({ canonical, pullRequest, claim, waitingSuccessor, cloud });
  return {
    schema: DORMANT_EMPTY_COORDINATION_RETIREMENT_EVIDENCE_SCHEMA,
    observedAt: instant(value.observedAt, "observation instant"),
    controller,
    canonical,
    pullRequest,
    claim,
    waitingSuccessor,
    localAbsence,
    cloud,
  };
}

function normalizeController(value) {
  object(value, "controller evidence");
  if (value.clean !== true || value.protected !== true) {
    throw new Error("Retirement controller must execute from clean protected source.");
  }
  return {
    repository: repository(value.repository, "controller repository"),
    rootDigest: digest(value.rootDigest, "controller root digest"),
    headSha: sha(value.headSha, "controller HEAD"),
    treeSha: sha(value.treeSha, "controller tree"),
    originMainSha: sha(value.originMainSha, "controller origin/main"),
    runtimeDigest: digest(value.runtimeDigest, "controller runtime digest"),
    clean: true,
    protected: true,
  };
}

function normalizeCanonical(value) {
  object(value, "canonical evidence");
  if (value.branch !== "main") throw new Error("Canonical branch must be main.");
  return {
    repository: repository(value.repository, "canonical repository"),
    branch: "main",
    sha: sha(value.sha, "canonical revision"),
    treeSha: sha(value.treeSha, "canonical tree"),
    containsBase: boolean(value.containsBase, "canonical base ancestry"),
  };
}

function normalizePullRequest(value) {
  object(value, "pull request evidence");
  if (value.state !== "OPEN" || value.isDraft !== true || value.mergedAt !== null
    || value.autoMergeRequest !== null || value.inMergeQueue !== false) {
    throw new Error("Retirement requires one open unmerged draft outside the merge queue.");
  }
  const parentShas = array(value.parentShas, "head parents").map((item, index) =>
    sha(item, `head parent ${index}`));
  if (parentShas.length !== 1) throw new Error("Coordination head must have exactly one parent.");
  if (value.changedPaths?.length !== 0) throw new Error("Coordination head must change no paths.");
  return {
    number: positive(value.number, "pull request number"),
    nodeId: text(value.nodeId, "pull request node ID"),
    url: text(value.url, "pull request URL"),
    repository: repository(value.repository, "pull request repository"),
    state: "OPEN",
    isDraft: true,
    mergedAt: null,
    closedAt: value.closedAt == null ? null : instant(value.closedAt, "closure instant"),
    autoMergeRequest: null,
    inMergeQueue: false,
    headRepository: repository(value.headRepository, "head repository"),
    headBranch: text(value.headBranch, "head branch"),
    headSha: sha(value.headSha, "head revision"),
    headTreeSha: sha(value.headTreeSha, "head tree"),
    parentShas,
    baseRepository: repository(value.baseRepository, "base repository"),
    baseBranch: text(value.baseBranch, "base branch"),
    baseSha: sha(value.baseSha, "base revision"),
    baseTreeSha: sha(value.baseTreeSha, "base tree"),
    changedPaths: Object.freeze([]),
    bodyDigest: digest(value.bodyDigest, "pull request body digest"),
    reviewRequestId: text(value.reviewRequestId, "pull request review ID"),
    markerClaimId: digest(value.markerClaimId, "marker claim ID"),
    markerDigest: digest(value.markerDigest, "marker digest"),
    markerAuthority: normalizeMarkerAuthority(value.markerAuthority),
    providerVersion: instant(value.providerVersion, "provider version"),
  };
}

function normalizeMarkerAuthority(value) {
  object(value, "marker authority");
  return {
    claimId: digest(value.claimId, "marker claim ID"),
    claimDigest: digest(value.claimDigest, "marker claim digest"),
    operationReceiptDigest: digest(value.operationReceiptDigest, "marker operation receipt"),
    ledgerRepository: repository(value.ledgerRepository, "marker ledger repository"),
    targetRepository: repository(value.targetRepository, "marker target repository"),
    canonicalBaseSha: sha(value.canonicalBaseSha, "marker canonical base"),
    laneRevision: sha(value.laneRevision, "marker lane revision"),
    declaredWriteScope: Object.freeze(normalizeWriteSet(value.declaredWriteScope)),
    writeSetDigest: digest(value.writeSetDigest, "marker write-set digest"),
    deviceId: text(value.deviceId, "marker device ID"),
    sessionId: text(value.sessionId, "marker session ID"),
    reviewRequestId: text(value.reviewRequestId, "marker review request ID"),
    leaseEpoch: positive(value.leaseEpoch, "marker lease epoch"),
    transitionCounter: positive(value.transitionCounter, "marker transition counter"),
    integration: value.integration == null ? null : deepFreeze(structuredClone(value.integration)),
  };
}

function normalizeClaim(value, label) {
  object(value, label);
  return {
    claimId: digest(value.claimId, `${label} ID`),
    claimDigest: digest(value.claimDigest, `${label} digest`),
    transitionDigest: digest(value.transitionDigest, `${label} transition digest`),
    operationReceiptDigest: digest(value.operationReceiptDigest, `${label} operation receipt`),
    state: text(value.state, `${label} state`),
    recordedState: text(value.recordedState, `${label} recorded state`),
    writeAuthority: boolean(value.writeAuthority, `${label} write authority`),
    scopeReserved: boolean(value.scopeReserved, `${label} scope reservation`),
    actorId: text(value.actorId, `${label} actor ID`),
    repositoryId: text(value.repositoryId, `${label} repository ID`),
    workItemId: text(value.workItemId, `${label} work-item ID`),
    deviceId: text(value.deviceId, `${label} device ID`),
    sessionId: text(value.sessionId, `${label} session ID`),
    canonicalBaseRevision: sha(value.canonicalBaseRevision, `${label} canonical base`),
    laneRevision: sha(value.laneRevision, `${label} lane revision`),
    declaredWriteScope: Object.freeze(normalizeWriteSet(value.declaredWriteScope)),
    writeSetDigest: digest(value.writeSetDigest, `${label} write-set digest`),
    leaseEpoch: positive(value.leaseEpoch, `${label} lease epoch`),
    transitionCounter: positive(value.transitionCounter, `${label} transition counter`),
    predecessorClaimId: value.predecessorClaimId == null ? null
      : digest(value.predecessorClaimId, `${label} predecessor`),
    reviewRequestId: value.reviewRequestId == null ? null
      : text(value.reviewRequestId, `${label} review request ID`),
    evidenceDigest: value.evidenceDigest == null ? null
      : digest(value.evidenceDigest, `${label} focused evidence`),
    integration: value.integration == null ? null : deepFreeze(structuredClone(value.integration)),
    retirement: value.retirement == null ? null : deepFreeze(structuredClone(value.retirement)),
  };
}

function normalizeLocalAbsence(value) {
  object(value, "local absence evidence");
  if (value.branchPresent !== false || value.worktreePresent !== false
    || value.leasePresent !== false) {
    throw new Error("Dormant empty coordination subject still has a local owner.");
  }
  return {
    gitCommonDirectoryDigest: digest(value.gitCommonDirectoryDigest, "git common directory digest"),
    registryRevision: nonnegative(value.registryRevision, "writer registry revision"),
    branchPresent: false,
    worktreePresent: false,
    leasePresent: false,
    matchingRefCount: nonnegative(value.matchingRefCount, "matching local ref count"),
    matchingWorktreeCount: nonnegative(value.matchingWorktreeCount, "matching worktree count"),
    matchingLeaseCount: nonnegative(value.matchingLeaseCount, "matching lease count"),
  };
}

function normalizeCloud(value) {
  object(value, "cloud evidence");
  return {
    ledgerRepository: repository(value.ledgerRepository, "ledger repository"),
    ledgerRevision: sha(value.ledgerRevision, "ledger revision"),
    ledgerDigest: digest(value.ledgerDigest, "ledger digest"),
    sequence: positive(value.sequence, "ledger sequence"),
    inventoryDigest: digest(value.inventoryDigest, "claim inventory digest"),
    validatedLedgerDigest: digest(value.validatedLedgerDigest, "validated ledger digest"),
    sourceEntryDigest: digest(value.sourceEntryDigest, "source entry digest"),
    successorEntryDigest: digest(value.successorEntryDigest, "successor entry digest"),
    sourceCardinality: positive(value.sourceCardinality, "source claim cardinality"),
    successorCardinality: positive(value.successorCardinality, "successor claim cardinality"),
  };
}

function assertJoins({ canonical, pullRequest, claim, waitingSuccessor, cloud }) {
  if (canonical.repository !== pullRequest.repository
    || pullRequest.headRepository !== pullRequest.repository
    || pullRequest.baseRepository !== pullRequest.repository
    || pullRequest.baseBranch !== "main") {
    throw new Error("Pull request is not an exact same-repository main subject.");
  }
  if (pullRequest.headSha !== claim.laneRevision || pullRequest.baseSha !== claim.canonicalBaseRevision
    || pullRequest.parentShas[0] !== pullRequest.baseSha
    || pullRequest.headTreeSha !== pullRequest.baseTreeSha
    || pullRequest.markerClaimId !== claim.claimId || canonical.containsBase !== true) {
    throw new Error("Empty coordination commit, marker, claim, and canonical lineage do not join.");
  }
  const marker = pullRequest.markerAuthority;
  if (marker.claimId !== claim.claimId || marker.targetRepository !== canonical.repository
    || marker.canonicalBaseSha !== claim.canonicalBaseRevision || marker.laneRevision !== claim.laneRevision
    || marker.writeSetDigest !== claim.writeSetDigest
    || digestValue(marker.declaredWriteScope) !== digestValue(claim.declaredWriteScope)
    || marker.deviceId !== claim.deviceId || marker.sessionId !== claim.sessionId
    || marker.reviewRequestId !== claim.reviewRequestId || marker.leaseEpoch !== claim.leaseEpoch
    || marker.transitionCounter > claim.transitionCounter || marker.integration !== null) {
    throw new Error("Hidden marker does not join the exact dormant claim lineage.");
  }
  if (claim.state !== "dormant-preserved" || claim.recordedState !== "reviewed"
    || claim.writeAuthority !== false || claim.scopeReserved !== true
    || claim.reviewRequestId !== pullRequest.reviewRequestId
    || claim.integration !== null || claim.retirement !== null) {
    throw new Error("Source claim is not the exact nonintegrated dormant reservation.");
  }
  if (waitingSuccessor.state !== "waiting-successor"
    || waitingSuccessor.writeAuthority !== false || waitingSuccessor.scopeReserved !== false
    || waitingSuccessor.predecessorClaimId !== claim.claimId
    || waitingSuccessor.actorId !== claim.actorId
    || waitingSuccessor.repositoryId !== claim.repositoryId
    || waitingSuccessor.integration !== null || waitingSuccessor.retirement !== null) {
    throw new Error("Waiting successor is not the exact inert direct successor.");
  }
  if (cloud.sourceCardinality !== 1 || cloud.successorCardinality !== 1) {
    throw new Error("Cloud claim cardinality is ambiguous.");
  }
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is required.`);
}
function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} is required.`);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || value.trim() !== value || !value) throw new Error(`${label} is invalid.`);
  return value;
}
function repository(value, label) {
  const normalized = text(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}
function sha(value, label) {
  if (!SHA_PATTERN.test(value || "")) throw new Error(`${label} is invalid.`);
  return value;
}
function digest(value, label) {
  if (!DIGEST_PATTERN.test(value || "")) throw new Error(`${label} is invalid.`);
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`);
  return value;
}
function nonnegative(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid.`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid.`);
  return value;
}
function instant(value, label) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new Error(`${label} is invalid.`);
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const member of Object.values(value)) deepFreeze(member);
  return value;
}
