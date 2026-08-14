// Responsibility: Bind exact evidence for retiring one empty admitted owner.
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { WRITER_LEASE_SCHEMA } from "./writer-lease-lib.mjs";

export const ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_REQUEST_SCHEMA =
  "agentic-admitted-empty-abandoned-owner-retirement-request/v1";
export const ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_RECEIPT_SCHEMA =
  "agentic-admitted-empty-abandoned-owner-retirement-receipt/v1";
export const ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_RESULT_SCHEMA =
  "agentic-admitted-empty-abandoned-owner-retirement-result/v1";

export function normalizeAdmittedEmptyAbandonedOwnerRetirementRequest(value) {
  requiredObject(value, "Retirement request");
  return Object.freeze({
    schema: exactText(
      value.schema || ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_REQUEST_SCHEMA,
      ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_REQUEST_SCHEMA,
      "request schema",
    ),
    repository: path.resolve(requiredText(value.repository, "repository")),
    targetRepository: requiredRepository(value.targetRepository, "targetRepository"),
    ledgerRepository: requiredRepository(value.ledgerRepository, "ledgerRepository"),
    branch: requiredText(value.branch, "branch"),
    sourceSessionId: requiredText(value.sourceSessionId, "sourceSessionId"),
    expectedHead: requiredSha(value.expectedHead, "expectedHead"),
    expectedPullRequest: positiveInteger(value.expectedPullRequest, "expectedPullRequest"),
    expectedPullRequestUrl: requiredText(value.expectedPullRequestUrl, "expectedPullRequestUrl"),
    evaluatedAt: requiredInstant(value.evaluatedAt, "evaluatedAt"),
  });
}

export function normalizeAdmittedEmptyAbandonedOwnerSnapshot(snapshot, requestValue) {
  const request = normalizeAdmittedEmptyAbandonedOwnerRetirementRequest(requestValue);
  requiredObject(snapshot, "Retirement snapshot");
  const lane = requiredObject(snapshot.lane, "Retirement lane");
  const lease = requiredObject(snapshot.lease, "Retirement lease");
  const pullRequest = normalizePullRequest(snapshot.pullRequest);
  const observedBranch = String(lane.branch || "").replace(/^refs\/heads\//u, "");
  if (
    lane.invalid
    || lane.leaseAmbiguous
    || lane.detached
    || lane.dirty
    || path.resolve(lane.path || "") !== request.repository
    || observedBranch !== request.branch
    || lane.head !== request.expectedHead
    || lease.schema !== WRITER_LEASE_SCHEMA
    || lease.status !== "active"
    || lease.sessionId !== request.sourceSessionId
    || lease.branch !== request.branch
    || path.resolve(lease.worktreePath || "") !== request.repository
    || lease.admission?.schema !== "agentic-lane-admission-lease/v1"
    || lease.admission?.status !== "admitted"
    || lease.cloudAuthority?.schema !== "agentic-lane-cloud-authority/v1"
    || lease.cloudAuthority?.targetRepository?.toLowerCase() !== request.targetRepository.toLowerCase()
    || lease.admissionOwnerRetirement != null
  ) {
    throw new Error("Lane is not the exact admitted owner requested for empty-owner retirement.");
  }
  if (Date.parse(requiredInstant(lease.expiresAt, "lease expiresAt"))
    > Date.parse(request.evaluatedAt)) {
    throw new Error("Admitted owner is still live; abandonment is forbidden.");
  }
  if (
    snapshot.remoteHeadSha !== request.expectedHead
    || lane.head !== lease.fenceSha
    || pullRequest.number !== request.expectedPullRequest
    || pullRequest.url !== request.expectedPullRequestUrl
    || pullRequest.headSha !== request.expectedHead
    || pullRequest.headBranch !== request.branch
    || pullRequest.headRepository.toLowerCase() !== request.targetRepository.toLowerCase()
    || pullRequest.baseRepository.toLowerCase() !== request.targetRepository.toLowerCase()
    || pullRequest.baseBranch !== "main"
    || pullRequest.draft !== true
    || pullRequest.merged !== false
    || !["OPEN", "CLOSED"].includes(pullRequest.state)
  ) {
    throw new Error("Admitted owner pull request does not match the exact empty-owner identity.");
  }
  requiredSha(snapshot.remoteHeadSha, "remoteHeadSha");
  requiredSha(lane.treeSha, "lane treeSha");
  requiredDigest(lane.stateDigest, "lane stateDigest");
  return Object.freeze({
    lane,
    lease,
    pullRequest,
    remoteHeadSha: snapshot.remoteHeadSha,
    branch: request.branch,
    worktreePath: request.repository,
  });
}

export function normalizeDormantAdmittedOwnerClaim(value, { headSha, canonicalBaseSha, writeSetDigest, reviewRequestId } = {}) {
  requiredObject(value, "Dormant admitted owner claim");
  const rawState = requiredText(value.state, "claim state");
  const parkedState = rawState === "dormant-preserved" || rawState === "parked";
  const normalized = {
    claimId: requiredDigest(value.claimId, "claimId"),
    state: parkedState ? "parked" : rawState,
    writeAuthority: value.writeAuthority === true,
    scopeReserved: value.scopeReserved === undefined ? parkedState : value.scopeReserved === true,
    laneRevision: requiredSha(value.laneRevision, "claim laneRevision"),
    canonicalBaseRevision: requiredSha(value.canonicalBaseRevision, "claim canonicalBaseRevision"),
    writeSetDigest: requiredDigest(value.writeSetDigest, "claim writeSetDigest"),
    transitionCounter: positiveInteger(value.transitionCounter, "claim transitionCounter"),
    fenceRevision: requiredDigest(value.fenceRevision, "claim fenceRevision"),
    reviewRequestId: value.reviewRequestId === null ? null : requiredText(value.reviewRequestId, "claim reviewRequestId"),
  };
  if (
    normalized.state !== "parked"
    || normalized.writeAuthority
    || !normalized.scopeReserved
    || normalized.laneRevision !== requiredSha(headSha, "expected headSha")
    || normalized.canonicalBaseRevision !== requiredSha(canonicalBaseSha, "expected canonicalBaseSha")
    || normalized.writeSetDigest !== requiredDigest(writeSetDigest, "expected writeSetDigest")
    || normalized.reviewRequestId !== requiredText(reviewRequestId, "expected reviewRequestId")
  ) {
    throw new Error("Cloud claim is not the exact dormant-preserved admitted owner.");
  }
  return normalized;
}

export function buildAdmittedEmptyAbandonedOwnerRetirementReceipt({
  source,
  cloud,
  provider,
  retiredAt,
}) {
  const originalLease = structuredClone(requiredObject(source?.lease, "source lease"));
  const core = {
    schema: ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_RECEIPT_SCHEMA,
    status: "completed",
    retiredAt: requiredInstant(retiredAt, "retiredAt"),
    source: {
      worktreePath: path.resolve(requiredText(source?.path, "source path")),
      branch: requiredText(source?.branch, "source branch").replace(/^refs\/heads\//u, ""),
      headSha: requiredSha(source?.head, "source head"),
      treeSha: requiredSha(source?.treeSha, "source tree"),
      stateDigest: requiredDigest(source?.stateDigest, "source stateDigest"),
      remoteHeadSha: requiredSha(source?.remoteHeadSha, "source remoteHeadSha"),
      pullRequestUrl: requiredText(source?.pullRequestUrl, "source pullRequestUrl"),
      originalLease,
      originalLeaseDigest: digestValue(originalLease),
    },
    cloud: {
      ledgerRepository: requiredRepository(cloud?.ledgerRepository, "cloud ledgerRepository"),
      ledgerRevision: requiredSha(cloud?.ledgerRevision, "cloud ledgerRevision"),
      ledgerDigest: requiredDigest(cloud?.ledgerDigest, "cloud ledgerDigest"),
      verificationReceiptDigest: requiredDigest(
        cloud?.verificationReceiptDigest,
        "cloud verificationReceiptDigest",
      ),
      sourceClaimId: requiredDigest(cloud?.sourceClaimId, "cloud sourceClaimId"),
      sourceClaimState: exactText(cloud?.sourceClaimState, "dormant-preserved", "cloud sourceClaimState"),
      reviewRequestId: requiredText(cloud?.reviewRequestId, "cloud reviewRequestId"),
      sourceClaimAbsent: cloud?.sourceClaimAbsent === true,
      retirementReceiptDigest: requiredDigest(
        cloud?.retirementReceiptDigest,
        "cloud retirementReceiptDigest",
      ),
    },
    provider: normalizeProvider(provider),
    preservation: {
      worktree: "preserve",
      branch: "preserve",
      localCommit: "preserve",
      remoteBranch: "preserve",
      pullRequest: "closed-preserved",
      cleanupEligible: false,
      deployment: false,
    },
  };
  if (!core.cloud.sourceClaimAbsent) {
    throw new Error("Retirement requires the source claim to be absent from current authority.");
  }
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeAdmittedEmptyAbandonedOwnerRetirementReceipt(value) {
  const source = requiredObject(value, "Retirement receipt");
  const { receiptDigest, ...core } = source;
  requiredDigest(receiptDigest, "receiptDigest");
  if (
    core.schema !== ADMITTED_EMPTY_ABANDONED_OWNER_RETIREMENT_RECEIPT_SCHEMA
    || core.status !== "completed"
    || digestValue(core) !== receiptDigest
  ) {
    throw new Error("Admitted empty-owner retirement receipt is invalid.");
  }
  const rebuilt = buildAdmittedEmptyAbandonedOwnerRetirementReceipt({
    ...core,
    source: {
      path: core.source?.worktreePath,
      branch: core.source?.branch,
      head: core.source?.headSha,
      treeSha: core.source?.treeSha,
      stateDigest: core.source?.stateDigest,
      remoteHeadSha: core.source?.remoteHeadSha,
      pullRequestUrl: core.source?.pullRequestUrl,
      lease: core.source?.originalLease,
    },
  });
  if (rebuilt.receiptDigest !== receiptDigest) {
    throw new Error("Admitted empty-owner retirement receipt changed during normalization.");
  }
  return rebuilt;
}

export function isRetiredAdmittedEmptyAbandonedOwnerLane({ lane = null, record = null, lease = null } = {}) {
  const observed = lane || record;
  const currentLease = lease || lane?.lease || null;
  try {
    const receipt = normalizeAdmittedEmptyAbandonedOwnerRetirementReceipt(
      currentLease?.admissionOwnerRetirement,
    );
    const source = receipt.source;
    const observedBranch = String(observed?.branch || "").replace(/^refs\/heads\//u, "");
    if (
      currentLease.schema !== WRITER_LEASE_SCHEMA
      || currentLease.status !== "released"
      || currentLease.admission !== null
      || currentLease.cloudAuthority !== null
      || currentLease.heartbeatAt !== receipt.retiredAt
      || currentLease.expiresAt !== receipt.retiredAt
      || path.resolve(currentLease.worktreePath || "") !== source.worktreePath
      || path.resolve(observed?.path || "") !== source.worktreePath
      || currentLease.branch !== source.branch
      || observedBranch !== source.branch
      || observed?.head !== source.headSha
      || observed?.dirty === true
      || receipt.preservation.cleanupEligible !== false
    ) {
      return false;
    }
    const { admissionOwnerRetirement: _receipt, ...released } = currentLease;
    const reconstructed = {
      ...released,
      status: source.originalLease.status,
      heartbeatAt: source.originalLease.heartbeatAt,
      expiresAt: source.originalLease.expiresAt,
      admission: source.originalLease.admission,
      cloudAuthority: source.originalLease.cloudAuthority,
      ...(Object.hasOwn(source.originalLease, "taskAuthority")
        ? { taskAuthority: source.originalLease.taskAuthority }
        : {}),
    };
    return (
      digestValue(reconstructed) === source.originalLeaseDigest
      && digestValue(source.originalLease) === source.originalLeaseDigest
      && (!observed?.treeSha || observed.treeSha === source.treeSha)
    );
  } catch {
    return false;
  }
}

function normalizeProvider(value) {
  const provider = requiredObject(value, "provider evidence");
  if (provider.state !== "CLOSED" || provider.mergedAt !== null || !provider.closedAt) {
    throw new Error("Provider evidence must preserve one closed, unmerged pull request.");
  }
  return {
    url: requiredText(provider.url, "pull request URL"),
    number: positiveInteger(provider.number, "pull request number"),
    state: "CLOSED",
    draft: provider.draft === true,
    mergedAt: null,
    closedAt: requiredInstant(provider.closedAt, "pull request closedAt"),
    headBranch: requiredText(provider.headBranch, "pull request head branch"),
    headSha: requiredSha(provider.headSha, "pull request head SHA"),
    baseBranch: requiredText(provider.baseBranch, "pull request base branch"),
    baseSha: requiredSha(provider.baseSha, "pull request base SHA"),
    bodyDigest: requiredDigest(provider.bodyDigest, "pull request bodyDigest"),
  };
}

function normalizePullRequest(value) {
  requiredObject(value, "Pull request");
  return {
    url: requiredText(value.url, "pull request URL"),
    number: positiveInteger(value.number, "pull request number"),
    nodeId: requiredText(value.nodeId, "pull request nodeId"),
    providerVersion: requiredText(value.providerVersion, "pull request providerVersion"),
    state: requiredText(value.state, "pull request state").toUpperCase(),
    draft: value.draft === true,
    merged: value.merged === true,
    closedAt: value.closedAt === null ? null : requiredInstant(value.closedAt, "pull request closedAt"),
    body: String(value.body || ""),
    headRepository: requiredRepository(value.headRepository, "pull request headRepository"),
    headBranch: requiredText(value.headBranch, "pull request headBranch"),
    headSha: requiredSha(value.headSha, "pull request headSha"),
    baseRepository: requiredRepository(value.baseRepository, "pull request baseRepository"),
    baseBranch: requiredText(value.baseBranch, "pull request baseBranch"),
    baseSha: requiredSha(value.baseSha, "pull request baseSha"),
  };
}

function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}

function exactText(value, expected, label) {
  const actual = requiredText(value, label);
  if (actual !== expected) throw new Error(`${label} must be ${expected}.`);
  return actual;
}

function requiredRepository(value, label) {
  const repository = requiredText(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error(`${label} is invalid.`);
  }
  return repository;
}

function requiredSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}

function requiredDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}

function requiredInstant(value, label) {
  const instant = new Date(value);
  if (!value || Number.isNaN(instant.getTime()) || instant.toISOString() !== value) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} is invalid.`);
  return value;
}
