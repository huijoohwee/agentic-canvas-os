// Responsibility: Execute one fenced, journaled active-owned-dirt current-base reanchor.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  PHASES,
  advanceReanchorIntent,
  authorizeReanchor,
  buildReanchorCompletion,
  buildReanchorPlan,
  createReanchorIntent,
  normalizeReanchorIntent,
  normalizeReanchorPlan,
  operationKey,
} from "./active-owned-dirt-current-base-reanchor-contract.mjs";

const EFFECTS = Object.freeze({
  "source-authorized": "authorizeSource",
  snapshotted: "snapshot",
  "reanchor-prepared": "prepareReanchor",
  "successor-waiting": "claimWaitingSuccessor",
  "source-retired": "retireSource",
  "successor-current": "promoteSuccessor",
  "local-reanchored": "reanchorLocal",
  "remote-reanchored": "reanchorRemote",
  "successor-bound": "bindSuccessor",
  "local-cas": "projectLocal",
  "pr-projected": "projectPullRequest",
  verified: "verifyTerminal",
});

const REQUIRED_METHODS = Object.freeze([
  "withFence",
  "captureEvidence",
  "readIntent",
  "writeIntent",
  "reconcile",
  ...Object.values(EFFECTS),
]);

export function createActiveOwnedDirtCurrentBaseReanchorController(adapter) {
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Reanchor adapter requires ${method}().`);
    }
  }
  return Object.freeze({
    async plan({ ttlSeconds = 1_800 } = {}) {
      const stored = await adapter.readIntent();
      if (stored) return normalizeReanchorIntent(stored).planSnapshot;
      const first = await adapter.captureEvidence();
      const second = await adapter.captureEvidence();
      if (digestValue(first) !== digestValue(second)) {
        throw new Error("Reanchor evidence changed during the read-only planning window.");
      }
      return buildReanchorPlan({ evidence: first, ttlSeconds });
    },

    async run({ plan: supplied, authorization } = {}) {
      const plan = normalizeReanchorPlan(supplied);
      authorizeReanchor({ plan, authorization });
      return adapter.withFence(async () => {
        let intent = await adapter.readIntent();
        if (intent) {
          intent = normalizeReanchorIntent(intent);
          if (intent.planDigest !== plan.planDigest) {
            throw new Error("Stored reanchor intent differs from the supplied plan.");
          }
        } else {
          const first = await adapter.captureEvidence();
          const second = await adapter.captureEvidence();
          if (first.evidenceDigest !== plan.evidenceDigest
            || second.evidenceDigest !== plan.evidenceDigest
            || digestValue(first) !== digestValue(second)) {
            throw new Error("Authorized reanchor evidence is no longer exact-current.");
          }
          intent = createReanchorIntent(plan, authorization);
          await adapter.writeIntent({ expected: null, value: intent, plan });
        }
        return execute(adapter, intent);
      });
    },
  });
}

async function execute(adapter, initial) {
  let intent = normalizeReanchorIntent(initial);
  if (intent.phase === "complete") return intent.completion;
  for (const phase of PHASES.slice(PHASES.indexOf(intent.phase) + 1)) {
    if (phase === "complete") {
      const completion = buildReanchorCompletion(intent);
      const next = advanceReanchorIntent(intent, { phase, values: completion });
      await adapter.writeIntent({ expected: intent, value: next, plan: intent.planSnapshot });
      return next.completion;
    }
    const input = Object.freeze({
      intent,
      plan: intent.planSnapshot,
      phase,
      operationKey: operationKey(intent.planSnapshot, phase),
    });
    let values = await adapter.reconcile(input);
    if (!values) {
      try {
        values = await adapter[EFFECTS[phase]](input);
      } catch (error) {
        values = await adapter.reconcile(input);
        if (!values) throw error;
      }
    }
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error(`Reanchor phase ${phase} returned no receipt values.`);
    }
    const next = advanceReanchorIntent(intent, { phase, values });
    await adapter.writeIntent({ expected: intent, value: next, plan: intent.planSnapshot });
    intent = next;
  }
  return intent.completion;
}
