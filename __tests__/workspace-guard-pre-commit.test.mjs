import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const PRE_COMMIT_HOOK = path.resolve(".githooks/pre-commit");

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

function runHook({ branch, createWriterLeaseGuard }) {
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
  const result = spawnSync(PRE_COMMIT_HOOK, [], {
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

test("shared pre-commit runs the writer lease guard when the repository provides it", () => {
  const result = runHook({
    branch: "agent/macos/release-closure-parity",
    createWriterLeaseGuard: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.nodeCalls.length, 1);
  assert.match(result.nodeCalls[0], /writer-lease-guard\.mjs$/);
});
