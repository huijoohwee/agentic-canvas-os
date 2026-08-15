// Responsibility: Join exact Git, GitHub, cloud, task capability, and writer-registry recovery effects.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { projectActiveDirtyScopeExpansionSuccessor }
  from "./active-dirty-scope-expansion-successor-projection.mjs";
import { digestValue, validateLedger } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier }
  from "./cloud-collaboration-delivery-verifier.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import {
  bindAdmissionCloudAuthority, invokeRepositoryCloudAction, verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  advanceScopeExpansionIntent, readScopeExpansionIntent, writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";
import { scopeExpansionSuccessorProjectionRecoveryTaskOperation,
  scopeExpansionSuccessorProjectionTerminalStableDigest }
  from "./scope-expansion-successor-projection-recovery-contract.mjs";
import {
  createScopeExpansionSuccessorProjectionRecoveryController,
  readScopeExpansionSuccessorProjectionRecoveryJournal,
  withScopeExpansionSuccessorProjectionRecoveryFence,
  writeScopeExpansionSuccessorProjectionRecoveryJournal,
}
  from "./scope-expansion-successor-projection-recovery-controller.mjs";
import {
  buildScopeExpansionSuccessorProjectionRecoveryEvidence,
  assertScopeExpansionRecoverySuccessorUnexpired,
  assertScopeExpansionSuccessorRecoveryBoundTransition,
  assertScopeExpansionSuccessorRecoveryProtectedFrame,
  assertScopeExpansionSuccessorRecoveryPullRequest,
  readScopeExpansionSuccessorProjectionRecoveryController,
  readScopeExpansionSuccessorProjectionRecoveryLane,
  RECOVERED_SCOPE_EXPANSION_PLAN_DIGEST,
}
  from "./scope-expansion-successor-projection-recovery-evidence.mjs";
import { scopeExpansionSuccessorProjectionRecoveryDecisionSubject }
  from "./scope-expansion-successor-projection-recovery-evidence.mjs";

const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const IMPLEMENTATION = Object.freeze([
  "active-dirty-scope-expansion-controller.mjs",
  "active-dirty-scope-expansion-successor-projection.mjs",
  "scope-expansion-successor-projection-recovery-evidence.mjs",
  "scope-expansion-successor-projection-recovery-contract.mjs",
  "scope-expansion-successor-projection-recovery-controller.mjs",
  "scope-expansion-successor-projection-recovery-repository-adapter.mjs",
  "scope-expansion-successor-projection-recovery.mjs",
]);

export function createScopeExpansionSuccessorProjectionRecoveryRepositoryController(
  options = {},
  dependencies = {},
) {
  return createScopeExpansionSuccessorProjectionRecoveryController(
    createRepositoryAdapter(options, dependencies),
  );
}

export function createRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(text(options.repository, "source repository")));
  const sourceSessionId = text(options.sourceSessionId, "source session");
  const operatorSessionId = text(options.operatorSessionId, "operator session");
  const pullRequestNumber = integer(options.pullRequestNumber, "pull request number");
  const taskAuthorityFile = options.taskAuthorityFile
    ? realpathSync(path.resolve(options.taskAuthorityFile)) : null;
  if (taskAuthorityFile && pathIsInside(repository, taskAuthorityFile)) {
    throw new Error("Task-authority capability must remain outside the source worktree.");
  }
  const environment = dependencies.environment || process.env;
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, args, cwd = repository) => execFileSync(
    command, args, { cwd, encoding: "utf8", env: environment, maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
  ));
  const git = dependencies.git || ((args, cwd = repository) => String(execute("git", args, cwd)).trim());
  const gh = dependencies.gh || (args => String(execute("gh", args, repository)).trim());
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verify = dependencies.verify || invokeRepositoryCloudVerifier;
  const controllerRoot = realpathSync(path.resolve(options.controllerRoot || CONTROLLER_ROOT));
  if (controllerRoot !== realpathSync(CONTROLLER_ROOT)) {
    throw new Error("Recovery requires its installed protected controller root.");
  }
  const branch = text(git(["branch", "--show-current"]), "source branch");
  const registered = assertRegisteredWorktree({
    cwd: repository,
    porcelain: git(["worktree", "list", "--porcelain", "-z"]),
  });
  if (registered.branch !== `refs/heads/${branch}`) invalid("registered branch");
  const commonDirectory = realpathSync(path.resolve(repository, git(["rev-parse", "--git-common-dir"])));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityFile,
  });
  const key = scopeExpansionSuccessorProjectionRecoveryJournalKey(branch);
  const directory = path.join(commonDirectory, "agentic-canvas-os",
    "scope-expansion-successor-projection-recovery");
  const journalPath = path.join(directory, `${key}.json`);
  const lockPath = `${journalPath}.lock`;

  function sourceLease() {
    const lease = leaseStore.read(branch);
    if (!lease || lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
      || lease.sessionId !== sourceSessionId || lease.branch !== branch
      || realpathSync(lease.worktreePath) !== repository
      || !lease.pullRequestUrl?.endsWith(`/pull/${pullRequestNumber}`)
      || lease.admission?.status !== "admitted" || !lease.taskAuthority) {
      invalid("source writer lease");
    }
    return lease;
  }
  function originalIntent() {
    const value = readScopeExpansionIntent({ leaseStore, branch });
    if (!value) invalid("scope-expansion intent");
    return value;
  }
  function cloudStatus(authority) {
    const result = dependencies.cloudStatus
      ? dependencies.cloudStatus(authority)
      : invoke({ action: "status", ledgerRepository: authority.ledgerRepository,
        request: { targetRepository: authority.targetRepository }, environment });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1"
      || result.ok !== true || !Array.isArray(result.claims)) invalid("cloud status");
    return result;
  }
  function pullRequest() {
    const value = JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--json",
      "url,number,id,state,isDraft,isCrossRepository,headRefName,headRefOid,headRepository,baseRefName,baseRefOid,autoMergeRequest,body"]));
    if (value.isCrossRepository || value.number !== pullRequestNumber) invalid("pull request");
    const marker = parseWriterLeasePullRequestBody(String(value.body || ""));
    if (!marker) invalid("pull-request writer marker");
    return { url: value.url, number: value.number, nodeId: value.id, state: value.state,
      isDraft: value.isDraft, autoMergeAbsent: value.autoMergeRequest === null,
      headRepository: value.headRepository.nameWithOwner, headRefName: value.headRefName,
      headRefOid: value.headRefOid, baseRefName: value.baseRefName,
      baseRefOid: value.baseRefOid, body: String(value.body || ""), marker,
      markerDigest: digestValue(marker), bodyDigest: digestValue(String(value.body || "")),
      bodyWithoutMarkerDigest: digestValue(bodyWithoutWriterMarker(String(value.body || ""))) };
  }
  function readLedger(authority, revision) {
    const raw = gh(["api", "--method", "GET", "-H", "Accept: application/vnd.github.raw+json",
      `repos/${authority.ledgerRepository}/contents/.agentic/collaboration-ledger.json`,
      "-f", `ref=${revision}`]);
    const ledger = JSON.parse(raw);
    const failures = validateLedger(ledger);
    if (failures.length) throw new Error(`Recovery ledger is invalid: ${failures.join("; ")}`);
    return ledger;
  }
  function validatedLedger(authority, status) {
    const ledger = dependencies.readLedger
      ? dependencies.readLedger(authority, status.ledgerRevision)
      : readLedger(authority, status.ledgerRevision);
    if (status.ledgerDigest !== ledger.headDigest || status.sequence !== ledger.sequence) {
      invalid("cloud status and validated ledger head");
    }
    return ledger;
  }
  function checkpoint() {
    const lease = sourceLease();
    const intent = originalIntent();
    if (intent.status !== "source-retired"
      || intent.planDigest !== RECOVERED_SCOPE_EXPANSION_PLAN_DIGEST) {
      invalid("exact c902 source-retired intent");
    }
    const status = cloudStatus(lease.cloudAuthority);
    const candidates = status.claims.filter(claim => claim.claimId === intent.targetClaimId
      && claim.predecessorClaimId === intent.sourceClaimId);
    if (candidates.length !== 1) invalid("unique C2 successor");
    const successor = candidates[0];
    assertScopeExpansionRecoverySuccessorUnexpired(successor.expiresAt, now());
    const ledger = validatedLedger(lease.cloudAuthority, status);
    const sourceEntries = ledger.entries.filter(entry => entry.claimId === intent.sourceClaimId);
    const successorEntries = ledger.entries.filter(entry => entry.claimId === intent.targetClaimId);
    const retired = sourceEntries.at(-1);
    const prior = sourceEntries.at(-2);
    const waiting = successorEntries.at(0);
    const promoted = successorEntries.at(-1);
    if (!retired || !prior || !waiting || !promoted || retired.action !== "retire"
      || successorEntries.length !== 2 || promoted.action !== "continue") {
      invalid("retired C1 and promoted C2 ledger suffix");
    }
    const sourceRetirement = { ...retired.claimCore, claimId: retired.claimId,
      claimDigest: retired.claimDigest, transitionDigest: retired.digest,
      priorClaimDigest: prior.claimDigest, action: retired.action };
    const successorWithCore = { ...successor, claimCore: promoted.claimCore,
      waitingClaimDigest: waiting.claimDigest, waitingTransitionDigest: waiting.digest };
    const recoveryLineage = [prior, waiting, retired, promoted].map(entry => ({
      sequence: entry.sequence, action: entry.action, claimId: entry.claimId,
      claimDigest: entry.claimDigest, transitionDigest: entry.digest,
      transitionCounter: entry.claimCore.transitionCounter,
    }));
    const lane = readScopeExpansionSuccessorProjectionRecoveryLane({ repository, git });
    const pull = pullRequest();
    const controller = readScopeExpansionSuccessorProjectionRecoveryController({ controllerRoot, git,
      repository: lease.cloudAuthority.targetRepository, implementation: IMPLEMENTATION });
    return buildScopeExpansionSuccessorProjectionRecoveryEvidence({
      controller, lane, lease, scopeExpansionIntent: intent,
      pullRequest: withoutBody(pull), sourceRetirement, successor: successorWithCore,
      cloud: { observedLedgerRevision: status.ledgerRevision,
        observedLedgerDigest: status.ledgerDigest,
        observedLedgerSequence: status.sequence,
        observedInventoryDigest: digestValue(status.claims),
        sourceRetirementDigest: digestValue(sourceRetirement),
        successorDigest: digestValue(successorWithCore), successorCandidateCount: candidates.length,
        sourceLineageCount: sourceEntries.length, successorLineageCount: successorEntries.length,
        sourceLineageDigest: digestValue(sourceEntries.map(entry => entry.digest)),
        successorLineageDigest: digestValue(successorEntries.map(entry => entry.digest)),
        recoveryLineage, validatedLedgerDigest: digestValue({
          schema: ledger.schema, ledgerRepositoryId: ledger.ledgerRepositoryId,
          headDigest: ledger.headDigest, sequence: ledger.sequence, recoveryLineage,
        }) },
    });
  }
  function readIntent() {
    return readScopeExpansionSuccessorProjectionRecoveryJournal(journalPath);
  }
  function writeIntent({ expected, value }) {
    return writeScopeExpansionSuccessorProjectionRecoveryJournal({ filePath: journalPath,
      stateRoot: commonDirectory, expected, value });
  }
  async function withFence(action) {
    return withScopeExpansionSuccessorProjectionRecoveryFence({ lockPath,
      stateRoot: commonDirectory, action });
  }
  async function verifyTaskAuthority({ plan, intent = null, phase = "task-authority-verified" }) {
    if (!taskAuthorityFile) throw new Error("Recovery run requires --task-authority.");
    if (phase === "task-authority-verified") {
      assertFreshDecisionSubject(plan);
    } else if (phase === "successor-bound") {
      const bound = boundAuthority(plan);
      if (bound) assertBoundPreLocal(plan, bound);
      else assertFreshDecisionSubject(plan);
    } else if (phase === "local-cas") {
      if (sourceLease().cloudAuthority.claimId === plan.successorClaimId) {
        assertLocalProjection(plan);
      } else {
        assertBoundPreLocal(plan, intent.phases["successor-bound"].values.authority);
      }
    } else if (phase === "pr-marker") {
      assertLocalProjection(plan);
      const pull = pullRequest();
      const sourceMarker = plan.evidence.pullRequest.markerDigest;
      const targetMarker = digestValue(projectWriterLeasePullRequestMarker(sourceLease()));
      assertPullRequestSubject(plan, pull, { markerDigest: pull.markerDigest,
        requireOriginalBody: pull.markerDigest === sourceMarker });
      if (![sourceMarker, targetMarker].includes(pull.markerDigest)) invalid("pre-PR capability frame");
    } else if (phase === "complete") {
      await verifyTerminal({ plan, intent });
    } else {
      throw new Error(`Unsupported recovery capability phase: ${phase}.`);
    }
    const receipt = authorizeTaskBoundLeaseMutation({ lease: sourceLease(),
      capabilityPath: taskAuthorityFile,
      operation: scopeExpansionSuccessorProjectionRecoveryTaskOperation(phase), now: now() });
    return { taskAuthorityReceiptDigest: receipt.receiptDigest,
      sourceTaskAuthorityBindingDigest: receipt.bindingDigest };
  }
  async function adoptPromotion({ plan }) {
    assertFreshDecisionSubject(plan);
    const promoted = promotedEvidence(plan);
    const core = { schema: "agentic-scope-expansion-successor-promotion-adoption/v1",
      recoveryPlanDigest: plan.planDigest, originalPlanDigest: plan.evidence.originalPlanDigest,
      promoted };
    return { promoted, receiptDigest: digestValue(core) };
  }
  function boundAuthority(plan) {
    const lease = sourceLease();
    const status = cloudStatus(lease.cloudAuthority);
    const candidates = status.claims.filter(claim => claim.claimId === plan.successorClaimId);
    if (candidates.length !== 1) invalid("bound C2 cardinality");
    const claim = candidates[0];
    const sealed = plan.evidence.successor;
    if (claim.reviewRequestId !== plan.evidence.originalPlan.sourceReviewRequestId
      || claim.state !== "current" || claim.writeAuthority !== true || claim.scopeReserved !== true
      || claim.predecessorClaimId !== plan.sourceClaimId
      || claim.actorId !== sealed.actorId || claim.repositoryId !== sealed.repositoryId
      || claim.workItemId !== sealed.workItemId
      || claim.canonicalBaseRevision !== sealed.canonicalBaseRevision
      || claim.laneRevision !== sealed.laneRevision
      || claim.writeSetDigest !== sealed.writeSetDigest
      || claim.leaseEpoch !== sealed.leaseEpoch
      || claim.transitionCounter !== sealed.transitionCounter + 1
      || claim.heartbeatCounter !== sealed.heartbeatCounter
      || claim.integrationReceiptDigest !== null || claim.integration !== null
      || Date.parse(claim.expiresAt) <= now().getTime()) return null;
    const ledger = validatedLedger(lease.cloudAuthority, status);
    const entry = ledger.entries.findLast(value => value.claimId === claim.claimId);
    assertScopeExpansionSuccessorRecoveryBoundTransition({
      sealed, current: claim, entry,
      reviewRequestId: plan.evidence.originalPlan.sourceReviewRequestId, now: now(),
    });
    return normalizeBoundAuthority({ result: { schema: status.schema, ok: true,
      action: "continue", ledgerRevision: status.ledgerRevision, ledgerDigest: status.ledgerDigest,
      claimDigest: claim.fenceRevision, claim }, authority: {
      ...lease.cloudAuthority, canonicalBaseSha: plan.evidence.originalPlan.targetCanonicalBaseSha,
      laneRevision: plan.evidence.originalPlan.sourceFenceSha,
      cloudDeclaredWriteScope: plan.evidence.originalPlan.targetDeclaredWriteSet,
      writeSetDigest: plan.evidence.originalPlan.targetWriteSetDigest, leaseEpoch: 1,
      reviewRequestId: claim.reviewRequestId, state: "active",
      manifestDigest: plan.evidence.originalPlan.targetManifestDigest,
    }, manifest: manifest(plan), deviceId: lease.device, sessionId: lease.sessionId });
  }
  async function bindSuccessor({ plan, intent }) {
    assertFreshDecisionSubject(plan);
    const adopted = boundAuthority(plan);
    if (adopted) return { authority: adopted,
      receiptDigest: adopted.operationReceiptDigest };
    const lease = sourceLease();
    const claim = plan.evidence.successor;
    const seed = normalizeBoundAuthority({ result: { schema: "agentic-cloud-collaboration-result/v1",
      ok: true, action: "continue", ledgerRevision: plan.evidence.cloud.observedLedgerRevision,
      ledgerDigest: plan.evidence.cloud.observedLedgerDigest, claimDigest: claim.fenceRevision, claim },
    authority: { ...lease.cloudAuthority,
      canonicalBaseSha: plan.evidence.originalPlan.targetCanonicalBaseSha,
      laneRevision: plan.evidence.originalPlan.sourceFenceSha,
      cloudDeclaredWriteScope: plan.evidence.originalPlan.targetDeclaredWriteSet,
      writeSetDigest: plan.evidence.originalPlan.targetWriteSetDigest, leaseEpoch: 1,
      reviewRequestId: null, state: "active",
      manifestDigest: plan.evidence.originalPlan.targetManifestDigest },
    manifest: manifest(plan), deviceId: lease.device, sessionId: lease.sessionId });
    const pull = pullRequest();
    if (pull.headRefOid !== plan.evidence.originalPlan.sourceFenceSha) invalid("PR head before C2 bind");
    const bound = bindAdmissionCloudAuthority({ authority: seed, manifest: manifest(plan),
      branch, headSha: plan.evidence.originalPlan.sourceFenceSha,
      reviewRequestId: plan.evidence.originalPlan.sourceReviewRequestId,
      deviceId: lease.device, sessionId: lease.sessionId,
      idempotencyKey: `scope-expansion-successor-recovery:bind:${plan.planDigest}:${claim.claimId}`,
      returnVerification: true, environment, invoke, inspect: invoke, verify });
    return { authority: bound.authority,
      receiptDigest: bound.verification.receiptDigest };
  }
  function validateProjectedLease(lease) {
    const verified = verifyAdmissionCloudAuthority({ authority: lease.cloudAuthority,
      manifest: manifestFromLease(lease), canonicalBaseSha: lease.baseSha,
      environment, inspect: invoke, invoke: verify });
    return assertAdmissionMutationAuthority({ lease, cloudAuthority: verified.authority,
      remoteAuthorityVerification: verified.verification });
  }
  async function projectLocal({ plan, intent }) {
    if (!taskAuthorityFile) throw new Error("Recovery run requires --task-authority.");
    const promotion = intent.phases["promotion-adopted"].values;
    const binding = intent.phases["successor-bound"].values;
    if (sourceLease().cloudAuthority.claimId === plan.successorClaimId) {
      assertLocalProjection(plan);
    } else {
      assertBoundPreLocal(plan, binding.authority);
    }
    const sourceIntent = plan.evidence.scopeExpansionIntent;
    const successorIntent = { ...sourceIntent, status: "successor-bound",
      promoted: promotion.promoted, promotedReceiptDigest: promotion.receiptDigest,
      boundAuthority: binding.authority, boundReceiptDigest: binding.receiptDigest,
      targetClaimId: binding.authority.claimId, targetClaimDigest: binding.authority.claimDigest,
      targetReviewRequestId: binding.authority.reviewRequestId };
    const result = projectActiveDirtyScopeExpansionSuccessor({ leaseStore, branch,
      expectedLeaseDigest: plan.evidence.leaseDigest, expectedClaimId: plan.sourceClaimId,
      plan: plan.evidence.originalPlan, authority: binding.authority, taskAuthorityFile,
      successorIntent, promotedEvidence: promotedEvidence(plan),
      validateLease: validateProjectedLease });
    return { leaseDigest: writerLeaseDigest(result.lease), projection: result.projection,
      receiptDigest: result.receiptDigest, adopted: result.adopted };
  }
  async function projectPullRequest({ plan }) {
    const lease = sourceLease();
    if (lease.cloudAuthority.claimId !== plan.successorClaimId) invalid("local C2 lease");
    assertLocalProjection(plan);
    const before = pullRequest();
    const sourceMarker = plan.evidence.pullRequest.markerDigest;
    const targetMarker = digestValue(projectWriterLeasePullRequestMarker(lease));
    assertPullRequestSubject(plan, before, { markerDigest: before.markerDigest,
      requireOriginalBody: before.markerDigest === sourceMarker });
    if (before.bodyWithoutMarkerDigest !== plan.evidence.pullRequest.bodyWithoutMarkerDigest
      || ![sourceMarker, targetMarker].includes(before.markerDigest)
      || before.markerDigest === sourceMarker
        && before.bodyDigest !== plan.evidence.pullRequest.bodyDigest) {
      invalid("sealed pull-request body before C2 projection");
    }
    const body = updateWriterLeasePullRequestBody(before.body, lease);
    if (body !== before.body) execute("gh", ["pr", "edit", before.url, "--body", body]);
    const after = pullRequest();
    const markerDigest = targetMarker;
    assertPullRequestSubject(plan, after, { markerDigest, requireOriginalBody: false });
    const current = originalIntent();
    if (current.status === "local-cas") {
      advanceScopeExpansionIntent({ leaseStore, branch,
        expectedLeaseDigest: writerLeaseDigest(lease), expectedClaimId: plan.successorClaimId,
        expectedPlanDigest: plan.evidence.originalPlanDigest,
        values: { status: "pr-marker", pullRequestProjection: { markerDigest },
          pullRequestProjectionReceiptDigest: digestValue({
            schema: "agentic-active-dirty-scope-expansion-pr-projection/v1",
            planDigest: plan.evidence.originalPlanDigest, pullRequestUrl: after.url, markerDigest,
          }) } });
    } else if (current.status !== "pr-marker") invalid("scope-expansion PR-marker phase");
    return { pullRequestMarkerDigest: markerDigest,
      receiptDigest: originalIntent().pullRequestProjectionReceiptDigest };
  }
  async function verifyTerminal({ plan, intent }) {
    const lease = sourceLease();
    const original = originalIntent();
    const pull = pullRequest();
    const dirt = readScopeExpansionSuccessorProjectionRecoveryLane({ repository, git });
    assertCommonProtectedSubject(plan);
    assertPullRequestSubject(plan, pull, {
      markerDigest: digestValue(projectWriterLeasePullRequestMarker(lease)),
      requireOriginalBody: false,
    });
    if (lease.cloudAuthority.claimId !== plan.successorClaimId
      || !["pr-marker", "complete"].includes(original.status)
      || dirt.dirtDigest !== plan.evidence.lane.dirtDigest
      || lease.taskAuthority?.bindingMode !== "continuation"
      || lease.taskAuthority?.priorBindingDigest
        !== plan.evidence.sourceTaskAuthorityBindingDigest) invalid("terminal C2 projection");
    const authority = validateProjectedLease(lease);
    const core = { schema: "agentic-scope-expansion-successor-projection-terminal/v1",
      recoveryPlanDigest: plan.planDigest, leaseDigest: writerLeaseDigest(lease),
      originalIntentDigest: original.status === "complete"
        ? intent.phases.verified.values.originalIntentDigest : digestValue(original),
      pullRequestMarkerDigest: pull.markerDigest, dirtDigest: dirt.dirtDigest,
      mutationAuthorityReceiptDigest: authority.receiptDigest,
      taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
      cloudAuthorityDigest: digestValue(lease.cloudAuthority) };
    return { ...core, terminalVerificationDigest:
      scopeExpansionSuccessorProjectionTerminalStableDigest(core) };
  }
  async function completeOriginalIntent({ plan, intent }) {
    const lease = sourceLease();
    let original = originalIntent();
    const terminal = intent.phases.verified.values;
    const currentTerminal = await verifyTerminal({ plan, intent });
    if (currentTerminal.terminalVerificationDigest !== terminal.terminalVerificationDigest) {
      throw new Error("Terminal recovery subject changed immediately before completion.");
    }
    const finalReceiptDigest = digestValue({
      schema: "agentic-active-dirty-scope-expansion-complete/v1",
      planDigest: plan.evidence.originalPlanDigest,
      mutationAuthorityReceiptDigest: terminal.mutationAuthorityReceiptDigest,
      pullRequestMarkerDigest: terminal.pullRequestMarkerDigest,
    });
    if (original.status === "pr-marker") {
      original = advanceScopeExpansionIntent({ leaseStore, branch,
        expectedLeaseDigest: writerLeaseDigest(lease), expectedClaimId: plan.successorClaimId,
        expectedPlanDigest: plan.evidence.originalPlanDigest,
        values: { status: "complete", finalReceiptDigest } }).intent;
    }
    if (original.status !== "complete" || original.finalReceiptDigest !== finalReceiptDigest) {
      invalid("complete original scope-expansion intent");
    }
    return { taskAuthorityReceiptDigest:
        intent.phases["task-authority-verified"].values.taskAuthorityReceiptDigest,
      successorBindReceiptDigest: intent.phases["successor-bound"].values.receiptDigest,
      localProjectionReceiptDigest: intent.phases["local-cas"].values.receiptDigest,
      pullRequestMarkerDigest: intent.phases["pr-marker"].values.pullRequestMarkerDigest,
      terminalVerificationDigest: terminal.terminalVerificationDigest,
      finalScopeExpansionReceiptDigest: finalReceiptDigest };
  }
  function assertFreshDecisionSubject(plan) {
    const live = checkpoint();
    if (digestValue(scopeExpansionSuccessorProjectionRecoveryDecisionSubject(live))
      !== plan.decisionSubjectDigest) {
      throw new Error("Recovery decision subject changed before its effect boundary.");
    }
    return live;
  }
  function assertCommonProtectedSubject(plan) {
    const controller = readScopeExpansionSuccessorProjectionRecoveryController({ controllerRoot, git,
      repository: plan.evidence.controller.repository, implementation: IMPLEMENTATION });
    const lane = readScopeExpansionSuccessorProjectionRecoveryLane({ repository, git });
    return assertScopeExpansionSuccessorRecoveryProtectedFrame({
      sealedController: plan.evidence.controller, currentController: controller,
      sealedLane: plan.evidence.lane, currentLane: lane,
    });
  }
  function assertPullRequestSubject(plan, pull, { markerDigest, requireOriginalBody }) {
    return assertScopeExpansionSuccessorRecoveryPullRequest({
      sealed: plan.evidence.pullRequest, current: pull, markerDigest, requireOriginalBody,
    });
  }
  function assertBoundPreLocal(plan, authority) {
    assertCommonProtectedSubject(plan);
    const lease = sourceLease();
    if (writerLeaseDigest(lease) !== plan.evidence.leaseDigest
      || digestValue(originalIntent()) !== plan.evidence.scopeExpansionIntentDigest) {
      throw new Error("Local C1 or source-retired intent changed before C2 projection.");
    }
    assertPullRequestSubject(plan, pullRequest(), {
      markerDigest: plan.evidence.pullRequest.markerDigest,
      requireOriginalBody: true,
    });
    const live = boundAuthority(plan);
    if (!live || digestValue(live) !== digestValue(authority)) {
      throw new Error("Bound C2 authority changed before local projection.");
    }
  }
  function assertLocalProjection(plan) {
    assertCommonProtectedSubject(plan);
    const lease = sourceLease();
    const intent = originalIntent();
    if (lease.cloudAuthority.claimId !== plan.successorClaimId
      || !["local-cas", "pr-marker", "complete"].includes(intent.status)
      || intent.localProjection?.leaseDigest !== writerLeaseDigest(lease)
      || intent.localProjection?.claimId !== plan.successorClaimId
      || lease.taskAuthority?.bindingMode !== "continuation"
      || lease.taskAuthority?.priorBindingDigest !== plan.evidence.sourceTaskAuthorityBindingDigest) {
      throw new Error("Atomic C2 local projection changed before PR effect.");
    }
    validateProjectedLease(lease);
  }
  async function verifyCompleted(input) {
    const terminal = await verifyTerminal(input);
    const expected = input.intent.completion;
    if (terminal.terminalVerificationDigest !== expected.terminalVerificationDigest
      || originalIntent().finalReceiptDigest !== expected.finalScopeExpansionReceiptDigest) {
      invalid("completed recovery live verification");
    }
    return terminal;
  }
  async function reconcilePhase(input) {
    const phase = input.phase;
    if (phase === "promotion-adopted") return adoptPromotion(input);
    if (phase === "successor-bound") { const authority = boundAuthority(input.plan);
      if (authority) assertBoundPreLocal(input.plan, authority);
      return authority ? { authority, receiptDigest: authority.operationReceiptDigest } : null; }
    if (phase === "local-cas" && sourceLease().cloudAuthority.claimId === input.plan.successorClaimId) {
      return projectLocal(input);
    }
    if (phase === "pr-marker" && originalIntent().status === "pr-marker") {
      return projectPullRequest(input);
    }
    if (phase === "verified" && originalIntent().status === "pr-marker") {
      try { return await verifyTerminal(input); } catch { return null; }
    }
    if (phase === "complete" && originalIntent().status === "complete") {
      return completeOriginalIntent(input);
    }
    return null;
  }
  async function readEvidence() {
    const first = checkpoint();
    const second = checkpoint();
    if (digestValue(scopeExpansionSuccessorProjectionRecoveryDecisionSubject(first))
      !== digestValue(scopeExpansionSuccessorProjectionRecoveryDecisionSubject(second))) {
      throw new Error("Recovery evidence changed across its paired capture.");
    }
    return second;
  }
  return { withFence, readEvidence, readIntent, writeIntent,
    reconcilePhase, verifyTaskAuthority, adoptPromotion, bindSuccessor, projectLocal,
    projectPullRequest, verifyTerminal, completeOriginalIntent, verifyCompleted };
}

export function scopeExpansionSuccessorProjectionRecoveryJournalKey(branch) {
  return digestValue(`${text(branch, "source branch")}:${RECOVERED_SCOPE_EXPANSION_PLAN_DIGEST}`);
}

function promotedEvidence(plan) { const claim = plan.evidence.successor;
  return { claimId: claim.claimId, claimDigest: claim.fenceRevision,
    ledgerRevision: plan.evidence.cloud.observedLedgerRevision,
    claimLedgerRevision: claim.transitionDigest, transitionCounter: claim.transitionCounter,
    expiresAt: claim.expiresAt }; }

function manifest(plan) { return { schema: "agentic-declared-write-scope/v1",
  semanticScope: plan.evidence.lease.scope,
  declaredWriteSet: plan.evidence.originalPlan.targetDeclaredWriteSet,
  writeSetDigest: plan.evidence.originalPlan.targetWriteSetDigest,
  manifestDigest: plan.evidence.originalPlan.targetManifestDigest }; }
function manifestFromLease(lease) { return { schema: "agentic-declared-write-scope/v1",
  semanticScope: lease.scope, declaredWriteSet: lease.admission.declaredWriteSet,
  writeSetDigest: lease.admission.writeSetDigest, manifestDigest: lease.admission.manifestDigest }; }
function withoutBody(value) { const { body, ...result } = value; return result; }
function bodyWithoutWriterMarker(value) { return String(value).replace(/<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu, ""); }
function pathIsInside(root, candidate) { const relative = path.relative(root, candidate);
  return relative === "" || relative && !relative.startsWith("..") && !path.isAbsolute(relative); }
function text(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value.trim(); }
function integer(value, label) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) invalid(label); return result; }
function invalid(label) { throw new Error(`Scope-expansion successor projection recovery has invalid ${label}.`); }
