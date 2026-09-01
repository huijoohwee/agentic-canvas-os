import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";

import { parseLaneRef } from "agentic-os/src/lane-id.mjs";
import { load as loadLaneStore } from "agentic-os/src/lane-records.mjs";

import { parseWorktreeRecords } from "./repository-guards.mjs";

/**
 * Compatibility snapshot for the one remaining cross-repository reader.
 *
 * ADLC coordinates lanes through observable Git state and branch identity. It
 * does not have ACOS writer leases, so this adapter keeps the old snapshot
 * field names while returning `lease: null`. Consumers that still require a
 * lease must fail closed until they migrate to ADLC evidence.
 */
export function collectScopedLaneState({
  repository,
  git = runGit,
  readLaneStore = readAgenticLaneStore,
  pathExists = existsSync,
  pathStat = lstatSync,
} = {}) {
  const root = path.resolve(repository || process.cwd());
  const capture = () => captureLaneState({
    root,
    git,
    readLaneStore,
    pathExists,
    pathStat,
  });
  const first = capture();
  const second = capture();
  if (
    first.registryDigest !== second.registryDigest
    || first.worktreeRegistryDigest !== second.worktreeRegistryDigest
    || first.laneStateDigest !== second.laneStateDigest
    || first.canonicalSourceDisposition !== second.canonicalSourceDisposition
  ) {
    throw new Error("Registered worktrees, ADLC lane records, or working bytes changed during inspection.");
  }
  return {
    repository: root,
    canonicalBaseSha: second.canonicalBaseSha,
    canonicalSourceDisposition: second.canonicalSourceDisposition,
    lanes: second.lanes,
    laneStateDigest: second.laneStateDigest,
    registryDigest: second.registryDigest,
  };
}

function captureLaneState({ root, git, readLaneStore, pathExists, pathStat }) {
  const worktreeRegistry = git(root, ["worktree", "list", "--porcelain", "-z"]);
  const records = parseWorktreeRecords(worktreeRegistry);
  const canonicalBaseSha = git(root, ["rev-parse", "origin/main"]).trim();
  const laneStore = normalizeLaneStore(readLaneStore(root));
  const lanes = records.map(record => captureWorktree({
    record,
    laneRecord: record.branch
      ? laneStore.lanes[record.branch.replace(/^refs\/heads\//u, "")] || null
      : null,
    git,
    pathExists,
    pathStat,
  }));
  const laneStateDigest = digest(
    lanes
      .map(lane => ({ path: lane.path, stateDigest: lane.stateDigest }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  );
  return {
    canonicalBaseSha,
    canonicalSourceDisposition: classifyCanonicalSource({
      root,
      canonicalBaseSha,
      lanes,
      git,
    }),
    lanes,
    laneStateDigest,
    registryDigest: digest(laneStore),
    worktreeRegistryDigest: digest(worktreeRegistry),
  };
}

function captureWorktree({ record, laneRecord, git, pathExists, pathStat }) {
  const lanePath = path.resolve(record.path);
  const status = git(lanePath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const indexEntries = git(lanePath, ["ls-files", "--stage", "-z"]);
  const changedPaths = nullList(git(lanePath, [
    "ls-files",
    "--modified",
    "--deleted",
    "--others",
    "--exclude-standard",
    "-z",
  ]));
  const workingFiles = changedPaths.map(relativePath => {
    const absolutePath = path.resolve(lanePath, relativePath);
    if (!within(lanePath, absolutePath) || !pathExists(absolutePath)) {
      return { path: relativePath, absent: true };
    }
    const stat = pathStat(absolutePath);
    return {
      path: relativePath,
      mode: stat.mode,
      sizeBytes: stat.size,
      objectId: git(lanePath, ["hash-object", "--no-filters", "--", relativePath]).trim(),
    };
  });
  const branch = record.branch || null;
  const branchIdentity = branchIdentityFor(branch, laneRecord);
  const state = {
    path: lanePath,
    head: record.head,
    treeSha: git(lanePath, ["rev-parse", "HEAD^{tree}"]).trim(),
    branch,
    detached: Boolean(record.detached),
    bare: Boolean(record.bare),
    locked: Boolean(record.locked),
    prunable: Boolean(record.prunable),
    invalid: Boolean(record.bare || record.locked || record.prunable),
    dirty: Boolean(status),
    indexDigest: digest(indexEntries),
    workingTreeDigest: digest({ status, workingFiles }),
    branchIdentity,
    leaseAmbiguous: false,
    lease: null,
  };
  return { ...state, stateDigest: digest(state) };
}

function branchIdentityFor(branch, laneRecord) {
  const ref = String(branch || "").replace(/^refs\/heads\//u, "");
  const identity = parseLaneRef(ref);
  if (!identity) return null;
  return {
    schema: "agentic-os-lane-identity/v1",
    coordination: "git-branch",
    ref,
    device: identity.device,
    scope: identity.scope,
    state: typeof laneRecord?.state === "string" ? laneRecord.state : "active",
  };
}

function classifyCanonicalSource({ root, canonicalBaseSha, lanes, git }) {
  const canonical = lanes.filter(lane => lane.branch === "refs/heads/main");
  if (canonical.length !== 1) return "ambiguous";
  const [main] = canonical;
  if (main.invalid) return "unsafe";
  if (main.head === canonicalBaseSha) return main.dirty ? "root-bootstrap-dirty" : "exact";
  try {
    git(root, ["merge-base", "--is-ancestor", main.head, canonicalBaseSha]);
    return main.dirty ? "root-bootstrap-dirty" : "preserved-behind";
  } catch {
    return "unsafe";
  }
}

function readAgenticLaneStore(repository) {
  return loadLaneStore(repository);
}

function normalizeLaneStore(value) {
  if (
    value?.schema !== "agentic-os/lanes/v1"
    || !value.lanes
    || typeof value.lanes !== "object"
    || Array.isArray(value.lanes)
  ) {
    throw new Error("ADLC lane record store is malformed.");
  }
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function nullList(value) {
  return String(value || "").split("\0").filter(Boolean).sort();
}

function within(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
