// Responsibility: Orchestrate one exact-authorized, replay-safe fence-only recovery.
import {
  advancePlannedFenceOnlyAdmissionRecoveryIntent,
  authorizePlannedFenceOnlyAdmissionRecovery,
  buildPlannedFenceOnlyAdmissionRecoveryCompletion,
  buildPlannedFenceOnlyAdmissionRecoveryPlan,
  createPlannedFenceOnlyAdmissionRecoveryIntent,
  normalizePlannedFenceOnlyAdmissionRecoveryIntent,
  normalizePlannedFenceOnlyAdmissionRecoveryPlan,
  normalizePlannedFenceOnlyTerminalVerification,
} from "./planned-fence-only-admission-recovery-contract.mjs";

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "readPlanEvidence",
  "assertSource",
  "authorizeTask",
  "prepareLocalProjection",
  "restoreLocalProjection",
  "sealCloudRequest",
  "recoverCloud",
  "projectLease",
  "projectReviewMarker",
  "verifyTerminal",
]);

export function createPlannedFenceOnlyAdmissionRecoveryController({ adapter, store }) {
  for (const method of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Planned fence-only recovery adapter requires ${method}().`);
    }
  }
  for (const method of ["readIntent", "writeIntent", "withOperationLock"]) {
    if (typeof store?.[method] !== "function") {
      throw new Error(`Planned fence-only recovery store requires ${method}().`);
    }
  }
  return Object.freeze({
    async plan({ ttlSeconds } = {}) {
      return buildPlannedFenceOnlyAdmissionRecoveryPlan({
        evidence: await adapter.readPlanEvidence(),
        ttlSeconds,
      });
    },
    async run({ plan, authorization } = {}) {
      const sealedPlan = normalizePlannedFenceOnlyAdmissionRecoveryPlan(plan);
      authorizePlannedFenceOnlyAdmissionRecovery({ plan: sealedPlan, authorization });
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
  let intent = store.readIntent();
  if (intent) {
    intent = normalizePlannedFenceOnlyAdmissionRecoveryIntent(intent);
    if (intent.planDigest !== plan.planDigest) {
      throw new Error("Stored planned fence-only recovery belongs to another plan.");
    }
    authorizePlannedFenceOnlyAdmissionRecovery({ plan: intent.planSnapshot, authorization });
  } else {
    await adapter.assertSource(plan, "before-authorized-journal");
    intent = createPlannedFenceOnlyAdmissionRecoveryIntent(plan, authorization);
    intent = store.writeIntent({ expected: null, value: intent });
  }

  if (intent.status === "complete") {
    return buildPlannedFenceOnlyAdmissionRecoveryCompletion(intent);
  }

  if (intent.status === "authorized") {
    const values = await requireValues(adapter.authorizeTask(plan), "task authority");
    intent = persist(store, intent, "task_authority_verified", values);
  }
  if (intent.status === "task_authority_verified") {
    await adapter.assertSource(plan, "before-local-projection-preparation");
    const values = await requireValues(adapter.prepareLocalProjection(plan),
      "local projection preparation");
    intent = persist(store, intent, "local_projection_prepared", values);
  }
  if (intent.status === "local_projection_prepared") {
    const values = await requireValues(adapter.restoreLocalProjection(plan, { intent }),
      "local projection restoration");
    intent = persist(store, intent, "local_projection_restored", values);
  }
  if (intent.status === "local_projection_restored") {
    await adapter.assertSource(plan, "before-cloud-request-journal");
    const values = await requireValues(adapter.sealCloudRequest(plan), "cloud request");
    intent = persist(store, intent, "cloud_request_sealed", values);
  }
  if (intent.status === "cloud_request_sealed") {
    const values = await requireValues(adapter.recoverCloud(plan, {
      intent,
      sealedRequest: intent.phases.cloud_request_sealed.values,
    }), "cloud recovery");
    intent = persist(store, intent, "cloud_recovered", values);
  }
  if (intent.status === "cloud_recovered") {
    const values = await requireValues(adapter.projectLease(plan, { intent }), "lease projection");
    intent = persist(store, intent, "lease_projected", values);
  }
  if (intent.status === "lease_projected") {
    const values = await requireValues(adapter.projectReviewMarker(plan, { intent }), "review marker");
    intent = persist(store, intent, "review_marker_projected", values);
  }
  if (intent.status === "review_marker_projected") {
    const values = await requireValues(adapter.verifyTerminal(plan, { intent, replay: false }),
      "terminal verification");
    intent = persist(store, intent, "verified", values);
  }
  if (intent.status === "verified") {
    const currentValues = await requireValues(
      adapter.verifyTerminal(plan, { intent, replay: true }),
      "completion revalidation",
    );
    const current = normalizePlannedFenceOnlyTerminalVerification({
      plan,
      intent,
      values: currentValues,
    });
    const stored = normalizePlannedFenceOnlyTerminalVerification({
      plan,
      intent,
      values: intent.phases.verified.values,
    });
    if (current.terminalTargetDigest !== stored.terminalTargetDigest) {
      throw new Error("Planned fence-only recovery terminal evidence drifted before completion.");
    }
    intent = persist(store, intent, "complete", {});
  }
  if (intent.status !== "complete") throw new Error("Planned fence-only recovery did not complete.");
  return buildPlannedFenceOnlyAdmissionRecoveryCompletion(intent);
}

function persist(store, current, status, values) {
  const next = advancePlannedFenceOnlyAdmissionRecoveryIntent(current, { status, values });
  return store.writeIntent({ expected: current, value: next });
}

async function requireValues(promise, label) {
  const value = await promise;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Planned fence-only recovery ${label} returned no receipt values.`);
  }
  return value;
}
