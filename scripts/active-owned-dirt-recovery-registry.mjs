import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeActiveOwnedDirtLeaseRecovery,
  normalizeActiveOwnedDirtRecoveryPlan,
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
          throw new Error("A different active-owned-dirt recovery already fences this branch.");
        }
        return { registry, lease, intent: existing, changed: false };
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
