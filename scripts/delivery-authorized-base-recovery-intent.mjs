import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  assertDeliveryAuthorizedBaseRecoveryAuthorization,
  buildDeliveryAuthorizedBaseRecoveryReceipt,
  normalizeDeliveryAuthorizedBaseRecoveryPlan,
} from "./delivery-authorized-base-recovery-contract.mjs";

export const DELIVERY_BASE_RECOVERY_INTENT_SCHEMA =
  "agentic-delivery-authorized-base-recovery-intent/v1";
export const DELIVERY_BASE_RECOVERY_PHASES = Object.freeze([
  "prepared",
  "pull_request_drafted",
  "successor_waiting",
  "predecessor_retired",
  "successor_active",
  "lease_projected",
  "marker_projected",
  "verified",
  "complete",
]);

export function createDeliveryAuthorizedBaseRecoveryIntent(plan, authorization) {
  const normalized = assertDeliveryAuthorizedBaseRecoveryAuthorization(plan, authorization);
  const authority = authorizationReceipt(normalized, authorization);
  return seal({
    status: "prepared",
    plan: normalized,
    authorization: authority,
    phases: {
      prepared: phaseReceipt(normalized, "prepared", null, {
        authorizationDigest: authority.authorizationDigest,
      }),
    },
    completion: null,
  });
}

export function advanceDeliveryAuthorizedBaseRecoveryIntent(intent, {
  status,
  values = {},
} = {}) {
  const current = normalizeDeliveryAuthorizedBaseRecoveryIntent(intent);
  const next = phase(status);
  const currentIndex = DELIVERY_BASE_RECOVERY_PHASES.indexOf(current.status);
  const nextIndex = DELIVERY_BASE_RECOVERY_PHASES.indexOf(next);
  if (nextIndex < currentIndex || nextIndex > currentIndex + 1) {
    throw new Error("Delivery-base recovery intent cannot skip or regress a protected phase.");
  }
  const normalizedValues = plain(values, "phase values");
  if (nextIndex === currentIndex) {
    if (current.phases[next].valuesDigest !== digestValue(normalizedValues)) {
      invalid("phase replay");
    }
    return current;
  }
  const phases = {
    ...current.phases,
    [next]: phaseReceipt(current.planSnapshot, next, current.intentDigest, normalizedValues),
  };
  const completion = next === "complete"
    ? completionReceipt(current.planSnapshot, normalizedValues.receipt)
    : null;
  return seal({
    status: next,
    plan: current.planSnapshot,
    authorization: current.authorization,
    phases,
    completion,
  });
}

export function normalizeDeliveryAuthorizedBaseRecoveryIntent(value) {
  if (value?.schema !== DELIVERY_BASE_RECOVERY_INTENT_SCHEMA) invalid("intent schema");
  const status = phase(value.status);
  const plan = normalizeDeliveryAuthorizedBaseRecoveryPlan(value.planSnapshot);
  const authorization = authorizationReceipt(plan, value.authorization?.statement);
  const expectedNames = DELIVERY_BASE_RECOVERY_PHASES.slice(
    0,
    DELIVERY_BASE_RECOVERY_PHASES.indexOf(status) + 1,
  );
  exact(value.phases, expectedNames, "intent phases");
  let prior = null;
  const phases = {};
  for (const name of expectedNames) {
    const receipt = phaseReceipt(plan, name, prior, value.phases[name]?.values);
    if (JSON.stringify(receipt) !== JSON.stringify(value.phases[name])) {
      invalid(`${name} receipt`);
    }
    phases[name] = receipt;
    prior = digestValue(intentCore({
      status: name,
      plan,
      authorization,
      phases: { ...phases },
      completion: name === "complete" ? value.completion : null,
    }));
  }
  const completion = status === "complete"
    ? completionReceipt(plan, value.completion)
    : value.completion === null ? null : invalid("non-terminal completion");
  const core = intentCore({ status, plan, authorization, phases, completion });
  exact(value, [...Object.keys(core), "intentDigest"], "intent");
  if (value.intentDigest !== digestValue(core)) invalid("intent digest");
  return freeze({ ...core, intentDigest: value.intentDigest });
}

export function deliveryAuthorizedBaseRecoveryOperationKey(plan, phaseName) {
  const normalized = normalizeDeliveryAuthorizedBaseRecoveryPlan(plan);
  const name = phase(phaseName);
  return `delivery-authorized-base-recovery:${name}:${digestValue({
    planDigest: normalized.planDigest,
    phase: name,
  })}`;
}

function authorizationReceipt(plan, authorization) {
  const normalized = assertDeliveryAuthorizedBaseRecoveryAuthorization(plan, authorization);
  const core = {
    schema: "agentic-delivery-authorized-base-recovery-authorization/v1",
    planDigest: normalized.planDigest,
    statement: authorization,
  };
  return freeze({ ...core, authorizationDigest: digestValue(core) });
}

function phaseReceipt(plan, name, priorIntentDigest, values) {
  const normalizedValues = plain(values, "phase values");
  const core = {
    schema: "agentic-delivery-authorized-base-recovery-phase-receipt/v1",
    phase: phase(name),
    planDigest: plan.planDigest,
    operationKey: deliveryAuthorizedBaseRecoveryOperationKey(plan, name),
    intentDigest: priorIntentDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

function completionReceipt(plan, value) {
  const values = plain(value, "completion receipt");
  const normalized = buildDeliveryAuthorizedBaseRecoveryReceipt({
    plan,
    outcome: values.outcome,
    successorAuthority: {
      claimId: values.successorClaimId,
      claimDigest: values.successorClaimDigest,
      leaseEpoch: values.successorLeaseEpoch,
      transitionCounter: values.successorTransitionCounter,
    },
    finalLeaseDigest: values.finalLeaseDigest,
    finalMarkerDigest: values.finalMarkerDigest,
    effects: values.effects,
  });
  if (value?.receiptDigest && JSON.stringify(value) !== JSON.stringify(normalized)) {
    invalid("completion receipt");
  }
  return normalized;
}

function seal({ status, plan, authorization, phases, completion }) {
  const core = intentCore({ status, plan, authorization, phases, completion });
  return freeze({ ...core, intentDigest: digestValue(core) });
}

function intentCore({ status, plan, authorization, phases, completion }) {
  return {
    schema: DELIVERY_BASE_RECOVERY_INTENT_SCHEMA,
    status,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorization,
    authorizationDigest: authorization.authorizationDigest,
    phases,
    completion,
  };
}

function phase(value) {
  if (!DELIVERY_BASE_RECOVERY_PHASES.includes(value)) invalid("phase");
  return value;
}
function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return JSON.parse(JSON.stringify(value));
}
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    invalid(label);
  }
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function invalid(label) {
  throw new Error(`Invalid delivery-authorized base recovery ${label}.`);
}
