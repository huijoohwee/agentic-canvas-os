// Responsibility: durably enforce waiter-first provider-only reconciliation without owning effects.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import * as Contract from "./provider-only-merged-claim-pair-reconciliation-contract.mjs";

export const PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_PHASES = Object.freeze([
  "authorized",
  "prepared",
  "waiter-retired",
  "source-recovered",
  "source-integrated",
  "source-retired",
  "verified",
  "complete",
]);

const EFFECTS = Object.freeze([
  ["waiter-retired", "retireWaiter"],
  ["source-recovered", "recoverSource"],
  ["source-integrated", "integrateSource"],
  ["source-retired", "retireSource"],
  ["verified", "verifyTerminal"],
]);
const REQUIRED = Object.freeze([
  "withEntrypointFence",
  "readSourceEvidence",
  "readIntent",
  "writeIntent",
  "observePhase",
  ...EFFECTS.map(([, method]) => method),
]);
const DIGEST = /^[0-9a-f]{64}$/u;

export function createProviderOnlyMergedClaimPairReconciliationControllerAdapter(methods = {}) {
  const adapter = Object.freeze(Object.fromEntries(REQUIRED.map(name => [name, methods[name]])));
  for (const name of REQUIRED) {
    if (typeof adapter[name] !== "function") {
      throw new Error(`Provider-only merged-claim-pair adapter requires ${name}().`);
    }
  }
  return adapter;
}

export function createProviderOnlyMergedClaimPairReconciliationController({ adapter } = {}) {
  const runtime = createProviderOnlyMergedClaimPairReconciliationControllerAdapter(adapter);
  return Object.freeze({
    plan: input => planProviderOnlyMergedClaimPairReconciliation(input, { adapter: runtime }),
    run: input => runProviderOnlyMergedClaimPairReconciliation(input, { adapter: runtime }),
  });
}

export async function planProviderOnlyMergedClaimPairReconciliation(
  input = {},
  { adapter } = {},
) {
  const runtime = createProviderOnlyMergedClaimPairReconciliationControllerAdapter(adapter);
  const stored = await runtime.readIntent();
  const plan = stored
    ? normalizeIntent(stored).planSnapshot
    : await buildPlan(runtime, { input });
  requirePlanDigest(input.planDigest, plan);
  return Object.freeze({
    status: "planned",
    plan,
    planDigest: plan.planDigest,
    exactAuthorization: plan.exactAuthorization,
  });
}

export async function runProviderOnlyMergedClaimPairReconciliation(
  input = {},
  { adapter } = {},
) {
  const runtime = createProviderOnlyMergedClaimPairReconciliationControllerAdapter(adapter);
  return runtime.withEntrypointFence(
    { planDigest: input.planDigest ?? null },
    fence => execute({ adapter: runtime, fence, input }),
  );
}

async function execute({ adapter, fence, input }) {
  let intent = await adapter.readIntent({ fence });
  intent = intent ? normalizeIntent(intent) : null;
  const plan = intent?.planSnapshot ?? await buildPlan(adapter, { fence, input });
  requirePlanDigest(input.planDigest, plan, { required: true });
  const authorization = Contract.authorizeProviderOnlyMergedClaimPairReconciliation({
    plan,
    authorization: input.authorization,
  });
  if (intent && intent.authorizationDigest !== authorization.authorizationDigest) {
    throw new Error("Stored provider-only reconciliation authorization drifted.");
  }
  if (!intent) {
    const candidate = Contract.createProviderOnlyMergedClaimPairReconciliationIntent({
      plan,
      authorizationReceipt: authorization,
    });
    intent = await writeExactIntent(adapter, candidate, {
      expectedIntent: null,
      fence,
      nextIntent: candidate,
      plan,
    });
  } else if (intent.status === "authorized") {
    await requireCurrentPlan(adapter, { fence, input, plan });
  } else if (intent.status === "prepared") {
    const next = await observe(adapter, {
      fence,
      intent,
      operationKey: operationKey(plan, "waiter-retired"),
      phase: "waiter-retired",
      plan,
    });
    if (next.state === "pending") await requireCurrentPlan(adapter, { fence, input, plan });
  }
  intent = await persistObserved({ adapter, fence, intent, phase: "prepared", plan });
  for (const [phase, method] of EFFECTS) {
    if (atLeast(intent.status, phase)) {
      await requireComplete(adapter, { fence, intent, phase, plan });
      continue;
    }
    assertNext(intent.status, phase);
    const values = await executeEffect({ adapter, fence, intent, method, phase, plan });
    intent = await persist({ adapter, fence, intent, phase, plan, values });
    await requireComplete(adapter, { fence, intent, phase, plan });
  }
  if (!atLeast(intent.status, "complete")) {
    assertNext(intent.status, "complete");
    const verified = intent.phases.verified.values;
    const values = Object.freeze({
      operationKey: operationKey(plan, "complete"),
      evidenceDigest: digestValue({
        schema: "agentic-provider-only-merged-claim-pair-completion-evidence/v1",
        planDigest: plan.planDigest,
        verifiedEvidenceDigest: verified.evidenceDigest,
        sourceIntegrationReceiptDigest: verified.sourceIntegrationReceiptDigest,
      }),
      sourceIntegrationReceiptDigest: verified.sourceIntegrationReceiptDigest,
    });
    const receipt = Contract.buildProviderOnlyMergedClaimPairReconciliationReceipt({
      plan,
      intent,
      values,
    });
    intent = await persist({
      adapter,
      fence,
      intent,
      phase: "complete",
      plan,
      values: { ...values, receipt },
    });
  }
  return Object.freeze({
    schema: "agentic-provider-only-merged-claim-pair-reconciliation-result/v1",
    status: "complete",
    planDigest: plan.planDigest,
    receipt: intent.phases.complete.values.receipt,
  });
}

async function persistObserved({ adapter, fence, intent, phase, plan }) {
  if (atLeast(intent.status, phase)) {
    await requireComplete(adapter, { fence, intent, phase, plan });
    return intent;
  }
  assertNext(intent.status, phase);
  const values = await requireComplete(adapter, { fence, intent, phase, plan });
  return persist({ adapter, fence, intent, phase, plan, values });
}

async function executeEffect({ adapter, fence, intent, method, phase, plan }) {
  const context = { fence, intent, operationKey: operationKey(plan, phase), phase, plan };
  let classification = await observe(adapter, context);
  if (classification.state === "complete") return values(classification);
  try {
    const result = await adapter[method](context);
    if (!result || result.operationKey !== context.operationKey) {
      throw new Error(`Provider-only ${phase} effect is not operation-bound.`);
    }
  } catch (error) {
    classification = await observe(adapter, context);
    if (classification.state === "pending") throw error;
    return values(classification);
  }
  classification = await observe(adapter, context);
  if (classification.state !== "complete") {
    throw new Error(`Provider-only reconciliation phase ${phase} did not become live-complete.`);
  }
  return values(classification);
}

async function requireComplete(adapter, context) {
  const classification = await observe(adapter, {
    ...context,
    operationKey: operationKey(context.plan, context.phase),
  });
  if (classification.state !== "complete") {
    throw new Error(`Provider-only reconciliation phase ${context.phase} is not live-complete.`);
  }
  const recorded = context.intent?.phases?.[context.phase]?.values;
  if (recorded?.operationKey && recorded.operationKey !== classification.operationKey) {
    throw new Error(`Provider-only ${context.phase} operation key drifted after persistence.`);
  }
  if (recorded?.evidenceDigest && recorded.evidenceDigest !== classification.evidenceDigest) {
    throw new Error(`Provider-only ${context.phase} evidence drifted after persistence.`);
  }
  if (recorded?.sourceIntegrationReceiptDigest
    && recorded.sourceIntegrationReceiptDigest !== classification.sourceIntegrationReceiptDigest) {
    throw new Error(`Provider-only ${context.phase} integration receipt drifted after persistence.`);
  }
  return values(classification);
}

async function observe(adapter, context) {
  const value = await adapter.observePhase(context);
  if (!value || value.phase !== context.phase || value.operationKey !== context.operationKey
    || !["pending", "complete"].includes(value.state)) {
    throw new Error(`Provider-only ${context.phase} phase classification is invalid.`);
  }
  if (value.state === "pending") {
    if (value.evidenceDigest !== null) throw new Error(`Pending ${context.phase} evidence is malformed.`);
    return Object.freeze({ ...value, sourceIntegrationReceiptDigest: null });
  }
  const evidenceDigest = requiredDigest(value.evidenceDigest, `${context.phase} evidence digest`);
  const sourceIntegrationReceiptDigest = atLeast(context.phase, "source-integrated")
    ? requiredDigest(
      value.sourceIntegrationReceiptDigest,
      `${context.phase} source integration receipt digest`,
    )
    : null;
  return Object.freeze({ ...value, evidenceDigest, sourceIntegrationReceiptDigest });
}

async function persist({ adapter, fence, intent, phase, plan, values: phaseValues }) {
  const candidate = Contract.advanceProviderOnlyMergedClaimPairReconciliationIntent(
    intent,
    { status: phase, values: phaseValues },
  );
  return writeExactIntent(adapter, candidate, {
    expectedIntent: intent,
    fence,
    nextIntent: candidate,
    plan,
  });
}

async function writeExactIntent(adapter, candidate, input) {
  const returned = normalizeIntent(await adapter.writeIntent(input));
  if (returned.intentDigest !== candidate.intentDigest) {
    throw new Error("Provider-only reconciliation intent CAS returned a different intent.");
  }
  return returned;
}

function values(classification) {
  const result = {
    operationKey: classification.operationKey,
    evidenceDigest: classification.evidenceDigest,
  };
  if (classification.sourceIntegrationReceiptDigest) {
    result.sourceIntegrationReceiptDigest = classification.sourceIntegrationReceiptDigest;
  }
  return Object.freeze(result);
}
async function buildPlan(adapter, context) {
  return Contract.normalizeProviderOnlyMergedClaimPairReconciliationPlan(
    Contract.buildProviderOnlyMergedClaimPairReconciliationPlan(
      await adapter.readSourceEvidence(context),
    ),
  );
}
async function requireCurrentPlan(adapter, context) {
  const current = await buildPlan(adapter, context);
  if (current.planDigest !== context.plan.planDigest) {
    throw new Error("Live provider-only reconciliation plan identity drifted before its first effect.");
  }
}
function normalizeIntent(value) {
  return Contract.normalizeProviderOnlyMergedClaimPairReconciliationIntent(value);
}
function operationKey(plan, phase) {
  return Contract.providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase);
}
function requirePlanDigest(requested, plan, { required = false } = {}) {
  if (required && requested == null) {
    throw new Error("Provider-only reconciliation run requires its exact plan digest.");
  }
  if (requested != null && requested !== plan.planDigest) {
    throw new Error("Requested provider-only reconciliation plan digest drifted.");
  }
}
function atLeast(current, expected) { return index(current) >= index(expected); }
function assertNext(current, expected) {
  if (PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_PHASES[index(current) + 1] !== expected) {
    throw new Error(`Provider-only reconciliation cannot advance from ${current} to ${expected}.`);
  }
}
function index(value) {
  const result = PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_PHASES.indexOf(value);
  if (result < 0) throw new Error(`Unsupported provider-only reconciliation phase: ${value}.`);
  return result;
}
function requiredDigest(value, label) {
  if (!DIGEST.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest.`);
  return value;
}
