// Responsibility: Orchestrate two exact, ordered, replay-safe waiting-bridge transactions.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  BRIDGE_RETIREMENT_OPERATION, SUCCESSOR_PROMOTION_OPERATION,
  advanceWaitingBridgeJournal, authorizeWaitingBridgePlan,
  bridgeRetirementRequestDigest, buildBridgeRetirementPlan,
  buildExistingSuccessorPromotionPlan, buildWaitingBridgeResult,
  createWaitingBridgeJournal, normalizeWaitingBridgeJournal,
  startWaitingBridgeJournal, successorPromotionTemplateDigest,
  waitingBridgeEffectDigest, waitingBridgeOperationKey,
} from "./claim-only-waiting-bridge-reconciliation-contract.mjs";

const METHODS = Object.freeze([
  "withOperationLock", "readJournal", "writeJournal",
  "observeRetirement", "observePromotion", "prepare",
  "classifyBridgeRetired", "retireBridge",
  "classifySuccessorPromoted", "promoteSuccessor", "verifyTerminal",
]);

export function createClaimOnlyWaitingBridgeReconciliationController({ adapter } = {}) {
  const runtime = requireAdapter(adapter);
  return Object.freeze({
    planRetirement: () => plan(runtime, BRIDGE_RETIREMENT_OPERATION),
    runRetirement: input => run(runtime, BRIDGE_RETIREMENT_OPERATION, input),
    planPromotion: () => plan(runtime, SUCCESSOR_PROMOTION_OPERATION),
    runPromotion: input => run(runtime, SUCCESSOR_PROMOTION_OPERATION, input),
  });
}

export const createWaitingBridgeReconciliationController =
  createClaimOnlyWaitingBridgeReconciliationController;

async function plan(adapter, operation) {
  return adapter.withOperationLock({ operation, action: "plan" }, async () => {
    const existing = await adapter.readJournal(operation);
    if (existing) {
      const journal = normalizeWaitingBridgeJournal(existing);
      requireOperation(journal, operation);
      if (journal.state === null) {
        const fresh = await stableObservation(adapter, operation);
        requireStableEvidence(journal.plan.evidence, fresh, operation);
      }
      return journal.plan;
    }
    const evidence = await stableObservation(adapter, operation);
    const candidate = buildPlan(operation, evidence);
    const next = createWaitingBridgeJournal(candidate);
    const stored = await adapter.writeJournal({ operation, expected: null, next });
    return normalizeWaitingBridgeJournal(stored || next).plan;
  });
}

async function run(adapter, operation, { planDigest, authorization } = {}) {
  requireDigest(planDigest, "run plan digest");
  return adapter.withOperationLock({ operation, action: "run", planDigest }, async () => {
    let journal = normalizeWaitingBridgeJournal(await adapter.readJournal(operation));
    requireOperation(journal, operation);
    if (journal.plan.planDigest !== planDigest) {
      throw new Error("Run digest does not match the private waiting-bridge plan.");
    }
    authorizeWaitingBridgePlan(journal.plan, authorization);
    if (!journal.state) {
      journal = await persist(adapter, journal,
        startWaitingBridgeJournal(journal, authorization));
    }
    return execute(adapter, journal);
  });
}

async function execute(adapter, initial) {
  let journal = initial;
  const { plan, operation } = journal;
  // A terminal replay is deliberately sealed and cloud-independent.
  if (journal.state.phase === "complete") return journal.state.receipts.complete.result;

  if (journal.state.phase === "authorized") {
    const prepared = object(await adapter.prepare({ plan, journal }), "prepared frame");
    journal = await advance(adapter, journal, "prepared", {
      operationKey: waitingBridgeOperationKey(plan, "prepared"),
      stableFrameDigest: requireDigest(prepared.stableFrameDigest,
        "prepared stable frame digest"),
    });
  }

  if (journal.state.phase === "prepared") {
    const phase = operation === BRIDGE_RETIREMENT_OPERATION
      ? "retirement-intent" : "promotion-intent";
    journal = await advance(adapter, journal, phase,
      operation === BRIDGE_RETIREMENT_OPERATION
        ? retirementIntent(plan) : promotionIntent(plan));
  }

  if (operation === BRIDGE_RETIREMENT_OPERATION) {
    journal = await convergeEffect({
      adapter, journal, intentPhase: "retirement-intent", phase: "bridge-retired",
      classify: adapter.classifyBridgeRetired, effect: adapter.retireBridge,
      label: "bridge retirement",
    });
  } else {
    journal = await convergeEffect({
      adapter, journal, intentPhase: "promotion-intent", phase: "successor-promoted",
      classify: adapter.classifySuccessorPromoted, effect: adapter.promoteSuccessor,
      label: "existing-successor promotion",
    });
  }

  const effectPhase = operation === BRIDGE_RETIREMENT_OPERATION
    ? "bridge-retired" : "successor-promoted";
  if (journal.state.phase === effectPhase) {
    const verified = object(await adapter.verifyTerminal({ plan, journal }),
      "terminal verification");
    const effectDigest = waitingBridgeEffectDigest(journal.state.receipts[effectPhase]);
    if (verified.effectDigest !== effectDigest) {
      throw new Error("Fresh terminal verification does not join the sealed cloud effect.");
    }
    journal = await advance(adapter, journal, "verified", {
      operationKey: waitingBridgeOperationKey(plan, "verified"),
      effectDigest,
      terminalRelevantDigest: requireDigest(verified.terminalRelevantDigest,
        "terminal relevant digest"),
      preservationDigest: requireDigest(verified.preservationDigest,
        "terminal preservation digest"),
    });
  }

  if (journal.state.phase === "verified") {
    const result = buildWaitingBridgeResult(journal);
    journal = await advance(adapter, journal, "complete", {
      operationKey: waitingBridgeOperationKey(plan, "complete"), result,
    });
  }
  if (journal.state.phase !== "complete") {
    throw new Error(`Waiting-bridge operation stopped at ${journal.state.phase}.`);
  }
  return journal.state.receipts.complete.result;
}

async function convergeEffect({
  adapter, journal, intentPhase, phase, classify, effect, label,
}) {
  const phases = journal.operation === BRIDGE_RETIREMENT_OPERATION
    ? ["authorized", "prepared", "retirement-intent", "bridge-retired", "verified", "complete"]
    : ["authorized", "prepared", "promotion-intent", "successor-promoted", "verified", "complete"];
  const currentIndex = phases.indexOf(journal.state.phase);
  const effectIndex = phases.indexOf(phase);
  const context = effectContext(journal, phase);
  if (currentIndex >= effectIndex) {
    await requireComplete(classify, context, label);
    return journal;
  }
  if (journal.state.phase !== intentPhase) return journal;
  const before = await classification(classify(context), label);
  if (before.state === "complete") return advance(adapter, journal, phase, before.values);
  let failure = null;
  try { await effect(context); } catch (error) { failure = error; }
  const after = await classification(classify(context), label);
  if (after.state !== "complete") {
    if (failure) throw failure;
    throw new Error(`${label} did not converge durably.`);
  }
  return advance(adapter, journal, phase, after.values);
}

function retirementIntent(plan) {
  const effectOperationKey = waitingBridgeOperationKey(plan, "bridge-retired");
  const requestDigest = bridgeRetirementRequestDigest(plan);
  const values = {
    operationKey: waitingBridgeOperationKey(plan, "retirement-intent"),
    effectOperationKey,
    claimId: plan.bridgeClaimId,
    expectedFenceRevision: plan.evidence.bridge.claimDigest,
    expectedTransitionCounter: 1,
    requestDigest,
  };
  return { ...values, intentDigest: digestValue({
    operationKey: effectOperationKey, claimId: values.claimId,
    expectedFenceRevision: values.expectedFenceRevision,
    expectedTransitionCounter: values.expectedTransitionCounter, requestDigest,
  }) };
}

function promotionIntent(plan) {
  const effectOperationKey = waitingBridgeOperationKey(plan, "successor-promoted");
  const requestTemplateDigest = successorPromotionTemplateDigest(plan);
  const values = {
    operationKey: waitingBridgeOperationKey(plan, "promotion-intent"),
    effectOperationKey,
    claimId: plan.successorClaimId,
    expectedFenceRevision: plan.evidence.successor.claimDigest,
    expectedTransitionCounter: 1,
    ttlSeconds: plan.evidence.ttlSeconds,
    requestTemplateDigest,
  };
  return { ...values, intentDigest: digestValue({
    operationKey: effectOperationKey, claimId: values.claimId,
    expectedFenceRevision: values.expectedFenceRevision,
    expectedTransitionCounter: values.expectedTransitionCounter,
    ttlSeconds: values.ttlSeconds, requestTemplateDigest,
  }) };
}

async function stableObservation(adapter, operation) {
  const observe = operation === BRIDGE_RETIREMENT_OPERATION
    ? adapter.observeRetirement : adapter.observePromotion;
  const first = object(await observe(), "first planning evidence");
  const second = object(await observe(), "second planning evidence");
  requireStableEvidence(first, second, operation);
  return second;
}

export function stableWaitingBridgeEvidenceDigest(value, operation) {
  const projected = structuredClone(value);
  delete projected.observedAt;
  // These are transport positions, not applicability facts. Subject/inventory digests remain bound.
  if (projected.cloud) {
    delete projected.cloud.ledgerRevision;
    delete projected.cloud.ledgerDigest;
    delete projected.cloud.sequence;
  }
  return digestValue({ operation, evidence: projected });
}

export function requireStableWaitingBridgeEvidence(expected, actual, operation) {
  requireStableEvidence(expected, actual, operation);
}

function requireStableEvidence(expected, actual, operation) {
  if (stableWaitingBridgeEvidenceDigest(expected, operation)
    !== stableWaitingBridgeEvidenceDigest(actual, operation)) {
    throw new Error("Waiting-bridge stable double-read evidence drifted.");
  }
}

function buildPlan(operation, evidence) {
  return operation === BRIDGE_RETIREMENT_OPERATION
    ? buildBridgeRetirementPlan(evidence)
    : buildExistingSuccessorPromotionPlan(evidence);
}
function effectContext(journal, phase) {
  return Object.freeze({
    plan: journal.plan, journal, phase,
    operationKey: waitingBridgeOperationKey(journal.plan, phase),
  });
}
async function requireComplete(classify, context, label) {
  const result = await classification(classify(context), label);
  if (result.state !== "complete") throw new Error(`${label} is no longer complete.`);
}
async function classification(value, label) {
  const result = await value;
  if (!result || !["pending", "complete"].includes(result.state)) {
    throw new Error(`${label} classification is malformed.`);
  }
  if (result.state === "complete") object(result.values, `${label} values`);
  return result;
}
async function advance(adapter, journal, phase, values) {
  return persist(adapter, journal, advanceWaitingBridgeJournal(journal, phase, values));
}
async function persist(adapter, expected, next) {
  const stored = await adapter.writeJournal({ operation: expected.operation, expected, next });
  return normalizeWaitingBridgeJournal(stored || next);
}
function requireAdapter(adapter) {
  for (const method of METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Waiting-bridge controller adapter requires ${method}().`);
    }
  }
  return Object.freeze(Object.fromEntries(METHODS.map(name => [name, adapter[name]])));
}
function requireOperation(journal, operation) {
  if (journal.operation !== operation) throw new Error("Private journal operation is different.");
}
function requireDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be one object.`);
  }
  return value;
}
