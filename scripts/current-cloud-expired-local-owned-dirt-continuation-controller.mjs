// Responsibility: Orchestrate one task-authorized local lease continuation through injected ports.
import {
  advanceCurrentCloudExpiredLocalOwnedDirtContinuationIntent,
  buildCurrentCloudExpiredLocalOwnedDirtContinuationCompletionReceipt,
  buildCurrentCloudExpiredLocalOwnedDirtContinuationPlan,
  createCurrentCloudExpiredLocalOwnedDirtContinuationIntent,
  normalizeCurrentCloudExpiredLocalOwnedDirtContinuationIntent,
  normalizeCurrentCloudExpiredLocalOwnedDirtContinuationPlan,
} from "./current-cloud-expired-local-owned-dirt-continuation-contract.mjs";

const REQUIRED_METHODS = Object.freeze([
  "readPlanEvidence", "withOperationLock", "readIntent", "writeIntent",
  "authorizeTask", "revalidateCloud", "projectLocal", "verifyTerminal",
]);

export function createCurrentCloudExpiredLocalOwnedDirtContinuationController(adapter) {
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Current-cloud local continuation adapter requires ${method}().`);
    }
  }
  return Object.freeze({
    async plan() {
      return buildCurrentCloudExpiredLocalOwnedDirtContinuationPlan({
        evidence: await adapter.readPlanEvidence(),
      });
    },
    async run({ plan } = {}) {
      const normalized = normalizeCurrentCloudExpiredLocalOwnedDirtContinuationPlan(plan);
      return adapter.withOperationLock(() => runLocked(adapter, normalized));
    },
  });
}

async function runLocked(adapter, plan) {
  let intent = await adapter.readIntent(plan);
  if (intent) {
    intent = normalizeCurrentCloudExpiredLocalOwnedDirtContinuationIntent(intent);
    if (intent.planDigest !== plan.planDigest) {
      throw new Error("Stored local continuation intent belongs to another plan.");
    }
  } else {
    intent = createCurrentCloudExpiredLocalOwnedDirtContinuationIntent(plan);
    await adapter.writeIntent({ expected: null, value: intent, plan });
  }
  if (intent.status === "complete") {
    await adapter.verifyTerminal(plan, { intent, replay: true });
    return buildCurrentCloudExpiredLocalOwnedDirtContinuationCompletionReceipt(intent);
  }
  if (intent.status === "prepared") {
    await adapter.revalidateCloud(plan, "before-authority");
    intent = await persist(adapter, plan, intent, "authority-verified",
      await adapter.authorizeTask(plan));
  }
  if (intent.status === "authority-verified") {
    const values = await adapter.revalidateCloud(plan, "before-local");
    intent = await persist(adapter, plan, intent, "local-attempted", values);
  }
  if (intent.status === "local-attempted") {
    let values;
    try {
      values = await adapter.projectLocal(plan, { intent });
    } catch (error) {
      const adopted = await adapter.revalidateCloud(plan, "after-local-error");
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
    intent = await persist(adapter, plan, intent, "complete", {});
  }
  return buildCurrentCloudExpiredLocalOwnedDirtContinuationCompletionReceipt(intent);
}

async function persist(adapter, plan, current, status, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error(`Current-cloud local continuation ${status} produced no receipt values.`);
  }
  const next = advanceCurrentCloudExpiredLocalOwnedDirtContinuationIntent(
    current, { status, values },
  );
  await adapter.writeIntent({ expected: current, value: next, plan });
  return next;
}
