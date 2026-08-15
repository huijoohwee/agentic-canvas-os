// Responsibility: Seal exact predecessor, successor, provider, Git, and protected-main facts.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeEvidence } from "./active-publish-task-authority-successor-reconciliation-contract.mjs";

export function buildReconciliationEvidence(input) {
  const core = {
    observedAt: input.observedAt,
    repository: input.repository,
    branch: input.branch,
    sessionId: input.sessionId,
    pullRequest: input.pullRequest,
    canonical: input.canonical,
    source: input.source,
    target: input.target,
    leaseDigest: input.leaseDigest,
  };
  return normalizeEvidence({ ...core, evidenceDigest: digestValue(core) });
}

export function reconciliationEvidenceReplaySubjectDigest(value) {
  const evidence = normalizeEvidence(value);
  const { observedAt, evidenceDigest, ...stableSubject } = evidence;
  return digestValue(stableSubject);
}

export { normalizeEvidence as normalizeReconciliationEvidence };
