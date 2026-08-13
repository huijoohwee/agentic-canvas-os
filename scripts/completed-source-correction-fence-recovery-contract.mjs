// Responsibility: Seal exact authority and replay receipts for completed source-correction fence recovery.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeCompletedSourceCorrectionFenceRecoveryEvidence } from "./completed-source-correction-fence-recovery-evidence.mjs";

export const PLAN_SCHEMA = "agentic-completed-source-correction-fence-recovery-plan/v1";
export const INTENT_SCHEMA = "agentic-completed-source-correction-fence-recovery-intent/v1";
export const PHASES = Object.freeze(["prepared", "task_authority_verified", "cloud_recovered", "local_projected", "pr_marker_projected", "verified", "complete"]);

export function buildCompletedSourceCorrectionFenceRecoveryPlan({ evidence, operatorSessionId } = {}) {
  const source = normalizeCompletedSourceCorrectionFenceRecoveryEvidence(evidence);
  const operator = text(operatorSessionId, "operator session");
  if (operator === source.source.sessionId) throw new Error("Fence recovery requires a distinct operator session.");
  const core = {
    schema: PLAN_SCHEMA,
    operation: "completed-source-correction-fence-recovery",
    evidence: source,
    operatorSessionId: operator,
    sourceSessionId: source.source.sessionId,
    pullRequestNumber: source.pullRequest.number,
    sourceFenceSha: source.lease.fenceSha,
    targetFenceSha: source.correction.sourceHeadSha,
    claimId: source.claim.claimId,
    forbiddenEffects: ["source-change", "commit", "push", "merge", "cleanup", "deployment"],
  };
  const planDigest = digestValue(core);
  return freeze({ ...core, planDigest, exactAuthorization: `authorize completed-source-correction-fence-recovery ${planDigest}` });
}

export function normalizeCompletedSourceCorrectionFenceRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA) invalid("plan schema");
  const rebuilt = buildCompletedSourceCorrectionFenceRecoveryPlan(value);
  if (JSON.stringify(value) !== JSON.stringify(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizeCompletedSourceCorrectionFenceRecovery({ plan, authorization } = {}) {
  const normalized = normalizeCompletedSourceCorrectionFenceRecoveryPlan(plan);
  if (authorization !== normalized.exactAuthorization) throw new Error(`Fence recovery requires exact authorization: ${normalized.exactAuthorization}`);
  const core = { schema: "agentic-completed-source-correction-fence-recovery-authorization/v1", planDigest: normalized.planDigest, statement: authorization };
  return freeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createCompletedSourceCorrectionFenceRecoveryIntent(plan, authorization) {
  const normalized = normalizeCompletedSourceCorrectionFenceRecoveryPlan(plan);
  const authority = authorizeCompletedSourceCorrectionFenceRecovery({ plan: normalized, authorization });
  return seal({ status: "prepared", plan: normalized, authorization: authority, phases: { prepared: receipt(normalized, "prepared", null, { authorizationDigest: authority.authorizationDigest }) }, completion: null });
}

export function advanceCompletedSourceCorrectionFenceRecoveryIntent(value, { status, values = {} } = {}) {
  const current = normalizeCompletedSourceCorrectionFenceRecoveryIntent(value);
  const from = PHASES.indexOf(current.status); const to = PHASES.indexOf(status);
  if (to < from || to > from + 1) throw new Error("Fence recovery cannot skip or regress a protected phase.");
  if (to === from) return current;
  const nextReceipt = receipt(current.planSnapshot, status, current.intentDigest, values);
  const phases = { ...current.phases, [status]: nextReceipt };
  const completion = status === "complete" ? completionReceipt(current.planSnapshot, values.receipt) : null;
  return seal({ status, plan: current.planSnapshot, authorization: current.authorization, phases, completion });
}

export function normalizeCompletedSourceCorrectionFenceRecoveryIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !PHASES.includes(value.status)) invalid("intent");
  const plan = normalizeCompletedSourceCorrectionFenceRecoveryPlan(value.planSnapshot);
  const authorization = authorizeCompletedSourceCorrectionFenceRecovery({ plan, authorization: value.authorization?.statement });
  const names = PHASES.slice(0, PHASES.indexOf(value.status) + 1);
  if (JSON.stringify(Object.keys(value.phases)) !== JSON.stringify(names)) invalid("intent phases");
  let prior = null; const phases = {};
  for (const name of names) { phases[name] = receipt(plan, name, prior, value.phases[name]?.values); prior = sealCore({ status: name, plan, authorization, phases: { ...phases }, completion: name === "complete" ? value.completion : null }).intentDigest; }
  const completion = value.status === "complete" ? completionReceipt(plan, value.completion) : null;
  const sealed = seal({ status: value.status, plan, authorization, phases, completion });
  if (JSON.stringify(value) !== JSON.stringify(sealed)) invalid("intent projection");
  return sealed;
}

export function buildCompletionReceipt(plan, values = {}) {
  const normalized = normalizeCompletedSourceCorrectionFenceRecoveryPlan(plan);
  const core = {
    schema: "agentic-completed-source-correction-fence-recovery-completion/v1",
    status: "mutation-authority-restored",
    planDigest: normalized.planDigest,
    claimId: normalized.claimId,
    targetFenceSha: normalized.targetFenceSha,
    taskAuthorityReceiptDigest: digest(values.taskAuthorityReceiptDigest, "task receipt"),
    cloudAuthorityDigest: digest(values.cloudAuthorityDigest, "cloud authority"),
    leaseDigest: digest(values.leaseDigest, "lease digest"),
    pullRequestMarkerDigest: digest(values.pullRequestMarkerDigest, "PR marker"),
    verificationDigest: digest(values.verificationDigest, "verification"),
    mutationAuthority: object(values.mutationAuthority, "mutation authority"),
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function operationKey(plan, phase) { return `completed-source-correction-fence-recovery:${phase}:${digestValue({ planDigest: normalizeCompletedSourceCorrectionFenceRecoveryPlan(plan).planDigest, phase })}`; }
function receipt(plan, phase, prior, values) { if (!PHASES.includes(phase)) invalid("phase"); const core = { schema: "agentic-completed-source-correction-fence-recovery-phase-receipt/v1", phase, planDigest: plan.planDigest, operationKey: operationKey(plan, phase), intentDigest: prior, values: object(values, "phase values"), valuesDigest: digestValue(values) }; return freeze({ ...core, receiptDigest: digestValue(core) }); }
function completionReceipt(plan, value) { const rebuilt = buildCompletionReceipt(plan, value); if (value?.receiptDigest && JSON.stringify(value) !== JSON.stringify(rebuilt)) invalid("completion"); return rebuilt; }
function seal(args) { const core = sealCore(args); return freeze({ ...core, intentDigest: core.intentDigest }); }
function sealCore({ status, plan, authorization, phases, completion }) { const raw = { schema: INTENT_SCHEMA, status, planDigest: plan.planDigest, planSnapshot: plan, authorization, authorizationDigest: authorization.authorizationDigest, phases, completion }; return { ...raw, intentDigest: digestValue(raw) }; }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function freeze(value) { return Object.freeze(value); }
function invalid(label) { throw new Error(`Completed source-correction fence recovery has invalid ${label}.`); }
