// Responsibility: Orchestrate one exact-authorized historical successor adoption or recovery.
import {
  advanceActivePublishHistoricalDerivativeRecoveryIntent,
  authorizeActivePublishHistoricalDerivativeRecovery,
  buildActivePublishHistoricalDerivativeRecoveryCompletion,
  buildActivePublishHistoricalDerivativeRecoveryPlan,
  createActivePublishHistoricalDerivativeRecoveryIntent,
  normalizeActivePublishHistoricalDerivativeRecoveryIntent,
  normalizeActivePublishHistoricalDerivativeRecoveryPlan,
  normalizeActivePublishHistoricalDerivativeRecoveryTerminal,
} from "./active-publish-historical-derivative-recovery-contract.mjs";

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "readPlanEvidence",
  "assertSource",
  "authorizeTask",
  "sealCloudRequest",
  "recoverCloud",
  "prepareRegistryProjection",
  "projectRegistry",
  "projectReviewMarker",
  "verifyTerminal",
]);

export function createActivePublishHistoricalDerivativeRecoveryController({
  adapter,
  store,
} = {}) {
  requireMethods(adapter, REQUIRED_ADAPTER_METHODS, "adapter");
  requireMethods(store, ["readIntent", "writeIntent", "withOperationLock"], "store");
  return Object.freeze({
    async plan({ ttlSeconds } = {}) {
      return buildActivePublishHistoricalDerivativeRecoveryPlan({
        evidence: await adapter.readPlanEvidence(),
        ttlSeconds,
      });
    },
    async run({ plan, authorization } = {}) {
      const sealedPlan = normalizeActivePublishHistoricalDerivativeRecoveryPlan(plan);
      authorizeActivePublishHistoricalDerivativeRecovery({
        plan: sealedPlan,
        authorization,
      });
      return store.withOperationLock(() => runLocked({
        adapter,
        store,
        plan: sealedPlan,
        authorization,
      }));
    },
  });
}

async function runLocked({ adapter, store, plan, authorization }) {
  const authorizationReceipt = authorizeActivePublishHistoricalDerivativeRecovery({
    plan,
    authorization,
  });
  let intent = store.readIntent();
  if (intent) {
    intent = normalizeActivePublishHistoricalDerivativeRecoveryIntent(intent);
    if (intent.planDigest !== plan.planDigest) {
      throw new Error("Stored historical derivative recovery belongs to another plan.");
    }
    authorizeActivePublishHistoricalDerivativeRecovery({
      plan: intent.planSnapshot,
      authorization,
    });
  } else {
    await adapter.assertSource(plan, "before-authorized-journal");
    intent = store.writeIntent({
      expected: null,
      value: createActivePublishHistoricalDerivativeRecoveryIntent(
        plan,
        authorizationReceipt,
      ),
    });
  }
  if (intent.status === "complete") return completion(plan, intent);

  intent = await advanceWhen(intent, "authorized", "task_authority_verified", store,
    () => adapter.authorizeTask(plan));
  intent = await advanceWhen(intent, "task_authority_verified", "cloud_request_sealed", store,
    async () => {
      await adapter.assertSource(plan, "before-cloud-request-seal");
      return adapter.sealCloudRequest(plan, { intent });
    });
  intent = await advanceWhen(intent, "cloud_request_sealed", "cloud_recovered", store,
    () => adapter.recoverCloud(plan, {
      intent,
      sealedRequest: intent.phases.cloud_request_sealed.values,
    }));
  intent = await advanceWhen(
    intent,
    "cloud_recovered",
    "registry_projection_prepared",
    store,
    async () => {
      await adapter.assertSource(plan, "before-registry-projection-prepare");
      return adapter.prepareRegistryProjection(plan, { intent });
    },
  );
  intent = await advanceWhen(
    intent,
    "registry_projection_prepared",
    "registry_projected",
    store,
    () => adapter.projectRegistry(plan, {
      intent,
      projection: intent.phases.registry_projection_prepared.values,
    }),
  );
  intent = await advanceWhen(
    intent,
    "registry_projected",
    "review_marker_projected",
    store,
    () => adapter.projectReviewMarker(plan, { intent }),
  );
  intent = await advanceWhen(intent, "review_marker_projected", "verified", store,
    () => adapter.verifyTerminal(plan, { intent, replay: false }));
  if (intent.status === "verified") {
    const current = normalizeActivePublishHistoricalDerivativeRecoveryTerminal(
      await requireValues(
        adapter.verifyTerminal(plan, { intent, replay: true }),
        "completion revalidation",
      ),
      plan,
    );
    const stored = normalizeActivePublishHistoricalDerivativeRecoveryTerminal(
      intent.phases.verified.values,
      plan,
    );
    if (current.verificationDigest !== stored.verificationDigest) {
      throw new Error("Historical derivative recovery terminal evidence drifted.");
    }
    buildActivePublishHistoricalDerivativeRecoveryCompletion({
      plan,
      intent,
      terminalVerification: stored,
    });
    intent = persist(store, intent, "complete", {});
  }
  if (intent.status !== "complete") {
    throw new Error("Historical derivative recovery did not complete.");
  }
  return completion(plan, intent);
}

function completion(plan, intent) {
  return buildActivePublishHistoricalDerivativeRecoveryCompletion({
    plan,
    intent,
    terminalVerification: intent.phases.verified.values,
  });
}

async function advanceWhen(intent, source, target, store, effect) {
  if (intent.status !== source) return intent;
  const values = await requireValues(effect(), target);
  return persist(store, intent, target, values);
}

function persist(store, current, status, values) {
  return store.writeIntent({
    expected: current,
    value: advanceActivePublishHistoricalDerivativeRecoveryIntent(current, status, values),
  });
}

async function requireValues(value, label) {
  const resolved = await value;
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw new Error(`Historical derivative recovery ${label} returned no receipt values.`);
  }
  return resolved;
}

function requireMethods(value, names, label) {
  for (const name of names) {
    if (typeof value?.[name] !== "function") {
      throw new Error(`Historical derivative recovery ${label} requires ${name}().`);
    }
  }
}
