// Responsibility: Execute one exact journaled reviewed-handoff scope repair.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  PHASES, advanceScopeExpansionRecoveryIntent, authorizeScopeExpansionRecovery,
  buildScopeExpansionRecoveryPlan, createScopeExpansionRecoveryIntent,
  normalizeScopeExpansionRecoveryIntent, normalizeScopeExpansionRecoveryPlan,
  scopeExpansionRecoveryOperationKey,
} from "./reviewed-terminal-handoff-scope-expansion-recovery-contract.mjs";

const EFFECTS = Object.freeze({
  "source-recovered": "recoverSource",
  "successor-claimed": "claimSuccessor",
  "source-retired": "retireSource",
  "successor-promoted": "promoteSuccessor",
  "successor-bound": "bindSuccessor",
  "successor-review-ready": "markSuccessorReviewReady",
  "local-cas": "projectLocal",
  "pr-marker": "projectPullRequest",
  "source-journal-archived": "archiveSourceJournal",
  verified: "verifyTerminal",
});

export function createReviewedTerminalHandoffScopeExpansionRecoveryController(adapter) {
  const methods = ["withFence", "captureEvidence", "readIntent", "writeIntent", "reconcile",
    ...Object.values(EFFECTS)];
  for (const method of methods) if (typeof adapter?.[method] !== "function") {
    throw new Error(`Scope repair adapter requires ${method}().`);
  }
  return Object.freeze({
    async plan({ operatorSessionId, ttlSeconds } = {}) {
      const stored = await adapter.readIntent();
      if (stored) return normalizeScopeExpansionRecoveryIntent(stored).planSnapshot;
      const first = await adapter.captureEvidence();
      const second = await adapter.captureEvidence();
      if (digestValue(first) !== digestValue(second)) {
        throw new Error("Scope repair evidence changed during read-only planning.");
      }
      return buildScopeExpansionRecoveryPlan({ evidence: first, operatorSessionId, ttlSeconds });
    },
    async run({ plan: supplied, operatorSessionId, authorization } = {}) {
      return adapter.withFence(async () => {
        const plan = normalizeScopeExpansionRecoveryPlan(supplied);
        authorizeScopeExpansionRecovery({ plan, authorization });
        if (plan.operatorSessionId !== operatorSessionId) {
          throw new Error("Scope repair plan belongs to another operator session.");
        }
        let intent = await adapter.readIntent();
        if (intent) {
          intent = normalizeScopeExpansionRecoveryIntent(intent);
          if (intent.planDigest !== plan.planDigest) throw new Error("Stored scope repair plan differs.");
        } else {
          const current = await adapter.captureEvidence();
          if (current.evidenceDigest !== plan.evidenceDigest) {
            throw new Error("Authorized scope repair evidence is no longer exact-current.");
          }
          intent = createScopeExpansionRecoveryIntent(plan, authorization);
          await adapter.writeIntent({ expected: null, value: intent });
        }
        return execute(adapter, intent);
      });
    },
  });
}

async function execute(adapter, initial) {
  let intent = initial;
  if (intent.phase === "complete") return intent.completion;
  for (const phase of PHASES.slice(PHASES.indexOf(intent.phase) + 1)) {
    if (phase === "complete") {
      const next = advanceScopeExpansionRecoveryIntent(intent, { phase, values: completion(intent) });
      await adapter.writeIntent({ expected: intent, value: next });
      return next.completion;
    }
    const input = { intent, plan: intent.planSnapshot, phase,
      operationKey: scopeExpansionRecoveryOperationKey(intent.planSnapshot, phase) };
    let values = await adapter.reconcile(input);
    if (!values) {
      try { values = await adapter[EFFECTS[phase]](input); }
      catch (error) { values = await adapter.reconcile(input); if (!values) throw error; }
    }
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error(`Scope repair phase ${phase} returned no receipt values.`);
    }
    const next = advanceScopeExpansionRecoveryIntent(intent, { phase, values });
    await adapter.writeIntent({ expected: intent, value: next });
    intent = next;
  }
  return intent.completion;
}

function completion(intent) {
  const values = phase => intent.receipts[phase].values;
  const core = { schema: "agentic-reviewed-terminal-handoff-scope-expansion-recovery-completion/v1",
    status: "successor-review-ready", planDigest: intent.planDigest,
    sourceClaimId: intent.planSnapshot.sourceClaimId,
    successorClaimId: values("successor-claimed").claimId,
    reviewReceiptDigest: values("successor-review-ready").receiptDigest,
    localProjectionReceiptDigest: values("local-cas").receiptDigest,
    pullRequestProjectionReceiptDigest: values("pr-marker").receiptDigest,
    sourceJournalArchiveReceiptDigest: values("source-journal-archived").receiptDigest,
    terminalVerificationDigest: values("verified").receiptDigest,
    integrationAuthorityRestored: false, sourceBytesChanged: false,
    committed: false, pushed: false, merged: false, deployed: false, cleaned: false };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}
