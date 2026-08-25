// Responsibility: Normalize immutable evidence for one lost-capability owner recovery.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const EVIDENCE_SCHEMA =
  "agentic-reviewed-scope-expansion-lost-capability-owner-recovery-evidence/v1";

export function sealLostCapabilityOwnerRecoveryEvidence(value) {
  const normalized = normalizeLostCapabilityOwnerRecoveryEvidence(value);
  const core = { ...normalized };
  delete core.evidenceDigest;
  return freeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeLostCapabilityOwnerRecoveryEvidence(value) {
  const source = object(value, "evidence");
  if (source.schema !== EVIDENCE_SCHEMA) invalid("schema");
  const changedPaths = paths(source.changedPaths, "changed paths");
  const missingPaths = paths(source.missingPaths, "missing paths");
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    repository: absolute(source.repository, "repository"),
    branch: text(source.branch, "branch"),
    headSha: sha(source.headSha, "head SHA"),
    treeSha: sha(source.treeSha, "tree SHA"),
    sourceLeaseDigest: digest(source.sourceLeaseDigest, "source lease digest"),
    sourceBinding: binding(source.sourceBinding),
    sourceClaim: claim(source.sourceClaim),
    sourceJournalPath: absolute(source.sourceJournalPath, "source journal path"),
    sourceJournalBytesDigest: digest(source.sourceJournalBytesDigest, "source journal bytes digest"),
    pullRequest: pullRequest(source.pullRequest),
    changedPaths,
    missingPaths,
    targetManifest: manifest(source.targetManifest),
    targetCapability: capability(source.targetCapability),
    targetCapabilityDigest: digest(source.targetCapabilityDigest, "target capability digest"),
  };
  if (evidence.sourceBinding.generation + 1 !== evidence.targetCapability.generation
    || evidence.sourceBinding.authoritySubjectId === evidence.targetCapability.authoritySubjectId
    || evidence.targetCapabilityDigest !== digestValue(evidence.targetCapability)) {
    invalid("replacement capability transition");
  }
  if (!missingPaths.every(item => changedPaths.includes(item))) invalid("missing path inventory");
  if (source.evidenceDigest !== undefined
    && source.evidenceDigest !== digestValue(evidence)) invalid("digest");
  return freeze({ ...evidence, ...(source.evidenceDigest ? { evidenceDigest: source.evidenceDigest } : {}) });
}

function pullRequest(value) {
  const source = object(value, "pull request");
  return freeze({ url: text(source.url, "pull request URL"), number: positive(source.number, "pull request number"),
    id: text(source.id, "pull request id"), baseSha: sha(source.baseSha, "pull request base"),
    headSha: sha(source.headSha, "pull request head"),
    bodyRemainderDigest: digest(source.bodyRemainderDigest, "pull request body digest"),
    filesDigest: digest(source.filesDigest, "pull request files digest") });
}
function manifest(value) {
  const source = object(value, "target manifest");
  if (source.schema !== "agentic-declared-write-scope/v1") invalid("target manifest schema");
  return freeze({ schema: source.schema, semanticScope: text(source.semanticScope, "manifest scope"),
    declaredWriteSet: scopes(source.declaredWriteSet), writeSetDigest: digest(source.writeSetDigest, "write set digest"),
    manifestDigest: digest(source.manifestDigest, "manifest digest") });
}
function binding(value) {
  const source = object(value, "source binding");
  return freeze({ ...source, authoritySubjectId: text(source.authoritySubjectId, "source subject"),
    generation: positive(source.generation, "source generation"), publicKeyDigest: digest(source.publicKeyDigest, "source public key"),
    bindingDigest: digest(source.bindingDigest, "source binding digest") });
}
function capability(value) {
  const source = object(value, "target capability");
  return freeze({ authoritySubjectId: text(source.authoritySubjectId, "target subject"),
    proofAdapterId: text(source.proofAdapterId, "proof adapter"), generation: positive(source.generation, "target generation"),
    publicKey: text(source.publicKey, "target public key"), publicKeyDigest: digest(source.publicKeyDigest, "target public key digest") });
}
function claim(value) {
  const source = object(value, "source claim");
  return freeze({ claimId: digest(source.claimId, "claim id"), fenceRevision: digest(source.fenceRevision, "claim fence"),
    transitionCounter: positive(source.transitionCounter, "claim counter"), state: text(source.state, "claim state"),
    canonicalBaseRevision: sha(source.canonicalBaseRevision, "claim base"), laneRevision: sha(source.laneRevision, "claim lane"),
    writeSetDigest: digest(source.writeSetDigest, "claim write set"), reviewRequestId: text(source.reviewRequestId, "review request") });
}
function paths(value, label) { if (!Array.isArray(value)) invalid(label); return freeze([...value].map(item => text(item, label)).sort()); }
function scopes(value) { if (!Array.isArray(value) || value.length < 2) invalid("declared write set"); return freeze([...value].map(item => text(item, "declared scope")).sort()); }
function object(value, label) { if (!value || Array.isArray(value) || typeof value !== "object") invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim() || value !== value.trim()) invalid(label); return value; }
function absolute(value, label) { const result = text(value, label); if (!result.startsWith("/")) invalid(label); return result; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function freeze(value) { return Object.freeze(value); }
function invalid(label) { throw new Error(`Lost-capability owner recovery has invalid ${label}.`); }
