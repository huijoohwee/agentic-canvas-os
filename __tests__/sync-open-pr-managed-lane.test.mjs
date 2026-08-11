import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseWriterLeasePullRequestBody,
  renderWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const syncScript = path.join(repositoryRoot, "scripts", "sync-open-pr.mjs");
const validMarker = renderWriterLeasePullRequestBody({
  schema: "agentic-writer-lease/v2",
  status: "active",
  epoch: 1,
  sessionId: "session-a",
  device: "device-a",
  scope: "managed-sync",
  branch: "agent/device-a/managed-sync",
  baseSha: "a".repeat(40),
  fenceSha: "b".repeat(40),
  heartbeatAt: "2026-08-11T00:00:00.000Z",
  expiresAt: "2026-08-11T01:00:00.000Z",
});
const malformedMarker = "<!-- agentic-writer-lease/v2 {\"schema\": -->";

assert.ok(parseWriterLeasePullRequestBody(validMarker));
assert.equal(parseWriterLeasePullRequestBody(malformedMarker), null);

function pull(body = "") {
  return {
    number: 17,
    title: "fix(sync): preserve legacy automation",
    draft: false,
    body,
    mergeable: true,
    mergeable_state: "clean",
    base: { ref: "main", sha: "c".repeat(40) },
    head: {
      ref: "legacy-sync-candidate",
      sha: "d".repeat(40),
      repo: { full_name: "owner/repo" },
    },
    labels: [{ name: "automerge" }],
    auto_merge: null,
  };
}

function execute(t, { initialBody = "", freshBody = initialBody } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "acos-managed-sync-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const commandLog = path.join(directory, "commands.ndjson");
  const mutationLog = path.join(directory, "mutations.ndjson");
  const fakeGh = path.join(directory, "gh");
  const fakeGit = path.join(directory, "git");
  writeFileSync(fakeGh, `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.COMMAND_LOG, JSON.stringify(["gh", ...args]) + "\\n");
if (args[0] === "api") {
  const endpoint = args.find(value => value.startsWith("repos/"));
  const value = endpoint === "repos/owner/repo/pulls"
    ? [JSON.parse(process.env.INITIAL_PULL)]
    : JSON.parse(process.env.FRESH_PULL);
  process.stdout.write(JSON.stringify(value));
  process.exit(0);
}
appendFileSync(process.env.MUTATION_LOG, JSON.stringify(["gh", ...args]) + "\\n");
process.exit(0);
`);
  writeFileSync(fakeGit, `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.COMMAND_LOG, JSON.stringify(["git", ...process.argv.slice(2)]) + "\\n");
appendFileSync(process.env.MUTATION_LOG, JSON.stringify(["git", ...process.argv.slice(2)]) + "\\n");
process.exit(86);
`);
  chmodSync(fakeGh, 0o755);
  chmodSync(fakeGit, 0o755);

  const result = spawnSync(process.execPath, [syncScript], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH || ""}`,
      GITHUB_REPOSITORY: "owner/repo",
      COMMAND_LOG: commandLog,
      MUTATION_LOG: mutationLog,
      INITIAL_PULL: JSON.stringify(pull(initialBody)),
      FRESH_PULL: JSON.stringify(pull(freshBody)),
    },
  });
  const readLines = file => {
    try {
      return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  };
  return { result, commands: readLines(commandLog), mutations: readLines(mutationLog) };
}

test("legacy sync skips valid and malformed reserved writer-lease markers without effects", t => {
  for (const [label, body] of [["valid", validMarker], ["malformed", malformedMarker]]) {
    const { result, commands, mutations } = execute(t, { initialBody: body });
    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
    assert.match(result.stdout, /No eligible automerge PR needs synchronization/);
    assert.deepEqual(mutations, [], `${label} marker must block every Git and PR mutation`);
    assert.equal(commands.filter(call => call[0] === "gh" && call[1] === "api").length, 1);
  }
});

test("legacy sync repeats managed-lane eligibility after its fresh PR read", t => {
  for (const [label, body] of [["valid", validMarker], ["malformed", malformedMarker]]) {
    const { result, commands, mutations } = execute(t, { freshBody: body });
    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
    assert.match(result.stdout, /No eligible automerge PR needs synchronization/);
    assert.deepEqual(mutations, [], `${label} fresh marker must block every Git and PR mutation`);
    assert.equal(commands.filter(call => call[0] === "gh" && call[1] === "api").length, 2);
  }
});

test("an ordinary legacy automerge candidate remains eligible", t => {
  const { result, commands, mutations } = execute(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Synchronizing PR #17/);
  assert.deepEqual(mutations.map(call => call.slice(0, 3)), [
    ["gh", "pr", "edit"],
    ["gh", "pr", "merge"],
  ]);
  assert.equal(commands.some(call => call[0] === "git"), false);
});
