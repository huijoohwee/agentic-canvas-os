// Responsibility: Persist recovery intents and reconcile exact cloud/local response-loss projections.
import { digestValue, normalizeWriteSet, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";
import { isOperationDerivedCloudVerification }
  from "./scoped-lane-admission-lib.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import { reconcileCloudAuthorityProjection }
  from "./scoped-lane-cloud-reconciliation.mjs";
import { parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker }
  from "./writer-lease-lib.mjs";
import {
  normalizeActiveOwnedDirtLeaseRecovery,
  normalizeActiveOwnedDirtRecoveryPlan,
  validateCompletedActiveOwnedDirtRecoveryIntent,
} from "./active-owned-dirt-recovery-contract.mjs";
import {
  mutateWriterLeaseRegistry,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";

export const ACTIVE_OWNED_DIRT_RECOVERY_INTENT_SCHEMA =
  "agentic-active-owned-dirt-recovery-intent/v1";

const PHASES = Object.freeze([
  "intent",
  "snapshot",
  "cloud",
  "local-cas",
  "pr-marker",
  "complete",
]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function reconcileLostCloudHeartbeat({
  current, branch, inspectCloudStatus, verifyActiveCloudAuthority, now,
}) {
  if (typeof inspectCloudStatus !== "function") return null;
  const authority = current.cloudAuthority;
  const status = inspectCloudStatus({ action: "status", ledgerRepository: authority.ledgerRepository,
    request: { targetRepository: authority.targetRepository, claimId: authority.claimId } });
  const matches = (status?.claims || []).filter(claim => claim?.claimId === authority.claimId);
  if (matches.length !== 1) throw new Error("Cloud heartbeat status requires exactly one candidate claim.");
  const claim = matches[0];
  const identity = digestValue({ actorId: claim.actorId,
    canonicalBaseRevision: claim.canonicalBaseRevision, leaseEpoch: claim.leaseEpoch,
    repositoryId: claim.repositoryId, workItemId: claim.workItemId,
    writeSetDigest: claim.writeSetDigest });
  const sourceHeartbeat = authority.heartbeatCounter ?? 0;
  if (identity !== authority.claimId || claim.entrySchema !== "agentic-cloud-collaboration-entry/v2"
    || claim.claimIdentitySchema !== "agentic-cloud-collaboration-entry/v2"
    || claim.state !== "current" || claim.writeAuthority !== true || claim.scopeReserved !== true
    || claim.canonicalBaseRevision !== authority.canonicalBaseSha
    || claim.laneRevision !== authority.laneRevision || claim.leaseEpoch !== authority.leaseEpoch
    || claim.writeSetDigest !== authority.writeSetDigest
    || JSON.stringify(normalizeWriteSet(claim.declaredWriteScope))
      !== JSON.stringify(authority.cloudDeclaredWriteScope)
    || claim.reviewRequestId !== authority.reviewRequestId
    || claim.integrationReceiptDigest !== (authority.integrationReceiptDigest ?? null)
    || JSON.stringify(claim.integration ?? null) !== JSON.stringify(authority.integration ?? null)) {
    throw new Error("Cloud heartbeat status drifted from the public claim identity.");
  }
  if (claim.transitionCounter === authority.transitionCounter) {
    if (claim.fenceRevision !== authority.claimDigest || claim.transitionDigest !== authority.claimLedgerRevision
      || claim.operationReceiptDigest !== authority.operationReceiptDigest
      || claim.expiresAt !== authority.expiresAt || claim.heartbeatCounter !== sourceHeartbeat) {
      throw new Error("Cloud heartbeat changed without advancing its transition counter.");
    }
    return null;
  }
  if (claim.transitionCounter !== authority.transitionCounter + 1
    || claim.heartbeatCounter !== sourceHeartbeat + 1
    || Date.parse(claim.expiresAt) <= Date.parse(authority.expiresAt)
    || [claim.fenceRevision === authority.claimDigest,
      claim.transitionDigest === authority.claimLedgerRevision,
      claim.operationReceiptDigest === authority.operationReceiptDigest].some(Boolean)) {
    throw new Error("Cloud heartbeat is not one exact renewal ahead of the local projection.");
  }
  const reconciled = reconcileCloudAuthorityProjection({ authority,
    manifest: current.admission, statusResult: status, branch,
    headSha: current.fenceSha, now: now() });
  const verified = verifyActiveCloudAuthority({ authority: {
    ...reconciled.authority, heartbeatCounter: claim.heartbeatCounter,
  }, manifest: current.admission, canonicalBaseSha: authority.canonicalBaseSha });
  return { authority: { ...verified.authority, heartbeatCounter: claim.heartbeatCounter },
    verification: verified.verification };
}

export function verifiedHeartbeatAuthority(result) {
  const claim = result.verification?.inventory?.claims
    ?.find(candidate => candidate.claimId === result.authority?.claimId);
  if ((!Number.isSafeInteger(claim?.heartbeatCounter) || claim.heartbeatCounter < 0)
    && result.authority?.reviewRequestId) return result.authority;
  if (!Number.isSafeInteger(claim?.heartbeatCounter) || claim.heartbeatCounter < 0) {
    throw new Error("Verified cloud heartbeat has no exact heartbeat counter.");
  }
  return Object.freeze({ ...result.authority, heartbeatCounter: claim.heartbeatCounter });
}

export function assertActiveDraftMutationAuthority(input) {
  if (input.cloudAuthority.reviewRequestId) return assertAdmissionMutationAuthority(input);
  const { lease, cloudAuthority: authority, remoteAuthorityVerification: verified, pullRequest } = input;
  const candidate = verified?.inventory?.claims?.filter(claim => claim.claimId === authority.claimId) || [];
  const exact = candidate.length === 1 && candidate[0].state === "active"
    && candidate[0].reviewRequestId === null && verified.status === "ready"
    && isOperationDerivedCloudVerification(verified)
    && verified.claimDigest === authority.claimDigest && verified.ledgerRevision === authority.ledgerRevision
    && verified.ledgerDigest === authority.ledgerDigest && verified.laneRevision === lease.fenceSha
    && verified.writeSetDigest === lease.admission?.writeSetDigest
    && candidate[0].fenceRevision === authority.claimDigest
    && candidate[0].transitionDigest === authority.claimLedgerRevision
    && candidate[0].operationReceiptDigest === authority.operationReceiptDigest
    && candidate[0].leaseEpoch === authority.leaseEpoch
    && candidate[0].transitionCounter === authority.transitionCounter
    && candidate[0].heartbeatCounter === authority.heartbeatCounter
    && JSON.stringify(candidate[0].declaredWriteScope) === JSON.stringify(authority.cloudDeclaredWriteScope)
    && verified.inventory.claims.every(claim => claim.claimId === authority.claimId
      || claim.state === "waiting-successor"
      || !writeSetsOverlap(claim.declaredWriteScope, authority.cloudDeclaredWriteScope));
  if (!exact || !pullRequest?.id || pullRequest.url !== lease.pullRequestUrl
    || pullRequest.state !== "OPEN" || pullRequest.isDraft !== true
    || pullRequest.headRefName !== lease.branch || pullRequest.headRefOid !== lease.fenceSha
    || pullRequest.headRepository?.nameWithOwner !== authority.targetRepository
    || pullRequest.autoMergeRequest !== null || authority.deviceId !== lease.device
    || authority.sessionId !== lease.sessionId || authority.canonicalBaseSha !== lease.baseSha
    || authority.laneRevision !== lease.fenceSha
    || Date.parse(lease.expiresAt) > Date.parse(authority.expiresAt)
    || Date.parse(lease.expiresAt) <= Date.parse(verified.verifiedAt)) {
    throw new Error("Active draft heartbeat requires exact joined cloud, lease, and pull-request authority.");
  }
  const receipt = { schema: "agentic-active-draft-mutation-authority/v1", status: "ready",
    claimId: authority.claimId, claimDigest: authority.claimDigest,
    ledgerRevision: authority.ledgerRevision, pullRequestId: pullRequest.id,
    pullRequestUrl: pullRequest.url, localFenceSha: lease.fenceSha,
    localLeaseEpoch: lease.epoch, remoteLeaseEpoch: authority.leaseEpoch,
    cloudVerificationReceiptDigest: verified.receiptDigest,
    evaluatedAt: verified.verifiedAt, expiresAt: lease.expiresAt };
  return Object.freeze({ ...receipt, receiptDigest: digestValue(receipt) });
}

export function requireExactDraftHeartbeatMarker({ lease, pullRequest }) {
  const marker = parseWriterLeasePullRequestBody(pullRequest?.body);
  if (pullRequest?.headRefOid !== lease.fenceSha
    || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
    throw new Error(`Active draft pull-request marker drifted from the exact writer lease (${marker ? "present" : "missing"}).`);
  }
}

export function assertActiveOwnedDirtPlanSource({ plan, current, allowRecoveredClaim = false }) {
  const normalized = normalizeActiveOwnedDirtRecoveryPlan(plan);
  const source = current?.source, claim = source?.claim;
  const identityMatches = claim?.entrySchema === normalized.sourceEntrySchema
    && claim.claimIdentitySchema === normalized.sourceClaimIdentitySchema
    && claim.actorId === normalized.sourceActorId
    && claim.repositoryId === normalized.sourceRepositoryId
    && claim.workItemId === normalized.sourceWorkItemId
    && (claim.predecessorClaimId ?? null) === normalized.sourcePredecessorClaimId
    && claim.claimId === normalized.sourceClaimId
    && claim.canonicalBaseRevision === normalized.sourceBaseSha
    && claim.laneRevision === normalized.sourceFenceSha
    && claim.leaseEpoch === normalized.sourceCloudLeaseEpoch
    && claim.writeSetDigest === normalized.sourceWriteSetDigest
    && JSON.stringify(normalizeWriteSet(claim.declaredWriteScope))
      === JSON.stringify(normalized.sourceDeclaredWriteSet)
    && claim.reviewRequestId === normalized.sourceReviewRequestId;
  const original = claim?.state === "dormant-preserved"
    && claim.transitionCounter === normalized.sourceCloudTransitionCounter
    && claim.fenceRevision === normalized.sourceClaimDigest
    && claim.transitionDigest === normalized.sourceClaimLedgerRevision
    && claim.operationReceiptDigest === normalized.sourceOperationReceiptDigest
    && source.ledgerRevision === normalized.sourceLedgerRevision
    && source.ledgerDigest === normalized.sourceLedgerDigest;
  const recovered = allowRecoveredClaim && claim?.state === "current"
    && claim.writeAuthority === true && claim.scopeReserved === true
    && claim.transitionCounter === normalized.sourceCloudTransitionCounter + 1
    && claim.fenceRevision !== normalized.sourceClaimDigest
    && claim.transitionDigest !== normalized.sourceClaimLedgerRevision
    && claim.operationReceiptDigest !== normalized.sourceOperationReceiptDigest;
  if (!identityMatches || (!original && !recovered)
    || writerLeaseDigest(source?.lease) !== normalized.sourceLeaseDigest
    || source.worktreeIdentityDigest !== normalized.sourceWorktreeIdentityDigest
    || source.pullRequest?.id !== normalized.sourcePullRequestId
    || source.pullRequest?.url !== normalized.sourcePullRequestUrl
    || source.pullRequest?.headRepository?.nameWithOwner !== normalized.sourcePullRequestRepository
    || source.pullRequestBodyDigest !== normalized.sourcePullRequestBodyDigest
    || source.markerDigest !== normalized.sourceMarkerDigest
    || source.overlappingClaims?.some(candidate => writeSetsOverlap(
      candidate.declaredWriteScope, normalized.sourceDeclaredWriteSet,
    ))) {
    throw new Error("Source lease, claim, worktree, or pull-request projection drifted.");
  }
  return Object.freeze({ recoveredClaim: recovered });
}

export function readActiveOwnedDirtRecoveryIntent({ leaseStore, branch }) {
  const registry = requireRegistry(leaseStore.readRegistry());
  return normalizeIntent(registry.activeOwnedDirtRecoveryIntents?.[branch] ?? null);
}

export function beginActiveOwnedDirtRecoveryIntent({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
  plan,
}) {
  const normalizedPlan = normalizeActiveOwnedDirtRecoveryPlan(plan);
  return mutateWriterLeaseRegistry({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action: ({ registry, lease }) => {
      const existing = normalizeIntent(
        registry.activeOwnedDirtRecoveryIntents?.[branch] ?? null,
      );
      if (existing) {
        if (existing.planDigest !== normalizedPlan.planDigest) {
          if (existing.status !== "complete") {
            throw new Error("A different active-owned-dirt recovery already fences this branch.");
          }
          validateCompletedActiveOwnedDirtRecoveryIntent(existing);
        } else {
          return { registry, lease, intent: existing, changed: false };
        }
      }
      const intent = normalizeIntent({
        schema: ACTIVE_OWNED_DIRT_RECOVERY_INTENT_SCHEMA,
        status: "intent",
        branch,
        sourceLeaseDigest: expectedLeaseDigest,
        sourceClaimId: expectedClaimId,
        planDigest: normalizedPlan.planDigest,
        planSnapshot: normalizedPlan,
        snapshot: null,
        cloud: null,
        localProjection: null,
        pullRequestProjection: null,
        finalReceiptDigest: null,
      });
      return {
        registry: withIntent(registry, branch, intent),
        lease,
        intent,
        changed: true,
      };
    },
  });
}

export function advanceActiveOwnedDirtRecoveryIntent({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
  planDigest,
  status,
  values = {},
}) {
  return mutateWriterLeaseRegistry({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action: ({ registry, lease }) => {
      const current = requireCurrentIntent(registry, branch, planDigest);
      requireMonotonicPhase(current.status, status);
      const next = normalizeIntent({ ...current, ...values, status });
      return {
        registry: withIntent(registry, branch, next),
        lease,
        intent: next,
        changed: digestValue(current) !== digestValue(next),
      };
    },
  });
}

export function projectActiveOwnedDirtRecoveredLease({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
  planDigest,
  cloudAuthority,
  recovery,
  validateLease = null,
}) {
  const normalizedRecovery = normalizeActiveOwnedDirtLeaseRecovery(recovery);
  return mutateWriterLeaseRegistry({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action: ({ registry, lease }) => {
      const current = requireCurrentIntent(registry, branch, planDigest);
      if (current.status === "local-cas" || phaseIndex(current.status) > phaseIndex("local-cas")) {
        const existing = normalizeActiveOwnedDirtLeaseRecovery(lease.activeOwnedDirtRecovery);
        if (existing?.planDigest !== planDigest
          || digestValue(existing) !== digestValue(normalizedRecovery)
          || lease.cloudAuthority?.claimId !== cloudAuthority?.claimId
          || lease.cloudAuthority?.claimDigest !== cloudAuthority?.claimDigest) {
          throw new Error("Recovered writer lease belongs to another plan.");
        }
        return { registry, lease, intent: current, changed: false };
      }
      if (current.status !== "cloud") {
        throw new Error("Local recovery projection requires the durable cloud phase.");
      }
      if (lease.sessionId !== normalizedRecovery.sourceSessionId
        || lease.device !== normalizedRecovery.sourceDevice
        || lease.branch !== normalizedRecovery.sourceBranch
        || lease.fenceSha !== normalizedRecovery.sourceFenceSha) {
        throw new Error("Recovered lease cannot transfer dirty ownership.");
      }
      const nextEpoch = Object.values(registry.leases || {})
        .reduce((highest, candidate) => Math.max(highest, Number(candidate?.epoch || 0)), 0) + 1;
      if (!Number.isSafeInteger(nextEpoch) || nextEpoch >= Number.MAX_SAFE_INTEGER) {
        throw new Error("Recovered writer-lease epoch exceeds the safe global fence range.");
      }
      const nextLease = {
        ...lease,
        status: "active",
        epoch: nextEpoch,
        cloudAuthority,
        heartbeatAt: normalizedRecovery.recoveredAt,
        expiresAt: cloudAuthority.expiresAt,
        activeOwnedDirtRecovery: normalizedRecovery,
      };
      const validation = typeof validateLease === "function"
        ? validateLease(nextLease) : null;
      const localProjection = Object.freeze({
        leaseDigest: writerLeaseDigest(nextLease),
        epoch: nextEpoch,
        claimId: cloudAuthority.claimId,
        claimDigest: cloudAuthority.claimDigest,
        ...(validation?.receiptDigest ? {
          mutationAuthorityReceiptDigest: validation.receiptDigest,
        } : {}),
      });
      const nextIntent = normalizeIntent({
        ...current,
        status: "local-cas",
        localProjection,
      });
      return {
        registry: withIntent({
          ...registry,
          leases: { ...registry.leases, [branch]: nextLease },
        }, branch, nextIntent),
        lease: nextLease,
        intent: nextIntent,
        changed: true,
      };
    },
  });
}

export function normalizeActiveOwnedDirtRecoveryIntent(value) {
  return normalizeIntent(value);
}

function normalizeIntent(value) {
  if (value === null || value === undefined) return null;
  const planSnapshot = normalizeActiveOwnedDirtRecoveryPlan(value.planSnapshot);
  const normalized = {
    schema: value.schema,
    status: value.status,
    branch: requiredText(value.branch, "intent branch"),
    sourceLeaseDigest: requiredDigest(value.sourceLeaseDigest, "intent source lease digest"),
    sourceClaimId: requiredDigest(value.sourceClaimId, "intent source claim ID"),
    planDigest: requiredDigest(value.planDigest, "intent plan digest"),
    planSnapshot,
    snapshot: boundedObject(value.snapshot, "intent snapshot"),
    cloud: boundedObject(value.cloud, "intent cloud projection"),
    localProjection: boundedObject(value.localProjection, "intent local projection"),
    pullRequestProjection: boundedObject(value.pullRequestProjection, "intent pull-request projection"),
    finalReceiptDigest: value.finalReceiptDigest === null || value.finalReceiptDigest === undefined
      ? null : requiredDigest(value.finalReceiptDigest, "intent final receipt digest"),
  };
  if (normalized.schema !== ACTIVE_OWNED_DIRT_RECOVERY_INTENT_SCHEMA
    || !PHASES.includes(normalized.status)
    || normalized.planDigest !== planSnapshot.planDigest) {
    throw new Error("Active-owned-dirt recovery intent is malformed.");
  }
  requirePhasePayloads(normalized);
  return Object.freeze(normalized);
}

function requirePhasePayloads(intent) {
  const required = [
    ["snapshot", "snapshot"],
    ["cloud", "cloud"],
    ["local-cas", "localProjection"],
    ["pr-marker", "pullRequestProjection"],
  ];
  for (const [phase, key] of required) {
    if (phaseIndex(intent.status) >= phaseIndex(phase) && !intent[key]) {
      throw new Error(`Recovery intent ${intent.status} lacks ${key}.`);
    }
  }
  if (intent.status === "complete" && !intent.finalReceiptDigest) {
    throw new Error("Completed recovery intent lacks its final receipt.");
  }
}

function requireCurrentIntent(registry, branch, planDigest) {
  const intent = normalizeIntent(registry.activeOwnedDirtRecoveryIntents?.[branch] ?? null);
  if (!intent || intent.planDigest !== requiredDigest(planDigest, "plan digest")) {
    throw new Error("Active-owned-dirt recovery intent changed before CAS.");
  }
  return intent;
}

function withIntent(registry, branch, intent) {
  return {
    ...registry,
    activeOwnedDirtRecoveryIntents: {
      ...(registry.activeOwnedDirtRecoveryIntents || {}),
      [branch]: intent,
    },
  };
}

function requireMonotonicPhase(current, target) {
  if (phaseIndex(target) < phaseIndex(current)) {
    throw new Error("Active-owned-dirt recovery intent cannot move backward.");
  }
}

function phaseIndex(value) {
  const index = PHASES.indexOf(value);
  if (index < 0) throw new Error("Active-owned-dirt recovery phase is invalid.");
  return index;
}

function boundedObject(value, label) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed.`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 65_536) throw new Error(`${label} is too large.`);
  return Object.freeze(JSON.parse(serialized));
}

function requireRegistry(value) {
  if (value?.schema !== "agentic-writer-lease-registry/v2"
    || !value.leases || typeof value.leases !== "object") {
    throw new Error("Writer-lease registry is malformed.");
  }
  return value;
}

function requiredDigest(value, label) {
  const candidate = String(value || "");
  if (!DIGEST_PATTERN.test(candidate)) throw new Error(`${label} must be a SHA-256 digest.`);
  return candidate;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}
