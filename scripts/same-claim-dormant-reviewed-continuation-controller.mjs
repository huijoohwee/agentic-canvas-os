// Responsibility: Order capability proof, same-claim cloud recovery, local CAS, and terminal verification durably.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { AUTHORIZATION_PREFIX, buildSameClaimDormantReviewedPlan, buildSameClaimDormantReviewedReceipt, evidenceReplayDigest, normalizeCloudRecovery, normalizeLocalProjection, normalizeSameClaimDormantReviewedPlan, normalizeTerminal, sameClaimDormantReviewedOperation } from "./same-claim-dormant-reviewed-continuation-contract.mjs";

const JOURNAL_SCHEMA = "agentic-same-claim-dormant-reviewed-continuation-journal/v1";
const PHASES = ["authorized", "cloud-attempted", "cloud-recovered", "local-attempted", "local-projected", "verified", "complete"];

export function createSameClaimDormantReviewedContinuationController(adapter) {
  for (const method of ["inspect", "authorizeTask", "recoverCloud", "projectLocal", "verify", "readJournal", "writeJournal", "withLock"]) if (typeof adapter?.[method] !== "function") throw new Error(`Same-claim dormant reviewed adapter requires ${method}.`);
  function plan() { return buildSameClaimDormantReviewedPlan(adapter.inspect()); }
  function run({ plan: rawPlan, authorization, taskAuthorityFile }) {
    const sealed = normalizeSameClaimDormantReviewedPlan(rawPlan); const expected = `${AUTHORIZATION_PREFIX} ${sealed.planDigest}`;
    if (authorization !== expected) throw new Error(`Exact authorization required: ${expected}`);
    if (typeof taskAuthorityFile !== "string" || !taskAuthorityFile.trim()) throw new Error("Exact task-authority capability file is required.");
    return adapter.withLock(() => execute(sealed, taskAuthorityFile));
  }
  function execute(plan, taskAuthorityFile) {
    let journal = normalizeJournal(adapter.readJournal());
    if (journal && journal.planDigest !== plan.planDigest) throw new Error("A different same-claim recovery plan owns this journal.");
    if (journal?.phase === "complete") {
      const result = adapter.verify({ plan }); const terminal = normalizeTerminal(result?.terminal || result);
      if (terminal.claimId !== journal.completion.claimId || terminal.localRepairReceiptDigest !== journal.completion.localRepairReceiptDigest || terminal.targetLeaseDigest !== journal.completion.targetLeaseDigest || terminal.registryRevision !== journal.completion.registryRevision) throw new Error("Completed same-claim recovery terminal projection changed.");
      return journal.completion;
    }
    const live = adapter.inspect();
    if (live.projectionState === "complete" && !journal) return adopt(plan, adapter.verify({ plan }));
    if (live.projectionState !== "complete" && evidenceReplayDigest(live) !== evidenceReplayDigest(plan.evidence)) throw new Error("Same-claim recovery subject changed before execution.");
    if (!journal) journal = persist(makeJournal(plan, "authorized", { taskAuthorityReceipt: adapter.authorizeTask({ plan, taskAuthorityFile, operation: sameClaimDormantReviewedOperation(plan) }) }));
    if (journal.phase === "authorized") journal = persist(makeJournal(plan, "cloud-attempted", journal.values));
    if (journal.phase === "cloud-attempted") journal = persist(makeJournal(plan, "cloud-recovered", { ...journal.values, cloudRecovery: normalizeCloudRecovery(adapter.recoverCloud({ plan })) }));
    if (journal.phase === "cloud-recovered") journal = persist(makeJournal(plan, "local-attempted", journal.values));
    if (journal.phase === "local-attempted") journal = persist(makeJournal(plan, "local-projected", { ...journal.values, projection: normalizeLocalProjection(adapter.projectLocal({ plan, taskAuthorityReceipt: journal.values.taskAuthorityReceipt, cloudRecovery: journal.values.cloudRecovery })) }));
    if (journal.phase === "local-projected") journal = persist(makeJournal(plan, "verified", { ...journal.values, terminal: normalizeTerminal(adapter.verify({ plan })) }));
    if (journal.phase === "verified") { const terminal = normalizeTerminal(adapter.verify({ plan })); const completion = buildSameClaimDormantReviewedReceipt({ plan, taskAuthorityReceipt: journal.values.taskAuthorityReceipt, cloudRecovery: journal.values.cloudRecovery, projection: journal.values.projection, terminal }); journal = persist(makeJournal(plan, "complete", { ...journal.values, terminal }, completion)); }
    return journal.completion;
  }
  function adopt(plan, result) { if (!result?.taskAuthorityReceipt || !result?.cloudRecovery || !result?.projection || !result?.terminal) throw new Error("Terminal adoption evidence is incomplete."); return buildSameClaimDormantReviewedReceipt({ plan, ...result }); }
  function persist(value) { const normalized = normalizeJournal(value); adapter.writeJournal(normalized); return normalized; }
  return Object.freeze({ plan, run });
}

function makeJournal(plan, phase, values, completion) { const core = { schema: JOURNAL_SCHEMA, planDigest: plan.planDigest, phase, values }; if (completion) core.completion = completion; return Object.freeze({ ...core, journalDigest: digestValue(core) }); }
function normalizeJournal(value) { if (value === null || value === undefined) return null; if (!value || value.schema !== JOURNAL_SCHEMA || !PHASES.includes(value.phase)) invalid("journal"); const keys = ["schema", "planDigest", "phase", "values", ...(value.phase === "complete" ? ["completion"] : []), "journalDigest"]; if (Object.keys(value).sort().join("\0") !== keys.sort().join("\0")) invalid("journal fields"); const { journalDigest, ...core } = value; if (journalDigest !== digestValue(core)) invalid("journal digest"); return Object.freeze(value); }
function invalid(label) { throw new Error(`Same-claim dormant reviewed continuation has invalid ${label}.`); }
