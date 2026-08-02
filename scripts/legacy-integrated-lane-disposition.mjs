#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePorcelainV1 } from "./canonical-main-recovery-evidence.mjs";

export const LEGACY_INTEGRATED_LANE_DISPOSITION_SCHEMA =
  "agentic-legacy-integrated-lane-disposition/v1";
export const LEGACY_INTEGRATED_LANE_RESULT_SCHEMA =
  "agentic-legacy-integrated-lane-disposition-result/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

export function dispositionLegacyIntegratedLane({
  sourceWorktree,
  expectedBranch,
  expectedHead,
  protectedTip,
  operatorSessionId,
  receiptPath,
}) {
  const source = realpathSync(path.resolve(requireValue(sourceWorktree, "source worktree")));
  const branch = requireValue(expectedBranch, "expected branch");
  const head = requireSha(expectedHead, "expected lane HEAD");
  const protectedSha = requireSha(protectedTip, "protected tip");
  const sessionId = requireValue(operatorSessionId, "operator session id");
  const outputPath = path.resolve(requireValue(receiptPath, "receipt path"));
  const repository = realpathSync(path.resolve(gitText(source, ["rev-parse", "--show-toplevel"]).trim()));
  if (repository !== source) throw new Error(`Source must be the registered worktree root ${repository}.`);
  if (branch === "main" || branch === "refs/heads/main") throw new Error("Canonical main is not a legacy task lane.");
  requireRegisteredWorktree(source);

  const commonDirectory = realpathSync(path.resolve(source, gitText(source, ["rev-parse", "--git-common-dir"]).trim()));
  if (isWithin(outputPath, source) || isWithin(outputPath, commonDirectory)) {
    throw new Error("Receipt must be outside the source worktree and Git common directory.");
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const lockPath = `${outputPath}.lock`;
  const lock = acquireLock(lockPath, sessionId);
  try {
    gitRun(source, ["fetch", "--no-tags", "origin", "main", branch]);
    requireExactRef(source, "origin/main", protectedSha, "protected origin/main");
    requireExactRef(source, `refs/remotes/origin/${branch}`, head, "durable remote branch");

    const existing = readReceipt(outputPath);
    if (existing) requireReceiptIdentity(existing, { source, branch, head, protectedSha, sessionId });
    const observedHead = requireSha(gitText(source, ["rev-parse", "HEAD"]).trim(), "observed HEAD");
    const currentBranch = gitOptional(source, ["symbolic-ref", "--quiet", "--short", "HEAD"]).trim();
    if (!currentBranch && observedHead === protectedSha && existing?.state === "prepared") {
      requireCleanAtProtected(source, protectedSha);
      const completed = completeReceipt(existing, outputPath);
      return buildResult(completed, outputPath, true);
    }
    if (currentBranch !== branch || observedHead !== head) {
      throw new Error(`Lane identity changed (branch=${currentBranch || "detached"}, HEAD=${observedHead}).`);
    }

    let receipt = existing;
    const transitionPrepared = receipt && isPreparedTransition(source, protectedSha);
    if (!receipt) {
      const evidence = captureEvidence({ source, branch, head, protectedSha });
      receipt = withDigest({
        schema: LEGACY_INTEGRATED_LANE_DISPOSITION_SCHEMA,
        state: "prepared",
        sourceWorktree: source,
        sourceBranch: branch,
        sourceHead: head,
        sourceTree: requireSha(gitText(source, ["rev-parse", `${head}^{tree}`]).trim(), "source tree"),
        protectedTip: protectedSha,
        protectedTree: requireSha(gitText(source, ["rev-parse", `${protectedSha}^{tree}`]).trim(), "protected tree"),
        operatorSessionId: sessionId,
        equivalenceScope: "complete-legacy-lane-write-set",
        manifest: evidence.manifest,
        manifestDigest: digest(evidence.manifest),
        stateDigest: evidence.stateDigest,
        writeSetDigest: evidence.writeSetDigest,
        recoveryHandles: [
          `protected-commit:${protectedSha}`,
          `remote-ref:refs/heads/${branch}@${head}`,
        ],
        preparedAt: new Date().toISOString(),
        completedAt: null,
      });
      writeReceipt(outputPath, receipt);
    } else if (!transitionPrepared) {
      const evidence = captureEvidence({ source, branch, head, protectedSha });
      requirePreparedReceipt(receipt, evidence);
    }

    if (!transitionPrepared) {
      requireExactEvidence(captureEvidence({ source, branch, head, protectedSha }), receipt);
      requireExactRef(source, "origin/main", protectedSha, "protected origin/main");
      requireExactRef(source, `refs/remotes/origin/${branch}`, head, "durable remote branch");
      gitRun(source, ["read-tree", "--reset", "-u", protectedSha]);
    }
    if (!isPreparedTransition(source, protectedSha)) {
      throw new Error("Legacy disposition did not reach the prepared protected-tree transition.");
    }
    gitRun(source, ["switch", "--detach", protectedSha]);
    requireCleanAtProtected(source, protectedSha);
    requireExactRef(source, `refs/remotes/origin/${branch}`, head, "durable remote branch");
    receipt = completeReceipt(receipt, outputPath);
    return buildResult(receipt, outputPath, false);
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

function isPreparedTransition(source, protectedSha) {
  if (gitText(source, ["diff", "--name-only", "--diff-filter=U"]).trim() || gitText(source, ["ls-files", "-u"]).trim()) return false;
  if (readNul(gitText(source, ["ls-files", "--others", "--exclude-standard", "-z"])).length) return false;
  return gitSucceeds(source, ["diff", "--cached", "--quiet", protectedSha, "--"])
    && gitSucceeds(source, ["diff", "--quiet", "--"]);
}

function captureEvidence({ source, branch, head, protectedSha }) {
  assertSafeWorkingState(source, head);
  const dirtyPaths = readNul(gitText(source, ["diff", "--name-only", "-z", "--"]));
  if (dirtyPaths.length === 0) throw new Error("Legacy disposition requires an unstaged tracked working set.");
  const mergeBase = requireSha(gitText(source, ["merge-base", head, protectedSha]).trim(), "merge base");
  const branchPaths = readNul(gitText(source, ["diff", "--name-only", "-z", mergeBase, head, "--"]));
  const dirtySet = new Set(dirtyPaths);
  const uncovered = branchPaths.filter((entry) => !dirtySet.has(entry));
  if (uncovered.length) {
    throw new Error(`Legacy branch has committed path outside the equivalent working set: ${uncovered[0]}.`);
  }
  const paths = [...new Set([...dirtyPaths, ...branchPaths])].sort();
  const manifest = paths.map(relativePath => {
    const target = readTreeBlob(source, protectedSha, relativePath, "Protected target");
    const workingMode = readWorkingMode(source, relativePath);
    const workingBlob = requireSha(gitText(source, ["hash-object", `--path=${relativePath}`, "--", relativePath]).trim(), `working blob for ${relativePath}`);
    if (workingMode !== target.mode || workingBlob !== target.blob) {
      throw new Error(`Working path is not byte-and-mode equivalent to protected main: ${relativePath}.`);
    }
    const branchBlob = readTreeBlob(source, head, relativePath, "Legacy branch");
    return Object.freeze({
      path: relativePath,
      branchMode: branchBlob.mode,
      branchBlob: branchBlob.blob,
      protectedMode: target.mode,
      protectedBlob: target.blob,
      workingMode,
      workingBlob,
      branchAuthored: branchPaths.includes(relativePath),
    });
  });
  return Object.freeze({
    manifest: Object.freeze(manifest),
    stateDigest: digest({ head, branch, manifest }),
    writeSetDigest: digest(paths),
  });
}

function assertSafeWorkingState(source, head) {
  if (gitText(source, ["diff", "--name-only", "--diff-filter=U"]).trim() || gitText(source, ["ls-files", "-u"]).trim()) {
    throw new Error("Legacy disposition rejects unmerged paths.");
  }
  const untracked = readNul(gitText(source, ["ls-files", "--others", "--exclude-standard", "-z"]));
  if (untracked.length) throw new Error(`Legacy disposition rejects untracked path ${untracked[0]}.`);
  if (!gitSucceeds(source, ["diff", "--cached", "--quiet", head, "--"])) {
    throw new Error("Legacy disposition rejects staged state.");
  }
  const records = parsePorcelainV1(gitText(source, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
  for (const record of records) {
    if (record.status[0] !== " " || !["M", "T"].includes(record.status[1])) {
      throw new Error(`Legacy disposition rejects status ${record.status} ${record.path}.`);
    }
  }
}

function requireRegisteredWorktree(source) {
  const paths = gitText(source, ["worktree", "list", "--porcelain"])
    .split(/\r?\n/)
    .filter(line => line.startsWith("worktree "))
    .map(line => realpathSync(line.slice("worktree ".length).trim()));
  if (paths.filter(candidate => candidate === source).length !== 1) {
    throw new Error(`Source is not exactly one registered worktree: ${source}.`);
  }
}

function requireCleanAtProtected(source, protectedSha) {
  requireExactRef(source, "HEAD", protectedSha, "detached protected HEAD");
  if (gitOptional(source, ["symbolic-ref", "--quiet", "--short", "HEAD"]).trim()) {
    throw new Error("Completed legacy disposition must be detached.");
  }
  if (gitText(source, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).length) {
    throw new Error("Completed legacy disposition is not clean.");
  }
}

function readTreeBlob(source, treeish, relativePath, label) {
  const match = /^([0-7]{6}) blob ([0-9a-f]{40})\t/.exec(gitText(source, ["ls-tree", "-z", treeish, "--", relativePath]));
  if (!match) throw new Error(`${label} does not contain tracked blob ${relativePath}.`);
  return Object.freeze({ mode: match[1], blob: match[2] });
}

function readWorkingMode(source, relativePath) {
  const stats = lstatSync(path.join(source, relativePath));
  if (stats.isSymbolicLink()) return "120000";
  if (!stats.isFile()) throw new Error(`Legacy disposition rejects non-file path ${relativePath}.`);
  return stats.mode & 0o111 ? "100755" : "100644";
}

function requirePreparedReceipt(receipt, evidence) {
  if (receipt.state !== "prepared" || receipt.equivalenceScope !== "complete-legacy-lane-write-set") {
    throw new Error("Legacy disposition receipt is not replayable prepared evidence.");
  }
  requireExactEvidence(evidence, receipt);
}

function requireExactEvidence(evidence, receipt) {
  if (evidence.stateDigest !== receipt.stateDigest || evidence.writeSetDigest !== receipt.writeSetDigest ||
      digest(evidence.manifest) !== receipt.manifestDigest) {
    throw new Error("Legacy lane drifted from prepared disposition evidence.");
  }
}

function completeReceipt(receipt, outputPath) {
  const completed = withDigest({ ...withoutDigest(receipt), state: "completed", completedAt: new Date().toISOString() });
  writeReceipt(outputPath, completed);
  return completed;
}

function buildResult(receipt, outputPath, replayed) {
  return Object.freeze({
    schema: LEGACY_INTEGRATED_LANE_RESULT_SCHEMA,
    status: "completed",
    sourceBranch: receipt.sourceBranch,
    sourceHead: receipt.sourceHead,
    protectedTip: receipt.protectedTip,
    pathCount: receipt.manifest.length,
    stateDigest: receipt.stateDigest,
    writeSetDigest: receipt.writeSetDigest,
    receiptDigest: receipt.receiptDigest,
    receiptPath: outputPath,
    replayed,
  });
}

function readReceipt(outputPath) {
  if (!existsSync(outputPath)) return null;
  const receipt = JSON.parse(readFileSync(outputPath, "utf8"));
  if (receipt.schema !== LEGACY_INTEGRATED_LANE_DISPOSITION_SCHEMA || receipt.receiptDigest !== digest(withoutDigest(receipt))) {
    throw new Error("Legacy disposition receipt is malformed or digest-invalid.");
  }
  return receipt;
}

function requireReceiptIdentity(receipt, { source, branch, head, protectedSha, sessionId }) {
  const expected = { sourceWorktree: source, sourceBranch: branch, sourceHead: head, protectedTip: protectedSha, operatorSessionId: sessionId };
  for (const [key, value] of Object.entries(expected)) {
    if (receipt[key] !== value) throw new Error(`Legacy disposition receipt ${key} does not match this invocation.`);
  }
}

function withDigest(value) {
  const plain = withoutDigest(value);
  return Object.freeze({ ...plain, receiptDigest: digest(plain) });
}

function withoutDigest(value) {
  const { receiptDigest: _ignored, ...plain } = value;
  return plain;
}

function writeReceipt(outputPath, receipt) {
  const temporary = `${outputPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, outputPath);
}

function acquireLock(lockPath, sessionId) {
  try {
    const fd = openSync(lockPath, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify({ sessionId, createdAt: new Date().toISOString() })}\n`);
    return fd;
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`Legacy disposition lock is already held: ${lockPath}.`);
    throw error;
  }
}

function requireExactRef(source, ref, expected, label) {
  const observed = requireSha(gitText(source, ["rev-parse", ref]).trim(), label);
  if (observed !== expected) throw new Error(`${label} moved from ${expected} to ${observed}.`);
}

function gitText(source, args) {
  return execFileSync("git", args, { cwd: source, encoding: "utf8" });
}

function gitOptional(source, args) {
  const result = spawnSync("git", args, { cwd: source, encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "") : "";
}

function gitSucceeds(source, args) {
  return spawnSync("git", args, { cwd: source, stdio: "ignore" }).status === 0;
}

function gitRun(source, args) {
  execFileSync("git", args, { cwd: source, stdio: "inherit" });
}

function readNul(value) {
  return String(value || "").split("\0").filter(Boolean).sort();
}

function digest(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(serialized).digest("hex");
}

function requireSha(value, label) {
  const normalized = String(value || "").trim();
  if (!SHA_PATTERN.test(normalized)) throw new Error(`${label} must be an exact 40-hex SHA.`);
  return normalized;
}

function requireValue(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readOption(args, name) {
  const prefix = `--${name}=`;
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  try {
    if (!args.includes("--acknowledge-protected-equivalence")) throw new Error("Explicit protected-equivalence acknowledgement is required.");
    const result = dispositionLegacyIntegratedLane({
      sourceWorktree: readOption(args, "source"),
      expectedBranch: readOption(args, "branch"),
      expectedHead: readOption(args, "expected-head"),
      protectedTip: readOption(args, "protected-tip"),
      operatorSessionId: readOption(args, "session") || process.env.AGENTIC_SESSION_ID,
      receiptPath: readOption(args, "receipt"),
    });
    process.stdout.write(`${json ? JSON.stringify(result) : `[legacy-disposition] detached ${result.sourceBranch} at protected ${result.protectedTip.slice(0, 12)}; receipt ${result.receiptPath}`}\n`);
  } catch (error) {
    if (!json) throw error;
    process.stdout.write(`${JSON.stringify({ schema: LEGACY_INTEGRATED_LANE_RESULT_SCHEMA, status: "blocked", message: error?.message || String(error) })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
