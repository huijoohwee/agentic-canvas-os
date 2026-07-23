import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CHANGE_MANIFEST_SCHEMA,
  DEVICE_INTEGRATION_RESULT_SCHEMA,
  integrateSession,
} from "../scripts/device-integrate-lib.mjs";

const branch = "agent/device/runtime-integration";
const baseSha = "a".repeat(40);
const fenceSha = "b".repeat(40);
const commitSha = "c".repeat(40);
const treeSha = "d".repeat(40);
const mergeSha = "e".repeat(40);
const mainSha = "f".repeat(40);
const knowgrphSha = "1".repeat(40);
const pullRequestUrl = "https://github.test/example/repo/pull/42";

test("dirty integration validates an exact manifest, commits, publishes, completes, and proves runtime readiness", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-"));
  const manifestPath = path.join(os.tmpdir(), `agentic-manifest-${process.pid}.json`);
  const paths = ["package.json", "scripts/runtime.mjs"];
  const canonicalAgenticRoot = path.join(repo, "canonical", "agentic-canvas-os");
  const canonicalKnowgrphRoot = path.join(repo, "canonical", "knowgrph");
  mkdirSync(canonicalAgenticRoot, { recursive: true });
  mkdirSync(canonicalKnowgrphRoot, { recursive: true });
  writeFileSync(path.join(canonicalAgenticRoot, "package.json"), "{}");
  writeFileSync(path.join(canonicalKnowgrphRoot, "package.json"), "{}");
  writeFileSync(manifestPath, JSON.stringify({ schema: CHANGE_MANIFEST_SCHEMA, branch, baseSha, paths }));
  let head = fenceSha;
  let lease = createLease({ repo, status: "active" });
  const commands = [];
  const runtimeCommands = [];
  const gitText = args => {
    const key = args.join(" ");
    if (key === "branch --show-current") return `${branch}\n`;
    if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
    if (key === "diff --name-only -z HEAD --") return `${paths.join("\0")}\0`;
    if (key === "ls-files --others --exclude-standard -z") return "";
    if (key === "diff --name-only -z") return "";
    if (key === "diff --cached --name-only -z") return `${paths.join("\0")}\0`;
    if (key === "diff --cached --binary") return "fixture staged diff";
    if (key === "status --porcelain") return "";
    if (key === "rev-parse HEAD") return head;
    if (key === "rev-parse HEAD^{tree}") return treeSha;
    throw new Error(`unexpected git command: ${key}`);
  };
  const leaseStore = {
    read: requested => requested ? lease : { leases: { [branch]: lease } },
    annotate: ({ values }) => (lease = { ...lease, ...values }),
  };

  try {
    const result = integrateSession({
      invocationPath: repo,
      repo,
      gitText,
      ghText: () => JSON.stringify({
        url: pullRequestUrl,
        state: "MERGED",
        baseRefName: "main",
        headRefOid: commitSha,
        mergeCommit: { oid: mergeSha },
      }),
      leaseStore,
      sessionId: "session-a",
      run: (command, args) => {
        commands.push([command, ...args]);
        if (command === "git" && args[0] === "commit") head = commitSha;
      },
      runText: (command, args, options) => {
        runtimeCommands.push({ command, args, options });
        if (command === "git") return `${mainSha}\n`;
        if (command === "node") return "";
        return JSON.stringify({
          schema: "agentic-local-runtime-readiness/v1",
          ready: true,
          status: "runtime-ready",
          source: { repository: "huijoohwee/knowgrph", revision: knowgrphSha },
          agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: mainSha },
        });
      },
      controllerRoot: repo,
      publishTask: () => {
        lease = { ...lease, status: "delivery", deliveryHeadSha: commitSha };
      },
      completeTask: () => {
        lease = { ...lease, status: "completed", completion: { mergeCommitSha: mergeSha, mainSha } };
        return lease.completion;
      },
      commitMessage: "feat: integrate the canonical runtime",
      pathsManifest: manifestPath,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    });

    assert.equal(result.schema, DEVICE_INTEGRATION_RESULT_SCHEMA);
    assert.equal(result.status, "runtime_ready");
    assert.equal(result.mainSha, mainSha);
    assert.equal(result.commit.commitSha, commitSha);
    assert.deepEqual(result.commit.paths, paths);
    assert.ok(commands.some(call => call.join(" ") ===
      "git add -- :(literal)package.json :(literal)scripts/runtime.mjs"));
    assert.ok(commands.some(call => call.join(" ") ===
      "git commit -m feat: integrate the canonical runtime"));
    assert.ok(commands.some(call => call.join(" ") === "npm run check"));
    assert.ok(commands.some(call => call.join(" ") === "git fetch origin main"));
    assert.ok(commands.some(call => call.join(" ") === "git merge --no-edit origin/main"));
    assert.equal(result.runtime.integratedSource.mainSha, mainSha);
    assert.equal(result.runtime.readiness.source.revision, knowgrphSha);
    assert.deepEqual(runtimeCommands[0], {
      command: "git",
      args: ["merge-tree", "--write-tree", "HEAD", "origin/main"],
      options: { cwd: repo },
    });
    assert.equal(runtimeCommands[1].command, "node");
    assert.equal(runtimeCommands[1].options.cwd, canonicalAgenticRoot);
    assert.deepEqual(runtimeCommands[2], {
      command: "git",
      args: ["rev-parse", "HEAD"],
      options: { cwd: canonicalAgenticRoot },
    });
    assert.equal(runtimeCommands[3].command, "npm");
    assert.ok(runtimeCommands[3].args.includes(`--repository=${canonicalKnowgrphRoot}`));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(manifestPath, { force: true });
  }
});

test("integration rejects dirty paths outside the explicit manifest before validation or staging", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-"));
  const manifestPath = path.join(os.tmpdir(), `agentic-manifest-mismatch-${process.pid}.json`);
  writeFileSync(manifestPath, JSON.stringify({
    schema: CHANGE_MANIFEST_SCHEMA,
    branch,
    baseSha,
    paths: ["package.json"],
  }));
  let lease = createLease({ repo, status: "active" });
  const commands = [];
  try {
    assert.throws(() => integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === "diff --name-only -z HEAD --") return "package.json\0scripts/unapproved.mjs\0";
        if (key === "ls-files --others --exclude-standard -z") return "";
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => "",
      leaseStore: {
        read: requested => requested ? lease : { leases: { [branch]: lease } },
        annotate: ({ values }) => (lease = { ...lease, ...values }),
      },
      sessionId: "session-a",
      run: (command, args) => commands.push([command, ...args]),
      runText: () => "",
      publishTask: () => {},
      completeTask: () => {},
      commitMessage: "fix: bounded integration",
      pathsManifest: manifestPath,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    }), /do not match the approved manifest/);
    assert.deepEqual(commands, [["git", "merge-base", "--is-ancestor", fenceSha, "HEAD"]]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(manifestPath, { force: true });
  }
});

test("bounded merge waiting preserves delivery state for replay", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-"));
  const lease = createLease({
    repo,
    status: "delivery",
    deliveryHeadSha: commitSha,
    integration: { commitSha },
  });
  let clock = 0;
  let completed = false;
  try {
    assert.throws(() => integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => JSON.stringify({
        url: pullRequestUrl,
        state: "OPEN",
        baseRefName: "main",
        headRefOid: commitSha,
        mergeCommit: null,
      }),
      leaseStore: { read: requested => requested ? lease : { leases: { [branch]: lease } } },
      sessionId: "session-a",
      run: () => {},
      runText: () => "",
      publishTask: () => {},
      completeTask: () => { completed = true; },
      waitSeconds: 1,
      pollSeconds: 0.1,
      now: () => new Date(clock),
      sleep: milliseconds => { clock += milliseconds; },
      log: () => {},
    }), /delivery lease is preserved for replay/);
    assert.equal(completed, false);
    assert.equal(lease.status, "delivery");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

function createLease({ repo, ...overrides }) {
  return {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 1,
    sessionId: "session-a",
    branch,
    worktreePath: repo,
    baseSha,
    fenceSha,
    pullRequestUrl,
    ...overrides,
  };
}

function canonicalWorktree(repo) {
  return `worktree ${path.join(repo, "canonical", "agentic-canvas-os")}\0HEAD ${baseSha}\0branch refs/heads/main\0\0` +
    `worktree ${repo}\0HEAD ${fenceSha}\0branch refs/heads/${branch}\0\0`;
}
