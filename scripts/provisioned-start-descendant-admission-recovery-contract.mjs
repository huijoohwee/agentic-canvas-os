// Responsibility: Bind exact authorization and local projection for descendant admission recovery.

import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeProvisionedStartDescendantAdmissionRecoveryEvidence }
  from "./provisioned-start-descendant-admission-recovery-evidence.mjs";

export const PLAN_SCHEMA = "agentic-provisioned-start-descendant-admission-recovery-plan/v1";
export const RESULT_SCHEMA = "agentic-provisioned-start-descendant-admission-recovery-result/v1";
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildProvisionedStartDescendantAdmissionRecoveryPlan(evidence) {
  const normalized = normalizeProvisionedStartDescendantAdmissionRecoveryEvidence(evidence);
  const core = { schema: PLAN_SCHEMA, operation: "provisioned-start-descendant-admission-recovery",
    effects: ["record-intent", "bind-cloud-descendant", "project-local-admission",
      "project-pull-request-marker"], evidence: normalized };
  return freeze({ ...core, planDigest: digestValue(core), exactAuthorization: null });
}

export function sealProvisionedStartDescendantAdmissionRecoveryPlan(evidence) {
  const base = buildProvisionedStartDescendantAdmissionRecoveryPlan(evidence);
  const exactAuthorization = `authorize provisioned-start-descendant-admission-recovery ${base.planDigest}`;
  return freeze({ ...base, exactAuthorization });
}

export function normalizeProvisionedStartDescendantAdmissionRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== "provisioned-start-descendant-admission-recovery") {
    throw new Error("Descendant admission recovery plan schema is invalid.");
  }
  const rebuilt = sealProvisionedStartDescendantAdmissionRecoveryPlan(value.evidence);
  if (canonicalJson(rebuilt) !== canonicalJson(value)) throw new Error("Descendant admission recovery plan drifted.");
  return rebuilt;
}

export function authorizeProvisionedStartDescendantAdmissionRecovery(plan, authorization) {
  const sealed = normalizeProvisionedStartDescendantAdmissionRecoveryPlan(plan);
  if (authorization !== sealed.exactAuthorization) throw new Error(`Exact authorization required: ${sealed.exactAuthorization}`);
  const core = { schema: "agentic-provisioned-start-descendant-admission-recovery-authorization/v1",
    planDigest: sealed.planDigest, statementDigest: digestValue({ statement: authorization }) };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function projectProvisionedStartDescendantAdmissionLease({ plan, authority,
  taskAuthorityReceiptDigest, projectedAt }) {
  const sealed = normalizeProvisionedStartDescendantAdmissionRecoveryPlan(plan);
  const source = sealed.evidence.lease;
  if (authority?.claimId !== source.cloudAuthority.claimId
    || authority?.laneRevision !== sealed.evidence.descendant.headSha
    || authority?.reviewRequestId !== sealed.evidence.pullRequest.reviewRequestId
    || authority?.state !== "active" || authority?.transitionCounter < 2) {
    throw new Error("Target cloud authority does not bind the exact descendant review.");
  }
  const descendant = sealed.evidence.descendant;
  const integration = freeze({ schema: "agentic-integration-commit/v1",
    commitSha: descendant.headSha, treeSha: descendant.treeSha, paths: descendant.paths,
    stagedDiffDigest: descendant.rangeDiffDigest, manifestDigest: source.admission.manifestDigest,
    commitMessage: descendant.commits.at(-1).message, rangeBaseSha: descendant.fenceSha,
    commitInventoryDigest: digestValue(descendant.commits) });
  const preservationCore = { schema: "agentic-provisioned-start-descendant-preservation/v1",
    planDigest: sealed.planDigest, sourceLeaseDigest: sealed.evidence.sourceLeaseDigest,
    integrationDigest: digestValue(integration), cloudAuthorityDigest: digestValue(authority),
    taskAuthorityReceiptDigest: digest(taskAuthorityReceiptDigest, "task-authority receipt"),
    projectedAt: instant(projectedAt) };
  const preservation = freeze({ ...preservationCore, receiptDigest: digestValue(preservationCore) });
  const admission = freeze({ ...source.admission, status: "admitted",
    admittedReportDigest: preservation.receiptDigest,
    preservationReceiptDigest: preservation.receiptDigest });
  const lease = freeze({ ...source, admission, integration, cloudAuthority: authority,
    heartbeatAt: projectedAt, expiresAt: authority.expiresAt,
    provisionedStartDescendantAdmissionRecovery: preservation });
  return freeze({ lease, admission, integration, preservation, leaseDigest: digestValue(lease) });
}

export function buildProvisionedStartDescendantAdmissionRecoveryResult({ plan, terminal, receipts }) {
  const sealed = normalizeProvisionedStartDescendantAdmissionRecoveryPlan(plan);
  const receiptDigests = receipts.map((value, index) => digest(value, `receipt ${index}`));
  if (receiptDigests.length < 4) throw new Error("Recovery result requires all phase receipts.");
  const core = { schema: RESULT_SCHEMA, ok: true, status: "admitted", planDigest: sealed.planDigest,
    branch: sealed.evidence.lease.branch, commitSha: sealed.evidence.descendant.headSha,
    terminalDigest: digestValue(terminal), phaseReceiptDigests: receiptDigests };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function phaseReceipt({ planDigest, phase, values, recordedAt }) {
  const core = { schema: "agentic-provisioned-start-descendant-admission-recovery-phase/v1",
    planDigest: digest(planDigest, "plan digest"), phase, values, recordedAt: instant(recordedAt) };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

function digest(value, label) { if (!DIGEST.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function instant(value) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error("Recovery instant is invalid."); return date.toISOString(); }
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
