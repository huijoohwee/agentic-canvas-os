// Responsibility: Orchestrate one replay-safe reviewed-to-authoring correction.
import {
  PHASES,
  advanceReviewedLaneSourceCorrectionIntent,
  authorizeReviewedLaneSourceCorrection,
  buildCompletionReceipt,
  buildReviewedLaneSourceCorrectionPlan,
  createReviewedLaneSourceCorrectionIntent,
  normalizeReviewedLaneSourceCorrectionIntent,
  normalizeReviewedLaneSourceCorrectionPlan,
  operationKey,
} from "./reviewed-lane-source-correction-contract.mjs";

const EFFECTS = Object.freeze({
  successor_waiting: "createWaitingSuccessor",
  source_retired: "retireSourceClaim",
  successor_current: "promoteSuccessor",
  lease_activated: "activateLease",
  pr_drafted: "projectDraftPullRequest",
  verified: "verifyTerminal",
});

const METHODS = Object.freeze([
  "withFence", "readSource", "readIntent", "writeIntent", "reconcilePhase",
  ...Object.values(EFFECTS),
]);

export function createReviewedLaneSourceCorrectionAdapter(methods = {}) {
  for (const method of METHODS) {
    if (typeof methods[method] !== "function") {
      throw new Error(`Source correction adapter requires ${method}().`);
    }
  }
  return Object.freeze(Object.fromEntries(METHODS.map(name => [name, methods[name]])));
}

export function createReviewedLaneSourceCorrectionController({ adapter } = {}) {
  const effects = createReviewedLaneSourceCorrectionAdapter(adapter);
  return Object.freeze({
    async plan({ operatorSessionId } = {}) {
      return buildReviewedLaneSourceCorrectionPlan({
        source: await readStableSource(effects),
        operatorSessionId,
      });
    },

    async run({ operatorSessionId, authorization } = {}) {
      return effects.withFence(async () => {
        let intent = await effects.readIntent();
        if (intent) {
          intent = normalizeReviewedLaneSourceCorrectionIntent(intent);
          authorizeReviewedLaneSourceCorrection({
            plan: intent.planSnapshot,
            authorization,
          });
          if (intent.planSnapshot.operatorSessionId !== operatorSessionId
            || intent.authorization.statement !== authorization) {
            throw new Error("Stored source correction intent differs from current exact authority.");
          }
        } else {
          const currentPlan = buildReviewedLaneSourceCorrectionPlan({
            source: await readStableSource(effects),
            operatorSessionId,
          });
          authorizeReviewedLaneSourceCorrection({ plan: currentPlan, authorization });
          intent = createReviewedLaneSourceCorrectionIntent(currentPlan, authorization);
          await effects.writeIntent({ expected: null, value: intent });
        }
        return executeIntent({ adapter: effects, intent });
      });
    },
  });
}

async function readStableSource(adapter) {
  const first = await adapter.readSource();
  const second = await adapter.readSource();
  if (first?.evidenceDigest !== second?.evidenceDigest) {
    throw new Error("Reviewed-lane source correction evidence changed during read-only planning.");
  }
  return second;
}

async function executeIntent({ adapter, intent: initial }) {
  let intent = initial;
  const plan = normalizeReviewedLaneSourceCorrectionPlan(intent.planSnapshot);
  if (intent.status === "complete") return intent.completion;
  for (const phase of PHASES.slice(PHASES.indexOf(intent.status) + 1)) {
    const key = operationKey(plan, phase);
    let result;
    if (phase === "complete") {
      const verified = intent.phases.verified?.values;
      if (!verified) throw new Error("Source correction completion lacks terminal verification.");
      result = complete({ receipt: buildCompletionReceipt(plan, verified) });
    } else {
      const reconciliation = normalizeResolution(await adapter.reconcilePhase({
        intent,
        operationKey: key,
        phase,
        plan,
      }));
      if (reconciliation.kind === "complete") {
        result = reconciliation;
      } else {
        result = normalizeResolution(await adapter[EFFECTS[phase]]({
          intent,
          operationKey: key,
          plan,
        }));
        if (result.kind !== "complete") {
          throw new Error(`Source correction ${phase} effect did not complete.`);
        }
      }
    }
    const next = advanceReviewedLaneSourceCorrectionIntent(intent, {
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
    throw new Error("Source correction operation result is malformed.");
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
    throw new Error("Source correction reconciliation result is malformed.");
  }
  return complete(value.values);
}
