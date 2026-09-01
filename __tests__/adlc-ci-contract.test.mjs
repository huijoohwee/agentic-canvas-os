import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const workflowPath = path.resolve(import.meta.dirname, "..", ".github", "workflows", "ci.yml");
const workflow = readFileSync(workflowPath, "utf8");

test("CI exposes ADLC budgets while the legacy required context is a bounded bridge", () => {
  assert.match(workflow, /^  budgets:\n    name: budgets$/mu);
  assert.match(workflow, /npm run authored-line-budget:check/u);
  assert.match(workflow, /npm run frontmatter-runtime:check/u);
  assert.match(workflow, /npm run frontmatter-dictionary:check/u);
  assert.match(workflow, /npm run dictionary-catalog:check/u);
  assert.match(
    workflow,
    /^  conformance:\n    name: agentic-sdlc-policy-runtime\n    needs: budgets$/mu,
  );
  assert.doesNotMatch(workflow, /^  cloud-collaboration:/mu);
});
