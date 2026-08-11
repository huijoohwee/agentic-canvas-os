// Responsibility: Require stable consecutive evidence before emitting read-only history audit or plan results.

import {
  buildHistoryLifecycleResult,
  buildHistoryLifecyclePlan,
  normalizeHistoryLifecycleEvidence,
} from "./history-lifecycle-contract.mjs";

export function createHistoryLifecycleController({ adapter } = {}) {
  if (!adapter || typeof adapter.captureEvidence !== "function") {
    throw new Error("History lifecycle controller requires captureEvidence().");
  }
  return Object.freeze({
    async audit() {
      const evidence = await captureStableEvidence(adapter);
      return buildHistoryLifecycleResult({ mode: "audit", evidence, plan: null });
    },
    async plan() {
      const evidence = await captureStableEvidence(adapter);
      const plan = buildHistoryLifecyclePlan(evidence);
      return buildHistoryLifecycleResult({ mode: "plan", evidence, plan });
    },
  });
}

async function captureStableEvidence(adapter) {
  const first = normalizeHistoryLifecycleEvidence(await adapter.captureEvidence());
  const second = normalizeHistoryLifecycleEvidence(await (typeof adapter.verifyEvidence === "function"
    ? adapter.verifyEvidence(first)
    : adapter.captureEvidence()));
  if (first.evidenceDigest !== second.evidenceDigest) {
    throw new Error("History lifecycle evidence drifted between consecutive captures.");
  }
  return second;
}
