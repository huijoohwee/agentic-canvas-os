// Responsibility: Seal the local-CAS-only continuation plan, intent, and cumulative receipt.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeCurrentCloudExpiredLocalOwnedDirtContinuationEvidence }
  from "./current-cloud-expired-local-owned-dirt-continuation-evidence.mjs";

export const CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_OPERATION =
  "current-cloud-expired-local-owned-dirt-continuation";
export const CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_PLAN_SCHEMA =
  "agentic-current-cloud-expired-local-owned-dirt-continuation-plan/v1";
export const CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_INTENT_SCHEMA =
  "agentic-current-cloud-expired-local-owned-dirt-continuation-intent/v1";
export const CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_PHASE_RECEIPT_SCHEMA =
  "agentic-current-cloud-expired-local-owned-dirt-continuation-phase-receipt/v1";
export const CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_COMPLETION_SCHEMA =
  "agentic-current-cloud-expired-local-owned-dirt-continuation-completion/v1";
export const CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_PHASES = Object.freeze([
  "prepared", "authority-verified", "local-attempted", "local-projected", "verified", "complete",
]);

const MUTATION_SET = Object.freeze(["writer-lease-registry-cas"]);

export function buildCurrentCloudExpiredLocalOwnedDirtContinuationPlan({ evidence } = {}) {
  const normalizedEvidence = normalizeCurrentCloudExpiredLocalOwnedDirtContinuationEvidence(evidence);
  const core = {
    schema: CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_PLAN_SCHEMA,
    operation: CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_OPERATION,
    evidence: normalizedEvidence,
    mutationSet: MUTATION_SET,
    terminalStatus: "mutation-authority-restored",
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    taskAuthorityOperation: `${CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_OPERATION}:${planDigest}`,
  });
}

export function normalizeCurrentCloudExpiredLocalOwnedDirtContinuationPlan(value) {
  if (value?.schema !== CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_PLAN_SCHEMA) {
    invalid("plan schema");
  }
  const rebuilt = buildCurrentCloudExpiredLocalOwnedDirtContinuationPlan(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function createCurrentCloudExpiredLocalOwnedDirtContinuationIntent(plan) {
  const normalizedPlan = normalizeCurrentCloudExpiredLocalOwnedDirtContinuationPlan(plan);
  const prepared = phaseReceipt(normalizedPlan, "prepared", null, {});
  return sealIntent({
    status: "prepared", plan: normalizedPlan, phases: { prepared }, completion: null,
  });
}

export function advanceCurrentCloudExpiredLocalOwnedDirtContinuationIntent(
  value,
  { status, values = {} } = {},
) {
  const current = normalizeCurrentCloudExpiredLocalOwnedDirtContinuationIntent(value);
  const sourceIndex = CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_PHASES
    .indexOf(current.status);
  const targetIndex = CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_PHASES.indexOf(status);
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

export function normalizeCurrentCloudExpiredLocalOwnedDirtContinuationIntent(value) {
  if (value?.schema !== CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_INTENT_SCHEMA
    || !CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_PHASES.includes(value.status)) {
    invalid("intent");
  }
  const plan = normalizeCurrentCloudExpiredLocalOwnedDirtContinuationPlan(value.planSnapshot);
  const names = CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_PHASES.slice(
    0,
    CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_PHASES.indexOf(value.status) + 1,
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

export function buildCurrentCloudExpiredLocalOwnedDirtContinuationCompletionReceipt(value) {
  const intent = normalizeCurrentCloudExpiredLocalOwnedDirtContinuationIntent(value);
  if (intent.status !== "complete") invalid("completion phase");
  return intent.completion;
}

export function currentCloudExpiredLocalOwnedDirtContinuationOperationKey(plan, phase) {
  const normalized = normalizeCurrentCloudExpiredLocalOwnedDirtContinuationPlan(plan);
  if (!CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_PHASES.includes(phase)) {
    invalid("phase");
  }
  return `${CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_OPERATION}:${phase}:${digestValue({
    planDigest: normalized.planDigest,
    phase,
  })}`;
}

function phaseReceipt(plan, phase, previousReceiptDigest, values) {
  const normalizedValues = normalizePhaseValues(phase, values, plan);
  const core = {
    schema: CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_PHASE_RECEIPT_SCHEMA,
    phase,
    planDigest: plan.planDigest,
    operationKey: currentCloudExpiredLocalOwnedDirtContinuationOperationKey(plan, phase),
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
    exactKeys(source, ["taskAuthorityBindingDigest", "taskAuthorityReceiptDigest"], phase);
    digest(source.taskAuthorityBindingDigest, "task authority binding digest");
    digest(source.taskAuthorityReceiptDigest, "task authority receipt digest");
    if (source.taskAuthorityBindingDigest
      !== plan.evidence.taskCapabilityDigest) invalid("task authority join");
  } else if (phase === "local-attempted") {
    exactKeys(source, ["idempotencyKey", "sourceLeaseDigest", "targetLeaseDigest"], phase);
    digest(source.idempotencyKey, "local idempotency key");
    digest(source.sourceLeaseDigest, "source lease digest");
    digest(source.targetLeaseDigest, "target lease digest");
    if (source.sourceLeaseDigest !== plan.evidence.leaseDigest) invalid("source lease join");
  } else if (phase === "local-projected") {
    exactKeys(source, [
      "disposition", "mutationAuthorityReceipt", "targetLeaseDigest",
      "writerRegistryMutation",
    ], phase);
    if (!["projected", "adopted-response-loss"].includes(source.disposition)
      || source.writerRegistryMutation !== true) invalid("cumulative local disposition");
    digest(source.targetLeaseDigest, "target lease digest");
    normalizeMutationAuthority(source.mutationAuthorityReceipt, plan, source.targetLeaseDigest);
  } else if (phase === "verified") {
    exactKeys(source, ["mutationAuthorityReceiptDigest", "targetLeaseDigest", "verificationDigest"], phase);
    digest(source.mutationAuthorityReceiptDigest, "mutation authority receipt digest");
    digest(source.targetLeaseDigest, "target lease digest");
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
  if (attempted.targetLeaseDigest !== projected.targetLeaseDigest
    || projected.targetLeaseDigest !== verified.targetLeaseDigest
    || projected.mutationAuthorityReceipt.receiptDigest
      !== verified.mutationAuthorityReceiptDigest) invalid("terminal lease join");
  const core = {
    schema: CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_COMPLETION_SCHEMA,
    status: "mutation-authority-restored",
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidence.evidenceDigest,
    sourceLeaseDigest: plan.evidence.leaseDigest,
    targetLeaseDigest: projected.targetLeaseDigest,
    claimId: plan.evidence.cloudClaim.claimId,
    claimDigest: plan.evidence.cloudClaim.fenceRevision,
    taskAuthorityOperation: plan.taskAuthorityOperation,
    taskAuthorityBindingDigest: authority.taskAuthorityBindingDigest,
    taskAuthorityReceiptDigest: authority.taskAuthorityReceiptDigest,
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
    remoteRefMutation: false,
    sourceMutation: false,
    pullRequestMutation: false,
    newClaimCreated: false,
    newWorktreeCreated: false,
    deploymentMutation: false,
    cleanupMutation: false,
    authoringAuthorityRestored: true,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizeMutationAuthority(value, plan, targetLeaseDigest) {
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
  digest(targetLeaseDigest, "target lease digest");
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
    schema: CURRENT_CLOUD_EXPIRED_LOCAL_OWNED_DIRT_CONTINUATION_INTENT_SCHEMA,
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
  throw new Error(`Current-cloud expired-local owned-dirt continuation has invalid ${label}.`);
}
