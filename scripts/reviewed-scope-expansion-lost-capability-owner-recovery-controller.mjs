// Responsibility: Orchestrate one response-loss-safe lost-capability owner recovery.
import {
  advanceLostCapabilityOwnerRecoveryJournal, authorizeLostCapabilityOwnerRecovery,
  buildLostCapabilityOwnerRecoveryPlan, freshLostCapabilityOwnerRecoveryJournal,
  normalizeLostCapabilityOwnerRecoveryPlan,
} from "./reviewed-scope-expansion-lost-capability-owner-recovery-contract.mjs";

export function createLostCapabilityOwnerRecoveryController(adapter) {
  return Object.freeze({
    plan() { return buildLostCapabilityOwnerRecoveryPlan(adapter.captureEvidence()); },
    run({ plan, authorization }) {
      const sealed = normalizeLostCapabilityOwnerRecoveryPlan(plan);
      const authorizationReceipt = authorizeLostCapabilityOwnerRecovery(sealed, authorization);
      let journal = adapter.readJournal(sealed.planDigest);
      if (!journal) {
        adapter.assertStable(sealed);
        journal = freshLostCapabilityOwnerRecoveryJournal(sealed, authorizationReceipt, adapter.now());
        adapter.writeJournal(sealed.planDigest, journal);
      } else if (journal.plan.planDigest !== sealed.planDigest
        || journal.authorization.receiptDigest !== authorizationReceipt.receiptDigest) {
        throw new Error("Owner-recovery journal does not match the authorized plan.");
      }
      if (journal.phase === "prepared") {
        const binding = adapter.projectBinding(sealed, authorizationReceipt);
        journal = advanceLostCapabilityOwnerRecoveryJournal(journal, "binding-projected", { binding }, adapter.now());
        adapter.writeJournal(sealed.planDigest, journal);
      }
      if (journal.phase === "binding-projected") {
        const completion = adapter.projectPullRequest(sealed, authorizationReceipt, journal.values.binding);
        journal = advanceLostCapabilityOwnerRecoveryJournal(journal, "complete", { completion }, adapter.now());
        adapter.writeJournal(sealed.planDigest, journal);
      }
      adapter.verifyComplete(sealed, journal.values.completion);
      return journal.values.completion;
    },
  });
}
