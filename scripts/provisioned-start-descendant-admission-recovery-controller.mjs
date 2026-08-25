// Responsibility: Advance one journaled descendant admission recovery phase chain.

import {
  authorizeProvisionedStartDescendantAdmissionRecovery,
  buildProvisionedStartDescendantAdmissionRecoveryResult,
  normalizeProvisionedStartDescendantAdmissionRecoveryPlan,
  sealProvisionedStartDescendantAdmissionRecoveryPlan,
} from "./provisioned-start-descendant-admission-recovery-contract.mjs";

const PHASES = ["prepared", "task-authorized", "cloud-bound", "local-projected",
  "marker-projected", "complete"];

export function createProvisionedStartDescendantAdmissionRecoveryController({ adapter }) {
  if (!adapter) throw new Error("Descendant admission recovery requires a repository adapter.");
  function plan() { return sealProvisionedStartDescendantAdmissionRecoveryPlan(adapter.readEvidence()); }
  function run({ sealedPlan, authorization }) {
    const recoveryPlan = normalizeProvisionedStartDescendantAdmissionRecoveryPlan(sealedPlan);
    const authorizationReceipt = authorizeProvisionedStartDescendantAdmissionRecovery(recoveryPlan, authorization);
    return adapter.withLock(recoveryPlan, () => execute({ recoveryPlan, authorizationReceipt }));
  }
  function execute({ recoveryPlan, authorizationReceipt }) {
    let journal = adapter.begin({ plan: recoveryPlan, authorizationReceipt });
    if (journal.phase === "prepared") {
      const values = adapter.authorizeTask(recoveryPlan);
      journal = adapter.advance({ plan: recoveryPlan, expected: "prepared", phase: "task-authorized", values });
    }
    if (journal.phase === "task-authorized") {
      const values = adapter.bindCloud(recoveryPlan);
      journal = adapter.advance({ plan: recoveryPlan, expected: "task-authorized", phase: "cloud-bound", values });
    }
    if (journal.phase === "cloud-bound") {
      const values = adapter.projectLocal(recoveryPlan, journal.phases["task-authorized"].values,
        journal.phases["cloud-bound"].values);
      journal = adapter.advance({ plan: recoveryPlan, expected: "cloud-bound", phase: "local-projected", values });
    }
    if (journal.phase === "local-projected") {
      const values = adapter.projectMarker(recoveryPlan);
      journal = adapter.advance({ plan: recoveryPlan, expected: "local-projected", phase: "marker-projected", values });
    }
    if (journal.phase === "marker-projected") {
      const values = adapter.verify(recoveryPlan);
      journal = adapter.advance({ plan: recoveryPlan, expected: "marker-projected", phase: "complete", values });
    }
    if (journal.phase !== "complete") throw new Error("Descendant admission recovery did not complete.");
    const terminal = adapter.verify(recoveryPlan);
    return buildProvisionedStartDescendantAdmissionRecoveryResult({ plan: recoveryPlan, terminal,
      receipts: PHASES.slice(1).map(phase => journal.phases[phase].receiptDigest) });
  }
  return Object.freeze({ plan, run });
}
