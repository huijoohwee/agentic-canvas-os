// Responsibility: Join immutable source, canonical supersession, successor, and retirement effects.
import { execFileSync } from "node:child_process"; import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path"; import { fileURLToPath } from "node:url";
import { normalizeState } from "./admitted-prepared-descendant-canonical-supersession-retirement-contract.mjs";
import { compareStructuredSupersessionDocuments, normalizeAbandonedRecoveryLineage, normalizeProviderInstant, normalizePullCloseChronology, normalizeSupersessionManifest } from "./admitted-prepared-descendant-canonical-supersession-retirement-controller.mjs";
import { canonicalJson, digestValue, validateLedger } from "./cloud-collaboration-primitives.mjs";
import { assertPreparedIntegrationRemoteFence } from "./device-branch-ownership-lib.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { assertCapabilityMatchesBinding, assertTaskAuthorityBinding, createTaskAuthorityProof,
  projectTaskAuthorityCapability, verifyTaskAuthorityProof } from "./task-bound-lane-authority-contract.mjs";
import { readTaskAuthorityCapability } from "./task-bound-lane-authority-store.mjs"; import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
const CONTROLLER_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUNTIME_FILES = ["contract", "controller", "repository-adapter", ""].map(name => `scripts/admitted-prepared-descendant-canonical-supersession-retirement${name ? `-${name}` : ""}.mjs`);
const RELEASE_SCHEMA = "agentic-admitted-prepared-descendant-canonical-supersession-local-release/v1";
const RELEASE_LEASE_KEYS = ["acquiredAt", "admission", "admittedPreparedDescendantCanonicalSupersessionRetirement", "autoDelivery", "baseSha", "branch", "cloudAuthority", "device", "epoch", "expiresAt", "fenceSha", "heartbeatAt", "integration", "pullRequestUrl", "runtimeRequired", "schema", "scope", "sessionId", "status", "taskAuthority", "worktreePath"];
const SHA = /^[0-9a-f]{40}$/u, DIGEST = /^[0-9a-f]{64}$/u;
export function createRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = absolute(options.repository, "repository"), subjectPath = absolute(options.subjectWorktree, "subject worktree"), controllerRoot = absolute(options.controllerRoot || CONTROLLER_ROOT, "controller root");
  if (controllerRoot !== CONTROLLER_ROOT) throw new Error("Retirement requires its installed controller root.");
  const targetRepository = repositoryName(options.targetRepository), ledgerRepository = repositoryName(options.ledgerRepository || "huijoohwee/agentic-canvas-os");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request number"), claimId = digest(options.claimId, "claim ID");
  const now = dependencies.now || (() => new Date()), environment = dependencies.environment || process.env, execution = { env: environment, maxBuffer: 64 * 1024 * 1024, timeout: 60_000 };
  const execute = dependencies.execute || ((command, args, cwd = repository) => execFileSync(command, args, { cwd, encoding: "utf8", ...execution }));
  const executeBuffer = dependencies.executeBuffer || ((command, args, cwd = repository) => execFileSync(command, args, { cwd, encoding: null, ...execution }));
  const git = dependencies.git || ((cwd, args) => String(execute("git", ["-C", cwd, ...args], cwd)).trim());
  const gitRaw = dependencies.gitRaw || ((cwd, args) => String(execute("git", ["-C", cwd, ...args], cwd)));
  const gitBuffer = dependencies.gitBuffer || ((cwd, args) => Buffer.from(executeBuffer("git", ["-C", cwd, ...args], cwd)));
  const gh = dependencies.gh || (args => String(execute("gh", args, repository)).trim());
  const invokeCloud = dependencies.invokeCloud || invokeRepositoryCloudAction;
  const commonDirectory = path.resolve(repository, git(repository, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const roots = { repository, subjectPath, controllerRoot, commonDirectory }, statePath = safeStatePath(options.statePath, roots);
  const sourceCapabilityPath = safeExternalFile(options.sourceTaskAuthorityFile, "source task-authority capability", roots),
    successorCapabilityPath = safeExternalFile(options.successorTaskAuthorityFile, "successor task-authority capability", roots),
    successorWriteScopePath = safeExternalFile(options.successorWriteScopeManifestFile, "successor write-scope manifest", roots);
  const successorManifestPath = safeExternalFile(options.successorManifestFile, "successor supersession manifest", roots), lockPath = `${statePath}.lock`;
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory, taskAuthorityFile: sourceCapabilityPath });
  function cloudStatus() {
    const value = dependencies.readCloud ? dependencies.readCloud()
      : invokeCloud({ action: "status", ledgerRepository, request: { targetRepository }, environment });
    if (value?.schema !== "agentic-cloud-collaboration-result/v1" || value.ok !== true
      || !Array.isArray(value.claims) || !Number.isSafeInteger(value.sequence)
      || !SHA.test(value.ledgerRevision || "") || !DIGEST.test(value.ledgerDigest || ""))
      throw new Error("Cloud status is malformed.");
    return value;
  }
  function pullProjection() {
    const input = JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--repo", targetRepository,
      "--json", "number,id,url,state,isDraft,mergedAt,closedAt,headRefName,headRefOid,headRepository,baseRefName,baseRefOid"])), raw = { ...input, closedAt: input.closedAt === null ? null : normalizeProviderInstant(input.closedAt) };
    if (raw?.headRepository?.nameWithOwner !== targetRepository)
      throw new Error("Pull request is not an exact same-repository review.");
    return { raw, public: { number: raw.number, nodeId: raw.id, url: raw.url, state: raw.state,
      isDraft: raw.isDraft, mergedAt: raw.mergedAt, closedAt: raw.closedAt, headBranch: raw.headRefName,
      headSha: raw.headRefOid, baseBranch: raw.baseRefName, baseSha: raw.baseRefOid } };
  }
  function stablePullProjection() {
    const first = pullProjection(), second = pullProjection();
    if (canonicalJson(pullStableCore(first)) !== canonicalJson(pullStableCore(second)))
      throw new Error("Pull request changed during the mandatory stable double read.");
    return second;
  }
  function timelineTransitions() {
    const read = () => {
      const raw = dependencies.readPullTimeline ? dependencies.readPullTimeline({ targetRepository, pullRequestNumber })
        : JSON.parse(gh(["api", "--paginate", "--slurp", "-H", "Accept: application/vnd.github+json",
          `repos/${targetRepository}/issues/${pullRequestNumber}/timeline`]));
      const events = Array.isArray(raw?.[0]) ? raw.flat() : raw;
      if (!Array.isArray(events)) throw new Error("Pull-request timeline is malformed.");
      return events.filter(item => ["closed", "reopened"].includes(item?.event)).map(item => ({ event: item.event,
        eventId: item.id, nodeId: item.node_id, actorLogin: item.actor?.login, actorId: item.actor?.id,
        actorType: item.actor?.type, createdAt: normalizeProviderInstant(item.created_at), performedViaGitHubApp: item.performed_via_github_app ?? null }));
    };
    const first = read(), second = read();
    if (canonicalJson(first) !== canonicalJson(second))
      throw new Error("Pull-request close timeline changed during the mandatory stable double read.");
    return second;
  }
  function pullCloseEvent(pull, { expected = undefined, observedAt = null } = {}) {
    return normalizePullCloseChronology({ pull: pull.raw, timeline: timelineTransitions(), targetRepository,
      observedAt, expectedCloseEvent: expected });
  }
  function closePullRequestConditionally(plan, pull) {
    const snapshot = dependencies.readConditionalPull
      ? dependencies.readConditionalPull({ targetRepository, pullRequestNumber })
      : readConditionalPull({ execute, repository, targetRepository, pullRequestNumber });
    assertConditionalPull(plan.subject.pullRequest, snapshot, targetRepository);
    const rechecked = stablePullProjection();
    assertPullIdentity(plan.subject.pullRequest, rechecked);
    if (rechecked.raw.state !== "OPEN") throw new Error("Pull request changed before conditional closure.");
    withEffectAuthority(plan, "close-pull-request", () => {
      if (dependencies.closePull) dependencies.closePull({ targetRepository, pullRequestNumber,
        pullRequestNodeId: pull.raw.id, expectedHeadSha: plan.subject.headSha, expectedEtag: snapshot.etag });
      else {
        execute("gh", ["api", "--method", "PATCH", "-H", "Accept: application/vnd.github+json",
          "-H", `If-Match: ${snapshot.etag}`, `repos/${targetRepository}/pulls/${pullRequestNumber}`,
          "-f", "state=closed"], repository);
      }
    });
  }
  function claimProjection(lease, status = cloudStatus()) {
    const matches = status.claims.filter(item => item?.claimId === claimId);
    if (matches.length > 1) throw new Error("Cloud claim cardinality is ambiguous.");
    if (matches.length === 0) return null;
    const claim = matches[0], authority = lease.cloudAuthority;
    if (!ownerIdentifierMatches("device", claim.deviceId, lease.device)
      || !ownerIdentifierMatches("session", claim.sessionId, lease.sessionId))
      throw new Error("Cloud claim owner identity does not match the local owner.");
    const claimDigest = claim.claimDigest || claim.fenceRevision;
    if (authority?.claimId !== claimId || authority.claimDigest !== claimDigest
      || authority.targetRepository !== targetRepository || authority.ledgerRepository !== ledgerRepository
      || authority.canonicalBaseSha !== claim.canonicalBaseRevision
      || authority.laneRevision !== claim.laneRevision || authority.writeSetDigest !== claim.writeSetDigest
      || authority.transitionCounter !== claim.transitionCounter
      || authority.reviewRequestId !== claim.reviewRequestId
      || canonicalJson(authority.cloudDeclaredWriteScope) !== canonicalJson(claim.declaredWriteScope)
      || canonicalJson(lease.admission?.declaredWriteSet) !== canonicalJson(claim.declaredWriteScope)
      || lease.admission?.writeSetDigest !== claim.writeSetDigest)
      throw new Error("Live cloud claim does not exactly match the local authority projection.");
    return { claimId, claimDigest, state: claim.state, writeAuthority: claim.writeAuthority === true,
      scopeReserved: claim.scopeReserved === true, laneRevision: claim.laneRevision,
      canonicalBaseRevision: claim.canonicalBaseRevision, transitionCounter: claim.transitionCounter,
      reviewRequestId: claim.reviewRequestId, expiresAt: new Date(claim.expiresAt).toISOString() };
  }
  function sourceCapability(lease) {
    const capability = readTaskAuthorityCapability(sourceCapabilityPath);
    const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    assertCapabilityMatchesBinding(capability, binding);
    return { capability, binding };
  }
  function sourceProof(lease, operation) {
    const { capability, binding } = sourceCapability(lease), proofTime = now();
    const proof = createTaskAuthorityProof({ capability, binding, lease, operation,
      issuedAt: proofTime.toISOString() });
    const verified = verifyTaskAuthorityProof({ proof, binding, lease, operation, now: proofTime });
    return { bindingDigest: binding.bindingDigest, proofDigest: verified.proofDigest,
      operation, verifiedAt: proofTime.toISOString() };
  }
  function retirementTerminal(plan, status, lease = leaseStore.read(plan.subject.branch)) {
    return plan.mode === "partial-recovery"
      ? requireRecoveryEntry({ status, lease, pull: plan.subject.pullRequest, expected: plan.recovery,
        gh, dependencies, ledgerRepository: plan.cloud.ledgerRepository })
      : { entry: requireRetirementEntry({ status, plan, gh, dependencies }), recovery: null };
  }
  function initialSubject(status, observedAt) {
    const registered = worktrees(gitRaw(repository, ["worktree", "list", "--porcelain", "-z"]));
    if (!registered.includes(subjectPath)) throw new Error("Prepared subject worktree is not registered.");
    const branch = git(subjectPath, ["branch", "--show-current"]), lease = leaseStore.read(branch);
    if (!lease) throw new Error("Prepared subject has no writer lease.");
    const pull = stablePullProjection(), closeEvent = pullCloseEvent(pull, { observedAt });
    const remoteHeadSha = remoteHead(git, repository, branch); assertPreparedIntegrationRemoteFence({ branch, lease,
      pullRequest: pull.raw.state === "CLOSED" ? { ...pull.raw, state: "OPEN" } : pull.raw, remoteSha: remoteHeadSha,
      gitText: args => gitRaw(subjectPath, args) });
    const headSha = git(subjectPath, ["rev-parse", "HEAD"]), treeSha = git(subjectPath, ["rev-parse", "HEAD^{tree}"]);
    const parentSha = lease.fenceSha, changedPaths = sortPaths(lease.integration.paths);
    const leaseProjection = projectLease(lease), integration = { ...lease.integration, parentSha };
    if (leaseProjection.claimId !== claimId) throw new Error("Configured claim ID does not match the source lease.");
    const claim = claimProjection(lease, status);
    const recovery = claim ? null : requireRecoveryEntry({ status, lease, pull: pull.public, gh, dependencies, ledgerRepository }).recovery;
    if (claim && claim.claimId !== leaseProjection.claimId) throw new Error("Exact cloud claim is foreign before planning.");
    const staticCore = { repository: targetRepository, path: subjectPath, branch, headSha, treeSha,
      parentSha, remoteHeadSha, changedPaths, clean: true, registered: true,
      leaseDigest: leaseProjection.leaseDigest, integration };
    const subject = { ...staticCore, stateDigest: digestValue(staticCore), lease: leaseProjection, integration,
      claim, pullRequest: { ...pull.public, closeEvent },
      sourceAuthority: sourceProof(lease, `prepared-supersession-retirement:plan:${claimId}:${headSha}`),
      rawLease: lease };
    return { mode: recovery ? "partial-recovery" : "normal", recovery, subject };
  }
  function controllerProjection() {
    const headSha = git(controllerRoot, ["rev-parse", "HEAD"]), originMainSha = git(controllerRoot, ["rev-parse", "origin/main"]);
    const remoteMainSha = remoteMain(git, controllerRoot), treeSha = git(controllerRoot, ["rev-parse", "HEAD^{tree}"]);
    const clean = gitRaw(controllerRoot, ["status", "--porcelain=v1", "--untracked-files=all"]) === "", onMain = git(controllerRoot, ["branch", "--show-current"]) === "main";
    const runtimeDigest = digestValue(RUNTIME_FILES.map(file => ({ file,
      digest: hashBuffer(readFileSync(path.join(controllerRoot, file))) })));
    return { headSha, originMainSha, treeSha, runtimeDigest, clean,
      protected: onMain && headSha === originMainSha && headSha === remoteMainSha };
  }
  function successorProjection() {
    const manifest = normalizeSupersessionManifest(readPrivateJson(successorManifestPath));
    const scope = normalizeDeclaredWriteScopeManifest(readPrivateJson(successorWriteScopePath),
      { expectedScope: manifest.semanticScope });
    if (canonicalJson(sortPaths(scope.paths)) !== canonicalJson(manifest.entries.map(item => item.path)))
      throw new Error("Successor write scope does not exactly cover the supersession entries.");
    const rawCapability = readTaskAuthorityCapability(successorCapabilityPath), projected = projectTaskAuthorityCapability(rawCapability);
    const capability = { authoritySubjectId: projected.authoritySubjectId,
      proofAdapterId: projected.proofAdapterId, generation: projected.generation,
      publicKeyDigest: projected.publicKeyDigest, issuedAt: rawCapability.issuedAt };
    const core = { semanticScope: manifest.semanticScope, targetRevision: manifest.targetRevision,
      expectedCanonicalRevision: manifest.expectedCanonicalRevision,
      sourceIntegrationRevision: manifest.sourceIntegrationRevision, paths: manifest.entries.map(item => item.path),
      manifestDigest: digestValue(manifest), writeSetDigest: scope.writeSetDigest, capability, capabilityDigest: digestValue(capability) };
    return { manifest, public: { ...core, stateDigest: digestValue(core) } };
  }
  function canonicalProjection(subject, successor) {
    const manifest = successor.manifest, protectedRevision = git(repository, ["rev-parse", "HEAD"]);
    const originMainSha = git(repository, ["rev-parse", "origin/main"]);
    if (git(repository, ["branch", "--show-current"]) !== "main" || protectedRevision !== originMainSha
      || protectedRevision !== remoteMain(git, repository)
      || gitRaw(repository, ["status", "--porcelain=v1", "--untracked-files=all"]) !== ""
      || protectedRevision !== manifest.expectedCanonicalRevision)
      throw new Error("Canonical target repository is not clean exact protected main.");
    ancestor(git, repository, subject.lease.baseSha, protectedRevision, "source base");
    const witnessRevisions = [...new Set(manifest.entries.map(item => item.integrationWitnessRevision))];
    if (witnessRevisions.length !== 1) throw new Error("Supersession entries require one integration witness revision.");
    ancestor(git, repository, witnessRevisions[0], protectedRevision, "integration witness");
    const entries = manifest.entries.map(item => {
      const subjectBlobSha = git(repository, ["rev-parse", `${subject.headSha}:${item.path}`]);
      const witnessBlobSha = git(repository, ["rev-parse", `${item.integrationWitnessRevision}:${item.path}`]);
      const canonicalBlobSha = git(repository, ["rev-parse", `${protectedRevision}:${item.path}`]);
      const sourceBytes = gitBuffer(repository, ["show", `${subject.headSha}:${item.path}`]);
      const witnessBytes = gitBuffer(repository, ["show", `${item.integrationWitnessRevision}:${item.path}`]);
      if (subjectBlobSha !== witnessBlobSha || Buffer.compare(sourceBytes, witnessBytes) !== 0)
        throw new Error(`Integration witness bytes drifted for ${item.path}.`);
      const comparison = compareStructuredSupersessionDocuments(sourceBytes,
        gitBuffer(repository, ["show", `${protectedRevision}:${item.path}`]), item);
      return { path: item.path, subjectBlobSha, witnessBlobSha, canonicalBlobSha,
        fieldParent: item.fieldParent, fieldKey: item.fieldKey,
        subjectValue: comparison.subjectValue, canonicalValue: comparison.canonicalValue,
        targetValue: manifest.targetRevision, normalizedDocumentDigest: comparison.normalizedDocumentDigest };
    });
    const dependencySourceRevision = uniqueValue(entries.map(item => item.subjectValue), "source dependency");
    const dependencyCanonicalRevision = uniqueValue(entries.map(item => item.canonicalValue), "canonical dependency");
    if (entries.some(item => item.subjectValue !== dependencySourceRevision
      || item.canonicalValue !== dependencyCanonicalRevision || item.targetValue !== manifest.targetRevision))
      throw new Error("Canonical entry dependency values are not globally joined.");
    ancestor(git, controllerRoot, dependencySourceRevision, dependencyCanonicalRevision, "source dependency");
    ancestor(git, controllerRoot, dependencyCanonicalRevision, manifest.targetRevision, "canonical dependency");
    const core = { protectedRevision, protectedTreeSha: git(repository, ["rev-parse", "HEAD^{tree}"]),
      sourceBaseRevision: subject.lease.baseSha, integrationWitnessRevision: witnessRevisions[0],
      sourceBaseAncestor: true, witnessAncestor: true, dependencySourceRevision,
      dependencyCanonicalRevision, targetDependencyRevision: manifest.targetRevision,
      dependencySourceAncestor: true, dependencyCanonicalAncestor: true, entries };
    return { ...core, stateDigest: digestValue(core) };
  }
  function preservedSubject(plan, { allowReleased = false } = {}) {
    const registered = worktrees(gitRaw(repository, ["worktree", "list", "--porcelain", "-z"]));
    const branch = git(subjectPath, ["branch", "--show-current"]), lease = leaseStore.read(plan.subject.branch);
    const integration = lease?.integration && { ...lease.integration, parentSha: lease.fenceSha };
    const core = { repository: targetRepository, path: subjectPath, branch,
      headSha: git(subjectPath, ["rev-parse", "HEAD"]),
      treeSha: git(subjectPath, ["rev-parse", "HEAD^{tree}"]), parentSha: lease?.fenceSha,
      remoteHeadSha: remoteHead(git, repository, branch), changedPaths: sortPaths(lease?.integration?.paths || []),
      clean: gitRaw(subjectPath, ["status", "--porcelain=v1", "--untracked-files=all"]) === "",
      registered: registered.includes(subjectPath), leaseDigest: plan.subject.lease.leaseDigest, integration };
    const stateDigest = digestValue(core);
    const active = lease?.status === "active" && digestValue(lease) === plan.subject.lease.leaseDigest;
    const released = allowReleased && isReleasedLease(lease, plan);
    if (stateDigest !== plan.subject.stateDigest
      || git(subjectPath, ["rev-parse", `refs/heads/${branch}`]) !== plan.subject.headSha
      || (!active && !released) || digestValue(integration) !== digestValue(plan.subject.integration))
      throw new Error("Prepared subject Git, ref, integration, or authority binding drifted.");
    return { lease, stateDigest, active, released };
  }
  function assertPreserved(plan) {
    const subject = preservedSubject(plan), controller = controllerProjection();
    const successor = successorProjection(), canonical = canonicalProjection(plan.subject, successor);
    if (digestValue(controller) !== digestValue(plan.controller)
      || successor.public.stateDigest !== plan.successor.stateDigest
      || canonical.stateDigest !== plan.canonical.stateDigest)
      throw new Error("Protected controller, canonical successor, or successor capability drifted.");
    const pull = stablePullProjection(); assertPullIdentity(plan.subject.pullRequest, pull);
    if (pull.raw.state !== plan.subject.pullRequest.state)
      throw new Error("Pull request state drifted before retirement.");
    pullCloseEvent(pull, { expected: plan.subject.pullRequest.closeEvent || undefined });
    return { subject, controller, successor, canonical };
  }
  function assertTerminalPreserved(plan) {
    const subject = preservedSubject(plan, { allowReleased: true });
    const controller = controllerProjection();
    if (!controller.clean || !controller.protected) throw new Error("Terminal controller is not clean exact protected main.");
    ancestor(git, controllerRoot, plan.controller.headSha, controller.headSha, "planned protected controller");
    const canonical = terminalCanonicalProjection(plan, controller.headSha);
    return { subject, controller, canonical };
  }
  function assertPostClaimPreserved(plan) {
    const evidence = assertTerminalPreserved(plan);
    if (!evidence.subject.active) throw new Error("Remaining retirement effects require the exact active source lease.");
    return evidence;
  }
  function terminalCanonicalProjection(plan, controllerHead) {
    const protectedRevision = git(repository, ["rev-parse", "HEAD"]);
    if (git(repository, ["branch", "--show-current"]) !== "main"
      || protectedRevision !== git(repository, ["rev-parse", "origin/main"])
      || protectedRevision !== remoteMain(git, repository)
      || gitRaw(repository, ["status", "--porcelain=v1", "--untracked-files=all"]) !== "")
      throw new Error("Terminal canonical repository is not clean exact protected main.");
    ancestor(git, repository, plan.canonical.protectedRevision, protectedRevision, "planned canonical revision");
    const values = plan.canonical.entries.map(entry => {
      const currentBlobSha = git(repository, ["rev-parse", `${protectedRevision}:${entry.path}`]);
      const comparison = compareStructuredSupersessionDocuments(
        gitBuffer(repository, ["show", `${plan.subject.headSha}:${entry.path}`]),
        gitBuffer(repository, ["show", `${protectedRevision}:${entry.path}`]), entry);
      if (comparison.normalizedDocumentDigest !== entry.normalizedDocumentDigest
        || (comparison.canonicalValue === entry.canonicalValue && currentBlobSha !== entry.canonicalBlobSha))
        throw new Error("Terminal canonical successor bytes are foreign.");
      if (comparison.canonicalValue !== entry.canonicalValue) {
        ancestor(git, controllerRoot, entry.targetValue, comparison.canonicalValue, "terminal dependency target");
        ancestor(git, controllerRoot, comparison.canonicalValue, controllerHead, "terminal dependency frontier");
      }
      return comparison.canonicalValue;
    });
    const dependencyRevision = uniqueValue(values, "terminal canonical dependency");
    return { protectedRevision, dependencyRevision,
      disposition: dependencyRevision === plan.successor.targetRevision
        ? "final-successor" : "planned-canonical" };
  }
  function withEffectAuthority(plan, operation, action) {
    if (typeof leaseStore.withRegistryLock !== "function") throw new Error("Irreversible effects require the repository writer-registry lock.");
    return leaseStore.withRegistryLock(registry => {
      const lease = registry?.leases?.[plan.subject.branch] || null;
      if (!lease || lease.status !== "active" || digestValue(lease) !== plan.subject.lease.leaseDigest)
        throw new Error("Exact active source lease changed before an irreversible effect.");
      const proof = sourceProof(lease, `prepared-supersession-retirement:${plan.planDigest}:${operation}`);
      if (proof.bindingDigest !== plan.subject.lease.taskAuthorityBindingDigest)
        throw new Error("Source capability no longer proves the active lease.");
      return action(lease, proof);
    });
  }
  return Object.freeze({
    async observe() {
      const observedAt = now().toISOString(), cloud = cloudStatus();
      const captured = initialSubject(cloud, observedAt), { subject } = captured, successor = successorProjection();
      const controller = controllerProjection(), canonical = canonicalProjection(subject, successor);
      return { mode: captured.mode, recovery: captured.recovery, observedAt,
        subject: { ...subject, rawLease: undefined }, canonical,
        successor: successor.public, controller,
        cloud: { ledgerRepository, ledgerRevision: cloud.ledgerRevision,
          ledgerDigest: cloud.ledgerDigest, sequence: cloud.sequence } };
    },
    readState: () => readPrivateState(statePath),
    writeState({ expected, next }) {
      const current = readPrivateState(statePath);
      if ((current?.stateDigest || null) !== (expected?.stateDigest || null)) {
        throw new Error("Supersession retirement state changed before compare-and-swap.");
      }
      const normalized = normalizeState(next); writeAtomic(statePath, normalized); return normalized;
    },
    withLock(context, action) { return withLock(lockPath, context, action); },
    verifySourceAuthority(plan) {
      const { lease } = assertPreserved(plan).subject;
      if (lease.status !== "active" || digestValue(lease) !== plan.subject.lease.leaseDigest)
        throw new Error("Source lease drifted before task-authority verification.");
      const suffix = plan.mode === "normal" ? "retire" : "partial-release";
      const proof = sourceProof(lease, `prepared-supersession-retirement:${plan.planDigest}:${suffix}`);
      if (plan.mode === "partial-recovery") retirementTerminal(plan, cloudStatus(), lease);
      if (proof.bindingDigest !== plan.subject.lease.taskAuthorityBindingDigest)
        throw new Error("Source task-authority binding drifted after planning.");
      return { schema: "agentic-prepared-supersession-source-authority-receipt/v1",
        ...proof, subjectStateDigest: plan.subject.stateDigest };
    },
    classifyClaim(plan) {
      const lease = leaseStore.read(plan.subject.branch), cloud = cloudStatus();
      const claim = claimProjection(lease, cloud);
      if (claim) {
        assertPreserved(plan);
        if (digestValue(claim) !== digestValue(plan.subject.claim)) throw new Error("Cloud claim drifted.");
        return { state: "pending" };
      }
      assertTerminalPreserved(plan);
      const { entry, recovery } = retirementTerminal(plan, cloud, lease);
      const evidence = recovery || plan.retirementEvidence;
      return { state: "complete", values: {
        schema: "agentic-prepared-supersession-claim-retirement-receipt/v1", claimId: plan.subject.lease.claimId,
        retirementEntryDigest: recovery ? recovery.retirementEntryDigest : digestValue(entry),
        finalRevision: plan.subject.lease.fenceSha,
        retirementReason: recovery ? "abandoned" : "superseded", bytesDigest: evidence.bytesDigest,
        namedChecksDigest: evidence.namedChecksDigest, handoffEvidenceDigest: evidence.handoffEvidenceDigest,
        providerMutation: !recovery } };
    },
    retireClaim(plan) {
      if (plan.mode === "partial-recovery") throw new Error("Partial recovery forbids cloud mutation.");
      const preserved = assertPreserved(plan), cloud = cloudStatus();
      const claim = claimProjection(preserved.subject.lease, cloud);
      if (!claim) { requireRetirementEntry({ status: cloud, plan, gh, dependencies }); return; }
      if (digestValue(claim) !== digestValue(plan.subject.claim)) throw new Error("Cloud claim drifted before retirement.");
      withEffectAuthority(plan, "retire-cloud-claim", lease => {
        const request = { targetRepository, claimId, expectedFenceRevision: claim.claimDigest,
          expectedTransitionCounter: claim.transitionCounter, expectedLedgerDigest: cloud.ledgerDigest,
          deviceId: lease.device, sessionId: lease.sessionId,
          reason: "superseded", finalRevision: plan.subject.lease.fenceSha,
          reviewRequestId: claim.reviewRequestId, ...plan.retirementEvidence,
          integrationReceiptDigest: null, idempotencyKey: claimOperationKey(plan) };
        const result = invokeCloud({ action: "retire", ledgerRepository, request, environment });
        if (result?.ok !== true || result.operationReceipt?.operation !== "retire"
          || result.operationReceipt.idempotencyKey !== digestValue(request.idempotencyKey))
          throw new Error("Cloud retirement returned a foreign operation receipt.");
      });
      assertTerminalPreserved(plan);
    },
    classifyPullRequest(plan) {
      retirementTerminal(plan, cloudStatus());
      const pull = stablePullProjection(); assertPullIdentity(plan.subject.pullRequest, pull);
      if (pull.raw.state === "OPEN") {
        if (plan.subject.pullRequest.state !== "OPEN") throw new Error("Preclosed pull request was reopened.");
        pullCloseEvent(pull); assertPostClaimPreserved(plan); return { state: "pending" };
      }
      const closeEvent = pullCloseEvent(pull, { expected: plan.subject.pullRequest.closeEvent || undefined });
      assertTerminalPreserved(plan);
      const remoteHeadSha = remoteHead(git, repository, plan.subject.branch);
      if (remoteHeadSha !== plan.subject.remoteHeadSha) throw new Error("Remote subject head drifted after closure.");
      return { state: "complete", values: {
        schema: "agentic-prepared-supersession-pull-request-close-receipt/v1",
        pullRequestNumber, pullRequestNodeId: pull.raw.id,
        closedAt: pull.raw.closedAt, closeEventDigest: digestValue(closeEvent),
        providerMutation: plan.subject.pullRequest.state === "OPEN",
        remoteHeadSha, subjectStateDigest: plan.subject.stateDigest } };
    },
    closePullRequest(plan) {
      if (plan.mode === "partial-recovery") throw new Error("Partial recovery forbids pull-request mutation.");
      assertPostClaimPreserved(plan);
      retirementTerminal(plan, cloudStatus());
      const pull = stablePullProjection(); assertPullIdentity(plan.subject.pullRequest, pull);
      if (pull.raw.state === "CLOSED") { pullCloseEvent(pull, { expected: plan.subject.pullRequest.closeEvent || undefined }); return; }
      if (plan.subject.pullRequest.state !== "OPEN") throw new Error("Preclosed pull request was reopened.");
      pullCloseEvent(pull);
      closePullRequestConditionally(plan, pull);
    },
    classifyOwnerReleased(plan) {
      const lease = leaseStore.read(plan.subject.branch);
      if (isReleasedLease(lease, plan)) {
        assertTerminalPreserved(plan);
        return { state: "complete", values: {
          schema: "agentic-prepared-supersession-owner-release-receipt/v1",
          leaseDigest: plan.subject.lease.leaseDigest, releasedLeaseDigest: digestValue(lease),
          releasedAt: lease.admittedPreparedDescendantCanonicalSupersessionRetirement.completedAt,
          localMutation: true, mode: plan.mode, retirementEntryDigest: plan.recovery?.retirementEntryDigest ?? null,
          retirementReason: plan.mode === "normal" ? "superseded" : "abandoned",
          subjectStateDigest: plan.subject.stateDigest } };
      }
      assertPostClaimPreserved(plan);
      if (!lease || digestValue(lease) !== plan.subject.lease.leaseDigest) throw new Error("Local lease drifted.");
      return { state: "pending" };
    },
    releaseOwner(plan) {
      (plan.mode === "partial-recovery" ? assertPreserved : assertPostClaimPreserved)(plan);
      const current = leaseStore.read(plan.subject.branch);
      if (isReleasedLease(current, plan)) return;
      if (!current || digestValue(current) !== plan.subject.lease.leaseDigest) throw new Error("Local lease drifted before release.");
      if (plan.mode === "partial-recovery") {
        retirementTerminal(plan, cloudStatus(), current); const pull = stablePullProjection();
        assertPullIdentity(plan.subject.pullRequest, pull); pullCloseEvent(pull, { expected: plan.subject.pullRequest.closeEvent });
      }
      const completedAt = now().toISOString(), proof = sourceProof(current, `prepared-supersession-retirement:${plan.planDigest}:release-local-lease`);
      if (proof.bindingDigest !== plan.subject.lease.taskAuthorityBindingDigest)
        throw new Error("Source capability no longer proves the lease before release.");
      const core = { schema: RELEASE_SCHEMA, status: "retired-preserved", planDigest: plan.planDigest,
        claimId: plan.subject.lease.claimId, subjectStateDigest: plan.subject.stateDigest, canonicalStateDigest: plan.canonical.stateDigest,
        successorStateDigest: plan.successor.stateDigest, originalLeaseDigest: plan.subject.lease.leaseDigest,
        mode: plan.mode, retirementReason: plan.mode === "partial-recovery" ? "abandoned" : "superseded",
        retirementEntryDigest: plan.mode === "partial-recovery" ? plan.recovery.retirementEntryDigest : null, completedAt };
      if (plan.mode === "partial-recovery") assertPreserved(plan);
      leaseStore.release({ sessionId: current.sessionId, branch: current.branch, expectedLease: current,
        status: "released", timestamp: completedAt, values: { admission: null, cloudAuthority: null,
          admittedPreparedDescendantCanonicalSupersessionRetirement:
            { ...core, receiptDigest: digestValue(core) } } });
      assertTerminalPreserved(plan);
    },
    verifyTerminal(plan) {
      const preserved = assertTerminalPreserved(plan), cloud = cloudStatus(), pull = stablePullProjection();
      const claim = claimProjection(preserved.subject.lease, cloud), lease = leaseStore.read(plan.subject.branch);
      if (!claim) retirementTerminal(plan, cloud, preserved.subject.lease);
      assertPullIdentity(plan.subject.pullRequest, pull);
      const closeEvent = pullCloseEvent(pull, { expected: plan.subject.pullRequest.closeEvent || undefined });
      if (claim || pull.raw.state !== "CLOSED" || pull.raw.mergedAt !== null
        || !isReleasedLease(lease, plan) || preserved.subject.stateDigest !== plan.subject.stateDigest)
        throw new Error("Terminal supersession retirement evidence did not converge.");
      return { terminalEvidenceDigest: digestValue({ claimAbsent: true, pullState: pull.raw.state,
        pullClosedAt: pull.raw.closedAt, closeEventDigest: digestValue(closeEvent), leaseDigest: digestValue(lease),
        mode: plan.mode, retirementEntryDigest: plan.recovery?.retirementEntryDigest ?? null,
        subjectStateDigest: plan.subject.stateDigest, canonicalStateDigest: plan.canonical.stateDigest,
        successorStateDigest: plan.successor.stateDigest, remoteHeadSha: plan.subject.remoteHeadSha }) };
    },
  });
}
function pullStableCore({ raw, public: projection }) { return { ...projection, closedAt: raw.closedAt ?? null, headRepository: raw.headRepository?.nameWithOwner ?? null }; }
function readConditionalPull({ execute, repository, targetRepository, pullRequestNumber }) {
  const response = String(execute("gh", ["api", "--include", "--method", "GET", "-H", "Accept: application/vnd.github+json",
    `repos/${targetRepository}/pulls/${pullRequestNumber}`], repository));
  const split = response.search(/\r?\n\r?\n\s*\{/u);
  if (split < 0) throw new Error("Conditional pull-request response is malformed.");
  const etag = response.slice(0, split).match(/^etag:\s*(.+)$/imu)?.[1]?.trim();
  let raw; try { raw = JSON.parse(response.slice(response.indexOf("{", split))); }
  catch { throw new Error("Conditional pull-request body is malformed."); }
  if (!etag || !raw) throw new Error("Conditional pull-request ETag is missing.");
  return { etag, number: raw.number, nodeId: raw.node_id, url: raw.html_url,
    state: String(raw.state || "").toUpperCase(), isDraft: raw.draft === true,
    mergedAt: raw.merged_at ?? null, headBranch: raw.head?.ref, headSha: raw.head?.sha,
    headRepository: raw.head?.repo?.full_name, baseBranch: raw.base?.ref, baseSha: raw.base?.sha };
}
function assertConditionalPull(expected, actual, targetRepository) {
  if (!actual || typeof actual.etag !== "string" || !actual.etag.trim())
    throw new Error("Conditional pull-request identity is missing its ETag.");
  for (const field of ["number", "nodeId", "url", "isDraft", "mergedAt", "headBranch", "headSha", "baseBranch", "baseSha"])
    if (actual[field] !== expected[field]) throw new Error(`Conditional pull-request ${field} changed before closure.`);
  if (actual.state !== "OPEN" || actual.headRepository !== targetRepository)
    throw new Error("Conditional pull-request provider identity changed before closure.");
}
function projectLease(lease) {
  const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  return { status: lease.status, epoch: lease.epoch, sessionId: lease.sessionId, device: lease.device,
    scope: lease.scope, branch: lease.branch, worktreePath: path.resolve(lease.worktreePath), baseSha: lease.baseSha,
    fenceSha: lease.fenceSha, pullRequestUrl: lease.pullRequestUrl, autoDelivery: lease.autoDelivery === true,
    runtimeRequired: lease.runtimeRequired === true, acquiredAt: lease.acquiredAt,
    admissionStatus: lease.admission?.status, semanticScope: lease.admission?.semanticScope, declaredWriteSet: lease.admission?.declaredWriteSet,
    writeSetDigest: lease.admission?.writeSetDigest,
    manifestDigest: lease.admission?.manifestDigest, claimId: lease.cloudAuthority?.claimId,
    taskAuthoritySubjectId: binding.authoritySubjectId, taskAuthorityBindingDigest: binding.bindingDigest,
    leaseDigest: digestValue(lease) };
}
function assertPullIdentity(expected, actual) { for (const key of ["number", "nodeId", "url", "isDraft", "mergedAt", "headBranch", "headSha", "baseBranch", "baseSha"])
  if (actual.public[key] !== expected[key]) throw new Error("Pull request identity drifted."); }
function isReleasedLease(lease, plan) {
  const receipt = lease?.admittedPreparedDescendantCanonicalSupersessionRetirement, core = receipt && { ...receipt };
  if (core) delete core.receiptDigest;
  const receiptKeys = ["canonicalStateDigest", "claimId", "completedAt", "mode", "originalLeaseDigest", "planDigest",
    "receiptDigest", "retirementEntryDigest", "retirementReason", "schema", "status", "subjectStateDigest", "successorStateDigest"];
  let binding;
  try { binding = assertTaskAuthorityBinding({ binding: lease?.taskAuthority, lease: {
    branch: lease?.branch, scope: lease?.scope, device: lease?.device, epoch: lease?.epoch,
    baseSha: lease?.baseSha, cloudAuthority: { claimId: plan.subject.lease.claimId } } }); } catch { return false; }
  return lease?.schema === "agentic-writer-lease/v2" && lease.status === "released" && canonicalJson(Object.keys(lease).sort(comparePath)) === canonicalJson(RELEASE_LEASE_KEYS)
    && lease.epoch === plan.subject.lease.epoch && lease.sessionId === plan.subject.lease.sessionId && lease.device === plan.subject.lease.device
    && lease.scope === plan.subject.lease.scope && lease.branch === plan.subject.branch && path.resolve(lease.worktreePath || "") === plan.subject.path
    && lease.baseSha === plan.subject.lease.baseSha && lease.fenceSha === plan.subject.lease.fenceSha && lease.pullRequestUrl === plan.subject.lease.pullRequestUrl
    && lease.autoDelivery === plan.subject.lease.autoDelivery && lease.runtimeRequired === plan.subject.lease.runtimeRequired && lease.acquiredAt === plan.subject.lease.acquiredAt
    && lease.admission === null && lease.cloudAuthority === null && digestValue({ ...lease.integration, parentSha: lease.fenceSha }) === digestValue(plan.subject.integration)
    && binding.authoritySubjectId === plan.subject.lease.taskAuthoritySubjectId && binding.bindingDigest === plan.subject.lease.taskAuthorityBindingDigest
    && receipt?.schema === RELEASE_SCHEMA && receipt.status === "retired-preserved" && canonicalJson(Object.keys(receipt).sort(comparePath)) === canonicalJson(receiptKeys)
    && receipt.planDigest === plan.planDigest && receipt.claimId === plan.subject.lease.claimId && receipt.mode === plan.mode
    && receipt.retirementEntryDigest === (plan.recovery?.retirementEntryDigest ?? null) && receipt.retirementReason === (plan.mode === "normal" ? "superseded" : "abandoned")
    && receipt.subjectStateDigest === plan.subject.stateDigest && receipt.canonicalStateDigest === plan.canonical.stateDigest && receipt.successorStateDigest === plan.successor.stateDigest
    && receipt.originalLeaseDigest === plan.subject.lease.leaseDigest && isCanonicalInstant(receipt.completedAt)
    && lease.heartbeatAt === receipt.completedAt && lease.expiresAt === receipt.completedAt && receipt.receiptDigest === digestValue(core);
}
function requireRecoveryEntry({ status, lease, pull, expected = null, gh, dependencies, ledgerRepository }) {
  const ledger = dependencies.readLedger ? dependencies.readLedger(status)
    : JSON.parse(gh(["api", "--method", "GET", "-H", "Accept: application/vnd.github.raw+json", `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`, "-f", `ref=${status.ledgerRevision}`]));
  return normalizeAbandonedRecoveryLineage({ ledger, status, lease, pull, expected });
}
function requireRetirementEntry({ status, plan, gh, dependencies }) {
  const ledger = dependencies.readLedger ? dependencies.readLedger(status)
    : JSON.parse(gh(["api", "--method", "GET", "-H", "Accept: application/vnd.github.raw+json",
      `repos/${plan.cloud.ledgerRepository}/contents/.agentic/collaboration-ledger.json`, "-f", `ref=${status.ledgerRevision}`]));
  const entry = ledger.entries.filter(item => item.claimId === plan.subject.claim.claimId).at(-1);
  const claim = entry?.claimCore, retirement = claim?.retirement;
  if (validateLedger(ledger).length > 0 || ledger.headDigest !== status.ledgerDigest || ledger.sequence !== status.sequence
    || entry?.action !== "retire" || claim?.state !== "retired"
    || claim.claimId !== plan.subject.claim.claimId || claim.canonicalBaseRevision !== plan.subject.lease.baseSha
    || claim.laneRevision !== plan.subject.lease.fenceSha || claim.writeSetDigest !== plan.subject.lease.writeSetDigest
    || canonicalJson(claim.declaredWriteScope) !== canonicalJson(plan.subject.lease.declaredWriteSet)
    || !ownerIdentifierMatches("device", claim.deviceId, plan.subject.lease.device)
    || !ownerIdentifierMatches("session", claim.sessionId, plan.subject.lease.sessionId)
    || claim.transitionCounter !== plan.subject.claim.transitionCounter + 1
    || retirement?.reason !== "superseded" || retirement.finalRevision !== plan.subject.lease.fenceSha
    || retirement.reviewRequestId !== plan.subject.claim.reviewRequestId || retirement.bytesDigest !== plan.retirementEvidence.bytesDigest
    || retirement.namedChecksDigest !== plan.retirementEvidence.namedChecksDigest || retirement.handoffEvidenceDigest !== plan.retirementEvidence.handoffEvidenceDigest
    || retirement.integrationReceiptDigest !== null
    || entry.idempotencyKey !== digestValue(claimOperationKey(plan))) throw new Error("Cloud claim reached a foreign terminal operation.");
  return entry;
}
function claimOperationKey(plan) { return `admitted-prepared-descendant-canonical-supersession-retirement:${plan.planDigest}:claim`; }
function ownerIdentifierMatches(namespace, projected, local) { return typeof local === "string" && local.length > 0 && (projected === local || projected === pseudonymousIdentifier(namespace, local)); }
function ancestor(git, cwd, older, newer, label) { try { git(cwd, ["merge-base", "--is-ancestor", older, newer]); } catch { throw new Error(`${label} is not an ancestor of its protected successor.`); } }
function remoteHead(git, cwd, branch) { const lines = git(cwd, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split("\n").filter(Boolean); if (lines.length !== 1 || !SHA.test(lines[0].split(/\s+/u)[0])) throw new Error("Remote branch is missing or ambiguous."); return lines[0].split(/\s+/u)[0]; }
function remoteMain(git, cwd) { const lines = git(cwd, ["ls-remote", "--heads", "origin", "refs/heads/main"]).split("\n").filter(Boolean); if (lines.length !== 1 || !SHA.test(lines[0].split(/\s+/u)[0])) throw new Error("Protected remote main is missing or ambiguous."); return lines[0].split(/\s+/u)[0]; }
function worktrees(raw) { const result = []; for (const field of String(raw).split("\0")) if (field.startsWith("worktree ")) result.push(path.resolve(field.slice(9))); return result; }
function sortPaths(values) { return [...values].sort(comparePath); }
function comparePath(left, right) { return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")); }
function uniqueValue(values, label) { if (new Set(values).size !== 1) throw new Error(`${label} revisions are ambiguous.`); return values[0]; }
function hashBuffer(value) { return createHash("sha256").update(value).digest("hex"); }
function readPrivateJson(file) { assertPrivateParent(file, "External JSON"); assertPrivateFile(file, "External JSON"); return JSON.parse(readFileSync(file, "utf8")); }
function readPrivateState(file) { try { assertPrivateParent(file, "State path"); assertPrivateFile(file, "State path"); return JSON.parse(readFileSync(file, "utf8")); } catch (error) { if (error?.code === "ENOENT") return null; throw error; } }
function writeAtomic(file, value) { const directory = path.dirname(file); mkdirSync(directory, { recursive: true, mode: 0o700 }); const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`, descriptor = openSync(temporary, "wx", 0o600);
  try { writeFileSync(descriptor, `${canonicalJson(value)}\n`); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  renameSync(temporary, file); }
async function withLock(file, context, action) { mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); let descriptor, owned = false;
  try { descriptor = openSync(file, "wx", 0o600); owned = true; writeFileSync(descriptor, `${canonicalJson({ pid: process.pid, token: randomUUID(), context })}\n`); closeSync(descriptor); descriptor = null; return await action(); }
  catch (error) { if (error?.code === "EEXIST") throw new Error("Supersession retirement operation is already locked."); throw error; }
  finally { if (descriptor !== undefined && descriptor !== null) closeSync(descriptor); if (owned && existsSync(file)) unlinkSync(file); } }
function safeStatePath(value, roots) { const result = path.resolve(text(value, "state path"));
  if (!path.isAbsolute(value) || path.extname(result) !== ".json") throw new Error("State path must be an absolute JSON path.");
  assertPrivateParent(result, "State path"); if (existsSync(result)) assertPrivateFile(result, "State path"); assertOutside(result, roots, "State path"); return result; }
function safeExternalFile(value, label, roots) { if (!path.isAbsolute(value || "")) throw new Error(`${label} path must be absolute.`);
  const result = path.resolve(value); assertPrivateParent(result, label); assertPrivateFile(result, label); assertOutside(result, roots, label); return result; }
function assertPrivateParent(value, label) { const parent = path.dirname(value), stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(parent) !== parent || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error(`${label} parent must be a canonical private owner directory.`); }
function assertPrivateFile(value, label) { const stat = lstatSync(value);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(value) !== value || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error(`${label} must be a canonical private owner file.`); }
function assertOutside(value, roots, label) { for (const root of Object.values(roots)) { const relative = path.relative(path.resolve(root), value);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error(`${label} must remain outside repositories and worktrees.`); } }
function absolute(value, label) { return path.resolve(text(value, label)); }
function text(value, label) { if (typeof value !== "string" || !value.trim() || value.trim() !== value) throw new Error(`${label} is invalid.`); return value; }
function repositoryName(value) { const result = text(value, "repository identity"); if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw new Error("Repository identity is invalid."); return result; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function isCanonicalInstant(value) { const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value; }
