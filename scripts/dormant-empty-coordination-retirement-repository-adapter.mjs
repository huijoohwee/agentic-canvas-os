// Responsibility: adapt exact GitHub, Git, registry, and cloud evidence to one dormant retirement transaction.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue, validateLedger } from "./cloud-collaboration-primitives.mjs";
import {
  buildDormantEmptyCoordinationRetirementEvidence,
  normalizeDormantEmptyCoordinationRetirementEvidence,
} from "./dormant-empty-coordination-retirement-evidence.mjs";
import { createDormantEmptyCoordinationRetirementStore }
  from "./dormant-empty-coordination-retirement-store.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody }
  from "./writer-lease-lib.mjs";

const METHODS = Object.freeze(["withOperationLock", "readPlanEvidence", "readIntent", "writeIntent",
  "classifyClaimRetired", "retireClaim", "classifyPullRequestClosed", "closePullRequest", "verifyTerminal"]);
const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const RUNTIME_FILES = Object.freeze([
  "scripts/dormant-empty-coordination-retirement-evidence.mjs",
  "scripts/dormant-empty-coordination-retirement-contract.mjs",
  "scripts/dormant-empty-coordination-retirement-controller.mjs",
  "scripts/dormant-empty-coordination-retirement-repository-adapter.mjs",
  "scripts/dormant-empty-coordination-retirement-store.mjs",
  "scripts/dormant-empty-coordination-retirement.mjs",
]);
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function createDormantEmptyCoordinationRetirementAdapter(methods = {}) {
  for (const name of METHODS) {
    if (typeof methods[name] !== "function") {
      throw new Error(`Dormant empty coordination retirement adapter requires ${name}().`);
    }
  }
  return Object.freeze(Object.fromEntries(METHODS.map(name => [name, methods[name]])));
}

export function createRepositoryDormantEmptyCoordinationRetirementAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(text(options.repository, "repository")));
  const controllerRoot = realpathSync(path.resolve(options.controllerRoot || CONTROLLER_ROOT));
  if (controllerRoot !== realpathSync(CONTROLLER_ROOT)) {
    throw new Error("Retirement requires its exact installed controller root.");
  }
  const targetRepository = repositoryName(options.targetRepository);
  const ledgerRepository = repositoryName(options.ledgerRepository || "huijoohwee/agentic-canvas-os");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request number");
  const sourceClaimId = digest(options.claimId || options.sourceClaimId, "source claim ID");
  const waitingSuccessorClaimId = digest(options.waitingSuccessorClaimId, "waiting successor claim ID");
  const environment = dependencies.environment || process.env;
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, argumentsList, cwd = repository) => execFileSync(
    command, argumentsList, { cwd, encoding: "utf8", env: environment, maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }));
  const git = dependencies.git || ((argumentsList, cwd = repository) =>
    String(execute("git", argumentsList, cwd)).trim());
  const gitRaw = dependencies.gitRaw || ((argumentsList, cwd = repository) =>
    String(execute("git", argumentsList, cwd)));
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList, repository)).trim());
  const invokeCloud = dependencies.invokeCloud || invokeRepositoryCloudAction;
  const commonDirectory = realpathSync(path.resolve(repository,
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"])));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory });
  const operationId = digestValue({ targetRepository, pullRequestNumber, sourceClaimId,
    waitingSuccessorClaimId });
  const statePath = path.resolve(options.statePath || path.join(commonDirectory, "agentic-canvas-os",
    "dormant-empty-coordination-retirement", `${operationId}.json`));
  const store = dependencies.intentStore
    || createDormantEmptyCoordinationRetirementStore({ statePath, now });

  function cloudStatus() {
    const result = dependencies.readCloud
      ? dependencies.readCloud({ ledgerRepository, targetRepository })
      : invokeCloud({ action: "status", ledgerRepository,
        request: { targetRepository }, environment });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
      || !Array.isArray(result.claims) || !Number.isSafeInteger(result.sequence)) {
      throw new Error("Cloud status is malformed.");
    }
    return result;
  }

  function capture(observedAt) {
    if (dependencies.captureEvidence) {
      return normalizeDormantEmptyCoordinationRetirementEvidence(
        dependencies.captureEvidence({ observedAt, sourceClaimId, waitingSuccessorClaimId }));
    }
    const cloud = cloudStatus();
    const ledger = validatedLedger(cloud);
    const sources = cloud.claims.filter(claim => claim.claimId === sourceClaimId);
    const successors = cloud.claims.filter(claim => claim.claimId === waitingSuccessorClaimId);
    if (sources.length !== 1 || successors.length !== 1) {
      throw new Error("Cloud status does not contain one exact source and waiting successor.");
    }
    const sourceEntry = exactLatestEntry(ledger, sourceClaimId, "source");
    const successorEntry = exactLatestEntry(ledger, waitingSuccessorClaimId, "successor");
    const pullRequest = readPullRequest({ gh, pullRequestNumber, targetRepository });
    const headCommit = readCommit(gh, targetRepository, pullRequest.headSha);
    const baseCommit = readCommit(gh, targetRepository, pullRequest.baseSha);
    const canonical = readCanonical(gh, targetRepository, pullRequest.baseSha);
    return buildDormantEmptyCoordinationRetirementEvidence({
      schema: "agentic-dormant-empty-coordination-retirement-evidence/v1",
      observedAt,
      controller: readController({ controllerRoot, git, gitRaw, ledgerRepository }),
      canonical,
      pullRequest: { ...pullRequest, headTreeSha: headCommit.treeSha,
        parentShas: headCommit.parentShas, baseTreeSha: baseCommit.treeSha,
        changedPaths: readChangedPaths(gh, targetRepository, pullRequest.headSha) },
      claim: projectClaim(joinClaimEntry(sources[0], sourceEntry)),
      waitingSuccessor: projectClaim(joinClaimEntry(successors[0], successorEntry)),
      localAbsence: readLocalAbsence({ commonDirectory, git, gitRaw, leaseStore,
        branch: pullRequest.headBranch, headSha: pullRequest.headSha }),
      cloud: { ledgerRepository, ledgerRevision: cloud.ledgerRevision,
        ledgerDigest: cloud.ledgerDigest, sequence: cloud.sequence,
        inventoryDigest: digestValue(cloud.claims), sourceCardinality: sources.length,
        successorCardinality: successors.length,
        validatedLedgerDigest: digestValue(ledger), sourceEntryDigest: sourceEntry.digest,
        successorEntryDigest: successorEntry.digest },
    });
  }

  function validatedLedger(status) {
    const ledger = dependencies.readLedger
      ? dependencies.readLedger({ ledgerRepository, revision: status.ledgerRevision })
      : JSON.parse(gh(["api", "--method", "GET", "-H",
        "Accept: application/vnd.github.raw+json",
        `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`,
        "-f", `ref=${status.ledgerRevision}`]));
    const failures = validateLedger(ledger);
    if (failures.length > 0) throw new Error(`Collaboration ledger is invalid: ${failures.join("; ")}`);
    if (ledger.headDigest !== status.ledgerDigest || ledger.sequence !== status.sequence) {
      throw new Error("Cloud status does not join the validated ledger head.");
    }
    return ledger;
  }

  function terminalProjection(plan) {
    const evidence = evidenceFromPlan(plan);
    const controller = readController({ controllerRoot, git, gitRaw, ledgerRepository });
    if (digestValue(controller) !== digestValue(evidence.controller)) {
      throw new Error("Protected retirement controller drifted after planning.");
    }
    const cloud = cloudStatus();
    const ledger = validatedLedger(cloud);
    const source = cloud.claims.filter(claim => claim.claimId === sourceClaimId);
    const successor = cloud.claims.filter(claim => claim.claimId === waitingSuccessorClaimId);
    if (source.length > 1 || successor.length !== 1) throw new Error("Terminal cloud cardinality is ambiguous.");
    const sourceEntry = exactLatestEntry(ledger, sourceClaimId, "source");
    const successorEntry = exactLatestEntry(ledger, waitingSuccessorClaimId, "successor");
    const joinedSuccessor = joinClaimEntry(successor[0], successorEntry);
    const joinedSource = source.length === 1 ? joinClaimEntry(source[0], sourceEntry) : null;
    assertWaitingSuccessor(evidence.waitingSuccessor, joinedSuccessor);
    const pull = readPullRequest({ gh, pullRequestNumber, targetRepository,
      expectedStates: ["OPEN", "CLOSED"] });
    assertPullIdentity(evidence.pullRequest, pull);
    const local = readLocalAbsence({ commonDirectory, git, gitRaw, leaseStore,
      branch: evidence.pullRequest.headBranch, headSha: evidence.pullRequest.headSha });
    if (digestValue(local) !== digestValue(evidence.localAbsence)) {
      throw new Error("Local absence evidence drifted.");
    }
    return Object.freeze({ cloud, pull, source: joinedSource, sourceEntry,
      successor: joinedSuccessor, local });
  }

  async function readPlanEvidence() {
    const observedAt = now().toISOString();
    const first = capture(observedAt);
    const second = capture(observedAt);
    if (first.evidenceDigest !== second.evidenceDigest) {
      throw new Error("Retirement evidence drifted across the mandatory double read.");
    }
    return second;
  }

  return createDormantEmptyCoordinationRetirementAdapter({
    withOperationLock: (context, action) => store.withOperationLock(context, action),
    readPlanEvidence,
    readIntent: () => store.readIntent(),
    writeIntent: input => store.writeIntent(input),
    classifyClaimRetired(context) {
      const live = terminalProjection(context.plan);
      const complete = live.source === null
        && isRetirementByOperation(live.sourceEntry, context.operationKey);
      if (live.source === null && !complete) {
        throw new Error("Source claim reached a foreign terminal state.");
      }
      if (!complete) assertSourceClaim(evidenceFromPlan(context.plan).claim, live.source);
      return classification(context, complete, {
        claimId: sourceClaimId,
        successorClaimId: waitingSuccessorClaimId,
        state: complete ? "retired" : "dormant-preserved",
        ledgerRevision: live.cloud.ledgerRevision,
        ledgerDigest: live.cloud.ledgerDigest,
        disposition: complete ? "adopted" : "projected",
        cloudMutation: complete || cumulativeMutations(context.intent).cloudMutation,
        providerMutation: cumulativeMutations(context.intent).providerMutation,
      });
    },
    retireClaim(context) {
      const evidence = evidenceFromPlan(context.plan);
      const before = terminalProjection(context.plan);
      if (before.source === null) {
        requireRetirementByOperation(before.sourceEntry, context.operationKey);
        return operationValues(context, "adopted", true, false);
      }
      assertSourceClaim(evidence.claim, before.source);
      const request = {
        targetRepository,
        deviceId: before.pull.markerAuthority.rawDeviceId,
        sessionId: before.pull.markerAuthority.rawSessionId,
        claimId: sourceClaimId,
        expectedFenceRevision: evidence.claim.claimDigest,
        expectedTransitionCounter: evidence.claim.transitionCounter,
        expectedLedgerDigest: before.cloud.ledgerDigest,
        reason: "superseded",
        finalRevision: evidence.pullRequest.headSha,
        reviewRequestId: evidence.claim.reviewRequestId,
        bytesDigest: digestValue({ headSha: evidence.pullRequest.headSha,
          treeSha: evidence.pullRequest.headTreeSha }),
        namedChecksDigest: digestValue({ emptyCoordinationCommit: true,
          changedPaths: evidence.pullRequest.changedPaths }),
        handoffEvidenceDigest: digestValue({ predecessorClaimId: sourceClaimId,
          successorClaimId: waitingSuccessorClaimId,
          successorClaimDigest: evidence.waitingSuccessor.claimDigest,
          successorTransitionDigest: evidence.waitingSuccessor.transitionDigest }),
        idempotencyKey: context.operationKey,
      };
      try {
        const result = invokeCloud({ action: "retire", ledgerRepository, request, environment });
        requireRetirementResult(result, context.operationKey);
        const after = terminalProjection(context.plan);
        if (after.source !== null) throw new Error("Source claim remains after retirement.");
        requireRetirementByOperation(after.sourceEntry, context.operationKey);
        return operationValues(context, "projected", true, false, result);
      } catch (error) {
        const after = terminalProjection(context.plan);
        if (after.source !== null) throw error;
        requireRetirementByOperation(after.sourceEntry, context.operationKey);
        return operationValues(context, "adopted", true, false);
      }
    },
    classifyPullRequestClosed(context) {
      const live = terminalProjection(context.plan);
      if (live.source !== null) throw new Error("Pull request cannot close before claim retirement.");
      const complete = live.pull.state === "CLOSED";
      return classification(context, complete, {
        pullRequestNumber, pullRequestNodeId: live.pull.nodeId, state: live.pull.state,
        closedAt: live.pull.closedAt, disposition: complete ? "adopted" : "projected",
        ...cumulativeMutations(context.intent),
      });
    },
    closePullRequest(context) {
      const before = terminalProjection(context.plan);
      if (before.source !== null) throw new Error("Pull request cannot close before claim retirement.");
      if (before.pull.state === "CLOSED") return operationValues(context, "adopted", false, false);
      let responseLost = false;
      try {
        if (dependencies.closePull) dependencies.closePull(before.pull);
        else execute("gh", ["pr", "close", "--repo", targetRepository, before.pull.url], repository);
      } catch { responseLost = true; }
      const after = terminalProjection(context.plan);
      if (after.pull.state !== "CLOSED") throw new Error("Exact draft did not close.");
      return operationValues(context, responseLost ? "adopted" : "projected", false,
        !responseLost);
    },
    verifyTerminal(context) {
      const live = terminalProjection(context.plan);
      if (live.source !== null || live.pull.state !== "CLOSED") {
        throw new Error("Dormant empty coordination retirement is not terminal.");
      }
      const claimOperationKey = context.intent?.phases?.["claim-retired"]?.values?.operationKey;
      requireRetirementByOperation(live.sourceEntry, claimOperationKey);
      const mutations = cumulativeMutations(context.intent);
      return Object.freeze({ operationKey: context.operationKey, disposition: "adopted",
        cloudMutation: mutations.cloudMutation, providerMutation: mutations.providerMutation,
        sourceClaimId, waitingSuccessorClaimId, pullRequestNumber,
        pullRequestNodeId: live.pull.nodeId, pullRequestState: "CLOSED",
        ledgerRevision: live.cloud.ledgerRevision, ledgerDigest: live.cloud.ledgerDigest,
        terminalDigest: digestValue({ sourceClaimId, waitingSuccessorClaimId,
          waitingSuccessorDigest: digestValue(projectClaim(live.successor)),
          pullRequestNodeId: live.pull.nodeId, pullRequestState: "CLOSED",
          localAbsence: live.local }),
      });
    },
  });
}

function readPullRequest({ gh, pullRequestNumber, targetRepository, expectedStates = ["OPEN"] }) {
  const value = JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--repo", targetRepository,
    "--json", "number,id,url,state,isDraft,mergedAt,closedAt,headRefName,headRefOid,headRepository,baseRefName,baseRefOid,autoMergeRequest,body,updatedAt"]));
  const headRepository = value.headRepository?.nameWithOwner;
  if (value.number !== pullRequestNumber || !expectedStates.includes(value.state)) {
    throw new Error("Pull request identity or state drifted.");
  }
  const body = String(value.body || "");
  const marker = parseWriterLeasePullRequestBody(body);
  if (!marker?.cloudAuthority?.claimId) throw new Error("Pull request has no exact cloud claim marker.");
  return Object.freeze({ number: value.number, nodeId: text(value.id, "pull request node ID"),
    url: text(value.url, "pull request URL"), repository: targetRepository, state: value.state,
    isDraft: value.isDraft === true, mergedAt: value.mergedAt, closedAt: value.closedAt,
    autoMergeRequest: value.autoMergeRequest, inMergeQueue: false,
    headRepository: repositoryName(headRepository), headBranch: text(value.headRefName, "head branch"),
    headSha: sha(value.headRefOid, "head revision"), baseRepository: targetRepository,
    baseBranch: text(value.baseRefName, "base branch"), baseSha: sha(value.baseRefOid, "base revision"),
    bodyDigest: digestValue(body), reviewRequestId: marker.cloudAuthority.reviewRequestId,
    markerClaimId: marker.cloudAuthority.claimId,
    markerDigest: digestValue(marker), markerAuthority: projectMarkerAuthority(marker.cloudAuthority),
    providerVersion: new Date(value.updatedAt).toISOString() });
}

function projectMarkerAuthority(value) {
  const projected = { claimId: value.claimId, claimDigest: value.claimDigest,
    operationReceiptDigest: value.operationReceiptDigest,
    ledgerRepository: value.ledgerRepository, targetRepository: value.targetRepository,
    canonicalBaseSha: value.canonicalBaseSha, laneRevision: value.laneRevision,
    declaredWriteScope: value.cloudDeclaredWriteScope, writeSetDigest: value.writeSetDigest,
    deviceId: pseudonymousIdentifier("device", value.deviceId),
    sessionId: pseudonymousIdentifier("session", value.sessionId),
    reviewRequestId: value.reviewRequestId, leaseEpoch: value.leaseEpoch,
    transitionCounter: value.transitionCounter, integration: value.integration || null };
  Object.defineProperties(projected, {
    rawDeviceId: { value: value.deviceId, enumerable: false },
    rawSessionId: { value: value.sessionId, enumerable: false },
  });
  return Object.freeze(projected);
}

function readCommit(gh, repository, revision) {
  const value = JSON.parse(gh(["api", `repos/${repository}/git/commits/${revision}`]));
  return Object.freeze({ sha: sha(value.sha, "commit revision"),
    treeSha: sha(value.tree?.sha, "commit tree"),
    parentShas: Object.freeze((value.parents || []).map(parent => sha(parent.sha, "commit parent"))) });
}

function readChangedPaths(gh, repository, revision) {
  const value = JSON.parse(gh(["api", `repos/${repository}/commits/${revision}`]));
  const paths = (value.files || []).map(file => text(file.filename, "changed path")).sort();
  if (new Set(paths).size !== paths.length) throw new Error("Commit path inventory is ambiguous.");
  return Object.freeze(paths);
}

function readCanonical(gh, repository, baseSha) {
  const reference = JSON.parse(gh(["api", `repos/${repository}/git/ref/heads/main`]));
  const revision = sha(reference.object?.sha, "protected main revision");
  const commit = readCommit(gh, repository, revision);
  const compare = JSON.parse(gh(["api", `repos/${repository}/compare/${baseSha}...${revision}`]));
  return Object.freeze({ repository, branch: "main", sha: revision, treeSha: commit.treeSha,
    containsBase: ["ahead", "identical"].includes(compare.status) });
}

function readController({ controllerRoot, git, gitRaw, ledgerRepository }) {
  const headSha = sha(git(["rev-parse", "HEAD"], controllerRoot), "controller HEAD");
  const originMainSha = sha(git(["rev-parse", "origin/main"], controllerRoot), "controller origin/main");
  const treeSha = sha(git(["rev-parse", "HEAD^{tree}"], controllerRoot), "controller tree");
  const clean = gitRaw(["status", "--porcelain=v1", "--untracked-files=all"], controllerRoot) === "";
  const files = RUNTIME_FILES.map(file => ({ file,
    digest: digestValue(readFileSync(path.join(controllerRoot, file))) }));
  return Object.freeze({ repository: ledgerRepository, rootDigest: digestValue(controllerRoot),
    headSha, treeSha, originMainSha, runtimeDigest: digestValue(files), clean,
    protected: headSha === originMainSha });
}

function readLocalAbsence({ commonDirectory, git, gitRaw, leaseStore, branch, headSha }) {
  const ref = `refs/heads/${branch}`;
  const refs = git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"])
    .split("\n").filter(Boolean).filter(line => line === `${ref} ${headSha}` || line.startsWith(`${ref} `));
  const worktrees = parseWorktrees(gitRaw(["worktree", "list", "--porcelain", "-z"]))
    .filter(item => item.branch === ref || item.head === headSha);
  const registry = leaseStore.read();
  const leases = Object.values(registry.leases || {}).filter(lease =>
    lease.branch === branch || lease.fenceSha === headSha || lease.reviewHeadSha === headSha);
  return Object.freeze({ gitCommonDirectoryDigest: digestValue(commonDirectory),
    registryRevision: registry.revision, branchPresent: refs.length > 0,
    worktreePresent: worktrees.length > 0, leasePresent: leases.length > 0,
    matchingRefCount: refs.length, matchingWorktreeCount: worktrees.length,
    matchingLeaseCount: leases.length });
}

function parseWorktrees(raw) {
  const records = [], fields = String(raw).split("\0"), current = {};
  for (const field of fields) {
    if (!field) continue;
    const [key, ...parts] = field.split(" ");
    if (key === "worktree" && current.path) { records.push({ ...current }); Object.keys(current).forEach(name => delete current[name]); }
    if (key === "worktree") current.path = parts.join(" ");
    else if (key === "HEAD") current.head = parts[0];
    else if (key === "branch") current.branch = parts.join(" ");
  }
  if (current.path) records.push(current);
  return records;
}

function projectClaim(value) {
  return Object.freeze({ claimId: value.claimId, claimDigest: value.fenceRevision || value.claimDigest,
    transitionDigest: value.transitionDigest || value.ledgerRevision,
    operationReceiptDigest: value.operationReceiptDigest, state: value.state,
    recordedState: value.recordedState || (value.state === "dormant-preserved" ? "reviewed" : value.state),
    writeAuthority: value.writeAuthority, scopeReserved: value.scopeReserved,
    actorId: value.actorId, repositoryId: value.repositoryId, workItemId: value.workItemId,
    deviceId: value.deviceId, sessionId: value.sessionId,
    canonicalBaseRevision: value.canonicalBaseRevision, laneRevision: value.laneRevision,
    declaredWriteScope: value.declaredWriteScope, writeSetDigest: value.writeSetDigest,
    leaseEpoch: value.leaseEpoch, transitionCounter: value.transitionCounter,
    predecessorClaimId: value.predecessorClaimId || null, reviewRequestId: value.reviewRequestId || null,
    evidenceDigest: value.evidenceDigest || null, integration: value.integration || null,
    retirement: value.retirement || null });
}

function exactLatestEntry(ledger, claimId, label) {
  const entries = ledger.entries.filter(entry => entry.claimId === claimId);
  if (entries.length === 0) throw new Error(`Validated ledger has no ${label} lineage.`);
  return entries.at(-1);
}

function joinClaimEntry(claim, entry) {
  if (entry.claimId !== claim.claimId || entry.claimDigest !== (claim.fenceRevision || claim.claimDigest)
    || entry.digest !== (claim.transitionDigest || claim.ledgerRevision)
    || entry.claimCore?.transitionCounter !== claim.transitionCounter) {
    throw new Error("Cloud inventory and validated claim entry do not join.");
  }
  return Object.freeze({ ...entry.claimCore, ...claim,
    claimDigest: entry.claimDigest, transitionDigest: entry.digest,
    deviceId: entry.claimCore.deviceId, sessionId: entry.claimCore.sessionId });
}

function evidenceFromPlan(plan) {
  const value = plan?.evidence || plan?.sourceEvidence;
  return normalizeDormantEmptyCoordinationRetirementEvidence(value);
}

function assertSourceClaim(expected, actual) {
  if (digestValue(projectClaim(actual)) !== digestValue(expected)) throw new Error("Source claim drifted.");
}
function assertWaitingSuccessor(expected, actual) {
  if (digestValue(projectClaim(actual)) !== digestValue(expected)) throw new Error("Waiting successor drifted.");
}
function assertPullIdentity(expected, actual) {
  for (const key of ["number", "nodeId", "url", "repository", "headRepository", "headBranch",
    "headSha", "baseRepository", "baseBranch", "baseSha", "bodyDigest", "reviewRequestId",
    "markerClaimId", "markerDigest"]) {
    if (actual[key] !== expected[key]) throw new Error(`Pull request ${key} drifted.`);
  }
  if (digestValue(actual.markerAuthority) !== digestValue(expected.markerAuthority)) {
    throw new Error("Pull request marker authority drifted.");
  }
  if (actual.isDraft !== true || actual.mergedAt !== null || actual.autoMergeRequest !== null) {
    throw new Error("Pull request lifecycle escaped the exact draft subject.");
  }
}

function classification(context, complete, values) {
  return Object.freeze({ state: complete ? "complete" : "pending",
    values: Object.freeze({ operationKey: context.operationKey, ...values }) });
}
function operationValues(context, disposition, cloudMutation, providerMutation, result = null) {
  const cumulative = cumulativeMutations(context.intent);
  return Object.freeze({ operationKey: context.operationKey, disposition,
    cloudMutation: cumulative.cloudMutation || cloudMutation,
    providerMutation: cumulative.providerMutation || providerMutation,
    ...(result?.receipt?.receiptDigest ? { receiptDigest: result.receipt.receiptDigest } : {}),
    ...(result?.operationReceipt?.receiptDigest
      ? { operationReceiptDigest: result.operationReceipt.receiptDigest } : {}) });
}
function cumulativeMutations(intent) {
  let cloudMutation = false, providerMutation = false;
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (value.cloudMutation === true) cloudMutation = true;
    if (value.providerMutation === true) providerMutation = true;
    for (const member of Object.values(value)) visit(member);
  };
  visit(intent);
  return { cloudMutation, providerMutation };
}
function requireRetirementResult(result, operationKey) {
  if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
    || result.operationReceipt?.operation !== "retire"
    || result.operationReceipt?.idempotencyKey !== digestValue(operationKey)
    || !DIGEST_PATTERN.test(result.operationReceipt?.receiptDigest || "")) {
    throw new Error("Cloud retirement returned a foreign operation receipt.");
  }
}

function isRetirementByOperation(entry, operationKey) {
  return entry?.action === "retire"
    && entry.claimCore?.state === "retired"
    && entry.idempotencyKey === digestValue(operationKey);
}

function requireRetirementByOperation(entry, operationKey) {
  if (!isRetirementByOperation(entry, operationKey)) {
    throw new Error("Source claim retirement is not bound to this exact operation.");
  }
}

function text(value, label) { if (typeof value !== "string" || value.trim() !== value || !value) throw new Error(`${label} is invalid.`); return value; }
function repositoryName(value) { const result = text(value, "repository"); if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw new Error("Repository is invalid."); return result; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`); return value; }
function sha(value, label) { if (!SHA_PATTERN.test(value || "")) throw new Error(`${label} is invalid.`); return value; }
function digest(value, label) { if (!DIGEST_PATTERN.test(value || "")) throw new Error(`${label} is invalid.`); return value; }
