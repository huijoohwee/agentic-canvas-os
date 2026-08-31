// Responsibility: Guard the integrated scope-expansion controller with exact descendant/untracked evidence.
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildActiveDirtyScopeExpansionPlan, normalizeActiveDirtyScopeExpansionPlan } from "./active-dirty-scope-expansion-contract.mjs";
import { createRepositoryActiveDirtyScopeExpansionAdapter, runActiveDirtyScopeExpansion } from "./active-dirty-scope-expansion-controller.mjs";
import { captureActiveOwnedDirtEvidence, requireSameActiveOwnedDirtEvidence } from "./active-owned-dirt-recovery-evidence.mjs";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import { invokeRepositoryCloudAction, verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import { assertTaskAuthorityBinding } from "./task-bound-lane-authority-contract.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";
import { readScopeExpansionIntent, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { normalizeActiveDescendantUntrackedScopeRecoveryPlan } from "./active-descendant-untracked-scope-recovery-contract.mjs";
import {
  activeDescendantUntrackedEntriesDigest,
  activeDescendantUntrackedIndexEvidenceDigest,
  activeDescendantUntrackedStableIncidentDigest,
  assertActiveDescendantUntrackedScopePartition,
  buildActiveDescendantUntrackedSyntheticState,
  buildActiveDescendantUntrackedIncident,
  buildActiveDescendantUntrackedOwnerStopEvidence,
  requireFreshActiveDescendantUntrackedOwnerStop,
} from "./active-descendant-untracked-scope-recovery-evidence.mjs";
const CONTROLLER_ROOT = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const OPERATION = "active-descendant-untracked-scope-recovery";
const MAX_EXTERNAL_BYTES = 1024 * 1024;
const IMPLEMENTATION_FILES = Object.freeze([
  "scripts/active-descendant-untracked-scope-recovery-contract.mjs",
  "scripts/active-descendant-untracked-scope-recovery-controller.mjs",
  "scripts/active-descendant-untracked-scope-recovery-evidence.mjs",
  "scripts/active-descendant-untracked-scope-recovery-repository-adapter.mjs",
  "scripts/active-descendant-untracked-scope-recovery.mjs",
]);

export function createActiveDescendantUntrackedScopeRecoveryRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = realDirectory(options.repository, "source repository");
  const sourceSessionId = text(options.sourceSessionId, "source session");
  const controllerRoot = realDirectory(options.controllerRoot || CONTROLLER_ROOT, "controller root");
  if (!dependencies.allowAlternateController && controllerRoot !== CONTROLLER_ROOT) {
    invalid("installed controller root");
  }
  const ttlSeconds = boundedTtl(options.ttlSeconds ?? 1_800);
  const targetManifestFile = options.targetManifestFile
    ? realExternalFile(options.targetManifestFile, "target manifest", [repository, controllerRoot])
    : null;
  const ownerStopReceiptFile = options.ownerStopReceiptFile
    ? realExternalFile(options.ownerStopReceiptFile, "owner-stop receipt", [repository, controllerRoot])
    : null;
  const taskAuthorityFile = options.taskAuthorityFile
    ? realExternalFile(options.taskAuthorityFile, "task authority", [repository, controllerRoot])
    : null;
  const environment = options.environment || process.env;
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, argumentsList, cwd = repository) =>
    execFileSync(command, argumentsList, {
      cwd,
      encoding: "utf8",
      env: environment,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    }));
  const git = dependencies.git || ((argumentsList, cwd = repository) =>
    String(execute("git", argumentsList, cwd)).trim());
  const gitRaw = dependencies.gitRaw || ((argumentsList, cwd = repository) =>
    String(execute("git", argumentsList, cwd)));
  const ghText = dependencies.ghText || (argumentsList =>
    String(execute("gh", argumentsList, repository)).trim());
  const rawInvoke = dependencies.invoke || invokeRepositoryCloudAction;
  const rawVerify = dependencies.verify || invokeRepositoryCloudVerifier;
  const captureDirt = dependencies.captureDirt || (() =>
    captureActiveOwnedDirtEvidence({ repository }));
  const commonDirectory = realDirectory(path.resolve(repository,
    git(["rev-parse", "--git-common-dir"])), "Git common directory");
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityFile,
  });
  const manifest = () => {
    if (!targetManifestFile) invalid("configured target manifest");
    return normalizeDeclaredWriteScopeManifest(readPrivateJson(targetManifestFile, "target manifest"));
  };
  function makeBase(invoke = rawInvoke) {
    return dependencies.baseAdapter || createRepositoryActiveDirtyScopeExpansionAdapter({
      sourceRepository: repository,
      sessionId: sourceSessionId,
      targetManifest: targetManifestFile ? manifest() : null,
      environment,
      ttlSeconds,
      // The integrated controller owns tracked-dirt expansion. The outer
      // incident independently seals every untracked byte and proves that the
      // target manifest covers it before presenting the tracked projection.
      gitText: argumentsList => isUntrackedQuery(argumentsList)
        ? ""
        : git(argumentsList),
      ghText,
      run: (command, argumentsList) => execute(command, argumentsList, repository),
      leaseStore,
      taskAuthorityFile,
      invoke,
      verify: rawVerify,
    });
  }
  async function createOwnerStopReceipt() {
    if (!taskAuthorityFile) invalid("external task-authority capability");
    const base = makeBase();
    const state = await base.readState();
    const lease = requireSourceLease(state.lease);
    const frame = captureGitAndDirt({ lease });
    const issuedAt = now().toISOString();
    const task = authorizeTaskBoundLeaseMutation({
      lease,
      capabilityPath: taskAuthorityFile,
      operation: `${OPERATION}:owner-stop:${frame.dirt.evidenceDigest}`,
      now: new Date(issuedAt),
    });
    return buildActiveDescendantUntrackedOwnerStopEvidence({
      sourceSessionId,
      sourceBranch: lease.branch,
      sourceHeadSha: frame.headSha,
      sourceFenceSha: lease.fenceSha,
      sourceDirtEvidenceDigest: frame.dirt.evidenceDigest,
      sourceIndexEvidenceDigest:
        activeDescendantUntrackedIndexEvidenceDigest(frame.dirt),
      untrackedEntriesDigest: activeDescendantUntrackedEntriesDigest(frame.dirt),
      taskAuthorityReceiptDigest: task.receiptDigest,
      taskAuthorityProofDigest: task.proofDigest,
      taskAuthorityBindingDigest: task.bindingDigest,
      untrackedPaths: frame.untrackedPaths,
      issuedAt,
      expiresAt: new Date(Date.parse(issuedAt) + ttlSeconds * 1_000).toISOString(),
    });
  }
  async function captureEvidence(observedAt = now().toISOString()) {
    const base = makeBase();
    const rawState = await base.readState();
    const lease = requireSourceLease(rawState.lease);
    const target = manifest();
    if (target.semanticScope !== lease.scope) invalid("target semantic scope");
    const frame = captureGitAndDirt({ lease });
    const stop = requireOwnerStop({ lease, frame });
    const pull = pullRequestFrame(lease);
    const controller = controllerWitness();
    const cloud = verifySourceAuthority({ lease, pull });
    const incident = buildActiveDescendantUntrackedIncident({
      repository: lease.cloudAuthority.targetRepository,
      authorityRepository: lease.cloudAuthority.ledgerRepository,
      worktreeIdentityDigest: digestValue({ repository, branch: lease.branch }),
      sourceSessionId,
      sourceDevice: lease.device,
      sourceScope: lease.scope,
      sourceWorkItemId: cloud.claim.workItemId,
      sourceBranch: lease.branch,
      sourceBaseSha: lease.baseSha,
      sourceFenceSha: lease.fenceSha,
      sourceHeadSha: frame.headSha,
      sourceHeadTreeSha: frame.headTreeSha,
      commitInventoryDigest: frame.commitInventoryDigest,
      rangeDiffDigest: frame.rangeDiffDigest,
      committedPaths: frame.committedPaths,
      dirt: frame.dirt,
      trackedDirtyPaths: frame.trackedDirtyPaths,
      untrackedPaths: frame.untrackedPaths,
      ownerStop: stop,
      sourceLeaseDigest: writerLeaseDigest(lease),
      sourceClaimId: lease.cloudAuthority.claimId,
      sourceClaimDigest: lease.cloudAuthority.claimDigest,
      sourceTransitionCounter: lease.cloudAuthority.transitionCounter,
      sourceLedgerRevision: cloud.status.ledgerRevision,
      sourceLedgerDigest: cloud.status.ledgerDigest,
      sourceTaskAuthorityBindingDigest: assertTaskAuthorityBinding({
        binding: lease.taskAuthority,
        lease,
      }).bindingDigest,
      sourceManifestDigest: lease.admission.manifestDigest,
      sourceWriteSetDigest: lease.admission.writeSetDigest,
      sourceDeclaredWriteSet: lease.admission.declaredWriteSet,
      targetManifestDigest: target.manifestDigest,
      targetWriteSetDigest: target.writeSetDigest,
      targetDeclaredWriteSet: target.declaredWriteSet,
      pullRequest: pull,
      controller,
      observedAt,
    });
    assertActiveDescendantUntrackedScopePartition(incident);
    const syntheticState = buildActiveDescendantUntrackedSyntheticState({ rawState, incident });
    const innerPlan = buildActiveDirtyScopeExpansionPlan({
      source: syntheticState.source,
      targetManifest: target,
      targetCanonicalBaseSha: syntheticState.targetCanonicalBaseSha,
      canonicalDescendantProof: syntheticState.canonicalDescendantProof,
    });
    return { incident, innerPlan, syntheticState };
  }
  async function executeRecovery({ plan }) {
    if (!taskAuthorityFile) invalid("external task-authority capability");
    const sealed = normalizeActiveDescendantUntrackedScopeRecoveryPlan(plan);
    let activePlan = sealed;
    const guardedInvoke = input => {
      if (input?.action === "status" || input?.action === "verify") {
        return rawInvoke(input);
      }
      guardStatic(activePlan, `cloud-${input?.action || "mutation"}`);
      if (input?.action === "claim") {
        const request = {
          ...input.request,
          expectedLedgerDigest: activePlan.incident.sourceLedgerDigest,
        };
        return rawInvoke({ ...input, request });
      }
      return rawInvoke(input);
    };
    const base = makeBase(guardedInvoke);
    const guarded = guardBaseAdapter(base, sealed);
    const result = await runActiveDirtyScopeExpansion({
      targetManifest: manifest(),
      authorization: `authorize scope-expansion ${sealed.innerPlanDigest}`,
    }, { adapter: guarded });
    activePlan = null;
    return result;
  }
  function guardBaseAdapter(base, outerPlan) {
    const wrap = (name, { after = false } = {}) => async input => {
      guardStatic(outerPlan, name);
      const result = await base[name](input);
      if (after) guardStatic(outerPlan, `${name}-post`, { allowTargetMarker: true });
      return result;
    };
    return Object.freeze({
      async readState() {
        const existing = readScopeExpansionIntent({
          leaseStore,
          branch: outerPlan.incident.sourceBranch,
        });
        const captured = await captureRuntimeState(outerPlan, { allowTargetLease: Boolean(existing?.localProjection) });
        const rebuilt = existing?.planSnapshot
          ? normalizeActiveDirtyScopeExpansionPlan(existing.planSnapshot)
          : buildActiveDirtyScopeExpansionPlan({
            source: captured.syntheticState.source,
            targetManifest: manifest(),
            targetCanonicalBaseSha: captured.syntheticState.targetCanonicalBaseSha,
            canonicalDescendantProof: captured.syntheticState.canonicalDescendantProof,
          });
        if (rebuilt.planDigest !== outerPlan.innerPlanDigest) invalid("runtime inner plan");
        return captured.syntheticState;
      },
      beginIntent: wrap("beginIntent"),
      markIntent: wrap("markIntent"),
      claimWaitingSuccessor: wrap("claimWaitingSuccessor"),
      retireSource: wrap("retireSource"),
      promoteSuccessor: wrap("promoteSuccessor"),
      bindSuccessor: wrap("bindSuccessor"),
      projectLocal: wrap("projectLocal", { after: true }),
      projectPullRequest: wrap("projectPullRequest", { after: true }),
      finalize: wrap("finalize", { after: true }),
    });
  }
  async function captureRuntimeState(plan, { allowTargetLease = false } = {}) {
    guardStatic(plan, "runtime-capture", { allowTargetMarker: allowTargetLease });
    const base = makeBase();
    const rawState = await base.readState();
    const syntheticState = buildActiveDescendantUntrackedSyntheticState({
      rawState, incident: plan.incident,
    });
    return { syntheticState };
  }
  function guardStatic(plan, operation, { allowTargetMarker = false } = {}) {
    const current = leaseStore.read(plan.incident.sourceBranch);
    if (!current || current.sessionId !== sourceSessionId
      || current.branch !== plan.incident.sourceBranch
      || realDirectory(current.worktreePath, "source lease worktree") !== repository) {
      invalid("live local owner");
    }
    const sourceProjection = writerLeaseDigest(current) === plan.sourceLeaseDigest
      && current.cloudAuthority?.claimId === plan.sourceClaimId;
    const targetProjection = current.cloudAuthority?.claimId !== plan.sourceClaimId
      && current.admission?.writeSetDigest === plan.targetWriteSetDigest
      && current.admission?.manifestDigest === plan.targetManifestDigest;
    if (!sourceProjection && !targetProjection) invalid("source or target lease projection");
    const task = authorizeTaskBoundLeaseMutation({
      lease: current,
      capabilityPath: taskAuthorityFile,
      operation: `${OPERATION}:${plan.planDigest}:${operation}`,
      now: now(),
    });
    if (task.bindingDigest !== current.taskAuthority.bindingDigest) {
      invalid("fresh task-authority binding");
    }
    const frame = captureGitAndDirt({
      lease: { ...current, fenceSha: plan.sourceFenceSha },
    });
    requireSameActiveOwnedDirtEvidence(plan.incident.dirt, frame.dirt);
    if (frame.headSha !== plan.sourceHeadSha
      || frame.headTreeSha !== plan.incident.sourceHeadTreeSha
      || frame.commitInventoryDigest !== plan.incident.commitInventoryDigest
      || frame.rangeDiffDigest !== plan.incident.rangeDiffDigest) invalid("sealed source bytes");
    requireOwnerStop({ lease: { ...current, fenceSha: plan.sourceFenceSha }, frame, plan });
    const pull = pullRequestFrame({ ...current,
      pullRequestUrl: plan.incident.pullRequest.url,
      fenceSha: plan.sourceFenceSha }, {
      allowedMarkerDigests: [
        plan.incident.pullRequest.sourceMarkerDigest,
        ...(allowTargetMarker || targetProjection
          ? [digestValue(projectWriterLeasePullRequestMarker(current))]
          : []),
      ],
    });
    if (pull.nodeId !== plan.incident.pullRequest.nodeId
      || pull.number !== plan.incident.pullRequest.number
      || pull.visibleBodyDigest !== plan.incident.pullRequest.visibleBodyDigest) {
      invalid("sealed pull-request identity");
    }
    const liveController = controllerWitness();
    if (digestValue(liveController) !== digestValue(plan.incident.controller)) {
      invalid("protected controller drift");
    }
    if (sourceProjection && ["claimWaitingSuccessor", "retireSource"]
      .some(name => operation.includes(name))) {
      verifySourceAuthority({ lease: current, pull });
    }
    return { current, sourceProjection, targetProjection, pull };
  }
  async function verifyTerminal({ plan, innerResult }) {
    const sealed = normalizeActiveDescendantUntrackedScopeRecoveryPlan(plan);
    const guarded = guardStatic(sealed, "terminal", { allowTargetMarker: true });
    if (!guarded.targetProjection) invalid("terminal target lease");
    const target = guarded.current;
    const verified = verifyAdmissionCloudAuthority({
      authority: target.cloudAuthority,
      manifest: manifest(),
      canonicalBaseSha: target.baseSha,
      environment,
      inspect: rawInvoke,
      invoke: rawVerify,
    });
    const mutation = assertAdmissionMutationAuthority({
      lease: target,
      cloudAuthority: verified.authority,
      remoteAuthorityVerification: verified.verification,
    });
    const stableIncidentDigest = activeDescendantUntrackedStableIncidentDigest(
      sealed.incident,
    );
    return Object.freeze({
      stableIncidentDigest,
      sourceHeadSha: sealed.sourceHeadSha,
      sourceDirtEvidenceDigest: sealed.sourceDirtEvidenceDigest,
      successorClaimId: target.cloudAuthority.claimId,
      targetLeaseDigest: writerLeaseDigest(target),
      targetMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(target)),
      innerCompletionReceiptDigest: innerResult.receiptDigest,
      mutationAuthorityReceiptDigest: mutation.receiptDigest,
      cloudVerificationReceiptDigest: verified.verification.receiptDigest,
      verifiedAt: now().toISOString(),
    });
  }
  function captureGitAndDirt({ lease }) {
    const branch = text(git(["branch", "--show-current"]), "attached branch");
    if (branch !== lease.branch) invalid("attached source branch");
    const headSha = sha(git(["rev-parse", "HEAD"]), "source HEAD");
    const remoteFence = firstSha(git([
      "ls-remote", "--heads", "origin", `refs/heads/${branch}`,
    ]));
    if (remoteFence !== lease.fenceSha || headSha === lease.fenceSha
      || gitExit(["merge-base", "--is-ancestor", lease.fenceSha, headSha]) !== 0) {
      invalid("strict unpublished descendant");
    }
    const firstParent = lines(git([
      "rev-list", "--reverse", "--first-parent", `${lease.fenceSha}..${headSha}`,
    ]));
    const all = lines(git([
      "rev-list", "--reverse", `${lease.fenceSha}..${headSha}`,
    ]));
    if (!firstParent.length || canonicalJson(firstParent) !== canonicalJson(all)) {
      invalid("linear descendant commits");
    }
    const committedPaths = nul(gitRaw([
      "diff", "--name-only", "--no-renames", "-z",
      lease.fenceSha, headSha, "--",
    ])).sort();
    const dirt = captureDirt();
    if (dirt.headSha !== headSha) invalid("dirt HEAD");
    const trackedDirtyPaths = dirt.entries.filter(entry => !entry.untracked)
      .map(entry => entry.path).sort();
    const untrackedPaths = dirt.entries.filter(entry => entry.untracked)
      .map(entry => entry.path).sort();
    if (!trackedDirtyPaths.length || !untrackedPaths.length) {
      invalid("mixed tracked and untracked stopped dirt");
    }
    return Object.freeze({
      headSha,
      headTreeSha: sha(git(["rev-parse", `${headSha}^{tree}`]), "source tree"),
      commitInventoryDigest: digestValue(firstParent),
      rangeDiffDigest: digestValue(gitRaw([
        "diff", "--binary", "--full-index", lease.fenceSha, headSha, "--",
      ])),
      committedPaths,
      dirt,
      trackedDirtyPaths,
      untrackedPaths,
    });
  }
  function requireOwnerStop({ lease, frame, plan = null }) {
    if (!ownerStopReceiptFile) invalid("configured owner-stop receipt");
    return requireFreshActiveDescendantUntrackedOwnerStop({
      ownerStop: readPrivateJson(ownerStopReceiptFile, "owner-stop receipt"),
      lease, frame, sourceSessionId, ttlSeconds, now: now(),
      expectedReceiptDigest: plan?.ownerStopReceiptDigest || null,
    });
  }
  function verifySourceAuthority({ lease, pull }) {
    const sourceManifest = Object.freeze({
      semanticScope: lease.admission.semanticScope,
      declaredWriteSet: lease.admission.declaredWriteSet,
      writeSetDigest: lease.admission.writeSetDigest,
      manifestDigest: lease.admission.manifestDigest,
    });
    const verified = verifyAdmissionCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: sourceManifest,
      canonicalBaseSha: lease.baseSha,
      environment,
      inspect: rawInvoke,
      invoke: rawVerify,
    });
    const mutation = assertAdmissionMutationAuthority({
      lease,
      cloudAuthority: verified.authority,
      remoteAuthorityVerification: verified.verification,
    });
    const status = rawInvoke({
      action: "status",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository },
      environment,
    });
    const matches = status?.claims?.filter(claim =>
      claim.claimId === lease.cloudAuthority.claimId) || [];
    const claim = matches[0];
    if (status?.ok !== true || matches.length !== 1
      || claim.state !== "current" || claim.writeAuthority !== true
      || claim.scopeReserved !== true
      || claim.canonicalBaseRevision !== lease.baseSha
      || claim.laneRevision !== lease.fenceSha
      || claim.fenceRevision !== lease.cloudAuthority.claimDigest
      || claim.transitionCounter !== lease.cloudAuthority.transitionCounter
      || claim.reviewRequestId !== lease.cloudAuthority.reviewRequestId
      || claim.writeSetDigest !== lease.admission.writeSetDigest
      || pull.nodeId !== String(lease.cloudAuthority.reviewRequestId)
        .replace(/^github-pull-request:/u, "")) {
      invalid("fresh exact source authority");
    }
    return { verified, mutation, status, claim };
  }
  function pullRequestFrame(lease, { allowedMarkerDigests = null } = {}) {
    const value = JSON.parse(ghText([
      "pr", "view", lease.pullRequestUrl, "--json",
      "id,number,url,state,isDraft,autoMergeRequest,headRefName,headRefOid,baseRefName,baseRefOid,body",
    ]));
    const marker = parseWriterLeasePullRequestBody(value.body);
    const markerDigest = digestValue(marker);
    const sourceMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(lease));
    const expectedNodeId = String(lease.cloudAuthority.reviewRequestId || "")
      .replace(/^github-pull-request:/u, "");
    if (!marker || value.state !== "OPEN" || value.isDraft !== true
      || value.autoMergeRequest !== null || value.headRefOid !== lease.fenceSha
      || value.baseRefName !== "main" || value.id !== expectedNodeId
      || (allowedMarkerDigests && !allowedMarkerDigests.includes(markerDigest))
      || (!allowedMarkerDigests && markerDigest !== sourceMarkerDigest)) {
      invalid("exact draft pull request and marker");
    }
    return Object.freeze({
      repository: lease.cloudAuthority.targetRepository,
      nodeId: value.id,
      number: value.number,
      url: value.url,
      state: value.state,
      draft: value.isDraft,
      autoMerge: value.autoMergeRequest,
      branch: value.headRefName,
      headSha: value.headRefOid,
      baseBranch: value.baseRefName,
      baseSha: value.baseRefOid,
      visibleBodyDigest: digestValue(bodyWithoutMarker(value.body)),
      sourceMarkerDigest: markerDigest,
    });
  }
  function controllerWitness() {
    if (dependencies.controllerWitness) return dependencies.controllerWitness();
    const branch = git(["branch", "--show-current"], controllerRoot);
    const headSha = sha(git(["rev-parse", "HEAD"], controllerRoot), "controller HEAD");
    const originMainSha = sha(
      git(["rev-parse", "refs/remotes/origin/main"], controllerRoot),
      "controller origin/main",
    );
    if (branch !== "main" || headSha !== originMainSha
      || gitRaw(["status", "--porcelain=v1", "-z", "--untracked-files=all"], controllerRoot)) {
      invalid("clean protected controller");
    }
    return Object.freeze({
      repository: text(git(["remote", "get-url", "origin"], controllerRoot),
        "controller repository"),
      branch,
      headSha,
      originMainSha,
      treeSha: sha(git(["rev-parse", "HEAD^{tree}"], controllerRoot), "controller tree"),
      implementationDigest: digestValue(IMPLEMENTATION_FILES.map(file => ({
        file,
        digest: digestValue(readFileSync(path.join(controllerRoot, file))),
      }))),
    });
  }
  return Object.freeze({
    createOwnerStopReceipt,
    async readEvidence() {
      const observedAt = now().toISOString();
      const first = await captureEvidence(observedAt);
      const second = await captureEvidence(observedAt);
      if (first.incident.incidentDigest !== second.incident.incidentDigest
        || first.innerPlan.planDigest !== second.innerPlan.planDigest) {
        invalid("double-read evidence drift");
      }
      return Object.freeze({ incident: second.incident, innerPlan: second.innerPlan });
    },
    execute: executeRecovery,
    verifyTerminal,
  });
  function gitExit(argumentsList) {
    try { git(argumentsList); return 0; } catch { return 1; }
  }
}
function isUntrackedQuery(argumentsList) {
  return canonicalJson(argumentsList)
    === canonicalJson(["ls-files", "--others", "--exclude-standard"]);
}
function requireSourceLease(lease) {
  if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || lease.sessionId == null || lease.admission?.status !== "admitted"
    || lease.cloudAuthority?.state !== "active" || !lease.taskAuthority)
    invalid("active admitted task-bound source lease");
  return lease;
}
function readPrivateJson(file, label) {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_EXTERNAL_BYTES
      || (typeof process.getuid === "function" && before.uid !== process.getuid())
      || (before.mode & 0o077) !== 0) invalid(`private ${label}`);
    const value = JSON.parse(readFileSync(descriptor, "utf8"));
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      invalid(`${label} read stability`);
    }
    return value;
  } finally {
    closeSync(descriptor);
  }
}
function realExternalFile(value, label, roots) {
  if (!path.isAbsolute(String(value || ""))) invalid(`${label} absolute path`);
  const requested = path.resolve(value), target = realpathSync(requested);
  if (target !== requested) invalid(`${label} canonical path`);
  if (roots.some(root => target === root || target.startsWith(`${root}${path.sep}`))) {
    invalid(`${label} external location`);
  }
  return target;
}
function realDirectory(value, label) { return realpathSync(path.resolve(text(value, label))); }
function bodyWithoutMarker(value) {
  return String(value || "").replace(
    /<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu,
    "",
  );
}
function nul(value) { return String(value).split("\0").filter(Boolean); }
function lines(value) { return String(value).split(/\r?\n/u).filter(Boolean); }
function firstSha(value) { return sha(String(value || "").trim().split(/\s+/u)[0], "remote SHA"); }
function boundedTtl(value) {
  if (!Number.isSafeInteger(value) || value < 60 || value > 3_600) invalid("TTL seconds");
  return value;
}
function sha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value.trim();
}
function invalid(label) { throw new Error(`Active descendant/untracked recovery has invalid ${label}.`); }
