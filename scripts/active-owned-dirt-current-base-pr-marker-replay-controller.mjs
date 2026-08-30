// Responsibility: Orchestrate one replay-safe, task-bound current-base marker repair.
import {
  advanceActiveOwnedDirtCurrentBasePrMarkerReplayIntent,
  buildActiveOwnedDirtCurrentBasePrMarkerReplayCompletionReceipt,
  buildActiveOwnedDirtCurrentBasePrMarkerReplayPlan,
  createActiveOwnedDirtCurrentBasePrMarkerReplayIntent,
  normalizeActiveOwnedDirtCurrentBasePrMarkerReplayIntent,
  normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan,
} from "./active-owned-dirt-current-base-pr-marker-replay-contract.mjs";

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

export function createActiveOwnedDirtCurrentBasePrMarkerReplayController(adapter) {
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(
        `Active-owned-dirt current-base PR-marker replay adapter requires ${method}().`,
      );
    }
  }
  return Object.freeze({
    async plan({ ttlSeconds } = {}) {
      return buildActiveOwnedDirtCurrentBasePrMarkerReplayPlan({
        evidence: await adapter.readPlanEvidence(),
        ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
      });
    },
    async run({ plan, authorization } = {}) {
      const sealed = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan(plan);
      return adapter.withOperationLock(
        () => runLocked(adapter, sealed, authorization),
      );
    },
  });
}

export const createController =
  createActiveOwnedDirtCurrentBasePrMarkerReplayController;

async function runLocked(adapter, plan, authorization) {
  let intent = await adapter.readIntent();
  if (intent) {
    intent = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayIntent(intent);
    if (intent.planDigest !== plan.planDigest) {
      throw new Error("Stored marker replay intent belongs to a different plan.");
    }
    if (authorization !== undefined
      && authorization !== intent.authorization.statement) {
      throw new Error("Marker replay authorization differs from the sealed intent.");
    }
  } else {
    intent = createActiveOwnedDirtCurrentBasePrMarkerReplayIntent(plan, authorization);
    await adapter.writeIntent({ expected: null, value: intent });
  }

  if (intent.phase === "complete") {
    await adapter.verifyTerminal(plan, { intent, replay: true });
    return buildActiveOwnedDirtCurrentBasePrMarkerReplayCompletionReceipt(intent);
  }

  if (intent.phase === "prepared") {
    await adapter.revalidate(plan, "before-authority");
    const values = receiptValues(await adapter.authorizeTask(plan), "task authority");
    intent = await persistNext(adapter, intent, "authority-verified", values);
  } else if ([
    "authority-verified",
    "provider-attempted",
    "provider-projected",
  ].includes(intent.phase)) {
    const current = receiptValues(
      await adapter.authorizeTask(plan),
      "resumed task authority",
    );
    const sealed = intent.receipts["authority-verified"].values;
    if (current.bindingDigest !== sealed.bindingDigest) {
      throw new Error("Resumed marker replay task authority changed its sealed binding.");
    }
  }

  if (intent.phase === "authority-verified") {
    const values = receiptValues(
      await adapter.revalidate(plan, "before-provider"),
      "provider prevalidation",
    );
    // Seal the exact pre-mutation frame before the sole provider body projection.
    intent = await persistNext(adapter, intent, "provider-attempted", values);
  }

  if (intent.phase === "provider-attempted") {
    let values;
    try {
      values = receiptValues(
        await adapter.projectProviderBody(plan),
        "provider projection",
      );
    } catch (error) {
      const adopted = await adapter.revalidate(plan, "after-provider-error");
      if (adopted?.providerProjected !== true) throw error;
      values = receiptValues(adopted, "provider response-loss adoption");
    }
    intent = await persistNext(adapter, intent, "provider-projected", values);
  }

  if (intent.phase === "provider-projected") {
    const values = receiptValues(
      await adapter.verifyTerminal(plan, { intent, replay: false }),
      "terminal verification",
    );
    intent = await persistNext(adapter, intent, "complete", values);
  }

  return buildActiveOwnedDirtCurrentBasePrMarkerReplayCompletionReceipt(intent);
}

async function persistNext(adapter, current, phase, values) {
  const next = advanceActiveOwnedDirtCurrentBasePrMarkerReplayIntent(
    current,
    { phase, values },
  );
  await adapter.writeIntent({ expected: current, value: next });
  return next;
}

function receiptValues(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Active-owned-dirt current-base PR-marker replay ${label} returned no values.`,
    );
  }
  return value;
}
