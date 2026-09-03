import { normalizeJson } from "./json-contract.js";

export const COMMERCE_ADMISSION_PROVIDER_CONTRACT = "commerce.agentic-os-admission-provider/v3";
export const COMMERCE_ADMISSION_PATH = "/agentic-os/internal/v2/adapter-registrations";
export const COMMERCE_ADMISSION_RECEIPT_SCHEMA = "agentic-os-adapter-registration/v2";
// This local configuration reference is content-addressed to one admission.
// It is not an authenticated release or production-approval assertion.
export const COMMERCE_ADMISSION_AUTHORITY_REF_PREFIX = "authority://agentic-graph/commerce-admission/";
export const AUTHORING_MUTATION_PERMIT_SCHEMA = "agentic-os-authoring-mutation-permit/v2";
export const AUTHORING_OPERATION_SCHEMA = "agentic-os-authoring-operation/v1";
export const COMMERCE_ADMISSION_SCOPE = "operator-registry";
export const COMMERCE_ADMISSION_WRITE_TARGET = "registry";
export const COMMERCE_ADMISSION_AUTH_SCHEMA = "commerce-agentic-os-admission-auth/v1";
export const COMMERCE_ADMISSION_CANDIDATE_BINDING_SCHEMA = "agentic-os-commerce-admission-binding/v1";
export const COMMERCE_ADMISSION_AUTH_HEADERS = Object.freeze({
  schema: "x-agentic-os-admission-auth-schema",
  signature: "x-agentic-os-admission-auth-signature",
});

export const AUTHORING_HEADERS = Object.freeze({
  schema: "x-authoring-mutation-contract",
  mutationId: "x-authoring-mutation-id",
  operationId: "x-authoring-operation-id",
  requestDigest: "x-authoring-request-digest",
  mutationSequence: "x-authoring-mutation-sequence",
  semanticScope: "x-authoring-semantic-scope",
  claimId: "x-authoring-claim-id",
  leaseEpoch: "x-authoring-lease-epoch",
  leaseExpiresAtMs: "x-authoring-lease-expires-at-ms",
  fenceRevision: "x-authoring-fence-revision",
  requiredWriteTarget: "x-authoring-write-target",
  reservedAtMs: "x-authoring-reserved-at-ms",
});

const BODY_KEYS = Object.freeze([
  "agent_definition",
  "authoring_mutation_intent",
  "invocation_register_entry",
  "operator_instruction_ref",
  "tool_allowlist_entry",
]);
const INTENT_KEYS = Object.freeze([
  "admissionInputs",
  "commerceProjection",
  "expectedPreviousContentHash",
  "invocationProof",
  "sandboxDryRun",
]);
const ADMISSION_INPUT_KEYS = Object.freeze([
  "agentDefinition",
  "invocationRegisterEntry",
  "operatorInstructionRef",
  "toolAllowlistEntry",
]);
const PERMIT_KEYS = Object.freeze([
  "claimId",
  "fenceRevision",
  "leaseEpoch",
  "leaseExpiresAtMs",
  "mutationId",
  "mutationSequence",
  "operationId",
  "requestDigest",
  "requiredWriteTarget",
  "reservedAtMs",
  "schema",
  "semanticScope",
]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const AUTH_INPUT_KEYS = Object.freeze([
  "bodyDigest", "contract", "method", "permitHeaders", "schema", "url",
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
}

function positiveInteger(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nonnegativeInteger(value) {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function canonicalJson(value, field = "value") {
  return JSON.stringify(normalizeJson(value, field));
}

export async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isCommerceAdmissionAuthSecret(secret) {
  return typeof secret === "string"
    && /^[\x21-\x7e]{32,256}$/u.test(secret)
    && !/(?:replace|placeholder|required|example|changeme|todo)/iu.test(secret);
}

function exactPermitHeaders(headers) {
  return Object.fromEntries(Object.values(AUTHORING_HEADERS).sort().map((name) => [
    name,
    headers.get(name),
  ]));
}

export function createCommerceAdmissionAuthInput({ method, url, bodyDigest, headers }) {
  const input = {
    schema: COMMERCE_ADMISSION_AUTH_SCHEMA,
    contract: COMMERCE_ADMISSION_PROVIDER_CONTRACT,
    method,
    url,
    bodyDigest,
    permitHeaders: exactPermitHeaders(headers),
  };
  if (!exactKeys(input, AUTH_INPUT_KEYS)
    || typeof method !== "string" || !/^[A-Z]+$/u.test(method)
    || typeof url !== "string" || url.length < 1 || url.length > 2_048
    || !SHA256_PATTERN.test(bodyDigest ?? "")) return null;
  return Object.freeze({ ...input, permitHeaders: Object.freeze(input.permitHeaders) });
}

function hexBytes(value) {
  if (!SHA256_PATTERN.test(value ?? "")) return null;
  return Uint8Array.from(value.match(/../gu), (pair) => Number.parseInt(pair, 16));
}

async function hmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

export async function commerceAdmissionAuthHeaders({ method, url, bodyDigest, headers, secret }) {
  if (!isCommerceAdmissionAuthSecret(secret)) throw new TypeError("Agentic OS admission authentication is unconfigured.");
  const input = createCommerceAdmissionAuthInput({ method, url, bodyDigest, headers });
  if (!input) throw new TypeError("Agentic OS admission authentication input is malformed.");
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, ["sign"]),
    new TextEncoder().encode(canonicalJson(input, "admission authentication input")),
  );
  return Object.freeze({
    [COMMERCE_ADMISSION_AUTH_HEADERS.schema]: COMMERCE_ADMISSION_AUTH_SCHEMA,
    [COMMERCE_ADMISSION_AUTH_HEADERS.signature]: [...new Uint8Array(signature)]
      .map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  });
}

export async function verifyCommerceAdmissionAuth({ request, bodyDigest, secret }) {
  if (!isCommerceAdmissionAuthSecret(secret)) return Object.freeze({ ok: false, code: "auth_unconfigured" });
  if (request.headers.get(COMMERCE_ADMISSION_AUTH_HEADERS.schema) !== COMMERCE_ADMISSION_AUTH_SCHEMA) {
    return Object.freeze({ ok: false, code: "auth_invalid" });
  }
  const signature = hexBytes(request.headers.get(COMMERCE_ADMISSION_AUTH_HEADERS.signature));
  const input = createCommerceAdmissionAuthInput({
    method: request.method,
    url: request.url,
    bodyDigest,
    headers: request.headers,
  });
  if (!signature || !input) return Object.freeze({ ok: false, code: "auth_invalid" });
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, ["verify"]),
    signature,
    new TextEncoder().encode(canonicalJson(input, "admission authentication input")),
  );
  return Object.freeze({ ok, code: ok ? null : "auth_invalid" });
}

export async function commerceAdmissionRequestDigest(authoringMutationIntent) {
  return sha256Hex(canonicalJson({
    schema: AUTHORING_OPERATION_SCHEMA,
    semanticScope: COMMERCE_ADMISSION_SCOPE,
    writeTarget: COMMERCE_ADMISSION_WRITE_TARGET,
    payload: authoringMutationIntent,
  }, "authoring operation"));
}

export async function commerceAdmissionInputsDigest(admissionInputs) {
  return sha256Hex(canonicalJson(admissionInputs, "commerce admission inputs"));
}

export async function commerceAdmissionPermitDigest(permit) {
  return sha256Hex(canonicalJson(permit, "commerce admission permit"));
}

export async function commerceAdmissionCandidateAuthorizationDigest(authorization) {
  return sha256Hex(canonicalJson({
    schema: COMMERCE_ADMISSION_CANDIDATE_BINDING_SCHEMA,
    admissionInputsDigest: authorization.admissionInputsDigest,
    admissionRequestDigest: authorization.admissionRequestDigest,
    permitDigest: authorization.permitDigest,
  }, "commerce admission candidate binding"));
}

export function readCommerceAdmissionBody(value) {
  if (!exactKeys(value, BODY_KEYS)) return null;
  const intent = readCommerceAdmissionIntent(value.authoring_mutation_intent);
  if (!intent) return null;
  const admissionInputs = {
    agentDefinition: value.agent_definition,
    toolAllowlistEntry: value.tool_allowlist_entry,
    invocationRegisterEntry: value.invocation_register_entry,
    operatorInstructionRef: value.operator_instruction_ref,
  };
  try {
    if (canonicalJson(intent.admissionInputs) !== canonicalJson(admissionInputs)) return null;
    return Object.freeze({
      agentDefinition: value.agent_definition,
      toolAllowlistEntry: value.tool_allowlist_entry,
      invocationRegisterEntry: value.invocation_register_entry,
      operatorInstructionRef: value.operator_instruction_ref,
      authoringMutationIntent: intent,
    });
  } catch {
    return null;
  }
}

export function readCommerceAdmissionIntent(value) {
  if (!exactKeys(value, INTENT_KEYS) || !exactKeys(value.admissionInputs, ADMISSION_INPUT_KEYS)) return null;
  try {
    return normalizeJson(value, "authoring_mutation_intent");
  } catch {
    return null;
  }
}

export function readAuthoringMutationPermit(headers) {
  return readAuthoringMutationPermitValue({
    schema: headers.get(AUTHORING_HEADERS.schema),
    mutationId: headers.get(AUTHORING_HEADERS.mutationId),
    operationId: headers.get(AUTHORING_HEADERS.operationId),
    requestDigest: headers.get(AUTHORING_HEADERS.requestDigest),
    mutationSequence: positiveInteger(headers.get(AUTHORING_HEADERS.mutationSequence)),
    semanticScope: headers.get(AUTHORING_HEADERS.semanticScope),
    claimId: headers.get(AUTHORING_HEADERS.claimId),
    leaseEpoch: positiveInteger(headers.get(AUTHORING_HEADERS.leaseEpoch)),
    leaseExpiresAtMs: positiveInteger(headers.get(AUTHORING_HEADERS.leaseExpiresAtMs)),
    fenceRevision: headers.get(AUTHORING_HEADERS.fenceRevision),
    requiredWriteTarget: headers.get(AUTHORING_HEADERS.requiredWriteTarget),
    reservedAtMs: nonnegativeInteger(headers.get(AUTHORING_HEADERS.reservedAtMs)),
  });
}

export function readAuthoringMutationPermitValue(value) {
  if (!exactKeys(value, PERMIT_KEYS)) return null;
  const permit = value;
  if (permit.schema !== AUTHORING_MUTATION_PERMIT_SCHEMA
    || !IDENTIFIER_PATTERN.test(permit.mutationId ?? "")
    || !IDENTIFIER_PATTERN.test(permit.operationId ?? "")
    || !SHA256_PATTERN.test(permit.requestDigest ?? "")
    || !Number.isSafeInteger(permit.mutationSequence)
    || !IDENTIFIER_PATTERN.test(permit.semanticScope ?? "")
    || !IDENTIFIER_PATTERN.test(permit.claimId ?? "")
    || !Number.isSafeInteger(permit.leaseEpoch)
    || !Number.isSafeInteger(permit.leaseExpiresAtMs)
    || !REVISION_PATTERN.test(permit.fenceRevision ?? "")
    || typeof permit.requiredWriteTarget !== "string"
    || permit.requiredWriteTarget.length < 1
    || permit.requiredWriteTarget.length > 512
    || !Number.isSafeInteger(permit.reservedAtMs)
    || permit.reservedAtMs >= permit.leaseExpiresAtMs
    || permit.operationId !== `operation:${permit.requestDigest}`
    || permit.mutationId !== `mutation:${permit.leaseEpoch}:${permit.mutationSequence}:${permit.requestDigest.slice(0, 32)}`) {
    return null;
  }
  return Object.freeze(permit);
}

export function authoringMutationHeaders(permit) {
  return Object.freeze({
    [AUTHORING_HEADERS.schema]: permit.schema,
    [AUTHORING_HEADERS.mutationId]: permit.mutationId,
    [AUTHORING_HEADERS.operationId]: permit.operationId,
    [AUTHORING_HEADERS.requestDigest]: permit.requestDigest,
    [AUTHORING_HEADERS.mutationSequence]: String(permit.mutationSequence),
    [AUTHORING_HEADERS.semanticScope]: permit.semanticScope,
    [AUTHORING_HEADERS.claimId]: permit.claimId,
    [AUTHORING_HEADERS.leaseEpoch]: String(permit.leaseEpoch),
    [AUTHORING_HEADERS.leaseExpiresAtMs]: String(permit.leaseExpiresAtMs),
    [AUTHORING_HEADERS.fenceRevision]: permit.fenceRevision,
    [AUTHORING_HEADERS.requiredWriteTarget]: permit.requiredWriteTarget,
    [AUTHORING_HEADERS.reservedAtMs]: String(permit.reservedAtMs),
  });
}

export function permitBoundaryRefusal(permit, nowMs) {
  if (permit.semanticScope !== COMMERCE_ADMISSION_SCOPE
    || permit.requiredWriteTarget !== COMMERCE_ADMISSION_WRITE_TARGET) return "mutation_out_of_write_set";
  if (!Number.isSafeInteger(nowMs) || permit.leaseExpiresAtMs <= nowMs) return "lease_expired";
  return null;
}
