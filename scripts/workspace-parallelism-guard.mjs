#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildWorkspaceParallelismReport,
  classifyGitOperation,
  assertNonDestructiveOperation,
} from "./workspace-parallelism-lib.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultAgenticCanvasOsRoot = path.resolve(path.dirname(scriptPath), "..");

export function resolveWorkspaceRoot({
  agenticCanvasOsRoot = defaultAgenticCanvasOsRoot,
  env = process.env,
} = {}) {
  const configured = String(env.AGENTIC_WORKSPACE_ROOT || "").trim();
  return configured ? path.resolve(configured) : path.resolve(agenticCanvasOsRoot, "..");
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
    return {
      repository: path.basename(repository),
      worktree: lane.worktree,
      branch: lane.branch || (head && head !== "HEAD" ? `refs/heads/${head}` : null),
      session: `${session}:${path.basename(repository)}:${path.basename(lane.worktree)}`,
      scope: lane.branch ? lane.branch.split("/").slice(-1)[0] : null,
      dirtyTrackedPaths: rows.length - untrackedPaths,
      untrackedPaths,
      recoveryRef: null,
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
  const workspaceRoot = resolveWorkspaceRoot({ agenticCanvasOsRoot, env });
  const session = String(env.AGENTIC_SESSION_ID || "local").trim() || "local";
  const json = argv.includes("--json");
  const operationIndex = argv.findIndex((token) => token === "--operation");
  const operation = operationIndex >= 0 ? argv[operationIndex + 1] : null;

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

  write(`${json ? JSON.stringify(report, null, 2) : renderReport(report)}\n`);
  if (!report.ready) {
    throw new Error(`${report.unrecoverableLanes.length} lane(s) hold work that a destructive operation would not be able to restore.`);
  }
  return { report, decision: null, classification: null };
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
