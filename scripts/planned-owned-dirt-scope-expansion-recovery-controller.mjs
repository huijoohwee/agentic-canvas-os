// Responsibility: Orchestrate one authorized, replay-safe planned-owned-dirt successor transition.
import {
  advanceRecoveryIntent,
  authorizePlannedOwnedDirtScopeExpansionRecovery,
  buildCompletionReceipt,
  buildPlannedOwnedDirtScopeExpansionRecoveryPlan,
  createRecoveryIntent,
  normalizePlannedOwnedDirtScopeExpansionRecoveryPlan,
  normalizeRecoveryIntent,
} from "./planned-owned-dirt-scope-expansion-recovery-contract.mjs";

const METHODS = Object.freeze([
  "readEvidence", "authorizeTask", "claimWaitingSuccessor", "retireSource",
  "promoteSuccessor", "bindSuccessor", "projectLocal", "projectPullRequestMarker",
  "verifyTerminal", "readIntent", "writeIntent", "withOperationLock",
]);

export function createPlannedOwnedDirtScopeExpansionRecoveryController(adapter) {
  for (const method of METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Planned-owned-dirt recovery adapter requires ${method}().`);
    }
  }
  return Object.freeze({
    async plan({ targetManifest }) {
      return buildPlannedOwnedDirtScopeExpansionRecoveryPlan({
        evidence: await adapter.readEvidence(targetManifest), targetManifest,
      });
    },
    async run({ plan, authorization }) {
      const sealed = normalizePlannedOwnedDirtScopeExpansionRecoveryPlan(plan);
      return adapter.withOperationLock(sealed, () => runLocked(adapter, sealed, authorization));
    },
  });
}

async function runLocked(adapter, plan, authorization) {
  let intent = await adapter.readIntent(plan);
  if (!intent) {
    const authorized = authorizePlannedOwnedDirtScopeExpansionRecovery(plan, authorization);
    const taskAuthority = await adapter.authorizeTask(plan);
    intent = createRecoveryIntent({ plan, authorization: authorized, taskAuthority });
    await adapter.writeIntent({ expected: null, next: intent, plan });
  } else {
    intent = normalizeRecoveryIntent(intent);
    if (intent.planDigest !== plan.planDigest) throw new Error("Recovery journal belongs to another plan.");
  }
  if (intent.status === "complete") {
    await adapter.verifyTerminal({ plan, intent, replay: true });
    return buildCompletionReceipt(intent);
  }
  intent = await step(adapter, plan, intent, "authorized", "waiting-successor",
    () => adapter.claimWaitingSuccessor({ plan, intent }));
  intent = await step(adapter, plan, intent, "waiting-successor", "source-retired",
    () => adapter.retireSource({ plan, intent }));
  intent = await step(adapter, plan, intent, "source-retired", "successor-promoted",
    () => adapter.promoteSuccessor({ plan, intent }));
  intent = await step(adapter, plan, intent, "successor-promoted", "successor-bound",
    () => adapter.bindSuccessor({ plan, intent }));
  intent = await step(adapter, plan, intent, "successor-bound", "local-projected",
    () => adapter.projectLocal({ plan, intent }));
  intent = await step(adapter, plan, intent, "local-projected", "pr-marker-projected",
    () => adapter.projectPullRequestMarker({ plan, intent }));
  intent = await step(adapter, plan, intent, "pr-marker-projected", "complete",
    () => adapter.verifyTerminal({ plan, intent, replay: false }));
  return buildCompletionReceipt(intent);
}

async function step(adapter, plan, intent, expected, status, action) {
  if (intent.status !== expected) return intent;
  const values = await action();
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error(`Planned-owned-dirt recovery ${status} returned no receipt values.`);
  }
  const next = advanceRecoveryIntent(intent, { status, values });
  await adapter.writeIntent({ expected: intent, next, plan });
  return next;
}
