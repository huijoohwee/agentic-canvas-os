import {
  authorizeRepeatedRecovery,
  buildRepeatedRecoveryPlan,
  normalizeRepeatedRecoveryPlan,
} from "./repeated-expired-committed-heartbeat-recovery-contract.mjs";

export function createRepeatedRecoveryController({ adapter } = {}) {
  if (!adapter || typeof adapter.inspect !== "function"
    || typeof adapter.readTargetManifest !== "function") {
    throw new Error("Repeated recovery requires a repository adapter.");
  }
  return Object.freeze({
    async plan() {
      const replay = await optional(adapter.readActiveIntent);
      if (replay) return planResult(replay.planSnapshot);
      return planResult(buildRepeatedRecoveryPlan({
        evidence: await adapter.inspect(),
        targetManifest: await adapter.readTargetManifest(),
      }));
    },
    async run({ authorization } = {}) {
      const replay = await optional(adapter.readIntentForAuthorization, authorization);
      const active = replay || await optional(adapter.readActiveIntent);
      const plan = active?.planSnapshot
        ? normalizeRepeatedRecoveryPlan(active.planSnapshot)
        : buildRepeatedRecoveryPlan({
          evidence: await adapter.inspect(),
          targetManifest: await adapter.readTargetManifest(),
        });
      authorizeRepeatedRecovery({ plan, authorization });
      return adapter.execute({ plan, authorization, intent: active || null });
    },
  });
}

function planResult(plan) {
  const normalized = normalizeRepeatedRecoveryPlan(plan);
  return Object.freeze({
    schema: "agentic-repeated-expired-committed-heartbeat-recovery-plan-result/v1",
    status: "planned",
    plan: normalized,
    exactAuthorization: normalized.exactAuthorization,
  });
}

async function optional(method, ...argumentsList) {
  return typeof method === "function" ? method(...argumentsList) : null;
}
