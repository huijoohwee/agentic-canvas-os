// Responsibility: Plan, execute, observe, and replay one recovery artifact atomic archive.
import { canonicalJson } from "./cloud-collaboration-primitives.mjs";
import {
  RECOVERY_ARTIFACT_RETIREMENT_RESULT_SCHEMA,
  advanceRecoveryArtifactRetirementIntent,
  authorizeRecoveryArtifactRetirement,
  buildRecoveryArtifactRetirementPlan,
  buildRecoveryArtifactRetirementReceipt,
  createRecoveryArtifactRetirementIntent,
  normalizeRecoveryArtifactRetirementEvidence,
  normalizeRecoveryArtifactRetirementIntent,
  normalizeRecoveryArtifactRetirementPlan,
  normalizeRecoveryArtifactRetirementReceipt,
} from "./recovery-artifact-retirement-contract.mjs";

const METHODS = ["captureEvidence", "withSubjectFence", "readIntent", "writeIntent",
  "readReceipt", "writeReceipt", "archive", "observeArchive"];

export function createRecoveryArtifactRetirementController({ adapter } = {}) {
  const runtime = normalizeAdapter(adapter);
  return Object.freeze({
    plan: input => planRecoveryArtifactRetirement(input, { adapter: runtime }),
    run: input => runRecoveryArtifactRetirement(input, { adapter: runtime }),
    observe: input => observeRecoveryArtifactRetirement(input, { adapter: runtime }),
  });
}

export function planRecoveryArtifactRetirement(input = {}, { adapter } = {}) {
  const runtime = normalizeAdapter(adapter);
  const first = normalizeRecoveryArtifactRetirementEvidence(runtime.captureEvidence());
  const second = normalizeRecoveryArtifactRetirementEvidence(runtime.captureEvidence());
  if (first.evidenceDigest !== second.evidenceDigest) throw new Error("Recovery artifact evidence drifted between consecutive captures.");
  const plan = buildRecoveryArtifactRetirementPlan({
    evidence: second, sessionId: input.sessionId,
    operatorDecisionDigest: input.operatorDecisionDigest,
    acknowledgedDriftDigest: input.acknowledgedDriftDigest || null,
  });
  return result("planned", plan, null, null);
}

export function runRecoveryArtifactRetirement(input = {}, { adapter } = {}) {
  const runtime = normalizeAdapter(adapter);
  required(input.planDigest, "run plan digest");
  let stored = runtime.readIntent();
  const plan = stored ? normalizeRecoveryArtifactRetirementIntent(stored).plan
    : planRecoveryArtifactRetirement(input, { adapter: runtime }).plan;
  assertInput(plan, input);
  if (plan.planDigest !== input.planDigest) throw new Error("Run plan digest differs from stored or live retirement plan.");
  const authorized = authorizeRecoveryArtifactRetirement(plan, input.authorization);
  return runtime.withSubjectFence(plan, () => execute(runtime, plan, authorized, input));
}

export function observeRecoveryArtifactRetirement(input = {}, { adapter } = {}) {
  const runtime = normalizeAdapter(adapter);
  const raw = runtime.readIntent();
  if (!raw) return Object.freeze({ schema: RECOVERY_ARTIFACT_RETIREMENT_RESULT_SCHEMA,
    status: "absent", plan: null, intent: null, receipt: null });
  const intent = normalizeRecoveryArtifactRetirementIntent(raw);
  if (input.planDigest && input.planDigest !== intent.planDigest) throw new Error("Observed retirement belongs to a different plan.");
  const receipt = runtime.readReceipt();
  const normalizedReceipt = receipt ? normalizeRecoveryArtifactRetirementReceipt(receipt) : null;
  if (["archived", "complete"].includes(intent.status)) {
    const observation = runtime.observeArchive(intent.plan);
    assertObservation(intent.plan, observation);
  }
  if (intent.status === "complete") {
    const candidate = buildRecoveryArtifactRetirementReceipt(archivedPredecessor(intent));
    if (!normalizedReceipt || normalizedReceipt.receiptDigest !== intent.phases.complete.receiptDigest
      || normalizedReceipt.planDigest !== intent.planDigest
      || normalizedReceipt.subjectKey !== intent.subjectKey
      || normalizedReceipt.authorizationDigest !== intent.authorizationDigest
      || normalizedReceipt.archivedIntentDigest !== intent.phases.complete.archivedIntentDigest
      || canonicalJson(normalizedReceipt) !== canonicalJson(candidate)) {
      throw new Error("Completed retirement receipt is absent or drifted.");
    }
  }
  return result(intent.status, intent.plan, intent, normalizedReceipt);
}

function execute(adapter, plan, authorized, input) {
  let intent = adapter.readIntent();
  if (intent) {
    intent = normalizeRecoveryArtifactRetirementIntent(intent);
    if (intent.planDigest !== plan.planDigest || intent.authorizationDigest !== authorized.authorizationDigest) {
      throw new Error("Stored retirement intent belongs to different authority.");
    }
  } else {
    const live = planRecoveryArtifactRetirement(input, { adapter }).plan;
    if (canonicalJson(live) !== canonicalJson(plan)) throw new Error("Retirement evidence drifted before intent persistence.");
    intent = createRecoveryArtifactRetirementIntent({ plan, authorization: input.authorization });
    intent = persistIntent(adapter, null, intent);
  }
  let receipt = adapter.readReceipt();
  if (receipt) receipt = normalizeRecoveryArtifactRetirementReceipt(receipt);
  if (intent.status === "prepared") {
    const observation = adapter.archive(plan);
    assertObservation(plan, observation);
    intent = persistIntent(adapter, intent, advanceRecoveryArtifactRetirementIntent(intent,
      { status: "archived", evidence: observation }));
  }
  if (intent.status === "archived") {
    const observation = adapter.observeArchive(plan);
    assertObservation(plan, observation);
    const candidate = buildRecoveryArtifactRetirementReceipt(intent);
    receipt = receipt ? sameReceipt(receipt, candidate) : persistReceipt(adapter, null, candidate);
    const archivedIntentDigest = intent.intentDigest;
    intent = persistIntent(adapter, intent, advanceRecoveryArtifactRetirementIntent(intent,
      { status: "complete", evidence: { receiptDigest: receipt.receiptDigest, archivedIntentDigest } }));
  }
  if (intent.status === "complete") {
    const observation = adapter.observeArchive(plan); assertObservation(plan, observation);
    if (!receipt) receipt = normalizeRecoveryArtifactRetirementReceipt(adapter.readReceipt());
    const candidate = buildRecoveryArtifactRetirementReceipt(archivedPredecessor(intent));
    if (receipt.planDigest !== plan.planDigest || receipt.subjectKey !== plan.subjectKey
      || receipt.authorizationDigest !== intent.authorizationDigest
      || receipt.archivedIntentDigest !== intent.phases.complete.archivedIntentDigest
      || receipt.receiptDigest !== intent.phases.complete.receiptDigest
      || canonicalJson(receipt) !== canonicalJson(candidate)) {
      throw new Error("Completed retirement receipt drifted.");
    }
  }
  return result(intent.status, plan, intent, receipt);
}

function persistIntent(adapter, previous, next) {
  const written = normalizeRecoveryArtifactRetirementIntent(adapter.writeIntent(previous, next));
  if (written.intentDigest !== next.intentDigest) throw new Error("Retirement intent CAS returned different content.");
  return written;
}
function persistReceipt(adapter, previous, next) {
  const written = normalizeRecoveryArtifactRetirementReceipt(adapter.writeReceipt(previous, next));
  if (written.receiptDigest !== next.receiptDigest) throw new Error("Retirement receipt CAS returned different content.");
  return written;
}
function sameReceipt(existing, candidate) {
  if (canonicalJson(existing) !== canonicalJson(candidate)) throw new Error("Retirement receipt conflicts with replay candidate.");
  return existing;
}
function assertObservation(plan, value) {
  if (!value?.sourceAbsent || !value?.archivePresent || value.archivePath !== plan.archivePath
    || value.manifestDigest !== plan.evidence.manifest.manifestDigest) throw new Error("Archived recovery artifact observation drifted.");
}
function assertInput(plan, input) {
  if (plan.sessionId !== input.sessionId || plan.operatorDecisionDigest !== input.operatorDecisionDigest
    || plan.acknowledgedDriftDigest !== (input.acknowledgedDriftDigest || null)) throw new Error("Run input differs from the stored retirement plan.");
}
function archivedPredecessor(intent) {
  const core = { schema: intent.schema, status: "archived", plan: intent.plan,
    planDigest: intent.planDigest, subjectKey: intent.subjectKey,
    authorizationDigest: intent.authorizationDigest,
    phases: { prepared: intent.phases.prepared, archived: intent.phases.archived } };
  return normalizeRecoveryArtifactRetirementIntent({ ...core, intentDigest: intent.phases.complete.archivedIntentDigest });
}
function result(status, plan, intent, receipt) { return Object.freeze({
  schema: RECOVERY_ARTIFACT_RETIREMENT_RESULT_SCHEMA, status,
  planDigest: plan.planDigest, subjectKey: plan.subjectKey,
  exactAuthorization: status === "planned" ? plan.exactAuthorization : null,
  plan, intent, receipt,
}); }
function required(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value))) throw new Error(`${label} is required.`); }
function normalizeAdapter(adapter) { for (const method of METHODS) if (typeof adapter?.[method] !== "function") throw new Error(`Retirement adapter requires ${method}().`); return adapter; }
