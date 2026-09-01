// Responsibility: Own the durable writer-registry boundary around canonical relocation effects.
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { assertCanonicalUntrackedRelocationPlan }
  from "./canonical-untracked-relocation-contract.mjs";
import {
  canonicalRelocationDirectoryState,
  normalizeCanonicalUntrackedRelocationEntries,
  readCanonicalUntrackedRelocationEffectIntent,
  readCanonicalUntrackedRelocationReceipt,
} from "./canonical-untracked-relocation-transaction.mjs";
import {
  captureSourceEvidence,
  verifyLegacyRecoveryPackage,
} from "./legacy-dirty-lane-adoption-lib.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import {
  mutateWriterLeaseRegistry,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";
import {
  assertWriterLeaseMutationIntentAvailability,
  createCanonicalUntrackedRelocationRegistryIntent,
  normalizeCanonicalUntrackedRelocationRegistryIntent,
  withCanonicalUntrackedRelocationRegistryIntent as projectRelocationIntent,
} from "./writer-lease-registry-intents.mjs";

const OPERATION = "canonical-untracked-relocation";
const DIGEST = /^[0-9a-f]{64}$/u;

export async function withCanonicalUntrackedRelocationRegistryIntent(
  { plan: value, input, preflight = null, action }, dependencies = {},
) {
  const plan = assertCanonicalUntrackedRelocationPlan(value);
  requireExecutionInput(input, plan);
  if (typeof action !== "function") throw new Error("Canonical relocation registry owner requires an action.");
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: plan.evidence.source.commonDirectory,
  });
  const readers = {
    readReceipt: dependencies.readReceipt || readCanonicalUntrackedRelocationReceipt,
    readEffectIntent: dependencies.readEffectIntent
      || readCanonicalUntrackedRelocationEffectIntent,
  };
  const replay = replayCompletedCanonicalUntrackedRelocationRegistryIntent({
    plan, leaseStore, action, ...readers,
  });
  if (replay) return replay.actionResult;
  if (preflight !== null) synchronousAction(preflight, Object.freeze({ plan }));
  beginCanonicalUntrackedRelocationRegistryIntent({ plan, leaseStore });
  try {
    const transition = executeAndCompleteCanonicalUntrackedRelocationRegistryIntent({
      plan, leaseStore, action, ...readers,
    });
    return transition.actionResult;
  } catch (error) {
    const inspectNoEffect = dependencies.inspectNoEffect
      || inspectCanonicalUntrackedRelocationNoEffect;
    const proof = safeNoEffectProof(() => inspectNoEffect(plan));
    if (!proof) throw error;
    try {
      abortCanonicalUntrackedRelocationRegistryIntent({
        plan, leaseStore, proof,
      });
    } catch (abortError) {
      throw new AggregateError(
        [error, abortError],
        "Canonical relocation failed and its proven no-effect registry abort did not complete.",
      );
    }
    throw error;
  }
}

function replayCompletedCanonicalUntrackedRelocationRegistryIntent({
  plan, leaseStore, action, readReceipt, readEffectIntent,
}) {
  return leaseStore.withRegistryLock(registry => {
    const branch = plan.evidence.target.branch;
    const current = normalizeCanonicalUntrackedRelocationRegistryIntent(
      registry.canonicalUntrackedRelocationIntents?.[branch] ?? null);
    if (!current || current.status !== "complete" || current.planDigest !== plan.planDigest) {
      return null;
    }
    const actionResult = synchronousAction(action, {
      registry, lease: registry.leases?.[branch] ?? null,
    });
    const durableReceipt = readReceipt(plan);
    const effectIntent = readEffectIntent(plan);
    if (!durableReceipt || durableReceipt.receiptDigest !== current.receiptDigest
      || durableReceipt.receiptDigest !== actionResult?.receiptDigest
      || effectIntent?.intentDigest !== current.effectIntentDigest) {
      throw new Error("Completed canonical relocation registry replay changed its durable evidence.");
    }
    return Object.freeze({ actionResult });
  });
}

function beginCanonicalUntrackedRelocationRegistryIntent({ plan: value, leaseStore }) {
  const plan = assertCanonicalUntrackedRelocationPlan(value);
  const target = plan.evidence.target;
  return mutateWriterLeaseRegistry({
    leaseStore, branch: target.branch,
    expectedLeaseDigest: target.leaseDigest, expectedClaimId: target.cloudClaimId,
    action: ({ registry, lease }) => {
      const { relocation } = assertWriterLeaseMutationIntentAvailability({
        registry, branch: target.branch, operation: OPERATION,
      });
      const active = createCanonicalUntrackedRelocationRegistryIntent({
        branch: target.branch, sourceLeaseDigest: target.leaseDigest,
        sourceClaimId: target.cloudClaimId, sourceFenceSha: target.fenceSha,
        sourceAuthoritySnapshot: lease.cloudAuthority, planSnapshot: plan,
      });
      if (relocation?.status === "active") {
        if (relocation.intentDigest !== active.intentDigest) {
          throw new Error("A different canonical relocation intent already owns this branch.");
        }
        return unchanged(registry, lease, relocation);
      }
      if (relocation?.status === "complete" && relocation.planDigest === plan.planDigest) {
        return unchanged(registry, lease, relocation);
      }
      return changed(projectRelocationIntent(registry, target.branch, active), lease, active);
    },
  });
}

function executeAndCompleteCanonicalUntrackedRelocationRegistryIntent({
  plan: value, leaseStore, action, readReceipt, readEffectIntent,
}) {
  const plan = assertCanonicalUntrackedRelocationPlan(value);
  const target = plan.evidence.target;
  return mutateWriterLeaseRegistry({
    leaseStore, branch: target.branch,
    expectedLeaseDigest: target.leaseDigest, expectedClaimId: target.cloudClaimId,
    action: ({ registry, lease }) => {
      const current = normalizeCanonicalUntrackedRelocationRegistryIntent(
        registry.canonicalUntrackedRelocationIntents?.[target.branch] ?? null);
      if (!current || current.planDigest !== plan.planDigest
        || !["active", "complete"].includes(current.status)) {
        throw new Error("Canonical relocation completion has no exact active registry intent.");
      }
      const actionResult = synchronousAction(action, { registry, lease });
      const durableReceipt = readReceipt(plan);
      const effectIntent = readEffectIntent(plan);
      if (!durableReceipt || durableReceipt.receiptDigest !== actionResult?.receiptDigest) {
        throw new Error("Canonical relocation action returned without its exact durable receipt.");
      }
      if (!DIGEST.test(String(effectIntent?.intentDigest || ""))) {
        throw new Error("Canonical relocation completed without its durable effect intent.");
      }
      const complete = createCanonicalUntrackedRelocationRegistryIntent({
        status: "complete", branch: current.branch,
        sourceLeaseDigest: current.sourceLeaseDigest, sourceClaimId: current.sourceClaimId,
        sourceFenceSha: current.sourceFenceSha,
        sourceAuthoritySnapshot: current.sourceAuthoritySnapshot,
        planSnapshot: current.planSnapshot, effectIntentDigest: effectIntent.intentDigest,
        targetLeaseDigest: writerLeaseDigest(lease), targetClaimId: lease.cloudAuthority?.claimId,
        targetAuthoritySnapshot: lease.cloudAuthority,
        receiptSnapshot: receiptSnapshot(durableReceipt),
      });
      if (current.status === "complete") {
        if (current.intentDigest !== complete.intentDigest) {
          throw new Error("Canonical relocation completion evidence changed on replay.");
        }
        return { ...unchanged(registry, lease, current), output: { actionResult } };
      }
      return { ...changed(
        projectRelocationIntent(registry, target.branch, complete), lease, complete,
      ), output: { actionResult } };
    },
  });
}

function abortCanonicalUntrackedRelocationRegistryIntent({
  plan: value, leaseStore, proof: proofValue,
}) {
  const plan = assertCanonicalUntrackedRelocationPlan(value);
  const proof = assertNoEffectProof(proofValue, plan);
  const target = plan.evidence.target;
  return mutateWriterLeaseRegistry({
    leaseStore, branch: target.branch,
    expectedLeaseDigest: target.leaseDigest, expectedClaimId: target.cloudClaimId,
    action: ({ registry, lease }) => {
      const current = normalizeCanonicalUntrackedRelocationRegistryIntent(
        registry.canonicalUntrackedRelocationIntents?.[target.branch] ?? null);
      if (!current || current.status !== "active" || current.planDigest !== plan.planDigest
        || current.effectIntentDigest !== null) {
        throw new Error("Canonical relocation has no exact pre-effect registry intent to abort.");
      }
      const aborted = createCanonicalUntrackedRelocationRegistryIntent({
        status: "aborted", branch: current.branch,
        sourceLeaseDigest: current.sourceLeaseDigest, sourceClaimId: current.sourceClaimId,
        sourceFenceSha: current.sourceFenceSha,
        sourceAuthoritySnapshot: current.sourceAuthoritySnapshot,
        planSnapshot: current.planSnapshot, abortReceiptSnapshot: proof,
      });
      return changed(projectRelocationIntent(registry, target.branch, aborted), lease, aborted);
    },
  });
}

export function inspectCanonicalUntrackedRelocationNoEffect(value) {
  const plan = assertCanonicalUntrackedRelocationPlan(value);
  const { source, target, recovery, transaction } = plan.evidence;
  const verified = verifyLegacyRecoveryPackage({ recoveryDirectory: recovery.directory });
  if (verified.packageDigest !== recovery.packageDigest
    || JSON.stringify(verified.untracked.map(entry => entry.path)) !== JSON.stringify(recovery.paths)) {
    return null;
  }
  const entries = normalizeCanonicalUntrackedRelocationEntries(
    verified.untracked, recovery.directory);
  const sourceRoot = path.join(source.worktree, source.subtree);
  const targetRoot = path.join(target.worktree, source.subtree);
  const sourceState = canonicalRelocationDirectoryState(sourceRoot, entries, source.subtree);
  const targetState = canonicalRelocationDirectoryState(targetRoot, entries, source.subtree);
  const quarantineState = canonicalRelocationDirectoryState(
    transaction.quarantinePath, entries, source.subtree);
  if (sourceState !== "exact" || targetState !== "absent" || quarantineState !== "absent"
    || readCanonicalUntrackedRelocationEffectIntent(plan) !== null) return null;
  const live = captureSourceEvidence(source.worktree);
  if (live.branch !== "main" || live.headSha !== source.headSha
    || live.stateDigest !== source.stateDigest || live.writeSetDigest !== source.writeSetDigest
    || live.trackedPaths.length !== 0
    || JSON.stringify(live.untrackedPaths) !== JSON.stringify(recovery.paths)) return null;
  const core = Object.freeze({
    schema: "agentic-canonical-untracked-relocation-no-effect-abort/v1",
    status: "no-effect", planDigest: plan.planDigest,
    sourceLeaseDigest: target.leaseDigest, sourceClaimId: target.cloudClaimId,
    sourceState, targetState, quarantineState, effectIntentDigest: null,
  });
  return Object.freeze({ ...core, abortReceiptDigest: digestValue(core) });
}

function requireExecutionInput(input, plan) {
  const evidence = plan.evidence;
  if (!input || path.resolve(String(input.source || "")) !== evidence.source.worktree
    || path.resolve(String(input.target || "")) !== evidence.target.worktree
    || path.resolve(String(input.recovery || "")) !== evidence.recovery.directory
    || input.sessionId !== evidence.target.sessionId
    || !input.taskAuthorityFile || !input.writeScopeManifestPath) {
    throw new Error(
      "Canonical-untracked relocation execution requires the two-sided registry mutation-intent owner input.",
    );
  }
}

function receiptSnapshot(value) {
  const { receiptPath: _receiptPath, ...receipt } = value;
  return receipt;
}

function safeNoEffectProof(action) {
  try {
    const proof = action();
    return DIGEST.test(String(proof?.abortReceiptDigest || "")) ? proof : null;
  } catch { return null; }
}

function synchronousAction(action, context) {
  if (action.constructor?.name === "AsyncFunction") {
    throw new Error("Canonical relocation registry action must remain synchronous under its lock.");
  }
  const result = action(context);
  if (result && typeof result.then === "function") {
    throw new Error("Canonical relocation registry action escaped its synchronous lock.");
  }
  return result;
}

function assertNoEffectProof(value, plan) {
  const core = Object.freeze({
    schema: value?.schema, status: value?.status, planDigest: value?.planDigest,
    sourceLeaseDigest: value?.sourceLeaseDigest, sourceClaimId: value?.sourceClaimId,
    sourceState: value?.sourceState, targetState: value?.targetState,
    quarantineState: value?.quarantineState, effectIntentDigest: value?.effectIntentDigest,
  });
  const target = plan.evidence.target;
  if (core.schema !== "agentic-canonical-untracked-relocation-no-effect-abort/v1"
    || core.status !== "no-effect" || core.planDigest !== plan.planDigest
    || core.sourceLeaseDigest !== target.leaseDigest || core.sourceClaimId !== target.cloudClaimId
    || core.sourceState !== "exact" || core.targetState !== "absent"
    || core.quarantineState !== "absent" || core.effectIntentDigest !== null
    || value.abortReceiptDigest !== digestValue(core)) {
    throw new Error("Canonical relocation no-effect abort proof is invalid.");
  }
  return Object.freeze({ ...core, abortReceiptDigest: value.abortReceiptDigest });
}

function changed(registry, lease, intent) {
  return { registry, lease, intent, changed: true };
}

function unchanged(registry, lease, intent) {
  return { registry, lease, intent, changed: false };
}
