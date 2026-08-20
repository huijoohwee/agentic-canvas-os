// Responsibility: Bind exact authorization and terminal receipts for device-projection recovery.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  normalizePlannedDeviceProjectionRecoveryEvidence,
} from "./planned-device-projection-recovery-evidence.mjs";

export const PLANNED_DEVICE_PROJECTION_RECOVERY_PLAN_SCHEMA =
  "agentic-planned-device-projection-recovery-plan/v1";
export const PLANNED_DEVICE_PROJECTION_RECOVERY_RECEIPT_SCHEMA =
  "agentic-planned-device-projection-recovery-receipt/v1";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const ALLOWED_EFFECTS = Object.freeze([
  "recover-same-cloud-claim-device-projection",
  "project-same-local-writer-lease",
  "replace-same-draft-review-marker",
]);
const FORBIDDEN_EFFECTS = Object.freeze([
  "source-bytes",
  "git-refs",
  "new-claim",
  "new-review",
  "review-state",
  "integration",
  "cleanup",
  "deployment",
]);

export function buildPlannedDeviceProjectionRecoveryPlan({ evidence, ttlSeconds = 1_800 } = {}) {
  const normalizedEvidence = normalizePlannedDeviceProjectionRecoveryEvidence(evidence);
  const core = {
    schema: PLANNED_DEVICE_PROJECTION_RECOVERY_PLAN_SCHEMA,
    operation: "planned-device-projection-recovery",
    evidence: normalizedEvidence,
    ttlSeconds: positive(ttlSeconds, "TTL"),
    taskAuthorityOperation:
      `planned-device-projection-recovery:${normalizedEvidence.evidenceDigest}`,
    allowedEffects: ALLOWED_EFFECTS,
    forbiddenEffects: FORBIDDEN_EFFECTS,
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize planned-device-projection-recovery ${planDigest}`,
  });
}

export function normalizePlannedDeviceProjectionRecoveryPlan(value) {
  const plan = buildPlannedDeviceProjectionRecoveryPlan({
    evidence: value?.evidence,
    ttlSeconds: value?.ttlSeconds,
  });
  if (JSON.stringify(value) !== JSON.stringify(plan)) {
    throw new Error("Planned device-projection recovery plan is not canonical.");
  }
  return plan;
}

export function authorizePlannedDeviceProjectionRecovery(plan, authorization) {
  const normalized = normalizePlannedDeviceProjectionRecoveryPlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error("Planned device-projection recovery authorization is not exact.");
  }
  return deepFreeze({
    schema: "agentic-planned-device-projection-recovery-authorization/v1",
    planDigest: normalized.planDigest,
    authorizationDigest: digestValue({ planDigest: normalized.planDigest, authorization }),
  });
}

export function buildPlannedDeviceProjectionRecoveryReceipt({
  plan,
  taskAuthorityReceiptDigest,
  recoveredAuthority,
  sourceLeaseDigest,
  targetLeaseDigest,
  sourceBodyDigest,
  targetBodyDigest,
  cloudVerificationReceiptDigest,
  disposition,
  completedAt,
} = {}) {
  const normalized = normalizePlannedDeviceProjectionRecoveryPlan(plan);
  const authority = object(recoveredAuthority, "recovered authority");
  const core = {
    schema: PLANNED_DEVICE_PROJECTION_RECOVERY_RECEIPT_SCHEMA,
    status: "complete",
    planDigest: normalized.planDigest,
    evidenceDigest: normalized.evidence.evidenceDigest,
    claimId: digest(authority.claimId, "claim ID"),
    sourceClaimDigest: normalized.evidence.cloud.claim.fenceRevision,
    recoveredClaimDigest: digest(authority.claimDigest, "recovered claim digest"),
    sourceTransitionCounter: normalized.evidence.cloud.claim.transitionCounter,
    recoveredTransitionCounter: positive(authority.transitionCounter, "transition counter"),
    taskAuthorityReceiptDigest: digest(taskAuthorityReceiptDigest, "task receipt"),
    sourceLeaseDigest: digest(sourceLeaseDigest, "source lease digest"),
    targetLeaseDigest: digest(targetLeaseDigest, "target lease digest"),
    sourceBodyDigest: digest(sourceBodyDigest, "source body digest"),
    targetBodyDigest: digest(targetBodyDigest, "target body digest"),
    cloudVerificationReceiptDigest:
      digest(cloudVerificationReceiptDigest, "cloud verification receipt"),
    disposition: disposition === "projected" ? "projected" : "adopted",
    admissionStatus: "planned",
    mutationAuthorityGranted: false,
    authoringAuthority: false,
    integrationAuthority: false,
    deploymentAuthority: false,
    effects: ALLOWED_EFFECTS,
    forbiddenEffects: FORBIDDEN_EFFECTS,
    completedAt: instant(completedAt, "completion instant"),
  };
  if (core.recoveredTransitionCounter !== core.sourceTransitionCounter + 1) {
    throw new Error("Recovery must advance the same claim by exactly one transition.");
  }
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is required.`);
  }
  return value;
}
function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`);
  return value;
}
function instant(value, label) {
  if (!Number.isFinite(Date.parse(String(value || "")))) throw new Error(`${label} is invalid.`);
  return new Date(value).toISOString();
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
