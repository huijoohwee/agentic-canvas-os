// Responsibility: Seal provider-neutral plans, intents, and receipts for one marker response-loss repair.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeActiveAdmittedPrMarkerResponseLossEvidence }
  from "./active-admitted-pr-marker-response-loss-evidence.mjs";

export const ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION =
  "active-admitted-pr-marker-response-loss";
export const ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PLAN_SCHEMA =
  "agentic-active-admitted-pr-marker-response-loss-plan/v1";
export const ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_INTENT_SCHEMA =
  "agentic-active-admitted-pr-marker-response-loss-intent/v1";
export const ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASE_RECEIPT_SCHEMA =
  "agentic-active-admitted-pr-marker-response-loss-phase-receipt/v1";
export const ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_COMPLETION_SCHEMA =
  "agentic-active-admitted-pr-marker-response-loss-completion/v1";
export const ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES = Object.freeze([
  "prepared",
  "authority-verified",
  "provider-attempted",
  "provider-projected",
  "complete",
]);

const ALLOWED_MUTATIONS = Object.freeze(["pull-request-writer-marker"]);
const FORBIDDEN_EFFECTS = Object.freeze([
  "cloud-transition",
  "writer-registry-mutation",
  "git-mutation",
  "remote-ref-mutation",
  "source-mutation",
  "pull-request-metadata-mutation",
  "authoring-authority",
  "integration-authority",
  "deployment",
]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
export function buildActiveAdmittedPrMarkerResponseLossPlan({ evidence } = {}) {
  const normalizedEvidence = normalizePlanEvidence(evidence);
  const core = {
    schema: ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PLAN_SCHEMA,
    operation: ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION,
    evidence: normalizedEvidence,
    allowedMutations: ALLOWED_MUTATIONS,
    forbiddenEffects: FORBIDDEN_EFFECTS,
    terminalStatus: "projection-restored",
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    taskAuthorityOperation:
      `${ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION}:${planDigest}`,
  });
}

export function normalizeActiveAdmittedPrMarkerResponseLossPlan(value) {
  if (value?.schema !== ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PLAN_SCHEMA) {
    invalid("plan schema");
  }
  const rebuilt = buildActiveAdmittedPrMarkerResponseLossPlan(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function createActiveAdmittedPrMarkerResponseLossIntent(plan) {
  const normalizedPlan = normalizeActiveAdmittedPrMarkerResponseLossPlan(plan);
  const prepared = buildPhaseReceipt({
    plan: normalizedPlan,
    phase: "prepared",
    previousReceiptDigest: null,
    values: {},
  });
  return sealIntent({
    status: "prepared",
    plan: normalizedPlan,
    phases: { prepared },
    completion: null,
  });
}

export function advanceActiveAdmittedPrMarkerResponseLossIntent(
  value,
  { status, values = {} } = {},
) {
  const current = normalizeActiveAdmittedPrMarkerResponseLossIntent(value);
  const sourceIndex = ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES.indexOf(current.status);
  const targetIndex = ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES.indexOf(status);
  if (targetIndex !== sourceIndex + 1) invalid("phase transition");
  const previous = current.phases[current.status];
  const next = buildPhaseReceipt({
    plan: current.planSnapshot,
    phase: status,
    previousReceiptDigest: previous.receiptDigest,
    values,
  });
  const phases = { ...current.phases, [status]: next };
  const completion = status === "complete"
    ? buildCompletionReceipt({ plan: current.planSnapshot, phases })
    : null;
  return sealIntent({ status, plan: current.planSnapshot, phases, completion });
}

export function normalizeActiveAdmittedPrMarkerResponseLossIntent(value) {
  if (value?.schema !== ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_INTENT_SCHEMA
    || !ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES.includes(value.status)) {
    invalid("intent");
  }
  const plan = normalizeActiveAdmittedPrMarkerResponseLossPlan(value.planSnapshot);
  const names = ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES.slice(
    0,
    ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES.indexOf(value.status) + 1,
  );
  if (canonicalJson(Object.keys(value.phases || {})) !== canonicalJson(names)) {
    invalid("intent phases");
  }
  let previousReceiptDigest = null;
  const phases = {};
  for (const phase of names) {
    const receipt = buildPhaseReceipt({
      plan,
      phase,
      previousReceiptDigest,
      values: value.phases?.[phase]?.values,
    });
    phases[phase] = receipt;
    previousReceiptDigest = receipt.receiptDigest;
  }
  const completion = value.status === "complete"
    ? buildCompletionReceipt({ plan, phases })
    : null;
  const rebuilt = sealIntent({ status: value.status, plan, phases, completion });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("intent projection");
  return rebuilt;
}

export function buildActiveAdmittedPrMarkerResponseLossCompletionReceipt(value) {
  const intent = normalizeActiveAdmittedPrMarkerResponseLossIntent(value);
  if (intent.status !== "complete") invalid("completion phase");
  return intent.completion;
}

export function activeAdmittedPrMarkerResponseLossOperationKey(plan, phase) {
  const normalized = normalizeActiveAdmittedPrMarkerResponseLossPlan(plan);
  if (!ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES.includes(phase)) invalid("phase");
  return `${ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION}:${phase}:${digestValue({
    planDigest: normalized.planDigest,
    phase,
  })}`;
}

function normalizePlanEvidence(value) {
  return deepFreeze(structuredClone(
    normalizeActiveAdmittedPrMarkerResponseLossEvidence(value),
  ));
}

function buildPhaseReceipt({ plan, phase, previousReceiptDigest, values }) {
  const normalizedValues = normalizePhaseValues(phase, values);
  if (phase === "authority-verified"
    && normalizedValues.bindingDigest !== plan.evidence.lease.taskAuthorityBindingDigest) {
    invalid("task authority evidence join");
  }
  const core = {
    schema: ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASE_RECEIPT_SCHEMA,
    phase,
    planDigest: plan.planDigest,
    operationKey: activeAdmittedPrMarkerResponseLossOperationKey(plan, phase),
    previousReceiptDigest,
    values: deepFreeze(structuredClone(normalizedValues)),
    valuesDigest: digestValue(normalizedValues),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function buildCompletionReceipt({ plan, phases }) {
  const authority = phases["authority-verified"];
  const attempted = phases["provider-attempted"];
  const projected = phases["provider-projected"];
  const terminal = phases.complete;
  if (!authority || !attempted || !projected || !terminal) invalid("completion receipts");
  const core = {
    schema: ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_COMPLETION_SCHEMA,
    status: "projection-restored",
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidence.evidenceDigest,
    sourceBodyDigest: plan.evidence.providerReview.sourceBodyDigest,
    sourceMarkerDigest: plan.evidence.providerReview.sourceMarkerDigest,
    targetBodyDigest: plan.evidence.providerReview.targetBodyDigest,
    targetMarkerDigest: plan.evidence.providerReview.targetMarkerDigest,
    taskAuthorityOperation: plan.taskAuthorityOperation,
    taskAuthorityReceiptDigest:
      authority.values.taskAuthorityReceiptDigest,
    taskAuthorityBindingDigest: authority.values.bindingDigest,
    providerRevalidationDigest: attempted.values.revalidationDigest,
    providerDisposition: projected.values.disposition,
    providerMutation: projected.values.providerMutation,
    providerProjectionDigest: projected.values.projectionDigest,
    terminalVerificationDigest: terminal.values.verificationDigest,
    authorityReceiptDigest: authority.receiptDigest,
    providerAttemptReceiptDigest: attempted.receiptDigest,
    providerProjectionReceiptDigest: projected.receiptDigest,
    terminalVerificationReceiptDigest: terminal.receiptDigest,
    mutationSet: ALLOWED_MUTATIONS,
    journalMutation: true,
    cloudMutation: false,
    writerRegistryMutation: false,
    gitMutation: false,
    remoteRefMutation: false,
    sourceMutation: false,
    pullRequestMetadataMutation: false,
    authoringAuthorityGranted: false,
    integrationAuthorityGranted: false,
    deploymentAuthorityGranted: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseValues(phase, values) {
  const normalized = structuredClone(record(values, `${phase} values`));
  if (phase === "prepared") return deepFreeze(normalized);
  if (phase === "authority-verified") {
    digest(normalized.taskAuthorityReceiptDigest, "task authority receipt digest");
    digest(normalized.bindingDigest, "task authority binding digest");
  } else if (phase === "provider-attempted") {
    digest(normalized.revalidationDigest, "provider revalidation digest");
    if (!["source", "target"].includes(normalized.providerState)) {
      invalid("provider prevalidation state");
    }
  } else if (phase === "provider-projected") {
    if (!["projected", "adopted-response-loss"].includes(normalized.disposition)) {
      invalid("provider projection disposition");
    }
    const expectedMutation = normalized.disposition === "projected";
    if (normalized.providerMutation !== expectedMutation) invalid("provider mutation receipt");
    if (Object.hasOwn(normalized, "providerProjected")
      && normalized.providerProjected !== true) invalid("provider response-loss receipt");
    digest(normalized.projectionDigest, "provider projection digest");
  } else if (phase === "complete") {
    digest(normalized.verificationDigest, "terminal verification digest");
  } else {
    invalid("phase values");
  }
  return deepFreeze(normalized);
}

function sealIntent({ status, plan, phases, completion }) {
  const core = {
    schema: ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_INTENT_SCHEMA,
    status,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    phases,
    completion,
  };
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) invalid(label);
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function invalid(label) {
  throw new Error(`Active admitted PR marker response-loss contract has invalid ${label}.`);
}
