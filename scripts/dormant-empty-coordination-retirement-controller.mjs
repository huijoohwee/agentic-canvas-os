// Responsibility: Orchestrate one replay-safe dormant empty coordination retirement.
import {
  DORMANT_EMPTY_COORDINATION_RETIREMENT_PHASES,
  advanceDormantEmptyCoordinationRetirementIntent,
  authorizeDormantEmptyCoordinationRetirement,
  buildDormantEmptyCoordinationRetirementPlan,
  buildDormantEmptyCoordinationRetirementReceipt,
  createDormantEmptyCoordinationRetirementIntent,
  dormantEmptyCoordinationRetirementOperationKey,
  normalizeDormantEmptyCoordinationRetirementIntent,
  normalizeDormantEmptyCoordinationRetirementPlan,
} from "./dormant-empty-coordination-retirement-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";

const METHODS = Object.freeze([
  "withOperationLock", "readPlanEvidence", "readIntent", "writeIntent",
  "classifyClaimRetired", "retireClaim", "classifyPullRequestClosed",
  "closePullRequest", "verifyTerminal",
]);

export function createDormantEmptyCoordinationRetirementController({ adapter } = {}) {
  const runtime = normalizeAdapter(adapter);
  return Object.freeze({
    async plan() {
      return buildDormantEmptyCoordinationRetirementPlan(await runtime.readPlanEvidence());
    },
    async run({ planDigest, authorization } = {}) {
      requireDigest(planDigest, "run plan digest");
      return runtime.withOperationLock({ planDigest }, async fence => {
        let intent = await runtime.readIntent();
        if (intent) {
          intent = normalizeDormantEmptyCoordinationRetirementIntent(intent);
          const plan = normalizeDormantEmptyCoordinationRetirementPlan(intent.planSnapshot);
          requirePlanDigest(plan, planDigest);
          authorizeDormantEmptyCoordinationRetirement({ plan, authorization });
        } else {
          const plan = buildDormantEmptyCoordinationRetirementPlan(
            await runtime.readPlanEvidence(),
          );
          requirePlanDigest(plan, planDigest);
          const authorizationReceipt = authorizeDormantEmptyCoordinationRetirement({
            plan, authorization,
          });
          intent = createDormantEmptyCoordinationRetirementIntent({ plan, authorizationReceipt });
          intent = await persist(runtime, null, intent);
        }
        return execute({ adapter: runtime, fence, intent });
      });
    },
  });
}

async function execute({ adapter, fence, intent: initial }) {
  let intent = initial;
  const plan = normalizeDormantEmptyCoordinationRetirementPlan(intent.planSnapshot);
  if (intent.status === "complete") {
    const terminal = normalizeValues(await adapter.verifyTerminal(
      context({ fence, intent, plan }, "verified"),
    ), "terminal replay verification");
    const sealed = intent.phases.verified.values;
    const terminalEvidenceDigest = terminal.terminalEvidenceDigest || terminal.terminalDigest
      || digestValue(terminal);
    if (terminalEvidenceDigest !== sealed.terminalEvidenceDigest
      || Boolean(terminal.cloudMutation) !== sealed.cloudMutation
      || Boolean(terminal.providerMutation) !== sealed.providerMutation) {
      throw new Error("Retirement terminal evidence drifted after completion.");
    }
    return intent.phases.complete.values.receipt;
  }

  if (intent.status === "authorized") {
    intent = await advance(adapter, intent, "prepared", {
      operationKey: operationKey(plan, "prepared"),
      evidenceDigest: evidenceDigest(plan),
    });
  }

  if (phaseAtLeast(intent.status, "claim-retired")) {
    await requireClassified(adapter.classifyClaimRetired, context({ fence, intent, plan },
      "claim-retired"), "claim retirement");
  } else {
    intent = await executeEffect({
      adapter, fence, intent, plan, phase: "claim-retired",
      classify: adapter.classifyClaimRetired,
      effect: adapter.retireClaim,
      label: "claim retirement",
    });
  }

  if (intent.status === "claim-retired") {
    intent = await advance(adapter, intent, "pr-close-attempted", {
      operationKey: operationKey(plan, "pr-close-attempted"),
      evidenceDigest: evidenceDigest(plan),
      closeOperationKey: operationKey(plan, "pr-closed"),
      cloudMutation: intent.phases["claim-retired"].values.cloudMutation,
      providerMutation: false,
    });
  }

  if (phaseAtLeast(intent.status, "pr-closed")) {
    await requireClassified(adapter.classifyPullRequestClosed, context({ fence, intent, plan },
      "pr-closed"), "pull-request closure");
  } else {
    intent = await executeEffect({
      adapter, fence, intent, plan, phase: "pr-closed",
      classify: adapter.classifyPullRequestClosed,
      effect: adapter.closePullRequest,
      label: "pull-request closure",
    });
  }

  if (intent.status === "pr-closed") {
    const input = context({ fence, intent, plan }, "verified");
    const terminal = normalizeValues(await adapter.verifyTerminal(input), "verification");
    intent = await advance(adapter, intent, "verified", {
      operationKey: operationKey(plan, "verified"),
      evidenceDigest: evidenceDigest(plan),
      terminalEvidenceDigest: terminal.terminalEvidenceDigest || terminal.terminalDigest
        || digestValue(terminal),
      cloudMutation: Boolean(terminal.cloudMutation),
      providerMutation: Boolean(terminal.providerMutation),
    });
  }

  if (intent.status === "verified") {
    const values = { operationKey: operationKey(plan, "complete"),
      evidenceDigest: evidenceDigest(plan) };
    const receipt = buildDormantEmptyCoordinationRetirementReceipt({ plan, intent, values });
    intent = await advance(adapter, intent, "complete", { ...values, receipt });
  }

  if (intent.status !== "complete") {
    throw new Error(`Retirement stopped in unexpected phase ${intent.status}.`);
  }
  return intent.phases.complete.values.receipt;
}

async function executeEffect({ adapter, fence, intent, plan, phase, classify, effect, label }) {
  const input = context({ fence, intent, plan }, phase);
  const before = await normalizeClassification(classify(input), label);
  let effectValues = null;
  if (before.state !== "complete") {
    let effectError = null;
    try {
      effectValues = normalizeValues(await effect(input), `${label} effect`);
    } catch (error) {
      effectError = error;
    }
    const after = await normalizeClassification(classify(input), label);
    if (after.state !== "complete") {
      if (effectError) throw effectError;
      throw new Error(`${label} is not durably complete.`);
    }
    if (effectError) effectValues = responseLossValues(intent, phase);
    return advance(adapter, intent, phase,
      phaseValues(plan, phase, after.values, effectValues));
  }
  return advance(adapter, intent, phase, phaseValues(plan, phase, before.values, null));
}

async function requireClassified(classifier, input, label) {
  const result = await normalizeClassification(classifier(input), label);
  if (result.state !== "complete") throw new Error(`${label} is not durably complete.`);
  return result.values;
}

async function normalizeClassification(value, label) {
  const resolved = await value;
  if (!resolved || !["pending", "complete"].includes(resolved.state)) {
    throw new Error(`${label} classification is malformed.`);
  }
  if (resolved.state === "complete") normalizeValues(resolved.values, `${label} classification`);
  return resolved;
}

function context({ fence, intent, plan }, phase) {
  return Object.freeze({ fence, intent, plan, phase, operationKey: operationKey(plan, phase) });
}

function operationKey(plan, phase) {
  return dormantEmptyCoordinationRetirementOperationKey(plan, phase);
}

function phaseAtLeast(actual, expected) {
  return DORMANT_EMPTY_COORDINATION_RETIREMENT_PHASES.indexOf(actual)
    >= DORMANT_EMPTY_COORDINATION_RETIREMENT_PHASES.indexOf(expected);
}

function evidenceDigest(plan) {
  return plan.evidenceDigest || plan.evidence.evidenceDigest;
}

function phaseValues(plan, phase, classified, effect) {
  const observed = Object.freeze({ classified, effect });
  const common = {
    operationKey: operationKey(plan, phase),
    evidenceDigest: evidenceDigest(plan),
    disposition: effect?.disposition || classified.disposition || "adopted",
    cloudMutation: Boolean(classified.cloudMutation || effect?.cloudMutation),
    providerMutation: Boolean(classified.providerMutation || effect?.providerMutation),
  };
  if (phase === "claim-retired") {
    return { ...common, claimRetirementReceiptDigest:
      effect?.operationReceiptDigest || effect?.receiptDigest || digestValue({ phase, observed }) };
  }
  if (phase === "pr-closed") {
    return { ...common, pullRequestCloseReceiptDigest: digestValue({ phase, observed }) };
  }
  throw new Error(`Unsupported effect phase ${phase}.`);
}

function responseLossValues(intent, phase) {
  const cumulative = cumulativeMutations(intent);
  return Object.freeze({ disposition: "adopted",
    cloudMutation: cumulative.cloudMutation || phase === "claim-retired",
    providerMutation: cumulative.providerMutation });
}

function cumulativeMutations(intent) {
  let cloudMutation = false;
  let providerMutation = false;
  for (const phase of Object.values(intent.phases || {})) {
    cloudMutation ||= phase.values?.cloudMutation === true;
    providerMutation ||= phase.values?.providerMutation === true;
  }
  return { cloudMutation, providerMutation };
}

async function advance(adapter, intent, status, values) {
  const next = advanceDormantEmptyCoordinationRetirementIntent(intent, { status,
    values: normalizeValues(values, `${status} values`) });
  return persist(adapter, intent, next);
}

async function persist(adapter, expectedIntent, nextIntent) {
  const stored = await adapter.writeIntent({ expectedIntent, nextIntent });
  return normalizeDormantEmptyCoordinationRetirementIntent(stored || nextIntent);
}

function normalizeAdapter(adapter) {
  for (const method of METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Dormant empty coordination retirement adapter requires ${method}().`);
    }
  }
  return Object.freeze(Object.fromEntries(METHODS.map(name => [name, adapter[name]])));
}

function normalizeValues(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be one object.`);
  }
  return Object.freeze({ ...value });
}

function requirePlanDigest(plan, requested) {
  if (plan.planDigest !== requested) {
    throw new Error("Retirement plan digest differs from current exact authority.");
  }
}

function requireDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
}
