// Responsibility: Join and project one already-reviewed cloud transition without another cloud write.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  digestValue,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { validateLedger } from "./cloud-collaboration-contract.mjs";
import {
  buildExpiredActiveDeviceReviewResponseLossEvidence,
} from "./expired-active-device-review-response-loss-evidence.mjs";
import {
  buildExpiredActiveDeviceReviewResponseLossReviewedTransitionAdoption,
  normalizeExpiredActiveDeviceReviewResponseLossIntent,
  normalizeExpiredActiveDeviceReviewResponseLossPlan,
} from "./expired-active-device-review-response-loss-contract.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { invokeRepositoryCloudAction }
  from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority }
  from "./scoped-lane-cloud-reconciliation.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  mutateWriterLeaseRegistry,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";

const JOURNAL_SCHEMA = "agentic-expired-active-device-review-response-loss-journal/v1";
const TERMINAL_EVIDENCE_SCHEMA =
  "agentic-expired-active-device-review-response-loss-terminal-evidence/v1";
const LOCK_SCHEMA = "agentic-expired-active-device-review-response-loss-lock/v1";
const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
const MAX_LOCK_BYTES = 4096;
const BRANCH_CONTROLLER_FENCE_FIELDS = Object.freeze([
  "scopeExpansionIntents",
  "activeOwnedDirtRecoveryIntents",
  "expiredCommittedScopeExpansionIntents",
  "reviewedLaneRevisionIntents",
  "reviewedLaneEntrypointFences",
]);

export function createRepositoryExpiredActiveDeviceReviewResponseLossAdapter(
  options = {},
  dependencies = {},
) {
  const resolveRealpath = dependencies.realpath || realpathSync;
  const repository = resolveRealpath(path.resolve(required(options.repository, "repository")));
  const pullRequestNumber = positiveInteger(
    options.pullRequestNumber,
    "pull-request number",
  );
  const execute = dependencies.execute || ((command, argumentsList) => execFileSync(
    command,
    argumentsList,
    {
      cwd: repository,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  ));
  const git = dependencies.git
    || (argumentsList => String(execute("git", argumentsList)).trim());
  const gh = dependencies.gh
    || (argumentsList => String(execute("gh", argumentsList)).trim());
  const now = dependencies.now || (() => new Date());
  const cloudAction = dependencies.cloudAction || invokeRepositoryCloudAction;
  const authorizeTaskMutation = dependencies.authorizeTaskMutation
    || authorizeTaskBoundLeaseMutation;
  const uuid = dependencies.randomUUID || randomUUID;
  const isProcessAlive = dependencies.isProcessAlive || processIsAlive;
  const branch = required(git(["branch", "--show-current"]), "attached branch");
  const commonDirectory = resolveRealpath(path.resolve(
    repository,
    required(git(["rev-parse", "--git-common-dir"]), "Git common directory"),
  ));
  const taskAuthorityFile = options.taskAuthorityFile
    ? resolveRealpath(path.resolve(options.taskAuthorityFile))
    : null;
  if (taskAuthorityFile && (inside(repository, taskAuthorityFile)
    || inside(commonDirectory, taskAuthorityFile))) {
    throw new Error(
      "Expired device-review task authority must remain outside the repository and Git directory.",
    );
  }
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityPolicy: "projected",
  });
  const operationId = digestValue({ repository, branch, pullRequestNumber });
  const defaultJournalDirectory = path.join(
    commonDirectory,
    "agentic-canvas-os",
    "expired-active-device-review-response-loss",
  );
  const journalPath = path.resolve(dependencies.journalPath
    || path.join(defaultJournalDirectory, `${operationId}.json`));
  const journalDirectory = path.dirname(journalPath);
  if (journalDirectory === commonDirectory || !inside(commonDirectory, journalDirectory)) {
    throw new Error(
      "Expired device-review journal must remain below the real Git common directory.",
    );
  }
  const lockPath = `${journalPath}.lock`;

  const readLedgerSnapshot = dependencies.readLedgerSnapshot || (({
    ledgerRepository,
    revision,
  }) => parseJson(gh([
    "api", "--method", "GET",
    `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`,
    "-f", `ref=${revision}`,
    "-H", "Accept: application/vnd.github.raw+json",
  ]), "collaboration ledger"));
  const historicalLedgerCache = new Map();

  function readPlanEvidence() {
    const observedAt = canonicalInstant(now(), "plan observation");
    const registry = readRegistry();
    const sourceLease = requireSourceLease(registry.leases?.[branch], observedAt);
    const review = readReview();
    const worktree = readWorktree(review.headRepository);
    const cloud = readReviewedCloud(sourceLease, review);
    const sourceMarkerValue = requireSourceMarker(sourceLease, review);
    const targetLease = Object.freeze({
      ...sourceLease,
      status: "review_ready",
      reviewHeadSha: sourceLease.fenceSha,
      cloudAuthority: cloud.targetAuthority,
    });
    const targetMarker = projectWriterLeasePullRequestMarker(targetLease);
    const targetBody = updateWriterLeasePullRequestBody(review.body, targetLease);
    const targetProviderState = providerState(review, { isDraft: false });
    return buildExpiredActiveDeviceReviewResponseLossEvidence({
      observedAt,
      repository: {
        path: repository,
        nameWithOwner: review.headRepository,
      },
      worktree,
      sourceLease,
      sourceLeaseDigest: writerLeaseDigest(sourceLease),
      migration: {
        planDigest: sourceLease.taskAuthority.transitionPlanDigest,
        targetBindingDigest: sourceLease.taskAuthority.bindingDigest,
        taskAuthorityCapabilitySubject: sourceLease.taskAuthority.authoritySubjectId,
        bindingMode: sourceLease.taskAuthority.bindingMode,
        boundAt: sourceLease.taskAuthority.boundAt,
      },
      sourceMarker: {
        marker: sourceMarkerValue,
        markerDigest: digestValue(sourceMarkerValue),
        projectedWithoutTaskAuthorityDigest: digestValue(sourceMarkerValue),
        taskAuthorityAbsent: true,
      },
      cloud: {
        status: cloud.status,
        claim: cloud.claim,
        sourceEntry: cloud.sourceEntry,
        reviewedEntry: cloud.reviewedEntry,
        targetAuthority: cloud.targetAuthority,
        targetAuthorityDigest: digestValue(cloud.targetAuthority),
        ledgerValidation: cloud.ledgerValidation,
        ledgerValidationDigest: digestValue(cloud.ledgerValidation),
        laterTargetTransitionCount: 0,
        noOverlappingCompetitor: true,
        competitorCount: 0,
      },
      pullRequest: {
        ...providerState(review, { isDraft: true }),
        sourceBody: review.body,
        sourceBodyDigest: digestValue(review.body),
        sourceMarkerDigest: digestValue(sourceMarkerValue),
      },
      projections: {
        targetLease,
        targetLeaseDigest: writerLeaseDigest(targetLease),
        targetMarker,
        targetMarkerDigest: digestValue(targetMarker),
        targetBody,
        targetBodyDigest: digestValue(targetBody),
        targetProviderState,
        targetProviderStateDigest: digestValue(targetProviderState),
        targetRegistryRevision: nextRevision(registry.revision),
      },
    });
  }

  function authorizeTask(planValue) {
    const plan = normalizeExpiredActiveDeviceReviewResponseLossPlan(planValue);
    assertRuntimeSubject(plan);
    if (!taskAuthorityFile) {
      throw new Error("Expired device-review recovery requires its external task capability.");
    }
    const frame = captureProgress(plan);
    requireStage(frame, { local: "source", marker: "source", ready: "draft" });
    const receipt = authorizeTaskMutation({
      lease: frame.lease,
      capabilityPath: taskAuthorityFile,
      operation: plan.taskAuthorityOperation,
      now: now(),
    });
    if (receipt.bindingDigest !== plan.evidence.migration.targetBindingDigest) {
      throw new Error("Expired device-review task proof changed its migrated binding.");
    }
    return Object.freeze({
      taskAuthorityReceiptDigest: receipt.receiptDigest,
      bindingDigest: receipt.bindingDigest,
    });
  }

  function revalidate(planValue, phase) {
    const plan = normalizeExpiredActiveDeviceReviewResponseLossPlan(planValue);
    assertRuntimeSubject(plan);
    const frame = captureProgress(plan);
    if (phase === "before-authority") {
      requireStage(frame, { local: "source", marker: "source", ready: "draft" });
      return Object.freeze({ revalidationDigest: revalidationDigest(plan, phase, frame) });
    }
    if (phase === "adopt-reviewed-transition") {
      return reviewedTransitionAdoption(plan, frame);
    }
    if (phase === "before-local") {
      requireStage(frame, { marker: "source", ready: "draft" });
      return Object.freeze({
        localState: frame.localState,
        revalidationDigest: revalidationDigest(plan, phase, frame),
      });
    }
    if (phase === "adopt-local") {
      if (frame.localState !== "target") return Object.freeze({ localProjected: false });
      return localProjectionReceipt(plan, frame, {
        disposition: "adopted-response-loss",
        localMutation: false,
        localProjected: true,
      });
    }
    if (phase === "before-marker") {
      requireStage(frame, { local: "target", ready: "draft" });
      return Object.freeze({
        markerState: frame.markerState,
        revalidationDigest: revalidationDigest(plan, phase, frame),
      });
    }
    if (phase === "adopt-marker") {
      if (frame.markerState !== "target") return Object.freeze({ markerProjected: false });
      return markerProjectionReceipt(plan, {
        disposition: "adopted-response-loss",
        providerMutation: false,
        markerProjected: true,
      });
    }
    if (phase === "before-ready") {
      requireStage(frame, { local: "target", marker: "target" });
      return Object.freeze({
        readyState: frame.readyState,
        revalidationDigest: revalidationDigest(plan, phase, frame),
      });
    }
    if (phase === "adopt-ready") {
      if (frame.readyState !== "ready") return Object.freeze({ providerReady: false });
      return readyProjectionReceipt(plan, {
        disposition: "adopted-response-loss",
        providerMutation: false,
        providerReady: true,
      });
    }
    if (phase === "before-terminal") return frame;
    throw new Error(`Unsupported expired device-review revalidation phase: ${phase}`);
  }

  function projectLocalReviewReady(planValue) {
    const plan = normalizeExpiredActiveDeviceReviewResponseLossPlan(planValue);
    assertRuntimeSubject(plan);
    const frame = captureProgress(plan);
    requireStage(frame, { local: "source", marker: "source", ready: "draft" });
    const projected = mutateWriterLeaseRegistry({
      leaseStore,
      branch,
      expectedLeaseDigest: plan.evidence.sourceLeaseDigest,
      expectedClaimId: plan.evidence.cloud.claim.claimId,
      action: ({ registry, lease }) => {
        assertNoCompetingBranchControllerIntent(registry, branch);
        if (registry.revision + 1 !== plan.evidence.projections.targetRegistryRevision
          || canonicalJson(lease) !== canonicalJson(plan.evidence.sourceLease)) {
          throw new Error("Expired device-review registry changed before its exact local CAS.");
        }
        const targetLease = plan.evidence.projections.targetLease;
        return {
          registry: {
            ...registry,
            leases: { ...registry.leases, [branch]: targetLease },
          },
          lease: targetLease,
          changed: true,
        };
      },
    });
    if (projected.registryRevision !== plan.evidence.projections.targetRegistryRevision
      || writerLeaseDigest(projected.lease) !== plan.evidence.projections.targetLeaseDigest) {
      throw new Error("Expired device-review local CAS did not reach its sealed target.");
    }
    return localProjectionReceipt(plan, {
      ...frame,
      lease: projected.lease,
      localState: "target",
    }, {
      disposition: "projected",
      localMutation: true,
    });
  }

  function projectProviderMarker(planValue) {
    const plan = normalizeExpiredActiveDeviceReviewResponseLossPlan(planValue);
    assertRuntimeSubject(plan);
    const frame = captureProgress(plan);
    requireStage(frame, { local: "target", marker: "source", ready: "draft" });
    withBranchControllerIntentFence({
      plan,
      action: () => gh([
        "pr", "edit", plan.evidence.pullRequest.url,
        "--body", plan.evidence.projections.targetBody,
      ]),
    });
    const terminal = captureProgress(plan);
    requireStage(terminal, { local: "target", marker: "target", ready: "draft" });
    return markerProjectionReceipt(plan, {
      disposition: "projected",
      providerMutation: true,
    });
  }

  function markProviderReady(planValue) {
    const plan = normalizeExpiredActiveDeviceReviewResponseLossPlan(planValue);
    assertRuntimeSubject(plan);
    const frame = captureProgress(plan);
    requireStage(frame, { local: "target", marker: "target", ready: "draft" });
    withBranchControllerIntentFence({
      plan,
      action: () => gh(["pr", "ready", plan.evidence.pullRequest.url]),
    });
    const terminal = captureProgress(plan);
    requireStage(terminal, { local: "target", marker: "target", ready: "ready" });
    return readyProjectionReceipt(plan, {
      disposition: "projected",
      providerMutation: true,
    });
  }

  function verifyTerminal(planValue) {
    const plan = normalizeExpiredActiveDeviceReviewResponseLossPlan(planValue);
    assertRuntimeSubject(plan);
    const frame = captureProgress(plan);
    requireStage(frame, { local: "target", marker: "target", ready: "ready" });
    const terminalEvidence = Object.freeze({
      schema: TERMINAL_EVIDENCE_SCHEMA,
      planDigest: plan.planDigest,
      cloud: Object.freeze({
        claimId: frame.cloud.claim.claimId,
        claimDigest: frame.cloud.claim.fenceRevision,
        transitionDigest: frame.cloud.claim.transitionDigest,
        transitionCounter: frame.cloud.claim.transitionCounter,
        operationReceiptDigest: frame.cloud.claim.operationReceiptDigest,
        reviewedEntryDigest: frame.cloud.reviewedEntry.digest,
        noOverlappingCompetitor: true,
      }),
      registry: Object.freeze({
        targetRegistryRevision: plan.evidence.projections.targetRegistryRevision,
        currentRegistryRevisionAtLeastTarget:
          frame.registry.revision >= plan.evidence.projections.targetRegistryRevision,
        leaseDigest: frame.leaseDigest,
      }),
      provider: Object.freeze({
        stateDigest: frame.providerStateDigest,
        bodyDigest: frame.bodyDigest,
        markerDigest: frame.markerDigest,
      }),
      worktree: Object.freeze({
        branch: frame.worktree.branch,
        headSha: frame.worktree.headSha,
        treeSha: frame.worktree.treeSha,
        localRefSha: frame.worktree.localRefSha,
        remoteRefSha: frame.worktree.remoteRefSha,
        indexDigest: frame.worktree.indexDigest,
        statusDigest: frame.worktree.statusDigest,
        registered: frame.worktree.registered,
        clean: frame.worktree.clean,
      }),
      sourcePreservation: Object.freeze({
        sourceHeadSha: plan.evidence.worktree.headSha,
        sourceTreeSha: plan.evidence.worktree.treeSha,
        sourceIndexDigest: plan.evidence.worktree.indexDigest,
        title: plan.evidence.pullRequest.title,
        headRepository: plan.evidence.pullRequest.headRepository,
        headBranch: plan.evidence.pullRequest.headBranch,
        baseBranch: plan.evidence.pullRequest.baseBranch,
        baseSha: plan.evidence.pullRequest.baseSha,
        autoMergeRequest: null,
      }),
      cloudMutation: false,
      sourceMutation: false,
      gitMutation: false,
      remoteRefMutation: false,
      titleMutation: false,
      autoMergeMutation: false,
    });
    if (!terminalEvidence.registry.currentRegistryRevisionAtLeastTarget) {
      throw new Error("Expired device-review terminal registry revision regressed.");
    }
    return Object.freeze({
      verificationDigest: digestValue(terminalEvidence),
      leaseDigest: plan.evidence.projections.targetLeaseDigest,
      bodyDigest: plan.evidence.projections.targetBodyDigest,
      markerDigest: plan.evidence.projections.targetMarkerDigest,
      providerStateDigest: plan.evidence.projections.targetProviderStateDigest,
      registryRevision: plan.evidence.projections.targetRegistryRevision,
    });
  }

  function captureProgress(plan) {
    assertRuntimeSubject(plan);
    const registry = readRegistry();
    const lease = registry.leases?.[branch];
    if (!lease) throw new Error("Expired device-review source lease is absent.");
    const leaseDigest = writerLeaseDigest(lease);
    const localState = leaseDigest === plan.evidence.sourceLeaseDigest
      && canonicalJson(lease) === canonicalJson(plan.evidence.sourceLease)
      ? "source"
      : leaseDigest === plan.evidence.projections.targetLeaseDigest
        && canonicalJson(lease) === canonicalJson(plan.evidence.projections.targetLease)
        ? "target"
        : invalid("local lease is neither the sealed source nor target");
    if (localState === "source"
      && registry.revision + 1 !== plan.evidence.projections.targetRegistryRevision) {
      invalid("source registry revision drift");
    }
    if (localState === "target"
      && registry.revision < plan.evidence.projections.targetRegistryRevision) {
      invalid("target registry revision regression");
    }
    const review = readReview();
    assertProviderIdentity(plan, review);
    const worktree = readWorktree(review.headRepository);
    assertWorktreeIdentity(plan, worktree);
    const marker = parseWriterLeasePullRequestBody(review.body);
    const markerDigest = marker ? digestValue(marker) : null;
    const bodyDigest = digestValue(review.body);
    const markerState = bodyDigest === plan.evidence.pullRequest.sourceBodyDigest
      && markerDigest === plan.evidence.sourceMarker.markerDigest
      && canonicalJson(marker) === canonicalJson(plan.evidence.sourceMarker.marker)
      ? "source"
      : bodyDigest === plan.evidence.projections.targetBodyDigest
        && markerDigest === plan.evidence.projections.targetMarkerDigest
        && canonicalJson(marker) === canonicalJson(plan.evidence.projections.targetMarker)
        ? "target"
        : invalid("provider marker is neither the sealed source nor target");
    const readyState = review.isDraft === true ? "draft"
      : review.isDraft === false ? "ready" : invalid("provider draft state");
    const cloud = readReviewedCloud(plan.evidence.sourceLease, review);
    assertCloudPlanIdentity(plan, cloud);
    const providerStateDigest = readyState === "ready"
      ? digestValue(providerState(review, { isDraft: false }))
      : digestValue(providerState(review, { isDraft: true }));
    return Object.freeze({
      registry,
      lease,
      leaseDigest,
      localState,
      review,
      marker,
      markerDigest,
      bodyDigest,
      markerState,
      readyState,
      providerStateDigest,
      cloud,
      worktree,
    });
  }

  function readReviewedCloud(sourceLease, review) {
    const authority = sourceLease.cloudAuthority;
    const statusValue = cloudAction({
      action: "status",
      ledgerRepository: authority.ledgerRepository,
      request: { targetRepository: authority.targetRepository },
    });
    if (statusValue?.status !== "ready" || !Array.isArray(statusValue.claims)) {
      invalid("cloud status response");
    }
    const matches = statusValue.claims.filter(item => item.claimId === authority.claimId);
    if (matches.length !== 1) invalid("reviewed claim cardinality");
    const claim = matches[0];
    const competitors = statusValue.claims.filter(item => item.claimId !== claim.claimId
      && (item.writeAuthority === true || item.scopeReserved === true)
      && (item.reviewRequestId === claim.reviewRequestId
        || writeSetsOverlap(item.declaredWriteScope, claim.declaredWriteScope)));
    if (competitors.length !== 0) invalid("overlapping cloud competitor");
    const ledger = readLedgerSnapshot({
      ledgerRepository: authority.ledgerRepository,
      revision: statusValue.ledgerRevision,
    });
    if (ledger?.schema !== "agentic-cloud-collaboration-ledger/v1"
      || !Array.isArray(ledger.entries)) invalid("cloud ledger snapshot");
    const validationFailures = validateLedger(ledger);
    if (validationFailures.length !== 0
      || ledger.sequence !== statusValue.sequence
      || ledger.headDigest !== statusValue.ledgerDigest) {
      invalid(`cloud ledger validation: ${validationFailures.join("; ")}`);
    }
    const sourceEntries = ledger.entries.filter(entry => entry.claimId === claim.claimId
      && entry.digest === authority.claimLedgerRevision
      && entry.claimDigest === authority.claimDigest
      && entry.claimCore?.transitionCounter === authority.transitionCounter
      && entry.claimCore?.state === "current");
    if (sourceEntries.length !== 1) invalid("direct active source ledger transition");
    const sourceLedger = readHistoricalLedger({
      ledgerRepository: authority.ledgerRepository,
      revision: authority.ledgerRevision,
    });
    const historicalSourceEntry = sourceLedger.entries.at(-1);
    if (sourceLedger.headDigest !== authority.ledgerDigest
      || sourceLedger.sequence !== sourceEntries[0].sequence
      || canonicalJson(historicalSourceEntry) !== canonicalJson(sourceEntries[0])) {
      invalid("source authority historical ledger provenance");
    }
    const reviewed = ledger.entries.filter(entry => entry.claimId === claim.claimId
      && entry.digest === claim.transitionDigest
      && entry.claimDigest === claim.fenceRevision
      && entry.claimCore?.transitionCounter === claim.transitionCounter
      && entry.claimCore?.state === "reviewed");
    if (reviewed.length !== 1) invalid("direct reviewed ledger transition");
    const laterTargetTransitions = ledger.entries.filter(entry =>
      entry.claimId === claim.claimId && entry.sequence > reviewed[0].sequence);
    if (laterTargetTransitions.length !== 0) invalid("later target cloud transition");
    const focusedEvidenceDigest = digestValue({
      schema: "agentic-focused-review-evidence/v1",
      command: "npm run check",
      branch,
      headSha: sourceLease.fenceSha,
      pullRequestNumber,
      admittedReportDigest: sourceLease.admission.admittedReportDigest,
    });
    const targetAuthority = Object.freeze({
      ...normalizeBoundAuthority({
        result: {
          claim,
          claimDigest: claim.fenceRevision,
          ledgerRevision: statusValue.ledgerRevision,
          ledgerDigest: statusValue.ledgerDigest,
        },
        authority,
        manifest: sourceLease.admission,
        deviceId: sourceLease.device,
        sessionId: sourceLease.sessionId,
        focusedEvidenceDigest,
      }),
      state: "review_ready",
      manifestDigest: authority.manifestDigest,
    });
    if (claim.reviewRequestId !== `github-pull-request:${review.id}`) {
      invalid("reviewed claim provider identity");
    }
    const ledgerValidation = Object.freeze({
      schema: "agentic-expired-active-device-review-ledger-validation/v1",
      ledgerRevision: statusValue.ledgerRevision,
      ledgerDigest: statusValue.ledgerDigest,
      sequence: statusValue.sequence,
      entryCount: ledger.entries.length,
      validated: true,
      failureCount: 0,
      targetLatestSequence: reviewed[0].sequence,
      sourceLedgerRevision: authority.ledgerRevision,
      sourceLedgerDigest: sourceLedger.headDigest,
      sourceSequence: sourceLedger.sequence,
      sourceEntryDigest: historicalSourceEntry.digest,
      sourceEntryCount: sourceLedger.entries.length,
      sourceValidated: true,
    });
    return Object.freeze({
      status: Object.freeze({
        ledgerRevision: statusValue.ledgerRevision,
        ledgerDigest: statusValue.ledgerDigest,
        sequence: statusValue.sequence,
      }),
      claim: Object.freeze(structuredClone(claim)),
      sourceEntry: Object.freeze(structuredClone(sourceEntries[0])),
      reviewedEntry: Object.freeze(structuredClone(reviewed[0])),
      targetAuthority,
      ledgerValidation,
    });
  }

  function readHistoricalLedger({ ledgerRepository, revision }) {
    const cacheKey = `${ledgerRepository}@${revision}`;
    if (historicalLedgerCache.has(cacheKey)) return historicalLedgerCache.get(cacheKey);
    const ledger = structuredClone(readLedgerSnapshot({ ledgerRepository, revision }));
    if (ledger?.schema !== "agentic-cloud-collaboration-ledger/v1"
      || !Array.isArray(ledger.entries)) invalid("historical cloud ledger snapshot");
    const validationFailures = validateLedger(ledger);
    if (validationFailures.length !== 0) {
      invalid(`historical cloud ledger validation: ${validationFailures.join("; ")}`);
    }
    const sealed = Object.freeze(ledger);
    historicalLedgerCache.set(cacheKey, sealed);
    return sealed;
  }

  function readReview() {
    const value = parseJson(gh([
      "pr", "view", String(pullRequestNumber), "--json",
      "id,number,url,state,isDraft,title,body,headRefName,headRefOid,headRepository,"
        + "baseRefName,baseRefOid,autoMergeRequest",
    ]), "pull request");
    if (value.number !== pullRequestNumber || typeof value.body !== "string") {
      invalid("pull-request identity");
    }
    return Object.freeze({
      id: required(value.id, "pull-request ID"),
      number: value.number,
      url: required(value.url, "pull-request URL"),
      state: value.state,
      isDraft: value.isDraft,
      autoMergeRequest: value.autoMergeRequest,
      title: required(value.title, "pull-request title"),
      headRepository: required(value.headRepository?.nameWithOwner, "head repository"),
      headBranch: required(value.headRefName, "head branch"),
      headSha: requiredSha(value.headRefOid, "head SHA"),
      baseBranch: required(value.baseRefName, "base branch"),
      baseSha: requiredSha(value.baseRefOid, "base SHA"),
      body: value.body,
    });
  }

  function readWorktree(repositoryName) {
    const headSha = requiredSha(git(["rev-parse", "HEAD"]), "worktree HEAD");
    const treeSha = requiredSha(git(["rev-parse", "HEAD^{tree}"]), "worktree tree");
    const localRefSha = requiredSha(
      git(["rev-parse", `refs/heads/${branch}`]),
      "local branch ref",
    );
    const remoteRefSha = requiredSha(gh([
      "api", `repos/${repositoryName}/git/ref/heads/${encodeURIComponent(branch)}`,
      "--jq", ".object.sha",
    ]), "remote branch ref");
    const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const registered = assertRegisteredWorktree({
      cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]),
    });
    const indexPathValue = git(["rev-parse", "--git-path", "index"]);
    const indexPath = path.isAbsolute(indexPathValue)
      ? indexPathValue : path.resolve(repository, indexPathValue);
    const indexStat = lstatSync(indexPath);
    if (!indexStat.isFile() || indexStat.isSymbolicLink()) invalid("regular worktree index");
    const indexDigest = createHash("sha256").update(readFileSync(indexPath)).digest("hex");
    if (registered.branch !== `refs/heads/${branch}` || registered.head !== headSha
      || status !== "" || localRefSha !== headSha || remoteRefSha !== headSha) {
      invalid("clean attached exact worktree fence");
    }
    return Object.freeze({
      branch,
      headSha,
      treeSha,
      localRefSha,
      remoteRefSha,
      registered: true,
      clean: true,
      statusDigest: digestValue(status),
      indexDigest,
    });
  }

  function requireSourceLease(value, observedAt) {
    if (!value || value.schema !== "agentic-writer-lease/v2"
      || value.status !== "active" || value.branch !== branch
      || path.resolve(value.worktreePath || "") !== repository
      || value.admission?.status !== "admitted"
      || value.cloudAuthority?.state !== "active"
      || value.cloudAuthority?.transitionCounter !== 3
      || value.taskAuthority?.bindingMode !== "migration"
      || value.reviewHeadSha != null || value.integration != null
      || Date.parse(value.expiresAt) >= Date.parse(observedAt)) {
      invalid("expired active migrated source lease");
    }
    return value;
  }

  function requireSourceMarker(sourceLease, review) {
    const marker = parseWriterLeasePullRequestBody(review.body);
    const { taskAuthority: _taskAuthority, ...preMigrationLease } = sourceLease;
    const expected = projectWriterLeasePullRequestMarker(preMigrationLease);
    if (!marker || Object.hasOwn(marker, "taskAuthority")
      || canonicalJson(marker) !== canonicalJson(expected)) {
      invalid("pre-migration provider marker");
    }
    return marker;
  }

  function assertProviderIdentity(plan, review) {
    const expected = plan.evidence.pullRequest;
    for (const field of [
      "id", "number", "url", "state", "autoMergeRequest", "title", "headRepository",
      "headBranch", "headSha", "baseBranch", "baseSha",
    ]) {
      if (canonicalJson(review[field]) !== canonicalJson(expected[field])) {
        invalid(`provider ${field} drift`);
      }
    }
  }

  function assertWorktreeIdentity(plan, worktree) {
    const expected = plan.evidence.worktree;
    for (const field of [
      "branch", "headSha", "treeSha", "localRefSha", "remoteRefSha",
      "registered", "clean", "statusDigest", "indexDigest",
    ]) {
      if (worktree[field] !== expected[field]) invalid(`worktree ${field} drift`);
    }
  }

  function assertCloudPlanIdentity(plan, cloud) {
    const expected = plan.evidence.cloud;
    const stableClaim = claim => {
      const copy = structuredClone(claim);
      delete copy.state;
      delete copy.writeAuthority;
      delete copy.scopeReserved;
      return copy;
    };
    if (!new Set(["reviewed", "dormant-preserved"]).has(cloud.claim.state)
      || canonicalJson(stableClaim(cloud.claim)) !== canonicalJson(stableClaim(expected.claim))
      || canonicalJson(cloud.status) !== canonicalJson(expected.status)
      || canonicalJson(cloud.sourceEntry) !== canonicalJson(expected.sourceEntry)
      || canonicalJson(cloud.reviewedEntry) !== canonicalJson(expected.reviewedEntry)
      || canonicalJson(cloud.targetAuthority) !== canonicalJson(expected.targetAuthority)
      || digestValue(cloud.targetAuthority) !== expected.targetAuthorityDigest
      || canonicalJson(cloud.ledgerValidation) !== canonicalJson(expected.ledgerValidation)
      || digestValue(cloud.ledgerValidation) !== expected.ledgerValidationDigest
      || cloud.claim.writeAuthority !== false || cloud.claim.scopeReserved !== true) {
      invalid("reviewed cloud transition drift");
    }
  }

  function assertRuntimeSubject(planValue) {
    const plan = normalizeExpiredActiveDeviceReviewResponseLossPlan(planValue);
    const evidence = plan.evidence;
    if (evidence.repository.path !== repository
      || evidence.pullRequest.number !== pullRequestNumber
      || evidence.worktree.branch !== branch
      || evidence.sourceLease.branch !== branch
      || evidence.pullRequest.headBranch !== branch
      || evidence.sourceLease.worktreePath !== repository
      || evidence.repository.nameWithOwner !== evidence.pullRequest.headRepository
      || evidence.sourceLease.cloudAuthority?.targetRepository
        !== evidence.repository.nameWithOwner
      || evidence.cloud.targetAuthority?.targetRepository
        !== evidence.repository.nameWithOwner) {
      throw new Error("Expired device-review plan does not match its adapter runtime subject.");
    }
    return plan;
  }

  function providerState(review, { isDraft }) {
    return Object.freeze({
      id: review.id,
      number: review.number,
      url: review.url,
      state: review.state,
      isDraft,
      autoMergeRequest: review.autoMergeRequest,
      title: review.title,
      headRepository: review.headRepository,
      headBranch: review.headBranch,
      headSha: review.headSha,
      baseBranch: review.baseBranch,
      baseSha: review.baseSha,
    });
  }

  function reviewedTransitionAdoption(plan, frame) {
    if (frame.cloud.claim.claimId !== plan.evidence.cloud.claim.claimId) {
      invalid("reviewed-transition adoption claim");
    }
    return buildExpiredActiveDeviceReviewResponseLossReviewedTransitionAdoption(plan);
  }

  function localProjectionReceipt(plan, _frame, values) {
    return Object.freeze({
      disposition: values.disposition,
      leaseDigest: plan.evidence.projections.targetLeaseDigest,
      localMutation: values.localMutation,
      registryRevision: plan.evidence.projections.targetRegistryRevision,
      ...(values.localProjected === true ? { localProjected: true } : {}),
    });
  }

  function markerProjectionReceipt(plan, values) {
    return Object.freeze({
      bodyDigest: plan.evidence.projections.targetBodyDigest,
      disposition: values.disposition,
      markerDigest: plan.evidence.projections.targetMarkerDigest,
      providerMutation: values.providerMutation,
      ...(values.markerProjected === true ? { markerProjected: true } : {}),
    });
  }

  function readyProjectionReceipt(plan, values) {
    return Object.freeze({
      disposition: values.disposition,
      providerMutation: values.providerMutation,
      providerStateDigest: plan.evidence.projections.targetProviderStateDigest,
      ...(values.providerReady === true ? { providerReady: true } : {}),
    });
  }

  function requireStage(frame, expected) {
    for (const [key, value] of Object.entries(expected)) {
      const actual = frame[`${key}State`];
      if (actual !== value) {
        throw new Error(
          `Expired device-review ${key} projection is ${actual}, not ${value}.`,
        );
      }
    }
  }

  function revalidationDigest(plan, phase, frame) {
    return digestValue({
      schema: "agentic-expired-active-device-review-revalidation/v1",
      planDigest: plan.planDigest,
      phase,
      localState: frame.localState,
      markerState: frame.markerState,
      readyState: frame.readyState,
      leaseDigest: frame.leaseDigest,
      registryRevision: frame.registry.revision,
      claimId: frame.cloud.claim.claimId,
      claimDigest: frame.cloud.claim.fenceRevision,
      transitionDigest: frame.cloud.claim.transitionDigest,
      transitionCounter: frame.cloud.claim.transitionCounter,
      bodyDigest: frame.bodyDigest,
      providerStateDigest: frame.providerStateDigest,
      worktreeDigest: digestValue(frame.worktree),
    });
  }

  function readIntent() {
    const journal = readJournal();
    return journal?.intent || null;
  }

  function writeIntent({ expected, value }) {
    const normalized = normalizeExpiredActiveDeviceReviewResponseLossIntent(value);
    const normalizedExpected = expected === null
      ? null : normalizeExpiredActiveDeviceReviewResponseLossIntent(expected);
    mkdirSecure(commonDirectory, journalDirectory);
    const current = readJournal();
    if (current?.intent?.intentDigest === normalized.intentDigest) return current.intent;
    const currentDigest = current?.intent?.intentDigest || null;
    const expectedDigest = normalizedExpected?.intentDigest || null;
    if (currentDigest !== expectedDigest) {
      throw new Error("Expired device-review intent changed before its exact journal CAS.");
    }
    const journal = Object.freeze({
      schema: JOURNAL_SCHEMA,
      operationId,
      repository,
      branch,
      pullRequestNumber,
      intent: normalized,
    });
    writeJsonAtomic(journalPath, journal, uuid);
    const persisted = readJournal();
    if (persisted?.intent?.intentDigest !== normalized.intentDigest) {
      throw new Error("Expired device-review intent journal did not persist exactly.");
    }
    return persisted.intent;
  }

  async function withOperationLock(action) {
    if (typeof action !== "function") throw new Error("Operation lock requires an action.");
    mkdirSecure(commonDirectory, journalDirectory);
    const release = acquireOperationLock({
      lockPath,
      operationId,
      uuid,
      isProcessAlive,
    });
    try {
      return await action();
    } finally {
      release();
    }
  }

  function readJournal() {
    mkdirSecure(commonDirectory, journalDirectory);
    if (!existsSync(journalPath)) return null;
    const value = parseJson(
      readSecureRegularFile(journalPath, MAX_JOURNAL_BYTES, "intent journal"),
      "intent journal",
    );
    if (value.schema !== JOURNAL_SCHEMA || value.operationId !== operationId
      || value.repository !== repository || value.branch !== branch
      || value.pullRequestNumber !== pullRequestNumber) invalid("intent journal identity");
    return value;
  }

  function readRegistry() {
    const registry = requireWriterRegistry(leaseStore.readRegistry());
    assertNoCompetingBranchControllerIntent(registry, branch);
    return registry;
  }

  function requireWriterRegistry(registry) {
    if (registry?.schema !== "agentic-writer-lease-registry/v2"
      || !Number.isSafeInteger(registry.revision) || registry.revision < 0
      || !registry.leases || typeof registry.leases !== "object") {
      invalid("writer-lease registry");
    }
    return registry;
  }

  function withBranchControllerIntentFence({ plan, action }) {
    if (typeof leaseStore?.withRegistryLock !== "function") {
      throw new Error("Provider projection requires the writer-registry intent fence.");
    }
    return leaseStore.withRegistryLock(registryValue => {
      const registry = requireWriterRegistry(registryValue);
      assertNoCompetingBranchControllerIntent(registry, branch);
      const lease = registry.leases?.[branch];
      if (!lease
        || writerLeaseDigest(lease) !== plan.evidence.projections.targetLeaseDigest
        || canonicalJson(lease) !== canonicalJson(plan.evidence.projections.targetLease)
        || lease.cloudAuthority?.claimId !== plan.evidence.cloud.claim.claimId) {
        throw new Error("Provider projection writer lease changed under its branch intent fence.");
      }
      return action();
    });
  }

  return Object.freeze({
    readPlanEvidence,
    withOperationLock,
    readIntent,
    writeIntent,
    assertRuntimeSubject,
    authorizeTask,
    revalidate,
    projectLocalReviewReady,
    projectProviderMarker,
    markProviderReady,
    verifyTerminal,
    branch,
    gitCommonDir: commonDirectory,
    journalPath,
  });
}

function writeJsonAtomic(target, value, uuid) {
  assertSecureRegularFileIfPresent(target, "intent journal");
  const temporary = `${target}.${process.pid}.${uuid()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, target);
  const directoryDescriptor = openSync(path.dirname(target), "r");
  try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
}

function mkdirSecure(commonDirectory, directory) {
  if (directory === commonDirectory || !inside(commonDirectory, directory)) {
    throw new Error("Expired device-review journal directory escaped the Git common directory.");
  }
  const root = lstatSync(commonDirectory);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error("Expired device-review Git common directory is not real.");
  }
  const segments = path.relative(commonDirectory, directory).split(path.sep).filter(Boolean);
  let current = commonDirectory;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    if (!existsSync(current)) {
      try { mkdirSync(current, { mode: 0o700 }); }
      catch (error) { if (error?.code !== "EEXIST") throw error; }
    }
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Expired device-review journal ancestry is not a real directory.");
    }
    if (index === segments.length - 1 && (stat.mode & 0o077) !== 0) {
      throw new Error("Expired device-review journal leaf directory is not private.");
    }
  }
}

function assertNoCompetingBranchControllerIntent(registry, branch) {
  for (const field of BRANCH_CONTROLLER_FENCE_FIELDS) {
    const values = registry?.[field];
    if (values !== null && values !== undefined
      && (!values || typeof values !== "object" || Array.isArray(values))) {
      throw new Error(`Writer registry ${field} is malformed.`);
    }
    if (values?.[branch] !== null && values?.[branch] !== undefined) {
      throw new Error(
        `Expired device-review found a competing branch controller intent or fence: ${field}.`,
      );
    }
  }
}

function acquireOperationLock({ lockPath, operationId, uuid, isProcessAlive }) {
  const token = uuid();
  try { return createOwnedOperationLock({ lockPath, operationId, token }); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  const owner = readOperationLock(lockPath);
  if (!owner || owner.operationId !== operationId) {
    throw new Error("Expired device-review operation lock is malformed or foreign.");
  }
  if (isProcessAlive(owner.pid)) {
    throw new Error("An expired device-review recovery is already in progress.");
  }
  const confirmed = readOperationLock(lockPath);
  if (!confirmed || confirmed.token !== owner.token
    || confirmed.operationId !== operationId) {
    throw new Error("Expired device-review operation lock changed during dead-owner recovery.");
  }
  const stalePath = `${lockPath}.stale.${token}`;
  renameSync(lockPath, stalePath);
  syncDirectory(path.dirname(lockPath));
  const moved = readOperationLock(stalePath);
  if (!moved || moved.token !== owner.token || moved.operationId !== operationId) {
    if (!existsSync(lockPath)) renameSync(stalePath, lockPath);
    throw new Error("Expired device-review dead-owner lock capture changed identity.");
  }
  let release;
  try {
    release = createOwnedOperationLock({ lockPath, operationId, token });
  } catch (error) {
    if (!existsSync(lockPath)) renameSync(stalePath, lockPath);
    else unlinkSync(stalePath);
    syncDirectory(path.dirname(lockPath));
    throw error;
  }
  unlinkSync(stalePath);
  syncDirectory(path.dirname(lockPath));
  return release;
}

function createOwnedOperationLock({ lockPath, operationId, token }) {
  const descriptor = openSync(lockPath, "wx", 0o600);
  const owner = {
    schema: LOCK_SCHEMA,
    operationId,
    pid: process.pid,
    token,
  };
  try {
    writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  syncDirectory(path.dirname(lockPath));
  return () => {
    const current = readOperationLock(lockPath);
    if (!current || current.operationId !== operationId || current.token !== token
      || current.pid !== process.pid) {
      throw new Error("Expired device-review operation lock ownership changed.");
    }
    unlinkSync(lockPath);
    syncDirectory(path.dirname(lockPath));
  };
}

function readOperationLock(lockPath) {
  if (!existsSync(lockPath)) return null;
  let value;
  try {
    value = JSON.parse(readSecureRegularFile(lockPath, MAX_LOCK_BYTES, "operation lock"));
  } catch {
    return null;
  }
  const keys = ["schema", "operationId", "pid", "token"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson(keys.sort())
    || value.schema !== LOCK_SCHEMA
    || !/^[0-9a-f]{64}$/u.test(String(value.operationId || ""))
    || !Number.isSafeInteger(value.pid) || value.pid < 1
    || typeof value.token !== "string" || !value.token) return null;
  return value;
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function readSecureRegularFile(target, maximumBytes, label) {
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600
    || stat.size < 1 || stat.size > maximumBytes) {
    throw new Error(`Expired device-review ${label} is not a bounded 0600 regular file.`);
  }
  const descriptor = openSync(target, "r");
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino
      || opened.size !== stat.size || (opened.mode & 0o777) !== 0o600) {
      throw new Error(`Expired device-review ${label} changed during secure open.`);
    }
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function assertSecureRegularFileIfPresent(target, label) {
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error(`Expired device-review ${label} must remain a 0600 regular file.`);
  }
}

function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function parseJson(source, label) {
  try { return JSON.parse(source); }
  catch (error) { throw new Error(`Could not parse ${label}: ${error.message}`); }
}
function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}
function canonicalInstant(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid.`);
  return date.toISOString();
}
function nextRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER - 1) {
    throw new Error("Writer-lease registry revision cannot advance safely.");
  }
  return value + 1;
}
function required(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}
function requiredSha(value, label) {
  const normalized = required(value, label);
  if (!/^[0-9a-f]{40}$/u.test(normalized)) throw new Error(`${label} must be a Git SHA.`);
  return normalized;
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} must be positive.`);
  return number;
}
function invalid(label) {
  throw new Error(`Expired active device-review response-loss adapter has invalid ${label}.`);
}
