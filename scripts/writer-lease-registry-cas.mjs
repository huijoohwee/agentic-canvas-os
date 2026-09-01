// Responsibility: Apply exact writer-lease registry projections under one cooperative CAS lock.
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  WRITER_LEASE_REGISTRY_SCHEMA,
  WRITER_LEASE_SCHEMA,
} from "./writer-lease-lib.mjs";
import { validateCompletedActiveOwnedDirtRecoveryIntent }
  from "./active-owned-dirt-recovery-contract.mjs";
import {
  SCOPE_EXPANSION_INTENT_SCHEMA,
  assertCompletedScopeExpansionProjection,
  assertExpectedWriterLease,
  assertHeartbeatTerminalCurrent,
  assertWriterLeaseMutationIntentAvailability,
  boundedWriterLeaseExpiry,
  completedScopeExpansionHeartbeatBridgeDigest,
  completeHeartbeatMutationIntent,
  createHeartbeatMutationIntent,
  createScopeExpansionTombstone,
  normalizeScopeExpansionIntent,
  normalizeScopeExpansionPlan,
  normalizeScopeExpansionTombstone,
  requireCompletedScopeExpansionIntent,
  snapshotScopeExpansionPlan,
  withHeartbeatMutationIntent,
  withScopeExpansionIntent,
} from "./writer-lease-registry-intents.mjs";
export { SCOPE_EXPANSION_INTENT_SCHEMA, assertCompletedScopeExpansionProjection };
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
export function writerLeaseDigest(lease) {
  requireLease(lease);
  return digestValue(lease);
}
export function readScopeExpansionIntent({ leaseStore, branch }) {
  const registry = requireRegistry(leaseStore.readRegistry());
  return normalizeScopeExpansionIntent(registry.scopeExpansionIntents?.[branch] ?? null);
}
export function beginScopeExpansionIntent({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
  plan,
}) {
  const normalizedPlan = normalizeScopeExpansionPlan(plan);
  return mutateRegistry({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action: ({ registry, lease }) => {
      assertWriterLeaseMutationIntentAvailability({
        registry, branch, operation: "scope-expansion",
      });
      const existing = normalizeScopeExpansionIntent(
        registry.scopeExpansionIntents?.[branch] ?? null);
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
        planSnapshot: snapshotScopeExpansionPlan(plan),
      });
      return {
        registry: withScopeExpansionIntent(registry, branch, intent),
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
      const current = normalizeScopeExpansionIntent(
        registry.scopeExpansionIntents?.[branch] ?? null);
      if (!current || current.planDigest !== requiredDigest(expectedPlanDigest, "plan digest")) {
        throw new Error("Scope-expansion intent is missing or belongs to another plan.");
      }
      const next = normalizeScopeExpansionIntent({
        ...current,
        ...values,
        branch,
        schema: SCOPE_EXPANSION_INTENT_SCHEMA,
      });
      return {
        registry: withScopeExpansionIntent(registry, branch, next),
        lease,
        intent: next,
        changed: digestValue(current) !== digestValue(next),
      };
    },
  });
}
export function rolloverCompletedScopeExpansionIntent({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
  targetManifestDigest,
  targetWriteSetDigest,
}) {
  const requestedManifest = requiredDigest(targetManifestDigest, "target manifest digest");
  const requestedWriteSet = requiredDigest(targetWriteSetDigest, "target write-set digest");
  return mutateRegistry({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action: ({ registry, lease }) => {
      assertWriterLeaseMutationIntentAvailability({
        registry, branch, operation: "scope-expansion",
      });
      const archived = registry.lastCompletedScopeExpansionIntents?.[branch] ?? null;
      if (archived) normalizeScopeExpansionTombstone(archived);
      const current = normalizeScopeExpansionIntent(
        registry.scopeExpansionIntents?.[branch] ?? null);
      const sameTarget = current?.targetManifestDigest === requestedManifest
        && current?.targetWriteSetDigest === requestedWriteSet;
      const completed = current?.status === "complete"
        ? assertCompletedScopeExpansionProjection({
          intent: current, lease, expectedLeaseDigest, expectedClaimId,
        }) : null;
      if (!current || sameTarget) {
        return {
          registry, lease, intent: current, archive: archived,
          output: { changed: false }, changed: false,
        };
      }
      const tombstone = createScopeExpansionTombstone(
        completed || requireCompletedScopeExpansionIntent(current));
      const scopeExpansionIntents = { ...(registry.scopeExpansionIntents || {}) };
      delete scopeExpansionIntents[branch];
      return {
        registry: {
          ...registry,
          scopeExpansionIntents,
          lastCompletedScopeExpansionIntents: {
            ...(registry.lastCompletedScopeExpansionIntents || {}),
            [branch]: tombstone,
          },
        },
        lease,
        intent: null,
        archive: tombstone,
        output: { changed: true },
        changed: true,
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
    assertExpectedWriterLease({ lease, expectedLeaseDigest, expectedClaimId });
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
      const intent = normalizeScopeExpansionIntent(
        registry.scopeExpansionIntents?.[branch] ?? null);
      const operationIntents = assertWriterLeaseMutationIntentAvailability({
        registry, branch, operation: "heartbeat",
      });
      const heartbeatIntent = operationIntents.heartbeat;
      if (heartbeatIntent?.status === "active") {
        assertHeartbeatAttemptSource({
          intent: heartbeatIntent, lease, expectedLeaseDigest, expectedClaimId,
        });
      } else if (requireNoActiveIntent) {
        assertHeartbeatIntentAllows({
          intent,
          recoveryIntent: recoveryFenceIntent(registry, branch),
          expectedClaimId,
          expectedLeaseDigest,
        });
      }
      const next = { ...lease, ...values, schema: WRITER_LEASE_SCHEMA };
      requireLease(next);
      if (heartbeatIntent?.status === "active") {
        const { cloudAuthority: _sourceAuthority, ...sourceLeaseSubject } = lease;
        const { cloudAuthority: _targetAuthority, ...targetLeaseSubject } = next;
        if (digestValue(sourceLeaseSubject) !== digestValue(targetLeaseSubject)) {
          throw new Error("Heartbeat C2 projection changed the non-cloud C1 lease subject.");
        }
      }
      const completedHeartbeat = heartbeatIntent?.status === "active"
        ? completeHeartbeatMutationIntent({ intent: heartbeatIntent, targetLease: next })
        : heartbeatIntent;
      const projectedRegistry = completedHeartbeat?.status === "complete"
        ? withHeartbeatMutationIntent(registry, branch, completedHeartbeat)
        : registry;
      return {
        registry: {
          ...projectedRegistry,
          leases: { ...projectedRegistry.leases, [branch]: next },
        },
        lease: next,
        intent,
        heartbeatIntent: completedHeartbeat,
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
    assertExpectedWriterLease({ lease, expectedLeaseDigest, expectedClaimId });
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
      expiresAt: boundedWriterLeaseExpiry({ now: instant, ttlMs, expiresAtCap }),
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
    assertExpectedWriterLease({ lease, expectedLeaseDigest, expectedClaimId });
    assertWriterLeaseMutationIntentAvailability({
      registry: normalized, branch, operation: "heartbeat",
    });
    assertHeartbeatIntentAllows({
      intent: normalizeScopeExpansionIntent(
        normalized.scopeExpansionIntents?.[branch] ?? null),
      recoveryIntent: recoveryFenceIntent(normalized, branch),
      expectedClaimId,
      expectedLeaseDigest,
    });
    return lease;
  });
}
export function assertHeartbeatMutationIntentFence({
  leaseStore,
  branch,
  expectedLeaseDigest,
  expectedClaimId,
}) {
  if (typeof leaseStore?.withRegistryLock !== "function" || !leaseStore.statePath) {
    return assertHeartbeatScopeExpansionFence({
      leaseStore, branch, expectedLeaseDigest, expectedClaimId,
    });
  }
  return mutateRegistry({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action: ({ registry, lease }) => {
      const operationIntents = assertWriterLeaseMutationIntentAvailability({
        registry, branch, operation: "heartbeat",
      });
      assertHeartbeatIntentAllows({
        intent: normalizeScopeExpansionIntent(
          registry.scopeExpansionIntents?.[branch] ?? null),
        recoveryIntent: recoveryFenceIntent(registry, branch),
        expectedClaimId,
        expectedLeaseDigest,
      });
      const existing = operationIntents.heartbeat;
      let predecessorIntentDigest = existing?.predecessorIntentDigest || null;
      let predecessorBridgeDigest = existing?.predecessorBridgeDigest || null;
      if (existing?.status === "complete") {
        predecessorIntentDigest = existing.intentDigest;
        try {
          assertHeartbeatTerminalCurrent({ intent: existing, lease });
          predecessorBridgeDigest = null;
        } catch {
          predecessorBridgeDigest = completedScopeExpansionHeartbeatBridgeDigest({
            heartbeatIntent: existing, scopeExpansionIntent: operationIntents.expansion,
            lease, expectedLeaseDigest, expectedClaimId,
          });
        }
      }
      const proposed = createHeartbeatMutationIntent({
        branch,
        sourceLeaseDigest: expectedLeaseDigest,
        sourceClaimId: expectedClaimId,
        sourceAuthoritySnapshot: lease.cloudAuthority,
        predecessorIntentDigest,
        predecessorBridgeDigest,
      });
      if (existing?.status === "active") {
        assertHeartbeatAttemptSource({
          intent: existing, lease, expectedLeaseDigest, expectedClaimId,
        });
        if (existing.intentDigest !== proposed.intentDigest) {
          throw new Error("Active heartbeat mutation intent belongs to another C1 authority.");
        }
        return { registry, lease, heartbeatIntent: existing, changed: false };
      }
      return {
        registry: withHeartbeatMutationIntent(registry, branch, proposed),
        lease,
        heartbeatIntent: proposed,
        changed: true,
      };
    },
  });
}
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
    assertExpectedWriterLease({ lease, expectedLeaseDigest, expectedClaimId });
    assertWriterLeaseMutationIntentAvailability({
      registry: normalized, branch, operation: "heartbeat",
    });
    assertHeartbeatIntentAllows({
      intent: normalizeScopeExpansionIntent(
        normalized.scopeExpansionIntents?.[branch] ?? null),
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
    assertExpectedWriterLease({ lease, expectedLeaseDigest, expectedClaimId });
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
      heartbeatIntent: result.heartbeatIntent ?? null,
      archive: result.archive ?? null,
      registryRevision: Number(normalized.revision || 0) + (result.changed ? 1 : 0),
      ...(result.output || {}),
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
  try {
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
      flag: "wx", mode: 0o600,
    });
    syncPath(temporary);
    renameSync(temporary, statePath);
    syncPath(root);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}
function syncPath(target) {
  const descriptor = openSync(target, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
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
function assertHeartbeatAttemptSource({ intent, lease, expectedLeaseDigest, expectedClaimId }) {
  if (intent.branch !== lease.branch
    || intent.sourceLeaseDigest !== expectedLeaseDigest
    || intent.sourceClaimId !== expectedClaimId
    || intent.sourceAuthorityDigest !== digestValue(lease.cloudAuthority)) {
    throw new Error("Active heartbeat mutation intent changed its exact C1 authority subject.");
  }
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
