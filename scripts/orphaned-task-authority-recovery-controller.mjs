// Responsibility: Orchestrate the exact orphaned task-authority recovery phase chain.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  ORPHANED_TASK_AUTHORITY_RESULT_SCHEMA,
  advanceOrphanedTaskAuthorityRecoveryIntent,
  authorizeOrphanedTaskAuthorityRecovery,
  createOrphanedTaskAuthorityRecoveryIntent,
  createOrphanedTaskAuthorityRecoveryPlan,
  normalizeOrphanedTaskAuthorityRecoveryIntent,
  normalizeOrphanedTaskAuthorityRecoveryPlan,
} from "./orphaned-task-authority-recovery-contract.mjs";

export async function planOrphanedTaskAuthorityRecovery(input, { adapter } = {}) {
  requireAdapter(adapter);
  const first = await adapter.captureSource();
  const second = await adapter.captureSource();
  if (digestValue(first) !== digestValue(second)) {
    throw new Error("Recovery source changed during read-only planning.");
  }
  return createOrphanedTaskAuthorityRecoveryPlan({
    ...input,
    source: first,
    targetCapability: await adapter.readTargetCapabilityProjection(),
  });
}

export async function runOrphanedTaskAuthorityRecovery({ plan, authorization }, {
  adapter,
  journalStore,
} = {}) {
  requireAdapter(adapter);
  if (!journalStore || typeof journalStore.read !== "function"
    || typeof journalStore.write !== "function") {
    throw new Error("Recovery controller requires a durable journal store.");
  }
  const normalizedPlan = normalizeOrphanedTaskAuthorityRecoveryPlan(plan);
  const decision = authorizeOrphanedTaskAuthorityRecovery(normalizedPlan, authorization);
  let intent = journalStore.read();
  if (intent) {
    intent = normalizeOrphanedTaskAuthorityRecoveryIntent(intent);
    requireIntentIdentity(intent, normalizedPlan, decision);
    if (intent.phase === "complete") return intent.completion;
  } else {
    const first = await adapter.captureSource();
    const second = await adapter.captureSource();
    if (digestValue(first) !== digestValue(normalizedPlan.source)
      || digestValue(second) !== digestValue(normalizedPlan.source)) {
      throw new Error("Recovery source drifted from the authorized plan.");
    }
    intent = journalStore.write(createOrphanedTaskAuthorityRecoveryIntent({
      plan: normalizedPlan,
      authorization,
    }));
  }

  const target = await adapter.createTargetBinding(normalizedPlan);
  if (target?.binding?.bindingDigest === undefined
    || target?.proofReceipt?.receiptDigest === undefined) {
    throw new Error("Replacement capability proof returned no exact target binding.");
  }

  if (intent.phase === "prepared") {
    await adapter.assertSourceCurrent(normalizedPlan.source);
    const snapshot = normalizedPlan.source.git.kind === "dirty"
      ? await adapter.createSnapshot(normalizedPlan)
      : receipt("snapshot-not-required", {
        gitEvidenceDigest: normalizedPlan.source.git.evidenceDigest,
      });
    intent = writeNext(journalStore, intent, "snapshotted", snapshot);
  }

  if (intent.phase === "snapshotted") {
    await adapter.assertSourceCurrent(normalizedPlan.source);
    let localReceipt;
    try {
      localReceipt = await adapter.replaceLocalBinding(normalizedPlan, target);
    } catch (error) {
      localReceipt = await adapter.observeLocalBinding(normalizedPlan, target);
      if (!localReceipt) throw error;
    }
    intent = writeNext(journalStore, intent, "local-cas", localReceipt, {
      targetBindingDigest: target.binding.bindingDigest,
    });
  }

  if (intent.phase === "local-cas") {
    const attempt = receipt("pull-request-projection-attempt", {
      planDigest: normalizedPlan.planDigest,
      targetBindingDigest: target.binding.bindingDigest,
      operationKey: digestValue({
        operation: "orphaned-task-authority-pr-projection",
        planDigest: normalizedPlan.planDigest,
        targetBindingDigest: target.binding.bindingDigest,
      }),
    });
    intent = writeNext(journalStore, intent, "pr-attempted", attempt);
  }

  if (intent.phase === "pr-attempted") {
    let projection;
    try {
      projection = await adapter.projectPullRequest(normalizedPlan, target);
    } catch (error) {
      projection = await adapter.observePullRequestProjection(normalizedPlan, target);
      if (!projection) throw error;
    }
    intent = writeNext(journalStore, intent, "pr-projected", projection);
  }

  if (intent.phase === "pr-projected") {
    const terminal = await adapter.verifyTerminal(normalizedPlan, target);
    intent = writeNext(journalStore, intent, "verified", terminal);
  }

  if (intent.phase === "verified") {
    const completionCore = {
      schema: ORPHANED_TASK_AUTHORITY_RESULT_SCHEMA,
      status: "complete",
      planDigest: normalizedPlan.planDigest,
      sourceBindingDigest: normalizedPlan.source.taskAuthority.bindingDigest,
      targetBindingDigest: target.binding.bindingDigest,
      sourceBytesChanged: false,
      cloudMutated: false,
      merged: false,
      deployed: false,
      phaseReceiptDigests: Object.fromEntries(Object.entries(intent.receipts)
        .map(([phase, value]) => [phase, value.receiptDigest])),
    };
    const completion = Object.freeze({
      ...completionCore,
      resultDigest: digestValue(completionCore),
    });
    const completeReceipt = receipt("complete", { resultDigest: completion.resultDigest });
    intent = writeNext(journalStore, intent, "complete", completeReceipt, { completion });
  }
  return intent.completion;
}

function writeNext(store, intent, phase, phaseReceipt, values = {}) {
  return store.write(advanceOrphanedTaskAuthorityRecoveryIntent(intent, {
    phase,
    receipt: phaseReceipt,
    ...values,
  }));
}

function receipt(kind, payload) {
  const core = { schema: "agentic-orphaned-task-authority-phase-receipt/v1", kind, payload };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function requireIntentIdentity(intent, plan, decision) {
  if (intent.planDigest !== plan.planDigest
    || intent.authorizationDigest !== decision.authorizationDigest
    || intent.sourceLeaseDigest !== plan.source.leaseDigest
    || intent.sourceBindingDigest !== plan.source.taskAuthority.bindingDigest
    || intent.targetSubjectId !== plan.targetCapability.authoritySubjectId) {
    throw new Error("Recovery journal belongs to another exact incident plan.");
  }
}

function requireAdapter(adapter) {
  const methods = [
    "captureSource", "readTargetCapabilityProjection", "assertSourceCurrent",
    "createSnapshot", "createTargetBinding", "replaceLocalBinding",
    "observeLocalBinding", "projectPullRequest", "observePullRequestProjection",
    "verifyTerminal",
  ];
  if (!adapter || methods.some(method => typeof adapter[method] !== "function")) {
    throw new Error("Recovery controller adapter is incomplete.");
  }
}
