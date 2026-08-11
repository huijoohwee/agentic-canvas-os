import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { WRITER_LEASE_REGISTRY_SCHEMA, WRITER_LEASE_SCHEMA } from "./writer-lease-lib.mjs";
export const REVIEWED_LANE_ENTRYPOINT_FENCE_SCHEMA =
  "agentic-reviewed-lane-entrypoint-fence/v1";
export const REVIEWED_LANE_REVISION_JOURNAL_SCHEMA =
  "agentic-reviewed-lane-revision-journal/v1";
export const REVIEWED_LANE_REVISION_PHASES = Object.freeze([
  "prepared", "successor_waiting", "commit_created", "local_ref_updated",
  "remote_ref_updated", "source_retired", "successor_current", "successor_bound",
  "successor_review_ready", "lease_updated", "pr_projected", "verified", "complete",
]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const PHASE_INDEX = new Map(REVIEWED_LANE_REVISION_PHASES.map((phase, index) => [phase, index]));
const fenceStores = new WeakMap();
export function acquireReviewedLaneEntrypointFence({ leaseStore, branch, entrypoint,
  operationDigest, expectedLeaseDigest, expectedClaimId = null }) {
  const identity = normalizeOperationIdentity({ branch, entrypoint, operationDigest });
  const expected = normalizeExpectedProjection({ expectedLeaseDigest, expectedClaimId });
  const result = mutateRegistry({
    leaseStore,
    action: registry => {
      requireExpectedLease(registry, identity.branch, expected);
      const intent = normalizeIntent(registry.reviewedLaneRevisionIntents?.[identity.branch] ?? null);
      assertIntentOwner(intent, identity);
      const current = normalizeFence(registry.reviewedLaneEntrypointFences?.[identity.branch] ?? null);
      if (current && isLiveProcess(current.ownerPid)) {
        throw new Error(
          `Reviewed-lane entrypoint ${current.entrypoint} already fences ${identity.branch} in process ${current.ownerPid}.`,
        );
      }
      const acquiredAt = new Date().toISOString();
      const core = {
        schema: REVIEWED_LANE_ENTRYPOINT_FENCE_SCHEMA,
        branch: identity.branch,
        entrypoint: identity.entrypoint,
        operationDigest: identity.operationDigest,
        sourceLeaseDigest: expected.expectedLeaseDigest,
        sourceClaimId: expected.expectedClaimId,
        ownerPid: process.pid,
        ownerToken: randomUUID(),
        acquiredAt,
      };
      const fence = Object.freeze({ ...core, fenceDigest: digestValue(core) });
      return {
        registry: withBranchRecord(registry, "reviewedLaneEntrypointFences", identity.branch, fence),
        value: fence,
        changed: true,
      };
    },
  });
  fenceStores.set(result, leaseStore);
  return result;
}
export function assertReviewedLaneEntrypointFence({ fence, leaseStore }) {
  const expectedFence = normalizeFence(fence);
  if (!expectedFence) throw new Error("Reviewed-lane entrypoint fence is required.");
  return withRegistryLock(leaseStore, registry => {
    const normalized = requireRegistry(registry);
    const current = normalizeFence(
      normalized.reviewedLaneEntrypointFences?.[expectedFence.branch] ?? null,
    );
    if (!current || current.fenceDigest !== expectedFence.fenceDigest
      || current.ownerToken !== expectedFence.ownerToken || current.ownerPid !== process.pid) {
      throw new Error("Reviewed-lane entrypoint fence changed before the protected transition.");
    }
    const intent = normalizeIntent(
      normalized.reviewedLaneRevisionIntents?.[expectedFence.branch] ?? null,
    );
    assertIntentOwner(intent, expectedFence);
    const projection = intent?.status === "active"
      ? {
        expectedLeaseDigest: intent.currentLeaseDigest,
        expectedClaimId: intent.currentClaimId,
      }
      : {
        expectedLeaseDigest: expectedFence.sourceLeaseDigest,
        expectedClaimId: expectedFence.sourceClaimId,
      };
    requireExpectedLease(normalized, expectedFence.branch, projection);
    return current;
  });
}
export function releaseReviewedLaneEntrypointFence(fence) {
  const normalizedFence = normalizeFence(fence);
  if (!normalizedFence) throw new Error("Reviewed-lane entrypoint fence is required.");
  const leaseStore = fenceStores.get(fence);
  if (!leaseStore) {
    throw new Error("Reviewed-lane entrypoint fence is not owned by this process invocation.");
  }
  const released = mutateRegistry({
    leaseStore,
    action: registry => {
      const current = normalizeFence(
        registry.reviewedLaneEntrypointFences?.[normalizedFence.branch] ?? null,
      );
      if (!current) return { registry, value: false, changed: false };
      if (current.fenceDigest !== normalizedFence.fenceDigest
        || current.ownerToken !== normalizedFence.ownerToken) {
        throw new Error("Reviewed-lane entrypoint fence changed before release.");
      }
      return {
        registry: withoutBranchRecord(
          registry,
          "reviewedLaneEntrypointFences",
          normalizedFence.branch,
        ),
        value: true,
        changed: true,
      };
    },
  });
  fenceStores.delete(fence);
  return released;
}
export function withReviewedLaneEntrypointFence(options, action) {
  if (typeof action !== "function") {
    throw new Error("Reviewed-lane entrypoint fence requires an action.");
  }
  const fence = acquireReviewedLaneEntrypointFence(options);
  const finish = () => releaseReviewedLaneEntrypointFence(fence);
  try {
    assertReviewedLaneEntrypointFence({ fence, leaseStore: options.leaseStore });
    const result = action(fence);
    if (result && typeof result.then === "function") {
      return result.finally(finish);
    }
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}
export function readReviewedLaneRevisionIntent({ leaseStore, branch }) {
  const normalizedBranch = requiredText(branch, "branch");
  const registry = requireRegistry(leaseStore?.readRegistry?.());
  return normalizeIntent(registry.reviewedLaneRevisionIntents?.[normalizedBranch] ?? null);
}
export function beginReviewedLaneRevisionIntent({ leaseStore, branch, entrypoint,
  operationDigest, expectedLeaseDigest, expectedClaimId = null, planDigest,
  intent = null }) {
  const identity = normalizeOperationIdentity({ branch, entrypoint, operationDigest });
  const expected = normalizeExpectedProjection({ expectedLeaseDigest, expectedClaimId });
  const normalizedPlanDigest = requiredDigest(planDigest, "plan digest");
  const initialValues = normalizeValues(intent, identity);
  return mutateRegistry({
    leaseStore,
    action: registry => {
      requireExpectedLease(registry, identity.branch, expected);
      const current = normalizeIntent(
        registry.reviewedLaneRevisionIntents?.[identity.branch] ?? null,
      );
      if (current) {
        if (sameIntentIdentity(current, { ...identity, planDigest: normalizedPlanDigest })) {
          return { registry, value: current, changed: false };
        }
        if (current.status === "active") {
          throw new Error("A different reviewed-lane revision intent already fences this branch.");
        }
      }
      const createdAt = new Date().toISOString();
      const core = {
        schema: REVIEWED_LANE_REVISION_JOURNAL_SCHEMA,
        status: "active",
        branch: identity.branch,
        entrypoint: identity.entrypoint,
        operationDigest: identity.operationDigest,
        planDigest: normalizedPlanDigest,
        sourceLeaseDigest: expected.expectedLeaseDigest,
        sourceClaimId: expected.expectedClaimId,
        currentLeaseDigest: expected.expectedLeaseDigest,
        currentClaimId: expected.expectedClaimId,
        phase: "prepared",
        journalRevision: 1,
        createdAt,
        updatedAt: createdAt,
        values: initialValues,
        history: [],
      };
      const next = sealIntent(core);
      return {
        registry: withBranchRecord(
          registry,
          "reviewedLaneRevisionIntents",
          identity.branch,
          next,
        ),
        value: next,
        changed: true,
      };
    },
  });
}
export function advanceReviewedLaneRevisionIntent({ leaseStore, branch, entrypoint,
  operationDigest, expectedLeaseDigest, expectedClaimId = null, planDigest,
  intent = null, phase, evidenceDigest, values = null, leaseProjection = null,
  expectedIntentDigest = null }) {
  const identity = normalizeOperationIdentity({ branch, entrypoint, operationDigest });
  const expected = normalizeExpectedProjection({ expectedLeaseDigest, expectedClaimId });
  const normalizedPlanDigest = requiredDigest(planDigest, "plan digest");
  const normalizedPhase = requirePhase(phase);
  if (normalizedPhase === "complete") {
    throw new Error("Use completeReviewedLaneRevisionIntent for the complete phase.");
  }
  const normalizedEvidence = requiredDigest(evidenceDigest, "evidence digest");
  const normalizedValues = normalizeValues(values, identity);
  return mutateRegistry({
    leaseStore,
    action: registry => {
      requireExpectedLease(registry, identity.branch, expected);
      const current = requireCurrentIntent({
        registry,
        identity: { ...identity, planDigest: normalizedPlanDigest },
        expectedIntentDigest,
        intent,
      });
      const projectedLease = normalizedPhase === "lease_updated"
        ? requireLeaseProjection({
          currentLease: registry.leases[identity.branch],
          explicitProjection: leaseProjection,
          values: normalizedValues,
        })
        : null;
      if (current.status !== "active") {
        throw new Error("Completed reviewed-lane revision intent cannot advance.");
      }
      const currentIndex = PHASE_INDEX.get(current.phase);
      const nextIndex = PHASE_INDEX.get(normalizedPhase);
      if (nextIndex < currentIndex) {
        throw new Error("Reviewed-lane revision intent phase cannot move backwards.");
      }
      if (current.phase === normalizedPhase) {
        const recorded = current.history.filter(step => step.phase === normalizedPhase);
        if (recorded.length !== 1 || recorded[0].evidenceDigest !== normalizedEvidence
          || digestValue(recorded[0].values) !== digestValue(normalizedValues)) {
          throw new Error("Reviewed-lane revision same-phase replay changed its evidence or values.");
        }
        return { registry, value: current, changed: false };
      }
      if (nextIndex > currentIndex + 1) {
        throw new Error("Reviewed-lane revision intent cannot skip a protected phase.");
      }
      const updatedAt = new Date().toISOString();
      const history = [...current.history, Object.freeze({
        phase: normalizedPhase,
        evidenceDigest: normalizedEvidence,
        at: updatedAt,
        values: normalizedValues,
      })];
      const next = sealIntent({
        ...current,
        status: "active",
        currentLeaseDigest: projectedLease
          ? digestValue(projectedLease)
          : expected.expectedLeaseDigest,
        currentClaimId: projectedLease?.cloudAuthority?.claimId
          || expected.expectedClaimId,
        phase: normalizedPhase,
        journalRevision: current.journalRevision + 1,
        updatedAt,
        values: Object.freeze({ ...current.values, ...normalizedValues }),
        history,
      });
      let nextRegistry = withBranchRecord(
        registry,
        "reviewedLaneRevisionIntents",
        identity.branch,
        next,
      );
      if (projectedLease) {
        nextRegistry = {
          ...nextRegistry,
          leases: { ...nextRegistry.leases, [identity.branch]: projectedLease },
        };
      }
      return {
        registry: nextRegistry,
        value: next,
        changed: true,
      };
    },
  });
}
export function completeReviewedLaneRevisionIntent({ leaseStore, branch, entrypoint,
  operationDigest, expectedLeaseDigest, expectedClaimId = null, planDigest,
  intent = null, evidenceDigest, values = null, expectedIntentDigest = null }) {
  const identity = normalizeOperationIdentity({ branch, entrypoint, operationDigest });
  const expected = normalizeExpectedProjection({ expectedLeaseDigest, expectedClaimId });
  const normalizedPlanDigest = requiredDigest(planDigest, "plan digest");
  const normalizedEvidence = requiredDigest(evidenceDigest, "evidence digest");
  const normalizedValues = normalizeValues(values, identity);
  return mutateRegistry({
    leaseStore,
    action: registry => {
      requireExpectedLease(registry, identity.branch, expected);
      const current = requireCurrentIntent({
        registry,
        identity: { ...identity, planDigest: normalizedPlanDigest },
        expectedIntentDigest,
        intent,
      });
      if (current.status === "complete") return { registry, value: current, changed: false };
      if (current.phase !== "verified") {
        throw new Error("Reviewed-lane revision intent must be verified before completion.");
      }
      const updatedAt = new Date().toISOString();
      const next = sealIntent({
        ...current,
        status: "complete",
        currentLeaseDigest: expected.expectedLeaseDigest,
        currentClaimId: expected.expectedClaimId,
        phase: "complete",
        journalRevision: current.journalRevision + 1,
        updatedAt,
        values: Object.freeze({ ...current.values, ...normalizedValues }),
        history: [...current.history, Object.freeze({
          phase: "complete",
          evidenceDigest: normalizedEvidence,
          at: updatedAt,
          values: normalizedValues,
        })],
      });
      return {
        registry: withBranchRecord(
          registry,
          "reviewedLaneRevisionIntents",
          identity.branch,
          next,
        ),
        value: next,
        changed: true,
      };
    },
  });
}
function requireCurrentIntent({ registry, identity, expectedIntentDigest, intent }) {
  const current = normalizeIntent(registry.reviewedLaneRevisionIntents?.[identity.branch] ?? null);
  if (!current || !sameIntentIdentity(current, identity)) {
    throw new Error("Reviewed-lane revision intent is missing or belongs to another operation.");
  }
  const expectedDigest = expectedIntentDigest || intent?.intentDigest || current.intentDigest;
  if (current.intentDigest !== requiredDigest(expectedDigest, "expected intent digest")) {
    throw new Error("Reviewed-lane revision intent changed before journal advance.");
  }
  return current;
}
function assertIntentOwner(intent, identity) {
  if (!intent || intent.status === "complete") return;
  if (intent.entrypoint !== identity.entrypoint
    || intent.operationDigest !== identity.operationDigest) {
    throw new Error("A foreign reviewed-lane revision intent fences this branch.");
  }
}
function sameIntentIdentity(intent, identity) {
  return intent.branch === identity.branch
    && intent.entrypoint === identity.entrypoint
    && intent.operationDigest === identity.operationDigest
    && intent.planDigest === identity.planDigest;
}
function normalizeIntent(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schema !== REVIEWED_LANE_REVISION_JOURNAL_SCHEMA
    || !["active", "complete"].includes(value.status)
    || !Number.isInteger(value.journalRevision) || value.journalRevision < 1
    || !PHASE_INDEX.has(value.phase)) {
    throw new Error("Reviewed-lane revision intent is malformed.");
  }
  const core = {
    schema: REVIEWED_LANE_REVISION_JOURNAL_SCHEMA,
    status: value.status,
    branch: requiredText(value.branch, "intent branch"),
    entrypoint: requiredText(value.entrypoint, "intent entrypoint"),
    operationDigest: requiredDigest(value.operationDigest, "intent operation digest"),
    planDigest: requiredDigest(value.planDigest, "intent plan digest"),
    sourceLeaseDigest: requiredDigest(value.sourceLeaseDigest, "intent source lease digest"),
    sourceClaimId: optionalDigest(value.sourceClaimId, "intent source claim ID"),
    currentLeaseDigest: requiredDigest(value.currentLeaseDigest, "intent current lease digest"),
    currentClaimId: optionalDigest(value.currentClaimId, "intent current claim ID"),
    phase: value.phase,
    journalRevision: value.journalRevision,
    createdAt: requiredTimestamp(value.createdAt, "intent creation time"),
    updatedAt: requiredTimestamp(value.updatedAt, "intent update time"),
    values: normalizeValues(value.values, value),
    history: normalizeHistory(value.history),
  };
  const intentDigest = requiredDigest(value.intentDigest, "intent digest");
  if (digestValue(core) !== intentDigest) {
    throw new Error("Reviewed-lane revision intent digest is invalid.");
  }
  return Object.freeze({ ...core, intentDigest });
}
function sealIntent(value) {
  const { intentDigest: _ignored, ...core } = value;
  return normalizeIntent({ ...core, intentDigest: digestValue(core) });
}
function normalizeHistory(value) {
  if (!Array.isArray(value) || value.length > REVIEWED_LANE_REVISION_PHASES.length) {
    throw new Error("Reviewed-lane revision intent history is malformed.");
  }
  return Object.freeze(value.map(step => {
    if (!step || typeof step !== "object" || !PHASE_INDEX.has(step.phase)) {
      throw new Error("Reviewed-lane revision intent history step is malformed.");
    }
    return Object.freeze({
      phase: step.phase,
      evidenceDigest: requiredDigest(step.evidenceDigest, "intent evidence digest"),
      at: requiredTimestamp(step.at, "intent evidence time"),
      values: normalizeValues(step.values, {}),
    });
  }));
}
function normalizeFence(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schema !== REVIEWED_LANE_ENTRYPOINT_FENCE_SCHEMA
    || !Number.isInteger(value.ownerPid) || value.ownerPid < 1) {
    throw new Error("Reviewed-lane entrypoint fence is malformed.");
  }
  const core = {
    schema: REVIEWED_LANE_ENTRYPOINT_FENCE_SCHEMA,
    branch: requiredText(value.branch, "fence branch"),
    entrypoint: requiredText(value.entrypoint, "fence entrypoint"),
    operationDigest: requiredDigest(value.operationDigest, "fence operation digest"),
    sourceLeaseDigest: requiredDigest(value.sourceLeaseDigest, "fence source lease digest"),
    sourceClaimId: optionalDigest(value.sourceClaimId, "fence source claim ID"),
    ownerPid: value.ownerPid,
    ownerToken: requiredText(value.ownerToken, "fence owner token"),
    acquiredAt: requiredTimestamp(value.acquiredAt, "fence acquisition time"),
  };
  const fenceDigest = requiredDigest(value.fenceDigest, "fence digest");
  if (digestValue(core) !== fenceDigest) throw new Error("Reviewed-lane entrypoint fence digest is invalid.");
  return Object.freeze({ ...core, fenceDigest });
}
function normalizeOperationIdentity({ branch, entrypoint, operationDigest }) {
  return Object.freeze({
    branch: requiredText(branch, "branch"),
    entrypoint: requiredText(entrypoint, "entrypoint"),
    operationDigest: requiredDigest(operationDigest, "operation digest"),
  });
}
function normalizeExpectedProjection({ expectedLeaseDigest, expectedClaimId }) {
  return Object.freeze({
    expectedLeaseDigest: requiredDigest(expectedLeaseDigest, "expected lease digest"),
    expectedClaimId: optionalDigest(expectedClaimId, "expected claim ID"),
  });
}
function normalizeValues(value, identity) {
  if (value === null || value === undefined) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Reviewed-lane revision intent values must be an object.");
  }
  for (const key of ["branch", "entrypoint", "operationDigest", "planDigest"]) {
    if (value[key] !== undefined && identity[key] !== undefined && value[key] !== identity[key]) {
      throw new Error(`Reviewed-lane revision intent cannot change ${key}.`);
    }
  }
  const serialized = JSON.stringify(value, (key, item) => item === undefined ? null : item);
  if (!serialized || serialized.length > 65_536) {
    throw new Error("Reviewed-lane revision intent values are too large.");
  }
  const normalized = JSON.parse(serialized);
  return Object.freeze(normalized);
}
function requireExpectedLease(registry, branch, expected) {
  const lease = registry.leases?.[branch];
  if (lease?.schema !== WRITER_LEASE_SCHEMA || lease.branch !== branch) {
    throw new Error("Reviewed-lane entrypoint requires the exact writer lease.");
  }
  if (digestValue(lease) !== expected.expectedLeaseDigest) {
    throw new Error("Writer lease changed before reviewed-lane entrypoint CAS.");
  }
  if ((lease.cloudAuthority?.claimId || null) !== expected.expectedClaimId) {
    throw new Error("Writer lease claim changed before reviewed-lane entrypoint CAS.");
  }
  return lease;
}
function requireLeaseProjection({ currentLease, explicitProjection, values }) {
  const phaseValues = values.revisionIntent?.phases?.lease_updated?.values || values;
  const boundProjection = phaseValues.leaseProjection;
  if (explicitProjection && digestValue(explicitProjection) !== digestValue(boundProjection)) {
    throw new Error("Explicit lease projection differs from the phase-bound projection.");
  }
  const projection = explicitProjection || boundProjection;
  if (!projection || typeof projection !== "object" || Array.isArray(projection)
    || projection.schema !== WRITER_LEASE_SCHEMA
    || projection.branch !== currentLease.branch
    || projection.status !== "review_ready") {
    throw new Error("lease_updated requires one exact review-ready writer lease projection.");
  }
  const projectionDigest = requiredDigest(
    phaseValues.leaseProjectionDigest,
    "lease projection digest",
  );
  if (digestValue(projection) !== projectionDigest) {
    throw new Error("Reviewed-lane lease projection digest is invalid.");
  }
  const authorizedChanges = new Set([
    "fenceSha", "reviewHeadSha", "cloudAuthority", "heartbeatAt", "expiresAt",
  ]);
  if (JSON.stringify(Object.keys(projection).sort())
    !== JSON.stringify(Object.keys(currentLease).sort())) {
    throw new Error("Reviewed-lane lease projection changed the source lease field set.");
  }
  const stableFields = lease => Object.fromEntries(
    Object.entries(lease).filter(([field]) => !authorizedChanges.has(field)),
  );
  if (digestValue(stableFields(projection)) !== digestValue(stableFields(currentLease))) {
    throw new Error("Reviewed-lane lease projection changed fields outside the authorized successor projection.");
  }
  if (!DIGEST_PATTERN.test(String(projection.cloudAuthority?.claimId || ""))) {
    throw new Error("Reviewed-lane lease projection lacks its successor claim.");
  }
  return Object.freeze(projection);
}
function mutateRegistry({ leaseStore, action }) {
  return withRegistryLock(leaseStore, rawRegistry => {
    const registry = requireRegistry(rawRegistry);
    const result = action(registry);
    if (!result?.registry || !("value" in result)) {
      throw new Error("Reviewed-lane registry CAS returned no exact projection.");
    }
    if (result.changed) writeRegistry({
      statePath: leaseStore.statePath,
      expectedRegistry: registry,
      nextRegistry: result.registry,
    });
    return result.value;
  });
}
function withRegistryLock(leaseStore, action) {
  if (typeof leaseStore?.withRegistryLock !== "function" || !leaseStore.statePath) {
    throw new Error("Reviewed-lane entrypoint requires the durable writer-lease registry mutex.");
  }
  return leaseStore.withRegistryLock(action);
}
function writeRegistry({ statePath, expectedRegistry, nextRegistry }) {
  const normalized = requireRegistry(nextRegistry);
  const next = {
    ...normalized,
    schema: WRITER_LEASE_REGISTRY_SCHEMA,
    revision: Number(expectedRegistry.revision || 0) + 1,
  };
  const root = path.dirname(statePath);
  mkdirSync(root, { recursive: true });
  const temporary = `${statePath}.${process.pid}.${Date.now()}.reviewed-lane.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, statePath);
}
function withBranchRecord(registry, field, branch, value) {
  return { ...registry, [field]: { ...(registry[field] || {}), [branch]: value } };
}
function withoutBranchRecord(registry, field, branch) {
  const records = { ...(registry[field] || {}) };
  delete records[branch];
  return { ...registry, [field]: records };
}
function requireRegistry(registry) {
  if (registry?.schema !== WRITER_LEASE_REGISTRY_SCHEMA
    || !registry.leases || typeof registry.leases !== "object") {
    throw new Error("Writer-lease registry schema is unsupported.");
  }
  return registry;
}
function requirePhase(value) {
  const phase = requiredText(value, "intent phase");
  if (!PHASE_INDEX.has(phase)) throw new Error(`Unknown reviewed-lane revision phase: ${phase}`);
  return phase;
}
function requiredDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest.`);
  return String(value);
}
function optionalDigest(value, label) {
  if (value === null || value === undefined || value === "") return null;
  return requiredDigest(value, label);
}
function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text || text.length > 512) throw new Error(`${label} is required.`);
  return text;
}
function requiredTimestamp(value, label) {
  const text = requiredText(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} is invalid.`);
  return text;
}
function isLiveProcess(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
