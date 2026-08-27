// Responsibility: Apply exact writer-lease registry projections under one cooperative CAS lock.
import { existsSync, lstatSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  WRITER_LEASE_REGISTRY_SCHEMA,
  WRITER_LEASE_SCHEMA,
} from "./writer-lease-lib.mjs";
import { validateCompletedActiveOwnedDirtRecoveryIntent }
  from "./active-owned-dirt-recovery-contract.mjs";

export const SCOPE_EXPANSION_INTENT_SCHEMA =
  "agentic-active-dirty-scope-expansion-intent/v1";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function writerLeaseDigest(lease) {
  requireLease(lease);
  return digestValue(lease);
}

export function readScopeExpansionIntent({ leaseStore, branch }) {
  const registry = requireRegistry(leaseStore.readRegistry());
  return normalizeIntent(registry.scopeExpansionIntents?.[branch] ?? null);
}

export function beginScopeExpansionIntent({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
  plan,
}) {
  const normalizedPlan = normalizePlan(plan);
  return mutateRegistry({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action: ({ registry, lease }) => {
      const existing = normalizeIntent(registry.scopeExpansionIntents?.[branch] ?? null);
      if (existing) {
        if (existing.planDigest !== normalizedPlan.planDigest) {
          throw new Error("A different scope-expansion intent already fences this branch.");
        }
        return { registry, lease, intent: existing, changed: false };
      }
      const intent = Object.freeze({
        schema: SCOPE_EXPANSION_INTENT_SCHEMA,
        status: "intent",
        branch,
        sourceLeaseDigest: expectedLeaseDigest,
        sourceClaimId: expectedClaimId,
        sourceFenceSha: requiredSha(lease.fenceSha, "source fence SHA"),
        targetWriteSetDigest: normalizedPlan.targetWriteSetDigest,
        targetManifestDigest: normalizedPlan.targetManifestDigest,
        planDigest: normalizedPlan.planDigest,
        targetClaimId: null,
        targetClaimDigest: null,
        targetLeaseEpoch: 1,
        targetCanonicalBaseSha: normalizedPlan.targetCanonicalBaseSha,
        targetReviewRequestId: null,
        completedReceiptDigest: null,
        planSnapshot: snapshotPlan(plan),
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

export function advanceScopeExpansionIntent({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
  expectedPlanDigest,
  values,
}) {
  return mutateRegistry({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action: ({ registry, lease }) => {
      const current = normalizeIntent(registry.scopeExpansionIntents?.[branch] ?? null);
      if (!current || current.planDigest !== requiredDigest(expectedPlanDigest, "plan digest")) {
        throw new Error("Scope-expansion intent is missing or belongs to another plan.");
      }
      const next = normalizeIntent({
        ...current,
        ...values,
        branch,
        schema: SCOPE_EXPANSION_INTENT_SCHEMA,
      });
      return {
        registry: withIntent(registry, branch, next),
        lease,
        intent: next,
        changed: digestValue(current) !== digestValue(next),
      };
    },
  });
}

export function casWriterLeaseProjection({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
  requireNoActiveIntent = false,
  values,
}) {
  if (typeof leaseStore?.withRegistryLock !== "function" || !leaseStore.statePath) {
    const lease = leaseStore.verify({ branch });
    assertExpectedLease({ lease, expectedLeaseDigest, expectedClaimId });
    return Object.freeze({
      lease: leaseStore.annotate({
        sessionId: lease.sessionId,
        branch,
        values,
      }),
      intent: null,
      registryRevision: null,
    });
  }
  return mutateRegistry({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action: ({ registry, lease }) => {
      const intent = normalizeIntent(registry.scopeExpansionIntents?.[branch] ?? null);
      if (requireNoActiveIntent) {
        assertHeartbeatIntentAllows({
          intent,
          recoveryIntent: recoveryFenceIntent(registry, branch),
          expectedClaimId,
          expectedLeaseDigest,
        });
      }
      const next = { ...lease, ...values, schema: WRITER_LEASE_SCHEMA };
      requireLease(next);
      return {
        registry: {
          ...registry,
          leases: { ...registry.leases, [branch]: next },
        },
        lease: next,
        intent,
        changed: true,
      };
    },
  });
}

export function heartbeatWriterLeaseProjection({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
  ttlMs,
  expiresAtCap,
  now = () => new Date(),
}) {
  if (typeof leaseStore?.withRegistryLock !== "function" || !leaseStore.statePath) {
    const lease = leaseStore.verify({ branch });
    assertExpectedLease({ lease, expectedLeaseDigest, expectedClaimId });
    return leaseStore.heartbeat({
      sessionId: lease.sessionId,
      branch,
      ttlMs,
      expiresAtCap,
    });
  }
  const instant = now();
  return casWriterLeaseProjection({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    requireNoActiveIntent: true,
    values: {
      heartbeatAt: instant.toISOString(),
      expiresAt: boundedExpiry({ now: instant, ttlMs, expiresAtCap }),
    },
  }).lease;
}

export function assertHeartbeatScopeExpansionFence({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
}) {
  if (typeof leaseStore?.withRegistryLock !== "function") {
    return leaseStore.verify({ branch });
  }
  return leaseStore.withRegistryLock((registry) => {
    const normalized = requireRegistry(registry);
    const lease = normalized.leases?.[branch];
    assertExpectedLease({ lease, expectedLeaseDigest, expectedClaimId });
    assertHeartbeatIntentAllows({
      intent: normalizeIntent(normalized.scopeExpansionIntents?.[branch] ?? null),
      recoveryIntent: recoveryFenceIntent(normalized, branch),
      expectedClaimId,
      expectedLeaseDigest,
    });
    return lease;
  });
}

export const assertHeartbeatMutationIntentFence =
  assertHeartbeatScopeExpansionFence;

export function withHeartbeatProjectionFence({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
  action,
}) {
  if (typeof action !== "function") throw new Error("Heartbeat projection fence requires an action.");
  if (typeof leaseStore?.withRegistryLock !== "function") {
    return action();
  }
  return leaseStore.withRegistryLock((registry) => {
    const normalized = requireRegistry(registry);
    const lease = normalized.leases?.[branch];
    assertExpectedLease({ lease, expectedLeaseDigest, expectedClaimId });
    assertHeartbeatIntentAllows({
      intent: normalizeIntent(normalized.scopeExpansionIntents?.[branch] ?? null),
      recoveryIntent: recoveryFenceIntent(normalized, branch),
      expectedClaimId,
      expectedLeaseDigest,
    });
    return action();
  });
}

export function assertExpansionIntentCurrent({
  leaseStore,
  branch,
  planDigest,
  sourceLeaseDigest,
  sourceClaimId,
}) {
  const intent = readScopeExpansionIntent({ leaseStore, branch });
  if (
    !intent
    || intent.planDigest !== requiredDigest(planDigest, "plan digest")
    || intent.sourceLeaseDigest !== requiredDigest(sourceLeaseDigest, "source lease digest")
    || intent.sourceClaimId !== requiredDigest(sourceClaimId, "source claim ID")
  ) {
    throw new Error("Scope-expansion intent changed before the fenced transition.");
  }
  return intent;
}

export function mutateWriterLeaseRegistry({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
  action,
}) {
  if (typeof leaseStore?.withRegistryLock !== "function" || !leaseStore.statePath) {
    throw new Error("This transition requires the repository writer-lease registry CAS capability.");
  }
  return leaseStore.withRegistryLock((registry) => {
    const normalized = requireRegistry(registry);
    const lease = normalized.leases?.[branch];
    assertExpectedLease({ lease, expectedLeaseDigest, expectedClaimId });
    const result = action({ registry: normalized, lease });
    if (!result?.registry || !result.lease) {
      throw new Error("Writer-lease registry CAS action returned no exact projection.");
    }
    if (result.changed) writeRegistryCas({
      statePath: leaseStore.statePath,
      expectedRegistry: normalized,
      nextRegistry: result.registry,
    });
    return Object.freeze({
      lease: result.lease,
      intent: result.intent ?? null,
      registryRevision: Number(normalized.revision || 0) + (result.changed ? 1 : 0),
    });
  });
}

const mutateRegistry = mutateWriterLeaseRegistry;

function writeRegistryCas({ statePath, expectedRegistry, nextRegistry }) {
  const normalized = requireRegistry(nextRegistry);
  const next = {
    ...normalized,
    schema: WRITER_LEASE_REGISTRY_SCHEMA,
    revision: Number(expectedRegistry.revision || 0) + 1,
  };
  requireRegistry(next);
  const root = path.dirname(statePath);
  mkdirSync(root, { recursive: true });
  requireRegularRegistryPath(statePath);
  const temporary = `${statePath}.${process.pid}.${Date.now()}.writer-lease-cas.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, statePath);
}

function withIntent(registry, branch, intent) {
  return {
    ...registry,
    scopeExpansionIntents: {
      ...(registry.scopeExpansionIntents || {}),
      [branch]: intent,
    },
  };
}

function assertExpectedLease({ lease, expectedLeaseDigest, expectedClaimId }) {
  requireLease(lease);
  if (writerLeaseDigest(lease) !== requiredDigest(expectedLeaseDigest, "expected lease digest")) {
    throw new Error("Writer lease changed before scope-expansion CAS or active-owned-dirt recovery CAS.");
  }
  const normalizedExpectedClaimId = expectedClaimId === null
    ? null
    : requiredDigest(expectedClaimId, "expected claim ID");
  const claimMatches = normalizedExpectedClaimId === null
    ? lease.cloudAuthority === null || lease.cloudAuthority === undefined
    : lease.cloudAuthority?.claimId === normalizedExpectedClaimId;
  if (!claimMatches) {
    throw new Error("Writer lease claim changed before scope-expansion CAS or active-owned-dirt recovery CAS.");
  }
}

function assertHeartbeatIntentAllows({
  intent,
  recoveryIntent = null,
  expectedClaimId,
  expectedLeaseDigest,
}) {
  if (recoveryIntent) {
    throw new Error("Active-owned-dirt recovery intent fences this heartbeat projection.");
  }
  if (!intent) return;
  const sourceMatch = intent.sourceClaimId === expectedClaimId
    && intent.sourceLeaseDigest === expectedLeaseDigest;
  if (sourceMatch) {
    throw new Error("Scope-expansion intent fences this source heartbeat projection.");
  }
  if (intent.targetClaimId && intent.targetClaimId === expectedClaimId) return;
  throw new Error("Another scope-expansion intent owns this branch projection.");
}

function recoveryFenceIntent(registry, branch) {
  const value = registry.activeOwnedDirtRecoveryIntents?.[branch] ?? null;
  if (value === null || value === undefined) return null;
  if (value.status === "complete") {
    validateCompletedActiveOwnedDirtRecoveryIntent(value);
    return null;
  }
  if (value.schema !== "agentic-active-owned-dirt-recovery-intent/v1"
    || !DIGEST_PATTERN.test(String(value.planDigest || ""))) {
    throw new Error("Active-owned-dirt recovery intent is malformed.");
  }
  return value;
}

function normalizeIntent(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schema !== SCOPE_EXPANSION_INTENT_SCHEMA
    || !["intent", "waiting-successor", "source-retired", "promoted", "successor-bound", "local-cas", "pr-marker", "complete"].includes(value.status)
    || typeof value.branch !== "string" || !value.branch
    || !DIGEST_PATTERN.test(String(value.sourceLeaseDigest || ""))
    || !DIGEST_PATTERN.test(String(value.sourceClaimId || ""))
    || !/^[0-9a-f]{40}$/u.test(String(value.sourceFenceSha || ""))
    || !DIGEST_PATTERN.test(String(value.targetWriteSetDigest || ""))
    || !DIGEST_PATTERN.test(String(value.targetManifestDigest || ""))
    || !DIGEST_PATTERN.test(String(value.planDigest || ""))
    || !Number.isInteger(value.targetLeaseEpoch) || value.targetLeaseEpoch !== 1
    || !/^[0-9a-f]{40}$/u.test(String(value.targetCanonicalBaseSha || ""))
  ) {
    throw new Error("Scope-expansion intent is malformed.");
  }
  for (const key of [
    "targetClaimId",
    "targetClaimDigest",
    "completedReceiptDigest",
    "waitingReceiptDigest",
    "sourceRetirementReceiptDigest",
    "promotedReceiptDigest",
    "boundReceiptDigest",
    "localProjectionReceiptDigest",
    "pullRequestProjectionReceiptDigest",
    "finalReceiptDigest",
  ]) {
    if (value[key] !== null && value[key] !== undefined && !DIGEST_PATTERN.test(String(value[key]))) {
      throw new Error(`Scope-expansion intent ${key} is malformed.`);
    }
  }
  if (value.targetReviewRequestId !== null && value.targetReviewRequestId !== undefined
    && (typeof value.targetReviewRequestId !== "string" || !value.targetReviewRequestId)) {
    throw new Error("Scope-expansion intent review request is malformed.");
  }
  const planSnapshot = snapshotPlan(value.planSnapshot);
  if (planSnapshot.planDigest !== value.planDigest) {
    throw new Error("Scope-expansion intent plan snapshot is inconsistent.");
  }
  const snapshots = {
    waiting: normalizeSnapshot(value.waiting, "waiting successor"),
    promoted: normalizeSnapshot(value.promoted, "promoted successor"),
    boundAuthority: normalizeSnapshot(value.boundAuthority, "bound successor authority"),
    localProjection: normalizeSnapshot(value.localProjection, "local projection"),
    pullRequestProjection: normalizeSnapshot(value.pullRequestProjection, "pull-request projection"),
  };
  return Object.freeze({
    schema: SCOPE_EXPANSION_INTENT_SCHEMA,
    status: value.status,
    branch: value.branch,
    sourceLeaseDigest: value.sourceLeaseDigest,
    sourceClaimId: value.sourceClaimId,
    sourceFenceSha: value.sourceFenceSha,
    targetWriteSetDigest: value.targetWriteSetDigest,
    targetManifestDigest: value.targetManifestDigest,
    planDigest: value.planDigest,
    targetClaimId: value.targetClaimId || null,
    targetClaimDigest: value.targetClaimDigest || null,
    targetLeaseEpoch: value.targetLeaseEpoch,
    targetCanonicalBaseSha: value.targetCanonicalBaseSha,
    targetReviewRequestId: value.targetReviewRequestId || null,
    completedReceiptDigest: value.completedReceiptDigest || null,
    waiting: snapshots.waiting,
    waitingReceiptDigest: value.waitingReceiptDigest || null,
    sourceRetirementReceiptDigest: value.sourceRetirementReceiptDigest || null,
    promoted: snapshots.promoted,
    promotedReceiptDigest: value.promotedReceiptDigest || null,
    boundAuthority: snapshots.boundAuthority,
    boundReceiptDigest: value.boundReceiptDigest || null,
    localProjection: snapshots.localProjection,
    localProjectionReceiptDigest: value.localProjectionReceiptDigest || null,
    pullRequestProjection: snapshots.pullRequestProjection,
    pullRequestProjectionReceiptDigest: value.pullRequestProjectionReceiptDigest || null,
    finalReceiptDigest: value.finalReceiptDigest || null,
    planSnapshot,
  });
}

function normalizeSnapshot(value, label) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Scope-expansion intent ${label} is malformed.`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 65_536) {
    throw new Error(`Scope-expansion intent ${label} is too large.`);
  }
  return Object.freeze(JSON.parse(serialized));
}

function normalizePlan(value) {
  if (!value || typeof value !== "object") throw new Error("Scope-expansion plan is required.");
  return {
    planDigest: requiredDigest(value.planDigest, "plan digest"),
    targetWriteSetDigest: requiredDigest(value.targetWriteSetDigest, "target write-set digest"),
    targetManifestDigest: requiredDigest(value.targetManifestDigest, "target manifest digest"),
    targetCanonicalBaseSha: requiredSha(value.targetCanonicalBaseSha, "target canonical base SHA"),
  };
}

function snapshotPlan(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Scope-expansion intent plan snapshot is required.");
  }
  const { planDigest, ...core } = value;
  if (!DIGEST_PATTERN.test(String(planDigest || "")) || digestValue(core) !== planDigest) {
    throw new Error("Scope-expansion intent plan snapshot digest is invalid.");
  }
  return Object.freeze({ ...core, planDigest });
}

function requireRegistry(registry) {
  if (registry?.schema !== WRITER_LEASE_REGISTRY_SCHEMA
    || !registry.leases || typeof registry.leases !== "object"
    || !Number.isSafeInteger(registry.revision) || registry.revision < 0
    || registry.revision >= Number.MAX_SAFE_INTEGER
    || Object.values(registry.leases).some(candidate => (
      !Number.isSafeInteger(candidate?.epoch) || candidate.epoch < 1
      || candidate.epoch >= Number.MAX_SAFE_INTEGER
    ))) {
    throw new Error("Writer-lease registry schema is unsupported.");
  }
  return registry;
}

function requireRegularRegistryPath(statePath) {
  if (!existsSync(statePath)) return;
  const stat = lstatSync(statePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Writer-lease registry must be a regular non-symlink file.");
  }
}

function requireLease(lease) {
  if (lease?.schema !== WRITER_LEASE_SCHEMA || typeof lease.branch !== "string") {
    throw new Error("Writer lease is malformed.");
  }
  return lease;
}

function requiredDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest.`);
  return String(value);
}

function requiredSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) throw new Error(`${label} must be a SHA.`);
  return String(value);
}

function boundedExpiry({ now, ttlMs, expiresAtCap }) {
  const instant = now instanceof Date ? now : new Date(now);
  const ttl = Number(ttlMs);
  if (!Number.isFinite(instant.getTime()) || !Number.isFinite(ttl) || ttl < 60_000 || ttl > 86_400_000) {
    throw new Error("Writer-lease heartbeat projection has an invalid TTL.");
  }
  const cap = expiresAtCap === null || expiresAtCap === undefined
    ? null
    : Date.parse(expiresAtCap);
  if (cap !== null && (!Number.isFinite(cap) || cap - instant.getTime() < 60_000)) {
    throw new Error("Writer-lease heartbeat projection cloud expiry cap is invalid.");
  }
  return new Date(Math.min(instant.getTime() + Math.floor(ttl), cap ?? Infinity)).toISOString();
}
