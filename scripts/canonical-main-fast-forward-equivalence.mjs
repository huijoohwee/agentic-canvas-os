#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
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

  assertNoConflictsOrUntracked();
  if (!gitSucceeds(["diff", "--quiet", expectedOriginHead, "--"])) {
    throw new Error("Canonical working bytes do not exactly match protected origin/main.");
  }
  const manifest = createManifest(expectedLocalHead, expectedOriginHead);
  if (manifest.length === 0) throw new Error("No canonical working changes require protected equivalence reconciliation.");
  const manifestDigest = digest(manifest);
  let journal = existing;
  if (!journal) {
    if (head !== expectedLocalHead || !gitSucceeds(["diff", "--cached", "--quiet", expectedLocalHead, "--"])) {
      throw new Error("Initial reconciliation requires an unstaged canonical working tree at the expected local head.");
    }
    journal = withDigest({
      schema: JOURNAL_SCHEMA,
      state: "prepared",
      recoveryId,
      repository: repoRoot,
      sessionId,
      expectedLocalHead,
      expectedOriginHead,
      manifest,
      manifestDigest,
      recoveryHandle: `protected-commit:${expectedOriginHead}`,
      preparedAt: new Date().toISOString(),
      completedAt: null,
    });
    writeJournal(journalPath, journal);
  } else if (journal.manifestDigest !== manifestDigest) {
    throw new Error("Canonical working state drifted from the prepared equivalence receipt.");
  }

  if (head === expectedLocalHead) {
    gitRun(["update-ref", "refs/heads/main", expectedOriginHead, expectedLocalHead]);
  }
  if (gitText(["rev-parse", "HEAD"]).trim() !== expectedOriginHead) {
    throw new Error("Canonical main ref did not advance to the protected head.");
  }
  if (!gitSucceeds(["diff", "--quiet", expectedOriginHead, "--"])) {
    throw new Error("Canonical working bytes drifted before index reconciliation.");
  }
  gitRun(["read-tree", "--reset", "-u", expectedOriginHead]);
  if (!isClean() || gitText(["rev-parse", "HEAD"]).trim() !== expectedOriginHead) {
    throw new Error("Canonical main did not finish as a clean protected checkout.");
  }
  journal = withDigest({
    ...withoutDigest(journal),
    state: "completed",
    completedAt: journal.completedAt || new Date().toISOString(),
  });
  writeJournal(journalPath, journal);
  return buildResult(journal, journalPath, false);
}

function createManifest(localHead, originHead) {
  const paths = splitNul(gitText(["diff", "--name-only", "-z", localHead, "--"]));
  return paths.sort().map(relativePath => {
    const target = gitText(["ls-tree", "-z", originHead, "--", relativePath]);
    const match = /^([0-7]{6}) (blob) ([0-9a-f]{40})\t/.exec(target);
    if (!match) throw new Error(`Protected target does not contain tracked blob ${relativePath}.`);
    const workingBlob = gitText(["hash-object", "--", relativePath]).trim();
    if (workingBlob !== match[3]) throw new Error(`Working blob differs from protected target for ${relativePath}.`);
    return Object.freeze({ path: relativePath, mode: match[1], blob: match[3] });
  });
}

function assertNoConflictsOrUntracked() {
  if (gitText(["diff", "--name-only", "--diff-filter=U"]).trim() || gitText(["ls-files", "-u"]).trim()) {
    throw new Error("Canonical equivalence reconciliation rejects unmerged paths.");
  }
  for (const entry of splitNul(gitText(["status", "--porcelain=v1", "-z", "--untracked-files=all"]))) {
    const status = entry.slice(0, 2);
    if (status === "??") throw new Error(`Canonical equivalence reconciliation rejects untracked path ${entry.slice(3)}.`);
    if (status[0] !== " ") throw new Error(`Canonical equivalence reconciliation rejects staged state ${entry}.`);
  }
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
