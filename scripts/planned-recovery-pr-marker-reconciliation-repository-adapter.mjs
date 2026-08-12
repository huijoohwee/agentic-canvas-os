// Responsibility: Adapt exact Git, lease-registry, cloud-status, and GitHub projections.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { buildPlan } from "./planned-recovery-pr-marker-reconciliation-contract.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";

export function createRepositoryAdapter({ repository, sourceWorktree, now = () => new Date() }) {
  const root = real(repository), source = real(sourceWorktree);
  const common = absoluteGit(source, ["rev-parse", "--git-common-dir"]);
  const store = createWriterLeaseStore({ gitCommonDir: common });
  const readSource = ({ sessionId, operatorDecisionDigest }) => {
    const branch = git(source, ["branch", "--show-current"]);
    const lease = store.verify({ sessionId, branch, allowExpired: true });
    const headSha = git(source, ["rev-parse", "HEAD"]);
    const treeSha = git(source, ["rev-parse", "HEAD^{tree}"]);
    if (git(source, ["status", "--porcelain=v1", "--untracked-files=all"])) throw new Error("Source worktree must be clean.");
    if (lease.status !== "active" || lease.admission?.status !== "planned"
      || Date.parse(lease.expiresAt) > now().getTime()) throw new Error("Source must be one expired active planned owner.");
    if (headSha !== lease.fenceSha) throw new Error("Source fence changed.");
    const remoteHeadSha = remoteHead(source, branch);
    if (gitExit(source, ["diff", "--quiet", `${lease.baseSha}...${headSha}`]) !== 0) {
      throw new Error("Source contains authored delta and cannot be abandoned by this controller.");
    }
    const pull = readPull(lease.pullRequestUrl);
    if (pull.state !== "OPEN" || !pull.isDraft || pull.headRefName !== branch
      || pull.headRefOid !== remoteHeadSha) throw new Error("Pull request is not the exact open draft source.");
    const marker = parseWriterLeasePullRequestBody(pull.body);
    if (!sameExceptHeartbeat(marker, lease)) throw new Error("Pull-request marker differs beyond response-loss heartbeat projection.");
    const cloud = cloudStatus(root, lease.cloudAuthority.ledgerRepository,
      lease.cloudAuthority.targetRepository);
    const observedClaim = cloud.claims.find(item => item.claimId === lease.cloudAuthority.claimId);
    if (observedClaim?.scopeReserved || observedClaim?.writeAuthority
      || (observedClaim && observedClaim.state !== "retired")) {
      throw new Error("Source cloud claim must be absent or terminal retired authority.");
    }
    const claim = observedClaim || { claimId: lease.cloudAuthority.claimId,
      fenceRevision: lease.cloudAuthority.claimDigest,
      transitionCounter: lease.cloudAuthority.transitionCounter };
    return { lease, branch, headSha, treeSha, remoteHeadSha, pull, marker, cloud, claim,
      plan: buildPlan({ repository: root, sourceWorktree: source, branch, headSha, treeSha,
        remoteHeadSha, sourceLeaseDigest: digestValue(lease),
        sourceMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(marker)),
        sourceBodyDigest: digestValue(pull.body), pullRequestUrl: pull.url,
        pullRequestNumber: pull.number, pullRequestNodeId: pull.id,
        ledgerRepository: lease.cloudAuthority.ledgerRepository,
        targetRepository: lease.cloudAuthority.targetRepository,
        claimId: claim.claimId, claimDigest: claim.fenceRevision,
        claimTransitionCounter: claim.transitionCounter,
        sessionId, operatorDecisionDigest }) };
  };
  const inspectPlan = plan => {
    const branch = git(source, ["branch", "--show-current"]);
    const headSha = git(source, ["rev-parse", "HEAD"]);
    const treeSha = git(source, ["rev-parse", "HEAD^{tree}"]);
    if (branch !== plan.branch || headSha !== plan.headSha || treeSha !== plan.treeSha
      || remoteHead(source, branch) !== plan.remoteHeadSha
      || git(source, ["status", "--porcelain=v1", "--untracked-files=all"])) {
      throw new Error("Reconciliation source identity changed.");
    }
    const pull = readPull(plan.pullRequestUrl);
    if (!pull.isDraft || pull.headRefName !== branch || pull.headRefOid !== plan.remoteHeadSha
      || pull.number !== plan.pullRequestNumber || pull.id !== plan.pullRequestNodeId
      || !["OPEN", "CLOSED"].includes(pull.state) || pull.mergedAt !== null) {
      throw new Error("Pull request is not the exact open-or-closed unmerged draft source.");
    }
    const cloud = cloudStatus(root, plan.ledgerRepository, plan.targetRepository);
    const observedClaim = cloud.claims.find(item => item.claimId === plan.claimId);
    if (observedClaim?.scopeReserved || observedClaim?.writeAuthority
      || (observedClaim && observedClaim.state !== "retired")) {
      throw new Error("Source cloud claim regained nonterminal authority.");
    }
    const lease = store.read(branch);
    const isSourceLeaseProjection = digestValue(lease) === plan.sourceLeaseDigest
      && lease?.status === "active";
    const released = lease?.status === "released"
      && lease.plannedRecoveryMarkerReconciliation?.planDigest === plan.planDigest;
    if (!isSourceLeaseProjection && !released) {
      throw new Error("Local owner is neither the exact source nor its exact released projection.");
    }
    const markerDigest = digestValue(projectWriterLeasePullRequestMarker(parseWriterLeasePullRequestBody(pull.body)));
    const targetMarkerDigest = released ? digestValue(projectWriterLeasePullRequestMarker(lease)) : null;
    if (markerDigest !== plan.sourceMarkerDigest && markerDigest !== targetMarkerDigest) {
      throw new Error("Pull-request projection is neither the exact source nor released target.");
    }
    return {
      branch, pull, cloud, lease, source: isSourceLeaseProjection,
      released, markerDigest, targetMarkerDigest,
    };
  };
  return Object.freeze({
    buildPlan(input) { return readSource(input).plan; },
    verifyPlan({ plan }) { inspectPlan(plan); },
    closePullRequest({ plan }) {
      const live = inspectPlan(plan);
      if (live.pull.state === "OPEN") {
        try { execFileSync("gh", ["pr", "close", live.pull.url], { cwd: root, stdio: "pipe" }); }
        catch (error) { if (readPull(live.pull.url).state !== "CLOSED") throw error; }
      }
      const closed = readPull(live.pull.url);
      if (closed.state !== "CLOSED" || closed.mergedAt !== null
        || closed.headRefOid !== plan.remoteHeadSha) throw new Error("Pull request did not close unmerged at the exact remote head.");
      return { disposition: "closed-unmerged", closedAt: new Date(closed.closedAt).toISOString() };
    },
    releaseLocalOwner({ plan, provider }) {
      const branch = plan.branch, existing = store.read(branch);
      if (existing?.status === "released"
        && existing.plannedRecoveryMarkerReconciliation?.planDigest === plan.planDigest) {
        return { released: existing, releasedLeaseDigest: digestValue(existing),
          completedAt: existing.plannedRecoveryMarkerReconciliation.completedAt };
      }
      const lease = store.verify({ sessionId: plan.sessionId, branch, allowExpired: true });
      if (digestValue(lease) !== plan.sourceLeaseDigest) throw new Error("Source lease changed before release.");
      const completedAt = new Date(provider.closedAt).toISOString();
      const receiptCore = { schema: "agentic-planned-recovery-pr-marker-local-release/v1",
        planDigest: plan.planDigest, claimId: plan.claimId,
        pullRequestUrl: plan.pullRequestUrl, completedAt };
      const released = store.release({ sessionId: plan.sessionId, branch, expectedLease: lease,
        status: "released", timestamp: completedAt,
        values: { admission: null, cloudAuthority: null,
          plannedRecoveryMarkerReconciliation: { ...receiptCore, receiptDigest: digestValue(receiptCore) } } });
      return { released, releasedLeaseDigest: digestValue(released), completedAt };
    },
    projectPullRequest({ plan, local }) {
      const pull = readPull(plan.pullRequestUrl);
      const targetMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(local.released));
      const currentMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(
        parseWriterLeasePullRequestBody(pull.body)));
      if (currentMarkerDigest !== targetMarkerDigest) {
        if (currentMarkerDigest !== plan.sourceMarkerDigest || digestValue(pull.body) !== plan.sourceBodyDigest) {
          throw new Error("Pull-request body changed before released projection.");
        }
        const body = updateWriterLeasePullRequestBody(pull.body, local.released);
        try { execFileSync("gh", ["pr", "edit", pull.url, "--body", body], { cwd: root, stdio: "pipe" }); }
        catch (error) {
          const observed = readPull(pull.url);
          const observedDigest = digestValue(projectWriterLeasePullRequestMarker(
            parseWriterLeasePullRequestBody(observed.body)));
          if (observedDigest !== targetMarkerDigest) throw error;
        }
      }
      const final = readPull(pull.url);
      if (digestValue(projectWriterLeasePullRequestMarker(parseWriterLeasePullRequestBody(final.body)))
        !== targetMarkerDigest) throw new Error("Released pull-request projection did not converge.");
      return { targetMarkerDigest, completedAt: local.completedAt };
    },
    verifyFinal({ plan, local }) {
      const lease = store.read(plan.branch);
      const pull = readPull(plan.pullRequestUrl);
      if (digestValue(lease) !== local.releasedLeaseDigest || pull.state !== "CLOSED"
        || pull.mergedAt !== null || git(source, ["rev-parse", "HEAD"]) !== plan.headSha
        || remoteHead(source, plan.branch) !== plan.remoteHeadSha
        || git(source, ["status", "--porcelain=v1", "--untracked-files=all"])) {
        throw new Error("Final reconciliation evidence did not converge.");
      }
    },
  });
}

function readPull(ref) { return JSON.parse(execFileSync("gh", ["pr", "view", ref, "--json",
  "id,number,url,state,isDraft,mergedAt,closedAt,headRefName,headRefOid,body"], { encoding: "utf8" })); }
function cloudStatus(root, ledger, target) { return JSON.parse(execFileSync(process.execPath,
  [path.join(root, "scripts/cloud-collaboration.mjs"), "status", `--ledger-repository=${ledger}`,
    `--request-json=${JSON.stringify({ targetRepository: target })}`, "--json"], { cwd: root, encoding: "utf8" })); }
function remoteHead(root, branch) { const out = execFileSync("git", ["-C", root, "ls-remote", "--heads", "origin", branch], { encoding: "utf8" }).trim(); const lines = out.split("\n").filter(Boolean); if (lines.length !== 1) throw new Error("Remote branch is missing or ambiguous."); return lines[0].split(/\s+/u)[0]; }
function sameExceptHeartbeat(left, right) { const clean = value => { const copy = structuredClone(projectWriterLeasePullRequestMarker(value)); delete copy.heartbeatAt; return copy; }; return digestValue(clean(left)) === digestValue(clean(right)); }
function git(root, args) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim(); }
function gitExit(root, args) { try { execFileSync("git", ["-C", root, ...args], { stdio: "ignore" }); return 0; } catch (error) { return error.status ?? 1; } }
function absoluteGit(root, args) { const value = git(root, [args[0], "--path-format=absolute", ...args.slice(1)]); return path.resolve(value); }
function real(value) { return path.resolve(value); }
