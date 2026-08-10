// Responsibility: journal one authorized logical provider disposition without provider effects.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  projectRetiredHandoffSuccessorDurableSubject,
} from "./provider-scope-disposition.mjs";
import * as Contract from "./retired-handoff-successor-disposition-contract.mjs";

const RESULT_SCHEMA =
  "agentic-retired-handoff-successor-disposition-result/v1";
const PHASES = Object.freeze(["authorized", "verified", "complete"]);
const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "withSubjectFence",
  "readEvidence",
  "readIntent",
  "writeIntent",
  "readReceipt",
  "writeReceipt",
]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function createRetiredHandoffSuccessorDispositionController({
  adapter,
} = {}) {
  const runtime = normalizeAdapter(adapter);
  return Object.freeze({
    observe: input => observeRetiredHandoffSuccessorDisposition(input, {
      adapter: runtime,
    }),
    plan: input => planRetiredHandoffSuccessorDisposition(input, {
      adapter: runtime,
    }),
    run: input => runRetiredHandoffSuccessorDisposition(input, {
      adapter: runtime,
    }),
  });
}

export async function planRetiredHandoffSuccessorDisposition(
  input = {},
  { adapter } = {},
) {
  const runtime = normalizeAdapter(adapter);
  const state = await resolveLiveState(runtime, input, "plan");
  if (!state.plan) return operatorInputResult(state);
  const { plan } = state;
  requireRequestedPlanDigest(input.planDigest, plan, { required: false });
  return plannedResult(plan);
}

export async function runRetiredHandoffSuccessorDisposition(
  input = {},
  { adapter } = {},
) {
  const runtime = normalizeAdapter(adapter);
  requireDigest(input.planDigest, "run plan digest");
  const prepared = await resolveLiveState(runtime, input, "authorize");
  const preparedPlan = requirePlannedState(prepared, "run").plan;
  requireRequestedPlanDigest(input.planDigest, preparedPlan, { required: true });
  const authorizationReceipt = authorize(preparedPlan, input.authorization);
  if (prepared.intent) {
    assertIntentBound(prepared.intent, preparedPlan, authorizationReceipt);
  }

  return runtime.withSubjectFence(
    {
      planDigest: preparedPlan.planDigest,
      subjectKey: preparedPlan.subjectKey,
    },
    () => executeDisposition({
      adapter: runtime,
      expectedExistingIntent: Boolean(prepared.intent),
      input,
      preparedPlan,
    }),
  );
}

export async function observeRetiredHandoffSuccessorDisposition(
  input = {},
  { adapter } = {},
) {
  const runtime = normalizeAdapter(adapter);
  const state = await resolveLiveState(runtime, input, "observe");
  if (!state.plan) return operatorInputResult(state);
  const { intent, plan } = state;
  requireRequestedPlanDigest(input.planDigest, plan, { required: false });
  const receipt = await readNormalizedReceipt(runtime, plan.subjectKey);
  if (intent) assertIntentBound(intent, plan);
  if (receipt) assertReceiptBound(receipt, plan, intent);
  if (receipt && (!intent || intent.status === "authorized")) {
    throw new Error("Disposition receipt exists before its verified intent.");
  }
  if (intent?.status === "complete" && !receipt) {
    throw new Error("Complete disposition intent has no receipt.");
  }
  return Object.freeze({
    schema: RESULT_SCHEMA,
    status: intent?.status || "absent",
    subjectKey: plan.subjectKey,
    planDigest: plan.planDigest,
    intent,
    receipt,
  });
}

async function executeDisposition({
  adapter, expectedExistingIntent, input, preparedPlan,
}) {
  const liveEvidence = await readFreshEvidence(adapter, input, "fenced-authorize");
  assertLiveSubjectKey(liveEvidence, preparedPlan.subjectKey);
  let intent = await readNormalizedIntent(adapter, preparedPlan.subjectKey);
  let plan = preparedPlan;
  let authorizationReceipt;
  if (intent) {
    plan = normalizePlan(intent.planSnapshot);
    if (plan.subjectKey !== preparedPlan.subjectKey) {
      throw new Error("Stored disposition plan changed inside its subject fence.");
    }
    assertDurableCurrent(liveEvidence, plan.evidence);
    requireRequestedPlanDigest(input.planDigest, plan, { required: true });
    authorizationReceipt = authorize(plan, input.authorization);
    assertIntentBound(intent, plan, authorizationReceipt);
  } else {
    if (expectedExistingIntent) {
      throw new Error("Stored disposition intent disappeared inside its subject fence.");
    }
    requireExactInitialEvidence(liveEvidence, plan);
    requireRequestedPlanDigest(input.planDigest, plan, { required: true });
    authorizationReceipt = authorize(plan, input.authorization);
  }
  let receipt = await readNormalizedReceipt(adapter, plan.subjectKey);
  if (receipt) {
    assertReceiptBound(receipt, plan, intent);
    if (!intent || intent.status === "authorized") {
      throw new Error("Disposition receipt exists before its verified intent.");
    }
  }
  if (!intent) {
    const candidate = contractFunction(
      "createRetiredHandoffSuccessorDispositionIntent",
    )({ plan, authorizationReceipt });
    intent = await persistIntent(adapter, {
      expectedIntent: null,
      nextIntent: candidate,
      plan,
    });
  }

  if (intent.status === "authorized") {
    await readDurableEvidence(adapter, input, "after-authorized", plan);
    const candidate = contractFunction(
      "advanceRetiredHandoffSuccessorDispositionIntent",
    )(intent, {
      status: "verified",
      values: Object.freeze({
        operationKey: operationKeyFor(plan, "verified"),
        evidenceDigest: plan.evidenceDigest,
      }),
    });
    intent = await persistIntent(adapter, {
      expectedIntent: intent,
      nextIntent: candidate,
      plan,
    });
  }

  if (intent.status === "verified") {
    await readDurableEvidence(adapter, input, "after-verified", plan);
    const candidate = normalizeReceipt(contractFunction(
      "buildRetiredHandoffSuccessorDispositionReceipt",
    )({ intent, plan, evidence: plan.evidence }));
    receipt = receipt
      ? requireSameReceipt(receipt, candidate)
      : await persistReceipt(adapter, {
        nextReceipt: candidate,
        plan,
      });
    await readDurableEvidence(adapter, input, "after-receipt", plan);
    const nextIntent = contractFunction(
      "advanceRetiredHandoffSuccessorDispositionIntent",
    )(intent, {
      status: "complete",
      values: Object.freeze({
        operationKey: operationKeyFor(plan, "complete"),
        evidenceDigest: plan.evidenceDigest,
        receiptDigest: receipt.receiptDigest,
      }),
    });
    intent = await persistIntent(adapter, {
      expectedIntent: intent,
      nextIntent,
      plan,
    });
  }

  requirePhase(intent.status);
  if (intent.status !== "complete") {
    throw new Error(`Disposition stopped in unexpected phase ${intent.status}.`);
  }
  receipt ||= await readNormalizedReceipt(adapter, plan.subjectKey);
  if (!receipt) throw new Error("Complete disposition intent has no receipt.");
  assertIntentBound(intent, plan, authorizationReceipt);
  assertReceiptBound(receipt, plan, intent);
  return completedResult(plan, intent, receipt);
}

async function resolveLiveState(adapter, input, operation) {
  const evidence = await readFreshEvidence(adapter, input, operation);
  const subjectKey = subjectKeyFor(evidence);
  const intent = await readNormalizedIntent(adapter, subjectKey);
  if (intent) return stateFromIntent(evidence, subjectKey, intent);

  const snapshot = Object.hasOwn(input, "portDecision")
    ? sealPlanningSnapshot(evidence, input.portDecision)
    : await readPlanningSnapshot(adapter, input, operation);
  const plannedSubjectKey = snapshot.plan?.subjectKey
    || subjectKeyFor(snapshot.evidence);
  if (plannedSubjectKey !== subjectKey) {
    const laterIntent = await readNormalizedIntent(adapter, plannedSubjectKey);
    if (laterIntent) {
      return stateFromIntent(snapshot.evidence, plannedSubjectKey, laterIntent);
    }
  }
  return Object.freeze({ ...snapshot, intent: null });
}

async function readFreshEvidence(adapter, input, operation) {
  const bundle = await readEvidenceBundle(adapter, Object.freeze({
    ...input, operation, portDecision: null,
  }));
  return bundle.evidence;
}

async function readPlanningSnapshot(adapter, input, operation) {
  const bundle = await readEvidenceBundle(adapter, Object.freeze({
    ...input, operation,
  }));
  return sealPlanningSnapshot(bundle.evidence, bundle.portDecision);
}

async function readEvidenceBundle(adapter, context) {
  const bundle = await adapter.readEvidence(context);
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new Error("Disposition adapter returned no planning evidence.");
  }
  const evidence = contractFunction(
    "normalizeRetiredHandoffSuccessorDispositionEvidence",
  )(bundle.evidence);
  return Object.freeze({ evidence, portDecision: bundle.portDecision });
}

function sealPlanningSnapshot(evidence, portDecision) {
  if (portDecision === undefined || portDecision === null) {
    const residualTemplate = contractFunction(
      "buildRetiredHandoffSuccessorPortDecisionTemplate",
    )(evidence);
    return Object.freeze({ evidence, plan: null, residualTemplate });
  }
  const plan = normalizePlan(contractFunction(
    "buildRetiredHandoffSuccessorDispositionPlan",
  )({ evidence, portDecision }));
  if (plan.evidenceDigest !== evidence.evidenceDigest) {
    throw new Error("Disposition plan drifted from its normalized evidence.");
  }
  return Object.freeze({ evidence, plan });
}

function stateFromIntent(evidence, subjectKey, intent) {
  const plan = normalizePlan(intent.planSnapshot);
  if (intent.subjectKey !== subjectKey || plan.subjectKey !== subjectKey) {
    throw new Error("Stored disposition intent does not match the live subject key.");
  }
  assertIntentBound(intent, plan);
  assertDurableCurrent(evidence, plan.evidence);
  return Object.freeze({ evidence, intent, plan });
}

function requirePlannedState(state, operation) {
  if (!state.plan) {
    throw new Error(`Disposition ${operation} requires a complete port decision.`);
  }
  return state;
}

async function readDurableEvidence(adapter, input, operation, plan) {
  const evidence = await readFreshEvidence(adapter, input, operation);
  assertLiveSubjectKey(evidence, plan.subjectKey);
  assertDurableCurrent(evidence, plan.evidence);
  return evidence;
}

function assertLiveSubjectKey(evidence, expectedSubjectKey) {
  if (subjectKeyFor(evidence) !== expectedSubjectKey) {
    throw new Error("Disposition durable subject changed after authorization.");
  }
}

function assertDurableCurrent(evidence, authorizedEvidence) {
  const current = projectRetiredHandoffSuccessorDurableSubject(evidence);
  const authorized = projectRetiredHandoffSuccessorDurableSubject(
    authorizedEvidence,
  );
  if (digestValue(current) !== digestValue(authorized)) {
    throw new Error("Disposition durable subject changed after authorization.");
  }
}

function requireExactInitialEvidence(evidence, plan) {
  if (evidence.evidenceDigest !== plan.evidenceDigest) {
    throw new Error("Disposition evidence changed before its authorized journal.");
  }
}

function subjectKeyFor(evidence) {
  const subjectKey = contractFunction(
    "retiredHandoffSuccessorDispositionSubjectKey",
  )(evidence);
  return requireDigest(subjectKey, "subject key");
}

async function persistIntent(adapter, { expectedIntent, nextIntent, plan }) {
  const candidate = normalizeIntent(nextIntent);
  assertIntentBound(candidate, plan);
  let persisted;
  try {
    persisted = await adapter.writeIntent({
      subjectKey: plan.subjectKey,
      expectedIntent,
      nextIntent: candidate,
    });
  } catch (error) {
    persisted = await adapter.readIntent(plan.subjectKey);
    if (!persisted) throw error;
  }
  const normalized = normalizeIntent(persisted);
  if (normalized.intentDigest !== candidate.intentDigest) {
    throw new Error("Disposition intent changed during compare-and-swap persistence.");
  }
  return normalized;
}

async function persistReceipt(adapter, { nextReceipt, plan }) {
  const candidate = normalizeReceipt(nextReceipt);
  assertReceiptBound(candidate, plan);
  let persisted;
  try {
    persisted = await adapter.writeReceipt({
      subjectKey: plan.subjectKey,
      expectedReceipt: null,
      nextReceipt: candidate,
    });
  } catch (error) {
    persisted = await adapter.readReceipt(plan.subjectKey);
    if (!persisted) throw error;
  }
  return requireSameReceipt(normalizeReceipt(persisted), candidate);
}

async function readNormalizedIntent(adapter, subjectKey) {
  const value = await adapter.readIntent(subjectKey);
  return value ? normalizeIntent(value) : null;
}

async function readNormalizedReceipt(adapter, subjectKey) {
  const value = await adapter.readReceipt(subjectKey);
  return value ? normalizeReceipt(value) : null;
}

function plannedResult(plan) {
  return Object.freeze({
    schema: RESULT_SCHEMA,
    status: "planned",
    subjectKey: plan.subjectKey,
    planDigest: plan.planDigest,
    exactAuthorization: plan.exactAuthorization,
    plan,
  });
}

function operatorInputResult({ evidence, residualTemplate }) {
  return Object.freeze({
    schema: RESULT_SCHEMA,
    status: "operator-input-required",
    evidenceDigest: evidence.evidenceDigest,
    residualTemplate,
  });
}

function completedResult(plan, intent, receipt) {
  return Object.freeze({
    schema: RESULT_SCHEMA,
    status: "complete",
    subjectKey: plan.subjectKey,
    planDigest: plan.planDigest,
    intentDigest: intent.intentDigest,
    receipt,
  });
}

function authorize(plan, authorization) {
  return contractFunction(
    "authorizeRetiredHandoffSuccessorDisposition",
  )({ plan, authorization });
}

function operationKeyFor(plan, phase) {
  return contractFunction(
    "retiredHandoffSuccessorDispositionOperationKey",
  )({
    phase,
    planDigest: plan.planDigest,
    subjectKey: plan.subjectKey,
  });
}

function normalizePlan(value) {
  const plan = contractFunction(
    "normalizeRetiredHandoffSuccessorDispositionPlan",
  )(value);
  requireDigest(plan.planDigest, "plan digest");
  requireDigest(plan.subjectKey, "subject key");
  if (plan.exactAuthorization !==
    `authorize retired-handoff-successor-disposition ${plan.planDigest}`) {
    throw new Error("Disposition plan contains a malformed exact authorization.");
  }
  return plan;
}

function normalizeIntent(value) {
  return contractFunction(
    "normalizeRetiredHandoffSuccessorDispositionIntent",
  )(value);
}

function normalizeReceipt(value) {
  return contractFunction(
    "normalizeRetiredHandoffSuccessorDispositionReceipt",
  )(value);
}

function assertIntentBound(intent, plan, authorizationReceipt = null) {
  requirePhase(intent.status);
  if (intent.subjectKey !== plan.subjectKey
    || intent.planDigest !== plan.planDigest
    || intent.planSnapshot?.planDigest !== plan.planDigest
    || intent.intentDigest !== requireDigest(intent.intentDigest, "intent digest")) {
    throw new Error("Disposition intent drifted from its exact plan subject.");
  }
  const expectedAuthorization = authorizationReceipt?.authorizationDigest;
  if (expectedAuthorization
    && intent.authorizationDigest !== expectedAuthorization) {
    throw new Error("Disposition intent authorization drifted on replay.");
  }
}

function assertReceiptBound(receipt, plan, intent = null) {
  requireDigest(receipt.receiptDigest, "receipt digest");
  if (receipt.subjectKey !== plan.subjectKey
    || receipt.planDigest !== plan.planDigest
    || receipt.evidenceDigest !== plan.evidenceDigest
    || receipt.portDecisionDigest !== plan.portDecisionDigest
    || (intent && receipt.authorizationDigest !== intent.authorizationDigest)
    || (intent?.status === "complete"
      && intent.phases.complete.values.receiptDigest !== receipt.receiptDigest)) {
    throw new Error("Disposition receipt drifted from its exact subject.");
  }
}

function requireSameReceipt(observed, expected) {
  if (observed.receiptDigest !== expected.receiptDigest) {
    throw new Error("Immutable disposition receipt already contains another value.");
  }
  return observed;
}

function requireRequestedPlanDigest(value, plan, { required }) {
  if (!required && (value === undefined || value === null || value === "")) return;
  if (!DIGEST_PATTERN.test(String(value || "")) || value !== plan.planDigest) {
    throw new Error("Requested disposition plan digest is not exact-current.");
  }
}

function requirePhase(value) {
  const index = PHASES.indexOf(value);
  if (index < 0) throw new Error(`Unsupported disposition phase: ${value}.`);
  return index;
}

function normalizeAdapter(methods = {}) {
  const adapter = Object.freeze(Object.fromEntries(
    REQUIRED_ADAPTER_METHODS.map(name => [name, methods?.[name]]),
  ));
  for (const name of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter[name] !== "function") {
      throw new Error(`Disposition adapter requires ${name}().`);
    }
  }
  return adapter;
}

function contractFunction(name) {
  const value = Contract[name];
  if (typeof value !== "function") {
    throw new Error(`Disposition contract requires ${name}().`);
  }
  return value;
}

function requireDigest(value, label) {
  const normalized = String(value || "");
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return normalized;
}
