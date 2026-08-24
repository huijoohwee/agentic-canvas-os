// Responsibility: Join immutable GitHub/cloud evidence to one exact local writer-registry CAS.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue, validateLedger } from "./cloud-collaboration-primitives.mjs";
import {
  buildEvidence,
  buildReleasedLease,
  isReleasedLease,
} from "./closed-absent-planned-owner-release-contract.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
} from "./writer-lease-lib.mjs";
import {
  mutateWriterLeaseRegistry,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";

const CONTROLLER_ROOT = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const RUNTIME_FILES = Object.freeze([
  "scripts/closed-absent-planned-owner-release-contract.mjs",
  "scripts/closed-absent-planned-owner-release-controller.mjs",
  "scripts/closed-absent-planned-owner-release-repository-adapter.mjs",
  "scripts/closed-absent-planned-owner-release.mjs",
]);
const MARKER = /<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu;

export function createRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const targetRepository = repositoryName(options.targetRepository);
  const ledgerRepository = repositoryName(options.ledgerRepository || "huijoohwee/agentic-canvas-os");
  const branch = required(options.branch, "branch");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull-request number");
  const claimId = digest(options.claimId, "claim ID");
  const controllerRoot = realpathSync(path.resolve(options.controllerRoot || CONTROLLER_ROOT));
  if (controllerRoot !== CONTROLLER_ROOT) {
    throw new Error("Owner release requires its exact installed controller root.");
  }
  const environment = dependencies.environment || process.env;
  const execute = dependencies.execute || ((command, argumentsList, cwd = repository) => execFileSync(
    command, argumentsList, { cwd, encoding: "utf8", env: environment,
      maxBuffer: 64 * 1024 * 1024, timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"] },
  ));
  const git = dependencies.git || ((argumentsList, cwd = repository) =>
    String(execute("git", argumentsList, cwd)).trim());
  const gitRaw = dependencies.gitRaw || ((argumentsList, cwd = repository) =>
    String(execute("git", argumentsList, cwd)));
  const ghJson = dependencies.ghJson || (argumentsList =>
    JSON.parse(String(execute("gh", argumentsList, repository))));
  const now = dependencies.now || (() => new Date());
  const pathExists = dependencies.pathExists || existsSync;
  const commonDirectory = realpathSync(path.resolve(
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], repository),
  ));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityPolicy: "projected",
  });
  const readCloud = dependencies.readCloud || (() => invokeRepositoryCloudAction({
    action: "status",
    ledgerRepository,
    request: { targetRepository },
    environment,
  }));
  const readLedger = dependencies.readLedger || (revision => ghJson([
    "api", "--method", "GET", "-H", "Accept: application/vnd.github.raw+json",
    `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`,
    "-f", `ref=${revision}`,
  ]));

  function repositoryProjection() {
    const origin = git(["remote", "get-url", "origin"], repository);
    if (repositoryFromOrigin(origin) !== targetRepository) fail("target GitHub origin identity");
    const topLevel = realpathSync(path.resolve(
      git(["rev-parse", "--show-toplevel"], repository),
    ));
    if (topLevel !== repository) fail("target repository top-level continuity");
    const currentCommonDirectory = realpathSync(path.resolve(
      git(["rev-parse", "--path-format=absolute", "--git-common-dir"], repository),
    ));
    if (currentCommonDirectory !== commonDirectory) fail("target Git common-directory continuity");
    const value = ghJson(["repo", "view", targetRepository, "--json", "id,nameWithOwner"]);
    if (value?.nameWithOwner !== targetRepository) fail("target repository identity");
    return Object.freeze({ id: required(value.id, "repository ID"), nameWithOwner: value.nameWithOwner,
      gitCommonDirectoryDigest: digestValue(commonDirectory) });
  }

  function controllerProjection() {
    const origin = git(["remote", "get-url", "origin"], controllerRoot);
    if (repositoryFromOrigin(origin) !== ledgerRepository) fail("controller GitHub origin identity");
    const topLevel = realpathSync(path.resolve(
      git(["rev-parse", "--show-toplevel"], controllerRoot),
    ));
    if (topLevel !== controllerRoot) fail("controller repository top-level continuity");
    const headSha = git(["rev-parse", "HEAD"], controllerRoot);
    const mainSha = git(["rev-parse", "refs/heads/main"], controllerRoot);
    const originMainSha = git(["rev-parse", "refs/remotes/origin/main"], controllerRoot);
    const remoteLine = git(["ls-remote", "--refs", "origin", "refs/heads/main"], controllerRoot)
      .split(/\s+/u);
    if (remoteLine.length !== 2 || remoteLine[1] !== "refs/heads/main") {
      fail("controller live remote main ref");
    }
    const remoteMainSha = remoteLine[0];
    const treeSha = git(["rev-parse", "HEAD^{tree}"], controllerRoot);
    const branchName = git(["branch", "--show-current"], controllerRoot);
    const clean = gitRaw(["status", "--porcelain=v1", "--untracked-files=all"], controllerRoot) === "";
    const mainBranch = ghJson(["api", "--method", "GET",
      `repos/${ledgerRepository}/branches/main`]);
    const remoteCommit = ghJson(["api", "--method", "GET",
      `repos/${ledgerRepository}/git/commits/${remoteMainSha}`]);
    const protectedMain = mainBranch?.name === "main" && mainBranch?.protected === true
      && mainBranch?.protection?.enabled === true && mainBranch?.commit?.sha === remoteMainSha;
    if (branchName !== "main" || headSha !== mainSha || headSha !== originMainSha
      || headSha !== remoteMainSha || remoteCommit?.sha !== remoteMainSha
      || remoteCommit?.tree?.sha !== treeSha || !clean || !protectedMain) {
      fail("clean live provider-protected controller main");
    }
    const runtimeDigest = digestValue(RUNTIME_FILES.map(file => ({ file,
      digest: digestValue(readFileSync(path.join(controllerRoot, file))) })));
    return Object.freeze({ repository: ledgerRepository, branch: branchName, headSha,
      originMainSha, treeSha, runtimeDigest, clean, protected: protectedMain });
  }

  function pullProjection(originalLease) {
    const value = ghJson(["pr", "view", String(pullRequestNumber), "--repo", targetRepository,
      "--json", "number,id,url,state,isDraft,mergedAt,closedAt,headRefName,headRefOid,headRepository,baseRefName,baseRefOid,body"]);
    const body = String(value.body || "");
    const matches = body.match(MARKER) || [];
    if (matches.length !== 1) fail("single pull-request writer marker");
    const marker = parseWriterLeasePullRequestBody(body);
    if (!marker || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(originalLease))) {
      fail("exact pull-request writer marker");
    }
    return Object.freeze({
      number: value.number,
      nodeId: required(value.id, "pull-request node ID"),
      url: required(value.url, "pull-request URL"),
      state: value.state,
      isDraft: value.isDraft,
      mergedAt: value.mergedAt,
      closedAt: canonicalInstant(value.closedAt, "pull-request closedAt"),
      headRepository: value.headRepository?.nameWithOwner || targetRepository,
      headBranch: value.headRefName,
      headSha: value.headRefOid,
      baseRepository: targetRepository,
      baseBranch: value.baseRefName,
      baseSha: value.baseRefOid,
      bodyDigest: digestValue(body),
      bodyRemainderDigest: digestValue(body.replace(MARKER, "")),
      markerDigest: digestValue(marker),
    });
  }

  function retainedHeadProjection(pull) {
    const ref = `refs/pull/${pull.number}/head`;
    const lines = git(["ls-remote", "origin", ref], repository).split("\n").filter(Boolean);
    if (lines.length !== 1) fail("one retained pull-request head ref");
    const [headSha, observedRef] = lines[0].split(/\s+/u);
    if (observedRef !== ref) fail("retained pull-request head ref identity");
    const head = ghJson(["api", `repos/${targetRepository}/git/commits/${headSha}`]);
    const base = ghJson(["api", `repos/${targetRepository}/git/commits/${pull.baseSha}`]);
    const commit = ghJson(["api", `repos/${targetRepository}/commits/${headSha}`]);
    return Object.freeze({ ref, sha: headSha, treeSha: head.tree?.sha,
      parentShas: (head.parents || []).map(parent => parent.sha), baseTreeSha: base.tree?.sha,
      changedPaths: (commit.files || []).map(file => file.filename).sort() });
  }

  function localAbsenceProjection(originalLease) {
    const ref = `refs/heads/${branch}`;
    const localRefs = git(["for-each-ref", "--format=%(refname)", "refs/heads"], repository)
      .split("\n").filter(Boolean).filter(candidate => candidate === ref);
    const remoteRefs = git(["ls-remote", "--heads", "origin", branch], repository)
      .split("\n").filter(Boolean);
    const worktrees = parseWorktrees(gitRaw(["worktree", "list", "--porcelain", "-z"], repository))
      .filter(item => item.branch === ref || path.resolve(item.path) === path.resolve(originalLease.worktreePath));
    return Object.freeze({ branch, worktreePath: path.resolve(originalLease.worktreePath),
      worktreeRegistered: worktrees.length > 0, worktreePathPresent: pathExists(originalLease.worktreePath),
      localBranchPresent: localRefs.length > 0, remoteBranchPresent: remoteRefs.length > 0,
      matchingWorktreeCount: worktrees.length, matchingLocalRefCount: localRefs.length,
      matchingRemoteRefCount: remoteRefs.length });
  }

  function cloudProjection(originalLease, pullNodeId, expected = null) {
    const authority = originalLease.cloudAuthority;
    const status = readCloud();
    if (status?.schema !== "agentic-cloud-collaboration-result/v1" || status.ok !== true
      || status.action !== "status" || !Array.isArray(status.claims)) fail("authoritative cloud status");
    const current = status.claims.filter(item => item.claimId === claimId);
    const ledgerRevision = expected?.ledgerRevision || status.ledgerRevision;
    const ledger = readLedger(ledgerRevision);
    const failures = validateLedger(ledger);
    if (failures.length > 0) throw new Error(`Collaboration ledger is invalid: ${failures.join("; ")}`);
    const ledgerDigest = expected?.ledgerDigest || status.ledgerDigest;
    const sequence = expected?.sequence || status.sequence;
    if (ledger.headDigest !== ledgerDigest || ledger.sequence !== sequence
      || (!expected && (ledgerRevision !== status.ledgerRevision
        || ledger.headDigest !== status.ledgerDigest || ledger.sequence !== status.sequence))) {
      fail("validated collaboration-ledger head");
    }
    const entries = ledger.entries.filter(entry => entry.claimId === claimId);
    const sourceEntries = entries.filter(entry => entry.claimDigest === authority.claimDigest);
    if (sourceEntries.length !== 1 || entries.length < 2) fail("unique source and terminal claim lineage");
    const source = sourceEntries[0], terminal = entries.at(-1);
    assertCloudLineage({ authority, source, terminal, pullNodeId });
    const retirement = terminal.claimCore.retirement;
    return Object.freeze({ ledgerRepository, ledgerRevision, ledgerDigest, sequence,
      validatedLedgerDigest: digestValue(ledger), currentClaimCardinality: current.length,
      source: { claimId: source.claimId, entryDigest: source.digest, claimDigest: source.claimDigest,
        transitionCounter: source.claimCore.transitionCounter, state: source.claimCore.state },
      terminal: { claimId: terminal.claimId, entryDigest: terminal.digest, claimDigest: terminal.claimDigest,
        transitionCounter: terminal.claimCore.transitionCounter, action: terminal.action,
        state: terminal.claimCore.state, reason: retirement.reason,
        finalRevision: retirement.finalRevision, reviewRequestId: retirement.reviewRequestId,
        retiredAt: canonicalInstant(retirement.retiredAt, "retirement instant"),
        integrationReceiptDigest: retirement.integrationReceiptDigest ?? null } });
  }

  function registryProjection(registry, originalLease) {
    return Object.freeze({ schema: registry.schema, revision: registry.revision,
      registryDigest: digestValue(registry), sourceLeaseDigest: writerLeaseDigest(originalLease),
      originalLease: structuredClone(originalLease), relatedArtifacts: {
        scopeExpansionIntent: registry.scopeExpansionIntents?.[branch] != null,
        activeOwnedDirtRecoveryIntent: registry.activeOwnedDirtRecoveryIntents?.[branch] != null,
        reviewedLaneEntrypointFence: registry.reviewedLaneEntrypointFences?.[branch] != null,
      } });
  }

  function capture(observedAt) {
    const registry = leaseStore.readRegistry();
    const originalLease = registry.leases?.[branch];
    if (!originalLease || originalLease.cloudAuthority?.claimId !== claimId) fail("source writer lease");
    const pullRequest = pullProjection(originalLease);
    return buildEvidence({ schema: "agentic-closed-absent-planned-owner-release-evidence/v1",
      observedAt, repository: repositoryProjection(), controller: controllerProjection(),
      registry: registryProjection(registry, originalLease),
      localAbsence: localAbsenceProjection(originalLease), pullRequest,
      retainedHead: retainedHeadProjection(pullRequest),
      cloud: cloudProjection(originalLease, pullRequest.nodeId) });
  }

  function assertExternal(plan) {
    const expected = plan.evidence;
    const originalLease = expected.registry.originalLease;
    const pullRequest = pullProjection(originalLease);
    const actual = {
      repository: repositoryProjection(),
      controller: controllerProjection(),
      localAbsence: localAbsenceProjection(originalLease),
      pullRequest,
      retainedHead: retainedHeadProjection(pullRequest),
      cloud: cloudProjection(originalLease, pullRequest.nodeId, expected.cloud),
    };
    for (const key of Object.keys(actual)) {
      if (digestValue(actual[key]) !== digestValue(expected[key])) {
        throw new Error(`Authorized ${key} evidence drifted before local owner release.`);
      }
    }
    return actual;
  }

  function classifyOwner(plan, authorizationReceipt) {
    const registry = leaseStore.readRegistry();
    const lease = registry.leases?.[branch];
    if (isReleasedLease({ lease, plan, authorizationReceipt })) {
      const targetRevision = lease.closedAbsentPlannedOwnerRelease.targetRegistryRevision;
      if (!Number.isSafeInteger(registry.revision) || registry.revision < targetRevision) {
        fail("released writer-registry revision");
      }
      return Object.freeze({ state: "complete", lease });
    }
    assertExternal(plan);
    const sourceCurrent = registry.revision === plan.evidence.registry.revision
      && digestValue(registry) === plan.evidence.registry.registryDigest
      && writerLeaseDigest(lease) === plan.evidence.registry.sourceLeaseDigest;
    if (sourceCurrent) return Object.freeze({ state: "pending", lease });
    throw new Error("Writer registry or source lease reached a foreign state.");
  }

  return Object.freeze({
    observe({ observedAt = now().toISOString() } = {}) { return capture(observedAt); },
    classifyOwner,
    releaseOwner(plan, authorizationReceipt) {
      assertExternal(plan);
      const result = mutateWriterLeaseRegistry({ leaseStore, branch,
        expectedLeaseDigest: plan.evidence.registry.sourceLeaseDigest,
        expectedClaimId: claimId,
        action: ({ registry, lease }) => {
          if (registry.revision !== plan.evidence.registry.revision
            || digestValue(registry) !== plan.evidence.registry.registryDigest
            || writerLeaseDigest(lease) !== plan.evidence.registry.sourceLeaseDigest) {
            throw new Error("Writer registry changed before the exact owner-release CAS.");
          }
          const releasedLease = buildReleasedLease({ plan, authorizationReceipt,
            releasedAt: now().toISOString() });
          return { registry: { ...registry, leases: { ...registry.leases, [branch]: releasedLease } },
            lease: releasedLease, changed: true };
        } });
      return Object.freeze({ releasedLease: result.lease, registryRevision: result.registryRevision });
    },
    verifyTerminal(plan, authorizationReceipt) {
      const classification = classifyOwner(plan, authorizationReceipt);
      if (classification.state !== "complete") throw new Error("Local owner release is not terminal.");
      return Object.freeze({ releasedLease: classification.lease });
    },
  });
}

function assertCloudLineage({ authority, source, terminal, pullNodeId }) {
  const sourceCore = source.claimCore, terminalCore = terminal.claimCore;
  const reviewRequestId = `github-pull-request:${pullNodeId}`;
  if (source.action !== "continue" || sourceCore?.state !== "current"
    || source.claimId !== authority.claimId || source.claimDigest !== authority.claimDigest
    || sourceCore.transitionCounter !== authority.transitionCounter
    || sourceCore.canonicalBaseRevision !== authority.canonicalBaseSha
    || sourceCore.laneRevision !== authority.laneRevision
    || sourceCore.writeSetDigest !== authority.writeSetDigest
    || sourceCore.leaseEpoch !== authority.leaseEpoch
    || sourceCore.reviewRequestId !== reviewRequestId || authority.reviewRequestId !== reviewRequestId
    || terminal.action !== "retire" || terminalCore?.state !== "retired"
    || terminal.claimId !== authority.claimId
    || terminalCore.transitionCounter <= sourceCore.transitionCounter
    || terminalCore.retirement?.reason !== "abandoned"
    || terminalCore.retirement?.finalRevision !== authority.laneRevision
    || terminalCore.retirement?.reviewRequestId !== reviewRequestId
    || terminalCore.retirement?.integrationReceiptDigest !== null) {
    fail("terminal abandoned cloud-claim lineage");
  }
}

function parseWorktrees(raw) {
  const records = [], current = {};
  for (const field of String(raw).split("\0")) {
    if (!field) continue;
    const [key, ...parts] = field.split(" ");
    if (key === "worktree" && current.path) {
      records.push({ ...current }); for (const name of Object.keys(current)) delete current[name];
    }
    if (key === "worktree") current.path = parts.join(" ");
    else if (key === "HEAD") current.head = parts[0];
    else if (key === "branch") current.branch = parts.join(" ");
  }
  if (current.path) records.push(current);
  return records;
}

function required(value, label) {
  if (typeof value !== "string" || !value || value.trim() !== value) throw new Error(`${label} is invalid.`);
  return value;
}
function repositoryName(value) {
  const result = required(value, "repository identity");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) fail("repository identity");
  return result;
}
function repositoryFromOrigin(value) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u
    .exec(String(value || "").trim());
  return match?.[1] || null;
}
function positive(value, label) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) fail(label); return result; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) fail(label); return value; }
function canonicalInstant(value, label) {
  const instant = new Date(value);
  if (!value || Number.isNaN(instant.getTime())) fail(label);
  return instant.toISOString();
}
function fail(label) { throw new Error(`Closed-absent planned-owner release requires exact ${label}.`); }
