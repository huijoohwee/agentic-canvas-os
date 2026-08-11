import { buildDeliveryAuthorizedBaseRecoveryPlan } from "./delivery-authorized-base-recovery-contract.mjs";
import {
  DELIVERY_BASE_RECOVERY_PHASES,
  advanceDeliveryAuthorizedBaseRecoveryIntent,
  createDeliveryAuthorizedBaseRecoveryIntent,
  deliveryAuthorizedBaseRecoveryOperationKey,
  normalizeDeliveryAuthorizedBaseRecoveryIntent,
} from "./delivery-authorized-base-recovery-intent.mjs";

const EFFECTS = Object.freeze({
  pull_request_drafted: "demotePullRequest",
  successor_waiting: "createWaitingSuccessor",
  predecessor_retired: "retirePredecessor",
  successor_active: "promoteSuccessor",
  lease_projected: "projectLease",
  marker_projected: "projectMarker",
  verified: "verifyTerminal",
});
const METHODS = Object.freeze([
  "withFence",
  "readEvidence",
  "readIntent",
  "writeIntent",
  "reconcilePhase",
  ...Object.values(EFFECTS),
]);

export function createDeliveryAuthorizedBaseRecoveryAdapter(methods = {}) {
  for (const method of METHODS) {
    if (typeof methods[method] !== "function") {
      throw new Error(`Delivery-base recovery adapter requires ${method}().`);
    }
  }
  return Object.freeze(Object.fromEntries(METHODS.map(name => [name, methods[name]])));
}

export function createDeliveryAuthorizedBaseRecoveryController({ adapter } = {}) {
  const effects = createDeliveryAuthorizedBaseRecoveryAdapter(adapter);
  return Object.freeze({
    async plan() {
      return buildDeliveryAuthorizedBaseRecoveryPlan(await effects.readEvidence());
    },
    async run({ authorization } = {}) {
      return effects.withFence(async () => {
        let intent = await effects.readIntent();
        if (intent) {
          intent = normalizeDeliveryAuthorizedBaseRecoveryIntent(intent);
          if (intent.authorization.statement !== authorization) {
            throw new Error("Stored delivery-base intent differs from current exact authority.");
          }
          if (intent.status === "prepared") {
            const current = buildDeliveryAuthorizedBaseRecoveryPlan(
              await effects.readEvidence(),
            );
            if (current.planDigest !== intent.planDigest) {
              throw new Error("Prepared delivery-base intent no longer matches live evidence.");
            }
          }
        } else {
          const plan = buildDeliveryAuthorizedBaseRecoveryPlan(await effects.readEvidence());
          intent = createDeliveryAuthorizedBaseRecoveryIntent(plan, authorization);
          await effects.writeIntent({ expected: null, value: intent });
        }
        return executeIntent({ adapter: effects, intent });
      });
    },
  });
}

async function executeIntent({ adapter, intent: initial }) {
  let intent = initial;
  if (intent.status === "complete") return intent.completion;
  const phases = DELIVERY_BASE_RECOVERY_PHASES.slice(
    DELIVERY_BASE_RECOVERY_PHASES.indexOf(intent.status) + 1,
  );
  for (const phase of phases) {
    let result;
    if (phase === "complete") {
      const verified = intent.phases.verified?.values;
      if (!verified) throw new Error("Delivery-base completion lacks terminal verification.");
      result = complete({ receipt: verified.receipt });
    } else {
      const input = {
        intent,
        phase,
        plan: intent.planSnapshot,
        operationKey: deliveryAuthorizedBaseRecoveryOperationKey(intent.planSnapshot, phase),
      };
      result = normalizeResolution(await adapter.reconcilePhase(input));
      if (result.kind !== "complete") {
        let effectError = null;
        try {
          result = normalizeResolution(await adapter[EFFECTS[phase]](input));
        } catch (error) {
          effectError = error;
          result = normalizeResolution(await adapter.reconcilePhase(input));
        }
        if (result.kind !== "complete") {
          if (effectError) throw effectError;
          throw new Error(`Delivery-base recovery ${phase} effect did not complete.`);
        }
      }
    }
    const next = advanceDeliveryAuthorizedBaseRecoveryIntent(intent, {
      status: phase,
      values: result.values,
    });
    await adapter.writeIntent({ expected: intent, value: next });
    intent = next;
  }
  return intent.completion;
}

export function complete(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("Delivery-base operation result is malformed.");
  }
  return Object.freeze({ kind: "complete", values: Object.freeze({ ...values }) });
}

export function pending() {
  return Object.freeze({ kind: "pending" });
}

function normalizeResolution(value) {
  if (value?.kind === "pending") return pending();
  if (value?.kind !== "complete" || !value.values || typeof value.values !== "object"
    || Array.isArray(value.values)) {
    throw new Error("Delivery-base reconciliation result is malformed.");
  }
  return complete(value.values);
}
