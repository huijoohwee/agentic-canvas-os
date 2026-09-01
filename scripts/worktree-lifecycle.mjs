#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRepositoryProfile } from "agentic-os/adapters/git";
import {
  dirtyTracked,
  headSha,
  repoRoot,
  untrackedPaths,
  worktrees,
} from "agentic-os/compat/git";
import { parseLaneRef } from "agentic-os/compat/lane-id";
import { load as loadLaneStore } from "agentic-os/compat/lane-records";
import { staleWorktrees } from "agentic-os/compat/worktree";

const SAFE_LANE_STATES = new Set(["planned", "active", "published", "queued", "integrated"]);
const UNTRACKED_SAMPLE_LIMIT = 32;

export function summarizeOwnedPaths(paths, limit = UNTRACKED_SAMPLE_LIMIT) {
  const normalized = [...new Set((Array.isArray(paths) ? paths : []).map(String))]
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const digest = createHash("sha256");
  for (const entry of normalized) digest.update(entry).update("\0");
  return Object.freeze({
    count: normalized.length,
    digest: digest.digest("hex"),
    sample: normalized.slice(0, limit),
    truncated: normalized.length > limit,
  });
}

export function buildLifecycleReport({ repository, readProfile = loadRepositoryProfile } = {}) {
  const invocationRoot = repoRoot(path.resolve(repository || process.cwd()));
  const profile = readProfile({ repository: invocationRoot });
  const registered = worktrees(invocationRoot);
  const canonical = requireCanonicalWorktree(registered, profile.canonical.localRef);
  const laneStore = loadLaneStore(canonical.path);
  const worktreeReports = registered.map(entry => inspectRegisteredWorktree({
    entry,
    canonicalPath: canonical.path,
    canonicalRemoteRef: profile.canonical.remoteRef,
    laneStore,
  }));
  const stale = staleWorktrees(canonical.path).map(entry => entry.path);
  return {
    schema: "agentic-os-worktree-lifecycle-compatibility/v1",
    repository: canonical.path,
    canonicalSha: headSha(profile.canonical.remoteRef, canonical.path),
    status: stale.length === 0 && worktreeReports.every(item => item.safe)
      ? "ready"
      : "attention-required",
    worktrees: worktreeReports,
    staleRegistrations: stale,
  };
}

function inspectRegisteredWorktree({ entry, canonicalPath, canonicalRemoteRef, laneStore }) {
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
  const ownedUntracked = summarizeOwnedPaths(untrackedPaths(normalizedPath));
  const head = headSha("HEAD", normalizedPath);
  if (normalizedPath === path.resolve(canonicalPath)) {
    const canonicalSha = headSha(canonicalRemoteRef, canonicalPath);
    const safe = !trackedDirty && ownedUntracked.count === 0 && head === canonicalSha;
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
    && ownedUntracked.count === 0
    && SAFE_LANE_STATES.has(recordedState);
  return {
    path: normalizedPath,
    head,
    branch: entry.branch,
    state: safe ? recordedState : trackedDirty || ownedUntracked.count > 0
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

function requireCanonicalWorktree(registered, canonicalLocalRef) {
  const expectedBranch = String(canonicalLocalRef || "").replace(/^refs\/heads\//u, "");
  const matches = registered.filter(entry => entry.branch === expectedBranch);
  if (matches.length !== 1) {
    throw new Error(`ADLC requires one registered ${expectedBranch || "canonical"} worktree; found ${matches.length}.`);
  }
  return matches[0];
}

function readOption(args, name) {
  const prefix = `--${name}=`;
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

function usage() {
  return "Usage: worktree-lifecycle.mjs check [--repository=<path>]";
}

function main(args = process.argv.slice(2)) {
  const [command, ...options] = args;
  const repository = readOption(options, "repository") || process.cwd();
  if (command === "check") {
    const report = buildLifecycleReport({ repository });
    console.log(JSON.stringify(report));
    return report.status === "ready" ? 0 : 1;
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
