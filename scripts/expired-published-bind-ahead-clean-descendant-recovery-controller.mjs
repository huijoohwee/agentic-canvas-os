// Responsibility: Durably reconcile one exact bind-ahead claim through injected ports.
import { canonicalJson } from "./cloud-collaboration-primitives.mjs";
import {
  advanceExpiredPublishedBindAheadCleanDescendantRecoveryIntent,
  authorizeExpiredPublishedBindAheadCleanDescendantRecovery,
  buildExpiredPublishedBindAheadCleanDescendantRecoveryCompletionReceipt,
  buildExpiredPublishedBindAheadCleanDescendantRecoveryPlan,
  createExpiredPublishedBindAheadCleanDescendantRecoveryIntent,
  normalizeExpiredPublishedBindAheadCleanDescendantRecoveryIntent,
  normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPhaseValues,
  normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan,
} from "./expired-published-bind-ahead-clean-descendant-recovery-contract.mjs";

const REQUIRED_METHODS = Object.freeze([
  "readPlanEvidence",
  "readPlanTtlSeconds",
  "withOperationLock",
  "assertRuntimeSubject",
  "readIntent",
  "writeIntent",
  "authorizeTask",
  "acquireBranchFence",
  "releaseBranchFence",
  "revalidate",
  "recoverDormantClaim",
  "projectLocalLease",
  "projectProviderMarker",
  "finalizeTerminalProjection",
  "verifyTerminal",
]);

export function createExpiredPublishedBindAheadCleanDescendantRecoveryController(
  adapter,
) {
  const runtime = normalizeAdapter(adapter);
  return Object.freeze({
    async plan() {
      return buildExpiredPublishedBindAheadCleanDescendantRecoveryPlan({
        evidence: await runtime.readPlanEvidence(),
        ttlSeconds: await runtime.readPlanTtlSeconds(),
      });
    },
    async run({ plan, authorization } = {}) {
      const normalizedPlan =
        normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan(plan);
      const authorizationReceipt =
        authorizeExpiredPublishedBindAheadCleanDescendantRecovery(
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
  let intent = await adapter.readIntent(plan);
  if (intent) {
    intent = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
      intent,
    );
    if (intent.planDigest !== plan.planDigest
      || intent.authorizationDigest !== authorization.authorizationDigest) {
      throw new Error(
        "Stored bind-ahead recovery intent belongs to different exact authority.",
      );
    }
  } else {
    intent = createExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
      plan,
      authorization,
    );
    await persistExact(adapter, plan, null, intent);
  }

  if (intent.status === "complete") {
    await adapter.releaseBranchFence(plan, { intent });
    return buildExpiredPublishedBindAheadCleanDescendantRecoveryCompletionReceipt(
      intent,
    );
  }

  if (intent.status === "authorized") {
    await adapter.revalidate(plan, "before-task-authority", { intent });
    intent = await persistNext(
      adapter,
      plan,
      intent,
      "task-authority-verified",
      requireValues(
        await adapter.authorizeTask(plan, { intent }),
        "task authorization",
      ),
    );
  }

  if (intent.status === "task-authority-verified") {
    intent = await persistNext(
      adapter,
      plan,
      intent,
      "branch-fence-attempted",
      requireValues(
        await adapter.revalidate(plan, "before-branch-fence", { intent }),
        "branch-controller fence prevalidation",
      ),
    );
  }

  if (intent.status === "branch-fence-attempted") {
    intent = await settleEffect({
      adapter,
      plan,
      intent,
      status: "branch-fenced",
      effect: "acquireBranchFence",
      adoptionPhase: "adopt-branch-fence",
      adoptionFlag: "branchFenced",
      label: "branch-controller fence",
    });
  }

  if (intent.status === "branch-fenced") {
    intent = await persistNext(
      adapter,
      plan,
      intent,
      "bind-adopted",
      requireValues(
        await adapter.revalidate(plan, "adopt-bind", { intent }),
        "device-review bind adoption",
      ),
    );
  }

  if (intent.status === "bind-adopted") {
    intent = await persistNext(
      adapter,
      plan,
      intent,
      "cloud-attempted",
      requireValues(
        await adapter.revalidate(plan, "before-cloud", { intent }),
        "cloud prevalidation",
      ),
    );
  }

  if (intent.status === "cloud-attempted") {
    intent = await settleEffect({
      adapter,
      plan,
      intent,
      status: "cloud-reconciled",
      effect: "recoverDormantClaim",
      adoptionPhase: "adopt-cloud",
      adoptionFlag: "cloudReconciled",
      label: "same-claim cloud recovery",
    });
  }

  if (intent.status === "cloud-reconciled") {
    intent = await persistNext(
      adapter,
      plan,
      intent,
      "local-attempted",
      requireValues(
        await adapter.revalidate(plan, "before-local", { intent }),
        "local prevalidation",
      ),
    );
  }

  if (intent.status === "local-attempted") {
    intent = await settleEffect({
      adapter,
      plan,
      intent,
      status: "local-projected",
      effect: "projectLocalLease",
      adoptionPhase: "adopt-local",
      adoptionFlag: "localProjected",
      label: "writer-lease projection",
    });
  }

  if (intent.status === "local-projected") {
    intent = await persistNext(
      adapter,
      plan,
      intent,
      "marker-attempted",
      requireValues(
        await adapter.revalidate(plan, "before-marker", { intent }),
        "provider marker prevalidation",
      ),
    );
  }

  if (intent.status === "marker-attempted") {
    const finalized = requireValues(
      await adapter.finalizeTerminalProjection(plan, { intent }),
      "terminal projection finalization",
    );
    const marker = advanceExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
      intent,
      {
        status: "marker-projected",
        values: requireValues(
          finalized.markerValues,
          "final provider hidden-marker projection",
        ),
      },
    );
    const verified = advanceExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
      marker,
      {
        status: "verified",
        values: requireValues(finalized.verifiedValues, "terminal verification"),
      },
    );
    const complete = advanceExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
      verified,
      {
        status: "complete",
        values: { verifiedReceiptDigest: verified.phases.verified.receiptDigest },
      },
    );
    await persistExact(adapter, plan, intent, complete);
    intent = complete;
  }

  if (intent.status === "marker-projected") {
    const verified = advanceExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
      intent,
      {
        status: "verified",
        values: requireValues(
          await adapter.verifyTerminal(plan, { intent, replay: false }),
          "terminal verification",
        ),
      },
    );
    const complete = advanceExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
      verified,
      {
        status: "complete",
        values: { verifiedReceiptDigest: verified.phases.verified.receiptDigest },
      },
    );
    await persistExact(adapter, plan, intent, complete);
    intent = complete;
  }

  // Retained only for an interrupted pre-atomic journal written by an older
  // controller. New runs persist verified+complete in one journal CAS so a
  // process crash cannot strand a freshly projected marker behind an expired
  // cloud authority.
  if (intent.status === "verified") {
    await assertTerminalReplay(adapter, plan, intent);
    intent = await persistNext(
      adapter,
      plan,
      intent,
      "complete",
      { verifiedReceiptDigest: intent.phases.verified.receiptDigest },
    );
  }

  if (intent.status === "complete") {
    await adapter.releaseBranchFence(plan, { intent });
  }

  return buildExpiredPublishedBindAheadCleanDescendantRecoveryCompletionReceipt(
    intent,
  );
}

async function settleEffect({
  adapter,
  plan,
  intent,
  status,
  effect,
  adoptionPhase,
  adoptionFlag,
  label,
}) {
  const before = await adapter.revalidate(plan, adoptionPhase, { intent });
  if (before?.[adoptionFlag] === true) {
    return persistNext(
      adapter,
      plan,
      intent,
      status,
      requireValues(before.values, `${label} adoption`),
    );
  }
  let values;
  try {
    values = requireValues(await adapter[effect](plan, { intent }), label);
  } catch (error) {
    const after = await adapter.revalidate(plan, adoptionPhase, { intent });
    if (after?.[adoptionFlag] !== true) throw error;
    values = requireValues(after.values, `${label} response-loss adoption`);
  }
  return persistNext(adapter, plan, intent, status, values);
}

async function assertTerminalReplay(adapter, plan, intent) {
  const observed =
    normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPhaseValues(
      plan,
      "verified",
      requireValues(
        await adapter.verifyTerminal(plan, { intent, replay: true }),
        "terminal replay verification",
      ),
    );
  if (canonicalJson(observed)
      !== canonicalJson(intent.phases.verified.values)) {
    throw new Error(
      "Bind-ahead recovery terminal state changed after durable verification.",
    );
  }
}

async function persistNext(adapter, plan, current, status, values) {
  const next = advanceExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
    current,
    { status, values },
  );
  await persistExact(adapter, plan, current, next);
  return next;
}

async function persistExact(adapter, plan, expected, value) {
  let writeError = null;
  try {
    await adapter.writeIntent({ plan, expected, value });
  } catch (error) {
    writeError = error;
  }
  let persisted;
  try {
    persisted =
      normalizeExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
        await adapter.readIntent(plan),
      );
  } catch (readError) {
    if (writeError) throw writeError;
    throw new Error(
      "Bind-ahead recovery intent has no exact persisted readback.",
      { cause: readError },
    );
  }
  if (persisted.intentDigest !== value.intentDigest
    || canonicalJson(persisted) !== canonicalJson(value)) {
    throw new Error(
      "Bind-ahead recovery intent CAS lost or changed during persistence.",
      { cause: writeError || undefined },
    );
  }
}

function requireValues(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Bind-ahead recovery ${label} returned no receipt values.`);
  }
  return value;
}

function normalizeAdapter(adapter) {
  const normalized = Object.freeze(Object.fromEntries(
    REQUIRED_METHODS.map(method => [method, adapter?.[method]]),
  ));
  for (const method of REQUIRED_METHODS) {
    if (typeof normalized[method] !== "function") {
      throw new Error(`Bind-ahead recovery adapter requires ${method}().`);
    }
  }
  return normalized;
}
