// Responsibility: Orchestrate one task-authorized, registry-only cloud-fence projection.
import {
  advancePlannedStartFenceProjectionRecoveryIntent,
  buildPlannedStartFenceProjectionRecoveryCompletionReceipt,
  buildPlannedStartFenceProjectionRecoveryPlan,
  createPlannedStartFenceProjectionRecoveryIntent,
  normalizePlannedStartFenceProjectionRecoveryIntent,
  normalizePlannedStartFenceProjectionRecoveryPlan,
} from "./planned-start-fence-projection-recovery-contract.mjs";

const REQUIRED_METHODS = Object.freeze([
  "readPlanEvidence", "withOperationLock", "readIntent", "writeIntent",
  "authorizeTask", "revalidate", "projectLocal", "verifyTerminal",
]);

export function createPlannedStartFenceProjectionRecoveryController(adapter) {
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Planned-start fence projection adapter requires ${method}().`);
    }
  }
  return Object.freeze({
    async plan() {
      return buildPlannedStartFenceProjectionRecoveryPlan({
        evidence: await adapter.readPlanEvidence(),
      });
    },
    async run({ plan } = {}) {
      const sealed = normalizePlannedStartFenceProjectionRecoveryPlan(plan);
      return adapter.withOperationLock(() => runLocked(adapter, sealed));
    },
  });
}

async function runLocked(adapter, plan) {
  let intent = await adapter.readIntent(plan);
  if (intent) {
    intent = normalizePlannedStartFenceProjectionRecoveryIntent(intent);
    if (intent.planDigest !== plan.planDigest) {
      throw new Error("Stored fence-projection intent belongs to another plan.");
    }
  } else {
    intent = createPlannedStartFenceProjectionRecoveryIntent(plan);
    await adapter.writeIntent({ expected: null, value: intent, plan });
  }
  if (intent.status === "complete") {
    await adapter.verifyTerminal(plan, { intent, replay: true });
    return buildPlannedStartFenceProjectionRecoveryCompletionReceipt(intent);
  }
  if (intent.status === "prepared") {
    await adapter.revalidate(plan, "before-authority");
    intent = await persist(adapter, plan, intent, "authority-verified",
      await adapter.authorizeTask(plan));
  }
  if (intent.status === "authority-verified") {
    intent = await persist(adapter, plan, intent, "local-attempted",
      await adapter.revalidate(plan, "before-local"));
  }
  if (intent.status === "local-attempted") {
    let values;
    try {
      values = await adapter.projectLocal(plan, { intent });
    } catch (error) {
      const adopted = await adapter.revalidate(plan, "after-local-error");
      if (adopted?.localProjected !== true) throw error;
      values = adopted.values;
    }
    intent = await persist(adapter, plan, intent, "local-projected", values);
  }
  if (intent.status === "local-projected") {
    intent = await persist(adapter, plan, intent, "verified",
      await adapter.verifyTerminal(plan, { intent, replay: false }));
  }
  if (intent.status === "verified") {
    const current = await adapter.verifyTerminal(plan, { intent, replay: true });
    const stored = intent.phases.verified.values;
    if (current.verificationDigest !== stored.verificationDigest
      || current.targetLeaseDigest !== stored.targetLeaseDigest
      || current.recoveryReceiptDigest !== stored.recoveryReceiptDigest
      || current.registryRevision !== stored.registryRevision) {
      throw new Error("Fence-projection terminal evidence drifted before completion.");
    }
    intent = await persist(adapter, plan, intent, "complete", {});
  }
  if (intent.status !== "complete") {
    throw new Error("Planned-start fence projection did not complete.");
  }
  return buildPlannedStartFenceProjectionRecoveryCompletionReceipt(intent);
}

async function persist(adapter, plan, current, status, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error(`Planned-start fence projection ${status} produced no receipt values.`);
  }
  const next = advancePlannedStartFenceProjectionRecoveryIntent(current, { status, values });
  await adapter.writeIntent({ expected: current, value: next, plan });
  return next;
}
