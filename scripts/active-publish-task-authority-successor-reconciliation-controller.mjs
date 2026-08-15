// Responsibility: Orchestrate a durable, task-authorized, registry-only successor reconciliation.
import { buildCompletion, buildReconciliationPlan, normalizeReconciliationPlan, operationForPlan } from "./active-publish-task-authority-successor-reconciliation-contract.mjs";

export function createActivePublishTaskAuthoritySuccessorReconciliationController(adapter) {
  for (const method of ["captureEvidence", "authorizeTask", "prepareProjection", "projectRegistry", "verifyTerminal", "readJournal", "writeJournal", "withOperationLock"]) if (typeof adapter?.[method] !== "function") throw new Error(`Reconciliation adapter requires ${method}.`);
  function plan() { return buildReconciliationPlan(adapter.captureEvidence()); }
  function run({ plan: rawPlan, authorization }) {
    const plan = normalizeReconciliationPlan(rawPlan);
    const expected = `authorize active-publish-task-authority-successor-reconciliation ${plan.planDigest}`;
    if (authorization !== expected) throw new Error(`Exact authorization required: ${expected}`);
    return adapter.withOperationLock(() => execute(plan));
  }
  function execute(plan) {
    let journal = adapter.readJournal();
    if (journal?.phase === "complete") return journal.completion;
    if (!journal) journal = persist({ schema: "agentic-active-publish-task-authority-successor-reconciliation-journal/v1", planDigest: plan.planDigest, phase: "prepared", values: {} });
    if (journal.planDigest !== plan.planDigest) throw new Error("A different reconciliation plan already owns this operation journal.");
    if (journal.phase === "prepared") journal = persist({ ...journal, phase: "task-authority-verified", values: { ...journal.values, taskAuthorityReceipt: adapter.authorizeTask(plan, operationForPlan(plan)) } });
    if (journal.phase === "task-authority-verified") journal = persist({ ...journal, phase: "registry-attempted", values: { ...journal.values, projection: adapter.prepareProjection(plan) } });
    if (journal.phase === "registry-attempted") journal = persist({ ...journal, phase: "registry-projected", values: { ...journal.values, projection: adapter.projectRegistry(plan, journal.values.projection) } });
    if (journal.phase === "registry-projected") journal = persist({ ...journal, phase: "verified", values: { ...journal.values, terminal: adapter.verifyTerminal(plan, journal.values.projection) } });
    if (journal.phase === "verified") {
      const terminal = adapter.verifyTerminal(plan, journal.values.projection);
      if (terminal.targetLeaseDigest !== journal.values.terminal.targetLeaseDigest) throw new Error("Terminal successor projection changed before completion.");
      const completion = buildCompletion({ plan, taskAuthorityReceipt: journal.values.taskAuthorityReceipt, projection: terminal, verifiedAt: terminal.verifiedAt });
      journal = persist({ ...journal, phase: "complete", completion });
    }
    return journal.completion;
  }
  function persist(value) { adapter.writeJournal(value); return value; }
  return Object.freeze({ plan, run });
}
