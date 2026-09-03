import { createHash, createHmac } from "node:crypto";

import {
  AUTHORING_OPERATION_SCHEMA,
  COMMERCE_ADMISSION_CANDIDATE_BINDING_SCHEMA,
  COMMERCE_ADMISSION_SCOPE,
  COMMERCE_ADMISSION_WRITE_TARGET,
  canonicalJson,
  createCommerceAdmissionAuthInput,
} from "../../agent-api/src/commerce-admission-contract.js";

export const AGENTIC_OS_ADMISSION_TEST_SECRET = "agentic-os-admission-test-secret-000001";
export const AGENTIC_OS_ADMISSION_AUTHORITY_HMAC_TEST_SECRET = "agentic-os-admission-authority-hmac-secret-000001";
export const GRAPH_AUTHORITY_NOW = 1_800_000_000_000;
export const GRAPH_AUTHORITY_OPERATOR_REF = "operator://agentic-graph/commerce-adapter-admission/2026-09-03";
export const GRAPH_AUTHORITY_REF = "authority://agentic-graph/commerce-admission/fixture-20260903";

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function createGraphAuthorityBinding({ authoringMutationIntent, permit }) {
  return Object.freeze({
    admissionInputsDigest: digest(authoringMutationIntent.admissionInputs),
    admissionRequestDigest: digest({
      schema: AUTHORING_OPERATION_SCHEMA,
      semanticScope: COMMERCE_ADMISSION_SCOPE,
      writeTarget: COMMERCE_ADMISSION_WRITE_TARGET,
      payload: authoringMutationIntent,
    }),
    permitDigest: digest(permit),
  });
}

export function createAdmissionAuthFixture(url, secret = AGENTIC_OS_ADMISSION_TEST_SECRET) {
  function authenticatedPost(bodyText, inputHeaders) {
    const headers = new Headers(inputHeaders);
    const input = createCommerceAdmissionAuthInput({
      method: "POST",
      url,
      bodyDigest: createHash("sha256").update(bodyText).digest("hex"),
      headers,
    });
    headers.set("x-agentic-os-admission-auth-schema", "commerce-agentic-os-admission-auth/v1");
    headers.set("x-agentic-os-admission-auth-signature", createHmac("sha256", secret)
      .update(canonicalJson(input)).digest("hex"));
    return new Request(url, { method: "POST", headers, body: bodyText });
  }

  function readyRequest() {
    const readyUrl = `${url}/readyz`;
    const headers = new Headers();
    const input = createCommerceAdmissionAuthInput({
      method: "GET",
      url: readyUrl,
      bodyDigest: createHash("sha256").update("").digest("hex"),
      headers,
    });
    headers.set("x-agentic-os-admission-auth-schema", "commerce-agentic-os-admission-auth/v1");
    headers.set("x-agentic-os-admission-auth-signature", createHmac("sha256", secret)
      .update(canonicalJson(input)).digest("hex"));
    return new Request(readyUrl, { headers });
  }

  return Object.freeze({ authenticatedPost, readyRequest });
}

export function createGraphAuthorityFixture({
  authorization = Object.freeze({
    admissionInputsDigest: "a".repeat(64),
    admissionRequestDigest: "b".repeat(64),
    permitDigest: "c".repeat(64),
  }),
  authorityRef = GRAPH_AUTHORITY_REF,
  operatorInstructionRef = GRAPH_AUTHORITY_OPERATOR_REF,
  candidateAuthorizationRef,
  issuedAtMs = GRAPH_AUTHORITY_NOW - 1_000,
  expiresAtMs = GRAPH_AUTHORITY_NOW + 6 * 24 * 60 * 60 * 1_000,
  issuerRevision = "d".repeat(40),
  secret = AGENTIC_OS_ADMISSION_AUTHORITY_HMAC_TEST_SECRET,
} = {}) {
  const resolvedCandidateAuthorizationRef = candidateAuthorizationRef
    ?? `authorization://agentic-graph/commerce-admission/${digest({ schema: COMMERCE_ADMISSION_CANDIDATE_BINDING_SCHEMA, ...authorization })}`;
  const unsigned = {
    schema: "agentic-graph-commerce-admission-authority/v1",
    authorityRef,
    issuerRepository: "huijoohwee/agentic-graph",
    issuerRevision,
    targetRepository: "huijoohwee/agentic-canvas-os",
    admissionContract: "commerce.agentic-os-admission-provider/v3",
    admissionInputsDigest: authorization.admissionInputsDigest,
    admissionRequestDigest: authorization.admissionRequestDigest,
    operatorInstructionRef,
    permitDigest: authorization.permitDigest,
    candidateAuthorizationRef: resolvedCandidateAuthorizationRef,
    issuedAtMs,
    expiresAtMs,
  };
  const signature = createHmac("sha256", secret).update(canonicalJson(unsigned)).digest("hex");
  return Object.freeze({
    authorityRef,
    operatorInstructionRef,
    authorization: Object.freeze({ ...authorization }),
    evidence: JSON.stringify({ ...unsigned, signature }),
    secret,
    envelope: Object.freeze({ ...unsigned, signature }),
  });
}
