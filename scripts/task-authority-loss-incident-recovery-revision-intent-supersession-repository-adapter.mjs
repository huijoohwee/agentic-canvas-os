// Responsibility: Prove the exact recovered owner lane and CAS-supersede only its stale prepared revision intent.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeCompletedSourceCorrectionFenceRecoveryIntent,
} from "./completed-source-correction-fence-recovery-contract.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import {
  normalizeReviewedLaneSourceCorrectionIntent,
} from "./reviewed-lane-source-correction-contract.mjs";
import { readReviewedLaneRevisionIntent } from "./reviewed-lane-revision-fence.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import {
  currentSuccessorRepair,
} from "./source-correction-successor-task-binding-reconciliation-repository-adapter.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import {
  mutateWriterLeaseRegistry,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";
import {
  OPERATION,
  RECEIPT_SCHEMA,
  authorizeRevisionIntentSupersession,
  buildRevisionIntentSupersessionEvidence,
  buildRevisionIntentSupersessionPlan,
  buildRevisionIntentSupersessionReceipt,
  normalizeRevisionIntentSupersessionPlan,
  normalizeRevisionIntentSupersessionReceipt,
} from "./task-authority-loss-incident-recovery-revision-intent-supersession-contract.mjs";

const RUNTIME_PATHS = Object.freeze([
  "scripts/task-authority-loss-incident-recovery-revision-intent-supersession-contract.mjs",
  "scripts/task-authority-loss-incident-recovery-revision-intent-supersession-repository-adapter.mjs",
  "scripts/task-authority-loss-incident-recovery-revision-intent-supersession.mjs",
]);

export function createRevisionIntentSupersessionRepositoryController(options = {}, dependencies = {}) {
  const runtime = createRuntime(options, dependencies);
  return Object.freeze({
    async plan() {
      return buildRevisionIntentSupersessionPlan({ evidence: await runtime.inspect() });
    },
    async run({ authorization } = {}) {
      const replay = runtime.readReplay();
      if (replay) {
        authorizeRevisionIntentSupersession({ plan: replay.planSnapshot, authorization });
        return replay;
      }
      const plan = buildRevisionIntentSupersessionPlan({ evidence: await runtime.inspect() });
      authorizeRevisionIntentSupersession({ plan, authorization });
      return runtime.supersede({ plan, authorization });
    },
  });
}

export function applyRevisionIntentSupersession({
  leaseStore,
  branch,
  plan,
  authorization,
  taskAuthorityReceipt,
  now = () => new Date(),
}) {
  const normalized = normalizeRevisionIntentSupersessionPlan(plan);
  const expectedLeaseDigest = normalized.evidence.lease.leaseDigest;
  const expectedClaimId = normalized.evidence.lease.claimId;
  const result = mutateWriterLeaseRegistry({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action: ({ registry, lease }) => {
      const current = registry.reviewedLaneRevisionIntents?.[branch] ?? null;
      const replay = readSupersessionReceipt(current);
      if (replay) {
        if (replay.planDigest !== normalized.planDigest) fail("a different supersession already completed");
        return { registry, lease, intent: replay, changed: false };
      }
      assertPreparedIntent(current, normalized);
      const receipt = buildRevisionIntentSupersessionReceipt({
        plan: normalized,
        authorization,
        taskAuthorityReceiptDigest: taskAuthorityReceipt.receiptDigest,
        supersededIntentDigest: current.intentDigest,
        currentLeaseDigest: writerLeaseDigest(lease),
        completedAt: now().toISOString(),
      });
      const nextCore = {
        ...current,
        status: "superseded",
        currentLeaseDigest: writerLeaseDigest(lease),
        currentClaimId: expectedClaimId,
        journalRevision: current.journalRevision + 1,
        updatedAt: receipt.completedAt,
        values: {
          ...current.values,
          taskAuthorityLossIncidentRecoveryRevisionIntentSupersession: receipt,
        },
      };
      delete nextCore.intentDigest;
      const next = Object.freeze({ ...nextCore, intentDigest: digestValue(nextCore) });
      return {
        registry: {
          ...registry,
          reviewedLaneRevisionIntents: {
            ...(registry.reviewedLaneRevisionIntents || {}),
            [branch]: next,
          },
        },
        lease,
        intent: receipt,
        changed: true,
      };
    },
  });
  return normalizeRevisionIntentSupersessionReceipt(result.intent);
}

function createRuntime(options, dependencies) {
  const repository = (dependencies.realpath || realpathSync)(
    path.resolve(required(options.repository, "repository")),
  );
  const branch = required(options.branch, "branch");
  const sessionId = required(options.sessionId, "session");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request number");
  const taskAuthorityFile = options.taskAuthorityFile
    ? (dependencies.realpath || realpathSync)(path.resolve(options.taskAuthorityFile))
    : null;
  const execute = dependencies.execute || ((command, argumentsList) => execFileSync(
    command,
    argumentsList,
    { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ));
  const git = dependencies.git || (argumentsList => String(execute("git", argumentsList)).trim());
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const now = dependencies.now || (() => new Date());
  const commonDirectory = path.resolve(repository, git(["rev-parse", "--git-common-dir"]));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityFile,
    taskAuthorityPolicy: "projected",
  });
  const key = createHash("sha256").update(branch).digest("hex");
  const sourceCorrectionPath = path.join(
    commonDirectory,
    "agentic-canvas-os",
    "reviewed-lane-source-correction",
    `${key}.json`,
  );
  const fenceRecoveryPath = path.join(
    commonDirectory,
    "agentic-canvas-os",
    "completed-source-correction-fence-recovery",
    `${key}.json`,
  );

  function assertLane() {
    if (git(["branch", "--show-current"]) !== branch) fail("checked-out branch");
    const registered = assertRegisteredWorktree({
      cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]),
    });
    if (registered.branch !== `refs/heads/${branch}`) fail("registered branch");
  }

  function currentLease() {
    const lease = leaseStore.read(branch);
    if (lease?.status !== "active" || lease.sessionId !== sessionId
      || realpathSync(lease.worktreePath) !== repository
      || lease.admission?.status !== "admitted"
      || lease.cloudAuthority?.state !== "active"
      || lease.cloudAuthority?.mutationAuthorityEligible !== true
      || !lease.pullRequestUrl?.endsWith(`/pull/${pullRequestNumber}`)
      || Date.parse(lease.expiresAt) <= now().getTime()) fail("current owner lease");
    return lease;
  }

  async function inspect() {
    assertLane();
    const lease = currentLease();
    const intent = readReviewedLaneRevisionIntent({ leaseStore, branch });
    if (!intent || intent.status !== "active" || intent.phase !== "prepared"
      || intent.journalRevision !== 1 || intent.history.length !== 0) fail("prepared-only revision intent");
    const sourceCorrection = normalizeReviewedLaneSourceCorrectionIntent(
      JSON.parse(readFileSync(sourceCorrectionPath, "utf8")),
    );
    const fenceRecovery = normalizeCompletedSourceCorrectionFenceRecoveryIntent(
      JSON.parse(readFileSync(fenceRecoveryPath, "utf8")),
    );
    const correctionReceipt = sourceCorrection.completion;
    const fenceReceipt = fenceRecovery.completion;
    const bindingRepair = currentSuccessorRepair(lease);
    if (sourceCorrection.status !== "complete" || correctionReceipt?.status !== "authoring-restored"
      || fenceRecovery.status !== "complete" || fenceReceipt?.status !== "mutation-authority-restored"
      || correctionReceipt.sourceClaimId !== intent.sourceClaimId
      || correctionReceipt.sourceHeadSha !== intent.values?.revisionIntent?.planSnapshot?.sourceHeadSha
      || correctionReceipt.successorClaimId !== lease.cloudAuthority.claimId
      || fenceReceipt.claimId !== correctionReceipt.successorClaimId
      || fenceReceipt.targetFenceSha !== correctionReceipt.sourceHeadSha
      || bindingRepair?.predecessorClaimId !== correctionReceipt.sourceClaimId
      || bindingRepair.successorClaimId !== correctionReceipt.successorClaimId
      || bindingRepair.targetBindingDigest !== lease.taskAuthority?.bindingDigest) {
      fail("completed recovery lineage");
    }
    const verified = verifyAdmissionCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: lease.admission,
      canonicalBaseSha: lease.baseSha,
    });
    assertVerifiedCurrentClaim({ lease, verified });
    const localHeadSha = git(["rev-parse", "HEAD"]);
    const parentFields = git(["rev-list", "--parents", "-n", "1", localHeadSha]).split(/\s+/u);
    const remoteHeadSha = remoteHead(git([
      "ls-remote", "--heads", "origin", `refs/heads/${branch}`,
    ]));
    const pullRequest = JSON.parse(gh([
      "pr", "view", String(pullRequestNumber), "--json",
      "number,url,state,isDraft,headRefName,headRefOid,autoMergeRequest",
    ]));
    if (parentFields.length !== 2 || parentFields[0] !== localHeadSha
      || parentFields[1] !== remoteHeadSha
      || git(["rev-parse", `${localHeadSha}^{tree}`]) !== git(["rev-parse", `${remoteHeadSha}^{tree}`])
      || pullRequest.number !== pullRequestNumber || pullRequest.state !== "OPEN"
      || pullRequest.isDraft !== true || pullRequest.headRefName !== branch
      || pullRequest.headRefOid !== remoteHeadSha || pullRequest.autoMergeRequest !== null) {
      fail("tree-identical forward child or pull request");
    }
    const runtime = RUNTIME_PATHS.map(runtimePath => ({
      path: runtimePath,
      digest: digestValue(readFileSync(path.join(repository, runtimePath), "utf8")),
    }));
    return buildRevisionIntentSupersessionEvidence({
      repository: JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner,
      branch,
      sessionId,
      pullRequest: {
        number: pullRequest.number,
        url: pullRequest.url,
        headSha: pullRequest.headRefOid,
        isDraft: pullRequest.isDraft,
      },
      git: {
        protectedMainSha: git(["rev-parse", "origin/main"]),
        remoteHeadSha,
        localHeadSha,
        parentSha: parentFields[1],
        remoteTreeSha: git(["rev-parse", `${remoteHeadSha}^{tree}`]),
        localTreeSha: git(["rev-parse", `${localHeadSha}^{tree}`]),
        worktreeStateDigest: digestValue(git([
          "status", "--porcelain=v1", "--untracked-files=all",
        ])),
      },
      lease: {
        leaseDigest: writerLeaseDigest(lease),
        claimId: lease.cloudAuthority.claimId,
        taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
        manifestDigest: lease.admission.manifestDigest,
        writeSetDigest: lease.admission.writeSetDigest,
      },
      revisionIntent: {
        intentDigest: intent.intentDigest,
        planDigest: intent.planDigest,
        sourceClaimId: intent.sourceClaimId,
        sourceHeadSha: intent.values.revisionIntent.planSnapshot.sourceHeadSha,
      },
      recovery: {
        sourceCorrectionJournalDigest: digestValue(sourceCorrection),
        sourceCorrectionReceiptDigest: correctionReceipt.receiptDigest,
        fenceRecoveryJournalDigest: digestValue(fenceRecovery),
        fenceRecoveryReceiptDigest: fenceReceipt.receiptDigest,
        taskBindingReconciliationReceiptDigest: bindingRepair.receiptDigest,
        predecessorClaimId: correctionReceipt.sourceClaimId,
        successorClaimId: correctionReceipt.successorClaimId,
      },
      runtime: { digest: digestValue(runtime), paths: RUNTIME_PATHS },
    });
  }

  function readReplay() {
    const intent = readReviewedLaneRevisionIntent({ leaseStore, branch });
    return readSupersessionReceipt(intent);
  }

  function supersede({ plan, authorization }) {
    if (!taskAuthorityFile) throw new Error("Revision-intent supersession run requires --task-authority.");
    const refreshed = currentLease();
    if (writerLeaseDigest(refreshed) !== plan.evidence.lease.leaseDigest) fail("lease changed after planning");
    const taskAuthorityReceipt = authorizeTaskBoundLeaseMutation({
      lease: refreshed,
      capabilityPath: taskAuthorityFile,
      operation: OPERATION,
      now: now(),
    });
    return applyRevisionIntentSupersession({
      leaseStore,
      branch,
      plan,
      authorization,
      taskAuthorityReceipt,
      now,
    });
  }

  return { inspect, readReplay, supersede };
}

function assertPreparedIntent(current, plan) {
  if (!current || current.schema !== "agentic-reviewed-lane-revision-journal/v1"
    || current.status !== "active" || current.phase !== "prepared"
    || current.journalRevision !== 1 || current.history?.length !== 0
    || current.intentDigest !== plan.evidence.revisionIntent.intentDigest
    || current.planDigest !== plan.evidence.revisionIntent.planDigest
    || current.sourceClaimId !== plan.evidence.revisionIntent.sourceClaimId
    || current.values?.revisionIntent?.planSnapshot?.sourceHeadSha
      !== plan.evidence.revisionIntent.sourceHeadSha) fail("prepared revision intent changed before CAS");
}

function readSupersessionReceipt(intent) {
  const value = intent?.values?.taskAuthorityLossIncidentRecoveryRevisionIntentSupersession;
  return value?.schema === RECEIPT_SCHEMA
    ? normalizeRevisionIntentSupersessionReceipt(value)
    : null;
}
function assertVerifiedCurrentClaim({ lease, verified }) {
  const authority = verified?.authority;
  const verification = verified?.verification;
  if (verification?.status !== "ready"
    || authority?.claimId !== lease.cloudAuthority.claimId
    || authority.claimDigest !== lease.cloudAuthority.claimDigest
    || authority.claimLedgerRevision !== lease.cloudAuthority.claimLedgerRevision
    || authority.operationReceiptDigest !== lease.cloudAuthority.operationReceiptDigest
    || authority.canonicalBaseSha !== lease.cloudAuthority.canonicalBaseSha
    || authority.laneRevision !== lease.fenceSha
    || authority.writeSetDigest !== lease.admission.writeSetDigest
    || authority.reviewRequestId !== lease.cloudAuthority.reviewRequestId
    || authority.state !== "active" || authority.mutationAuthorityEligible !== true
    || verification.claimId !== authority.claimId
    || verification.claimDigest !== authority.claimDigest
    || verification.laneRevision !== authority.laneRevision
    || verification.writeSetDigest !== authority.writeSetDigest
    || verification.reviewRequestId !== authority.reviewRequestId) {
    fail("verified current successor claim");
  }
}
function remoteHead(value) { const candidate = String(value || "").split(/\s+/u)[0]; if (!/^[0-9a-f]{40}$/u.test(candidate)) fail("remote head"); return candidate; }
function required(value, label) { if (typeof value !== "string" || !value.trim()) fail(label); return value.trim(); }
function positive(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) fail(label); return number; }
function fail(label) { throw new Error(`Revision-intent supersession requires exact ${label}.`); }
