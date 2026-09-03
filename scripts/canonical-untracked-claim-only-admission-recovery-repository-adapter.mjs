// Responsibility: Capture and execute the repository-neutral, no-projection recovery boundary.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  digestValue,
} from "./cloud-collaboration-primitives.mjs";
import {
  buildCanonicalUntrackedClaimOnlyAdmissionRecoveryEvidence,
  claimsOverlapManifest,
  projectCanonicalUntrackedClaimOnlyClaim,
} from "./canonical-untracked-claim-only-admission-recovery-evidence.mjs";
import { normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan }
  from "./canonical-untracked-claim-only-admission-recovery-contract.mjs";
import {
  CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  captureSourceEvidence,
  verifyLegacyRecoveryPackage,
} from "./legacy-dirty-lane-adoption-lib.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "./scoped-lane-admission-lib.mjs";
import { invokeRepositoryCloudAction }
  from "./scoped-lane-cloud-authority.mjs";
import { pseudonymousIdentifier }
  from "./github-cloud-collaboration-mapping.mjs";
import {
  authorizeTaskBoundLeaseMutation,
  createTaskAuthorityLeaseBinding,
} from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";

export function createCanonicalUntrackedClaimOnlyAdmissionRecoveryRepositoryAdapter(options = {}) {
  const repositoryPath = realDirectory(options.repository, "canonical repository");
  const recoveryDirectory = realDirectory(options.recoveryDirectory, "preservation package");
  const targetWorktree = canonicalProspectivePath(options.targetWorktree, "target worktree");
  const controllerRoot = realDirectory(options.controllerRoot, "controller repository");
  const executingControllerRoot = realpathSync(git(
    path.dirname(fileURLToPath(import.meta.url)), ["rev-parse", "--show-toplevel"],
  ));
  if (executingControllerRoot !== controllerRoot) {
    throw new Error("Executing recovery module is not owned by the attested controller root.");
  }
  const manifestFile = realFile(options.manifestFile, "write-scope manifest");
  const cloudAuthorityFile = realFile(options.cloudAuthorityFile, "source cloud authority");
  const taskAuthorityFile = options.taskAuthorityFile
    ? realFile(options.taskAuthorityFile, "task authority capability") : null;
  if (taskAuthorityFile && [repositoryPath, recoveryDirectory, controllerRoot]
    .some(root => inside(taskAuthorityFile, root))) {
    throw new Error("Task authority capability must be external to source, preservation, and controller roots.");
  }
  const device = required(options.device, "device");
  const sessionId = required(options.sessionId, "session id");
  const scope = required(options.scope, "scope");
  const branch = `agent/${device}/${scope}`;
  const environment = options.environment || process.env;
  const run = options.exec || defaultExec;
  const cloud = options.cloud || invokeRepositoryCloudAction;
  const taskReceiptGate = createCanonicalUntrackedClaimOnlyTaskReceiptGate();

  async function readPlanEvidence() {
    const local = captureLocalEvidence();
    const authorityEnvelope = parseJson(cloudAuthorityFile, "source cloud authority");
    const selector = normalizeCanonicalUntrackedClaimOnlySourceAuthoritySelector(authorityEnvelope);
    const { ledgerRepository, targetRepository } = selector;
    if (targetRepository !== local.source.repository) {
      throw new Error("Source cloud authority targets another repository.");
    }
    const seedClaim = authorityEnvelope.result?.claim;
    if (authorityEnvelope.result?.schema !== "agentic-cloud-collaboration-result/v1"
      || authorityEnvelope.result?.ok !== true || !seedClaim?.claimId) {
      throw new Error("Source cloud authority is not a successful wrapped claim result.");
    }
    const status = readStatus({ cloud, environment, ledgerRepository, targetRepository });
    const matches = status.claims.filter(candidate => candidate.claimId === seedClaim.claimId);
    if (matches.length !== 1) throw new Error("Exact dormant claim cardinality changed.");
    const claim = projectCanonicalUntrackedClaimOnlyClaim(matches[0]);
    assertOwner(claim, device, sessionId);
    const overlappingClaimIds = status.claims
      .filter(candidate => claimsOverlapManifest(candidate, claim, local.manifest))
      .map(candidate => candidate.claimId).sort();
    return buildCanonicalUntrackedClaimOnlyAdmissionRecoveryEvidence({
      ...local,
      cloud: {
        ledgerRepository,
        targetRepository,
        ledgerRevision: status.ledgerRevision,
        ledgerDigest: status.ledgerDigest,
        inventoryDigest: status.inventoryDigest || digestValue(status.claims),
        sourceAuthorityDigest: digestValue(authorityEnvelope),
        claim,
        overlappingClaimIds,
      },
    });
  }

  async function assertSource(plan, label = "source assertion") {
    const sealed = normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan(plan);
    const current = captureLocalEvidence();
    for (const key of ["identity", "source", "preservation", "manifest", "absence", "controller"]) {
      if (canonicalJson(current[key]) !== canonicalJson(sealed.evidence[key])) {
        throw new Error(`Canonical-untracked claim-only ${label} drifted: ${key}.`);
      }
    }
    const authority = parseJson(cloudAuthorityFile, "source cloud authority");
    if (digestValue(authority) !== sealed.evidence.cloud.sourceAuthorityDigest) {
      throw new Error(`Canonical-untracked claim-only ${label} drifted: source authority.`);
    }
    assertSourceAuthoritySelector(authority, sealed);
    return Object.freeze({ sourceEvidenceDigest: digestValue(current), label });
  }

  async function authorizeTask(plan, { purpose = "journal" } = {}) {
    const sealed = normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan(plan);
    if (!taskAuthorityFile) throw new Error("Run requires an absolute task authority capability path.");
    const leaseSubject = prospectiveLeaseSubject(sealed);
    const taskAuthority = createTaskAuthorityLeaseBinding({
      lease: leaseSubject,
      capabilityPath: taskAuthorityFile,
      bindingMode: "claim",
    });
    const receipt = authorizeTaskBoundLeaseMutation({
      lease: { ...leaseSubject, taskAuthority },
      capabilityPath: taskAuthorityFile,
      operation: sealed.taskAuthorityOperation,
    });
    if (purpose === "cloud-continuation") {
      taskReceiptGate.issue(receipt, sealed);
    } else if (purpose !== "journal") {
      throw new Error("Task authority proof purpose is invalid.");
    }
    return Object.freeze({ ...receipt, purpose });
  }

  async function sealCloudRequest(plan) {
    const sealed = normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan(plan);
    const claim = sealed.evidence.cloud.claim;
    const request = Object.freeze({
      targetRepository: sealed.evidence.cloud.targetRepository,
      claimId: claim.claimId,
      expectedFenceRevision: claim.fenceRevision,
      expectedTransitionCounter: claim.transitionCounter,
      mode: "recovery",
      ttlSeconds: sealed.ttlSeconds,
      recoveryEvidenceDigest: sealed.evidence.evidenceDigest,
      deviceId: sealed.evidence.identity.device,
      sessionId: sealed.evidence.identity.sessionId,
      idempotencyKey: `canonical-untracked-claim-only-admission-recovery:${sealed.planDigest}`,
    });
    const core = {
      action: "continue",
      ledgerRepository: sealed.evidence.cloud.ledgerRepository,
      request,
    };
    return Object.freeze({ ...core, sealedTransportDigest: digestValue(core) });
  }

  async function recoverCloud(plan, { sealedRequest, taskAuthority } = {}) {
    const sealed = normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan(plan);
    await assertSource(sealed, "repository-adapter direct pre-effect");
    const expected = await sealCloudRequest(sealed);
    if (canonicalJson(expected) !== canonicalJson(sealedRequest)) {
      throw new Error("Sealed same-claim continuation request changed.");
    }
    const before = readStatus({
      cloud, environment,
      ledgerRepository: expected.ledgerRepository,
      targetRepository: expected.request.targetRepository,
    });
    const current = exactClaim(before, sealed.evidence.cloud.claim.claimId);
    assertOwner(projectCanonicalUntrackedClaimOnlyClaim(current),
      sealed.evidence.identity.device, sealed.evidence.identity.sessionId);
    assertRecoverableState(current, sealed);
    assertNoOverlap(before.claims, current, sealed.evidence.manifest);
    taskReceiptGate.consume(taskAuthority, sealed);
    const result = cloud({
      action: "continue",
      ledgerRepository: expected.ledgerRepository,
      request: expected.request,
      environment,
    });
    const claim = projectCanonicalUntrackedClaimOnlyClaim(result?.claim);
    verifyCanonicalUntrackedClaimOnlyContinuationResult({
      result, claim, source: sealed.evidence.cloud.claim, plan: sealed, request: expected.request,
    });
    const authority = Object.freeze({
      ledgerRepository: expected.ledgerRepository,
      targetRepository: expected.request.targetRepository,
      result,
    });
    return Object.freeze({
      authority,
      authorityDigest: digestValue(authority),
      claimDigest: claim.fenceRevision,
      transitionDigest: claim.transitionDigest,
      operationReceiptDigest: claim.operationReceiptDigest,
      sealedTransportDigest: expected.sealedTransportDigest,
    });
  }

  async function verifyTerminal(plan, { recovered } = {}) {
    const sealed = normalizeCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan(plan);
    if (!recovered?.authority || recovered.authorityDigest !== digestValue(recovered.authority)) {
      throw new Error("Recovered raw authority envelope changed.");
    }
    await assertSource(sealed, "terminal verification");
    const status = readStatus({
      cloud, environment,
      ledgerRepository: sealed.evidence.cloud.ledgerRepository,
      targetRepository: sealed.evidence.cloud.targetRepository,
    });
    const claim = projectCanonicalUntrackedClaimOnlyClaim(
      exactClaim(status, sealed.evidence.cloud.claim.claimId),
    );
    assertRecoveredClaim(claim, sealed.evidence.cloud.claim, sealed);
    assertNoOverlap(status.claims, claim, sealed.evidence.manifest);
    if (claim.fenceRevision !== recovered.claimDigest
      || claim.transitionDigest !== recovered.transitionDigest
      || claim.operationReceiptDigest !== recovered.operationReceiptDigest
      || recovered.authority.result?.claim?.fenceRevision !== claim.fenceRevision) {
      throw new Error("Recovered raw authority no longer identifies the current claim.");
    }
    const core = {
      schema: "agentic-canonical-untracked-claim-only-terminal-verification/v1",
      planDigest: sealed.planDigest,
      claim: projectCanonicalUntrackedClaimOnlyClaim(claim),
      authorityDigest: recovered.authorityDigest,
    };
    return Object.freeze({ ...core, terminalReceiptDigest: digestValue(core) });
  }

  function captureLocalEvidence() {
    const sourceRepository = repositoryFromRemote(git(repositoryPath, ["remote", "get-url", "origin"]));
    const source = captureSourceEvidence(repositoryPath);
    const common = realpathSync(resolveGitPath(repositoryPath, git(repositoryPath, ["rev-parse", "--git-common-dir"])));
    const gitDirectory = realpathSync(resolveGitPath(repositoryPath, git(repositoryPath, ["rev-parse", "--git-dir"])));
    const originMainSha = git(repositoryPath, ["rev-parse", "refs/remotes/origin/main"]);
    const remoteMainSha = remoteRef(repositoryPath, "refs/heads/main");
    const recovery = verifyLegacyRecoveryPackage({ recoveryDirectory });
    if (realpathSync(recovery.sourceWorktree) !== repositoryPath
      || recovery.captureProfile !== CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE) {
      throw new Error("Preservation package is not bound to this canonical repository.");
    }
    const manifest = normalizeDeclaredWriteScopeManifest(parseJson(manifestFile, "write-scope manifest"), {
      expectedScope: scope,
    });
    const worktrees = git(repositoryPath, ["worktree", "list", "--porcelain"]);
    const registered = parseWorktrees(worktrees).filter(candidate => candidate.path === repositoryPath);
    const localBranchAbsent = !refExists(repositoryPath, `refs/heads/${branch}`);
    const remoteBranchAbsent = remoteRef(repositoryPath, `refs/heads/${branch}`, { optional: true }) === null;
    const leaseStore = createWriterLeaseStore({ gitCommonDir: common });
    const pullRequests = JSON.parse(run("gh", ["pr", "list", "--repo", sourceRepository,
      "--state", "all", "--head", branch, "--limit", "1", "--json", "number"]));
    const controllerRepository = repositoryFromRemote(git(controllerRoot, ["remote", "get-url", "origin"]));
    const controllerHead = git(controllerRoot, ["rev-parse", "HEAD"]);
    const controllerCommon = realpathSync(resolveGitPath(controllerRoot,
      git(controllerRoot, ["rev-parse", "--git-common-dir"])));
    const controllerGitDirectory = realpathSync(resolveGitPath(controllerRoot,
      git(controllerRoot, ["rev-parse", "--git-dir"])));
    const controllerOrigin = git(controllerRoot, ["rev-parse", "refs/remotes/origin/main"]);
    const controllerRemote = remoteRef(controllerRoot, "refs/heads/main");
    const protectedMain = run("gh", ["api", `repos/${controllerRepository}/branches/main`, "--jq", ".protected"]) === "true";
    const controllerRegistrations = parseWorktrees(
      git(controllerRoot, ["worktree", "list", "--porcelain"]),
    ).filter(candidate => candidate.path === controllerRoot);
    return Object.freeze({
      identity: {
        device, sessionId, scope, branch,
        targetWorktreeDigest: digestValue(path.resolve(targetWorktree)),
      },
      source: {
        repository: sourceRepository,
        repositoryPathDigest: digestValue(repositoryPath),
        gitCommonDirectoryDigest: digestValue(common),
        branch: source.branch,
        headSha: source.headSha,
        originMainSha,
        remoteMainSha,
        primaryCanonical: gitDirectory === common,
        registeredWorktree: registered.length === 1
          && registered[0].headSha === source.headSha
          && registered[0].branch === "refs/heads/main",
        trackedPaths: [...source.trackedPaths].sort(),
        untrackedPaths: [...source.untrackedPaths].sort(),
        stateDigest: source.stateDigest,
        writeSetDigest: source.writeSetDigest,
      },
      preservation: {
        captureProfile: recovery.captureProfile,
        packageDigest: recovery.packageDigest,
        sourceHeadSha: recovery.sourceHeadSha,
        protectedTipSha: recovery.protectedTipSha,
        operatorSessionId: recovery.operatorSessionId,
        stateDigest: recovery.stateDigest,
        writeSetDigest: recovery.writeSetDigest,
        trackedPaths: recovery.tracked.map(entry => entry.path).sort(),
        untrackedPaths: recovery.untracked.map(entry => entry.path).sort(),
      },
      manifest,
      absence: {
        targetPathAbsent: pathAbsent(targetWorktree),
        worktreeRegistrationAbsent: !worktrees.includes(`worktree ${path.resolve(targetWorktree)}\n`)
          && !worktrees.includes(`branch refs/heads/${branch}\n`),
        localBranchAbsent,
        remoteBranchAbsent,
        writerLeaseAbsent: leaseStore.read(branch) === null,
        pullRequestAbsent: Array.isArray(pullRequests) && pullRequests.length === 0,
      },
      controller: {
        repository: controllerRepository,
        branch: git(controllerRoot, ["branch", "--show-current"]),
        headSha: controllerHead,
        originMainSha: controllerOrigin,
        remoteMainSha: controllerRemote,
        clean: git(controllerRoot, ["status", "--porcelain=v1"]) === "",
        protectedMain,
        primaryCanonical: controllerGitDirectory === controllerCommon,
        registeredWorktree: controllerRegistrations.length === 1
          && controllerRegistrations[0].headSha === controllerHead
          && controllerRegistrations[0].branch === "refs/heads/main",
      },
    });
  }

  return Object.freeze({ readPlanEvidence, assertSource, authorizeTask, sealCloudRequest, recoverCloud, verifyTerminal });
}

function prospectiveLeaseSubject(plan) {
  return Object.freeze({
    branch: plan.evidence.identity.branch,
    scope: plan.evidence.identity.scope,
    device: plan.evidence.identity.device,
    epoch: plan.evidence.cloud.claim.leaseEpoch,
    baseSha: plan.evidence.source.headSha,
    fenceSha: plan.evidence.source.headSha,
    status: "planned",
    cloudAuthority: { claimId: plan.evidence.cloud.claim.claimId },
  });
}

function readStatus({ cloud, environment, ledgerRepository, targetRepository }) {
  const status = cloud({ action: "status", ledgerRepository, request: { targetRepository }, environment });
  if (status?.schema !== "agentic-cloud-collaboration-result/v1" || status.ok !== true
    || status.action !== "status" || !Array.isArray(status.claims)
    || !/^[0-9a-f]{40}$/u.test(String(status.ledgerRevision || ""))
    || !/^[0-9a-f]{64}$/u.test(String(status.ledgerDigest || ""))) {
    throw new Error("Operation-derived cloud status is invalid.");
  }
  return status;
}
function exactClaim(status, claimId) { const matches = status.claims.filter(candidate => candidate.claimId === claimId); if (matches.length !== 1) throw new Error("Exact claim cardinality changed."); return matches[0]; }
function assertOwner(claim, device, sessionId) { if (claim.deviceId !== normalizeOwner("device", device) || claim.sessionId !== normalizeOwner("session", sessionId)) throw new Error("Dormant claim owner identity changed."); }
function normalizeOwner(namespace, value) { return String(value).startsWith(`${namespace}:`) ? value : pseudonymousIdentifier(namespace, value); }
function assertNoOverlap(claims, claim, manifest) { if (claims.some(candidate => claimsOverlapManifest(candidate, claim, manifest))) throw new Error("Overlapping cloud reservation appeared."); }
function assertRecoverableState(claim, plan) {
  const projected = projectCanonicalUntrackedClaimOnlyClaim(claim);
  try { assertRecoveredClaim(projected, plan.evidence.cloud.claim, plan); return; } catch {}
  if (canonicalJson(projected) !== canonicalJson(plan.evidence.cloud.claim)) throw new Error("Same-claim recovery source drifted.");
}
function assertRecoveredClaim(claim, source, plan) {
  const stable = ["claimId", "entrySchema", "claimIdentitySchema", "actorId", "repositoryId", "workItemId", "canonicalBaseRevision", "laneRevision", "writeSetDigest", "leaseEpoch", "reviewRequestId"];
  const recoveryKeys = Object.keys(claim.recovery || {}).sort();
  if (claim.state !== "current" || claim.writeAuthority !== true || claim.scopeReserved !== true
    || stable.some(key => claim[key] !== source[key])
    || claim.transitionCounter !== source.transitionCounter + 1
    || claim.heartbeatCounter !== source.heartbeatCounter
    || canonicalJson(claim.declaredWriteScope) !== canonicalJson(source.declaredWriteScope)
    || claim.recovery?.evidenceDigest !== plan.evidence.evidenceDigest
    || canonicalJson(recoveryKeys) !== canonicalJson(["evidenceDigest", "recoveredAt"])
    || !canonicalInstantOrFalse(claim.recovery?.recoveredAt)
    || claim.predecessorClaimId !== null || claim.integration !== null
    || Date.parse(claim.expiresAt) <= Date.now()) {
    throw new Error("Recovered claim is not the exact same-claim continuation.");
  }
  assertOwner(claim, plan.evidence.identity.device, plan.evidence.identity.sessionId);
}
function canonicalInstantOrFalse(value) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value; }
export function verifyCanonicalUntrackedClaimOnlyContinuationResult({ result, claim, source, plan, request }) {
  assertRecoveredClaim(claim, source, plan);
  const operation = result?.operationReceipt;
  const provider = result?.receipt;
  const { receiptDigest: operationReceiptDigest, ...operationCore } = operation || {};
  const { receiptDigest: providerReceiptDigest, ...providerCore } = provider || {};
  const operationTime = canonicalInstant(operation?.evaluationTime, "operation evaluation time");
  const providerTime = canonicalInstant(provider?.evaluationTime, "provider evaluation time");
  if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
    || result.action !== "continue" || result.status !== "current"
    || typeof result.replayed !== "boolean" || result.claimDigest !== claim.fenceRevision
    || operation?.schema !== "agentic-collaboration-continuation-receipt/v1"
    || operation.operation !== "continue" || operation.status !== "current"
    || operation.claimId !== source.claimId || operation.claimDigest !== claim.fenceRevision
    || operation.ledgerRevision !== claim.transitionDigest
    || operation.idempotencyKey !== digestValue(request.idempotencyKey)
    || operation.requestDigest !== recoveryRequestDigest({ source, plan, recoveredAt: operationTime })
    || operationReceiptDigest !== claim.operationReceiptDigest
    || operationReceiptDigest !== digestValue(operationCore)
    || provider?.schema !== "agentic-cloud-collaboration-github-receipt/v1"
    || provider.action !== "continue" || provider.contractReceiptDigest !== claim.operationReceiptDigest
    || provider.claimId !== claim.claimId || provider.claimDigest !== claim.fenceRevision
    || provider.ledgerRevision !== result.ledgerRevision
    || providerReceiptDigest !== digestValue(providerCore)
    || Date.parse(providerTime) < Date.parse(operationTime)
    || claim.recovery.recoveredAt !== operationTime
    || claim.expiresAt !== new Date(Date.parse(operationTime) + plan.ttlSeconds * 1_000).toISOString()
    || claim.fenceRevision === source.fenceRevision
    || claim.transitionDigest === source.transitionDigest
    || claim.operationReceiptDigest === source.operationReceiptDigest
    || !/^[0-9a-f]{40}$/u.test(String(result.ledgerRevision || ""))
    || !/^[0-9a-f]{64}$/u.test(String(result.ledgerDigest || provider.ledgerDigest || ""))) {
    throw new Error("Same-claim continuation receipts are invalid.");
  }
  return Object.freeze({
    claimId: claim.claimId,
    claimDigest: claim.fenceRevision,
    operationReceiptDigest: claim.operationReceiptDigest,
  });
}
function recoveryRequestDigest({ source, plan, recoveredAt }) {
  const intent = {
    repositoryId: source.repositoryId,
    actorId: source.actorId,
    deviceId: normalizeOwner("device", plan.evidence.identity.device),
    sessionId: normalizeOwner("session", plan.evidence.identity.sessionId),
    claimId: source.claimId,
    expectedFenceRevision: source.fenceRevision,
    expectedTransitionCounter: source.transitionCounter,
    mode: "recovery",
    laneRevision: null,
    reviewRequestId: null,
    expiresAt: new Date(Date.parse(recoveredAt) + plan.ttlSeconds * 1_000).toISOString(),
    focusedEvidenceDigest: null,
    handoffEvidenceDigest: null,
    recoveryEvidenceDigest: plan.evidence.evidenceDigest,
  };
  return digestValue({ action: "continue", intent });
}
function canonicalInstant(value, label) { const parsed = new Date(value); if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(`${label} is invalid.`); return value; }
function assertSourceAuthoritySelector(authority, plan) {
  const selector = normalizeCanonicalUntrackedClaimOnlySourceAuthoritySelector(authority);
  if (selector.ledgerRepository !== plan.evidence.cloud.ledgerRepository
    || selector.targetRepository !== plan.evidence.cloud.targetRepository
    || selector.claimId !== plan.evidence.cloud.claim.claimId) {
    throw new Error("Source authority selector does not match the sealed recovery subject.");
  }
}
function pathAbsent(candidate) { try { lstatSync(candidate); return false; } catch (error) { if (error?.code === "ENOENT") return true; throw error; } }
function parseWorktrees(value) { return value.split(/\n\n+/u).filter(Boolean).map(block => { const fields = Object.fromEntries(block.split("\n").map(line => { const split = line.indexOf(" "); return split < 0 ? [line, true] : [line.slice(0, split), line.slice(split + 1)]; })); return { path: fields.worktree ? realpathSync(fields.worktree) : null, headSha: fields.HEAD || null, branch: fields.branch || null }; }); }
function refExists(root, ref) { try { git(root, ["show-ref", "--verify", "--quiet", ref]); return true; } catch { return false; } }
function remoteRef(root, ref, { optional = false } = {}) { const output = git(root, ["ls-remote", "origin", ref]); if (!output) { if (optional) return null; throw new Error(`Remote ref is absent: ${ref}`); } const rows = output.split("\n").filter(Boolean); if (rows.length !== 1) throw new Error(`Remote ref cardinality changed: ${ref}`); return rows[0].split(/\s+/u)[0]; }
function resolveGitPath(root, value) { return path.isAbsolute(value) ? value : path.resolve(root, value); }
function repositoryFromRemote(value) { const text = required(value, "origin remote").replace(/\.git$/u, ""); const match = text.match(/(?:github\.com[/:])([^/]+\/[^/]+)$/u); if (!match) throw new Error("Origin remote is not a GitHub repository."); return repositoryName(match[1], "origin repository"); }
function repositoryName(value, label) { const result = required(value, label); if (!/^[^/\s]+\/[^/\s]+$/u.test(result)) throw new Error(`${label} is invalid.`); return result; }
function git(root, args) { return defaultExec("git", ["-C", root, ...args]); }
function defaultExec(command, args) { return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function parseJson(file, label) { try { return JSON.parse(readFileSync(file, "utf8")); } catch (error) { throw new Error(`${label} is invalid: ${error.message}`); } }
function realDirectory(value, label) { const target = absolute(value, label); const resolved = realpathSync(target); if (resolved !== target) throw new Error(`${label} must be canonical.`); return resolved; }
function realFile(value, label) { return canonicalExisting(value, label, "file"); }
function canonicalProspectivePath(value, label) { const target = absolute(value, label); rejectSymlinkTraversal(target, label); if (resolveThroughExistingAncestor(target) !== target) throw new Error(`${label} cannot traverse a symbolic-link alias.`); return target; }
function absolute(value, label) { const text = required(value, label); if (!path.isAbsolute(text)) throw new Error(`${label} must be absolute.`); return path.resolve(text); }
function required(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) throw new Error(`${label} is required.`); return value; }

export function normalizeCanonicalUntrackedClaimOnlySourceAuthoritySelector(authority) {
  if (authority?.result?.schema !== "agentic-cloud-collaboration-result/v1"
    || authority.result.ok !== true) throw new Error("Source authority result is invalid.");
  return Object.freeze({
    ledgerRepository: repositoryName(authority.ledgerRepository, "wrapped ledger repository"),
    targetRepository: repositoryName(authority.targetRepository, "wrapped target repository"),
    claimId: required(authority.result.claim?.claimId, "wrapped claim id"),
  });
}

export function createCanonicalUntrackedClaimOnlyTaskReceiptGate({
  now = () => new Date(),
  maximumAgeMs = 60_000,
} = {}) {
  if (typeof now !== "function" || !Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 1) {
    throw new Error("Task receipt gate clock is invalid.");
  }
  const issued = new Map();
  return Object.freeze({
    issue(receipt, plan) {
      requireTaskReceipt(receipt, plan, { now: now(), maximumAgeMs });
      issued.set(receipt.receiptDigest, Object.freeze({
        planDigest: plan.planDigest,
        receiptSnapshot: canonicalJson(receipt),
      }));
      return receipt;
    },
    consume(receipt, plan) {
      const registered = issued.get(receipt?.receiptDigest);
      issued.delete(receipt?.receiptDigest);
      const { purpose, ...receiptSnapshot } = receipt || {};
      if (purpose !== "cloud-continuation"
        || registered?.planDigest !== plan.planDigest
        || registered?.receiptSnapshot !== canonicalJson(receiptSnapshot)) {
        throw new Error("Fresh plan-bound task authority is required immediately before continuation.");
      }
      requireTaskReceipt(receipt, plan, { now: now(), maximumAgeMs });
      return receipt;
    },
  });
}

export function validateCanonicalUntrackedClaimOnlyPathRoles(value = {}) {
  const roots = {
    repository: canonicalExisting(value.repository, "canonical repository", "directory"),
    recoveryDirectory: canonicalExisting(value.recoveryDirectory, "preservation package", "directory"),
    controllerRoot: canonicalExisting(value.controllerRoot, "controller repository", "directory"),
  };
  const roles = {
    ...roots,
    targetWorktree: canonicalTarget(value.targetWorktree, "target worktree"),
    manifestFile: canonicalExisting(value.manifestFile, "write-scope manifest", "file"),
    cloudAuthorityFile: canonicalExisting(value.cloudAuthorityFile, "source cloud authority", "file"),
    statePath: canonicalTarget(value.statePath, "journal path"),
    journalLockPath: canonicalTarget(`${required(value.statePath, "journal path")}.lock`, "journal lock path"),
  };
  for (const [key, label] of [
    ["planFile", "plan file"], ["planOutput", "plan output"],
    ["taskAuthorityFile", "task authority capability"],
    ["authorityOutput", "authority output"],
  ]) {
    if (value[key]) roles[key] = key === "planFile" || key === "taskAuthorityFile"
      ? canonicalExisting(value[key], label, "file") : canonicalTarget(value[key], label);
  }
  const seen = new Map();
  for (const [role, candidate] of Object.entries(roles)) {
    const prior = seen.get(candidate);
    if (prior) throw new Error(`Path roles must be distinct: ${prior} and ${role}.`);
    seen.set(candidate, role);
  }
  const artifactRoles = Object.entries(roles)
    .filter(([role]) => !Object.hasOwn(roots, role));
  for (let left = 0; left < artifactRoles.length; left += 1) {
    for (let right = left + 1; right < artifactRoles.length; right += 1) {
      const [leftRole, leftPath] = artifactRoles[left];
      const [rightRole, rightPath] = artifactRoles[right];
      if (hierarchyOverlaps(leftPath, rightPath)) {
        throw new Error(`Path roles must be hierarchy-disjoint: ${leftRole} and ${rightRole}.`);
      }
    }
  }
  for (const role of ["targetWorktree", "statePath", "journalLockPath", "planFile", "planOutput", "taskAuthorityFile", "authorityOutput"]) {
    const candidate = roles[role];
    if (!candidate) continue;
    for (const [rootRole, root] of Object.entries(roots)) {
      if (inside(candidate, root)) throw new Error(`${role} must be external to ${rootRole}.`);
    }
  }
  return Object.freeze(roles);
}

function requireTaskReceipt(receipt, plan, { now, maximumAgeMs }) {
  const verifiedAt = canonicalInstant(receipt?.verifiedAt, "task receipt verification time");
  const age = now.getTime() - Date.parse(verifiedAt);
  if (receipt?.status !== "verified" || receipt.operation !== plan.taskAuthorityOperation
    || !/^[0-9a-f]{64}$/u.test(String(receipt.receiptDigest || ""))
    || !Number.isFinite(age) || age < 0 || age > maximumAgeMs) {
    throw new Error("Fresh plan-bound task authority is required immediately before continuation.");
  }
}
function canonicalExisting(value, label, kind) { const target = absolute(value, label); const stat = lstatSync(target); if (stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isDirectory()) || realpathSync(target) !== target) throw new Error(`${label} must be a canonical real ${kind}.`); return target; }
function canonicalTarget(value, label) { const target = absolute(value, label); rejectSymlinkTraversal(target, label); if (pathEntryExists(target)) { const stat = lstatSync(target); if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(target) !== target) throw new Error(`${label} must be a canonical real file path.`); } if (resolveThroughExistingAncestor(target) !== target) throw new Error(`${label} cannot traverse a symbolic-link alias.`); return target; }
function pathEntryExists(candidate) { try { lstatSync(candidate); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
function inside(candidate, root) { return candidate === root || candidate.startsWith(`${root}${path.sep}`); }
function hierarchyOverlaps(left, right) { return inside(left, right) || inside(right, left); }
function rejectSymlinkTraversal(value, label) { const parsed = path.parse(value); let cursor = parsed.root; for (const segment of value.slice(parsed.root.length).split(path.sep).filter(Boolean)) { cursor = path.join(cursor, segment); try { if (lstatSync(cursor).isSymbolicLink()) throw new Error(`${label} cannot traverse a symbolic link.`); } catch (error) { if (["ENOENT", "ENOTDIR"].includes(error?.code)) return; throw error; } } }
function resolveThroughExistingAncestor(value) { const remainder = []; let cursor = value; while (!pathEntryExists(cursor)) { const parent = path.dirname(cursor); if (parent === cursor) break; remainder.unshift(path.basename(cursor)); cursor = parent; } const anchor = pathEntryExists(cursor) ? realpathSync(cursor) : cursor; return path.resolve(anchor, ...remainder); }
