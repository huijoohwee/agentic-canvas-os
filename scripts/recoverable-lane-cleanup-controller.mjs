// Responsibility: execute one exact-authorized, replay-safe recoverable clean-lane removal.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  advanceRecoverableLaneCleanupIntent,
  authorizeRecoverableLaneCleanup,
  buildRecoverableLaneCleanupPlan,
  buildRecoverableLaneCleanupReceipt,
  createRecoverableLaneCleanupIntent,
  normalizeRecoverableLaneCleanupEvidence,
  normalizeRecoverableLaneCleanupIntent,
  normalizeRecoverableLaneCleanupPlan,
  normalizeRecoverableLaneCleanupReceipt,
} from "./recoverable-lane-cleanup-contract.mjs";

export const RECOVERABLE_LANE_CLEANUP_RESULT_SCHEMA =
  "agentic-recoverable-lane-cleanup-result/v1";

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "captureEvidence",
  "withSubjectFence",
  "readIntent",
  "writeIntent",
  "ensureBundle",
  "verifyBundle",
  "inspectReservation",
  "beginReservation",
  "inspectCleanupState",
  "quarantineWorktree",
  "removeWorktree",
  "releaseReservation",
  "observeFinal",
  "readReceipt",
  "writeReceipt",
]);

export function createRecoverableLaneCleanupController({ adapter } = {}) {
  const runtime = normalizeAdapter(adapter);
  return Object.freeze({
    plan: input => planRecoverableLaneCleanup(input, { adapter: runtime }),
    run: input => runRecoverableLaneCleanup(input, { adapter: runtime }),
    observe: input => observeRecoverableLaneCleanup(input, { adapter: runtime }),
  });
}

export function planRecoverableLaneCleanup(input = {}, { adapter } = {}) {
  const runtime = normalizeAdapter(adapter);
  const evidence = doubleCapture(runtime, input);
  const plan = normalizeRecoverableLaneCleanupPlan(buildRecoverableLaneCleanupPlan({
    evidence,
    recoveryDirectory: input.recoveryDirectory,
    sessionId: input.sessionId,
    operatorDecisionDigest: input.operatorDecisionDigest,
    supersededPreservationDigests: input.supersededPreservationDigests || [],
  }));
  if (input.planDigest && input.planDigest !== plan.planDigest) {
    throw new Error("Requested cleanup plan digest differs from live evidence.");
  }
  return Object.freeze({
    schema: RECOVERABLE_LANE_CLEANUP_RESULT_SCHEMA,
    status: "planned",
    subjectKey: plan.subjectKey,
    planDigest: plan.planDigest,
    exactAuthorization: plan.exactAuthorization,
    plan,
  });
}

export function runRecoverableLaneCleanup(input = {}, { adapter } = {}) {
  const runtime = normalizeAdapter(adapter);
  requiredDigest(input.planDigest, "run plan digest");
  const stored = readIntent(runtime);
  const plan = stored
    ? normalizeRecoverableLaneCleanupIntent(stored).plan
    : planRecoverableLaneCleanup(input, { adapter: runtime }).plan;
  assertInputBound(plan, input, { requireDecision: true });
  if (input.planDigest !== plan.planDigest) {
    throw new Error("Run plan digest differs from the stored or live cleanup plan.");
  }
  const authorization = authorizeRecoverableLaneCleanup({
    plan,
    authorization: input.authorization,
  });
  return runtime.withSubjectFence(plan, () => executeCleanup({
    adapter: runtime,
    authorization,
    input,
    plan,
  }));
}

export function observeRecoverableLaneCleanup(input = {}, { adapter } = {}) {
  const runtime = normalizeAdapter(adapter);
  const rawIntent = readIntent(runtime);
  if (!rawIntent) {
    return Object.freeze({
      schema: RECOVERABLE_LANE_CLEANUP_RESULT_SCHEMA,
      status: "absent",
      planDigest: input.planDigest || null,
      intent: null,
      receipt: null,
    });
  }
  const intent = normalizeRecoverableLaneCleanupIntent(rawIntent);
  if (input.planDigest && input.planDigest !== intent.planDigest) {
    throw new Error("Observed cleanup intent belongs to a different plan.");
  }
  assertInputBound(intent.plan, input, { requireDecision: false });
  const receipt = readReceipt(runtime);
  const normalizedReceipt = receipt
    ? normalizeRecoverableLaneCleanupReceipt(receipt)
    : null;
  assertReceiptBound(intent, normalizedReceipt);
  if ([
    "bundle_verified", "worktree_quarantined", "worktree_removed",
    "reservation_released", "complete",
  ].includes(intent.status)) {
    runtime.verifyBundle(intent.plan, intent.phases.bundle_verified.bundle);
  }
  if (["reservation_released", "complete"].includes(intent.status)) {
    assertFinalObservation(
      intent.plan,
      runtime.observeFinal(intent.plan),
      intent.phases.worktree_removed,
    );
  }
  if (intent.status === "complete") {
    verifyCompletedState(runtime, intent.plan, normalizedReceipt);
  }
  return result(intent, normalizedReceipt);
}

function executeCleanup({ adapter, authorization, input, plan }) {
  let intent = readIntent(adapter);
  if (intent) {
    intent = normalizeRecoverableLaneCleanupIntent(intent);
    assertIntentBound(intent, plan, authorization);
  } else {
    const livePlan = planRecoverableLaneCleanup(input, { adapter }).plan;
    if (canonicalJson(livePlan) !== canonicalJson(plan)) {
      throw new Error("Cleanup evidence drifted before the subject fence was acquired.");
    }
    intent = createRecoverableLaneCleanupIntent({ plan, authorization });
    intent = persistIntent(adapter, null, intent);
  }

  let receipt = readReceipt(adapter);
  if (receipt) receipt = normalizeRecoverableLaneCleanupReceipt(receipt);

  if (intent.status === "prepared") {
    let reservation = adapter.inspectReservation(
      plan, authorization.authorizationDigest,
    );
    const bundle = adapter.ensureBundle(plan);
    adapter.verifyBundle(plan, bundle);
    reservation ||= adapter.beginReservation(
      plan, authorization.authorizationDigest,
    );
    const beforeQuarantine = adapter.inspectCleanupState(plan);
    const next = advanceRecoverableLaneCleanupIntent(intent, {
      status: "bundle_verified",
      evidence: {
        bundle,
        reservation,
        quarantineStateDigest: digestValue(beforeQuarantine),
      },
    });
    intent = persistIntent(adapter, intent, next);
  }

  if (intent.status === "bundle_verified") {
    const bundle = intent.phases.bundle_verified.bundle;
    adapter.verifyBundle(plan, bundle);
    adapter.verifyBundle(plan, bundle);
    const quarantine = adapter.quarantineWorktree(
      plan, intent.phases.bundle_verified.reservation,
    );
    const next = advanceRecoverableLaneCleanupIntent(intent, {
      status: "worktree_quarantined",
      evidence: {
        ...quarantine,
        removalStateDigest: digestValue(quarantine),
      },
    });
    intent = persistIntent(adapter, intent, next);
  }

  if (intent.status === "worktree_quarantined") {
    const bundle = intent.phases.bundle_verified.bundle;
    adapter.verifyBundle(plan, bundle);
    const removal = adapter.removeWorktree(
      plan,
      intent.phases.bundle_verified.reservation,
      intent.phases.worktree_quarantined,
    );
    const next = advanceRecoverableLaneCleanupIntent(intent, {
      status: "worktree_removed",
      evidence: removal,
    });
    intent = persistIntent(adapter, intent, next);
  }

  if (intent.status === "worktree_removed") {
    const bundle = intent.phases.bundle_verified.bundle;
    adapter.verifyBundle(plan, bundle);
    const beforeRelease = adapter.observeFinal(plan);
    const release = adapter.releaseReservation(
      plan,
      intent.phases.bundle_verified.reservation,
      beforeRelease,
    );
    const next = advanceRecoverableLaneCleanupIntent(intent, {
      status: "reservation_released",
      evidence: { release },
    });
    intent = persistIntent(adapter, intent, next);
  }

  if (intent.status === "reservation_released") {
    const bundle = intent.phases.bundle_verified.bundle;
    adapter.verifyBundle(plan, bundle);
    const finalObservation = adapter.observeFinal(plan);
    const candidate = buildRecoverableLaneCleanupReceipt({
      intent,
      bundle,
      finalObservation,
    });
    receipt = receipt
      ? requireSameReceipt(receipt, candidate)
      : persistReceipt(adapter, candidate);
    const next = advanceRecoverableLaneCleanupIntent(intent, {
      status: "complete",
      evidence: { receiptDigest: receipt.receiptDigest },
    });
    intent = persistIntent(adapter, intent, next);
  }

  if (intent.status !== "complete") {
    throw new Error(`Cleanup stopped in unexpected phase ${intent.status}.`);
  }
  receipt ||= readReceipt(adapter);
  if (!receipt) throw new Error("Complete cleanup intent has no receipt.");
  receipt = normalizeRecoverableLaneCleanupReceipt(receipt);
  assertIntentBound(intent, plan, authorization);
  assertReceiptBound(intent, receipt);
  verifyCompletedState(adapter, plan, receipt);
  return result(intent, receipt);
}

function verifyCompletedState(adapter, plan, receipt) {
  if (!receipt) throw new Error("Complete cleanup state has no receipt to verify.");
  adapter.verifyBundle(plan, receipt.bundle);
  const finalObservation = assertFinalObservation(
    plan, adapter.observeFinal(plan), receipt.finalObservation,
  );
  if (canonicalJson(finalObservation) !== canonicalJson(receipt.finalObservation)) {
    throw new Error("Live cleanup state differs from its completion receipt.");
  }
}

function assertFinalObservation(plan, value, snapshots) {
  const expected = {
    targetRegistered: false,
    targetExists: false,
    stagingRegistered: false,
    stagingExists: false,
    snapshotExists: true,
    snapshotDigest: snapshots.snapshotDigest,
    snapshotGenerationDigest: snapshots.snapshotGenerationDigest,
    gitDirSnapshotExists: true,
    gitDirSnapshotDigest: snapshots.gitDirSnapshotDigest,
    gitDirSnapshotGenerationDigest: snapshots.gitDirSnapshotGenerationDigest,
    disposableGitDirExists: false,
    priorLeaseRestored: true,
    canonicalHeadSha: plan.evidence.canonical.headSha,
    branchHeadSha: plan.evidence.target.branchHeadSha,
    remoteBranchSha: plan.evidence.remoteBranch.sha,
  };
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("Cleanup final state drifted or the target path was recreated.");
  }
  return value;
}

function assertInputBound(plan, input, { requireDecision }) {
  const fields = [
    ["repository", plan.evidence.repository.root],
    ["worktree", plan.evidence.target.worktreePath],
    ["recoveryDirectory", plan.recovery.directory],
  ];
  if (requireDecision) {
    fields.push(
      ["sessionId", plan.sessionId],
      ["operatorDecisionDigest", plan.operatorDecisionDigest],
    );
  }
  for (const [name, expected] of fields) {
    if (input[name] !== expected) {
      throw new Error(`Cleanup input ${name} differs from the stored plan.`);
    }
  }
  if (requireDecision) {
    const observed = [...(input.supersededPreservationDigests || [])].sort();
    if (canonicalJson(observed) !== canonicalJson(plan.supersededPreservationDigests)) {
      throw new Error("Cleanup input preservation receipts differ from the stored plan.");
    }
  }
}

function doubleCapture(adapter, input) {
  const first = normalizeRecoverableLaneCleanupEvidence(adapter.captureEvidence(input));
  const second = normalizeRecoverableLaneCleanupEvidence(adapter.captureEvidence(input));
  if (canonicalJson(first) !== canonicalJson(second)) {
    throw new Error("Cleanup evidence changed between consecutive read-only captures.");
  }
  return first;
}

function persistIntent(adapter, expected, next) {
  const written = normalizeRecoverableLaneCleanupIntent(adapter.writeIntent(expected, next));
  if (canonicalJson(written) !== canonicalJson(next)) {
    throw new Error("Cleanup intent storage did not preserve exact bytes.");
  }
  return written;
}

function persistReceipt(adapter, next) {
  const written = normalizeRecoverableLaneCleanupReceipt(adapter.writeReceipt(next));
  if (canonicalJson(written) !== canonicalJson(next)) {
    throw new Error("Cleanup receipt storage did not preserve exact bytes.");
  }
  return written;
}

function readIntent(adapter) {
  const value = adapter.readIntent();
  return value ? normalizeRecoverableLaneCleanupIntent(value) : null;
}

function readReceipt(adapter) {
  const value = adapter.readReceipt();
  return value ? normalizeRecoverableLaneCleanupReceipt(value) : null;
}

function assertIntentBound(intent, plan, authorization) {
  if (canonicalJson(intent.plan) !== canonicalJson(plan)
    || intent.authorizationDigest !== authorization.authorizationDigest) {
    throw new Error("Stored cleanup intent differs from the authorized plan.");
  }
}

function assertReceiptBound(intent, receipt) {
  if (!receipt) {
    if (intent.status === "complete") throw new Error("Complete cleanup intent has no receipt.");
    return;
  }
  if (receipt.planDigest !== intent.planDigest
    || receipt.subjectKey !== intent.subjectKey
    || receipt.authorizationDigest !== intent.authorizationDigest) {
    throw new Error("Cleanup receipt differs from its intent.");
  }
  if (intent.status === "complete"
    && intent.phases.complete.receiptDigest !== receipt.receiptDigest) {
    throw new Error("Complete cleanup intent names a different receipt.");
  }
}

function requireSameReceipt(existing, candidate) {
  if (canonicalJson(existing) !== canonicalJson(candidate)) {
    throw new Error("Stored cleanup receipt conflicts with the recomputed receipt.");
  }
  return existing;
}

function result(intent, receipt) {
  return Object.freeze({
    schema: RECOVERABLE_LANE_CLEANUP_RESULT_SCHEMA,
    status: intent.status,
    subjectKey: intent.subjectKey,
    planDigest: intent.planDigest,
    intent,
    receipt,
  });
}

function normalizeAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") throw new Error("Cleanup controller requires an adapter.");
  for (const name of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter[name] !== "function") throw new Error(`Cleanup adapter requires ${name}().`);
  }
  return adapter;
}

function requiredDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return value;
}
