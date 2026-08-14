// Responsibility: replay one exact-authorized successor projection under a live entrypoint fence.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  TASK_AUTHORITY_SUCCESSOR_PROJECTION_REPAIR_PHASES as PHASES,
  advanceTaskAuthoritySuccessorProjectionRepairIntent,
  authorizeTaskAuthoritySuccessorProjectionRepair,
  buildTaskAuthoritySuccessorProjectionRepairPlan,
  buildTaskAuthoritySuccessorProjectionRepairReceipt,
  createTaskAuthoritySuccessorProjectionRepairIntent,
  normalizeTaskAuthoritySuccessorProjectionRepairIntent,
  normalizeTaskAuthoritySuccessorProjectionRepairPhaseReceipt,
  normalizeTaskAuthoritySuccessorProjectionRepairPlan,
} from "./task-authority-successor-projection-repair-contract.mjs";

const EFFECTS = Object.freeze({
  projection_prepared: "prepareProjection",
  successor_promoted: "promoteSuccessor",
  successor_bound: "bindSuccessor",
  lease_projected: "projectLease",
  marker_projected: "projectMarker",
  expansion_finalized: "finalizeExpansion",
  verified: "verifyTerminal",
});
const REQUIRED_METHODS = Object.freeze([
  "readEvidence", "withEntrypointFence", "readIntent", "writeIntent",
  "revalidate", "reconcilePhase", "assertIrreversibilityBarrier",
  ...new Set(Object.values(EFFECTS)), "archiveComplete",
]);
const ARCHIVE_SCHEMA =
  "agentic-task-authority-successor-projection-repair-archive/v1";

export function createTaskAuthoritySuccessorProjectionRepairController({
  adapter,
  dependencies = {},
} = {}) {
  requireAdapter(adapter);
  const contract = Object.freeze({
    buildPlan: dependencies.buildPlan || buildTaskAuthoritySuccessorProjectionRepairPlan,
    normalizePlan: dependencies.normalizePlan
      || normalizeTaskAuthoritySuccessorProjectionRepairPlan,
    authorize: dependencies.authorize || authorizeTaskAuthoritySuccessorProjectionRepair,
    createIntent: dependencies.createIntent
      || createTaskAuthoritySuccessorProjectionRepairIntent,
    normalizeIntent: dependencies.normalizeIntent
      || normalizeTaskAuthoritySuccessorProjectionRepairIntent,
    normalizePhaseReceipt: dependencies.normalizePhaseReceipt
      || normalizeTaskAuthoritySuccessorProjectionRepairPhaseReceipt,
    advanceIntent: dependencies.advanceIntent
      || advanceTaskAuthoritySuccessorProjectionRepairIntent,
    buildReceipt: dependencies.buildReceipt
      || buildTaskAuthoritySuccessorProjectionRepairReceipt,
  });
  const plan = async () => contract.buildPlan(await adapter.readEvidence());
  const run = async ({ plan: suppliedPlan, authorization } = {}) => {
    const supplied = contract.normalizePlan(suppliedPlan);
    const live = contract.normalizePlan(await plan());
    if (canonicalJson(live) !== canonicalJson(supplied)) {
      throw new Error("Successor-projection repair evidence changed after planning.");
    }
    const authority = contract.authorize(supplied, authorization);
    return adapter.withEntrypointFence({ plan: supplied, planDigest: supplied.planDigest }, () => runLocked({
      adapter, authority, contract, plan: supplied,
    }));
  };
  return Object.freeze({ plan, run });
}

async function runLocked({ adapter, authority, contract, plan }) {
  let intent = await adapter.readIntent({ plan });
  if (!intent) {
    await adapter.revalidate({ plan, intent: null, phase: "prepared" });
    const prepared = contract.createIntent(plan, authority);
    intent = await persistIntent({
      adapter, contract, plan, expected: null, value: prepared,
    });
  }
  intent = contract.normalizeIntent(intent);
  if (intent.planDigest !== plan.planDigest) {
    throw new Error("Stored successor-projection repair belongs to another plan.");
  }
  if (intent.status === "complete") {
    await finishArchive({ adapter, contract, intent, plan });
    return intent.receipt;
  }

  for (const phase of PHASES.slice(1, -1)) {
    if (reached(intent.status, phase)) continue;
    const receipt = await resolvePhase({ adapter, intent, phase, plan });
    const next = contract.advanceIntent(intent, phase, receipt);
    intent = await persistIntent({
      adapter, contract, plan, expected: intent, value: next,
    });
  }

  const completionReceipt = contract.buildReceipt({
    intent,
    verified: intent.phases.verified,
  });
  const complete = contract.advanceIntent(intent, "complete", completionReceipt);
  intent = await persistIntent({
    adapter, contract, plan, expected: intent, value: complete,
  });
  await finishArchive({ adapter, contract, intent, plan });
  return intent.receipt;
}

async function persistIntent({ adapter, contract, expected, plan, value }) {
  const candidate = contract.normalizeIntent(value);
  const persisted = contract.normalizeIntent(await adapter.writeIntent({
    plan, expected, value: candidate,
  }));
  if (canonicalJson(persisted) !== canonicalJson(candidate)) {
    throw new Error("Successor-projection repair journal changed during CAS persistence.");
  }
  return persisted;
}

async function resolvePhase({ adapter, intent, phase, plan }) {
  let observed = await adapter.reconcilePhase({ plan, intent, phase });
  if (observed) return observed;
  await adapter.revalidate({ plan, intent, phase });
  if (isIrreversible(phase)) {
    await adapter.assertIrreversibilityBarrier({ plan, intent, phase });
  }
  const effect = EFFECTS[phase];
  if (!effect) throw new Error(`Unsupported successor-projection repair phase: ${phase}.`);
  let failure = null;
  try {
    await adapter[effect]({ plan, intent, phase });
  } catch (error) {
    failure = error;
  }
  try {
    observed = await adapter.reconcilePhase({ plan, intent, phase });
  } catch (error) {
    if (failure) throw failure;
    throw error;
  }
  if (observed) return observed;
  if (failure) throw failure;
  throw new Error(`Successor-projection repair ${phase} effect was not exactly observable.`);
}

async function finishArchive({ adapter, contract, intent, plan }) {
  if (intent.status !== "complete") {
    throw new Error("Only a complete successor-projection intent may be archived.");
  }
  await adapter.assertIrreversibilityBarrier({
    plan, intent, phase: "complete",
  });
  const rawVerification = await adapter.verifyTerminal({
    plan, intent, phase: "verified", fresh: true,
  });
  const verified = contract.normalizePhaseReceipt({
    plan, phase: "verified", value: rawVerification,
  });
  if (canonicalJson(verificationIdentity(verified))
    !== canonicalJson(verificationIdentity(intent.phases.verified))) {
    throw new Error("Fresh terminal verification differs from the completed intent.");
  }
  const archive = await adapter.archiveComplete({ plan, intent, verified });
  normalizeArchive(archive, plan, intent);
}

function verificationIdentity(receipt) {
  const values = { ...receipt.values };
  delete values.verifiedAt;
  delete values.cloudVerificationReceiptDigest;
  delete values.receiptDigest;
  return Object.freeze({
    schema: receipt.schema,
    phase: receipt.phase,
    planDigest: receipt.planDigest,
    operationKey: receipt.operationKey,
    values: Object.freeze(values),
  });
}

function normalizeArchive(value, plan, intent) {
  const core = Object.freeze({
    schema: ARCHIVE_SCHEMA,
    status: "complete",
    planDigest: plan.planDigest,
    terminalIntentDigest: intent.intentDigest,
    completionReceiptDigest: intent.receipt.receiptDigest,
  });
  const expected = Object.freeze({ ...core, archiveDigest: digestValue(core) });
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("Successor-projection repair archive differs from its terminal intent.");
  }
  return expected;
}

function isIrreversible(phase) {
  return PHASES.indexOf(phase) >= PHASES.indexOf("successor_promoted");
}

function reached(current, target) {
  const currentIndex = PHASES.indexOf(current);
  const targetIndex = PHASES.indexOf(target);
  if (currentIndex < 0 || targetIndex < 0) {
    throw new Error("Task-authority successor projection repair phase is invalid.");
  }
  return currentIndex >= targetIndex;
}

function requireAdapter(adapter) {
  for (const name of REQUIRED_METHODS) {
    if (typeof adapter?.[name] !== "function") {
      throw new Error(`Task-authority successor projection repair adapter requires ${name}().`);
    }
  }
}
