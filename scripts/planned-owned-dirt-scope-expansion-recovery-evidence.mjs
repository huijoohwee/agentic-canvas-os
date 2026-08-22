// Responsibility: Bind the planned lane, exact dirt, live cloud source, review, and controller.
import { digestValue, normalizeWriteSet }
  from "./cloud-collaboration-primitives.mjs";
import {
  assertActiveOwnedDirtWithinWriteSet,
  normalizeActiveOwnedDirtEvidence,
  requireSameActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";

export const EVIDENCE_SCHEMA =
  "agentic-planned-owned-dirt-scope-expansion-recovery-evidence/v1";

export function buildPlannedOwnedDirtScopeExpansionRecoveryEvidence(input = {}) {
  const ownedDirt = assertActiveOwnedDirtWithinWriteSet({
    evidence: input.ownedDirt,
    declaredWriteSet: input.declaredWriteSet,
  });
  const declaredWriteSet = normalizeWriteSet(input.declaredWriteSet);
  const core = {
    schema: EVIDENCE_SCHEMA,
    repositoryPathDigest: input.repositoryPathDigest,
    targetRepository: input.targetRepository,
    ledgerRepository: input.ledgerRepository,
    branch: input.branch,
    sessionId: input.sessionId,
    device: input.device,
    scope: input.scope,
    baseSha: input.baseSha,
    fenceSha: input.fenceSha,
    leaseDigest: input.leaseDigest,
    claimId: input.claimId,
    claimDigest: input.claimDigest,
    claimTransitionCounter: input.claimTransitionCounter,
    claimState: input.claimState,
    reviewRequestId: input.reviewRequestId,
    pullRequestUrl: input.pullRequestUrl,
    declaredWriteSet,
    writeSetDigest: input.writeSetDigest,
    manifestDigest: input.manifestDigest,
    existingLaneStateDigest: input.existingLaneStateDigest,
    ownedDirt,
    dirtDigest: ownedDirt.evidenceDigest,
    changedPaths: ownedDirt.entries.filter(entry => !entry.untracked).map(entry => entry.path),
    untrackedPaths: ownedDirt.entries.filter(entry => entry.untracked).map(entry => entry.path),
    taskAuthorityBindingDigest: input.taskAuthorityBindingDigest,
    cloudLedgerRevision: input.cloudLedgerRevision,
    cloudLedgerDigest: input.cloudLedgerDigest,
    controllerDigest: input.controllerDigest,
    observedAt: input.observedAt,
  };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function requireSamePlannedOwnedDirt(planEvidence, observedDirt) {
  return requireSameActiveOwnedDirtEvidence(
    normalizeActiveOwnedDirtEvidence(planEvidence.ownedDirt),
    observedDirt,
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value;
}
