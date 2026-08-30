// Responsibility: Project one task-authority continuation across an exact active-publish cloud successor.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  assertTaskAuthorityBinding,
  normalizeStableLaneIdentity,
  normalizeTaskAuthorityBinding,
} from "./task-bound-lane-authority-contract.mjs";

export const ACTIVE_PUBLISH_TASK_AUTHORITY_SUCCESSOR_RECEIPT_SCHEMA =
  "agentic-active-publish-task-authority-successor-receipt/v1";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function continueActivePublishTaskAuthoritySuccessor({
  sourceLease,
  targetLease,
  cloudOperationReceiptDigest,
  cloudVerificationReceiptDigest,
  boundAt = new Date().toISOString(),
}) {
  const sourceBinding = assertTaskAuthorityBinding({
    binding: sourceLease?.taskAuthority,
    lease: sourceLease,
  });
  requireInstant(boundAt, "successor binding time");
  requireDigest(cloudOperationReceiptDigest, "cloud operation receipt digest");
  requireDigest(cloudVerificationReceiptDigest, "cloud verification receipt digest");
  assertStableOwner(sourceLease, targetLease);
  assertSuccessorSubject({
    sourceLease,
    targetLease,
    cloudOperationReceiptDigest,
    cloudVerificationReceiptDigest,
  });

  const bindingCore = {
    schema: sourceBinding.schema,
    authoritySubjectId: sourceBinding.authoritySubjectId,
    proofAdapterId: sourceBinding.proofAdapterId,
    generation: sourceBinding.generation,
    publicKey: sourceBinding.publicKey,
    publicKeyDigest: sourceBinding.publicKeyDigest,
    laneBindingDigest: digestValue(laneIdentity(targetLease)),
    bindingMode: "continuation",
    boundAt,
    transitionPlanDigest: null,
    priorBindingDigest: sourceBinding.bindingDigest,
  };
  const binding = normalizeTaskAuthorityBinding({
    ...bindingCore,
    bindingDigest: digestValue(bindingCore),
  });
  assertTaskAuthorityBinding({ binding, lease: targetLease });

  const receiptCore = {
    schema: ACTIVE_PUBLISH_TASK_AUTHORITY_SUCCESSOR_RECEIPT_SCHEMA,
    branch: targetLease.branch,
    epoch: targetLease.epoch,
    sourceBaseSha: sourceLease.baseSha,
    sourceFenceSha: sourceLease.fenceSha,
    sourceClaimId: sourceLease.cloudAuthority.claimId,
    sourceBindingDigest: sourceBinding.bindingDigest,
    targetBaseSha: targetLease.baseSha,
    targetFenceSha: targetLease.fenceSha,
    targetClaimId: targetLease.cloudAuthority.claimId,
    targetBindingDigest: binding.bindingDigest,
    cloudOperationReceiptDigest,
    cloudVerificationReceiptDigest,
    boundAt,
  };
  return Object.freeze({
    binding: Object.freeze(binding),
    receipt: Object.freeze({
      ...receiptCore,
      receiptDigest: digestValue(receiptCore),
    }),
  });
}

function assertStableOwner(sourceLease, targetLease) {
  const stableFields = ["branch", "scope", "device", "epoch", "sessionId", "worktreePath", "pullRequestUrl"];
  if (stableFields.some(field => sourceLease?.[field] !== targetLease?.[field])) {
    throw new Error("Active-publish task authority successor changed its stable lane owner.");
  }
  if (sourceLease?.status !== "active" || targetLease?.status !== "active") {
    throw new Error("Active-publish task authority successor requires active source and target leases.");
  }
  const sourceAdmission = sourceLease?.admission;
  const targetAdmission = targetLease?.admission;
  if (sourceAdmission?.status !== "admitted" || targetAdmission?.status !== "admitted" ||
      sourceAdmission.semanticScope !== targetAdmission.semanticScope ||
      sourceAdmission.manifestDigest !== targetAdmission.manifestDigest ||
      sourceAdmission.writeSetDigest !== targetAdmission.writeSetDigest ||
      JSON.stringify(sourceAdmission.declaredWriteSet) !== JSON.stringify(targetAdmission.declaredWriteSet)) {
    throw new Error("Active-publish task authority successor changed its admitted write authority.");
  }
}

function assertSuccessorSubject({
  sourceLease,
  targetLease,
  cloudOperationReceiptDigest,
  cloudVerificationReceiptDigest,
}) {
  const source = sourceLease?.cloudAuthority;
  const target = targetLease?.cloudAuthority;
  const exact = source?.claimId && target?.claimId && source.claimId !== target.claimId &&
    source.canonicalBaseSha === sourceLease.baseSha && source.laneRevision === sourceLease.fenceSha &&
    target.canonicalBaseSha === targetLease.baseSha && target.laneRevision === targetLease.fenceSha &&
    target.leaseEpoch === source.leaseEpoch + 1 &&
    target.deviceId === source.deviceId && target.sessionId === source.sessionId &&
    target.reviewRequestId === source.reviewRequestId &&
    target.writeSetDigest === source.writeSetDigest &&
    target.operationReceiptDigest === cloudOperationReceiptDigest &&
    targetLease.admission.admissionReceiptDigest === cloudVerificationReceiptDigest;
  if (!exact) {
    throw new Error("Active-publish task authority successor changed its exact cloud operation subject.");
  }
}

// Must stay identical to the contract's stable lane identity: a second spelling
// of the bound operands is how a successor binding comes to disagree with the
// checker that validates it.
function laneIdentity(lease) {
  return normalizeStableLaneIdentity(lease);
}

function requireDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}

function requireInstant(value, label) {
  if (!value || new Date(value).toISOString() !== value) throw new Error(`${label} is invalid.`);
  return value;
}
