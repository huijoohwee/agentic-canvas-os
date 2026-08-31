// Responsibility: Authorize one outer incident and delegate effects to integrated scope expansion.
import {
  authorizeActiveDescendantUntrackedScopeRecovery,
  buildActiveDescendantUntrackedScopeRecoveryPlan,
  buildActiveDescendantUntrackedScopeRecoveryReceipt,
  normalizeActiveDescendantUntrackedScopeRecoveryPlan,
} from "./active-descendant-untracked-scope-recovery-contract.mjs";

export function createActiveDescendantUntrackedScopeRecoveryController(adapter) {
  for (const method of ["readEvidence", "execute", "verifyTerminal"]) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Active descendant/untracked recovery requires ${method}().`);
    }
  }
  return Object.freeze({
    async plan() {
      const evidence = await adapter.readEvidence();
      return buildActiveDescendantUntrackedScopeRecoveryPlan(evidence);
    },
    async run({ plan, authorization } = {}) {
      const sealed = normalizeActiveDescendantUntrackedScopeRecoveryPlan(plan);
      const authorizationReceipt =
        authorizeActiveDescendantUntrackedScopeRecovery(sealed, authorization);
      const innerResult = await adapter.execute({ plan: sealed });
      const terminal = await adapter.verifyTerminal({
        plan: sealed,
        innerResult,
      });
      return buildActiveDescendantUntrackedScopeRecoveryReceipt({
        plan: sealed,
        authorizationReceipt,
        innerResult,
        terminal,
      });
    },
  });
}
