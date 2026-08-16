// Responsibility: Orchestrate one authorization-bound registry-only task binding repair.
import {
  AUTHORIZATION_PREFIX, buildPlan, buildReceipt, normalizePlan, operation,
  replayDigest,
} from "./source-correction-successor-task-binding-reconciliation-contract.mjs";

export function createSourceCorrectionSuccessorTaskBindingReconciliationController(adapter) {
  for (const method of ["inspect", "project", "verify"]) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Source-correction successor binding adapter requires ${method}.`);
    }
  }
  function plan() { return buildPlan(adapter.inspect()); }
  function run({ plan: rawPlan, authorization, taskAuthorityFile }) {
    const sealed = normalizePlan(rawPlan);
    const expected = `${AUTHORIZATION_PREFIX} ${sealed.planDigest}`;
    if (authorization !== expected) throw new Error(`Exact authorization required: ${expected}`);
    if (typeof taskAuthorityFile !== "string" || !taskAuthorityFile.trim()) {
      throw new Error("Exact task-authority capability file is required.");
    }
    const live = adapter.inspect();
    const terminal = live.terminalRepair;
    if (terminal) {
      const verified = adapter.verify({ plan: sealed });
      return buildReceipt({ plan: sealed, repair: terminal, terminal: verified });
    }
    if (replayDigest(live) !== replayDigest(sealed.evidence)) {
      throw new Error("Source-correction successor binding subject changed before projection.");
    }
    const repair = adapter.project({
      plan: sealed,
      taskAuthorityFile,
      operation: operation(sealed),
    });
    const verified = adapter.verify({ plan: sealed });
    return buildReceipt({ plan: sealed, repair, terminal: verified });
  }
  return Object.freeze({ plan, run });
}
