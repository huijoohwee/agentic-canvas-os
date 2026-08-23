// Responsibility: Run one bounded, checkpointed lane-convergence transaction under one authorization.
import {
  authorizeLaneConvergence,
  buildInternalGrant,
  buildLaneConvergenceReceipt,
  completeLaneConvergenceIntent,
  createLaneConvergenceIntent,
  normalizeLaneConvergenceIntent,
  normalizeLaneConvergencePlan,
  normalizeTransitionDecision,
  withTransitionAttempt,
  withTransitionComplete,
} from "./lane-convergence-transaction-contract.mjs";

const METHODS = Object.freeze([
  "observe", "next", "classify", "execute", "verifyTransition", "verifyTerminal",
]);

export function createLaneConvergenceController({ adapter, journal, now = () => new Date() } = {}) {
  const runtime = normalizeAdapter(adapter);
  if (!journal || typeof journal.readIntent !== "function"
    || typeof journal.writeIntent !== "function" || typeof journal.withOperationLock !== "function") {
    throw new Error("Lane-convergence controller requires a durable journal.");
  }

  async function run({ plan: rawPlan, authorization } = {}) {
    const plan = normalizeLaneConvergencePlan(rawPlan);
    return journal.withOperationLock(async () => {
      let intent = journal.readIntent();
      if (intent) {
        intent = normalizeLaneConvergenceIntent(intent, plan);
        if (authorization !== plan.exactAuthorization) {
          throw new Error(`Exact authorization required: ${plan.exactAuthorization}`);
        }
      } else {
        const authorizationReceipt = authorizeLaneConvergence({ plan, authorization,
          authorizedAt: now() });
        intent = persist(null, createLaneConvergenceIntent({ plan, authorizationReceipt }));
      }
      if (intent.status === "complete") return buildLaneConvergenceReceipt({ plan, intent });
      return executeToTerminal({ plan, intent });
    });
  }

  async function executeToTerminal({ plan, intent: initial }) {
    let intent = initial;
    while (intent.status === "running") {
      const pending = intent.transitions.at(-1);
      if (pending?.status === "attempted") {
        intent = await settleAttempt({ plan, intent, record: pending });
        continue;
      }
      const observation = await runtime.observe(context({ plan, intent }));
      const decision = await runtime.next(context({ plan, intent, observation }));
      if (decision?.kind === "terminal") {
        const terminal = await runtime.verifyTerminal(context({ plan, intent, observation,
          terminalCandidate: decision.terminal }));
        intent = persist(intent, completeLaneConvergenceIntent({ intent, plan, terminal }));
        break;
      }
      const transition = normalizeTransitionDecision(decision, plan);
      intent = persist(intent, withTransitionAttempt({ intent, plan, decision: transition,
        attemptedAt: now() }));
      intent = await settleAttempt({ plan, intent, record: intent.transitions.at(-1) });
    }
    return buildLaneConvergenceReceipt({ plan, intent });
  }

  async function settleAttempt({ plan, intent, record }) {
    const decision = record.decision;
    const grant = buildInternalGrant({ plan, authorizationReceipt: intent.authorization, decision });
    const base = context({ plan, intent, decision, grant });
    let classification = normalizeClassification(await runtime.classify(base));
    let execution = null;
    if (classification.state === "pending") {
      let executionError = null;
      try { execution = await runtime.execute(base); } catch (error) { executionError = error; }
      classification = normalizeClassification(await runtime.classify({ ...base, execution }));
      if (classification.state === "pending") {
        if (executionError) throw executionError;
        throw new Error(`Lane-convergence transition ${decision.operationKey} is not durably complete.`);
      }
    }
    const resultReceipt = await runtime.verifyTransition({ ...base, execution,
      classification: classification.evidence });
    const completed = withTransitionComplete({ intent, plan, resultReceipt, completedAt: now() });
    return persist(intent, completed);
  }

  function persist(expectedIntent, nextIntent) {
    return journal.writeIntent({ expectedIntent, nextIntent });
  }

  return Object.freeze({ run });
}

function normalizeAdapter(adapter) {
  for (const method of METHODS) if (typeof adapter?.[method] !== "function") {
    throw new Error(`Lane-convergence adapter requires ${method}().`);
  }
  return adapter;
}

function normalizeClassification(value) {
  if (!value || !["pending", "complete"].includes(value.state)) {
    throw new Error("Lane-convergence classification is malformed.");
  }
  if (value.state === "complete" && (!value.evidence || typeof value.evidence !== "object"
    || Array.isArray(value.evidence))) {
    throw new Error("Lane-convergence completed classification requires evidence.");
  }
  return Object.freeze({ state: value.state, evidence: value.state === "complete" ? value.evidence : null });
}

function context(value) { return Object.freeze({ ...value }); }
