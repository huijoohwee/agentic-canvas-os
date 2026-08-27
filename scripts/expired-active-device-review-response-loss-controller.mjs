// Responsibility: Durably orchestrate one exact reviewed-transition adoption through injected ports.
import { canonicalJson } from "./cloud-collaboration-primitives.mjs";
import {
  advanceExpiredActiveDeviceReviewResponseLossIntent,
  authorizeExpiredActiveDeviceReviewResponseLoss,
  buildExpiredActiveDeviceReviewResponseLossCompletionReceipt,
  buildExpiredActiveDeviceReviewResponseLossPlan,
  createExpiredActiveDeviceReviewResponseLossIntent,
  normalizeExpiredActiveDeviceReviewResponseLossIntent,
  normalizeExpiredActiveDeviceReviewResponseLossPhaseValues,
  normalizeExpiredActiveDeviceReviewResponseLossPlan,
} from "./expired-active-device-review-response-loss-contract.mjs";

const REQUIRED_METHODS = Object.freeze([
  "readPlanEvidence",
  "withOperationLock",
  "assertRuntimeSubject",
  "readIntent",
  "writeIntent",
  "authorizeTask",
  "revalidate",
  "projectLocalReviewReady",
  "markProviderReady",
  "projectProviderMarker",
  "verifyTerminal",
]);

export function createExpiredActiveDeviceReviewResponseLossController(adapter) {
  const runtime = normalizeAdapter(adapter);
  return Object.freeze({
    async plan() {
      return buildExpiredActiveDeviceReviewResponseLossPlan({
        evidence: await runtime.readPlanEvidence(),
      });
    },
    async run({ plan, authorization } = {}) {
      const normalizedPlan = normalizeExpiredActiveDeviceReviewResponseLossPlan(plan);
      const authorizationReceipt = authorizeExpiredActiveDeviceReviewResponseLoss(
        normalizedPlan,
        authorization,
      );
      await runtime.assertRuntimeSubject(normalizedPlan);
      return runtime.withOperationLock(
        () => runLocked(runtime, normalizedPlan, authorizationReceipt),
      );
    },
  });
}

async function runLocked(adapter, plan, authorization) {
  let intent = await adapter.readIntent();
  if (intent) {
    intent = normalizeExpiredActiveDeviceReviewResponseLossIntent(intent);
    if (intent.planDigest !== plan.planDigest
      || intent.authorizationDigest !== authorization.authorizationDigest) {
      throw new Error(
        "Stored expired device-review response-loss intent belongs to different exact authority.",
      );
    }
  } else {
    intent = createExpiredActiveDeviceReviewResponseLossIntent(plan, authorization);
    await persistExact(adapter, null, intent);
  }

  if (intent.status === "complete") {
    const terminal = normalizeValues(
      plan,
      "verified",
      requireValues(
        await adapter.verifyTerminal(plan, { intent, replay: true }),
        "terminal replay verification",
      ),
    );
    if (canonicalJson(terminal) !== canonicalJson(intent.phases.verified.values)) {
      throw new Error("Completed expired device-review projection changed terminal state.");
    }
    return buildExpiredActiveDeviceReviewResponseLossCompletionReceipt(intent);
  }

  if (intent.status === "authorized") {
    await adapter.revalidate(plan, "before-authority");
    intent = await persistNext(
      adapter,
      intent,
      "task-authority-verified",
      requireValues(await adapter.authorizeTask(plan), "task authorization"),
    );
  }

  if (intent.status === "task-authority-verified") {
    intent = await persistNext(
      adapter,
      intent,
      "reviewed-transition-adopted",
      requireValues(
        await adapter.revalidate(plan, "adopt-reviewed-transition"),
        "reviewed-transition adoption",
      ),
    );
  }

  if (intent.status === "reviewed-transition-adopted") {
    intent = await persistNext(
      adapter,
      intent,
      "local-attempted",
      requireValues(
        await adapter.revalidate(plan, "before-local"),
        "local prevalidation",
      ),
    );
  }
  if (intent.status === "local-attempted") {
    intent = await settleProjection({
      adapter,
      intent,
      plan,
      status: "local-projected",
      effect: "projectLocalReviewReady",
      adoptionPhase: "adopt-local",
      adoptionFlag: "localProjected",
      label: "local review-ready projection",
    });
  }

  if (intent.status === "local-projected") {
    intent = await persistNext(
      adapter,
      intent,
      "marker-attempted",
      requireValues(
        await adapter.revalidate(plan, "before-marker"),
        "provider marker prevalidation",
      ),
    );
  }
  if (intent.status === "marker-attempted") {
    intent = await settleProjection({
      adapter,
      intent,
      plan,
      status: "marker-projected",
      effect: "projectProviderMarker",
      adoptionPhase: "adopt-marker",
      adoptionFlag: "markerProjected",
      label: "provider hidden-marker projection",
    });
  }

  if (intent.status === "marker-projected") {
    intent = await persistNext(
      adapter,
      intent,
      "ready-attempted",
      requireValues(
        await adapter.revalidate(plan, "before-ready"),
        "provider ready prevalidation",
      ),
    );
  }
  if (intent.status === "ready-attempted") {
    intent = await settleProjection({
      adapter,
      intent,
      plan,
      status: "provider-ready",
      effect: "markProviderReady",
      adoptionPhase: "adopt-ready",
      adoptionFlag: "providerReady",
      label: "provider draft-to-ready projection",
    });
  }

  if (intent.status === "provider-ready") {
    intent = await persistNext(
      adapter,
      intent,
      "verified",
      requireValues(
        await adapter.verifyTerminal(plan, { intent, replay: false }),
        "terminal verification",
      ),
    );
  }
  if (intent.status === "verified") {
    const terminal = normalizeValues(
      plan,
      "verified",
      requireValues(
        await adapter.verifyTerminal(plan, { intent, replay: true }),
        "pre-completion terminal verification",
      ),
    );
    if (canonicalJson(terminal) !== canonicalJson(intent.phases.verified.values)) {
      throw new Error("Verified expired device-review projection changed before completion.");
    }
    intent = await persistNext(
      adapter,
      intent,
      "complete",
      { verifiedReceiptDigest: intent.phases.verified.receiptDigest },
    );
  }

  return buildExpiredActiveDeviceReviewResponseLossCompletionReceipt(intent);
}

async function settleProjection({
  adapter,
  intent,
  plan,
  status,
  effect,
  adoptionPhase,
  adoptionFlag,
  label,
}) {
  const before = await adapter.revalidate(plan, adoptionPhase);
  if (before?.[adoptionFlag] === true) {
    return persistNext(adapter, intent, status, requireValues(before, `${label} adoption`));
  }
  let values;
  try {
    values = requireValues(await adapter[effect](plan), label);
  } catch (error) {
    const adopted = await adapter.revalidate(plan, adoptionPhase);
    if (adopted?.[adoptionFlag] !== true) throw error;
    values = requireValues(adopted, `${label} response-loss adoption`);
  }
  return persistNext(adapter, intent, status, values);
}

async function persistNext(adapter, current, status, values) {
  const next = advanceExpiredActiveDeviceReviewResponseLossIntent(
    current,
    { status, values },
  );
  await persistExact(adapter, current, next);
  return next;
}

async function persistExact(adapter, expected, value) {
  let writeError = null;
  try {
    await adapter.writeIntent({ expected, value });
  } catch (error) {
    writeError = error;
  }
  let persisted;
  try {
    persisted = normalizeExpiredActiveDeviceReviewResponseLossIntent(
      await adapter.readIntent(),
    );
  } catch (readError) {
    if (writeError) throw writeError;
    throw new Error(
      "Expired device-review response-loss intent has no exact persisted readback.",
      { cause: readError },
    );
  }
  if (persisted.intentDigest !== value.intentDigest
    || canonicalJson(persisted) !== canonicalJson(value)) {
    throw new Error(
      "Expired device-review response-loss intent CAS lost or changed during persistence.",
      { cause: writeError || undefined },
    );
  }
}

function normalizeValues(plan, phase, values) {
  return normalizeExpiredActiveDeviceReviewResponseLossPhaseValues(plan, phase, values);
}

function requireValues(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Expired active device-review response-loss ${label} returned no receipt values.`,
    );
  }
  return value;
}

function normalizeAdapter(adapter) {
  const normalized = Object.freeze(Object.fromEntries(
    REQUIRED_METHODS.map(method => [method, adapter?.[method]]),
  ));
  for (const method of REQUIRED_METHODS) {
    if (typeof normalized[method] !== "function") {
      throw new Error(
        `Expired active device-review response-loss adapter requires ${method}().`,
      );
    }
  }
  return normalized;
}
