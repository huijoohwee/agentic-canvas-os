import { verify } from "node:crypto";

import { authoringBaselineEnvelope } from "./baseline-digest.mjs";
import {
  compareText,
  object,
  stableJson,
  stableValue,
  text,
} from "./normalize.mjs";

export const AUTHORING_AUTHORITY_ID = "acos-dev-authoring-v1";
export const OPERATOR_AUTHORITY_ID = "acos-dev-operator-v1";
export const PERSISTENCE_AUTHORITY_ID = "acos-dev-persistence-v1";

const AUTHORING_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAy5luycGn0iP/X+gZV+U1uOJKKhIyMkf90oQX1oV0stU=
-----END PUBLIC KEY-----
`;

const PERSISTENCE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAPAWad7QYjuYAQ12JAPEs1sSlklbKoajW1uw4Y61ZIjw=
-----END PUBLIC KEY-----
`;

const OPERATOR_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA/AxmXhp6Dn5LPxwmSOANxTSD1vRqQS1y4495NxW03II=
-----END PUBLIC KEY-----
`;

export const ATTESTATION_AUTHORITY_PUBLIC_KEYS = Object.freeze({
  authoring: AUTHORING_PUBLIC_KEY,
  operator: OPERATOR_PUBLIC_KEY,
  persistence: PERSISTENCE_PUBLIC_KEY,
});

export function verifyAuthoringAttestation(
  baselineInput,
  vccsInput,
  specificationTokenEstimate,
) {
  const baseline = object(baselineInput);
  return verifyEnvelope(
    baseline.attestation,
    AUTHORING_AUTHORITY_ID,
    AUTHORING_PUBLIC_KEY,
    authoringBaselineEnvelope(
      baseline,
      vccsInput,
      specificationTokenEstimate,
    ),
  );
}

export function verifyOperatorDecisionAttestation(runId, decisionInput) {
  const decision = { ...object(decisionInput) };
  const attestation = decision.attestation;
  delete decision.attestation;
  return verifyEnvelope(
    attestation,
    OPERATOR_AUTHORITY_ID,
    OPERATOR_PUBLIC_KEY,
    {
      schema: "agentic-sdlc-operator-decision-attestation/v1",
      runId: text(runId),
      decision: stableValue(decision),
    },
  );
}

export function verifyPersistenceAttestation(runInput) {
  const run = { ...object(runInput) };
  const persistence = { ...object(run.persistence) };
  const attestation = persistence.attestation;
  delete persistence.attestation;
  run.persistence = persistence;
  return verifyEnvelope(
    attestation,
    PERSISTENCE_AUTHORITY_ID,
    PERSISTENCE_PUBLIC_KEY,
    persistenceAttestationEnvelope(run),
  );
}

export function persistenceAttestationEnvelope(runInput) {
  const run = { ...object(runInput) };
  const persistence = { ...object(run.persistence) };
  delete persistence.attestation;
  run.persistence = persistence;
  return {
    schema: "agentic-sdlc-persistence-attestation/v1",
    run: canonicalPersistenceValue(run),
  };
}

function canonicalPersistenceValue(value, field = "") {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalPersistenceValue(item));
    if (["attempts", "options", "consequences"].includes(field)) return items;
    return items.sort((left, right) =>
      compareText(JSON.stringify(left), JSON.stringify(right)));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareText)
      .map((key) => [key, canonicalPersistenceValue(value[key], key)]),
  );
}

function verifyEnvelope(attestationInput, authorityId, publicKey, envelope) {
  const attestation = object(attestationInput);
  if (
    text(attestation.authorityId) !== authorityId
    || text(attestation.algorithm) !== "ed25519"
    || !/^[A-Za-z0-9+/]{86}==$/u.test(text(attestation.signature))
  ) {
    return false;
  }
  try {
    return verify(
      null,
      Buffer.from(stableJson(envelope), "utf8"),
      publicKey,
      Buffer.from(attestation.signature, "base64"),
    );
  } catch {
    return false;
  }
}
