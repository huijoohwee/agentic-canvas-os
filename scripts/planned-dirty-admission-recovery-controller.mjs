// Responsibility: Orchestrate one exact-authorized, replay-safe planned-dirty admission repair.
import {
  advanceRecoveryIntent,
  authorizePlannedDirtyAdmissionRecovery,
  buildCompletionReceipt,
  buildPlannedDirtyAdmissionRecoveryPlan,
  createRecoveryIntent,
  normalizePlannedDirtyAdmissionRecoveryPlan,
  normalizeRecoveryIntent,
  stableTerminalEvidenceDigest,
} from "./planned-dirty-admission-recovery-contract.mjs";

const REQUIRED_METHODS = Object.freeze([
  "readEvidence",
  "assertSource",
  "authorizeTask",
  "projectRegistry",
  "projectPullRequestMarker",
  "verifyTerminal",
  "readIntent",
  "writeIntent",
  "withOperationLock",
]);

export function createPlannedDirtyAdmissionRecoveryController(adapter) {
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Planned-dirty admission recovery adapter requires ${method}().`);
    }
  }
  return Object.freeze({
    async plan() {
      return buildPlannedDirtyAdmissionRecoveryPlan({
        evidence: await adapter.readEvidence(),
      });
    },
    async run({ plan, authorization } = {}) {
      const sealed = normalizePlannedDirtyAdmissionRecoveryPlan(plan);
      return adapter.withOperationLock(
        sealed,
        () => runLocked(adapter, sealed, authorization),
      );
    },
  });
}

async function runLocked(adapter, plan, authorization) {
  let intent = await adapter.readIntent(plan);
  if (!intent) {
    const authorized = authorizePlannedDirtyAdmissionRecovery(plan, authorization);
    await adapter.assertSource(plan, "before-task-authorization");
    const taskAuthority = await requireValues(
      adapter.authorizeTask(plan),
      "task authorization",
    );
    intent = createRecoveryIntent({ plan, authorization: authorized, taskAuthority });
    await adapter.writeIntent({ expected: null, next: intent, plan });
  } else {
    intent = normalizeRecoveryIntent(intent);
    if (intent.planDigest !== plan.planDigest) {
      throw new Error("Recovery journal belongs to another planned-dirty admission plan.");
    }
  }

  if (intent.status === "complete") {
    await adapter.assertSource(plan, "before-terminal-replay");
    const current = await requireValues(
      adapter.verifyTerminal({ plan, intent, replay: true }),
      "terminal replay verification",
    );
    if (stableTerminalEvidenceDigest(current)
      !== stableTerminalEvidenceDigest(intent.phases.complete.values)) {
      throw new Error("Planned-dirty admission recovery terminal evidence drifted on replay.");
    }
    return buildCompletionReceipt(intent);
  }

  if (intent.status === "authorized") {
    await adapter.assertSource(plan, "before-registry-projection");
    intent = await step(adapter, plan, intent, "registry-projected", () =>
      adapter.projectRegistry({ plan, intent }));
  }
  if (intent.status === "registry-projected") {
    await adapter.assertSource(plan, "before-pr-marker-projection");
    intent = await step(adapter, plan, intent, "pr-marker-projected", () =>
      adapter.projectPullRequestMarker({ plan, intent }));
  }
  if (intent.status === "pr-marker-projected") {
    await adapter.assertSource(plan, "before-terminal-verification");
    intent = await step(adapter, plan, intent, "complete", () =>
      adapter.verifyTerminal({ plan, intent, replay: false }));
  }
  if (intent.status !== "complete") {
    throw new Error("Planned-dirty admission recovery did not complete.");
  }
  return buildCompletionReceipt(intent);
}

async function step(adapter, plan, intent, status, action) {
  const values = await requireValues(action(), status);
  const next = advanceRecoveryIntent(intent, { status, values });
  await adapter.writeIntent({ expected: intent, next, plan });
  return next;
}

async function requireValues(promise, label) {
  const value = await promise;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Planned-dirty admission recovery ${label} returned no receipt values.`);
  }
  return value;
}
