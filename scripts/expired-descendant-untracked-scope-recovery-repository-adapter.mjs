// Responsibility: Recover one expired mixed-dirt descendant through a provider-deferred successor CAS.
import { execFileSync } from "node:child_process";
import {
  closeSync, constants, fstatSync, openSync, readFileSync, realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildActiveDirtyScopeExpansionPlan,
  verifyBoundSuccessor,
  verifyPromotedSuccessor,
  verifyWaitingSuccessor,
}
  from "./active-dirty-scope-expansion-contract.mjs";
import { createRepositoryActiveDirtyScopeExpansionAdapter }
  from "./active-dirty-scope-expansion-controller.mjs";
import {
  activeDescendantUntrackedEntriesDigest,
  activeDescendantUntrackedIndexEvidenceDigest,
  activeDescendantUntrackedStableIncidentDigest,
  assertActiveDescendantUntrackedScopePartition,
  buildActiveDescendantUntrackedIncident,
  buildActiveDescendantUntrackedOwnerStopEvidence,
  buildActiveDescendantUntrackedSyntheticState,
  requireFreshActiveDescendantUntrackedOwnerStop,
} from "./active-descendant-untracked-scope-recovery-evidence.mjs";
import {
  captureActiveOwnedDirtEvidence,
  requireSameActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier }
  from "./cloud-collaboration-delivery-verifier.mjs";
import { assertAdmissionMutationAuthority }
  from "./scoped-lane-admission-state.mjs";
import {
  invokeRepositoryCloudAction,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "./scoped-lane-admission-lib.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import {
  createWriterLeaseStore,
} from "./writer-lease-lib.mjs";
import { writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
import { normalizeExpiredDescendantUntrackedScopeRecoveryPlan }
  from "./expired-descendant-untracked-scope-recovery-contract.mjs";
import {
  assertExpiredDescendantCloudTopology,
  buildExpiredDescendantUntrackedScopeRecoveryEvidence,
  expiredDescendantRelevantClaims,
} from "./expired-descendant-untracked-scope-recovery-evidence.mjs";
import {
  createExpiredDescendantUntrackedScopeRecoveryRepositoryObserver,
  preservedExpiredDescendantPullRequestDigest as preservedPullDigest,
} from "./expired-descendant-untracked-scope-recovery-repository-observer.mjs";
import {
  advanceExpiredDescendantIntent,
  beginExpiredDescendantIntent,
  bindExpiredDescendantSuccessor,
  buildExpiredDescendantInnerResult as innerResult,
  exactExpiredDescendantTargetProjection as exactTargetProjection,
  expiredDescendantIntentAtLeast as phaseAtLeast,
  projectExpiredDescendantSuccessor,
  readExpiredDescendantIntent,
  readExpiredDescendantTerminal as readTerminalRecord,
  retireExpiredDescendantSource,
} from "./expired-descendant-untracked-scope-recovery-repository-terminal.mjs";

const CONTROLLER_ROOT = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const OPERATION = "expired-descendant-untracked-scope-recovery";
export function createExpiredDescendantUntrackedScopeRecoveryRepositoryAdapter(
  options = {}, dependencies = {},
) {
  const repository = realDirectory(options.repository, "source repository");
  const sourceSessionId = text(options.sourceSessionId, "source session");
  const controllerRoot = realDirectory(options.controllerRoot || CONTROLLER_ROOT,
    "controller root");
  if (!dependencies.allowAlternateController && controllerRoot !== CONTROLLER_ROOT) {
    invalid("installed controller root");
  }
  const ttlSeconds = boundedTtl(options.ttlSeconds ?? 1_800);
  const environment = options.environment || process.env;
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, args, cwd = repository) =>
    execFileSync(command, args, { cwd, encoding: "utf8", environment,
      env: environment, maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }));
  const git = dependencies.git || ((args, cwd = repository) =>
    String(execute("git", args, cwd)).trim());
  const gitRaw = dependencies.gitRaw || ((args, cwd = repository) =>
    String(execute("git", args, cwd)));
  const gh = dependencies.gh || (args => String(execute("gh", args)).trim());
  const rawInvoke = dependencies.invoke || invokeRepositoryCloudAction;
  const rawVerify = dependencies.verify || invokeRepositoryCloudVerifier;
  const captureDirt = dependencies.captureDirt
    || (() => captureActiveOwnedDirtEvidence({ repository }));
  const commonDirectory = realDirectory(path.resolve(repository,
    git(["rev-parse", "--git-common-dir"])), "Git common directory");
  const controllerCommonDirectory = realDirectory(path.resolve(controllerRoot,
    git(["rev-parse", "--git-common-dir"], controllerRoot)),
  "controller Git common directory");
  const roots = [repository, controllerRoot, commonDirectory, controllerCommonDirectory];
  const targetManifestFile = options.targetManifestFile
    ? realExternalFile(options.targetManifestFile, "target manifest", roots) : null;
  const ownerStopReceiptFile = options.ownerStopReceiptFile
    ? realExternalFile(options.ownerStopReceiptFile, "owner stop", roots) : null;
  const historicalOwnerDecisionFile = options.historicalOwnerDecisionFile
    ? realExternalFile(options.historicalOwnerDecisionFile,
      "historical owner decision", roots) : null;
  const taskAuthorityFile = realExternalFile(options.taskAuthorityFile,
    "task authority", roots);
  const durableStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityFile,
  });
  const leaseStore = Object.freeze({
    ...durableStore,
    verify: input => durableStore.verify({ ...input, allowExpired: true }),
  });
  const observer = createExpiredDescendantUntrackedScopeRecoveryRepositoryObserver({
    repository, controllerRoot, git, gitRaw, gh, invoke: rawInvoke, captureDirt,
    alternateControllerWitness: dependencies.controllerWitness || null,
  });
  const { captureFrame, pullFrame, statusCloud, repositorySubject,
    captureTargetAdditions, controllerWitness, controllerContinuation } = observer;
  const readTerminal = plan => readTerminalRecord({ leaseStore, plan });
  let activePlan = null, activeOperation = null;

  const manifest = () => {
    if (!targetManifestFile) invalid("configured target manifest");
    return normalizeDeclaredWriteScopeManifest(
      readPrivateJson(targetManifestFile, "target manifest"),
    );
  };
  const invoke = input => {
    if (!activePlan || ["status", "verify"].includes(input?.action)) {
      return rawInvoke(input);
    }
    const operation = `${activeOperation || "unknown"}:cloud-${input?.action || "mutation"}`;
    const guarded = guardStatic(activePlan, operation);
    return rawInvoke({ ...input, request: {
      ...(input.request || {}),
      expectedLedgerDigest: guarded.cloud.ledgerDigest,
    } });
  };
  const makeBase = () => dependencies.baseAdapter
    || createRepositoryActiveDirtyScopeExpansionAdapter({
      sourceRepository: repository,
      sessionId: sourceSessionId,
      targetManifest: targetManifestFile ? manifest() : null,
      environment,
      ttlSeconds,
      gitText: args => isUntrackedQuery(args) ? "" : git(args),
      ghText: gh,
      run: (command, args) => execute(command, args),
      leaseStore,
      taskAuthorityFile,
      invoke,
      verify: rawVerify,
    });

  async function createOwnerStopReceipt() {
    const lease = requireSourceLease(leaseStore.verify({
      sessionId: sourceSessionId,
      branch: git(["branch", "--show-current"]),
    }));
    const frame = captureFrame(lease);
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
      sourceIndexEvidenceDigest: activeDescendantUntrackedIndexEvidenceDigest(frame.dirt),
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
    const rawState = await makeBase().readState();
    const lease = requireSourceLease(rawState.lease);
    if (Date.parse(lease.expiresAt) > now().getTime()) invalid("expired source lease");
    assertSourceManifestBridge(lease);
    const target = manifest();
    if (target.semanticScope !== lease.scope) invalid("target semantic scope");
    const frame = captureFrame(lease);
    const stop = ownerStop(lease, frame);
    const pull = pullFrame(lease, { requireSourceMarker: true });
    const cloud = statusCloud(lease);
    const sourceClaims = cloud.status.claims.filter(item =>
      item.claimId === lease.cloudAuthority.claimId);
    if (sourceClaims.length !== 1) invalid("single source claim");
    const sourceClaim = sourceClaims[0];
    const relevant = expiredDescendantRelevantClaims(cloud.status.claims, {
      sourceClaimId: sourceClaim.claimId,
      sourceRepositoryId: sourceClaim.repositoryId,
      sourceWorkItemId: sourceClaim.workItemId,
      targetDeclaredWriteSet: target.declaredWriteSet,
    });
    if (relevant.length !== 1 || relevant[0].claimId !== sourceClaim.claimId) {
      invalid("unclaimed target scope and absent downstream successor");
    }
    const repositoryIdentity = repositorySubject();
    const authorityRepositoryIdentity = repositorySubject(
      lease.cloudAuthority.ledgerRepository,
    );
    const additions = captureTargetAdditions({ lease, target, frame, cloud });
    const controller = controllerWitness();
    const incident = buildActiveDescendantUntrackedIncident({
      repository: lease.cloudAuthority.targetRepository,
      authorityRepository: lease.cloudAuthority.ledgerRepository,
      worktreeIdentityDigest: digestValue({ repository, branch: lease.branch }),
      sourceSessionId,
      sourceDevice: lease.device,
      sourceScope: lease.scope,
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
        binding: lease.taskAuthority, lease,
      }).bindingDigest,
      sourceManifestDigest: lease.admission.manifestDigest,
      sourceWriteSetDigest: lease.admission.writeSetDigest,
      sourceDeclaredWriteSet: lease.admission.declaredWriteSet,
      targetManifestDigest: target.manifestDigest,
      targetWriteSetDigest: target.writeSetDigest,
      targetDeclaredWriteSet: target.declaredWriteSet,
      pullRequest: pull.incident,
      controller,
      observedAt,
    });
    assertActiveDescendantUntrackedScopePartition(incident);
    const syntheticState = buildActiveDescendantUntrackedSyntheticState({
      rawState, incident,
    });
    const innerPlan = buildActiveDirtyScopeExpansionPlan({
      source: syntheticState.source,
      targetManifest: target,
      targetCanonicalBaseSha: syntheticState.targetCanonicalBaseSha,
      canonicalDescendantProof: syntheticState.canonicalDescendantProof,
    });
    return buildExpiredDescendantUntrackedScopeRecoveryEvidence({
      incident,
      innerPlan,
      sourceClaim,
      historicalOwnerDecision: historicalOwnerDecision(),
      targetAdditionProof: additions,
      pullRequestRawBodyDigest: pull.rawBodyDigest,
      pullRequestStructuralMarkerDigest: pull.structuralMarkerDigest,
      repositoryIdentity,
      authorityRepositoryIdentity,
    });
  }

  async function executeRecovery({ plan }) {
    const sealed = normalizeExpiredDescendantUntrackedScopeRecoveryPlan(plan);
    const adopted = readTerminal(sealed);
    if (adopted) return innerResult(adopted);
    activePlan = sealed;
    try {
      const base = makeBase();
      const inner = sealed.evidence.innerPlan;
      let intent = readExpiredDescendantIntent({ leaseStore,
        branch: sealed.evidence.incident.sourceBranch });
      if (!intent) {
        guardStatic(sealed, "beginIntent");
        intent = beginExpiredDescendantIntent({ leaseStore, plan: sealed });
      }

      if (!phaseAtLeast(intent.status, "waiting-successor")) {
        const result = await callBase(base, "claimWaitingSuccessor", sealed,
          { plan: inner, intent });
        const waiting = verifyWaitingSuccessor({ plan: inner, result });
        intent = advanceJournal(sealed, "waiting-successor", {
          waiting, waitingReceiptDigest: requiredDigest(
            result?.receipt?.receiptDigest, "waiting successor receipt"),
          targetClaimId: waiting.claimId, targetClaimDigest: waiting.claimDigest,
        });
      }
      const waiting = intent.waiting;

      if (!phaseAtLeast(intent.status, "source-retired")) {
        const retired = await retireCloudSource(sealed, waiting);
        intent = advanceJournal(sealed, "source-retired", {
          sourceRetirementReceiptDigest: retired.receiptDigest,
        });
      }

      if (!phaseAtLeast(intent.status, "promoted")) {
        const result = await callBase(base, "promoteSuccessor", sealed,
          { plan: inner, intent, waiting });
        const promoted = verifyPromotedSuccessor({ plan: inner, result, waiting });
        intent = advanceJournal(sealed, "promoted", {
          promoted, promotedReceiptDigest: requiredDigest(
            result?.receipt?.receiptDigest, "successor promotion receipt"),
          targetClaimId: promoted.claimId, targetClaimDigest: promoted.claimDigest,
        });
      }

      if (!phaseAtLeast(intent.status, "successor-bound")) {
        const result = await callFenced("bindSuccessor", sealed, guarded =>
          bindExpiredDescendantSuccessor({ plan: sealed, lease: guarded.current,
            promoted: intent.promoted, status: guarded.cloud.status,
            manifest: manifest(), environment, invoke, inspect: rawInvoke,
            verify: rawVerify }));
        const authority = verifyBoundSuccessor({ plan: inner,
          authority: result?.authority || result,
          reviewRequestId: inner.sourceReviewRequestId });
        intent = advanceJournal(sealed, "successor-bound", {
          boundAuthority: authority,
          boundReceiptDigest: requiredDigest(
            result?.receiptDigest || result?.verification?.receiptDigest,
            "successor binding receipt"),
          targetClaimId: authority.claimId, targetClaimDigest: authority.claimDigest,
        });
      }

      guardStatic(sealed, "projectLocal");
      const guarded = guardStatic(sealed, "provider-deferred-terminal");
      const verified = verifyAdmissionCloudAuthority({
        authority: intent.boundAuthority, manifest: manifest(),
        canonicalBaseSha: inner.targetCanonicalBaseSha, environment,
        inspect: rawInvoke, invoke: rawVerify,
      });
      const projected = projectExpiredDescendantSuccessor({ leaseStore,
        plan: sealed, authority: verified.authority, taskAuthorityFile, now,
        terminalValues: { preservedPullRequestDigest: preservedPullDigest(guarded.pull),
          completedAt: now().toISOString() },
        validateLease: updated => assertAdmissionMutationAuthority({ lease: updated,
          cloudAuthority: verified.authority,
          remoteAuthorityVerification: verified.verification }),
      });
      const terminal = projected.terminal;
      guardStatic(sealed, "terminal-complete");
      return innerResult(terminal);
    } finally {
      activePlan = null;
      activeOperation = null;
    }
  }

  async function callBase(base, name, plan, input) {
    return callFenced(name, plan, () => base[name](input));
  }

  async function callFenced(name, plan, effect) {
    activeOperation = name;
    guardStatic(plan, name);
    try {
      const result = await effect(guardStatic(plan, `${name}-effect`));
      guardStatic(plan, `${name}-post`);
      return result;
    } finally { activeOperation = null; }
  }

  function advanceJournal(plan, status, values) {
    const current = leaseStore.read(plan.evidence.incident.sourceBranch);
    return advanceExpiredDescendantIntent({ leaseStore, plan, status, values,
      expectedLeaseDigest: writerLeaseDigest(current),
      expectedClaimId: current.cloudAuthority.claimId });
  }

  async function retireCloudSource(plan, waiting) {
    return callFenced("retireSource", plan, guarded =>
      retireExpiredDescendantSource({ invoke, lease: guarded.current,
        plan, waiting, environment }));
  }

  function guardStatic(plan, operation) {
    const incident = plan.evidence.incident;
    const current = leaseStore.read(incident.sourceBranch);
    if (!current || current.sessionId !== sourceSessionId
      || realDirectory(current.worktreePath, "source worktree") !== repository) {
      invalid("live local owner");
    }
    const intent = readExpiredDescendantIntent({ leaseStore,
      branch: incident.sourceBranch });
    const terminal = intent ? null : readTerminal(plan);
    const sourceProjection = writerLeaseDigest(current) === incident.sourceLeaseDigest
      && current.cloudAuthority?.claimId === incident.sourceClaimId;
    const targetProjection = exactTargetProjection({ current, intent, terminal, plan });
    const targetPhase = Boolean(terminal);
    if ((targetPhase && !targetProjection) || (!targetPhase && !sourceProjection)) {
      invalid("phase-exact local projection");
    }
    authorizeTaskBoundLeaseMutation({ lease: current, capabilityPath: taskAuthorityFile,
      operation: `${OPERATION}:${plan.planDigest}:${operation}`, now: now() });
    const frame = captureFrame({ ...current, fenceSha: incident.sourceFenceSha });
    requireSameActiveOwnedDirtEvidence(incident.dirt, frame.dirt);
    if (frame.headSha !== incident.sourceHeadSha
      || frame.headTreeSha !== incident.sourceHeadTreeSha
      || frame.commitInventoryDigest !== incident.commitInventoryDigest
      || frame.rangeDiffDigest !== incident.rangeDiffDigest) invalid("sealed source bytes");
    ownerStop({ ...current, fenceSha: incident.sourceFenceSha }, frame, plan);
    const pull = pullFrame(current, { expected: incident.pullRequest,
      expectedRawBodyDigest: plan.evidence.pullRequestRawBodyDigest,
      expectedStructuralMarkerDigest:
        plan.evidence.pullRequestStructuralMarkerDigest });
    controllerContinuation(incident.controller);
    const cloud = statusCloud(current);
    const topologyIntent = intent || (terminal ? { status: "local-cas",
      targetClaimId: terminal.successorClaimId,
      targetClaimDigest: terminal.successorClaimDigest } : null);
    const topology = assertExpiredDescendantCloudTopology({
      claims: cloud.status.claims, plan, intent: topologyIntent, operation,
    });
    if (targetProjection && topology.target?.claimId !== current.cloudAuthority.claimId) {
      invalid("terminal cloud successor join");
    }
    return { current, sourceProjection, targetProjection, pull, cloud, topology,
      intent, terminal };
  }

  function targetAuthority(lease, plan) {
    const verified = verifyAdmissionCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: manifest(),
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
    if (lease.admission.writeSetDigest !== plan.targetWriteSetDigest
      || lease.admission.manifestDigest !== plan.targetManifestDigest) {
      invalid("terminal target admission");
    }
    return { ...verified, mutation };
  }

  async function verifyTerminal({ plan, innerResult }) {
    const sealed = normalizeExpiredDescendantUntrackedScopeRecoveryPlan(plan);
    const guarded = guardStatic(sealed, "terminal");
    const terminal = readTerminal(sealed);
    if (!guarded.targetProjection || !terminal
      || innerResult?.terminalReceiptDigest !== terminal.receiptDigest
      || innerResult?.successorClaimId !== terminal.successorClaimId
      || innerResult?.successorClaimDigest !== terminal.successorClaimDigest
      || innerResult?.targetLeaseDigest !== terminal.targetLeaseDigest) {
      invalid("terminal target projection and receipt join");
    }
    const verified = targetAuthority(guarded.current, sealed);
    return Object.freeze({
      stableIncidentDigest: activeDescendantUntrackedStableIncidentDigest(
        sealed.evidence.incident,
      ),
      sourceHeadSha: sealed.sourceHeadSha,
      sourceDirtEvidenceDigest: sealed.sourceDirtEvidenceDigest,
      successorClaimId: guarded.current.cloudAuthority.claimId,
      successorClaimDigest: guarded.current.cloudAuthority.claimDigest,
      targetLeaseDigest: writerLeaseDigest(guarded.current),
      innerCompletionReceiptDigest: innerResult.receiptDigest,
      mutationAuthorityReceiptDigest: verified.mutation.receiptDigest,
      cloudVerificationReceiptDigest: verified.verification.receiptDigest,
      preservedPullRequestDigest: preservedPullDigest(guarded.pull),
      providerProjection: "deferred",
      pullRequestMutation: false,
      verifiedAt: now().toISOString(),
    });
  }

  function ownerStop(lease, frame, plan = null) {
    if (!ownerStopReceiptFile) invalid("configured owner stop");
    return requireFreshActiveDescendantUntrackedOwnerStop({
      ownerStop: readPrivateJson(ownerStopReceiptFile, "owner stop"),
      lease, frame, sourceSessionId, ttlSeconds, now: now(),
      expectedReceiptDigest: plan?.ownerStopReceiptDigest || null,
    });
  }

  function historicalOwnerDecision() {
    if (!historicalOwnerDecisionFile) invalid("configured historical owner decision");
    return readPrivateJson(historicalOwnerDecisionFile, "historical owner decision");
  }

  function assertSourceManifestBridge(lease) {
    const legacy = digestValue({ declaredWriteSet: lease.admission.declaredWriteSet,
      writeSetDigest: lease.admission.writeSetDigest });
    if (![lease.admission.manifestDigest, legacy]
      .includes(lease.cloudAuthority.manifestDigest)) invalid("exact legacy manifest bridge");
  }

  return Object.freeze({
    createOwnerStopReceipt,
    async readEvidence() {
      const observedAt = now().toISOString();
      const first = await captureEvidence(observedAt);
      const second = await captureEvidence(observedAt);
      if (first.evidenceDigest !== second.evidenceDigest) {
        invalid("double-read evidence drift");
      }
      return second;
    },
    execute: executeRecovery,
    verifyTerminal,
  });

}

function requireSourceLease(lease) {
  if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || lease.admission?.status !== "admitted" || lease.cloudAuthority?.state !== "active"
    || !lease.taskAuthority) invalid("active admitted task-bound source lease");
  return lease;
}
function readPrivateJson(file, label) {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.size > 1024 * 1024
      || (typeof process.getuid === "function" && before.uid !== process.getuid())
      || (before.mode & 0o077) !== 0) invalid(`private ${label}`);
    const value = JSON.parse(readFileSync(descriptor, "utf8"));
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      invalid(`${label} read stability`);
    }
    return value;
  } finally { closeSync(descriptor); }
}
function realExternalFile(value, label, roots) {
  if (!path.isAbsolute(String(value || ""))) invalid(`${label} absolute path`);
  const requested = path.resolve(value), target = realpathSync(requested);
  if (requested !== target || roots.some(root => target === root
    || target.startsWith(`${root}${path.sep}`))) invalid(`${label} external location`);
  return target;
}
function realDirectory(value, label) { return realpathSync(path.resolve(text(value, label))); }
function isUntrackedQuery(args) {
  return canonicalJson(args) === canonicalJson(["ls-files", "--others", "--exclude-standard"]);
}
function boundedTtl(value) {
  if (!Number.isSafeInteger(value) || value < 60 || value > 3_600) invalid("TTL seconds"); return value;
}
function requiredDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label); return value.trim();
}
function invalid(label) { throw new Error(`Expired descendant/untracked recovery has invalid ${label}.`); }
