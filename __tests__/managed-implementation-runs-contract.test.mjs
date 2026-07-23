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
  assert.match(managed, /pullRequest: \{ url, number, isDraft \}/);
  assert.match(managed, /A manually readied active PR makes heartbeat fail before lease renewal/);
  assert.match(managed, /gh pr ready --undo/);
  assert.match(managed, /Resume is replay-safe after PR demotion, local claim, empty claim commit, lease annotation, remote push, or PR-body edit/);
  assert.match(managed, /verifier profile ids/);
  assert.match(managed, /exact host-owned command/);
  assert.match(managed, /96-bit run-id suffix/);
  assert.match(managed, /stash@\{0\}.*never durable evidence/);
  assert.match(managed, /stashRef`, `stashSha`, and `stashStatus`/);
  assert.match(managed, /No Symphony code, prose, prompt, schema/);
  assert.match(managed, /automatic merge|automerge/);
  assert.match(managed, /deploy/);
  assert.equal(packageJson.scripts["device:review"], "node ./scripts/device-branch.mjs review");
  assert.equal(packageJson.scripts["device:integrate"], "node ./scripts/device-branch.mjs integrate");
  assert.equal(packageJson.scripts["managed-implementation-runs:check"], "node --test __tests__/managed-implementation-runs-contract.test.mjs __tests__/device-branch-cli.test.mjs __tests__/device-command-result.test.mjs __tests__/device-integrate.test.mjs __tests__/device-park-stash.test.mjs __tests__/device-park.test.mjs __tests__/device-resume.test.mjs __tests__/device-review-resume-recovery.test.mjs __tests__/device-review.test.mjs __tests__/device-start.test.mjs __tests__/local-runtime.test.mjs __tests__/task-worktree-provision.test.mjs");
  assert.doesNotMatch(JSON.stringify({
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
  }), /symphony/i);
});

test("managed runner evidence states the implemented redaction and truncation boundary", () => {
  assert.match(managed, /exact configured runner environment values/);
  assert.match(managed, /heuristic secret-key labels/);
  assert.match(managed, /cannot recognize arbitrary file-derived secrets or environment dumps/);
  assert.match(managed, /Callers and runners must not emit secrets/);
  assert.match(managed, /Output portions beyond `maxOutputBytes` are truncated before durable storage or return/);
  assert.match(managed, /evidence marks that truncation/);
  assert.match(managed, /does not by itself reject the producer or run/);
  assert.doesNotMatch(managed, /Oversized logs are rejected/);
  assert.doesNotMatch(managed, /Secrets, credentials, environment dumps, and oversized logs are redacted or rejected/);
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
