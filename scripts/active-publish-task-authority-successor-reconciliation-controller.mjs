// Responsibility: Orchestrate a durable, task-authorized, registry-only successor reconciliation.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { buildCompletion, buildReconciliationPlan, normalizeReconciliationPlan, operationForPlan, PHASES } from "./active-publish-task-authority-successor-reconciliation-contract.mjs";
import { reconciliationEvidenceReplaySubjectDigest } from "./active-publish-task-authority-successor-reconciliation-evidence.mjs";
import { normalizeTaskAuthorityBinding } from "./task-bound-lane-authority-contract.mjs";

const JOURNAL_V1 = "agentic-active-publish-task-authority-successor-reconciliation-journal/v1";
const JOURNAL_V2 = "agentic-active-publish-task-authority-successor-reconciliation-journal/v2";
const JOURNAL_HISTORY_LIMIT = 128;
const DIGEST = /^[0-9a-f]{64}$/u;
const VALUE_KEYS = Object.freeze({
  prepared: [],
  "task-authority-verified": ["taskAuthorityReceipt"],
  "registry-attempted": ["taskAuthorityReceipt", "projection"],
  "registry-projected": ["taskAuthorityReceipt", "projection"],
  verified: ["taskAuthorityReceipt", "projection", "terminal"],
  complete: ["taskAuthorityReceipt", "projection", "terminal"],
});

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
    let journal = normalizeJournal(adapter.readJournal());
    if (!journal) journal = beginV2(plan, []);
    else if (journal.planDigest !== plan.planDigest) {
      if (journal.schema !== JOURNAL_V1 || !isPristine(journal)) throw new Error("A different reconciliation plan already owns this operation journal.");
      journal = beginV2(plan, supersessionHistory(journal));
    } else {
      assertJournalPlan(journal, plan);
      if (journal.phase === "complete") return validateCompletion(journal, plan);
      if (journal.schema === JOURNAL_V1 && ["prepared", "task-authority-verified", "registry-attempted"].includes(journal.phase)) throw new Error("Legacy v1 pre-CAS reconciliation journals cannot resume safely; create a fresh authorized plan for pristine supersession.");
      if (journal.schema === JOURNAL_V2 && journal.phase === "prepared") throw new Error("A durable v2 prepared journal cannot resume or be superseded.");
    }
    if (journal.phase === "task-authority-verified") journal = persist(advance(journal, "registry-attempted", { ...journal.values, projection: adapter.prepareProjection(plan) }), plan);
    if (journal.phase === "registry-attempted") journal = persist(advance(journal, "registry-projected", { ...journal.values, projection: adapter.projectRegistry(plan, journal.values.projection) }), plan);
    if (journal.phase === "registry-projected") journal = persist(advance(journal, "verified", { ...journal.values, terminal: adapter.verifyTerminal(plan, journal.values.projection) }), plan);
    if (journal.phase === "verified") {
      const terminal = adapter.verifyTerminal(plan, journal.values.projection);
      assertTerminalMatches(terminal, journal.values.projection);
      const completion = buildCompletion({ plan, taskAuthorityReceipt: journal.values.taskAuthorityReceipt, projection: terminal, verifiedAt: terminal.verifiedAt });
      journal = persist(advance(journal, "complete", { ...journal.values, terminal }, completion), plan);
    }
    return validateCompletion(journal, plan);
  }
  function beginV2(plan, history) {
    const liveEvidence = adapter.captureEvidence();
    if (reconciliationEvidenceReplaySubjectDigest(liveEvidence) !== reconciliationEvidenceReplaySubjectDigest(plan.evidence)) throw new Error("Live reconciliation evidence changed before the first v2 journal write.");
    const receipt = adapter.authorizeTask(plan, operationForPlan(plan));
    return persist(advance(freshJournal(plan, history), "task-authority-verified", { taskAuthorityReceipt: receipt }), plan);
  }
  function persist(value, plan) { const normalized = normalizeJournal(value); assertJournalPlan(normalized, plan); adapter.writeJournal(normalized); return normalized; }
  return Object.freeze({ plan, run });
}

function freshJournal(plan, history) {
  return sealV2({ schema: JOURNAL_V2, planDigest: plan.planDigest, evidenceDigest: plan.evidence.evidenceDigest, phase: "prepared", values: {}, history });
}

function supersessionHistory(journal) {
  const previousEvidenceDigest = journal.schema === JOURNAL_V2 ? journal.evidenceDigest : null;
  const previousJournalDigest = journal.schema === JOURNAL_V2 ? journal.journalDigest : digestValue(journal);
  return [...(journal.history || []), Object.freeze({ previousPlanDigest: journal.planDigest, previousEvidenceDigest, previousJournalDigest })];
}

function advance(journal, phase, values, completion) {
  const core = { ...journal, phase, values: valuesForSchema(journal.schema, values) };
  delete core.journalDigest;
  delete core.completion;
  if (completion) core.completion = completion;
  return journal.schema === JOURNAL_V2 ? sealV2(core) : core;
}

function sealV2(value) {
  const core = { schema: JOURNAL_V2, planDigest: value.planDigest, evidenceDigest: value.evidenceDigest, phase: value.phase, values: value.values, history: value.history };
  if (value.phase === "complete") core.completion = value.completion;
  return Object.freeze({ ...core, journalDigest: digestValue(core) });
}

function normalizeJournal(value) {
  if (value === null || value === undefined) return null;
  record(value, "journal");
  if (value.schema === JOURNAL_V1) return normalizeV1(value);
  if (value.schema === JOURNAL_V2) return normalizeV2(value);
  invalid("journal schema");
}

function normalizeV1(value) {
  const phase = normalizedPhase(value.phase);
  exactKeys(value, ["schema", "planDigest", "phase", "values", ...(phase === "complete" ? ["completion"] : [])], "v1 journal");
  const journal = { schema: JOURNAL_V1, planDigest: requiredDigest(value.planDigest, "plan digest"), phase, values: normalizeValues(value.values, phase, true) };
  if (phase === "complete") journal.completion = record(value.completion, "completion");
  return Object.freeze(journal);
}

function normalizeV2(value) {
  const phase = normalizedPhase(value.phase);
  exactKeys(value, ["schema", "planDigest", "evidenceDigest", "phase", "values", "history", ...(phase === "complete" ? ["completion"] : []), "journalDigest"], "v2 journal");
  const planDigest = requiredDigest(value.planDigest, "plan digest");
  const evidenceDigest = requiredDigest(value.evidenceDigest, "evidence digest");
  const history = normalizeHistory(value.history, planDigest);
  const core = { schema: JOURNAL_V2, planDigest, evidenceDigest, phase, values: normalizeValues(value.values, phase, false), history };
  if (phase === "complete") core.completion = record(value.completion, "completion");
  if (requiredDigest(value.journalDigest, "journal digest") !== digestValue(core)) invalid("journal digest");
  return Object.freeze({ ...core, journalDigest: value.journalDigest });
}

function normalizeHistory(value, currentPlanDigest) {
  if (!Array.isArray(value) || value.length > JOURNAL_HISTORY_LIMIT) invalid("journal history");
  if (value.length === 0) return Object.freeze([]);
  if (value.length !== 1) invalid("journal history chronology");
  const item = value[0];
  exactKeys(item, ["previousPlanDigest", "previousEvidenceDigest", "previousJournalDigest"], "journal history entry");
  const previousPlanDigest = requiredDigest(item.previousPlanDigest, "history plan digest");
  const previousJournalDigest = requiredDigest(item.previousJournalDigest, "history journal digest");
  if (item.previousEvidenceDigest !== null) invalid("v2 journal history predecessor");
  const prior = { schema: JOURNAL_V1, planDigest: previousPlanDigest, phase: "prepared", values: {} };
  if (digestValue(prior) !== previousJournalDigest) invalid("journal history link");
  if (previousPlanDigest === currentPlanDigest) invalid("journal history ping-pong");
  return Object.freeze([Object.freeze({ previousPlanDigest, previousEvidenceDigest: null, previousJournalDigest })]);
}

function normalizeValues(value, phase, legacy) {
  exactKeys(value, VALUE_KEYS[phase], `${phase} journal values`);
  if (phase === "prepared") return Object.freeze({});
  const taskAuthorityReceipt = normalizeTaskReceipt(value.taskAuthorityReceipt);
  if (phase === "task-authority-verified") return Object.freeze({ taskAuthorityReceipt });
  const projected = phase !== "registry-attempted";
  const projection = normalizeProjection(value.projection, projected, legacy);
  if (!new Set(["verified", "complete"]).has(phase)) return Object.freeze({ taskAuthorityReceipt, projection });
  const terminal = normalizeTerminal(value.terminal);
  assertTerminalMatches(terminal, projection);
  return Object.freeze({ taskAuthorityReceipt, projection, terminal });
}

function normalizeProjection(value, projected, legacy) {
  const preparedKeys = ["sourceLeaseDigest", "expectedLeaseDigest", "expectedClaimId", ...(legacy ? [] : ["priorTaskAuthority"]), "binding", "receipt"];
  const projectedKeys = [...preparedKeys, "targetBindingDigest", "successorReceiptDigest", "targetLeaseDigest", "registryRevision"];
  exactKeys(value, projected ? projectedKeys : preparedKeys, "projection");
  const normalizedPrior = legacy ? null : normalizeTaskAuthorityBinding(value.priorTaskAuthority);
  const normalizedBinding = normalizeTaskAuthorityBinding(value.binding);
  if ((!legacy && !normalizedPrior) || !normalizedBinding) invalid("successor binding");
  const priorTaskAuthority = normalizedPrior ? Object.freeze(normalizedPrior) : null;
  const binding = Object.freeze(normalizedBinding);
  const successorReceipt = normalizeSuccessorReceipt(value.receipt);
  const result = {
    sourceLeaseDigest: requiredDigest(value.sourceLeaseDigest, "source lease digest"),
    expectedLeaseDigest: requiredDigest(value.expectedLeaseDigest, "expected lease digest"),
    expectedClaimId: requiredDigest(value.expectedClaimId, "expected claim"),
    binding,
    receipt: successorReceipt,
  };
  if (priorTaskAuthority) result.priorTaskAuthority = priorTaskAuthority;
  const bindingDigest = requiredDigest(binding.bindingDigest, "binding digest");
  const receiptDigest = requiredDigest(successorReceipt.receiptDigest, "successor receipt digest");
  if (successorReceipt.targetBindingDigest !== bindingDigest) invalid("successor receipt binding");
  if (!projected) return Object.freeze(result);
  if (value.targetBindingDigest !== bindingDigest || value.successorReceiptDigest !== receiptDigest) invalid("projected successor identity");
  return Object.freeze({ ...result, targetBindingDigest: bindingDigest, successorReceiptDigest: receiptDigest, targetLeaseDigest: requiredDigest(value.targetLeaseDigest, "target lease digest"), registryRevision: positive(value.registryRevision, "registry revision") });
}

function normalizeTerminal(value) {
  exactKeys(value, ["targetBindingDigest", "successorReceiptDigest", "targetLeaseDigest", "registryRevision", "verifiedAt"], "terminal projection");
  return Object.freeze({ targetBindingDigest: requiredDigest(value.targetBindingDigest, "terminal binding digest"), successorReceiptDigest: requiredDigest(value.successorReceiptDigest, "terminal successor receipt digest"), targetLeaseDigest: requiredDigest(value.targetLeaseDigest, "terminal lease digest"), registryRevision: positive(value.registryRevision, "terminal registry revision"), verifiedAt: instant(value.verifiedAt, "terminal verification time") });
}

function normalizeTaskReceipt(value) {
  exactKeys(value, ["schema", "status", "authoritySubjectId", "proofAdapterId", "generation", "bindingDigest", "proofDigest", "operation", "verifiedAt", "receiptDigest"], "task-authority receipt");
  const core = { authoritySubjectId: text(value.authoritySubjectId, "task authority subject"), bindingDigest: requiredDigest(value.bindingDigest, "task binding digest"), proofDigest: requiredDigest(value.proofDigest, "task proof digest"), operation: text(value.operation, "task operation"), verifiedAt: instant(value.verifiedAt, "task verification time") };
  if (value.schema !== "agentic-task-authority-verification-receipt/v1" || value.status !== "verified" || text(value.proofAdapterId, "task proof adapter") === "" || !Number.isSafeInteger(value.generation) || value.generation < 1 || value.receiptDigest !== digestValue(core)) invalid("task-authority receipt");
  return Object.freeze({ schema: value.schema, status: value.status, authoritySubjectId: core.authoritySubjectId, proofAdapterId: value.proofAdapterId, generation: value.generation, bindingDigest: core.bindingDigest, proofDigest: core.proofDigest, operation: core.operation, verifiedAt: core.verifiedAt, receiptDigest: value.receiptDigest });
}

function normalizeSuccessorReceipt(value) {
  const keys = ["schema", "branch", "epoch", "sourceBaseSha", "sourceFenceSha", "sourceClaimId", "sourceBindingDigest", "targetBaseSha", "targetFenceSha", "targetClaimId", "targetBindingDigest", "cloudOperationReceiptDigest", "cloudVerificationReceiptDigest", "boundAt", "receiptDigest"];
  exactKeys(value, keys, "successor receipt");
  const core = { schema: value.schema, branch: text(value.branch, "successor branch"), epoch: positive(value.epoch, "successor epoch"), sourceBaseSha: sha(value.sourceBaseSha, "source base SHA"), sourceFenceSha: sha(value.sourceFenceSha, "source fence SHA"), sourceClaimId: requiredDigest(value.sourceClaimId, "source claim"), sourceBindingDigest: requiredDigest(value.sourceBindingDigest, "source binding digest"), targetBaseSha: sha(value.targetBaseSha, "target base SHA"), targetFenceSha: sha(value.targetFenceSha, "target fence SHA"), targetClaimId: requiredDigest(value.targetClaimId, "target claim"), targetBindingDigest: requiredDigest(value.targetBindingDigest, "target binding digest"), cloudOperationReceiptDigest: requiredDigest(value.cloudOperationReceiptDigest, "cloud operation receipt digest"), cloudVerificationReceiptDigest: requiredDigest(value.cloudVerificationReceiptDigest, "cloud verification receipt digest"), boundAt: instant(value.boundAt, "successor binding time") };
  if (core.schema !== "agentic-active-publish-task-authority-successor-receipt/v1" || value.receiptDigest !== digestValue(core)) invalid("successor receipt");
  return Object.freeze({ ...core, receiptDigest: value.receiptDigest });
}

function assertTerminalMatches(terminal, projection) {
  for (const key of ["targetBindingDigest", "successorReceiptDigest", "targetLeaseDigest", "registryRevision"]) if (terminal[key] !== projection[key]) throw new Error("Terminal successor projection changed before completion.");
}

function validateCompletion(journal, plan) {
  assertJournalPlan(journal, plan);
  const verifiedAt = journal.schema === JOURNAL_V1 ? journal.completion.verifiedAt : journal.values.terminal.verifiedAt;
  if (journal.schema === JOURNAL_V1 && new Date(verifiedAt) < new Date(journal.values.terminal.verifiedAt)) invalid("legacy completion chronology");
  const expected = buildCompletion({ plan, taskAuthorityReceipt: journal.values.taskAuthorityReceipt, projection: journal.values.terminal, verifiedAt });
  if (canonicalJson(expected) !== canonicalJson(journal.completion)) invalid("completion");
  return expected;
}

function assertJournalPlan(journal, plan) {
  if (journal.schema === JOURNAL_V2 && journal.evidenceDigest !== plan.evidence.evidenceDigest) throw new Error("The reconciliation journal evidence does not match this plan.");
  const phaseIndex = PHASES.indexOf(journal.phase);
  if (phaseIndex >= PHASES.indexOf("task-authority-verified")) {
    const task = journal.values.taskAuthorityReceipt;
    if (task.bindingDigest !== plan.evidence.source.bindingDigest || task.operation !== operationForPlan(plan)) invalid("task-authority plan subject");
  }
  if (phaseIndex >= PHASES.indexOf("registry-attempted")) {
    const { binding, receipt, expectedLeaseDigest, expectedClaimId, priorTaskAuthority = null } = journal.values.projection;
    const task = journal.values.taskAuthorityReceipt;
    const priorBindingDigest = priorTaskAuthority?.bindingDigest || plan.evidence.source.bindingDigest;
    const exact = expectedLeaseDigest === plan.evidence.leaseDigest && expectedClaimId === plan.evidence.target.claimId && (!priorTaskAuthority || priorTaskAuthority.laneBindingDigest === plan.evidence.source.laneBindingDigest) && priorBindingDigest === plan.evidence.source.bindingDigest && binding.bindingMode === "continuation" && binding.transitionPlanDigest === null && binding.priorBindingDigest === priorBindingDigest && binding.authoritySubjectId === task.authoritySubjectId && binding.proofAdapterId === task.proofAdapterId && binding.generation === task.generation && receipt.branch === plan.evidence.branch && receipt.sourceBaseSha === plan.evidence.source.baseSha && receipt.sourceFenceSha === plan.evidence.source.fenceSha && receipt.sourceClaimId === plan.evidence.source.claimId && receipt.sourceBindingDigest === priorBindingDigest && receipt.targetBaseSha === plan.evidence.target.baseSha && receipt.targetFenceSha === plan.evidence.target.fenceSha && receipt.targetClaimId === plan.evidence.target.claimId && receipt.targetBindingDigest === binding.bindingDigest && receipt.cloudOperationReceiptDigest === plan.evidence.target.operationReceiptDigest && receipt.cloudVerificationReceiptDigest === plan.evidence.target.verificationReceiptDigest && receipt.boundAt === binding.boundAt;
    if (!exact) invalid("successor projection plan subject");
  }
}

function valuesForSchema(schema, values) {
  if (schema !== JOURNAL_V1 || !values?.projection?.priorTaskAuthority) return values;
  const { priorTaskAuthority: _omitted, ...projection } = values.projection;
  return { ...values, projection };
}

function isPristine(journal) { return journal.phase === "prepared" && Object.keys(journal.values).length === 0; }
function normalizedPhase(value) { if (!PHASES.includes(value)) invalid("journal phase"); return value; }
function record(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); digestValue(value); return value; }
function exactKeys(value, keys, label) { record(value, label); if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) invalid(label); }
function requiredDigest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function instant(value, label) { if (!value || new Date(value).toISOString() !== value) invalid(label); return value; }
function invalid(label) { throw new Error(`Active-publish task-authority successor reconciliation has invalid ${label}.`); }
