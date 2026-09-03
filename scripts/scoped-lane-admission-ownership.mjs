import path from "node:path";

import {
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  DELIVERY_PEER_VERIFICATION_SCHEMA,
  isOperationDerivedDeliveryPeerVerification,
} from "./scoped-lane-delivery-peer-authority.mjs";
import { parseDeviceBranch } from "./writer-lease-lib.mjs";

export const CURRENT_CLAIM_ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
export const HISTORICAL_CLAIM_ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v1";
export const LANE_ADMISSION_LEASE_SCHEMA = "agentic-lane-admission-lease/v1";
export const LANE_CLOUD_AUTHORITY_SCHEMA = "agentic-lane-cloud-authority/v1";

const ADMITTED_LANE_STATES = new Set([
  "active",
  "delivery",
  "review_ready",
  "parked",
]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function normalizeClaimProvenance(source, label = "claim") {
  const entrySchema = requiredEntrySchema(source?.entrySchema, `${label} entrySchema`);
  const claimIdentitySchema = requiredIdentitySchema(
    source?.claimIdentitySchema,
    entrySchema,
    `${label} claimIdentitySchema`,
  );
  const operationReceiptDigest = source?.operationReceiptDigest
    ? requiredDigest(source.operationReceiptDigest, `${label} operationReceiptDigest`)
    : null;
  if (entrySchema === CURRENT_CLAIM_ENTRY_SCHEMA && !operationReceiptDigest) {
    throw new Error(`${label} current entry requires an operation receipt digest.`);
  }
  return Object.freeze({
    entrySchema,
    claimIdentitySchema,
    operationReceiptDigest,
    mutationAuthorityEligible: entrySchema === CURRENT_CLAIM_ENTRY_SCHEMA,
  });
}

export function claimProvenanceMatches(
  remoteClaim,
  localAuthority,
  { requireCurrentEntry = true } = {},
) {
  try {
    const remote = normalizeClaimProvenance(remoteClaim, "remote claim");
    const local = normalizeClaimProvenance(localAuthority, "local authority");
    return (!requireCurrentEntry
        || (remote.mutationAuthorityEligible && local.mutationAuthorityEligible))
      && requiredDigest(remoteClaim?.claimId, "remote claimId")
        === requiredDigest(localAuthority?.claimId, "local claimId")
      && remote.entrySchema === local.entrySchema
      && remote.claimIdentitySchema === local.claimIdentitySchema
      && remote.operationReceiptDigest === local.operationReceiptDigest;
  } catch {
    return false;
  }
}

export function bindOperationDerivedDeliveryPeerLaneStates(lanes, verification) {
  const authorities = requireDeliveryPeerAuthorityMap(verification, lanes);
  return lanes.map(lane => {
    const authority = authorities.get(path.resolve(lane.path));
    if (!authority) return lane;
    return Object.freeze({
      ...lane,
      stateDigest: digestValue({
        schema: "agentic-delivery-peer-bound-lane-state/v1",
        laneStateDigest: requiredDigest(lane.stateDigest, "lane.stateDigest"),
        authorityDigest: authority.authorityDigest,
      }),
    });
  });
}

export function classifyExistingLane({
  lane,
  branch,
  semanticScope,
  declaredWriteSet,
  evaluatedAt,
  currentRemoteClaims,
  deliveryPeerAuthorities,
}) {
  const reasons = [];
  if (lane.invalid || lane.leaseAmbiguous) reasons.push("structural-ambiguity");
  if (lane.branch === `refs/heads/${branch}`) reasons.push("same-branch");
  const identity = lane.branch
    ? parseDeviceBranch(lane.branch.replace(/^refs\/heads\//u, ""))
    : null;
  if (identity?.scope === semanticScope) reasons.push("same-semantic-scope");
  const lease = lane.lease;
  if (!hasAuthoritativeLaneOwner(
    lane,
    lease,
    evaluatedAt,
    currentRemoteClaims,
    deliveryPeerAuthorities,
  ) && !hasCloudPreservedLaneProjection(lane, lease, currentRemoteClaims)) {
    reasons.push("missing-authoritative-owner");
  }
  const authoritativeScope = lease?.admission?.declaredWriteSet;
  if (Array.isArray(authoritativeScope)) {
    try {
      if (writeSetsOverlap(authoritativeScope, declaredWriteSet)) {
        reasons.push("write-set-overlap");
      }
    } catch {
      reasons.push("invalid-declared-write-scope");
    }
  }
  const collision = reasons.some(reason => [
    "same-branch",
    "same-semantic-scope",
    "write-set-overlap",
  ].includes(reason));
  if (collision) {
    return { ...lane, classification: "overlapping", overlapReasons: reasons };
  }
  if (reasons.length > 0) {
    return { ...lane, classification: "ambiguous", overlapReasons: reasons };
  }
  return { ...lane, classification: "disjoint-attributed", overlapReasons: [] };
}

function hasCloudPreservedLaneProjection(lane, lease, currentRemoteClaims) {
  if (
    !lease
    || !ADMITTED_LANE_STATES.has(lease.status)
    || !Array.isArray(currentRemoteClaims)
    || path.resolve(lease.worktreePath || "") !== lane.path
    || lease.admission?.schema !== LANE_ADMISSION_LEASE_SCHEMA
    || lease.admission.status !== "admitted"
    || !Array.isArray(lease.admission.declaredWriteSet)
    || !DIGEST_PATTERN.test(String(lease.admission.writeSetDigest || ""))
    || !DIGEST_PATTERN.test(String(lease.admission.admissionReceiptDigest || ""))
    || !DIGEST_PATTERN.test(String(lease.admission.preservationReceiptDigest || ""))
    || lease.cloudAuthority?.schema !== LANE_CLOUD_AUTHORITY_SCHEMA
    || !DIGEST_PATTERN.test(String(lease.cloudAuthority.claimId || ""))
  ) return false;
  const checkedOut = lane.branch?.replace(/^refs\/heads\//u, "") || null;
  if (!checkedOut || checkedOut !== lease.branch) return false;
  try {
    const declaredWriteSet = normalizeWriteSet(lease.admission.declaredWriteSet);
    const projectedWriteSet = normalizeWriteSet(
      lease.cloudAuthority.cloudDeclaredWriteScope,
    );
    const matches = currentRemoteClaims.filter(
      claim => claim.claimId === lease.cloudAuthority.claimId,
    );
    if (matches.length !== 1) return false;
    const remote = matches[0];
    return remoteClaimOwnsReplaceableProjection(remote, lease.cloudAuthority)
      && remote.state === "parked"
      && digestValue(declaredWriteSet) === lease.admission.writeSetDigest
      && JSON.stringify(projectedWriteSet) === JSON.stringify(declaredWriteSet)
      && JSON.stringify(remote.declaredWriteScope) === JSON.stringify(declaredWriteSet)
      && remote.writeSetDigest === lease.admission.writeSetDigest
      && remote.canonicalBaseRevision === lease.baseSha
      && remote.canonicalBaseRevision === lease.cloudAuthority.canonicalBaseSha
      && remote.laneRevision === lane.head
      && remote.laneRevision === lease.cloudAuthority.laneRevision
      && remote.leaseEpoch === lease.cloudAuthority.leaseEpoch
      && remote.fenceRevision === lease.cloudAuthority.claimDigest
      && remote.transitionDigest === lease.cloudAuthority.claimLedgerRevision
      && remote.transitionCounter === lease.cloudAuthority.transitionCounter
      && remote.expiresAt === lease.cloudAuthority.expiresAt
      && remote.reviewRequestId === lease.cloudAuthority.reviewRequestId;
  } catch {
    return false;
  }
}

function hasAuthoritativeLaneOwner(
  lane,
  lease,
  evaluatedAt,
  currentRemoteClaims,
  deliveryPeerAuthorities,
) {
  if (
    !lease
    || !ADMITTED_LANE_STATES.has(lease.status)
    || !Array.isArray(currentRemoteClaims)
  ) return false;
  if (path.resolve(lease.worktreePath || "") !== lane.path) return false;
  const checkedOut = lane.branch?.replace(/^refs\/heads\//u, "") || null;
  if (checkedOut && checkedOut !== lease.branch) return false;
  if (hasDeliveryAuthorizedSuccessorOwner({
    lane,
    lease,
    evaluatedAt,
    currentRemoteClaims,
    deliveryPeerAuthorities,
  })) return true;
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
  const expectedLaneRevision = lease.status === "review_ready"
    ? lease.reviewHeadSha
    : lease.status === "delivery"
      ? lease.deliveryHeadSha
      : lease.fenceSha;
  if (
    !lease.sessionId
    || !identity
    || identity.device !== lease.device
    || identity.scope !== lease.scope
    || !Number.isInteger(lease.epoch)
    || lease.epoch < 1
    || !SHA_PATTERN.test(String(lease.baseSha || ""))
    || !SHA_PATTERN.test(String(lease.fenceSha || ""))
    || !lease.pullRequestUrl
    || !DIGEST_PATTERN.test(String(lease.admission?.writeSetDigest || ""))
    || lease.admission?.schema !== LANE_ADMISSION_LEASE_SCHEMA
    || lease.admission.status !== "admitted"
    || lease.admission.semanticScope !== lease.scope
    || !DIGEST_PATTERN.test(String(lease.admission.admissionReceiptDigest || ""))
    || !DIGEST_PATTERN.test(String(lease.admission.preservationReceiptDigest || ""))
    || cloud?.schema !== LANE_CLOUD_AUTHORITY_SCHEMA
    || cloud.writeSetDigest !== lease.admission.writeSetDigest
    || cloud.canonicalBaseSha !== lease.baseSha
    || cloud.deviceId !== lease.device
    || cloud.sessionId !== lease.sessionId
    || !cloud.reviewRequestId
    || cloud.state !== expectedCloudState
    || !SHA_PATTERN.test(String(expectedLaneRevision || ""))
    || lane.head !== expectedLaneRevision
    || !Number.isFinite(cloudExpiry)
    || cloudExpiry <= evaluatedAt.getTime()
    || (Number.isFinite(localExpiry) && localExpiry > cloudExpiry)
    || (lease.status === "active"
      && (!Number.isFinite(localExpiry) || localExpiry <= evaluatedAt.getTime()))
  ) return false;
  try {
    const declaredWriteSet = normalizeWriteSet(lease.admission.declaredWriteSet);
    const cloudWriteSet = normalizeWriteSet(cloud.cloudDeclaredWriteScope);
    const matches = currentRemoteClaims.filter(claim => claim.claimId === cloud.claimId);
    if (matches.length !== 1) return false;
    const remote = matches[0];
    return remoteClaimOwnsReplaceableProjection(remote, cloud)
      && digestValue(declaredWriteSet) === lease.admission.writeSetDigest
      && JSON.stringify(cloudWriteSet) === JSON.stringify(declaredWriteSet)
      && JSON.stringify(remote.declaredWriteScope) === JSON.stringify(declaredWriteSet)
      && remote.writeSetDigest === lease.admission.writeSetDigest
      && remote.fenceRevision === cloud.claimDigest
      && remote.transitionDigest === cloud.claimLedgerRevision
      && remote.canonicalBaseRevision === cloud.canonicalBaseSha
      && remote.laneRevision === cloud.laneRevision
      && remote.laneRevision === expectedLaneRevision
      && remote.leaseEpoch === cloud.leaseEpoch
      && remote.transitionCounter === cloud.transitionCounter
      && remote.state === cloud.state
      && remote.expiresAt === cloud.expiresAt
      && remote.reviewRequestId === cloud.reviewRequestId;
  } catch {
    return false;
  }
}

function remoteClaimOwnsReplaceableProjection(remoteClaim, localProjection) {
  const carriesSchemaProjection = [
    localProjection?.entrySchema,
    localProjection?.claimIdentitySchema,
    localProjection?.mutationAuthorityEligible,
  ].some(value => value !== undefined);
  if (carriesSchemaProjection) {
    return claimProvenanceMatches(remoteClaim, localProjection);
  }
  try {
    const remote = normalizeClaimProvenance(remoteClaim, "remote claim");
    return remote.mutationAuthorityEligible
      && requiredDigest(remoteClaim?.claimId, "remote claimId")
        === requiredDigest(localProjection?.claimId, "local projection claimId")
      && remote.operationReceiptDigest === requiredDigest(
        localProjection?.operationReceiptDigest,
        "local projection operationReceiptDigest",
      );
  } catch {
    return false;
  }
}

function hasDeliveryAuthorizedSuccessorOwner({
  lane,
  lease,
  evaluatedAt,
  currentRemoteClaims,
  deliveryPeerAuthorities,
}) {
  const proof = deliveryPeerAuthorities?.get(lane.path);
  const cloud = lease?.cloudAuthority;
  const identity = parseDeviceBranch(lease?.branch || "");
  if (
    !proof
    || lane.dirty
    || lease.status !== "review_ready"
    || !identity
    || identity.device !== lease.device
    || identity.scope !== lease.scope
    || !Number.isInteger(lease.epoch)
    || lease.epoch < 1
    || !SHA_PATTERN.test(String(lease.baseSha || ""))
    || !SHA_PATTERN.test(String(lease.fenceSha || ""))
    || !SHA_PATTERN.test(String(lease.reviewHeadSha || ""))
    || !lease.pullRequestUrl
    || lease.admission?.schema !== LANE_ADMISSION_LEASE_SCHEMA
    || lease.admission?.status !== "admitted"
    || lease.admission.semanticScope !== lease.scope
    || !Array.isArray(lease.admission.declaredWriteSet)
    || !DIGEST_PATTERN.test(String(lease.admission.writeSetDigest || ""))
    || !DIGEST_PATTERN.test(String(lease.admission.admissionReceiptDigest || ""))
    || !DIGEST_PATTERN.test(String(lease.admission.preservationReceiptDigest || ""))
    || cloud?.schema !== LANE_CLOUD_AUTHORITY_SCHEMA
    || cloud.state !== "review_ready"
    || cloud.deviceId !== lease.device
    || cloud.sessionId !== lease.sessionId
    || cloud.canonicalBaseSha !== lease.baseSha
    || cloud.laneRevision !== lease.reviewHeadSha
    || cloud.writeSetDigest !== lease.admission.writeSetDigest
    || !cloud.reviewRequestId
    || !DIGEST_PATTERN.test(String(cloud.focusedEvidenceDigest || ""))
    || !DIGEST_PATTERN.test(String(cloud.claimDigest || ""))
    || !DIGEST_PATTERN.test(String(cloud.claimLedgerRevision || ""))
    || !Number.isInteger(cloud.transitionCounter)
    || cloud.transitionCounter < 1
    || proof.claimId !== cloud.claimId
    || proof.reviewedHeadSha !== lease.reviewHeadSha
    || proof.observedHeadSha !== lane.head
    || proof.predecessorLedgerRevision !== cloud.ledgerRevision
    || proof.predecessorClaimDigest !== cloud.claimDigest
    || proof.predecessorTransitionDigest !== cloud.claimLedgerRevision
    || proof.predecessorCounter !== cloud.transitionCounter
    || proof.deliveryAuthorizationCounter !== cloud.transitionCounter + 1
    || proof.provider?.repository !== cloud.targetRepository
    || !Number.isSafeInteger(proof.provider.pullRequestNumber)
    || proof.provider.pullRequestNumber < 1
    || proof.provider.reviewRequestId !== cloud.reviewRequestId
    || proof.provider.url !== lease.pullRequestUrl
    || proof.provider.branch !== lease.branch
    || proof.provider.headSha !== lane.head
    || proof.provider.state !== "OPEN"
    || proof.provider.draft !== false
  ) return false;
  try {
    const declaredWriteSet = normalizeWriteSet(lease.admission.declaredWriteSet);
    const cloudWriteSet = normalizeWriteSet(cloud.cloudDeclaredWriteScope);
    const matches = currentRemoteClaims.filter(claim => claim.claimId === cloud.claimId);
    if (matches.length !== 1) return false;
    const remote = matches[0];
    return claimProvenanceMatches(remote, cloud, { requireCurrentEntry: false })
      && digestValue(declaredWriteSet) === lease.admission.writeSetDigest
      && JSON.stringify(cloudWriteSet) === JSON.stringify(declaredWriteSet)
      && JSON.stringify(remote.declaredWriteScope) === JSON.stringify(declaredWriteSet)
      && remote.writeSetDigest === lease.admission.writeSetDigest
      && remote.canonicalBaseRevision === cloud.canonicalBaseSha
      && remote.laneRevision === cloud.laneRevision
      && remote.laneRevision === lease.reviewHeadSha
      && remote.leaseEpoch === cloud.leaseEpoch
      && remote.transitionCounter === proof.currentCounter
      && remote.transitionCounter
        === proof.deliveryAuthorizationCounter + proof.heartbeatSuffixCount
      && remote.state === "delivery_authorized"
      && remote.recordDigest === proof.currentRecordDigest
      && remote.fenceRevision === proof.currentClaimDigest
      && remote.transitionDigest === proof.currentTransitionDigest
      && remote.expiresAt === proof.currentExpiresAt
      && Date.parse(remote.expiresAt) > evaluatedAt.getTime()
      && remote.reviewRequestId === cloud.reviewRequestId
      && remote.fenceRevision !== cloud.claimDigest
      && remote.transitionDigest !== cloud.claimLedgerRevision;
  } catch {
    return false;
  }
}

export function requireDeliveryPeerAuthorityMap(verification, lanes) {
  if (
    !isOperationDerivedDeliveryPeerVerification(verification)
    || verification.schema !== DELIVERY_PEER_VERIFICATION_SCHEMA
    || verification.status !== "ready"
    || !Array.isArray(verification.peers)
    || !DIGEST_PATTERN.test(String(verification.peerSetDigest || ""))
    || !DIGEST_PATTERN.test(String(verification.operationReceiptDigest || ""))
  ) {
    throw new Error(
      "Delivery peer lane binding requires an operation-derived authority proof.",
    );
  }
  const lanePaths = new Set(lanes.map(lane => path.resolve(lane.path)));
  const authorities = new Map();
  for (const proof of verification.peers) {
    const proofPath = path.resolve(requiredText(proof.path, "delivery peer path"));
    const {
      currentLedgerRevision: _currentLedgerRevision,
      currentLedgerDigest: _currentLedgerDigest,
      authorityDigest,
      ...authorityCore
    } = proof;
    if (
      !lanePaths.has(proofPath)
      || authorities.has(proofPath)
      || !DIGEST_PATTERN.test(String(authorityDigest || ""))
      || digestValue(authorityCore) !== authorityDigest
    ) {
      throw new Error("Delivery peer authority proof does not bind one exact lane.");
    }
    authorities.set(proofPath, proof);
  }
  const peerSet = [...authorities.values()]
    .map(proof => ({
      path: proof.path,
      claimId: proof.claimId,
      authorityDigest: proof.authorityDigest,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const { operationReceiptDigest, ...operationCore } = verification;
  if (
    digestValue(peerSet) !== verification.peerSetDigest
    || digestValue(operationCore) !== operationReceiptDigest
  ) {
    throw new Error("Delivery peer authority proof receipt is invalid.");
  }
  return authorities;
}

function requiredEntrySchema(value, label) {
  const schema = String(value || "").trim();
  if (![CURRENT_CLAIM_ENTRY_SCHEMA, HISTORICAL_CLAIM_ENTRY_SCHEMA].includes(schema)) {
    throw new Error(`${label} is unsupported.`);
  }
  return schema;
}

function requiredIdentitySchema(value, entrySchema, label) {
  const schema = requiredEntrySchema(value, label);
  if (
    entrySchema === HISTORICAL_CLAIM_ENTRY_SCHEMA
    && schema !== HISTORICAL_CLAIM_ENTRY_SCHEMA
  ) {
    throw new Error(`${label} cannot postdate its historical entry.`);
  }
  return schema;
}

function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requiredDigest(value, label) {
  const normalized = requiredText(value, label);
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return normalized;
}
