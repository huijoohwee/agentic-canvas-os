import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { consumerSnapshotReader } from "../node_modules/agentic-os/bin/agentic-os-validation-inputs.mjs";
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


test("depth-two PR and single-commit push checkouts contain their exact changed-tree boundaries", (t) => {
  assert.equal(workflow.match(/fetch-depth: \$\{\{ github.event_name == 'pull_request' && 2 \|\| 0 \}\}/gu)?.length, 4);
  const collaboration = workflow.split("  collaboration-integration:\n", 2)[1]?.split("  budgets:\n", 1)[0];
  assert.match(collaboration, /^\s+fetch-depth: 2$/mu);
  const directory = mkdtempSync(path.join(tmpdir(), "canvas-validation-history-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source"), checkout = path.join(directory, "checkout");
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(directory, "init", "-b", "main", source);
  git(source, "config", "user.name", "Validation fixture");
  git(source, "config", "user.email", "validation@example.invalid");
  writeFileSync(path.join(source, "base.txt"), "base\n");
  git(source, "add", "."); git(source, "commit", "-m", "base");
  git(source, "switch", "-c", "feature");
  writeFileSync(path.join(source, "feature.txt"), "feature\n");
  git(source, "add", "."); git(source, "commit", "-m", "feature");
  git(source, "switch", "main");
  writeFileSync(path.join(source, "base.txt"), "new base\n");
  git(source, "commit", "-am", "advance base");
  const base = git(source, "rev-parse", "HEAD");
  git(source, "merge", "--no-ff", "feature", "-m", "synthetic merge");
  git(directory, "clone", "--depth=2", "--branch=main", pathToFileURL(source).href, checkout);
  assert.equal(git(checkout, "rev-parse", "--is-shallow-repository"), "true");
  const observed = consumerSnapshotReader({ root: checkout, base, committed: true })();
  assert.equal(observed.identity.baseRevision, base);
  assert.deepEqual(observed.changed, ["feature.txt"]);

  const beforePush = git(source, "rev-parse", "HEAD");
  writeFileSync(path.join(source, "base.txt"), "squash push\n");
  git(source, "commit", "-am", "squash push");
  const pushCheckout = path.join(directory, "push-checkout");
  git(directory, "clone", "--depth=2", "--branch=main", pathToFileURL(source).href, pushCheckout);
  const pushed = consumerSnapshotReader({ root: pushCheckout, base: beforePush, committed: true })();
  assert.equal(pushed.identity.baseRevision, beforePush);
  assert.deepEqual(pushed.changed, ["base.txt"]);
});
