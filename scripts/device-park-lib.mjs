import { randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";

import { assertNoUnmergedPaths, assertRegisteredWorktree } from "./repository-guards.mjs";
import { parseWriterLeasePullRequestBody, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { requireOwnershipPullRequestDraft } from "./device-pull-request-state.mjs";

const ZERO_SHA = "0".repeat(40);
const STASH_LOCK_STALE_MS = 30_000;

export function park({
  invocationPath,
  repo,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  run,
  log = console.log,
  now = () => new Date(),
}) {
  const worktree = requireRepositorySafety({ invocationPath, repo, gitText });
  const branch = gitText(["branch", "--show-current"]).trim();
  if (!branch) return replayDetachedPark({ worktree, repo, gitText, gitOptional, ghText, leaseStore, sessionId, run, log });
  const instant = now();
  let stash = null;
  let parkHeadSha;

  if (branch === "main") {
    const message = createParkMessage(branch, instant);
    const branchHeadSha = requireSha(gitText(["rev-parse", "HEAD"]).trim(), "Main park HEAD");
    stash = captureParkStash({
      branch, branchHeadSha, message,
      ref: `refs/agentic-canvas-os/parked/main/${formatParkTimestamp(instant)}`,
      repo, gitText, gitOptional, run,
    });
    run("git", ["fetch", "origin", "main"]);
    parkHeadSha = requireSha(gitText(["rev-parse", "origin/main"]).trim(), "Main park origin/main");
    run("git", ["merge", "--ff-only", parkHeadSha]);
    const headSha = requireCleanAtSha(gitText, parkHeadSha, "Main park");
    log(stash ? `Parked ${branch} in ${stash.ref} at ${stash.sha.slice(0, 12)}; canonical main is pinned at ${headSha.slice(0, 12)}.` : `main is already clean at ${headSha.slice(0, 12)}.`);
    return parkResult({ branch, headSha, stash });
  }
  if (!branch.startsWith("agent/")) throw new Error(`Refusing unexpected device branch: ${branch}`);
  requireSession(sessionId);

  let lease = leaseStore.read?.(branch) || leaseStore.verify({ sessionId, branch, allowExpired: true });
  if (!lease || !["active", "parked"].includes(lease.status) || lease.sessionId !== sessionId) {
    throw new Error(`No active or replayable parked lease belongs to this session for ${branch}.`);
  }
  if (lease.status === "active") lease = leaseStore.verify({ sessionId, branch, allowExpired: true });
  assertLeaseWorktree(lease, repo);
  requireRemoteFence({ branch, lease, gitOptional });
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, "HEAD"]);
  requireOwnershipPullRequestDraft({ url: lease.pullRequestUrl, branch, ghText, expectedDraft: true });

  if (lease.status === "active") {
    if (!lease.pullRequestUrl) throw new Error("Park requires the exact ownership pull request created by device:start.");
    if (lease.parkStashSha && lease.parkStashStatus !== "restored") {
      throw new Error("A prior parked stash must be exactly restored before another park cycle.");
    }
    const branchHeadSha = requireSha(gitText(["rev-parse", "HEAD"]).trim(), "Parked branch HEAD");
    stash = captureParkStash({
      branch, branchHeadSha, message: createLeaseParkMessage(lease), ref: createLeaseParkRef(lease),
      repo, gitText, gitOptional, run,
    });
    if (lease.parkStashSha) dropParkedStashObject({ lease, repo, gitText, run });
    run("git", ["fetch", "origin", "main"]);
    const timestamp = instant.toISOString();
    parkHeadSha = requireSha(gitText(["rev-parse", "origin/main"]).trim(), "Park origin/main");
    const parkValues = {
      parkHeadSha,
      parkBranchHeadSha: branchHeadSha,
      parkSourceEpoch: lease.epoch,
      parkSourceFenceSha: lease.fenceSha,
      parkStashRef: stash?.ref ?? null,
      parkStashSha: stash?.sha ?? null,
      parkStashMessage: stash?.message ?? null,
      parkStashStatus: stash ? "pending" : null,
    };
    const projected = { ...lease, ...parkValues, status: "parked", heartbeatAt: timestamp, expiresAt: timestamp };
    const pullRequest = requireOwnershipPullRequestDraft({
      url: lease.pullRequestUrl, branch, ghText, expectedDraft: true,
    });
    run("gh", ["pr", "edit", lease.pullRequestUrl, "--body", updateWriterLeasePullRequestBody(
      pullRequest.body, projected,
    )]);
    requireOwnershipPullRequestDraft({ url: lease.pullRequestUrl, branch, ghText, expectedDraft: true });
    lease = leaseStore.release({
      sessionId,
      branch,
      status: "parked",
      expectedLease: lease,
      timestamp,
      values: parkValues,
    });
    if (lease.parkHeadSha !== parkHeadSha) {
      throw new Error(`Released park lease changed its pinned main SHA from ${parkHeadSha} to ${lease.parkHeadSha || "missing"}.`);
    }
  } else {
    requireClean(gitText);
    requireParkedPullRequest(lease, ghText);
    stash = requireParkedStashObject({ lease, gitText, gitOptional });
    parkHeadSha = requireSha(lease.parkHeadSha, "Parked lease main SHA");
    run("git", ["fetch", "origin", "main"]);
  }

  run("git", ["switch", "--detach", parkHeadSha]);
  const headSha = requireCleanAtSha(gitText, parkHeadSha, "Detached park");
  const summary = stash
    ? `Parked ${branch} in ${stash.ref} at ${stash.sha.slice(0, 12)}; task worktree is detached at ${headSha.slice(0, 12)}.`
    : `Detached the task worktree from ${branch} at ${headSha.slice(0, 12)}.`;
  log(summary);
  return parkResult({ branch, headSha, stash });
}

export function createParkMessage(branch, date = new Date()) {
  return `park: ${branch} ${formatParkTimestamp(date)}`;
}

export function formatParkTimestamp(date = new Date()) {
  return new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function replayDetachedPark({ worktree, repo, gitText, gitOptional, ghText, leaseStore, sessionId, run, log }) {
  requireSession(sessionId);
  if (!worktree.detached) throw new Error("Detached park replay requires a registered detached task worktree.");
  const registry = leaseStore.read();
  const candidates = Object.values(registry?.leases || {}).filter(candidate =>
    candidate?.status === "parked" && candidate.sessionId === sessionId &&
    candidate.worktreePath && path.resolve(candidate.worktreePath) === path.resolve(repo));
  if (candidates.length !== 1) throw new Error("Detached park replay requires exactly one parked lease for this session and worktree.");
  const lease = candidates[0];
  if (!/^[0-9a-f]{40}$/.test(String(lease.parkHeadSha || ""))) throw new Error("Detached park replay lacks its exact parked main SHA.");
  requireRemoteFence({ branch: lease.branch, lease, gitOptional });
  requireParkedPullRequest(lease, ghText);
  const stash = requireParkedStashObject({ lease, gitText, gitOptional });
  requireClean(gitText);
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (headSha !== lease.parkHeadSha) throw new Error(`Detached park HEAD ${headSha} does not match ${lease.parkHeadSha}.`);
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, lease.branch]);
  log(`Park already completed for ${lease.branch} at ${headSha.slice(0, 12)}.`);
  return parkResult({ branch: lease.branch, headSha, stash });
}

function requireParkedPullRequest(lease, ghText) {
  if (!lease.pullRequestUrl) throw new Error("Parked replay lacks its ownership pull request.");
  const pullRequest = requireOwnershipPullRequestDraft({
    url: lease.pullRequestUrl, branch: lease.branch, ghText, expectedDraft: true,
  });
  const remote = parseWriterLeasePullRequestBody(pullRequest.body);
  for (const field of ["status", "epoch", "sessionId", "branch", "baseSha", "fenceSha", "heartbeatAt", "expiresAt", "parkHeadSha", "parkBranchHeadSha", "parkSourceEpoch", "parkSourceFenceSha", "parkStashRef", "parkStashSha", "parkStashMessage", "parkStashStatus"]) {
    if (remote?.[field] !== lease[field]) throw new Error(`Parked pull request evidence disagrees on ${field}.`);
  }
}

export function requireParkedStashObject({ lease, gitText, gitOptional }) {
  const stash = requireParkedStashEvidence(lease);
  if (!stash) return null;
  requireStashObject({
    branch: lease.branch, branchHeadSha: lease.parkBranchHeadSha,
    message: stash.message, ref: stash.ref, sha: stash.sha,
    gitText, gitOptional,
  });
  return stash;
}

export function requireParkedStashEvidence(lease) {
  const fields = ["parkStashRef", "parkStashSha", "parkStashMessage", "parkStashStatus"];
  const present = fields.filter(field => lease?.[field] !== null && lease?.[field] !== undefined);
  if (!present.length) return null;
  if (present.length !== fields.length || !Number.isInteger(lease.parkSourceEpoch) ||
      !/^[0-9a-f]{40}$/.test(String(lease.parkSourceFenceSha || "")) ||
      !/^[0-9a-f]{40}$/.test(String(lease.parkBranchHeadSha || "")) ||
      !["pending", "restored"].includes(lease.parkStashStatus)) {
    throw new Error("Parked stash evidence is incomplete.");
  }
  if (!lease.parkStashRef.startsWith("refs/agentic-canvas-os/parked/") ||
      !/^[0-9a-f]{40}$/.test(lease.parkStashSha) ||
      lease.parkStashMessage !== createLeaseParkMessage({
        branch: lease.branch, epoch: lease.parkSourceEpoch, fenceSha: lease.parkSourceFenceSha,
      })) {
    throw new Error("Parked stash identity is invalid.");
  }
  return { ref: lease.parkStashRef, sha: lease.parkStashSha, message: lease.parkStashMessage, status: lease.parkStashStatus };
}

export function restoreParkedStashObject({ lease, repo, gitText, gitOptional, run }) {
  const stash = requireParkedStashObject({ lease, gitText, gitOptional });
  if (!stash) return null;
  if (!gitText(["status", "--porcelain"]).trim()) run("git", ["stash", "apply", "--index", stash.sha]);
  assertNoUnmergedPaths({
    conflictPaths: gitText(["diff", "--name-only", "--diff-filter=U"]),
    indexEntries: gitText(["ls-files", "-u"]),
  });
  verifyRestoredStash({ stash, repo, gitText, gitOptional, run });
  return stash;
}

function captureParkStash({ branch, branchHeadSha, message, ref, repo, gitText, gitOptional, run }) {
  const dirty = Boolean(gitText(["status", "--porcelain"]).trim());
  const referencedSha = gitOptional(["show-ref", "--hash", "--verify", ref]).trim();
  let matches = findStashes({ branch, message, gitText });
  if (referencedSha) {
    if (dirty) throw new Error(`Park stash ${ref} already exists while the worktree has new changes.`);
    requireStashObject({ branch, branchHeadSha, message, ref, sha: referencedSha, gitText, gitOptional });
    return { ref, sha: referencedSha, message, status: "pending" };
  }
  if (matches.length > 1) throw new Error(`Multiple stash objects match ${message}.`);
  if (dirty && matches.length) throw new Error(`A prior park stash matches ${message} while the worktree has new changes.`);
  if (dirty) {
    withParkStashLock({ repo, gitText }, () => run("git", ["stash", "push", "-u", "-m", message]));
    matches = findStashes({ branch, message, gitText });
  }
  if (!matches.length) return null;
  if (matches.length !== 1) throw new Error(`Park did not produce one exact stash object for ${message}.`);
  const sha = requireSha(matches[0], "Park stash");
  try {
    run("git", ["update-ref", ref, sha, ZERO_SHA]);
  } catch (error) {
    if (gitOptional(["show-ref", "--hash", "--verify", ref]).trim() !== sha) throw error;
  }
  requireStashObject({ branch, branchHeadSha, message, ref, sha, gitText, gitOptional });
  if (gitText(["status", "--porcelain"]).trim()) throw new Error("Worktree remains dirty after the exact park stash was captured.");
  return { ref, sha, message, status: "pending" };
}

export function dropParkedStashObject({ lease, repo, gitText, run }) {
  const evidence = requireParkedStashEvidence(lease);
  if (!evidence) return;
  if (evidence.status !== "restored") throw new Error("Only an exact restored stash can be retired.");
  withParkStashLock({ repo, gitText }, () => {
    const before = readStashEntries(gitText(["stash", "list", "--format=%H%x00%gd%x00%gs"]));
    const beforeParkRefs = readParkRefs(gitText([
      "for-each-ref", "--format=%(refname)%00%(objectname)", "refs/agentic-canvas-os/parked/",
    ]));
    const targets = before.filter(entry => entry.sha === evidence.sha &&
      entry.subject === `On ${lease.branch}: ${evidence.message}`);
    if (targets.length > 1) throw new Error("Exact restored stash appears more than once in the shared reflog.");
    const refSha = readOptional(gitText, ["show-ref", "--hash", "--verify", evidence.ref]);
    if (refSha) {
      requireStashObject({
        branch: lease.branch, branchHeadSha: lease.parkBranchHeadSha,
        message: evidence.message, ref: evidence.ref, sha: evidence.sha,
        gitText, gitOptional: args => readOptional(gitText, args),
      });
    } else if (targets.length) {
      throw new Error("Restored stash reflog entry exists without its immutable evidence ref.");
    } else {
      return;
    }
    if (targets.length === 1) {
      if (gitText(["rev-parse", targets[0].selector]).trim() !== evidence.sha) {
        throw new Error("Restored stash selector moved before exact cleanup.");
      }
      try {
        run("git", ["stash", "drop", targets[0].selector]);
      } catch (error) {
        const remaining = readStashEntries(gitText(["stash", "list", "--format=%H%x00%gd%x00%gs"]));
        if (remaining.some(entry => entry.sha === evidence.sha)) throw error;
      }
    }
    const after = readStashEntries(gitText(["stash", "list", "--format=%H%x00%gd%x00%gs"]));
    if (after.some(entry => entry.sha === evidence.sha)) throw new Error("Exact restored stash remains in the shared reflog.");
    requireSameStashMultiset(
      before.filter(candidate => candidate.sha !== evidence.sha),
      after.filter(candidate => candidate.sha !== evidence.sha),
    );
    try {
      run("git", ["update-ref", "-d", evidence.ref, evidence.sha]);
    } catch (error) {
      if (readOptional(gitText, ["show-ref", "--hash", "--verify", evidence.ref])) throw error;
    }
    if (readOptional(gitText, ["show-ref", "--hash", "--verify", evidence.ref])) {
      throw new Error("Immutable parked stash ref remains after exact cleanup.");
    }
    const afterParkRefs = readParkRefs(gitText([
      "for-each-ref", "--format=%(refname)%00%(objectname)", "refs/agentic-canvas-os/parked/",
    ]));
    for (const [ref, sha] of beforeParkRefs) {
      if (ref !== evidence.ref && afterParkRefs.get(ref) !== sha) {
        throw new Error(`Shared stash cleanup disturbed another immutable parked ref ${ref}.`);
      }
    }
  });
}

function readStashEntries(output) {
  return String(output).split("\n").flatMap(line => {
    const [sha, selector, subject] = line.split("\0");
    return sha && selector && subject ? [{ sha, selector, subject }] : [];
  });
}

function readParkRefs(output) {
  return new Map(String(output).split("\n").flatMap(line => {
    const [ref, sha] = line.split("\0");
    return ref && sha ? [[ref, sha]] : [];
  }));
}

function requireSameStashMultiset(before, after) {
  const counts = entries => entries.reduce((result, entry) => {
    const key = `${entry.sha}\0${entry.subject}`;
    result.set(key, (result.get(key) || 0) + 1);
    return result;
  }, new Map());
  const expected = counts(before);
  const actual = counts(after);
  if (expected.size !== actual.size || [...expected].some(([key, count]) => actual.get(key) !== count)) {
    throw new Error("Shared stash cleanup disturbed another parked reflog entry.");
  }
}

export function withParkStashLock({ repo, gitText }, action) {
  const commonDir = path.resolve(repo, gitText(["rev-parse", "--git-common-dir"]).trim());
  const root = path.join(commonDir, "agentic-canvas-os");
  const lockPath = path.join(root, "park-stash.lock");
  const token = `${process.pid}:${randomUUID()}`;
  mkdirSync(root, { recursive: true });
  let descriptor;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST" || lockOwnerAlive(lockPath) ||
        Date.now() - statSync(lockPath).mtimeMs <= STASH_LOCK_STALE_MS) throw error;
    const stalePath = `${lockPath}.stale.${process.pid}.${Date.now()}`;
    renameSync(lockPath, stalePath);
    descriptor = openSync(lockPath, "wx", 0o600);
    unlinkSync(stalePath);
  }
  writeSync(descriptor, token);
  try {
    return action();
  } finally {
    closeSync(descriptor);
    if (existsSync(lockPath) && readFileSync(lockPath, "utf8") === token) unlinkSync(lockPath);
  }
}

function lockOwnerAlive(lockPath) {
  let pid;
  try {
    pid = Number(readFileSync(lockPath, "utf8").split(":", 1)[0]);
  } catch {
    return false;
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readOptional(gitText, args) {
  try {
    return gitText(args).trim();
  } catch {
    return "";
  }
}

function findStashes({ branch, message, gitText }) {
  const subject = `On ${branch}: ${message}`;
  return gitText(["stash", "list", "--format=%H%x00%gs"]).split("\n").flatMap(line => {
    const separator = line.indexOf("\0");
    return separator > 0 && line.slice(separator + 1) === subject ? [line.slice(0, separator)] : [];
  });
}

function requireStashObject({ branch, branchHeadSha, message, ref, sha, gitText, gitOptional }) {
  if (gitOptional(["show-ref", "--hash", "--verify", ref]).trim() !== sha ||
      gitText(["cat-file", "-t", sha]).trim() !== "commit" ||
      gitText(["rev-parse", `${sha}^1`]).trim() !== branchHeadSha ||
      gitText(["log", "-1", "--pretty=%s", sha]).trim() !== `On ${branch}: ${message}`) {
    throw new Error(`Parked stash ${sha} does not match its immutable branch, message, parent, and ref evidence.`);
  }
}

function verifyRestoredStash({ stash, repo, gitText, gitOptional, run }) {
  try {
    run("git", ["diff", "--quiet", stash.sha, "--"]);
    run("git", ["diff", "--cached", "--quiet", `${stash.sha}^2`, "--"]);
  } catch {
    throw new Error(`Restored worktree does not match exact stash ${stash.sha}.`);
  }
  const thirdParent = gitOptional(["rev-parse", "--verify", `${stash.sha}^3`]).trim();
  const expected = thirdParent ? parseTree(gitText(["ls-tree", "-rz", "--full-tree", thirdParent])) : new Map();
  const paths = gitText(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  if (paths.length !== expected.size || paths.some(entryPath => {
    const entry = expected.get(entryPath);
    const mode = worktreeMode(path.resolve(repo, entryPath));
    return !entry || entry.type !== "blob" || entry.mode !== mode ||
      gitText(["hash-object", "--", entryPath]).trim() !== entry.oid;
  })) {
    throw new Error(`Restored untracked files do not match exact stash ${stash.sha}.`);
  }
  if (!gitText(["status", "--porcelain"]).trim()) throw new Error(`Exact stash ${stash.sha} restored no worktree changes.`);
}

function parseTree(output) {
  return new Map(String(output).split("\0").filter(Boolean).map(record => {
    const tab = record.indexOf("\t");
    const header = record.slice(0, tab).split(" ");
    return [record.slice(tab + 1), { mode: header[0], type: header[1], oid: header[2] }];
  }));
}

function worktreeMode(filePath) {
  const stats = lstatSync(filePath);
  if (stats.isSymbolicLink()) return "120000";
  return stats.mode & 0o111 ? "100755" : "100644";
}

function createLeaseParkMessage(lease) {
  return `park: ${lease.branch} epoch ${lease.epoch} fence ${lease.fenceSha}`;
}

function createLeaseParkRef(lease) {
  return `refs/agentic-canvas-os/parked/${lease.branch}/epoch-${lease.epoch}`;
}

function parkResult({ branch, headSha, stash }) {
  return {
    branch, headSha,
    stashRef: stash?.ref ?? null,
    stashSha: stash?.sha ?? null,
    stashStatus: stash?.status ?? null,
  };
}

function requireSha(value, label) {
  if (!/^[0-9a-f]{40}$/.test(String(value || ""))) throw new Error(`${label} must be an exact Git commit SHA.`);
  return value;
}

function requireRemoteFence({ branch, lease, gitOptional }) {
  const remoteSha = gitOptional(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(/\s+/)[0] || "";
  if (!lease.fenceSha || remoteSha !== lease.fenceSha) {
    throw new Error(`Remote fence for ${branch} is ${remoteSha || "missing"}, not ${lease.fenceSha || "unclaimed"}; this session is stale.`);
  }
}

function requireCleanAtSha(gitText, expectedSha, label) {
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (headSha !== expectedSha) {
    throw new Error(`${label} HEAD ${headSha.slice(0, 12)} does not match pinned main ${expectedSha.slice(0, 12)}.`);
  }
  requireClean(gitText);
  return headSha;
}

function requireClean(gitText) {
  if (gitText(["status", "--porcelain"]).trim()) throw new Error("Worktree remains dirty after park; resolve local changes before continuing.");
}

function requireRepositorySafety({ invocationPath, repo, gitText }) {
  if (path.resolve(invocationPath) !== path.resolve(repo)) throw new Error(`Repository commands must start at the registered worktree root ${repo}; received ${invocationPath}`);
  const worktree = assertRegisteredWorktree({ cwd: repo, porcelain: gitText(["worktree", "list", "--porcelain", "-z"]) });
  assertNoUnmergedPaths({ conflictPaths: gitText(["diff", "--name-only", "--diff-filter=U"]), indexEntries: gitText(["ls-files", "-u"]) });
  return worktree;
}

function assertLeaseWorktree(lease, repo) {
  if (path.resolve(lease.worktreePath) !== path.resolve(repo)) throw new Error(`Writer lease owns worktree ${lease.worktreePath}, not ${repo}.`);
}

function requireSession(sessionId) {
  if (!String(sessionId || "").trim()) throw new Error("A stable session id is required through --session=<id> or AGENTIC_SESSION_ID.");
}
