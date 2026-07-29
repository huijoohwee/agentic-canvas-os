import { createHash } from "node:crypto";

export const INTEGRATION_RECEIPT_SCHEMA = "agentic-integration-receipt/v1";
export const RUNTIME_REVIEW_RECEIPT_SCHEMA = "agentic-runtime-review-receipt/v1";
export const CANDIDATE_MANIFEST_SCHEMA = "agentic-candidate-manifest/v1";
export const HUMAN_AUTHORIZATION_RECEIPT_SCHEMA = "agentic-human-authorization-receipt/v1";
export const LIVE_VERIFICATION_RECEIPT_SCHEMA = "agentic-live-verification-receipt/v1";
export const PUBLICATION_RECEIPT_SCHEMA = "agentic-publication-receipt/v1";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COLLABORATION_FIELDS = [
  "actorId",
  "deviceId",
  "sessionId",
  "worktreeId",
  "branchId",
  "scopeId",
  "leaseEpoch",
  "fenceRevision",
];

export function createIntegrationReceipt(input) {
  requireExact(input, [
    "sourceRevision",
    "sourceDigest",
    "dependencyClosureDigest",
    "checksDigest",
    "evaluatorId",
    "collaboration",
    "integrationTargetDigest",
    "integratedAt",
  ], "Integration Receipt input");
  requireText(input.sourceRevision, "sourceRevision");
  for (const field of ["sourceDigest", "dependencyClosureDigest", "checksDigest", "integrationTargetDigest"]) {
    requireDigest(input[field], field);
  }
  requireText(input.evaluatorId, "evaluatorId");
  requireCollaboration(input.collaboration);
  requireInstant(input.integratedAt, "integratedAt");
  return receipt({
    schema: INTEGRATION_RECEIPT_SCHEMA,
    status: "integrated",
    ...input,
  });
}

export function createRuntimeReviewReceipt(integration, input) {
  validateIntegrationReceipt(integration);
  requireExact(input, [
    "reviewSurfaceDigest",
    "policyDigest",
    "probesDigest",
    "reviewerId",
    "issuedAt",
    "expiresAt",
  ], "Runtime Review Receipt input");
  for (const field of ["reviewSurfaceDigest", "policyDigest", "probesDigest"]) requireDigest(input[field], field);
  requireText(input.reviewerId, "reviewerId");
  requireWindow(input.issuedAt, input.expiresAt, "Runtime Review Receipt");
  return receipt({
    schema: RUNTIME_REVIEW_RECEIPT_SCHEMA,
    status: "reviewed",
    integrationReceiptDigest: integration.receiptDigest,
    sourceDigest: integration.sourceDigest,
    dependencyClosureDigest: integration.dependencyClosureDigest,
    ...input,
  });
}

export function createCandidateManifest(review, input) {
  validateRuntimeReviewReceipt(review);
  requireExact(input, [
    "targetDigest",
    "artifactDigest",
    "manifestDigest",
    "rollbackTargetDigest",
    "builtAt",
  ], "Candidate Manifest input");
  for (const field of ["targetDigest", "artifactDigest", "manifestDigest", "rollbackTargetDigest"]) {
    requireDigest(input[field], field);
  }
  requireInstant(input.builtAt, "builtAt");
  if (Date.parse(input.builtAt) > Date.parse(review.expiresAt)) {
    throw new Error("Candidate preparation occurred after the Runtime Review Receipt expired.");
  }
  return receipt({
    schema: CANDIDATE_MANIFEST_SCHEMA,
    status: "awaiting-human-authorization",
    runtimeReviewReceiptDigest: review.receiptDigest,
    sourceDigest: review.sourceDigest,
    dependencyClosureDigest: review.dependencyClosureDigest,
    policyDigest: review.policyDigest,
    ...input,
  });
}

export function createHumanAuthorizationReceipt(candidate, input) {
  validateCandidateManifest(candidate);
  requireExact(input, [
    "decisionKind",
    "humanActorId",
    "decisionRef",
    "authorityAdapterId",
    "issuedAt",
    "expiresAt",
  ], "Human Authorization Receipt input");
  if (input.decisionKind !== "human") throw new Error("Forward deployment requires an authenticated human decision.");
  for (const field of ["humanActorId", "decisionRef", "authorityAdapterId"]) requireText(input[field], field);
  requireWindow(input.issuedAt, input.expiresAt, "Human Authorization Receipt");
  if (Date.parse(input.issuedAt) < Date.parse(candidate.builtAt)) {
    throw new Error("Human authorization cannot predate the Candidate Manifest.");
  }
  return receipt({
    schema: HUMAN_AUTHORIZATION_RECEIPT_SCHEMA,
    status: "authorized",
    candidateDigest: candidate.receiptDigest,
    targetDigest: candidate.targetDigest,
    releaseKey: releaseKey(candidate.targetDigest, candidate.receiptDigest),
    ...input,
    consumedAt: null,
  });
}

export function validateAuthorizedDeployment({
  integration,
  review,
  candidate,
  authorization,
  current,
  now,
}) {
  validateIntegrationReceipt(integration);
  validateRuntimeReviewReceipt(review);
  validateCandidateManifest(candidate);
  validateHumanAuthorizationReceipt(authorization);
  requireExact(current, [
    "integrationReceiptDigest",
    "runtimeReviewReceiptDigest",
    "candidateDigest",
    "authorizationReceiptDigest",
    "sourceDigest",
    "dependencyClosureDigest",
    "policyDigest",
    "targetDigest",
    "artifactDigest",
    "manifestDigest",
  ], "current deployment identity");
  requireInstant(now, "now");
  if (review.integrationReceiptDigest !== integration.receiptDigest ||
      candidate.runtimeReviewReceiptDigest !== review.receiptDigest ||
      authorization.candidateDigest !== candidate.receiptDigest) {
    throw new Error("Release receipt chain is unjoined.");
  }
  if (authorization.targetDigest !== candidate.targetDigest ||
      authorization.releaseKey !== releaseKey(candidate.targetDigest, candidate.receiptDigest)) {
    throw new Error("Human authorization is bound to another target or candidate.");
  }
  if (authorization.consumedAt !== null) throw new Error("Human authorization was already consumed.");
  if (Date.parse(now) > Date.parse(authorization.expiresAt)) throw new Error("Human authorization expired.");
  const expected = {
    integrationReceiptDigest: integration.receiptDigest,
    runtimeReviewReceiptDigest: review.receiptDigest,
    candidateDigest: candidate.receiptDigest,
    authorizationReceiptDigest: authorization.receiptDigest,
    sourceDigest: candidate.sourceDigest,
    dependencyClosureDigest: candidate.dependencyClosureDigest,
    policyDigest: candidate.policyDigest,
    targetDigest: candidate.targetDigest,
    artifactDigest: candidate.artifactDigest,
    manifestDigest: candidate.manifestDigest,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (current[field] !== value) throw new Error(`Forward deployment blocked by ${field} drift.`);
  }
  return true;
}

export function dispatchReleaseController(ledger = {}, input) {
  requireExact(input, ["targetDigest", "candidateDigest", "controllerId"], "release dispatch");
  requireDigest(input.targetDigest, "targetDigest");
  requireDigest(input.candidateDigest, "candidateDigest");
  requireText(input.controllerId, "controllerId");
  const key = releaseKey(input.targetDigest, input.candidateDigest);
  const active = ledger[input.targetDigest];
  if (active) {
    if (active.candidateDigest !== input.candidateDigest) {
      throw new Error("Target is fenced by a competing release candidate.");
    }
    return Object.freeze({
      status: "coalesced",
      releaseKey: key,
      ownerControllerId: active.controllerId,
      ledger,
    });
  }
  const next = Object.freeze({
    ...ledger,
    [input.targetDigest]: Object.freeze({
      status: "in-progress",
      releaseKey: key,
      candidateDigest: input.candidateDigest,
      controllerId: input.controllerId,
    }),
  });
  return Object.freeze({
    status: "claimed",
    releaseKey: key,
    ownerControllerId: input.controllerId,
    ledger: next,
  });
}

export function consumeHumanAuthorizationReceipt(authorization, { consumedAt, controllerId }) {
  validateHumanAuthorizationReceipt(authorization);
  if (authorization.consumedAt !== null) throw new Error("Human authorization was already consumed.");
  requireInstant(consumedAt, "consumedAt");
  requireText(controllerId, "controllerId");
  const { receiptDigest: _priorDigest, ...prior } = authorization;
  return receipt({
    ...prior,
    status: "consumed",
    consumedAt,
    controllerId,
    authorizationReceiptDigest: authorization.receiptDigest,
  });
}

export function createLiveVerificationReceipt(consumedAuthorization, input) {
  validateConsumedAuthorizationReceipt(consumedAuthorization);
  requireExact(input, [
    "deployedArtifactDigest",
    "observedRuntimeDigest",
    "probesDigest",
    "rollbackTargetDigest",
    "verifiedAt",
  ], "Live Verification Receipt input");
  for (const field of ["deployedArtifactDigest", "observedRuntimeDigest", "probesDigest", "rollbackTargetDigest"]) {
    requireDigest(input[field], field);
  }
  requireInstant(input.verifiedAt, "verifiedAt");
  return receipt({
    schema: LIVE_VERIFICATION_RECEIPT_SCHEMA,
    status: "verified",
    authorizationReceiptDigest: consumedAuthorization.receiptDigest,
    candidateDigest: consumedAuthorization.candidateDigest,
    targetDigest: consumedAuthorization.targetDigest,
    controllerId: consumedAuthorization.controllerId,
    ...input,
  });
}

export function createPublicationReceipt(liveVerification, { publicationIdentitiesDigest, publishedAt }) {
  validateLiveVerificationReceipt(liveVerification);
  requireDigest(publicationIdentitiesDigest, "publicationIdentitiesDigest");
  requireInstant(publishedAt, "publishedAt");
  return receipt({
    schema: PUBLICATION_RECEIPT_SCHEMA,
    status: "published",
    liveVerificationReceiptDigest: liveVerification.receiptDigest,
    candidateDigest: liveVerification.candidateDigest,
    targetDigest: liveVerification.targetDigest,
    publicationIdentitiesDigest,
    publishedAt,
  });
}

export function releaseKey(targetDigest, candidateDigest) {
  requireDigest(targetDigest, "targetDigest");
  requireDigest(candidateDigest, "candidateDigest");
  return digest({ targetDigest, candidateDigest });
}

function validateIntegrationReceipt(value) {
  validateReceipt(value, INTEGRATION_RECEIPT_SCHEMA, "integrated", [
    "sourceRevision", "sourceDigest", "dependencyClosureDigest", "checksDigest",
    "evaluatorId", "collaboration", "integrationTargetDigest", "integratedAt",
  ]);
  requireCollaboration(value.collaboration);
}

function validateRuntimeReviewReceipt(value) {
  validateReceipt(value, RUNTIME_REVIEW_RECEIPT_SCHEMA, "reviewed", [
    "integrationReceiptDigest", "sourceDigest", "dependencyClosureDigest",
    "reviewSurfaceDigest", "policyDigest", "probesDigest", "reviewerId", "issuedAt", "expiresAt",
  ]);
}

function validateCandidateManifest(value) {
  validateReceipt(value, CANDIDATE_MANIFEST_SCHEMA, "awaiting-human-authorization", [
    "runtimeReviewReceiptDigest", "sourceDigest", "dependencyClosureDigest",
    "policyDigest", "targetDigest", "artifactDigest", "manifestDigest", "rollbackTargetDigest", "builtAt",
  ]);
}

function validateHumanAuthorizationReceipt(value) {
  validateReceipt(value, HUMAN_AUTHORIZATION_RECEIPT_SCHEMA, "authorized", [
    "candidateDigest", "targetDigest", "releaseKey", "decisionKind", "humanActorId",
    "decisionRef", "authorityAdapterId", "issuedAt", "expiresAt", "consumedAt",
  ]);
  if (value.decisionKind !== "human" || value.consumedAt !== null) {
    throw new Error("Human Authorization Receipt is not an unconsumed human decision.");
  }
}

function validateConsumedAuthorizationReceipt(value) {
  validateReceipt(value, HUMAN_AUTHORIZATION_RECEIPT_SCHEMA, "consumed", [
    "candidateDigest", "targetDigest", "releaseKey", "decisionKind", "humanActorId",
    "decisionRef", "authorityAdapterId", "issuedAt", "expiresAt", "consumedAt",
    "controllerId", "authorizationReceiptDigest",
  ]);
  requireInstant(value.consumedAt, "consumedAt");
}

function validateLiveVerificationReceipt(value) {
  validateReceipt(value, LIVE_VERIFICATION_RECEIPT_SCHEMA, "verified", [
    "authorizationReceiptDigest", "candidateDigest", "targetDigest", "controllerId",
    "deployedArtifactDigest", "observedRuntimeDigest", "probesDigest", "rollbackTargetDigest", "verifiedAt",
  ]);
}

function validateReceipt(value, schema, status, evidenceFields) {
  requireExact(value, ["schema", "status", ...evidenceFields, "receiptDigest"], schema);
  if (value.schema !== schema || value.status !== status) throw new Error(`${schema} has invalid schema or status.`);
  const { receiptDigest, ...evidence } = value;
  requireDigest(receiptDigest, "receiptDigest");
  if (receiptDigest !== digest(evidence)) throw new Error(`${schema} digest does not match its evidence.`);
}

function receipt(evidence) {
  return Object.freeze({ ...evidence, receiptDigest: digest(evidence) });
}

function requireCollaboration(value) {
  requireExact(value, COLLABORATION_FIELDS, "collaboration identity");
  for (const field of COLLABORATION_FIELDS.filter(field => field !== "leaseEpoch")) requireText(value[field], field);
  if (!Number.isSafeInteger(value.leaseEpoch) || value.leaseEpoch < 1) {
    throw new Error("leaseEpoch must be a positive integer.");
  }
}

function requireWindow(issuedAt, expiresAt, label) {
  requireInstant(issuedAt, `${label} issuedAt`);
  requireInstant(expiresAt, `${label} expiresAt`);
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new Error(`${label} expiry must follow issue time.`);
}

function requireInstant(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`);
}

function requireDigest(value, label) {
  if (!SHA256_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest.`);
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty.`);
}

function requireExact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains missing or unknown fields.`);
  }
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
