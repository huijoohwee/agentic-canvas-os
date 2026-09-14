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
  assert.match(workflow, /npm run check:ci -- --only=budgets/u);
  const source = packageDocument.scripts["check:budgets:source"];
  assert.match(source, /^npm --prefix node_modules\/agentic-os run evals/u);
  assert.match(source, /npm run authored-line-budget:check/u);
  assert.match(source, /node --test __tests__\/adlc-compatibility\.test\.mjs __tests__\/agentic-os-profile\.test\.mjs/u);
  assert.match(source, /npm run dictionary-catalog:check/u);
  assert.doesNotMatch(workflow, /^  conformance:/mu);
  assert.doesNotMatch(workflow, /agentic-sdlc-policy-runtime/u);
  assert.doesNotMatch(workflow, /^  cloud-collaboration:/mu);
  assert.match(instructions, /node_modules\/agentic-os\/docs\/adlc-guidelines\.md/u);
  assert.doesNotMatch(instructions, /agentic-sdlc-policy-runtime|no-gap bridge|old policy-runtime context/u);
  assert.equal(Object.hasOwn(packageDocument.scripts, "evals"), false);
  assert.doesNotMatch(workflow, /^\s*-\s+run:\s+npm run evals\s*$/mu);
});


test("CI partitions preserve every broad validation group", () => {
  const policy = JSON.parse(readFileSync(new URL("../.agentic-os-validation.json", import.meta.url)));
  const selected = [...workflow.matchAll(/--only=([a-z-]+)(?:\$\{\{ matrix.shard \}\})?/gu)].flatMap((match) =>
    match[1] === "test-" ? ["test-1", "test-2", "test-3", "test-4"] : [match[1]]);
  assert.deepEqual(selected.sort(), [...policy.fallback].sort());
  assert.equal(packageDocument.scripts.check, "node node_modules/agentic-os/bin/agentic-os-validation.mjs run");
  assert.deepEqual(policy.always, ["budgets"]);
  for (const check of policy.checks) assert.equal(check.reuse, "never");
});
