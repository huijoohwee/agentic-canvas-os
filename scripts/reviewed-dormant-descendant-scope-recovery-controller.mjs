// Responsibility: Orchestrate one fenced, replay-safe reviewed descendant authority recovery.
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import {
  PHASES,
  advanceReviewedDormantDescendantScopeRecoveryIntent,
  authorizeReviewedDormantDescendantScopeRecovery,
  buildReviewedDormantDescendantCompletionReceipt,
  buildReviewedDormantDescendantScopeRecoveryPlan,
  createReviewedDormantDescendantScopeRecoveryIntent,
  normalizeReviewedDormantDescendantScopeRecoveryIntent,
  normalizeReviewedDormantDescendantScopeRecoveryPlan,
  normalizeReviewedDormantDescendantTerminalVerification,
  reviewedDormantDescendantScopeRecoveryOperationKey,
} from "./reviewed-dormant-descendant-scope-recovery-contract.mjs";

const EFFECTS = Object.freeze({
  "task-authority-verified": "authorizeTaskAuthority",
  "successor-waiting": "createWaitingSuccessor",
  "source-retired": "retireSourceClaim",
  "successor-current": "promoteSuccessor",
  "successor-bound": "bindSuccessor",
  "local-cas": "projectLocalLease",
  "pr-drafted": "projectDraftPullRequest",
  verified: "verifyTerminal",
});
const METHODS = Object.freeze([
  "withFence", "captureEvidence", "readIntent", "writeIntent", "reconcilePhase",
  ...Object.values(EFFECTS),
]);

export function createReviewedDormantDescendantScopeRecoveryAdapter(methods = {}) {
  for (const method of METHODS) {
    if (typeof methods[method] !== "function") {
      throw new Error(`Reviewed descendant recovery adapter requires ${method}().`);
    }
  }
  return Object.freeze(Object.fromEntries(METHODS.map(name => [name, methods[name]])));
}

export function createReviewedDormantDescendantScopeRecoveryController({ adapter } = {}) {
  const effects = createReviewedDormantDescendantScopeRecoveryAdapter(adapter);
  return Object.freeze({
    async plan({ operatorSessionId, ttlSeconds } = {}) {
      const stored = await effects.readIntent();
      if (stored) {
        return normalizeReviewedDormantDescendantScopeRecoveryIntent(stored).planSnapshot;
      }
      const first = await effects.captureEvidence();
      const second = await effects.captureEvidence();
      if (first?.evidenceDigest !== second?.evidenceDigest
        || digestValue(first) !== digestValue(second)) {
        throw new Error("Reviewed descendant recovery evidence changed during read-only planning.");
      }
      return buildReviewedDormantDescendantScopeRecoveryPlan({
        evidence: second,
        operatorSessionId,
        ttlSeconds,
      });
    },

    async run({ plan: supplied, operatorSessionId, authorization } = {}) {
      return effects.withFence(async () => {
        const plan = normalizeReviewedDormantDescendantScopeRecoveryPlan(supplied);
        authorizeReviewedDormantDescendantScopeRecovery({ plan, authorization });
        if (plan.operatorSessionId !== operatorSessionId) {
          throw new Error("Reviewed descendant recovery plan belongs to another operator session.");
        }
        let intent = await effects.readIntent();
        if (intent) {
          intent = normalizeReviewedDormantDescendantScopeRecoveryIntent(intent);
          if (intent.planDigest !== plan.planDigest
            || intent.authorization.statement !== authorization) {
            throw new Error("Stored reviewed descendant recovery authority differs from this plan.");
          }
        } else {
          const current = await effects.captureEvidence();
          if (current?.evidenceDigest !== plan.evidenceDigest
            || digestValue(current) !== digestValue(plan.evidence)) {
            throw new Error("Authorized reviewed descendant evidence is no longer exact-current.");
          }
          intent = createReviewedDormantDescendantScopeRecoveryIntent(plan, authorization);
          await effects.writeIntent({ expected: null, value: intent });
        }
        return execute(effects, intent);
      });
    },
  });
}

async function execute(adapter, initial) {
  let intent = initial;
  if (intent.phase === "complete") return replayCompletion(adapter, intent);
  for (const phase of PHASES.slice(PHASES.indexOf(intent.phase) + 1)) {
    if (phase === "complete") {
      const terminal = await freshTerminalVerification(adapter, intent);
      requireStableTerminal(intent.receipts.verified.values, terminal);
      const completion = buildReviewedDormantDescendantCompletionReceipt(
        intent.planSnapshot,
        terminal,
      );
      const next = advanceReviewedDormantDescendantScopeRecoveryIntent(intent, {
        phase,
        values: completion,
      });
      await adapter.writeIntent({ expected: intent, value: next });
      return completion;
    }
    const input = phaseInput(intent, phase);
    let raw = await adapter.reconcilePhase(input);
    let values = unwrap(raw);
    if (!values) {
      try {
        values = unwrap(await adapter[EFFECTS[phase]](input));
      } catch (error) {
        values = unwrap(await adapter.reconcilePhase(input));
        if (!values) throw error;
      }
    }
    if (!values) {
      throw new Error(`Reviewed descendant recovery phase ${phase} returned no receipt values.`);
    }
    const next = advanceReviewedDormantDescendantScopeRecoveryIntent(intent, {
      phase,
      values,
    });
    await adapter.writeIntent({ expected: intent, value: next });
    intent = next;
  }
  return intent.completion;
}

async function replayCompletion(adapter, intent) {
  const terminal = await freshTerminalVerification(adapter, intent);
  requireStableTerminal(intent.receipts.verified.values, terminal);
  return buildReviewedDormantDescendantCompletionReceipt(intent.planSnapshot, terminal);
}

async function freshTerminalVerification(adapter, intent) {
  const raw = await adapter.verifyTerminal({
    ...phaseInput(intent, "verified"),
    replay: true,
  });
  const values = unwrap(raw);
  if (!values) throw new Error("Reviewed descendant recovery lacks fresh terminal verification.");
  return normalizeReviewedDormantDescendantTerminalVerification(intent.planSnapshot, values);
}

function requireStableTerminal(expected, observed) {
  const stable = value => {
    const result = { ...value };
    delete result.schema;
    delete result.status;
    delete result.planDigest;
    delete result.receiptDigest;
    delete result.reviewedHeadSha;
    delete result.localHeadSha;
    delete result.verificationDigest;
    return result;
  };
  if (canonicalJson(stable(expected)) !== canonicalJson(stable(observed))) {
    throw new Error("Fresh reviewed descendant terminal verification changed stable authority.");
  }
}

function phaseInput(intent, phase) {
  return Object.freeze({
    intent,
    plan: intent.planSnapshot,
    phase,
    operationKey: reviewedDormantDescendantScopeRecoveryOperationKey(
      intent.planSnapshot,
      phase,
    ),
  });
}

function unwrap(value) {
  if (value === null || value === undefined || value?.kind === "pending") return null;
  if (value?.kind === "complete") return plain(value.values);
  return plain(value);
}
function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Reviewed descendant recovery adapter result is malformed.");
  }
  return structuredClone(value);
}
