import assert from "node:assert/strict";
import test from "node:test";

import {
  compareFindingSets,
  validateExecutionRun,
} from "../scripts/agentic-sdlc/index.mjs";
import { canonicalRun } from "./fixtures/agentic-sdlc-canonical-run.mjs";

test("the exact agentic-sdlc-run/v1 interchange artifact is runtime ready", () => {
  const run = deepFreeze(canonicalRun());
  const before = JSON.stringify(run);
  const result = validateExecutionRun(run);

  assert.equal(result.runtimeReady, true);
  assert.equal(result.admissionReady, true);
  assert.deepEqual(result.readiness, {
    localRung: "runtime-ready",
    deliveredRung: "undocumented",
  });
  assert.deepEqual(result.findingComparison, {
    newCount: 0,
    resolvedCount: 0,
    unchangedCount: 0,
    newBlockerCount: 0,
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.metrics.bridgeCoverageRatio, 1);
  assert.equal(result.metrics.boundaryClosed, true);
  assert.equal(result.metrics.persistenceComplete, true);
  assert.equal(result.metrics.satisfiedVccCount, 1);
  assert.deepEqual(result.metrics.satisfiedVccIds, ["VCC-1"]);
  assert.equal(result.metrics.totalTokenConsumption, 48);
  assert.equal(JSON.stringify(run), before);
});

test("local readiness is derived only from canonical satisfying authoring evidence", () => {
  const undocumented = canonicalRun();
  undocumented.vccs = [];
  undocumented.evidence = [];
  assert.equal(
    validateExecutionRun(undocumented).readiness.localRung,
    "undocumented",
  );

  const specificationOnly = canonicalRun();
  specificationOnly.evidence = [];
  assert.equal(
    validateExecutionRun(specificationOnly).readiness.localRung,
    "spec-complete",
  );

  const invalidEvidence = canonicalRun();
  invalidEvidence.evidence[0].checkRunId = "not-the-task-check-run";
  const invalidResult = validateExecutionRun(invalidEvidence);
  assert.equal(invalidResult.readiness.localRung, "spec-complete");
  assert.equal(invalidResult.metrics.satisfiedVccCount, 0);

  const partial = canonicalRun();
  const secondVcc = {
    conditionId: "VCC-2",
    criterionId: "AC-2",
    endState: "A second outcome is proven.",
    statedCheck: partial.dispatches[0].namedCheck,
    constraint: "The second outcome remains local.",
    behaviorClaims: ["stable-ordering"],
    correctnessProperties: [],
  };
  partial.vccs.push(secondVcc);
  partial.tasks[0].vccIds.push("VCC-2");
  partial.tasks[0].criterionIds.push("AC-2");
  partial.dispatches[0].sourceVccs.push(structuredClone(secondVcc));
  partial.dispatches[0].criterionIds.push("AC-2");
  const partialResult = validateExecutionRun(partial);
  assert.equal(partialResult.readiness.localRung, "dev-proven");
  assert.equal(partialResult.readiness.deliveredRung, "undocumented");
  assert.deepEqual(partialResult.metrics.satisfiedVccIds, ["VCC-1"]);

  const duplicate = canonicalRun();
  duplicate.evidence.push({
    ...structuredClone(duplicate.evidence[0]),
    evidenceId: "evidence-duplicate",
  });
  const duplicateResult = validateExecutionRun(duplicate);
  assert.equal(duplicateResult.readiness.localRung, "spec-complete");
  assert.equal(duplicateResult.metrics.satisfiedVccCount, 0);
});

test("prior findings are compared by the authoring deduplication key", () => {
  const run = canonicalRun();
  run.evaluator.mechanismId = "implementer:task-worker";
  run.tasks[0].observedChangedArtifacts.push("src/prior-comparison.mjs");
  run.tasks[0].capabilityGrants[0].scope.push("src/prior-comparison.mjs");
  run.dispatches[0].capabilityGrants[0].scope.push("src/prior-comparison.mjs");
  const current = validateExecutionRun(run);
  const blocker = current.findings.find(
    (finding) => finding.findingType === "unnamed-evaluator",
  );
  const minor = current.findings.find(
    (finding) => finding.findingType === "unenumerated-change",
  );
  assert.ok(blocker);
  assert.ok(minor);

  const resolved = {
    ...structuredClone(minor),
    artifactReference: `${minor.artifactReference}:prior-only`,
  };
  const prior = [structuredClone(minor), resolved];
  const comparisonInput = current.findings.filter((finding) =>
    ["unnamed-evaluator", "unenumerated-change"].includes(
      finding.findingType,
    ));
  const before = JSON.stringify(prior);
  const result = compareFindingSets(comparisonInput, deepFreeze(prior));

  assert.deepEqual(result, {
    newCount: 1,
    resolvedCount: 1,
    unchangedCount: 1,
    newBlockerCount: 1,
  });
  assert.equal(JSON.stringify(prior), before);
});

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
