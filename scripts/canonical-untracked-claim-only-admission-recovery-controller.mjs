// Responsibility: Orchestrate one exact-authorized same-claim continuation without lane projection.
import {
  advanceCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent,
  authorizeCanonicalUntrackedClaimOnlyAdmissionRecovery,
  buildCanonicalUntrackedClaimOnlyAdmissionRecoveryCompletion,
  buildCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan,
  createCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent,
  normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent,
  normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan,
} from "./canonical-untracked-claim-only-admission-recovery-contract.mjs";

const ADAPTER_METHODS = Object.freeze([
  "readPlanEvidence", "assertSource", "authorizeTask", "sealCloudRequest",
  "recoverCloud", "verifyTerminal",
]);

export function createCanonicalUntrackedClaimOnlyAdmissionRecoveryController({ adapter, store }) {
  for (const method of ADAPTER_METHODS) {
    if (typeof adapter?.[method] !== "function") throw new Error(`Claim-only recovery adapter requires ${method}().`);
  }
  for (const method of ["readIntent", "writeIntent", "withOperationLock"]) {
    if (typeof store?.[method] !== "function") throw new Error(`Claim-only recovery store requires ${method}().`);
  }
  return Object.freeze({
    async plan({ ttlSeconds } = {}) {
      return buildCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan({
        evidence: await adapter.readPlanEvidence(),
        ttlSeconds,
      });
    },
    async run({ plan, authorization } = {}) {
      const sealed = normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan(plan);
      authorizeCanonicalUntrackedClaimOnlyAdmissionRecovery({ plan: sealed, authorization });
      return store.withOperationLock(() => runLocked({ adapter, store, plan: sealed, authorization }));
    },
  });
}

async function runLocked({ adapter, store, plan, authorization }) {
  let intent = store.readIntent();
  if (intent) {
    intent = normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent(intent);
    if (intent.planDigest !== plan.planDigest) throw new Error("Stored claim-only recovery belongs to another plan.");
    authorizeCanonicalUntrackedClaimOnlyAdmissionRecovery({ plan, authorization });
  } else {
    await adapter.assertSource(plan, "before-authorized-journal");
    intent = store.writeIntent({
      expected: null,
      value: createCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent(plan, authorization),
    });
  }
  if (intent.status === "complete") {
    await adapter.assertSource(plan, "completed-replay");
    const current = await receipt(adapter.verifyTerminal(plan, {
      recovered: intent.phases.cloud_recovered.values,
    }), "completed replay verification");
    if (current.terminalReceiptDigest !== intent.phases.verified.values.terminalReceiptDigest) {
      throw new Error("Completed claim-only recovery authority is no longer current.");
    }
    return buildCanonicalUntrackedClaimOnlyAdmissionRecoveryCompletion(intent);
  }
  if (intent.status === "authorized") {
    await adapter.assertSource(plan, "before-task-authority");
    intent = persist(store, intent, "task_authority_verified", await receipt(
      adapter.authorizeTask(plan, { purpose: "journal" }), "task authority",
    ));
  }
  if (intent.status === "task_authority_verified") {
    await adapter.assertSource(plan, "before-cloud-request");
    intent = persist(store, intent, "cloud_request_sealed", await receipt(adapter.sealCloudRequest(plan), "cloud request"));
  }
  if (intent.status === "cloud_request_sealed") {
    await adapter.assertSource(plan, "before-cloud-continuation");
    const freshTaskAuthority = await receipt(
      adapter.authorizeTask(plan, { purpose: "cloud-continuation" }), "fresh task authority",
    );
    intent = persist(store, intent, "cloud_recovered", await receipt(adapter.recoverCloud(plan, {
      sealedRequest: intent.phases.cloud_request_sealed.values,
      taskAuthority: freshTaskAuthority,
    }), "cloud recovery"));
  }
  if (intent.status === "cloud_recovered") {
    intent = persist(store, intent, "verified", await receipt(adapter.verifyTerminal(plan, {
      recovered: intent.phases.cloud_recovered.values,
    }), "terminal verification"));
  }
  if (intent.status === "verified") {
    await adapter.assertSource(plan, "before-completion");
    const replay = await receipt(adapter.verifyTerminal(plan, {
      recovered: intent.phases.cloud_recovered.values,
    }), "completion verification");
    if (replay.terminalReceiptDigest !== intent.phases.verified.values.terminalReceiptDigest) {
      throw new Error("Claim-only recovery terminal evidence drifted before completion.");
    }
    intent = persist(store, intent, "complete", {});
  }
  return buildCanonicalUntrackedClaimOnlyAdmissionRecoveryCompletion(intent);
}

function persist(store, current, status, values) {
  return store.writeIntent({
    expected: current,
    value: advanceCanonicalUntrackedClaimOnlyAdmissionRecoveryIntent(current, { status, values }),
  });
}
async function receipt(value, label) { const result = await value; if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error(`Claim-only recovery ${label} returned no receipt.`); return result; }
