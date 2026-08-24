// Responsibility: Verify recovery lineage and CAS-rebind only the stale active-owned-dirt intent.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { normalizeActiveOwnedDirtRecoveryIntent }
  from "./active-owned-dirt-recovery-registry.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
import {
  OPERATION,
  authorizeActiveOwnedDirtIntentSupersession,
  buildActiveOwnedDirtIntentSupersessionPlan,
  buildActiveOwnedDirtIntentSupersessionReceipt,
  createSuccessorActiveOwnedDirtRecoveryPlan,
} from "./active-owned-dirt-task-authority-intent-supersession-contract.mjs";

export function createActiveOwnedDirtIntentSupersessionRepositoryController(options = {}, dependencies = {}) {
  const runtime = createRuntime(options, dependencies);
  return Object.freeze({
    async plan() { return buildActiveOwnedDirtIntentSupersessionPlan({ evidence: runtime.inspect() }); },
    async run({ authorization } = {}) {
      const plan = buildActiveOwnedDirtIntentSupersessionPlan({ evidence: runtime.inspect() });
      authorizeActiveOwnedDirtIntentSupersession({ plan, authorization });
      return runtime.supersede({ plan, authorization });
    },
  });
}

export function applyActiveOwnedDirtIntentSupersession({
  leaseStore, branch, plan, taskAuthorityReceipt,
}) {
  const expectedLeaseDigest = plan.evidence.lease.leaseDigest;
  const expectedClaimId = plan.evidence.lease.claimId;
  const successorPlan = createSuccessorActiveOwnedDirtRecoveryPlan({
    sourcePlan: leaseStore.readRegistry().activeOwnedDirtRecoveryIntents?.[branch]?.planSnapshot,
    currentLeaseDigest: expectedLeaseDigest,
  });
  const result = mutateWriterLeaseRegistry({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action: ({ registry, lease }) => {
      const current = normalizeActiveOwnedDirtRecoveryIntent(
        registry.activeOwnedDirtRecoveryIntents?.[branch] ?? null,
      );
      if (current?.status === "cloud"
        && current.sourceLeaseDigest === expectedLeaseDigest
        && current.planDigest === successorPlan.planDigest) {
        return { registry, lease, intent: { successorPlan, replayed: true }, changed: false };
      }
      if (current?.status !== "cloud"
        || digestValue(current) !== plan.evidence.intent.intentDigest
        || current.planDigest !== plan.evidence.intent.planDigest
        || current.sourceLeaseDigest !== plan.evidence.intent.sourceLeaseDigest
        || current.sourceClaimId !== expectedClaimId
        || writerLeaseDigest(lease) !== expectedLeaseDigest) {
        throw new Error("Active-owned-dirt intent changed before supersession CAS.");
      }
      const next = normalizeActiveOwnedDirtRecoveryIntent({
        ...current,
        sourceLeaseDigest: expectedLeaseDigest,
        planDigest: successorPlan.planDigest,
        planSnapshot: successorPlan,
      });
      return {
        registry: {
          ...registry,
          activeOwnedDirtRecoveryIntents: {
            ...(registry.activeOwnedDirtRecoveryIntents || {}),
            [branch]: next,
          },
        },
        lease,
        intent: { successorPlan, replayed: false },
        changed: true,
      };
    },
  });
  return buildActiveOwnedDirtIntentSupersessionReceipt({
    plan,
    successorPlanDigest: result.intent.successorPlan.planDigest,
    taskAuthorityReceiptDigest: taskAuthorityReceipt.receiptDigest,
    replayed: result.intent.replayed,
  });
}

function createRuntime(options, dependencies) {
  const repository = (dependencies.realpath || realpathSync)(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request number");
  const authorityRecoveryJournal = (dependencies.realpath || realpathSync)(
    path.resolve(required(options.authorityRecoveryJournal, "authority recovery journal")),
  );
  const taskAuthorityFile = options.taskAuthorityFile
    ? (dependencies.realpath || realpathSync)(path.resolve(options.taskAuthorityFile)) : null;
  const execute = dependencies.execute || ((command, argumentsList) => execFileSync(
    command, argumentsList, { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ));
  const git = dependencies.git || (argumentsList => String(execute("git", argumentsList)).trim());
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const branch = git(["branch", "--show-current"]);
  const commonDirectory = path.resolve(repository, git(["rev-parse", "--git-common-dir"]));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityFile,
    taskAuthorityPolicy: "projected",
  });

  function inspect() {
    if (realpathSync(git(["rev-parse", "--show-toplevel"])) !== repository) fail("exact worktree root");
    const lease = leaseStore.read(branch);
    const leaseDigest = writerLeaseDigest(lease);
    const intent = normalizeActiveOwnedDirtRecoveryIntent(
      leaseStore.readRegistry().activeOwnedDirtRecoveryIntents?.[branch] ?? null,
    );
    const pullRequest = JSON.parse(gh([
      "pr", "view", String(pullRequestNumber), "--json", "number,state,isDraft,headRefName,headRefOid",
    ]));
    const journal = JSON.parse(readFileSync(authorityRecoveryJournal, "utf8"));
    if (lease?.status !== "active" || lease.sessionId !== sessionId
      || realpathSync(lease.worktreePath) !== repository
      || lease.admission?.status !== "admitted"
      || lease.cloudAuthority?.state !== "active"
      || lease.cloudAuthority?.claimId !== intent?.sourceClaimId
      || !lease.taskAuthority?.bindingDigest
      || pullRequest.number !== pullRequestNumber || pullRequest.state !== "OPEN"
      || pullRequest.isDraft !== true || pullRequest.headRefName !== branch
      || pullRequest.headRefOid !== lease.fenceSha
      || intent?.status !== "cloud" || intent.localProjection !== null
      || intent.pullRequestProjection !== null || intent.finalReceiptDigest !== null
      || journal?.status !== "complete" || journal.phase !== "complete"
      || journal.sourceLeaseDigest !== intent.sourceLeaseDigest
      || journal.targetBindingDigest !== lease.taskAuthority.bindingDigest
      || journal.completion?.status !== "complete"
      || journal.completion?.targetBindingDigest !== lease.taskAuthority.bindingDigest
      || journal.completion?.sourceBytesChanged !== false
      || journal.completion?.cloudMutated !== false
      || journal.completion?.merged !== false || journal.completion?.deployed !== false
      || leaseDigest === intent.sourceLeaseDigest) {
      fail("stale cloud-phase intent and completed authority-recovery lineage");
    }
    return Object.freeze({
      repository: JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner,
      branch,
      sessionId,
      pullRequestNumber,
      headSha: git(["rev-parse", "HEAD"]),
      lease: {
        leaseDigest,
        claimId: lease.cloudAuthority.claimId,
        taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
      },
      intent: {
        status: intent.status,
        intentDigest: digestValue(intent),
        planDigest: intent.planDigest,
        sourceLeaseDigest: intent.sourceLeaseDigest,
        sourceClaimId: intent.sourceClaimId,
        snapshotReceiptDigest: intent.snapshot.snapshotReceiptDigest,
        cloudReceiptDigest: intent.cloud.cloudReceiptDigest,
      },
      authorityRecovery: {
        journalDigest: digestValue(journal),
        planDigest: journal.planDigest,
        sourceLeaseDigest: journal.sourceLeaseDigest,
        targetBindingDigest: journal.targetBindingDigest,
        resultDigest: journal.completion.resultDigest,
      },
    });
  }

  function supersede({ plan }) {
    if (!taskAuthorityFile) fail("task-authority capability");
    const lease = leaseStore.read(branch);
    if (writerLeaseDigest(lease) !== plan.evidence.lease.leaseDigest) fail("unchanged current lease");
    const taskAuthorityReceipt = authorizeTaskBoundLeaseMutation({
      lease,
      capabilityPath: taskAuthorityFile,
      operation: OPERATION,
    });
    return applyActiveOwnedDirtIntentSupersession({
      leaseStore, branch, plan, taskAuthorityReceipt,
    });
  }
  return { inspect, supersede };
}

function required(value, label) { if (typeof value !== "string" || !value.trim()) fail(label); return value.trim(); }
function positive(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) fail(label); return number; }
function fail(label) { throw new Error(`Intent supersession requires exact ${label}.`); }
