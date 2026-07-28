#!/usr/bin/env node

/**
 * Single entry point for every Git hook surface and for the git wrapper.
 * Hooks stay thin shell scripts; all decisions live in the owner library so they
 * are testable without spawning git.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertNonDestructiveOperation,
  assertRefTransactionSafety,
  assertWorkspaceLaneIsolation,
  buildEnforcementCoverageReport,
  classifyGitOperation,
  isZeroSha,
} from "./workspace-parallelism-lib.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const BYPASS_ENV = "AGENTIC_WORKSPACE_GUARD_BYPASS";
const BYPASS_TOKEN = "i-accept-destroying-unrecoverable-work";

function git(args, { cwd = process.cwd(), spawn = spawnSync } = {}) {
  const result = spawn("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
}

export function readLane({ cwd = process.cwd(), env = process.env, spawn = spawnSync } = {}) {
  const top = git(["rev-parse", "--show-toplevel"], { cwd, spawn });
  if (top.status !== 0) throw new Error(`Not a Git worktree: ${cwd}`);
  const worktree = top.stdout.trim();
  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, spawn });
  const repositoryRoot = commonDir.status === 0
    ? path.dirname(commonDir.stdout.trim())
    : worktree;
  const branch = git(["symbolic-ref", "--quiet", "HEAD"], { cwd, spawn });
  const status = git(["status", "--porcelain=v1", "--untracked-files=normal"], { cwd, spawn });
  const rows = status.stdout.split(/\r?\n/).filter(Boolean);
  const untrackedPaths = rows.filter((row) => row.startsWith("??")).length;
  const branchRef = branch.status === 0 ? branch.stdout.trim() : null;
  const recovery = git(["for-each-ref", "--format=%(refname)", "refs/heads/recovery", "refs/tags/recovery"], { cwd, spawn });
  const recoveryRefs = recovery.status === 0 ? recovery.stdout.split(/\r?\n/).filter(Boolean) : [];

  return {
    lane: {
      repository: path.basename(repositoryRoot),
      worktree,
      branch: branchRef,
      session: String(env.AGENTIC_SESSION_ID || "local").trim() || "local",
      scope: branchRef ? branchRef.split("/").slice(-1)[0] : null,
      dirtyTrackedPaths: rows.length - untrackedPaths,
      untrackedPaths,
      recoveryRef: recoveryRefs[0] || null,
    },
    recoveryRefs,
  };
}

export function readSiblingLanes({ cwd = process.cwd(), env = process.env, spawn = spawnSync } = {}) {
  const listed = git(["worktree", "list", "--porcelain"], { cwd, spawn });
  if (listed.status !== 0) return [];
  const session = String(env.AGENTIC_SESSION_ID || "local").trim() || "local";
  const paths = listed.stdout.split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim());
  return paths.map((worktree) => {
    const status = git(["status", "--porcelain=v1", "--untracked-files=normal"], { cwd: worktree, spawn });
    const rows = status.stdout.split(/\r?\n/).filter(Boolean);
    const untrackedPaths = rows.filter((row) => row.startsWith("??")).length;
    const branch = git(["symbolic-ref", "--quiet", "HEAD"], { cwd: worktree, spawn });
    const branchRef = branch.status === 0 ? branch.stdout.trim() : null;
    return {
      repository: path.basename(path.dirname(worktree)) === ".git-worktrees"
        ? path.basename(worktree)
        : path.basename(worktree),
      worktree,
      branch: branchRef,
      session: path.normalize(worktree) === path.normalize(git(["rev-parse", "--show-toplevel"], { cwd, spawn }).stdout.trim())
        ? session
        : `foreign:${path.basename(worktree)}`,
      scope: branchRef ? branchRef.split("/").slice(-1)[0] : null,
      dirtyTrackedPaths: rows.length - untrackedPaths,
      untrackedPaths,
      recoveryRef: null,
    };
  });
}

function bypassRequested(env) {
  return String(env[BYPASS_ENV] || "").trim() === BYPASS_TOKEN;
}

function refuse(message, { env = process.env, write = (t) => process.stderr.write(t) } = {}) {
  if (bypassRequested(env)) {
    write(`[workspace-guard] BYPASS ACTIVE, proceeding despite: ${message}\n`);
    return 0;
  }
  write(`[workspace-guard] ${message}\n`);
  write(`[workspace-guard] this is refused to protect work another session may still hold\n`);
  write(`[workspace-guard] commit or bundle the work, or set ${BYPASS_ENV}=${BYPASS_TOKEN} to override\n`);
  return 1;
}

export function runPreCommit({ cwd = process.cwd(), env = process.env, spawn = spawnSync, write } = {}) {
  const lanes = readSiblingLanes({ cwd, env, spawn });
  if (lanes.length > 0) {
    try {
      assertWorkspaceLaneIsolation(lanes);
    } catch (error) {
      return refuse(error instanceof Error ? error.message : String(error), { env, write });
    }
  }
  return 0;
}

export function runPrePush({ cwd = process.cwd(), env = process.env, spawn = spawnSync, stdin = "", write } = {}) {
  const { lane, recoveryRefs } = readLane({ cwd, env, spawn });
  const updates = stdin.split(/\r?\n/).filter(Boolean).map((line) => {
    const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    return { ref: remoteRef || localRef, oldSha: remoteSha, newSha: localSha, localRef };
  });
  if (updates.length === 0) return 0;

  const isAncestor = (from, to) => (
    git(["merge-base", "--is-ancestor", from, to], { cwd, spawn }).status === 0
  );

  const deletions = updates.filter((update) => isZeroSha(update.newSha));
  const forced = updates.filter((update) => (
    !isZeroSha(update.newSha) && !isZeroSha(update.oldSha) && !isAncestor(update.oldSha, update.newSha)
  ));
  if (deletions.length === 0 && forced.length === 0) return 0;

  try {
    assertRefTransactionSafety({
      updates,
      lane,
      session: lane.session,
      refs: recoveryRefs,
      isAncestor,
    });
    return 0;
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error), { env, write });
  }
}

export function runReferenceTransaction({ cwd = process.cwd(), env = process.env, spawn = spawnSync, state = "", stdin = "", write } = {}) {
  if (state !== "prepared") return 0;
  const updates = stdin.split(/\r?\n/).filter(Boolean).map((line) => {
    const [oldSha, newSha, ref] = line.trim().split(/\s+/);
    return { ref, oldSha, newSha };
  });
  const relevant = updates.filter((update) => (
    typeof update.ref === "string" && (update.ref.startsWith("refs/heads/") || update.ref === "HEAD")
  ));
  if (relevant.length === 0) return 0;

  const isAncestor = (from, to) => (
    git(["merge-base", "--is-ancestor", from, to], { cwd, spawn }).status === 0
  );
  const destructive = relevant.filter((update) => (
    isZeroSha(update.newSha) || (!isZeroSha(update.oldSha) && !isAncestor(update.oldSha, update.newSha))
  ));
  if (destructive.length === 0) return 0;

  const { lane, recoveryRefs } = readLane({ cwd, env, spawn });
  try {
    assertRefTransactionSafety({
      updates: destructive,
      lane,
      session: lane.session,
      refs: recoveryRefs,
      isAncestor,
    });
    return 0;
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error), { env, write });
  }
}

export function runOperationReview({ argv, cwd = process.cwd(), env = process.env, spawn = spawnSync, write } = {}) {
  const classification = classifyGitOperation(argv);
  if (!classification.destructive) return 0;
  const { lane, recoveryRefs } = readLane({ cwd, env, spawn });
  const lanes = readSiblingLanes({ cwd, env, spawn });
  try {
    assertNonDestructiveOperation({
      operation: argv,
      lane: { ...lane, recoveryRef: recoveryRefs[0] || null },
      session: lane.session,
      lanes: lanes.length > 0 ? lanes : [lane],
    });
    return 0;
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error), { env, write });
  }
}

export function runCoverage({ write = (t) => process.stdout.write(t) } = {}) {
  const coverage = buildEnforcementCoverageReport();
  write(`${JSON.stringify(coverage, null, 2)}\n`);
  return 0;
}

export function main(argv = process.argv.slice(2), { env = process.env, readStdin } = {}) {
  const [surface, ...rest] = argv;
  const stdin = typeof readStdin === "function" ? readStdin() : readAllStdin();
  switch (surface) {
    case "pre-commit": return runPreCommit({ env });
    case "pre-push": return runPrePush({ env, stdin });
    case "reference-transaction": return runReferenceTransaction({ env, state: rest[0] || "", stdin });
    case "review": return runOperationReview({ argv: rest, env });
    case "coverage": return runCoverage();
    default:
      process.stderr.write(`[workspace-guard] unknown surface ${surface || "(none)"}\n`);
      return 1;
  }
}

function readAllStdin() {
  if (process.stdin.isTTY) return "";
  try {
    return String(readFileSync(0, "utf8"));
  } catch {
    return "";
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[workspace-guard] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
