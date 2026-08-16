// Responsibility: Join exact predecessor/successor evidence and CAS-project only ownership metadata.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import { createRepositoryCloudAuthorityHandoffControllerAdapter }
  from "./cloud-authority-handoff-controller.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { continueTaskAuthorityCloudSuccessorBinding }
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

const RECEIPT_SCHEMA = "agentic-reviewed-successor-projection-response-loss-binding/v1";

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
    const lane = handoffAdapter.readPreservedReviewLane({ branch });
    const actor = handoffAdapter.readAuthenticatedOwner();
    const status = handoffAdapter.readCloudStatus({
      ledgerRepository: lane.authority.ledgerRepository,
      targetRepository: lane.authority.targetRepository,
    });
    const sourceLease = lane.lease;
    if (sourceLease.status !== "review_ready" || sourceLease.admission?.status !== "admitted"
      || sourceLease.sessionId !== sessionId || !lane.clean
      || Number(lane.pullRequest.url.split("/").at(-1)) !== pullRequestNumber) {
      throw new Error("Reviewed-successor response-loss source lane is not exact and clean.");
    }
    const predecessorMatches = status.claims.filter(claim => claim.claimId === lane.authority.claimId);
    const successors = status.claims.filter(claim => exactSuccessor({
      claim,
      lane,
      actorId: `github-user:${actor.id}`,
    }));
    if (predecessorMatches.length !== 0 || successors.length !== 1) {
      throw new Error("Reviewed-successor response-loss requires one exact successor and no live predecessor.");
    }
    const successor = successors[0];
    const marker = lane.remoteLease;
    if (!marker || marker.cloudAuthority?.claimId !== lane.authority.claimId
      || marker.epoch !== sourceLease.epoch || marker.reviewHeadSha !== lane.headSha) {
      throw new Error("Reviewed-successor response-loss provider marker changed.");
    }
    const localMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(sourceLease));
    const providerMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(marker));
    const core = {
      observedAt: now().toISOString(),
      repository: successor.repositoryId,
      actorId: `github-user:${actor.id}`,
      workItemId: successor.workItemId,
      branch,
      sessionId,
      local: {
        status: sourceLease.status,
        admissionStatus: sourceLease.admission.status,
        clean: lane.clean,
        baseSha: sourceLease.baseSha,
        headSha: lane.headSha,
        writeSetDigest: sourceLease.admission.writeSetDigest,
        reviewRequestId: lane.authority.reviewRequestId,
        leaseEpoch: lane.authority.leaseEpoch,
        claimId: lane.authority.claimId,
        taskBindingDigest: sourceLease.taskAuthority.bindingDigest,
        leaseDigest: writerLeaseDigest(sourceLease),
        markerDigest: localMarkerDigest,
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
        markerClaimId: marker.cloudAuthority.claimId,
        markerLeaseEpoch: marker.cloudAuthority.leaseEpoch,
        markerDigest: providerMarkerDigest,
      },
      predecessor: {
        claimId: lane.authority.claimId,
        cloudInventoryMatches: predecessorMatches.length,
        leaseEpoch: lane.authority.leaseEpoch,
      },
      successor: {
        cloudInventoryMatches: successors.length,
        claimId: successor.claimId,
        predecessorClaimId: successor.predecessorClaimId,
        state: successor.state,
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
        verificationReceiptDigest: lane.authority.focusedEvidenceDigest,
        authorityDigest: successor.fenceRevision,
      },
    };
    return Object.freeze({
      evidence: Object.freeze({ ...core, evidenceDigest: digestValue(core) }),
      lane,
      status,
      successor,
      sourceLease,
    });
  }

  function inspect() { return inspectFrame().evidence; }

  function project({ plan, taskAuthorityFile }) {
    const frame = inspectFrame();
    if (frame.evidence.evidenceDigest !== plan.evidence.evidenceDigest) {
      throw new Error("Reviewed-successor response-loss evidence changed before projection.");
    }
    const cloudAuthority = projectSuccessorAuthority(frame);
    const targetBeforeBinding = {
      ...frame.sourceLease,
      heartbeatAt: cloudAuthority.expiresAt,
      expiresAt: cloudAuthority.expiresAt,
      cloudAuthority,
    };
    const taskAuthority = continueTaskAuthorityCloudSuccessorBinding({
      sourceLease: frame.sourceLease,
      nextLease: targetBeforeBinding,
      capabilityPath: taskAuthorityFile,
      boundAt: new Date().toISOString(),
    });
    const receiptCore = {
      schema: RECEIPT_SCHEMA,
      planDigest: plan.planDigest,
      branch,
      sourceClaimId: frame.sourceLease.cloudAuthority.claimId,
      successorClaimId: cloudAuthority.claimId,
      sourceBindingDigest: frame.sourceLease.taskAuthority.bindingDigest,
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
  return Object.freeze({ inspect, project, verify });
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
