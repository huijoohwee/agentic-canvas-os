// Responsibility: Canonicalize stable cloud authority and bind fresh verifier attestations.

import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";

export const PROVISIONED_START_CLOUD_AUTHORITY_SUBJECT_SCHEMA =
  "agentic-provisioned-start-cloud-authority-subject/v1";
export const PROVISIONED_START_CLOUD_AUTHORITY_ATTESTATION_SCHEMA =
  "agentic-provisioned-start-cloud-authority-attestation/v1";
export const PROVISIONED_START_CLOUD_VERIFIER_ADAPTER_ID =
  "agentic-admission-cloud-authority-verifier";
export const PROVISIONED_START_CLOUD_VERIFIER_VERSION = 1;

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function projectProvisionedStartCloudAuthoritySubject({
  verified, lease, manifest,
} = {}) {
  const authority = object(verified?.authority, "verified authority");
  const verification = object(verified?.verification, "cloud verification");
  const claim = exactClaim(verification, authority.claimId);
  const declaredWriteSet = normalizeWriteSet(claim.declaredWriteScope);
  const subject = {
    schema: PROVISIONED_START_CLOUD_AUTHORITY_SUBJECT_SCHEMA,
    verificationSchema: text(verification.schema, "verification schema"),
    provider: text(authority.provider, "authority provider"),
    ledgerRepository: text(authority.ledgerRepository, "ledger repository"),
    targetRepository: text(authority.targetRepository, "target repository"),
    claim: {
      claimId: digest(authority.claimId, "claim ID"),
      claimDigest: digest(authority.claimDigest, "claim digest"),
      claimLedgerRevision: digest(authority.claimLedgerRevision, "claim ledger revision"),
      entrySchema: text(authority.entrySchema, "claim entry schema"),
      claimIdentitySchema: text(authority.claimIdentitySchema, "claim identity schema"),
      operationReceiptDigest: digest(authority.operationReceiptDigest, "operation receipt digest"),
      state: text(authority.state, "claim state"),
      transitionCounter: positive(authority.transitionCounter, "transition counter"),
      heartbeatCounter: nonnegative(claim.heartbeatCounter, "heartbeat counter"),
      leaseEpoch: positive(authority.leaseEpoch, "lease epoch"),
      expiresAt: instant(authority.expiresAt, "claim expiry"),
      mutationAuthorityEligible: authority.mutationAuthorityEligible === true,
      writeAuthority: claim.writeAuthority === true,
      scopeReserved: claim.scopeReserved === true,
    },
    owner: {
      actorId: text(claim.actorId, "claim actor"),
      repositoryId: text(claim.repositoryId, "claim repository"),
      workItemId: text(claim.workItemId, "claim work item"),
      deviceId: text(authority.deviceId, "authority device"),
      sessionId: text(authority.sessionId, "authority session"),
    },
    lane: {
      branch: text(lease?.branch, "lease branch"),
      canonicalBaseSha: sha(authority.canonicalBaseSha, "canonical base"),
      laneRevision: sha(authority.laneRevision, "lane revision"),
      fenceSha: sha(lease?.fenceSha, "lease fence"),
      reviewRequestId: optionalText(authority.reviewRequestId),
    },
    scope: {
      semanticScope: text(manifest?.semanticScope, "semantic scope"),
      declaredWriteSet,
      writeSetDigest: digest(authority.writeSetDigest, "write-set digest"),
      manifestDigest: digest(authority.manifestDigest, "manifest digest"),
    },
  };
  requireEqual(subject.claim.claimId, claim.claimId, "claim identity");
  requireEqual(subject.claim.claimDigest, claim.fenceRevision, "claim fence");
  requireEqual(subject.claim.claimLedgerRevision, claim.transitionDigest, "claim transition");
  requireEqual(subject.claim.state, claim.state, "claim state");
  requireEqual(subject.claim.transitionCounter, claim.transitionCounter, "claim counter");
  requireEqual(subject.claim.leaseEpoch, claim.leaseEpoch, "claim lease epoch");
  requireEqual(subject.claim.expiresAt, claim.expiresAt, "claim expiry");
  requireEqual(subject.lane.canonicalBaseSha, claim.canonicalBaseRevision, "claim base");
  requireEqual(subject.lane.laneRevision, claim.laneRevision, "claim lane revision");
  requireEqual(subject.lane.reviewRequestId, claim.reviewRequestId, "claim review request");
  requireEqual(subject.scope.writeSetDigest, claim.writeSetDigest, "claim write set");
  requireEqual(subject.scope.writeSetDigest, manifest?.writeSetDigest, "manifest write set");
  requireEqual(subject.scope.manifestDigest, manifest?.manifestDigest, "manifest digest");
  requireEqual(subject.scope.writeSetDigest, digestValue(declaredWriteSet), "declared write set");
  return Object.freeze(subject);
}

export function attestProvisionedStartCloudAuthoritySubject({ verified, subject } = {}) {
  const verification = object(verified?.verification, "cloud verification");
  const core = {
    schema: PROVISIONED_START_CLOUD_AUTHORITY_ATTESTATION_SCHEMA,
    verifier: {
      adapterId: PROVISIONED_START_CLOUD_VERIFIER_ADAPTER_ID,
      schema: PROVISIONED_START_CLOUD_AUTHORITY_SUBJECT_SCHEMA,
      version: PROVISIONED_START_CLOUD_VERIFIER_VERSION,
    },
    subjectDigest: digestValue(subject),
    sourceVerificationSchema: text(verification.schema, "verification schema"),
    sourceReceiptDigest: digest(verification.receiptDigest, "verification receipt"),
    verifiedAt: instant(verification.verifiedAt, "verification time"),
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function requireProvisionedStartCloudAuthorityAttestation(attestation, expectedSubjectDigest) {
  const value = object(attestation, "cloud authority attestation");
  const { receiptDigest, ...core } = value;
  if (core.schema !== PROVISIONED_START_CLOUD_AUTHORITY_ATTESTATION_SCHEMA
    || core.verifier?.adapterId !== PROVISIONED_START_CLOUD_VERIFIER_ADAPTER_ID
    || core.verifier?.schema !== PROVISIONED_START_CLOUD_AUTHORITY_SUBJECT_SCHEMA
    || core.verifier?.version !== PROVISIONED_START_CLOUD_VERIFIER_VERSION
    || digest(core.subjectDigest, "attested subject") !== digest(expectedSubjectDigest, "expected subject")
    || digest(core.sourceReceiptDigest, "source receipt") !== core.sourceReceiptDigest
    || instant(core.verifiedAt, "verification time") !== core.verifiedAt
    || digest(receiptDigest, "attestation receipt") !== digestValue(core)) {
    throw new Error("Fresh cloud verification did not attest the exact stable authority subject.");
  }
  return Object.freeze(value);
}

function exactClaim(verification, claimId) {
  const claims = verification.inventory?.claims;
  if (!Array.isArray(claims)) throw new Error("Cloud verification omitted its claim inventory.");
  const matches = claims.filter(claim => claim?.claimId === claimId);
  if (matches.length !== 1) throw new Error("Cloud verification requires one exact authority claim.");
  return object(matches[0], "verified claim");
}
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`); return value; }
function text(value, label) { const result = String(value || "").trim(); if (!result) throw new Error(`${label} is required.`); return result; }
function optionalText(value) { return value === null || value === undefined ? null : text(value, "optional identity"); }
function digest(value, label) { const result = String(value || ""); if (!DIGEST_PATTERN.test(result)) throw new Error(`${label} is invalid.`); return result; }
function sha(value, label) { const result = String(value || ""); if (!SHA_PATTERN.test(result)) throw new Error(`${label} is invalid.`); return result; }
function positive(value, label) { if (!Number.isInteger(value) || value < 1) throw new Error(`${label} is invalid.`); return value; }
function nonnegative(value, label) { if (!Number.isInteger(value) || value < 0) throw new Error(`${label} is invalid.`); return value; }
function instant(value, label) { const result = String(value || ""); if (!result || !Number.isFinite(Date.parse(result))) throw new Error(`${label} is invalid.`); return result; }
function requireEqual(left, right, label) { if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(`${label} drifted across authority evidence.`); }
