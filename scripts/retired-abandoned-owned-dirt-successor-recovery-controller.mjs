// Responsibility: Execute the fenced, journaled abandoned-owner successor sequence.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  PHASES,
  advanceRecoveryIntent,
  authorizeRecovery,
  buildRecoveryPlan,
  createRecoveryIntent,
  normalizeRecoveryIntent,
  normalizeRecoveryPlan,
  operationKey,
} from "./retired-abandoned-owned-dirt-successor-recovery-contract.mjs";

const EFFECTS = Object.freeze({
  "source-authorized": "authorizeSource",
  snapshotted: "snapshot",
  "reanchor-prepared": "prepareReanchor",
  "local-reanchored": "reanchorLocal",
  "remote-reanchored": "reanchorRemote",
  "pr-reopened": "reopenPullRequest",
  "recovery-claimed": "claimRecovery",
  "recovery-bound": "bindRecovery",
  "local-cas": "projectLocal",
  "pr-marker": "projectPullRequestMarker",
  verified: "verifyTerminal",
});
const METHODS = Object.freeze([
  "withFence",
  "captureEvidence",
  "readIntent",
  "writeIntent",
  "reconcile",
  ...Object.values(EFFECTS),
]);

export function createRetiredAbandonedOwnedDirtSuccessorRecoveryController(adapter) {
  for (const method of METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Recovery adapter requires ${method}().`);
    }
  }
  return Object.freeze({
    async plan({ targetManifest, operatorSessionId, ttlSeconds } = {}) {
      const stored = await adapter.readIntent();
      if (stored) return normalizeRecoveryIntent(stored).planSnapshot;
      const request = { targetManifest };
      const first = await adapter.captureEvidence(request);
      const second = await adapter.captureEvidence(request);
      if (digestValue(first) !== digestValue(second)) {
        throw new Error("Recovery evidence changed during read-only planning.");
      }
      return buildRecoveryPlan({ evidence: first, operatorSessionId, ttlSeconds });
    },
    async run({ plan: supplied, operatorSessionId, authorization } = {}) {
      const plan = normalizeRecoveryPlan(supplied);
      authorizeRecovery({ plan, authorization });
      if (plan.operatorSessionId !== operatorSessionId) {
        throw new Error("Recovery plan belongs to another operator session.");
      }
      return adapter.withFence(async () => {
        let intent = await adapter.readIntent();
        if (intent) {
          intent = normalizeRecoveryIntent(intent);
          if (intent.planDigest !== plan.planDigest) {
            throw new Error("Stored recovery plan differs from the supplied plan.");
          }
        } else {
          const current = await adapter.captureEvidence({
            targetManifest: plan.evidence.targetManifest,
          });
          if (current.evidenceDigest !== plan.evidenceDigest) {
            throw new Error("Authorized recovery evidence is no longer exact-current.");
          }
          intent = createRecoveryIntent(plan, authorization);
          await adapter.writeIntent({ expected: null, value: intent, plan });
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
      const values = completion(intent);
      const next = advanceRecoveryIntent(intent, { phase, values });
      await adapter.writeIntent({ expected: intent, value: next, plan: intent.planSnapshot });
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
      try {
        values = await adapter[EFFECTS[phase]](input);
      } catch (error) {
        values = await adapter.reconcile(input);
        if (!values) throw error;
      }
    }
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error(`Recovery phase ${phase} returned no receipt values.`);
    }
    const next = advanceRecoveryIntent(intent, { phase, values });
    await adapter.writeIntent({ expected: intent, value: next, plan: intent.planSnapshot });
    intent = next;
  }
  return intent.completion;
}

function completion(intent) {
  const values = phase => intent.receipts[phase].values;
  const plan = intent.planSnapshot;
  const core = {
    schema: "agentic-retired-abandoned-owned-dirt-successor-recovery-completion/v1",
    status: "mutation-authority-restored",
    planDigest: intent.planDigest,
    sourceClaimId: plan.sourceClaimId,
    recoveryClaimId: values("recovery-claimed").claimId,
    predecessorClaimId: null,
    sourceBaseSha: plan.sourceBaseSha,
    targetCanonicalBaseSha: plan.targetCanonicalBaseSha,
    targetCloudCanonicalBaseSha: plan.targetCloudCanonicalBaseSha,
    targetLocalBaseSha: plan.targetLocalBaseSha,
    protectedChangedPathsDigest: plan.protectedChangedPathsDigest,
    dirtyOverlapPathsDigest: plan.dirtyOverlapPathsDigest,
    dirtyOverlapPathCount: plan.dirtyOverlapPathCount,
    recoveryLaneRevision: plan.targetLaneRevision,
    targetCloudLeaseEpoch: plan.targetCloudLeaseEpoch,
    writerLeaseEpoch: plan.writerLeaseEpoch,
    targetWriteSetDigest: plan.targetWriteSetDigest,
    targetManifestDigest: plan.targetManifestDigest,
    targetCapabilityDigest: plan.targetCapabilityDigest,
    sourceAuthorizationReceiptDigest: values("source-authorized").receiptDigest,
    snapshotReceiptDigest: values("snapshotted").receiptDigest,
    reanchorPreparationReceiptDigest: values("reanchor-prepared").receiptDigest,
    localReanchorReceiptDigest: values("local-reanchored").receiptDigest,
    remoteReanchorReceiptDigest: values("remote-reanchored").receiptDigest,
    pullRequestReopenReceiptDigest: values("pr-reopened").receiptDigest,
    claimReceiptDigest: values("recovery-claimed").receiptDigest,
    bindReceiptDigest: values("recovery-bound").receiptDigest,
    localProjectionReceiptDigest: values("local-cas").receiptDigest,
    pullRequestMarkerReceiptDigest: values("pr-marker").receiptDigest,
    terminalVerificationDigest: values("verified").receiptDigest,
    mutationAuthorityReceiptDigest: values("verified").mutationAuthorityReceiptDigest,
    canonicalBaseChanged: true,
    authoredBytesPreserved: true,
    upstreamConflictResolutionRequired: plan.dirtyOverlapPathCount > 0,
    pullRequestBaseChanged: true,
    sourceBytesChanged: true,
    sourceIndexChanged: true,
    sourceHeadChanged: true,
    sourceWorktreeChanged: true,
    sourceUntrackedBytesPreserved: true,
    sourceLocalRefChanged: true,
    sourceRemoteRefChanged: true,
    sourceBranchRefsChanged: true,
    sourceCommitCreated: true,
    coordinationCommitCreated: true,
    authoredCommitCreated: false,
    authoredContentCommitted: false,
    coordinationCommitSha: plan.coordinationCommitSha,
    gitIndexChanged: true,
    gitHeadChanged: true,
    gitWorktreeChanged: true,
    untrackedBytesChanged: false,
    sourceBranchRefChanged: true,
    pullRequestReopened: true,
    committed: true,
    pushed: true,
    mergedProtectedMain: true,
    coordinationMergeOnly: true,
    pullRequestMerged: false,
    merged: false,
    deployed: false,
    cleaned: false,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}
