// Responsibility: Orchestrate one exact-authorized descendant/untracked successor recovery.

import {
  advanceActiveDescendantUntrackedScopeRecoveryIntent,
  authorizeActiveDescendantUntrackedScopeRecovery,
  buildActiveDescendantUntrackedScopeRecoveryPlan,
  buildActiveDescendantUntrackedScopeRecoveryReceipt,
  createActiveDescendantUntrackedScopeRecoveryIntent,
  normalizeActiveDescendantUntrackedScopeRecoveryIntent,
  normalizeActiveDescendantUntrackedScopeRecoveryPlan,
  stableActiveDescendantUntrackedTerminalDigest,
} from "./active-descendant-untracked-scope-recovery-contract.mjs";

const REQUIRED_METHODS = Object.freeze([
  "readEvidence",
  "withOperationLock",
  "readIntent",
  "writeIntent",
  "assertState",
  "authorizeTask",
  "createWaitingSuccessor",
  "retireSource",
  "promoteSuccessor",
  "bindSuccessor",
  "projectLocal",
  "verifyTerminal",
]);

const STEPS = Object.freeze([
  ["authorized", "task-authority-verified", "authorizeTask"],
  ["task-authority-verified", "successor-waiting", "createWaitingSuccessor"],
  ["successor-waiting", "source-retired", "retireSource"],
  ["source-retired", "successor-current", "promoteSuccessor"],
  ["successor-current", "successor-bound", "bindSuccessor"],
  ["successor-bound", "local-cas", "projectLocal"],
  ["local-cas", "verified", "verifyTerminal"],
]);

export function createActiveDescendantUntrackedScopeRecoveryController(adapter) {
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Active descendant/untracked recovery adapter requires ${method}().`);
    }
  }
  return Object.freeze({
    async plan() {
      return buildActiveDescendantUntrackedScopeRecoveryPlan({
        evidence: await adapter.readEvidence(),
      });
    },
    async run({ plan, authorization } = {}) {
      const sealed = normalizeActiveDescendantUntrackedScopeRecoveryPlan(plan);
      return adapter.withOperationLock(
        sealed,
        () => runLocked(adapter, sealed, authorization),
      );
    },
  });
}

async function runLocked(adapter, plan, authorization) {
  const authorizationReceipt = authorizeActiveDescendantUntrackedScopeRecovery(
    plan,
    authorization,
  );
  let intent = await adapter.readIntent(plan);
  if (!intent) {
    await adapter.assertState({ plan, intent: null, before: "authorized" });
    intent = createActiveDescendantUntrackedScopeRecoveryIntent({
      plan,
      authorizationReceipt,
    });
    await adapter.writeIntent({ plan, expected: null, next: intent });
  } else {
    intent = normalizeActiveDescendantUntrackedScopeRecoveryIntent(intent);
    if (intent.planDigest !== plan.planDigest) {
      throw new Error("Recovery journal belongs to another descendant/untracked plan.");
    }
    if (intent.authorizationDigest !== authorizationReceipt.authorizationDigest) {
      throw new Error("Recovery journal authorization no longer matches the exact plan.");
    }
  }

  if (intent.phase === "complete") {
    const observed = await requiredValues(
      adapter.verifyTerminal({ plan, intent, replay: true }),
      "terminal replay",
    );
    if (stableActiveDescendantUntrackedTerminalDigest(observed)
      !== stableActiveDescendantUntrackedTerminalDigest(intent.phases.verified.values)) {
      throw new Error("Descendant/untracked terminal evidence drifted on replay.");
    }
    return buildActiveDescendantUntrackedScopeRecoveryReceipt(intent);
  }

  for (const [source, target, method] of STEPS) {
    if (intent.phase !== source) continue;
    await adapter.assertState({ plan, intent, before: target });
    const values = await requiredValues(
      adapter[method]({ plan, intent, replay: false }),
      target,
    );
    intent = await persist(adapter, plan, intent, target, values);
  }
  if (intent.phase === "verified") {
    intent = await persist(adapter, plan, intent, "complete", {});
  }
  if (intent.phase !== "complete") {
    throw new Error("Active descendant/untracked recovery did not complete.");
  }
  return buildActiveDescendantUntrackedScopeRecoveryReceipt(intent);
}

async function persist(adapter, plan, current, phase, values) {
  const next = advanceActiveDescendantUntrackedScopeRecoveryIntent(
    current,
    { phase, values },
  );
  await adapter.writeIntent({ plan, expected: current, next });
  return next;
}

async function requiredValues(value, label) {
  const awaited = await value;
  if (!awaited || typeof awaited !== "object" || Array.isArray(awaited)) {
    throw new Error(`Active descendant/untracked recovery ${label} returned no receipt values.`);
  }
  return awaited;
}
