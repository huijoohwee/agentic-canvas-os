// Responsibility: Capture path-free, joined source evidence without mutating repository state.
import path from "node:path";
import { realpathSync } from "node:fs";

import {
  assertActiveOwnedDirtWithinWriteSet,
  captureActiveOwnedDirtEvidence,
  requireSameActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import {
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
} from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

const ACCEPTED_STATUSES = new Set(["active", "review_ready", "delivery", "parked"]);

export function captureOrphanedTaskAuthoritySource({
  repository,
  gitText,
  ghText,
  leaseStore,
  readCloudClaim,
} = {}) {
  const root = realpathSync(path.resolve(requiredText(repository, "repository")));
  requireFunction(gitText, "Git reader");
  requireFunction(ghText, "GitHub reader");
  if (!leaseStore || typeof leaseStore.read !== "function") {
    throw new Error("Source evidence requires the writer-lease store.");
  }
  const branch = requiredText(gitText(["branch", "--show-current"]), "source branch");
  const record = assertRegisteredWorktree({
    cwd: root,
    porcelain: gitText(["worktree", "list", "--porcelain", "-z"]),
  });
  if (record.branch !== `refs/heads/${branch}` || realpathSync(record.path) !== root) {
    throw new Error("Source branch does not own the registered worktree.");
  }
  const lease = leaseStore.read(branch);
  assertJoinedLease({ lease, branch, root });
  const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  requireFunction(readCloudClaim, "cloud claim reader");
  const cloudClaim = readCloudClaim(lease);
  if (cloudClaim?.claimId !== lease.cloudAuthority?.claimId) {
    throw new Error("Source writer lease does not join one exact cloud claim proof.");
  }
  const headSha = requiredSha(gitText(["rev-parse", "HEAD"]), "source HEAD");
  const treeSha = requiredSha(gitText(["show", "-s", "--format=%T", headSha]), "source tree");
  const git = captureOrphanedTaskAuthorityGitEvidence({
    repository: root,
    gitText,
    headSha,
    treeSha,
    declaredWriteSet: lease.admission?.declaredWriteSet ?? lease.declaredWriteSet,
  });
  const pull = readOwnershipPullRequest({
    url: requiredText(lease.pullRequestUrl, "pull-request URL"),
    branch,
    ghText,
  });
  const marker = parseWriterLeasePullRequestBody(pull.body);
  const expectedMarker = projectWriterLeasePullRequestMarker(lease);
  if (!marker || digestValue(marker) !== digestValue(expectedMarker)
    || pull.headRefOid !== headSha) {
    throw new Error("Source pull request, HEAD, and writer-lease marker do not join exactly.");
  }
  const identity = parseRepositoryIdentity(ghText([
    "repo", "view", "--json", "id,nameWithOwner",
  ]));
  return Object.freeze({
    schema: "agentic-orphaned-task-authority-source/v1",
    repository: identity,
    branch,
    headSha,
    treeSha,
    worktreeIdentityDigest: digestValue({ path: root, branch }),
    leaseDigest: writerLeaseDigest(lease),
    claimId: requiredDigest(lease.cloudAuthority?.claimId, "source claim ID"),
    cloudClaimDigest: digestValue(cloudClaim),
    pullRequest: Object.freeze({
      id: requiredText(pull.id, "pull-request ID"),
      url: requiredText(pull.url, "pull-request URL"),
      headSha: requiredSha(pull.headRefOid, "pull-request head"),
      headBranch: requiredText(pull.headRefName, "pull-request head branch"),
      baseSha: requiredSha(pull.baseRefOid, "pull-request base"),
      bodyDigest: digestValue(pull.body || ""),
      bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(pull.body)),
      markerDigest: digestValue(marker),
      state: pull.state,
      isDraft: pull.isDraft,
    }),
    taskAuthority: Object.freeze(structuredClone(binding)),
    git,
  });
}

export function writerLeaseBodyRemainder(body) {
  const pattern = /<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu;
  const source = String(body || "");
  const matches = source.match(pattern) || [];
  if (matches.length !== 1) {
    throw new Error("Pull-request body must contain exactly one writer-lease marker.");
  }
  return source.replace(pattern, "");
}

export function captureOrphanedTaskAuthorityGitEvidence({
  repository,
  gitText,
  headSha,
  treeSha,
  declaredWriteSet,
} = {}) {
  const root = realpathSync(path.resolve(requiredText(repository, "repository")));
  const head = requiredSha(headSha, "Git evidence HEAD");
  const tree = requiredSha(treeSha, "Git evidence tree");
  const conflicts = gitText(["diff", "--name-only", "--diff-filter=U", "-z"]);
  if (conflicts) throw new Error("Orphaned authority recovery rejects unmerged paths.");
  const status = gitText(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!status) {
    const core = { kind: "clean", headSha: head, treeSha: tree };
    return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
  }
  const evidence = assertActiveOwnedDirtWithinWriteSet({
    evidence: captureActiveOwnedDirtEvidence({ repository: root }),
    declaredWriteSet,
  });
  if (evidence.headSha !== head) {
    throw new Error("Dirty Git evidence HEAD changed during capture.");
  }
  return Object.freeze({
    kind: "dirty",
    evidenceDigest: evidence.evidenceDigest,
    evidence,
  });
}

export function requireSameOrphanedTaskAuthorityGitEvidence(expected, observed) {
  if (expected?.kind !== observed?.kind
    || expected?.evidenceDigest !== observed?.evidenceDigest) {
    throw new Error("Source Git evidence changed from the authorized plan.");
  }
  if (expected.kind === "dirty") {
    requireSameActiveOwnedDirtEvidence(expected.evidence, observed.evidence);
  }
  return observed;
}

export function assertOnlyTaskAuthorityChanged({ sourceLeaseDigest, sourceBinding, targetLease }) {
  const reconstructedSource = { ...targetLease, taskAuthority: sourceBinding };
  if (writerLeaseDigest(reconstructedSource) !== sourceLeaseDigest) {
    throw new Error("Writer lease changed outside taskAuthority.");
  }
  return targetLease;
}

function assertJoinedLease({ lease, branch, root }) {
  if (!lease || lease.schema !== "agentic-writer-lease/v2"
    || !ACCEPTED_STATUSES.has(lease.status)
    || lease.branch !== branch
    || realpathSync(lease.worktreePath) !== root) {
    throw new Error("Source lane has no exact supported writer lease.");
  }
}

function parseRepositoryIdentity(value) {
  let source;
  try { source = JSON.parse(value); }
  catch (error) { throw new Error(`Repository identity is invalid: ${error.message}`); }
  return Object.freeze({
    id: requiredText(source?.id, "repository ID"),
    nameWithOwner: requiredText(source?.nameWithOwner, "repository name"),
  });
}

function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
function requiredSha(value, label) {
  const sha = requiredText(value, label);
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error(`${label} is invalid.`);
  return sha;
}
function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error(`${label} is invalid.`);
  return digest;
}
function requireFunction(value, label) {
  if (typeof value !== "function") throw new Error(`${label} is required.`);
}
