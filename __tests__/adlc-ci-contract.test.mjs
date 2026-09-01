import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const workflowPath = path.resolve(import.meta.dirname, "..", ".github", "workflows", "ci.yml");
const workflow = readFileSync(workflowPath, "utf8");
const policyDocs = [
  "docs/AGENTIC-SDLC-RUNTIME.md",
  "docs/VALIDATION-RUNBOOK.md",
].map(relativePath => readFileSync(path.resolve(import.meta.dirname, "..", relativePath), "utf8"));

test("CI exposes ADLC budgets without a legacy required-context bridge", () => {
  assert.match(workflow, /^  budgets:\n    name: budgets$/mu);
  assert.match(workflow, /npm run authored-line-budget:check/u);
  assert.match(workflow, /npm run frontmatter-runtime:check/u);
  assert.match(workflow, /npm run frontmatter-dictionary:check/u);
  assert.match(workflow, /npm run dictionary-catalog:check/u);
  assert.doesNotMatch(workflow, /^  conformance:/mu);
  assert.doesNotMatch(workflow, /agentic-sdlc-policy-runtime/u);
  assert.doesNotMatch(workflow, /^  cloud-collaboration:/mu);
  for (const document of policyDocs) {
    assert.doesNotMatch(document, /agentic-sdlc-policy-runtime|no-gap bridge|old policy-runtime context/u);
  }
});
