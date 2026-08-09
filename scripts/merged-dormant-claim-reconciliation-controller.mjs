// Responsibility: durably orchestrate exact-authority reconciliation without owning effects.
import * as Contract from "./merged-dormant-claim-reconciliation-contract.mjs";
import * as Evidence from "./merged-dormant-claim-reconciliation-evidence.mjs";

export const MERGED_DORMANT_CLAIM_RECONCILIATION_PHASES = Object.freeze([
  "authorized",
  "prepared",
  "recovered",
  "integrated",
  "retired",
  "complete",
]);

const EFFECTS = Object.freeze([
  ["recovered", "recoverDormant"],
  ["integrated", "integrateReviewed"],
  ["retired", "retireIntegrated"],
]);

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "withEntrypointFence",
  "readSourceEvidence",
  "readIntent",
  "writeIntent",
  "readClaim",
  ...EFFECTS.map(([, method]) => method),
]);

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function createMergedDormantClaimReconciliationControllerAdapter(methods = {}) {
  const adapter = Object.freeze(Object.fromEntries(
    REQUIRED_ADAPTER_METHODS.map(name => [name, methods[name]]),
  ));
  for (const name of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter[name] !== "function") {
      throw new Error(`Merged dormant claim reconciliation adapter requires ${name}().`);
    }
  }
  return adapter;
}

export function createMergedDormantClaimReconciliationController({ adapter } = {}) {
  const normalizedAdapter = createMergedDormantClaimReconciliationControllerAdapter(adapter);
  return Object.freeze({
    plan: input => planMergedDormantClaimReconciliation(input, {
      adapter: normalizedAdapter,
    }),
    run: input => runMergedDormantClaimReconciliation(input, {
      adapter: normalizedAdapter,
    }),
  });
}

export async function planMergedDormantClaimReconciliation(
  input = {},
  { adapter } = {},
) {
  const runtime = createMergedDormantClaimReconciliationControllerAdapter(adapter);
  const stored = await runtime.readIntent();
  const plan = stored
    ? planFromIntent(normalizeIntent(stored))
    : await buildPlan(runtime, { input });
  requireRequestedPlanDigest(input?.planDigest, plan);
  return planResult(plan);
}

export async function runMergedDormantClaimReconciliation(
  input = {},
  { adapter } = {},
) {
  const runtime = createMergedDormantClaimReconciliationControllerAdapter(adapter);
  return runtime.withEntrypointFence(
    { planDigest: input?.planDigest ?? null },
    fence => executeReconciliation({
      adapter: runtime,
      authorization: input?.authorization,
      fence,
      input,
    }),
  );
}

async function executeReconciliation({ adapter, authorization, fence, input }) {
  let stored = await adapter.readIntent({ fence });
  let intent = stored ? normalizeIntent(stored) : null;
  const plan = intent
    ? planFromIntent(intent)
    : await buildPlan(adapter, { fence, input });
  requireRequestedPlanDigest(input?.planDigest, plan);

  const authorizationReceipt = contractFunction(
    "authorizeMergedDormantClaimReconciliation",
  )({ plan, authorization });
  if (intent) assertAuthorizationReplay(intent, authorizationReceipt);

  if (!intent) {
    const candidate = normalizeIntent(contractFunction(
      "createMergedDormantClaimReconciliationIntent",
    )({ plan, authorizationReceipt }));
    intent = normalizeIntent(await adapter.writeIntent({
      expectedIntent: null,
      fence,
      nextIntent: candidate,
      plan,
    }));
  }
  requirePhase(intent.status);

  intent = await persistObservedPhase({
    adapter,
    fence,
    intent,
    phase: "prepared",
    plan,
  });

  for (const [phase, method] of EFFECTS) {
    if (atLeast(intent.status, phase)) {
      await requireReconciled(adapter, { fence, intent, phase, plan });
      continue;
    }
    assertNextPhase(intent.status, phase);
    const values = await executeEffect({
      adapter,
      fence,
      intent,
      method,
      phase,
      plan,
    });
    intent = await persistIntentPhase({
      adapter,
      fence,
      intent,
      phase,
      plan,
      values,
    });
    await requireReconciled(adapter, { fence, intent, phase, plan });
  }

  if (!atLeast(intent.status, "complete")) {
    assertNextPhase(intent.status, "complete");
    const values = await requireReconciled(adapter, {
      fence,
      intent,
      phase: "complete",
      plan,
    });
    const receipt = contractFunction(
      "buildMergedDormantClaimReconciliationReceipt",
    )({ plan, intent, phase: "complete", values });
    intent = await persistIntentPhase({
      adapter,
      fence,
      intent,
      phase: "complete",
      plan,
      values: { ...values, receipt },
    });
  }
  await requireReconciled(adapter, { fence, intent, phase: "complete", plan });

  return Object.freeze({
    schema: "agentic-merged-dormant-claim-reconciliation-result/v1",
    status: "complete",
    planDigest: plan.planDigest,
    receipt: completionReceipt(intent),
  });
}

async function persistObservedPhase({ adapter, fence, intent, phase, plan }) {
  if (atLeast(intent.status, phase)) {
    await requireReconciled(adapter, { fence, intent, phase, plan });
    return intent;
  }
  assertNextPhase(intent.status, phase);
  const values = await requireReconciled(adapter, { fence, intent, phase, plan });
  const nextIntent = await persistIntentPhase({
    adapter,
    fence,
    intent,
    phase,
    plan,
    values,
  });
  await requireReconciled(adapter, {
    fence,
    intent: nextIntent,
    phase,
    plan,
  });
  return nextIntent;
}

async function persistIntentPhase({ adapter, fence, intent, phase, plan, values }) {
  const candidate = normalizeIntent(contractFunction(
    "advanceMergedDormantClaimReconciliationIntent",
  )(intent, { status: phase, values }));
  return normalizeIntent(await adapter.writeIntent({
    expectedIntent: intent,
    fence,
    nextIntent: candidate,
    plan,
  }));
}

async function executeEffect({
  adapter,
  fence,
  intent,
  method,
  phase,
  plan,
}) {
  const operationKey = operationKeyFor(plan, phase);
  const context = { fence, intent, operationKey, phase, plan };
  let classification = await classifyLivePhase(adapter, context);
  if (classification.state === "complete") return classificationValues(classification);

  let effectResult;
  try {
    effectResult = await adapter[method](context);
  } catch (error) {
    classification = await classifyLivePhase(adapter, context);
    if (classification.state === "pending") throw error;
    return classificationValues(classification);
  }
  requireOperationResult(effectResult, operationKey, phase);

  classification = await classifyLivePhase(adapter, context);
  if (classification.state !== "complete") {
    throw new Error(
      `Merged dormant claim reconciliation phase ${phase} did not become live-complete.`,
    );
  }
  return classificationValues(classification);
}

async function requireReconciled(adapter, { fence, intent, phase, plan }) {
  const classification = await classifyLivePhase(adapter, {
    fence,
    intent,
    operationKey: operationKeyFor(plan, phase),
    phase,
    plan,
  });
  if (classification.state !== "complete") {
    throw new Error(
      `Merged dormant claim reconciliation phase ${phase} is not live-complete.`,
    );
  }
  assertDurableEvidence(intent, phase, classification);
  return classificationValues(classification);
}

async function classifyLivePhase(adapter, context) {
  const observation = await adapter.readClaim(context);
  const classification = evidenceFunction(
    "classifyMergedDormantClaimReconciliationPhase",
  )({ ...context, observation });
  return normalizeClassification(classification, context.operationKey, context.phase);
}

function normalizeClassification(value, operationKey, phase) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Merged dormant claim reconciliation phase ${phase} returned no classification.`,
    );
  }
  if (value.phase !== phase || value.operationKey !== operationKey) {
    throw new Error(
      `Merged dormant claim reconciliation phase ${phase} classification drifted.`,
    );
  }
  if (value.state !== "pending" && value.state !== "complete") {
    throw new Error(
      `Merged dormant claim reconciliation phase ${phase} returned an invalid state.`,
    );
  }
  const evidenceDigest = value.state === "complete"
    ? requireDigest(value.evidenceDigest, `${phase} evidence digest`)
    : null;
  const requiresIntegrationReceipt = value.state === "complete"
    && atLeast(phase, "integrated");
  const integrationReceiptDigest = requiresIntegrationReceipt
    ? requireDigest(
      value.integrationReceiptDigest,
      `${phase} integration receipt digest`,
    )
    : null;
  if (value.state === "pending" && value.evidenceDigest !== null) {
    throw new Error(
      `Merged dormant claim reconciliation phase ${phase} pending evidence is malformed.`,
    );
  }
  return Object.freeze({
    evidenceDigest,
    integrationReceiptDigest,
    operationKey,
    phase,
    state: value.state,
  });
}

function assertDurableEvidence(intent, phase, classification) {
  const recorded = intent?.phases?.[phase]?.values;
  if (recorded?.operationKey && recorded.operationKey !== classification.operationKey) {
    throw new Error(
      `Merged dormant claim reconciliation phase ${phase} operation key drifted after persistence.`,
    );
  }
  if (recorded?.evidenceDigest
    && recorded.evidenceDigest !== classification.evidenceDigest) {
    throw new Error(
      `Merged dormant claim reconciliation phase ${phase} evidence drifted after persistence.`,
    );
  }
  if (recorded?.integrationReceiptDigest
    && recorded.integrationReceiptDigest !== classification.integrationReceiptDigest) {
    throw new Error(
      `Merged dormant claim reconciliation phase ${phase} integration receipt drifted after persistence.`,
    );
  }
}

function classificationValues(classification) {
  const values = {
    operationKey: classification.operationKey,
    evidenceDigest: classification.evidenceDigest,
  };
  if (classification.integrationReceiptDigest) {
    values.integrationReceiptDigest = classification.integrationReceiptDigest;
  }
  return Object.freeze(values);
}

function requireOperationResult(value, operationKey, phase) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.operationKey !== operationKey) {
    throw new Error(
      `Merged dormant claim reconciliation phase ${phase} effect is not bound to its exact operation key.`,
    );
  }
  return Object.freeze({ ...value });
}

function assertAuthorizationReplay(intent, receipt) {
  const storedDigest = intent.authorizationDigest
    || intent.authorization?.authorizationDigest;
  const nextDigest = receipt?.authorizationDigest || receipt?.receiptDigest;
  if (!storedDigest || !nextDigest || storedDigest !== nextDigest) {
    throw new Error("Stored merged dormant claim reconciliation authorization drifted.");
  }
}

function planFromIntent(intent) {
  return normalizePlan(intent.planSnapshot || intent.plan);
}

async function buildPlan(adapter, context) {
  const source = await adapter.readSourceEvidence(context);
  return normalizePlan(contractFunction(
    "buildMergedDormantClaimReconciliationPlan",
  )(source));
}

function normalizePlan(value) {
  return contractFunction("normalizeMergedDormantClaimReconciliationPlan")(value);
}

function normalizeIntent(value) {
  return contractFunction("normalizeMergedDormantClaimReconciliationIntent")(value);
}

function operationKeyFor(plan, phase) {
  return contractFunction("mergedDormantClaimReconciliationOperationKey")(plan, phase);
}

function planResult(plan) {
  return Object.freeze({
    status: "planned",
    plan,
    planDigest: requireDigest(plan.planDigest, "plan digest"),
    exactAuthorization: requireText(plan.exactAuthorization, "exact authorization"),
  });
}

function requireRequestedPlanDigest(requested, plan) {
  if (requested !== undefined && requested !== null && requested !== plan.planDigest) {
    throw new Error("Requested merged dormant claim reconciliation plan digest drifted.");
  }
}

function completionReceipt(intent) {
  const receipt = intent.receipt
    || intent.values?.receipt
    || intent.phases?.complete?.values?.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("Merged dormant claim reconciliation completed without a durable receipt.");
  }
  return receipt;
}

function assertNextPhase(current, expected) {
  const next = requirePhase(current) + 1;
  if (MERGED_DORMANT_CLAIM_RECONCILIATION_PHASES[next] !== expected) {
    throw new Error(
      `Merged dormant claim reconciliation cannot advance from ${current} to ${expected}.`,
    );
  }
}

function atLeast(current, expected) {
  return requirePhase(current) >= requirePhase(expected);
}

function requirePhase(value) {
  const index = MERGED_DORMANT_CLAIM_RECONCILIATION_PHASES.indexOf(value);
  if (index < 0) {
    throw new Error(`Unsupported merged dormant claim reconciliation phase: ${value}.`);
  }
  return index;
}

function contractFunction(name) {
  const value = Contract[name];
  if (typeof value !== "function") {
    throw new Error(`Merged dormant claim reconciliation contract requires ${name}().`);
  }
  return value;
}

function evidenceFunction(name) {
  const value = Evidence[name];
  if (typeof value !== "function") {
    throw new Error(`Merged dormant claim reconciliation evidence requires ${name}().`);
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

function requireText(value, label) {
  const normalized = String(value || "");
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}
