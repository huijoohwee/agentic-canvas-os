// Responsibility: Orchestrate one expired marker repair through injected, receipt-bound ports.
import {
  advanceExpiredActiveAdmittedPrMarkerResponseLossIntent,
  buildExpiredActiveAdmittedPrMarkerResponseLossCompletionReceipt,
  buildExpiredActiveAdmittedPrMarkerResponseLossPlan,
  createExpiredActiveAdmittedPrMarkerResponseLossIntent,
  normalizeExpiredActiveAdmittedPrMarkerResponseLossIntent,
  normalizeExpiredActiveAdmittedPrMarkerResponseLossPlan,
} from "./expired-active-admitted-pr-marker-response-loss-contract.mjs";

const REQUIRED_METHODS = Object.freeze([
  "readPlanEvidence",
  "withOperationLock",
  "readIntent",
  "writeIntent",
  "authorizeTask",
  "revalidate",
  "projectProviderBody",
  "verifyTerminal",
]);

export function createExpiredActiveAdmittedPrMarkerResponseLossController(adapter) {
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(
        `Expired active admitted PR marker response-loss adapter requires ${method}().`,
      );
    }
  }
  return Object.freeze({
    async plan() {
      return buildExpiredActiveAdmittedPrMarkerResponseLossPlan({
        evidence: await adapter.readPlanEvidence(),
      });
    },
    async run({ plan } = {}) {
      const normalizedPlan = normalizeExpiredActiveAdmittedPrMarkerResponseLossPlan(plan);
      return adapter.withOperationLock(async () => runLocked(adapter, normalizedPlan));
    },
  });
}

async function runLocked(adapter, plan) {
  let intent = await adapter.readIntent();
  if (intent) {
    intent = normalizeExpiredActiveAdmittedPrMarkerResponseLossIntent(intent);
    if (intent.planDigest !== plan.planDigest) {
      throw new Error("Stored expired marker response-loss intent belongs to a different plan.");
    }
  } else {
    intent = createExpiredActiveAdmittedPrMarkerResponseLossIntent(plan);
    await adapter.writeIntent({ expected: null, value: intent });
  }

  if (intent.status === "complete") {
    await adapter.verifyTerminal(plan, { intent, replay: true });
    return buildExpiredActiveAdmittedPrMarkerResponseLossCompletionReceipt(intent);
  }

  if (intent.status === "prepared") {
    await adapter.revalidate(plan, "before-authority");
    const values = requireValues(await adapter.authorizeTask(plan), "task authority");
    intent = await persistNext(adapter, intent, "authority-verified", values);
  }

  if (intent.status === "authority-verified") {
    const values = requireValues(
      await adapter.revalidate(plan, "before-provider"),
      "provider prevalidation",
    );
    // The attempt receipt is durable before the sole permitted provider edit.
    intent = await persistNext(adapter, intent, "provider-attempted", values);
  }

  if (intent.status === "provider-attempted") {
    let values;
    try {
      values = requireValues(await adapter.projectProviderBody(plan), "provider projection");
    } catch (error) {
      const reconciled = await adapter.revalidate(plan, "after-provider-error");
      if (reconciled?.providerProjected !== true) throw error;
      values = requireValues(reconciled, "provider response-loss reconciliation");
    }
    intent = await persistNext(adapter, intent, "provider-projected", values);
  }

  if (intent.status === "provider-projected") {
    const values = requireValues(
      await adapter.verifyTerminal(plan, { intent, replay: false }),
      "terminal verification",
    );
    intent = await persistNext(adapter, intent, "complete", values);
  }

  return buildExpiredActiveAdmittedPrMarkerResponseLossCompletionReceipt(intent);
}

async function persistNext(adapter, current, status, values) {
  const next = advanceExpiredActiveAdmittedPrMarkerResponseLossIntent(
    current,
    { status, values },
  );
  await adapter.writeIntent({ expected: current, value: next });
  return next;
}

function requireValues(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Expired active admitted PR marker response-loss ${label} returned no receipt values.`,
    );
  }
  return value;
}
