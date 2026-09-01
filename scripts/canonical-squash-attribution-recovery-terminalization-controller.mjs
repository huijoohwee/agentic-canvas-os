// Responsibility: Orchestrate proof, exact cloud retirement, and completion-ready projection.
import {
  advanceJournal,
  authorizePlan,
  buildPlan,
  buildReceipt,
  createJournal,
  normalizeJournal,
  normalizeReceipt,
  operationKey,
  startJournal,
} from "./canonical-squash-attribution-recovery-terminalization-contract.mjs";

const METHODS = Object.freeze([
  "withOperationLock",
  "withLaneFence",
  "readJournal",
  "writeJournal",
  "observe",
  "verifyEvidence",
  "retireCloud",
  "projectCompletion",
  "verifyTerminal",
]);

export function createCanonicalSquashAttributionRecoveryTerminalizationController({
  adapter,
} = {}) {
  for (const method of METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Canonical squash attribution recovery adapter requires ${method}().`);
    }
  }
  return Object.freeze({
    plan: () => plan(adapter),
    run: input => run(adapter, input),
  });
}

async function plan(adapter) {
  return adapter.withOperationLock({ action: "plan" }, async () => {
    const existing = await adapter.readJournal();
    if (existing) {
      const journal = normalizeJournal(existing);
      if (journal.state === null) {
        const fresh = buildPlan(await stableObserve(
          adapter,
          journal.plan.evidence.observedAt,
        ));
        if (fresh.planDigest !== journal.plan.planDigest) {
          throw new Error("Recovery evidence drifted after planning.");
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
  return adapter.withOperationLock({ action: "run", planDigest }, async () => {
    let journal = normalizeJournal(await adapter.readJournal());
    if (journal.plan.planDigest !== planDigest) {
      throw new Error("Run digest does not match the persisted recovery plan.");
    }
    authorizePlan(journal.plan, authorization);
    if (journal.state === null) {
      journal = await persist(adapter, journal, startJournal(journal, authorization));
    }
    if (journal.state.phase === "complete") {
      const sealed = normalizeReceipt(journal.state.receipts.complete.receipt);
      const expected = buildReceipt(journal);
      if (sealed.receiptDigest !== expected.receiptDigest) {
        throw new Error("Recovery terminal replay receipt drifted.");
      }
      const terminal = requireObject(
        await adapter.verifyTerminal({ plan: journal.plan, journal, replay: true }),
        "terminal replay",
      );
      if (terminal.terminalEvidenceDigest
        !== journal.state.receipts.verified.terminalEvidenceDigest) {
        throw new Error("Recovery terminal replay evidence drifted.");
      }
      return expected;
    }
    if (journal.state.phase === "authorized") {
      const verified = requireObject(
        await adapter.verifyEvidence({ plan: journal.plan, journal }),
        "evidence verification",
      );
      journal = await advance(adapter, journal, "evidence-verified", {
        operationKey: operationKey(journal.plan, "evidence-verified"),
        evidenceVerificationDigest: requireDigest(
          verified.evidenceVerificationDigest,
          "evidence verification digest",
        ),
      });
    }
    return adapter.withLaneFence({ plan: journal.plan, journal }, async () => {
      return execute(adapter, journal);
    });
  });
}

async function execute(adapter, initial) {
  let journal = initial;
  if (journal.state.phase === "evidence-verified") {
    journal = await advance(adapter, journal, "cloud-retirement-intent", {
      operationKey: operationKey(journal.plan, "cloud-retirement-intent"),
      priorJournalDigest: journal.journalDigest,
      taskAuthorityBindingDigest:
        journal.plan.evidence.subject.taskAuthorityBindingDigest,
      taskAuthorizationOperation:
        `canonical-squash-attribution-recovery:cloud:${journal.plan.planDigest}:${operationKey(journal.plan, "cloud-retired")}`,
    });
  }
  if (journal.state.phase === "cloud-retirement-intent") {
    const retired = requireObject(
      await adapter.retireCloud({
        plan: journal.plan,
        journal,
        operationKey: operationKey(journal.plan, "cloud-retired"),
      }),
      "cloud retirement",
    );
    journal = await advance(adapter, journal, "cloud-retired", {
      operationKey: operationKey(journal.plan, "cloud-retired"),
      disposition: requireText(retired.disposition, "cloud retirement disposition"),
      cloudRetirementReceiptDigest: requireDigest(
        retired.cloudRetirementReceiptDigest,
        "cloud retirement receipt",
      ),
      taskAuthorizationReceiptDigest: requireDigest(
        retired.taskAuthorizationReceiptDigest,
        "cloud task authorization",
      ),
      taskAuthorizationReceipt: requireObject(
        retired.taskAuthorizationReceipt,
        "cloud task authorization receipt",
      ),
      cloudRetirementReceipt: requireObject(
        retired.cloudRetirementReceipt,
        "cloud retirement receipt",
      ),
      terminalCloudDigest: requireDigest(
        retired.terminalCloudDigest,
        "cloud terminal state digest",
      ),
      terminalCloud: requireObject(retired.terminalCloud, "cloud terminal state"),
    });
  }
  if (journal.state.phase === "cloud-retired") {
    journal = await advance(adapter, journal, "completion-intent", {
      operationKey: operationKey(journal.plan, "completion-intent"),
      priorJournalDigest: journal.journalDigest,
      taskAuthorityBindingDigest:
        journal.plan.evidence.subject.taskAuthorityBindingDigest,
      taskAuthorizationOperation:
        `canonical-squash-attribution-recovery:completion:${journal.plan.planDigest}:${operationKey(journal.plan, "completion-projected")}`,
    });
  }
  if (journal.state.phase === "completion-intent") {
    const projected = requireObject(
      await adapter.projectCompletion({
        plan: journal.plan,
        journal,
        operationKey: operationKey(journal.plan, "completion-projected"),
      }),
      "completion projection",
    );
    journal = await advance(adapter, journal, "completion-projected", {
      operationKey: operationKey(journal.plan, "completion-projected"),
      disposition: requireText(projected.disposition, "completion disposition"),
      mainSha: requireSha(projected.mainSha, "completion main SHA"),
      completionBaseSha: requireSha(
        projected.completionBaseSha,
        "completion base SHA",
      ),
      completionTopologyDigest: requireDigest(
        projected.completionTopologyDigest,
        "completion topology digest",
      ),
      completingLeaseDigest: requireDigest(
        projected.completingLeaseDigest,
        "completing lease digest",
      ),
      taskAuthorizationReceiptDigest: requireDigest(
        projected.taskAuthorizationReceiptDigest,
        "completion task authorization",
      ),
      taskAuthorizationReceipt: requireObject(
        projected.taskAuthorizationReceipt,
        "completion task authorization receipt",
      ),
      completionSummary: requireObject(
        projected.completionSummary,
        "completion summary",
      ),
    });
  }
  if (journal.state.phase === "completion-projected") {
    const terminal = requireObject(
      await adapter.verifyTerminal({ plan: journal.plan, journal, replay: false }),
      "terminal verification",
    );
    const verified = advanceJournal(journal, "verified", {
      operationKey: operationKey(journal.plan, "verified"),
      terminalEvidenceDigest: requireDigest(
        terminal.terminalEvidenceDigest,
        "terminal evidence digest",
      ),
      terminalEvidence: requireObject(terminal.terminalEvidence, "terminal evidence"),
    });
    const receipt = buildReceipt(verified);
    const complete = advanceJournal(verified, "complete", {
      operationKey: operationKey(journal.plan, "complete"),
      receipt,
    });
    journal = await persist(adapter, journal, complete);
  }
  if (journal.state.phase === "verified") {
    const terminal = requireObject(
      await adapter.verifyTerminal({ plan: journal.plan, journal, replay: true }),
      "terminal replay before completion",
    );
    if (terminal.terminalEvidenceDigest
      !== journal.state.receipts.verified.terminalEvidenceDigest) {
      throw new Error("Recovery terminal evidence drifted before completion sealing.");
    }
    const receipt = buildReceipt(journal);
    journal = await advance(adapter, journal, "complete", {
      operationKey: operationKey(journal.plan, "complete"),
      receipt,
    });
  }
  if (journal.state.phase !== "complete") {
    throw new Error("Recovery did not reach completion-ready state.");
  }
  return normalizeReceipt(journal.state.receipts.complete.receipt);
}

async function stableObserve(adapter, observedAt = null) {
  const first = await adapter.observe(observedAt ? { observedAt } : undefined);
  const second = await adapter.observe({ observedAt: first.observedAt });
  const left = buildPlan(first);
  const right = buildPlan(second);
  if (left.planDigest !== right.planDigest) {
    throw new Error("Recovery evidence drifted between exact reads.");
  }
  return second;
}

async function advance(adapter, current, phase, values) {
  return persist(adapter, current, advanceJournal(current, phase, values));
}
async function persist(adapter, expected, next) {
  return normalizeJournal(await adapter.writeJournal({ expected, next }) || next);
}
function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
function requireDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
function requireSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
function requireText(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} is invalid.`);
  return value;
}
