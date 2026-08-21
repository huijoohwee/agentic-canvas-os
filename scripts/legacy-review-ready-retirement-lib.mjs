import path from "node:path";
import { canonicalJson, digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { projectRootState } from "./cloud-collaboration-state-projection.mjs";
import { normalizeLocalReleaseReceipt } from "./planned-recovery-pr-marker-reconciliation-contract.mjs";
import { isRetiredPlannedAdmissionOwnerLane } from "./retired-planned-admission-owner-lib.mjs";
import { projectWriterLeasePullRequestMarker, WRITER_LEASE_SCHEMA } from "./writer-lease-lib.mjs";
export const LOCAL_REVIEW_RETIREMENT_INTENT_SCHEMA = "agentic-local-review-retirement-intent/v1";
export const LOCAL_REVIEW_RETIREMENT_RECEIPT_SCHEMA = "agentic-local-review-retirement-receipt/v1";
export const LOCAL_REVIEW_RETIREMENT_RESULT_SCHEMA = "agentic-local-review-retirement-result/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
export function buildLocalReviewRetirementIntent({ request, snapshot }) {
  const normalizedRequest = normalizeLocalReviewRetirementRequest(request);
  const source = normalizeReviewReadySnapshot(snapshot, normalizedRequest);
  const core = {
    schema: LOCAL_REVIEW_RETIREMENT_INTENT_SCHEMA,
    targetRepository: normalizedRequest.targetRepository,
    ledgerRepository: normalizedRequest.ledgerRepository,
    operatorSessionId: normalizedRequest.operatorSessionId,
    operatorDecisionDigest: normalizedRequest.operatorDecisionDigest,
    source: projectSourceIdentity(source),
    preservation: preservationPolicy(),
  };
  return Object.freeze({ ...core, intentDigest: digestValue(core) });
}
export function renderLocalReviewRetirementMarker({
  intentDigest,
  retiredAt,
  releasedWriterMarkerDigest,
}) {
  const marker = normalizeMarker({
    schema: LOCAL_REVIEW_RETIREMENT_INTENT_SCHEMA,
    intentDigest,
    retiredAt,
    releasedWriterMarkerDigest,
  });
  return `<!-- ${LOCAL_REVIEW_RETIREMENT_INTENT_SCHEMA} ${canonicalJson(marker)} -->`;
}
export function parseLocalReviewRetirementMarker(body) {
  const escaped = escapeRegExp(LOCAL_REVIEW_RETIREMENT_INTENT_SCHEMA);
  const matches = [...String(body || "").matchAll(
    new RegExp(`<!--\\s*${escaped}\\s+(\\{[\\s\\S]*?\\})\\s*-->`, "gu"),
  )];
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw new Error("Pull request has multiple local review retirement markers.");
  }
  return normalizeMarker(JSON.parse(matches[0][1]));
}
export function appendLocalReviewRetirementMarker(body, markerText) {
  const source = String(body || "");
  const expected = parseLocalReviewRetirementMarker(markerText);
  const current = parseLocalReviewRetirementMarker(source);
  if (current) {
    if (digestValue(current) !== digestValue(expected)) {
      throw new Error("Pull request has a conflicting local review retirement marker.");
    }
    return source;
  }
  return source ? `${source}\n\n${markerText}` : markerText;
}
export function requireExactWriterMarker(body, expectedMarker) {
  const escaped = escapeRegExp(WRITER_LEASE_SCHEMA);
  const matches = [...String(body || "").matchAll(
    new RegExp(`<!--\\s*${escaped}\\s+[\\s\\S]*?-->`, "gu"),
  )].map(match => match[0]);
  if (matches.length !== 1 || matches[0] !== expectedMarker) {
    throw new Error("Pull request must contain one exact writer lease marker.");
  }
  return expectedMarker;
}
export function normalizeLocalReviewRetirementReceipt(value) {
  requireObject(value, "Local review retirement receipt");
  const { receiptDigest, ...core } = value;
  if (
    core.schema !== LOCAL_REVIEW_RETIREMENT_RECEIPT_SCHEMA
    || core.status !== "completed"
  ) {
    throw new Error("Local review retirement receipt is not completed.");
  }
  requiredDigest(receiptDigest, "receiptDigest");
  if (digestValue(core) !== receiptDigest) {
    throw new Error("Local review retirement receipt digest is invalid.");
  }
  const intent = normalizeIntent(core.intent);
  if (intent.intentDigest !== requiredDigest(core.intentDigest, "intentDigest")) {
    throw new Error("Local review retirement receipt intent does not match.");
  }
  const retiredAt = requiredInstant(core.retiredAt, "retiredAt");
  const provider = normalizeProviderEvidence(core.provider);
  const cloud = normalizeCloudEvidence(core.cloud);
  if (provider.marker.intentDigest !== intent.intentDigest) {
    throw new Error("Provider marker does not bind the retirement intent.");
  }
  if (provider.marker.retiredAt !== retiredAt) {
    throw new Error("Provider marker does not bind the retirement instant.");
  }
  if (provider.headSha !== intent.source.headSha
    || cloud.ledgerRepository !== intent.ledgerRepository) {
    throw new Error("Retirement provider or cloud evidence changed subject.");
  }
  const preservation = normalizePreservation(core.preservation);
  return Object.freeze({
    ...core,
    intent,
    intentDigest: intent.intentDigest,
    preservation,
    cloud,
    provider,
    retiredAt,
    receiptDigest,
  });
}
export function isRetiredPreservedLane({ lane = null, record = null, lease = null } = {}) {
  const observed = lane || record;
  const currentLease = lease || lane?.lease || null;
  if (isRetiredPlannedAdmissionOwnerLane({ lane, record, lease })) return true;
  if (isRetiredPlannedRecoveryMarkerLane({ observed, currentLease })) return true;
  try {
    requireObject(observed, "Retired lane");
    requireObject(currentLease, "Retired lane lease");
    const receipt = normalizeLocalReviewRetirementReceipt(
      currentLease.localReviewRetirement,
    );
    const source = receipt.intent.source;
    const observedBranch = String(observed.branch || "").replace(/^refs\/heads\//u, "");
    if (
      currentLease.schema !== WRITER_LEASE_SCHEMA
      || currentLease.status !== "released"
      || currentLease.admission != null
      || currentLease.cloudAuthority != null
      || currentLease.heartbeatAt !== receipt.retiredAt
      || currentLease.expiresAt !== receipt.retiredAt
      || currentLease.branch !== source.branch
      || currentLease.sessionId !== source.lease.sessionId
      || currentLease.epoch !== source.lease.epoch
      || currentLease.device !== source.lease.device
      || currentLease.scope !== source.lease.scope
      || currentLease.baseSha !== source.lease.baseSha
      || currentLease.fenceSha !== source.lease.fenceSha
      || currentLease.reviewHeadSha !== source.headSha
      || currentLease.pullRequestUrl !== source.pullRequest.url
      || path.resolve(currentLease.worktreePath || "") !== source.worktreePath
      || path.resolve(observed.path || "") !== source.worktreePath
      || observedBranch !== source.branch
      || observed.head !== source.headSha
      || observed.dirty === true
      || receipt.preservation.cleanupEligible !== false
    ) return false;
    const { localReviewRetirement: _receipt, ...releasedSource } = currentLease;
    const reconstructedSource = {
      ...releasedSource,
      status: "review_ready",
      heartbeatAt: source.lease.heartbeatAt,
      expiresAt: source.lease.expiresAt,
    };
    if (
      digestValue(reconstructedSource) !== source.lease.leaseDigest
      || digestValue(projectWriterLeasePullRequestMarker(currentLease))
        !== receipt.provider.releasedWriterMarkerDigest
    ) return false;
    if (observed.treeSha && observed.treeSha !== source.treeSha) return false;
    if (observed.indexDigest && observed.indexDigest !== source.indexDigest) return false;
    if (
      observed.workingTreeDigest
      && observed.workingTreeDigest !== source.workingTreeDigest
    ) return false;
    return true;
  } catch {
    return false;
  }
}
function isRetiredPlannedRecoveryMarkerLane({ observed, currentLease }) {
  try {
    requireObject(observed, "Retired lane");
    requireObject(currentLease, "Retired lane lease");
    const receipt = normalizeLocalReleaseReceipt(
      currentLease.plannedRecoveryMarkerReconciliation,
    );
    const observedBranch = String(observed.branch || "").replace(/^refs\/heads\//u, "");
    return currentLease.schema === WRITER_LEASE_SCHEMA
      && currentLease.status === "released"
      && currentLease.admission == null
      && currentLease.cloudAuthority == null
      && currentLease.heartbeatAt === receipt.completedAt
      && currentLease.expiresAt === receipt.completedAt
      && currentLease.pullRequestUrl === receipt.pullRequestUrl
      && path.resolve(currentLease.worktreePath || "") === path.resolve(observed.path || "")
      && currentLease.branch === observedBranch
      && currentLease.fenceSha === observed.head
      && observed.dirty !== true;
  } catch {
    return false;
  }
}
export function prepareProviderCheckpoint({ source, intent, adapter }) {
  const sourceWriterMarker = adapter.projectWriterMarker(source.lease);
  const current = parseLocalReviewRetirementMarker(source.pullRequest.body);
  const retiredAt = current?.retiredAt || requiredInstant(adapter.now(), "retiredAt");
  const projectedLease = {
    ...source.lease,
    status: "released",
    heartbeatAt: retiredAt,
    expiresAt: retiredAt,
  };
  const writerMarker = adapter.projectWriterMarker(projectedLease);
  requireExactWriterMarker(
    source.pullRequest.body, current ? writerMarker : sourceWriterMarker,
  );
  const releasedWriterMarkerDigest = digestValue(
    projectWriterLeasePullRequestMarker(projectedLease),
  );
  const marker = normalizeMarker({
    schema: LOCAL_REVIEW_RETIREMENT_INTENT_SCHEMA,
    intentDigest: intent.intentDigest,
    retiredAt,
    releasedWriterMarkerDigest,
  });
  if (current && digestValue(current) !== digestValue(marker)) {
    throw new Error("Existing retirement marker does not match the exact source lease.");
  }
  const markerText = renderLocalReviewRetirementMarker(marker);
  const writerBody = adapter.updateWriterBody(source.pullRequest.body, projectedLease);
  requireExactWriterMarker(writerBody, writerMarker);
  return {
    body: appendLocalReviewRetirementMarker(writerBody, markerText),
    marker,
    markerText,
    writerMarker,
    projectedLease,
  };
}
export function buildCompletedReceipt({ intent, preservation, pullRequest, checkpoint }) {
  const provider = normalizeProviderEvidence({
    state: pullRequest.state,
    merged: pullRequest.merged,
    closedAt: pullRequest.closedAt,
    headSha: pullRequest.headSha,
    bodyDigest: digestValue(pullRequest.body),
    marker: checkpoint.marker,
    markerDigest: digestValue(checkpoint.markerText),
    releasedWriterMarkerDigest: checkpoint.marker.releasedWriterMarkerDigest,
  });
  const core = {
    schema: LOCAL_REVIEW_RETIREMENT_RECEIPT_SCHEMA,
    status: "completed",
    intent,
    intentDigest: intent.intentDigest,
    preservation: intent.preservation,
    cloud: normalizeCloudEvidence({
      ledgerRepository: intent.ledgerRepository,
      ledgerRevision: preservation.cloudVerification.ledgerRevision,
      ledgerDigest: preservation.cloudVerification.ledgerDigest,
      remoteClaimInventoryDigest:
        preservation.cloudVerification.remoteClaimInventoryDigest,
      cloudVerificationReceiptDigest:
        preservation.cloudVerification.receiptDigest,
      dormantPreservationReceiptDigest:
        preservation.dormantReceipt.receiptDigest,
    }),
    provider,
    retiredAt: checkpoint.marker.retiredAt,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}
export function normalizeReviewReadySnapshot(snapshot, request) {
  requireObject(snapshot, "Review-ready snapshot");
  const lane = snapshot.lane;
  const lease = snapshot.lease;
  const pullRequest = normalizePullRequest(snapshot.pullRequest);
  requireObject(lane, "Review-ready lane");
  requireObject(lease, "Review-ready lease");
  const branch = requiredText(request.branch, "branch");
  const worktreePath = path.resolve(request.repository);
  const observedBranch = String(lane.branch || "").replace(/^refs\/heads\//u, "");
  if (
    lane.invalid || lane.leaseAmbiguous || lane.detached || lane.dirty
    || path.resolve(lane.path || "") !== worktreePath
    || observedBranch !== branch
    || lane.head !== request.expectedHead
    || lease.schema !== WRITER_LEASE_SCHEMA
    || lease.status !== "review_ready"
    || lease.sessionId !== request.sourceSessionId
    || lease.branch !== branch
    || path.resolve(lease.worktreePath || "") !== worktreePath
    || lease.reviewHeadSha !== request.expectedHead
    || lease.pullRequestUrl !== pullRequest.url
    || lease.admission != null
    || lease.cloudAuthority != null
    || lease.localReviewRetirement != null
  ) throw new Error("Lane is not the exact clean local-only review_ready owner.");
  const leaseExpiry = Date.parse(requiredInstant(lease.expiresAt, "lease expiresAt"));
  if (leaseExpiry > Date.parse(request.evaluatedAt)) {
    throw new Error("Local review_ready owner is still live; dormant retirement is forbidden.");
  }
  if (
    snapshot.remoteHeadSha !== request.expectedHead
    || pullRequest.number !== request.expectedPullRequest
    || pullRequest.headSha !== request.expectedHead
    || pullRequest.headBranch !== branch
    || pullRequest.headRepository.toLowerCase() !== request.targetRepository.toLowerCase()
    || pullRequest.baseRepository.toLowerCase() !== request.targetRepository.toLowerCase()
    || pullRequest.baseBranch !== "main"
    || pullRequest.url !== request.expectedPullRequestUrl
    || pullRequest.draft
    || pullRequest.merged
    || !["OPEN", "CLOSED"].includes(pullRequest.state)
  ) throw new Error("Pull request does not match the exact preserved lane identity.");
  for (const [value, label] of [
    [lane.head, "lane head"], [lane.treeSha, "lane tree"],
    [snapshot.remoteHeadSha, "remote head"],
  ]) requiredSha(value, label);
  for (const [value, label] of [
    [lane.indexDigest, "indexDigest"],
    [lane.workingTreeDigest, "workingTreeDigest"],
    [lane.stateDigest, "stateDigest"],
  ]) requiredDigest(value, label);
  return { ...snapshot, lane, lease, pullRequest, branch, worktreePath };
}
function projectSourceIdentity(source) {
  return Object.freeze({
    worktreePath: path.resolve(source.lane.path),
    branch: source.branch,
    headSha: source.lane.head,
    treeSha: source.lane.treeSha,
    remoteHeadSha: source.remoteHeadSha,
    indexDigest: source.lane.indexDigest,
    workingTreeDigest: source.lane.workingTreeDigest,
    stateDigest: source.lane.stateDigest,
    lease: {
      status: "review_ready",
      epoch: source.lease.epoch,
      sessionId: source.lease.sessionId,
      device: source.lease.device,
      scope: source.lease.scope,
      baseSha: source.lease.baseSha,
      fenceSha: source.lease.fenceSha,
      heartbeatAt: requiredInstant(source.lease.heartbeatAt, "source lease heartbeatAt"),
      expiresAt: requiredInstant(source.lease.expiresAt, "source lease expiresAt"),
      leaseDigest: digestValue(source.lease),
    },
    pullRequest: {
      url: source.pullRequest.url,
      number: source.pullRequest.number,
      nodeId: source.pullRequest.nodeId,
      reviewRequestId: `github-pull-request:${source.pullRequest.nodeId}`,
      headRepository: source.pullRequest.headRepository,
      headBranch: source.pullRequest.headBranch,
      headSha: source.pullRequest.headSha,
      baseRepository: source.pullRequest.baseRepository,
      baseBranch: source.pullRequest.baseBranch,
    },
  });
}
function normalizeIntent(value) {
  requireObject(value, "Retirement intent");
  const { intentDigest, ...core } = value;
  if (core.schema !== LOCAL_REVIEW_RETIREMENT_INTENT_SCHEMA) {
    throw new Error("Unsupported local review retirement intent.");
  }
  requiredRepository(core.targetRepository, "targetRepository");
  requiredRepository(core.ledgerRepository, "ledgerRepository");
  requiredText(core.operatorSessionId, "operatorSessionId");
  requiredDigest(core.operatorDecisionDigest, "operatorDecisionDigest");
  const source = normalizeSourceIdentity(core.source);
  normalizePreservation(core.preservation);
  if (
    source.pullRequest.headRepository.toLowerCase() !== core.targetRepository.toLowerCase()
    || source.pullRequest.baseRepository.toLowerCase() !== core.targetRepository.toLowerCase()
  ) throw new Error("Retirement intent repositories do not join its target.");
  if (digestValue(core) !== requiredDigest(intentDigest, "intentDigest")) {
    throw new Error("Local review retirement intent digest is invalid.");
  }
  return Object.freeze({ ...core, intentDigest });
}
function normalizeSourceIdentity(value) {
  requireObject(value, "Retirement source");
  const source = value;
  requiredText(source.worktreePath, "source worktreePath");
  requiredText(source.branch, "source branch");
  requiredSha(source.headSha, "source headSha");
  requiredSha(source.treeSha, "source treeSha");
  requiredSha(source.remoteHeadSha, "source remoteHeadSha");
  requiredDigest(source.indexDigest, "source indexDigest");
  requiredDigest(source.workingTreeDigest, "source workingTreeDigest");
  requiredDigest(source.stateDigest, "source stateDigest");
  requireObject(source.lease, "source lease");
  if (source.lease.status !== "review_ready"
    || !Number.isInteger(source.lease.epoch) || source.lease.epoch < 1) {
    throw new Error("Retirement source lease must be review_ready with an exact epoch.");
  }
  requiredText(source.lease.sessionId, "source lease sessionId");
  requiredText(source.lease.device, "source lease device");
  requiredText(source.lease.scope, "source lease scope");
  requiredSha(source.lease.baseSha, "source lease baseSha");
  requiredSha(source.lease.fenceSha, "source lease fenceSha");
  requiredInstant(source.lease.heartbeatAt, "source lease heartbeatAt");
  requiredInstant(source.lease.expiresAt, "source lease expiresAt");
  requiredDigest(source.lease.leaseDigest, "source leaseDigest");
  requireObject(source.pullRequest, "source pull request");
  requiredText(source.pullRequest.url, "source pull request URL");
  positiveInteger(source.pullRequest.number, "source pull request number");
  requiredText(source.pullRequest.nodeId, "source pull request nodeId");
  requiredText(source.pullRequest.reviewRequestId, "source reviewRequestId");
  requiredRepository(source.pullRequest.headRepository, "source head repository");
  requiredRepository(source.pullRequest.baseRepository, "source base repository");
  requiredSha(source.pullRequest.headSha, "source pull request head");
  if (
    source.remoteHeadSha !== source.headSha
    || source.pullRequest.headSha !== source.headSha
    || source.pullRequest.headBranch !== source.branch
    || source.pullRequest.baseBranch !== "main"
    || source.pullRequest.reviewRequestId !== `github-pull-request:${source.pullRequest.nodeId}`
    || source.branch !== `agent/${source.lease.device}/${source.lease.scope}`
  ) throw new Error("Retirement source identities do not join.");
  return source;
}
export function normalizePullRequest(value) {
  requireObject(value, "Pull request");
  return {
    url: requiredText(value.url, "pull request URL"),
    number: positiveInteger(value.number, "pull request number"),
    nodeId: requiredText(value.nodeId, "pull request node ID"),
    providerVersion: requiredText(value.providerVersion, "pull request provider version"),
    state: requiredText(value.state, "pull request state").toUpperCase(),
    draft: value.draft === true,
    merged: value.merged === true,
    closedAt: value.closedAt || null,
    body: String(value.body || ""),
    headRepository: requiredRepository(value.headRepository, "head repository"),
    headBranch: requiredText(value.headBranch, "head branch"),
    headSha: requiredSha(value.headSha, "pull request head"),
    baseRepository: requiredRepository(value.baseRepository, "base repository"),
    baseBranch: requiredText(value.baseBranch, "base branch"),
    baseSha: requiredSha(value.baseSha, "pull request base"),
  };
}
function normalizeMarker(value) {
  requireObject(value, "Local review retirement marker");
  if (value.schema !== LOCAL_REVIEW_RETIREMENT_INTENT_SCHEMA) {
    throw new Error("Unsupported local review retirement marker.");
  }
  const normalized = {
    schema: value.schema,
    intentDigest: requiredDigest(value.intentDigest, "marker intentDigest"),
    retiredAt: requiredInstant(value.retiredAt, "marker retiredAt"),
    releasedWriterMarkerDigest: requiredDigest(
      value.releasedWriterMarkerDigest,
      "marker releasedWriterMarkerDigest",
    ),
  };
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(Object.keys(normalized).sort())) {
    throw new Error("Local review retirement marker has unexpected fields.");
  }
  return Object.freeze(normalized);
}
function normalizeProviderEvidence(value) {
  requireObject(value, "Provider evidence");
  const marker = normalizeMarker(value.marker);
  if (value.state !== "CLOSED" || value.merged !== false) {
    throw new Error("Provider evidence must preserve one closed, unmerged pull request.");
  }
  const markerDigest = requiredDigest(value.markerDigest, "provider markerDigest");
  const releasedWriterMarkerDigest = requiredDigest(
    value.releasedWriterMarkerDigest,
    "provider releasedWriterMarkerDigest",
  );
  if (
    markerDigest !== digestValue(renderLocalReviewRetirementMarker(marker))
    || releasedWriterMarkerDigest !== marker.releasedWriterMarkerDigest
  ) throw new Error("Provider marker digests do not join their evidence.");
  return Object.freeze({
    state: value.state,
    merged: value.merged,
    closedAt: requiredInstant(value.closedAt, "provider closedAt"),
    headSha: requiredSha(value.headSha, "provider headSha"),
    bodyDigest: requiredDigest(value.bodyDigest, "provider bodyDigest"),
    marker,
    markerDigest,
    releasedWriterMarkerDigest,
  });
}
function normalizeCloudEvidence(value) {
  requireObject(value, "Cloud evidence");
  return Object.freeze({
    ledgerRepository: requiredRepository(value.ledgerRepository, "cloud ledgerRepository"),
    ledgerRevision: requiredSha(value.ledgerRevision, "cloud ledgerRevision"),
    ledgerDigest: requiredDigest(value.ledgerDigest, "cloud ledgerDigest"),
    remoteClaimInventoryDigest: requiredDigest(
      value.remoteClaimInventoryDigest,
      "cloud remoteClaimInventoryDigest",
    ),
    cloudVerificationReceiptDigest: requiredDigest(
      value.cloudVerificationReceiptDigest,
      "cloud verification receipt",
    ),
    dormantPreservationReceiptDigest: requiredDigest(
      value.dormantPreservationReceiptDigest,
      "dormant preservation receipt",
    ),
  });
}
function preservationPolicy() {
  return Object.freeze({
    worktree: "preserved",
    branch: "preserved",
    pullRequest: "closed-preserved",
    bytes: "exact",
    cleanupEligible: false,
  });
}
function normalizePreservation(value) {
  const expected = preservationPolicy();
  if (digestValue(value) !== digestValue(expected)) {
    throw new Error("Retirement preservation policy is invalid.");
  }
  return expected;
}
export function normalizeLocalReviewRetirementRequest(value) {
  requireObject(value, "Retirement request");
  return Object.freeze({
    repository: path.resolve(requiredText(value.repository, "repository")),
    targetRepository: requiredRepository(value.targetRepository, "targetRepository"),
    ledgerRepository: requiredRepository(value.ledgerRepository, "ledgerRepository"),
    branch: requiredText(value.branch, "branch"),
    sourceSessionId: requiredText(value.sourceSessionId, "sourceSessionId"),
    operatorSessionId: requiredText(value.operatorSessionId, "operatorSessionId"),
    expectedHead: requiredSha(value.expectedHead, "expectedHead"),
    expectedPullRequest: positiveInteger(value.expectedPullRequest, "expectedPullRequest"),
    expectedPullRequestUrl: requiredText(value.expectedPullRequestUrl, "expectedPullRequestUrl"),
    operatorDecisionDigest: requiredDigest(value.operatorDecisionDigest, "operatorDecisionDigest"),
    evaluatedAt: requiredInstant(value.evaluatedAt, "evaluatedAt"),
  });
}
export function normalizeCurrentCloudClaim(source) {
  const core = {
    claimId: requiredDigest(source?.claimId, "claimId"),
    state: projectRootState(requiredText(source?.state, "claim state")),
    actorId: requiredText(source?.actorId, "claim actorId"),
    repositoryId: requiredText(source?.repositoryId, "claim repositoryId"),
    workItemId: requiredText(source?.workItemId, "claim workItemId"),
    canonicalBaseRevision: requiredSha(source?.canonicalBaseRevision, "claim canonical base"),
    laneRevision: requiredSha(source?.laneRevision, "claim lane revision"),
    declaredWriteScope: normalizeWriteSet(source?.declaredWriteScope),
    writeSetDigest: requiredDigest(source?.writeSetDigest, "claim writeSetDigest"),
    leaseEpoch: positiveInteger(source?.leaseEpoch, "claim leaseEpoch"),
    transitionCounter: positiveInteger(source?.transitionCounter, "claim transitionCounter"),
    heartbeatCounter: nonnegativeInteger(source?.heartbeatCounter, "claim heartbeatCounter"),
    reviewRequestId: source?.reviewRequestId
      ? requiredText(source.reviewRequestId, "claim reviewRequestId") : null,
    expiresAt: requiredInstant(source?.expiresAt, "claim expiresAt"),
    fenceRevision: requiredDigest(source?.fenceRevision, "claim fenceRevision"),
    transitionDigest: requiredDigest(source?.transitionDigest, "claim transitionDigest"),
  };
  if (!["active", "waiting-successor", "review_ready", "delivery_authorized", "parked"].includes(core.state)) {
    throw new Error(`Cloud inventory claim state ${core.state} is not current.`);
  }
  if (digestValue(core.declaredWriteScope) !== core.writeSetDigest) {
    throw new Error(`Cloud inventory claim ${core.claimId} has an invalid write-set digest.`);
  }
  return Object.freeze({ ...core, recordDigest: digestValue(core) });
}
export function withoutReceiptDigest(receipt) {
  const { receiptDigest: _receiptDigest, ...core } = receipt;
  return core;
}
export function uniqueSorted(values, label) {
  const unique = [...new Set(values)].sort();
  if (unique.length !== values.length) throw new Error(`${label} values must be unique.`);
  return unique;
}
export function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}
export function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}
export function requiredRepository(value, label) {
  const normalized = requiredText(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(normalized)) {
    throw new Error(`${label} must use owner/repository form.`);
  }
  return normalized;
}
export function requiredSha(value, label) {
  const normalized = requiredText(value, label);
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a lowercase 40-character SHA.`);
  }
  return normalized;
}
export function requiredDigest(value, label) {
  const normalized = requiredText(value, label);
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return normalized;
}
export function requiredInstant(value, label) {
  const normalized = requiredText(value, label);
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be an ISO-8601 instant.`);
  return new Date(milliseconds).toISOString();
}
export function positiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return normalized;
}
export function nonnegativeInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }
  return normalized;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
