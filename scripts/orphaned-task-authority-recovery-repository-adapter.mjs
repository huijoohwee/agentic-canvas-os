// Responsibility: Bind the recovery transaction to Git, GitHub, lease CAS, proof, and snapshots.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import { createActiveOwnedDirtSnapshot }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import {
  assertOnlyTaskAuthorityChanged,
  captureOrphanedTaskAuthorityGitEvidence,
  captureOrphanedTaskAuthoritySource,
  requireSameOrphanedTaskAuthorityGitEvidence,
  writerLeaseBodyRemainder,
} from "./orphaned-task-authority-recovery-evidence.mjs";
import {
  assertTaskAuthorityBinding,
  createTaskAuthorityBinding,
  createTaskAuthorityProof,
  projectTaskAuthorityCapability,
  verifyTaskAuthorityProof,
} from "./task-bound-lane-authority-contract.mjs";
import { readTaskAuthorityCapability }
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

export function createOrphanedTaskAuthorityRecoveryRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(requiredText(options.repository, "repository")));
  const capabilityPath = requireExternalCapability(repository, options.targetCapabilityPath);
  const execute = (command, args, settings = {}) => execFileSync(command, args, {
    cwd: repository,
    encoding: "utf8",
    stdio: [settings.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    ...settings,
  });
  const gitText = dependencies.gitText || (args => execute("git", args).trim());
  const ghText = dependencies.ghText || (args => execute("gh", args).trim());
  const branch = requiredText(gitText(["branch", "--show-current"]), "branch");
  if (options.branch && options.branch !== branch) {
    throw new Error("Requested branch does not match the registered worktree branch.");
  }
  const commonDirectory = path.resolve(
    repository,
    gitText(["rev-parse", "--git-common-dir"]),
  );
  const leaseStore = dependencies.leaseStore
    || createWriterLeaseStore({ gitCommonDir: commonDirectory });
  const inspectCloud = dependencies.inspectCloud || invokeRepositoryCloudAction;
  const environment = options.environment || process.env;

  function readLease() {
    const lease = leaseStore.read(branch);
    if (!lease || lease.branch !== branch) throw new Error("Recovery writer lease is missing.");
    return lease;
  }

  function readCloudClaim(lease = readLease()) {
    const authority = lease.cloudAuthority;
    const status = inspectCloud({
      action: "status",
      ledgerRepository: authority?.ledgerRepository,
      request: { targetRepository: authority?.targetRepository },
      environment,
    });
    if (status?.schema !== "agentic-cloud-collaboration-result/v1"
      || status.ok !== true || status.action !== "status" || !Array.isArray(status.claims)) {
      throw new Error("Cloud status did not return an authoritative claim inventory.");
    }
    const matches = status.claims.filter(item => item?.claimId === authority?.claimId);
    if (matches.length !== 1) throw new Error("Cloud inventory has no unique source claim.");
    return matches[0];
  }

  function captureSource() {
    return captureOrphanedTaskAuthoritySource({
      repository,
      gitText,
      ghText,
      leaseStore,
      readCloudClaim,
    });
  }

  function readTargetCapability() {
    return readTaskAuthorityCapability(capabilityPath);
  }

  function createTargetBinding(plan) {
    const capability = readTargetCapability();
    if (digestValue(projectTaskAuthorityCapability(capability))
      !== digestValue(plan.targetCapability)) {
      throw new Error("Replacement capability drifted from the authorized plan.");
    }
    const lease = readLease();
    assertSourceOrTargetLease(plan, lease);
    const binding = createTaskAuthorityBinding({
      capability,
      lease,
      bindingMode: "handoff",
      boundAt: plan.plannedAt,
      transitionPlanDigest: plan.planDigest,
      priorBindingDigest: plan.source.taskAuthority.bindingDigest,
    });
    const operation = `orphaned-task-authority-recovery:${plan.planDigest}`;
    const proof = createTaskAuthorityProof({ capability, binding, lease, operation });
    const verified = verifyTaskAuthorityProof({ proof, binding, lease, operation });
    const proofCore = {
      schema: "agentic-orphaned-task-authority-target-proof/v1",
      planDigest: plan.planDigest,
      bindingDigest: binding.bindingDigest,
      proofDigest: verified.proofDigest,
      operation,
    };
    return Object.freeze({
      binding,
      proofReceipt: Object.freeze({ ...proofCore, receiptDigest: digestValue(proofCore) }),
    });
  }

  function currentGitEvidence(plan) {
    const lease = readLease();
    const headSha = requiredSha(gitText(["rev-parse", "HEAD"]), "current HEAD");
    const treeSha = requiredSha(
      gitText(["show", "-s", "--format=%T", headSha]),
      "current tree",
    );
    if (headSha !== plan.source.headSha || treeSha !== plan.source.treeSha) {
      throw new Error("Source HEAD or tree changed from the authorized plan.");
    }
    return captureOrphanedTaskAuthorityGitEvidence({
      repository,
      gitText,
      headSha,
      treeSha,
      declaredWriteSet: lease.admission?.declaredWriteSet ?? lease.declaredWriteSet,
    });
  }

  function assertSourceCurrent(source) {
    const observed = captureSource();
    if (digestValue(observed) !== digestValue(source)) {
      throw new Error("Recovery source drifted from the authorized plan.");
    }
    return observed;
  }

  function createSnapshot(plan) {
    requireSameOrphanedTaskAuthorityGitEvidence(plan.source.git, currentGitEvidence(plan));
    const snapshot = createActiveOwnedDirtSnapshot({
      repository,
      evidence: plan.source.git.evidence,
      claimId: plan.source.claimId,
      planDigest: plan.planDigest,
      timestamp: plan.plannedAt,
    });
    const core = {
      schema: "agentic-orphaned-task-authority-snapshot-receipt/v1",
      planDigest: plan.planDigest,
      evidenceDigest: plan.source.git.evidenceDigest,
      snapshotRef: snapshot.snapshotRef,
      snapshotCommitSha: snapshot.commitSha,
      snapshotReceiptDigest: snapshot.snapshotReceiptDigest,
    };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  }

  function localReceipt(plan, target, lease) {
    assertTaskAuthorityBinding({ binding: target.binding, lease });
    assertOnlyTaskAuthorityChanged({
      sourceLeaseDigest: plan.source.leaseDigest,
      sourceBinding: plan.source.taskAuthority,
      targetLease: lease,
    });
    const core = {
      schema: "agentic-orphaned-task-authority-local-cas-receipt/v1",
      planDigest: plan.planDigest,
      sourceLeaseDigest: plan.source.leaseDigest,
      targetLeaseDigest: writerLeaseDigest(lease),
      targetBindingDigest: target.binding.bindingDigest,
      targetProofReceiptDigest: target.proofReceipt.receiptDigest,
    };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  }

  function replaceLocalBinding(plan, target) {
    const result = mutateWriterLeaseRegistry({
      leaseStore,
      branch,
      expectedLeaseDigest: plan.source.leaseDigest,
      expectedClaimId: plan.source.claimId,
      action: ({ registry, lease }) => {
        if (lease.taskAuthority?.bindingDigest
          !== plan.source.taskAuthority.bindingDigest) {
          throw new Error("Source task-authority binding changed before CAS.");
        }
        const targetLease = { ...lease, taskAuthority: target.binding };
        assertOnlyTaskAuthorityChanged({
          sourceLeaseDigest: plan.source.leaseDigest,
          sourceBinding: plan.source.taskAuthority,
          targetLease,
        });
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
    return localReceipt(plan, target, result.lease);
  }

  function observeLocalBinding(plan, target) {
    const lease = readLease();
    if (lease.taskAuthority?.bindingDigest !== target.binding.bindingDigest) return null;
    return localReceipt(plan, target, lease);
  }

  function readPull(plan) {
    const pull = readOwnershipPullRequest({
      url: plan.source.pullRequest.url,
      branch,
      ghText,
    });
    if (pull.id !== plan.source.pullRequest.id
      || pull.headRefOid !== plan.source.pullRequest.headSha
      || pull.baseRefOid !== plan.source.pullRequest.baseSha
      || pull.isDraft !== plan.source.pullRequest.isDraft
      || digestValue(writerLeaseBodyRemainder(pull.body))
        !== plan.source.pullRequest.bodyRemainderDigest) {
      throw new Error("Pull-request identity or non-marker body changed from the plan.");
    }
    return pull;
  }

  function pullReceipt(plan, target, pull, targetLease) {
    const marker = parseWriterLeasePullRequestBody(pull.body);
    const expected = projectWriterLeasePullRequestMarker(targetLease);
    if (!marker || digestValue(marker) !== digestValue(expected)) return null;
    const core = {
      schema: "agentic-orphaned-task-authority-pr-projection-receipt/v1",
      planDigest: plan.planDigest,
      pullRequestId: pull.id,
      pullRequestUrl: pull.url,
      targetBindingDigest: target.binding.bindingDigest,
      targetMarkerDigest: digestValue(marker),
      bodyDigest: digestValue(pull.body || ""),
    };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  }

  function observePullRequestProjection(plan, target) {
    const targetLease = readLease();
    if (!observeLocalBinding(plan, target)) return null;
    return pullReceipt(plan, target, readPull(plan), targetLease);
  }

  function projectPullRequest(plan, target) {
    const targetLease = readLease();
    if (!observeLocalBinding(plan, target)) {
      throw new Error("PR projection requires the exact local replacement binding.");
    }
    const before = readPull(plan);
    const already = pullReceipt(plan, target, before, targetLease);
    if (already) return already;
    const sourceMarker = parseWriterLeasePullRequestBody(before.body);
    if (!sourceMarker
      || digestValue(sourceMarker) !== plan.source.pullRequest.markerDigest
      || digestValue(before.body || "") !== plan.source.pullRequest.bodyDigest) {
      throw new Error("Pull-request source marker changed before projection.");
    }
    const body = updateWriterLeasePullRequestBody(before.body, targetLease);
    ghText(["pr", "edit", before.url, "--body", body]);
    const receipt = observePullRequestProjection(plan, target);
    if (!receipt) throw new Error("Pull-request marker did not converge to the replacement binding.");
    return receipt;
  }

  function verifyTerminal(plan, target) {
    requireSameOrphanedTaskAuthorityGitEvidence(plan.source.git, currentGitEvidence(plan));
    const local = observeLocalBinding(plan, target);
    const pull = observePullRequestProjection(plan, target);
    if (!local || !pull || digestValue(readCloudClaim()) !== plan.source.cloudClaimDigest) {
      throw new Error("Recovery terminal state does not preserve its exact source identity.");
    }
    const core = {
      schema: "agentic-orphaned-task-authority-terminal-receipt/v1",
      planDigest: plan.planDigest,
      gitEvidenceDigest: plan.source.git.evidenceDigest,
      cloudClaimDigest: plan.source.cloudClaimDigest,
      localReceiptDigest: local.receiptDigest,
      pullRequestReceiptDigest: pull.receiptDigest,
      sourceBytesChanged: false,
      cloudMutated: false,
      merged: false,
      deployed: false,
    };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  }

  return Object.freeze({
    captureSource,
    readTargetCapabilityProjection: () => projectTaskAuthorityCapability(readTargetCapability()),
    assertSourceCurrent,
    createSnapshot,
    createTargetBinding,
    replaceLocalBinding,
    observeLocalBinding,
    projectPullRequest,
    observePullRequestProjection,
    verifyTerminal,
  });
}

function assertSourceOrTargetLease(plan, lease) {
  const binding = lease.taskAuthority;
  if (binding?.bindingDigest !== plan.source.taskAuthority.bindingDigest
    && binding?.authoritySubjectId !== plan.targetCapability.authoritySubjectId) {
    throw new Error("Writer lease has neither the source nor planned target authority.");
  }
  assertOnlyTaskAuthorityChanged({
    sourceLeaseDigest: plan.source.leaseDigest,
    sourceBinding: plan.source.taskAuthority,
    targetLease: lease,
  });
}

function requireExternalCapability(repository, value) {
  const source = requiredText(value, "target capability path");
  if (!path.isAbsolute(source)) throw new Error("Target capability path must be absolute.");
  const target = realpathSync(path.resolve(source));
  const relative = path.relative(repository, target);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
    throw new Error("Target capability must be outside the source repository.");
  }
  return target;
}

function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
function requiredSha(value, label) {
  const sha = requiredText(value, label);
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error(`${label} is invalid.`);
  return sha;
}
