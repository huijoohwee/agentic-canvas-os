import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const PRE_COMMIT_HOOK = path.resolve(".githooks/pre-commit");
const PRE_PUSH_HOOK = path.resolve(".githooks/pre-push");

function createFakeGit(binDir) {
  const script = `#!/bin/sh
set -eu
command="$1"
shift || true
case "$command $*" in
  "diff --name-only --diff-filter=U")
    exit 0
    ;;
  "ls-files -u")
    exit 0
    ;;
  "rev-parse --show-toplevel")
    printf '%s\\n' "$TEST_REPOSITORY_ROOT"
    ;;
  "worktree list --porcelain")
    printf 'worktree %s\\n\\n' "$TEST_REPOSITORY_ROOT"
    ;;
  "branch --show-current")
    printf '%s\\n' "$TEST_BRANCH"
    ;;
  *)
    echo "unexpected git command: $command $*" >&2
    exit 1
    ;;
esac
`;
  const target = path.join(binDir, "git");
  fs.writeFileSync(target, script, { mode: 0o755 });
}

function createFakeNode(binDir, logPath) {
  const script = `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "${logPath}"
exit 0
`;
  const target = path.join(binDir, "node");
  fs.writeFileSync(target, script, { mode: 0o755 });
}

function runHook({ branch, createWriterLeaseGuard, hook = PRE_COMMIT_HOOK }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-hook-pre-commit-"));
  const binDir = path.join(root, "bin");
  const scriptsDir = path.join(root, "scripts");
  const nodeLog = path.join(root, "node.log");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  createFakeGit(binDir);
  createFakeNode(binDir, nodeLog);
  if (createWriterLeaseGuard) {
    fs.writeFileSync(path.join(scriptsDir, "writer-lease-guard.mjs"), "export {};\n");
  }
  const result = spawnSync(hook, [], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      TEST_BRANCH: branch,
      TEST_REPOSITORY_ROOT: root,
    },
    encoding: "utf8",
  });
  const nodeCalls = fs.existsSync(nodeLog)
    ? fs.readFileSync(nodeLog, "utf8").trim().split("\n").filter(Boolean)
    : [];
  fs.rmSync(root, { recursive: true, force: true });
  return { ...result, nodeCalls };
}

test("shared pre-commit skips repo-specific writer guard when the script is absent", () => {
  const result = runHook({
    branch: "agent/macos/release-closure-parity",
    createWriterLeaseGuard: false,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.nodeCalls, []);
});

// The writer-lease authority gate belongs to pre-push. A commit reaches only the
// run's own lane, so gating it on shared authority protects nothing shared while
// risking every authored byte not yet recorded.
test("shared pre-commit never gates a local commit on shared writer authority", () => {
  const result = runHook({
    branch: "agent/macos/release-closure-parity",
    createWriterLeaseGuard: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.nodeCalls.some((call) => /writer-lease-guard\.mjs$/.test(call)),
    false,
    "recording must not assert publication authority",
  );
});

test("shared pre-push runs the writer lease guard on an agent branch", () => {
  const result = runHook({
    branch: "agent/macos/release-closure-parity",
    createWriterLeaseGuard: true,
    hook: PRE_PUSH_HOOK,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.nodeCalls[0], /writer-lease-guard\.mjs$/,
    "pushing is the first shared mutation, so it carries the gate");
});

test("shared pre-push leaves a non-agent branch to the workspace guard alone", () => {
  const result = runHook({
    branch: "main",
    createWriterLeaseGuard: true,
    hook: PRE_PUSH_HOOK,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.nodeCalls.some((call) => /writer-lease-guard\.mjs$/.test(call)),
    false,
  );
});

test("shared pre-push skips the writer guard when the repository omits it", () => {
  const result = runHook({
    branch: "agent/macos/release-closure-parity",
    createWriterLeaseGuard: false,
    hook: PRE_PUSH_HOOK,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.nodeCalls.some((call) => /writer-lease-guard\.mjs$/.test(call)),
    false,
  );
});
