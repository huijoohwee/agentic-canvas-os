import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTESTATION_AUTHORITY_PUBLIC_KEYS,
  verifyOperatorDecisionAttestation,
} from "../scripts/agentic-sdlc/attestation.mjs";

const OPERATOR_DECISION = {
  reference: "operator-decision-test-001",
  role: "operator",
  explicit: true,
  approved: false,
  taskId: "1",
  occurrenceId: "operator-gate-test-001",
  decision: "refuse",
  options: ["approve", "refuse"],
  consequences: [
    "continue irreversible operation",
    "retain current state",
  ],
  attestation: {
    authorityId: "acos-dev-operator-v1",
    algorithm: "ed25519",
    signature: "0dQ3MqtwLMR8VSozbSRD6p+0W284naA45t4MStEyTG/WnU5JW7ikOIvyV3QN8gvPAYYB3phnI96Dsl5KIvVbAg==",
  },
};

test("authoring, persistence, and Operator authorities use distinct keys", () => {
  assert.equal(
    new Set(Object.values(ATTESTATION_AUTHORITY_PUBLIC_KEYS)).size,
    3,
  );
});

test("Operator decisions require an untampered authority signature", () => {
  assert.equal(
    verifyOperatorDecisionAttestation(
      "operator-attestation-test-run",
      OPERATOR_DECISION,
    ),
    true,
  );
  const tampered = structuredClone(OPERATOR_DECISION);
  tampered.consequences[1] = "silently continue";
  assert.equal(
    verifyOperatorDecisionAttestation(
      "operator-attestation-test-run",
      tampered,
    ),
    false,
  );
});
