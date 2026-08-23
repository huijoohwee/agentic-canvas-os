// Responsibility: Inspect and CAS-project only the missing successor task binding after source correction.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import {
  REPAIR_SCHEMA, ZERO_EFFECTS, normalizeRepair, replayDigest,
} from "./source-correction-successor-task-binding-reconciliation-contract.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import { continueTaskAuthorityCloudSuccessorBinding }
  from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
} from "./writer-lease-lib.mjs";
import {
  mutateWriterLeaseRegistry, writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";

export function createRepositorySourceCorrectionSuccessorTaskBindingReconciliationAdapter(
  options = {}, dependencies = {},
) {
  const repository = (dependencies.realpath || realpathSync)(
    path.resolve(required(options.repository, "repository")),
  );
  const branch = required(options.branch, "branch");
  const sessionId = required(options.sessionId, "source session");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull-request number");
  const execute = dependencies.execute || ((command, argumentsList) => execFileSync(
    command, argumentsList, {
      cwd: repository,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  ));
  const git = dependencies.git || (argumentsList => String(execute("git", argumentsList)).trim());
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const now = dependencies.now || (() => new Date());
  const commonDirectory = path.resolve(repository, git(["rev-parse", "--git-common-dir"]));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityPolicy: "projected",
  });

  function inspectFrame() {
    assertExactRegisteredLane({ repository, branch, git });
    const lease = leaseStore.read(branch);
    if (lease?.status !== "active" || lease.sessionId !== sessionId
      || lease.admission?.status !== "admitted"
      || lease.cloudAuthority?.state !== "active") {
      throw new Error("Source-correction successor binding requires its active admitted source lane.");
    }
    const repair = currentSuccessorRepair(lease);
    const localHeadSha = git(["rev-parse", "HEAD"]);
    const remoteHeadSha = remoteHead(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]));
    const clean = git(["status", "--porcelain"]) === "";
    const review = JSON.parse(gh([
      "pr", "view", String(pullRequestNumber), "--json",
      "url,state,isDraft,headRefName,headRefOid,body",
    ]));
    const marker = parseWriterLeasePullRequestBody(review.body);
    const remoteIsLocalAncestor = localHeadSha === remoteHeadSha
      || isAncestor(remoteHeadSha, localHeadSha);
    if (!clean || !isSourceCorrectionSuccessorHeadRelationshipExact({
      localHeadSha,
      remoteHeadSha,
      remoteIsLocalAncestor,
    })
      || review.state !== "OPEN" || review.isDraft !== true
      || review.headRefName !== branch || review.headRefOid !== remoteHeadSha
      || marker?.status !== "active"
      || marker.cloudAuthority?.claimId !== lease.cloudAuthority.claimId
      || marker.taskAuthority?.bindingDigest
        !== (repair?.sourceBindingDigest || lease.taskAuthority?.bindingDigest)
      || marker.fenceSha !== remoteHeadSha) {
      throw new Error("Source-correction successor binding head, PR, and marker fence is not exact.");
    }
    const sourceCorrection = findSourceCorrectionCompletion({
      commonDirectory,
      successorClaimId: lease.cloudAuthority.claimId,
      sourceHeadSha: remoteHeadSha,
    });
    const sourceLeaseDigest = repair?.sourceLeaseDigest || writerLeaseDigest(lease);
    const sourceBindingDigest = repair?.sourceBindingDigest
      || lease.taskAuthority?.bindingDigest;
    if (sourceCorrection.leaseDigest !== sourceLeaseDigest
      || sourceCorrection.successorClaimId !== lease.cloudAuthority.claimId
      || marker.taskAuthority?.bindingDigest !== sourceBindingDigest) {
      throw new Error("Source-correction completion does not join the current successor lease.");
    }
    let bindingSourceLease = null;
    if (repair) {
      if (repair.successorClaimId !== lease.cloudAuthority.claimId
        || repair.predecessorClaimId !== sourceCorrection.sourceClaimId
        || repair.targetBindingDigest !== lease.taskAuthority?.bindingDigest
        || lease.taskAuthority?.priorBindingDigest !== repair.sourceBindingDigest) {
        throw new Error("Terminal source-correction binding repair is not exact.");
      }
    } else {
      bindingSourceLease = {
        ...lease,
        cloudAuthority: {
          ...lease.cloudAuthority,
          claimId: sourceCorrection.sourceClaimId,
        },
      };
      const binding = assertTaskAuthorityBinding({
        binding: lease.taskAuthority,
        lease: bindingSourceLease,
      });
      if (binding.bindingDigest !== sourceBindingDigest
        || lease.cloudAuthority.leaseEpoch <= 1) {
        throw new Error("Retained source-correction task binding is not predecessor-bound.");
      }
    }
    const markerDigest = digestValue(projectWriterLeasePullRequestMarker(marker));
    const core = {
      observedAt: now().toISOString(),
      repository,
      branch,
      sessionId,
      worktreePath: repository,
      localHeadSha,
      remoteHeadSha,
      pullRequest: {
        number: pullRequestNumber,
        url: review.url,
        state: review.state,
        isDraft: review.isDraft,
        headBranch: review.headRefName,
        headSha: review.headRefOid,
        bodyDigest: digestValue(review.body),
      },
      sourceLeaseDigest,
      sourceBindingDigest,
      predecessorClaimId: sourceCorrection.sourceClaimId,
      successorClaimId: sourceCorrection.successorClaimId,
      successorLeaseEpoch: lease.cloudAuthority.leaseEpoch,
      sourceCorrection,
      markerDigest,
      terminalRepair: repair,
    };
    return Object.freeze({
      evidence: Object.freeze({ ...core, evidenceDigest: digestValue(core) }),
      lease,
      marker,
      review,
      bindingSourceLease,
    });
  }

  function inspect() { return inspectFrame().evidence; }

  function isAncestor(ancestor, descendant) {
    try {
      execute("git", ["merge-base", "--is-ancestor", ancestor, descendant]);
      return true;
    } catch {
      return false;
    }
  }

  function project({ plan, taskAuthorityFile, operation }) {
    const frame = inspectFrame();
    if (frame.evidence.terminalRepair) return frame.evidence.terminalRepair;
    if (replayDigest(frame.evidence) !== replayDigest(plan.evidence)) {
      throw new Error("Source-correction successor binding evidence changed before CAS.");
    }
    const boundAt = now().toISOString();
    const taskAuthority = continueTaskAuthorityCloudSuccessorBinding({
      sourceLease: frame.bindingSourceLease,
      nextLease: frame.lease,
      capabilityPath: taskAuthorityFile,
      boundAt,
    });
    const taskAuthorityReceiptDigest = digestValue({
      operation,
      sourceBindingDigest: frame.evidence.sourceBindingDigest,
      targetBindingDigest: taskAuthority.bindingDigest,
      boundAt,
    });
    const repairCore = {
      schema: REPAIR_SCHEMA,
      status: "reconciled",
      planDigest: plan.planDigest,
      branch,
      predecessorClaimId: frame.evidence.predecessorClaimId,
      successorClaimId: frame.evidence.successorClaimId,
      sourceBindingDigest: frame.evidence.sourceBindingDigest,
      targetBindingDigest: taskAuthority.bindingDigest,
      sourceLeaseDigest: frame.evidence.sourceLeaseDigest,
      taskAuthorityReceiptDigest,
      reconciledAt: boundAt,
      ...ZERO_EFFECTS,
    };
    const repair = Object.freeze({
      ...repairCore,
      receiptDigest: digestValue(repairCore),
    });
    mutateWriterLeaseRegistry({
      leaseStore,
      branch,
      expectedLeaseDigest: frame.evidence.sourceLeaseDigest,
      expectedClaimId: frame.evidence.successorClaimId,
      action: ({ registry, lease }) => {
        if (writerLeaseDigest(lease) !== frame.evidence.sourceLeaseDigest
          || lease.taskAuthority?.bindingDigest !== frame.evidence.sourceBindingDigest
          || lease.cloudAuthority?.claimId !== frame.evidence.successorClaimId) {
          throw new Error("Source-correction successor lease changed before atomic repair.");
        }
        const nextLease = {
          ...lease,
          taskAuthority,
          sourceCorrectionSuccessorTaskBindingReconciliation: repair,
        };
        return {
          registry: {
            ...registry,
            leases: { ...registry.leases, [branch]: nextLease },
          },
          lease: nextLease,
          changed: true,
        };
      },
    });
    return repair;
  }

  function verify({ plan }) {
    const frame = inspectFrame();
    const repair = frame.evidence.terminalRepair;
    if (!repair || repair.planDigest !== plan.planDigest
      || repair.predecessorClaimId !== plan.evidence.predecessorClaimId
      || repair.successorClaimId !== plan.evidence.successorClaimId
      || repair.sourceBindingDigest !== plan.evidence.sourceBindingDigest
      || frame.evidence.localHeadSha !== plan.evidence.localHeadSha
      || frame.evidence.remoteHeadSha !== plan.evidence.remoteHeadSha
      || frame.evidence.pullRequest.bodyDigest !== plan.evidence.pullRequest.bodyDigest
      || frame.evidence.markerDigest !== plan.evidence.markerDigest) {
      throw new Error("Source-correction successor binding terminal verification failed.");
    }
    return Object.freeze({
      targetBindingDigest: repair.targetBindingDigest,
      targetLeaseDigest: writerLeaseDigest(frame.lease),
      registryRevision: Number(leaseStore.readRegistry().revision),
      repairReceiptDigest: repair.receiptDigest,
      verifiedAt: now().toISOString(),
      ...ZERO_EFFECTS,
    });
  }

  return Object.freeze({ inspect, project, verify });
}

export function isSourceCorrectionSuccessorHeadRelationshipExact({
  localHeadSha,
  remoteHeadSha,
  remoteIsLocalAncestor,
}) {
  return localHeadSha === remoteHeadSha || remoteIsLocalAncestor === true;
}

export function currentSuccessorRepair(lease) {
  if (!lease?.sourceCorrectionSuccessorTaskBindingReconciliation) return null;
  const repair = normalizeRepair(lease.sourceCorrectionSuccessorTaskBindingReconciliation);
  return repair.successorClaimId === lease.cloudAuthority?.claimId ? repair : null;
}

function assertExactRegisteredLane({ repository, branch, git }) {
  const registered = assertRegisteredWorktree({
    cwd: repository,
    porcelain: git(["worktree", "list", "--porcelain", "-z"]),
    resolvePath: value => path.resolve(value),
  });
  if (registered.branch !== `refs/heads/${branch}`
    || git(["branch", "--show-current"]) !== branch
    || path.resolve(git(["rev-parse", "--show-toplevel"])) !== repository) {
    throw new Error("Source-correction successor binding requires its exact registered worktree.");
  }
}

function findSourceCorrectionCompletion({ commonDirectory, successorClaimId, sourceHeadSha }) {
  const directory = path.join(
    commonDirectory,
    "agentic-canvas-os",
    "reviewed-lane-source-correction",
  );
  const matches = readdirSync(directory)
    .filter(name => name.endsWith(".json"))
    .map(name => JSON.parse(readFileSync(path.join(directory, name), "utf8")))
    .filter(value => value?.status === "complete"
      && value.completion?.schema === "agentic-reviewed-lane-source-correction-completion/v1"
      && value.completion.status === "authoring-restored"
      && value.completion.successorClaimId === successorClaimId
      && value.completion.sourceHeadSha === sourceHeadSha);
  if (matches.length !== 1) {
    throw new Error("Expected one exact completed reviewed-lane source-correction journal.");
  }
  const completion = matches[0].completion;
  const { receiptDigest, ...core } = completion;
  if (digestValue(core) !== receiptDigest) {
    throw new Error("Reviewed-lane source-correction completion receipt is invalid.");
  }
  return Object.freeze({
    planDigest: completion.planDigest,
    sourceClaimId: completion.sourceClaimId,
    successorClaimId: completion.successorClaimId,
    sourceHeadSha: completion.sourceHeadSha,
    leaseDigest: completion.leaseDigest,
    receiptDigest: completion.receiptDigest,
  });
}

function remoteHead(line) {
  const value = String(line || "").split(/\s+/u)[0];
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error("Source-correction successor remote head is unavailable.");
  }
  return value;
}
function required(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`);
  return value;
}
