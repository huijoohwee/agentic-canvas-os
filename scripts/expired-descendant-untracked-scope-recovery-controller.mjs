// Responsibility: Authorize one dormant incident and delegate its atomic successor transition.
import {
  authorizeExpiredDescendantUntrackedScopeRecovery,
  buildExpiredDescendantUntrackedScopeRecoveryCompletion,
  buildExpiredDescendantUntrackedScopeRecoveryPlan,
  normalizeExpiredDescendantUntrackedScopeRecoveryPlan,
} from "./expired-descendant-untracked-scope-recovery-contract.mjs";

export function createExpiredDescendantUntrackedScopeRecoveryController(adapter) {
  for (const method of ["readEvidence", "execute", "verifyTerminal"]) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Expired descendant/untracked recovery requires ${method}().`);
    }
  }
  return Object.freeze({
    async plan() {
      return buildExpiredDescendantUntrackedScopeRecoveryPlan(
        await adapter.readEvidence(),
      );
    },
    async run({ plan, authorization } = {}) {
      const sealed = normalizeExpiredDescendantUntrackedScopeRecoveryPlan(plan);
      const authorizationReceipt =
        authorizeExpiredDescendantUntrackedScopeRecovery(sealed, authorization);
      const innerResult = await adapter.execute({ plan: sealed });
      const terminal = await adapter.verifyTerminal({
        plan: sealed,
        innerResult,
      });
      return buildExpiredDescendantUntrackedScopeRecoveryCompletion({
        plan: sealed,
        authorization: authorizationReceipt,
        innerResult,
        terminal,
      });
    },
  });
}
