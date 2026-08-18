import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import {
  isRetiredPreservedLane,
  normalizeCurrentCloudClaim,
  positiveInteger,
  requiredDigest,
  requiredInstant,
  requiredRepository,
  requiredSha,
  requiredText,
  requireObject,
  uniqueSorted,
  withoutReceiptDigest,
} from "./legacy-review-ready-retirement-lib.mjs";
import { parseDeviceBranch } from "./writer-lease-lib.mjs";

export const LANE_ADMISSION_LEASE_SCHEMA = "agentic-lane-admission-lease/v1";
export const LANE_CLOUD_AUTHORITY_SCHEMA = "agentic-lane-cloud-authority/v1";
export const DORMANT_PRESERVATION_RECEIPT_SCHEMA =
  "agentic-dormant-preservation-receipt/v1";
export const CLOUD_INVENTORY_STATUS_VERIFICATION_SCHEMA =
  "agentic-lane-cloud-inventory-status-verification/v1";

const CLOUD_RESULT_SCHEMA = "agentic-cloud-collaboration-result/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const ADMITTED_LANE_STATES = new Set(["active", "delivery", "review_ready", "parked"]);
const operationDerivedCloudVerifications = new WeakSet();
const operationDerivedInventoryVerifications = new WeakSet();
const operationDerivedDormantVerifications = new WeakSet();

export function markOperationDerivedCloudVerification(verification) {
  requireObject(verification, "Cloud verification");
  operationDerivedCloudVerifications.add(verification);
  return verification;
}

export function isOperationDerivedCloudVerification(verification) {
  return operationDerivedCloudVerifications.has(verification);
}

export function verifyCurrentCloudInventory({
  ledgerRepository,
  targetRepository,
  environment = process.env,
  inspect,
} = {}) {
  if (typeof inspect !== "function") {
    throw new Error("Cloud inventory verification requires the repository status operation.");
  }
  const normalizedLedgerRepository = requiredRepository(
    ledgerRepository, "ledgerRepository",
  );
  const normalizedTargetRepository = requiredRepository(
    targetRepository, "targetRepository",
  );
  const result = inspect({
    action: "status",
    ledgerRepository: normalizedLedgerRepository,
    request: {
      targetRepository: normalizedTargetRepository,
    },
    environment,
  });
  if (
    result?.schema !== CLOUD_RESULT_SCHEMA
    || result.ok !== true
    || result.action !== "status"
    || result.status !== "ready"
    || !Array.isArray(result.claims)
    || result.claims.length > 128
  ) {
    throw new Error("Cloud status did not return one complete bounded current-claim inventory.");
  }
  const claims = result.claims.map(normalizeCurrentCloudClaim)
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
  if (new Set(claims.map(claim => claim.claimId)).size !== claims.length) {
    throw new Error("Cloud status returned duplicate current claim identities.");
  }
  const inventory = Object.freeze({
    schema: "agentic-cloud-claim-inventory-status/v1",
    observedLedgerHeadRevision: requiredSha(result.ledgerRevision, "ledgerRevision"),
    ledgerDigest: requiredDigest(result.ledgerDigest, "ledgerDigest"),
    claims,
  });
  const verification = Object.freeze({
    schema: CLOUD_INVENTORY_STATUS_VERIFICATION_SCHEMA,
    status: "ready",
    ledgerRepository: normalizedLedgerRepository,
    targetRepository: normalizedTargetRepository,
    ledgerRevision: inventory.observedLedgerHeadRevision,
    ledgerDigest: inventory.ledgerDigest,
    remoteClaimInventoryDigest: digestValue(inventory),
    inventory,
    receiptDigest: digestValue({
      schema: CLOUD_INVENTORY_STATUS_VERIFICATION_SCHEMA,
      targetRepository: normalizedTargetRepository,
      ledgerRepository: normalizedLedgerRepository,
      inventory,
    }),
  });
  operationDerivedInventoryVerifications.add(verification);
  return verification;
}

export function isReadyRemoteInventory(verification) {
  if (operationDerivedCloudVerifications.has(verification)) {
    return verification?.schema === "agentic-lane-cloud-verification/v1"
      && verification.status === "ready"
      && verification.inventory?.schema === "agentic-cloud-claim-inventory/v1"
      && verification.remoteClaimInventoryDigest === verification.inventory.inventoryDigest
      && verification.ledgerRevision === verification.inventory.observedLedgerHeadRevision
      && verification.ledgerDigest === verification.inventory.ledgerDigest
      && verification.verifiedAt === verification.inventory.evaluationTime;
  }
  return operationDerivedInventoryVerifications.has(verification)
    && verification?.schema === CLOUD_INVENTORY_STATUS_VERIFICATION_SCHEMA
    && verification.status === "ready"
    && verification.inventory?.schema === "agentic-cloud-claim-inventory-status/v1"
    && verification.ledgerRevision === verification.inventory.observedLedgerHeadRevision
    && verification.ledgerDigest === verification.inventory.ledgerDigest
    && verification.remoteClaimInventoryDigest === digestValue(verification.inventory)
    && verification.receiptDigest === digestValue({
      schema: CLOUD_INVENTORY_STATUS_VERIFICATION_SCHEMA,
      targetRepository: verification.targetRepository,
      ledgerRepository: verification.ledgerRepository,
      inventory: verification.inventory,
    });
}

export function verifyDormantPreservation({
  repository,
  targetRepository,
  lanes,
  worktreePaths = [],
  pullRequestReferences = [],
  operatorDecisionDigest,
  sessionId,
  remoteAuthorityVerification,
  ghJson = executeGitHubJson,
  verifiedAt = new Date().toISOString(),
} = {}) {
  const requestedPaths = uniqueSorted(
    worktreePaths.map(value => path.resolve(requiredText(value, "dormant worktree path"))),
    "dormant worktree path",
  );
  const requestedPullRequests = uniqueSorted(
    pullRequestReferences.map(value => requiredText(value, "dormant pull request")),
    "dormant pull request",
  );
  if (requestedPaths.length + requestedPullRequests.length === 0) return null;
  requiredDigest(operatorDecisionDigest, "operatorDecisionDigest");
  requiredText(sessionId, "sessionId");
  if (!isReadyRemoteInventory(remoteAuthorityVerification)) {
    throw new Error("Dormant preservation requires a fresh operation-derived cloud inventory.");
  }
  const firstIdentity = resolveGitHubIdentity({ targetRepository, ghJson });
  const secondIdentity = resolveGitHubIdentity({ targetRepository, ghJson });
  if (digestValue(firstIdentity) !== digestValue(secondIdentity)) {
    throw new Error("Authenticated repository identity changed during dormant preservation.");
  }
  if (firstIdentity.actor.login !== firstIdentity.repository.ownerLogin) {
    throw new Error("Dormant preservation requires the authenticated repository owner.");
  }
  const laneMap = new Map(lanes.map(lane => [path.resolve(lane.path), lane]));
  const worktrees = requestedPaths.map(requestedPath => {
    const lane = laneMap.get(requestedPath);
    if (!lane || lane.branch === "refs/heads/main") {
      throw new Error(`Dormant preservation path is not a registered non-canonical worktree: ${requestedPath}`);
    }
    if (lane.invalid || lane.leaseAmbiguous) {
      throw new Error(`Dormant preservation cannot waive structural ambiguity: ${requestedPath}`);
    }
    return normalizeWorktreeProjection(lane);
  });
  const firstPullRequests = requestedPullRequests.map(reference => (
    resolvePullRequest({ reference, repository: firstIdentity.repository.nameWithOwner, ghJson })
  ));
  const secondPullRequests = requestedPullRequests.map(reference => (
    resolvePullRequest({ reference, repository: firstIdentity.repository.nameWithOwner, ghJson })
  ));
  if (digestValue(firstPullRequests) !== digestValue(secondPullRequests)) {
    throw new Error("Pull-request identity changed during dormant preservation.");
  }
  const receiptCore = {
    schema: DORMANT_PRESERVATION_RECEIPT_SCHEMA,
    status: "dormant-preserved",
    authorityState: "dormant-preserved",
    authenticatedActor: firstIdentity.actor,
    repository: {
      ...firstIdentity.repository,
      path: path.resolve(repository),
    },
    sessionId,
    operatorDecisionDigest,
    cloudInventory: {
      ledgerRevision: remoteAuthorityVerification.ledgerRevision,
      ledgerDigest: remoteAuthorityVerification.ledgerDigest,
      inventoryDigest: digestValue(remoteAuthorityVerification.inventory.claims),
      verificationReceiptDigest: remoteAuthorityVerification.receiptDigest,
    },
    worktrees,
    pullRequests: firstPullRequests,
    verifiedAt: requiredInstant(verifiedAt, "verifiedAt"),
  };
  rejectCurrentDormantAuthority({
    receipt: receiptCore,
    claims: remoteAuthorityVerification.inventory.claims,
  });
  const receipt = Object.freeze({
    ...receiptCore,
    receiptDigest: digestValue(receiptCore),
  });
  operationDerivedDormantVerifications.add(receipt);
  return receipt;
}

export function isOperationDerivedDormantPreservation(receipt) {
  return operationDerivedDormantVerifications.has(receipt)
    && receipt?.schema === DORMANT_PRESERVATION_RECEIPT_SCHEMA
    && receipt.status === "dormant-preserved"
    && receipt.receiptDigest === digestValue(withoutReceiptDigest(receipt));
}

export function classifyExistingLane({
  lane,
  branch,
  semanticScope,
  declaredWriteSet,
  evaluatedAt,
  currentRemoteClaims,
  dormantPreservationReceipt = null,
}) {
  const dormant = dormantProjectionForLane(lane, dormantPreservationReceipt);
  const reasons = [];
  if (isDetachedIntegratedCompletionLane(lane, declaredWriteSet)) {
    return {
      ...lane,
      classification: "disjoint-attributed",
      authorityState: "disjoint-attributed",
      dormantPreservationReceiptDigest: null,
      overlapReasons: [],
    };
  }
  if (isRetiredPreservedLane({ lane })) {
    const reasons = [];
    if (lane.invalid || lane.leaseAmbiguous) reasons.push("structural-ambiguity");
    if (lane.branch === `refs/heads/${branch}`) reasons.push("same-branch");
    if (retiredPreservationHasCurrentClaim(lane, currentRemoteClaims)) {
      reasons.push("current-authority-conflict");
    }
    const result = {
      ...lane,
      authorityState: "retired-preserved",
      dormantPreservationReceiptDigest: null,
      overlapReasons: reasons,
    };
    if (reasons.includes("structural-ambiguity")) {
      return { ...result, classification: "ambiguous" };
    }
    if (reasons.length > 0) return { ...result, classification: "overlapping" };
    return { ...result, classification: "disjoint-attributed" };
  }
  if (lane.invalid || lane.leaseAmbiguous) reasons.push("structural-ambiguity");
  if (lane.branch === `refs/heads/${branch}`) reasons.push("same-branch");
  const identity = lane.branch
    ? parseDeviceBranch(lane.branch.replace(/^refs\/heads\//u, ""))
    : null;
  const current = hasAuthoritativeLaneOwner(
    lane, lane.lease, evaluatedAt, currentRemoteClaims,
  );
  const reviewReadyProjection = hasReviewReadyProjection(lane, evaluatedAt, declaredWriteSet);
  const expiredLocalProjection = isExpiredLocalAuthoringProjection(
    lane.lease,
    evaluatedAt,
  );
  const queuedSuccessorProjection = hasQueuedSuccessorProjection(
    lane.lease,
    evaluatedAt,
    currentRemoteClaims,
  );
  if (!dormant) {
    if (identity?.scope === semanticScope) reasons.push("same-semantic-scope");
    if (
      !current
      && !reviewReadyProjection
      && !expiredLocalProjection
      && !queuedSuccessorProjection
    ) {
      reasons.push("missing-authoritative-owner");
    }
    const authoritativeScope = lane.lease?.admission?.declaredWriteSet;
    if (Array.isArray(authoritativeScope)) {
      try {
        if (!reviewReadyProjection && writeSetsOverlap(authoritativeScope, declaredWriteSet)) {
          reasons.push("write-set-overlap");
        }
      } catch {
        reasons.push("invalid-declared-write-scope");
      }
    }
  }
  const authorityState = dormant
    ? "dormant-preserved"
    : reviewReadyProjection ? "review-ready-projected"
      : current ? "current" : "unattributed";
  const result = {
    ...lane,
    authorityState,
    dormantPreservationReceiptDigest: dormant?.receiptDigest || null,
  };
  if (reasons.includes("structural-ambiguity")) {
    return { ...result, classification: "ambiguous", overlapReasons: reasons };
  }
  if (reasons.some(reason => ["same-branch", "same-semantic-scope", "write-set-overlap"].includes(reason))) {
    return { ...result, classification: "overlapping", overlapReasons: reasons };
  }
  if (reasons.length > 0) {
    return { ...result, classification: "ambiguous", overlapReasons: reasons };
  }
  return { ...result, classification: "disjoint-attributed", overlapReasons: [] };
}

function dormantProjectionForLane(lane, receipt) {
  if (!isOperationDerivedDormantPreservation(receipt)) return null;
  return receipt.worktrees.find(projection => (
    projection.path === lane.path
    && projection.branch === lane.branch
    && projection.headSha === lane.head
    && projection.stateDigest === lane.stateDigest
  )) ? receipt : null;
}

function isExpiredLocalAuthoringProjection(lease, evaluatedAt) {
  if (!lease || !ADMITTED_LANE_STATES.has(lease.status)) return false;
  const localExpiry = Date.parse(lease.expiresAt);
  return Number.isFinite(localExpiry) && localExpiry <= evaluatedAt.getTime();
}

function hasQueuedSuccessorProjection(lease, evaluatedAt, currentRemoteClaims) {
  if (!lease || lease.status !== "active" || !Array.isArray(currentRemoteClaims)) {
    return false;
  }
  const workItemIds = new Set([
    pseudonymousIdentifier("work-item", lease.branch || ""),
    pseudonymousIdentifier("work-item", lease.scope || ""),
  ]);
  return currentRemoteClaims.some((claim) => {
    const state = String(claim?.state || "").replaceAll("-", "_");
    const expiry = Date.parse(claim?.expiresAt || "");
    return state === "waiting_successor"
      && workItemIds.has(String(claim?.workItemId || ""))
      && Number.isFinite(expiry)
      && expiry > evaluatedAt.getTime();
  });
}

function retiredPreservationHasCurrentClaim(lane, currentRemoteClaims) {
  if (!Array.isArray(currentRemoteClaims)) return true;
  const lease = lane?.lease;
  if (!lease?.branch || !lease?.scope) return true;
  const reviewRequestId = lease.localReviewRetirement?.intent?.source
    ?.pullRequest?.reviewRequestId
    ?? lease.admissionOwnerRetirement?.source?.originalLease
      ?.cloudAuthority?.reviewRequestId
    ?? null;
  const workItemIds = new Set([
    pseudonymousIdentifier("work-item", lease.branch),
    pseudonymousIdentifier("work-item", lease.scope),
  ]);
  return currentRemoteClaims.some(claim => (
    (typeof reviewRequestId === "string" && claim.reviewRequestId === reviewRequestId)
    || workItemIds.has(claim.workItemId)
  ));
}

function hasAuthoritativeLaneOwner(lane, lease, evaluatedAt, currentRemoteClaims) {
  if (!lease || !ADMITTED_LANE_STATES.has(lease.status) || !Array.isArray(currentRemoteClaims)) {
    return false;
  }
  if (path.resolve(lease.worktreePath || "") !== lane.path) return false;
  const checkedOut = lane.branch?.replace(/^refs\/heads\//u, "") || null;
  if (checkedOut && checkedOut !== lease.branch) return false;
  const identity = parseDeviceBranch(lease.branch);
  const localExpiry = Date.parse(lease.expiresAt);
  const cloud = lease.cloudAuthority;
  const cloudExpiry = Date.parse(cloud?.expiresAt);
  const expectedCloudState = {
    active: "active",
    delivery: "delivery_authorized",
    review_ready: "review_ready",
    parked: "parked",
  }[lease.status];
  const requiresCurrentMutationAuthority = expectedCloudState !== "parked";
  const expectedLaneRevision = lease.status === "review_ready"
    ? lease.reviewHeadSha
    : lease.status === "delivery" ? lease.deliveryHeadSha : lease.fenceSha;
  if (
    !lease.sessionId || !identity || identity.device !== lease.device || identity.scope !== lease.scope
    || !Number.isInteger(lease.epoch) || lease.epoch < 1
    || !SHA_PATTERN.test(String(lease.baseSha || ""))
    || !SHA_PATTERN.test(String(lease.fenceSha || "")) || !lease.pullRequestUrl
    || !DIGEST_PATTERN.test(String(lease.admission?.writeSetDigest || ""))
    || lease.admission?.schema !== LANE_ADMISSION_LEASE_SCHEMA
    || lease.admission.status !== "admitted" || lease.admission.semanticScope !== lease.scope
    || !DIGEST_PATTERN.test(String(lease.admission.admissionReceiptDigest || ""))
    || !DIGEST_PATTERN.test(String(lease.admission.preservationReceiptDigest || ""))
    || cloud?.schema !== LANE_CLOUD_AUTHORITY_SCHEMA
    || (requiresCurrentMutationAuthority && cloud?.mutationAuthorityEligible !== true)
    || cloud.writeSetDigest !== lease.admission.writeSetDigest
    || cloud.canonicalBaseSha !== lease.baseSha || cloud.deviceId !== lease.device
    || cloud.sessionId !== lease.sessionId || !cloud.reviewRequestId
    || cloud.state !== expectedCloudState || !SHA_PATTERN.test(String(expectedLaneRevision || ""))
    || lane.head !== expectedLaneRevision || !Number.isFinite(cloudExpiry)
    || cloudExpiry <= evaluatedAt.getTime()
    || (Number.isFinite(localExpiry) && localExpiry > cloudExpiry)
    || (lease.status === "active" && (!Number.isFinite(localExpiry) || localExpiry <= evaluatedAt.getTime()))
  ) return false;
  try {
    const declaredWriteSet = normalizeWriteSet(lease.admission.declaredWriteSet);
    const cloudWriteSet = normalizeWriteSet(cloud.cloudDeclaredWriteScope);
    const matches = currentRemoteClaims.filter(claim => claim.claimId === cloud.claimId);
    if (matches.length !== 1) return false;
    const remote = matches[0];
    return digestValue(declaredWriteSet) === lease.admission.writeSetDigest
      && JSON.stringify(cloudWriteSet) === JSON.stringify(declaredWriteSet)
      && JSON.stringify(remote.declaredWriteScope) === JSON.stringify(declaredWriteSet)
      && remote.writeSetDigest === lease.admission.writeSetDigest
      && remote.fenceRevision === cloud.claimDigest
      && remote.transitionDigest === cloud.claimLedgerRevision
      && remote.canonicalBaseRevision === cloud.canonicalBaseSha
      && remote.laneRevision === cloud.laneRevision && remote.laneRevision === expectedLaneRevision
      && remote.leaseEpoch === cloud.leaseEpoch
      && remote.transitionCounter === cloud.transitionCounter
      && remote.state === cloud.state && remote.expiresAt === cloud.expiresAt
      && remote.reviewRequestId === cloud.reviewRequestId;
  } catch {
    return false;
  }
}

function hasReviewReadyProjection(lane, evaluatedAt, declaredWriteSet) {
  const lease = lane.lease;
  const cloud = lease?.cloudAuthority;
  const cloudExpiry = cloud?.expiresAt ? Date.parse(cloud.expiresAt) : null;
  if (
    lease?.status !== "review_ready"
    || cloud?.state !== "review_ready"
    || path.resolve(lease.worktreePath || "") !== lane.path
    || lane.head !== lease.reviewHeadSha
    || !SHA_PATTERN.test(String(lease.baseSha || ""))
    || !DIGEST_PATTERN.test(String(lease.admission?.writeSetDigest || ""))
    || lease.admission?.schema !== LANE_ADMISSION_LEASE_SCHEMA
    || lease.admission.status !== "admitted"
    || cloud.schema !== LANE_CLOUD_AUTHORITY_SCHEMA
    || !matchesReviewReadyProjectionBase({ lease, cloud })
    || cloud.laneRevision !== lease.reviewHeadSha
    || cloud.writeSetDigest !== lease.admission.writeSetDigest
    || JSON.stringify(cloud.cloudDeclaredWriteScope) !== JSON.stringify(lease.admission.declaredWriteSet)
    || (cloud?.expiresAt && (!Number.isFinite(cloudExpiry) || cloudExpiry <= evaluatedAt.getTime()))
  ) {
    return false;
  }
  try {
    return !writeSetsOverlap(lease.admission.declaredWriteSet, declaredWriteSet)
      || lease.branch === null;
  } catch {
    return false;
  }
}

function matchesReviewReadyProjectionBase({ lease, cloud }) {
  if (cloud.canonicalBaseSha === lease.baseSha) return true;
  const recovery = lease?.ownedDirtRecovery;
  return (
    lease?.status === "review_ready"
    && recovery?.schema === "agentic-owned-dirt-resume/v1"
    && cloud?.state === "review_ready"
    && SHA_PATTERN.test(String(recovery.reviewHeadSha || ""))
    && recovery.reviewHeadSha === lease.baseSha
    && cloud.laneRevision === lease.reviewHeadSha
  );
}

function isDetachedIntegratedCompletionLane(lane, declaredWriteSet) {
  const lease = lane.lease;
  if (
    lane.detached !== true
    || lane.dirty
    || !lease
    || !["completing", "completed"].includes(lease.status)
    || lease.admission?.status !== "admitted"
    || lease.completion?.mainSha !== lane.head
  ) {
    return false;
  }
  try {
    return JSON.stringify(normalizeWriteSet(lease.admission.declaredWriteSet))
      === JSON.stringify(normalizeWriteSet(declaredWriteSet));
  } catch {
    return false;
  }
}

function rejectCurrentDormantAuthority({ receipt, claims }) {
  const repositoryId = `github-repository:${receipt.repository.id}`;
  const claimIds = new Set(receipt.worktrees.map(item => item.projectedClaimId).filter(Boolean));
  const reviewRequestIds = new Set(receipt.pullRequests.map(item => item.reviewRequestId));
  const workItemIds = new Set();
  for (const projection of [...receipt.worktrees, ...receipt.pullRequests]) {
    if (!projection.branch) continue;
    workItemIds.add(pseudonymousIdentifier("work-item", projection.branch));
    const identity = parseDeviceBranch(projection.branch);
    if (identity?.scope) workItemIds.add(pseudonymousIdentifier("work-item", identity.scope));
  }
  const conflicts = claims.filter(claim => claim.repositoryId === repositoryId && (
    claimIds.has(claim.claimId)
    || reviewRequestIds.has(claim.reviewRequestId)
    || workItemIds.has(claim.workItemId)
  ));
  if (conflicts.length > 0) {
    throw new Error(`Dormant preservation matched current cloud authority: ${conflicts.map(item => item.claimId).sort().join(", ")}`);
  }
}

function resolveGitHubIdentity({ targetRepository, ghJson }) {
  const actor = resolveAuthenticatedActor(ghJson);
  const repositoryValue = ghJson([
    "repo", "view", requiredRepository(targetRepository, "targetRepository"),
    "--json", "id,nameWithOwner,owner",
  ]);
  return {
    actor: {
      actorId: `github-user:${positiveInteger(actor?.id, "authenticated actor id")}`,
      login: requiredText(actor?.login, "authenticated actor login"),
    },
    repository: {
      id: requiredText(repositoryValue?.id, "repository node id"),
      nameWithOwner: requiredRepository(repositoryValue?.nameWithOwner, "repository name"),
      ownerLogin: requiredText(repositoryValue?.owner?.login, "repository owner login"),
    },
  };
}
function resolveAuthenticatedActor(ghJson) {
  try {
    return ghJson(["api", "user", "--jq", "{id,login}"]);
  } catch (error) {
    const message = String(error?.message || error);
    if (!/\b503\b/u.test(message)) throw error;
  }
  const response = ghJson([
    "api", "graphql", "-f", "query=query { viewer { login databaseId } }",
  ]);
  return {
    id: positiveInteger(response?.data?.viewer?.databaseId, "authenticated actor id"),
    login: requiredText(response?.data?.viewer?.login, "authenticated actor login"),
  };
}

function resolvePullRequest({ reference, repository, ghJson }) {
  const source = ghJson([
    "pr", "view", reference, "--repo", repository, "--json",
    "id,number,url,state,isDraft,headRefName,headRefOid,headRepository,baseRefName,baseRefOid,mergeStateStatus",
  ]);
  if (source?.headRepository?.nameWithOwner !== repository) {
    throw new Error(`Dormant pull request ${reference} must be owned by ${repository}.`);
  }
  const branch = requiredText(source.headRefName, "pull request head branch");
  return Object.freeze({
    number: positiveInteger(source.number, "pull request number"),
    nodeId: requiredText(source.id, "pull request node id"),
    url: requiredText(source.url, "pull request URL"),
    state: requiredText(source.state, "pull request state"),
    isDraft: Boolean(source.isDraft),
    branch,
    headSha: requiredSha(source.headRefOid, "pull request head SHA"),
    headRepository: source.headRepository.nameWithOwner,
    baseBranch: requiredText(source.baseRefName, "pull request base branch"),
    baseSha: requiredSha(source.baseRefOid, "pull request base SHA"),
    mergeStateStatus: requiredText(source.mergeStateStatus, "pull request merge state"),
    reviewRequestId: `github-pull-request:${source.id}`,
  });
}

function normalizeWorktreeProjection(lane) {
  return Object.freeze({
    path: path.resolve(lane.path),
    branch: lane.branch || null,
    detached: Boolean(lane.detached),
    dirty: Boolean(lane.dirty),
    headSha: requiredSha(lane.head, "worktree head SHA"),
    treeSha: requiredSha(lane.treeSha, "worktree tree SHA"),
    indexDigest: requiredDigest(lane.indexDigest, "worktree index digest"),
    workingTreeDigest: requiredDigest(lane.workingTreeDigest, "worktree working digest"),
    stateDigest: requiredDigest(lane.stateDigest, "worktree state digest"),
    projectedClaimId: lane.lease?.cloudAuthority?.claimId || null,
  });
}

function executeGitHubJson(argumentsList) {
  return JSON.parse(execFileSync("gh", argumentsList, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }));
}
