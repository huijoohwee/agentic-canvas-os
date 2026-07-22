import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const facts = read("docs/FACTS.md");
const managed = read("docs/MANAGED-IMPLEMENTATION-RUNS.md");
const packageJson = JSON.parse(read("package.json"));
const routes = [
  ["docs/DICTIONARY-COMMAND.md", "/implementation.run"],
  ["docs/DICTIONARY-SEMANTIC.md", "#managed-implementation-run"],
  ["docs/DICTIONARY-BINDING.md", "@work-item"],
  ["docs/DICTIONARY-BINDING.md", "@implementation-run"],
];

test("managed implementation invocation tokens are exact canonical dictionary entries", () => {
  for (const [file, token] of routes) {
    const source = read(file);
    assert.equal(matches(source, `^  - "${escapeRegExp(token)}"$`).length, 1, `${token} frontmatter`);
    assert.ok(matches(source, "^\\| `" + escapeRegExp(token) + "`").length >= 1, `${token} table`);
    assert.equal(matches(facts, `^  "${escapeRegExp(token)}":`).length, 1, `${token} facts resolution`);
  }
});

test("managed implementation contract exposes the exact MCP and lifecycle boundary", () => {
  for (const tool of ["plan", "start", "list", "control"]) {
    assert.match(managed, new RegExp(`knowgrph\\.implementation_run\\.${tool}`));
  }
  assert.match(managed, /managed-run default terminal state is `delivery_ready`/);
  assert.match(managed, /ACOS lease\/CLI has reached `review_ready`/);
  assert.match(managed, /agentic-device-command-result\/v1/);
  assert.match(managed, /No Symphony code, prose, prompt, schema/);
  assert.match(managed, /automatic merge|automerge/);
  assert.match(managed, /deploy/);
  assert.equal(packageJson.scripts["device:review"], "node ./scripts/device-branch.mjs review");
  assert.equal(packageJson.scripts["managed-implementation-runs:check"], "node --test __tests__/managed-implementation-runs-contract.test.mjs __tests__/device-branch-cli.test.mjs __tests__/device-command-result.test.mjs __tests__/device-park.test.mjs __tests__/device-resume.test.mjs __tests__/device-review.test.mjs __tests__/device-start.test.mjs __tests__/task-worktree-provision.test.mjs");
  assert.doesNotMatch(JSON.stringify({
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
  }), /symphony/i);
});

function read(file) {
  return readFileSync(file, "utf8");
}

function matches(source, pattern) {
  return [...source.matchAll(new RegExp(pattern, "gm"))];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
