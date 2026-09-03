import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  COMMERCE_ADMISSION_AUTHORITY_PROJECTION_SCHEMA,
  createCommerceAdmissionAuthority,
  readGraphAuthorityProjection,
} from "../agent-api/src/commerce-admission-authority.js";
import { canonicalJson } from "../agent-api/src/commerce-admission-contract.js";
import {
  GRAPH_AUTHORITY_NOW,
  createGraphAuthorityFixture,
} from "./lib/commerce-admission-auth-fixture.mjs";

function signedEvidence(fixture, changes = {}) {
  const { signature: _signature, ...unsigned } = { ...fixture.envelope, ...changes };
  const signature = createHmac("sha256", fixture.secret).update(canonicalJson(unsigned)).digest("hex");
  return JSON.stringify({ ...unsigned, signature });
}

function authority(fixture, overrides = {}) {
  return createCommerceAdmissionAuthority({
    ...fixture,
    now: () => GRAPH_AUTHORITY_NOW,
    ...overrides,
  });
}

test("a signed exact agentic-graph authority produces a normalized non-secret projection", async () => {
  const fixture = createGraphAuthorityFixture();
  const result = await authority(fixture).authorize(fixture.operatorInstructionRef, fixture.authorization);
  assert.equal(result.ok, true);
  assert.deepEqual(readGraphAuthorityProjection(result.projection), result.projection);
  assert.equal(result.projection.schema, COMMERCE_ADMISSION_AUTHORITY_PROJECTION_SCHEMA);
  assert.equal(result.projection.issuer_repository, "huijoohwee/agentic-graph");
  assert.equal(result.projection.expires_at_ms, fixture.envelope.expiresAtMs);
  const mismatched = await authority(fixture).authorize(fixture.operatorInstructionRef, {
    ...fixture.authorization,
    permitDigest: "f".repeat(64),
  });
  assert.deepEqual(mismatched, { ok: false, code: "authority_invalid" });
});

test("missing, malformed, mismatched, tampered, and expired Graph authority evidence fails closed", async () => {
  const fixture = createGraphAuthorityFixture();
  const cases = [
    ["missing secret", authority(fixture, { secret: undefined }), "authority_unconfigured"],
    ["malformed evidence", authority(fixture, { evidence: "{" }), "authority_invalid"],
    ["wrong issuer", authority(fixture, { evidence: signedEvidence(fixture, { issuerRepository: "huijoohwee/agentic-os" }) }), "authority_invalid"],
    ["wrong contract", authority(fixture, { evidence: signedEvidence(fixture, { admissionContract: "commerce.unrelated/v1" }) }), "authority_invalid"],
    ["wrong target", authority(fixture, { evidence: signedEvidence(fixture, { targetRepository: "huijoohwee/agentic-graph" }) }), "authority_invalid"],
    ["wrong content reference", authority(fixture, { evidence: signedEvidence(fixture, { candidateAuthorizationRef: `authorization://agentic-graph/commerce-admission/${"f".repeat(64)}` }) }), "authority_invalid"],
    ["wrong operator", authority(fixture, { operatorInstructionRef: "operator://agentic-graph/commerce-adapter-admission/other" }), "authority_invalid"],
    ["wrong trust anchor", authority(fixture, { authorityRef: "authority://agentic-graph/commerce-admission/other" }), "authority_invalid"],
    ["tampered signature", authority(fixture, { evidence: fixture.evidence.replace(/.$/u, "x") }), "authority_invalid"],
    ["expired", authority(fixture, {
      evidence: signedEvidence(fixture, {
        issuedAtMs: GRAPH_AUTHORITY_NOW - 120_000,
        expiresAtMs: GRAPH_AUTHORITY_NOW - 1,
      }),
    }), "authority_expired"],
  ];
  for (const [label, candidate, expected] of cases) {
    const result = await candidate.authorize(fixture.operatorInstructionRef, fixture.authorization);
    assert.equal(result.ok, false, label);
    assert.equal(result.code, expected, label);
  }
});

test("stored projections are strict but remain readable after their authority expiry", () => {
  const valid = {
    schema: COMMERCE_ADMISSION_AUTHORITY_PROJECTION_SCHEMA,
    admission_inputs_digest: "c".repeat(64),
    admission_request_digest: "d".repeat(64),
    authority_ref: "authority://agentic-graph/commerce-admission/immutable-1",
    evidence_digest: "a".repeat(64),
    issuer_repository: "huijoohwee/agentic-graph",
    issuer_revision: "b".repeat(40),
    permit_digest: "e".repeat(64),
    expires_at_ms: GRAPH_AUTHORITY_NOW - 1,
  };
  assert.deepEqual(readGraphAuthorityProjection(valid), valid);
  assert.equal(readGraphAuthorityProjection({ ...valid, extra: true }), null);
  assert.equal(readGraphAuthorityProjection({ ...valid, evidence_digest: "bad" }), null);
});
