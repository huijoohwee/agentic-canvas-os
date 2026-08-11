// Responsibility: Journal and replay the two exact projection effects.
import {
  advanceAdmissionManifestProjectionRepairIntent,
  authorizeAdmissionManifestProjectionRepair,
  beginAdmissionManifestProjectionRepairEffect,
  buildAdmissionManifestProjectionRepairPlan,
  buildAdmissionManifestProjectionRepairReceipt,
  completeAdmissionManifestProjectionRepairIntent,
  createAdmissionManifestProjectionRepairIntent,
  normalizeAdmissionManifestProjectionRepairIntent,
} from "./admission-manifest-projection-repair-contract.mjs";

const EFFECTS = [
  ["provider-projected", "projectProvider"],
  ["registry-projected", "projectRegistry"],
];

export function createAdmissionManifestProjectionRepairController({ adapter } = {}) {
  for (const name of ["readPlanEvidence", "withOperationLock", "readIntent", "writeIntent",
    "revalidate", "reconcile", "projectProvider", "projectRegistry", "verify"]) {
    if (typeof adapter?.[name] !== "function") throw new Error(`Admission manifest projection repair adapter requires ${name}().`);
  }
  return Object.freeze({
    plan() { return buildAdmissionManifestProjectionRepairPlan(adapter.readPlanEvidence()); },
    run({ plan, authorization } = {}) {
      const authorized = authorizeAdmissionManifestProjectionRepair(plan, authorization);
      const operationId = createAdmissionManifestProjectionRepairIntent(authorized).operationId;
      return adapter.withOperationLock({ operationId }, () => runLocked(adapter, authorized));
    },
  });
}

function runLocked(adapter, plan) {
  let intent = adapter.readIntent({ plan }) || createAdmissionManifestProjectionRepairIntent(plan);
  intent = normalizeAdmissionManifestProjectionRepairIntent(intent);
  if (intent.planDigest !== plan.planDigest) throw new Error("Stored projection-repair intent differs from the authorized plan.");
  if (!adapter.readIntent({ plan })) adapter.writeIntent({ expected: null, value: intent });
  if (intent.status === "complete") {
    adapter.verify({ plan, intent });
    return intent.receipt;
  }
  for (const [phase, effect] of EFFECTS) {
    if (reached(intent.status, phase)) continue;
    let receipt = adapter.reconcile({ plan, intent, phase });
    if (!receipt) {
      adapter.revalidate({ plan, intent, phase });
      if (!intent.attempts.some(item => item.phase === phase)) {
        const prepared = beginAdmissionManifestProjectionRepairEffect(intent, phase);
        adapter.writeIntent({ expected: intent, value: prepared });
        intent = prepared;
      }
      adapter[effect]({ plan, intent });
      receipt = adapter.reconcile({ plan, intent, phase });
    }
    if (!receipt) throw new Error(`Admission manifest projection ${phase} effect was not exactly observable.`);
    const next = advanceAdmissionManifestProjectionRepairIntent(intent, phase, receipt);
    adapter.writeIntent({ expected: intent, value: next });
    intent = next;
  }
  const verified = adapter.verify({ plan, intent });
  const receipt = buildAdmissionManifestProjectionRepairReceipt({ intent, ...verified });
  const complete = completeAdmissionManifestProjectionRepairIntent(intent, receipt);
  adapter.writeIntent({ expected: intent, value: complete });
  return receipt;
}

function reached(current, target) { return ["prepared", "provider-projected", "registry-projected", "complete"].indexOf(current)
  >= ["prepared", "provider-projected", "registry-projected", "complete"].indexOf(target); }
