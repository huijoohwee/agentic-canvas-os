// Responsibility: Journal and execute one task-authorized provider-body-only repair.
import {
  advanceExpiredPlannedCommittedPrMarkerResponseLossIntent,
  buildExpiredPlannedCommittedPrMarkerResponseLossCompletionReceipt,
  buildExpiredPlannedCommittedPrMarkerResponseLossPlan,
  createExpiredPlannedCommittedPrMarkerResponseLossIntent,
  normalizeExpiredPlannedCommittedPrMarkerResponseLossIntent,
  normalizeExpiredPlannedCommittedPrMarkerResponseLossPlan,
} from "./expired-planned-committed-pr-marker-response-loss-contract.mjs";

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

export function createExpiredPlannedCommittedPrMarkerResponseLossController(adapter) {
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(
        `Expired planned committed PR marker response-loss adapter requires ${method}().`,
      );
    }
  }
  return Object.freeze({
    async plan() {
      return buildExpiredPlannedCommittedPrMarkerResponseLossPlan({
        evidence: await adapter.readPlanEvidence(),
      });
    },
    async run({ plan } = {}) {
      const normalizedPlan = normalizeExpiredPlannedCommittedPrMarkerResponseLossPlan(plan);
      return adapter.withOperationLock(() => runLocked(adapter, normalizedPlan));
    },
  });
}

async function runLocked(adapter, plan) {
  let intent = await adapter.readIntent();
  if (intent) {
    intent = normalizeExpiredPlannedCommittedPrMarkerResponseLossIntent(intent);
    if (intent.planDigest !== plan.planDigest) {
      throw new Error("Stored expired planned marker intent belongs to another plan.");
    }
  } else {
    intent = createExpiredPlannedCommittedPrMarkerResponseLossIntent(plan);
    await adapter.writeIntent({ expected: null, value: intent });
  }

  if (intent.status === "complete") {
    await adapter.verifyTerminal(plan, { intent, replay: true });
    return buildExpiredPlannedCommittedPrMarkerResponseLossCompletionReceipt(intent);
  }
  if (intent.status === "prepared") {
    await adapter.revalidate(plan, "before-authority");
    intent = await persistNext(
      adapter,
      intent,
      "authority-verified",
      requireValues(await adapter.authorizeTask(plan), "task authorization"),
    );
  }
  if (intent.status === "authority-verified") {
    intent = await persistNext(
      adapter,
      intent,
      "provider-attempted",
      requireValues(
        await adapter.revalidate(plan, "before-provider"),
        "provider prevalidation",
      ),
    );
  }
  if (intent.status === "provider-attempted") {
    let values;
    try {
      values = requireValues(
        await adapter.projectProviderBody(plan),
        "provider projection",
      );
    } catch (error) {
      const replay = await adapter.revalidate(plan, "after-provider-error");
      if (replay?.providerProjected !== true) throw error;
      values = requireValues(replay, "provider response-loss replay");
    }
    intent = await persistNext(adapter, intent, "provider-projected", values);
  }
  if (intent.status === "provider-projected") {
    intent = await persistNext(
      adapter,
      intent,
      "complete",
      requireValues(
        await adapter.verifyTerminal(plan, { intent, replay: false }),
        "terminal verification",
      ),
    );
  }
  return buildExpiredPlannedCommittedPrMarkerResponseLossCompletionReceipt(intent);
}

async function persistNext(adapter, current, status, values) {
  const next = advanceExpiredPlannedCommittedPrMarkerResponseLossIntent(
    current,
    { status, values },
  );
  await adapter.writeIntent({ expected: current, value: next });
  return next;
}

function requireValues(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Expired planned committed PR marker response-loss ${label} returned no receipt values.`,
    );
  }
  return value;
}
