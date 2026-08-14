// Responsibility: Replay one receipt-bound inner rehydration while preserving its waiting queue.
import {
  authorizeOpenReviewedLaneQueuePreservation,
  buildOpenReviewedLaneQueuePreservationPlan,
  buildOpenReviewedLaneQueuePreservationReceipt,
  completeOpenReviewedLaneQueuePreservationIntent,
  createOpenReviewedLaneQueuePreservationIntent,
  normalizeOpenReviewedLaneQueuePreservationInnerReceipt,
  normalizeOpenReviewedLaneQueuePreservationIntent,
  recordOpenReviewedLaneQueuePreservationInnerReceipt,
} from "./open-reviewed-lane-queue-preservation-contract.mjs";

const REQUIRED_METHODS = Object.freeze([
  "readPlanEvidence",
  "withOperationLock",
  "readIntent",
  "writeIntent",
  "revalidate",
  "runInner",
  "verifyTerminal",
]);

export function createOpenReviewedLaneQueuePreservationController({ adapter } = {}) {
  for (const name of REQUIRED_METHODS) {
    if (typeof adapter?.[name] !== "function") {
      throw new Error(`Open reviewed lane queue preservation adapter requires ${name}().`);
    }
  }
  return Object.freeze({
    plan() {
      return buildOpenReviewedLaneQueuePreservationPlan(adapter.readPlanEvidence());
    },
    run({ plan, authorization } = {}) {
      const authorized = authorizeOpenReviewedLaneQueuePreservation(plan, authorization);
      const operationId = createOpenReviewedLaneQueuePreservationIntent(authorized).operationId;
      return adapter.withOperationLock({ operationId, plan: authorized }, () => runLocked({
        adapter,
        plan: authorized,
      }));
    },
  });
}

function runLocked({ adapter, plan }) {
  let intent = readExactIntent(adapter, plan);
  if (!intent) {
    intent = createOpenReviewedLaneQueuePreservationIntent(plan);
    adapter.writeIntent({ expected: null, value: intent });
  }
  if (intent.planDigest !== plan.planDigest) {
    throw new Error("Stored queue-preservation intent differs from the authorized plan.");
  }
  if (intent.status === "complete") {
    verifyCompleted({ adapter, plan, intent });
    return intent.receipt;
  }
  if (intent.status === "prepared") {
    adapter.revalidate({ plan, intent, stage: "before-inner" });
    const innerReceipt = normalizeOpenReviewedLaneQueuePreservationInnerReceipt(plan,
      adapter.runInner({
        outerPlan: plan,
        outerIntent: intent,
        plan: plan.evidence.innerPlan,
        authorization: plan.evidence.innerPlan.exactAuthorization,
      }));
    const next = recordOpenReviewedLaneQueuePreservationInnerReceipt(intent, innerReceipt);
    adapter.writeIntent({ expected: intent, value: next });
    intent = next;
  }
  const verifiedInnerReceipt = normalizeOpenReviewedLaneQueuePreservationInnerReceipt(plan,
    adapter.verifyTerminal({ plan, intent, innerReceipt: intent.innerReceipt }));
  if (verifiedInnerReceipt.receiptDigest !== intent.innerReceipt.receiptDigest) {
    throw new Error("Queue-preservation terminal revalidation returned a different inner receipt.");
  }
  adapter.revalidate({ plan, intent, stage: "after-inner" });
  const receipt = buildOpenReviewedLaneQueuePreservationReceipt({ intent });
  const complete = completeOpenReviewedLaneQueuePreservationIntent(intent, receipt);
  adapter.writeIntent({ expected: intent, value: complete });
  return receipt;
}

function verifyCompleted({ adapter, plan, intent }) {
  const verifiedInnerReceipt = normalizeOpenReviewedLaneQueuePreservationInnerReceipt(plan,
    adapter.verifyTerminal({ plan, intent, innerReceipt: intent.innerReceipt }));
  if (verifiedInnerReceipt.receiptDigest !== intent.innerReceipt.receiptDigest) {
    throw new Error("Completed queue-preservation inner receipt no longer matches its terminal projection.");
  }
  adapter.revalidate({ plan, intent, stage: "after-inner" });
}

function readExactIntent(adapter, plan) {
  const stored = adapter.readIntent({ plan });
  return stored === null || stored === undefined
    ? null
    : normalizeOpenReviewedLaneQueuePreservationIntent(stored);
}
