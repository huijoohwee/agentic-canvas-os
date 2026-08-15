// Responsibility: Seal provider-neutral plans and receipts for one expired marker repair.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeExpiredActiveAdmittedPrMarkerResponseLossEvidence }
  from "./expired-active-admitted-pr-marker-response-loss-evidence.mjs";

export const EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION =
  "expired-active-admitted-pr-marker-response-loss";
export const EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PLAN_SCHEMA =
  "agentic-expired-active-admitted-pr-marker-response-loss-plan/v1";
export const EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_INTENT_SCHEMA =
  "agentic-expired-active-admitted-pr-marker-response-loss-intent/v1";
export const EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASE_RECEIPT_SCHEMA =
  "agentic-expired-active-admitted-pr-marker-response-loss-phase-receipt/v1";
export const EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_COMPLETION_SCHEMA =
  "agentic-expired-active-admitted-pr-marker-response-loss-completion/v1";
export const EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES = Object.freeze([
  "prepared",
  "authority-verified",
  "provider-attempted",
  "provider-projected",
  "complete",
]);

const ALLOWED_MUTATIONS = Object.freeze(["provider-review-body"]);
const FORBIDDEN_EFFECTS = Object.freeze([
  "cloud-transition",
  "writer-registry-mutation",
  "git-mutation",
  "remote-ref-mutation",
  "source-mutation",
  "provider-review-metadata-mutation",
  "authoring-authority",
  "integration-authority",
  "release-authority",
  "deployment-authority",
  "cleanup-authority",
]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function buildExpiredActiveAdmittedPrMarkerResponseLossPlan({ evidence } = {}) {
  const normalizedEvidence = deepFreeze(structuredClone(
    normalizeExpiredActiveAdmittedPrMarkerResponseLossEvidence(evidence),
  ));
  const core = {
    schema: EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PLAN_SCHEMA,
    operation: EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION,
    evidence: normalizedEvidence,
    allowedMutations: ALLOWED_MUTATIONS,
    forbiddenEffects: FORBIDDEN_EFFECTS,
    terminalStatus: "projection-restored-expired",
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    taskAuthorityOperation:
      `${EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION}:${planDigest}`,
  });
}

export function normalizeExpiredActiveAdmittedPrMarkerResponseLossPlan(value) {
  if (value?.schema !== EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PLAN_SCHEMA) {
    invalid("plan schema");
  }
  const rebuilt = buildExpiredActiveAdmittedPrMarkerResponseLossPlan(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function createExpiredActiveAdmittedPrMarkerResponseLossIntent(plan) {
  const normalizedPlan = normalizeExpiredActiveAdmittedPrMarkerResponseLossPlan(plan);
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

export function advanceExpiredActiveAdmittedPrMarkerResponseLossIntent(
  value,
  { status, values = {} } = {},
) {
  const current = normalizeExpiredActiveAdmittedPrMarkerResponseLossIntent(value);
  const sourceIndex = EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES
    .indexOf(current.status);
  const targetIndex = EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES
    .indexOf(status);
  if (targetIndex !== sourceIndex + 1) invalid("phase transition");
  const next = buildPhaseReceipt({
    plan: current.planSnapshot,
    phase: status,
    previousReceiptDigest: current.phases[current.status].receiptDigest,
    values,
  });
  const phases = { ...current.phases, [status]: next };
  const completion = status === "complete"
    ? buildCompletionReceipt({ plan: current.planSnapshot, phases })
    : null;
  return sealIntent({ status, plan: current.planSnapshot, phases, completion });
}

export function normalizeExpiredActiveAdmittedPrMarkerResponseLossIntent(value) {
  if (value?.schema !== EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_INTENT_SCHEMA
    || !EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES.includes(value.status)) {
    invalid("intent");
  }
  const plan = normalizeExpiredActiveAdmittedPrMarkerResponseLossPlan(value.planSnapshot);
  const names = EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES.slice(
    0,
    EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES.indexOf(value.status) + 1,
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

export function buildExpiredActiveAdmittedPrMarkerResponseLossCompletionReceipt(value) {
  const intent = normalizeExpiredActiveAdmittedPrMarkerResponseLossIntent(value);
  if (intent.status !== "complete") invalid("completion phase");
  return intent.completion;
}

export function expiredActiveAdmittedPrMarkerResponseLossOperationKey(plan, phase) {
  const normalized = normalizeExpiredActiveAdmittedPrMarkerResponseLossPlan(plan);
  if (!EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASES.includes(phase)) {
    invalid("phase");
  }
  return `${EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_OPERATION}:${phase}:${digestValue({
    planDigest: normalized.planDigest,
    phase,
  })}`;
}

function buildPhaseReceipt({ plan, phase, previousReceiptDigest, values }) {
  const normalizedValues = normalizePhaseValues(phase, values, plan);
  const core = {
    schema: EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_PHASE_RECEIPT_SCHEMA,
    phase,
    planDigest: plan.planDigest,
    operationKey: expiredActiveAdmittedPrMarkerResponseLossOperationKey(plan, phase),
    previousReceiptDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseValues(phase, values, plan) {
  const source = structuredClone(record(values, `${phase} values`));
  if (phase === "prepared") {
    exactKeys(source, [], "prepared values");
  } else if (phase === "authority-verified") {
    exactKeys(source, ["bindingDigest", "taskAuthorityReceiptDigest"], phase);
    digest(source.taskAuthorityReceiptDigest, "task authority receipt digest");
    digest(source.bindingDigest, "task authority binding digest");
    if (source.bindingDigest !== plan.evidence.lease.taskAuthorityBindingDigest) {
      invalid("task authority evidence join");
    }
  } else if (phase === "provider-attempted") {
    exactKeys(source, ["providerState", "revalidationDigest"], phase);
    digest(source.revalidationDigest, "provider revalidation digest");
    if (!["source", "target"].includes(source.providerState)) {
      invalid("provider prevalidation state");
    }
  } else if (phase === "provider-projected") {
    const expectedKeys = ["disposition", "projectionDigest", "providerMutation"];
    if (Object.hasOwn(source, "providerProjected")) expectedKeys.push("providerProjected");
    exactKeys(source, expectedKeys, phase);
    if (!["projected", "adopted-response-loss"].includes(source.disposition)) {
      invalid("provider projection disposition");
    }
    if (source.providerMutation !== (source.disposition === "projected")) {
      invalid("provider mutation receipt");
    }
    if (Object.hasOwn(source, "providerProjected")
      && (source.providerProjected !== true
        || source.disposition !== "adopted-response-loss")) {
      invalid("provider response-loss receipt");
    }
    digest(source.projectionDigest, "provider projection digest");
    if (source.projectionDigest !== plan.evidence.providerReview.targetBodyDigest) {
      invalid("sealed target projection");
    }
  } else if (phase === "complete") {
    exactKeys(source, ["verificationDigest"], phase);
    digest(source.verificationDigest, "terminal verification digest");
  } else {
    invalid("phase values");
  }
  return deepFreeze(source);
}

function buildCompletionReceipt({ plan, phases }) {
  const authority = phases["authority-verified"];
  const attempted = phases["provider-attempted"];
  const projected = phases["provider-projected"];
  const terminal = phases.complete;
  if (!authority || !attempted || !projected || !terminal) {
    invalid("completion receipts");
  }
  if (attempted.values.providerState === "target"
    && projected.values.disposition !== "adopted-response-loss") {
    invalid("preexisting provider target disposition");
  }
  const predecessor = plan.evidence.predecessorPlanSnapshot;
  const review = plan.evidence.providerReview;
  const core = {
    schema: EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_COMPLETION_SCHEMA,
    status: "projection-restored-expired",
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidence.evidenceDigest,
    predecessorPlanDigest: predecessor.planDigest,
    predecessorEvidenceDigest: predecessor.evidence.evidenceDigest,
    predecessorObservedAt: predecessor.evidence.observedAt,
    expiredObservedAt: plan.evidence.observedAt,
    leaseExpiresAt: plan.evidence.lease.expiresAt,
    sourceBodyDigest: review.sourceBodyDigest,
    sourceMarkerDigest: review.sourceMarkerDigest,
    targetBodyDigest: review.targetBodyDigest,
    targetMarkerDigest: review.targetMarkerDigest,
    taskAuthorityOperation: plan.taskAuthorityOperation,
    taskAuthorityReceiptDigest: authority.values.taskAuthorityReceiptDigest,
    taskAuthorityBindingDigest: authority.values.bindingDigest,
    providerRevalidationDigest: attempted.values.revalidationDigest,
    providerPrevalidationState: attempted.values.providerState,
    providerDisposition: projected.values.disposition,
    providerMutation: projected.values.providerMutation,
    providerProjectionDigest: projected.values.projectionDigest,
    terminalVerificationDigest: terminal.values.verificationDigest,
    authorityReceiptDigest: authority.receiptDigest,
    providerAttemptReceiptDigest: attempted.receiptDigest,
    providerProjectionReceiptDigest: projected.receiptDigest,
    terminalVerificationReceiptDigest: terminal.receiptDigest,
    mutationSet: ALLOWED_MUTATIONS,
    privateJournalMutation: true,
    cloudMutation: false,
    writerRegistryMutation: false,
    gitMutation: false,
    remoteRefMutation: false,
    sourceMutation: false,
    providerReviewMetadataMutation: false,
    authoringAuthorityGranted: false,
    integrationAuthorityGranted: false,
    releaseAuthorityGranted: false,
    deploymentAuthorityGranted: false,
    cleanupAuthorityGranted: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealIntent({ status, plan, phases, completion }) {
  const core = {
    schema: EXPIRED_ACTIVE_ADMITTED_PR_MARKER_RESPONSE_LOSS_INTENT_SCHEMA,
    status,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    phases,
    completion,
  };
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function exactKeys(value, expected, label) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    invalid(`${label} fields`);
  }
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
  throw new Error(`Expired active admitted PR marker response-loss contract has invalid ${label}.`);
}
