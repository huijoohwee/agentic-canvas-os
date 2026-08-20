// Responsibility: Orchestrate one exact-authorized, replay-safe device projection repair.
import {
  authorizePlannedDeviceProjectionRecovery,
  buildPlannedDeviceProjectionRecoveryPlan,
  buildPlannedDeviceProjectionRecoveryReceipt,
  normalizePlannedDeviceProjectionRecoveryPlan,
} from "./planned-device-projection-recovery-contract.mjs";

const METHODS = Object.freeze([
  "readPlanEvidence",
  "authorizeTask",
  "recoverCloud",
  "projectLease",
  "projectReview",
  "verifyTerminal",
]);

export function createPlannedDeviceProjectionRecoveryController({ adapter } = {}) {
  for (const method of METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Planned device-projection recovery adapter requires ${method}().`);
    }
  }
  return Object.freeze({
    async plan({ ttlSeconds } = {}) {
      return buildPlannedDeviceProjectionRecoveryPlan({
        evidence: await adapter.readPlanEvidence(),
        ttlSeconds,
      });
    },
    async run({ plan, authorization } = {}) {
      const sealed = normalizePlannedDeviceProjectionRecoveryPlan(plan);
      authorizePlannedDeviceProjectionRecovery(sealed, authorization);
      const taskAuthorityReceiptDigest = await adapter.authorizeTask(sealed);
      const recovery = await adapter.recoverCloud(sealed);
      const lease = await adapter.projectLease(sealed, recovery);
      const review = await adapter.projectReview(sealed, lease.lease);
      const terminal = await adapter.verifyTerminal(
        sealed,
        recovery,
        taskAuthorityReceiptDigest,
        [lease.disposition, review.disposition],
      );
      return buildPlannedDeviceProjectionRecoveryReceipt({ plan: sealed, ...terminal });
    },
  });
}
