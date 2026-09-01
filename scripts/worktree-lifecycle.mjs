#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  dirtyTracked,
  fetch as fetchRemote,
  headSha,
  repoRoot,
  untrackedPaths,
  worktrees,
} from "agentic-os/src/git.mjs";
import { parseLaneRef } from "agentic-os/src/lane-id.mjs";
import { load as loadLaneStore, remove as removeLaneRecord } from "agentic-os/src/lane-records.mjs";
import { integrationProof } from "agentic-os/src/patch-identity.mjs";
import {
  PROTECTED_REF,
  retire,
  staleWorktrees,
} from "agentic-os/src/worktree.mjs";

const SAFE_LANE_STATES = new Set(["planned", "active", "published", "queued", "integrated"]);

export function buildLifecycleReport({ repository } = {}) {
  const invocationRoot = repoRoot(path.resolve(repository || process.cwd()));
  const registered = worktrees(invocationRoot);
  const canonical = requireCanonicalWorktree(registered);
  const laneStore = loadLaneStore(canonical.path);
  const worktreeReports = registered.map(entry => inspectRegisteredWorktree({
    entry,
    canonicalPath: canonical.path,
    laneStore,
  }));
  const stale = staleWorktrees(canonical.path).map(entry => entry.path);
  return {
    schema: "agentic-os-worktree-lifecycle-compatibility/v1",
    repository: canonical.path,
    canonicalSha: headSha(PROTECTED_REF, canonical.path),
    status: stale.length === 0 && worktreeReports.every(item => item.safe)
      ? "ready"
      : "attention-required",
    worktrees: worktreeReports,
    staleRegistrations: stale,
  };
}

export function cleanupIntegratedLane({ repository, target } = {}) {
  if (!target) throw new Error("ADLC cleanup requires --worktree=<exact-lane-worktree>.");
  const invocationRoot = repoRoot(path.resolve(repository || process.cwd()));
  const registered = worktrees(invocationRoot);
  const canonical = requireCanonicalWorktree(registered);
  const normalizedTarget = path.resolve(target);
  const matches = registered.filter(entry => path.resolve(entry.path) === normalizedTarget);
  if (matches.length !== 1) {
    throw new Error(`ADLC cleanup requires one registered exact target: ${normalizedTarget}`);
  }
  const [candidate] = matches;
  if (path.resolve(candidate.path) === path.resolve(canonical.path)) {
    throw new Error("ADLC cleanup refuses the canonical main worktree.");
  }
  const identity = parseLaneRef(candidate.branch);
  if (!identity) {
    throw new Error(
      "ADLC cleanup supports only an attached agent/<device>/<scope> lane; "
        + `received ${candidate.branch || "detached HEAD"}.`,
    );
  }
  if (dirtyTracked(candidate.path) || untrackedPaths(candidate.path).length > 0) {
    throw new Error(`ADLC cleanup refuses dirty or untracked authored bytes: ${normalizedTarget}`);
  }
  const checkedOutHead = headSha("HEAD", candidate.path);
  const branchHead = headSha(candidate.branch, canonical.path);
  if (!checkedOutHead || checkedOutHead !== branchHead) {
    throw new Error(`ADLC cleanup target is not at the exact ${candidate.branch} head.`);
  }

  fetchRemote("origin", canonical.path);
  const proof = integrationProof(PROTECTED_REF, candidate.branch, { cwd: canonical.path });
  if (!proof) {
    throw new Error(
      `ADLC cleanup has no integration proof for ${candidate.branch} in ${PROTECTED_REF}.`,
    );
  }

  const removed = retire(candidate.branch, { cwd: canonical.path });
  removeLaneRecord(candidate.branch, canonical.path);
  const registeredAfter = worktrees(canonical.path)
    .some(entry => path.resolve(entry.path) === normalizedTarget);
  const pathPresentAfter = existsSync(normalizedTarget);
  const branchPresentAfter = Boolean(headSha(`refs/heads/${candidate.branch}`, canonical.path));
  if (registeredAfter || pathPresentAfter || branchPresentAfter) {
    throw new Error(`ADLC cleanup did not prove exact local lane retirement: ${normalizedTarget}`);
  }
  return {
    schema: "agentic-os-worktree-cleanup-result/v1",
    status: "cleaned",
    repository: canonical.path,
    canonicalSha: headSha(PROTECTED_REF, canonical.path),
    target: normalizedTarget,
    branch: candidate.branch,
    device: identity.device,
    scope: identity.scope,
    proof,
    removed,
    registeredAfter: false,
    pathPresentAfter: false,
    branchPresentAfter: false,
  };
}

function inspectRegisteredWorktree({ entry, canonicalPath, laneStore }) {
  const normalizedPath = path.resolve(entry.path);
  if (!existsSync(normalizedPath)) {
    return {
      path: normalizedPath,
      branch: entry.branch,
      state: "blocked-stale-registration",
      safe: false,
    };
  }
  const trackedDirty = dirtyTracked(normalizedPath);
  const ownedUntracked = untrackedPaths(normalizedPath);
  const head = headSha("HEAD", normalizedPath);
  if (normalizedPath === path.resolve(canonicalPath)) {
    const canonicalSha = headSha(PROTECTED_REF, canonicalPath);
    const safe = !trackedDirty && ownedUntracked.length === 0 && head === canonicalSha;
    return {
      path: normalizedPath,
      head,
      branch: entry.branch,
      state: safe ? "canonical" : "blocked-canonical",
      safe,
      trackedDirty,
      untracked: ownedUntracked,
    };
  }
  const identity = parseLaneRef(entry.branch);
  if (!identity) {
    return {
      path: normalizedPath,
      head,
      branch: entry.branch,
      state: "review-required-legacy-lane",
      safe: false,
      trackedDirty,
      untracked: ownedUntracked,
    };
  }
  const recordedState = laneStore.lanes?.[entry.branch]?.state || "active";
  const safe = !trackedDirty
    && ownedUntracked.length === 0
    && SAFE_LANE_STATES.has(recordedState);
  return {
    path: normalizedPath,
    head,
    branch: entry.branch,
    state: safe ? recordedState : trackedDirty || ownedUntracked.length > 0
      ? "blocked-dirty"
      : "review-required",
    safe,
    trackedDirty,
    untracked: ownedUntracked,
    branchIdentity: {
      schema: "agentic-os-lane-identity/v1",
      coordination: "git-branch",
      device: identity.device,
      scope: identity.scope,
    },
  };
}

function requireCanonicalWorktree(registered) {
  const matches = registered.filter(entry => entry.branch === "main");
  if (matches.length !== 1) {
    throw new Error(`ADLC requires one registered main worktree; found ${matches.length}.`);
  }
  return matches[0];
}

function readOption(args, name) {
  const prefix = `--${name}=`;
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

function usage() {
  return "Usage: worktree-lifecycle.mjs check [--repository=<path>] "
    + "| cleanup --repository=<path> --worktree=<exact-lane-worktree>";
}

function main(args = process.argv.slice(2)) {
  const [command, ...options] = args;
  const repository = readOption(options, "repository") || process.cwd();
  if (command === "check") {
    const report = buildLifecycleReport({ repository });
    console.log(JSON.stringify(report));
    return report.status === "ready" ? 0 : 1;
  }
  if (command === "cleanup") {
    console.log(JSON.stringify(cleanupIntegratedLane({
      repository,
      target: readOption(options, "worktree"),
    })));
    return 0;
  }
  if (command === "cleanup-empty") {
    throw new Error(
      "Unsupported legacy command cleanup-empty: ADLC reaps only an exact integration-proven lane.",
    );
  }
  throw new Error(usage());
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`worktree-lifecycle: ${error.message}`);
    process.exitCode = 1;
  }
}
