// Responsibility: Orchestrate one replay-safe waiter-first, source-second claim retirement.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  advanceMixedIdentityPairRetirementJournal,
  authorizeMixedIdentityPairRetirement,
  buildMixedIdentityPairRetirementPlan,
  buildMixedIdentityPairRetirementReceipt,
  createMixedIdentityPairRetirementJournal,
  mixedIdentityPairEffectReceiptDigest,
  mixedIdentityPairRetirementOperationKey,
  normalizeMixedIdentityPairRetirementJournal,
  startMixedIdentityPairRetirementJournal,
} from "./claim-only-mixed-identity-pair-retirement-contract.mjs";
import { stableMixedIdentityPairEvidenceDigest }
  from "./claim-only-mixed-identity-pair-retirement-evidence.mjs";

const METHODS = Object.freeze([
  "withOperationLock", "readJournal", "writeJournal", "observePlan", "prepare",
  "classifyWaitingSuccessorRetired", "retireWaitingSuccessor",
  "classifySourceRetired", "retireSource", "verifyTerminal",
]);

export function createMixedIdentityPairRetirementController({ adapter } = {}) {
  const runtime = requireAdapter(adapter);
  return Object.freeze({
    plan: () => plan(runtime),
    run: input => run(runtime, input),
  });
}

async function plan(adapter) {
  return adapter.withOperationLock({
    operation: "claim-only-mixed-identity-pair-retirement", action: "plan",
  }, async () => {
    const existing = await adapter.readJournal();
    if (existing) {
      const journal = normalizeMixedIdentityPairRetirementJournal(existing);
      if (journal.state === null) {
        const fresh = buildMixedIdentityPairRetirementPlan(await adapter.observePlan());
        if (stableMixedIdentityPairEvidenceDigest(fresh.evidence)
          !== stableMixedIdentityPairEvidenceDigest(journal.plan.evidence)) {
          throw new Error("Pair-relevant planning evidence drifted.");
        }
      }
      return journal.plan;
    }
    const candidate = buildMixedIdentityPairRetirementPlan(await adapter.observePlan());
    const next = createMixedIdentityPairRetirementJournal(candidate);
    const stored = await adapter.writeJournal({ expected: null, next });
    return normalizeMixedIdentityPairRetirementJournal(stored || next).plan;
  });
}

async function run(adapter, { planDigest, authorization } = {}) {
  requireDigest(planDigest, "run plan digest");
  return adapter.withOperationLock({
    operation: "claim-only-mixed-identity-pair-retirement", action: "run", planDigest,
  }, async () => {
    let journal = normalizeMixedIdentityPairRetirementJournal(await adapter.readJournal());
    if (journal.plan.planDigest !== planDigest) {
      throw new Error("Run digest does not match the private pair-retirement plan.");
    }
    authorizeMixedIdentityPairRetirement(journal.plan, authorization);
    if (!journal.state) {
      journal = await persist(adapter, journal,
        startMixedIdentityPairRetirementJournal(journal, authorization));
    }
    return execute(adapter, journal);
  });
}

async function execute(adapter, initial) {
  let journal = initial;
  const plan = journal.plan;
  if (journal.state.phase === "complete") {
    await verifyReplay(adapter, journal);
    return journal.state.receipts.complete.receipt;
  }
  if (journal.state.phase === "authorized") {
    const prepared = object(await adapter.prepare({ plan, journal }), "prepared frame");
    journal = await advance(adapter, journal, "prepared", {
      operationKey: mixedIdentityPairRetirementOperationKey(plan, "prepared"),
      relevantFrameDigest: requireDigest(prepared.relevantFrameDigest,
        "prepared relevant frame"),
      disjointMovementDigest: requireDigest(prepared.disjointMovementDigest,
        "prepared disjoint movement"),
      disjointMovementClassification: requireKeep(prepared.disjointMovementClassification),
    });
  }
  journal = await convergeEffect({
    adapter,
    journal,
    phase: "waiting-successor-retired",
    classify: adapter.classifyWaitingSuccessorRetired,
    effect: adapter.retireWaitingSuccessor,
    label: "waiting-successor retirement",
  });
  journal = await convergeEffect({
    adapter,
    journal,
    phase: "source-retired",
    classify: adapter.classifySourceRetired,
    effect: adapter.retireSource,
    label: "source retirement",
  });
  if (journal.state.phase === "source-retired") {
    const verified = object(await adapter.verifyTerminal({ plan, journal }),
      "terminal verification");
    const expectedEffectDigest = mixedIdentityPairEffectReceiptDigest(journal.state.receipts);
    if (verified.effectReceiptDigest !== expectedEffectDigest) {
      throw new Error("Terminal effect receipts do not join the fresh verification.");
    }
    journal = await advance(adapter, journal, "verified", {
      operationKey: mixedIdentityPairRetirementOperationKey(plan, "verified"),
      effectReceiptDigest: expectedEffectDigest,
      terminalRelevantDigest: requireDigest(verified.terminalRelevantDigest,
        "terminal relevant digest"),
      disjointMovementDigest: requireDigest(verified.disjointMovementDigest,
        "terminal disjoint movement"),
      disjointMovementClassification: requireKeep(verified.disjointMovementClassification),
    });
  }
  if (journal.state.phase === "verified") {
    const receipt = buildMixedIdentityPairRetirementReceipt(journal);
    journal = await advance(adapter, journal, "complete", {
      operationKey: mixedIdentityPairRetirementOperationKey(plan, "complete"), receipt,
    });
  }
  if (journal.state.phase !== "complete") {
    throw new Error(`Pair retirement stopped at ${journal.state.phase}.`);
  }
  return journal.state.receipts.complete.receipt;
}

async function convergeEffect({ adapter, journal, phase, classify, effect, label }) {
  const phaseIndex = phase === "waiting-successor-retired" ? 2 : 3;
  const currentIndex = ["authorized", "prepared", "waiting-successor-retired",
    "source-retired", "verified", "complete"].indexOf(journal.state.phase);
  if (currentIndex > phaseIndex) {
    await requireComplete(classify, effectContext(journal, phase), label);
    return journal;
  }
  if (currentIndex === phaseIndex) {
    await requireComplete(classify, effectContext(journal, phase), label);
    return journal;
  }
  if (currentIndex !== phaseIndex - 1) return journal;
  const context = effectContext(journal, phase);
  const before = await classification(classify(context), label);
  if (before.state === "complete") {
    return advance(adapter, journal, phase, before.values);
  }
  let failure = null;
  try { await effect(context); } catch (error) { failure = error; }
  const after = await classification(classify(context), label);
  if (after.state !== "complete") {
    if (failure) throw failure;
    throw new Error(`${label} did not converge durably.`);
  }
  return advance(adapter, journal, phase, after.values);
}

async function verifyReplay(adapter, journal) {
  const fresh = object(await adapter.verifyTerminal({ plan: journal.plan, journal }),
    "terminal replay verification");
  const sealed = journal.state.receipts.verified;
  if (fresh.effectReceiptDigest !== sealed.effectReceiptDigest
    || fresh.terminalRelevantDigest !== sealed.terminalRelevantDigest
    || fresh.disjointMovementClassification !== "keep") {
    throw new Error("Terminal pair-relevant evidence drifted after completion.");
  }
}

function effectContext(journal, phase) {
  return Object.freeze({
    plan: journal.plan,
    journal,
    phase,
    operationKey: mixedIdentityPairRetirementOperationKey(journal.plan, phase),
  });
}
async function requireComplete(classifier, context, label) {
  const result = await classification(classifier(context), label);
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
  return persist(adapter, journal,
    advanceMixedIdentityPairRetirementJournal(journal, phase, values));
}
async function persist(adapter, expected, next) {
  const stored = await adapter.writeJournal({ expected, next });
  return normalizeMixedIdentityPairRetirementJournal(stored || next);
}
function requireAdapter(adapter) {
  for (const method of METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Mixed-identity pair controller adapter requires ${method}().`);
    }
  }
  return Object.freeze(Object.fromEntries(METHODS.map(name => [name, adapter[name]])));
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be one object.`);
  }
  return value;
}
function requireDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}
function requireKeep(value) {
  if (value !== "keep") throw new Error("Disjoint movement must classify as keep.");
  return value;
}
