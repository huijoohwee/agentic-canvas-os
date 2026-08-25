// Responsibility: Orchestrate one exact journaled reviewed terminal-handoff recovery.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  PHASES, advanceRecoveryIntent, authorizeRecovery, buildRecoveryPlan,
  createRecoveryIntent, normalizeRecoveryIntent, normalizeRecoveryPlan, operationKey,
} from "./reviewed-terminal-handoff-successor-recovery-contract.mjs";

const EFFECTS = Object.freeze({
  "successor-claimed": "claimSuccessor",
  "successor-bound": "bindSuccessor",
  "successor-review-ready": "markSuccessorReviewReady",
  "local-cas": "projectLocal",
  "pr-marker": "projectPullRequest",
  verified: "verifyTerminal",
});
const METHODS = ["withFence", "captureEvidence", "readIntent", "writeIntent", "reconcile",
  ...Object.values(EFFECTS)];

export function createReviewedTerminalHandoffSuccessorRecoveryController(adapter) {
  for (const method of METHODS) if (typeof adapter?.[method] !== "function") {
    throw new Error(`Recovery adapter requires ${method}().`);
  }
  return Object.freeze({
    async plan({ operatorSessionId, ttlSeconds } = {}) {
      const stored = await adapter.readIntent();
      if (stored) return normalizeRecoveryIntent(stored).planSnapshot;
      const first = await adapter.captureEvidence();
      const second = await adapter.captureEvidence();
      if (digestValue(first) !== digestValue(second)) {
        throw new Error("Recovery evidence changed during read-only planning.");
      }
      return buildRecoveryPlan({ evidence: first, operatorSessionId, ttlSeconds });
    },
    async run({ plan: supplied, operatorSessionId, authorization } = {}) {
      return adapter.withFence(async () => {
        const plan = normalizeRecoveryPlan(supplied);
        authorizeRecovery({ plan, authorization });
        if (plan.operatorSessionId !== operatorSessionId) {
          throw new Error("Recovery plan belongs to another operator session.");
        }
        let intent = await adapter.readIntent();
        if (intent) {
          intent = normalizeRecoveryIntent(intent);
          if (intent.planDigest !== plan.planDigest) throw new Error("Stored recovery plan differs.");
        } else {
          const current = await adapter.captureEvidence();
          if (current.evidenceDigest !== plan.evidenceDigest) {
            throw new Error("Authorized recovery evidence is no longer exact-current.");
          }
          intent = createRecoveryIntent(plan, authorization);
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
      const next = advanceRecoveryIntent(intent, { phase, values: completion(intent) });
      await adapter.writeIntent({ expected: intent, value: next });
      return next.completion;
    }
    const input = {
      intent,
      plan: intent.planSnapshot,
      phase,
      operationKey: operationKey(intent.planSnapshot, phase),
    };
    let values = await adapter.reconcile(input);
    if (!values) {
      try { values = await adapter[EFFECTS[phase]](input); }
      catch (error) { values = await adapter.reconcile(input); if (!values) throw error; }
    }
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error(`Recovery phase ${phase} returned no receipt values.`);
    }
    const next = advanceRecoveryIntent(intent, { phase, values });
    await adapter.writeIntent({ expected: intent, value: next });
    intent = next;
  }
  return intent.completion;
}

function completion(intent) {
  const values = phase => intent.receipts[phase].values;
  const core = {
    schema: "agentic-reviewed-terminal-handoff-successor-recovery-completion/v1",
    status: "successor-review-ready",
    planDigest: intent.planDigest,
    sourceClaimId: intent.planSnapshot.sourceClaimId,
    handoffClaimId: intent.planSnapshot.handoffClaimId,
    successorClaimId: values("successor-claimed").claimId,
    claimReceiptDigest: values("successor-claimed").receiptDigest,
    bindReceiptDigest: values("successor-bound").receiptDigest,
    reviewReceiptDigest: values("successor-review-ready").receiptDigest,
    localProjectionReceiptDigest: values("local-cas").receiptDigest,
    pullRequestProjectionReceiptDigest: values("pr-marker").receiptDigest,
    terminalVerificationDigest: values("verified").receiptDigest,
    integrationAuthorityRestored: false,
    sourceBytesChanged: false,
    committed: false,
    pushed: false,
    merged: false,
    deployed: false,
    cleaned: false,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}
