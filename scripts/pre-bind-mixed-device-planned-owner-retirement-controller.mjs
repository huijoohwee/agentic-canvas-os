// Responsibility: Orchestrate the exact cloud, provider, then local retirement effects.
import {
  advanceJournal, authorizePlan, buildPlan, buildReceipt, createJournal, normalizeJournal, normalizeReceipt,
  operationKey, startJournal,
} from "./pre-bind-mixed-device-planned-owner-retirement-contract.mjs";

const METHODS = Object.freeze([
  "withLock", "readJournal", "writeJournal", "observe", "prepare", "classifyClaim", "retireClaim",
  "authorizeEffect", "classifyPullRequest", "closePullRequest", "classifyOwner", "releaseOwner", "verifyTerminal",
]);

export function createPreBindMixedDevicePlannedOwnerRetirementController({ adapter } = {}) {
  for (const method of METHODS) if (typeof adapter?.[method] !== "function") {
    throw new Error(`Pre-bind mixed-device retirement adapter requires ${method}().`);
  }
  return Object.freeze({ plan: () => plan(adapter), run: input => run(adapter, input) });
}

async function plan(adapter) {
  return adapter.withLock({ operation: "pre-bind-mixed-device-planned-owner-retirement", action: "plan" }, async () => {
    const existing = await adapter.readJournal();
    if (existing) {
      const journal = normalizeJournal(existing);
      if (journal.state === null) {
        const fresh = buildPlan(await stableObserve(adapter));
        if (fresh.planDigest !== journal.plan.planDigest) {
          throw new Error("Pre-bind mixed-device retirement evidence drifted after planning.");
        }
      }
      return journal.plan;
    }
    const candidate = buildPlan(await stableObserve(adapter));
    const next = createJournal(candidate);
    const stored = await adapter.writeJournal({ expected: null, next });
    return normalizeJournal(stored || next).plan;
  });
}

async function run(adapter, { planDigest, authorization } = {}) {
  requireDigest(planDigest, "run plan digest");
  return adapter.withLock({ operation: "pre-bind-mixed-device-planned-owner-retirement", action: "run", planDigest }, async () => {
    let journal = normalizeJournal(await adapter.readJournal());
    if (journal.plan.planDigest !== planDigest) throw new Error("Run digest does not match the persisted retirement plan.");
    authorizePlan(journal.plan, authorization);
    if (journal.state === null) journal = await persist(adapter, journal, startJournal(journal, authorization));
    return execute(adapter, journal);
  });
}

async function execute(adapter, initial) {
  let journal = initial;
  if (journal.state.phase === "complete") {
    const sealed = normalizeReceipt(journal.state.receipts.complete.receipt);
    const expected = buildReceipt(journal);
    if (sealed.receiptDigest !== expected.receiptDigest) throw new Error("Terminal replay receipt drifted.");
    const verified = await adapter.verifyTerminal({ plan: journal.plan, journal });
    if (verified?.terminalEvidenceDigest !== journal.state.receipts.verified.terminalEvidenceDigest) {
      throw new Error("Terminal replay evidence drifted.");
    }
    return expected;
  }
  if (journal.state.phase === "authorized") {
    const prepared = object(await adapter.prepare({ plan: journal.plan, journal }), "prepared evidence");
    journal = await advance(adapter, journal, "prepared", {
      operationKey: operationKey(journal.plan, "prepared"),
      relevantEvidenceDigest: requireDigest(prepared.relevantEvidenceDigest, "prepared relevant evidence"),
      workItemBindingDigest: requireDigest(prepared.workItemBindingDigest,
        "prepared work-item binding"),
      taskAuthorizationReceiptDigest: requireDigest(prepared.taskAuthorizationReceiptDigest,
        "prepared task authorization"),
    });
  }
  journal = await converge(adapter, journal, {
    prior: "prepared", intent: "claim-retirement-intent", attempted: "claim-retirement-attempted",
    complete: "claim-retired", classify: adapter.classifyClaim, effect: adapter.retireClaim,
    label: "claim retirement",
  });
  journal = await converge(adapter, journal, {
    prior: "claim-retired", intent: "pull-request-close-intent", attempted: "pull-request-close-attempted",
    complete: "pull-request-closed", classify: adapter.classifyPullRequest,
    effect: adapter.closePullRequest, label: "pull-request closure",
  });
  journal = await converge(adapter, journal, {
    prior: "pull-request-closed", intent: "owner-release-intent", attempted: "owner-release-attempted",
    complete: "owner-released", classify: adapter.classifyOwner, effect: adapter.releaseOwner,
    label: "local owner release",
  });
  if (journal.state.phase === "owner-released") {
    const terminal = object(await adapter.verifyTerminal({ plan: journal.plan, journal }), "terminal verification");
    journal = await advance(adapter, journal, "verified", {
      operationKey: operationKey(journal.plan, "verified"),
      terminalEvidenceDigest: requireDigest(terminal.terminalEvidenceDigest, "terminal evidence"),
    });
  }
  if (journal.state.phase === "verified") {
    const receipt = buildReceipt(journal);
    journal = await advance(adapter, journal, "complete", {
      operationKey: operationKey(journal.plan, "complete"), receipt,
    });
  }
  if (journal.state.phase !== "complete") throw new Error("Retirement did not reach its terminal phase.");
  return journal.state.receipts.complete.receipt;
}

async function converge(adapter, journal, step) {
  const { prior, intent, attempted, complete, classify, effect, label } = step;
  if (journal.state.phase === prior) {
    const authority = object(await adapter.authorizeEffect({ plan: journal.plan, journal,
      phase: attempted, operationKey: operationKey(journal.plan, attempted) }),
    `${label} task authorization`);
    journal = await advance(adapter, journal, intent, {
      operationKey: operationKey(journal.plan, intent),
      effectOperationKey: operationKey(journal.plan, attempted),
      priorJournalDigest: journal.journalDigest,
      taskAuthorizationReceiptDigest: requireDigest(authority.taskAuthorizationReceiptDigest,
        `${label} task authorization receipt`),
      taskAuthorizationExpectationDigest: requireDigest(authority.taskAuthorizationExpectationDigest,
        `${label} task authorization expectation`),
    });
  }
  if (journal.state.phase === intent) {
    journal = await advance(adapter, journal, attempted, {
      operationKey: operationKey(journal.plan, attempted),
      intentReceiptDigest: journal.state.receipts[intent].receiptDigest,
      taskAuthorizationReceiptDigest:
        journal.state.receipts[intent].taskAuthorizationReceiptDigest,
      taskAuthorizationExpectationDigest:
        journal.state.receipts[intent].taskAuthorizationExpectationDigest,
    });
  }
  if (journal.state.phase !== attempted) return journal;
  let result = object(await classify({ plan: journal.plan, journal,
    operationKey: operationKey(journal.plan, attempted) }), `${label} classification`);
  if (result.state === "pending") {
    let failure;
    try { await effect({ plan: journal.plan, journal,
      operationKey: operationKey(journal.plan, attempted),
      taskAuthorizationReceiptDigest:
        journal.state.receipts[attempted].taskAuthorizationReceiptDigest,
      taskAuthorizationExpectationDigest:
        journal.state.receipts[attempted].taskAuthorizationExpectationDigest }); }
    catch (error) { failure = error; }
    result = object(await classify({ plan: journal.plan, journal,
      operationKey: operationKey(journal.plan, attempted) }), `${label} post-effect classification`);
    if (result.state !== "complete") {
      if (failure) throw failure;
      throw new Error(`${label} did not converge.`);
    }
  } else if (result.state !== "complete") throw new Error(`${label} classification is invalid.`);
  const values = object(result.values, `${label} receipt values`);
  if (values.operationKey !== operationKey(journal.plan, attempted)) {
    throw new Error(`${label} did not join the exact operation key.`);
  }
  if (values.taskAuthorizationReceiptDigest
    !== journal.state.receipts[attempted].taskAuthorizationReceiptDigest) {
    throw new Error(`${label} did not join its durable task authorization.`);
  }
  if (values.taskAuthorizationExpectationDigest
    !== journal.state.receipts[attempted].taskAuthorizationExpectationDigest) {
    throw new Error(`${label} did not join its durable task authorization expectation.`);
  }
  return advance(adapter, journal, complete, values);
}

async function stableObserve(adapter) {
  const first = await adapter.observe();
  const second = await adapter.observe({ observedAt: first.observedAt });
  const left = buildPlan(first), right = buildPlan(second);
  if (left.planDigest !== right.planDigest) throw new Error("Planning evidence drifted between exact reads.");
  return second;
}
async function advance(adapter, current, phase, values) {
  return persist(adapter, current, advanceJournal(current, phase, values));
}
async function persist(adapter, expected, next) {
  return normalizeJournal(await adapter.writeJournal({ expected, next }) || next);
}
function requireDigest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`); return value; }
