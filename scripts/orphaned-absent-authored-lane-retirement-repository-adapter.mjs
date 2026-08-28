// Responsibility: Join exact provider, Git, cloud, absence, and durable evidence for one retirement.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, digestValue, validateLedger }
  from "./cloud-collaboration-primitives.mjs";
import {
  normalizeOrphanedAbsentAuthoredLaneEvidence,
  orphanedAbsentAuthoredStableEvidenceDigest,
} from "./orphaned-absent-authored-lane-retirement-evidence.mjs";
import { normalizePlan, retirementJournalOperationKey, retirementTerminalEvidenceDigest }
  from "./orphaned-absent-authored-lane-retirement-contract.mjs";
import { createRetirementStore, retirementOperationKey, retirementOperationReceipt,
  retirementRequest, retirementRequestDigest }
  from "./orphaned-absent-authored-lane-retirement-store.mjs";
import {
  assertGitHubPullQueueFence, closeGitHubPullWithReconciliation,
  gitHubPullImmutableDigest, readGitHubPullLifecycleSubject,
} from "./reviewed-ci-revision-evidence.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody }
  from "./writer-lease-lib.mjs";

const CONTROLLER_ROOT = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const RUNTIME_FILES = Object.freeze([
  "scripts/orphaned-absent-authored-lane-retirement-contract.mjs",
  "scripts/orphaned-absent-authored-lane-retirement-controller.mjs",
  "scripts/orphaned-absent-authored-lane-retirement-evidence.mjs",
  "scripts/orphaned-absent-authored-lane-retirement-repository-adapter.mjs",
  "scripts/orphaned-absent-authored-lane-retirement-store.mjs",
  "scripts/orphaned-absent-authored-lane-retirement.mjs",
]);
const MAX_PRIVATE_ENTRIES = 10_000;

export function createRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = realDirectory(options.repository, "target repository");
  const controllerRoot = realDirectory(options.controllerRoot || CONTROLLER_ROOT, "controller root");
  if (controllerRoot !== CONTROLLER_ROOT && dependencies.allowAlternateControllerRoot !== true) {
    throw new Error("Retirement requires its exact installed controller root.");
  }
  const targetRepository = repositoryName(options.targetRepository);
  const ledgerRepository = repositoryName(options.ledgerRepository || "huijoohwee/agentic-canvas-os");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull-request number");
  const claimId = digest(options.claimId, "claim ID");
  const canonicalTaskRoot = realDirectory(path.join(process.env.CODEX_HOME
    || path.join(homedir(), ".codex"), "task-state"), "canonical private task root");
  const privateTaskRoot = realDirectory(options.privateTaskRoot || canonicalTaskRoot, "private task root");
  if (privateTaskRoot !== canonicalTaskRoot && dependencies.allowAlternatePrivateTaskRoot !== true) {
    throw new Error("Retirement requires the canonical private task-state root.");
  }
  const environment = dependencies.environment || process.env;
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, argumentsList, cwd = repository) => execFileSync(
    command, argumentsList, { cwd, encoding: "utf8", env: environment,
      maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }));
  const git = dependencies.git || ((argumentsList, cwd = repository) =>
    String(execute("git", argumentsList, cwd)).trim());
  const gitRaw = dependencies.gitRaw || ((argumentsList, cwd = repository) =>
    String(execute("git", argumentsList, cwd)));
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList, repository)).trim());
  const invokeCloud = dependencies.invokeCloud || invokeRepositoryCloudAction;
  const commonDirectory = realDirectory(path.resolve(repository,
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"])), "Git common directory");
  const statePath = externalJson(options.statePath, [repository, controllerRoot, commonDirectory]);
  const store = dependencies.store || createRetirementStore({ statePath, now });
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory });

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

  function validatedLedger(status) {
    const ledger = dependencies.readLedger
      ? dependencies.readLedger({ ledgerRepository, revision: status.ledgerRevision })
      : JSON.parse(gh(["api", "--method", "GET", "-H", "Accept: application/vnd.github.raw+json",
        `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`,
        "-f", `ref=${status.ledgerRevision}`]));
    const failures = validateLedger(ledger);
    if (failures.length || ledger.headDigest !== status.ledgerDigest || ledger.sequence !== status.sequence) {
      throw new Error(`Cloud status does not join a valid ledger head${failures.length ? `: ${failures.join("; ")}` : ""}.`);
    }
    return ledger;
  }

  function readCloudFrame() {
    const cloud = cloudStatus();
    const ledger = validatedLedger(cloud);
    const matches = cloud.claims.filter(claim => claim.claimId === claimId);
    if (matches.length > 1) throw new Error("Cloud claim cardinality is ambiguous.");
    const entries = ledger.entries.filter(entry => entry.claimId === claimId);
    if (!entries.length) throw new Error("Validated ledger has no exact claim lineage.");
    const latestEntry = entries.at(-1);
    const claim = matches.length ? projectClaim(matches[0], latestEntry) : null;
    return Object.freeze({ cloud, ledger, claim, entries: Object.freeze(entries), latestEntry });
  }

  function readPull() {
    const subject = readGitHubPullLifecycleSubject({ gh, pullRequestNumber });
    if (subject.repository.full_name !== targetRepository) {
      throw new Error("Provider repository identity drifted.");
    }
    assertGitHubPullQueueFence(subject.pullRequest);
    const markerCount = (subject.pullRequest.body.match(/<!--\s*agentic-writer-lease\/v2\s+/gu) || []).length;
    const marker = parseWriterLeasePullRequestBody(subject.pullRequest.body);
    if (markerCount !== 1 || !marker) throw new Error("Pull request must contain one complete writer marker.");
    return Object.freeze({ ...subject, marker });
  }

  function capture() {
    if (dependencies.captureEvidence) {
      return normalizeOrphanedAbsentAuthoredLaneEvidence(dependencies.captureEvidence());
    }
    const observedAt = now().toISOString();
    const provider = readPull();
    const actor = JSON.parse(gh(["api", "user"]));
    const cloudFrame = readCloudFrame();
    if (!cloudFrame.claim) throw new Error("Exact cloud claim is absent before retirement.");
    const marker = projectMarker(provider.marker);
    const pullRequest = projectPull(provider.pullRequest, marker);
    const authoredRange = readAuthoredRange({ git, gitRaw, claim: cloudFrame.claim,
      headSha: pullRequest.headSha });
    const remote = readRemote({ git, branch: pullRequest.branch });
    const absence = readAbsence({ git, gitRaw, commonDirectory, leaseStore, privateTaskRoot,
      branch: pullRequest.branch, headSha: pullRequest.headSha, marker, claimId });
    const controller = readController({ git, gitRaw, gh, controllerRoot, ledgerRepository });
    const originUrl = git(["remote", "get-url", "origin"]);
    if (repositoryFromRemote(originUrl) !== targetRepository) {
      throw new Error("Local target origin does not bind the selected provider repository.");
    }
    const repositoryEvidence = {
      fullName: provider.repository.full_name,
      id: provider.repository.id,
      nodeId: provider.repository.node_id,
      originUrlDigest: digestValue(originUrl),
      gitCommonDirectoryDigest: digestValue(commonDirectory),
    };
    const core = {
      observedAt,
      repository: repositoryEvidence,
      controller,
      actor: { id: actor.id, login: actor.login },
      pullRequest,
      marker,
      claim: cloudFrame.claim,
      cloud: { ledgerRepository, ledgerRevision: cloudFrame.cloud.ledgerRevision,
        ledgerDigest: cloudFrame.cloud.ledgerDigest, sequence: cloudFrame.cloud.sequence },
      authoredRange,
      absence,
      remote,
    };
    return normalizeOrphanedAbsentAuthoredLaneEvidence({ ...core,
      stableEvidenceDigest: orphanedAbsentAuthoredStableEvidenceDigest(core) });
  }

  function assertPreserved(plan, states = ["OPEN", "CLOSED"]) {
    const sealed = normalizePlan(plan);
    const evidence = sealed.evidence;
    const controller = readController({ git, gitRaw, gh, controllerRoot, ledgerRepository });
    if (canonicalJson(controller) !== canonicalJson(evidence.controller)) {
      throw new Error("Protected retirement controller drifted after planning.");
    }
    const originUrl = git(["remote", "get-url", "origin"]);
    if (repositoryFromRemote(originUrl) !== targetRepository
      || digestValue(originUrl) !== evidence.repository.originUrlDigest) {
      throw new Error("Local target origin drifted from the planned provider repository.");
    }
    const provider = readPull();
    validatePull(provider.pullRequest, evidence, states);
    const remote = readRemote({ git, branch: evidence.remote.branch });
    if (canonicalJson(remote) !== canonicalJson(evidence.remote)) {
      throw new Error("Preserved remote branch drifted.");
    }
    const range = readAuthoredRange({ git, gitRaw, claim: evidence.claim,
      headSha: evidence.remote.headSha });
    if (canonicalJson(range) !== canonicalJson(evidence.authoredRange)) {
      throw new Error("Preserved authored commit range drifted.");
    }
    const absence = readAbsence({ git, gitRaw, commonDirectory, leaseStore, privateTaskRoot,
      branch: evidence.remote.branch, headSha: evidence.remote.headSha,
      marker: evidence.marker, claimId });
    if (absence.registeredWorktreeMatches.length || absence.localBranchPresent
      || absence.writerLeaseMatches.length || absence.privateTaskArtifactMatches.length) {
      throw new Error("A local owner projection appeared after planning.");
    }
    return Object.freeze({ provider, remote, range, absence });
  }

  function requireExactDormant(plan) {
    assertPreserved(plan);
    const live = readCloudFrame();
    if (!live.claim || canonicalJson(live.claim) !== canonicalJson(plan.evidence.claim)
      || Date.parse(live.claim.expiresAt) > now().getTime()
      || live.claim.state !== "dormant-preserved" || live.claim.writeAuthority
      || !live.claim.scopeReserved) {
      throw new Error("Exact cloud claim is not dormant-preserved at the mutation fence.");
    }
    return live;
  }

  function classifyClaim(plan) {
    assertPreserved(plan, ["CLOSED"]);
    const live = readCloudFrame();
    if (live.claim) {
      if (canonicalJson(live.claim) !== canonicalJson(plan.evidence.claim)) {
        throw new Error("Cloud claim drifted before retirement.");
      }
      return { state: "pending" };
    }
    requireRetirementEntry(live, plan);
    const operationReceipt = retirementOperationReceipt(live.latestEntry);
    return { state: "complete", values: {
      operationKey: retirementJournalOperationKey(plan, "claim-retired"),
      claimId,
      requestDigest: live.latestEntry.requestDigest,
      cloudMutation: true,
      disposition: "retired-or-reconciled",
      operationReceiptDigest: operationReceipt.receiptDigest,
      terminalEntryDigest: live.latestEntry.digest,
    } };
  }

  return Object.freeze({
    authorityForbiddenRoots: Object.freeze([repository, controllerRoot, commonDirectory]),
    observe: async () => capture(),
    readState: store.readState,
    writeState: store.writeState,
    withLock: store.withLock,
    classifyPullRequest(plan) {
      const live = assertPreserved(plan).provider.pullRequest;
      if (live.state === "OPEN") return { state: "pending" };
      if (live.state !== "CLOSED") throw new Error("Pull request reached a foreign lifecycle state.");
      return { state: "complete", values: {
        operationKey: retirementJournalOperationKey(plan, "pull-request-closed"),
        pullRequestNumber, pullRequestNodeId: live.nodeId,
        providerMutation: true, disposition: "closed-or-reconciled",
        closedAt: live.closedAt,
      } };
    },
    closePullRequest(plan) {
      const evidence = normalizePlan(plan).evidence;
      assertPreserved(plan);
      return closeGitHubPullWithReconciliation({
        readPull: () => readPull().pullRequest,
        readFreshEvidence: () => readPull().pullRequest,
        closePull: () => gh(["api", "--method", "PATCH",
          `repos/${targetRepository}/pulls/${pullRequestNumber}`, "-f", "state=closed"]),
        validateOpen: pull => validatePull(pull, evidence, ["OPEN"]),
        validateClosed: pull => validatePull(pull, evidence, ["CLOSED"]),
      });
    },
    revalidateDormantClaim: requireExactDormant,
    classifyClaim,
    retireClaim(plan) {
      const live = requireExactDormant(plan);
      const request = retirementRequest(plan, live.cloud);
      const result = invokeCloud({ action: "retire", ledgerRepository, request, environment });
      if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
        || result.operationReceipt?.operation !== "retire"
        || result.operationReceipt?.idempotencyKey !== digestValue(retirementOperationKey(plan))) {
        throw new Error("Cloud retirement returned a foreign operation receipt.");
      }
      assertPreserved(plan, ["CLOSED"]);
      return result;
    },
    verifyTerminal(plan) {
      assertPreserved(plan, ["CLOSED"]);
      const live = readCloudFrame();
      if (live.claim) throw new Error("Retired claim remains in the current inventory.");
      requireRetirementEntry(live, plan);
      const terminalEvidenceDigest = retirementTerminalEvidenceDigest(plan, {
        terminalEntryDigest: live.latestEntry.digest,
        operationReceiptDigest: retirementOperationReceipt(live.latestEntry).receiptDigest,
      });
      return { terminalEvidenceDigest };
    },
  });

  function requireRetirementEntry(live, plan) {
    const entry = live.latestEntry;
    const retirement = entry?.claimCore?.retirement;
    const request = retirementRequest(plan, { ledgerDigest: digestValue("terminal-ledger-placeholder") });
    const entryCore = entry && { ...entry };
    if (entryCore) delete entryCore.digest;
    const prior = live.entries.at(-2);
    if (entry?.action !== "retire" || entry.claimId !== claimId
      || prior?.digest !== plan.evidence.claim.transitionDigest
      || entry.idempotencyKey !== digestValue(retirementOperationKey(plan))
      || entry.requestDigest !== retirementRequestDigest(plan)
      || entry.claimDigest !== digestValue(entry.claimCore)
      || entry.digest !== digestValue(entryCore)
      || entry.claimCore?.state !== "retired" || retirement?.reason !== "abandoned"
      || retirement.finalRevision !== plan.evidence.claim.laneRevision
      || retirement.reviewRequestId !== plan.evidence.claim.reviewRequestId
      || retirement.bytesDigest !== request.bytesDigest
      || retirement.namedChecksDigest !== request.namedChecksDigest
      || retirement.handoffEvidenceDigest !== request.handoffEvidenceDigest
      || retirement.integrationReceiptDigest !== null
      || retirement.retiredAt !== entry.evaluationTime
      || entry.repositoryId !== plan.evidence.claim.repositoryId
      || entry.claimCore.actorId !== plan.evidence.claim.actorId
      || entry.claimCore.deviceId !== plan.evidence.claim.deviceId
      || entry.claimCore.sessionId !== plan.evidence.claim.sessionId
      || entry.claimCore.repositoryId !== plan.evidence.claim.repositoryId
      || entry.claimCore.workItemId !== plan.evidence.claim.workItemId
      || entry.claimCore.canonicalBaseRevision !== plan.evidence.claim.canonicalBaseRevision
      || entry.claimCore.laneRevision !== plan.evidence.claim.laneRevision
      || entry.claimCore.writeSetDigest !== plan.evidence.claim.writeSetDigest
      || entry.claimCore.leaseEpoch !== plan.evidence.claim.leaseEpoch
      || entry.claimCore.transitionCounter !== plan.evidence.claim.transitionCounter + 1) {
      throw new Error("Cloud claim reached a foreign terminal operation.");
    }
    return entry;
  }
}

function projectPull(pull, marker) {
  return Object.freeze({
    number: pull.number, nodeId: pull.nodeId, url: pull.url, state: pull.state,
    isDraft: pull.isDraft, mergedAt: pull.mergedAt, closedAt: pull.closedAt,
    branch: pull.branch, headSha: pull.headSha, baseRef: pull.baseRef, baseSha: pull.baseSha,
    authorLogin: pull.authorLogin,
    headRepository: pull.headRepository.fullName, baseRepository: pull.baseRepository.fullName,
    restAutoMergeRequest: pull.restAutoMergeRequest, autoMergeRequest: pull.autoMergeRequest,
    isInMergeQueue: pull.isInMergeQueue, mergeQueueEntry: pull.mergeQueueEntry,
    immutableDigest: gitHubPullImmutableDigest(pull), markerDigest: digestValue(marker),
  });
}

function projectMarker(value) {
  return Object.freeze({
    schema: value.schema, status: value.status, epoch: value.epoch,
    sessionId: value.sessionId, device: value.device, scope: value.scope,
    branch: value.branch, baseSha: value.baseSha, fenceSha: value.fenceSha,
    admission: Object.freeze({ status: value.admission?.status,
      semanticScope: value.admission?.semanticScope,
      declaredWriteSet: value.admission?.declaredWriteSet,
      writeSetDigest: value.admission?.writeSetDigest,
      manifestDigest: value.admission?.manifestDigest }),
    cloudAuthority: Object.freeze({ ledgerRepository: value.cloudAuthority?.ledgerRepository,
      targetRepository: value.cloudAuthority?.targetRepository,
      claimId: value.cloudAuthority?.claimId, claimDigest: value.cloudAuthority?.claimDigest,
      operationReceiptDigest: value.cloudAuthority?.operationReceiptDigest,
      canonicalBaseSha: value.cloudAuthority?.canonicalBaseSha,
      laneRevision: value.cloudAuthority?.laneRevision,
      writeSetDigest: value.cloudAuthority?.writeSetDigest,
      reviewRequestId: value.cloudAuthority?.reviewRequestId,
      leaseEpoch: value.cloudAuthority?.leaseEpoch,
      transitionCounter: value.cloudAuthority?.transitionCounter,
      state: value.cloudAuthority?.state, expiresAt: value.cloudAuthority?.expiresAt }),
    taskAuthority: Object.freeze({ schema: value.taskAuthority?.schema,
      authoritySubjectId: value.taskAuthority?.authoritySubjectId,
      proofAdapterId: value.taskAuthority?.proofAdapterId,
      generation: value.taskAuthority?.generation, publicKey: value.taskAuthority?.publicKey,
      publicKeyDigest: value.taskAuthority?.publicKeyDigest,
      laneBindingDigest: value.taskAuthority?.laneBindingDigest,
      bindingDigest: value.taskAuthority?.bindingDigest }),
  });
}

function projectClaim(value, entry) {
  if (entry.claimId !== value.claimId
    || entry.claimDigest !== (value.fenceRevision || value.claimDigest)
    || entry.digest !== (value.transitionDigest || value.ledgerRevision)
    || entry.claimCore?.transitionCounter !== value.transitionCounter) {
    throw new Error("Cloud inventory and validated claim lineage do not join.");
  }
  return Object.freeze({
    claimId: value.claimId, claimDigest: entry.claimDigest,
    transitionDigest: entry.digest,
    operationReceiptDigest: value.operationReceiptDigest,
    state: value.state, recordedState: entry.claimCore.state,
    writeAuthority: value.writeAuthority, scopeReserved: value.scopeReserved,
    actorId: value.actorId, repositoryId: value.repositoryId, workItemId: value.workItemId,
    deviceId: value.deviceId, sessionId: value.sessionId,
    canonicalBaseRevision: value.canonicalBaseRevision, laneRevision: value.laneRevision,
    declaredWriteScope: value.declaredWriteScope, writeSetDigest: value.writeSetDigest,
    leaseEpoch: value.leaseEpoch, transitionCounter: value.transitionCounter,
    reviewRequestId: value.reviewRequestId, expiresAt: value.expiresAt,
    integration: value.integration || null,
  });
}

export function readAuthoredRange({ git, gitRaw = git, claim, headSha }) {
  try { git(["merge-base", "--is-ancestor", claim.laneRevision, headSha]); }
  catch { throw new Error("Remote head is not a descendant of the claim lane revision."); }
  const revisions = lines(git(["rev-list", "--reverse", "--ancestry-path",
    `${claim.laneRevision}..${headSha}`]));
  if (!revisions.length || revisions.length > 64 || revisions.at(-1) !== headSha) {
    throw new Error("Authored descendant range is empty, incomplete, or exceeds its bound.");
  }
  let parentSha = claim.laneRevision;
  const commits = revisions.map(revision => {
    const parents = lines(git(["show", "-s", "--format=%P", revision]).replaceAll(" ", "\n"));
    if (parents.length !== 1 || parents[0] !== parentSha) {
      throw new Error("Authored descendant range is not strictly linear.");
    }
    const commit = Object.freeze({ sha: revision, parentSha: parents[0],
      treeSha: git(["rev-parse", `${revision}^{tree}`]),
      changedPaths: Object.freeze(nulFields(gitRaw(["diff-tree", "--no-commit-id", "--name-only",
        "--no-renames", "-r", "-z", revision])).sort()),
      message: git(["show", "-s", "--format=%B", revision]) });
    parentSha = revision;
    return commit;
  });
  const fenceParents = lines(git(["show", "-s", "--format=%P", claim.laneRevision]).replaceAll(" ", "\n"));
  if (fenceParents.length !== 1) throw new Error("Claim lane revision is not a single-parent coordination commit.");
  const changedPaths = [...new Set(commits.flatMap(commit => commit.changedPaths))].sort();
  const core = { fenceSha: claim.laneRevision, fenceParentSha: fenceParents[0],
    fenceTreeSha: git(["rev-parse", `${claim.laneRevision}^{tree}`]),
    baseTreeSha: git(["rev-parse", `${claim.canonicalBaseRevision}^{tree}`]),
    headSha, headTreeSha: commits.at(-1).treeSha,
    commits: Object.freeze(commits), changedPaths: Object.freeze(changedPaths) };
  return Object.freeze({ ...core, rangeDigest: digestValue(core) });
}

function readRemote({ git, branch }) {
  const matches = lines(git(["ls-remote", "--heads", "origin", branch]));
  if (matches.length !== 1) throw new Error("Remote branch is missing or ambiguous.");
  return Object.freeze({ branch, headSha: matches[0].split(/\s+/u)[0] });
}

function readController({ git, gitRaw, gh, controllerRoot, ledgerRepository }) {
  const headSha = git(["rev-parse", "HEAD"], controllerRoot);
  if (repositoryFromRemote(git(["remote", "get-url", "origin"], controllerRoot)) !== ledgerRepository) {
    throw new Error("Controller origin does not bind the collaboration ledger repository.");
  }
  const remote = lines(git(["ls-remote", "--heads", "origin", "main"], controllerRoot));
  if (remote.length !== 1) throw new Error("Controller remote main is missing or ambiguous.");
  const protection = JSON.parse(gh(["api", `repos/${ledgerRepository}/branches/main/protection`]));
  const protectedBranch = protection?.required_status_checks?.strict === true
    && Boolean(protection?.required_pull_request_reviews);
  if (!protectedBranch) throw new Error("Controller main branch protection is incomplete.");
  return Object.freeze({ branch: git(["branch", "--show-current"], controllerRoot), headSha,
    originMainSha: git(["rev-parse", "origin/main"], controllerRoot),
    remoteMainSha: remote[0].split(/\s+/u)[0],
    clean: gitRaw(["status", "--porcelain=v1", "--untracked-files=all"], controllerRoot) === "",
    protected: true, protectionDigest: digestValue(protection),
    runtimeDigest: digestValue(RUNTIME_FILES.map(file => ({ file,
      digest: digestValue(readFileSync(path.join(controllerRoot, file))) }))),
  });
}

function readAbsence({ git, gitRaw, commonDirectory, leaseStore, privateTaskRoot,
  branch, headSha, marker, claimId }) {
  const worktreeInventory = parseWorktrees(gitRaw(["worktree", "list", "--porcelain", "-z"]));
  const registeredWorktreeMatches = worktreeInventory.filter(item =>
    item.branch === `refs/heads/${branch}` || item.headSha === headSha).map(() => "matching-worktree");
  const localRefs = lines(git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]));
  const localBranchPresent = localRefs.some(line => line.startsWith(`refs/heads/${branch} `));
  const registry = leaseStore.read();
  const writerLeaseMatches = Object.values(registry.leases || {}).filter(lease =>
    lease.branch === branch || lease.sessionId === marker.sessionId
      || lease.cloudAuthority?.claimId === claimId).map(() => "matching-writer-lease");
  const privateInventory = scanPrivateTaskRoot(privateTaskRoot, marker);
  const base = {
    registeredWorktreeMatches: Object.freeze(registeredWorktreeMatches), localBranchPresent,
    writerLeaseMatches: Object.freeze(writerLeaseMatches),
    privateTaskArtifactMatches: privateInventory.matches,
    registryDigest: digestValue(worktreeInventory), localRefsDigest: digestValue(localRefs),
    writerLeaseRegistryDigest: digestValue(registry),
    privateTaskInventoryDigest: privateInventory.inventoryDigest,
  };
  return Object.freeze({ ...base, absenceDigest: digestValue(base) });
}

export function scanPrivateTaskRoot(root, marker) {
  const records = [], matches = [];
  let count = 0;
  const visit = (directory, depth) => {
    if (depth > 4) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      count += 1;
      if (count > MAX_PRIVATE_ENTRIES) throw new Error("Private task inventory exceeds its bound.");
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        records.push({ kind: "directory", nameDigest: digestValue(path.relative(root, candidate)) });
        if (entry.name === marker.sessionId) matches.push("matching-session-directory");
        visit(candidate, depth + 1);
      } else if (entry.isFile() && entry.name === "task-authority.json") {
        let capability;
        try { capability = JSON.parse(readFileSync(candidate, "utf8")); } catch { capability = null; }
        const authoritySubjectId = capability?.authoritySubjectId || null;
        records.push({ kind: "task-authority", authoritySubjectId });
        if (authoritySubjectId === marker.taskAuthority.authoritySubjectId) {
          matches.push("matching-authority-subject");
        }
      }
    }
  };
  visit(root, 0);
  return Object.freeze({ matches: Object.freeze([...new Set(matches)].sort()),
    inventoryDigest: digestValue(records.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))) });
}

function validatePull(pull, evidence, states) {
  assertGitHubPullQueueFence(pull);
  if (!states.includes(pull.state) || pull.isDraft !== true || pull.mergedAt !== null
    || pull.number !== evidence.pullRequest.number || pull.nodeId !== evidence.pullRequest.nodeId
    || pull.url !== evidence.pullRequest.url || pull.branch !== evidence.pullRequest.branch
    || pull.headSha !== evidence.pullRequest.headSha || pull.baseRef !== "main"
    || pull.baseSha !== evidence.pullRequest.baseSha
    || gitHubPullImmutableDigest(pull) !== evidence.pullRequest.immutableDigest) {
    throw new Error("Pull request drifted from the exact open-draft subject.");
  }
  const marker = parseWriterLeasePullRequestBody(pull.body);
  if (!marker || digestValue(projectMarker(marker)) !== evidence.pullRequest.markerDigest) {
    throw new Error("Pull-request writer marker drifted.");
  }
  return pull;
}

function parseWorktrees(raw) {
  const records = [];
  let record = null;
  for (const field of String(raw).split("\0").filter(Boolean)) {
    if (field.startsWith("worktree ")) {
      if (record) records.push(record);
      record = { pathDigest: digestValue(field.slice(9)) };
    } else if (record && field.startsWith("HEAD ")) record.headSha = field.slice(5);
    else if (record && field.startsWith("branch ")) record.branch = field.slice(7);
  }
  if (record) records.push(record);
  return records;
}

function lines(value) { return String(value || "").split(/\r?\n/u).map(item => item.trim()).filter(Boolean); }
function nulFields(value) { return String(value || "").split("\0").filter(item => item.length > 0); }
function repositoryFromRemote(value) {
  const remote = String(value || "").trim().replace(/\.git$/u, "");
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+)$/u.exec(remote);
  if (!match) throw new Error("Local target origin is not a canonical GitHub repository.");
  return repositoryName(match[1]);
}
function realDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${label} must be absolute.`);
  const requested = path.resolve(value), requestedStat = lstatSync(requested);
  if (!requestedStat.isDirectory() || requestedStat.isSymbolicLink()) {
    throw new Error(`${label} must be a real non-symlink directory.`);
  }
  const result = realpathSync(requested), stat = lstatSync(result);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real directory.`);
  return result;
}
function externalJson(value, forbiddenRoots) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.extname(value) !== ".json") {
    throw new Error("State path must be an absolute JSON path.");
  }
  const result = path.resolve(value);
  for (const root of forbiddenRoots) {
    const relative = path.relative(root, result);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error("State path must remain outside repositories and Git metadata.");
    }
  }
  return result;
}
function repositoryName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) {
    throw new Error("Repository identity is invalid.");
  }
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`);
  return value;
}
function digest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
