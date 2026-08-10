// Responsibility: Orchestrate one replay-safe reviewed forward-child recovery.
import {
  PHASES,
  advanceReviewedForwardChildIntent,
  authorizeReviewedForwardChild,
  buildCompletionReceipt,
  buildReviewedForwardChildPlan,
  createReviewedForwardChildIntent,
  normalizeReviewedForwardChildIntent,
  normalizeReviewedForwardChildPlan,
  operationKey,
} from "./reviewed-forward-child-recovery-contract.mjs";

const EFFECTS = Object.freeze({
  auto_merge_cancelled: "cancelAutoMerge",
  forward_child_created: "createForwardChild",
  successor_waiting: "createWaitingSuccessor",
  source_retired: "retireSourceClaim",
  successor_current: "promoteSuccessor",
  local_ref_updated: "updateLocalRef",
  remote_ref_updated: "updateRemoteRef",
  lease_activated: "activateLease",
  pr_drafted: "projectDraftPullRequest",
  verified: "verifyTerminal",
});

const METHODS = Object.freeze([
  "withFence", "readSource", "prepareCandidate", "readIntent", "writeIntent",
  "reconcilePhase", ...Object.values(EFFECTS),
]);

export function createReviewedForwardChildAdapter(methods = {}) {
  for (const method of METHODS) {
    if (typeof methods[method] !== "function") {
      throw new Error(`Forward-child adapter requires ${method}().`);
    }
  }
  return Object.freeze(Object.fromEntries(METHODS.map(name => [name, methods[name]])));
}

export function createReviewedForwardChildController({ adapter } = {}) {
  const effects = createReviewedForwardChildAdapter(adapter);
  return Object.freeze({
    async plan({ operatorSessionId } = {}) {
      const source = await effects.readSource();
      return buildReviewedForwardChildPlan({
        source,
        candidate: await effects.prepareCandidate({ source, operatorSessionId, planOnly: true }),
        operatorSessionId,
      });
    },

    async run({ operatorSessionId, authorization } = {}) {
      return effects.withFence(async () => {
        let intent = await effects.readIntent();
        if (intent) {
          intent = normalizeReviewedForwardChildIntent(intent);
          authorizeReviewedForwardChild({ plan: intent.planSnapshot, authorization });
          if (intent.planSnapshot.operatorSessionId !== operatorSessionId
            || intent.authorization.statement !== authorization) {
            throw new Error("Stored forward-child intent differs from current exact authority.");
          }
        } else {
          const source = await effects.readSource();
          const candidate = await effects.prepareCandidate({
            source,
            operatorSessionId,
            planOnly: false,
          });
          const plan = buildReviewedForwardChildPlan({ source, candidate, operatorSessionId });
          authorizeReviewedForwardChild({ plan, authorization });
          intent = createReviewedForwardChildIntent(plan, authorization);
          await effects.writeIntent({ expected: null, value: intent });
        }
        return executeIntent({ adapter: effects, intent });
      });
    },
  });
}

async function executeIntent({ adapter, intent: initial }) {
  let intent = initial;
  const plan = normalizeReviewedForwardChildPlan(intent.planSnapshot);
  if (intent.status === "complete") return intent.completion;
  for (const phase of PHASES.slice(PHASES.indexOf(intent.status) + 1)) {
    let result;
    if (phase === "complete") {
      const verified = intent.phases.verified?.values;
      if (!verified) throw new Error("Forward-child completion lacks terminal verification.");
      result = complete({ receipt: buildCompletionReceipt(plan, verified) });
    } else {
      const input = { intent, operationKey: operationKey(plan, phase), phase, plan };
      const reconciled = normalizeResolution(await adapter.reconcilePhase(input));
      if (reconciled.kind === "complete") {
        result = reconciled;
      } else {
        let effectError = null;
        try {
          result = normalizeResolution(await adapter[EFFECTS[phase]](input));
        } catch (error) {
          effectError = error;
          result = normalizeResolution(await adapter.reconcilePhase(input));
        }
        if (result.kind !== "complete") {
          if (effectError) throw effectError;
          throw new Error(`Forward-child ${phase} effect did not complete.`);
        }
      }
    }
    const next = advanceReviewedForwardChildIntent(intent, {
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
    throw new Error("Forward-child operation result is malformed.");
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
    throw new Error("Forward-child reconciliation result is malformed.");
  }
  return complete(value.values);
}
