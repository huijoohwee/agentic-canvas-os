import {
  COMMERCE_ADMISSION_AUTHORITY_REF_PREFIX,
  COMMERCE_ADMISSION_PROVIDER_CONTRACT,
  canonicalJson,
  commerceAdmissionCandidateAuthorizationDigest,
  isCommerceAdmissionAuthSecret,
  sha256Hex,
} from "./commerce-admission-contract.js";

export const COMMERCE_ADMISSION_AUTHORITY_SCHEMA = "agentic-graph-commerce-admission-authority/v1";
export const COMMERCE_ADMISSION_AUTHORITY_PROJECTION_SCHEMA = "agentic-graph-commerce-admission-authority-projection/v1";

const MAX_EVIDENCE_CHARS = 16_384;
const MAX_AUTHORITY_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const CLOCK_SKEW_MS = 60_000;
const AUTHORITY_KEYS = Object.freeze([
  "admissionContract",
  "admissionInputsDigest",
  "admissionRequestDigest",
  "authorityRef",
  "candidateAuthorizationRef",
  "expiresAtMs",
  "issuedAtMs",
  "issuerRepository",
  "issuerRevision",
  "operatorInstructionRef",
  "permitDigest",
  "schema",
  "signature",
  "targetRepository",
]);
const PROJECTION_KEYS = Object.freeze([
  "admission_inputs_digest",
  "admission_request_digest",
  "authority_ref",
  "evidence_digest",
  "expires_at_ms",
  "issuer_repository",
  "issuer_revision",
  "permit_digest",
  "schema",
]);
const AUTHORIZATION_BINDING_KEYS = Object.freeze([
  "admissionInputsDigest",
  "admissionRequestDigest",
  "permitDigest",
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const AUTHORITY_SUFFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const OPERATOR_REF_PATTERN = /^operator:\/\/agentic-graph\/commerce-adapter-admission\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const CANDIDATE_AUTHORITY_REF_PATTERN = /^authorization:\/\/agentic-graph\/commerce-admission\/[0-9a-f]{64}$/u;

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function hmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

function hexBytes(value) {
  if (!SHA256_PATTERN.test(value ?? "")) return null;
  return Uint8Array.from(value.match(/../gu), (pair) => Number.parseInt(pair, 16));
}

function readAuthorityEvidence(value) {
  if (typeof value !== "string" || value.length < 2 || value.length > MAX_EVIDENCE_CHARS) return null;
  try {
    const parsed = JSON.parse(value);
    return exactKeys(parsed, AUTHORITY_KEYS) ? parsed : null;
  } catch {
    return null;
  }
}

function unsignedEvidence(evidence) {
  const { signature, ...unsigned } = evidence;
  return unsigned;
}

function readAuthorityShape(evidence, { authorityRef, operatorInstructionRef } = {}) {
  if (!evidence || evidence.schema !== COMMERCE_ADMISSION_AUTHORITY_SCHEMA
    || typeof authorityRef !== "string" || authorityRef !== evidence.authorityRef
    || typeof operatorInstructionRef !== "string" || operatorInstructionRef !== evidence.operatorInstructionRef
    || evidence.issuerRepository !== "huijoohwee/agentic-graph"
    || evidence.targetRepository !== "huijoohwee/agentic-canvas-os"
    || evidence.admissionContract !== COMMERCE_ADMISSION_PROVIDER_CONTRACT
    || typeof evidence.authorityRef !== "string"
    || !evidence.authorityRef.startsWith(COMMERCE_ADMISSION_AUTHORITY_REF_PREFIX)
    || !AUTHORITY_SUFFIX_PATTERN.test(evidence.authorityRef.slice(COMMERCE_ADMISSION_AUTHORITY_REF_PREFIX.length))
    || !SHA_PATTERN.test(evidence.issuerRevision ?? "")
    || !OPERATOR_REF_PATTERN.test(evidence.operatorInstructionRef ?? "")
    || !CANDIDATE_AUTHORITY_REF_PATTERN.test(evidence.candidateAuthorizationRef ?? "")
    || !SHA256_PATTERN.test(evidence.admissionInputsDigest ?? "")
    || !SHA256_PATTERN.test(evidence.admissionRequestDigest ?? "")
    || !SHA256_PATTERN.test(evidence.permitDigest ?? "")
    || !Number.isSafeInteger(evidence.issuedAtMs)
    || !Number.isSafeInteger(evidence.expiresAtMs)
    || evidence.expiresAtMs <= evidence.issuedAtMs
    || evidence.expiresAtMs - evidence.issuedAtMs > MAX_AUTHORITY_LIFETIME_MS
    || !SHA256_PATTERN.test(evidence.signature ?? "")) return null;
  return Object.freeze({ ...evidence });
}

function readAuthorizationBinding(value) {
  if (!exactKeys(value, AUTHORIZATION_BINDING_KEYS)
    || !SHA256_PATTERN.test(value.admissionInputsDigest ?? "")
    || !SHA256_PATTERN.test(value.admissionRequestDigest ?? "")
    || !SHA256_PATTERN.test(value.permitDigest ?? "")) return null;
  return Object.freeze({ ...value });
}

export function readGraphAuthorityProjection(value) {
  if (!exactKeys(value, PROJECTION_KEYS)
    || value.schema !== COMMERCE_ADMISSION_AUTHORITY_PROJECTION_SCHEMA
    || typeof value.authority_ref !== "string"
    || !value.authority_ref.startsWith(COMMERCE_ADMISSION_AUTHORITY_REF_PREFIX)
    || !AUTHORITY_SUFFIX_PATTERN.test(value.authority_ref.slice(COMMERCE_ADMISSION_AUTHORITY_REF_PREFIX.length))
    || !SHA256_PATTERN.test(value.evidence_digest ?? "")
    || !SHA256_PATTERN.test(value.admission_inputs_digest ?? "")
    || !SHA256_PATTERN.test(value.admission_request_digest ?? "")
    || value.issuer_repository !== "huijoohwee/agentic-graph"
    || !SHA_PATTERN.test(value.issuer_revision ?? "")
    || !SHA256_PATTERN.test(value.permit_digest ?? "")
    || !Number.isSafeInteger(value.expires_at_ms)
    || value.expires_at_ms < 0) return null;
  return Object.freeze({ ...value });
}

export function createCommerceAdmissionAuthority({
  authorityRef,
  operatorInstructionRef,
  evidence,
  secret,
  now = () => Date.now(),
} = {}) {
  async function status() {
    if (!isCommerceAdmissionAuthSecret(secret)
      || typeof authorityRef !== "string"
      || typeof operatorInstructionRef !== "string") {
      return Object.freeze({ ok: false, code: "authority_unconfigured" });
    }
    const parsed = readAuthorityEvidence(evidence);
    const envelope = readAuthorityShape(parsed, { authorityRef, operatorInstructionRef });
    if (!envelope) {
      return Object.freeze({ ok: false, code: "authority_invalid" });
    }
    const expectedCandidateRef = `authorization://agentic-graph/commerce-admission/${await commerceAdmissionCandidateAuthorizationDigest(envelope)}`;
    if (envelope.candidateAuthorizationRef !== expectedCandidateRef) {
      return Object.freeze({ ok: false, code: "authority_invalid" });
    }
    const signature = hexBytes(envelope.signature);
    if (!signature) return Object.freeze({ ok: false, code: "authority_invalid" });
    const verified = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret, ["verify"]),
      signature,
      new TextEncoder().encode(canonicalJson(unsignedEvidence(envelope), "commerce admission authority")),
    );
    if (!verified) return Object.freeze({ ok: false, code: "authority_invalid" });
    const observedNow = now();
    if (!Number.isSafeInteger(observedNow)) return Object.freeze({ ok: false, code: "authority_invalid" });
    if (envelope.issuedAtMs > observedNow + CLOCK_SKEW_MS || envelope.expiresAtMs <= observedNow) {
      return Object.freeze({ ok: false, code: "authority_expired" });
    }
    return Object.freeze({
      ok: true,
      code: null,
      projection: Object.freeze({
        schema: COMMERCE_ADMISSION_AUTHORITY_PROJECTION_SCHEMA,
        authority_ref: envelope.authorityRef,
        admission_inputs_digest: envelope.admissionInputsDigest,
        admission_request_digest: envelope.admissionRequestDigest,
        evidence_digest: await sha256Hex(canonicalJson(envelope, "commerce admission authority evidence")),
        issuer_repository: envelope.issuerRepository,
        issuer_revision: envelope.issuerRevision,
        permit_digest: envelope.permitDigest,
        expires_at_ms: envelope.expiresAtMs,
      }),
    });
  }

  async function authorize(reference, authorization) {
    const result = await status();
    const binding = readAuthorizationBinding(authorization);
    if (!result.ok || reference !== operatorInstructionRef || !binding
      || binding.admissionInputsDigest !== result.projection.admission_inputs_digest
      || binding.admissionRequestDigest !== result.projection.admission_request_digest
      || binding.permitDigest !== result.projection.permit_digest) {
      return Object.freeze({ ok: false, code: result.ok ? "authority_invalid" : result.code });
    }
    return result;
  }

  return Object.freeze({
    status,
    authorize,
    async resolveOperatorInstruction(reference) {
      const result = await authorize(reference, null);
      return Object.freeze({ resolved: result.ok, reference });
    },
  });
}

export const COMMERCE_ADMISSION_AUTHORITY_DEFAULTS = Object.freeze({
  maxEvidenceChars: MAX_EVIDENCE_CHARS,
  maxAuthorityLifetimeMs: MAX_AUTHORITY_LIFETIME_MS,
});
