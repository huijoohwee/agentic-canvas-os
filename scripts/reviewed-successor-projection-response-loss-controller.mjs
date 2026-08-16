// Responsibility: Execute one capability-verified, projection-only recovery transaction.
import {
  AUTHORIZATION_PREFIX, buildReviewedSuccessorProjectionResponseLossPlan,
  buildReviewedSuccessorProjectionResponseLossReceipt,
  normalizeProjectedProjection, normalizeReviewedSuccessorProjectionResponseLossPlan,
  normalizeTerminal, reviewedSuccessorProjectionResponseLossOperation,
  reviewedSuccessorProjectionResponseLossReplayDigest, isExactPartialLocalTerminalAdoption,
} from "./reviewed-successor-projection-response-loss-contract.mjs";

export function createReviewedSuccessorProjectionResponseLossController(adapter) {
  for (const method of ["inspect", "project", "verify"]) {
    if (typeof adapter?.[method] !== "function") throw new Error(`Reviewed-successor projection response-loss adapter requires ${method}.`);
  }
  function plan() { return buildReviewedSuccessorProjectionResponseLossPlan(adapter.inspect()); }
  function run({ plan: rawPlan, authorization, taskAuthorityFile }) {
    const sealedPlan = normalizeReviewedSuccessorProjectionResponseLossPlan(rawPlan);
    const expected = `${AUTHORIZATION_PREFIX} ${sealedPlan.planDigest}`;
    if (authorization !== expected) throw new Error(`Exact authorization required: ${expected}`);
    if (typeof taskAuthorityFile !== "string" || !taskAuthorityFile.trim()) throw new Error("Exact task-authority capability file is required.");
    const live = adapter.inspect();
    const sameSubject = reviewedSuccessorProjectionResponseLossReplayDigest(live) === reviewedSuccessorProjectionResponseLossReplayDigest(sealedPlan.evidence);
    const terminalAdoption = sealedPlan.evidence.mode === "partial-local-successor" && live?.partialLocal?.projectionState === "repaired" && (sameSubject || isExactPartialLocalTerminalAdoption(sealedPlan.evidence, live));
    if (!sameSubject && !terminalAdoption) throw new Error("Live reviewed-successor recovery subject changed before projection.");
    if (terminalAdoption) {
      const adopted = adapter.verify({ plan: sealedPlan });
      if (!adopted?.projection || !adopted?.terminal) throw new Error("Terminal partial-local adoption requires its exact projection and terminal evidence.");
      const projection = normalizeProjectedProjection(adopted.projection);
      const terminal = normalizeTerminal(adopted.terminal);
      return buildReviewedSuccessorProjectionResponseLossReceipt({ plan: sealedPlan, taskAuthorityReceipt: { receiptDigest: projection.taskAuthorityReceiptDigest }, projection, terminal });
    }
    const projection = normalizeProjectedProjection(adapter.project({ plan: sealedPlan, taskAuthorityFile, operation: reviewedSuccessorProjectionResponseLossOperation(sealedPlan) }));
    const terminal = normalizeTerminal(adapter.verify({ plan: sealedPlan }));
    return buildReviewedSuccessorProjectionResponseLossReceipt({ plan: sealedPlan, taskAuthorityReceipt: { receiptDigest: projection.taskAuthorityReceiptDigest }, projection, terminal });
  }
  return Object.freeze({ plan, run });
}
