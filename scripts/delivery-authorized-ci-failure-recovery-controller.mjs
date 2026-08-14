// Responsibility: Orchestrate one fenced, replay-safe CI-failure recovery.
import {
  PHASES,
  advanceDeliveryAuthorizedCiFailureRecoveryIntent,
  authorizeDeliveryAuthorizedCiFailureRecovery,
  buildDeliveryAuthorizedCiFailureRecoveryCompletion,
  buildDeliveryAuthorizedCiFailureRecoveryPlan,
  createDeliveryAuthorizedCiFailureRecoveryIntent,
  deliveryAuthorizedCiFailureRecoveryOperationKey,
  normalizeDeliveryAuthorizedCiFailureRecoveryIntent,
  normalizeDeliveryAuthorizedCiFailureRecoveryPlan,
} from "./delivery-authorized-ci-failure-recovery-contract.mjs";

const EFFECTS = Object.freeze({
  auto_merge_disabled: "disableAutoMerge",
  pull_request_drafted: "draftPullRequest",
  successor_waiting: "createWaitingSuccessor",
  predecessor_retired: "retirePredecessor",
  successor_active: "promoteSuccessor",
  successor_bound: "bindSuccessor",
  projection_candidate: "prepareProjectionCandidate",
  lease_projected: "projectLease",
  markers_projected: "projectMarkers",
  verified: "verifyTerminal",
  complete: "archiveComplete",
});
const METHODS = Object.freeze([
  "withFence", "readEvidence", "readIntent", "writeIntent", "reconcilePhase",
  ...Object.values(EFFECTS),
]);

export function createDeliveryAuthorizedCiFailureRecoveryAdapter(methods = {}) {
  for (const name of METHODS) {
    if (typeof methods[name] !== "function") {
      throw new Error(`CI-failure recovery adapter requires ${name}().`);
    }
  }
  return Object.freeze(Object.fromEntries(METHODS.map(name => [name, methods[name]])));
}

export function createDeliveryAuthorizedCiFailureRecoveryController({ adapter } = {}) {
  const effects = createDeliveryAuthorizedCiFailureRecoveryAdapter(adapter);
  return Object.freeze({
    async plan({ ttlSeconds } = {}) {
      return buildDeliveryAuthorizedCiFailureRecoveryPlan({
        evidence: await effects.readEvidence(), ttlSeconds,
      });
    },
    async run({ authorization, ttlSeconds } = {}) {
      return effects.withFence(async () => {
        let intent = await effects.readIntent();
        if (intent) {
          intent = normalizeDeliveryAuthorizedCiFailureRecoveryIntent(intent);
          const granted = authorizeDeliveryAuthorizedCiFailureRecovery({
            plan: intent.planSnapshot, authorization,
          });
          if (granted.authorizationDigest !== intent.authorizationDigest) {
            throw new Error("Stored CI-failure recovery intent differs from exact authority.");
          }
        } else {
          const plan = buildDeliveryAuthorizedCiFailureRecoveryPlan({
            evidence: await effects.readEvidence(), ttlSeconds,
          });
          intent = createDeliveryAuthorizedCiFailureRecoveryIntent(plan, authorization);
          await effects.writeIntent({ expected: null, value: intent });
        }
        if (intent.status === "prepared") {
          await requireLivePlan(effects, intent.planSnapshot);
        }
        return executeIntent(effects, intent);
      });
    },
  });
}

async function requireLivePlan(adapter, storedPlan) {
  const plan = normalizeDeliveryAuthorizedCiFailureRecoveryPlan(storedPlan);
  const live = buildDeliveryAuthorizedCiFailureRecoveryPlan({
    evidence: await adapter.readEvidence(), ttlSeconds: plan.ttlSeconds,
  });
  if (live.planDigest !== plan.planDigest) {
    throw new Error("Prepared CI-failure recovery no longer matches live evidence.");
  }
}

async function executeIntent(adapter, initial) {
  let intent = initial;
  const plan = normalizeDeliveryAuthorizedCiFailureRecoveryPlan(intent.planSnapshot);
  for (const phase of PHASES.slice(PHASES.indexOf(intent.status) + 1)) {
    if (phase === "complete") break;
    const input = phaseInput(intent, plan, phase);
    const result = await resolvePhase(adapter, EFFECTS[phase], input);
    const next = advanceDeliveryAuthorizedCiFailureRecoveryIntent(intent, {
      status: phase, values: result.values,
    });
    await adapter.writeIntent({ expected: intent, value: next });
    intent = next;
  }
  if (intent.status !== "complete") {
    const verified = intent.phases.verified?.values;
    if (!verified) throw new Error("CI-failure recovery completion lacks terminal verification.");
    const completion = buildDeliveryAuthorizedCiFailureRecoveryCompletion(plan, verified);
    const next = advanceDeliveryAuthorizedCiFailureRecoveryIntent(intent, {
      status: "complete", values: { completion },
    });
    await adapter.writeIntent({ expected: intent, value: next });
    intent = next;
  }
  const archived = await resolvePhase(adapter, EFFECTS.complete,
    phaseInput(intent, plan, "complete"));
  if (archived.kind !== "complete") {
    throw new Error("CI-failure recovery archive did not complete.");
  }
  return intent.completion;
}

function phaseInput(intent, plan, phase) {
  const prior = phase === "complete" ? intent.phases.verified
    : intent.phases[intent.status];
  if (!prior?.receiptDigest) throw new Error(`CI-failure recovery ${phase} lacks prior receipt.`);
  return Object.freeze({
    intent, phase, plan,
    operationKey: deliveryAuthorizedCiFailureRecoveryOperationKey(
      plan, phase, prior.receiptDigest,
    ),
  });
}

async function resolvePhase(adapter, method, input) {
  let result = normalizeResolution(await adapter.reconcilePhase(input));
  if (result.kind === "complete") return result;
  let original;
  try {
    normalizeResolution(await adapter[method](input));
  } catch (error) {
    original = error;
  }
  try {
    result = normalizeResolution(await adapter.reconcilePhase(input));
  } catch (error) {
    throw original || error;
  }
  if (result.kind === "complete") return result;
  if (original) throw original;
  throw new Error(`CI-failure recovery ${input.phase} effect did not complete.`);
}

export function complete(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("CI-failure recovery operation result is malformed.");
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
    throw new Error("CI-failure recovery reconciliation result is malformed.");
  }
  return complete(value.values);
}
