import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeCanonicalRun,
  normalizeValidationRequest,
  validateExecutionRun,
} from "../scripts/agentic-sdlc/index.mjs";

const BASELINE_MANIFEST = JSON.parse(readFileSync(
  new URL(
    "../docs/schemas/agentic-sdlc-guideline-baseline.v1.json",
    import.meta.url,
  ),
  "utf8",
));
const RULE_BINDINGS = BASELINE_MANIFEST.executionFindingRuleBindings;

function nestedCanonicalSpoof() {
  return {
    schema: "agentic-sdlc-run/v1",
    runId: "nested-schema-spoof",
    ruleBindings: structuredClone(RULE_BINDINGS),
    baseline: {
      baselined: true,
      openAuthoringBlockers: 0,
      vccRevision: "derivation-001",
    },
    tasks: [{
      id: "1",
      dispatch: { taskId: "1" },
    }],
    unknownProof: "must not survive canonical admission",
  };
}

function assertCanonicalSchemaError(action) {
  assert.throws(
    action,
    (error) =>
      error instanceof TypeError
      && /agentic-sdlc-run\/v1 schema validation failed:/u.test(error.message)
      && /must have required property 'authoringBaseline'/u.test(error.message)
      && /must NOT have additional properties/u.test(error.message),
  );
}

test("canonical tags cannot route nested normalized records around Ajv", () => {
  assertCanonicalSchemaError(
    () => validateExecutionRun(nestedCanonicalSpoof()),
  );
  assertCanonicalSchemaError(() => validateExecutionRun({
    run: nestedCanonicalSpoof(),
    ruleBindings: structuredClone(RULE_BINDINGS),
  }));
  assertCanonicalSchemaError(
    () => normalizeCanonicalRun(nestedCanonicalSpoof()),
  );
});

test("noncanonical internal tags cannot earn public runtime readiness", () => {
  const input = {
    schema: "agentic-sdlc-normalized-internal/test-v1",
    ruleBindings: structuredClone(RULE_BINDINGS),
  };
  const normalized = normalizeValidationRequest(input);
  assert.equal(normalized.sourceSchema, input.schema);
  assert.equal(normalized.run.schema, input.schema);

  const result = validateExecutionRun(input);
  assert.equal(result.runtimeReady, false);
  assert.equal(result.admissionReady, false);
  assert.ok(result.controlFailures.includes("run-schema-invalid"));
});
