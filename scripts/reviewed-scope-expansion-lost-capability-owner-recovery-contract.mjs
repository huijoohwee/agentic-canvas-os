// Responsibility: Seal the exact plan, authorization, journal, and receipt for owner recovery.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeLostCapabilityOwnerRecoveryEvidence }
  from "./reviewed-scope-expansion-lost-capability-owner-recovery-evidence.mjs";

export const OPERATION = "reviewed-scope-expansion-lost-capability-owner-recovery";
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const RESULT_SCHEMA = `agentic-${OPERATION}-result/v1`;

export function buildLostCapabilityOwnerRecoveryPlan(evidence) {
  const normalized = normalizeLostCapabilityOwnerRecoveryEvidence(evidence);
  const core = { schema: PLAN_SCHEMA, operation: OPERATION, evidence: normalized,
    evidenceDigest: normalized.evidenceDigest,
    effects: ["replace-lost-task-binding", "project-pull-request-marker", "record-owner-recovery-receipt"],
    forbiddenEffects: ["source-change", "git-ref-change", "cloud-claim-change", "merge", "deployment", "cleanup"] };
  const planDigest = digestValue(core);
  return freeze({ ...core, planDigest, exactAuthorization: `authorize ${OPERATION} ${planDigest}` });
}

export function normalizeLostCapabilityOwnerRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) invalid("plan schema");
  const rebuilt = buildLostCapabilityOwnerRecoveryPlan(value.evidence);
  if (JSON.stringify(rebuilt) !== JSON.stringify(value)) invalid("plan digest");
  return rebuilt;
}

export function authorizeLostCapabilityOwnerRecovery(plan, statement) {
  const sealed = normalizeLostCapabilityOwnerRecoveryPlan(plan);
  if (statement !== sealed.exactAuthorization) {
    throw new Error(`Exact authorization required: ${sealed.exactAuthorization}`);
  }
  const core = { schema: `agentic-${OPERATION}-authorization/v1`, planDigest: sealed.planDigest,
    statementDigest: digestValue({ statement }) };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function buildLostCapabilityOwnerRecoveryReceipt({ plan, authorization, sourceLeaseDigest,
  targetLeaseDigest, targetBindingDigest, proofDigest, markerDigest, recoveredAt, replayed }) {
  const sealed = normalizeLostCapabilityOwnerRecoveryPlan(plan);
  const core = { schema: `agentic-${OPERATION}-completion/v1`, status: "recovered",
    planDigest: sealed.planDigest, authorizationReceiptDigest: digest(authorization.receiptDigest),
    sourceLeaseDigest: digest(sourceLeaseDigest), targetLeaseDigest: digest(targetLeaseDigest),
    sourceBindingDigest: sealed.evidence.sourceBinding.bindingDigest,
    targetBindingDigest: digest(targetBindingDigest), proofDigest: digest(proofDigest),
    markerDigest: digest(markerDigest), recoveredAt: instant(recoveredAt), replayed: replayed === true,
    zeroEffects: { sourceBytes: true, gitRefs: true, cloudClaim: true, pullRequestRemainder: true } };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function freshLostCapabilityOwnerRecoveryJournal(plan, authorization, recordedAt) {
  const sealed = normalizeLostCapabilityOwnerRecoveryPlan(plan);
  return freeze({ schema: `agentic-${OPERATION}-journal/v1`, phase: "prepared", plan: sealed,
    authorization, values: {}, recordedAt: instant(recordedAt) });
}
export function advanceLostCapabilityOwnerRecoveryJournal(journal, phase, values, recordedAt) {
  if (!["prepared", "binding-projected", "complete"].includes(phase)) invalid("journal phase");
  return freeze({ ...journal, phase, values: { ...journal.values, ...values }, recordedAt: instant(recordedAt) });
}

function digest(value) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid("digest"); return value; }
function instant(value) { if (!Number.isFinite(Date.parse(String(value || "")))) invalid("instant"); return value; }
function freeze(value) { return Object.freeze(value); }
function invalid(label) { throw new Error(`Lost-capability owner recovery has invalid ${label}.`); }
