// Responsibility: Join Git, provider, lease, cloud, and durable state for exact retirement.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, digestValue, validateLedger } from "./cloud-collaboration-primitives.mjs";
import { normalizeResumePlan, normalizeResumeState, normalizeState, RESUME_STATE_SCHEMA, STATE_SCHEMA }
  from "./admitted-empty-abandoned-owner-retirement-contract.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";

const CONTROLLER_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUNTIME_FILES = Object.freeze([
  "scripts/admitted-empty-abandoned-owner-retirement-contract.mjs",
  "scripts/admitted-empty-abandoned-owner-retirement-controller.mjs",
  "scripts/admitted-empty-abandoned-owner-retirement-repository-adapter.mjs",
  "scripts/admitted-empty-abandoned-owner-retirement.mjs",
]);

export function createRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = absolute(options.repository, "repository");
  const subjectPath = absolute(options.subjectWorktree, "subject worktree");
  const authoredPath = absolute(options.authoredWorktree, "authored worktree");
  const controllerRoot = absolute(options.controllerRoot || CONTROLLER_ROOT, "controller root");
  if (controllerRoot !== CONTROLLER_ROOT) throw new Error("Retirement requires its installed controller root.");
  const targetRepository = repositoryName(options.targetRepository);
  const ledgerRepository = repositoryName(options.ledgerRepository || "huijoohwee/agentic-canvas-os");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request number");
  const claimId = digest(options.claimId, "claim ID");
  const statePath = safeStatePath(options.statePath);
  const sourceStatePath = options.sourceStatePath
    ? safeStatePath(options.sourceStatePath) : null;
  if (sourceStatePath === statePath) throw new Error("Resume source and target state paths must remain distinct.");
  const lockPath = `${statePath}.lock`;
  const now = dependencies.now || (() => new Date());
  const environment = dependencies.environment || process.env;
  const execute = dependencies.execute || ((command, args, cwd = repository) => execFileSync(command, args,
    { cwd, encoding: "utf8", env: environment, maxBuffer: 32 * 1024 * 1024, timeout: 60_000 }));
  const git = dependencies.git || ((cwd, args) => String(execute("git", ["-C", cwd, ...args], cwd)).trim());
  const gitRaw = dependencies.gitRaw || ((cwd, args) => String(execute("git", ["-C", cwd, ...args], cwd)));
  const gh = dependencies.gh || (args => String(execute("gh", args, repository)).trim());
  const invokeCloud = dependencies.invokeCloud || invokeRepositoryCloudAction;
  const commonDirectory = path.resolve(repository, git(repository,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const taskAuthorityFile = options.taskAuthorityFile
    ? safeTaskAuthorityPath(options.taskAuthorityFile, { repository, subjectPath, authoredPath,
      controllerRoot, commonDirectory }) : null;
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityFile,
  });

  function cloudStatus() {
    const value = dependencies.readCloud ? dependencies.readCloud()
      : invokeCloud({ action: "status", ledgerRepository,
        request: { targetRepository }, environment });
    if (value?.schema !== "agentic-cloud-collaboration-result/v1" || value.ok !== true
      || !Array.isArray(value.claims) || !Number.isSafeInteger(value.sequence)) {
      throw new Error("Cloud status is malformed.");
    }
    return value;
  }

  function subjectProjection() {
    const registered = worktrees(gitRaw(repository, ["worktree", "list", "--porcelain", "-z"]));
    if (!registered.includes(subjectPath)) throw new Error("Fence-only subject worktree is not registered.");
    const branch = git(subjectPath, ["branch", "--show-current"]);
    const lease = leaseStore.read(branch);
    if (!lease) throw new Error("Fence-only subject has no writer lease.");
    const headSha = git(subjectPath, ["rev-parse", "HEAD"]);
    const headTreeSha = git(subjectPath, ["rev-parse", "HEAD^{tree}"]);
    const parents = git(subjectPath, ["show", "-s", "--format=%P", "HEAD"]).split(/\s+/u).filter(Boolean);
    const baseSha = parents.length === 1 ? parents[0] : "";
    const baseTreeSha = baseSha ? git(subjectPath, ["rev-parse", `${baseSha}^{tree}`]) : "";
    const status = gitRaw(subjectPath, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const changedPaths = git(subjectPath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
      .split("\n").filter(Boolean).sort();
    const remoteHeadSha = remoteHead(git, repository, branch);
    return { repository: targetRepository, path: subjectPath, branch, headSha, headTreeSha,
      baseSha, baseTreeSha, parentShas: parents, changedPaths, clean: status === "", registered: true,
      remoteHeadSha, stateDigest: digestValue({ branch, headSha, headTreeSha, status, remoteHeadSha }),
      lease: { status: lease.status, sessionId: lease.sessionId, branch: lease.branch,
        worktreePath: path.resolve(lease.worktreePath), baseSha: lease.baseSha, fenceSha: lease.fenceSha,
        expiresAt: lease.expiresAt, admissionStatus: lease.admission?.status,
        claimId: lease.cloudAuthority?.claimId, digest: digestValue(lease) }, rawLease: lease };
  }

  function authoredProjection() {
    const registered = worktrees(gitRaw(repository, ["worktree", "list", "--porcelain", "-z"]));
    if (!registered.includes(authoredPath)) throw new Error("Authored preservation lane is not registered.");
    const branch = git(authoredPath, ["branch", "--show-current"]);
    const headSha = git(authoredPath, ["rev-parse", "HEAD"]);
    const treeSha = git(authoredPath, ["rev-parse", "HEAD^{tree}"]);
    const status = gitRaw(authoredPath, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const core = { path: authoredPath, branch, headSha, treeSha, clean: status === "", registered: true,
      statusDigest: digestValue(status) };
    return { ...core, stateDigest: digestValue(core) };
  }

  function pullProjection() {
    const value = JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--repo", targetRepository,
      "--json", "number,id,url,state,isDraft,mergedAt,closedAt,headRefName,headRefOid,baseRefName,baseRefOid"]));
    return { number: value.number, nodeId: value.id, url: value.url, state: value.state,
      isDraft: value.isDraft, mergedAt: value.mergedAt, closedAt: value.closedAt,
      headBranch: value.headRefName, headSha: value.headRefOid,
      baseBranch: value.baseRefName, baseSha: value.baseRefOid };
  }

  function claimProjection(status = cloudStatus()) {
    const matches = status.claims.filter(item => item.claimId === claimId);
    if (matches.length > 1) throw new Error("Cloud claim cardinality is ambiguous.");
    if (matches.length === 0) return null;
    const claim = matches[0];
    const branch = git(subjectPath, ["branch", "--show-current"]);
    const lease = leaseStore.read(branch);
    if (!ownerIdentifierMatches("device", claim.deviceId, lease?.device)) {
      throw new Error("Cloud claim device identity does not match the local owner.");
    }
    if (!ownerIdentifierMatches("session", claim.sessionId, lease?.sessionId)) {
      throw new Error("Cloud claim session identity does not match the local owner.");
    }
    return { claimId, claimDigest: claim.fenceRevision || claim.claimDigest,
      state: claim.state, writeAuthority: claim.writeAuthority, scopeReserved: claim.scopeReserved,
      laneRevision: claim.laneRevision, canonicalBaseRevision: claim.canonicalBaseRevision,
      transitionCounter: claim.transitionCounter, reviewRequestId: claim.reviewRequestId || null,
      expiresAt: new Date(claim.expiresAt).toISOString() };
  }

  function controllerProjection() {
    const headSha = git(controllerRoot, ["rev-parse", "HEAD"]);
    const originMainSha = git(controllerRoot, ["rev-parse", "origin/main"]);
    const treeSha = git(controllerRoot, ["rev-parse", "HEAD^{tree}"]);
    const clean = gitRaw(controllerRoot, ["status", "--porcelain=v1", "--untracked-files=all"]) === "";
    const runtimeDigest = digestValue(RUNTIME_FILES.map(file => ({ file,
      digest: digestValue(readFileSync(path.join(controllerRoot, file))) })));
    return { headSha, originMainSha, treeSha, runtimeDigest, clean, protected: headSha === originMainSha };
  }

  function assertStatic(plan) {
    const subject = subjectProjection(), authored = authoredProjection(), pull = pullProjection();
    if (subject.stateDigest !== plan.subject.stateDigest || authored.stateDigest !== plan.authoredLane.stateDigest
      || digestValue(pull) !== digestValue({ ...plan.subject.pullRequest, closedAt: pull.closedAt })) {
      throw new Error("Retirement subject or preserved authored lane drifted.");
    }
    const controller = controllerProjection();
    if (digestValue(controller) !== digestValue(plan.controller)) throw new Error("Protected controller drifted after planning.");
    return { subject, authored, pull };
  }

  function assertPreserved(plan) {
    const subject = subjectProjection(), authored = authoredProjection();
    if (subject.stateDigest !== plan.subject.stateDigest || authored.stateDigest !== plan.authoredLane.stateDigest) {
      throw new Error("Fence-only subject or authored preservation lane drifted.");
    }
    const controller = controllerProjection();
    if (digestValue(controller) !== digestValue(plan.controller)) throw new Error("Protected controller drifted after planning.");
    return { subject, authored };
  }

  function readSourceState() {
    if (!sourceStatePath) throw new Error("Retirement resume requires a distinct source state path.");
    const source = readJson(sourceStatePath);
    if (!source) throw new Error("Retirement resume source state is absent.");
    return normalizeState(source);
  }

  function resumeFrame(rawPlan = null) {
    const plan = rawPlan ? normalizeResumePlan(rawPlan) : null;
    const sourceState = readSourceState();
    if (sourceState.phase !== "pull-request-closed") {
      throw new Error("Retirement resume source did not stop after pull-request closure.");
    }
    if (plan && sourceState.stateDigest !== plan.sourceState.stateDigest) {
      throw new Error("Retirement resume source journal drifted.");
    }
    const sourcePlan = sourceState.plan, subject = subjectProjection(), authored = authoredProjection();
    const resumedRelease = plan && isResumedReleasedLease(subject.rawLease, plan);
    if (subject.stateDigest !== sourcePlan.subject.stateDigest
      || authored.stateDigest !== sourcePlan.authoredLane.stateDigest
      || (!resumedRelease && digestValue(subject.rawLease) !== sourcePlan.subject.lease.digest)) {
      throw new Error("Retirement resume subject, lease, or authored lane drifted.");
    }
    const pull = pullProjection();
    assertPullIdentity(sourcePlan.subject.pullRequest, pull);
    if (pull.state !== "CLOSED" || pull.mergedAt !== null || !pull.closedAt) {
      throw new Error("Retirement resume requires the exact closed unmerged ownership pull request.");
    }
    const cloud = cloudStatus(), claim = claimProjection(cloud);
    if (claim) throw new Error("Retirement resume requires the exact cloud claim to remain absent.");
    const retirementEntry = requireRetirementEntry({ status: cloud, plan: sourcePlan, gh, dependencies });
    const bindingDigest = subject.rawLease.taskAuthority?.bindingDigest;
    if (!/^[0-9a-f]{64}$/u.test(String(bindingDigest || ""))) {
      throw new Error("Retirement resume requires the original task authority binding.");
    }
    if (!taskAuthorityFile) throw new Error("Retirement resume requires an explicit task authority capability.");
    if (!resumedRelease) {
      const authorizedLease = leaseStore.assertTaskAuthority({ branch: sourcePlan.subject.branch,
        operation: "admitted-empty-abandoned-owner-retirement-resume-plan" });
      if (digestValue(authorizedLease) !== digestValue(subject.rawLease)) {
        throw new Error("Retirement resume task authority proof did not bind the observed lease.");
      }
    }
    const controller = controllerProjection();
    if (controller.headSha !== sourcePlan.controller.headSha) {
      assertControllerDescendant(sourcePlan.controller, controller, git, controllerRoot);
    }
    const recovery = {
      sourceStateDigest: sourceState.stateDigest,
      sourcePlanDigest: sourcePlan.planDigest,
      claimAbsent: true,
      retirementEntryDigest: digestValue(retirementEntry),
      pullRequestState: pull.state,
      pullRequestClosedAt: new Date(pull.closedAt).toISOString(),
      leaseStatus: resumedRelease ? plan.recovery.leaseStatus : subject.rawLease.status,
      leaseDigest: resumedRelease ? plan.recovery.leaseDigest : digestValue(subject.rawLease),
      taskAuthorityBindingDigest: bindingDigest,
      subjectStateDigest: subject.stateDigest,
      authoredLaneStateDigest: authored.stateDigest,
      remoteHeadSha: subject.remoteHeadSha,
    };
    if (recovery.pullRequestClosedAt !== sourceState.receipts["pull-request-closed"].closedAt) {
      throw new Error("Retirement resume pull-request close receipt drifted.");
    }
    if (plan && digestValue(recovery) !== digestValue(plan.recovery)) {
      throw new Error("Retirement resume evidence drifted after planning.");
    }
    if (plan && resumedRelease && controller.headSha !== plan.controller.headSha) {
      assertControllerDescendant(plan.controller, controller, git, controllerRoot);
    } else if (plan && digestValue(controller) !== digestValue(plan.controller)) {
      throw new Error("Retirement resume controller drifted before local release.");
    }
    return { sourceState, sourcePlan, subject, authored, pull, cloud, controller, recovery,
      resumedRelease: Boolean(resumedRelease) };
  }

  return Object.freeze({
    async observe() {
      const cloud = cloudStatus();
      const subject = subjectProjection();
      const pullRequest = pullProjection();
      const claim = claimProjection(cloud);
      if (!claim) throw new Error("Exact cloud claim is absent before planning.");
      return { observedAt: now().toISOString(), subject: { ...subject, claim, pullRequest,
        rawLease: undefined }, authoredLane: authoredProjection(), controller: controllerProjection(),
      cloud: { ledgerRepository, ledgerRevision: cloud.ledgerRevision,
        ledgerDigest: cloud.ledgerDigest, sequence: cloud.sequence } };
    },
    observeResume() {
      const frame = resumeFrame();
      return { observedAt: now().toISOString(), sourceState: frame.sourceState,
        controller: frame.controller, recovery: frame.recovery,
        cloud: { ledgerRepository, ledgerRevision: frame.cloud.ledgerRevision,
          ledgerDigest: frame.cloud.ledgerDigest, sequence: frame.cloud.sequence } };
    },
    readState: () => readJson(statePath),
    writeState({ expected, next }) {
      const current = readJson(statePath);
      if ((current?.stateDigest || null) !== (expected?.stateDigest || null)
        || (current?.schema || null) !== (expected?.schema || null)) {
        throw new Error("Retirement state changed before compare-and-swap.");
      }
      if (current && current.schema !== next?.schema) {
        throw new Error("Retirement state schema cannot change in place.");
      }
      const normalized = normalizePersistedState(next);
      writeAtomic(statePath, normalized); return normalized;
    },
    withLock(context, action) { return withLock(lockPath, context, action); },
    classifyClaim(plan) {
      const { subject } = assertStatic(plan);
      const cloud = cloudStatus(), claim = claimProjection(cloud);
      if (claim && digestValue(claim) !== digestValue(plan.subject.claim)) throw new Error("Cloud claim drifted.");
      if (!claim) requireRetirementEntry({ status: cloud, plan, gh, dependencies });
      return claim ? { state: "pending" } : { state: "complete", values: effectValues("claim-retired", {
        claimId, cloudMutation: true, ledgerRevision: cloud.ledgerRevision, ledgerDigest: cloud.ledgerDigest,
        subjectStateDigest: subject.stateDigest }) };
    },
    retireClaim(plan) {
      const state = assertStatic(plan), cloud = cloudStatus(), claim = claimProjection(cloud);
      if (!claim) return;
      if (digestValue(claim) !== digestValue(plan.subject.claim)) throw new Error("Cloud claim drifted before retirement.");
      const request = { targetRepository, claimId, expectedFenceRevision: claim.claimDigest,
        expectedTransitionCounter: claim.transitionCounter, expectedLedgerDigest: cloud.ledgerDigest,
        deviceId: state.subject.rawLease.device, sessionId: state.subject.rawLease.sessionId,
        reason: "abandoned", finalRevision: claim.laneRevision, reviewRequestId: claim.reviewRequestId,
        bytesDigest: digestValue({ subject: plan.subject.stateDigest, authored: plan.authoredLane.stateDigest }),
        namedChecksDigest: digestValue({ fenceOnly: true, changedPaths: plan.subject.changedPaths }),
        handoffEvidenceDigest: digestValue({ subjectBranch: plan.subject.branch,
          authoredLane: plan.authoredLane.stateDigest }),
        idempotencyKey: claimOperationKey(plan) };
      const result = invokeCloud({ action: "retire", ledgerRepository, request, environment });
      if (result?.ok !== true || result.operationReceipt?.operation !== "retire") throw new Error("Cloud retirement failed.");
      const preserved = assertPreserved(plan);
      if (state.subject.stateDigest !== preserved.subject.stateDigest
        || state.authored.stateDigest !== preserved.authored.stateDigest) throw new Error("Preserved lanes changed during cloud retirement.");
    },
    classifyPullRequest(plan) {
      assertPreserved(plan);
      const pull = pullProjection();
      assertPullIdentity(plan.subject.pullRequest, pull);
      if (pull.state === "OPEN") return { state: "pending" };
      if (pull.state !== "CLOSED" || pull.mergedAt !== null) throw new Error("Pull request reached a foreign terminal state.");
      return { state: "complete", values: effectValues("pull-request-closed", {
        pullRequestNumber, closedAt: new Date(pull.closedAt).toISOString(), providerMutation: true,
        remoteBranchPreserved: remoteHead(git, repository, plan.subject.branch) === plan.subject.remoteHeadSha }) };
    },
    closePullRequest(plan) {
      assertPreserved(plan);
      const pull = pullProjection(); assertPullIdentity(plan.subject.pullRequest, pull);
      if (pull.state === "CLOSED") return;
      execute("gh", ["pr", "close", "--repo", targetRepository, pull.url], repository);
    },
    classifyOwnerReleased(plan) {
      assertPreserved(plan);
      const lease = leaseStore.read(plan.subject.branch);
      if (isReleasedLease(lease, plan)) return { state: "complete", values: effectValues("owner-released", {
        leaseDigest: digestValue(lease), localMutation: true, subjectPreserved: true }) };
      if (!lease || digestValue(lease) !== plan.subject.lease.digest) throw new Error("Local lease drifted.");
      return { state: "pending" };
    },
    releaseOwner(plan) {
      assertPreserved(plan);
      const current = leaseStore.read(plan.subject.branch);
      if (isReleasedLease(current, plan)) return;
      if (!current || digestValue(current) !== plan.subject.lease.digest) throw new Error("Local lease drifted before release.");
      const completedAt = now().toISOString();
      const retirement = { schema: "agentic-admitted-empty-abandoned-owner-local-release/v1",
        status: "retired-preserved", planDigest: plan.planDigest, claimId,
        subjectStateDigest: plan.subject.stateDigest, authoredLaneStateDigest: plan.authoredLane.stateDigest,
        originalLeaseDigest: plan.subject.lease.digest, completedAt };
      retirement.receiptDigest = digestValue(retirement);
      leaseStore.release({ sessionId: current.sessionId, branch: current.branch,
        expectedLease: current, status: "released", timestamp: completedAt,
        values: { admission: null, cloudAuthority: null, admittedEmptyAbandonedOwnerRetirement: retirement } });
    },
    classifyResumedOwnerReleased(plan) {
      const frame = resumeFrame(plan), lease = frame.subject.rawLease;
      if (frame.resumedRelease) return { state: "complete", values: effectValues("owner-released", {
        leaseDigest: digestValue(lease), localMutation: true, subjectPreserved: true,
        sourceStateDigest: plan.sourceState.stateDigest }) };
      if (!lease || digestValue(lease) !== frame.sourcePlan.subject.lease.digest) {
        throw new Error("Local lease drifted before resumed release.");
      }
      return { state: "pending" };
    },
    releaseResumedOwner(plan) {
      const frame = resumeFrame(plan), current = frame.subject.rawLease;
      if (frame.resumedRelease) return;
      if (!current || digestValue(current) !== frame.sourcePlan.subject.lease.digest) {
        throw new Error("Local lease drifted before resumed release.");
      }
      const completedAt = now().toISOString();
      const retirement = { schema: "agentic-admitted-empty-abandoned-owner-local-release/v1",
        status: "retired-preserved", planDigest: frame.sourcePlan.planDigest,
        resumePlanDigest: plan.planDigest, sourceStateDigest: plan.sourceState.stateDigest, claimId,
        subjectStateDigest: frame.sourcePlan.subject.stateDigest,
        authoredLaneStateDigest: frame.sourcePlan.authoredLane.stateDigest,
        originalLeaseDigest: frame.sourcePlan.subject.lease.digest, completedAt };
      retirement.receiptDigest = digestValue(retirement);
      leaseStore.release({ sessionId: current.sessionId, branch: current.branch,
        expectedLease: current, status: "released", timestamp: completedAt,
        values: { admission: null, cloudAuthority: null,
          admittedEmptyAbandonedOwnerRetirement: retirement } });
    },
    verifyTerminal(plan) {
      const subject = subjectProjection(), authored = authoredProjection(), pull = pullProjection();
      const status = cloudStatus(), claim = claimProjection(status), lease = leaseStore.read(plan.subject.branch);
      if (!claim) requireRetirementEntry({ status, plan, gh, dependencies });
      if (claim || pull.state !== "CLOSED" || pull.mergedAt !== null || !isReleasedLease(lease, plan)
        || subject.stateDigest !== plan.subject.stateDigest || authored.stateDigest !== plan.authoredLane.stateDigest
        || remoteHead(git, repository, plan.subject.branch) !== plan.subject.remoteHeadSha) {
        throw new Error("Terminal retirement evidence did not converge.");
      }
      return { terminalEvidenceDigest: digestValue({ claimAbsent: true, pullState: pull.state,
        leaseDigest: digestValue(lease), subjectStateDigest: subject.stateDigest,
        authoredLaneStateDigest: authored.stateDigest, remoteHeadSha: subject.remoteHeadSha }) };
    },
    verifyResumedTerminal(plan) {
      const frame = resumeFrame(plan), lease = frame.subject.rawLease;
      if (!frame.resumedRelease) {
        throw new Error("Resumed terminal retirement evidence did not converge.");
      }
      return { terminalEvidenceDigest: digestValue({ claimAbsent: true, pullState: frame.pull.state,
        sourceStateDigest: frame.sourceState.stateDigest, resumePlanDigest: plan.planDigest,
        leaseDigest: digestValue(lease), subjectStateDigest: frame.subject.stateDigest,
        authoredLaneStateDigest: frame.authored.stateDigest, remoteHeadSha: frame.subject.remoteHeadSha }) };
    },
  });
}

function assertPullIdentity(expected, actual) { for (const key of ["number", "nodeId", "url", "isDraft", "mergedAt",
  "headBranch", "headSha", "baseBranch", "baseSha"]) if (actual[key] !== expected[key]) throw new Error("Pull request identity drifted."); }
function isReleasedLease(lease, plan) { const receipt = lease?.admittedEmptyAbandonedOwnerRetirement;
  return lease?.status === "released" && receipt?.status === "retired-preserved"
    && receipt.planDigest === plan.planDigest && receipt.originalLeaseDigest === plan.subject.lease.digest; }
function isResumedReleasedLease(lease, plan) { const receipt = lease?.admittedEmptyAbandonedOwnerRetirement;
  const receiptCore = receipt && { ...receipt }; if (receiptCore) delete receiptCore.receiptDigest;
  return lease?.status === "released" && lease.admission == null && lease.cloudAuthority == null
    && lease.taskAuthority?.bindingDigest === plan.recovery.taskAuthorityBindingDigest
    && receipt?.schema === "agentic-admitted-empty-abandoned-owner-local-release/v1"
    && receipt?.status === "retired-preserved" && receipt.receiptDigest === digestValue(receiptCore)
    && receipt.planDigest === plan.sourceState.plan.planDigest
    && receipt.resumePlanDigest === plan.planDigest && receipt.sourceStateDigest === plan.sourceState.stateDigest
    && receipt.claimId === plan.sourceState.plan.subject.claim.claimId
    && receipt.subjectStateDigest === plan.sourceState.plan.subject.stateDigest
    && receipt.authoredLaneStateDigest === plan.sourceState.plan.authoredLane.stateDigest
    && receipt.originalLeaseDigest === plan.sourceState.plan.subject.lease.digest; }
function effectValues(phase, values) { const core = { phase, ...values }; return { ...values, operationDigest: digestValue(core) }; }
function claimOperationKey(plan) { return `admitted-empty-abandoned-owner-retirement:${plan.planDigest}:claim`; }
function ownerIdentifierMatches(namespace, projected, local) {
  return typeof local === "string" && local.length > 0
    && (projected === local || projected === pseudonymousIdentifier(namespace, local));
}
function requireRetirementEntry({ status, plan, gh, dependencies }) {
  const ledger = dependencies.readLedger ? dependencies.readLedger(status)
    : JSON.parse(gh(["api", "--method", "GET", "-H", "Accept: application/vnd.github.raw+json",
      `repos/${plan.cloud.ledgerRepository}/contents/.agentic/collaboration-ledger.json`, "-f", `ref=${status.ledgerRevision}`]));
  const failures = validateLedger(ledger), entry = ledger.entries.filter(item => item.claimId === plan.subject.claim.claimId).at(-1);
  if (failures.length > 0 || ledger.headDigest !== status.ledgerDigest || ledger.sequence !== status.sequence
    || entry?.action !== "retire" || entry.claimCore?.state !== "retired"
    || entry.idempotencyKey !== digestValue(claimOperationKey(plan))) throw new Error("Cloud claim reached a foreign terminal operation.");
  return entry;
}
function remoteHead(git, repository, branch) { const lines = git(repository, ["ls-remote", "--heads", "origin", branch]).split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error("Remote branch is missing or ambiguous."); return lines[0].split(/\s+/u)[0]; }
function worktrees(raw) { const result = []; for (const field of String(raw).split("\0")) if (field.startsWith("worktree ")) result.push(path.resolve(field.slice(9))); return result; }
function safeStatePath(value) { const result = path.resolve(text(value, "state path")); if (!path.isAbsolute(value) || path.extname(result) !== ".json") throw new Error("State path must be an absolute JSON path."); return result; }
function normalizePersistedState(value) {
  if (value?.schema === STATE_SCHEMA) return normalizeState(value);
  if (value?.schema === RESUME_STATE_SCHEMA) return normalizeResumeState(value);
  throw new Error("Retirement state schema is unsupported.");
}
function safeTaskAuthorityPath(value, roots) { if (!path.isAbsolute(value)) throw new Error("Task authority capability path must be absolute.");
  const result = path.resolve(value), stat = lstatSync(result); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Task authority capability must be a private regular file.");
  for (const root of Object.values(roots)) { const relative = path.relative(path.resolve(root), result);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Task authority capability must remain outside repositories and worktrees."); }
  return result; }
function readJson(file) { try { const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Retirement state storage is unsafe."); return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; } }
function writeAtomic(file, value) { const directory = path.dirname(file); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`; const descriptor = openSync(temporary, "wx", 0o600);
  try { writeFileSync(descriptor, `${canonicalJson(value)}\n`); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  renameSync(temporary, file); }
async function withLock(file, context, action) { mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let descriptor, owned = false; try { descriptor = openSync(file, "wx", 0o600); owned = true; writeFileSync(descriptor, `${canonicalJson({ pid: process.pid, token: randomUUID(), context })}\n`); closeSync(descriptor); descriptor = null;
    return await action(); } catch (error) { if (error?.code === "EEXIST") throw new Error("Retirement operation is already locked."); throw error; }
  finally { if (descriptor !== undefined && descriptor !== null) closeSync(descriptor); if (owned && existsSync(file)) unlinkSync(file); } }
function absolute(value, label) { return path.resolve(text(value, label)); }
function text(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid.`); return value; }
function repositoryName(value) { const result = text(value, "repository identity"); if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw new Error("Repository identity is invalid."); return result; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function assertControllerDescendant(source, current, git, controllerRoot) { if (!source.protected || !source.clean || !current.protected || !current.clean) throw new Error("Retirement resume requires clean protected controller lineage.");
  try { git(controllerRoot, ["merge-base", "--is-ancestor", source.headSha, current.headSha]); }
  catch { throw new Error("Retirement resume controller is not a protected descendant of the source controller."); } }
