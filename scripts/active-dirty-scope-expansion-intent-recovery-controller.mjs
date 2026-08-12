// Responsibility: orchestrate one exact terminal reconciliation through an injected fenced effect.
import * as Contract from "./active-dirty-scope-expansion-intent-recovery-contract.mjs";
import * as Evidence from "./active-dirty-scope-expansion-intent-recovery-evidence.mjs";

const RESULT_SCHEMA =
  "agentic-active-dirty-scope-expansion-intent-recovery-result/v1";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "withEntrypointFence",
  "readSourceEvidence",
  "readIntent",
  "writeIntent",
  "observeTerminal",
  "executeTerminal",
]);

export function createActiveDirtyScopeExpansionIntentRecoveryController({
  adapter,
  contract = Contract,
  evidence = Evidence,
} = {}) {
  const runtime = normalizeAdapter(adapter);
  return Object.freeze({
    plan: input => planActiveDirtyScopeExpansionIntentRecovery(input, {
      adapter: runtime,
      contract,
    }),
    run: input => runActiveDirtyScopeExpansionIntentRecovery(input, {
      adapter: runtime,
      contract,
      evidence,
    }),
  });
}

export async function planActiveDirtyScopeExpansionIntentRecovery(
  input = {},
  { adapter, contract = Contract } = {},
) {
  const runtime = normalizeAdapter(adapter);
  const stored = await runtime.readIntent();
  const plan = stored
    ? planFromIntent(normalizeIntent(contract, stored), contract)
    : await buildCurrentPlan(runtime, contract);
  requireRequestedPlanDigest(input?.planDigest, plan, { required: false });
  return plannedResult(plan);
}

export async function runActiveDirtyScopeExpansionIntentRecovery(
  input = {},
  { adapter, contract = Contract, evidence = Evidence } = {},
) {
  requirePlanDigest(input?.planDigest);
  const runtime = normalizeAdapter(adapter);
  return runtime.withEntrypointFence(
    { planDigest: input.planDigest },
    () => executeRecovery({ adapter: runtime, contract, evidence, input }),
  );
}

async function executeRecovery({ adapter, contract, evidence, input }) {
  const stored = await adapter.readIntent();
  let intent = stored ? normalizeIntent(contract, stored) : null;
  const plan = intent
    ? planFromIntent(intent, contract)
    : await buildCurrentPlan(adapter, contract);
  requireRequestedPlanDigest(input.planDigest, plan, { required: true });

  const authorizationReceipt = contractFunction(
    contract,
    "authorizeActiveDirtyScopeExpansionIntentRecovery",
  )(plan, input.authorization);
  if (intent) {
    assertAuthorizationReplay(intent, authorizationReceipt);
  } else {
    const candidate = normalizeIntent(contract, contractFunction(
      contract,
      "createActiveDirtyScopeExpansionIntentRecoveryIntent",
    )(plan, authorizationReceipt));
    intent = await persistIntent(adapter, contract, {
      expectedIntent: null,
      nextIntent: candidate,
      plan,
    });
  }
  assertIntentBound(intent, plan, authorizationReceipt);
  if (intent.status === "complete") return completedResult(contract, intent, plan);
  if (intent.status !== "authorized") {
    throw new Error(`Unsupported scope-expansion intent recovery status: ${intent.status}.`);
  }

  const operationKey = contractFunction(
    contract,
    "activeDirtyScopeExpansionIntentRecoveryOperationKey",
  )(plan.planDigest, intent.authorizationDigest);
  const context = Object.freeze({ intent, operationKey, plan });
  let live = await classifyTerminal(adapter, evidence, context);
  if (live.state === "pending") {
    let effect = null;
    try {
      effect = await adapter.executeTerminal(context);
    } catch (error) {
      live = await classifyTerminal(adapter, evidence, context);
      if (live.state !== "complete") throw error;
    }
    if (effect) {
      requireOperationResult(effect, operationKey);
      live = await classifyTerminal(adapter, evidence, context);
    }
    if (live.state !== "complete") {
      throw new Error("Terminal scope-expansion intent reconciliation did not become live-complete.");
    }
  }

  const completed = normalizeIntent(contract, contractFunction(
    contract,
    "completeActiveDirtyScopeExpansionIntentRecoveryIntent",
  )(intent, live.observation));
  intent = await persistIntent(adapter, contract, {
    expectedIntent: intent,
    nextIntent: completed,
    plan,
  });
  return completedResult(contract, intent, plan);
}

async function classifyTerminal(adapter, evidence, context) {
  const expected = Object.freeze({
    planDigest: context.plan.planDigest,
    operationKey: context.operationKey,
    sourceEvidenceDigest: context.plan.sourceEvidenceDigest,
    sourceEvidence: context.plan.sourceEvidence,
  });
  const raw = await adapter.observeTerminal(context);
  const candidate = raw?.state === "complete" && raw.observation
    ? raw.observation
    : raw;
  const classification = evidenceFunction(
    evidence,
    "classifyActiveDirtyScopeExpansionIntentRecoveryTerminal",
  )(candidate, expected);
  if (classification?.state === "pending" && classification.observation === null) {
    return Object.freeze({ state: "pending", observation: null });
  }
  if (classification?.state !== "complete" || !classification.observation) {
    throw new Error("Terminal scope-expansion intent recovery classification is invalid.");
  }
  const observation = evidenceFunction(
    evidence,
    "normalizeActiveDirtyScopeExpansionIntentRecoveryTerminalObservation",
  )(classification.observation, expected);
  return Object.freeze({ state: "complete", observation });
}

async function buildCurrentPlan(adapter, contract) {
  const raw = await adapter.readSourceEvidence();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Scope-expansion intent recovery adapter returned no source evidence.");
  }
  const sourceEvidence = raw.sourceEvidence ?? raw;
  return normalizePlan(contract, contractFunction(
    contract,
    "buildActiveDirtyScopeExpansionIntentRecoveryPlan",
  )({ sourceEvidence }));
}

async function persistIntent(adapter, contract, {
  expectedIntent,
  nextIntent,
  plan,
}) {
  const candidate = normalizeIntent(contract, nextIntent);
  const persisted = normalizeIntent(contract, await adapter.writeIntent({
    expectedIntent,
    nextIntent: candidate,
  }));
  if (persisted.planDigest !== plan.planDigest
    || persisted.intentDigest !== candidate.intentDigest) {
    throw new Error("Scope-expansion intent recovery journal changed during persistence.");
  }
  return persisted;
}

function completedResult(contract, intent, plan) {
  const receipt = contractFunction(
    contract,
    "buildActiveDirtyScopeExpansionIntentRecoveryReceipt",
  )(intent);
  const normalizedReceipt = contractFunction(
    contract,
    "normalizeActiveDirtyScopeExpansionIntentRecoveryReceipt",
  )(receipt, intent);
  return Object.freeze({
    schema: RESULT_SCHEMA,
    status: "complete",
    planDigest: plan.planDigest,
    receipt: normalizedReceipt,
    authoringAuthority: false,
    deployment: false,
  });
}

function plannedResult(plan) {
  return Object.freeze({
    schema: RESULT_SCHEMA,
    status: "planned",
    planDigest: plan.planDigest,
    exactAuthorization: requiredText(
      plan.exactAuthorization,
      "recovery exact authorization",
    ),
    plan,
  });
}

function assertAuthorizationReplay(intent, receipt) {
  if (!receipt?.authorizationDigest
    || intent.authorizationDigest !== receipt.authorizationDigest) {
    throw new Error("Stored scope-expansion intent recovery authorization drifted.");
  }
}

function assertIntentBound(intent, plan, receipt) {
  if (intent.planDigest !== plan.planDigest
    || intent.authorizationDigest !== receipt?.authorizationDigest) {
    throw new Error("Scope-expansion intent recovery changed its exact authority.");
  }
}

function requireOperationResult(value, operationKey) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.operationKey !== operationKey) {
    throw new Error("Terminal scope-expansion intent recovery changed its operation key.");
  }
}

function planFromIntent(intent, contract) {
  const plan = normalizePlan(contract, intent.planSnapshot);
  if (intent.planDigest !== plan.planDigest) {
    throw new Error("Scope-expansion intent recovery plan snapshot drifted.");
  }
  return plan;
}

function requirePlanDigest(value) {
  if (!DIGEST_PATTERN.test(String(value || ""))) {
    throw new Error("Scope-expansion intent recovery run requires an exact plan digest.");
  }
}

function requireRequestedPlanDigest(value, plan, { required }) {
  if (!required && (value === undefined || value === null || value === "")) return;
  if (!DIGEST_PATTERN.test(String(value || "")) || value !== plan.planDigest) {
    throw new Error("Requested scope-expansion intent recovery plan is not exact-current.");
  }
}

function normalizeAdapter(methods = {}) {
  const adapter = Object.freeze(Object.fromEntries(
    REQUIRED_ADAPTER_METHODS.map(name => [name, methods?.[name]]),
  ));
  for (const name of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter[name] !== "function") {
      throw new Error(`Scope-expansion intent recovery adapter requires ${name}().`);
    }
  }
  return adapter;
}

function normalizePlan(contract, value) {
  return contractFunction(
    contract,
    "normalizeActiveDirtyScopeExpansionIntentRecoveryPlan",
  )(value);
}

function normalizeIntent(contract, value) {
  return contractFunction(
    contract,
    "normalizeActiveDirtyScopeExpansionIntentRecoveryIntent",
  )(value);
}

function contractFunction(contract, name) {
  if (typeof contract?.[name] !== "function") {
    throw new Error(`Scope-expansion intent recovery contract requires ${name}().`);
  }
  return contract[name];
}

function evidenceFunction(evidence, name) {
  if (typeof evidence?.[name] !== "function") {
    throw new Error(`Scope-expansion intent recovery evidence requires ${name}().`);
  }
  return evidence[name];
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
  return value;
}
