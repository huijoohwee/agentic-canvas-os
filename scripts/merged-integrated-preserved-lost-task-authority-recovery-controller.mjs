// Responsibility: journal and execute one authorization-bound local authority handoff.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  OPERATION,
  advanceMergedIntegratedPreservedLostAuthorityJournal,
  authorizeMergedIntegratedPreservedLostAuthority,
  buildMergedIntegratedPreservedLostAuthorityPlan,
  buildMergedIntegratedPreservedLostAuthorityResult,
  createMergedIntegratedPreservedLostAuthorityJournal,
  normalizeMergedIntegratedPreservedLostAuthorityJournal,
  normalizeMergedIntegratedPreservedLostAuthorityPlan,
} from "./merged-integrated-preserved-lost-task-authority-recovery-contract.mjs";

export function createMergedIntegratedPreservedLostAuthorityRecoveryController({ adapter } = {}) {
  requireAdapter(adapter);
  return Object.freeze({
    async plan() {
      const first = await adapter.captureSource();
      const second = await adapter.captureSource();
      if (digestValue(first) !== digestValue(second)) {
        throw new Error("Recovery evidence changed during read-only planning.");
      }
      return buildMergedIntegratedPreservedLostAuthorityPlan({
        evidence: first,
        targetCapability: await adapter.readTargetCapabilityProjection(),
      });
    },

    async run({ plan, authorization, journalStore } = {}) {
      requireJournalStore(journalStore);
      const sealed = normalizeMergedIntegratedPreservedLostAuthorityPlan(plan);
      const decision = authorizeMergedIntegratedPreservedLostAuthority(sealed, authorization);
      let journal = journalStore.read();
      if (journal) {
        journal = normalizeMergedIntegratedPreservedLostAuthorityJournal(journal);
        if (journal.planDigest !== sealed.planDigest
          || journal.authorizationDigest !== decision.authorizationDigest) {
          throw new Error("Recovery journal belongs to another authorized plan.");
        }
        if (journal.phase === "complete") return journal.result;
      } else {
        await assertPlanCurrent(adapter, sealed);
        journal = journalStore.write(createMergedIntegratedPreservedLostAuthorityJournal({
          plan: sealed,
          authorization,
        }));
      }

      const target = await adapter.createTargetBinding(sealed);
      if (!target?.binding?.bindingDigest || !target?.proofReceipt?.receiptDigest) {
        throw new Error("Replacement authority did not return a binding proof.");
      }

      if (journal.phase === "prepared") {
        await assertPlanCurrent(adapter, sealed);
        journal = writeNext(journalStore, journal, "prechecked", receipt("prechecked", {
          evidenceDigest: sealed.evidence.evidenceDigest,
          targetBindingDigest: target.binding.bindingDigest,
        }));
      }
      if (journal.phase === "prechecked") {
        journal = writeNext(journalStore, journal, "cas-attempted", receipt("cas-attempted", {
          operationKey: `${OPERATION}:${sealed.planDigest}:local-cas`,
          sourceLeaseDigest: sealed.evidence.sourceLeaseDigest,
          targetBindingDigest: target.binding.bindingDigest,
        }));
      }
      if (journal.phase === "cas-attempted") {
        let local;
        try {
          local = await adapter.replaceLocalBinding(sealed, target);
        } catch (error) {
          local = await adapter.observeLocalBinding(sealed, target);
          if (!local) throw error;
        }
        journal = writeNext(journalStore, journal, "local-cas", local, {
          targetBindingDigest: target.binding.bindingDigest,
        });
      }
      if (journal.phase === "local-cas") {
        const terminal = await adapter.verifyTerminal(sealed, target);
        journal = writeNext(journalStore, journal, "verified", terminal, {
          targetBindingDigest: target.binding.bindingDigest,
        });
      }
      if (journal.phase === "verified") {
        const terminal = journal.receipts.verified;
        const result = buildMergedIntegratedPreservedLostAuthorityResult({
          plan: sealed,
          journal,
          terminal,
        });
        journal = writeNext(journalStore, journal, "complete", receipt("complete", {
          resultDigest: result.resultDigest,
        }), {
          targetBindingDigest: target.binding.bindingDigest,
          result,
        });
      }
      return journal.result;
    },
  });
}

async function assertPlanCurrent(adapter, plan) {
  const first = await adapter.captureSource();
  const second = await adapter.captureSource();
  if (first?.evidenceDigest !== plan.evidence.evidenceDigest
    || second?.evidenceDigest !== plan.evidence.evidenceDigest) {
    throw new Error("Recovery evidence drifted from the authorized plan.");
  }
}

function writeNext(store, journal, phase, receiptValue, values = {}) {
  return store.write(advanceMergedIntegratedPreservedLostAuthorityJournal(journal, phase, {
    receipt: receiptValue,
    ...values,
  }));
}

function receipt(kind, payload) {
  const core = {
    schema: `agentic-${OPERATION}-phase-receipt/v1`,
    kind,
    payload,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function requireAdapter(adapter) {
  const methods = [
    "captureSource", "readTargetCapabilityProjection", "createTargetBinding",
    "replaceLocalBinding", "observeLocalBinding", "verifyTerminal",
  ];
  if (!adapter || methods.some(method => typeof adapter[method] !== "function")) {
    throw new Error("Merged authority recovery adapter is incomplete.");
  }
}
function requireJournalStore(store) {
  if (!store || typeof store.read !== "function" || typeof store.write !== "function") {
    throw new Error("Merged authority recovery requires an external durable journal.");
  }
}
