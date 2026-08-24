// Responsibility: Bind one stale recovery intent to its proven successor task-authority lease.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeActiveOwnedDirtRecoveryPlan }
  from "./active-owned-dirt-recovery-contract.mjs";

export const OPERATION = "active-owned-dirt-task-authority-intent-supersession";
export const PLAN_SCHEMA = "agentic-active-owned-dirt-intent-supersession-plan/v1";
export const RECEIPT_SCHEMA = "agentic-active-owned-dirt-intent-supersession-receipt/v1";

const DIGEST = /^[0-9a-f]{64}$/u;

export function buildActiveOwnedDirtIntentSupersessionPlan({ evidence }) {
  const normalized = normalizeEvidence(evidence);
  const core = Object.freeze({ schema: PLAN_SCHEMA, operation: OPERATION, evidence: normalized });
  return Object.freeze({ ...core, planDigest: digestValue(core) });
}

export function normalizeActiveOwnedDirtIntentSupersessionPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) fail("plan schema");
  const core = Object.freeze({
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: normalizeEvidence(value.evidence),
  });
  if (digest(value.planDigest, "plan digest") !== digestValue(core)) fail("plan digest");
  return Object.freeze({ ...core, planDigest: value.planDigest });
}

export function authorizeActiveOwnedDirtIntentSupersession({ plan, authorization }) {
  const normalized = normalizeActiveOwnedDirtIntentSupersessionPlan(plan);
  const expected = `authorize ${OPERATION} ${normalized.planDigest}`;
  if (String(authorization || "").trim() !== expected) {
    throw new Error(`Intent supersession requires exact authorization: ${expected}`);
  }
  return Object.freeze({
    schema: "agentic-active-owned-dirt-intent-supersession-authorization/v1",
    planDigest: normalized.planDigest,
    authorizationDigest: digestValue(expected),
  });
}

export function createSuccessorActiveOwnedDirtRecoveryPlan({ sourcePlan, currentLeaseDigest }) {
  const source = normalizeActiveOwnedDirtRecoveryPlan(sourcePlan);
  const core = { ...source, sourceLeaseDigest: digest(currentLeaseDigest, "current lease digest") };
  delete core.planDigest;
  return normalizeActiveOwnedDirtRecoveryPlan({ ...core, planDigest: digestValue(core) });
}

export function buildActiveOwnedDirtIntentSupersessionReceipt({
  plan, successorPlanDigest, taskAuthorityReceiptDigest, replayed = false,
}) {
  const normalized = normalizeActiveOwnedDirtIntentSupersessionPlan(plan);
  const core = {
    schema: RECEIPT_SCHEMA,
    status: "superseded",
    planDigest: normalized.planDigest,
    sourceIntentDigest: normalized.evidence.intent.intentDigest,
    sourcePlanDigest: normalized.evidence.intent.planDigest,
    successorPlanDigest: digest(successorPlanDigest, "successor plan digest"),
    currentLeaseDigest: normalized.evidence.lease.leaseDigest,
    taskAuthorityReceiptDigest: digest(taskAuthorityReceiptDigest, "task-authority receipt digest"),
    replayed: Boolean(replayed),
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizeEvidence(value) {
  if (!value || typeof value !== "object") fail("evidence");
  return Object.freeze({
    repository: text(value.repository, "repository"),
    branch: text(value.branch, "branch"),
    sessionId: text(value.sessionId, "session"),
    pullRequestNumber: positive(value.pullRequestNumber, "pull request number"),
    headSha: sha(value.headSha, "head SHA"),
    lease: Object.freeze({
      leaseDigest: digest(value.lease?.leaseDigest, "lease digest"),
      claimId: digest(value.lease?.claimId, "claim ID"),
      taskAuthorityBindingDigest: digest(
        value.lease?.taskAuthorityBindingDigest,
        "task-authority binding digest",
      ),
    }),
    intent: Object.freeze({
      status: value.intent?.status === "cloud" ? "cloud" : fail("intent phase"),
      intentDigest: digest(value.intent?.intentDigest, "intent digest"),
      planDigest: digest(value.intent?.planDigest, "intent plan digest"),
      sourceLeaseDigest: digest(value.intent?.sourceLeaseDigest, "intent source lease digest"),
      sourceClaimId: digest(value.intent?.sourceClaimId, "intent source claim ID"),
      snapshotReceiptDigest: digest(
        value.intent?.snapshotReceiptDigest,
        "snapshot receipt digest",
      ),
      cloudReceiptDigest: digest(value.intent?.cloudReceiptDigest, "cloud receipt digest"),
    }),
    authorityRecovery: Object.freeze({
      journalDigest: digest(value.authorityRecovery?.journalDigest, "recovery journal digest"),
      planDigest: digest(value.authorityRecovery?.planDigest, "recovery plan digest"),
      sourceLeaseDigest: digest(
        value.authorityRecovery?.sourceLeaseDigest,
        "recovery source lease digest",
      ),
      targetBindingDigest: digest(
        value.authorityRecovery?.targetBindingDigest,
        "recovery target binding digest",
      ),
      resultDigest: digest(value.authorityRecovery?.resultDigest, "recovery result digest"),
    }),
  });
}

function text(value, label) { if (typeof value !== "string" || !value.trim()) fail(label); return value.trim(); }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) fail(label); return value; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) fail(label); return value; }
function positive(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) fail(label); return number; }
function fail(label) { throw new Error(`Active-owned-dirt intent supersession has invalid ${label}.`); }
