// Responsibility: Bind one exact append-only attribution recovery to repository effects.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  CLOSED_PR834_STANDARD_TERMINAL_ATTRIBUTION_PROFILE,
  EVIDENCE_SCHEMA,
  GENERIC_SELF_HOSTED_RECOVERY_EVIDENCE_PATH,
  GENERIC_SELF_HOSTED_RECOVERY_PATHS,
  LEGACY_ADMISSION_CONTINUATION_PROFILE,
  LEGACY_INTEGRATION_RUN_PROFILE,
  SELF_HOSTED_CI_RUN_PROFILE,
  STANDARD_AUTO_DELIVERY_PROFILE,
  normalizeCanonicalSquashRecoveryDeliveryProfile,
  normalizeJournal,
} from "./canonical-squash-attribution-recovery-terminalization-contract.mjs";
import { normalizeActiveOwnedDirtLeaseRecovery }
  from "./active-owned-dirt-recovery-contract.mjs";
import { normalizeRepair }
  from "./source-correction-successor-task-binding-reconciliation-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { validateLedger } from "./cloud-collaboration-contract.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { completeSession } from "./device-complete-lib.mjs";
import { renderProtectedSquashCommitBody } from "./device-integrate-lib.mjs";
import { createPostMergeCloudAuthorityVerifier }
  from "./post-merge-cloud-authority-verifier.mjs";
import {
  assertReviewedLaneEntrypointFence,
  withReviewedLaneEntrypointFence,
} from "./reviewed-lane-revision-fence.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import { assertTaskAuthorityBinding, normalizeTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import {
  createWriterLeaseStore,
} from "./writer-lease-lib.mjs";
import { writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
import { createWorktreeCleanupOperationId } from "./worktree-lifecycle-lib.mjs";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const RECOVERY_FRONTMATTER = Object.freeze([
  "title",
  "doc_type",
  "status",
  "lang",
  "frontmatter_contract",
  "failed_protected_main_sha",
  "reviewed_pull_request",
  "reviewed_source_head",
  "reviewed_source_tree",
  "reviewed_run_id",
  "post_merge_run_id",
  "controller_source",
  "controller_revision",
  "deployment_authority",
]);
const GENERIC_SELF_HOSTED_RECOVERY_FRONTMATTER = Object.freeze([
  "title",
  "graphId",
  "doc_type",
  "date",
  "lang",
  "schema",
  "frontmatter_contract",
  "status",
  "authority",
  "runtime_scope",
  "runtime_proof",
]);
const GENERIC_EVIDENCE_RECOVERY_FRONTMATTER = Object.freeze([
  ...GENERIC_SELF_HOSTED_RECOVERY_FRONTMATTER,
  "failed_protected_main_sha",
  "reviewed_pull_request",
  "reviewed_source_head",
  "reviewed_source_tree",
  "reviewed_run_id",
  "post_merge_run_id",
  "controller_source",
  "controller_revision",
  "deployment_authority",
]);
const PRESERVATION = Object.freeze({
  authoredSourceBytes: "unchanged",
  authoredTree: "unchanged",
  authoredBranchRef: "unchanged",
  worktreeProjection: "detached-at-canonical-main",
  indexProjection: "canonical-main",
  remoteTrackingRefs: "unchanged",
  pullRequest: "unchanged",
  autoMerge: "unchanged",
  newClaims: "none",
  runtime: "not-performed",
  cleanup: "not-performed",
  release: "not-performed",
  deployment: "not-performed",
});

export function createCanonicalSquashAttributionRecoveryTerminalizationRepositoryAdapter({
  repository,
  subjectWorktree,
  targetRepository,
  subjectPullRequest,
  recoveryPullRequest,
  recoveryEvidencePath,
  recoveryCleanupReceiptDigest,
  controllerRoot,
  ledgerRepository = "huijoohwee/agentic-canvas-os",
  statePath,
  taskAuthorityFile = null,
  now = () => new Date(),
} = {}, dependencies = {}) {
  const canonicalRoot = physicalDirectory(repository, "canonical repository");
  const subjectPath = path.resolve(required(subjectWorktree, "subject worktree"));
  const controller = physicalDirectory(controllerRoot, "controller root");
  const target = repositoryName(targetRepository, "target repository");
  const ledger = repositoryName(ledgerRepository, "ledger repository");
  const subjectNumber = positive(subjectPullRequest, "subject pull request");
  const recoveryNumber = positive(recoveryPullRequest, "recovery pull request");
  const evidencePath = normalizedRepositoryPath(recoveryEvidencePath);
  const recoveryCleanup = requiredDigest(
    recoveryCleanupReceiptDigest,
    "recovery cleanup receipt digest",
  );
  const journalPath = path.resolve(required(statePath, "state path"));
  const gitCommonDir = path.resolve(git(canonicalRoot, [
    "rev-parse", "--path-format=absolute", "--git-common-dir",
  ]));
  const excludedPrivateRoots = [canonicalRoot, subjectPath, controller, gitCommonDir];
  const capabilityPath = taskAuthorityFile
    ? externalPrivateFile(taskAuthorityFile, "task capability", excludedPrivateRoots)
    : null;
  requireExternalDestination(journalPath, "recovery journal", excludedPrivateRoots);
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir,
    taskAuthorityFile: capabilityPath,
    taskAuthorityPolicy: "required",
  });
  const command = dependencies.execFileSync || execFileSync;
  const gitText = args => String(command("git", ["-C", subjectPath, ...args], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }));
  const ghText = args => String(command("gh", args, {
    cwd: canonicalRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GH_HOST: "github.com" },
  }));
  const run = (binary, args, options = {}) => command(binary, args, {
    cwd: subjectPath, stdio: "inherit", ...options,
  });
  const postMergeVerifier = dependencies.postMergeVerifier
    || createPostMergeCloudAuthorityVerifier({ ghText });
  const completeSessionEffect = dependencies.completeSession || completeSession;
  const authorizeTaskMutation = dependencies.authorizeTaskBoundLeaseMutation
    || authorizeTaskBoundLeaseMutation;
  const withEntrypointFence = dependencies.withReviewedLaneEntrypointFence
    || withReviewedLaneEntrypointFence;
  const assertEntrypointFence = dependencies.assertReviewedLaneEntrypointFence
    || assertReviewedLaneEntrypointFence;
  const readProtectedMain = dependencies.requireProtectedMain
    || (input => requireProtectedMain(input));
  const readTerminalPullRequest = dependencies.readPullRequest
    || readPullRequest;
  const readRecoveryTerminal = dependencies.requireRecoveryTerminalProjection
    || requireRecoveryTerminalProjection;
  const journalStore = createPrivateJournalStore(journalPath);
  let activeFence = null;

  function currentSubjectLease({ allowTerminal = true } = {}) {
    const registry = leaseStore.read();
    const matches = Object.values(registry.leases || {}).filter(lease =>
      lease?.worktreePath && path.resolve(lease.worktreePath) === subjectPath);
    if (matches.length !== 1) {
      if (allowTerminal && matches.length === 0) return null;
      throw new Error("Recovery requires one exact subject writer lease.");
    }
    return matches[0];
  }

  function observe({ observedAt = null } = {}) {
    const timestamp = observedAt || now().toISOString();
    const lease = currentSubjectLease({ allowTerminal: false });
    requireSubjectLease(lease, { subjectPath, target });
    requireSubjectWorktree({ canonicalRoot, subjectPath, lease });
    const controllerEvidence = requireController({ controller, targetRepository: target });
    const subjectPr = readPullRequest(ghText, target, subjectNumber);
    const recoveryPr = readPullRequest(ghText, target, recoveryNumber);
    const recoveryLease = leaseStore.read(recoveryPr.headBranch);
    const subjectSeed = requireSubjectEvidence({
      canonicalRoot, lease, subjectPath, pullRequest: subjectPr, ghText,
      controllerRepository: controllerEvidence.repository,
    });
    const recoverySeed = requireRecoveryEvidence({
      canonicalRoot,
      controllerRoot: controller,
      controllerEvidence,
      evidencePath,
      recoveryCleanupReceiptDigest: recoveryCleanup,
      recoveryPr,
      recoveryLease,
      subject: subjectSeed,
      target,
      ghText,
    });
    const subject = Object.freeze({
      ...subjectSeed,
      checks: recoverySeed.subjectChecks,
      checksDigest: recoverySeed.subjectChecksDigest,
    });
    const { subjectChecks: _subjectChecks, subjectChecksDigest: _subjectChecksDigest,
      ...recoveryValues } = recoverySeed;
    const recovery = Object.freeze({
      ...recoveryValues,
      terminal: requireRecoveryTerminalProjection({
        leaseStore,
        canonicalRoot,
        recovery: recoveryValues,
        ghText,
        ledgerRepository: ledger,
        target,
      }),
    });
    const protectedMainSha = requireProtectedMain({ canonicalRoot, recovery, target });
    const core = {
      schema: EVIDENCE_SCHEMA,
      observedAt: timestamp,
      controller: controllerEvidence,
      subject,
      recovery,
      canonical: {
        protectedMainSha,
        recoveryContained: true,
        controllerContained: true,
      },
      preservation: PRESERVATION,
    };
    return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
  }

  function verifyEvidence({ plan }) {
    const fresh = observe({ observedAt: plan.evidence.observedAt });
    if (fresh.evidenceDigest !== plan.evidence.evidenceDigest) {
      throw new Error("Recovery evidence drifted before the protected effects.");
    }
    return Object.freeze({
      evidenceVerificationDigest: digestValue({
        planDigest: plan.planDigest,
        evidenceDigest: fresh.evidenceDigest,
        subjectLeaseDigest: fresh.subject.leaseDigest,
        subjectPullRequest: fresh.subject.pullRequest,
        recoveryPullRequest: fresh.recovery.pullRequest,
        checksDigest: fresh.recovery.checksDigest,
      }),
    });
  }

  function withLaneFence({ plan, journal }, action) {
    const subject = plan.evidence.subject;
    const phase = journal?.state?.phase;
    const terminalReplay = ["completion-projected", "verified"].includes(phase);
    const currentController = requireController({ controller, targetRepository: target });
    assertCanonicalSquashRecoveryControllerProjection({
      plan,
      currentController,
    });
    requirePlanRunsCurrent({ plan, ghText, target });
    const lease = currentSubjectLease({ allowTerminal: false });
    if (!lease || !["delivery", "completing", ...(terminalReplay ? ["completed"] : [])]
      .includes(lease.status)) {
      throw new Error(
        "Recovery fence requires the exact delivery, completing, or terminal-replay lease.",
      );
    }
    if (lease.status === "completed") {
      if (!terminalReplay) {
        throw new Error("Completed recovery lease is not authorized before terminal replay.");
      }
      verifyTerminal({ plan, journal, replay: true });
    } else {
      requireLeasePlanIdentity(lease, subject, "recovery fence", { allowCompleting: true });
    }
    if (lease.status === "delivery") {
      const currentMain = readProtectedMain({
        canonicalRoot,
        recovery: plan.evidence.recovery,
        target,
      });
      if (writerLeaseDigest(lease) !== subject.leaseDigest) {
        throw new Error("Recovery fence delivery lease drifted from the sealed plan.");
      }
      if (currentMain !== plan.evidence.canonical.protectedMainSha) {
        requireProtectedDescendantRevision({
          canonicalRoot,
          recovery: plan.evidence.recovery,
          baseSha: plan.evidence.canonical.protectedMainSha,
          targetSha: currentMain,
          target,
          readProtectedMain,
        });
        if (journal.state.phase === "cloud-retirement-intent") {
          readSubjectTerminalCloud({ plan });
        } else if (!["cloud-retired", "completion-intent"].includes(journal.state.phase)) {
          throw new Error("A protected-main advance is not authorized before exact retirement.");
        }
      }
    } else if (lease.status === "completing") {
      assertExactCanonicalSquashRecoveryCompletingReplay({
        lease,
        plan,
        journal,
        acceptCompletionMain: revision => requireProtectedDescendantRevision({
          canonicalRoot,
          recovery: plan.evidence.recovery,
          baseSha: plan.evidence.canonical.protectedMainSha,
          targetSha: revision,
          target,
          readProtectedMain,
        }),
      });
    }
    return withEntrypointFence({
      leaseStore,
      branch: subject.branch,
      entrypoint: "canonical-squash-attribution-recovery-terminalization",
      operationDigest: plan.planDigest,
      expectedLeaseDigest: writerLeaseDigest(lease),
      expectedClaimId: subject.claimId,
    }, fence => {
      if (activeFence) throw new Error("Recovery already owns a reviewed-lane fence.");
      activeFence = fence;
      const clear = () => { activeFence = null; };
      try {
        const result = action();
        if (result && typeof result.then === "function") return result.finally(clear);
        clear();
        return result;
      } catch (error) {
        clear();
        throw error;
      }
    });
  }

  function retireCloud({ plan, operationKey }) {
    requireActiveFence();
    requireRunCapability(capabilityPath);
    const lease = currentSubjectLease({ allowTerminal: false });
    requireLeasePlanIdentity(lease, plan.evidence.subject, "cloud retirement");
    const currentMain = readProtectedMain({
      canonicalRoot,
      recovery: plan.evidence.recovery,
      target,
    });
    if (currentMain !== plan.evidence.canonical.protectedMainSha) {
      requireProtectedDescendantRevision({
        canonicalRoot,
        recovery: plan.evidence.recovery,
        baseSha: plan.evidence.canonical.protectedMainSha,
        targetSha: currentMain,
        target,
        readProtectedMain,
      });
      readSubjectTerminalCloud({ plan });
    }
    const authorization = authorizeTaskMutation({
      lease,
      capabilityPath,
      operation: `canonical-squash-attribution-recovery:cloud:${plan.planDigest}:${operationKey}`,
      now: now(),
    });
    requireSealedPreRetirementProjection({ plan });
    requireActiveFence();
    const finalMain = readProtectedMain({
      canonicalRoot,
      recovery: plan.evidence.recovery,
      target,
    });
    if (finalMain !== plan.evidence.canonical.protectedMainSha) {
      requireProtectedDescendantRevision({
        canonicalRoot,
        recovery: plan.evidence.recovery,
        baseSha: plan.evidence.canonical.protectedMainSha,
        targetSha: finalMain,
        target,
        readProtectedMain,
      });
      readSubjectTerminalCloud({ plan });
    }
    const authority = plan.evidence.subject.cloudAuthority;
    const result = postMergeVerifier({
      pullRequestUrl: lease.pullRequestUrl,
      branch: lease.branch,
      headSha: lease.deliveryHeadSha || lease.reviewHeadSha,
      canonicalBaseSha: authority.canonicalBaseSha,
      cloudAuthority: authority,
      deliveryEvidence: plan.evidence.subject.deliveryEvidence,
    });
    if (result?.schema !== "agentic-post-merge-cloud-authority-verification/v1"
      || result.status !== "integrated-retired"
      || result.claimId !== plan.evidence.subject.claimId
      || result.pullRequestNumber !== plan.evidence.subject.pullRequest.number
      || result.pullRequestNodeId !== plan.evidence.subject.pullRequest.nodeId
      || result.headSha !== plan.evidence.subject.reviewedHeadSha
      || result.mergeCommitSha !== plan.evidence.subject.malformedCommit.sha
      || result.integrationReceiptDigest !== plan.evidence.subject.integrationReceiptDigest) {
      throw new Error("Post-merge retirement did not join the exact recovery subject.");
    }
    const terminalCloud = readSubjectTerminalCloud({ plan });
    return Object.freeze({
      disposition: "retired-or-adopted",
      cloudRetirementReceiptDigest: digestValue(result),
      terminalCloudDigest: digestValue(terminalCloud),
      terminalCloud,
      taskAuthorizationReceiptDigest: authorization.receiptDigest,
      taskAuthorizationReceipt: authorization,
      cloudRetirementReceipt: result,
    });
  }

  function projectCompletion({ plan, journal, operationKey }) {
    requireActiveFence();
    requireRunCapability(capabilityPath);
    const before = currentSubjectLease({ allowTerminal: false });
    if (!before || !["delivery", "completing"].includes(before.status)) {
      throw new Error("Completion projection requires the exact delivery or completing lease.");
    }
    requireLeasePlanIdentity(before, plan.evidence.subject, "completion projection", {
      allowCompleting: true,
    });
    const completionTargetMain = before.status === "completing"
      ? before.completion?.mainSha
      : readProtectedMain({
        canonicalRoot,
        recovery: plan.evidence.recovery,
        target,
      });
    requireProtectedDescendantRevision({
      canonicalRoot,
      recovery: plan.evidence.recovery,
      baseSha: plan.evidence.canonical.protectedMainSha,
      targetSha: completionTargetMain,
      target,
      readProtectedMain,
    });
    const authorization = authorizeTaskMutation({
      lease: before,
      capabilityPath,
      operation: `canonical-squash-attribution-recovery:completion:${plan.planDigest}:${operationKey}`,
      now: now(),
    });
    const authoredBranchBefore = git(subjectPath, ["rev-parse", `refs/heads/${before.branch}`]);
    const authoredTreeBefore = git(subjectPath, ["rev-parse", `${authoredBranchBefore}^{tree}`]);
    let summary;
    if (before.status === "completing") {
      assertExactCanonicalSquashRecoveryCompletingReplay({
        lease: before,
        plan,
        journal,
        acceptCompletionMain: revision => revision === completionTargetMain,
      });
      const projection = completingWorktreeProjection({
        subjectPath,
        subject: plan.evidence.subject,
        mainSha: completionTargetMain,
      });
      if (projection === "attached-reviewed") {
        const parked = git(subjectPath, ["stash", "list", "--format=%gs"])
          .split("\n").filter(value => value.includes(`park: ${before.branch} `));
        if (parked.length !== 0) {
          throw new Error("Completing replay cannot bypass a parked stash projection.");
        }
        run("git", ["merge-base", "--is-ancestor",
          before.completion.mergeCommitSha, before.completion.mainSha]);
        run("git", ["switch", "--detach", before.completion.mainSha]);
      }
      requirePreservedSubjectTerminalProjection({
        canonicalRoot,
        subjectPath,
        subject: plan.evidence.subject,
        lease: before,
      });
      summary = {
        completedBranch: before.branch,
        pullRequestUrl: before.pullRequestUrl,
        mergeCommitSha: before.completion.mergeCommitSha,
        mainSha: before.completion.mainSha,
        status: "runtime_pending",
      };
    } else {
      if (writerLeaseDigest(before) !== plan.evidence.subject.leaseDigest) {
        throw new Error("Completion delivery lease drifted from the sealed plan.");
      }
      const sealedRun = (binary, args, options = {}) => {
        if (binary === "git" && args.length === 3
          && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          if (readProtectedMain({
            canonicalRoot,
            recovery: plan.evidence.recovery,
            target,
          }) !== completionTargetMain) {
            throw new Error("Completion fetch boundary observed a new protected main.");
          }
          return undefined;
        }
        return run(binary, args, options);
      };
      summary = completeSessionEffect({
        invocationPath: subjectPath,
        repo: subjectPath,
        gitText,
        ghText,
        leaseStore,
        run: sealedRun,
        log: () => {},
        json: true,
        finalize: false,
      });
    }
    const after = currentSubjectLease({ allowTerminal: false });
    if (after.status !== "completing"
      || summary.status !== "runtime_pending"
      || summary.mainSha !== completionTargetMain
      || summary.mergeCommitSha !== plan.evidence.subject.malformedCommit.sha
      || after.completion?.mergeCommitSha !== summary.mergeCommitSha
      || after.completion?.mainSha !== summary.mainSha) {
      throw new Error("Local completion projection did not reach the exact completing state.");
    }
    if (git(subjectPath, ["rev-parse", `refs/heads/${before.branch}`]) !== authoredBranchBefore
      || git(subjectPath, ["rev-parse", `${authoredBranchBefore}^{tree}`]) !== authoredTreeBefore
      || authoredBranchBefore !== plan.evidence.subject.reviewedHeadSha
      || authoredTreeBefore !== plan.evidence.subject.reviewedTreeSha) {
      throw new Error("Completion projection changed the preserved authored branch or tree.");
    }
    return Object.freeze({
      disposition: before.status === "delivery" ? "projected" : "adopted",
      mainSha: summary.mainSha,
      completionBaseSha: plan.evidence.canonical.protectedMainSha,
      completionTopologyDigest: digestValue({
        baseSha: plan.evidence.canonical.protectedMainSha,
        targetSha: summary.mainSha,
        relation: "protected-descendant",
      }),
      completingLeaseDigest: writerLeaseDigest(after),
      taskAuthorizationReceiptDigest: authorization.receiptDigest,
      taskAuthorizationReceipt: authorization,
      completionSummary: summary,
    });
  }

  function requireActiveFence() {
    if (!activeFence) throw new Error("Recovery effect requires its live reviewed-lane fence.");
    assertEntrypointFence({ fence: activeFence, leaseStore });
  }

  function readSubjectTerminalCloud({ plan }) {
    if (typeof dependencies.readSubjectTerminalCloud === "function") {
      return dependencies.readSubjectTerminalCloud({ plan });
    }
    return readExactRetiredClaim({
      ghText,
      ledgerRepository: ledger,
      claimId: plan.evidence.subject.claimId,
      expected: exactRetiredClaimExpectation({
        ghText,
        pullRequest: plan.evidence.subject.pullRequest,
        branch: plan.evidence.subject.branch,
        sessionId: plan.evidence.subject.sessionId,
        device: plan.evidence.subject.cloudAuthority.deviceId,
        cloudAuthority: plan.evidence.subject.cloudAuthority,
        laneRevision: plan.evidence.subject.reviewedHeadSha,
        predecessorAuthority: plan.evidence.subject.predecessorAuthority,
      }),
    });
  }

  function requireSealedPreRetirementProjection({ plan }) {
    const first = observe({ observedAt: plan.evidence.observedAt });
    const second = observe({ observedAt: plan.evidence.observedAt });
    assertCanonicalSquashRecoveryPreRetirementProjection({
      sealedEvidence: plan.evidence,
      firstEvidence: first,
      secondEvidence: second,
    });
  }

  function verifyTerminal({ plan, journal }) {
    const currentController = requireController({ controller, targetRepository: target });
    assertCanonicalSquashRecoveryControllerProjection({
      plan,
      currentController,
    });
    requirePlanRunsCurrent({ plan, ghText, target });
    const projected = journal.state.receipts["completion-projected"];
    const lease = currentSubjectLease({ allowTerminal: true });
    const liveProtectedMain = readProtectedMain({
      canonicalRoot,
      recovery: plan.evidence.recovery,
      target,
    });
    assertExactCanonicalSquashRecoveryTerminalLeaseIdentity({
      lease,
      subject: plan.evidence.subject,
    });
    requireProtectedDescendantRevision({
      canonicalRoot,
      recovery: plan.evidence.recovery,
      baseSha: projected.completionBaseSha,
      targetSha: projected.mainSha,
      target,
      readProtectedMain,
    });
    assertCanonicalSquashRecoveryTerminalMainTopology({
      status: lease.status,
      projectedMainSha: projected.mainSha,
      leaseMainSha: lease.completion?.mainSha,
      protectedMainSha: liveProtectedMain,
      isAncestorRevision: (ancestor, descendant) =>
        isAncestor(canonicalRoot, ancestor, descendant),
    });
    if (lease.status === "completing") {
      if (writerLeaseDigest(lease) !== projected.completingLeaseDigest) {
        throw new Error("Completion-ready lease digest drifted from its durable projection.");
      }
    } else {
      requireProtectedDescendantRevision({
        canonicalRoot,
        recovery: plan.evidence.recovery,
        baseSha: projected.mainSha,
        targetSha: lease.completion?.mainSha,
        target,
        readProtectedMain,
      });
      if (!isAncestor(canonicalRoot, lease.completion.mainSha, liveProtectedMain)) {
        throw new Error("Completed lease main is not retained by protected main.");
      }
    }
    const authored = requirePreservedSubjectTerminalProjection({
      canonicalRoot,
      subjectPath,
      subject: plan.evidence.subject,
      lease,
    });
    if (authored.worktree === "present") {
      const expectedHead = lease.status === "completing"
        ? projected.mainSha
        : lease.completion.mainSha;
      if (git(subjectPath, ["branch", "--show-current"]) !== ""
        || git(subjectPath, ["rev-parse", "HEAD"]) !== expectedHead
        || git(subjectPath, ["status", "--porcelain"]) !== "") {
        throw new Error("Completion-ready worktree projection drifted.");
      }
    } else if (lease.status !== "completed") {
      throw new Error("Only an exact completed lease may replay after worktree cleanup.");
    }
    const pull = readTerminalPullRequest(ghText, target, subjectNumber);
    requireSamePull(pull, plan.evidence.subject.pullRequest, "terminal subject");
    const cloud = readSubjectTerminalCloud({ plan });
    const terminalCloudDigest = digestValue(cloud);
    if (terminalCloudDigest
      !== journal.state.receipts["cloud-retired"].terminalCloudDigest) {
      throw new Error("Live cloud retirement does not join its durable operation receipt.");
    }
    const recoveryTerminal = readRecoveryTerminal({
      leaseStore,
      canonicalRoot,
      recovery: plan.evidence.recovery,
      ghText,
      ledgerRepository: ledger,
    });
    if (digestValue(recoveryTerminal) !== digestValue(plan.evidence.recovery.terminal)) {
      throw new Error("Recovery terminal projection drifted from the sealed evidence.");
    }
    const core = {
      schema: "agentic-canonical-squash-attribution-recovery-terminal-evidence/v1",
      status: "completion-ready",
      planDigest: plan.planDigest,
      evidenceDigest: plan.evidence.evidenceDigest,
      subject: {
        branch: plan.evidence.subject.branch,
        reviewedHeadSha: plan.evidence.subject.reviewedHeadSha,
        reviewedTreeSha: plan.evidence.subject.reviewedTreeSha,
        authoredBranchSha: authored.branchSha,
        authoredTreeSha: authored.treeSha,
        mergeSha: plan.evidence.subject.malformedCommit.sha,
        pullRequestIdentityDigest: stablePullIdentityDigest(pull),
      },
      cloud: {
        status: "retired",
        claimId: plan.evidence.subject.claimId,
        terminalStateDigest: terminalCloudDigest,
      },
      completion: {
        status: "completion-ready-or-completed",
        mainSha: projected.mainSha,
        completingLeaseDigest: projected.completingLeaseDigest,
      },
      recovery: {
        status: "completed-and-cleaned",
        mergeSha: plan.evidence.recovery.mergeSha,
        terminalStateDigest: digestValue(recoveryTerminal),
      },
      effects: {
        cloudClaim: "retired",
        localLease: "completion-ready",
        worktreeProjection: "detached-canonical-or-terminally-cleaned",
        authoredSourceBytes: "unchanged",
        authoredTree: "unchanged",
        authoredBranchRef: "unchanged",
        pullRequest: "unchanged",
        autoMerge: "unchanged",
        newClaims: "none",
        runtime: "not-performed",
        cleanup: "not-performed-by-this-controller",
        release: "not-performed",
        deployment: "not-performed",
      },
      continuation: "device:integrate",
    };
    return Object.freeze({
      terminalEvidence: Object.freeze(core),
      terminalEvidenceDigest: digestValue(core),
    });
  }

  return Object.freeze({
    withOperationLock: journalStore.withLock,
    readJournal: journalStore.read,
    writeJournal: journalStore.write,
    observe,
    verifyEvidence,
    withLaneFence,
    retireCloud,
    projectCompletion,
    verifyTerminal,
  });
}

function requireSubjectEvidence({
  canonicalRoot,
  lease,
  subjectPath,
  pullRequest,
  ghText,
  controllerRepository,
}) {
  requireMergedPull(pullRequest, lease.pullRequestUrl, lease.branch);
  const genericSelfHosted = lease.cloudAuthority?.targetRepository === controllerRepository;
  const deliveryProfile = normalizeCanonicalSquashRecoveryDeliveryProfile(lease, {
    genericSelfHosted,
  });
  if (lease.status !== "delivery"
    || !lease.taskAuthority || !lease.admission || !lease.cloudAuthority
    || lease.cloudAuthority.state !== "delivery_authorized"
    || lease.cloudAuthority.deviceId !== lease.device
    || !lease.cloudAuthority.integrationReceiptDigest
    || lease.deliveryHeadSha !== pullRequest.headSha
    || (!genericSelfHosted && lease.integration?.commitSha !== pullRequest.headSha)) {
    throw new Error("Subject lease is not the exact integrated delivery lane.");
  }
  const leaseIdentity = canonicalSquashRecoveryImmutableLeaseProjection(lease, {
    genericSelfHosted,
  });
  const parkedStashes = git(subjectPath, ["stash", "list", "--format=%gs"])
    .split("\n").filter(subject => subject.includes(`park: ${lease.branch} `));
  if (parkedStashes.length !== 0) {
    throw new Error("Canonical squash recovery does not authorize a parked stash.");
  }
  const head = git(subjectPath, ["rev-parse", "HEAD"]);
  const branch = git(subjectPath, ["branch", "--show-current"]);
  if (branch !== lease.branch || head !== pullRequest.headSha
    || git(subjectPath, ["status", "--porcelain"]) !== "") {
    throw new Error("Subject worktree is not clean on its exact reviewed head.");
  }
  const reviewedTreeSha = git(subjectPath, ["rev-parse", `${head}^{tree}`]);
  if (deliveryProfile.profile === LEGACY_ADMISSION_CONTINUATION_PROFILE) {
    assertCanonicalSquashRecoveryLegacyContinuationTopology({
      lease,
      reviewedHeadSha: head,
      fenceTreeSha: git(subjectPath, ["rev-parse", `${lease.fenceSha}^{tree}`]),
      isAncestorRevision: (ancestor, descendant) =>
        isAncestor(canonicalRoot, ancestor, descendant),
    });
  }
  const remoteBranchRevision = lsRemoteOptional(
    canonicalRoot,
    `refs/heads/${lease.branch}`,
  );
  if (remoteBranchRevision !== null && remoteBranchRevision !== head) {
    throw new Error("Subject remote branch drifted from its exact reviewed head.");
  }
  const reviewed = gitCommit(canonicalRoot, head);
  const malformed = gitCommit(canonicalRoot, pullRequest.mergeSha);
  const providerMalformed = readProviderCommit({
    repository: lease.cloudAuthority.targetRepository,
    revision: malformed.sha,
    ghText,
  });
  requireProviderCommitJoin(providerMalformed, malformed, "subject malformed commit");
  const genericManaged = genericSelfHosted
    ? exactGenericManagedIntegrationBody({
      message: reviewed.message,
      headline: lease.integration.commitMessage,
      scope: lease.scope,
    })
    : null;
  const expectedBody = genericManaged?.body
    ?? renderProtectedSquashCommitBody({ branch: lease.branch, lease });
  const expectedReviewedMessage = `${lease.integration.commitMessage}\n\n${expectedBody}`;
  const sourceCommits = git(canonicalRoot, [
    "rev-list", "--reverse", `${lease.baseSha}..${head}`,
  ]).split("\n").filter(Boolean);
  if (sourceCommits.length < 1) {
    throw new Error("Subject source history has no admitted reviewed delta.");
  }
  const sourceHistorySubjects = sourceCommits.map(revision =>
    exactCommitSubject(canonicalRoot, revision));
  const reviewedChanges = exactTreeChanges(canonicalRoot, lease.baseSha, head);
  const pinTransition = optionalRuntimeReadinessPinTransition({
    root: canonicalRoot,
    baseSha: lease.baseSha,
    headSha: head,
    changes: reviewedChanges,
    targetRepository: lease.cloudAuthority.targetRepository,
    controllerRepository,
  });
  if (genericSelfHosted !== (pinTransition === null)) {
    throw new Error("Subject generic repository classification drifted.");
  }
  if (genericSelfHosted) {
    requireExactOwnedRegularPaths({
      changes: reviewedChanges,
      integrationPaths: lease.integration.paths,
      admission: lease.admission,
      cloudAuthority: lease.cloudAuthority,
      label: "generic subject",
    });
  }
  const sourceCommitAuthors = genericSelfHosted
    ? uniqueCommitAuthors(sourceCommits.map(revision => exactCommitAuthor(canonicalRoot, revision)))
    : null;
  const attributionTrailers = genericSelfHosted
    && deliveryProfile.profile === STANDARD_AUTO_DELIVERY_PROFILE
    ? sourceCommitAuthors.map(author => `Co-authored-by: ${author.name} <${author.email}>`)
    : genericSelfHosted
      ? []
      : ["Co-authored-by: knowgrph-lifecycle[bot] <knowgrph-lifecycle[bot]@users.noreply.github.com>"];
  const sourceCommitProviderActors = Object.freeze([
    LEGACY_ADMISSION_CONTINUATION_PROFILE,
    CLOSED_PR834_STANDARD_TERMINAL_ATTRIBUTION_PROFILE,
  ].includes(deliveryProfile.profile)
    ? sourceCommits.map(revision => readProviderCommitActors({
      repository: lease.cloudAuthority.targetRepository,
      revision,
      ghText,
    }))
    : []);
  const sourceSubjects = genericSelfHosted
    ? assertCanonicalSquashRecoveryMalformedProviderMessage({
      profile: deliveryProfile.profile,
      message: malformed.message,
      headline: lease.integration.commitMessage,
      expectedBody,
      attributionTrailers,
      sourceHistorySubjects,
      sourceCommitRevisions: sourceCommits,
      pullRequest,
      sourceCommitProviderActors,
    })
    : sourceHistorySubjects;
  const protectedRefresh = genericSelfHosted
    ? exactGenericProtectedRefresh({
      root: canonicalRoot,
      lease,
      reviewed,
      reviewedChanges,
      expectedReviewedMessage,
    })
    : null;
  const predecessorAuthority = genericSelfHosted
    ? readGenericSuccessorPredecessorAuthority({
      ghText,
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      lease,
      historicalLeaseEpoch: genericManaged.leaseEpoch,
    })
    : undefined;
  const expectedMessage = genericSelfHosted ? null : [
    lease.integration.commitMessage,
    "",
    ...sourceSubjects.flatMap((subject, index) =>
      index === 0 ? [`* ${subject}`] : ["", `* ${subject}`]),
    "",
    expectedBody,
    "",
    "---------",
    "",
    ...attributionTrailers,
  ].join("\n");
  if (malformed.treeSha !== reviewedTreeSha
    || reviewed.treeSha !== reviewedTreeSha
    || reviewed.message !== expectedReviewedMessage
    || reviewed.objectMessageTerminalLf !== true
    || (!genericSelfHosted && lease.integration.treeSha !== reviewedTreeSha)
    || malformed.parentShas.length !== 1
    || malformed.parentShas[0] !== lease.baseSha
    || (!genericSelfHosted && malformed.message !== expectedMessage)
    || (!genericSelfHosted && hasExactFinalManagedTrailers(malformed.message))
    || (!genericSelfHosted && finalTrailerBlock(malformed.message).join("\n")
      !== attributionTrailers.join("\n"))
    || reviewedChanges.length !== lease.integration.paths.length
    || reviewedChanges.some((entry, index) => entry.path !== lease.integration.paths[index])) {
    throw new Error("Subject canonical commit is not the exact provider attribution rewrite.");
  }
  return Object.freeze({
    repository: lease.cloudAuthority.targetRepository,
    worktreePath: subjectPath,
    branch: lease.branch,
    sessionId: lease.sessionId,
    scope: lease.scope,
    leaseDigest: writerLeaseDigest(lease),
    leaseIdentity,
    leaseIdentityDigest: digestValue(leaseIdentity),
    taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
    taskAuthority: Object.freeze(normalizeTaskAuthorityBinding(lease.taskAuthority)),
    claimId: lease.cloudAuthority.claimId,
    claimDigest: lease.cloudAuthority.claimDigest,
    integrationReceiptDigest: lease.cloudAuthority.integrationReceiptDigest,
    cloudAuthority: structuredClone(lease.cloudAuthority),
    deliveryEvidence: {
      dependencyClosureDigest: lease.cloudAuthority.integration.dependencyClosureDigest,
      namedChecksDigest: lease.cloudAuthority.integration.namedChecksDigest,
      handoffEvidenceDigest: lease.cloudAuthority.integration.handoffEvidenceDigest,
      operatorDecisionDigest: lease.cloudAuthority.integration.operatorDecisionDigest,
      integrationIntentDigest: lease.cloudAuthority.integration.integrationIntentDigest,
    },
    reviewedHeadSha: head,
    reviewedTreeSha,
    remoteBranch: remoteBranchRevision || "absent",
    reviewedCommit: {
      sha: reviewed.sha,
      treeSha: reviewed.treeSha,
      messageDigest: digestValue(reviewed.message),
      objectMessageByteLength: reviewed.objectMessageByteLength,
      objectMessageSha256: reviewed.objectMessageSha256,
      objectMessageTerminalLf: reviewed.objectMessageTerminalLf,
    },
    pullRequest,
    expectedSquashHeadline: lease.integration.commitMessage,
    malformedCommit: {
      sha: malformed.sha,
      parentSha: malformed.parentShas[0],
      treeSha: malformed.treeSha,
      messageDigest: digestValue(malformed.message),
      objectMessageByteLength: malformed.objectMessageByteLength,
      objectMessageSha256: malformed.objectMessageSha256,
      objectMessageTerminalLf: malformed.objectMessageTerminalLf,
      classification: deliveryProfile.profile === STANDARD_AUTO_DELIVERY_PROFILE
        ? "provider-rewritten-nonterminal-attribution"
        : "provider-rewritten-terminal-attribution-body-mismatch",
    },
    changedEntries: reviewedChanges,
    changedPaths: [...lease.integration.paths],
    pinTransition,
    sourceCommitSubjects: sourceSubjects,
    ...(genericSelfHosted ? {
      sourceCommitAuthors,
      protectedRefresh,
      historicalLeaseEpoch: genericManaged.leaseEpoch,
      predecessorAuthority,
    } : {}),
    ...([LEGACY_ADMISSION_CONTINUATION_PROFILE,
      CLOSED_PR834_STANDARD_TERMINAL_ATTRIBUTION_PROFILE]
      .includes(deliveryProfile.profile) ? {
      sourceCommitProviderActors,
    } : {}),
  });
}

function requireRecoveryEvidence({
  canonicalRoot, controllerRoot, controllerEvidence, evidencePath,
  recoveryCleanupReceiptDigest,
  recoveryPr, recoveryLease, subject, target, ghText,
}) {
  requireMergedPull(recoveryPr, recoveryPr.url, recoveryPr.headBranch);
  const recovery = gitCommit(canonicalRoot, recoveryPr.mergeSha);
  const source = gitCommit(canonicalRoot, recoveryPr.headSha);
  const providerRecovery = readProviderCommit({
    repository: target,
    revision: recovery.sha,
    ghText,
  });
  requireProviderCommitJoin(providerRecovery, recovery, "recovery protected commit");
  const genericSelfHosted = subject.pinTransition === null;
  if (recovery.parentShas.length !== 1 || recovery.parentShas[0] !== recoveryPr.baseSha
    || recovery.treeSha !== source.treeSha) {
    throw new Error("Recovery is not one exact protected squash over its reviewed base.");
  }
  if (genericSelfHosted) {
    if (target !== controllerEvidence.repository
      || !isAncestor(canonicalRoot, subject.malformedCommit.sha, recovery.parentShas[0])) {
      throw new Error("Generic recovery is not a protected self-hosted subject descendant.");
    }
  } else if (recovery.parentShas[0] !== subject.malformedCommit.sha) {
    throw new Error("Recovery is not the exact one-parent protected child of the failed merge.");
  }
  const changes = exactTreeChanges(canonicalRoot, recovery.parentShas[0], recovery.sha);
  const genericRecoveryVariant = genericSelfHosted
    ? classifyGenericRecoveryVariant({ changes, evidencePath, subject })
    : null;
  if (!genericSelfHosted && (changes.length !== 1 || changes[0].status !== "A"
    || changes[0].path !== evidencePath || changes[0].oldMode !== "000000"
    || changes[0].newMode !== "100644")) {
    throw new Error("Recovery must add exactly its one evidence document.");
  }
  const sourceBlob = gitBlobAt(canonicalRoot, source.sha, evidencePath);
  const mergeBlob = gitBlobAt(canonicalRoot, recovery.sha, evidencePath);
  const evidenceChanges = changes.filter(entry => entry.path === evidencePath);
  if (sourceBlob.mode !== "100644" || mergeBlob.mode !== "100644"
    || sourceBlob.sha !== mergeBlob.sha
    || !sourceBlob.bytes.equals(mergeBlob.bytes)
    || evidenceChanges.length !== 1
    || evidenceChanges[0].newBlob !== mergeBlob.sha) {
    throw new Error("Recovery evidence source and protected blobs do not match exactly.");
  }
  const bytes = mergeBlob.bytes;
  const frontmatterFields = genericRecoveryVariant === "self-hosted-controller-update"
    ? GENERIC_SELF_HOSTED_RECOVERY_FRONTMATTER
    : genericRecoveryVariant === "evidence-document"
      ? GENERIC_EVIDENCE_RECOVERY_FRONTMATTER
      : RECOVERY_FRONTMATTER;
  const frontmatter = parseFrontmatter(bytes.toString("utf8"), frontmatterFields);
  const controllerRevision = genericRecoveryVariant === "self-hosted-controller-update"
    ? recovery.sha
    : frontmatter.controller_revision;
  const expected = genericRecoveryVariant === "self-hosted-controller-update"
    ? expectedGenericSelfHostedFrontmatter()
    : genericRecoveryVariant === "evidence-document"
      ? expectedGenericEvidenceFrontmatter({ frontmatter, subject, controllerEvidence })
      : expectedLegacyRecoveryFrontmatter({ frontmatter, subject, controllerEvidence });
  for (const name of frontmatterFields) {
    if (frontmatter[name] !== expected[name]) {
      throw new Error(`Recovery frontmatter ${name} does not bind the subject.`);
    }
  }
  if ((genericRecoveryVariant === "self-hosted-controller-update"
    && (controllerRevision !== controllerEvidence.revision
      || recovery.treeSha !== controllerEvidence.tree))
    || (genericRecoveryVariant !== "self-hosted-controller-update"
      && !isAncestor(controllerRoot, controllerRevision, controllerEvidence.revision))) {
    throw new Error("Recovery controller revision is not an ancestor of the protected controller.");
  }
  const reviewedRunId = genericRecoveryVariant === "self-hosted-controller-update"
    ? null
    : exactDeclaredRunId(frontmatter.reviewed_run_id, "reviewed run ID");
  const postMergeRunId = genericRecoveryVariant === "self-hosted-controller-update"
    ? null
    : exactDeclaredRunId(frontmatter.post_merge_run_id, "post-merge run ID");
  const subjectChecks = [
    newestTerminalIntegrationRun(ghText, target, subject.reviewedHeadSha,
      "pull_request", subject.pullRequest.headBranch,
      reviewedRunId,
      "subject reviewed-head run", genericSelfHosted
        ? SELF_HOSTED_CI_RUN_PROFILE
        : LEGACY_INTEGRATION_RUN_PROFILE),
    newestTerminalIntegrationRun(ghText, target, subject.malformedCommit.sha,
      "push", "main", postMergeRunId, "subject post-merge run",
      genericSelfHosted ? SELF_HOSTED_CI_RUN_PROFILE : LEGACY_INTEGRATION_RUN_PROFILE),
  ];
  const recoveryChecks = [
    selectedPullRequestIntegrationRun(ghText, target, recoveryPr,
      genericSelfHosted ? SELF_HOSTED_CI_RUN_PROFILE : LEGACY_INTEGRATION_RUN_PROFILE),
    newestTerminalIntegrationRun(ghText, target, recoveryPr.mergeSha, "push", "main",
      null, "recovery push run", genericSelfHosted
        ? SELF_HOSTED_CI_RUN_PROFILE
        : LEGACY_INTEGRATION_RUN_PROFILE),
  ];
  const recoveryScope = scopeFromBranch(recoveryPr.headBranch);
  if (!recoveryLease || recoveryLease.branch !== recoveryPr.headBranch
    || recoveryLease.scope !== recoveryScope || recoveryLease.status !== "completed"
    || !Number.isSafeInteger(recoveryLease.cloudAuthority?.leaseEpoch)
    || recoveryLease.cloudAuthority.leaseEpoch < 1
    || recoveryLease.pullRequestUrl !== recoveryPr.url) {
    throw new Error("Recovery attribution epoch is not bound to its exact completed lane.");
  }
  if (genericSelfHosted) {
    requireExactOwnedRegularPaths({
      changes,
      integrationPaths: exactGenericCompletedRecoveryPaths({
        lease: recoveryLease,
        sourceHeadSha: source.sha,
      }),
      admission: recoveryLease.admission,
      cloudAuthority: recoveryLease.cloudAuthority,
      label: `generic ${genericRecoveryVariant} recovery`,
      allowEvidenceAddition: genericRecoveryVariant === "evidence-document",
    });
  }
  const recoveryBody = renderProtectedSquashCommitBody({
    branch: recoveryPr.headBranch,
    lease: recoveryLease,
  });
  const recoveryTitle = source.message.split("\n")[0];
  const recoveryTrailers = recoveryBody.split("\n").slice(2).join("\n");
  const legacySourceMessage = [
    recoveryTitle,
    "",
    `Record the immutable PR${subject.pullRequest.number} provider-generated squash-attribution failure and the append-only protected recovery boundary.`,
    "",
    recoveryTrailers,
  ].join("\n");
  const standardMessage = `${recoveryTitle}\n\n${recoveryBody}`;
  const genericEvidenceProviderMessage = genericRecoveryVariant === "evidence-document"
    ? exactProviderGeneratedMessage({
      root: canonicalRoot,
      baseSha: recoveryPr.baseSha,
      headSha: recoveryPr.headSha,
      headline: recoveryTitle,
      expectedBody: recoveryBody,
      message: recovery.message,
      pullRequest: recoveryPr,
    })
    : null;
  const messagesValid = genericRecoveryVariant === "evidence-document"
    ? source.message === standardMessage
      && recovery.message === genericEvidenceProviderMessage
      && hasExactFinalManagedTrailers(source.message)
      && !hasExactFinalManagedTrailers(recovery.message)
    : genericRecoveryVariant === "self-hosted-controller-update"
      ? source.message === standardMessage && recovery.message === standardMessage
        && hasExactFinalManagedTrailers(source.message)
        && hasExactFinalManagedTrailers(recovery.message)
      : source.message === legacySourceMessage && recovery.message === standardMessage
        && hasExactFinalManagedTrailers(source.message)
        && hasExactFinalManagedTrailers(recovery.message);
  if (!messagesValid || source.objectMessageTerminalLf !== true
    || recovery.objectMessageTerminalLf !== false) {
    throw new Error("Recovery canonical commit lacks its exact final attribution block.");
  }
  return Object.freeze({
    subjectChecks,
    subjectChecksDigest: digestValue(subjectChecks),
    pullRequest: recoveryPr,
    sourceHeadSha: source.sha,
    sourceTreeSha: source.treeSha,
    sourceCommitMessageDigest: digestValue(source.message),
    sourceObjectMessageByteLength: source.objectMessageByteLength,
    sourceObjectMessageSha256: source.objectMessageSha256,
    sourceObjectMessageTerminalLf: source.objectMessageTerminalLf,
    mergeSha: recovery.sha,
    parentSha: recovery.parentShas[0],
    treeSha: recovery.treeSha,
    commitMessageDigest: digestValue(recovery.message),
    commitObjectMessageByteLength: recovery.objectMessageByteLength,
    commitObjectMessageSha256: recovery.objectMessageSha256,
    commitObjectMessageTerminalLf: recovery.objectMessageTerminalLf,
    evidencePath,
    evidenceBlobSha: mergeBlob.sha,
    evidenceBlobDigest: sha256(bytes),
    evidenceContentDigest: digestValue(bytes.toString("utf8")),
    frontmatterDigest: digestValue(frontmatter),
    controllerRevision,
    checks: recoveryChecks,
    checksDigest: digestValue(recoveryChecks),
    cleanupReceiptDigest: recoveryCleanupReceiptDigest,
    changedEntries: changes,
    changedPaths: changes.map(entry => entry.path),
    ...(genericSelfHosted ? {
      genericRecoveryVariant,
      subjectAncestorOfRecoveryParent: true,
    } : {}),
    deploymentAuthority: "forbidden",
  });
}

function requireController({ controller, targetRepository }) {
  const revision = git(controller, ["rev-parse", "HEAD"]);
  const branch = git(controller, ["branch", "--show-current"]);
  const origin = git(controller, ["rev-parse", "origin/main"]);
  const remote = lsRemote(controller, "refs/heads/main");
  if (branch !== "main" || revision !== origin || revision !== remote
    || git(controller, ["status", "--porcelain"]) !== "") {
    throw new Error("Controller root is not clean exact protected main.");
  }
  const repository = remoteRepository(controller);
  if (repository !== "huijoohwee/agentic-canvas-os") {
    throw new Error("Controller repository identity is invalid.");
  }
  return Object.freeze({
    repository,
    revision,
    tree: git(controller, ["rev-parse", `${revision}^{tree}`]),
    targetRepository,
  });
}

function requireRecoveryTerminalProjection({
  leaseStore, canonicalRoot, recovery, ghText, ledgerRepository, target,
}) {
  const branch = recovery.pullRequest.headBranch;
  const lease = leaseStore.read(branch);
  const recoveryTaskAuthority =
    assertExactCanonicalSquashRecoveryCompletedTaskAuthority(lease);
  const remoteBranchRevision = lsRemoteOptional(canonicalRoot, `refs/heads/${branch}`);
  const registered = git(canonicalRoot, ["worktree", "list", "--porcelain"])
    .split("\n\n").some(record => {
      const lines = record.split("\n");
      return lines[0] === `worktree ${lease?.worktreePath}`
        || lines.includes(`branch refs/heads/${branch}`);
    });
  const completionMainSha = lease?.completion?.mainSha;
  const protectedMainSha = requireProtectedMain({ canonicalRoot, recovery, target });
  const completionContainsEvidence = SHA.test(String(completionMainSha || ""))
    && isAncestor(canonicalRoot, recovery.mergeSha, completionMainSha)
    && isAncestor(canonicalRoot, completionMainSha, protectedMainSha)
    && gitBlobAt(canonicalRoot, completionMainSha, recovery.evidencePath).sha
      === recovery.evidenceBlobSha;
  assertCanonicalSquashRecoveryCompletedRecoveryHeadProjection({
    lease,
    recovery,
    genericSelfHosted: recovery.genericRecoveryVariant !== undefined,
  });
  if (!lease || lease.status !== "completed" || registered
    || filesystemEntryState(lease.worktreePath, "recovery worktree") !== "absent"
    || lease.pullRequestUrl !== recovery.pullRequest.url
    || lease.completion?.mergeCommitSha !== recovery.mergeSha
    || !completionContainsEvidence
    || lease.cloudAuthority?.reviewRequestId
      !== `github-pull-request:${recovery.pullRequest.nodeId}`
    || git(canonicalRoot, ["rev-parse", `refs/heads/${branch}`]) !== recovery.sourceHeadSha
    || (remoteBranchRevision !== null && remoteBranchRevision !== recovery.sourceHeadSha)) {
    throw new Error("Recovery terminal projection does not bind its exact cleanup boundary.");
  }
  const managedContainerRoot = path.dirname(lease.worktreePath);
  const sharedContainerRoot = path.dirname(managedContainerRoot);
  const recomputedCleanupOperationId = createWorktreeCleanupOperationId({
    repository: canonicalRoot,
    gitCommonDir: git(canonicalRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    targetPath: lease.worktreePath,
    completionMainSha,
    preservedBranch: branch,
    managedContainer: { root: managedContainerRoot },
    sharedContainer: { root: sharedContainerRoot },
  });
  if (recomputedCleanupOperationId !== recovery.cleanupReceiptDigest) {
    throw new Error("Recovery cleanup operation identity does not recompute exactly.");
  }
  const terminalCloud = readExactRetiredClaim({
    ghText,
    ledgerRepository,
    claimId: lease.cloudAuthority.claimId,
    expected: exactRetiredClaimExpectation({
      ghText,
      pullRequest: recovery.pullRequest,
      branch,
      sessionId: lease.sessionId,
      device: lease.device,
      cloudAuthority: lease.cloudAuthority,
      laneRevision: recovery.sourceHeadSha,
    }),
  });
  const taskCompletionCore = {
    status: "completed-lease-bound",
    authoritySubjectId: required(
      recoveryTaskAuthority.authoritySubjectId,
      "recovery task authority subject",
    ),
    proofAdapterId: required(
      recoveryTaskAuthority.proofAdapterId,
      "recovery task proof adapter",
    ),
    generation: positive(recoveryTaskAuthority.generation, "recovery task generation"),
    bindingDigest: requiredDigest(
      recoveryTaskAuthority.bindingDigest,
      "recovery task binding digest",
    ),
    laneBindingDigest: requiredDigest(
      recoveryTaskAuthority.laneBindingDigest,
      "recovery task lane binding digest",
    ),
    publicKeyDigest: requiredDigest(
      recoveryTaskAuthority.publicKeyDigest,
      "recovery task public key digest",
    ),
    completedLeaseDigest: writerLeaseDigest(lease),
  };
  return Object.freeze({
    status: "completed-and-cleaned",
    branch,
    sessionId: lease.sessionId,
    scope: lease.scope,
    completedLeaseDigest: writerLeaseDigest(lease),
    taskAuthorityBindingDigest: recoveryTaskAuthority.bindingDigest,
    taskCompletion: Object.freeze({
      ...taskCompletionCore,
      evidenceDigest: digestValue(taskCompletionCore),
    }),
    claimId: lease.cloudAuthority.claimId,
    claimDigest: lease.cloudAuthority.claimDigest,
    terminalCloud,
    completion: lease.completion,
    cleanupReceiptDigest: recomputedCleanupOperationId,
    worktree: "absent",
    branchRef: "preserved",
    remoteBranch: "absent-or-preserved-exact",
  });
}

export function assertCanonicalSquashRecoveryCompletedRecoveryHeadProjection({
  lease,
  recovery,
  genericSelfHosted,
}) {
  const exact = genericSelfHosted === true
    ? ((lease?.reviewHeadSha ?? null) === null
      && lease?.deliveryHeadSha === recovery?.sourceHeadSha)
      || ((lease?.integration ?? null) === null
        && lease?.reviewHeadSha === recovery?.sourceHeadSha
        && (lease?.deliveryHeadSha ?? null) === null)
    : lease?.reviewHeadSha === recovery?.sourceHeadSha;
  if (!exact) {
    throw new Error("Recovery terminal projection does not bind its exact reviewed head.");
  }
  return true;
}

export function assertExactCanonicalSquashRecoveryCompletedTaskAuthority(lease) {
  if (lease?.status !== "completed") {
    throw new Error("Recovery terminal task authority requires its completed lease.");
  }
  try {
    return assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  } catch {
    throw new Error("Recovery terminal task authority does not bind its completed lease.");
  }
}

function requireProtectedMain({ canonicalRoot, recovery, target }) {
  if (git(canonicalRoot, ["branch", "--show-current"]) !== "main"
    || git(canonicalRoot, ["status", "--porcelain"]) !== "") {
    throw new Error("Canonical target checkout is not clean main.");
  }
  const head = git(canonicalRoot, ["rev-parse", "HEAD"]);
  const origin = git(canonicalRoot, ["rev-parse", "origin/main"]);
  const remote = lsRemote(canonicalRoot, "refs/heads/main");
  if (head !== origin || head !== remote || remoteRepository(canonicalRoot) !== target
    || !isAncestor(canonicalRoot, recovery.mergeSha, head)
    || gitBlobAt(canonicalRoot, head, recovery.evidencePath).sha !== recovery.evidenceBlobSha) {
    throw new Error("Canonical protected main does not contain the exact recovery.");
  }
  return head;
}

function requireProtectedDescendantRevision({
  canonicalRoot,
  recovery,
  baseSha,
  targetSha,
  target,
  readProtectedMain = input => requireProtectedMain(input),
}) {
  const liveProtectedMain = readProtectedMain({ canonicalRoot, recovery, target });
  return assertCanonicalSquashRecoveryCompletionTopology({
    baseSha,
    targetSha,
    protectedMainSha: liveProtectedMain,
    recoverySha: recovery.mergeSha,
    recoveryBlobMatches:
      gitBlobAt(canonicalRoot, targetSha, recovery.evidencePath).sha
        === recovery.evidenceBlobSha,
    isAncestorRevision: (ancestor, descendant) =>
      isAncestor(canonicalRoot, ancestor, descendant),
  });
}

export function assertCanonicalSquashRecoveryControllerProjection({
  plan,
  currentController,
}) {
  const sealed = plan?.evidence?.controller;
  if (digestValue(currentController) !== digestValue(sealed)) {
    throw new Error("Recovery controller drifted from the sealed protected revision.");
  }
  return true;
}

export function assertCanonicalSquashRecoveryCompletionTopology({
  baseSha,
  targetSha,
  protectedMainSha,
  recoverySha,
  recoveryBlobMatches,
  isAncestorRevision,
}) {
  if (![baseSha, targetSha, protectedMainSha, recoverySha]
    .every(value => SHA.test(String(value || "")))
    || typeof isAncestorRevision !== "function"
    || recoveryBlobMatches !== true
    || !isAncestorRevision(baseSha, targetSha)
    || !isAncestorRevision(targetSha, protectedMainSha)
    || !isAncestorRevision(recoverySha, targetSha)) {
    throw new Error("Completion target is not an exact protected recovery descendant.");
  }
  return true;
}

export function assertCanonicalSquashRecoveryPreRetirementProjection({
  sealedEvidence,
  firstEvidence,
  secondEvidence,
}) {
  const sealed = canonicalSquashRecoveryPreRetirementProjection(sealedEvidence);
  const first = canonicalSquashRecoveryPreRetirementProjection(firstEvidence);
  const second = canonicalSquashRecoveryPreRetirementProjection(secondEvidence);
  if (digestValue(first) !== digestValue(sealed)
    || digestValue(second) !== digestValue(sealed)
    || digestValue(first) !== digestValue(second)) {
    throw new Error("Pre-retirement preservation projection drifted from sealed evidence.");
  }
  return true;
}

export function canonicalSquashRecoveryPreRetirementProjection(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("Pre-retirement preservation evidence is invalid.");
  }
  return Object.freeze({
    schema: evidence.schema,
    controller: structuredClone(evidence.controller),
    subject: structuredClone(evidence.subject),
    recovery: structuredClone(evidence.recovery),
    canonical: Object.freeze({
      recoveryContained: evidence.canonical?.recoveryContained,
      controllerContained: evidence.canonical?.controllerContained,
    }),
    preservation: structuredClone(evidence.preservation),
  });
}

export function assertCanonicalSquashRecoveryTerminalMainTopology({
  status,
  projectedMainSha,
  leaseMainSha,
  protectedMainSha,
  isAncestorRevision,
}) {
  if (![projectedMainSha, leaseMainSha, protectedMainSha]
    .every(value => SHA.test(String(value || "")))
    || typeof isAncestorRevision !== "function"
    || !["completing", "completed"].includes(status)
    || !isAncestorRevision(projectedMainSha, protectedMainSha)
    || (status === "completing" && leaseMainSha !== projectedMainSha)
    || (status === "completed"
      && (!isAncestorRevision(projectedMainSha, leaseMainSha)
        || !isAncestorRevision(leaseMainSha, protectedMainSha)))) {
    throw new Error("Terminal completion main topology drifted from its sealed projection.");
  }
  return true;
}

function requireSubjectLease(lease, { subjectPath, target }) {
  if (!lease || lease.worktreePath !== subjectPath
    || lease.cloudAuthority?.targetRepository !== target) {
    throw new Error("Subject lease identity is invalid.");
  }
}

function requireSubjectWorktree({ canonicalRoot, subjectPath, lease }) {
  const records = git(canonicalRoot, ["worktree", "list", "--porcelain"])
    .split("\n\n").map(record => record.split("\n"));
  const match = records.find(lines => lines[0] === `worktree ${subjectPath}`);
  if (!match || !existsSync(subjectPath)
    || realpathSync(subjectPath) !== subjectPath
    || !match.includes(`branch refs/heads/${lease.branch}`)) {
    throw new Error("Subject worktree registration is invalid.");
  }
}

function requirePreservedSubjectTerminalProjection({
  canonicalRoot,
  subjectPath,
  subject,
  lease,
}) {
  const branchRef = `refs/heads/${subject.branch}`;
  const branchSha = git(canonicalRoot, ["rev-parse", branchRef]);
  const treeSha = git(canonicalRoot, ["rev-parse", `${branchSha}^{tree}`]);
  const remoteBranchRevision = lsRemoteOptional(canonicalRoot, branchRef);
  if (branchSha !== subject.reviewedHeadSha || treeSha !== subject.reviewedTreeSha
    || (subject.remoteBranch === "absent"
      ? remoteBranchRevision !== null
      : remoteBranchRevision !== subject.remoteBranch)) {
    throw new Error("Terminal authored branch or tree drifted from the sealed review.");
  }
  const worktree = filesystemEntryState(subjectPath, "subject worktree");
  const records = git(canonicalRoot, ["worktree", "list", "--porcelain"])
    .split("\n\n")
    .filter(Boolean)
    .map(record => record.split("\n"));
  const pathRecords = records.filter(lines => lines[0] === `worktree ${subjectPath}`);
  const branchRecords = records.filter(lines => lines.includes(`branch ${branchRef}`));
  if (worktree === "absent") {
    if (lease.status !== "completed" || pathRecords.length !== 0
      || branchRecords.length !== 0) {
      throw new Error("Terminal cleanup retained a stale subject worktree registration.");
    }
  } else if (pathRecords.length !== 1 || branchRecords.length !== 0
    || !pathRecords[0].includes("detached")) {
    throw new Error("Completion-ready subject worktree registration drifted.");
  }
  return Object.freeze({ branchSha, treeSha, worktree });
}

function requireLeasePlanIdentity(lease, subject, label, { allowCompleting = false } = {}) {
  const validStatus = allowCompleting ? ["delivery", "completing"] : ["delivery"];
  normalizeCanonicalSquashRecoveryDeliveryProfile(lease, {
    genericSelfHosted: subject.pinTransition === null,
  });
  if (!validStatus.includes(lease?.status)
    || lease.branch !== subject.branch
    || lease.sessionId !== subject.sessionId
    || lease.scope !== subject.scope
    || lease.pullRequestUrl !== subject.pullRequest.url
    || lease.taskAuthority?.bindingDigest !== subject.taskAuthorityBindingDigest
    || lease.cloudAuthority?.claimId !== subject.claimId
    || !authoredIntegrationMatchesSubject(lease, subject)) {
    throw new Error(`${label} lease drifted from the authorized recovery plan.`);
  }
}

export function assertExactCanonicalSquashRecoveryCompletingReplay({
  lease,
  plan,
  journal,
  acceptCompletionMain = revision =>
    revision === plan.evidence.canonical.protectedMainSha,
}) {
  const subject = plan.evidence.subject;
  const phases = new Set(["completion-intent", "completion-projected", "verified"]);
  normalizeCanonicalSquashRecoveryDeliveryProfile(lease, {
    genericSelfHosted: subject.pinTransition === null,
  });
  if (lease?.status !== "completing" || !phases.has(journal?.state?.phase)
    || lease.baseSha !== subject.pullRequest.baseSha
    || lease.deliveryHeadSha !== subject.reviewedHeadSha
    || !authoredIntegrationMatchesSubject(lease, subject)
    || lease.completion?.mergeCommitSha !== subject.malformedCommit.sha
    || !acceptCompletionMain(lease.completion?.mainSha)
    || digestValue(canonicalSquashRecoveryImmutableLeaseProjection(lease, {
      genericSelfHosted: subject.pinTransition === null,
    }))
      !== subject.leaseIdentityDigest
    || digestValue(lease.cloudAuthority) !== digestValue(subject.cloudAuthority)
    || lease.taskAuthority?.authoritySubjectId !== subject.taskAuthority.authoritySubjectId
    || lease.taskAuthority?.proofAdapterId !== subject.taskAuthority.proofAdapterId
    || lease.taskAuthority?.generation !== subject.taskAuthority.generation
    || lease.taskAuthority?.bindingDigest !== subject.taskAuthority.bindingDigest
    || lease.taskAuthority?.laneBindingDigest !== subject.taskAuthority.laneBindingDigest
    || lease.taskAuthority?.publicKeyDigest !== subject.taskAuthority.publicKeyDigest) {
    throw new Error("Completing replay does not match the controller's sealed projection.");
  }
  const projected = journal.state.receipts?.["completion-projected"];
  if (projected && writerLeaseDigest(lease) !== projected.completingLeaseDigest) {
    throw new Error("Completing replay lease digest drifted from its durable projection.");
  }
  return lease;
}

export function assertExactCanonicalSquashRecoveryTerminalLeaseIdentity({
  lease,
  subject,
}) {
  let taskAuthority = null;
  try {
    taskAuthority = normalizeTaskAuthorityBinding(lease?.taskAuthority);
  } catch {
    throw new Error("Terminal local lease task authority is invalid.");
  }
  normalizeCanonicalSquashRecoveryDeliveryProfile(lease, {
    genericSelfHosted: subject.pinTransition === null,
  });
  if (!lease || !["completing", "completed"].includes(lease.status)
    || lease.worktreePath !== subject.worktreePath
    || lease.branch !== subject.branch
    || lease.sessionId !== subject.sessionId
    || lease.scope !== subject.scope
    || lease.pullRequestUrl !== subject.pullRequest.url
    || lease.baseSha !== subject.pullRequest.baseSha
    || (lease.reviewHeadSha ?? null) !== null
    || lease.deliveryHeadSha !== subject.reviewedHeadSha
    || !authoredIntegrationMatchesSubject(lease, subject)
    || lease.integration?.commitMessage !== subject.expectedSquashHeadline
    || digestValue(lease.integration?.paths) !== digestValue(subject.changedPaths)
    || lease.completion?.mergeCommitSha !== subject.malformedCommit.sha
    || digestValue(canonicalSquashRecoveryImmutableLeaseProjection(lease, {
      genericSelfHosted: subject.pinTransition === null,
    }))
      !== subject.leaseIdentityDigest
    || digestValue(lease.cloudAuthority) !== digestValue(subject.cloudAuthority)
    || digestValue(taskAuthority) !== digestValue(subject.taskAuthority)) {
    throw new Error("Terminal local lease does not join the recovery plan.");
  }
  return lease;
}

function authoredIntegrationMatchesSubject(lease, subject) {
  const authored = subject.protectedRefresh?.authoredCommit;
  return lease.integration?.commitSha === (authored?.sha ?? subject.reviewedHeadSha)
    && lease.integration?.treeSha === (authored?.treeSha ?? subject.reviewedTreeSha)
    && lease.integration?.commitMessage === subject.expectedSquashHeadline
    && digestValue(lease.integration?.paths) === digestValue(subject.changedPaths);
}

export function canonicalSquashRecoveryImmutableLeaseProjection(lease, {
  genericSelfHosted = false,
} = {}) {
  const deliveryProfile = normalizeCanonicalSquashRecoveryDeliveryProfile(lease, {
    genericSelfHosted,
  });
  requireCanonicalSquashRecoveryLeaseKeySet(lease, {
    genericSelfHosted,
    deliveryProfile,
  });
  const parkFields = [
    "parkHeadSha", "parkBranchHeadSha", "parkSourceEpoch", "parkSourceFenceSha",
    "parkStashRef", "parkStashSha", "parkStashMessage", "parkStashStatus",
  ];
  if (!lease || parkFields.some(name => (lease[name] ?? null) !== null)) {
    throw new Error("Canonical squash recovery does not authorize a parked lease.");
  }
  const taskAuthority = assertTaskAuthorityBinding({
    binding: lease.taskAuthority,
    lease,
  });
  const closedPr834SourceCorrection = deliveryProfile.profile
    === CLOSED_PR834_STANDARD_TERMINAL_ATTRIBUTION_PROFILE;
  return Object.freeze({
    schema: lease.schema,
    epoch: lease.epoch,
    sessionId: lease.sessionId,
    device: lease.device,
    scope: lease.scope,
    branch: lease.branch,
    worktreePath: lease.worktreePath,
    baseSha: lease.baseSha,
    fenceSha: lease.fenceSha,
    pullRequestUrl: lease.pullRequestUrl,
    autoDelivery: lease.autoDelivery,
    runtimeRequired: lease.runtimeRequired,
    ownedDirtRecovery: lease.ownedDirtRecovery ?? null,
    pullRequestProjectionRepair: lease.pullRequestProjectionRepair ?? null,
    reviewHeadSha: lease.reviewHeadSha ?? null,
    deliveryHeadSha: lease.deliveryHeadSha,
    parkHeadSha: null,
    parkBranchHeadSha: null,
    parkSourceEpoch: null,
    parkSourceFenceSha: null,
    parkStashRef: null,
    parkStashSha: null,
    parkStashMessage: null,
    parkStashStatus: null,
    acquiredAt: lease.acquiredAt,
    admission: structuredClone(lease.admission),
    cloudAuthority: structuredClone(lease.cloudAuthority),
    integration: structuredClone(lease.integration),
    taskAuthority,
    ...(genericSelfHosted ? {
      successorLineage: closedPr834SourceCorrection
        ? null
        : genericSuccessorLineageProjection(lease),
      ...(closedPr834SourceCorrection ? {
        sourceCorrectionSuccessorLineage:
          sourceCorrectionSuccessorLineageProjection(lease),
      } : {}),
    } : {}),
    ...(deliveryProfile.profile === LEGACY_ADMISSION_CONTINUATION_PROFILE ? {
      admissionContinuation: structuredClone(deliveryProfile.admissionContinuation),
    } : {}),
  });
}

export function assertCanonicalSquashRecoveryLegacyContinuationTopology({
  lease,
  reviewedHeadSha,
  fenceTreeSha,
  isAncestorRevision,
} = {}) {
  const deliveryProfile = normalizeCanonicalSquashRecoveryDeliveryProfile(lease, {
    genericSelfHosted: true,
  });
  const continuation = deliveryProfile.admissionContinuation;
  if (deliveryProfile.profile !== LEGACY_ADMISSION_CONTINUATION_PROFILE
    || !SHA.test(String(reviewedHeadSha || ""))
    || !SHA.test(String(fenceTreeSha || ""))
    || typeof isAncestorRevision !== "function"
    || continuation.localFenceSha !== lease.fenceSha
    || continuation.candidateRevision !== lease.fenceSha
    || continuation.candidateTreeSha !== fenceTreeSha
    || !isAncestorRevision(lease.fenceSha, reviewedHeadSha)) {
    throw new Error(
      "Legacy admission continuation does not retain its exact fence tree and reviewed descendant.",
    );
  }
  return true;
}

function requireCanonicalSquashRecoveryLeaseKeySet(lease, {
  genericSelfHosted = false,
  deliveryProfile,
} = {}) {
  if (!lease || !["delivery", "completing", "completed"].includes(lease.status)) {
    throw new Error("Canonical squash recovery requires its exact delivery lease lineage.");
  }
  const keys = [
    "acquiredAt", "admission", "autoDelivery", "baseSha", "branch",
    "cloudAuthority", "deliveryHeadSha", "device", "epoch", "expiresAt",
    "fenceSha", "heartbeatAt", "integration", "pullRequestUrl",
    "runtimeRequired", "schema", "scope", "sessionId", "status",
    "taskAuthority", "worktreePath",
  ];
  if (lease.status !== "delivery") keys.push("completion");
  const lineageKeys = [
    "activeOwnedDirtRecovery", "activeOwnedDirtCurrentBaseReanchor",
    "activePublishTaskAuthoritySuccessor", "activePublishSuccessorIntent",
  ];
  const presentLineage = lineageKeys.filter(name => Object.hasOwn(lease, name));
  if (deliveryProfile?.profile
    === CLOSED_PR834_STANDARD_TERMINAL_ATTRIBUTION_PROFILE) {
    const sourceCorrectionKeys = [
      "activePublishTaskAuthoritySuccessor", "activePublishSuccessorIntent",
      "sourceCorrectionSuccessorTaskBindingReconciliation",
    ];
    if (!genericSelfHosted
      || JSON.stringify(presentLineage.sort())
        !== JSON.stringify(sourceCorrectionKeys.slice(0, 2).sort())) {
      throw new Error(
        "Closed PR834 recovery lease lacks its exact partial source-correction lineage.",
      );
    }
    if (Object.hasOwn(lease, "reviewHeadSha")) {
      if (lease.reviewHeadSha !== null) {
        throw new Error("Closed PR834 recovery lease review head must remain null.");
      }
      keys.push("reviewHeadSha");
    }
    keys.push(...sourceCorrectionKeys);
  } else if (presentLineage.length > 0) {
    if (!genericSelfHosted || presentLineage.length !== lineageKeys.length) {
      throw new Error("Canonical squash recovery lease has partial or foreign successor lineage.");
    }
    keys.push(...lineageKeys);
  }
  if (deliveryProfile?.profile === LEGACY_ADMISSION_CONTINUATION_PROFILE) {
    keys.push("admissionContinuation");
  }
  if (JSON.stringify(Object.keys(lease).sort()) !== JSON.stringify(keys.sort())) {
    throw new Error("Canonical squash recovery lease key set drifted from the sealed delivery lineage.");
  }
}

function sourceCorrectionSuccessorLineageProjection(lease) {
  const repairValue = lease?.sourceCorrectionSuccessorTaskBindingReconciliation;
  const successor = lease?.activePublishTaskAuthoritySuccessor;
  const successorKeys = [
    "boundAt", "branch", "cloudOperationReceiptDigest",
    "cloudVerificationReceiptDigest", "epoch", "receiptDigest", "schema",
    "sourceBaseSha", "sourceBindingDigest", "sourceClaimId", "sourceFenceSha",
    "targetBaseSha", "targetBindingDigest", "targetClaimId", "targetFenceSha",
  ];
  let repair = null;
  try {
    repair = normalizeRepair(repairValue);
  } catch {
    throw new Error("Closed PR834 source-correction repair lineage is malformed.");
  }
  const exactSuccessorKeys = successor && !Array.isArray(successor)
    && JSON.stringify(Object.keys(successor).sort())
      === JSON.stringify([...successorKeys].sort());
  const exactInstant = value => typeof value === "string"
    && Number.isFinite(Date.parse(value));
  const exactDigests = fields => fields.every(name =>
    DIGEST.test(String(successor?.[name] || "")));
  const exactShas = fields => fields.every(name =>
    SHA.test(String(successor?.[name] || "")));
  if (digestValue(repair) !== digestValue(repairValue)
    || !exactSuccessorKeys
    || lease.activePublishSuccessorIntent !== null
    || repair.branch !== lease.branch
    || repair.successorClaimId !== successor.sourceClaimId
    || repair.targetBindingDigest !== successor.sourceBindingDigest
    || successor.schema
      !== "agentic-active-publish-task-authority-successor-receipt/v1"
    || successor.branch !== lease.branch
    || successor.epoch !== lease.epoch
    || successor.targetBaseSha !== lease.baseSha
    || successor.targetFenceSha !== lease.fenceSha
    || successor.targetFenceSha !== lease.deliveryHeadSha
    || successor.targetClaimId !== lease.cloudAuthority.claimId
    || successor.sourceBindingDigest !== lease.taskAuthority.priorBindingDigest
    || successor.targetBindingDigest !== lease.taskAuthority.bindingDigest
    || !exactInstant(successor.boundAt)
    || !exactDigests([
      "sourceClaimId", "targetClaimId", "sourceBindingDigest", "targetBindingDigest",
      "cloudOperationReceiptDigest", "cloudVerificationReceiptDigest", "receiptDigest",
    ])
    || !exactShas([
      "sourceBaseSha", "sourceFenceSha", "targetBaseSha", "targetFenceSha",
    ])
    || successor.receiptDigest !== digestValue(Object.fromEntries(
      Object.entries(successor).filter(([name]) => name !== "receiptDigest"),
    ))) {
    throw new Error(
      "Closed PR834 source-correction successor does not join the current lease.",
    );
  }
  return Object.freeze({
    schema: "agentic-canonical-squash-source-correction-successor-lineage/v1",
    sourceCorrectionSuccessorTaskBindingReconciliation: structuredClone(repair),
    activePublishTaskAuthoritySuccessor: structuredClone(successor),
    activePublishSuccessorIntent: null,
  });
}

function genericSuccessorLineageProjection(lease) {
  const names = [
    "activeOwnedDirtRecovery", "activeOwnedDirtCurrentBaseReanchor",
    "activePublishTaskAuthoritySuccessor", "activePublishSuccessorIntent",
  ];
  if (names.every(name => !Object.hasOwn(lease, name))) return null;
  const [recovery, reanchor, successor, intent] = names.map(name => lease[name]);
  const reanchorKeys = [
    "planDigest", "schema", "sourceBaseSha", "sourceClaimId", "sourceFenceSha",
    "status", "successorClaimId", "targetCanonicalBaseSha",
    "targetDirtEvidenceDigest", "targetLaneRevision", "taskContinuationReceiptDigest",
  ];
  const successorKeys = [
    "boundAt", "branch", "cloudOperationReceiptDigest",
    "cloudVerificationReceiptDigest", "epoch", "receiptDigest", "schema",
    "sourceBaseSha", "sourceBindingDigest", "sourceClaimId", "sourceFenceSha",
    "targetBaseSha", "targetBindingDigest", "targetClaimId", "targetFenceSha",
  ];
  let normalizedRecovery = null;
  try {
    normalizedRecovery = normalizeActiveOwnedDirtLeaseRecovery(recovery);
  } catch {
    throw new Error("Generic owned-dirt recovery lineage is malformed.");
  }
  const exactKeys = (value, expected) => value && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
  const exactInstant = value => typeof value === "string"
    && Number.isFinite(Date.parse(value));
  const exactDigests = (value, fields) => fields.every(name =>
    DIGEST.test(String(value?.[name] || "")));
  const exactShas = (value, fields) => fields.every(name =>
    SHA.test(String(value?.[name] || "")));
  if (!recovery || !reanchor || !successor || intent !== null
    || digestValue(normalizedRecovery) !== digestValue(recovery)
    || !exactKeys(reanchor, reanchorKeys)
    || !exactKeys(successor, successorKeys)
    || recovery.sourceEpoch >= lease.epoch
    || recovery.sourceSessionId !== lease.sessionId
    || recovery.sourceDevice !== lease.device
    || recovery.sourceBranch !== lease.branch
    || reanchor.schema !== "agentic-active-owned-dirt-current-base-reanchor-lease/v1"
    || reanchor.status !== "reanchored"
    || successor.schema !== "agentic-active-publish-task-authority-successor-receipt/v1"
    || recovery.sourceClaimId !== reanchor.sourceClaimId
    || recovery.sourceFenceSha !== reanchor.sourceFenceSha
    || reanchor.successorClaimId !== successor.sourceClaimId
    || reanchor.targetCanonicalBaseSha !== successor.sourceBaseSha
    || reanchor.targetLaneRevision !== successor.sourceFenceSha
    || successor.branch !== lease.branch || successor.epoch !== lease.epoch
    || successor.targetBaseSha !== lease.baseSha
    || successor.targetFenceSha !== lease.fenceSha
    || successor.targetFenceSha !== lease.deliveryHeadSha
    || successor.targetClaimId !== lease.cloudAuthority.claimId
    || successor.sourceBindingDigest !== lease.taskAuthority.priorBindingDigest
    || successor.targetBindingDigest !== lease.taskAuthority.bindingDigest
    || !exactInstant(successor.boundAt)
    || !exactDigests(reanchor, [
      "planDigest", "sourceClaimId", "successorClaimId", "targetDirtEvidenceDigest",
      "taskContinuationReceiptDigest",
    ])
    || !exactShas(reanchor, [
      "sourceBaseSha", "sourceFenceSha", "targetCanonicalBaseSha", "targetLaneRevision",
    ])
    || !exactDigests(successor, [
      "sourceClaimId", "targetClaimId", "sourceBindingDigest", "targetBindingDigest",
      "cloudOperationReceiptDigest", "cloudVerificationReceiptDigest", "receiptDigest",
    ])
    || !exactShas(successor, [
      "sourceBaseSha", "sourceFenceSha", "targetBaseSha", "targetFenceSha",
    ])
    || successor.receiptDigest !== digestValue(Object.fromEntries(
      Object.entries(successor).filter(([name]) => name !== "receiptDigest"),
    ))) {
    throw new Error("Generic successor/reanchor lineage does not join the current lease.");
  }
  return Object.freeze({
    activeOwnedDirtRecovery: structuredClone(recovery),
    activeOwnedDirtCurrentBaseReanchor: structuredClone(reanchor),
    activePublishTaskAuthoritySuccessor: structuredClone(successor),
    activePublishSuccessorIntent: null,
  });
}

function genericProtectedRefreshSuccessor(lease) {
  if (Object.hasOwn(
    lease || {},
    "sourceCorrectionSuccessorTaskBindingReconciliation",
  )) {
    return sourceCorrectionSuccessorLineageProjection(lease)
      .activePublishTaskAuthoritySuccessor;
  }
  return genericSuccessorLineageProjection(lease)
    ?.activePublishTaskAuthoritySuccessor ?? null;
}

function completingWorktreeProjection({ subjectPath, subject, mainSha }) {
  return classifyCanonicalSquashRecoveryCompletingProjection({
    worktreeState: filesystemEntryState(subjectPath, "subject worktree"),
    statusPorcelain: git(subjectPath, ["status", "--porcelain"]),
    currentBranch: git(subjectPath, ["branch", "--show-current"]),
    headSha: git(subjectPath, ["rev-parse", "HEAD"]),
    subjectBranch: subject.branch,
    reviewedHeadSha: subject.reviewedHeadSha,
    completionMainSha: mainSha,
  });
}

export function classifyCanonicalSquashRecoveryCompletingProjection({
  worktreeState,
  statusPorcelain,
  currentBranch,
  headSha,
  subjectBranch,
  reviewedHeadSha,
  completionMainSha,
}) {
  if (worktreeState !== "present" || statusPorcelain !== "") {
    throw new Error("Completing replay worktree is absent or dirty.");
  }
  if (currentBranch === subjectBranch && headSha === reviewedHeadSha) {
    return "attached-reviewed";
  }
  if (currentBranch === "" && headSha === completionMainSha) return "detached-main";
  throw new Error("Completing replay worktree is neither exact attached review nor sealed main.");
}

function readPullRequest(ghText, repository, number) {
  const raw = JSON.parse(ghText([
    "pr", "view", String(number), "--repo", repository, "--json",
    "number,id,url,state,isDraft,mergedAt,closedAt,headRefName,headRefOid,baseRefName,baseRefOid,mergeCommit,mergedBy,isCrossRepository,autoMergeRequest",
  ]));
  if (raw.state !== "MERGED" || raw.isDraft !== false || raw.isCrossRepository !== false
    || !raw.mergedAt || !raw.mergeCommit?.oid || !raw.mergedBy?.login) {
    throw new Error(`Pull request ${number} is not one exact protected merged subject.`);
  }
  const autoMergeRequest = raw.autoMergeRequest === null ? null : Object.freeze({
    mergeMethod: raw.autoMergeRequest.mergeMethod,
    commitHeadline: raw.autoMergeRequest.commitHeadline,
    commitBody: raw.autoMergeRequest.commitBody,
    enabledAt: raw.autoMergeRequest.enabledAt,
    enabledBy: Object.freeze({
      id: raw.autoMergeRequest.enabledBy?.id,
      login: raw.autoMergeRequest.enabledBy?.login,
      isBot: raw.autoMergeRequest.enabledBy?.is_bot
        ?? raw.autoMergeRequest.enabledBy?.isBot,
    }),
  });
  return Object.freeze({
    number: raw.number,
    nodeId: raw.id,
    url: raw.url,
    headBranch: raw.headRefName,
    headSha: raw.headRefOid,
    baseBranch: raw.baseRefName,
    baseSha: raw.baseRefOid,
    mergeSha: raw.mergeCommit.oid,
    mergedAt: raw.mergedAt,
    mergedBy: raw.mergedBy.login,
    autoMergeDigest: digestValue(autoMergeRequest),
    autoMergeRequest,
  });
}

function requireMergedPull(pull, url, branch) {
  if (pull.url !== url || pull.headBranch !== branch || pull.baseBranch !== "main") {
    throw new Error("Merged pull request identity drifted.");
  }
}
function requireSamePull(current, expected, label) {
  if (stablePullIdentityDigest(current) !== stablePullIdentityDigest(expected)) {
    throw new Error(`${label} pull request drifted.`);
  }
}
function stablePullIdentityDigest(value) {
  return digestValue({
    number: value.number,
    nodeId: value.nodeId,
    url: value.url,
    headBranch: value.headBranch,
    headSha: value.headSha,
    baseBranch: value.baseBranch,
    baseSha: value.baseSha,
    mergeSha: value.mergeSha,
    mergedAt: value.mergedAt,
    mergedBy: value.mergedBy,
    autoMergeDigest: value.autoMergeDigest,
  });
}
function exactRetiredClaimExpectation({
  ghText, pullRequest, branch, sessionId, device, cloudAuthority, laneRevision,
  predecessorAuthority = null,
}) {
  return Object.freeze({
    reviewRequestId: `github-pull-request:${pullRequest.nodeId}`,
    laneRevision,
    writeSetDigest: requiredDigest(
      cloudAuthority.writeSetDigest,
      "terminal cloud write-set digest",
    ),
    leaseEpoch: positive(cloudAuthority.leaseEpoch, "terminal cloud lease epoch"),
    repositoryId: githubRepositoryIdentity(ghText, pullRequest.url),
    canonicalBaseRevision: requiredSha(
      cloudAuthority.canonicalBaseSha,
      "terminal cloud canonical base",
    ),
    declaredWriteScope: cloudAuthority.cloudDeclaredWriteScope,
    deviceId: pseudonymousIdentifier("device", device),
    sessionId: pseudonymousIdentifier("session", sessionId),
    workItemId: pseudonymousIdentifier("work-item", branch),
    evidenceDigest: requiredDigest(
      cloudAuthority.focusedEvidenceDigest,
      "terminal cloud focused evidence",
    ),
    historicalAuthority: Object.freeze({
      claimDigest: requiredDigest(cloudAuthority.claimDigest, "historical claim digest"),
      entryDigest: requiredDigest(
        cloudAuthority.claimLedgerRevision,
        "historical claim ledger entry",
      ),
      ledgerDigest: requiredDigest(cloudAuthority.ledgerDigest, "historical ledger digest"),
      transitionCounter: positive(
        cloudAuthority.transitionCounter,
        "historical transition counter",
      ),
      state: required(cloudAuthority.state, "historical cloud state"),
      operationReceiptDigest: requiredDigest(
        cloudAuthority.operationReceiptDigest,
        "historical operation receipt",
      ),
      integrationReceiptDigest: cloudAuthority.integrationReceiptDigest || null,
    }),
    predecessorAuthority: predecessorAuthority === null
      ? null
      : Object.freeze(structuredClone(predecessorAuthority)),
  });
}
function readValidatedCollaborationLedger({ ghText, ledgerRepository }) {
  const ref = ghJson(ghText,
    `repos/${ledgerRepository}/git/ref/heads/${encodeURIComponent("agentic/collaboration-ledger")}`);
  const ledgerRevision = requiredSha(ref?.object?.sha, "recovery ledger revision");
  const commit = ghJson(ghText, `repos/${ledgerRepository}/git/commits/${ledgerRevision}`);
  let treeSha = requiredSha(commit?.tree?.sha, "recovery ledger root tree");
  for (const [index, segment] of [".agentic", "collaboration-ledger.json"].entries()) {
    const tree = ghJson(ghText, `repos/${ledgerRepository}/git/trees/${treeSha}`);
    const item = tree?.tree?.find(candidate => candidate.path === segment);
    const type = index === 0 ? "tree" : "blob";
    if (item?.type !== type) throw new Error("Recovery cloud ledger path is missing.");
    treeSha = requiredSha(item.sha, `recovery ledger ${type}`);
  }
  const blob = ghJson(ghText, `repos/${ledgerRepository}/git/blobs/${treeSha}`);
  if (blob?.encoding !== "base64") throw new Error("Recovery cloud ledger encoding is invalid.");
  const ledger = JSON.parse(Buffer.from(String(blob.content || "").replace(/\s/gu, ""),
    "base64").toString("utf8"));
  const failures = validateLedger(ledger);
  if (failures.length > 0) throw new Error(`Recovery cloud ledger is invalid: ${failures[0]}`);
  return ledger;
}
function readGenericSuccessorPredecessorAuthority({
  ghText,
  ledgerRepository,
  lease,
  historicalLeaseEpoch,
}) {
  const successor = genericProtectedRefreshSuccessor(lease);
  if (successor === null) return null;
  const ledger = readValidatedCollaborationLedger({ ghText, ledgerRepository });
  const current = ledger.entries.filter(entry => entry.claimId === lease.cloudAuthority.claimId)
    .at(-1)?.claimCore;
  const predecessor = ledger.entries.filter(entry => entry.claimId === successor.sourceClaimId)
    .at(-1)?.claimCore;
  if (!current || !predecessor
    || current.claimId !== lease.cloudAuthority.claimId
    || current.predecessorClaimId !== successor.sourceClaimId
    || current.canonicalBaseRevision !== lease.cloudAuthority.canonicalBaseSha
    || current.laneRevision !== lease.cloudAuthority.laneRevision
    || current.leaseEpoch !== lease.cloudAuthority.leaseEpoch
    || predecessor.claimId !== successor.sourceClaimId
    || predecessor.canonicalBaseRevision !== successor.sourceBaseSha
    || predecessor.laneRevision !== successor.sourceFenceSha
    || predecessor.leaseEpoch !== historicalLeaseEpoch) {
    throw new Error("Generic successor cloud predecessor projection drifted.");
  }
  return Object.freeze({
    currentClaimId: current.claimId,
    predecessorClaimId: predecessor.claimId,
    canonicalBaseSha: predecessor.canonicalBaseRevision,
    laneRevision: predecessor.laneRevision,
    leaseEpoch: predecessor.leaseEpoch,
  });
}
function readExactRetiredClaim({ ghText, ledgerRepository, claimId, expected }) {
  const ledger = readValidatedCollaborationLedger({ ghText, ledgerRepository });
  const entries = ledger.entries.filter(entry => entry.claimId === claimId);
  const terminal = entries.at(-1);
  const integration = [...entries].reverse().find(entry => entry.action === "integrate");
  const historical = entries.find(entry =>
    entry.digest === expected.historicalAuthority.entryDigest
    && entry.claimDigest === expected.historicalAuthority.claimDigest
    && entry.claimCore?.transitionCounter
      === expected.historicalAuthority.transitionCounter);
  const predecessor = expected.predecessorAuthority === null
    ? null
    : ledger.entries.filter(entry =>
      entry.claimId === expected.predecessorAuthority.predecessorClaimId).at(-1)?.claimCore;
  const immutableFields = ["claimId", "actorId", "deviceId", "sessionId", "repositoryId",
    "workItemId", "canonicalBaseRevision", "declaredWriteScope", "writeSetDigest",
    "laneRevision", "leaseEpoch", "heartbeatCounter", "expiresAt", "evidenceDigest",
    "reviewRequestId", "predecessorClaimId"];
  const immutableProjection = core => Object.fromEntries(
    immutableFields.map(name => [name, core?.[name]]),
  );
  const integrationReceiptDigest = integration && digestValue({
    schema: "agentic-collaboration-integration-receipt/v1",
    operation: "integrate",
    status: "integrated-preserved",
    repositoryId: integration.repositoryId,
    claimId: integration.claimId,
    claimDigest: integration.claimDigest,
    fenceRevision: integration.claimDigest,
    ledgerRevision: integration.digest,
    ledgerSequence: integration.sequence,
    idempotencyKey: integration.idempotencyKey,
    requestDigest: integration.requestDigest,
    evaluationTime: integration.evaluationTime,
  });
  const historicalReceiptDigest = historical && collaborationOperationReceiptDigest(historical);
  const expectedHistoricalRawState = expected.historicalAuthority.state === "review_ready"
    ? "reviewed"
    : expected.historicalAuthority.state === "delivery_authorized"
      ? "integrated-preserved"
      : null;
  if (!terminal || terminal.action !== "retire" || terminal.claimCore?.state !== "retired"
    || terminal.repositoryId !== expected.repositoryId
    || terminal.claimCore.repositoryId !== expected.repositoryId
    || terminal.claimCore.canonicalBaseRevision !== expected.canonicalBaseRevision
    || digestValue(terminal.claimCore.declaredWriteScope)
      !== digestValue(expected.declaredWriteScope)
    || terminal.claimCore.deviceId !== expected.deviceId
    || terminal.claimCore.sessionId !== expected.sessionId
    || terminal.claimCore.workItemId !== expected.workItemId
    || terminal.claimCore.evidenceDigest !== expected.evidenceDigest
    || !historical || historical.claimCore?.state !== expectedHistoricalRawState
    || !["continue", "integrate"].includes(historical.action)
    || expected.historicalAuthority.ledgerDigest !== historical.digest
    || historicalReceiptDigest !== expected.historicalAuthority.operationReceiptDigest
    || terminal.claimCore.retirement?.reason !== "integrated"
    || terminal.claimCore.retirement.finalRevision !== expected.laneRevision
    || terminal.claimCore.retirement.reviewRequestId !== expected.reviewRequestId
    || terminal.claimCore.reviewRequestId !== expected.reviewRequestId
    || terminal.claimCore.laneRevision !== expected.laneRevision
    || terminal.claimCore.writeSetDigest !== expected.writeSetDigest
    || terminal.claimCore.leaseEpoch !== expected.leaseEpoch
    || (expected.predecessorAuthority !== null
      && (terminal.claimCore.claimId !== expected.predecessorAuthority.currentClaimId
        || terminal.claimCore.predecessorClaimId
          !== expected.predecessorAuthority.predecessorClaimId
        || !predecessor
        || predecessor.claimId !== expected.predecessorAuthority.predecessorClaimId
        || predecessor.canonicalBaseRevision
          !== expected.predecessorAuthority.canonicalBaseSha
        || predecessor.laneRevision !== expected.predecessorAuthority.laneRevision
        || predecessor.leaseEpoch !== expected.predecessorAuthority.leaseEpoch))
    || terminal.claimDigest !== digestValue(terminal.claimCore)
    || !integration || integration.claimCore?.state !== "integrated-preserved"
    || integration.claimCore.integration?.candidateRevision !== expected.laneRevision
    || integration.claimCore.integration?.reviewRequestId !== expected.reviewRequestId
    || integration.claimCore.writeSetDigest !== expected.writeSetDigest
    || integration.claimCore.leaseEpoch !== expected.leaseEpoch
    || (expected.historicalAuthority.state === "review_ready"
      && entries.indexOf(historical) !== entries.indexOf(integration) - 1)
    || (expected.historicalAuthority.state === "delivery_authorized"
      && entries.indexOf(historical) < entries.indexOf(integration))
    || (expected.historicalAuthority.integrationReceiptDigest
      && expected.historicalAuthority.integrationReceiptDigest !== integrationReceiptDigest)
    || integration.claimDigest !== digestValue(integration.claimCore)
    || digestValue(immutableProjection(integration.claimCore))
      !== digestValue(immutableProjection(terminal.claimCore))
    || digestValue(integration.claimCore.integration)
      !== digestValue(terminal.claimCore.integration)
    || terminal.claimCore.retirement.namedChecksDigest
      !== integration.claimCore.integration.namedChecksDigest
    || terminal.claimCore.retirement.handoffEvidenceDigest
      !== integration.claimCore.integration.handoffEvidenceDigest
    || terminal.claimCore.retirement.integrationReceiptDigest !== integrationReceiptDigest
    || !DIGEST.test(String(terminal.claimCore.retirement.bytesDigest || ""))
    || terminal.claimCore.transitionCounter !== integration.claimCore.transitionCounter + 1) {
    throw new Error("Recovery cloud claim is not one exact integrated terminal lineage.");
  }
  return Object.freeze({
    claimId,
    integrationEntryDigest: integration.digest,
    retirementEntryDigest: terminal.digest,
    terminalClaimDigest: terminal.claimDigest,
    integrationReceiptDigest: terminal.claimCore.retirement.integrationReceiptDigest,
    repositoryId: terminal.claimCore.repositoryId,
    canonicalBaseRevision: terminal.claimCore.canonicalBaseRevision,
    declaredWriteScopeDigest: digestValue(terminal.claimCore.declaredWriteScope),
    deviceId: terminal.claimCore.deviceId,
    sessionId: terminal.claimCore.sessionId,
    workItemId: terminal.claimCore.workItemId,
    focusedEvidenceDigest: terminal.claimCore.evidenceDigest,
    historicalAuthorityDigest: digestValue({
      entryDigest: historical.digest,
      claimDigest: historical.claimDigest,
      transitionCounter: historical.claimCore.transitionCounter,
      state: historical.claimCore.state,
      operationReceiptDigest: historicalReceiptDigest,
    }),
    reviewRequestId: terminal.claimCore.reviewRequestId,
    laneRevision: terminal.claimCore.laneRevision,
    writeSetDigest: terminal.claimCore.writeSetDigest,
    leaseEpoch: terminal.claimCore.leaseEpoch,
    immutableSubjectDigest: digestValue(immutableProjection(terminal.claimCore)),
    integrationEvidenceDigest: digestValue(terminal.claimCore.integration),
    retirementEvidenceDigest: digestValue(terminal.claimCore.retirement),
    transitionCounter: terminal.claimCore.transitionCounter,
    sequence: terminal.sequence,
  });
}
function collaborationOperationReceiptDigest(entry) {
  const schemaByAction = {
    continue: "agentic-collaboration-continuation-receipt/v1",
    integrate: "agentic-collaboration-integration-receipt/v1",
  };
  const schema = schemaByAction[entry?.action];
  if (!schema) throw new Error("Historical cloud authority action is unsupported.");
  return digestValue({
    schema,
    operation: entry.action,
    status: entry.claimCore.state,
    repositoryId: entry.repositoryId,
    claimId: entry.claimId,
    claimDigest: entry.claimDigest,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
    ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime,
  });
}
function githubRepositoryIdentity(ghText, pullRequestUrl) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/[1-9][0-9]*$/u
    .exec(String(pullRequestUrl || ""));
  if (!match) throw new Error("Recovery pull-request URL is not exact github.com identity.");
  const repository = ghJson(ghText, `repos/${match[1]}`);
  return `github-repository:${required(repository?.node_id, "recovery repository node ID")}`;
}
function ghJson(ghText, endpoint) {
  return JSON.parse(ghText(["api", "--hostname", "github.com",
    "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2026-03-10", endpoint]));
}

function gitCommit(root, revision) {
  const object = execFileSync("git", ["-C", root, "cat-file", "commit", revision], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  const boundary = object.indexOf("\n\n");
  if (boundary < 0) throw new Error("Git commit object has no message boundary.");
  const headers = object.slice(0, boundary).split("\n");
  const rawMessage = object.slice(boundary + 2);
  const terminalLf = rawMessage.endsWith("\n");
  const message = terminalLf ? rawMessage.slice(0, -1) : rawMessage;
  if (message.endsWith("\n")) throw new Error("Git commit message has ambiguous terminal LFs.");
  return Object.freeze({
    sha: git(root, ["rev-parse", revision]),
    parentShas: headers.filter(line => line.startsWith("parent "))
      .map(line => line.slice("parent ".length)),
    treeSha: requiredSha(
      headers.find(line => line.startsWith("tree "))?.slice("tree ".length),
      "commit tree",
    ),
    message,
    objectMessageByteLength: Buffer.byteLength(rawMessage),
    objectMessageSha256: sha256(rawMessage),
    objectMessageTerminalLf: terminalLf,
  });
}
function exactTreeChanges(root, from, to) {
  const raw = execFileSync("git", ["-C", root, "diff-tree", "--no-commit-id",
    "--raw", "--no-renames", "-r", "-z", from, to], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  if (!raw) return Object.freeze([]);
  const fields = raw.split("\0");
  if (fields.pop() !== "" || fields.length % 2 !== 0) {
    throw new Error("Git raw diff framing is invalid.");
  }
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    const header = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])$/u
      .exec(fields[index]);
    if (!header || !fields[index + 1]) throw new Error("Git raw diff entry is invalid.");
    entries.push(Object.freeze({ oldMode: header[1], newMode: header[2],
      oldBlob: header[3], newBlob: header[4], status: header[5], path: fields[index + 1] }));
  }
  return Object.freeze(entries);
}
function exactCommitAuthor(root, revision) {
  const raw = execFileSync("git", ["-C", root, "show", "-s",
    "--format=format:%an%x00%ae", revision], {
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
  });
  const fields = raw.split("\0");
  if (fields.length !== 2 || !fields[0] || !fields[1]
    || /[<>\r\n]/u.test(fields[0]) || /[<>\r\n]/u.test(fields[1])) {
    throw new Error("Source commit author identity is not exact Git attribution.");
  }
  return Object.freeze({ name: fields[0], email: fields[1] });
}
function exactGenericManagedIntegrationBody({ message, headline, scope }) {
  const prefix = `${headline}\n\n`;
  if (!message.startsWith(prefix)) {
    throw new Error("Generic reviewed commit headline is not exact.");
  }
  const body = message.slice(prefix.length);
  const lines = body.split("\n");
  const epoch = /^Agentic-Lease-Epoch: ([1-9][0-9]*)$/u.exec(lines[4] || "");
  if (lines.length !== 6
    || lines[0] !== `Integrate the declared ${scope} change through its protected managed task lane so downstream policy can attribute the change to its writer lease.`
    || lines[1] !== ""
    || lines[2] !== `Agentic-Task: ${scope}`
    || lines[3] !== `Agentic-Scope: ${scope}`
    || !epoch
    || lines[5] !== "Agentic-Mechanism: Agentic Canvas OS protected integration") {
    throw new Error("Generic reviewed commit lacks its exact historical managed body.");
  }
  return Object.freeze({ body, leaseEpoch: Number(epoch[1]) });
}
function exactGenericProtectedRefresh({
  root, lease, reviewed, reviewedChanges, expectedReviewedMessage,
}) {
  const authored = gitCommit(root, lease.integration.commitSha);
  const successor = genericProtectedRefreshSuccessor(lease);
  if (authored.treeSha !== lease.integration.treeSha
    || authored.message !== expectedReviewedMessage
    || authored.objectMessageTerminalLf !== true) {
    throw new Error("Generic authored integration commit drifted from its sealed bytes.");
  }
  if (authored.sha === reviewed.sha) {
    if (successor !== null || authored.treeSha !== reviewed.treeSha) {
      throw new Error("Generic unrefreshed integration tree drifted.");
    }
    return null;
  }
  if (successor === null
    || authored.parentShas.length !== 1
    || reviewed.parentShas.length !== 2
    || reviewed.parentShas[0] !== authored.sha
    || reviewed.parentShas[1] !== lease.baseSha
    || reviewed.message !== authored.message
    || reviewed.objectMessageTerminalLf !== true
    || authored.parentShas[0] !== successor.sourceFenceSha) {
    throw new Error("Generic protected refresh topology drifted from its authored head.");
  }
  const authoredChanges = exactTreeChanges(root, authored.parentShas[0], authored.sha);
  if (JSON.stringify(authoredChanges) !== JSON.stringify(reviewedChanges)) {
    throw new Error("Generic protected refresh did not preserve the exact authored patch.");
  }
  return Object.freeze({
    authoredCommit: Object.freeze({
      sha: authored.sha,
      treeSha: authored.treeSha,
      messageDigest: digestValue(authored.message),
      objectMessageByteLength: authored.objectMessageByteLength,
      objectMessageSha256: authored.objectMessageSha256,
      objectMessageTerminalLf: authored.objectMessageTerminalLf,
    }),
    authoredParentSha: authored.parentShas[0],
    reviewedParentShas: Object.freeze([...reviewed.parentShas]),
    changedEntries: authoredChanges,
  });
}
function uniqueCommitAuthors(authors) {
  const seen = new Set();
  const result = [];
  for (const author of authors) {
    const identity = `${author.name}\0${author.email}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(author);
  }
  if (result.length < 1) throw new Error("Generic recovery has no source attribution.");
  return Object.freeze(result);
}
function providerBulletSubjects({
  message,
  headline,
  expectedBody,
  attributionTrailers,
  sourceHistorySubjects,
}) {
  const suffix = `\n\n${expectedBody}\n\n---------\n\n${attributionTrailers.join("\n")}`;
  if (!message.startsWith(`${headline}\n\n`) || !message.endsWith(suffix)) {
    throw new Error("Provider-generated squash framing is not exact.");
  }
  const bulletText = message.slice(`${headline}\n\n`.length, -suffix.length);
  const bullets = bulletText.split("\n\n").map(value => {
    const match = /^\* ([^\r\n]+)$/u.exec(value);
    if (!match) throw new Error("Provider-generated squash bullet is malformed.");
    return match[1];
  });
  if (bullets.length < 1 || bullets.at(-1) !== headline) {
    throw new Error("Provider-generated squash lacks its terminal reviewed subject.");
  }
  let cursor = 0;
  for (const bullet of bullets) {
    const next = sourceHistorySubjects.indexOf(bullet, cursor);
    if (next < 0) {
      throw new Error("Provider-generated squash bullet is not ordered source history.");
    }
    cursor = next + 1;
  }
  return Object.freeze(bullets);
}

export function assertCanonicalSquashRecoveryMalformedProviderMessage({
  profile,
  message,
  headline,
  expectedBody,
  attributionTrailers = [],
  sourceHistorySubjects,
  sourceCommitRevisions = [],
  pullRequest = null,
  sourceCommitProviderActors = [],
} = {}) {
  if (profile === CLOSED_PR834_STANDARD_TERMINAL_ATTRIBUTION_PROFILE) {
    const autoMerge = pullRequest?.autoMergeRequest;
    if (!Array.isArray(sourceHistorySubjects)
      || sourceHistorySubjects.length !== 3
      || sourceHistorySubjects.some(subject => typeof subject !== "string"
        || !subject || /[\r\n]/u.test(subject))
      || sourceHistorySubjects[0] === headline
      || sourceHistorySubjects[1] !== headline
      || sourceHistorySubjects[2] !== headline
      || !Array.isArray(attributionTrailers)
      || attributionTrailers.length !== 0
      || autoMerge?.mergeMethod !== "SQUASH"
      || autoMerge.commitHeadline !== headline
      || autoMerge.commitBody !== null
      || autoMerge.enabledBy?.login !== pullRequest.mergedBy
      || autoMerge.enabledBy?.isBot !== false
      || !Array.isArray(sourceCommitRevisions)
      || sourceCommitRevisions.length !== sourceHistorySubjects.length
      || new Set(sourceCommitRevisions).size !== sourceCommitRevisions.length
      || sourceCommitRevisions.some(revision => !SHA.test(String(revision || "")))
      || !Array.isArray(sourceCommitProviderActors)
      || sourceCommitProviderActors.length !== sourceCommitRevisions.length
      || sourceCommitProviderActors.some((actor, index) =>
        actor?.revision !== sourceCommitRevisions[index]
        || actor.authorLogin !== pullRequest.mergedBy
        || actor.committerLogin !== pullRequest.mergedBy)) {
      throw new Error(
        "Provider-generated closed PR834 squash actor and source attribution is not exact.",
      );
    }
    const bullets = Object.freeze([sourceHistorySubjects[0], headline]);
    const expected = [
      headline,
      "",
      `* ${bullets[0]}`,
      "",
      `* ${bullets[1]}`,
      "",
      expectedBody,
    ].join("\n");
    const expectedManagedTrailers = String(expectedBody)
      .split("\n").slice(-4).join("\n");
    if (message !== expected || !hasExactFinalManagedTrailers(message)
      || finalTrailerBlock(message).join("\n") !== expectedManagedTrailers
      || message.includes("\n\n---------\n\n")
      || /(^|\n)Co-authored-by:/u.test(message)) {
      throw new Error(
        "Provider-generated closed PR834 terminal managed framing is not exact.",
      );
    }
    return bullets;
  }
  if (profile === STANDARD_AUTO_DELIVERY_PROFILE) {
    const bullets = providerBulletSubjects({
      message,
      headline,
      expectedBody,
      attributionTrailers,
      sourceHistorySubjects,
    });
    const expected = [
      headline,
      "",
      ...bullets.flatMap((subject, index) => index === 0
        ? [`* ${subject}`]
        : ["", `* ${subject}`]),
      "",
      expectedBody,
      "",
      "---------",
      "",
      ...attributionTrailers,
    ].join("\n");
    if (message !== expected || hasExactFinalManagedTrailers(message)
      || finalTrailerBlock(message).join("\n") !== attributionTrailers.join("\n")) {
      throw new Error("Provider-generated standard squash attribution framing is not exact.");
    }
    return bullets;
  }
  if (profile !== LEGACY_ADMISSION_CONTINUATION_PROFILE
    || !Array.isArray(sourceHistorySubjects) || sourceHistorySubjects.length < 1
    || sourceHistorySubjects.some(subject => typeof subject !== "string"
      || !subject || /[\r\n]/u.test(subject))
    || sourceHistorySubjects.at(-1) !== headline) {
    throw new Error("Provider-generated legacy squash source history is not exact.");
  }
  const autoMerge = pullRequest?.autoMergeRequest;
  if (autoMerge?.mergeMethod !== "SQUASH"
    || autoMerge.commitHeadline !== headline
    || autoMerge.commitBody !== null
    || autoMerge.enabledBy?.login !== pullRequest.mergedBy
    || autoMerge.enabledBy?.isBot !== false
    || !Array.isArray(sourceCommitRevisions)
    || sourceCommitRevisions.length !== sourceHistorySubjects.length
    || sourceCommitRevisions.some(revision => !SHA.test(String(revision || "")))
    || !Array.isArray(sourceCommitProviderActors)
    || sourceCommitProviderActors.length !== sourceHistorySubjects.length
    || sourceCommitProviderActors.some((actor, index) =>
      actor?.revision !== sourceCommitRevisions[index]
      || actor.authorLogin !== pullRequest.mergedBy
      || actor.committerLogin !== pullRequest.mergedBy)) {
    throw new Error("Provider-generated legacy squash actor attribution is not exact.");
  }
  const expected = [
    headline,
    "",
    ...sourceHistorySubjects.flatMap((subject, index) => index === 0
      ? [`* ${subject}`]
      : ["", `* ${subject}`]),
    "",
    expectedBody,
  ].join("\n");
  const expectedManagedTrailers = String(expectedBody).split("\n").slice(-4).join("\n");
  if (message !== expected || !hasExactFinalManagedTrailers(message)
    || finalTrailerBlock(message).join("\n") !== expectedManagedTrailers) {
    throw new Error("Provider-generated legacy squash managed attribution framing is not exact.");
  }
  return Object.freeze([...sourceHistorySubjects]);
}

function exactProviderGeneratedMessage({
  root,
  baseSha,
  headSha,
  headline,
  expectedBody,
  message,
  pullRequest,
}) {
  if (pullRequest.autoMergeRequest?.mergeMethod !== "SQUASH"
    || pullRequest.autoMergeRequest.commitHeadline !== headline
    || pullRequest.autoMergeRequest.commitBody !== null
    || pullRequest.autoMergeRequest.enabledBy?.login !== pullRequest.mergedBy
    || pullRequest.autoMergeRequest.enabledBy?.isBot !== false) {
    throw new Error("Generic evidence recovery lacks its exact null-body squash cause.");
  }
  const commits = git(root, ["rev-list", "--reverse", `${baseSha}..${headSha}`])
    .split("\n").filter(Boolean);
  if (commits.length < 1) throw new Error("Generic evidence recovery has no source history.");
  const sourceHistorySubjects = commits.map(revision => exactCommitSubject(root, revision));
  const authors = uniqueCommitAuthors(commits.map(revision => exactCommitAuthor(root, revision)));
  const attributionTrailers = authors
    .map(author => `Co-authored-by: ${author.name} <${author.email}>`);
  const bullets = providerBulletSubjects({
    message,
    headline,
    expectedBody,
    attributionTrailers,
    sourceHistorySubjects,
  });
  return [
    headline,
    "",
    ...bullets.flatMap((subject, index) => index === 0
      ? [`* ${subject}`]
      : ["", `* ${subject}`]),
    "",
    expectedBody,
    "",
    "---------",
    "",
    ...attributionTrailers,
  ].join("\n");
}
function classifyGenericRecoveryVariant({ changes, evidencePath, subject }) {
  const evidenceDocument = `docs/CANONICAL-SQUASH-PR${subject.pullRequest.number}-ATTRIBUTION-RECOVERY.md`;
  if (evidencePath === evidenceDocument && changes.length === 1
    && changes[0].path === evidenceDocument && changes[0].status === "A"
    && changes[0].oldMode === "000000" && changes[0].newMode === "100644") {
    return "evidence-document";
  }
  if (evidencePath === GENERIC_SELF_HOSTED_RECOVERY_EVIDENCE_PATH
    && JSON.stringify(changes.map(entry => entry.path))
      === JSON.stringify(GENERIC_SELF_HOSTED_RECOVERY_PATHS)
    && changes.every(entry => entry.status === "M"
      && entry.oldMode === "100644" && entry.newMode === "100644"
      && entry.oldBlob !== entry.newBlob)) {
    return "self-hosted-controller-update";
  }
  throw new Error("Generic recovery is neither its evidence document nor controller update.");
}
function requireExactOwnedRegularPaths({
  changes,
  integrationPaths,
  admission,
  cloudAuthority,
  label,
  allowEvidenceAddition = true,
}) {
  const paths = changes.map(entry => entry.path);
  const expectedScopes = paths.map(repositoryPath => `path:${repositoryPath}`);
  const admissionScopes = (admission?.declaredWriteSet || [])
    .filter(scope => String(scope).startsWith("path:"));
  const cloudScopes = (cloudAuthority?.cloudDeclaredWriteScope || [])
    .filter(scope => String(scope).startsWith("path:"));
  const exactRegular = changes.every(entry => {
    const addition = allowEvidenceAddition && entry.status === "A"
      && entry.oldMode === "000000" && entry.newMode === "100644"
      && entry.oldBlob === "0".repeat(40) && entry.newBlob !== "0".repeat(40);
    const modification = entry.status === "M" && entry.oldMode === "100644"
      && entry.newMode === "100644" && entry.oldBlob !== entry.newBlob;
    return addition || modification;
  });
  if (!exactRegular || new Set(paths).size !== paths.length
    || JSON.stringify(paths) !== JSON.stringify(integrationPaths)
    || JSON.stringify(expectedScopes) !== JSON.stringify(admissionScopes)
    || JSON.stringify(expectedScopes) !== JSON.stringify(cloudScopes)
    || JSON.stringify(admission?.declaredWriteSet)
      !== JSON.stringify(cloudAuthority?.cloudDeclaredWriteScope)
    || admission?.writeSetDigest !== cloudAuthority?.writeSetDigest
    || admission?.manifestDigest !== cloudAuthority?.manifestDigest) {
    throw new Error(`${label} does not own its exact regular-file delta.`);
  }
}
function exactGenericCompletedRecoveryPaths({ lease, sourceHeadSha }) {
  if (Array.isArray(lease?.integration?.paths)) return lease.integration.paths;
  if ((lease?.integration ?? null) !== null || lease?.reviewHeadSha !== sourceHeadSha
    || (lease?.deliveryHeadSha ?? null) !== null) return undefined;
  const admissionPaths = (lease.admission?.declaredWriteSet || [])
    .filter(scope => String(scope).startsWith("path:"))
    .map(scope => scope.slice("path:".length));
  const cloudPaths = (lease.cloudAuthority?.cloudDeclaredWriteScope || [])
    .filter(scope => String(scope).startsWith("path:"))
    .map(scope => scope.slice("path:".length));
  if (JSON.stringify(admissionPaths) !== JSON.stringify(cloudPaths)) return undefined;
  return admissionPaths;
}
function expectedLegacyRecoveryFrontmatter({ frontmatter, subject, controllerEvidence }) {
  return Object.freeze({
    title: `Runtime Pin ${subject.pinTransition.newRevision.slice(0, 8)} Squash Attribution Recovery`,
    doc_type: "Recovery Evidence",
    status: "source-backed",
    lang: "en-US",
    frontmatter_contract: "required",
    failed_protected_main_sha: subject.malformedCommit.sha,
    reviewed_pull_request: String(subject.pullRequest.number),
    reviewed_source_head: subject.reviewedHeadSha,
    reviewed_source_tree: subject.reviewedTreeSha,
    reviewed_run_id: frontmatter.reviewed_run_id,
    post_merge_run_id: frontmatter.post_merge_run_id,
    controller_source: controllerEvidence.repository,
    controller_revision: frontmatter.controller_revision,
    deployment_authority: "forbidden",
  });
}
function expectedGenericEvidenceFrontmatter({ frontmatter, subject, controllerEvidence }) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(frontmatter.date)) {
    throw new Error("Generic recovery evidence date is not canonical.");
  }
  return Object.freeze({
    title: `Canonical Squash PR${subject.pullRequest.number} Attribution Recovery`,
    graphId: `md:canonical-squash-pr${subject.pullRequest.number}-attribution-recovery`,
    doc_type: "Recovery Evidence",
    date: frontmatter.date,
    lang: "en-US",
    schema: "agentic-canonical-squash-attribution-recovery-evidence/v1",
    frontmatter_contract: "required",
    status: "source-backed",
    authority: `append-only evidence for protected PR${subject.pullRequest.number} terminalization`,
    runtime_scope: "attribution recovery evidence only",
    runtime_proof: "protected pull-request and post-main CI evidence",
    failed_protected_main_sha: subject.malformedCommit.sha,
    reviewed_pull_request: String(subject.pullRequest.number),
    reviewed_source_head: subject.reviewedHeadSha,
    reviewed_source_tree: subject.reviewedTreeSha,
    reviewed_run_id: frontmatter.reviewed_run_id,
    post_merge_run_id: frontmatter.post_merge_run_id,
    controller_source: controllerEvidence.repository,
    controller_revision: subject.malformedCommit.sha,
    deployment_authority: "forbidden",
  });
}
function expectedGenericSelfHostedFrontmatter() {
  return Object.freeze({
    title: "Canonical Squash Attribution Recovery Terminalization",
    graphId: "md:canonical-squash-attribution-recovery-terminalization",
    doc_type: "Recovery Contract",
    date: "2026-08-30",
    lang: "en-US",
    schema: "agentic-canonical-squash-attribution-recovery-terminalization-doc/v1",
    frontmatter_contract: "required",
    status: "runtime-ready",
    authority: "repository-owned terminalization after one exact append-only squash-attribution recovery",
    runtime_scope: "integrated cloud retirement and local completion-ready projection only",
    runtime_proof: "focused contract, controller, CLI, repository-adapter, response-loss, and provider-inventory tests",
  });
}
function exactDeclaredRunId(value, label) {
  if (!/^[1-9][0-9]*$/u.test(String(value || ""))
    || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${label} must be one canonical positive integer.`);
  }
  return Number(value);
}
function gitBlobAt(root, revision, repositoryPath) {
  const raw = execFileSync("git", ["-C", root, "ls-tree", "-z", revision, "--", repositoryPath], {
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
  });
  const match = /^([0-7]{6}) blob ([0-9a-f]{40})\t([^\0]+)\0$/u.exec(raw);
  if (!match || match[3] !== repositoryPath) {
    throw new Error(`Exact Git blob ${revision}:${repositoryPath} is missing.`);
  }
  const bytes = execFileSync("git", ["-C", root, "cat-file", "blob", match[2]], {
    encoding: "buffer", maxBuffer: 32 * 1024 * 1024,
  });
  return Object.freeze({ mode: match[1], sha: match[2], bytes });
}
function optionalRuntimeReadinessPinTransition({
  root,
  baseSha,
  headSha,
  changes,
  targetRepository,
  controllerRepository,
}) {
  if (changes.length === 1 && changes[0].path === "docs/runtime-readiness-contract.md") {
    return exactRuntimeReadinessPinTransition({ root, baseSha, headSha, changes });
  }
  if (targetRepository !== controllerRepository) {
    throw new Error("Generic squash attribution recovery is limited to its controller repository.");
  }
  return null;
}
function exactRuntimeReadinessPinTransition({ root, baseSha, headSha, changes }) {
  const repositoryPath = "docs/runtime-readiness-contract.md";
  if (changes.length !== 1 || changes[0].path !== repositoryPath
    || changes[0].status !== "M" || changes[0].oldMode !== "100644"
    || changes[0].newMode !== "100644") {
    throw new Error("Subject reviewed delta is not the exact runtime-readiness pin update.");
  }
  const before = gitBlobAt(root, baseSha, repositoryPath);
  const after = gitBlobAt(root, headSha, repositoryPath);
  if (before.sha !== changes[0].oldBlob || after.sha !== changes[0].newBlob) {
    throw new Error("Runtime-readiness pin blobs do not join the reviewed Git delta.");
  }
  const beforeText = before.bytes.toString("utf8");
  const afterText = after.bytes.toString("utf8");
  const pattern = /(^|\n)(  ref: ")([0-9a-f]{40})("\n)/gu;
  const beforeMatches = [...beforeText.matchAll(pattern)];
  const afterMatches = [...afterText.matchAll(pattern)];
  if (beforeMatches.length !== 1 || afterMatches.length !== 1) {
    throw new Error("Runtime-readiness document must contain one exact protected pin.");
  }
  const oldRevision = beforeMatches[0][3];
  const newRevision = afterMatches[0][3];
  const expectedAfter = beforeText.slice(0, beforeMatches[0].index)
    + beforeMatches[0][0].replace(oldRevision, newRevision)
    + beforeText.slice(beforeMatches[0].index + beforeMatches[0][0].length);
  if (oldRevision === newRevision || expectedAfter !== afterText) {
    throw new Error("Runtime-readiness reviewed delta changes more than its exact ACOS pin.");
  }
  return Object.freeze({
    path: repositoryPath,
    oldRevision,
    newRevision,
    oldBlob: before.sha,
    newBlob: after.sha,
    oldContentDigest: sha256(before.bytes),
    newContentDigest: sha256(after.bytes),
  });
}
function exactCommitSubject(root, revision) {
  const [subject] = gitCommit(root, revision).message.split("\n");
  return required(subject, "source commit subject");
}
function readProviderCommit({ repository, revision, ghText }) {
  const value = JSON.parse(ghText(["api", "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2026-03-10", `repos/${repository}/commits/${revision}`]));
  if (value?.sha !== revision || value.commit?.verification?.verified !== true
    || value.commit.verification.reason !== "valid") {
    throw new Error("Protected commit lacks an exact verified provider signature.");
  }
  return Object.freeze({ sha: value.sha,
    treeSha: requiredSha(value.commit?.tree?.sha, "provider commit tree"),
    parentShas: (value.parents || []).map(parent => requiredSha(parent.sha, "provider parent")),
    message: required(value.commit?.message, "provider commit message"),
    verificationDigest: digestValue(value.commit.verification) });
}
function readProviderCommitActors({ repository, revision, ghText }) {
  const value = JSON.parse(ghText(["api", "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2026-03-10", `repos/${repository}/commits/${revision}`]));
  if (value?.sha !== revision || !value.author?.login || !value.committer?.login) {
    throw new Error("Source commit lacks exact provider actor attribution.");
  }
  return Object.freeze({
    revision,
    authorLogin: value.author.login,
    committerLogin: value.committer.login,
  });
}
function requireProviderCommitJoin(provider, local, label) {
  if (provider.sha !== local.sha || provider.treeSha !== local.treeSha
    || digestValue(provider.parentShas) !== digestValue(local.parentShas)
    || provider.message !== local.message) {
    throw new Error(`${label} provider and Git commit objects disagree.`);
  }
}
function hasExactFinalManagedTrailers(message) {
  const lines = String(message).split("\n");
  const block = lines.slice(-4);
  return /^Agentic-Task: [a-z0-9-]+$/u.test(block[0] || "")
    && /^Agentic-Scope: [a-z0-9-]+$/u.test(block[1] || "")
    && /^Agentic-Lease-Epoch: [1-9][0-9]*$/u.test(block[2] || "")
    && block[3] === "Agentic-Mechanism: Agentic Canvas OS protected integration"
    && block[0].slice(15) === block[1].slice(16);
}
function finalTrailerBlock(message) {
  const lines = String(message).split("\n");
  const result = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!/^[A-Za-z0-9-]+: .+$/u.test(lines[index])) break;
    result.unshift(lines[index]);
  }
  return result;
}

function parseFrontmatter(text, fields = RECOVERY_FRONTMATTER) {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(text);
  if (!match) throw new Error("Recovery evidence frontmatter is missing.");
  const values = {};
  const lines = match[1].split("\n");
  if (lines.length !== fields.length) {
    throw new Error("Recovery frontmatter must contain exactly its declared key set.");
  }
  for (const [index, line] of lines.entries()) {
    const field = /^([A-Za-z0-9_]+):\s+"([^"\r\n]*)"$/u.exec(line);
    if (!field || field[1] !== fields[index]) {
      throw new Error("Recovery frontmatter contains an unknown, malformed, or reordered field.");
    }
    if (Object.hasOwn(values, field[1])) {
      throw new Error(`Recovery frontmatter duplicates ${field[1]}.`);
    }
    values[field[1]] = field[2];
  }
  for (const name of fields) {
    if (!Object.hasOwn(values, name)) throw new Error(`Recovery frontmatter lacks ${name}.`);
  }
  return Object.freeze(values);
}

const SELF_HOSTED_REQUIRED_JOB_STEPS = Object.freeze([
  "Require exact CI authorization",
  "Run npm run collab:test",
]);

export function classifySelfHostedSuccessfulJobInventory({ jobs, repository, runId }) {
  repositoryName(repository, "self-hosted CI repository");
  if (!Number.isSafeInteger(runId) || runId < 1 || !Array.isArray(jobs)) {
    throw new Error("Self-hosted CI job inventory input is invalid.");
  }
  const materializedJobIds = [];
  const providerProjectionJobIds = [];
  const seenJobIds = new Set();
  for (const job of jobs.filter(candidate => candidate?.name === "collaboration-integration")) {
    const jobId = job?.databaseId;
    if (!Number.isSafeInteger(jobId) || jobId < 1 || seenJobIds.has(jobId)
      || !Array.isArray(job.steps)) {
      throw new Error("Self-hosted CI collaboration job identity is invalid or duplicated.");
    }
    seenJobIds.add(jobId);
    const materializedUrl = `https://github.com/${repository}/actions/runs/${runId}/job/${jobId}`;
    const providerProjectionUrl = `https://github.com/${repository}/runs/${jobId}`;
    if (job.url === materializedUrl) {
      if (job.status !== "completed" || job.conclusion !== "success" || job.steps.length === 0) {
        throw new Error("Self-hosted CI materialized collaboration job is not successful.");
      }
      const requiredSteps = SELF_HOSTED_REQUIRED_JOB_STEPS.map(name =>
        job.steps
          .map((step, index) => ({ step, index }))
          .filter(({ step }) => step?.name === name));
      if (requiredSteps.some(matches => matches.length !== 1
        || matches[0].step.status !== "completed"
        || matches[0].step.conclusion !== "success")
        || requiredSteps[0][0].index >= requiredSteps[1][0].index) {
        throw new Error("Self-hosted CI materialized collaboration job lacks exact successful required steps.");
      }
      materializedJobIds.push(jobId);
      continue;
    }
    if (job.url !== providerProjectionUrl || job.status !== "completed"
      || job.conclusion !== "success" || job.steps.length !== 0) {
      throw new Error("Self-hosted CI collaboration job inventory contains an invalid provider projection.");
    }
    providerProjectionJobIds.push(jobId);
  }
  if (materializedJobIds.length !== 1) {
    throw new Error("Self-hosted CI job inventory must contain exactly one materialized collaboration job.");
  }
  return Object.freeze({
    materializedJobId: materializedJobIds[0],
    providerProjectionJobIds: Object.freeze(providerProjectionJobIds.sort((left, right) => left - right)),
  });
}

function requireSuccessfulRun(ghText, repository, id, sha, event, branch, label,
  expectedJobId = null, profile = LEGACY_INTEGRATION_RUN_PROFILE) {
  const run = JSON.parse(ghText([
    "run", "view", String(id), "--repo", repository,
    "--json", "databaseId,event,headBranch,headSha,status,conclusion,workflowName,jobs,url",
  ]));
  const workflowName = profile === LEGACY_INTEGRATION_RUN_PROFILE
    ? "Integration"
    : profile === SELF_HOSTED_CI_RUN_PROFILE ? "CI" : null;
  const jobName = profile === LEGACY_INTEGRATION_RUN_PROFILE
    ? "Integration Gate"
    : profile === SELF_HOSTED_CI_RUN_PROFILE ? "collaboration-integration" : null;
  const workflowPath = profile === SELF_HOSTED_CI_RUN_PROFILE
    ? ".github/workflows/ci.yml"
    : null;
  if (!workflowName || !jobName || run.databaseId !== id || run.headSha !== sha
    || run.status !== "completed"
    || run.conclusion !== "success" || run.workflowName !== workflowName
    || run.event !== event || run.headBranch !== branch) {
    throw new Error(`${label} is not exact and successful.`);
  }
  let jobDatabaseId;
  if (profile === SELF_HOSTED_CI_RUN_PROFILE) {
    jobDatabaseId = classifySelfHostedSuccessfulJobInventory({
      jobs: run.jobs,
      repository,
      runId: id,
    }).materializedJobId;
  } else {
    const jobs = (run.jobs || []).filter(job => job.name === jobName
      && job.status === "completed" && job.conclusion === "success");
    if (jobs.length !== 1 || !Number.isSafeInteger(jobs[0].databaseId)) {
      throw new Error(`${label} lacks its exact successful ${jobName} job.`);
    }
    jobDatabaseId = jobs[0].databaseId;
  }
  if (expectedJobId !== null && jobDatabaseId !== expectedJobId) {
    throw new Error(`${label} job identity drifted from the pull-request check.`);
  }
  return Object.freeze({ databaseId: run.databaseId, jobDatabaseId,
    event: run.event, headBranch: run.headBranch, headSha: run.headSha,
    workflowName: run.workflowName,
    ...(workflowPath ? { workflowPath } : {}),
    conclusion: run.conclusion });
}
function selectedPullRequestIntegrationRun(ghText, repository, pullRequest,
  profile = LEGACY_INTEGRATION_RUN_PROFILE) {
  return newestTerminalIntegrationRun(
    ghText,
    repository,
    pullRequest.headSha,
    "pull_request",
    pullRequest.headBranch,
    null,
    "recovery pull-request run",
    profile,
  );
}
function newestTerminalIntegrationRun(ghText, repository, sha, event, branch,
  expectedRunId = null, label = `recovery ${event} run`,
  profile = LEGACY_INTEGRATION_RUN_PROFILE) {
  const pages = ghJsonPages(ghText,
    `repos/${repository}/actions/runs?head_sha=${encodeURIComponent(sha)}&event=${encodeURIComponent(event)}&per_page=100`);
  const total = pages[0]?.total_count;
  const runs = pages.flatMap(page => page.workflow_runs || []);
  if (!Number.isSafeInteger(total) || total !== runs.length) {
    throw new Error("Complete Actions run inventory could not be proven.");
  }
  const run = selectNewestExactIntegrationRun(runs, {
    sha, event, branch, expectedRunId, profile,
  });
  return requireSuccessfulRun(ghText, repository, Number(run.id), sha, event, branch,
    label, null, profile);
}

function requirePlanRunsCurrent({ plan, ghText, target }) {
  const subject = plan.evidence.subject;
  const recovery = plan.evidence.recovery;
  const profile = subject.pinTransition === null
    ? SELF_HOSTED_CI_RUN_PROFILE
    : LEGACY_INTEGRATION_RUN_PROFILE;
  const currentSubject = [
    newestTerminalIntegrationRun(ghText, target, subject.reviewedHeadSha,
      "pull_request", subject.pullRequest.headBranch,
      subject.checks[0].databaseId, "subject reviewed-head run", profile),
    newestTerminalIntegrationRun(ghText, target, subject.malformedCommit.sha,
      "push", "main", subject.checks[1].databaseId, "subject post-merge run", profile),
  ];
  const currentRecovery = [
    newestTerminalIntegrationRun(ghText, target, recovery.sourceHeadSha,
      "pull_request", recovery.pullRequest.headBranch,
      recovery.checks[0].databaseId, "recovery reviewed-head run", profile),
    newestTerminalIntegrationRun(ghText, target, recovery.mergeSha,
      "push", "main", recovery.checks[1].databaseId, "recovery post-merge run", profile),
  ];
  if (digestValue(currentSubject) !== subject.checksDigest
    || digestValue(currentRecovery) !== recovery.checksDigest) {
    throw new Error("Recovery Integration run evidence drifted from its sealed newest runs.");
  }
}

export function selectNewestExactIntegrationRun(runs, {
  sha, event, branch, expectedRunId = null,
  profile = LEGACY_INTEGRATION_RUN_PROFILE,
}) {
  if (!Array.isArray(runs) || !SHA.test(String(sha || ""))
    || !["pull_request", "push"].includes(event) || !String(branch || "")
    || ![LEGACY_INTEGRATION_RUN_PROFILE, SELF_HOSTED_CI_RUN_PROFILE]
      .includes(profile)) {
    throw new Error("Integration run selection input is invalid.");
  }
  const exactWorkflow = run => profile === LEGACY_INTEGRATION_RUN_PROFILE
    ? run?.name === "Integration"
    : run?.path === ".github/workflows/ci.yml";
  const candidates = runs.filter(run => run?.head_sha === sha
    && exactWorkflow(run) && run.event === event && run.head_branch === branch);
  const run = candidates.sort((left, right) => Number(right.id) - Number(left.id))[0];
  if (!run || !Number.isSafeInteger(Number(run.id))
    || run.status !== "completed" || run.conclusion !== "success") {
    throw new Error(`Newest Integration run for ${sha} is not terminally successful.`);
  }
  if (expectedRunId !== null && Number(run.id) !== expectedRunId) {
    throw new Error(`Selected Integration run ${expectedRunId} is not the newest exact run.`);
  }
  return Object.freeze(structuredClone(run));
}

function ghJsonPages(ghText, endpoint) {
  const value = JSON.parse(ghText([
    "api", "--hostname", "github.com", "--paginate", "--slurp",
    "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2026-03-10", endpoint,
  ]));
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error("Paginated GitHub inventory is invalid.");
  }
  return value;
}

function createPrivateJournalStore(statePath) {
  const parent = path.dirname(statePath);
  const lockPath = `${statePath}.lock`;
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodExact(parent, 0o700, "journal parent");
  rejectSymlinks(statePath);
  function read() {
    if (!existsSync(statePath)) return null;
    const stat = lstatSync(statePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
      || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) {
      throw new Error("Recovery journal must be one owner-held mode-0600 regular file.");
    }
    return normalizeJournal(JSON.parse(readFileSync(statePath, "utf8")));
  }
  function write({ expected, next }) {
    const current = read();
    const expectedDigest = expected?.journalDigest || null;
    if ((current?.journalDigest || null) !== expectedDigest) {
      throw new Error("Recovery journal changed before compare-and-swap.");
    }
    const normalized = normalizeJournal(next);
    if (current?.journalDigest === normalized.journalDigest) return current;
    const temporary = `${statePath}.tmp.${process.pid}.${randomUUID()}`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(normalized)}\n`, "utf8");
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    renameSync(temporary, statePath);
    const parentFd = openSync(parent, "r");
    try { fsyncSync(parentFd); } finally { closeSync(parentFd); }
    return read();
  }
  function withLock(_context, action) {
    if (typeof action !== "function") throw new Error("Recovery lock action is required.");
    const owner = acquireProcessLock(lockPath);
    const release = () => releaseProcessLock(lockPath, owner);
    try {
      const result = action();
      if (result && typeof result.then === "function") return result.finally(release);
      release();
      return result;
    } catch (error) {
      release();
      throw error;
    }
  }
  return Object.freeze({ read, write, withLock });
}

function acquireProcessLock(lockPath) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const descriptor = openSync(lockPath, "wx", 0o600);
      const owner = { ...processIdentity(process.pid), token: randomUUID() };
      try {
        writeFileSync(descriptor, `${JSON.stringify(owner)}\n`, "utf8");
        fsyncSync(descriptor);
      } finally { closeSync(descriptor); }
      return owner;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const first = readLockIdentity(lockPath);
      const second = readLockIdentity(lockPath);
      if (digestValue(first) !== digestValue(second) || liveProcessIdentity(first)) {
        throw new Error("Another canonical squash recovery process owns the journal lock.");
      }
      renameSync(lockPath, `${lockPath}.stale.${randomUUID()}`);
    }
  }
  throw new Error("Recovery journal lock could not be acquired.");
}
function releaseProcessLock(lockPath, owner) {
  const current = readLockIdentity(lockPath);
  if (digestValue(current) !== digestValue(owner)) {
    throw new Error("Recovery journal lock ownership changed before release.");
  }
  rmSync(lockPath);
}
function processIdentity(pid) {
  return { pid, startedAt: processStart(pid) };
}
function readLockIdentity(lockPath) {
  const stat = lstatSync(lockPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) {
    throw new Error("Recovery journal lock is malformed.");
  }
  return JSON.parse(readFileSync(lockPath, "utf8"));
}
function liveProcessIdentity(identity) {
  if (!Number.isSafeInteger(identity?.pid) || identity.pid < 1) return false;
  try { return processStart(identity.pid) === identity.startedAt; } catch { return false; }
}
function processStart(pid) {
  return String(execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
  })).trim();
}

function rejectSymlinks(value) {
  const parsed = path.parse(value); let cursor = parsed.root;
  for (const part of value.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!existsSync(cursor)) return;
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new Error("Recovery state path cannot traverse a symbolic link.");
    }
  }
}
function filesystemEntryState(value, label) {
  try {
    const stat = lstatSync(value);
    if (stat.isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link.`);
    return "present";
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return "absent";
    throw error;
  }
}
function chmodExact(value, mode, label) {
  const stat = statSync(value);
  if ((stat.mode & 0o777) !== mode || stat.uid !== process.getuid()) {
    throw new Error(`${label} must be owner-held mode ${mode.toString(8)}.`);
  }
}
function physicalDirectory(value, label) {
  const resolved = realpathSync(path.resolve(required(value, label)));
  if (!statSync(resolved).isDirectory()) throw new Error(`${label} must be a directory.`);
  return resolved;
}
function normalizedRepositoryPath(value) {
  const result = required(value, "recovery evidence path");
  if (path.isAbsolute(result) || result.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Recovery evidence path must be one normalized repository-relative path.");
  }
  return result;
}
function scopeFromBranch(branch) {
  const parts = String(branch || "").split("/");
  if (parts[0] !== "agent" || parts.length < 3) {
    throw new Error("Recovery pull request branch is not one managed task branch.");
  }
  return required(parts.slice(2).join("/"), "recovery scope");
}
function externalPrivateFile(value, label, excludedRoots) {
  if (!path.isAbsolute(String(value || ""))) throw new Error(`${label} must be absolute.`);
  const resolved = realpathSync(value);
  requireExternalDestination(resolved, label, excludedRoots);
  const stat = lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must be one owner-held mode-0600 regular file.`);
  }
  return resolved;
}
function requireExternalDestination(value, label, excludedRoots) {
  if (!path.isAbsolute(String(value || ""))) throw new Error(`${label} must be absolute.`);
  rejectSymlinks(value);
  const candidate = resolveThroughExistingAncestor(path.resolve(value));
  for (const rootValue of excludedRoots) {
    const root = resolveThroughExistingAncestor(path.resolve(rootValue));
    if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
      throw new Error(`${label} must remain outside repository, worktree, controller, and Git roots.`);
    }
  }
  return candidate;
}
function resolveThroughExistingAncestor(value) {
  const suffix = [];
  let cursor = value;
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.resolve(existsSync(cursor) ? realpathSync(cursor) : cursor, ...suffix);
}
function requireRunCapability(value) {
  if (!value) throw new Error("Run requires the original task capability.");
  const stat = lstatSync(value);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid()) {
    throw new Error("Task capability must be one owner-held mode-0600 regular file.");
  }
}
function git(root, args) {
  return String(execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  })).trim();
}
function lsRemote(root, ref) {
  const lines = git(root, ["ls-remote", "origin", ref]).split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error(`Remote ${ref} is missing or ambiguous.`);
  return lines[0].split(/\s+/u)[0];
}
function lsRemoteOptional(root, ref) {
  const lines = git(root, ["ls-remote", "origin", ref]).split("\n").filter(Boolean);
  if (lines.length > 1) throw new Error(`Remote ${ref} is ambiguous.`);
  return lines.length === 0 ? null : requiredSha(lines[0].split(/\s+/u)[0], `remote ${ref}`);
}
function remoteRepository(root) {
  const value = git(root, ["remote", "get-url", "origin"]);
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/u
    .exec(value);
  if (!match) throw new Error("Remote repository is not exact github.com identity.");
  return `${match[1]}/${match[2]}`;
}
function isAncestor(root, ancestor, descendant) {
  try { execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", ancestor, descendant]); return true; }
  catch { return false; }
}
function required(value, label) { if (typeof value !== "string" || !value) throw new Error(`${label} is required.`); return value; }
function requiredDigest(value, label) { if (!DIGEST.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function requiredSha(value, label) { if (!SHA.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function positive(value, label) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} is invalid.`); return result; }
function repositoryName(value, label) { if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
