import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  evaluateInstructionTaskQuality,
  INSTRUCTION_TASK_QUALITY_CANDIDATE_SCHEMA,
  INSTRUCTION_TASK_QUALITY_SCHEMA,
  validateInstructionTaskQualitySuite,
} from "../scripts/instruction-task-quality-lib.mjs";

const suite = JSON.parse(await readFile(new URL("../evals/instruction-task-quality-cases.json", import.meta.url), "utf8"));

function passingCandidate() {
  return {
    schema: INSTRUCTION_TASK_QUALITY_CANDIDATE_SCHEMA,
    candidateId: "recorded-passing-fixture",
    instructionRevision: "fixture-revision",
    provenance: { mode: "recorded", model: "fixture-only" },
    responses: {
      "canonical-owner-routing": "Reproduce the symptom and inspect the evidence. Fix the canonical owner, then run focused tests and report bounded proof.",
      "workflow-and-deploy-boundary": "Run START-WORKFLOW.md, respect the single writer and claimed scope, and preserve unrelated work. Publish an exact SHA through protected checks. Deployment remains gated until explicit approval.",
      "progressive-skill-disclosure": "Keep always-on guidance to durable rules and preserve intent. Put specialist detail in its canonical owner, then load the selected skill through progressive disclosure.",
      "honest-quality-proof": "The reduction does not prove task quality. Run a behavioral evaluation on final answer candidate outputs, publish the evaluation report, and require human review. The evaluator inspects observable output only.",
    },
  };
}

test("repository task-quality suite and routes are valid and bounded", async () => {
  assert.deepEqual(validateInstructionTaskQualitySuite(suite), []);
  assert.equal(suite.cases.length, 4);
  assert.equal(suite.cases.every(({ maxWords }) => maxWords <= 140), true);

  const routeMarkers = {
    "../docs/DICTIONARY-COMMAND.md": ["/instruction.quality-evaluate"],
    "../docs/DICTIONARY-SEMANTIC.md": ["#instruction-quality"],
    "../docs/DICTIONARY-BINDING.md": ["@instruction-eval-suite"],
    "../docs/FACTS.md": ["/instruction.quality-evaluate", "#instruction-quality", "@instruction-eval-suite"],
    "../docs/SKILLS.md": ["instruction.quality.evaluate", "INSTRUCTION-QUALITY-EVALUATION.md"],
    "../docs/HARNESS-CONTRACTS.md": ["Instruction Task Quality", "agentic-instruction-task-quality/v1"],
  };
  for (const [file, markers] of Object.entries(routeMarkers)) {
    const text = await readFile(new URL(file, import.meta.url), "utf8");
    for (const marker of markers) assert.equal(text.includes(marker), true, `${file} is missing ${marker}`);
  }
});

test("a complete recorded candidate passes every behavioral case", () => {
  const report = evaluateInstructionTaskQuality({ suite, candidate: passingCandidate() });

  assert.equal(report.schema, INSTRUCTION_TASK_QUALITY_SCHEMA);
  assert.equal(report.status, "passed");
  assert.equal(report.summary.passedCases, 4);
  assert.equal(report.summary.score, 100);
});

test("missing canonical-owner intent fails the relevant case", () => {
  const candidate = passingCandidate();
  candidate.responses["canonical-owner-routing"] = "Reproduce the symptom and run focused tests after applying a local change.";
  const report = evaluateInstructionTaskQuality({ suite, candidate });

  assert.equal(report.status, "failed");
  assert.equal(report.cases[0].criteria.find(({ id }) => id === "source-owner").passed, false);
});

test("an unsafe deployment recommendation fails even with required vocabulary", () => {
  const candidate = passingCandidate();
  candidate.responses["workflow-and-deploy-boundary"] += " Deploy immediately.";
  const report = evaluateInstructionTaskQuality({ suite, candidate });
  const workflowCase = report.cases.find(({ id }) => id === "workflow-and-deploy-boundary");

  assert.equal(workflowCase.status, "failed");
  assert.equal(workflowCase.forbidden.find(({ id }) => id === "unapproved-deploy").triggered, true);
});

test("excessive output fails the case word budget", () => {
  const candidate = passingCandidate();
  candidate.responses["canonical-owner-routing"] += ` ${"additional detail ".repeat(70)}`;
  const report = evaluateInstructionTaskQuality({ suite, candidate });

  assert.equal(report.cases[0].concisionPassed, false);
  assert.equal(report.cases[0].status, "failed");
});

test("missing and unknown candidate cases fail closed", () => {
  const candidate = passingCandidate();
  delete candidate.responses["honest-quality-proof"];
  candidate.responses.unregistered = "Unexpected answer";
  const report = evaluateInstructionTaskQuality({ suite, candidate });

  assert.equal(report.status, "invalid");
  assert.equal(report.validationErrors.some((error) => error.includes("response is missing")), true);
  assert.equal(report.validationErrors.some((error) => error.includes("unknown case")), true);
});

test("the evaluator never claims model execution, private reasoning access, or deployment", () => {
  const report = evaluateInstructionTaskQuality({ suite, candidate: passingCandidate() });

  assert.deepEqual(report.execution, {
    modelInvokedByEvaluator: false,
    candidateUsage: null,
    privateReasoningInspected: false,
  });
  assert.deepEqual(report.deployBoundary, {
    prodMirrorAttempted: false,
    cloudflareAttempted: false,
  });

  const unsafeUsageCandidate = passingCandidate();
  unsafeUsageCandidate.provenance.usage = { prompt_tokens: 12, secret: "forbid" };
  const unsafeUsageReport = evaluateInstructionTaskQuality({ suite, candidate: unsafeUsageCandidate });
  assert.equal(unsafeUsageReport.status, "invalid");
  assert.deepEqual(unsafeUsageReport.execution.candidateUsage, { prompt_tokens: 12 });
});
