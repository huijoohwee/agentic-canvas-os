// Responsibility: Seal one local-CAS-only planned-start fence projection recovery.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { normalizePlannedStartFenceProjectionRecoveryEvidence }
  from "./planned-start-fence-projection-recovery-evidence.mjs";

export const PLANNED_START_FENCE_PROJECTION_RECOVERY_OPERATION =
  "planned-start-fence-projection-recovery";
export const PLANNED_START_FENCE_PROJECTION_RECOVERY_PLAN_SCHEMA =
  "agentic-planned-start-fence-projection-recovery-plan/v1";
export const PLANNED_START_FENCE_PROJECTION_RECOVERY_INTENT_SCHEMA =
  "agentic-planned-start-fence-projection-recovery-intent/v1";
export const PLANNED_START_FENCE_PROJECTION_RECOVERY_PHASE_RECEIPT_SCHEMA =
  "agentic-planned-start-fence-projection-recovery-phase-receipt/v1";
export const PLANNED_START_FENCE_PROJECTION_RECOVERY_COMPLETION_SCHEMA =
  "agentic-planned-start-fence-projection-recovery-completion/v1";
export const PLANNED_START_FENCE_PROJECTION_RECOVERY_PHASES = Object.freeze([
  "prepared", "authority-verified", "local-attempted", "local-projected", "verified", "complete",
]);

const MUTATION_SET = Object.freeze(["writer-lease-registry-cas-with-recovery-receipt"]);

export function buildPlannedStartFenceProjectionRecoveryPlan({ evidence } = {}) {
  const normalizedEvidence = normalizePlannedStartFenceProjectionRecoveryEvidence(evidence);
  const sourceLease = normalizedEvidence.leaseObservations[0];
  const sourceCloudAuthority = sourceLease.cloudAuthority;
  const targetCloudAuthority = normalizedEvidence.targetCloudAuthority;
  const targetLease = deepFreeze({ ...sourceLease, cloudAuthority: targetCloudAuthority });
  const core = {
    schema: PLANNED_START_FENCE_PROJECTION_RECOVERY_PLAN_SCHEMA,
    operation: PLANNED_START_FENCE_PROJECTION_RECOVERY_OPERATION,
    evidence: normalizedEvidence,
    sourceLeaseDigest: writerLeaseDigest(sourceLease),
    targetLeaseDigest: writerLeaseDigest(targetLease),
    sourceCloudAuthority,
    targetCloudAuthority,
    mutationSet: MUTATION_SET,
    terminalStatus: "planned-fence-projected",
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    taskAuthorityOperation: `${PLANNED_START_FENCE_PROJECTION_RECOVERY_OPERATION}:${planDigest}`,
  });
}

export function normalizePlannedStartFenceProjectionRecoveryPlan(value) {
  if (value?.schema !== PLANNED_START_FENCE_PROJECTION_RECOVERY_PLAN_SCHEMA) invalid("plan schema");
  const rebuilt = buildPlannedStartFenceProjectionRecoveryPlan(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function createPlannedStartFenceProjectionRecoveryIntent(plan) {
  const normalizedPlan = normalizePlannedStartFenceProjectionRecoveryPlan(plan);
  const prepared = phaseReceipt(normalizedPlan, "prepared", null, {});
  return sealIntent({ status: "prepared", plan: normalizedPlan, phases: { prepared }, completion: null });
}

export function advancePlannedStartFenceProjectionRecoveryIntent(value, { status, values = {} } = {}) {
  const current = normalizePlannedStartFenceProjectionRecoveryIntent(value);
  const sourceIndex = PLANNED_START_FENCE_PROJECTION_RECOVERY_PHASES.indexOf(current.status);
  const targetIndex = PLANNED_START_FENCE_PROJECTION_RECOVERY_PHASES.indexOf(status);
  if (targetIndex !== sourceIndex + 1) invalid("phase transition");
  const next = phaseReceipt(current.planSnapshot, status,
    current.phases[current.status].receiptDigest, values);
  const phases = { ...current.phases, [status]: next };
  const completion = status === "complete" ? completionReceipt(current.planSnapshot, phases) : null;
  return sealIntent({ status, plan: current.planSnapshot, phases, completion });
}

export function normalizePlannedStartFenceProjectionRecoveryIntent(value) {
  if (value?.schema !== PLANNED_START_FENCE_PROJECTION_RECOVERY_INTENT_SCHEMA
    || !PLANNED_START_FENCE_PROJECTION_RECOVERY_PHASES.includes(value.status)) invalid("intent");
  const plan = normalizePlannedStartFenceProjectionRecoveryPlan(value.planSnapshot);
  const names = PLANNED_START_FENCE_PROJECTION_RECOVERY_PHASES.slice(
    0, PLANNED_START_FENCE_PROJECTION_RECOVERY_PHASES.indexOf(value.status) + 1,
  );
  if (canonicalJson(Object.keys(value.phases || {})) !== canonicalJson(names)) invalid("intent phases");
  const phases = {};
  let previousReceiptDigest = null;
  for (const phase of names) {
    const receipt = phaseReceipt(plan, phase, previousReceiptDigest, value.phases?.[phase]?.values);
    phases[phase] = receipt;
    previousReceiptDigest = receipt.receiptDigest;
  }
  const completion = value.status === "complete" ? completionReceipt(plan, phases) : null;
  const rebuilt = sealIntent({ status: value.status, plan, phases, completion });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("intent projection");
  return rebuilt;
}

export function buildPlannedStartFenceProjectionRecoveryCompletionReceipt(value) {
  const intent = normalizePlannedStartFenceProjectionRecoveryIntent(value);
  if (intent.status !== "complete") invalid("completion phase");
  return intent.completion;
}

export function plannedStartFenceProjectionRecoveryOperationKey(plan, phase) {
  const normalized = normalizePlannedStartFenceProjectionRecoveryPlan(plan);
  if (!PLANNED_START_FENCE_PROJECTION_RECOVERY_PHASES.includes(phase)) invalid("phase");
  return `${PLANNED_START_FENCE_PROJECTION_RECOVERY_OPERATION}:${phase}:${digestValue({
    planDigest: normalized.planDigest, phase,
  })}`;
}

export function projectPlannedStartFenceProjectionRecoveryTargetLease(plan) {
  const normalized = normalizePlannedStartFenceProjectionRecoveryPlan(plan);
  return deepFreeze({
    ...normalized.evidence.leaseObservations[0],
    cloudAuthority: normalized.targetCloudAuthority,
  });
}

function phaseReceipt(plan, phase, previousReceiptDigest, values) {
  const normalizedValues = normalizePhaseValues(phase, values, plan);
  const core = {
    schema: PLANNED_START_FENCE_PROJECTION_RECOVERY_PHASE_RECEIPT_SCHEMA,
    phase,
    planDigest: plan.planDigest,
    operationKey: plannedStartFenceProjectionRecoveryOperationKey(plan, phase),
    previousReceiptDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseValues(phase, values, plan) {
  const source = structuredClone(record(values, `${phase} values`));
  if (["prepared", "complete"].includes(phase)) {
    exactKeys(source, [], phase);
  } else if (phase === "authority-verified") {
    exactKeys(source, ["taskAuthorityBindingDigest", "taskAuthorityReceiptDigest"], phase);
    digest(source.taskAuthorityBindingDigest, "task authority binding digest");
    digest(source.taskAuthorityReceiptDigest, "task authority receipt digest");
    if (source.taskAuthorityBindingDigest !== plan.evidence.taskCapabilityDigest) invalid("task authority join");
  } else if (phase === "local-attempted") {
    exactKeys(source, ["idempotencyKey", "sourceLeaseDigest", "targetLeaseDigest"], phase);
    digest(source.idempotencyKey, "local idempotency key");
    if (source.sourceLeaseDigest !== plan.sourceLeaseDigest
      || source.targetLeaseDigest !== plan.targetLeaseDigest) invalid("attempted lease join");
  } else if (phase === "local-projected") {
    exactKeys(source, ["disposition", "writerRegistryMutation", "sourceLeaseDigest",
      "targetLeaseDigest", "registryRevision", "recoveryReceiptDigest",
      "mutationAuthorityReceiptDigest"], phase);
    if (!["projected", "adopted-response-loss"].includes(source.disposition)
      || source.writerRegistryMutation !== true || source.sourceLeaseDigest !== plan.sourceLeaseDigest
      || source.targetLeaseDigest !== plan.targetLeaseDigest) invalid("cumulative local disposition");
    positiveInteger(source.registryRevision, "registry revision");
    digest(source.recoveryReceiptDigest, "recovery receipt digest");
    digest(source.mutationAuthorityReceiptDigest, "mutation authority receipt digest");
  } else if (phase === "verified") {
    exactKeys(source, ["targetLeaseDigest", "recoveryReceiptDigest", "registryRevision",
      "verificationDigest"], phase);
    if (source.targetLeaseDigest !== plan.targetLeaseDigest) invalid("verified target lease");
    positiveInteger(source.registryRevision, "registry revision");
    digest(source.recoveryReceiptDigest, "recovery receipt digest");
    digest(source.verificationDigest, "verification digest");
  } else invalid("phase values");
  return deepFreeze(source);
}

function completionReceipt(plan, phases) {
  const authority = phases["authority-verified"]?.values;
  const projected = phases["local-projected"]?.values;
  const verified = phases.verified?.values;
  if (!authority || !projected || !verified
    || projected.targetLeaseDigest !== verified.targetLeaseDigest
    || projected.recoveryReceiptDigest !== verified.recoveryReceiptDigest
    || projected.registryRevision !== verified.registryRevision) invalid("completion joins");
  const core = {
    schema: PLANNED_START_FENCE_PROJECTION_RECOVERY_COMPLETION_SCHEMA,
    status: "planned-fence-projected",
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidence.evidenceDigest,
    sourceLeaseDigest: plan.sourceLeaseDigest,
    targetLeaseDigest: plan.targetLeaseDigest,
    sourceCloudAuthorityDigest: digestValue(plan.sourceCloudAuthority),
    targetCloudAuthorityDigest: digestValue(plan.targetCloudAuthority),
    claimId: plan.targetCloudAuthority.claimId,
    sourceTransitionCounter: plan.sourceCloudAuthority.transitionCounter,
    targetTransitionCounter: plan.targetCloudAuthority.transitionCounter,
    taskAuthorityOperation: plan.taskAuthorityOperation,
    taskAuthorityBindingDigest: authority.taskAuthorityBindingDigest,
    taskAuthorityReceiptDigest: authority.taskAuthorityReceiptDigest,
    mutationAuthorityReceiptDigest: projected.mutationAuthorityReceiptDigest,
    writerRegistryDisposition: projected.disposition,
    writerRegistryMutation: true,
    recoveryReceiptDigest: projected.recoveryReceiptDigest,
    registryRevision: projected.registryRevision,
    terminalVerificationDigest: verified.verificationDigest,
    mutationSet: MUTATION_SET,
    privateJournalMutation: false,
    cloudMutation: false,
    providerMutation: false,
    sourceMutation: false,
    gitMutation: false,
    indexMutation: false,
    remoteRefMutation: false,
    pullRequestMutation: false,
    pullRequestStateMutation: false,
    newClaimCreated: false,
    newWorktreeCreated: false,
    mergeMutation: false,
    deploymentMutation: false,
    cleanupMutation: false,
    authoringAuthorityRestored: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealIntent({ status, plan, phases, completion }) {
  const core = { schema: PLANNED_START_FENCE_PROJECTION_RECOVERY_INTENT_SCHEMA, status,
    planDigest: plan.planDigest, planSnapshot: plan, phases, completion };
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}
function exactKeys(value, keys, label) { if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) invalid(`${label} keys`); }
function record(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function positiveInteger(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); return value; }
function invalid(label) { throw new Error(`Planned-start fence projection recovery has invalid ${label}.`); }
