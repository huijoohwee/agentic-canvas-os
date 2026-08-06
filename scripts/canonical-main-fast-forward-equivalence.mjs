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

import { textCommandOptions } from "./command-text-options.mjs";
import {
  parsePorcelainV1,
  proveIgnoredStateRetention,
} from "./canonical-main-recovery-evidence.mjs";
import { readTreeBlobEntry } from "./protected-main-path-equivalence-lib.mjs";

const RESULT_SCHEMA = "agentic-canonical-main-fast-forward-equivalence-result/v1";
const JOURNAL_SCHEMA = "agentic-canonical-main-fast-forward-equivalence/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const args = process.argv.slice(2);
const json = args.includes("--json");

try {
  const repositoryOption = readOption("repository");
  const sessionId = readOption("session") || process.env.AGENTIC_SESSION_ID || "";
  const expectedLocalHead = requireSha(readOption("expected-local-head"), "Expected local main HEAD");
  const expectedOriginHead = requireSha(readOption("expected-origin-head"), "Expected origin/main HEAD");
  if (!repositoryOption || !sessionId.trim() || !args.includes("--acknowledge-protected-equivalence")) usage();
  if (expectedLocalHead === expectedOriginHead) throw new Error("Fast-forward equivalence requires distinct local and protected heads.");

  const repository = realpathSync(path.resolve(repositoryOption));
  process.chdir(repository);
  const repoRoot = realpathSync(path.resolve(gitText(["rev-parse", "--show-toplevel"]).trim()));
  if (repository !== repoRoot) throw new Error(`Command must start at the repository root ${repoRoot}.`);
  requirePrimaryCanonicalWorktree(repoRoot);
  gitRun(["fetch", "--no-tags", "origin", "main"]);
  if (gitText(["rev-parse", "origin/main"]).trim() !== expectedOriginHead) {
    throw new Error("Fetched origin/main moved from the exact expected protected head.");
  }
  if (!gitSucceeds(["merge-base", "--is-ancestor", expectedLocalHead, expectedOriginHead])) {
    throw new Error("Protected origin/main is not a fast-forward descendant of the expected local main.");
  }

  const commonDir = realpathSync(path.resolve(repoRoot, gitText(["rev-parse", "--git-common-dir"]).trim()));
  const receiptDir = path.join(commonDir, "agentic-canvas-os", "canonical-main-fast-forward-equivalence");
  mkdirSync(receiptDir, { recursive: true });
  const recoveryId = `reconcile-${digest({ repoRoot, sessionId, expectedLocalHead, expectedOriginHead }).slice(0, 32)}`;
  const journalPath = path.join(receiptDir, `${recoveryId}.json`);
  const lockPath = path.join(commonDir, "agentic-canvas-os", "canonical-main-fast-forward-equivalence.lock");
  const lockFd = acquireLock(lockPath, { sessionId, recoveryId });
  let result;
  try {
    result = reconcile({
      repoRoot,
      sessionId,
      expectedLocalHead,
      expectedOriginHead,
      recoveryId,
      journalPath,
    });
  } finally {
    closeSync(lockFd);
    unlinkSync(lockPath);
  }
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else console.log(`Canonical main reconciled to protected ${result.headSha.slice(0, 12)} (${result.pathCount} equivalent paths).`);
} catch (error) {
  if (!json) throw error;
  process.stdout.write(`${JSON.stringify({
    schema: RESULT_SCHEMA,
    status: "error",
    error: { name: error?.name || "Error", message: error?.message || String(error) },
  })}\n`);
  process.exitCode = 1;
}

function reconcile({ repoRoot, sessionId, expectedLocalHead, expectedOriginHead, recoveryId, journalPath }) {
  const existing = readJournal(journalPath);
  if (existing) requireJournalIdentity(existing, { repoRoot, sessionId, expectedLocalHead, expectedOriginHead, recoveryId });
  assertProtectedHeadStable(expectedOriginHead);
  const branch = gitOptional(["symbolic-ref", "--quiet", "--short", "HEAD"]).trim();
  const head = requireSha(gitText(["rev-parse", "HEAD"]).trim(), "Observed HEAD");
  const mainRef = requireSha(gitText(["rev-parse", "refs/heads/main"]).trim(), "Observed main ref");
  if (branch !== "main" || head !== mainRef || ![expectedLocalHead, expectedOriginHead].includes(head)) {
    throw new Error(`Canonical replay state is invalid (branch=${branch || "detached"}, HEAD=${head}, main=${mainRef}).`);
  }
  if (head === expectedOriginHead && isClean() && existing?.state === "completed") {
    return buildResult(existing, journalPath, true);
  }
  if (head === expectedOriginHead && isClean() && !existing) {
    throw new Error("Canonical main is already protected but has no equivalence receipt.");
  }
  if (head === expectedOriginHead && isClean()) {
    requirePreparedJournal(existing, { expectedLocalHead, expectedOriginHead });
    requireIgnoredRetention(existing, { expectedLocalHead, expectedOriginHead });
    const completed = completeJournal(existing, journalPath);
    return buildResult(completed, journalPath, true);
  }

  let journal = existing;
  if (!journal) {
    if (head !== expectedLocalHead) {
      throw new Error("Initial reconciliation requires an unstaged canonical working tree at the expected local head.");
    }
    const manifest = captureInitialManifest({
      repoRoot,
      expectedLocalHead,
      expectedOriginHead,
    });
    if (manifest.length === 0) throw new Error("No canonical working changes require protected equivalence reconciliation.");
    const ignoredRetention = proveIgnoredStateRetention({
      localHead: expectedLocalHead,
      originHead: expectedOriginHead,
      gitText,
      gitOptional,
    });
    journal = withDigest({
      schema: JOURNAL_SCHEMA,
      state: "prepared",
      recoveryId,
      repository: repoRoot,
      sessionId,
      expectedLocalHead,
      expectedOriginHead,
      expectedLocalTree: requireSha(gitText(["rev-parse", `${expectedLocalHead}^{tree}`]).trim(), "Expected local tree"),
      expectedOriginTree: requireSha(gitText(["rev-parse", `${expectedOriginHead}^{tree}`]).trim(), "Expected origin tree"),
      equivalenceScope: "unstaged-tracked-dirty-paths",
      manifest,
      manifestDigest: digest(manifest),
      protectedAdvancePathCount: splitNul(gitText([
        "diff",
        "--name-only",
        "-z",
        expectedLocalHead,
        expectedOriginHead,
      ])).length,
      ignoredRetention,
      recoveryHandle: `protected-commit:${expectedOriginHead}`,
      preparedAt: new Date().toISOString(),
      completedAt: null,
    });
    writeJournal(journalPath, journal);
  }
  requirePreparedJournal(journal, { expectedLocalHead, expectedOriginHead });
  requirePreparedWorkingState(journal, {
    repoRoot,
    expectedLocalHead,
    expectedOriginHead,
    transition: head === expectedOriginHead,
  });

  if (head === expectedLocalHead) {
    assertProtectedHeadStable(expectedOriginHead);
    gitRun(["update-ref", "refs/heads/main", expectedOriginHead, expectedLocalHead]);
  }
  if (gitText(["rev-parse", "HEAD"]).trim() !== expectedOriginHead) {
    throw new Error("Canonical main ref did not advance to the protected head.");
  }
  requirePreparedWorkingState(journal, {
    repoRoot,
    expectedLocalHead,
    expectedOriginHead,
    transition: true,
  });
  assertProtectedHeadStable(expectedOriginHead);
  gitRun(["read-tree", "--reset", "-u", expectedOriginHead]);
  if (!isClean() || gitText(["rev-parse", "HEAD"]).trim() !== expectedOriginHead) {
    throw new Error("Canonical main did not finish as a clean protected checkout.");
  }
  requireIgnoredRetention(journal, {
    expectedLocalHead,
    expectedOriginHead,
  });
  journal = completeJournal(journal, journalPath);
  return buildResult(journal, journalPath, false);
}

function captureInitialManifest({ repoRoot, expectedLocalHead, expectedOriginHead }) {
  assertNoConflictsOrUntracked();
  assertIndexMatchesExpectedLocal(expectedLocalHead);
  const records = parsePorcelainV1(gitText(["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
  for (const record of records) {
    if (record.status[0] !== " ") {
      throw new Error(`Canonical equivalence reconciliation rejects staged state ${record.status} ${record.path}.`);
    }
    if (!["M", "T"].includes(record.status[1])) {
      const kind = record.status[1] === "D" ? "deleted" : "unsupported";
      throw new Error(`Canonical equivalence reconciliation rejects ${kind} tracked path ${record.path}.`);
    }
  }
  const paths = readDirtyPaths();
  const statusPaths = records.map(record => record.path).sort();
  if (canonicalJson(paths) !== canonicalJson(statusPaths)) {
    throw new Error("Canonical unstaged path inventory disagrees with porcelain status.");
  }
  return createManifest({ repoRoot, paths, expectedLocalHead, expectedOriginHead });
}

function captureTransitionManifest({ repoRoot, expectedLocalHead, expectedOriginHead }) {
  assertNoConflictsOrUntracked();
  assertIndexMatchesExpectedLocal(expectedLocalHead);
  return createManifest({
    repoRoot,
    paths: readDirtyPaths(),
    expectedLocalHead,
    expectedOriginHead,
  });
}

function createManifest({ repoRoot, paths, expectedLocalHead, expectedOriginHead }) {
  return paths.map(relativePath => {
    const base = readTreeBlob(expectedLocalHead, relativePath, "Expected local");
    const target = readTreeBlob(expectedOriginHead, relativePath, "Protected target");
    const workingMode = readWorkingMode(repoRoot, relativePath);
    if (workingMode !== target.mode) {
      throw new Error(
        `Working mode ${workingMode} differs from protected target mode ${target.mode} for ${relativePath}.`,
      );
    }
    const workingBlob = requireSha(gitText([
      "hash-object",
      `--path=${relativePath}`,
      "--",
      relativePath,
    ]).trim(), `Working blob for ${relativePath}`);
    if (workingBlob !== target.blob) {
      throw new Error(`Working blob differs from protected target for ${relativePath}.`);
    }
    return Object.freeze({
      path: relativePath,
      baseMode: base.mode,
      baseBlob: base.blob,
      mode: target.mode,
      blob: target.blob,
    });
  });
}

function assertNoConflictsOrUntracked() {
  if (gitText(["diff", "--name-only", "--diff-filter=U"]).trim() || gitText(["ls-files", "-u"]).trim()) {
    throw new Error("Canonical equivalence reconciliation rejects unmerged paths.");
  }
  const untracked = splitNul(gitText(["ls-files", "--others", "--exclude-standard", "-z"]));
  if (untracked.length) {
    throw new Error(`Canonical equivalence reconciliation rejects untracked path ${untracked[0]}.`);
  }
}

function assertIndexMatchesExpectedLocal(expectedLocalHead) {
  if (!gitSucceeds(["diff", "--cached", "--quiet", expectedLocalHead, "--"])) {
    throw new Error("Canonical equivalence reconciliation rejects staged state against the expected local head.");
  }
}

function assertProtectedHeadStable(expectedOriginHead) {
  if (gitText(["rev-parse", "origin/main"]).trim() !== expectedOriginHead) {
    throw new Error("Fetched origin/main moved from the exact expected protected head.");
  }
}

function readDirtyPaths() {
  return splitNul(gitText(["diff", "--name-only", "-z", "--"])).sort();
}

function readTreeBlob(treeish, relativePath, label) {
  const entry = readTreeBlobEntry({
    gitText,
    treeish,
    relativePath,
    label,
  });
  return Object.freeze({ mode: entry.mode, blob: entry.blobSha });
}

function readWorkingMode(repoRoot, relativePath) {
  let stats;
  try {
    stats = lstatSync(path.join(repoRoot, relativePath));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Canonical equivalence reconciliation rejects deleted tracked path ${relativePath}.`);
    }
    throw error;
  }
  if (stats.isSymbolicLink()) return "120000";
  if (!stats.isFile()) {
    throw new Error(`Canonical equivalence reconciliation rejects non-file tracked path ${relativePath}.`);
  }
  return stats.mode & 0o111 ? "100755" : "100644";
}

function requirePreparedJournal(journal, { expectedLocalHead, expectedOriginHead }) {
  if (!journal || !["prepared", "completed"].includes(journal.state)) {
    throw new Error("Canonical equivalence journal does not contain a replayable prepared state.");
  }
  if (journal.equivalenceScope !== "unstaged-tracked-dirty-paths" ||
      !Array.isArray(journal.manifest) ||
      journal.manifest.length === 0 ||
      journal.manifestDigest !== digest(journal.manifest) ||
      journal.expectedLocalTree !== gitText(["rev-parse", `${expectedLocalHead}^{tree}`]).trim() ||
      journal.expectedOriginTree !== gitText(["rev-parse", `${expectedOriginHead}^{tree}`]).trim() ||
      !journal.ignoredRetention) {
    throw new Error("Canonical equivalence journal lacks valid path-scoped protected evidence.");
  }
}

function requirePreparedWorkingState(journal, {
  repoRoot,
  expectedLocalHead,
  expectedOriginHead,
  transition,
}) {
  const manifest = transition
    ? captureTransitionManifest({ repoRoot, expectedLocalHead, expectedOriginHead })
    : captureInitialManifest({ repoRoot, expectedLocalHead, expectedOriginHead });
  if (digest(manifest) !== journal.manifestDigest) {
    throw new Error("Canonical working state drifted from the prepared equivalence receipt.");
  }
  requireIgnoredRetention(journal, { expectedLocalHead, expectedOriginHead });
}

function requireIgnoredRetention(journal, { expectedLocalHead, expectedOriginHead }) {
  const observed = proveIgnoredStateRetention({
    localHead: expectedLocalHead,
    originHead: expectedOriginHead,
    gitText,
    gitOptional,
  });
  if (canonicalJson(observed) !== canonicalJson(journal.ignoredRetention)) {
    throw new Error("Ignored canonical state drifted from the prepared equivalence receipt.");
  }
}

function completeJournal(journal, journalPath) {
  const completed = withDigest({
    ...withoutDigest(journal),
    state: "completed",
    completedAt: journal.completedAt || new Date().toISOString(),
  });
  writeJournal(journalPath, completed);
  return completed;
}

function requirePrimaryCanonicalWorktree(repoRoot) {
  const records = splitNul(gitText(["worktree", "list", "--porcelain", "-z"]));
  const firstPath = records.find(line => line.startsWith("worktree "))?.slice("worktree ".length);
  if (!firstPath || realpathSync(firstPath) !== repoRoot) throw new Error("Command is restricted to the primary registered worktree.");
  const gitDir = realpathSync(path.resolve(repoRoot, gitText(["rev-parse", "--git-dir"]).trim()));
  const commonDir = realpathSync(path.resolve(repoRoot, gitText(["rev-parse", "--git-common-dir"]).trim()));
  if (gitDir !== commonDir) throw new Error("Command is restricted to the live primary worktree.");
}

function acquireLock(lockPath, evidence) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  let fd;
  try {
    fd = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`Canonical equivalence operation lock is already held: ${lockPath}`);
    throw error;
  }
  writeFileSync(fd, `${JSON.stringify({ ...evidence, pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
  return fd;
}

function readJournal(journalPath) {
  if (!existsSync(journalPath)) return null;
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  if (journal.schema !== JOURNAL_SCHEMA || journal.receiptDigest !== digest(withoutDigest(journal))) {
    throw new Error("Canonical equivalence journal is malformed or digest-invalid.");
  }
  return journal;
}

function requireJournalIdentity(journal, expected) {
  for (const [key, value] of Object.entries(expected)) {
    const journalKey = key === "repoRoot" ? "repository" : key;
    if (journal[journalKey] !== value) throw new Error(`Canonical equivalence journal ${key} does not match this invocation.`);
  }
}

function writeJournal(journalPath, journal) {
  const temporary = `${journalPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, journalPath);
}

function buildResult(journal, journalPath, replayed) {
  return Object.freeze({
    schema: RESULT_SCHEMA,
    status: "completed",
    replayed,
    recoveryId: journal.recoveryId,
    repository: journal.repository,
    headSha: journal.expectedOriginHead,
    originHeadSha: journal.expectedOriginHead,
    priorHeadSha: journal.expectedLocalHead,
    manifestDigest: journal.manifestDigest,
    pathCount: journal.manifest.length,
    protectedAdvancePathCount: journal.protectedAdvancePathCount,
    recoveryHandle: journal.recoveryHandle,
    receiptDigest: journal.receiptDigest,
    receiptPath: journalPath,
  });
}

function isClean() {
  return gitText(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).length === 0;
}

function gitText(gitArgs) {
  return execFileSync("git", gitArgs, textCommandOptions());
}

function gitOptional(gitArgs) {
  const result = spawnSync("git", gitArgs, textCommandOptions());
  return result.status === 0 ? result.stdout : "";
}

function gitSucceeds(gitArgs) {
  return spawnSync("git", gitArgs, { stdio: "ignore" }).status === 0;
}

function gitRun(gitArgs) {
  const result = spawnSync("git", gitArgs, { stdio: json ? ["ignore", "ignore", "inherit"] : "inherit" });
  if (result.status !== 0) throw new Error(`git ${gitArgs.join(" ")} failed`);
}

function splitNul(value) {
  return String(value || "").split("\0").filter(Boolean);
}

function readOption(name) {
  const prefix = `--${name}=`;
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) throw new Error(`${label} must be an exact 40-character Git object id.`);
  return value;
}

function withDigest(value) {
  return Object.freeze({ ...value, receiptDigest: digest(value) });
}

function withoutDigest(value) {
  const { receiptDigest: _receiptDigest, ...rest } = value;
  return rest;
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function usage() {
  throw new Error(
    "Usage: node scripts/canonical-main-fast-forward-equivalence.mjs " +
    "--repository=<primary-main-worktree> --session=<stable-session-id> " +
    "--expected-local-head=<sha> --expected-origin-head=<sha> " +
    "--acknowledge-protected-equivalence [--json]",
  );
}
