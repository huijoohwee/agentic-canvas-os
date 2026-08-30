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

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { refreshTaskBranchFromMain } from "../scripts/device-integrate-lib.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const liveSyncPath = path.join(repositoryRoot, "scripts", "live-sync.mjs");
const beforeSha = "a".repeat(40);
const originSha = "b".repeat(40);
const otherSha = "c".repeat(40);
const requiredSha = "d".repeat(40);

function runLiveSync(t, {
  ancestorStatus = 0,
  expected = "",
  initialHead = beforeSha,
  json = true,
  required = requiredSha,
} = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agentic-live-sync-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fakeGitPath = path.join(directory, "git");
  const commandLogPath = path.join(directory, "commands.ndjson");
  const headPath = path.join(directory, "head");
  writeFileSync(commandLogPath, "");
  writeFileSync(headPath, initialHead);
  writeFileSync(fakeGitPath, `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.LIVE_SYNC_COMMAND_LOG, JSON.stringify(args) + "\\n");
const key = args.join(" ");
if (key === "rev-parse --show-toplevel") process.stdout.write(process.env.LIVE_SYNC_ROOT + "\\n");
else if (key === "worktree list --porcelain -z") process.stdout.write(
  "worktree " + process.env.LIVE_SYNC_ROOT + "\\0" +
  "HEAD " + readFileSync(process.env.LIVE_SYNC_HEAD, "utf8").trim() + "\\0" +
  "branch refs/heads/main\\0",
);
else if (key === "fetch --quiet origin main") {}
else if (key === "branch --show-current") process.stdout.write("main\\n");
else if (key === "status --porcelain") {}
else if (key === "rev-parse HEAD") process.stdout.write(
  readFileSync(process.env.LIVE_SYNC_HEAD, "utf8").trim() + "\\n",
);
else if (key === "rev-parse origin/main") process.stdout.write(process.env.LIVE_SYNC_ORIGIN + "\\n");
else if (key === "merge-base --is-ancestor " + process.env.LIVE_SYNC_REQUIRED + " " +
  process.env.LIVE_SYNC_ORIGIN) process.exit(Number(process.env.LIVE_SYNC_ANCESTOR_STATUS));
else if (key === "merge --ff-only " + process.env.LIVE_SYNC_ORIGIN) {
  writeFileSync(process.env.LIVE_SYNC_HEAD, process.env.LIVE_SYNC_ORIGIN);
} else process.exit(86);
`);
  chmodSync(fakeGitPath, 0o755);
  const result = spawnSync(process.execPath, [
    liveSyncPath,
    ...(expected ? [`--expected-origin-head=${expected}`] : []),
    ...(required ? [`--required-origin-ancestor=${required}`] : []),
    ...(json ? ["--json"] : []),
  ], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH || ""}`,
      LIVE_SYNC_COMMAND_LOG: commandLogPath,
      LIVE_SYNC_HEAD: headPath,
      LIVE_SYNC_ORIGIN: originSha,
      LIVE_SYNC_REQUIRED: required,
      LIVE_SYNC_ANCESTOR_STATUS: String(ancestorStatus),
      LIVE_SYNC_ROOT: directory,
    },
  });
  return {
    result,
    commands: readFileSync(commandLogPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse),
  };
}

test("live sync refuses a fetched origin/main that differs from the exact expected head", t => {
  const { result, commands } = runLiveSync(t, { expected: otherSha, required: "" });

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schema, "agentic-live-sync-result/v1");
  assert.equal(receipt.status, "error");
  assert.equal(receipt.expectedOriginHead, otherSha);
  assert.equal(receipt.requiredOriginAncestor, null);
  assert.match(receipt.error.message, /canonical fast-forward refused/u);
  assert.ok(Buffer.byteLength(result.stdout) < 2_048);
  assert.ok(commands.some(args => args.join(" ") === "fetch --quiet origin main"));
  assert.equal(commands.some(args => args[0] === "merge"), false);
});

test("live sync retains the legacy exact-head constraint", t => {
  const { result, commands } = runLiveSync(t, { expected: originSha, required: "" });

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, "updated");
  assert.equal(receipt.expectedOriginHead, originSha);
  assert.equal(receipt.requiredOriginAncestor, null);
  assert.equal(receipt.originHeadSha, originSha);
  assert.equal(receipt.integratedSha, originSha);
  assert.equal(commands.some(args => args[0] === "merge-base"), false);
  assert.ok(commands.some(args => args.join(" ") === `merge --ff-only ${originSha}`));
});

test("live sync accepts a later descendant, pins it, and binds both SHAs in its receipt", t => {
  const { result, commands } = runLiveSync(t);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  const { receiptDigest, ...receiptSubject } = receipt;
  assert.equal(receipt.status, "updated");
  assert.equal(receipt.expectedOriginHead, null);
  assert.equal(receipt.requiredOriginAncestor, requiredSha);
  assert.equal(receipt.beforeSha, beforeSha);
  assert.equal(receipt.originHeadSha, originSha);
  assert.equal(receipt.integratedSha, originSha);
  assert.equal(receiptDigest, digestValue(receiptSubject));
  assert.ok(commands.some(args => args.join(" ") ===
    `merge-base --is-ancestor ${requiredSha} ${originSha}`));
  assert.ok(commands.some(args => args.join(" ") === `merge --ff-only ${originSha}`));
});

test("live sync refuses an actual origin/main that does not descend from the required SHA", t => {
  const { result, commands } = runLiveSync(t, { ancestorStatus: 1 });

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, "error");
  assert.equal(receipt.expectedOriginHead, null);
  assert.equal(receipt.requiredOriginAncestor, requiredSha);
  assert.match(receipt.error.message, /does not descend from required origin ancestor/u);
  assert.equal(commands.some(args => args[0] === "merge"), false);
});

test("live sync keeps exact-head compatibility but rejects ambiguous dual constraints", t => {
  const { result, commands } = runLiveSync(t, { expected: originSha });

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.expectedOriginHead, originSha);
  assert.equal(receipt.requiredOriginAncestor, requiredSha);
  assert.match(receipt.error.message, /mutually exclusive/u);
  assert.deepEqual(commands, []);
});

test("live sync preserves its compatible plain update output", t => {
  const { result } = runLiveSync(t, { json: false });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `Canonical checkout updated ${beforeSha.slice(0, 12)} -> ${originSha.slice(0, 12)}.`,
  );
});

test("live sync rechecks a current canonical checkout before issuing its receipt", t => {
  const { result, commands } = runLiveSync(t, { initialHead: originSha });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, "current");
  assert.equal(receipt.integratedSha, originSha);
  assert.equal(commands.filter(args => args.join(" ") === "rev-parse HEAD").length, 2);
  assert.equal(commands.filter(args => args.join(" ") === "status --porcelain").length, 2);
});

test("task-branch refresh pins both parents, verifies the merge tree, and reports paths without rename folding", () => {
  const preMergeHeadSha = "1".repeat(40);
  const targetMainSha = "2".repeat(40);
  const mergeBaseSha = "3".repeat(40);
  const refreshedHeadSha = "4".repeat(40);
  const treeSha = "5".repeat(40);
  const branch = "agent/device/runtime-integration";
  const commands = [];
  let headSha = preMergeHeadSha;
  const gitText = args => {
    const key = args.join(" ");
    if (key === "status --porcelain") return "";
    if (key === "rev-parse HEAD") return headSha;
    if (key === "rev-parse origin/main") return targetMainSha;
    if (key === `merge-base ${preMergeHeadSha} ${targetMainSha}`) return mergeBaseSha;
    if (key === `merge-base --is-ancestor ${targetMainSha} ${targetMainSha}`) return "";
    if (key === `rev-list --parents -n 1 ${refreshedHeadSha}`) {
      return `${refreshedHeadSha} ${preMergeHeadSha} ${targetMainSha}\n`;
    }
    if (key === `rev-parse ${refreshedHeadSha}^{tree}`) return treeSha;
    if (key === `diff --name-only --no-renames -z ${targetMainSha}..${refreshedHeadSha} --`) {
      return "scripts/live-sync.mjs\0";
    }
    throw new Error(`unexpected git command: ${key}`);
  };
  const receipt = refreshTaskBranchFromMain({
    repo: "/workspace/task",
    gitText,
    run: (command, args) => {
      commands.push([command, ...args]);
      if (command === "git" && args[0] === "merge") headSha = refreshedHeadSha;
    },
    runText: (command, args, options) => {
      commands.push([command, ...args, JSON.stringify(options)]);
      return treeSha;
    },
    squashSubject: "fix(runtime-integration): pin protected main refresh",
    branch,
    lease: { branch, scope: "runtime-integration", epoch: 1 },
    expectedHeadSha: preMergeHeadSha,
  });

  const { receiptDigest, ...receiptSubject } = receipt;
  assert.equal(receipt.status, "refreshed");
  assert.equal(receipt.sourceHeadSha, preMergeHeadSha);
  assert.equal(receipt.preMergeHeadSha, preMergeHeadSha);
  assert.equal(receipt.targetMainSha, targetMainSha);
  assert.equal(receipt.refreshedHeadSha, refreshedHeadSha);
  assert.equal(receipt.treeSha, treeSha);
  assert.deepEqual(receipt.paths, ["scripts/live-sync.mjs"]);
  assert.equal(receipt.pathsDigest, digestValue(receipt.paths));
  assert.equal(receipt.refreshCommitCount, 1);
  assert.equal(receiptDigest, digestValue(receiptSubject));
  assert.ok(commands.some(call => call.join(" ").includes(
    `merge-tree --write-tree --no-messages ${preMergeHeadSha} ${targetMainSha}`,
  )));
  assert.ok(commands.some(call => call[0] === "git" && call[1] === "merge" &&
    call.at(-1) === targetMainSha));
  assert.equal(commands.some(call => call.includes("origin/main") && call[1] !== "fetch"), false);
});

test("task-branch refresh rejects an authored commit appended after the sealed source", () => {
  const sealedHeadSha = "1".repeat(40);
  const appendedHeadSha = "2".repeat(40);
  const targetMainSha = "3".repeat(40);
  const branch = "agent/device/runtime-integration";
  assert.throws(() => refreshTaskBranchFromMain({
    repo: "/workspace/task",
    gitText: args => {
      const key = args.join(" ");
      if (key === "status --porcelain") return "";
      if (key === "rev-parse HEAD") return appendedHeadSha;
      if (key === "rev-parse origin/main") return targetMainSha;
      if (key === `rev-list --parents -n 1 ${appendedHeadSha}`) {
        return `${appendedHeadSha} ${sealedHeadSha}`;
      }
      throw new Error(`unexpected git command: ${key}`);
    },
    run: () => {},
    runText: () => { throw new Error("unsealed history must fail before merge-tree"); },
    squashSubject: "fix(runtime-integration): reject unsealed append",
    branch,
    lease: { branch, scope: "runtime-integration", epoch: 1 },
    expectedHeadSha: sealedHeadSha,
  }), /refresh chain contains an unsealed authored commit/u);
});
