// Responsibility: Seal one exact expired-active device-review response-loss plan, intent, and receipt.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeExpiredActiveDeviceReviewResponseLossEvidence }
  from "./expired-active-device-review-response-loss-evidence.mjs";

export const EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_OPERATION =
  "expired-active-device-review-response-loss";
export const EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_AUTHORIZATION_PREFIX =
  `authorize ${EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_OPERATION}`;
export const EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PLAN_SCHEMA =
  "agentic-expired-active-device-review-response-loss-plan/v1";
export const EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_AUTHORIZATION_SCHEMA =
  "agentic-expired-active-device-review-response-loss-authorization/v1";
export const EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_INTENT_SCHEMA =
  "agentic-expired-active-device-review-response-loss-intent/v1";
export const EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PHASE_RECEIPT_SCHEMA =
  "agentic-expired-active-device-review-response-loss-phase-receipt/v1";
export const EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_COMPLETION_SCHEMA =
  "agentic-expired-active-device-review-response-loss-completion/v1";
export const EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PHASES = Object.freeze([
  "authorized",
  "task-authority-verified",
  "reviewed-transition-adopted",
  "local-attempted",
  "local-projected",
  "marker-attempted",
  "marker-projected",
  "ready-attempted",
  "provider-ready",
  "verified",
  "complete",
]);
export const EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_MUTATION_POLICY = deepFreeze({
  allowed: [
    "local-writer-lease-review-ready-cas",
    "pull-request-hidden-marker-projection",
    "pull-request-draft-to-ready",
  ],
  reviewedTransitionAdoption: "observation-only",
  cloudMutation: false,
  claimMutation: false,
  heartbeatMutation: false,
  sourceMutation: false,
  gitMutation: false,
  remoteRefMutation: false,
  mergeMutation: false,
  integrationMutation: false,
  releaseMutation: false,
  deploymentMutation: false,
  cleanupMutation: false,
  authoringAuthorityGranted: false,
  integrationAuthorityGranted: false,
  releaseAuthorityGranted: false,
  deploymentAuthorityGranted: false,
  cleanupAuthorityGranted: false,
});

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function buildExpiredActiveDeviceReviewResponseLossPlan({ evidence } = {}) {
  const normalizedEvidence = deepFreeze(structuredClone(
    normalizeExpiredActiveDeviceReviewResponseLossEvidence(evidence),
  ));
  const core = {
    schema: EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PLAN_SCHEMA,
    operation: EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_OPERATION,
    evidence: normalizedEvidence,
    mutationPolicy: EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_MUTATION_POLICY,
    terminalStatus: "review-ready-projection-restored",
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization:
      `${EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_AUTHORIZATION_PREFIX} ${planDigest}`,
    taskAuthorityOperation:
      `${EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_OPERATION}:${planDigest}`,
  });
}

export function normalizeExpiredActiveDeviceReviewResponseLossPlan(value) {
  if (value?.schema !== EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PLAN_SCHEMA) {
    invalid("plan schema");
  }
  const rebuilt = buildExpiredActiveDeviceReviewResponseLossPlan(value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizeExpiredActiveDeviceReviewResponseLoss(planValue, authorization) {
  const plan = normalizeExpiredActiveDeviceReviewResponseLossPlan(planValue);
  if (authorization !== plan.exactAuthorization) {
    throw new Error(`Exact authorization required: ${plan.exactAuthorization}`);
  }
  const core = {
    schema: EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_AUTHORIZATION_SCHEMA,
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidence.evidenceDigest,
    authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createExpiredActiveDeviceReviewResponseLossIntent(
  planValue,
  authorizationValue,
) {
  const plan = normalizeExpiredActiveDeviceReviewResponseLossPlan(planValue);
  const authorization = normalizeAuthorization(authorizationValue, plan);
  const authorized = buildPhaseReceipt({
    plan,
    authorizationDigest: authorization.authorizationDigest,
    phase: "authorized",
    previousReceiptDigest: null,
    values: { authorizationDigest: authorization.authorizationDigest },
  });
  return sealIntent({
    status: "authorized",
    plan,
    authorization,
    phases: { authorized },
    completion: null,
  });
}

export function advanceExpiredActiveDeviceReviewResponseLossIntent(
  value,
  { status, values = {} } = {},
) {
  const current = normalizeExpiredActiveDeviceReviewResponseLossIntent(value);
  const sourceIndex = EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PHASES
    .indexOf(current.status);
  const targetIndex = EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PHASES.indexOf(status);
  if (targetIndex !== sourceIndex + 1) invalid("phase transition");
  const next = buildPhaseReceipt({
    plan: current.planSnapshot,
    authorizationDigest: current.authorizationDigest,
    phase: status,
    previousReceiptDigest: current.phases[current.status].receiptDigest,
    values,
  });
  const phases = { ...current.phases, [status]: next };
  const completion = status === "complete"
    ? buildCompletionReceipt({
      plan: current.planSnapshot,
      authorization: current.authorization,
      phases,
    })
    : null;
  return sealIntent({
    status,
    plan: current.planSnapshot,
    authorization: current.authorization,
    phases,
    completion,
  });
}

export function normalizeExpiredActiveDeviceReviewResponseLossIntent(value) {
  if (value?.schema !== EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_INTENT_SCHEMA
    || !EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PHASES.includes(value.status)) {
    invalid("intent");
  }
  const plan = normalizeExpiredActiveDeviceReviewResponseLossPlan(value.planSnapshot);
  const authorization = normalizeAuthorization(value.authorization, plan);
  const names = EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PHASES.slice(
    0,
    EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PHASES.indexOf(value.status) + 1,
  );
  if (canonicalJson(Object.keys(value.phases || {})) !== canonicalJson(names)) {
    invalid("intent phases");
  }
  let previousReceiptDigest = null;
  const phases = {};
  for (const phase of names) {
    const receipt = buildPhaseReceipt({
      plan,
      authorizationDigest: authorization.authorizationDigest,
      phase,
      previousReceiptDigest,
      values: value.phases?.[phase]?.values,
    });
    phases[phase] = receipt;
    previousReceiptDigest = receipt.receiptDigest;
  }
  const completion = value.status === "complete"
    ? buildCompletionReceipt({ plan, authorization, phases })
    : null;
  const rebuilt = sealIntent({
    status: value.status,
    plan,
    authorization,
    phases,
    completion,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("intent projection");
  return rebuilt;
}

export function buildExpiredActiveDeviceReviewResponseLossCompletionReceipt(value) {
  const intent = normalizeExpiredActiveDeviceReviewResponseLossIntent(value);
  if (intent.status !== "complete") invalid("completion phase");
  return intent.completion;
}

export function expiredActiveDeviceReviewResponseLossOperationKey(
  planValue,
  authorizationDigest,
  phase,
) {
  const plan = normalizeExpiredActiveDeviceReviewResponseLossPlan(planValue);
  if (!EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PHASES.includes(phase)) {
    invalid("phase");
  }
  return `${EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_OPERATION}:${phase}:${digestValue({
    planDigest: plan.planDigest,
    authorizationDigest: digest(authorizationDigest, "authorization digest"),
    phase,
  })}`;
}

export function buildExpiredActiveDeviceReviewResponseLossReviewedTransitionAdoption(
  planValue,
) {
  const plan = normalizeExpiredActiveDeviceReviewResponseLossPlan(planValue);
  const claim = cloudClaim(plan.evidence);
  const core = {
    schema: "agentic-expired-active-device-review-transition-adoption/v1",
    planDigest: plan.planDigest,
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    transitionDigest: claim.transitionDigest,
    transitionCounter: claim.transitionCounter,
    cloudOperationReceiptDigest: claim.operationReceiptDigest,
    targetCloudAuthorityDigest: plan.evidence.cloud.targetAuthorityDigest,
    disposition: "adopted-response-loss",
    cloudMutation: false,
  };
  return deepFreeze({
    adoptionDigest: digestValue(core),
    claimDigest: core.claimDigest,
    cloudOperationReceiptDigest: core.cloudOperationReceiptDigest,
    disposition: core.disposition,
    transitionCounter: core.transitionCounter,
    transitionDigest: core.transitionDigest,
    cloudMutation: false,
  });
}

export function normalizeExpiredActiveDeviceReviewResponseLossPhaseValues(
  planValue,
  phase,
  values,
) {
  const plan = normalizeExpiredActiveDeviceReviewResponseLossPlan(planValue);
  const source = structuredClone(record(values, `${phase} values`));
  if (phase === "authorized") {
    exactKeys(source, ["authorizationDigest"], phase);
    digest(source.authorizationDigest, "authorization digest");
  } else if (phase === "task-authority-verified") {
    exactKeys(source, ["bindingDigest", "taskAuthorityReceiptDigest"], phase);
    digest(source.bindingDigest, "task-authority binding digest");
    digest(source.taskAuthorityReceiptDigest, "task-authority receipt digest");
    if (source.bindingDigest !== targetBindingDigest(plan.evidence)) {
      invalid("task-authority evidence join");
    }
  } else if (phase === "reviewed-transition-adopted") {
    exactKeys(source, [
      "adoptionDigest",
      "claimDigest",
      "cloudMutation",
      "cloudOperationReceiptDigest",
      "disposition",
      "transitionCounter",
      "transitionDigest",
    ], phase);
    for (const [key, label] of [
      ["adoptionDigest", "reviewed-transition adoption digest"],
      ["claimDigest", "reviewed claim digest"],
      ["cloudOperationReceiptDigest", "reviewed operation receipt digest"],
      ["transitionDigest", "reviewed transition digest"],
    ]) digest(source[key], label);
    positiveInteger(source.transitionCounter, "reviewed transition counter");
    if (source.disposition !== "adopted-response-loss" || source.cloudMutation !== false) {
      invalid("reviewed-transition adoption disposition");
    }
    const claim = cloudClaim(plan.evidence);
    if (source.claimDigest !== claim.fenceRevision
      || source.transitionDigest !== claim.transitionDigest
      || source.cloudOperationReceiptDigest !== claim.operationReceiptDigest
      || source.transitionCounter !== claim.transitionCounter) {
      invalid("reviewed-transition evidence join");
    }
    const expectedAdoption =
      buildExpiredActiveDeviceReviewResponseLossReviewedTransitionAdoption(plan);
    if (canonicalJson(source) !== canonicalJson(expectedAdoption)) {
      invalid("reviewed-transition adoption digest");
    }
  } else if (phase === "local-attempted") {
    exactKeys(source, ["localState", "revalidationDigest"], phase);
    if (!["source", "target"].includes(source.localState)) invalid("local state");
    digest(source.revalidationDigest, "local revalidation digest");
  } else if (phase === "local-projected") {
    const keys = ["disposition", "leaseDigest", "localMutation", "registryRevision"];
    if (Object.hasOwn(source, "localProjected")) keys.push("localProjected");
    exactKeys(source, keys, phase);
    projectionDisposition(source, "localMutation", "localProjected", "local projection");
    if (digest(source.leaseDigest, "target lease digest")
      !== plan.evidence.projections.targetLeaseDigest) invalid("target lease projection");
    positiveInteger(source.registryRevision, "target registry revision");
    if (source.registryRevision !== plan.evidence.projections.targetRegistryRevision) {
      invalid("target registry projection");
    }
  } else if (phase === "ready-attempted") {
    exactKeys(source, ["readyState", "revalidationDigest"], phase);
    if (!["draft", "ready"].includes(source.readyState)) invalid("provider ready state");
    digest(source.revalidationDigest, "provider ready revalidation digest");
  } else if (phase === "provider-ready") {
    const keys = ["disposition", "providerMutation", "providerStateDigest"];
    if (Object.hasOwn(source, "providerReady")) keys.push("providerReady");
    exactKeys(source, keys, phase);
    projectionDisposition(source, "providerMutation", "providerReady", "provider ready");
    if (digest(source.providerStateDigest, "target provider-state digest")
      !== plan.evidence.projections.targetProviderStateDigest) {
      invalid("target provider-ready projection");
    }
  } else if (phase === "marker-attempted") {
    exactKeys(source, ["markerState", "revalidationDigest"], phase);
    if (!["source", "target"].includes(source.markerState)) invalid("provider marker state");
    digest(source.revalidationDigest, "provider marker revalidation digest");
  } else if (phase === "marker-projected") {
    const keys = ["bodyDigest", "disposition", "markerDigest", "providerMutation"];
    if (Object.hasOwn(source, "markerProjected")) keys.push("markerProjected");
    exactKeys(source, keys, phase);
    projectionDisposition(source, "providerMutation", "markerProjected", "provider marker");
    if (digest(source.bodyDigest, "target body digest")
        !== plan.evidence.projections.targetBodyDigest
      || digest(source.markerDigest, "target marker digest")
        !== plan.evidence.projections.targetMarkerDigest) {
      invalid("target provider marker projection");
    }
  } else if (phase === "verified") {
    exactKeys(source, [
      "bodyDigest",
      "leaseDigest",
      "markerDigest",
      "providerStateDigest",
      "registryRevision",
      "verificationDigest",
    ], phase);
    for (const [key, label] of [
      ["bodyDigest", "terminal body digest"],
      ["leaseDigest", "terminal lease digest"],
      ["markerDigest", "terminal marker digest"],
      ["providerStateDigest", "terminal provider-state digest"],
      ["verificationDigest", "terminal verification digest"],
    ]) digest(source[key], label);
    positiveInteger(source.registryRevision, "terminal registry revision");
    if (source.leaseDigest !== plan.evidence.projections.targetLeaseDigest
      || source.bodyDigest !== plan.evidence.projections.targetBodyDigest
      || source.markerDigest !== plan.evidence.projections.targetMarkerDigest
      || source.providerStateDigest !== plan.evidence.projections.targetProviderStateDigest
      || source.registryRevision !== plan.evidence.projections.targetRegistryRevision) {
      invalid("terminal target projection");
    }
  } else if (phase === "complete") {
    exactKeys(source, ["verifiedReceiptDigest"], phase);
    digest(source.verifiedReceiptDigest, "verified phase receipt digest");
  } else {
    invalid("phase values");
  }
  return deepFreeze(source);
}

function buildPhaseReceipt({
  plan,
  authorizationDigest,
  phase,
  previousReceiptDigest,
  values,
}) {
  const normalizedValues = normalizeExpiredActiveDeviceReviewResponseLossPhaseValues(
    plan,
    phase,
    values,
  );
  if (phase === "authorized" && normalizedValues.authorizationDigest !== authorizationDigest) {
    invalid("authorized phase join");
  }
  const core = {
    schema: EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PHASE_RECEIPT_SCHEMA,
    phase,
    planDigest: plan.planDigest,
    authorizationDigest,
    operationKey: expiredActiveDeviceReviewResponseLossOperationKey(
      plan,
      authorizationDigest,
      phase,
    ),
    previousReceiptDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function buildCompletionReceipt({ plan, authorization, phases }) {
  const required = EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PHASES
    .filter(phase => phase !== "authorized");
  if (required.some(phase => !phases[phase])) invalid("completion receipts");
  for (const [attempt, projected, stateKey] of [
    ["local-attempted", "local-projected", "localState"],
    ["ready-attempted", "provider-ready", "readyState"],
    ["marker-attempted", "marker-projected", "markerState"],
  ]) {
    const targetState = attempt === "ready-attempted" ? "ready" : "target";
    if (phases[attempt].values[stateKey] === targetState
      && phases[projected].values.disposition !== "adopted-response-loss") {
      invalid(`${projected} target adoption`);
    }
  }
  const authority = phases["task-authority-verified"].values;
  const cloud = phases["reviewed-transition-adopted"].values;
  const local = phases["local-projected"].values;
  const ready = phases["provider-ready"].values;
  const marker = phases["marker-projected"].values;
  const terminal = phases.verified.values;
  if (phases.complete.values.verifiedReceiptDigest !== phases.verified.receiptDigest) {
    invalid("complete verified-receipt join");
  }
  if (terminal.leaseDigest !== local.leaseDigest
    || terminal.registryRevision !== local.registryRevision
    || terminal.providerStateDigest !== ready.providerStateDigest
    || terminal.bodyDigest !== marker.bodyDigest
    || terminal.markerDigest !== marker.markerDigest) {
    invalid("terminal phase joins");
  }
  const claim = cloudClaim(plan.evidence);
  const core = {
    schema: EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_COMPLETION_SCHEMA,
    status: "review-ready-projection-restored",
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidence.evidenceDigest,
    authorizationDigest: authorization.authorizationDigest,
    taskAuthorityOperation: plan.taskAuthorityOperation,
    taskAuthorityReceiptDigest: authority.taskAuthorityReceiptDigest,
    taskAuthorityBindingDigest: authority.bindingDigest,
    claimId: claim.claimId,
    reviewedTransitionCounter: cloud.transitionCounter,
    reviewedClaimDigest: cloud.claimDigest,
    reviewedTransitionDigest: cloud.transitionDigest,
    reviewedOperationReceiptDigest: cloud.cloudOperationReceiptDigest,
    reviewedTransitionAdoptionDigest: cloud.adoptionDigest,
    localDisposition: local.disposition,
    localMutation: local.localMutation,
    targetLeaseDigest: local.leaseDigest,
    registryRevision: local.registryRevision,
    readyDisposition: ready.disposition,
    pullRequestDraftMutation: ready.providerMutation,
    targetProviderStateDigest: ready.providerStateDigest,
    markerDisposition: marker.disposition,
    pullRequestMarkerMutation: marker.providerMutation,
    targetBodyDigest: marker.bodyDigest,
    targetMarkerDigest: marker.markerDigest,
    terminalVerificationDigest: terminal.verificationDigest,
    terminalVerificationReceiptDigest: phases.verified.receiptDigest,
    mutationPolicy: EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_MUTATION_POLICY,
    privateJournalMutation: true,
    cloudMutation: false,
    claimMutation: false,
    heartbeatMutation: false,
    sourceMutation: false,
    gitMutation: false,
    remoteRefMutation: false,
    mergeMutation: false,
    integrationMutation: false,
    releaseMutation: false,
    deploymentMutation: false,
    cleanupMutation: false,
    phaseReceiptDigests: deepFreeze(Object.fromEntries(
      EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_PHASES
        .map(phase => [phase, phases[phase].receiptDigest]),
    )),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealIntent({ status, plan, authorization, phases, completion }) {
  const core = {
    schema: EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_INTENT_SCHEMA,
    status,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorization,
    authorizationDigest: authorization.authorizationDigest,
    phases,
    completion,
  };
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function normalizeAuthorization(value, plan) {
  const source = record(value, "authorization receipt");
  const expected = authorizeExpiredActiveDeviceReviewResponseLoss(
    plan,
    source.authorization,
  );
  if (canonicalJson(source) !== canonicalJson(expected)) invalid("authorization receipt");
  return expected;
}

function projectionDisposition(value, mutationKey, adoptionKey, label) {
  if (!["projected", "adopted-response-loss"].includes(value.disposition)) {
    invalid(`${label} disposition`);
  }
  if (value[mutationKey] !== (value.disposition === "projected")) {
    invalid(`${label} mutation receipt`);
  }
  if (Object.hasOwn(value, adoptionKey)
    && (value[adoptionKey] !== true || value.disposition !== "adopted-response-loss")) {
    invalid(`${label} response-loss adoption`);
  }
}

function targetBindingDigest(evidence) {
  const value = evidence?.migration?.targetBindingDigest
    ?? evidence?.sourceLease?.taskAuthority?.bindingDigest;
  return digest(value, "planned target task-authority binding digest");
}

function cloudClaim(evidence) {
  const claim = evidence?.cloud?.claim;
  record(claim, "planned reviewed cloud claim");
  return {
    claimId: digest(claim.claimId, "reviewed claim ID"),
    fenceRevision: digest(claim.fenceRevision, "reviewed claim digest"),
    transitionDigest: digest(claim.transitionDigest, "reviewed transition digest"),
    operationReceiptDigest: digest(
      claim.operationReceiptDigest,
      "reviewed operation receipt digest",
    ),
    transitionCounter: positiveInteger(
      claim.transitionCounter,
      "reviewed transition counter",
    ),
  };
}

function exactKeys(value, keys, label) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
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
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function invalid(label) {
  throw new Error(
    `Expired active device-review response-loss contract has invalid ${label}.`,
  );
}
