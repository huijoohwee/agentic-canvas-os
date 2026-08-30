// Responsibility: join protected source, cloud, registry, capability, PR, and private-journal effects.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildActiveDirtyScopeExpansionSuccessorAdmission } from "./active-dirty-scope-expansion-successor-projection.mjs";
import { digestValue, normalizeWriteSet, validateLedger, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import { bindAdmissionCloudAuthority, invokeRepositoryCloudAction, verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import { authorizeTaskBoundLeaseMutation, continueTaskAuthorityCloudSuccessorBinding } from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, readScopeExpansionIntent, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { successorRolloverOperationKey, successorRolloverTaskOperation } from "./active-dirty-scope-expansion-successor-rollover-contract.mjs";
import { createSuccessorRolloverJournalStore } from "./active-dirty-scope-expansion-successor-rollover-controller.mjs";
import { claimOnlyOperationReceiptForEntry } from "./claim-only-partial-start-retirement-store.mjs"; import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { normalizeSuccessorRolloverContinuationPlan } from "./active-dirty-scope-expansion-successor-rollover-continuation-contract.mjs"; import { buildSuccessorRolloverContinuationFrame, captureSuccessorRolloverProtectedControllerAdvance } from "./active-dirty-scope-expansion-successor-rollover-continuation-frame.mjs"; import { buildSuccessorRolloverContinuationRefreshFrame, normalizeSuccessorRolloverContinuationRefreshPlan, rebuildSuccessorRolloverAuthorizedPrMarkerFrame, requireSuccessorRolloverContinuationRefreshJournal } from "./active-dirty-scope-expansion-successor-rollover-continuation-refresh.mjs";
import { assertSuccessorRolloverBindMutationAllowed, assertSuccessorRolloverTerminalControllerIdentity, classifySuccessorRolloverBindEvidence, projectSuccessorRolloverTerminalVerifiedLease, requireSuccessorRolloverSealedBindEvidence } from "./active-dirty-scope-expansion-successor-rollover-bind-evidence.mjs";
import { requireProtectedMainEquivalent } from "./device-branch-ownership-lib.mjs"; const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const OPERATION = "active-dirty-scope-expansion-successor-rollover", RETIREMENT_SCHEMA = `agentic-${OPERATION}-retirement/v1`, LOCAL_SCHEMA = `agentic-${OPERATION}-local-receipt/v1`;
const IMPLEMENTATION = Object.freeze([
  "scripts/active-dirty-scope-expansion-successor-rollover-contract.mjs", "scripts/active-dirty-scope-expansion-successor-rollover-controller.mjs", "scripts/active-dirty-scope-expansion-successor-rollover-repository-adapter.mjs",
  "scripts/active-dirty-scope-expansion-successor-rollover.mjs", "scripts/active-dirty-scope-expansion-successor-rollover-bind-evidence.mjs", "scripts/active-dirty-scope-expansion-successor-rollover-continuation-contract.mjs", "scripts/active-dirty-scope-expansion-successor-rollover-continuation-frame.mjs", "scripts/active-dirty-scope-expansion-successor-rollover-continuation-refresh.mjs", "scripts/claim-only-partial-start-retirement-store.mjs",
  "__tests__/active-dirty-scope-expansion-successor-rollover-bind-evidence.test.mjs",
    "__tests__/active-dirty-scope-expansion-successor-rollover-continuation-contract.test.mjs", "__tests__/active-dirty-scope-expansion-successor-rollover-continuation-refresh.test.mjs", "__tests__/active-dirty-scope-expansion-successor-rollover-contract.test.mjs", "__tests__/active-dirty-scope-expansion-successor-rollover-controller.test.mjs",
  "__tests__/active-dirty-scope-expansion-successor-rollover-repository-adapter.test.mjs", "docs/ACTIVE-DIRTY-SCOPE-EXPANSION-SUCCESSOR-ROLLOVER.md",
]);
export function createActiveDirtyScopeExpansionSuccessorRolloverRepositoryAdapter(options = {}, dependencies = {}) { const repository = realpathSync(path.resolve(text(options.repository, "source repository")));
  const sourceSessionId = text(options.sourceSessionId, "source session");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request number");
  const controllerRoot = realpathSync(path.resolve(options.controllerRoot || CONTROLLER_ROOT));
  if (controllerRoot !== realpathSync(CONTROLLER_ROOT)) invalid("installed protected controller root");
  const externalRoots = [repository, controllerRoot];
  const statePath = externalPath(options.statePath ?? options.journalFile, externalRoots, "journal state", { allowMissing: true });
  if (options.statePath && options.journalFile && path.resolve(options.statePath) !== path.resolve(options.journalFile)) invalid("journal path aliases");
  const taskAuthorityFile = options.taskAuthorityFile ? privateCapabilityPath(options.taskAuthorityFile, externalRoots) : null;
  const correctedManifestFile = options.correctedManifestFile ? externalPath(options.correctedManifestFile, externalRoots, "corrected manifest") : null;
  const continuationPlan = options.continuationPlan ? (dependencies.normalizeContinuationPlan || normalizeSuccessorRolloverContinuationPlan)(options.continuationPlan) : null, refreshContinuationPlan = options.refreshContinuationPlan === true, continuationRefreshPlan = options.continuationRefreshPlan ? (dependencies.normalizeContinuationRefreshPlan || normalizeSuccessorRolloverContinuationRefreshPlan)(options.continuationRefreshPlan) : null; if ((refreshContinuationPlan || continuationRefreshPlan) && !continuationPlan || continuationRefreshPlan && continuationRefreshPlan.continuationPlanDigest !== continuationPlan.planDigest) invalid("continuation refresh plan");
  const environment = dependencies.environment || process.env;
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, args, cwd = repository) => execFileSync(command, args,
    { cwd, encoding: "utf8", env: environment, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }));
  const git = dependencies.git || ((args, cwd = repository) => String(execute("git", args, cwd)).trim());
  const gitRaw = dependencies.gitRaw || ((args, cwd = repository) => String(execute("git", args, cwd)));
  const gh = dependencies.gh || (args => String(execute("gh", args, repository)).trim());
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verify = dependencies.verify || invokeRepositoryCloudVerifier;
  const authorize = dependencies.authorizeTaskAuthority || authorizeTaskBoundLeaseMutation;
  const continueBinding = dependencies.continueTaskAuthorityBinding || continueTaskAuthorityCloudSuccessorBinding;
  const commonDirectory = realpathSync(path.resolve(repository, git(["rev-parse", "--git-common-dir"])));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory, taskAuthorityFile, });
  if (!leaseStore.statePath || typeof leaseStore.withRegistryLock !== "function") invalid("writer-registry CAS capability");
  const branch = text(git(["branch", "--show-current"]), "source branch");
  const registered = assertRegisteredWorktree({ cwd: repository, porcelain: gitRaw(["worktree", "list", "--porcelain", "-z"]) });
  if (registered.branch !== `refs/heads/${branch}`) invalid("registered source branch");
  const pendingAuthority = new Map();
  const journalStore = createSuccessorRolloverJournalStore({ statePath, repositoryRoot: repository });
  function sourceFrame({ requireOriginal = true, allowPriorMarker = false } = {}) { const lease = leaseStore.read(branch);
    if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active" || lease.branch !== branch || lease.sessionId !== sourceSessionId
      || realpathSync(lease.worktreePath) !== repository || !lease.pullRequestUrl?.endsWith(`/pull/${pullRequestNumber}`)) invalid("source writer lease");
    const intent = readScopeExpansionIntent({ leaseStore, branch });
    const tombstone = leaseStore.readRegistry().scopeExpansionSuccessorRolloverReceipts?.[branch] ?? null;
    if (requireOriginal && (!intent || intent.status !== "source-retired" || tombstone)) invalid("source-retired scope-expansion intent");
    const staged = split(git(["diff", "--cached", "--name-only"]));
    const unstaged = split(git(["diff", "--name-only"]));
    const untracked = split(git(["ls-files", "--others", "--exclude-standard"]));
    const changedPaths = [...new Set([...staged, ...unstaged])].sort();
    const dirtDigest = digestValue({ stagedPatch: git(["diff", "--cached", "--binary"]), unstagedPatch: git(["diff", "--binary"]), changedPaths, untracked });
    const headSha = sha(git(["rev-parse", "HEAD"]), "source HEAD");
    const remoteFenceSha = firstSha(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]));
    if (headSha !== lease.fenceSha || remoteFenceSha !== lease.fenceSha || untracked.length) invalid("preserved source fence or dirt");
    if (intent && (dirtDigest !== intent.planSnapshot.sourceDirtyDigest || JSON.stringify(changedPaths) !== JSON.stringify(intent.planSnapshot.sourceChangedPaths))) invalid("preserved source dirt");
    const pullRequest = readPullRequest();
    const expectedMarker = digestValue(projectWriterLeasePullRequestMarker(lease));
    validateSuccessorRolloverPullRequestFence(pullRequest, { url: lease.pullRequestUrl, headSha: lease.fenceSha });
    if (pullRequest.markerDigest !== expectedMarker && !(allowPriorMarker
        && tombstone?.status === "local-cas" && pullRequest.markerDigest === tombstone.sourcePullRequestMarkerDigest)) invalid("exact open draft source pull request");
    return { lease, leaseDigest: writerLeaseDigest(lease), intent, intentDigest: intent ? digestValue(intent) : tombstone?.sourceIntentDigest,
      tombstone, changedPaths, dirtDigest, headSha, remoteHeadSha: remoteFenceSha, pullRequest };
  }
  function protectedFrame(intent) { if (dependencies.protectedFrame) return dependencies.protectedFrame(intent);
    const mainSha = firstSha(git(["ls-remote", "--heads", "origin", "refs/heads/main"]));
    const baseSha = sha(intent.planSnapshot.targetCanonicalBaseSha, "stale target base");
    const treeSha = sha(git(["rev-parse", `${mainSha}^{tree}`]), "protected main tree");
    const changedPaths = splitZero(gitRaw(["diff", "--name-only", "--no-renames", "-z", baseSha, mainSha, "--"]));
    const sourceIsAncestor = dependencies.isAncestor ? dependencies.isAncestor(baseSha, mainSha) : isAncestor(execute, repository, baseSha, mainSha);
    if (!sourceIsAncestor || mainSha === baseSha) invalid("protected-main advance");
    const core = { sourceBaseSha: baseSha, protectedMainSha: mainSha, protectedMainTreeSha: treeSha, changedPaths };
    return { mainSha, treeSha, changedPaths, advanceDigest: digestValue(core) };
  }
  function controllerDigest() { if (dependencies.controllerDigest) return dependencies.controllerDigest();
    const headSha = sha(git(["rev-parse", "HEAD"], controllerRoot), "controller HEAD");
    return digestValue({ headSha, contentDigest: controllerContentDigest() });
  }
  function controllerContentDigest() { if (dependencies.controllerContentDigest) return dependencies.controllerContentDigest();
    return digestValue(Object.fromEntries(IMPLEMENTATION.map(file => [file, digestValue(readFileSync(path.join(controllerRoot, file), "utf8"))]))); }
  function protectedControllerAdvance(plan) { if (dependencies.protectedControllerAdvance) return dependencies.protectedControllerAdvance(plan);
    return captureSuccessorRolloverProtectedControllerAdvance({ replacementPlan: plan, controllerHeadSha: git(["rev-parse", "HEAD"], controllerRoot), controllerOriginMainSha: git(["rev-parse", "origin/main"], controllerRoot),
      protectedMainSha: firstSha(git(["ls-remote", "--heads", "origin", "refs/heads/main"], controllerRoot)),
      controllerStatus: gitRaw(["status", "--porcelain=v1", "-z"], controllerRoot), gitText: args => gitRaw(args, controllerRoot) });
  }
  function repositoryId() { const value = dependencies.repositoryId ? text(dependencies.repositoryId(), "repository ID")
      : text(JSON.parse(gh(["repo", "view", "--json", "id"])).id, "repository ID");
    return value.startsWith("github-repository:") ? value : `github-repository:${value}`;
  }
  function sourceClaimIdentity(source, cloud) { const entries = cloud.ledger.entries.filter(entry => entry.claimId === source.intent.sourceClaimId && entry.action === "claim");
    if (entries.length !== 1) invalid("unique source claim genesis");
    const entry = entries[0], claim = entry.claimCore, core = { repositoryId: text(entry.repositoryId, "source claim repository"),
      actorId: text(claim?.actorId, "source claim actor"), deviceId: text(claim?.deviceId, "source claim device"),
      sessionId: text(claim?.sessionId, "source claim session"), workItemId: text(claim?.workItemId, "source claim work item") };
    if (!matchesSuccessorRolloverLocalSourceIdentity(core, { repositoryId: repositoryId(), deviceId: source.lease.device,
      sessionId: sourceSessionId, workItemId: source.lease.scope })) invalid("source claim identity continuity");
    return Object.freeze({ ...core, identityDigest: digestValue(core) });
  }
  function cloudFrame(authority) { const status = dependencies.cloudStatus ? dependencies.cloudStatus(authority) : invoke({
      action: "status", ledgerRepository: authority.ledgerRepository, request: { targetRepository: authority.targetRepository }, environment, });
    if (status?.schema !== "agentic-cloud-collaboration-result/v1" || status.ok !== true
      || !Array.isArray(status.claims) || !Number.isSafeInteger(status.sequence)) invalid("cloud status");
    const ledger = dependencies.readLedger ? dependencies.readLedger(authority, status.ledgerRevision)
      : JSON.parse(gh(["api", "--method", "GET", "-H", "Accept: application/vnd.github.raw+json",
        `repos/${authority.ledgerRepository}/contents/.agentic/collaboration-ledger.json`, "-f", `ref=${status.ledgerRevision}`]));
    const failures = validateLedger(ledger);
    if (failures.length || ledger.sequence !== status.sequence || ledger.headDigest !== status.ledgerDigest) throw new Error(`Successor-rollover ledger is invalid: ${failures.join("; ")}`);
    return { status, ledger };
  }
  async function readPhaseAObservation() { return stableCapture(capturePhaseAObservation, "retirement observation"); }
  function capturePhaseAObservation() { const source = sourceFrame(), intent = source.intent, plan = intent.planSnapshot;
    const protectedMain = protectedFrame(intent), cloud = cloudFrame(source.lease.cloudAuthority), identity = sourceClaimIdentity(source, cloud);
    const candidates = cloud.status.claims.filter(claim => claim.claimId === intent.targetClaimId);
    if (candidates.length !== 1) invalid("unique stale successor");
    const stale = candidates[0];
    if (!isSuccessorRolloverStaleCandidate(stale, plan, intent.targetClaimDigest, identity)) invalid("stale waiting successor");
    const core = { schema: `agentic-${OPERATION}-retirement-observation/v2`, sourceClaimIdentity: identity, controllerDigest: controllerDigest(),
      protectedMainSha: protectedMain.mainSha, protectedMainTreeSha: protectedMain.treeSha, protectedMainAdvanceDigest: protectedMain.advanceDigest,
      protectedMainChangedPaths: protectedMain.changedPaths, branch, sourceSessionId, semanticScope: source.lease.scope, sourceFenceSha: source.lease.fenceSha,
      sourceLeaseDigest: source.leaseDigest, sourceClaimId: plan.sourceClaimId, sourceClaimDigest: plan.sourceClaimDigest, sourceReviewRequestId: plan.sourceReviewRequestId,
      sourceWriteSetDigest: plan.sourceWriteSetDigest, sourceManifestDigest: plan.sourceManifestDigest,
      sourceDeclaredWriteSet: normalizeWriteSet(source.lease.admission.declaredWriteSet), sourceDirtDigest: source.dirtDigest, sourceChangedPaths: source.changedPaths,
      sourceIntentDigest: source.intentDigest, sourceIntentPlanDigest: intent.planDigest,
      sourceIntentStatus: intent.status, sourceRetirementReceiptDigest: intent.sourceRetirementReceiptDigest,
      staleSuccessorClaimId: stale.claimId, staleSuccessorClaimDigest: stale.fenceRevision, staleSuccessorTransitionDigest: stale.transitionDigest,
      staleSuccessorTransitionCounter: stale.transitionCounter, staleSuccessorState: stale.state,
      staleSuccessorPredecessorClaimId: stale.predecessorClaimId, staleTargetCanonicalBaseSha: plan.targetCanonicalBaseSha,
      staleTargetWriteSetDigest: plan.targetWriteSetDigest, staleTargetManifestDigest: plan.targetManifestDigest,
      staleTargetDeclaredWriteSet: normalizeWriteSet(plan.targetDeclaredWriteSet), staleExpiresAt: stale.expiresAt, pullRequestNumber,
      pullRequestNodeId: source.pullRequest.nodeId, pullRequestMarkerDigest: source.pullRequest.markerDigest,
      pullRequestBodyDigest: source.pullRequest.bodyDigest };
    return Object.freeze({ ...core, observationDigest: digestValue(core) });
  }
  async function readPhaseBState() { return stableCapture(capturePhaseBState, "replacement observation"); }
  function capturePhaseBState() { const journal = requireJournal(), source = sourceFrame();
    const cloud = cloudFrame(source.lease.cloudAuthority);
    const terminal = retirementTerminal(journal.retirement.planSnapshot, cloud);
    if (!terminal) invalid("terminal stale-successor retirement");
    const protectedMain = protectedFrame(source.intent);
    const core = { schema: `agentic-${OPERATION}-replacement-observation/v2`, sourceClaimIdentity: sourceClaimIdentity(source, cloud), controllerDigest: controllerDigest(),
      protectedMainSha: protectedMain.mainSha, protectedMainTreeSha: protectedMain.treeSha,
      protectedMainAdvanceDigest: protectedMain.advanceDigest, protectedMainChangedPaths: protectedMain.changedPaths,
      branch, sourceLeaseDigest: source.leaseDigest, sourceDirtDigest: source.dirtDigest,
      sourceIntentDigest: source.intentDigest, pullRequestMarkerDigest: source.pullRequest.markerDigest,
      pullRequestBodyDigest: source.pullRequest.bodyDigest, staleSuccessorClaimId: terminal.staleSuccessorClaimId,
      staleRetirementClaimDigest: terminal.retiredClaimDigest, staleRetirementTransitionDigest: terminal.retirementTransitionDigest,
      staleRetirementTransitionCounter: terminal.transitionCounter, staleRetirementReceiptDigest: terminal.receiptDigest };
    return Object.freeze({ ...core, observationDigest: digestValue(core) });
  }
  async function readContinuationFrame({ plan }) { return stableCapture(() => captureContinuationFrame(plan), "continuation frame", "frameDigest"); } function captureContinuationFrame(plan) { const journal = requireJournal(), forceRefresh = refreshContinuationPlan || continuationRefreshPlan; if (continuationRefreshPlan) requireSuccessorRolloverContinuationRefreshJournal({ plan: continuationRefreshPlan, journal, exactCheckpoint: true }); if (forceRefresh || continuationPlan && journal.replacement.status !== "replacement-promoted") { if (journal.replacement.status !== "pr-marker") invalid("continuation planning checkpoint"); return captureContinuationRefreshFrame(plan, journal); }
    const source = sourceFrame(), cloud = cloudFrame(source.lease.cloudAuthority);
    const candidate = replacementCandidate(plan, cloud);
    const evidence = classifySuccessorRolloverBindEvidence({ plan, journal, ledger: cloud.ledger, candidate }); const pull = source.pullRequest;
    return buildSuccessorRolloverContinuationFrame({ replacementPlan: plan, journal,
      owner: { schema: `agentic-${OPERATION}-owner-frame/v1`, repositoryPathDigest: digestValue(repository), branch, sourceSessionId,
        headSha: source.headSha, remoteHeadSha: source.remoteHeadSha, leaseDigest: source.leaseDigest, dirtDigest: source.dirtDigest, intentDigest: source.intentDigest,
        intentStatus: source.intent.status, changedPaths: source.changedPaths, changedPathsDigest: digestValue(source.changedPaths) },
      replacementClaim: evidence.promotedClaim, boundReplacement: evidence.boundReplacement,
      reviewRequest: { schema: `agentic-${OPERATION}-review-frame/v1`, reviewRequestId: plan.sourceReviewRequestId, pullRequestNumber, nodeId: pull.nodeId, state: pull.state, isDraft: pull.isDraft, branch: pull.headRefName,
        headSha: pull.headRefOid, baseBranch: pull.baseRefName, baseSha: pull.baseRefOid, markerDigest: pull.markerDigest, bodyDigest: pull.bodyDigest },
      protectedControllerAdvance: protectedControllerAdvance(plan), repairedControllerDigest: controllerContentDigest() });
  }
  function captureContinuationRefreshFrame(plan, journal) { const source = sourceFrame({ requireOriginal: false, allowPriorMarker: true }), cloud = cloudFrame(source.lease.cloudAuthority), candidate = replacementCandidate(plan, cloud), bound = requireContinuationBound(plan, cloud, candidate), local = reconcileLocal(plan), marker = reconcilePullRequest(plan), prior = continuationPlan.continuationFrameSnapshot, pull = source.pullRequest, target = manifest(plan);
    if (continuationPlan.replacementPlanDigest !== plan.planDigest || !bound || !local || !marker || digestValue(repository) !== prior.owner.repositoryPathDigest || source.headSha !== prior.owner.headSha || source.remoteHeadSha !== prior.owner.remoteHeadSha || source.dirtDigest !== prior.owner.dirtDigest || source.intentDigest !== prior.owner.intentDigest || digestValue(source.changedPaths) !== prior.owner.changedPathsDigest
      || pull.nodeId !== prior.reviewRequest.nodeId || pull.state !== prior.reviewRequest.state || pull.isDraft !== prior.reviewRequest.isDraft || pull.headRefName !== prior.reviewRequest.branch || pull.headRefOid !== prior.reviewRequest.headSha || pull.baseRefName !== prior.reviewRequest.baseBranch || pull.baseRefOid !== prior.reviewRequest.baseSha) invalid("preserved PR-marker continuation subject");
    requireCorrectedManifest(plan, source.lease.scope); const checked = prepareProjectedVerification(source.lease.cloudAuthority, target); validateProjectedLease(projectSuccessorRolloverTerminalVerifiedLease({ lease: source.lease, verifiedAuthority: checked.authority }), target, checked);
    return (refreshContinuationPlan ? buildSuccessorRolloverContinuationRefreshFrame : rebuildSuccessorRolloverAuthorizedPrMarkerFrame)({ priorPlan: continuationRefreshPlan || continuationPlan, currentJournal: journal, liveBoundValues: { authority: projectAuthority(source.lease.cloudAuthority), receiptDigest: bound.boundReplacement.receipt.receiptDigest }, liveLocalValues: local, livePullRequestValues: marker, protectedControllerAdvance: protectedControllerAdvance(plan), repairedControllerDigest: controllerContentDigest(), gitText: args => gitRaw(args, controllerRoot) });
  }
  function authorizeEffect({ plan, phase, operationKey }) { if (continuationRefreshPlan && phase !== "verified") invalid("refresh effect boundary"); if (phase === "verified") return Object.freeze({ status: "not-required" });
    if (continuationPlan && phase === "replacement-bound") assertSuccessorRolloverBindMutationAllowed(continuationPlan.continuationDisposition);
    const file = requireTaskAuthority();
    const lease = sourceFrame({ requireOriginal: phase !== "pr-marker", allowPriorMarker: phase === "pr-marker" }).lease;
    if (["local-cas", "pr-marker"].includes(phase)) requireCurrentContinuationBound(plan, lease);
    const operation = successorRolloverTaskOperation(plan, phase);
    const receipt = authorize({ lease, capabilityPath: file, operation, now: now() });
    pendingAuthority.set(operationKey, { planDigest: plan.planDigest, phase, leaseDigest: writerLeaseDigest(lease), bindingDigest: receipt.bindingDigest, receipt });
    return receipt;
  }
  async function reconcilePhase({ plan, journal, phase }) { if (continuationRefreshPlan && phase !== "verified") invalid("refresh effect boundary"); if (phase === "stale-successor-retired") return retirementTerminal(plan, cloudFrame(sourceFrame().lease.cloudAuthority));
    if (["replacement-claimed", "replacement-promoted", "replacement-bound"].includes(phase)) return reconcileCloudReplacement(plan, journal, phase);
    if (phase === "local-cas") return reconcileLocal(plan);
    if (phase === "pr-marker") return reconcilePullRequest(plan);
    if (phase === "verified") { try { return await observePhaseBComplete({ plan, journal }); } catch { return null; } }
    invalid("reconciliation phase");
  }
  async function retireStaleSuccessor(context) { const adopted = await reconcilePhase({ ...context, phase: "stale-successor-retired" });
    if (adopted) return adopted;
    consumeAuthority(context);
    const source = sourceFrame(), request = retirementRequest(context.plan, source.lease, context.operationKey);
    try { invoke({ action: "retire", ledgerRepository: source.lease.cloudAuthority.ledgerRepository,
        request: { targetRepository: source.lease.cloudAuthority.targetRepository, ...request }, environment });
    } catch (error) { const recovered = await reconcilePhase({ ...context, phase: "stale-successor-retired" });
      if (recovered) return recovered; throw error;
    }
    return requiredResult(await reconcilePhase({ ...context, phase: "stale-successor-retired" }), "stale successor retirement");
  }
  async function claimReplacement(context) { const adopted = await reconcilePhase({ ...context, phase: "replacement-claimed" });
    if (adopted) return adopted;
    consumeAuthority(context); assertReplacementFrame(context.plan);
    const source = sourceFrame(), target = manifest(context.plan);
    try { invoke({ action: "claim", ledgerRepository: source.lease.cloudAuthority.ledgerRepository, request: { targetRepository: source.lease.cloudAuthority.targetRepository,
          workItemId: source.lease.scope, canonicalBaseSha: context.plan.targetCanonicalBaseSha, headSha: source.lease.fenceSha, declaredWriteSet: target.declaredWriteSet,
          leaseEpoch: context.plan.targetCloudLeaseEpoch, ttlSeconds: context.plan.ttlSeconds ?? 28_800,
          deviceId: source.lease.device, sessionId: sourceSessionId, idempotencyKey: context.operationKey }, environment });
    } catch (error) { const recovered = await reconcilePhase({ ...context, phase: "replacement-claimed" });
      if (recovered) return recovered; throw error; }
    return requiredResult(await reconcilePhase({ ...context, phase: "replacement-claimed" }), "replacement claim");
  }
  async function promoteReplacement(context) { const adopted = await reconcilePhase({ ...context, phase: "replacement-promoted" });
    if (adopted) return adopted;
    consumeAuthority(context); assertReplacementFrame(context.plan);
    const live = replacementCandidate(context.plan, cloudFrame(sourceFrame().lease.cloudAuthority));
    if (!live || live.state !== "waiting-successor") invalid("waiting replacement before promotion");
    try { invoke({ action: "continue", ledgerRepository: sourceFrame().lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: sourceFrame().lease.cloudAuthority.targetRepository,
        claimId: live.claimId, expectedFenceRevision: live.fenceRevision, expectedTransitionCounter: live.transitionCounter, mode: "promote",
        ttlSeconds: context.plan.ttlSeconds ?? 28_800, deviceId: sourceFrame().lease.device, sessionId: sourceSessionId, idempotencyKey: context.operationKey }, environment });
    } catch (error) { const recovered = await reconcilePhase({ ...context, phase: "replacement-promoted" });
      if (recovered) return recovered; throw error; }
    return requiredResult(await reconcilePhase({ ...context, phase: "replacement-promoted" }), "replacement promotion");
  }
  async function bindReplacement(context) { const adopted = await reconcilePhase({ ...context, phase: "replacement-bound" });
    if (adopted) return adopted;
    if (continuationPlan) assertSuccessorRolloverBindMutationAllowed(continuationPlan.continuationDisposition);
    consumeAuthority(context); assertReplacementFrame(context.plan);
    const source = sourceFrame(), target = manifest(context.plan);
    const cloud = cloudFrame(source.lease.cloudAuthority);
    const candidate = replacementCandidate(context.plan, cloud);
    if (!candidate || candidate.state !== "current") invalid("current replacement before bind");
    const seed = actualAuthority(context.plan, source.lease, cloud, candidate);
    try { bindAdmissionCloudAuthority({ authority: seed, manifest: target, branch, headSha: source.lease.fenceSha, pullRequestNumber: continuationPlan ? null : pullRequestNumber,
      reviewRequestId: context.plan.sourceReviewRequestId, deviceId: source.lease.device, sessionId: sourceSessionId,
      idempotencyKey: context.operationKey, returnVerification: true, environment, invoke, inspect: invoke, verify });
    } catch (error) { const recovered = await reconcilePhase({ ...context, phase: "replacement-bound" });
      if (recovered) return recovered; throw error; }
    return requiredResult(await reconcilePhase({ ...context, phase: "replacement-bound" }), "replacement bind");
  }
  async function supersedeLocal(context) { const adopted = reconcileLocal(context.plan); if (adopted) return adopted;
    assertReplacementFrame(context.plan);
    const source = sourceFrame(), authority = boundActualAuthority(context.plan), target = manifest(context.plan);
    const sealedVerification = prepareProjectedVerification(authority, target);
    let values;
    mutateWriterLeaseRegistry({ leaseStore, branch, expectedLeaseDigest: source.leaseDigest, expectedClaimId: context.plan.sourceClaimId, action: ({ registry, lease }) => {
        const liveIntent = registry.scopeExpansionIntents?.[branch];
        if (digestValue(liveIntent) !== context.plan.observation.sourceIntentDigest || liveIntent.status !== "source-retired") invalid("old intent at local CAS");
        requireCurrentContinuationBound(context.plan, lease);
        consumeAuthority(context, lease);
        const expansionPlan = replacementExpansionPlan(context.plan, lease, source);
        const admission = buildActiveDirtyScopeExpansionSuccessorAdmission({ sourceAdmission: lease.admission, plan: expansionPlan, authority });
        const nextCore = { ...lease, baseSha: context.plan.targetCanonicalBaseSha,
          admission, cloudAuthority: authority, heartbeatAt: now().toISOString(), expiresAt: authority.expiresAt };
        const nextLease = { ...nextCore, taskAuthority: continueBinding({ sourceLease: lease,
          nextLease: nextCore, capabilityPath: requireTaskAuthority(), boundAt: now().toISOString() }) };
        validateProjectedLease(nextLease, target, sealedVerification);
        const leaseDigest = writerLeaseDigest(nextLease);
        const localCore = { schema: LOCAL_SCHEMA, status: "local-cas", planDigest: context.plan.planDigest, sourceIntentDigest: digestValue(liveIntent),
          sourceLeaseDigest: writerLeaseDigest(lease), sourceClaimId: context.plan.sourceClaimId, retiredStaleSuccessorClaimId: context.plan.retiredStaleSuccessorClaimId,
          replacementClaimId: authority.claimId, replacementAuthorityDigest: digestValue(authority),
          sourcePullRequestMarkerDigest: context.plan.observation.pullRequestMarkerDigest, leaseDigest, taskAuthorityBindingDigest: nextLease.taskAuthority.bindingDigest };
        const replacementIntentDigest = digestValue(localCore);
        const receiptDigest = digestValue({ ...localCore, replacementIntentDigest });
        const receipt = { ...localCore, replacementIntentDigest, receiptDigest };
        const { [branch]: _old, ...remainingIntents } = registry.scopeExpansionIntents || {};
        values = { leaseDigest, sourceIntentDigest: localCore.sourceIntentDigest,
          replacementIntentDigest, taskAuthorityBindingDigest: localCore.taskAuthorityBindingDigest, receiptDigest };
        return { registry: { ...registry, leases: { ...registry.leases, [branch]: nextLease }, scopeExpansionIntents: remainingIntents, scopeExpansionSuccessorRolloverReceipts: {
            ...(registry.scopeExpansionSuccessorRolloverReceipts || {}), [branch]: receipt } }, lease: nextLease, intent: null, changed: true };
      } });
    return Object.freeze(values);
  }
  async function projectPullRequest(context) { const adopted = reconcilePullRequest(context.plan); if (adopted) return adopted;
    const local = reconcileLocal(context.plan); if (!local) invalid("local projection before PR marker");
    let values;
    mutateWriterLeaseRegistry({ leaseStore, branch, expectedLeaseDigest: local.leaseDigest,
      expectedClaimId: context.journal.replacement.phases["replacement-claimed"].values.claim.claimId, action: ({ registry, lease }) => { requireCurrentContinuationBound(context.plan, lease); consumeAuthority(context, lease);
        const receipt = registry.scopeExpansionSuccessorRolloverReceipts?.[branch];
        if (!receipt || receipt.replacementIntentDigest !== local.replacementIntentDigest) invalid("local receipt at PR marker");
        const expectedPull = { url: lease.pullRequestUrl, nodeId: context.plan.retirementPlanSnapshot.observation.pullRequestNodeId, headSha: lease.fenceSha };
        const before = validateSuccessorRolloverPullRequestFence(readPullRequest(), expectedPull), targetMarker = digestValue(projectWriterLeasePullRequestMarker(lease));
        const sourceMarker = context.plan.observation.pullRequestMarkerDigest;
        if (![sourceMarker, targetMarker].includes(before.markerDigest)) invalid("PR marker pre-effect");
        if (before.markerDigest === sourceMarker) { if (before.bodyDigest !== context.plan.observation.pullRequestBodyDigest) invalid("PR body pre-effect");
          const body = updateWriterLeasePullRequestBody(before.body, lease);
          editPullRequest(before.url, body);
        }
        const after = validateSuccessorRolloverPullRequestFence(readPullRequest(), expectedPull);
        if (after.markerDigest !== targetMarker || after.bodyWithoutMarkerDigest !== before.bodyWithoutMarkerDigest) invalid("PR marker post-effect");
        const receiptDigest = digestValue({ schema: `agentic-${OPERATION}-pr-marker/v1`, planDigest: context.plan.planDigest, markerDigest: after.markerDigest,
          bodyDigest: after.bodyDigest, replacementIntentDigest: receipt.replacementIntentDigest });
        values = { markerDigest: after.markerDigest, bodyDigest: after.bodyDigest, receiptDigest };
        const nextReceipt = { ...receipt, status: "pr-marker", prMarker: values };
        return { registry: { ...registry, scopeExpansionSuccessorRolloverReceipts: {
          ...registry.scopeExpansionSuccessorRolloverReceipts, [branch]: nextReceipt } }, lease, intent: null, changed: true };
      } });
    return Object.freeze(values);
  }
  async function observePhaseBComplete({ plan }) { const source = sourceFrame({ requireOriginal: false }), local = reconcileLocal(plan);
    const marker = reconcilePullRequest(plan);
    if (!local || !marker || source.dirtDigest !== plan.observation.sourceDirtDigest) { invalid("terminal local, PR, or dirt projection");
    }
    assertSuccessorRolloverTerminalControllerIdentity({ continuationPlan, currentControllerDigest: continuationPlan ? controllerContentDigest() : controllerDigest(), originalControllerDigest: plan.observation.controllerDigest }); requireCurrentContinuationBound(plan, source.lease); const checked = prepareProjectedVerification(source.lease.cloudAuthority, manifest(plan));
    validateProjectedLease(projectSuccessorRolloverTerminalVerifiedLease({ lease: source.lease, verifiedAuthority: checked.authority }), manifest(plan), checked);
    const core = { leaseDigest: source.leaseDigest, replacementIntentDigest: local.replacementIntentDigest,
      cloudAuthorityDigest: digestValue(source.lease.cloudAuthority), taskAuthorityBindingDigest: source.lease.taskAuthority.bindingDigest,
      markerDigest: marker.markerDigest, bodyDigest: marker.bodyDigest, dirtDigest: source.dirtDigest };
    return Object.freeze({ ...core, verificationDigest: digestValue(core) });
  }
  async function verifyCompleted(context) { return observePhaseBComplete(context); }
  function reconcileCloudReplacement(plan, journal, phase) { assertReplacementFrame(plan);
    const cloud = cloudFrame(sourceFrame().lease.cloudAuthority);
    const candidate = replacementCandidate(plan, cloud);
    if (!candidate) { if (continuationPlan?.continuationDisposition === "bound-response-ahead") invalid("sealed bound replacement reconciliation"); return null; }
    const claimed = projectClaim(candidate, cloud.status);
    if (phase === "replacement-claimed") { const entry = validateSuccessorRolloverReplacementClaimLineage({ plan, cloud, candidate, journal });
      return { claim: claimed, receiptDigest: claimOnlyOperationReceiptForEntry(entry, "current").receiptDigest }; }
    if (phase === "replacement-promoted") { if (candidate.state !== "current") return null;
      const entry = validateSuccessorRolloverReplacementClaimLineage({ plan, cloud, candidate, journal });
      const prior = journal?.replacement?.phases?.["replacement-claimed"]?.values?.claim;
      return { claim: claimed, promoted: prior?.state === "waiting-successor", receiptDigest: claimOnlyOperationReceiptForEntry(entry, "current").receiptDigest };
    }
    const evidence = requireContinuationBound(plan, cloud, candidate)
      || classifySuccessorRolloverBindEvidence({ plan, journal, ledger: cloud.ledger, candidate });
    if (!evidence.boundReplacement) { if (continuationPlan?.continuationDisposition === "bound-response-ahead") invalid("sealed bound replacement reconciliation"); return null; }
    const actual = actualAuthority(plan, sourceFrame().lease, cloud, candidate);
    return { authority: projectAuthority(actual), receiptDigest: evidence.boundReplacement.receipt.receiptDigest };
  }
  function reconcileLocal(plan) { const source = sourceFrame({ requireOriginal: false, allowPriorMarker: true }), receipt = source.tombstone;
    if (!receipt) return null;
    requireCurrentContinuationBound(plan, source.lease);
    return validateSuccessorRolloverLocalReceipt(receipt, { planDigest: plan.planDigest, sourceIntentDigest: plan.observation.sourceIntentDigest,
      sourceLeaseDigest: plan.observation.sourceLeaseDigest, sourceClaimId: plan.sourceClaimId,
      retiredStaleSuccessorClaimId: plan.retiredStaleSuccessorClaimId, replacementAuthorityDigest: digestValue(source.lease.cloudAuthority),
      sourcePullRequestMarkerDigest: plan.observation.pullRequestMarkerDigest, leaseDigest: source.leaseDigest,
      replacementClaimId: source.lease.cloudAuthority?.claimId, taskAuthorityBindingDigest: source.lease.taskAuthority?.bindingDigest });
  }
  function reconcilePullRequest(plan) { const local = reconcileLocal(plan); if (!local) return null;
    const receipt = leaseStore.readRegistry().scopeExpansionSuccessorRolloverReceipts?.[branch];
    if (receipt?.status !== "pr-marker" || !receipt.prMarker) return null;
    requireCurrentContinuationBound(plan, leaseStore.read(branch)); const pull = readPullRequest();
    return validateSuccessorRolloverPullRequestReceipt({ receipt, planDigest: plan.planDigest, pull,
      leaseMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(leaseStore.read(branch))) });
  }
  function retirementTerminal(plan, cloud) { const observation = plan.observation, matches = cloud.status.claims
      .filter(claim => claim.claimId === observation.staleSuccessorClaimId);
    if (matches.length === 1) { const claim = matches[0];
      if (claim.state === "waiting-successor" && claim.fenceRevision === observation.staleSuccessorClaimDigest
        && claim.transitionCounter === observation.staleSuccessorTransitionCounter) return null;
      invalid("stale successor live state");
    }
    if (matches.length > 1) invalid("stale successor cardinality");
    const entries = cloud.ledger.entries.filter(entry => entry.claimId === observation.staleSuccessorClaimId);
    const genesis = entries[0], terminal = entries.at(-1), core = terminal?.claimCore;
    const request = retirementRequest(plan, { device: genesis?.claimCore?.deviceId,
      sessionId: genesis?.claimCore?.sessionId }, successorRolloverOperationKey(plan, "stale-successor-retired"));
    const { idempotencyKey: _key, ...effect } = request;
    const semantic = { repositoryId: genesis?.repositoryId, actorId: genesis?.claimCore?.actorId, deviceId: effect.deviceId, sessionId: effect.sessionId, ...effect };
    if (!terminal || terminal.action !== "retire" || core?.state !== "retired" || core.transitionCounter !== observation.staleSuccessorTransitionCounter + 1
      || core.retirement?.reason !== "superseded" || core.retirement.finalRevision !== observation.sourceFenceSha || core.retirement.reviewRequestId !== null
      || entries.at(-2)?.claimDigest !== observation.staleSuccessorClaimDigest || terminal.idempotencyKey !== digestValue(request.idempotencyKey)
      || terminal.requestDigest !== digestValue({ action: "retire", intent: semantic }) || !sameOwnerCore(genesis?.claimCore, core)) {
      invalid("stale successor retirement terminal");
    }
    return Object.freeze({ schema: RETIREMENT_SCHEMA, staleSuccessorClaimId: observation.staleSuccessorClaimId,
      priorClaimDigest: observation.staleSuccessorClaimDigest, retiredClaimDigest: digest(terminal.claimDigest, "retired claim digest"),
      retirementTransitionDigest: digest(terminal.digest, "retirement transition"), transitionCounter: core.transitionCounter, state: "retired", reason: "successor-rollover",
      receiptDigest: claimOnlyOperationReceiptForEntry(terminal, "retired").receiptDigest });
  }
  function assertReplacementFrame(plan) { const source = sourceFrame(), current = continuationPlan ? protectedControllerAdvance(plan) : protectedFrame(source.intent);
    if (continuationPlan && continuationPlan.replacementPlanDigest !== plan.planDigest) invalid("continuation replacement plan join");
    if (source.leaseDigest !== plan.observation.sourceLeaseDigest || source.intentDigest !== plan.observation.sourceIntentDigest
      || source.dirtDigest !== plan.observation.sourceDirtDigest || !continuationPlan && current.mainSha !== plan.observation.protectedMainSha
      || source.pullRequest.markerDigest !== plan.observation.pullRequestMarkerDigest
      || source.pullRequest.bodyDigest !== plan.observation.pullRequestBodyDigest) invalid("sealed replacement frame");
    if (continuationPlan) { const pull = source.pullRequest, review = plan.retirementPlanSnapshot.observation;
      if (controllerContentDigest() !== continuationPlan.repairedControllerDigest
        || pull.nodeId !== review.pullRequestNodeId || pull.baseRefOid !== continuationPlan.historicalBindProof.sourceBaseSha) invalid("repaired controller or historical review drift");
      requireProtectedMainEquivalent({ planned: continuationPlan.protectedControllerAdvance.advance, observed: current.advance,
        gitText: args => gitRaw(args, controllerRoot) });
    } else if (current.changedPaths.some(changed => covers(plan.target.declaredWriteSet, changed))) invalid("corrected target overlap with protected-main advance");
    requireCorrectedManifest(plan, source.lease.scope);
  }
  function requireCorrectedManifest(plan, scope) { if (!correctedManifestFile) return; const supplied = normalizeDeclaredWriteScopeManifest(readJson(correctedManifestFile), { expectedScope: scope }); if (supplied.manifestDigest !== plan.target.manifestDigest || supplied.writeSetDigest !== plan.target.writeSetDigest) invalid("corrected manifest file drift"); }
  function replacementCandidate(plan, cloud) { const matches = cloud.status.claims.filter(claim => (claim.predecessorClaimId ?? null) === null
      && claim.canonicalBaseRevision === plan.targetCanonicalBaseSha && claim.laneRevision === plan.sourceFenceSha && claim.writeSetDigest === plan.target.writeSetDigest
      && claim.leaseEpoch === plan.targetCloudLeaseEpoch && matchesSuccessorRolloverSourceClaimIdentity(claim, plan.sourceClaimIdentity));
    if (matches.length > 1) invalid("replacement claim cardinality");
    const foreign = cloud.status.claims.filter(claim => claim.claimId !== matches[0]?.claimId && ![plan.sourceClaimId, plan.retiredStaleSuccessorClaimId].includes(claim.claimId)
      && !["parked"].includes(claim.state) && writeSetsOverlap(claim.declaredWriteScope, plan.target.declaredWriteSet));
    if (foreign.some(claim => claim.scopeReserved || claim.state === "waiting-successor")) { invalid("foreign overlapping replacement authority");
    }
    return matches[0] || null;
  }
  function actualAuthority(plan, lease, cloud, candidate) {
    return normalizeBoundAuthority({ result: { schema: cloud.status.schema, ok: true, action: "status", ledgerRevision: cloud.status.ledgerRevision,
      ledgerDigest: cloud.status.ledgerDigest, claimDigest: candidate.fenceRevision, claim: candidate },
    authority: { ...lease.cloudAuthority, canonicalBaseSha: plan.targetCanonicalBaseSha, laneRevision: plan.sourceFenceSha,
      cloudDeclaredWriteScope: plan.target.declaredWriteSet, writeSetDigest: plan.target.writeSetDigest, leaseEpoch: plan.targetCloudLeaseEpoch,
      reviewRequestId: candidate.reviewRequestId, state: candidate.state, manifestDigest: plan.target.manifestDigest }, manifest: manifest(plan),
    deviceId: lease.device, sessionId: sourceSessionId });
  }
  function boundActualAuthority(plan) { const source = sourceFrame(), cloud = cloudFrame(source.lease.cloudAuthority);
    const candidate = replacementCandidate(plan, cloud);
    if (!requireContinuationBound(plan, cloud, candidate)
      && !isSuccessorRolloverRawBoundCandidate(candidate, plan.sourceReviewRequestId)) invalid("bound replacement authority");
    const authority = actualAuthority(plan, source.lease, cloud, candidate);
    if (projectAuthority(authority).authorityDigest
      !== digestValue(authority)) invalid("bound authority projection");
    return authority;
  }
  function requireContinuationBound(plan, cloud, candidate) { if (continuationPlan?.continuationDisposition !== "bound-response-ahead") return null;
    return requireSuccessorRolloverSealedBindEvidence({ plan, journal: continuationPlan.sourceJournalSnapshot, ledger: cloud.ledger, candidate,
      expectedBoundReplacement: continuationPlan.continuationFrameSnapshot.boundReplacement }); }
  function requireCurrentContinuationBound(plan, lease) { if (continuationPlan?.continuationDisposition !== "bound-response-ahead") return null;
    const cloud = cloudFrame(lease.cloudAuthority); return requireContinuationBound(plan, cloud, replacementCandidate(plan, cloud)); }
  function prepareProjectedVerification(authority, target) { if (dependencies.prepareProjectedVerification) { return dependencies.prepareProjectedVerification(authority, target);
    }
    return verifyAdmissionCloudAuthority({ authority, manifest: target, canonicalBaseSha: authority.canonicalBaseSha, environment, inspect: invoke, invoke: verify });
  }
  function validateProjectedLease(lease, target, sealed = null) { if (dependencies.validateProjectedLease) return dependencies.validateProjectedLease(lease, target);
    const checked = sealed || prepareProjectedVerification(lease.cloudAuthority, target);
    return assertAdmissionMutationAuthority({ lease, cloudAuthority: checked.authority, remoteAuthorityVerification: checked.verification });
  }
  function consumeAuthority(context, lease = sourceFrame({ requireOriginal: context.phase !== "pr-marker", allowPriorMarker: context.phase === "pr-marker" }).lease) {
    const token = pendingAuthority.get(context.operationKey);
    if (!token) { authorizeEffect(context); return consumeAuthority(context, lease); }
    if (token.planDigest !== context.plan.planDigest || token.phase !== context.phase || token.leaseDigest !== writerLeaseDigest(lease)
      || token.bindingDigest !== lease.taskAuthority?.bindingDigest) invalid("effect task authority token");
    pendingAuthority.delete(context.operationKey); return token.receipt;
  }
  function readPullRequest() { const value = dependencies.readPullRequest ? dependencies.readPullRequest() : JSON.parse(gh([
      "pr", "view", String(pullRequestNumber), "--json", "url,number,id,state,isDraft,isCrossRepository,headRefName,headRefOid,baseRefName,baseRefOid,body", ]));
    const marker = parseWriterLeasePullRequestBody(String(value.body || ""));
    if (!marker || value.number !== pullRequestNumber || value.isCrossRepository || value.headRefName !== branch) invalid("source pull request");
    return { url: value.url, nodeId: value.id, state: value.state, isDraft: value.isDraft, headRefName: value.headRefName,
      headRefOid: value.headRefOid, baseRefName: value.baseRefName, baseRefOid: value.baseRefOid, body: String(value.body || ""),
      markerDigest: digestValue(marker), bodyDigest: digestValue(String(value.body || "")), bodyWithoutMarkerDigest: digestValue(bodyWithoutMarker(String(value.body || ""))) };
  }
  function editPullRequest(url, body) { if (dependencies.editPullRequest) return dependencies.editPullRequest(url, body);
    return execute("gh", ["pr", "edit", url, "--body", body], repository);
  }
  function requireTaskAuthority() { if (!taskAuthorityFile) invalid("configured task-authority capability");
    return privateCapabilityPath(taskAuthorityFile, externalRoots); }
  const { withEntrypointFence, readRecoveryJournal, writeRecoveryJournal } = journalStore;
  function requireJournal() { const value = readRecoveryJournal();
    if (!value) invalid("existing retirement journal"); return value; }
  return Object.freeze({ withEntrypointFence, readRecoveryJournal, writeRecoveryJournal, readPhaseAObservation, authorizeEffect, reconcilePhase, retireStaleSuccessor,
    readPhaseBState, readContinuationFrame, claimReplacement, promoteReplacement, bindReplacement, supersedeLocal, projectPullRequest, observePhaseBComplete, verifyCompleted });
}
export function validateSuccessorRolloverLocalReceipt(receipt, expected) { const core = { schema: receipt?.schema, status: "local-cas",
  planDigest: receipt?.planDigest, sourceIntentDigest: receipt?.sourceIntentDigest, sourceLeaseDigest: receipt?.sourceLeaseDigest,
  sourceClaimId: receipt?.sourceClaimId, retiredStaleSuccessorClaimId: receipt?.retiredStaleSuccessorClaimId,
  replacementClaimId: receipt?.replacementClaimId, replacementAuthorityDigest: receipt?.replacementAuthorityDigest,
  sourcePullRequestMarkerDigest: receipt?.sourcePullRequestMarkerDigest, leaseDigest: receipt?.leaseDigest,
  taskAuthorityBindingDigest: receipt?.taskAuthorityBindingDigest };
  const replacementIntentDigest = digestValue(core), receiptDigest = digestValue({ ...core, replacementIntentDigest });
  if (receipt?.schema !== LOCAL_SCHEMA || !["local-cas", "pr-marker"].includes(receipt.status) || receipt.planDigest !== expected.planDigest
    || receipt.sourceIntentDigest !== expected.sourceIntentDigest || receipt.sourceLeaseDigest !== expected.sourceLeaseDigest
    || receipt.sourceClaimId !== expected.sourceClaimId || receipt.retiredStaleSuccessorClaimId !== expected.retiredStaleSuccessorClaimId
    || receipt.replacementAuthorityDigest !== expected.replacementAuthorityDigest
    || receipt.sourcePullRequestMarkerDigest !== expected.sourcePullRequestMarkerDigest || receipt.leaseDigest !== expected.leaseDigest
    || receipt.replacementClaimId !== expected.replacementClaimId || receipt.taskAuthorityBindingDigest !== expected.taskAuthorityBindingDigest
    || receipt.replacementIntentDigest !== replacementIntentDigest || receipt.receiptDigest !== receiptDigest) invalid("durable local successor-rollover receipt");
  return Object.freeze({ leaseDigest: receipt.leaseDigest, sourceIntentDigest: receipt.sourceIntentDigest,
    replacementIntentDigest, taskAuthorityBindingDigest: receipt.taskAuthorityBindingDigest, receiptDigest });
}
export function validateSuccessorRolloverReplacementClaimLineage({ plan, cloud, candidate, journal }) {
  const entries = cloud?.ledger?.entries?.filter(value => value.claimId === candidate?.claimId) || [], entry = entries[0], core = entry?.claimCore;
  const intent = { repositoryId: entry?.repositoryId, actorId: core?.actorId, deviceId: core?.deviceId, sessionId: core?.sessionId,
    workItemId: core?.workItemId, canonicalBaseRevision: plan.targetCanonicalBaseSha, declaredWriteScope: normalizeWriteSet(plan.target.declaredWriteSet),
    writeSetDigest: plan.target.writeSetDigest, laneRevision: plan.sourceFenceSha, leaseEpoch: plan.targetCloudLeaseEpoch,
    predecessorClaimId: null, canonicalDescendantProof: null, expiresAt: core?.expiresAt, claimId: candidate?.claimId };
  const receipt = entry ? claimOnlyOperationReceiptForEntry(entry, "current").receiptDigest : null;
  const stored = journal?.replacement?.phases?.["replacement-claimed"]?.values;
  const sealed = stored?.receiptDigest === receipt && stored?.claim?.claimId === candidate?.claimId && stored.claim.claimDigest === entry?.claimDigest
    && stored.claim.claimLedgerRevision === entry?.digest && stored.claim.transitionCounter === core?.transitionCounter && stored.claim.state === "current"
    && stored.claim.predecessorClaimId === null && stored.claim.canonicalBaseSha === plan.targetCanonicalBaseSha
    && stored.claim.laneRevision === plan.sourceFenceSha && stored.claim.writeSetDigest === plan.target.writeSetDigest
    && stored.claim.leaseEpoch === plan.targetCloudLeaseEpoch;
  if (entry?.action !== "claim" || core?.state !== "current" || !matchesSuccessorRolloverSourceClaimIdentity({ ...core, repositoryId: entry.repositoryId }, plan.sourceClaimIdentity)
    || entry.idempotencyKey !== digestValue(successorRolloverOperationKey(plan, "replacement-claimed"))
    || entry.requestDigest !== digestValue({ action: "claim", intent }) || (entries.length === 1 ? candidate.operationReceiptDigest !== receipt : !sealed)) {
    invalid("replacement claim operation join");
  }
  return entry;
}
export function isSuccessorRolloverRawBoundCandidate(candidate, reviewRequestId) {
  return candidate?.state === "current" && candidate.reviewRequestId === reviewRequestId;
}
export function matchesSuccessorRolloverSourceClaimIdentity(value, expected) { const core = { repositoryId: value?.repositoryId,
  actorId: value?.actorId, deviceId: value?.deviceId, sessionId: value?.sessionId, workItemId: value?.workItemId };
  return Object.keys(core).every(key => core[key] === expected?.[key]) && expected?.identityDigest === digestValue(core); }
export function matchesSuccessorRolloverLocalSourceIdentity(cloud, local) { const repositoryId = String(local?.repositoryId || "");
  return cloud?.repositoryId === (repositoryId.startsWith("github-repository:") ? repositoryId : `github-repository:${repositoryId}`)
    && cloud.deviceId === pseudonymousIdentifier("device", local?.deviceId) && cloud.sessionId === pseudonymousIdentifier("session", local?.sessionId)
    && cloud.workItemId === pseudonymousIdentifier("work-item", local?.workItemId); }
export function isSuccessorRolloverStaleCandidate(stale, plan, claimDigest, identity) { return stale?.state === "waiting-successor"
  && stale.predecessorClaimId === plan.sourceClaimId && stale.fenceRevision === claimDigest
  && stale.writeSetDigest === plan.targetWriteSetDigest && JSON.stringify(normalizeWriteSet(stale.declaredWriteScope)) === JSON.stringify(plan.targetDeclaredWriteSet)
  && matchesSuccessorRolloverSourceClaimIdentity(stale, identity); }
export function validateSuccessorRolloverPullRequestReceipt({ receipt, planDigest, pull, leaseMarkerDigest }) {
  const marker = receipt?.prMarker, receiptDigest = digestValue({ schema: `agentic-${OPERATION}-pr-marker/v1`, planDigest,
    markerDigest: marker?.markerDigest, bodyDigest: marker?.bodyDigest, replacementIntentDigest: receipt?.replacementIntentDigest });
  if (receipt?.status !== "pr-marker" || marker?.markerDigest !== pull?.markerDigest || marker?.bodyDigest !== pull?.bodyDigest
    || marker.markerDigest !== leaseMarkerDigest || marker.receiptDigest !== receiptDigest) invalid("durable pull-request marker receipt");
  return Object.freeze(marker);
}
export function validateSuccessorRolloverPullRequestFence(pull, expected) {
  if (pull?.url !== expected.url || pull.state !== "OPEN" || pull.isDraft !== true || pull.headRefName !== expected.branch && expected.branch
    || pull.headRefOid !== expected.headSha || pull.baseRefName !== "main" || expected.nodeId && pull.nodeId !== expected.nodeId) invalid("exact open draft source pull request");
  return pull;
}
function replacementExpansionPlan(plan, lease, source) { const original = source.intent.planSnapshot;
  const core = { schema: "agentic-active-dirty-scope-expansion-plan/v1", sourceBranch: original.sourceBranch, sourceFenceSha: original.sourceFenceSha,
    sourceLeaseDigest: writerLeaseDigest(lease), sourceClaimId: original.sourceClaimId, sourceClaimDigest: original.sourceClaimDigest,
    sourceClaimTransitionCounter: original.sourceClaimTransitionCounter, sourceReviewRequestId: original.sourceReviewRequestId,
    sourceWriteSetDigest: original.sourceWriteSetDigest, sourceManifestDigest: original.sourceManifestDigest, sourceDirtyDigest: source.dirtDigest,
    sourceChangedPaths: source.changedPaths, targetCanonicalBaseSha: plan.targetCanonicalBaseSha,
    targetManifestDigest: plan.target.manifestDigest, targetWriteSetDigest: plan.target.writeSetDigest,
    targetDeclaredWriteSet: plan.target.declaredWriteSet, targetCloudLeaseEpoch: plan.targetCloudLeaseEpoch };
  return Object.freeze({ ...core, planDigest: digestValue(core) });
}
function projectClaim(claim, status) { return Object.freeze({ claimId: claim.claimId, claimDigest: claim.fenceRevision, ledgerRevision: status.ledgerRevision,
  claimLedgerRevision: claim.transitionDigest, transitionCounter: claim.transitionCounter, state: claim.state, predecessorClaimId: claim.predecessorClaimId ?? null,
  canonicalBaseSha: claim.canonicalBaseRevision, laneRevision: claim.laneRevision,
  writeSetDigest: claim.writeSetDigest, leaseEpoch: claim.leaseEpoch, expiresAt: claim.expiresAt }); }
function projectAuthority(value) { const authority = { claimId: value.claimId, claimDigest: value.claimDigest, claimLedgerRevision: value.claimLedgerRevision,
  transitionCounter: value.transitionCounter, canonicalBaseSha: value.canonicalBaseSha,
  laneRevision: value.laneRevision, writeSetDigest: value.writeSetDigest, manifestDigest: value.manifestDigest, leaseEpoch: value.leaseEpoch,
  reviewRequestId: value.reviewRequestId, expiresAt: value.expiresAt };
  return Object.freeze({ ...authority, authorityDigest: digestValue(value) }); }
function retirementRequest(plan, owner, operationKey) { const observation = plan.observation;
  const evidence = { schema: `agentic-${OPERATION}-cloud-effect/v1`, planDigest: plan.planDigest,
    phase: "stale-successor-retired", staleSuccessorClaimId: observation.staleSuccessorClaimId };
  return { claimId: observation.staleSuccessorClaimId, expectedFenceRevision: observation.staleSuccessorClaimDigest,
    expectedTransitionCounter: observation.staleSuccessorTransitionCounter, reason: "superseded",
    finalRevision: observation.sourceFenceSha, reviewRequestId: null, bytesDigest: digestValue({ ...evidence, kind: "bytes" }),
    namedChecksDigest: digestValue({ ...evidence, kind: "checks" }), handoffEvidenceDigest: digestValue({ ...evidence, kind: "handoff" }), integrationReceiptDigest: null,
    deviceId: owner.device, sessionId: owner.sessionId, idempotencyKey: operationKey }; }
function sameOwnerCore(source, terminal) { return ["actorId", "deviceId", "sessionId", "repositoryId",
  "workItemId", "canonicalBaseRevision", "declaredWriteScope", "writeSetDigest", "laneRevision", "leaseEpoch", "heartbeatCounter", "predecessorClaimId"].every(key =>
  digestValue(source?.[key]) === digestValue(terminal?.[key])); }
async function stableCapture(capture, label, digestKey = "observationDigest") { const first = await capture(), second = await capture();
  if (first[digestKey] !== second[digestKey]) invalid(`${label} changed across paired reads`);
  return second; }
function manifest(plan) { return Object.freeze({ schema: "agentic-declared-write-scope/v1",
  semanticScope: plan.target.semanticScope, declaredWriteSet: normalizeWriteSet(plan.target.declaredWriteSet),
  writeSetDigest: plan.target.writeSetDigest, manifestDigest: plan.target.manifestDigest }); }
function bodyWithoutMarker(value) { return String(value).replace( /<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu, ""); }
function covers(writeSet, changed) { return normalizeWriteSet(writeSet).some(item => item.startsWith("path:")
  && (item === `path:${changed}` || changed.startsWith(`${item.slice(5)}/`))); }
function isAncestor(execute, cwd, source, target) { try { execute("git", ["merge-base", "--is-ancestor", source, target], cwd); return true;
} catch { return false; } }
function readJson(file) { return JSON.parse(readFileSync(file, "utf8")); }
function privateCapabilityPath(value, roots) { const target = externalPath(value, roots, "task-authority capability");
  const stat = lstatSync(target); if ((stat.mode & 0o777) !== 0o600 || stat.nlink !== 1
    || typeof process.getuid === "function" && stat.uid !== process.getuid()) invalid("private owned single-link task-authority capability");
  return target; }
function externalPath(value, roots, label, { allowMissing = false } = {}) { if (!path.isAbsolute(String(value || ""))) invalid(`absolute external ${label}`);
  const target = path.resolve(String(value));
  if (realpathSync(path.dirname(target)) !== path.dirname(target)) invalid(`symlink traversal ${label}`);
  if (roots.some(root => inside(root, target))) invalid(`external ${label}`);
  if (existsSync(target)) { const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) invalid(`regular non-symlink ${label}`);
    const real = realpathSync(target); if (roots.some(root => inside(root, real))) invalid(`external ${label}`);
    return real; }
  if (!allowMissing) invalid(`existing ${label}`);
  const parent = realpathSync(path.dirname(target)), resolved = path.join(parent, path.basename(target));
  if (roots.some(root => inside(root, resolved))) invalid(`external ${label}`); return resolved; }
function inside(root, candidate) { const relative = path.relative(root, candidate);
  return relative === "" || relative && !relative.startsWith("..") && !path.isAbsolute(relative); }
function split(value) { return String(value || "").split(/\r?\n/u).map(item => item.trim()).filter(Boolean).sort(); }
function splitZero(value) { return String(value || "").split("\0").filter(Boolean).sort(); }
function firstSha(value) { return sha(String(value || "").trim().split(/\s+/u)[0], "remote SHA"); }
function text(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value.trim(); }
function positive(value, label) { const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) invalid(label); return result; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function requiredResult(value, label) { if (!value) invalid(label); return value; }
function invalid(label) { throw new Error(`Successor-rollover repository adapter has invalid ${label}.`); }
