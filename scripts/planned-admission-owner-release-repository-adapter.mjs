// Responsibility: Join exact GitHub, cloud-ledger, worktree, and writer-lease projections.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { buildPlan } from "./planned-admission-owner-release-contract.mjs";
import { buildLocalReleaseProjection, isReleasedProjection } from "./planned-admission-owner-release-store.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";

const CONTROLLER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createRepositoryAdapter({ repository, preservedWorktree, staleBranch,
  pullRequestNumber, ledgerRepository = "huijoohwee/agentic-canvas-os",
  targetRepository, now = () => new Date() }) {
  const root = path.resolve(repository);
  const preservedPath = path.resolve(preservedWorktree);
  const commonDirectory = absoluteGit(root, ["rev-parse", "--git-common-dir"]);
  const leaseStore = createWriterLeaseStore({ gitCommonDir: commonDirectory });
  const target = targetRepository || gh(root, ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);

  const observe = () => {
    const registry = leaseStore.readRegistry();
    const staleLease = registry.leases[staleBranch];
    const planned = staleLease?.status === "active" && staleLease.admission?.status === "planned";
    const released = staleLease?.status === "released"
      && staleLease.plannedAdmissionOwnerRelease?.status === "retired-preserved";
    if (!planned && !released) {
      throw new Error("Stale owner must be one active planned lease.");
    }
    const sourceProjection = { worktreePath: staleLease.worktreePath, branch: staleBranch,
      worktreePresent: registeredWorktrees(root).includes(path.resolve(staleLease.worktreePath)),
      localBranchPresent: gitExit(root, ["show-ref", "--verify", "--quiet", `refs/heads/${staleBranch}`]) === 0 };
    const pull = readPull(root, pullRequestNumber);
    if (pull.branch !== staleBranch || pull.url !== staleLease.pullRequestUrl) {
      throw new Error("Pull request is not the stale lease projection.");
    }
    const remoteBranchHead = remoteHead(root, staleBranch);
    const cloud = cloudStatus(root, ledgerRepository, target);
    const claimId = staleLease.cloudAuthority?.claimId;
    const claim = cloud.claims.find(item => item.claimId === claimId);
    if (!claim) throw new Error("Stale lease cloud claim is absent.");
    const preservedLane = inspectPreservedLane(root, preservedPath, leaseStore);
    return { registry, staleLease, sourceProjection, pull, remoteBranchHead, cloud, claim, preservedLane };
  };
  const makePlan = state => buildPlan({ ledgerRepository, targetRepository: target,
    claim: state.claim, ledgerRevision: state.cloud.ledgerRevision,
    ledgerDigest: state.cloud.ledgerDigest, pullRequest: state.pull,
    remoteBranchHead: state.remoteBranchHead, staleLease: state.staleLease,
    staleLeaseDigest: digestValue(state.staleLease), leaseRegistryDigest: digestValue(state.registry),
    sourceProjection: state.sourceProjection, preservedLane: state.preservedLane });

  const verify = plan => {
    const state = observe();
    const released = isReleasedProjection(state.staleLease, plan);
    if (!released && digestValue(state.registry) !== plan.leaseRegistryDigest) {
      throw new Error("Writer lease registry changed after planning.");
    }
    const claimTerminal = state.claim.state === "retired"
      && !state.claim.scopeReserved && !state.claim.writeAuthority;
    const claimInitial = digestValue({ claimId: state.claim.claimId, state: state.claim.state,
      writeAuthority: state.claim.writeAuthority, scopeReserved: state.claim.scopeReserved,
      laneRevision: state.claim.laneRevision, fenceRevision: state.claim.fenceRevision,
      transitionCounter: state.claim.transitionCounter, reviewRequestId: state.claim.reviewRequestId })
      === digestValue(plan.claim);
    const pullIdentity = { ...state.pull, state: plan.pullRequest.state,
      isDraft: plan.pullRequest.isDraft, closedAt: undefined };
    const plannedPullIdentity = { ...plan.pullRequest, closedAt: undefined };
    if ((!claimInitial && !claimTerminal)
      || (!claimTerminal && (state.cloud.ledgerRevision !== plan.ledgerRevision
        || state.cloud.ledgerDigest !== plan.ledgerDigest))
      || digestValue(pullIdentity) !== digestValue(plannedPullIdentity)
      || state.remoteBranchHead !== plan.remoteBranchHead
      || digestValue(state.sourceProjection) !== digestValue(plan.sourceProjection)
      || (!released && digestValue(state.staleLease) !== plan.staleLeaseDigest)) {
      throw new Error("Planned owner-release evidence changed.");
    }
    if (state.preservedLane.stateDigest !== plan.preservedLane.stateDigest) {
      throw new Error("Preserved authored lane changed.");
    }
    return { ...state, released };
  };

  return Object.freeze({
    buildPlan() { return makePlan(observe()); },
    verifyPlan(plan) { verify(plan); },
    retireClaim(plan) {
      const state = verify(plan);
      if (state.claim.state === "retired") return terminalCloudReceipt(state.cloud, plan.claim.claimId);
      const request = { targetRepository: target, claimId: plan.claim.claimId,
        expectedFenceRevision: plan.claim.fenceRevision,
        expectedTransitionCounter: plan.claim.transitionCounter,
        expectedLedgerDigest: state.cloud.ledgerDigest, reason: "abandoned",
        finalRevision: plan.claim.laneRevision, reviewRequestId: plan.claim.reviewRequestId,
        bytesDigest: plan.preservedLane.workingTreeDigest,
        namedChecksDigest: plan.planDigest, handoffEvidenceDigest: plan.preservedLane.stateDigest,
        idempotencyKey: `planned-admission-owner-release:${plan.planDigest}:retire` };
      const result = cloudAction(root, ledgerRepository, "retire", request);
      if (result?.ok !== true || result?.claim?.state !== "retired"
        || result?.claim?.claimId !== plan.claim.claimId) throw new Error("Cloud claim retirement did not converge.");
      return { receiptDigest: result.operationReceipt.receiptDigest };
    },
    closePullRequest(plan) {
      const pull = readPull(root, pullRequestNumber);
      if (pull.state === "OPEN") execFileSync("gh", ["pr", "close", pull.url], { cwd: root, stdio: "pipe" });
      const closed = readPull(root, pullRequestNumber);
      if (closed.state !== "CLOSED" || closed.mergedAt !== null || closed.headSha !== plan.remoteBranchHead
        || remoteHead(root, staleBranch) !== plan.remoteBranchHead) {
        throw new Error("Pull request did not close unmerged with its remote branch preserved.");
      }
      return { disposition: "closed-unmerged", closedAt: new Date(closed.closedAt).toISOString(),
        remoteBranchPreserved: true };
    },
    releaseLocalOwner(plan, cloud, provider) {
      const current = leaseStore.read(staleBranch);
      if (isReleasedProjection(current, plan)) {
        return { releasedLease: current,
          completedAt: current.plannedAdmissionOwnerRelease.completedAt };
      }
      if (digestValue(current) !== plan.staleLeaseDigest) throw new Error("Stale lease changed before release.");
      const completedAt = new Date(provider.closedAt).toISOString();
      const release = buildLocalReleaseProjection({ plan, originalLease: current, cloud, provider, completedAt });
      const releasedLease = leaseStore.release({ sessionId: current.sessionId, branch: staleBranch,
        expectedLease: current, status: "released", timestamp: completedAt,
        values: { plannedAdmissionOwnerRelease: release } });
      return { releasedLease, completedAt };
    },
    verifyFinal(plan, cloud, provider, local) {
      const status = cloudStatus(root, ledgerRepository, target);
      const claim = status.claims.find(item => item.claimId === plan.claim.claimId);
      const pull = readPull(root, pullRequestNumber);
      const lease = leaseStore.read(staleBranch);
      const preserved = inspectPreservedLane(root, preservedPath, leaseStore);
      if (claim?.scopeReserved || claim?.writeAuthority || (claim && claim.state !== "retired")
        || pull.state !== "CLOSED" || pull.mergedAt !== null
        || remoteHead(root, staleBranch) !== plan.remoteBranchHead
        || digestValue(lease) !== digestValue(local.releasedLease)
        || !isReleasedProjection(lease, plan)
        || preserved.stateDigest !== plan.preservedLane.stateDigest
        || cloud.receiptDigest.length !== 64 || provider.remoteBranchPreserved !== true) {
        throw new Error("Terminal owner-release evidence did not converge.");
      }
    },
  });
}

function inspectPreservedLane(root, lane, leaseStore) {
  if (!registeredWorktrees(root).includes(lane)) throw new Error("Preserved lane is not registered.");
  const branch = git(lane, ["branch", "--show-current"]);
  const headSha = git(lane, ["rev-parse", "HEAD"]), treeSha = git(lane, ["rev-parse", "HEAD^{tree}"]);
  const status = gitRaw(lane, ["status", "--porcelain=v1", "--untracked-files=all"]).replace(/\n$/u, "");
  const changedPaths = status.split("\n").filter(Boolean).map(line => line.slice(3)).sort();
  if (leaseStore.read(branch)) throw new Error("Preserved successor unexpectedly owns a local lease.");
  const pulls = JSON.parse(gh(root, ["pr", "list", "--state", "open", "--head", branch, "--json", "number"]));
  const core = { path: lane, branch, headSha, treeSha, dirty: changedPaths.length > 0, changedPaths,
    workingTreeDigest: digestValue({ status, headSha, treeSha }), pullRequest: pulls.length ? pulls[0].number : null };
  return { ...core, stateDigest: digestValue(core) };
}
function terminalCloudReceipt(status, claimId) { const claim = status.claims.find(item => item.claimId === claimId);
  if (claim?.state !== "retired" || claim.scopeReserved || claim.writeAuthority) throw new Error("Cloud claim is not terminal retired.");
  return { receiptDigest: claim.operationReceiptDigest || claim.fenceRevision }; }
function readPull(root, number) { const value = JSON.parse(gh(root, ["pr", "view", String(number), "--json",
  "id,number,url,state,isDraft,mergedAt,closedAt,headRefName,headRefOid,baseRefName,baseRefOid"]));
  return { nodeId: value.id, number: value.number, url: value.url, state: value.state, isDraft: value.isDraft,
    mergedAt: value.mergedAt, closedAt: value.closedAt, branch: value.headRefName, headSha: value.headRefOid,
    baseBranch: value.baseRefName, baseSha: value.baseRefOid }; }
function cloudStatus(root, ledger, target) { return cloudAction(root, ledger, "status", { targetRepository: target }); }
function cloudAction(root, ledger, action, request) { return JSON.parse(execFileSync(process.execPath,
  [path.join(CONTROLLER_ROOT, "scripts/cloud-collaboration.mjs"), action,
    `--ledger-repository=${ledger}`, `--request-json=${JSON.stringify(request)}`, "--json"],
  { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })); }
function remoteHead(root, branch) { const output = git(root, ["ls-remote", "--heads", "origin", branch]);
  const lines = output.split("\n").filter(Boolean); if (lines.length !== 1) throw new Error("Remote branch is missing or ambiguous."); return lines[0].split(/\s+/u)[0]; }
function registeredWorktrees(root) { return git(root, ["worktree", "list", "--porcelain"]).split("\n")
  .filter(line => line.startsWith("worktree ")).map(line => path.resolve(line.slice(9))); }
function git(root, args) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim(); }
function gitRaw(root, args) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }); }
function gitExit(root, args) { try { execFileSync("git", ["-C", root, ...args], { stdio: "ignore" }); return 0; } catch (error) { return error.status ?? 1; } }
function gh(root, args) { return execFileSync("gh", args, { cwd: root, encoding: "utf8" }).trim(); }
function absoluteGit(root, args) { const value = git(root, [args[0], "--path-format=absolute", ...args.slice(1)]); return path.resolve(value); }
