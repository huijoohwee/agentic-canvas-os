// Responsibility: Durably converge duplicate-PR closure before preserved local lease release.
import {
  advanceIntent,
  authorizePlan,
  buildPlan,
  buildTerminalReceipt,
  createAuthorizationIntent,
  normalizeIntent,
  normalizePlan,
  normalizeTerminalEvidence,
  operationForPlan,
  phaseReceipt,
} from "./integrated-source-duplicate-pr-reconciliation-contract.mjs";
import { canonicalJson } from "./cloud-collaboration-primitives.mjs";

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "captureEvidence",
  "readState",
  "writeState",
  "withLock",
  "verifyTaskAuthority",
  "reverify",
  "classifyPullRequest",
  "closePullRequest",
  "prepareLeaseRelease",
  "classifyLeaseRelease",
  "releaseLease",
  "readTerminalEvidence",
]);

export function createIntegratedSourceDuplicatePrReconciliationController({ adapter } = {}) {
  requireAdapter(adapter);
  return Object.freeze({
    async plan() {
      return buildPlan(await adapter.captureEvidence());
    },

    async run({ plan, authorization } = {}) {
      const sealed = normalizePlan(plan);
      const authorizationReceipt = authorizePlan(sealed, authorization);
      return adapter.withLock(
        { operation: sealed.operation, planDigest: sealed.planDigest },
        async () => execute({ adapter, plan: sealed, authorization, authorizationReceipt }),
      );
    },
  });
}

async function execute({ adapter, plan, authorization, authorizationReceipt }) {
  let intent = await adapter.readState();
  if (intent === null || intent === undefined) {
    const initial = createAuthorizationIntent({ plan, authorization });
    intent = await persist(adapter, null, initial);
  } else {
    intent = normalizeIntent(intent);
    if (intent.planDigest !== plan.planDigest
      || canonicalJson(intent.planSnapshot) !== canonicalJson(plan)) {
      throw new Error("Persisted duplicate-PR reconciliation belongs to another plan.");
    }
  }

  if (intent.phase === "complete") {
    return verifyCompleteReplay({ adapter, intent });
  }

  if (intent.phase === "authorized") {
    await adapter.reverify(plan, "before-task-authority-verification");
    const taskAuthorityReceipt = await adapter.verifyTaskAuthority(
      plan,
      operationForPlan(plan, "pull-request-close"),
    );
    await adapter.reverify(plan, "after-task-authority-verification");
    intent = await advance(adapter, intent, "task-authority-verified", {
      taskAuthorityReceipt,
      taskAuthorityReceiptDigest: authorityReceiptDigest(taskAuthorityReceipt),
    });
  }

  if (intent.phase === "task-authority-verified") {
    await adapter.reverify(plan, "before-close-intent");
    intent = await advance(adapter, intent, "close-intent", {
      operationKey: operationForPlan(plan, "pull-request-close"),
      taskAuthorityReceiptDigest:
        intent.receipts["task-authority-verified"].values.taskAuthorityReceiptDigest,
    });
  }

  if (intent.phase === "close-intent") {
    await adapter.reverify(plan, "before-pull-request-close");
    const closed = await converge({
      classify: () => adapter.classifyPullRequest(plan),
      effect: () => adapter.closePullRequest(plan),
      label: "duplicate pull-request closure",
    });
    await adapter.reverify(plan, "after-pull-request-close");
    intent = await advance(adapter, intent, "pull-request-closed", closed);
  }

  if (intent.phase === "pull-request-closed") {
    await adapter.reverify(plan, "before-lease-release-preparation");
    const taskAuthorityReceipt = await adapter.verifyTaskAuthority(
      plan,
      operationForPlan(plan, "local-lease-release"),
    );
    const releaseProjection = await adapter.prepareLeaseRelease(plan, {
      authorizationReceipt,
      taskAuthorityReceipt,
      pullRequestReceipt: intent.receipts["pull-request-closed"],
    });
    await adapter.reverify(plan, "after-lease-release-preparation");
    intent = await advance(adapter, intent, "release-intent", {
      operationKey: operationForPlan(plan, "local-lease-release"),
      taskAuthorityReceipt,
      taskAuthorityReceiptDigest: authorityReceiptDigest(taskAuthorityReceipt),
      pullRequestReceiptDigest: intent.receipts["pull-request-closed"].receiptDigest,
      releaseProjection,
    });
  }

  if (intent.phase === "release-intent") {
    const releaseProjection = intent.receipts["release-intent"].values.releaseProjection;
    await adapter.reverify(plan, "before-local-lease-release");
    const released = await converge({
      classify: () => adapter.classifyLeaseRelease(plan, releaseProjection),
      effect: () => adapter.releaseLease(plan, releaseProjection),
      label: "preserved local lease release",
    });
    await adapter.reverify(plan, "after-local-lease-release");
    intent = await advance(adapter, intent, "lease-released", released);
  }

  if (intent.phase === "lease-released") {
    const terminalEvidence = await finalDoubleRead({ adapter, intent });
    const receipt = buildTerminalReceipt({ intent, terminalEvidence });
    intent = await advance(adapter, intent, "complete", { receipt, terminalEvidence });
  }

  if (intent.phase !== "complete") {
    throw new Error(`Duplicate-PR reconciliation stopped at ${intent.phase}.`);
  }
  return intent.receipts.complete.values.receipt;
}

async function verifyCompleteReplay({ adapter, intent }) {
  const terminalEvidence = await finalDoubleRead({ adapter, intent });
  const expected = buildTerminalReceipt({ intent, terminalEvidence });
  const recorded = intent.receipts.complete.values.receipt;
  if (canonicalJson(recorded) !== canonicalJson(expected)) {
    throw new Error("Completed duplicate-PR reconciliation receipt drifted.");
  }
  return recorded;
}

async function finalDoubleRead({ adapter, intent }) {
  const plan = intent.planSnapshot;
  const releaseProjection = intent.receipts["release-intent"].values.releaseProjection;
  await adapter.reverify(plan, "before-final-double-read");
  const first = normalizeTerminalEvidence(
    await adapter.readTerminalEvidence(plan, releaseProjection),
    plan,
  );
  const second = normalizeTerminalEvidence(
    await adapter.readTerminalEvidence(plan, releaseProjection),
    plan,
  );
  if (canonicalJson(first) !== canonicalJson(second)) {
    throw new Error("Terminal reconciliation evidence was not stable across the final double read.");
  }
  return first;
}

async function advance(adapter, intent, phase, values) {
  const receipt = phaseReceipt({ plan: intent.planSnapshot, phase, values });
  const next = advanceIntent({ intent, phase, receipt });
  return persist(adapter, intent, next);
}

async function persist(adapter, expected, next) {
  const normalizedNext = normalizeIntent(next);
  const written = await adapter.writeState({ expected, next: normalizedNext });
  if (written === null || written === undefined) return normalizedNext;
  normalizeIntent(written);
  return written;
}

async function converge({ classify, effect, label }) {
  const before = normalizeClassification(await classify(), label);
  if (before.state === "complete") return before.values;
  let failure = null;
  try {
    await effect();
  } catch (error) {
    failure = error;
  }
  const after = normalizeClassification(await classify(), label);
  if (after.state === "complete") return after.values;
  if (failure) throw failure;
  throw new Error(`${label} did not converge to its exact terminal projection.`);
}

function normalizeClassification(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["pending", "complete"].includes(value.state)) {
    throw new Error(`${label} classification is invalid.`);
  }
  if (value.state === "pending") {
    if (Object.keys(value).length !== 1) {
      throw new Error(`${label} pending classification has unexpected fields.`);
    }
    return Object.freeze({ state: "pending" });
  }
  if (Object.keys(value).sort().join("\0") !== ["state", "values"].sort().join("\0")
    || !value.values || typeof value.values !== "object" || Array.isArray(value.values)) {
    throw new Error(`${label} terminal classification is invalid.`);
  }
  return Object.freeze({ state: "complete", values: structuredClone(value.values) });
}

function authorityReceiptDigest(value) {
  const result = value?.receiptDigest ?? value?.taskAuthorityReceiptDigest;
  if (!/^[0-9a-f]{64}$/u.test(String(result || ""))) {
    throw new Error("Task-authority verification returned no exact receipt digest.");
  }
  return result;
}

function requireAdapter(adapter) {
  for (const method of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Integrated-source duplicate-PR reconciliation adapter requires ${method}().`);
    }
  }
}
