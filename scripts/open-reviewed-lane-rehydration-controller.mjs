// Responsibility: Journal and replay exactly three local projection effects.
import {
  advanceOpenReviewedLaneRehydrationIntent,
  authorizeOpenReviewedLaneRehydration,
  beginOpenReviewedLaneRehydrationEffect,
  buildOpenReviewedLaneRehydrationPlan,
  buildOpenReviewedLaneRehydrationReceipt,
  completeOpenReviewedLaneRehydrationIntent,
  createOpenReviewedLaneRehydrationIntent,
  normalizeOpenReviewedLaneRehydrationIntent,
} from "./open-reviewed-lane-rehydration-contract.mjs";

const EFFECTS = [
  ["branch-created", "createBranch"],
  ["worktree-created", "createWorktree"],
  ["lease-recovered", "recoverLease"],
];

export function createOpenReviewedLaneRehydrationController({ adapter } = {}) {
  for (const name of ["readPlanEvidence", "withOperationLock", "readIntent", "writeIntent",
    "withRegistryLock", "revalidate", "reconcile", "createBranch", "createWorktree",
    "recoverLease", "verify", "rollback"]) {
    if (typeof adapter?.[name] !== "function") throw new Error(`Open reviewed lane adapter requires ${name}().`);
  }
  return Object.freeze({
    plan() { return buildOpenReviewedLaneRehydrationPlan(adapter.readPlanEvidence()); },
    run({ plan, authorization } = {}) {
      const authorized = authorizeOpenReviewedLaneRehydration(plan, authorization);
      const operationId = createOpenReviewedLaneRehydrationIntent(authorized).operationId;
      return adapter.withOperationLock({ operationId }, () => runLocked({ adapter, plan: authorized }));
    },
  });
}

function runLocked({ adapter, plan }) {
  let intent = adapter.readIntent({ plan }) || createOpenReviewedLaneRehydrationIntent(plan);
  intent = normalizeOpenReviewedLaneRehydrationIntent(intent);
  if (intent.planDigest !== plan.planDigest) throw new Error("Stored rehydration intent differs from the authorized plan.");
  if (!adapter.readIntent({ plan })) adapter.writeIntent({ expected: null, value: intent });
  if (intent.status === "complete") {
    const verified = adapter.verify({ plan, intent });
    if (verified.leaseDigest !== intent.receipt.leaseDigest
      || verified.registrationDigest !== intent.receipt.registrationDigest) {
      throw new Error("Completed rehydration receipt no longer matches exact local projections.");
    }
    return intent.receipt;
  }
  try {
    adapter.withRegistryLock(() => {
      adapter.revalidate({ plan, intent });
      for (const [phase, effect] of EFFECTS.slice(0, 2)) {
        if (phaseReached(intent.status, phase)) continue;
        intent = runPhase({ adapter, intent, plan, phase, effect });
      }
    });
    if (!phaseReached(intent.status, "lease-recovered")) {
      intent = runPhase({ adapter, intent, plan, phase: "lease-recovered", effect: "recoverLease" });
    }
    const verified = adapter.verify({ plan, intent });
    const receipt = buildOpenReviewedLaneRehydrationReceipt({ intent, ...verified });
    const complete = completeOpenReviewedLaneRehydrationIntent(intent, receipt);
    adapter.writeIntent({ expected: intent, value: complete });
    return receipt;
  } catch (error) {
    let stored = intent;
    try { stored = normalizeOpenReviewedLaneRehydrationIntent(adapter.readIntent({ plan })); }
    catch (readError) {
      throw new Error(`${error.message}; stored intent recovery failed closed: ${readError.message}`, { cause: error });
    }
    let leasePresent = false;
    try { leasePresent = Boolean(adapter.reconcile({ plan, intent: stored, phase: "lease-recovered" })); } catch { leasePresent = true; }
    if (!leasePresent) {
      try {
        adapter.rollback({ plan, intent: stored });
        stored = normalizeOpenReviewedLaneRehydrationIntent(adapter.readIntent({ plan }));
        if (stored.operationId !== intent.operationId || stored.status === "complete") {
          throw new Error("stored intent changed before rollback reset");
        }
        adapter.writeIntent({ expected: stored, value: createOpenReviewedLaneRehydrationIntent(plan) });
      } catch (rollbackError) {
        throw new Error(`${error.message}; exact local rollback failed closed: ${rollbackError.message}`, { cause: error });
      }
    }
    throw error;
  }
}

function runPhase({ adapter, intent, plan, phase, effect }) {
  let values = adapter.reconcile({ plan, intent, phase });
  if (values && phase !== "lease-recovered") {
    throw new Error(`Open reviewed lane ${phase} effect exists without this operation's durable completion proof.`);
  }
  if (!values) {
    if (!intent.attempts.some(item => item.phase === phase)) {
      const prepared = beginOpenReviewedLaneRehydrationEffect(intent, phase);
      adapter.writeIntent({ expected: intent, value: prepared });
      intent = prepared;
    }
    adapter[effect]({ plan, intent });
    values ||= adapter.reconcile({ plan, intent, phase });
  }
  if (!values) throw new Error(`Open reviewed lane ${phase} effect was not exactly observable.`);
  const next = advanceOpenReviewedLaneRehydrationIntent(intent, phase, values);
  adapter.writeIntent({ expected: intent, value: next });
  return next;
}

function phaseReached(current, target) {
  const order = ["prepared", "branch-created", "worktree-created", "lease-recovered", "complete"];
  return order.indexOf(current) >= order.indexOf(target);
}
