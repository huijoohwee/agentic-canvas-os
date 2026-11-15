// Responsibility: Define the exact authorization, effects, journal, and terminal receipt.
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import {
  buildCanonicalUntrackedClaimOnlyAdmissionRecoveryEvidence,
  normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryEvidence,
} from "./canonical-untracked-claim-only-admission-recovery-evidence.mjs";

export const CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_OPERATION =
  "canonical-untracked-claim-only-admission-recovery";
export const CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_PLAN_SCHEMA =
  "agentic-canonical-untracked-claim-only-admission-recovery-plan/v1";
export const CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_INTENT_SCHEMA =
  "agentic-canonical-untracked-claim-only-admission-recovery-intent/v1";
export const CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_PHASES = Object.freeze([
  "authorized", "task_authority_verified", "cloud_request_sealed",
  "cloud_recovered", "verified", "complete",
]);

const ALLOWED_EFFECTS = Object.freeze([
  "private-journal", "same-claim-dormant-recovery", "private-authority-output",
]);
const FORBIDDEN_EFFECTS = Object.freeze([
  "source-change", "preservation-package-change", "new-claim", "new-branch",
  "ref-change", "commit", "worktree-projection", "writer-lease-projection",
  "pull-request", "push", "merge", "deploy", "cleanup",
]);

export function buildCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan({ evidence, ttlSeconds = 3_600 } = {}) {
  const normalizedEvidence = evidence?.schema
    ? normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryEvidence(evidence)
    : buildCanonicalUntrackedClaimOnlyAdmissionRecoveryEvidence(evidence);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 86_400) {
    throw new Error("Canonical-untracked claim-only recovery TTL must be 300..86400 seconds.");
  }
  const core = {
    schema: CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_PLAN_SCHEMA,
    operation: CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_OPERATION,
    evidence: normalizedEvidence,
    ttlSeconds,
    allowedEffects: ALLOWED_EFFECTS,
    forbiddenEffects: FORBIDDEN_EFFECTS,
    terminalStatus: "same-claim-recovered-current-authority",
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_OPERATION} ${planDigest}`,
    taskAuthorityOperation: `${CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_OPERATION}:${planDigest}`,
  });
}

export function normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan(value) {
  if (value?.schema !== CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_PLAN_SCHEMA) invalid("plan schema");
  const rebuilt = buildCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan(value);
  if (canonicalJson(rebuilt) !== canonicalJson(value)) invalid("plan projection");
  return rebuilt;
}

export function authorizeCanonicalUntrackedClaimOnlyAdmissionRecovery({ plan, authorization } = {}) {
  const sealed = normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan(plan);
  if (authorization !== sealed.exactAuthorization) {
    throw new Error(`Exact authorization required: ${sealed.exactAuthorization}`);
  }
  const core = {
    schema: "agentic-canonical-untracked-claim-only-admission-recovery-authorization/v1",
    planDigest: sealed.planDigest,
    statement: authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent(plan, authorization) {
  const sealed = normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan(plan);
  const authority = authorizeCanonicalUntrackedClaimOnlyAdmissionRecovery({ plan: sealed, authorization });
  const receipt = phaseReceipt(sealed, "authorized", null, {
    authorizationDigest: authority.authorizationDigest,
  });
  return sealIntent({ plan: sealed, authority, status: "authorized", phases: { authorized: receipt } });
}

export function advanceCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent(value, { status, values = {} } = {}) {
  const current = normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent(value);
  const from = CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_PHASES.indexOf(current.status);
  const to = CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_PHASES.indexOf(status);
  if (to !== from + 1) invalid("journal phase transition");
  const previous = current.phases[current.status].receiptDigest;
  const phases = { ...current.phases, [status]: phaseReceipt(current.planSnapshot, status, previous, values) };
  return sealIntent({ plan: current.planSnapshot, authority: current.authorization, status, phases });
}

export function normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent(value) {
  if (value?.schema !== CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_INTENT_SCHEMA
    || !CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_PHASES.includes(value.status)) invalid("journal");
  const plan = normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan(value.planSnapshot);
  const authority = authorizeCanonicalUntrackedClaimOnlyAdmissionRecovery({
    plan,
    authorization: value.authorization?.statement,
  });
  const last = CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_PHASES.indexOf(value.status);
  const names = CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_PHASES.slice(0, last + 1);
  if (canonicalJson(Object.keys(value.phases || {})) !== canonicalJson(names)) invalid("journal phases");
  const phases = {};
  let previous = null;
  for (const name of names) {
    const receipt = phaseReceipt(plan, name, previous, value.phases[name]?.values);
    phases[name] = receipt;
    previous = receipt.receiptDigest;
  }
  const rebuilt = sealIntent({ plan, authority, status: value.status, phases });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) invalid("journal projection");
  return rebuilt;
}

export function buildCanonicalUntrackedClaimOnlyAdmissionRecoveryCompletion(intent) {
  const sealed = normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent(intent);
  if (sealed.status !== "complete") invalid("completion status");
  return sealed.completion;
}

function phaseReceipt(plan, phase, previousReceiptDigest, values) {
  if (!CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_PHASES.includes(phase)) invalid("phase");
  if (!values || typeof values !== "object" || Array.isArray(values)) invalid(`${phase} receipt values`);
  const core = {
    schema: "agentic-canonical-untracked-claim-only-admission-recovery-phase/v1",
    planDigest: plan.planDigest,
    phase,
    previousReceiptDigest,
    values,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealIntent({ plan, authority, status, phases }) {
  const cloud = phases.cloud_recovered?.values;
  const completion = status === "complete" ? deepFreeze({
    schema: "agentic-canonical-untracked-claim-only-admission-recovery-result/v1",
    ok: true,
    status: plan.terminalStatus,
    planDigest: plan.planDigest,
    authority: cloud?.authority,
    terminalReceiptDigest: phases.verified.values.terminalReceiptDigest,
    journalReceiptDigest: phases.complete.receiptDigest,
  }) : null;
  if (status === "complete" && !validAuthorityEnvelope(completion.authority)) invalid("raw authority envelope");
  const core = {
    schema: CANONICAL_UNTRACKED_CLAIM_ONLY_ADMISSION_RECOVERY_INTENT_SCHEMA,
    status,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorization: authority,
    phases,
    completion,
  };
  return deepFreeze({ ...core, journalDigest: digestValue(core) });
}

function validAuthorityEnvelope(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && /^[^/\s]+\/[^/\s]+$/u.test(String(value.ledgerRepository || ""))
    && /^[^/\s]+\/[^/\s]+$/u.test(String(value.targetRepository || ""))
    && value.result?.schema === "agentic-cloud-collaboration-result/v1"
    && value.result?.ok === true && value.result?.action === "continue"
    && value.result?.status === "current";
}

function invalid(label) { throw new Error(`Canonical-untracked claim-only recovery rejected: ${label}.`); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
