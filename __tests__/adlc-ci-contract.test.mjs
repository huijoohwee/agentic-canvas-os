import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const workflowPath = path.resolve(import.meta.dirname, "..", ".github", "workflows", "ci.yml");
const workflow = readFileSync(workflowPath, "utf8");
const instructions = readFileSync(path.resolve(import.meta.dirname, "..", "AGENTS.md"), "utf8");
const packageDocument = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "..", "package.json"), "utf8"));

test("CI runs installed ADLC evals and local consumer checks without a legacy bridge", () => {
  assert.match(workflow, /^  budgets:\n    name: budgets$/mu);
  assert.match(workflow, /^          npm --prefix node_modules\/agentic-os run evals$/mu);
  assert.match(workflow, /npm run authored-line-budget:check/u);
  assert.match(workflow, /node --test __tests__\/adlc-compatibility\.test\.mjs __tests__\/agentic-os-profile\.test\.mjs/u);
  assert.match(workflow, /npm run dictionary-catalog:check/u);
  assert.doesNotMatch(workflow, /^  conformance:/mu);
  assert.doesNotMatch(workflow, /agentic-sdlc-policy-runtime/u);
  assert.doesNotMatch(workflow, /^  cloud-collaboration:/mu);
  assert.match(instructions, /node_modules\/agentic-os\/docs\/adlc-guidelines\.md/u);
  assert.doesNotMatch(instructions, /agentic-sdlc-policy-runtime|no-gap bridge|old policy-runtime context/u);
  assert.equal(Object.hasOwn(packageDocument.scripts, "evals"), false);
  assert.doesNotMatch(workflow, /^\s*-\s+run:\s+npm run evals\s*$/mu);
});
