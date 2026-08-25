// Responsibility: Orchestrate read-twice planning and exact-authorized recovery.
import { canonicalJson } from "./cloud-collaboration-primitives.mjs";
import {
  buildAdmittedPublishedDescendantDirtyRecoveryCompletion,
  buildAdmittedPublishedDescendantDirtyRecoveryPlan,
  normalizeAdmittedPublishedDescendantDirtyRecoveryPlan,
} from "./admitted-published-descendant-dirty-recovery-contract.mjs";

export function createAdmittedPublishedDescendantDirtyRecoveryController({ adapter }) {
  for (const method of ["capture", "authorize", "recover"]) {
    if (typeof adapter?.[method] !== "function") throw new Error(`Recovery adapter requires ${method}().`);
  }
  return Object.freeze({
    async plan({ ttlSeconds }) {
      const first = await adapter.capture();
      const second = await adapter.capture();
      if (canonicalJson(first) !== canonicalJson(second)) throw new Error("Recovery evidence drifted between reads.");
      return buildAdmittedPublishedDescendantDirtyRecoveryPlan(first, ttlSeconds);
    },
    async run({ plan, authorization }) {
      const normalized = normalizeAdmittedPublishedDescendantDirtyRecoveryPlan(plan);
      if (authorization !== normalized.exactAuthorization) throw new Error("Recovery authorization is not exact.");
      const current = await adapter.capture();
      if (canonicalJson(current) !== canonicalJson(normalized.evidence)) throw new Error("Recovery evidence drifted before execution.");
      const authority = await adapter.authorize(normalized);
      const result = await adapter.recover(normalized, authority);
      return buildAdmittedPublishedDescendantDirtyRecoveryCompletion({ plan: normalized, result });
    },
  });
}
