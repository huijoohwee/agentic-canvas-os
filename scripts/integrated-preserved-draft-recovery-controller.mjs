import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  assertIntegratedPreservedDraftRecoveryAuthorization,
  assertIntegratedPreservedReadyProjection,
  createIntegratedPreservedDraftRecoveryPlan,
  createIntegratedPreservedReadyTerminalReceipt,
  INTEGRATED_PRESERVED_DRAFT_RECOVERY_RESULT_SCHEMA,
} from "./integrated-preserved-draft-recovery-contract.mjs";

export function createIntegratedPreservedDraftRecoveryController({ adapter } = {}) {
  requireAdapter(adapter);
  return Object.freeze({
    async plan({ branch, sessionId }) {
      const evidence = await adapter.readState({ branch, sessionId });
      return createIntegratedPreservedDraftRecoveryPlan(evidence);
    },

    async execute({ branch, sessionId, authorization }) {
      const initial = await adapter.readState({ branch, sessionId });
      const initialPlan = createIntegratedPreservedDraftRecoveryPlan(initial);
      assertIntegratedPreservedDraftRecoveryAuthorization(initialPlan, authorization);

      return adapter.withOperationFence({
        state: initial,
        planDigest: initialPlan.planDigest,
      }, async () => {
        const before = await adapter.readState({ branch, sessionId });
        const plan = createIntegratedPreservedDraftRecoveryPlan(before);
        if (plan.planDigest !== initialPlan.planDigest) {
          throw new Error("Integrated-preserved draft recovery changed before its entrypoint fence.");
        }
        assertIntegratedPreservedDraftRecoveryAuthorization(plan, authorization);
        const taskAuthorityReceipt = await adapter.authorizeTask({
          state: before,
          planDigest: plan.planDigest,
        });

        let providerResult = null;
        let providerError = null;
        if (before.pullRequestDraft) {
          try {
            providerResult = await adapter.projectPullRequestReady({
              state: before,
              planDigest: plan.planDigest,
            });
          } catch (error) {
            providerError = error;
          }
        }

        const after = await adapter.readState({ branch, sessionId });
        let projection;
        try {
          projection = assertIntegratedPreservedReadyProjection({ before, after });
        } catch (error) {
          throw new Error(
            providerError
              ? "Provider response failed and exact ready-state adoption did not verify."
              : "Provider ready projection did not preserve the sealed exact identity.",
            { cause: error },
          );
        }

        const disposition = before.pullRequestDraft
          ? providerError ? "response-loss-adopted" : "projected"
          : "already-ready-adopted";
        const terminalReceipt = createIntegratedPreservedReadyTerminalReceipt({
          plan,
          evidence: after,
        });
        const core = Object.freeze({
          schema: INTEGRATED_PRESERVED_DRAFT_RECOVERY_RESULT_SCHEMA,
          ok: true,
          status: "pull-request-ready",
          disposition,
          branch,
          pullRequestUrl: after.pullRequestUrl,
          pullRequestId: after.pullRequestId,
          pullRequestNumber: after.pullRequestNumber,
          planDigest: plan.planDigest,
          identityDigest: projection.identityDigest,
          terminalReceiptDigest: terminalReceipt.receiptDigest,
          taskAuthorityReceiptDigest: requiredDigest(
            taskAuthorityReceipt?.receiptDigest,
            "task-authority receipt digest",
          ),
          providerOperationDigest: providerResult?.operationDigest || null,
          providerMutationAttempted: before.pullRequestDraft,
          providerResponseObserved: before.pullRequestDraft && !providerError,
          sourceMutation: false,
          branchMutation: false,
          cloudMutation: false,
          localLeaseMutation: false,
          merge: false,
          deployment: false,
          cleanup: false,
        });
        return Object.freeze({
          ...core,
          terminalReceipt,
          receiptDigest: terminalReceipt.receiptDigest,
          executionReceiptDigest: digestValue(core),
        });
      });
    },
  });
}

function requireAdapter(adapter) {
  if (!adapter) throw new Error("Integrated-preserved draft recovery requires an adapter.");
  for (const method of [
    "readState",
    "authorizeTask",
    "withOperationFence",
    "projectPullRequestReady",
  ]) {
    if (typeof adapter[method] !== "function") {
      throw new Error(`Integrated-preserved draft recovery adapter requires ${method}().`);
    }
  }
}

function requiredDigest(value, label) {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{64}$/u.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}
