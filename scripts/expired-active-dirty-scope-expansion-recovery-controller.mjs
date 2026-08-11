// Responsibility: durably orchestrate one exact expired active-dirty recovery without owning effects.
import * as Contract from "./expired-active-dirty-scope-expansion-recovery-contract.mjs";
import * as Evidence from "./expired-active-dirty-scope-expansion-recovery-evidence.mjs";

const RESULT_SCHEMA = "agentic-expired-active-dirty-scope-expansion-recovery-result/v1";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const EFFECT_BY_PHASE = Object.freeze({
  "cloud-recovered": "recoverCloud",
  "local-rebound": "persistLocalAuthority",
  "pr-projected": "persistPullRequestMarker",
});
const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "withEntrypointFence",
  "readSourceEvidence",
  "readIntent",
  "writeIntent",
  "observeRecovery",
  ...Object.values(EFFECT_BY_PHASE),
]);

export function createExpiredActiveDirtyScopeExpansionRecoveryController({
  adapter,
} = {}) {
  const runtime = normalizeAdapter(adapter);
  return Object.freeze({
    plan: input => planExpiredActiveDirtyScopeExpansionRecovery(input, {
      adapter: runtime,
    }),
    run: input => runExpiredActiveDirtyScopeExpansionRecovery(input, {
      adapter: runtime,
    }),
  });
}

export async function planExpiredActiveDirtyScopeExpansionRecovery(
  input = {},
  { adapter } = {},
) {
  const runtime = normalizeAdapter(adapter);
  const stored = await runtime.readIntent();
  const plan = stored
    ? planFromIntent(normalizeIntent(stored))
    : await buildCurrentPlan(runtime);
  requireRequestedPlanDigest(input?.planDigest, plan, { required: false });
  return plannedResult(plan);
}

export async function runExpiredActiveDirtyScopeExpansionRecovery(
  input = {},
  { adapter } = {},
) {
  requirePlanDigestInput(input?.planDigest);
  const runtime = normalizeAdapter(adapter);
  return runtime.withEntrypointFence(
    { planDigest: input.planDigest },
    () => executeRecovery({ adapter: runtime, input }),
  );
}

async function executeRecovery({ adapter, input }) {
  const stored = await adapter.readIntent();
  let intent = stored ? normalizeIntent(stored) : null;
  const plan = intent ? planFromIntent(intent) : await buildCurrentPlan(adapter);
  requireRequestedPlanDigest(input.planDigest, plan, { required: true });

  const authorizationReceipt = contractFunction(
    "authorizeExpiredActiveDirtyScopeExpansionRecovery",
  )(plan, input.authorization);
  if (intent) {
    assertAuthorizationReplay(intent, authorizationReceipt);
  } else {
    const candidate = normalizeIntent(contractFunction(
      "createExpiredActiveDirtyScopeExpansionRecoveryIntent",
    )(plan, authorizationReceipt));
    intent = await persistIntent(adapter, {
      expectedIntent: null,
      nextIntent: candidate,
      plan,
    });
  }
  assertIntentBound(intent, plan, authorizationReceipt);
  if (intent.status === "complete") return completedResult(intent, plan);

  for (const phase of recoveryPhases()) {
    const operationKey = operationKeyFor(plan, intent, phase);
    if (atLeast(intent.status, phase)) {
      const live = await requireLiveComplete(adapter, {
        intent,
        operationKey,
        phase,
        plan,
      });
      assertPersistedObservation(intent, live.observation, {
        operationKey,
        phase,
        plan,
      });
      continue;
    }

    assertNextPhase(intent.status, phase);
    const observation = await settlePhase(adapter, {
      intent,
      operationKey,
      phase,
      plan,
    });
    intent = await persistIntent(adapter, {
      expectedIntent: intent,
      nextIntent: contractFunction(
        "advanceExpiredActiveDirtyScopeExpansionRecoveryIntent",
      )(intent, phase, observation),
      plan,
    });
    const live = await requireLiveComplete(adapter, {
      intent,
      operationKey,
      phase,
      plan,
    });
    assertPersistedObservation(intent, live.observation, {
      operationKey,
      phase,
      plan,
    });
  }

  return completedResult(intent, plan);
}

function completedResult(intent, plan) {
  const receipt = contractFunction(
    "buildExpiredActiveDirtyScopeExpansionRecoveryReceipt",
  )(intent);
  const normalizedReceipt = contractFunction(
    "normalizeExpiredActiveDirtyScopeExpansionRecoveryReceipt",
  )(receipt, intent);
  return Object.freeze({
    schema: RESULT_SCHEMA,
    status: "complete",
    planDigest: plan.planDigest,
    receipt: normalizedReceipt,
  });
}

async function settlePhase(adapter, context) {
  let live = await classifyLive(adapter, context);
  if (live.state === "complete") return live.observation;

  const method = EFFECT_BY_PHASE[context.phase];
  if (!method) {
    throw new Error(
      `Expired active-dirty recovery phase ${context.phase} is not live-complete.`,
    );
  }

  let result;
  try {
    result = await adapter[method](context);
  } catch (error) {
    live = await classifyLive(adapter, context);
    if (live.state === "pending") throw error;
    return live.observation;
  }
  requireOperationResult(result, context.operationKey, context.phase);

  live = await classifyLive(adapter, context);
  if (live.state !== "complete") {
    throw new Error(
      `Expired active-dirty recovery phase ${context.phase} did not become live-complete.`,
    );
  }
  return live.observation;
}

async function requireLiveComplete(adapter, context) {
  const live = await classifyLive(adapter, context);
  if (live.state !== "complete") {
    throw new Error(
      `Expired active-dirty recovery phase ${context.phase} is not live-complete.`,
    );
  }
  return live;
}

async function classifyLive(adapter, context) {
  const raw = await adapter.observeRecovery(context);
  const expected = {
    planDigest: context.plan.planDigest,
    phase: context.phase,
    operationKey: context.operationKey,
  };
  const classification = evidenceFunction(
    "classifyExpiredActiveDirtyScopeExpansionRecoveryPhase",
  )(raw, expected);
  if (classification?.state === "pending" && classification.observation === null) {
    return Object.freeze({ state: "pending", observation: null });
  }
  if (classification?.state !== "complete" || !classification.observation) {
    throw new Error(
      `Expired active-dirty recovery phase ${context.phase} returned an invalid classification.`,
    );
  }
  const observation = evidenceFunction(
    "normalizeExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation",
  )(classification.observation, expected);
  return Object.freeze({ state: "complete", observation });
}

async function buildCurrentPlan(adapter) {
  const planningInput = await adapter.readSourceEvidence();
  if (!planningInput || typeof planningInput !== "object" || Array.isArray(planningInput)) {
    throw new Error("Expired active-dirty recovery adapter returned no planning evidence.");
  }
  return normalizePlan(contractFunction(
    "buildExpiredActiveDirtyScopeExpansionRecoveryPlan",
  )(planningInput));
}

async function persistIntent(adapter, { expectedIntent, nextIntent, plan }) {
  const candidate = normalizeIntent(nextIntent);
  const persisted = normalizeIntent(await adapter.writeIntent({
    expectedIntent,
    nextIntent: candidate,
  }));
  if (persisted.planDigest !== plan.planDigest
    || persisted.intentDigest !== candidate.intentDigest) {
    throw new Error("Expired active-dirty recovery intent changed during persistence.");
  }
  return persisted;
}

function assertPersistedObservation(intent, liveObservation, context) {
  const recorded = intent?.phases?.[context.phase];
  if (!recorded || recorded.operationKey !== context.operationKey) {
    throw new Error(
      `Expired active-dirty recovery phase ${context.phase} changed its durable operation key.`,
    );
  }
  const storedObservation = evidenceFunction(
    "normalizeExpiredActiveDirtyScopeExpansionRecoveryPhaseObservation",
  )(recorded.observation, {
    planDigest: context.plan.planDigest,
    phase: context.phase,
    operationKey: context.operationKey,
  });
  if (storedObservation.observationDigest !== liveObservation.observationDigest) {
    throw new Error(
      `Expired active-dirty recovery phase ${context.phase} drifted after persistence.`,
    );
  }
}

function assertAuthorizationReplay(intent, receipt) {
  const nextDigest = receipt?.authorizationDigest;
  if (!nextDigest || intent.authorizationDigest !== nextDigest) {
    throw new Error("Stored expired active-dirty recovery authorization drifted.");
  }
}

function assertIntentBound(intent, plan, authorizationReceipt) {
  if (intent.planDigest !== plan.planDigest
    || intent.authorizationDigest !== authorizationReceipt?.authorizationDigest) {
    throw new Error("Expired active-dirty recovery intent changed its exact authority.");
  }
  requirePhase(intent.status);
}

function requireOperationResult(value, operationKey, phase) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.operationKey !== operationKey) {
    throw new Error(
      `Expired active-dirty recovery phase ${phase} effect changed its operation key.`,
    );
  }
}

function planFromIntent(intent) {
  const plan = normalizePlan(intent.planSnapshot);
  if (intent.planDigest !== plan.planDigest) {
    throw new Error("Expired active-dirty recovery intent plan snapshot drifted.");
  }
  return plan;
}

function plannedResult(plan) {
  return Object.freeze({
    schema: RESULT_SCHEMA,
    status: "planned",
    planDigest: plan.planDigest,
    exactAuthorization: plan.exactAuthorization,
    plan,
  });
}

function operationKeyFor(plan, intent, phase) {
  return contractFunction(
    "expiredActiveDirtyScopeExpansionRecoveryOperationKey",
  )(plan.planDigest, intent.authorizationDigest, phase);
}

function recoveryPhases() {
  const phases = Contract.EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASES;
  if (!Array.isArray(phases) || phases.length !== 4) {
    throw new Error("Expired active-dirty recovery contract returned invalid phases.");
  }
  return phases;
}

function assertNextPhase(current, expected) {
  const phases = ["authorized", ...recoveryPhases()];
  const next = phases.indexOf(current) + 1;
  if (next < 1 || phases[next] !== expected) {
    throw new Error(
      `Expired active-dirty recovery cannot advance from ${current} to ${expected}.`,
    );
  }
}

function atLeast(current, expected) {
  return requirePhase(current) >= requirePhase(expected);
}

function requirePhase(value) {
  const phases = ["authorized", ...recoveryPhases()];
  const index = phases.indexOf(value);
  if (index < 0) {
    throw new Error(`Unsupported expired active-dirty recovery phase: ${value}.`);
  }
  return index;
}

function requirePlanDigestInput(value) {
  if (!DIGEST_PATTERN.test(String(value || ""))) {
    throw new Error("Expired active-dirty recovery run requires an exact plan digest.");
  }
}

function requireRequestedPlanDigest(value, plan, { required }) {
  if (!required && (value === undefined || value === null || value === "")) return;
  if (!DIGEST_PATTERN.test(String(value || "")) || value !== plan.planDigest) {
    throw new Error("Requested expired active-dirty recovery plan digest is not exact-current.");
  }
}

function normalizeAdapter(methods = {}) {
  const adapter = Object.freeze(Object.fromEntries(
    REQUIRED_ADAPTER_METHODS.map(name => [name, methods?.[name]]),
  ));
  for (const name of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter[name] !== "function") {
      throw new Error(`Expired active-dirty recovery adapter requires ${name}().`);
    }
  }
  return adapter;
}

function normalizePlan(value) {
  return contractFunction(
    "normalizeExpiredActiveDirtyScopeExpansionRecoveryPlan",
  )(value);
}

function normalizeIntent(value) {
  return contractFunction(
    "normalizeExpiredActiveDirtyScopeExpansionRecoveryIntent",
  )(value);
}

function contractFunction(name) {
  const value = Contract[name];
  if (typeof value !== "function") {
    throw new Error(`Expired active-dirty recovery contract requires ${name}().`);
  }
  return value;
}

function evidenceFunction(name) {
  const value = Evidence[name];
  if (typeof value !== "function") {
    throw new Error(`Expired active-dirty recovery evidence requires ${name}().`);
  }
  return value;
}
