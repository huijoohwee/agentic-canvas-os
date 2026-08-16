// Responsibility: Seal the local-CAS-only continuation plan, intent, and cumulative receipt.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeCurrentCloudExpiredLocalWorkContinuationEvidence }
  from "./current-cloud-expired-local-work-continuation-evidence.mjs";

export const CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_OPERATION =
  "current-cloud-expired-local-work-continuation";
export const CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_PLAN_SCHEMA =
  "agentic-current-cloud-expired-local-work-continuation-plan/v1";
export const CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_INTENT_SCHEMA =
  "agentic-current-cloud-expired-local-work-continuation-intent/v1";
export const CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_PHASE_RECEIPT_SCHEMA =
  "agentic-current-cloud-expired-local-work-continuation-phase-receipt/v1";
export const CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_COMPLETION_SCHEMA =
  "agentic-current-cloud-expired-local-work-continuation-completion/v1";
export const CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_PHASES = Object.freeze([
  "prepared", "authority-verified", "local-attempted", "local-projected", "verified", "complete",
]);

const MUTATION_SET = Object.freeze(["writer-lease-registry-cas"]);

export function buildCurrentCloudExpiredLocalWorkContinuationPlan({ evidence } = {}) {
  const normalizedEvidence = normalizeCurrentCloudExpiredLocalWorkContinuationEvidence(evidence);
  const projectedLease = { ...normalizedEvidence.lease,
    heartbeatAt: normalizedEvidence.cloudClaim.heartbeatAt || normalizedEvidence.observedAt,
    expiresAt: normalizedEvidence.cloudClaim.expiresAt };
  const core = {
    schema: CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_PLAN_SCHEMA,
    operation: CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_OPERATION,
    evidence: normalizedEvidence,
    mode: normalizedEvidence.mode,
    sourceLeaseDigest: normalizedEvidence.leaseDigest,
    projectedLeaseDigest: digestValue(projectedLease),
    mutationSet: MUTATION_SET,
    terminalStatus: "mutation-authority-restored",
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    taskAuthorityOperation: `${CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_OPERATION}:${planDigest}`,
  });
}

export function normalizeCurrentCloudExpiredLocalWorkContinuationPlan(value) {
  if (value?.schema !== CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_PLAN_SCHEMA) {
    invalid("plan schema");
  }
  const rebuilt = buildCurrentCloudExpiredLocalWorkContinuationPlan(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function createCurrentCloudExpiredLocalWorkContinuationIntent(plan) {
  const normalizedPlan = normalizeCurrentCloudExpiredLocalWorkContinuationPlan(plan);
  const prepared = phaseReceipt(normalizedPlan, "prepared", null, {});
  return sealIntent({
    status: "prepared", plan: normalizedPlan, phases: { prepared }, completion: null,
  });
}

export function advanceCurrentCloudExpiredLocalWorkContinuationIntent(
  value,
  { status, values = {} } = {},
) {
  const current = normalizeCurrentCloudExpiredLocalWorkContinuationIntent(value);
  const sourceIndex = CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_PHASES
    .indexOf(current.status);
  const targetIndex = CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_PHASES.indexOf(status);
  if (targetIndex !== sourceIndex + 1) invalid("phase transition");
  const next = phaseReceipt(
    current.planSnapshot,
    status,
    current.phases[current.status].receiptDigest,
    values,
  );
  const phases = { ...current.phases, [status]: next };
  const completion = status === "complete"
    ? completionReceipt(current.planSnapshot, phases)
    : null;
  return sealIntent({ status, plan: current.planSnapshot, phases, completion });
}

export function normalizeCurrentCloudExpiredLocalWorkContinuationIntent(value) {
  if (value?.schema !== CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_INTENT_SCHEMA
    || !CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_PHASES.includes(value.status)) {
    invalid("intent");
  }
  const plan = normalizeCurrentCloudExpiredLocalWorkContinuationPlan(value.planSnapshot);
  const names = CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_PHASES.slice(
    0,
    CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_PHASES.indexOf(value.status) + 1,
  );
  if (canonicalJson(Object.keys(value.phases || {})) !== canonicalJson(names)) {
    invalid("intent phases");
  }
  const phases = {};
  let previousReceiptDigest = null;
  for (const phase of names) {
    const receipt = phaseReceipt(
      plan, phase, previousReceiptDigest, value.phases?.[phase]?.values,
    );
    phases[phase] = receipt;
    previousReceiptDigest = receipt.receiptDigest;
  }
  const completion = value.status === "complete" ? completionReceipt(plan, phases) : null;
  const rebuilt = sealIntent({ status: value.status, plan, phases, completion });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("intent projection");
  return rebuilt;
}

export function buildCurrentCloudExpiredLocalWorkContinuationCompletionReceipt(value) {
  const intent = normalizeCurrentCloudExpiredLocalWorkContinuationIntent(value);
  if (intent.status !== "complete") invalid("completion phase");
  return intent.completion;
}

export function currentCloudExpiredLocalWorkContinuationOperationKey(plan, phase) {
  const normalized = normalizeCurrentCloudExpiredLocalWorkContinuationPlan(plan);
  if (!CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_PHASES.includes(phase)) {
    invalid("phase");
  }
  return `${CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_OPERATION}:${phase}:${digestValue({
    planDigest: normalized.planDigest,
    phase,
  })}`;
}

function phaseReceipt(plan, phase, previousReceiptDigest, values) {
  const normalizedValues = normalizePhaseValues(phase, values, plan);
  const core = {
    schema: CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_PHASE_RECEIPT_SCHEMA,
    phase,
    planDigest: plan.planDigest,
    operationKey: currentCloudExpiredLocalWorkContinuationOperationKey(plan, phase),
    previousReceiptDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseValues(phase, values, plan) {
  const source = structuredClone(record(values, `${phase} values`));
  if (phase === "prepared" || phase === "complete") {
    exactKeys(source, [], phase);
  } else if (phase === "authority-verified") {
    exactKeys(source, ["taskAuthorityBindingDigest", "taskAuthorityReceiptDigest", "taskProofDigest"], phase);
    digest(source.taskAuthorityBindingDigest, "task authority binding digest");
    digest(source.taskAuthorityReceiptDigest, "task authority receipt digest");
    digest(source.taskProofDigest, "task proof digest");
    if (source.taskAuthorityBindingDigest
      !== plan.evidence.taskCapabilityDigest) invalid("task authority join");
  } else if (phase === "local-attempted") {
    exactKeys(source, ["idempotencyKey", "projectedLeaseDigest", "sourceLeaseDigest"], phase);
    digest(source.idempotencyKey, "local idempotency key");
    digest(source.sourceLeaseDigest, "source lease digest");
    digest(source.projectedLeaseDigest, "projected lease digest");
    if (source.sourceLeaseDigest !== plan.sourceLeaseDigest
      || source.projectedLeaseDigest !== plan.projectedLeaseDigest) invalid("lease projection join");
  } else if (phase === "local-projected") {
    exactKeys(source, [
      "disposition", "mutationAuthorityReceipt", "projectedLeaseDigest", "storedLeaseDigest",
      "writerRegistryMutation",
    ], phase);
    if (!["projected", "adopted-response-loss"].includes(source.disposition)
      || source.writerRegistryMutation !== true) invalid("cumulative local disposition");
    digest(source.projectedLeaseDigest, "projected lease digest");
    digest(source.storedLeaseDigest, "stored lease digest");
    if (source.projectedLeaseDigest !== plan.projectedLeaseDigest) invalid("projected lease join");
    normalizeMutationAuthority(source.mutationAuthorityReceipt, plan, source.storedLeaseDigest);
  } else if (phase === "verified") {
    exactKeys(source, ["mutationAuthorityReceiptDigest", "projectedLeaseDigest",
      "storedLeaseDigest", "verificationDigest"], phase);
    digest(source.mutationAuthorityReceiptDigest, "mutation authority receipt digest");
    digest(source.projectedLeaseDigest, "projected lease digest");
    digest(source.storedLeaseDigest, "stored lease digest");
    if (source.projectedLeaseDigest !== plan.projectedLeaseDigest) invalid("verified lease join");
    digest(source.verificationDigest, "verification digest");
  } else {
    invalid("phase values");
  }
  return deepFreeze(source);
}

function completionReceipt(plan, phases) {
  const authority = phases["authority-verified"]?.values;
  const attempted = phases["local-attempted"]?.values;
  const projected = phases["local-projected"]?.values;
  const verified = phases.verified?.values;
  if (!authority || !attempted || !projected || !verified) invalid("completion receipts");
  if (attempted.projectedLeaseDigest !== projected.projectedLeaseDigest
    || projected.projectedLeaseDigest !== verified.projectedLeaseDigest
    || projected.storedLeaseDigest !== verified.storedLeaseDigest
    || projected.mutationAuthorityReceipt.receiptDigest
      !== verified.mutationAuthorityReceiptDigest) invalid("terminal lease join");
  const core = {
    schema: CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_COMPLETION_SCHEMA,
    status: "mutation-authority-restored",
    mode: plan.mode,
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidence.evidenceDigest,
    sourceLeaseDigest: plan.evidence.leaseDigest,
    projectedLeaseDigest: projected.projectedLeaseDigest,
    storedLeaseDigest: projected.storedLeaseDigest,
    claimId: plan.evidence.cloudClaim.claimId,
    claimDigest: plan.evidence.cloudClaim.fenceRevision,
    ownedWorkDigest: plan.evidence.ownedWork.ownedWorkDigest,
    taskAuthorityOperation: plan.taskAuthorityOperation,
    taskAuthorityBindingDigest: authority.taskAuthorityBindingDigest,
    taskAuthorityReceiptDigest: authority.taskAuthorityReceiptDigest,
    taskProofDigest: authority.taskProofDigest,
    writerRegistryDisposition: projected.disposition,
    writerRegistryMutation: true,
    mutationAuthorityReceipt: projected.mutationAuthorityReceipt,
    mutationAuthorityReceiptDigest: projected.mutationAuthorityReceipt.receiptDigest,
    terminalVerificationDigest: verified.verificationDigest,
    mutationSet: MUTATION_SET,
    privateJournalMutation: false,
    cloudMutation: false,
    providerMutation: false,
    gitMutation: false,
    indexMutation: false,
    remoteRefMutation: false,
    sourceMutation: false,
    pullRequestMutation: false,
    pullRequestStateMutation: false,
    newClaimCreated: false,
    newWorktreeCreated: false,
    mergeMutation: false,
    deploymentMutation: false,
    cleanupMutation: false,
    authoringAuthorityRestored: true,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizeMutationAuthority(value, plan, storedLeaseDigest) {
  const source = record(value, "mutation authority receipt");
  exactKeys(source, ["schema", "status", "claimId", "claimDigest", "ledgerRevision",
    "localLeaseEpoch", "localFenceSha", "remoteLeaseEpoch",
    "cloudVerificationReceiptDigest", "evaluatedAt", "expiresAt", "receiptDigest"],
  "mutation authority receipt");
  const core = {
    schema: source.schema,
    status: source.status,
    claimId: digest(source.claimId, "mutation authority claim ID"),
    claimDigest: digest(source.claimDigest, "mutation authority claim digest"),
    ledgerRevision: sha(source.ledgerRevision, "mutation authority ledger revision"),
    localLeaseEpoch: positiveInteger(source.localLeaseEpoch, "mutation authority local epoch"),
    localFenceSha: sha(source.localFenceSha, "mutation authority fence"),
    remoteLeaseEpoch: positiveInteger(source.remoteLeaseEpoch, "mutation authority remote epoch"),
    cloudVerificationReceiptDigest: digest(
      source.cloudVerificationReceiptDigest,
      "mutation authority cloud verification",
    ),
    evaluatedAt: instant(source.evaluatedAt, "mutation authority evaluation"),
    expiresAt: instant(source.expiresAt, "mutation authority expiry"),
  };
  digest(storedLeaseDigest, "stored lease digest");
  if (core.schema !== "agentic-admission-mutation-authority/v1"
    || core.status !== "ready"
    || core.claimId !== plan.evidence.cloudClaim.claimId
    || core.claimDigest !== plan.evidence.cloudClaim.fenceRevision
    || core.ledgerRevision !== plan.evidence.cloudObservation.ledgerRevision
    || core.localFenceSha !== plan.evidence.lease.fenceSha
    || core.localLeaseEpoch !== plan.evidence.lease.epoch
    || core.remoteLeaseEpoch !== plan.evidence.cloudClaim.leaseEpoch
    || core.expiresAt !== plan.evidence.cloudClaim.expiresAt
    || core.cloudVerificationReceiptDigest
      !== plan.evidence.cloudObservation.verificationReceiptDigest
    || digest(source.receiptDigest, "mutation authority receipt digest") !== digestValue(core)) {
    invalid("mutation authority receipt");
  }
  return source;
}

function sealIntent({ status, plan, phases, completion }) {
  const core = {
    schema: CURRENT_CLOUD_EXPIRED_LOCAL_WORK_CONTINUATION_INTENT_SCHEMA,
    status,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    phases,
    completion,
  };
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function exactKeys(value, keys, label) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) invalid(`${label} keys`);
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function digest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function sha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function instant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(label);
  return value;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
function invalid(label) {
  throw new Error(`Current-cloud expired-local work continuation has invalid ${label}.`);
}
