// Responsibility: Project only the current registry marker into one pr-projected reanchor PR.
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  captureActiveOwnedDirtEvidence,
  requireSameActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";
import {
  buildActiveOwnedDirtCurrentBasePrMarkerReplayEvidence,
  EVIDENCE_SCHEMA,
  normalizeActiveOwnedDirtCurrentBasePrMarkerReplayIntent,
  normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan,
} from "./active-owned-dirt-current-base-pr-marker-replay-contract.mjs";
import {
  normalizeReanchorIntent,
  normalizeReanchorPlan,
} from "./active-owned-dirt-current-base-reanchor-contract.mjs";
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import { createGitHubCooperativePullBodyProjectionPort }
  from "./github-cooperative-pull-body-projection.mjs";
import { writerLeaseBodyRemainder }
  from "./orphaned-task-authority-recovery-evidence.mjs";
import { withPrivateOperationLock } from "./private-operation-lock.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  withHeartbeatProjectionFence,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";

const PROVIDER_SEMANTICS = "github-cooperative-body-projection/v1";
const PULL_REQUEST_BODY_LIMIT = 65_536;
const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40,64}$/u;
const CLOUD_AUTHORITY_RECEIPT_KEYS = Object.freeze([
  "claimDigest",
  "ledgerRevision",
  "ledgerDigest",
  "claimLedgerRevision",
  "operationReceiptDigest",
  "transitionCounter",
  "expiresAt",
]);
const CLOUD_AUTHORITY_IMMUTABLE_KEYS = Object.freeze([
  "schema",
  "provider",
  "ledgerRepository",
  "targetRepository",
  "claimId",
  "entrySchema",
  "claimIdentitySchema",
  "mutationAuthorityEligible",
  "canonicalBaseSha",
  "laneRevision",
  "cloudDeclaredWriteScope",
  "writeSetDigest",
  "deviceId",
  "sessionId",
  "reviewRequestId",
  "leaseEpoch",
  "state",
  "integrationReceiptDigest",
  "integration",
  "manifestDigest",
]);
const ADMISSION_KEYS = Object.freeze([
  "schema",
  "status",
  "semanticScope",
  "declaredWriteSet",
  "writeSetDigest",
  "manifestDigest",
  "planReceiptDigest",
  "admissionReceiptDigest",
  "existingLaneStateDigest",
  "admittedReportDigest",
  "preservationReceiptDigest",
].sort());
const CURRENT_BASE_REANCHOR_KEYS = Object.freeze([
  "schema",
  "status",
  "planDigest",
  "sourceBaseSha",
  "sourceClaimId",
  "sourceFenceSha",
  "successorClaimId",
  "targetCanonicalBaseSha",
  "targetLaneRevision",
  "targetDirtEvidenceDigest",
  "taskContinuationReceiptDigest",
].sort());

export function createRepositoryActiveOwnedDirtCurrentBasePrMarkerReplayAdapter(
  options = {},
  dependencies = {},
) {
  const resolveRealpath = dependencies.realpath || realpathSync;
  const repository = resolveRealpath(path.resolve(required(options.repository, "repository")));
  const environment = dependencies.environment || process.env;
  const execute = dependencies.execute || ((command, argumentsList, executeOptions = {}) =>
    execFileSync(command, argumentsList, {
      cwd: executeOptions.cwd || repository,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: environment,
    }));
  const gitRaw = dependencies.gitRaw
    || (argumentsList => String(execute("git", argumentsList, { cwd: repository })));
  const git = dependencies.git || (argumentsList => gitRaw(argumentsList).trim());
  const now = dependencies.now || (() => new Date());
  const authorizeTaskMutation = dependencies.authorizeTaskMutation
    || authorizeTaskBoundLeaseMutation;
  const captureDirt = dependencies.captureDirt
    || (input => captureActiveOwnedDirtEvidence(input));
  const projectionFence = dependencies.withProjectionFence
    || withHeartbeatProjectionFence;
  const operationLock = dependencies.withOperationLock
    || withPrivateOperationLock;
  const branch = required(git(["branch", "--show-current"]), "attached branch");
  const commonDirectory = resolveRealpath(path.resolve(
    repository,
    required(git(["rev-parse", "--git-common-dir"]), "Git common directory"),
  ));
  const forbiddenArtifactRoots = externalArtifactForbiddenRoots({
    repository,
    commonDirectory,
    worktreeInventory: gitRaw(["worktree", "list", "--porcelain", "-z"]),
    resolveRealpath,
  });
  const reanchorPlanFile = privateExternalInput(
    options.reanchorPlanFile,
    forbiddenArtifactRoots,
    "reanchor plan",
    resolveRealpath,
  );
  const reanchorJournalFile = privateExternalInput(
    options.reanchorJournalFile,
    forbiddenArtifactRoots,
    "reanchor journal",
    resolveRealpath,
  );
  const taskAuthorityFile = options.taskAuthorityFile
    ? privateExternalInput(
      options.taskAuthorityFile,
      forbiddenArtifactRoots,
      "task-authority capability",
      resolveRealpath,
    ) : null;
  const recoveryJournalFile = externalOutputPath(
    options.recoveryJournalFile,
    forbiddenArtifactRoots,
    "recovery journal",
    resolveRealpath,
  );
  const operationPlanFile = options.planFile
    ? privateExternalInput(
      options.planFile,
      forbiddenArtifactRoots,
      "marker-replay plan",
      resolveRealpath,
    ) : null;
  const planOutputFile = options.output
    ? externalOutputPath(
      options.output,
      forbiddenArtifactRoots,
      "marker-replay plan output",
      resolveRealpath,
    ) : null;
  const artifactFiles = [
    reanchorPlanFile,
    reanchorJournalFile,
    taskAuthorityFile,
    recoveryJournalFile,
    operationPlanFile,
    planOutputFile,
  ].filter(Boolean);
  if (new Set(artifactFiles).size !== artifactFiles.length) {
    invalid("distinct external artifacts");
  }
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityPolicy: "projected",
  });
  const createPullBodyPort = dependencies.createPullBodyPort
    || createGitHubCooperativePullBodyProjectionPort;
  const pullBodyPort = dependencies.pullBodyPort || createPullBodyPort({
    repository,
    execute,
  });
  requirePullBodyPort(pullBodyPort);

  function assertRecoveryJournalBoundary() {
    const parent = path.dirname(recoveryJournalFile);
    if (resolveRealpath(parent) !== parent) {
      invalid("canonical recovery-journal parent");
    }
    const currentForbiddenRoots = externalArtifactForbiddenRoots({
      repository,
      commonDirectory,
      worktreeInventory: gitRaw(["worktree", "list", "--porcelain", "-z"]),
      resolveRealpath,
    });
    if (currentForbiddenRoots.some(root => inside(root, recoveryJournalFile))) {
      invalid("external recovery journal");
    }
    if (existsSync(recoveryJournalFile)) {
      if (resolveRealpath(recoveryJournalFile) !== recoveryJournalFile) {
        invalid("canonical recovery journal");
      }
      requirePrivateFile(recoveryJournalFile, "recovery journal");
    }
  }

  function assertPlanOutputBoundary() {
    if (!planOutputFile) invalid("configured marker-replay plan output");
    const parent = path.dirname(planOutputFile);
    if (resolveRealpath(parent) !== parent) {
      invalid("canonical marker-replay plan-output parent");
    }
    const currentForbiddenRoots = externalArtifactForbiddenRoots({
      repository,
      commonDirectory,
      worktreeInventory: gitRaw(["worktree", "list", "--porcelain", "-z"]),
      resolveRealpath,
    });
    if (currentForbiddenRoots.some(root => inside(root, planOutputFile))) {
      invalid("external marker-replay plan output");
    }
  }

  function readReanchor() {
    requirePrivateFile(reanchorPlanFile, "reanchor plan");
    requirePrivateFile(reanchorJournalFile, "reanchor journal");
    const plan = normalizeReanchorPlan(parseJson(
      readFileSync(reanchorPlanFile, "utf8"),
      "reanchor plan",
    ));
    const intent = normalizeReanchorIntent(parseJson(
      readFileSync(reanchorJournalFile, "utf8"),
      "reanchor journal",
    ));
    const projected = intent.receipts?.["pr-projected"]?.values;
    if (intent.phase !== "pr-projected" || intent.completion !== null
      || intent.planDigest !== plan.planDigest
      || intent.planSnapshot.planDigest !== plan.planDigest
      || projected?.kind !== "pr-projected"
      || projected.pullRequestId !== plan.pullRequestId
      || projected.headSha !== plan.targetLaneRevision
      || projected.baseSha !== plan.targetCanonicalBaseSha
      || projected.bodyRemainderDigest !== plan.pullRequestBodyRemainderDigest
      || projected.markerDigest === undefined) {
      invalid("exact pr-projected reanchor journal");
    }
    digest(projected.markerDigest, "journaled marker digest");
    return Object.freeze({ plan, intent, projected });
  }

  function readTargetLease(source) {
    const lease = leaseStore.read(branch);
    const successor = source.intent.receipts?.["successor-current"]?.values;
    const successorAuthority = source.intent.receipts?.["successor-bound"]?.values
      ?.authority;
    const localCas = source.intent.receipts?.["local-cas"]?.values;
    if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
      || lease.branch !== source.plan.branch || lease.branch !== branch
      || lease.sessionId !== source.plan.sessionId || lease.device !== source.plan.device
      || lease.scope !== source.plan.scope
      || path.resolve(lease.worktreePath || "") !== repository
      || lease.baseSha !== source.plan.targetCanonicalBaseSha
      || lease.fenceSha !== source.plan.targetLaneRevision
      || lease.pullRequestUrl !== source.plan.pullRequestUrl
      || lease.admission?.status !== "admitted"
      || lease.admission.manifestDigest !== source.plan.targetManifestDigest
      || lease.admission.writeSetDigest !== source.plan.targetWriteSetDigest
      || canonicalJson(lease.admission.declaredWriteSet)
        !== canonicalJson(source.plan.targetDeclaredWriteSet)
      || lease.admission.planReceiptDigest !== source.plan.planDigest
      || lease.cloudAuthority?.schema !== "agentic-lane-cloud-authority/v1"
      || !exactSuccessorAuthority({
        current: lease.cloudAuthority,
        sealed: successorAuthority,
      })
      || lease.cloudAuthority.state !== "active"
      || lease.cloudAuthority.claimId !== successor?.claimId
      || lease.cloudAuthority.canonicalBaseSha !== source.plan.targetCanonicalBaseSha
      || lease.cloudAuthority.laneRevision !== source.plan.targetLaneRevision
      || lease.cloudAuthority.leaseEpoch !== source.plan.targetCloudLeaseEpoch
      || lease.cloudAuthority.reviewRequestId
        !== source.plan.evidence.sourceClaim.reviewRequestId
      || lease.cloudAuthority.writeSetDigest !== source.plan.targetWriteSetDigest
      || lease.cloudAuthority.manifestDigest !== source.plan.targetManifestDigest
      || lease.cloudAuthority.deviceId !== source.plan.device
      || lease.cloudAuthority.sessionId !== source.plan.sessionId
      || !Number.isSafeInteger(lease.cloudAuthority.transitionCounter)
      || lease.cloudAuthority.transitionCounter < successor.transitionCounter
      || !Number.isFinite(Date.parse(lease.cloudAuthority.expiresAt))
      || lease.cloudAuthority.expiresAt !== lease.expiresAt
      || lease.taskAuthority?.bindingDigest !== localCas?.taskBindingDigest
      || lease.taskAuthority?.priorBindingDigest !== source.plan.sourceTaskBindingDigest
      || !exactTargetAdmission({ lease, source })
      || !exactPreservedMarkerLineage({ lease, source })
      || canonicalJson(Object.keys(
        lease.activeOwnedDirtCurrentBaseReanchor || {},
      ).sort()) !== canonicalJson(CURRENT_BASE_REANCHOR_KEYS)
      || lease.activeOwnedDirtCurrentBaseReanchor?.schema
        !== "agentic-active-owned-dirt-current-base-reanchor-lease/v1"
      || lease.activeOwnedDirtCurrentBaseReanchor?.status !== "reanchored"
      || lease.activeOwnedDirtCurrentBaseReanchor?.planDigest !== source.plan.planDigest
      || lease.activeOwnedDirtCurrentBaseReanchor?.sourceBaseSha
        !== source.plan.sourceBaseSha
      || lease.activeOwnedDirtCurrentBaseReanchor?.sourceClaimId
        !== source.plan.sourceClaimId
      || lease.activeOwnedDirtCurrentBaseReanchor?.sourceFenceSha
        !== source.plan.sourceFenceSha
      || lease.activeOwnedDirtCurrentBaseReanchor?.successorClaimId
        !== successor.claimId
      || lease.activeOwnedDirtCurrentBaseReanchor?.targetCanonicalBaseSha
        !== source.plan.targetCanonicalBaseSha
      || lease.activeOwnedDirtCurrentBaseReanchor?.targetLaneRevision
        !== source.plan.targetLaneRevision
      || lease.activeOwnedDirtCurrentBaseReanchor?.targetDirtEvidenceDigest
        !== source.plan.targetDirtEvidenceDigest
      || lease.activeOwnedDirtCurrentBaseReanchor?.taskContinuationReceiptDigest
        !== localCas.taskContinuationReceiptDigest) {
      invalid("current target reanchor lease");
    }
    return lease;
  }

  function readPull(source, lease) {
    const snapshot = pullBodyPort.readConditionalPull({
      targetRepository: lease.cloudAuthority.targetRepository,
      pullRequestNumber: source.plan.pullRequestNumber,
    });
    if (snapshot.id !== source.plan.pullRequestId
      || snapshot.number !== source.plan.pullRequestNumber
      || snapshot.url !== source.plan.pullRequestUrl
      || snapshot.state !== "OPEN" || snapshot.isDraft !== true
      || snapshot.headBranch !== branch
      || snapshot.headSha !== source.plan.targetLaneRevision
      || snapshot.headRepository !== lease.cloudAuthority.targetRepository
      || snapshot.baseBranch !== "main"
      || snapshot.baseSha !== source.plan.targetCanonicalBaseSha
      || typeof snapshot.body !== "string") {
      invalid("exact open draft target pull request");
    }
    if (Buffer.byteLength(snapshot.body, "utf8") > PULL_REQUEST_BODY_LIMIT) {
      invalid("pull-request body limit");
    }
    return snapshot;
  }

  function readFrame(sealedPlan = null, { requireFresh = true } = {}) {
    const replayPlan = sealedPlan
      ? normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan(sealedPlan) : null;
    const source = readReanchor();
    const lease = readTargetLease(source);
    const leaseDigest = writerLeaseDigest(lease);
    const registered = assertRegisteredWorktree({
      cwd: repository,
      porcelain: gitRaw(["worktree", "list", "--porcelain", "-z"]),
    });
    const headSha = sha(git(["rev-parse", "HEAD"]), "local HEAD");
    const localBranchSha = sha(
      git(["rev-parse", `refs/heads/${branch}`]),
      "local branch head",
    );
    const remoteHeadSha = readRemoteHead(git, branch);
    if (registered.branch !== `refs/heads/${branch}` || registered.head !== headSha
      || headSha !== source.plan.targetLaneRevision || localBranchSha !== headSha
      || remoteHeadSha !== headSha) {
      invalid("unchanged local and remote target head");
    }
    const dirt = requireSameActiveOwnedDirtEvidence(
      source.plan.evidence.reanchor.targetDirt,
      captureDirt({ repository }),
    );
    const pull = readPull(source, lease);
    const marker = parseWriterLeasePullRequestBody(pull.body);
    if (!marker) invalid("pull-request writer marker");
    const markerDigest = digestValue(marker);
    const bodyDigest = digestValue(pull.body);
    const bodyRemainderDigest = digestValue(writerLeaseBodyRemainder(pull.body));
    if (bodyRemainderDigest !== source.plan.pullRequestBodyRemainderDigest) {
      invalid("preserved pull-request body remainder");
    }
    const targetMarker = projectWriterLeasePullRequestMarker(lease);
    const targetMarkerDigest = digestValue(targetMarker);
    const targetBody = updateWriterLeasePullRequestBody(pull.body, lease);
    const targetBodyDigest = digestValue(targetBody);
    if (canonicalJson(parseWriterLeasePullRequestBody(targetBody))
        !== canonicalJson(targetMarker)
      || digestValue(writerLeaseBodyRemainder(targetBody)) !== bodyRemainderDigest
      || Buffer.byteLength(targetBody, "utf8") > PULL_REQUEST_BODY_LIMIT) {
      invalid("marker-only target body");
    }
    let providerState;
    if (markerDigest === targetMarkerDigest && bodyDigest === targetBodyDigest) {
      providerState = "target";
    } else if (markerDigest === source.projected.markerDigest) {
      providerState = "journaled";
    } else {
      invalid("exact journaled or target marker");
    }

    if (!replayPlan && providerState === "target") {
      invalid("marker replay is already complete");
    }

    const observedAt = now().toISOString();
    const evidence = buildActiveOwnedDirtCurrentBasePrMarkerReplayEvidence({
      schema: EVIDENCE_SCHEMA,
      observedAt,
      repositoryPathDigest: digestValue(repository),
      reanchorPlanDigest: source.plan.planDigest,
      reanchorIntentDigest: source.intent.intentDigest,
      reanchorPrProjectedReceiptDigest:
        source.intent.receipts["pr-projected"].receiptDigest,
      reanchorJournalPhase: source.intent.phase,
      branch,
      sessionId: lease.sessionId,
      device: lease.device,
      scope: lease.scope,
      pullRequestId: pull.id,
      pullRequestUrl: pull.url,
      pullRequestNumber: pull.number,
      targetRepository: lease.cloudAuthority.targetRepository,
      headSha,
      baseSha: pull.baseSha,
      bodyRemainderDigest,
      sourceBodyDigest: replayPlan?.sourceBodyDigest ?? bodyDigest,
      sourceMarkerDigest: replayPlan?.sourceMarkerDigest ?? markerDigest,
      sourceMarkerDisposition:
        replayPlan?.sourceMarkerDisposition ?? providerState,
      targetBodyDigest,
      targetMarkerDigest,
      targetLeaseDigest: leaseDigest,
      targetClaimId: lease.cloudAuthority.claimId,
      targetClaimDigest: lease.cloudAuthority.claimDigest,
      targetTransitionCounter: lease.cloudAuthority.transitionCounter,
      targetLeaseEpoch: lease.cloudAuthority.leaseEpoch,
      targetLeaseExpiresAt: lease.expiresAt,
      targetTaskBindingDigest: lease.taskAuthority.bindingDigest,
      targetManifestDigest: lease.admission.manifestDigest,
      targetWriteSetDigest: lease.admission.writeSetDigest,
      dirtEvidenceDigest: dirt.evidenceDigest,
      dirtyPathCount: dirt.pathCount,
      providerSemantics: PROVIDER_SEMANTICS,
      mutationBoundary: mutationBoundary(),
    });

    if (replayPlan) {
      if (requireFresh && Date.parse(observedAt) >= Date.parse(replayPlan.planExpiresAt)) {
        invalid("unexpired replay plan");
      }
      assertPlanFrame({ plan: replayPlan, evidence, providerState, bodyDigest, markerDigest });
    }
    return Object.freeze({
      source,
      lease,
      leaseDigest,
      dirt,
      pull,
      marker,
      markerDigest,
      bodyDigest,
      bodyRemainderDigest,
      targetMarker,
      targetMarkerDigest,
      targetBody,
      targetBodyDigest,
      providerState,
      evidence,
    });
  }

  return Object.freeze({
    writePlanFile(plan) {
      assertPlanOutputBoundary();
      const sealed = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan(plan);
      writePrivateJsonCreate(planOutputFile, sealed);
      return planOutputFile;
    },
    readPlanEvidence() {
      return readFrame().evidence;
    },
    withOperationLock(action) {
      if (typeof action !== "function") invalid("operation lock action");
      assertRecoveryJournalBoundary();
      return operationLock({
        file: `${recoveryJournalFile}.lock`,
        context: {
          operation: "active-owned-dirt-current-base-pr-marker-replay",
          repositoryPathDigest: digestValue(repository),
          branch,
          recoveryJournalPathDigest: digestValue(recoveryJournalFile),
        },
        now,
        action,
      });
    },
    readIntent() {
      assertRecoveryJournalBoundary();
      if (!existsSync(recoveryJournalFile)) return null;
      requirePrivateFile(recoveryJournalFile, "recovery journal");
      return normalizeActiveOwnedDirtCurrentBasePrMarkerReplayIntent(parseJson(
        readFileSync(recoveryJournalFile, "utf8"),
        "recovery journal",
      ));
    },
    writeIntent({ expected, value }) {
      assertRecoveryJournalBoundary();
      const current = existsSync(recoveryJournalFile)
        ? normalizeActiveOwnedDirtCurrentBasePrMarkerReplayIntent(parseJson(
          readFileSync(recoveryJournalFile, "utf8"),
          "recovery journal",
        )) : null;
      const expectedIntent = expected
        ? normalizeActiveOwnedDirtCurrentBasePrMarkerReplayIntent(expected) : null;
      if (canonicalJson(current) !== canonicalJson(expectedIntent)) {
        invalid("recovery journal compare-and-swap");
      }
      const normalized = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayIntent(value);
      assertRecoveryJournalBoundary();
      writePrivateJson(recoveryJournalFile, normalized);
      return normalized;
    },
    authorizeTask(plan) {
      const sealed = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan(plan);
      const frame = readFrame(sealed);
      if (!taskAuthorityFile) {
        throw new Error("Marker replay run requires --task-authority.");
      }
      const receipt = authorizeTaskMutation({
        lease: frame.lease,
        capabilityPath: taskAuthorityFile,
        operation: sealed.taskAuthorityOperation,
        now: now(),
      });
      return Object.freeze({
        taskAuthorityReceiptDigest: receipt.receiptDigest,
        bindingDigest: frame.lease.taskAuthority.bindingDigest,
      });
    },
    revalidate(plan, stage) {
      const sealed = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan(plan);
      const frame = readFrame(sealed, { requireFresh: stage !== "after-provider-error" });
      const projectionDigest = finalProjectionDigest(sealed, frame);
      if (stage === "after-provider-error") {
        if (frame.providerState !== "target") invalid("provider response-loss projection");
        return Object.freeze({
          disposition: "adopted-response-loss",
          providerMutation: false,
          providerProjected: true,
          projectionDigest,
        });
      }
      if (!["before-authority", "before-provider"].includes(stage)) {
        invalid("revalidation stage");
      }
      return Object.freeze({
        revalidationDigest: digestValue({
          schema: "agentic-active-owned-dirt-current-base-pr-marker-revalidation/v1",
          planDigest: sealed.planDigest,
          reanchorIntentDigest: frame.source.intent.intentDigest,
          targetLeaseDigest: frame.leaseDigest,
          dirtEvidenceDigest: frame.dirt.evidenceDigest,
          pullRequestId: frame.pull.id,
          headSha: frame.pull.headSha,
          baseSha: frame.pull.baseSha,
          bodyRemainderDigest: frame.bodyRemainderDigest,
          providerState: frame.providerState,
        }),
        providerState: frame.providerState,
      });
    },
    projectProviderBody(plan) {
      const sealed = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan(plan);
      const before = readFrame(sealed);
      if (before.providerState === "target") {
        return Object.freeze({
          disposition: "already-current",
          providerMutation: false,
          projectionDigest: finalProjectionDigest(sealed, before),
        });
      }
      let portReceipt = null;
      projectionFence({
        leaseStore,
        branch,
        expectedLeaseDigest: before.leaseDigest,
        expectedClaimId: before.lease.cloudAuthority.claimId,
        action: () => {
          const stable = readFrame(sealed);
          if (stable.providerState === "target") return;
          const conditional = pullBodyPort.readConditionalPull({
            targetRepository: stable.lease.cloudAuthority.targetRepository,
            pullRequestNumber: stable.source.plan.pullRequestNumber,
          });
          assertConditionalSnapshot(stable, conditional);
          portReceipt = pullBodyPort.patchConditionalPull({
            targetRepository: stable.lease.cloudAuthority.targetRepository,
            pullRequestNumber: stable.source.plan.pullRequestNumber,
            expectedEtag: conditional.etag,
            body: stable.targetBody,
          });
          if (portReceipt?.providerAtomicCompareAndSwap !== false
            || portReceipt?.cooperativeWriterFenceRequired !== true
            || portReceipt?.bodyDigest !== sealed.targetBodyDigest) {
            invalid("cooperative provider projection receipt");
          }
          const unchangedLease = leaseStore.read(branch);
          if (writerLeaseDigest(unchangedLease) !== before.leaseDigest) {
            invalid("unchanged writer registry during provider projection");
          }
        },
      });
      const after = readFrame(sealed);
      if (after.providerState !== "target") invalid("target provider projection");
      return Object.freeze({
        disposition: portReceipt ? "projected" : "already-current",
        providerMutation: Boolean(portReceipt),
        projectionDigest: finalProjectionDigest(sealed, after),
      });
    },
    verifyTerminal(plan, { replay = false } = {}) {
      const sealed = normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan(plan);
      const frame = readFrame(sealed, { requireFresh: !replay });
      if (frame.providerState !== "target") invalid("terminal target marker");
      return Object.freeze({
        verificationDigest: digestValue({
          schema: "agentic-active-owned-dirt-current-base-pr-marker-verification/v1",
          planDigest: sealed.planDigest,
          reanchorPlanDigest: frame.source.plan.planDigest,
          reanchorIntentDigest: frame.source.intent.intentDigest,
          targetLeaseDigest: frame.leaseDigest,
          targetClaimId: frame.lease.cloudAuthority.claimId,
          targetTaskBindingDigest: frame.lease.taskAuthority.bindingDigest,
          dirtEvidenceDigest: frame.dirt.evidenceDigest,
          pullRequestId: frame.pull.id,
          headSha: frame.pull.headSha,
          baseSha: frame.pull.baseSha,
          bodyRemainderDigest: frame.bodyRemainderDigest,
          targetBodyDigest: frame.targetBodyDigest,
          targetMarkerDigest: frame.targetMarkerDigest,
          providerProjectionDigest: finalProjectionDigest(sealed, frame),
          terminalStatus: "projection-restored",
        }),
      });
    },
  });
}

export const createRepositoryAdapter =
  createRepositoryActiveOwnedDirtCurrentBasePrMarkerReplayAdapter;

function assertPlanFrame({ plan, evidence, providerState, bodyDigest, markerDigest }) {
  const expected = plan.evidence;
  const stableKeys = [
    "repositoryPathDigest", "reanchorPlanDigest", "reanchorIntentDigest",
    "reanchorPrProjectedReceiptDigest", "reanchorJournalPhase", "branch", "sessionId",
    "device", "scope", "pullRequestId", "pullRequestUrl", "pullRequestNumber",
    "targetRepository", "headSha", "baseSha", "bodyRemainderDigest",
    "targetBodyDigest", "targetMarkerDigest", "targetLeaseDigest", "targetClaimId",
    "targetClaimDigest", "targetTransitionCounter", "targetLeaseEpoch",
    "targetLeaseExpiresAt", "targetTaskBindingDigest", "targetManifestDigest",
    "targetWriteSetDigest", "dirtEvidenceDigest", "dirtyPathCount", "providerSemantics",
  ];
  for (const key of stableKeys) {
    if (canonicalJson(evidence[key]) !== canonicalJson(expected[key])) {
      invalid(`plan-bound ${key}`);
    }
  }
  if (canonicalJson(evidence.mutationBoundary) !== canonicalJson(expected.mutationBoundary)) {
    invalid("plan-bound mutation boundary");
  }
  if (providerState === "target") {
    if (bodyDigest !== plan.targetBodyDigest || markerDigest !== plan.targetMarkerDigest) {
      invalid("plan-bound target body");
    }
  } else if (bodyDigest !== plan.sourceBodyDigest
    || markerDigest !== plan.sourceMarkerDigest
    || providerState !== plan.sourceMarkerDisposition) {
    invalid("plan-bound source body");
  }
}

function exactSuccessorAuthority({ current, sealed }) {
  if (!current || !sealed) return false;
  const expectedKeys = [
    ...CLOUD_AUTHORITY_IMMUTABLE_KEYS,
    ...CLOUD_AUTHORITY_RECEIPT_KEYS,
  ].sort();
  if (canonicalJson(Object.keys(current).sort()) !== canonicalJson(expectedKeys)
    || canonicalJson(Object.keys(sealed).sort()) !== canonicalJson(expectedKeys)) {
    return false;
  }
  for (const key of CLOUD_AUTHORITY_IMMUTABLE_KEYS) {
    if (canonicalJson(current[key]) !== canonicalJson(sealed[key])) return false;
  }
  for (const key of [
    "claimDigest", "ledgerDigest", "claimLedgerRevision", "operationReceiptDigest",
  ]) {
    if (!DIGEST.test(String(current[key] || ""))) return false;
  }
  return SHA.test(String(current.ledgerRevision || ""))
    && Number.isSafeInteger(current.transitionCounter)
    && current.transitionCounter >= sealed.transitionCounter
    && Number.isFinite(Date.parse(current.expiresAt))
    && Date.parse(current.expiresAt) >= Date.parse(sealed.expiresAt);
}

function exactTargetAdmission({ lease, source }) {
  const admission = lease.admission;
  const original = source.plan.evidence.lease.admission;
  if (canonicalJson(Object.keys(admission || {}).sort()) !== canonicalJson(ADMISSION_KEYS)
    || admission.schema !== "agentic-lane-admission-lease/v1"
    || admission.status !== "admitted"
    || admission.semanticScope !== source.plan.scope
    || admission.existingLaneStateDigest !== original.existingLaneStateDigest) {
    return false;
  }
  return [
    "admissionReceiptDigest",
    "existingLaneStateDigest",
    "admittedReportDigest",
    "preservationReceiptDigest",
  ].every(key => DIGEST.test(String(admission[key] || "")));
}

function exactPreservedMarkerLineage({ lease, source }) {
  const original = source.plan.evidence.lease;
  for (const key of [
    "autoDelivery",
    "runtimeRequired",
    "reviewHeadSha",
    "deliveryHeadSha",
    "completion",
    "ownedDirtRecovery",
    "activeOwnedDirtRecovery",
    "expiredCommittedHeartbeatRecovery",
    "pullRequestProjectionRepair",
    "preClaimIntegrationContinuation",
    "integration",
    "parkHeadSha",
    "parkBranchHeadSha",
    "parkSourceEpoch",
    "parkSourceFenceSha",
    "parkStashRef",
    "parkStashSha",
    "parkStashMessage",
    "parkStashStatus",
  ]) {
    if (canonicalJson(lease[key] ?? null) !== canonicalJson(original[key] ?? null)) {
      return false;
    }
  }
  return true;
}

function assertConditionalSnapshot(frame, snapshot) {
  if (snapshot.id !== frame.pull.id || snapshot.number !== frame.pull.number
    || snapshot.url !== frame.pull.url || snapshot.state !== "OPEN"
    || snapshot.isDraft !== true || snapshot.headBranch !== frame.pull.headBranch
    || snapshot.headSha !== frame.pull.headSha
    || snapshot.headRepository !== frame.pull.headRepository
    || snapshot.baseBranch !== frame.pull.baseBranch
    || snapshot.baseSha !== frame.pull.baseSha
    || snapshot.body !== frame.pull.body) {
    invalid("stable cooperative provider frame");
  }
}

function finalProjectionDigest(plan, frame) {
  return digestValue({
    schema: "agentic-active-owned-dirt-current-base-pr-marker-projection/v1",
    planDigest: plan.planDigest,
    reanchorIntentDigest: frame.source.intent.intentDigest,
    targetLeaseDigest: frame.leaseDigest,
    targetClaimId: frame.lease.cloudAuthority.claimId,
    pullRequestId: frame.pull.id,
    pullRequestNumber: frame.pull.number,
    headSha: frame.pull.headSha,
    baseSha: frame.pull.baseSha,
    bodyRemainderDigest: frame.bodyRemainderDigest,
    targetBodyDigest: plan.targetBodyDigest,
    targetMarkerDigest: plan.targetMarkerDigest,
    providerSemantics: PROVIDER_SEMANTICS,
  });
}

function mutationBoundary() {
  return Object.freeze({
    pullRequestWriterMarker: true,
    externalPrivateRecoveryJournal: true,
    cloud: false,
    writerRegistry: false,
    git: false,
    remoteRef: false,
    source: false,
    pullRequestSubject: false,
    pullRequestDraft: false,
    pullRequestAutoMerge: false,
    authoringAuthority: false,
    integrationAuthority: false,
    release: false,
    deployment: false,
    cleanup: false,
  });
}

function writePrivateJson(file, value) {
  const parent = path.dirname(file);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, file);
    const directory = openSync(parent, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
  requirePrivateFile(file, "recovery journal");
}

function writePrivateJsonCreate(file, value) {
  const parent = path.dirname(file);
  if (realpathSync(parent) !== parent || existsSync(file)) {
    invalid("fresh canonical marker-replay plan output");
  }
  const descriptor = openSync(file, "wx", 0o600);
  try {
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    try { unlinkSync(file); } catch {}
    throw error;
  }
  const directory = openSync(parent, "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
  requirePrivateFile(file, "marker-replay plan output");
}

function privateExternalInput(candidate, forbiddenRoots, label, resolveRealpath) {
  const file = resolveRealpath(path.resolve(required(candidate, label)));
  if (forbiddenRoots.some(root => inside(root, file))) invalid(`external ${label}`);
  requirePrivateFile(file, label);
  return file;
}

function externalOutputPath(candidate, forbiddenRoots, label, resolveRealpath) {
  const requested = path.resolve(required(candidate, label));
  const parent = resolveRealpath(path.dirname(requested));
  const file = path.join(parent, path.basename(requested));
  if (forbiddenRoots.some(root => inside(root, file))) invalid(`external ${label}`);
  if (existsSync(file)) {
    const resolved = resolveRealpath(file);
    if (resolved !== file) invalid(label);
    requirePrivateFile(file, label);
  }
  return file;
}

function externalArtifactForbiddenRoots({
  repository,
  commonDirectory,
  worktreeInventory,
  resolveRealpath,
}) {
  const roots = [repository, commonDirectory];
  for (const record of parseWorktreeRecords(worktreeInventory)) {
    roots.push(resolveRealpath(path.resolve(record.path)));
  }
  return Object.freeze([...new Set(roots)]);
}

function parseWorktreeRecords(raw) {
  const records = [];
  let current = null;
  for (const field of String(raw).split("\0")) {
    if (!field) continue;
    if (field.startsWith("worktree ")) {
      if (current) records.push(current);
      current = { path: required(field.slice("worktree ".length), "worktree path") };
    }
  }
  if (current) records.push(current);
  if (records.length === 0) invalid("registered worktree inventory");
  return records;
}

function requirePrivateFile(file, label) {
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o600
    || realpathSync(file) !== file
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    invalid(`owner-private ${label}`);
  }
}

function requirePullBodyPort(port) {
  if (typeof port?.readConditionalPull !== "function"
    || typeof port?.patchConditionalPull !== "function") {
    invalid("cooperative pull-body port");
  }
}

function readRemoteHead(git, branch) {
  const output = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  const values = String(output).trim().split(/\s+/u);
  if (values.length !== 2 || values[1] !== `refs/heads/${branch}`) {
    invalid("remote branch cardinality");
  }
  return sha(values[0], "remote head");
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}
function parseJson(value, label) {
  try { return JSON.parse(String(value)); } catch { invalid(label); }
}
function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0")) {
    invalid(label);
  }
  return value;
}
function sha(value, label) {
  if (!SHA.test(String(value || ""))) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(
    `Active-owned-dirt current-base PR-marker replay repository adapter has invalid ${label}.`,
  );
}
