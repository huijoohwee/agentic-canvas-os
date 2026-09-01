// Responsibility: Bind dormant-owner continuation effects to one exact repository and provider subject.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import {
  canonicalJson, digestValue,
} from "./cloud-collaboration-primitives.mjs";
import {
  captureActiveOwnedDirtEvidence,
  requireSameActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";
import {
  captureSuccessorRolloverProtectedControllerAdvance,
} from "./active-dirty-scope-expansion-successor-rollover-continuation-frame.mjs";
import { requireProtectedMainEquivalent }
  from "./device-branch-ownership-lib.mjs";
import {
  expiredCommittedCloudRecoveryEvidenceDigest,
  continueExpiredCommittedHeartbeatCloudAuthority,
  preserveSourceManifestProjection,
} from "./expired-committed-heartbeat-cloud-authority.mjs";
import { writerLeaseBodyRemainder }
  from "./orphaned-task-authority-recovery-evidence.mjs";
import { createGitHubConditionalPullBodyPort }
  from "./github-conditional-pull-body.mjs";
import {
  invokeRepositoryCloudAction,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import {
  assertCapabilityMatchesBinding,
  assertTaskAuthorityBinding,
  createTaskAuthorityBinding,
  createTaskAuthorityProof,
  normalizeTaskAuthorityCapability,
  verifyTaskAuthorityProof,
} from "./task-bound-lane-authority-contract.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
} from "./writer-lease-lib.mjs";
import {
  mutateWriterLeaseRegistry,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";
import {
  buildDormantOwnerContinuationEvidence,
  requireSameDormantOwnerContinuationEvidence,
  requireSameDormantOwnerContinuationStaticEvidence,
} from "./successor-rollover-dormant-owner-continuation-evidence.mjs";
import {
  normalizeDormantOwnerContinuationPlan,
  OPERATION,
} from "./successor-rollover-dormant-owner-continuation-contract.mjs";

export function createRepositoryDormantOwnerContinuationAdapter(
  options = {},
  dependencies = {},
) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session ID");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request");
  const taskAuthorityCapability = options.taskAuthorityCapability
    ? Object.freeze(normalizeTaskAuthorityCapability(options.taskAuthorityCapability)) : null;
  const controllerRoot = realpathSync(path.resolve(required(options.controllerRoot, "controller root")));
  const ttlSeconds = positive(options.ttlSeconds || 1_800, "TTL seconds");
  const environment = options.environment || process.env;
  const execute = dependencies.execute || ((command, args, settings = {}) => execFileSync(
    command,
    args,
    { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], ...settings },
  ));
  const git = dependencies.git || (args => String(execute("git", args)).trim());
  const gh = dependencies.gh || (args => String(execute("gh", args)).trim());
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verifyCloud = dependencies.verifyCloud || verifyAdmissionCloudAuthority;
  const now = dependencies.now || (() => new Date());
  const commonDirectory = realpathSync(path.resolve(repository, git([
    "rev-parse", "--git-common-dir",
  ])));
  const store = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityPolicy: "projected",
  });
  const pullPort = dependencies.pullPort || createGitHubConditionalPullBodyPort({ repository });
  const sealedInputs = Object.freeze({
    continuationPlan: cloneObject(options.continuationPlan, "rollover plan"),
    rolloverJournal: cloneObject(options.rolloverJournal, "rollover journal"),
    promotionJournal: cloneObject(options.promotionJournal, "successor promotion journal"),
  });
  const consumedProofDigests = new Set();
  const authorizedProofs = new Map();
  let recovered = null;

  function inputs() {
    return sealedInputs;
  }

  function sourceLease(expectedPlan = null) {
    const branch = required(git(["branch", "--show-current"]), "branch");
    const lease = store.read(branch);
    if (!lease || branch !== lease.branch || lease.sessionId !== sessionId
      || realpathSync(lease.worktreePath) !== repository) invalid("source lease identity");
    if (expectedPlan && branch !== expectedPlan.branch) invalid("planned source branch");
    assertRegistered(branch);
    return lease;
  }

  function readPull() {
    const conditional = pullPort.readConditionalPull({
      targetRepository: "huijoohwee/agentic-canvas-os",
      pullRequestNumber,
    });
    const supplemental = JSON.parse(gh([
      "pr", "view", String(pullRequestNumber), "--json",
      "id,url,number,state,isDraft,headRefName,headRefOid,baseRefOid,autoMergeRequest",
    ]));
    if (supplemental.id !== conditional.id || supplemental.number !== conditional.number
      || supplemental.url !== conditional.url || supplemental.headRefOid !== conditional.headSha
      || supplemental.baseRefOid !== conditional.baseSha) invalid("conditional pull-request join");
    return Object.freeze({
      ...conditional,
      autoMergeRequest: supplemental.autoMergeRequest,
    });
  }

  function controllerAdvance(continuationPlan) {
    const replacement = continuationPlan.replacementPlanSnapshot;
    const controllerGit = args => String(execFileSync("git", args, {
      cwd: controllerRoot,
      encoding: "utf8",
    })).trim();
    const protectedMainSha = controllerGit([
      "ls-remote", "--heads", "origin", "refs/heads/main",
    ]).split(/\s+/u)[0];
    return captureSuccessorRolloverProtectedControllerAdvance({
      replacementPlan: replacement,
      controllerHeadSha: controllerGit(["rev-parse", "HEAD"]),
      controllerOriginMainSha: controllerGit(["rev-parse", "origin/main"]),
      protectedMainSha,
      controllerStatus: controllerGit(["status", "--porcelain=v1", "--untracked-files=all"]),
      gitText: controllerGit,
    });
  }

  function staticEvidenceInput(plan = null) {
    const privateInputs = inputs();
    const lease = sourceLease(plan);
    const registry = store.readRegistry();
    const tombstone = registry.scopeExpansionSuccessorRolloverReceipts?.[lease.branch];
    const observedAt = plan?.evidenceSnapshot?.observedAt || now().toISOString();
    return {
      ...privateInputs,
      lease,
      tombstone,
      pullRequest: readPull(),
      dirtEvidence: captureActiveOwnedDirtEvidence({ repository }),
      protectedControllerAdvance: controllerAdvance(privateInputs.continuationPlan),
      repository,
      controllerRoot,
      registryRevision: registry.revision,
      observedAt,
    };
  }

  function captureEvidence({ plan = null } = {}) {
    const input = staticEvidenceInput(plan);
    const evidence = buildDormantOwnerContinuationEvidence({
      ...input,
      cloudStatus: cloudStatus(input.lease),
    });
    if (plan) requireSameDormantOwnerContinuationEvidence(plan.evidenceSnapshot, evidence);
    return evidence;
  }

  function authorizeTaskAuthority({ plan, operation }) {
    if (!taskAuthorityCapability) invalid("task-authority capability");
    const lease = requireSourceOrRecoveredLease(plan);
    const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    assertCapabilityMatchesBinding(taskAuthorityCapability, binding);
    const issuedAt = now().toISOString();
    const proof = createTaskAuthorityProof({
      capability: taskAuthorityCapability,
      binding,
      lease,
      operation: `${OPERATION}:${plan.planDigest}:${required(operation, "task operation")}`,
      issuedAt,
    });
    const verified = verifyTaskAuthorityProof({
      proof,
      binding,
      lease,
      operation: proof.challenge.operation,
      now: new Date(issuedAt),
      consumedProofDigests,
    });
    if (verified.proofDigest !== proof.proofDigest) invalid("task proof verification");
    const authorization = proof;
    authorizedProofs.set(proof.proofDigest, authorization);
    return authorization;
  }

  function consumeTaskAuthorization(value, plan, operation) {
    const proofDigest = value?.proofDigest;
    const authorized = authorizedProofs.get(proofDigest);
    if (!authorized || canonicalJson(authorized) !== canonicalJson(value)
      || value.challenge.operation !== `${OPERATION}:${plan.planDigest}:${operation}`) {
      invalid(`${operation} task proof`);
    }
    authorizedProofs.delete(proofDigest);
    return authorized;
  }

  function recoverCloudAuthority({ plan, taskAuthority }) {
    consumeTaskAuthorization(taskAuthority, plan, "cloud-recovery");
    requireSameDormantOwnerContinuationStaticEvidence(
      plan.evidenceSnapshot,
      staticEvidenceInput(plan),
    );
    const lease = requireSourceOrRecoveredLease(plan);
    if (isRecoveredLease(lease, plan)) {
      return cloudProjectionFromLiveLease(lease, plan);
    }
    const recoveryEvidence = {
      schema: `agentic-${OPERATION}-cloud-recovery/v1`,
      planDigest: plan.planDigest,
      continuationPlanDigest: plan.evidenceSnapshot.rollover.continuationPlanDigest,
      rolloverJournalDigest: plan.evidenceSnapshot.rollover.rolloverJournalDigest,
      promotionJournalDigest: plan.evidenceSnapshot.promotion.journalDigest,
      tombstoneDigest: plan.evidenceSnapshot.rollover.tombstoneDigest,
      sourceLeaseDigest: plan.sourceLeaseDigest,
      claimId: plan.claimId,
      headSha: plan.sourceFenceSha,
      pullRequestStateDigest: digestValue(plan.evidenceSnapshot.pullRequest),
    };
    const recoveryEvidenceDigest = expiredCommittedCloudRecoveryEvidenceDigest({
      snapshotDigest: plan.evidenceSnapshot.dirt.evidenceDigest,
      recoveryEvidence,
    });
    const result = continueExpiredCommittedHeartbeatCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: lease.admission,
      recoveryEvidenceDigest,
      deviceId: lease.device,
      sessionId: lease.sessionId,
      ttlSeconds,
      environment,
      inspect: invoke,
      invoke,
      verify: verifyCloud,
    });
    const verified = verifyCloud({
      authority: preserveSourceManifestProjection(
        lease.cloudAuthority,
        result.authority,
      ),
      manifest: lease.admission,
      canonicalBaseSha: lease.baseSha,
      environment,
    });
    recovered = preserveSourceManifestProjection(
      lease.cloudAuthority,
      verified.authority,
    );
    return Object.freeze({
      authority: recovered,
      claimDigest: recovered.claimDigest,
      expiresAt: recovered.expiresAt,
      receiptDigest: required(
        verified.verification?.receiptDigest,
        "cloud verification receipt digest",
      ),
    });
  }

  function projectLocalLease({ plan, cloudRecovery = null, taskAuthority }) {
    consumeTaskAuthorization(taskAuthority, plan, "local-projection");
    if (!taskAuthorityCapability) invalid("task-authority capability");
    const current = requireSourceOrRecoveredLease(plan);
    if (isRecoveredLease(current, plan)) return projectedLeaseResult(current);
    const cloud = requirePlanBoundCloudRecovery({ plan, recovery: cloudRecovery });
    const authority = cloud.authority;
    const originalDirt = plan.evidenceSnapshot.dirt;
    requireSameActiveOwnedDirtEvidence(
      originalDirt,
      captureActiveOwnedDirtEvidence({ repository }),
    );
    const expectedTombstone = plan.evidenceSnapshot.rollover.tombstoneDigest;
    let nextLease;
    const result = mutateWriterLeaseRegistry({
      leaseStore: store,
      branch: plan.branch,
      expectedLeaseDigest: plan.sourceLeaseDigest,
      expectedClaimId: plan.claimId,
      action: ({ registry, lease }) => {
        if (digestValue(registry.scopeExpansionSuccessorRolloverReceipts?.[plan.branch])
          !== expectedTombstone) invalid("rollover tombstone CAS fence");
        const epoch = Math.max(...Object.values(registry.leases || {})
          .map(candidate => Number(candidate.epoch || 0))) + 1;
        const core = {
          ...lease,
          epoch,
          cloudAuthority: authority,
          heartbeatAt: plan.evidenceSnapshot.observedAt,
          expiresAt: authority.expiresAt,
        };
        nextLease = {
          ...core,
          taskAuthority: createTaskAuthorityBinding({
            lease: core,
            capability: taskAuthorityCapability,
            bindingMode: "continuation",
            boundAt: plan.evidenceSnapshot.observedAt,
            transitionPlanDigest: null,
            priorBindingDigest: lease.taskAuthority.bindingDigest,
          }),
        };
        return {
          registry: {
            ...registry,
            leases: { ...registry.leases, [plan.branch]: nextLease },
          },
          lease: nextLease,
          changed: true,
        };
      },
    });
    if (digestValue(store.readRegistry().scopeExpansionSuccessorRolloverReceipts?.[plan.branch])
      !== expectedTombstone) invalid("rollover tombstone preservation");
    return projectedLeaseResult(nextLease, result.registryRevision);
  }

  function requirePlanBoundCloudRecovery({ plan, recovery }) {
    const authority = recovery?.authority;
    if (!authority || recovery.claimDigest !== authority.claimDigest
      || recovery.expiresAt !== authority.expiresAt
      || authority.claimId !== plan.claimId
      || authority.transitionCounter !== plan.sourceTransitionCounter + 1
      || authority.canonicalBaseSha !== plan.sourceBaseSha
      || authority.laneRevision !== plan.sourceFenceSha
      || authority.writeSetDigest !== plan.writeSetDigest
      || authority.reviewRequestId !== plan.reviewRequestId
      || authority.state !== "active") {
      invalid("plan-bound cloud recovery");
    }
    recovered = authority;
    return recovery;
  }

  function projectPullRequestMarker({ plan }) {
    const lease = requireRecoveredLease(plan);
    const current = readPull();
    assertPullIdentity(current, plan);
    const targetBody = updateWriterLeasePullRequestBody(current.body, lease);
    if (digestValue(writerLeaseBodyRemainder(targetBody))
      !== plan.evidenceSnapshot.pullRequest.bodyRemainderDigest) invalid("pull-request body remainder");
    const targetMarker = parseWriterLeasePullRequestBody(targetBody);
    if (digestValue(current.body) !== digestValue(targetBody)) {
      if (digestValue(current.body) !== plan.evidenceSnapshot.pullRequest.bodyDigest) {
        invalid("pull-request source or target body");
      }
      try {
        pullPort.patchConditionalPull({
          targetRepository: lease.cloudAuthority.targetRepository,
          pullRequestNumber,
          expectedEtag: current.etag,
          body: targetBody,
        });
      } catch (error) {
        const adopted = readPull();
        if (digestValue(adopted.body) !== digestValue(targetBody)) throw error;
      }
    }
    const verified = readPull();
    assertPullIdentity(verified, plan);
    if (digestValue(verified.body) !== digestValue(targetBody)
      || digestValue(parseWriterLeasePullRequestBody(verified.body))
        !== digestValue(targetMarker)) invalid("pull-request target marker");
    return Object.freeze({
      bodyDigest: digestValue(verified.body),
      markerDigest: digestValue(targetMarker),
    });
  }

  function verifyCompletion({ plan }) {
    const lease = requireRecoveredLease(plan);
    const registry = store.readRegistry();
    if (digestValue(registry.scopeExpansionSuccessorRolloverReceipts?.[plan.branch])
      !== plan.evidenceSnapshot.rollover.tombstoneDigest) invalid("terminal rollover tombstone");
    requireSameActiveOwnedDirtEvidence(
      plan.evidenceSnapshot.dirt,
      captureActiveOwnedDirtEvidence({ repository }),
    );
    const pull = readPull();
    assertPullIdentity(pull, plan);
    const marker = parseWriterLeasePullRequestBody(pull.body);
    if (digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))
      || digestValue(writerLeaseBodyRemainder(pull.body))
        !== plan.evidenceSnapshot.pullRequest.bodyRemainderDigest) invalid("terminal pull-request marker");
    const privateInputs = inputs();
    const observedAdvance = controllerAdvance(privateInputs.continuationPlan);
    const plannedAdvance = plan.evidenceSnapshot.controller;
    requireProtectedMainEquivalent({
      planned: plannedAdvance.advance,
      observed: observedAdvance.advance,
      gitText: args => String(execFileSync("git", args, {
        cwd: controllerRoot,
        encoding: "utf8",
      })).trim(),
    });
    const verified = verifyCloud({
      authority: lease.cloudAuthority,
      manifest: lease.admission,
      canonicalBaseSha: lease.baseSha,
      environment,
    });
    const core = {
      planDigest: plan.planDigest,
      leaseDigest: writerLeaseDigest(lease),
      claimDigest: lease.cloudAuthority.claimDigest,
      markerDigest: digestValue(marker),
      tombstoneDigest: plan.evidenceSnapshot.rollover.tombstoneDigest,
      cloudVerificationReceiptDigest: verified.verification.receiptDigest,
      controllerAdvanceDigest: observedAdvance.evidenceDigest,
      dirtEvidenceDigest: plan.evidenceSnapshot.dirt.evidenceDigest,
    };
    return Object.freeze({
      claimDigest: core.claimDigest,
      leaseDigest: core.leaseDigest,
      markerDigest: core.markerDigest,
      verificationDigest: digestValue(core),
    });
  }

  function cloudStatus(lease) {
    const result = invoke({
      action: "status",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository },
      environment,
    });
    if (result?.ok !== true || result.action !== "status") invalid("cloud status");
    return result;
  }

  function requireSourceLease(plan) {
    const lease = sourceLease(plan);
    if (writerLeaseDigest(lease) !== plan.sourceLeaseDigest
      || lease.cloudAuthority.claimId !== plan.claimId) invalid("source lease fence");
    assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    return lease;
  }

  function requireSourceOrRecoveredLease(plan) {
    const lease = sourceLease(plan);
    classifyDormantOwnerContinuationLease({ lease, plan, now: now() });
    return lease;
  }

  function requireRecoveredLease(plan) {
    const lease = sourceLease(plan);
    if (!isRecoveredLease(lease, plan)) invalid("recovered lease state");
    return lease;
  }

  function isRecoveredLease(lease, plan) {
    try {
      return classifyDormantOwnerContinuationLease({ lease, plan, now: now() }) === "recovered";
    } catch {
      return false;
    }
  }

  function projectedLeaseResult(lease, registryRevision = store.readRegistry().revision) {
    return Object.freeze({
      leaseDigest: writerLeaseDigest(lease),
      registryRevision,
      taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
    });
  }

  function cloudProjectionFromLiveLease(lease, plan) {
    if (!isRecoveredLease(lease, plan)) invalid("live recovered cloud projection");
    recovered = lease.cloudAuthority;
    return Object.freeze({
      authority: recovered,
      claimDigest: recovered.claimDigest,
      expiresAt: recovered.expiresAt,
      receiptDigest: recovered.operationReceiptDigest,
    });
  }

  function assertPullIdentity(pull, plan) {
    const expected = plan.evidenceSnapshot.pullRequest;
    if (pull.id !== expected.id || pull.number !== expected.number || pull.url !== expected.url
      || pull.state !== "OPEN" || pull.isDraft !== true || pull.autoMergeRequest !== null
      || pull.headBranch !== plan.branch || pull.headSha !== plan.sourceFenceSha
      || pull.baseSha !== expected.baseSha) invalid("pull-request identity");
  }

  function assertRegistered(branch) {
    const records = git(["worktree", "list", "--porcelain", "-z"]).split("\0\0");
    const matches = records.filter(record => record.split("\0")
      .includes(`branch refs/heads/${branch}`));
    const location = matches[0]?.split("\0")
      .find(item => item.startsWith("worktree "))?.slice(9);
    if (matches.length !== 1 || realpathSync(location) !== repository) {
      invalid("registered worktree");
    }
  }

  return Object.freeze({
    captureEvidence,
    authorizeTaskAuthority,
    recoverCloudAuthority,
    projectLocalLease,
    projectPullRequestMarker,
    verifyCompletion,
  });
}

export function classifyDormantOwnerContinuationLease({ lease, plan, now = new Date() } = {}) {
  const sealed = normalizeDormantOwnerContinuationPlan(plan);
  if (writerLeaseDigest(lease) === sealed.sourceLeaseDigest
    && lease.cloudAuthority?.claimId === sealed.claimId
    && lease.cloudAuthority?.claimDigest === sealed.sourceClaimDigest
    && lease.cloudAuthority?.transitionCounter === sealed.sourceTransitionCounter) {
    return "source";
  }
  if (lease?.status === "active" && lease.branch === sealed.branch
    && lease.sessionId === sealed.sessionId && lease.baseSha === sealed.sourceBaseSha
    && lease.fenceSha === sealed.sourceFenceSha
    && lease.admission?.writeSetDigest === sealed.writeSetDigest
    && lease.admission?.manifestDigest === sealed.manifestDigest
    && lease.cloudAuthority?.claimId === sealed.claimId
    && lease.cloudAuthority?.transitionCounter === sealed.sourceTransitionCounter + 1
    && lease.cloudAuthority?.state === "active"
    && lease.cloudAuthority?.reviewRequestId === sealed.reviewRequestId
    && Date.parse(lease.expiresAt) > new Date(now).getTime()
    && lease.taskAuthority?.bindingMode === "continuation"
    && lease.taskAuthority?.priorBindingDigest
      === sealed.evidenceSnapshot.source.taskAuthorityBindingDigest) {
    return "recovered";
  }
  invalid("source or recovered lease state");
}

function required(value, label) {
  const result = String(value || "").trim(); if (!result) invalid(label); return result;
}
function positive(value, label) {
  const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) invalid(label); return result;
}
function invalid(label) { throw new Error(`Invalid dormant-owner continuation ${label}.`); }
