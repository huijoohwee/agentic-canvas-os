#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildWorkspaceParallelismReport,
  classifyGitOperation,
  assertNonDestructiveOperation,
  assertWorkspaceReconciliationAdmission,
} from "./workspace-parallelism-lib.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultAgenticCanvasOsRoot = path.resolve(path.dirname(scriptPath), "..");

export function resolveWorkspaceRoot({
  agenticCanvasOsRoot = defaultAgenticCanvasOsRoot,
  env = process.env,
  spawn = spawnSync,
} = {}) {
  const configured = String(env.AGENTIC_WORKSPACE_ROOT || "").trim();
  if (configured) return path.resolve(configured);
  const canonicalRoot = resolveCanonicalWorktreeRoot({ agenticCanvasOsRoot, spawn });
  return path.dirname(canonicalRoot || agenticCanvasOsRoot);
}

function resolveCanonicalWorktreeRoot({ agenticCanvasOsRoot, spawn }) {
  const listing = git(agenticCanvasOsRoot, ["worktree", "list", "--porcelain"], spawn);
  if (listing === null) return null;
  let worktree = null;
  for (const line of listing.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) worktree = line.slice("worktree ".length).trim();
    if (worktree && line === "branch refs/heads/main") return worktree;
  }
  return null;
}

export function discoverRepositories({
  workspaceRoot,
  listEntries = (dir) => readdirSync(dir, { withFileTypes: true }),
  isDirectory = (target) => existsSync(target) && statSync(target).isDirectory(),
}) {
  return listEntries(workspaceRoot)
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(workspaceRoot, entry.name))
    .filter((candidate) => isDirectory(path.join(candidate, ".git")) || existsSync(path.join(candidate, ".git")))
    .sort();
}

function git(repository, args, spawn) {
  const result = spawn("git", args, { cwd: repository, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) return null;
  return String(result.stdout || "");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function splitNullSeparated(value) {
  return String(value || "").split("\0").filter(Boolean).sort();
}

function captureLaneEvidence({ worktree, spawn }) {
  const trackedPatch = git(worktree, ["diff", "--no-ext-diff", "--binary", "HEAD"], spawn) || "";
  const trackedPaths = splitNullSeparated(git(worktree, ["diff", "--name-only", "-z", "HEAD"], spawn));
  const untrackedPaths = splitNullSeparated(git(worktree, ["ls-files", "--others", "--exclude-standard", "-z"], spawn));
  const untrackedObjects = untrackedPaths.map((file) => ({
    file,
    objectId: (git(worktree, ["hash-object", "--no-filters", "--", file], spawn) || "").trim(),
  }));
  const paths = [...new Set([...trackedPaths, ...untrackedPaths])].sort();
  return Object.freeze({
    stateDigest: digest(JSON.stringify({ trackedPatch, untrackedObjects })),
    writeSetDigest: digest(JSON.stringify(paths)),
  });
}

export function readRepositoryLanes({ repository, session, spawn = spawnSync }) {
  const worktreeList = git(repository, ["worktree", "list", "--porcelain"], spawn);
  if (worktreeList === null) return [];

  const lanes = [];
  let current = null;
  for (const line of worktreeList.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) lanes.push(current);
      current = { worktree: line.slice("worktree ".length).trim(), branch: null };
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).trim();
    }
  }
  if (current) lanes.push(current);

  return lanes.map((lane) => {
    const status = git(lane.worktree, ["status", "--porcelain=v1", "--untracked-files=normal"], spawn) || "";
    const rows = status.split(/\r?\n/).filter(Boolean);
    const untrackedPaths = rows.filter((row) => row.startsWith("??")).length;
    const head = (git(lane.worktree, ["rev-parse", "--abbrev-ref", "HEAD"], spawn) || "").trim();
    const evidence = captureLaneEvidence({ worktree: lane.worktree, spawn });
    return {
      repository: path.basename(repository),
      worktree: lane.worktree,
      branch: lane.branch || (head && head !== "HEAD" ? `refs/heads/${head}` : null),
      session: `${session}:${path.basename(repository)}:${path.basename(lane.worktree)}`,
      scope: lane.branch ? lane.branch.split("/").slice(-1)[0] : null,
      dirtyTrackedPaths: rows.length - untrackedPaths,
      untrackedPaths,
      recoveryRef: null,
      ...evidence,
    };
  });
}

export function runWorkspaceParallelismGuard({
  agenticCanvasOsRoot = defaultAgenticCanvasOsRoot,
  env = process.env,
  spawn = spawnSync,
  argv = process.argv.slice(2),
  write = (text) => process.stdout.write(text),
} = {}) {
  const workspaceRoot = resolveWorkspaceRoot({ agenticCanvasOsRoot, env, spawn });
  const session = String(env.AGENTIC_SESSION_ID || "local").trim() || "local";
  const json = argv.includes("--json");
  const operationIndex = argv.findIndex((token) => token === "--operation");
  const operation = operationIndex >= 0 ? argv[operationIndex + 1] : null;
  const receiptIndex = argv.findIndex((token) => token === "--reconciliation-receipt");
  const receiptPath = receiptIndex >= 0 ? argv[receiptIndex + 1] : null;

  const repositories = discoverRepositories({ workspaceRoot });
  const lanes = repositories.flatMap((repository) => readRepositoryLanes({ repository, session, spawn }));
  const report = buildWorkspaceParallelismReport({ workspaceRoot, lanes });

  if (operation) {
    const classification = classifyGitOperation(operation);
    const target = lanes.find((lane) => path.normalize(lane.worktree) === path.normalize(process.cwd()))
      || lanes[0];
    if (!target) throw new Error("No lane resolves for the requested operation.");
    const decision = assertNonDestructiveOperation({
      operation,
      lane: target,
      session: target.session,
      lanes,
    });
    write(`${json ? JSON.stringify({ ...report, decision }, null, 2) : renderDecision(decision)}\n`);
    return { report, decision, classification };
  }

  const receipt = receiptPath ? JSON.parse(readFileSync(path.resolve(receiptPath), "utf8")) : null;
  const reconciliationAdmission = receipt
    ? assertWorkspaceReconciliationAdmission({ report, receipt })
    : null;
  const admittedReport = reconciliationAdmission ? { ...report, reconciliationAdmission } : report;
  write(`${json ? JSON.stringify(admittedReport, null, 2) : renderReport(admittedReport)}\n`);
  if (!report.ready && !reconciliationAdmission) {
    throw new Error(`${report.unrecoverableLanes.length} lane(s) hold work that a destructive operation would not be able to restore.`);
  }
  return { report: admittedReport, decision: null, classification: null };
}

function renderReport(report) {
  const lines = [
    `[workspace-parallelism] root ${report.workspaceRoot}`,
    `[workspace-parallelism] repositories ${report.repositories.length} lanes ${report.parallelLanes} sessions ${report.sessions.length}`,
  ];
  for (const lane of report.lanes) {
    lines.push(`[workspace-parallelism] lane ${lane.repository} ${lane.branch || "detached"} dirty=${lane.dirtyTrackedPaths} untracked=${lane.untrackedPaths}`);
  }
  for (const risk of report.unrecoverableLanes) {
    lines.push(`[workspace-parallelism] at-risk ${risk.lane} dirty=${risk.dirtyTrackedPaths} untracked=${risk.untrackedPaths} recovery=${risk.recoveryRef || "none"}`);
  }
  if (report.reconciliationAdmission) {
    lines.push(`[workspace-parallelism] ${report.reconciliationAdmission.decision} retained=${report.reconciliationAdmission.retained.length}`);
  }
  lines.push(`[workspace-parallelism] ${report.ready ? "ok" : "blocked"}`);
  return lines.join("\n");
}

function renderDecision(decision) {
  return `[workspace-parallelism] ${decision.decision} ${decision.operation} on ${decision.lane}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    runWorkspaceParallelismGuard();
  } catch (error) {
    process.stderr.write(`[workspace-parallelism] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
