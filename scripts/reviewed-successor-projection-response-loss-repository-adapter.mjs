// Responsibility: Join exact predecessor/successor evidence and CAS-project only ownership metadata.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import { createRepositoryCloudAuthorityHandoffControllerAdapter }
  from "./cloud-authority-handoff-controller.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { continueTaskAuthorityCloudSuccessorBinding }
  from "./task-bound-lane-authority-store.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import { reviewedSuccessorProjectionResponseLossReplayDigest }
  from "./reviewed-successor-projection-response-loss-contract.mjs";
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

const RECEIPT_SCHEMA = "agentic-reviewed-successor-projection-response-loss-binding/v1";
const PARTIAL_REPAIR_SCHEMA =
  "agentic-reviewed-successor-partial-local-projection-repair/v1";

export function createRepositoryReviewedSuccessorProjectionResponseLossAdapter(
  options = {}, dependencies = {},
) {
  const repository = (dependencies.realpath || realpathSync)(path.resolve(required(options.repository, "repository")));
  const pullRequestNumber = positive(options.pullRequestNumber, "pull-request number");
  const sessionId = required(options.sessionId, "session ID");
  const execute = dependencies.execute || ((command, argumentsList) => execFileSync(
    command, argumentsList, { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"] },
  ));
  const git = dependencies.git || (argumentsList => String(execute("git", argumentsList)).trim());
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const now = dependencies.now || (() => new Date());
  const branch = required(git(["branch", "--show-current"]), "attached branch");
  const commonDirectory = path.resolve(repository, git(["rev-parse", "--git-common-dir"]));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityPolicy: "projected",
  });
  const handoffAdapter = (dependencies.createHandoffAdapter
    || createRepositoryCloudAuthorityHandoffControllerAdapter)({ repository, sessionId }, {
    ...(dependencies.handoffDependencies || {}),
    leaseStore,
  });

  function inspectFrame() {
    const recordedLease = leaseStore.read(branch);
    const lane = recordedLease?.status === "active"
      ? readActivePartialLane(recordedLease)
      : handoffAdapter.readPreservedReviewLane({ branch });
    const actor = handoffAdapter.readAuthenticatedOwner();
    const status = handoffAdapter.readCloudStatus({
      ledgerRepository: lane.authority.ledgerRepository,
      targetRepository: lane.authority.targetRepository,
    });
    const actualLease = lane.lease;
    if (actualLease.admission?.status !== "admitted"
      || actualLease.sessionId !== sessionId || !lane.clean
      || Number(lane.pullRequest.url.split("/").at(-1)) !== pullRequestNumber) {
      throw new Error("Reviewed-successor response-loss source lane is not exact and clean.");
    }
    const actualMatches = status.claims.filter(claim => claim.claimId === lane.authority.claimId);
    const projectedSuccessors = status.claims.filter(claim => exactSuccessor({
      claim,
      lane,
      actorId: `github-user:${actor.id}`,
    }));
    const absentPredecessor = actualMatches.length === 0 && projectedSuccessors.length === 1;
    const currentSuccessor = actualMatches.length === 1
      && exactCurrentSuccessor({ claim: actualMatches[0], lane, actorId: `github-user:${actor.id}` });
    if (!absentPredecessor && !currentSuccessor) {
      throw new Error("Reviewed-successor response-loss requires one exact absent or partial-local successor.");
    }
    const mode = absentPredecessor ? "absent-predecessor" : "partial-local-successor";
    const successor = absentPredecessor ? projectedSuccessors[0] : actualMatches[0];
    const predecessorClaimId = absentPredecessor
      ? lane.authority.claimId
      : required(successor.predecessorClaimId, "successor predecessor claim ID");
    const predecessorMatches = status.claims.filter(claim => claim.claimId === predecessorClaimId);
    if (predecessorMatches.length !== 0) {
      throw new Error("Reviewed-successor response-loss predecessor remains in cloud inventory.");
    }
    const marker = lane.remoteLease;
    const expectedMarkerClaimId = absentPredecessor ? predecessorClaimId : successor.claimId;
    const expectedMarkerLeaseEpoch = absentPredecessor
      ? lane.authority.leaseEpoch
      : successor.leaseEpoch;
    const markerHeadSha = reviewedSuccessorMarkerHeadSha(marker);
    if (!marker || marker.cloudAuthority?.claimId !== expectedMarkerClaimId
      || marker.cloudAuthority?.leaseEpoch !== expectedMarkerLeaseEpoch
      || marker.epoch !== actualLease.epoch || markerHeadSha !== lane.headSha) {
      throw new Error("Reviewed-successor response-loss provider marker changed.");
    }
    const localMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(actualLease));
    const providerMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(marker));
    if (mode === "absent-predecessor" && localMarkerDigest !== providerMarkerDigest) {
      throw new Error("Reviewed-successor response-loss predecessor marker is not exact.");
    }
    const partialLocal = mode === "partial-local-successor"
      ? inspectPartialLocal({ actualLease, marker, predecessorClaimId, successor })
      : null;
    const core = {
      mode,
      observedAt: now().toISOString(),
      repository: successor.repositoryId,
      actorId: `github-user:${actor.id}`,
      workItemId: successor.workItemId,
      branch,
      sessionId,
      local: {
        status: actualLease.status,
        admissionStatus: actualLease.admission.status,
        clean: lane.clean,
        baseSha: actualLease.baseSha,
        headSha: lane.headSha,
        writeSetDigest: actualLease.admission.writeSetDigest,
        reviewRequestId: lane.authority.reviewRequestId,
        leaseEpoch: lane.authority.leaseEpoch,
        claimId: lane.authority.claimId,
        taskBindingDigest: actualLease.taskAuthority.bindingDigest,
        leaseDigest: writerLeaseDigest(actualLease),
        markerDigest: providerMarkerDigest,
      },
      remoteHeadSha: lane.remoteHeadSha,
      pullRequest: {
        number: pullRequestNumber,
        id: lane.authority.reviewRequestId,
        url: lane.pullRequest.url,
        state: lane.pullRequest.state,
        isDraft: lane.pullRequest.isDraft,
        autoMergeRequest: null,
        headRefName: lane.pullRequest.headRefName,
        headRefOid: lane.pullRequest.headRefOid,
        baseRefName: lane.pullRequest.baseRefName,
        markerClaimId: expectedMarkerClaimId,
        markerLeaseEpoch: expectedMarkerLeaseEpoch,
        markerDigest: providerMarkerDigest,
      },
      predecessor: {
        claimId: predecessorClaimId,
        cloudInventoryMatches: predecessorMatches.length,
        leaseEpoch: successor.leaseEpoch - 1,
      },
      successor: {
        cloudInventoryMatches: 1,
        claimId: successor.claimId,
        predecessorClaimId: successor.predecessorClaimId,
        state: successor.state === "current" ? "active" : successor.state,
        actorId: successor.actorId,
        repository: successor.repositoryId,
        workItemId: successor.workItemId,
        canonicalBaseSha: successor.canonicalBaseRevision,
        laneRevision: successor.laneRevision,
        writeSetDigest: successor.writeSetDigest,
        reviewRequestId: successor.reviewRequestId,
        leaseEpoch: successor.leaseEpoch,
        integrationState: successor.integration || successor.integrationReceiptDigest
          ? "integrated" : "not-integrated",
        operationReceiptDigest: successor.operationReceiptDigest,
        verificationReceiptDigest: lane.authority.focusedEvidenceDigest
          || successor.transitionDigest,
        authorityDigest: successor.fenceRevision,
      },
      partialLocal,
    };
    return Object.freeze({
      evidence: Object.freeze({ ...core, evidenceDigest: digestValue(core) }),
      lane,
      status,
      successor,
      actualLease,
      bindingSourceLease: partialLocal?.bindingSourceLease || null,
      mode,
    });
  }

  function inspect() { return inspectFrame().evidence; }

  function readActivePartialLane(lease) {
    const root = path.resolve(git(["rev-parse", "--show-toplevel"]));
    const registered = assertRegisteredWorktree({
      cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]),
      resolvePath: value => path.resolve(value),
    });
    if (root !== repository || registered.branch !== `refs/heads/${branch}`
      || git(["branch", "--show-current"]) !== branch) {
      throw new Error("Partial-local successor requires its exact registered branch worktree.");
    }
    const review = JSON.parse(gh([
      "pr", "view", String(pullRequestNumber), "--json",
      "url,state,isDraft,headRefName,headRefOid,baseRefName,body",
    ]));
    const remoteLine = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
    const remoteHeadSha = remoteLine.split(/\s+/u)[0];
    const headSha = git(["rev-parse", "HEAD"]);
    if (!/^[0-9a-f]{40}$/u.test(remoteHeadSha)
      || headSha !== lease.fenceSha
      || remoteHeadSha !== headSha
      || review.headRefOid !== headSha
      || review.headRefName !== branch
      || review.state !== "OPEN") {
      throw new Error("Partial-local successor head and provider review are not exact.");
    }
    return Object.freeze({
      repository,
      branch,
      headSha,
      remoteHeadSha,
      clean: git(["status", "--porcelain"]) === "",
      baseSha: lease.baseSha,
      lease,
      manifest: lease.admission,
      authority: lease.cloudAuthority,
      pullRequest: Object.freeze(review),
      remoteLease: parseWriterLeasePullRequestBody(review.body),
    });
  }

  function project({ plan, taskAuthorityFile }) {
    const frame = inspectFrame();
    if (!reviewedSuccessorEvidenceMatchesPlan(frame.evidence, plan.evidence)) {
      throw new Error("Reviewed-successor response-loss evidence changed before projection.");
    }
    if (frame.mode === "partial-local-successor") {
      return projectPartialLocal({ frame, plan, taskAuthorityFile });
    }
    const cloudAuthority = projectSuccessorAuthority(frame);
    const targetBeforeBinding = {
      ...frame.actualLease,
      heartbeatAt: cloudAuthority.expiresAt,
      expiresAt: cloudAuthority.expiresAt,
      cloudAuthority,
    };
    const taskAuthority = continueTaskAuthorityCloudSuccessorBinding({
      sourceLease: frame.actualLease,
      nextLease: targetBeforeBinding,
      capabilityPath: taskAuthorityFile,
      boundAt: new Date().toISOString(),
    });
    const receiptCore = {
      schema: RECEIPT_SCHEMA,
      planDigest: plan.planDigest,
      branch,
      sourceClaimId: frame.actualLease.cloudAuthority.claimId,
      successorClaimId: cloudAuthority.claimId,
      sourceBindingDigest: frame.actualLease.taskAuthority.bindingDigest,
      targetBindingDigest: taskAuthority.bindingDigest,
      cloudOperationReceiptDigest: cloudAuthority.operationReceiptDigest,
      cloudVerificationReceiptDigest: frame.lane.authority.focusedEvidenceDigest,
      boundAt: taskAuthority.boundAt,
    };
    const bindingReceipt = Object.freeze({ ...receiptCore, receiptDigest: digestValue(receiptCore) });
    const targetLease = {
      ...targetBeforeBinding,
      taskAuthority,
      reviewedSuccessorProjectionResponseLoss: bindingReceipt,
    };
    const projected = mutateWriterLeaseRegistry({
      leaseStore,
      branch,
      expectedLeaseDigest: frame.evidence.local.leaseDigest,
      expectedClaimId: frame.evidence.local.claimId,
      action: ({ registry }) => ({
        registry: { ...registry, leases: { ...registry.leases, [branch]: targetLease } },
        lease: targetLease,
        changed: true,
      }),
    });
    const body = updateWriterLeasePullRequestBody(frame.lane.pullRequest.body, projected.lease);
    execute("gh", ["pr", "edit", frame.lane.pullRequest.url, "--body", body]);
    const targetMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(projected.lease));
    return Object.freeze({
      expectedLeaseDigest: frame.evidence.local.leaseDigest,
      expectedMarkerDigest: frame.evidence.local.markerDigest,
      expectedSuccessorClaimId: cloudAuthority.claimId,
      binding: taskAuthority,
      successorReceipt: bindingReceipt,
      targetCloudAuthority: cloudAuthority,
      taskAuthorityReceiptDigest: bindingReceipt.receiptDigest,
      targetLeaseDigest: writerLeaseDigest(projected.lease),
      targetBindingDigest: taskAuthority.bindingDigest,
      successorReceiptDigest: bindingReceipt.receiptDigest,
      targetMarkerDigest,
      registryRevision: projected.registryRevision,
    });
  }

  function verify({ plan }) {
    const lease = leaseStore.read(branch);
    const review = JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--json", "body,headRefOid,state,isDraft,url"]));
    const marker = parseWriterLeasePullRequestBody(review.body);
    if (plan.evidence.mode === "partial-local-successor") {
      return verifyPartialLocal({ lease, marker, review, plan });
    }
    const receipt = lease?.reviewedSuccessorProjectionResponseLoss;
    const exact = lease?.cloudAuthority?.claimId === plan.evidence.successor.claimId
      && lease?.taskAuthority?.priorBindingDigest === plan.evidence.local.taskBindingDigest
      && receipt?.planDigest === plan.planDigest
      && marker?.cloudAuthority?.claimId === plan.evidence.successor.claimId
      && marker?.taskAuthority?.bindingDigest === lease?.taskAuthority?.bindingDigest
      && review.headRefOid === plan.evidence.local.headSha
      && review.state === "OPEN" && review.isDraft === false;
    if (!exact) throw new Error("Reviewed-successor response-loss terminal projection is not exact.");
    return Object.freeze({
      targetLeaseDigest: writerLeaseDigest(lease),
      targetMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(marker)),
      registryRevision: Number(leaseStore.readRegistry().revision),
      verifiedAt: now().toISOString(),
    });
  }

  function projectPartialLocal({ frame, plan, taskAuthorityFile }) {
    const partial = frame.evidence.partialLocal;
    if (partial.projectionState === "repaired") {
      return partialLocalProjection({
        lease: frame.actualLease,
        markerDigest: frame.evidence.local.markerDigest,
        plan,
      });
    }
    const boundAt = now().toISOString();
    const taskAuthority = continueTaskAuthorityCloudSuccessorBinding({
      sourceLease: frame.bindingSourceLease,
      nextLease: frame.actualLease,
      capabilityPath: taskAuthorityFile,
      boundAt,
    });
    const receiptCore = {
      schema: PARTIAL_REPAIR_SCHEMA,
      status: "repaired",
      evidenceDigest: plan.evidence.evidenceDigest,
      branch,
      predecessorClaimId: plan.evidence.predecessor.claimId,
      successorClaimId: plan.evidence.successor.claimId,
      sourceBindingDigest: partial.sourceBindingDigest,
      targetBindingDigest: taskAuthority.bindingDigest,
      boundAt,
      cloudEffect: false,
      pullRequestEffect: false,
      gitEffect: false,
      sourceEffect: false,
      integrationEffect: false,
      deploymentEffect: false,
    };
    const repair = Object.freeze({ ...receiptCore, receiptDigest: digestValue(receiptCore) });
    const projected = mutateWriterLeaseRegistry({
      leaseStore,
      branch,
      expectedLeaseDigest: frame.evidence.local.leaseDigest,
      expectedClaimId: frame.evidence.local.claimId,
      action: ({ registry, lease }) => {
        if (stableLeaseDigest(lease) !== partial.stableLeaseDigest
          || lease.cloudAuthority?.claimId !== frame.successor.claimId) {
          throw new Error("Partial-local successor lease changed before atomic repair.");
        }
        const nextLease = {
          ...lease,
          taskAuthority,
          reviewedSuccessorPartialLocalProjectionRepair: repair,
        };
        return {
          registry: { ...registry, leases: { ...registry.leases, [branch]: nextLease } },
          lease: nextLease,
          changed: true,
        };
      },
    });
    return partialLocalProjection({
      lease: projected.lease,
      markerDigest: frame.evidence.local.markerDigest,
      plan,
      registryRevision: projected.registryRevision,
    });
  }

  function verifyPartialLocal({ lease, marker, review, plan }) {
    const repair = normalizePartialRepair(lease?.reviewedSuccessorPartialLocalProjectionRepair);
    const markerDigest = digestValue(projectWriterLeasePullRequestMarker(marker));
    if (lease?.cloudAuthority?.claimId !== plan.evidence.successor.claimId
      || marker?.cloudAuthority?.claimId !== plan.evidence.successor.claimId
      || marker?.taskAuthority?.bindingDigest !== repair.sourceBindingDigest
      || markerDigest !== plan.evidence.local.markerDigest
      || repair.predecessorClaimId !== plan.evidence.predecessor.claimId
      || repair.successorClaimId !== plan.evidence.successor.claimId
      || lease.taskAuthority?.bindingDigest !== repair.targetBindingDigest
      || lease.taskAuthority?.priorBindingDigest !== repair.sourceBindingDigest
      || review.headRefOid !== plan.evidence.local.headSha
      || review.state !== "OPEN") {
      throw new Error("Partial-local successor terminal repair is not exact.");
    }
    const registryRevision = Number(leaseStore.readRegistry().revision);
    const projection = partialLocalProjection({ lease, markerDigest, plan, registryRevision });
    const terminal = Object.freeze({
      targetLeaseDigest: projection.targetLeaseDigest,
      targetMarkerDigest: projection.targetMarkerDigest,
      registryRevision,
      verifiedAt: now().toISOString(),
    });
    return plan.evidence.partialLocal.projectionState === "repaired"
      ? Object.freeze({ projection, terminal })
      : terminal;
  }

  function partialLocalProjection({ lease, markerDigest, plan, registryRevision = null }) {
    const repair = normalizePartialRepair(lease.reviewedSuccessorPartialLocalProjectionRepair);
    const revision = registryRevision ?? Number(leaseStore.readRegistry().revision);
    return Object.freeze({
      expectedLeaseDigest: plan.evidence.local.leaseDigest,
      expectedMarkerDigest: plan.evidence.local.markerDigest,
      expectedSuccessorClaimId: plan.evidence.successor.claimId,
      binding: lease.taskAuthority,
      successorReceipt: repair,
      targetCloudAuthority: lease.cloudAuthority,
      taskAuthorityReceiptDigest: repair.receiptDigest,
      targetBindingDigest: lease.taskAuthority.bindingDigest,
      successorReceiptDigest: repair.receiptDigest,
      targetLeaseDigest: writerLeaseDigest(lease),
      targetMarkerDigest: markerDigest,
      registryRevision: revision,
    });
  }
  return Object.freeze({ inspect, project, verify });
}

export function reviewedSuccessorMarkerHeadSha(marker) {
  return marker?.status === "review_ready" ? marker?.reviewHeadSha : marker?.fenceSha;
}

export function reviewedSuccessorEvidenceMatchesPlan(liveEvidence, plannedEvidence) {
  return reviewedSuccessorProjectionResponseLossReplayDigest(liveEvidence)
    === reviewedSuccessorProjectionResponseLossReplayDigest(plannedEvidence);
}

function exactSuccessor({ claim, lane, actorId }) {
  return claim?.claimId !== lane.authority.claimId
    && claim?.predecessorClaimId === lane.authority.claimId
    && new Set(["reviewed", "dormant-preserved"]).has(claim.state)
    && claim.actorId === actorId
    && claim.canonicalBaseRevision === lane.baseSha
    && claim.laneRevision === lane.headSha
    && claim.writeSetDigest === lane.manifest.writeSetDigest
    && claim.reviewRequestId === lane.authority.reviewRequestId
    && claim.leaseEpoch === lane.authority.leaseEpoch + 1
    && !claim.integration && !claim.integrationReceiptDigest;
}
function exactCurrentSuccessor({ claim, lane, actorId }) {
  return typeof claim?.predecessorClaimId === "string"
    && claim.predecessorClaimId !== claim.claimId
    && new Set(["current", "active", "reviewed", "dormant-preserved"]).has(claim.state)
    && claim.actorId === actorId
    && claim.canonicalBaseRevision === lane.baseSha
    && claim.laneRevision === lane.headSha
    && claim.writeSetDigest === lane.manifest.writeSetDigest
    && claim.reviewRequestId === lane.authority.reviewRequestId
    && claim.leaseEpoch === lane.authority.leaseEpoch
    && claim.claimId === lane.authority.claimId
    && !claim.integration && !claim.integrationReceiptDigest;
}
function inspectPartialLocal({ actualLease, marker, predecessorClaimId, successor }) {
  const repairValue = actualLease.reviewedSuccessorPartialLocalProjectionRepair;
  const stableDigest = stableLeaseDigest(actualLease);
  if (repairValue) {
    const repair = normalizePartialRepair(repairValue);
    if (repair.branch !== actualLease.branch
      || repair.predecessorClaimId !== predecessorClaimId
      || repair.successorClaimId !== successor.claimId
      || repair.targetBindingDigest !== actualLease.taskAuthority?.bindingDigest
      || actualLease.taskAuthority?.priorBindingDigest !== repair.sourceBindingDigest
      || marker.taskAuthority?.bindingDigest !== repair.sourceBindingDigest) {
      throw new Error("Partial-local successor repair receipt is not exact.");
    }
    return Object.freeze({
      projectionState: "repaired",
      stableLeaseDigest: stableDigest,
      actualLease,
      bindingSourceLease: null,
      sourceBindingDigest: repair.sourceBindingDigest,
      repair,
    });
  }
  const bindingSourceLease = {
    ...actualLease,
    cloudAuthority: { ...actualLease.cloudAuthority, claimId: predecessorClaimId },
  };
  const binding = assertTaskAuthorityBinding({
    binding: actualLease.taskAuthority,
    lease: bindingSourceLease,
  });
  if (marker.taskAuthority?.bindingDigest !== binding.bindingDigest) {
    throw new Error("Partial-local successor provider marker does not retain the predecessor binding.");
  }
  return Object.freeze({
    projectionState: "pending",
    stableLeaseDigest: stableDigest,
    actualLease,
    bindingSourceLease,
    sourceBindingDigest: binding.bindingDigest,
    repair: null,
  });
}
function stableLeaseDigest(lease) {
  const {
    taskAuthority: _taskAuthority,
    reviewedSuccessorPartialLocalProjectionRepair: _repair,
    ...stable
  } = lease;
  return digestValue(stable);
}
function normalizePartialRepair(value) {
  const keys = [
    "schema", "status", "evidenceDigest", "branch", "predecessorClaimId",
    "successorClaimId", "sourceBindingDigest", "targetBindingDigest", "boundAt",
    "cloudEffect", "pullRequestEffect", "gitEffect", "sourceEffect",
    "integrationEffect", "deploymentEffect", "receiptDigest",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== keys.sort().join("\0")
    || value.schema !== PARTIAL_REPAIR_SCHEMA || value.status !== "repaired"
    || ["cloudEffect", "pullRequestEffect", "gitEffect", "sourceEffect",
      "integrationEffect", "deploymentEffect"].some(key => value[key] !== false)
    || new Date(value.boundAt).toISOString() !== value.boundAt) {
    throw new Error("Partial-local successor repair receipt is invalid.");
  }
  const { receiptDigest, ...core } = value;
  if (receiptDigest !== digestValue(core)) {
    throw new Error("Partial-local successor repair receipt digest is invalid.");
  }
  return Object.freeze({ ...value });
}
function projectSuccessorAuthority({ lane, status, successor }) {
  return Object.freeze({
    ...lane.authority,
    claimId: successor.claimId,
    claimDigest: successor.fenceRevision,
    ledgerRevision: status.ledgerRevision,
    ledgerDigest: status.ledgerDigest,
    claimLedgerRevision: successor.transitionDigest,
    operationReceiptDigest: successor.operationReceiptDigest,
    canonicalBaseSha: successor.canonicalBaseRevision,
    laneRevision: successor.laneRevision,
    cloudDeclaredWriteScope: [...successor.declaredWriteScope],
    writeSetDigest: successor.writeSetDigest,
    reviewRequestId: successor.reviewRequestId,
    leaseEpoch: successor.leaseEpoch,
    transitionCounter: successor.transitionCounter,
    state: "review_ready",
    expiresAt: successor.expiresAt,
    focusedEvidenceDigest: lane.authority.focusedEvidenceDigest,
    integrationReceiptDigest: null,
    integration: null,
  });
}
function required(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`); return value.trim(); }
function positive(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} must be positive.`); return number; }
