// Responsibility: Orchestrate one exact-authorized dormant successor recovery.
import {
  advanceActivePublishSuccessorDormantRecoveryIntent,
  authorizeActivePublishSuccessorDormantRecovery,
  buildActivePublishSuccessorDormantRecoveryCompletion,
  buildActivePublishSuccessorDormantRecoveryPlan,
  createActivePublishSuccessorDormantRecoveryIntent,
  normalizeActivePublishSuccessorDormantRecoveryIntent,
  normalizeActivePublishSuccessorDormantRecoveryPlan,
  normalizeActivePublishSuccessorDormantRecoveryTerminalVerification,
} from "./active-publish-successor-dormant-recovery-contract.mjs";

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "readPlanEvidence",
  "assertSource",
  "authorizeTask",
  "sealCloudRequest",
  "recoverCloud",
  "projectLease",
  "projectReviewMarker",
  "verifyTerminal",
]);

export function createActivePublishSuccessorDormantRecoveryController({
  adapter,
  store,
} = {}) {
  requireMethods(adapter, REQUIRED_ADAPTER_METHODS, "adapter");
  requireMethods(store, ["readIntent", "writeIntent", "withOperationLock"], "store");
  return Object.freeze({
    async plan({ ttlSeconds } = {}) {
      return buildActivePublishSuccessorDormantRecoveryPlan({
        evidence: await adapter.readPlanEvidence(),
        ttlSeconds,
      });
    },
    async run({ plan, authorization } = {}) {
      const sealedPlan = normalizeActivePublishSuccessorDormantRecoveryPlan(plan);
      authorizeActivePublishSuccessorDormantRecovery({
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
  const authorizationReceipt = authorizeActivePublishSuccessorDormantRecovery({
    plan,
    authorization,
  });
  let intent = store.readIntent();
  if (intent) {
    intent = normalizeActivePublishSuccessorDormantRecoveryIntent(intent);
    if (intent.planDigest !== plan.planDigest) {
      throw new Error("Stored dormant successor recovery belongs to another plan.");
    }
    authorizeActivePublishSuccessorDormantRecovery({
      plan: intent.planSnapshot,
      authorization,
    });
  } else {
    await adapter.assertSource(plan, "before-authorized-journal");
    intent = store.writeIntent({
      expected: null,
      value: createActivePublishSuccessorDormantRecoveryIntent(
        plan,
        authorizationReceipt,
      ),
    });
  }
  if (intent.status === "complete") {
    return buildActivePublishSuccessorDormantRecoveryCompletion({
      plan,
      intent,
      terminalVerification: intent.phases.verified.values,
    });
  }
  intent = await advanceWhen(intent, "authorized", "task_authority_verified", store,
    () => adapter.authorizeTask(plan));
  intent = await advanceWhen(intent, "task_authority_verified", "cloud_request_sealed", store,
    async () => {
      await adapter.assertSource(plan, "before-cloud-request-seal");
      return adapter.sealCloudRequest(plan);
    });
  intent = await advanceWhen(intent, "cloud_request_sealed", "cloud_recovered", store,
    () => adapter.recoverCloud(plan, {
      intent,
      sealedRequest: intent.phases.cloud_request_sealed.values,
    }));
  intent = await advanceWhen(intent, "cloud_recovered", "lease_projected", store,
    () => adapter.projectLease(plan, { intent }));
  intent = await advanceWhen(intent, "lease_projected", "review_marker_projected", store,
    () => adapter.projectReviewMarker(plan, { intent }));
  intent = await advanceWhen(intent, "review_marker_projected", "verified", store,
    () => adapter.verifyTerminal(plan, { intent, replay: false }));
  if (intent.status === "verified") {
    const current = normalizeActivePublishSuccessorDormantRecoveryTerminalVerification(
      await requireValues(
        adapter.verifyTerminal(plan, { intent, replay: true }),
        "completion revalidation",
      ),
      plan,
    );
    const stored = normalizeActivePublishSuccessorDormantRecoveryTerminalVerification(
      intent.phases.verified.values,
      plan,
    );
    if (current.verificationDigest !== stored.verificationDigest) {
      throw new Error("Dormant successor recovery terminal evidence drifted.");
    }
    intent = persist(store, intent, "complete", {});
  }
  if (intent.status !== "complete") {
    throw new Error("Dormant successor recovery did not complete.");
  }
  return buildActivePublishSuccessorDormantRecoveryCompletion({
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
    value: advanceActivePublishSuccessorDormantRecoveryIntent(current, status, values),
  });
}

async function requireValues(value, label) {
  const resolved = await value;
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw new Error(`Dormant successor recovery ${label} returned no receipt values.`);
  }
  return resolved;
}

function requireMethods(value, names, label) {
  for (const name of names) {
    if (typeof value?.[name] !== "function") {
      throw new Error(`Dormant successor recovery ${label} requires ${name}().`);
    }
  }
}
