// Responsibility: Normalize path-free evidence for reopening one reviewed lane as its same owner.
import {
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import {
  parseWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export const SOURCE_EVIDENCE_SCHEMA =
  "agentic-reviewed-lane-source-correction-evidence/v2";
export const SAME_CLAIM_RECOVERY_SPLIT_SCHEMA =
  "agentic-reviewed-lane-same-claim-recovery-split/v1";

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const WRITER_MARKER = /<!--\s*agentic-writer-lease\/v2\s+\{/gu;

export function buildReviewedLaneSourceCorrectionEvidence(input = {}) {
  const core = normalizeCore({
    schema: SOURCE_EVIDENCE_SCHEMA,
    repository: input.repository,
    actor: input.actor,
    localHeadSha: input.localHeadSha,
    remoteHeadSha: input.remoteHeadSha,
    clean: input.clean,
    lease: input.lease,
    authority: input.authority || input.lease?.cloudAuthority,
    claim: input.claim,
    pullRequest: input.pullRequest,
    protectedAdvance: input.protectedAdvance,
    sameClaimRecovery: input.sameClaimRecovery ?? null,
  });
  return freeze({ ...core, evidenceDigest: digestValue(core) });
}

export function buildSameClaimRecoverySplitEvidence({ lease, marker, journal }) {
  const repair = lease?.sameClaimDormantReviewedContinuation;
  if (!repair) return null;
  const predecessor = { ...lease, cloudAuthority: marker?.cloudAuthority,
    heartbeatAt: marker?.heartbeatAt, expiresAt: marker?.expiresAt };
  const targetSubject = { ...lease };
  delete predecessor.sameClaimDormantReviewedContinuation;
  delete targetSubject.sameClaimDormantReviewedContinuation;
  const effects = { cloud: repair.cloudEffect, pullRequest: repair.pullRequestEffect,
    source: repair.sourceEffect, git: repair.gitEffect, merge: repair.mergeEffect,
    integration: repair.integrationEffect, deployment: repair.deploymentEffect };
  const journalCore = without(journal, "journalDigest");
  const repairCore = without(repair, "receiptDigest");
  const completion = journal?.completion;
  const completionCore = without(completion, "receiptDigest");
  const values = journal?.values;
  const projection = values?.projection;
  const terminal = values?.terminal;
  const cloudRecovery = values?.cloudRecovery;
  if (
    repair.schema !== "agentic-same-claim-dormant-reviewed-continuation-local-repair/v1"
    || repair.status !== "recovered"
    || repair.receiptDigest !== digestValue(repairCore)
    || writerLeaseDigest(predecessor) !== repair.sourceLeaseDigest
    || writerLeaseDigest(targetSubject) !== repair.targetLeaseSubjectDigest
    || journal?.schema !== "agentic-same-claim-dormant-reviewed-continuation-journal/v1"
    || journal.phase !== "complete"
    || journal.journalDigest !== digestValue(journalCore)
    || journal.planDigest !== repair.planDigest
    || values?.taskAuthorityReceipt?.receiptDigest !== repair.taskAuthorityReceiptDigest
    || cloudRecovery?.recoveryDigest !== repair.cloudRecoveryDigest
    || repair.cloudRecovery?.recoveryDigest !== repair.cloudRecoveryDigest
    || projection?.localRepair?.receiptDigest !== repair.receiptDigest
    || projection?.taskAuthorityReceiptDigest !== repair.taskAuthorityReceiptDigest
    || projection?.cloudRecoveryDigest !== repair.cloudRecoveryDigest
    || projection?.targetLeaseDigest !== writerLeaseDigest(lease)
    || terminal?.localRepairReceiptDigest !== repair.receiptDigest
    || terminal?.targetLeaseDigest !== projection?.targetLeaseDigest
    || terminal?.registryRevision !== projection?.registryRevision
    || completion?.planDigest !== repair.planDigest
    || completion?.claimId !== repair.claimId
    || completion?.taskAuthorityReceiptDigest !== repair.taskAuthorityReceiptDigest
    || completion?.cloudRecoveryDigest !== repair.cloudRecoveryDigest
    || completion?.localRepairReceiptDigest !== repair.receiptDigest
    || completion?.targetLeaseDigest !== projection?.targetLeaseDigest
    || completion?.registryRevision !== projection?.registryRevision
    || completion?.verifiedAt !== terminal?.verifiedAt
    || completion?.receiptDigest !== digestValue(completionCore)
    || completion?.policy?.cloudRecovery !== "same-claim-only"
    || completion?.policy?.localLeaseCas !== true
    || completion?.policy?.authoringAuthorityGranted !== false
    || Object.values(effects).some(Boolean)
    || ["pullRequestMutation", "sourceMutation", "gitRefMutation", "mergeMutation",
      "integrationMutation", "deployMutation"].some(key => completion?.policy?.[key] !== false)
  ) invalid("same-claim recovery proof");
  return freeze({
    schema: SAME_CLAIM_RECOVERY_SPLIT_SCHEMA,
    status: "completed",
    planDigest: repair.planDigest,
    claimId: repair.claimId,
    predecessorClaimDigest: marker.cloudAuthority.claimDigest,
    predecessorTransitionCounter: marker.cloudAuthority.transitionCounter,
    recoveredClaimDigest: lease.cloudAuthority.claimDigest,
    recoveredTransitionCounter: lease.cloudAuthority.transitionCounter,
    recoveredOperationReceiptDigest: lease.cloudAuthority.operationReceiptDigest,
    sourceLeaseDigest: repair.sourceLeaseDigest,
    targetLeaseDigest: projection.targetLeaseDigest,
    localRepairReceiptDigest: repair.receiptDigest,
    cloudRecoveryDigest: repair.cloudRecoveryDigest,
    taskAuthorityReceiptDigest: repair.taskAuthorityReceiptDigest,
    registryRevision: projection.registryRevision,
    completionReceiptDigest: completion.receiptDigest,
    journalDigest: journal.journalDigest,
    zeroEffectsDigest: digestValue(effects),
  });
}

export function normalizeReviewedLaneSourceCorrectionEvidence(value) {
  if (value?.schema !== SOURCE_EVIDENCE_SCHEMA) invalid("source evidence schema");
  exactKeys(value, [
    "schema", "repository", "actor", "localHeadSha", "remoteHeadSha", "clean",
    "lease", "authority", "claim", "pullRequest", "protectedAdvance", "sameClaimRecovery",
    "evidenceDigest",
  ], "source evidence");
  const core = normalizeCore(value);
  if (digest(value.evidenceDigest, "evidence digest") !== digestValue(core)) {
    invalid("source evidence digest");
  }
  return freeze({ ...core, evidenceDigest: value.evidenceDigest });
}

function normalizeCore(value) {
  const core = {
    schema: SOURCE_EVIDENCE_SCHEMA,
    repository: repository(value.repository),
    actor: actor(value.actor),
    localHeadSha: sha(value.localHeadSha, "local head"),
    remoteHeadSha: sha(value.remoteHeadSha, "remote head"),
    clean: value.clean === true ? true : invalid("clean worktree"),
    lease: lease(value.lease),
    authority: authority(value.authority),
    claim: claim(value.claim),
    pullRequest: pullRequest(value.pullRequest),
    protectedAdvance: protectedAdvance(value.protectedAdvance),
    sameClaimRecovery: sameClaimRecovery(value.sameClaimRecovery),
  };
  assertJoined(core);
  return freeze(core);
}

function repository(value) {
  const result = {
    fullName: text(value?.fullName, "repository name"),
    nodeId: text(value?.nodeId, "repository node ID"),
  };
  exactKeys(value, Object.keys(result), "repository evidence");
  if (!REPOSITORY.test(result.fullName)) invalid("repository name");
  return freeze(result);
}

function actor(value) {
  const result = {
    id: String(value?.id || ""),
    login: text(value?.login, "actor login"),
  };
  exactKeys(value, Object.keys(result), "actor evidence");
  if (!/^[1-9]\d*$/u.test(result.id)) invalid("actor ID");
  return freeze(result);
}

function lease(value) {
  const admission = value?.admission;
  const result = {
    schema: value?.schema === "agentic-writer-lease/v2" ? value.schema : invalid("lease schema"),
    status: value?.status === "review_ready" ? value.status : invalid("lease status"),
    epoch: integer(value?.epoch, "lease epoch"),
    sessionId: text(value?.sessionId, "source session"),
    device: text(value?.device, "source device"),
    scope: text(value?.scope, "source scope"),
    branch: text(value?.branch, "source branch"),
    baseSha: sha(value?.baseSha, "lease base"),
    fenceSha: sha(value?.fenceSha, "lease fence"),
    reviewHeadSha: sha(value?.reviewHeadSha, "review head"),
    pullRequestUrl: text(value?.pullRequestUrl, "pull-request URL"),
    admission: {
      schema: admission?.schema === "agentic-lane-admission-lease/v1"
        ? admission.schema : invalid("admission schema"),
      status: admission?.status === "admitted" ? admission.status : invalid("admission status"),
      semanticScope: text(admission?.semanticScope, "semantic scope"),
      declaredWriteSet: normalizeWriteSet(admission?.declaredWriteSet),
      writeSetDigest: digest(admission?.writeSetDigest, "write-set digest"),
      manifestDigest: digest(admission?.manifestDigest, "manifest digest"),
      admittedReportDigest: digest(admission?.admittedReportDigest, "admitted report digest"),
    },
  };
  if (digestValue(result.admission.declaredWriteSet) !== result.admission.writeSetDigest) {
    invalid("lease write set");
  }
  return freeze(result);
}

function authority(value) {
  const result = {
    schema: value?.schema === "agentic-lane-cloud-authority/v1"
      ? value.schema : invalid("authority schema"),
    provider: value?.provider === "github" ? "github" : invalid("authority provider"),
    ledgerRepository: text(value?.ledgerRepository, "ledger repository"),
    targetRepository: text(value?.targetRepository, "target repository"),
    claimId: digest(value?.claimId, "claim ID"),
    claimDigest: digest(value?.claimDigest, "claim digest"),
    claimLedgerRevision: digest(value?.claimLedgerRevision, "claim ledger revision"),
    operationReceiptDigest: digest(value?.operationReceiptDigest, "authority operation receipt"),
    canonicalBaseSha: sha(value?.canonicalBaseSha, "authority base"),
    laneRevision: sha(value?.laneRevision, "authority lane revision"),
    writeSetDigest: digest(value?.writeSetDigest, "authority write set"),
    leaseEpoch: integer(value?.leaseEpoch, "authority epoch"),
    transitionCounter: integer(value?.transitionCounter, "authority transition"),
    state: ["review_ready", "parked"].includes(value?.state)
      ? value.state : invalid("authority state"),
    reviewRequestId: text(value?.reviewRequestId, "authority review request"),
    focusedEvidenceDigest: digest(value?.focusedEvidenceDigest, "focused evidence"),
  };
  return freeze(result);
}

function claim(value) {
  const result = {
    claimId: digest(value?.claimId, "claim ID"),
    state: ["reviewed", "integrated-preserved", "dormant-preserved"].includes(value?.state)
      ? value.state : invalid("claim state"),
    recordedState: ["reviewed", "integrated-preserved"].includes(value?.recordedState)
      ? value.recordedState : invalid("claim recorded state"),
    writeAuthority: value?.writeAuthority === false ? false : invalid("claim write authority"),
    scopeReserved: value?.scopeReserved === true ? true : invalid("claim scope reservation"),
    actorId: text(value?.actorId, "claim actor"),
    repositoryId: text(value?.repositoryId, "claim repository"),
    workItemId: text(value?.workItemId, "claim work item"),
    canonicalBaseRevision: sha(value?.canonicalBaseRevision, "claim base"),
    laneRevision: sha(value?.laneRevision, "claim lane revision"),
    declaredWriteScope: normalizeWriteSet(value?.declaredWriteScope),
    writeSetDigest: digest(value?.writeSetDigest, "claim write set"),
    leaseEpoch: integer(value?.leaseEpoch, "claim epoch"),
    transitionCounter: integer(value?.transitionCounter, "claim transition"),
    reviewRequestId: text(value?.reviewRequestId, "claim review request"),
    fenceRevision: digest(value?.fenceRevision, "claim fence"),
    transitionDigest: digest(value?.transitionDigest, "claim transition digest"),
    operationReceiptDigest: digest(value?.operationReceiptDigest, "claim operation receipt"),
    integrationReceiptDigest: optionalDigest(value?.integrationReceiptDigest,
      "claim integration receipt"),
    integration: integration(value?.integration),
    recovery: recovery(value?.recovery),
    deviceId: text(value?.deviceId, "claim device"),
    sessionId: text(value?.sessionId, "claim session"),
  };
  const integrated = result.recordedState === "integrated-preserved";
  if (integrated !== Boolean(result.integration)
    || integrated !== Boolean(result.integrationReceiptDigest)
    || (integrated && (!["integrated-preserved", "dormant-preserved"].includes(result.state)
      || (result.recovery
        ? result.operationReceiptDigest === result.integrationReceiptDigest
        : result.operationReceiptDigest !== result.integrationReceiptDigest)))
    || (!integrated && !["reviewed", "dormant-preserved"].includes(result.state))) {
    invalid("claim lifecycle");
  }
  return freeze({ ...result, recordDigest: digestValue(result) });
}

function recovery(value) {
  if (value === null || value === undefined) return null;
  const result = {
    evidenceDigest: digest(value?.evidenceDigest, "recovery evidence"),
    recoveredAt: instant(value?.recoveredAt, "recovery instant"),
  };
  exactKeys(value, Object.keys(result), "claim recovery");
  return freeze(result);
}

function integration(value) {
  if (value === null) return null;
  const result = {
    candidateRevision: sha(value?.candidateRevision, "integration candidate"),
    reviewRequestId: text(value?.reviewRequestId, "integration review request"),
    focusedEvidenceDigest: digest(value?.focusedEvidenceDigest, "integration focused evidence"),
    dependencyClosureDigest: digest(value?.dependencyClosureDigest, "integration dependency closure"),
    namedChecksDigest: digest(value?.namedChecksDigest, "integration named checks"),
    handoffEvidenceDigest: digest(value?.handoffEvidenceDigest, "integration handoff evidence"),
    operatorDecisionDigest: digest(value?.operatorDecisionDigest, "integration operator decision"),
    integrationIntentDigest: digest(value?.integrationIntentDigest, "integration intent"),
    integratedAt: instant(value?.integratedAt, "integration instant"),
  };
  exactKeys(value, Object.keys(result), "claim integration");
  return freeze(result);
}

function pullRequest(value) {
  const body = typeof value?.body === "string" ? value.body : null;
  const marker = body === null ? value?.writerMarker : parseWriterLeasePullRequestBody(body);
  const result = {
    number: integer(value?.number, "pull-request number"),
    nodeId: text(value?.nodeId || value?.id, "pull-request node ID"),
    url: text(value?.url, "pull-request URL"),
    state: value?.state === "OPEN" ? "OPEN" : invalid("pull-request state"),
    isDraft: value?.isDraft === false ? false : invalid("pull-request draft state"),
    headBranch: text(value?.headBranch || value?.headRefName, "pull-request branch"),
    headSha: sha(value?.headSha || value?.headRefOid, "pull-request head"),
    baseBranch: text(value?.baseBranch || value?.baseRefName, "pull-request base branch"),
    baseSha: sha(value?.baseSha || value?.baseRefOid, "pull-request base"),
    headRepository: text(value?.headRepository, "head repository"),
    baseRepository: text(value?.baseRepository, "base repository"),
    authorLogin: text(value?.authorLogin, "pull-request author"),
    bodyDigest: body === null
      ? digest(value?.bodyDigest, "pull-request body digest")
      : digestValue(body),
    writerMarker: writerMarker(marker),
    autoMergeRequest: value?.autoMergeRequest ?? null,
    mergeQueueEntry: value?.mergeQueueEntry ?? null,
  };
  if (result.autoMergeRequest !== null || result.mergeQueueEntry !== null) {
    invalid("queued or auto-merge pull request");
  }
  if (body !== null && [...body.matchAll(WRITER_MARKER)].length !== 1) invalid("writer marker count");
  return freeze(result);
}

function protectedAdvance(value) {
  const changedWriteScope = Array.isArray(value?.changedWriteScope)
    ? (value.changedWriteScope.length === 0 ? [] : normalizeWriteSet(value.changedWriteScope))
    : invalid("protected changed scope");
  if (changedWriteScope.length > 256) invalid("protected changed scope bound");
  const core = {
    schema: value?.schema === "agentic-reviewed-lane-protected-advance/v2"
      ? value.schema : invalid("protected advance schema"),
    sourceBaseSha: sha(value?.sourceBaseSha, "protected source base"),
    pullRequestBaseSha: sha(value?.pullRequestBaseSha, "pull-request protected base"),
    currentBaseSha: sha(value?.currentBaseSha, "protected current base"),
    changedWriteScope,
    changedWriteScopeDigest: digest(value?.changedWriteScopeDigest, "protected scope digest"),
    disposition: value?.disposition === "unchanged" || value?.disposition === "disjoint-preserved"
      ? value.disposition : invalid("protected advance disposition"),
  };
  exactKeys(value, [...Object.keys(core), "receiptDigest"], "protected advance");
  if (core.changedWriteScopeDigest !== digestValue(core.changedWriteScope)
    || digest(value.receiptDigest, "protected advance receipt") !== digestValue(core)
    || (core.sourceBaseSha === core.currentBaseSha) !== (core.disposition === "unchanged")
    || (core.disposition === "unchanged" && core.changedWriteScope.length !== 0)) {
    invalid("protected advance receipt");
  }
  return freeze({ ...core, receiptDigest: value.receiptDigest });
}

function sameClaimRecovery(value) {
  if (value === null) return null;
  const result = {
    schema: value?.schema === SAME_CLAIM_RECOVERY_SPLIT_SCHEMA
      ? value.schema : invalid("same-claim recovery schema"),
    status: value?.status === "completed" ? value.status : invalid("same-claim recovery status"),
    planDigest: digest(value?.planDigest, "same-claim recovery plan"),
    claimId: digest(value?.claimId, "same-claim recovery claim"),
    predecessorClaimDigest: digest(value?.predecessorClaimDigest, "predecessor claim digest"),
    predecessorTransitionCounter: integer(value?.predecessorTransitionCounter,
      "predecessor transition"),
    recoveredClaimDigest: digest(value?.recoveredClaimDigest, "recovered claim digest"),
    recoveredTransitionCounter: integer(value?.recoveredTransitionCounter,
      "recovered transition"),
    recoveredOperationReceiptDigest: digest(value?.recoveredOperationReceiptDigest,
      "recovered operation receipt"),
    sourceLeaseDigest: digest(value?.sourceLeaseDigest, "same-claim source lease"),
    targetLeaseDigest: digest(value?.targetLeaseDigest, "same-claim target lease"),
    localRepairReceiptDigest: digest(value?.localRepairReceiptDigest, "local repair receipt"),
    cloudRecoveryDigest: digest(value?.cloudRecoveryDigest, "cloud recovery digest"),
    taskAuthorityReceiptDigest: digest(value?.taskAuthorityReceiptDigest,
      "task authority receipt"),
    registryRevision: integer(value?.registryRevision, "same-claim registry revision"),
    completionReceiptDigest: digest(value?.completionReceiptDigest, "completion receipt"),
    journalDigest: digest(value?.journalDigest, "same-claim journal"),
    zeroEffectsDigest: digest(value?.zeroEffectsDigest, "same-claim zero effects"),
  };
  exactKeys(value, Object.keys(result), "same-claim recovery split");
  if (result.recoveredTransitionCounter !== result.predecessorTransitionCounter + 1
    || result.zeroEffectsDigest !== digestValue({ cloud: false, pullRequest: false,
      source: false, git: false, merge: false, integration: false, deployment: false })) {
    invalid("same-claim recovery split");
  }
  return freeze(result);
}

function writerMarker(value) {
  if (value?.admissionWriteSetDigest) {
    const keys = [
      "status", "epoch", "sessionId", "device", "scope", "branch", "baseSha", "fenceSha",
      "reviewHeadSha", "admissionWriteSetDigest", "admissionManifestDigest", "cloudClaimId",
      "cloudClaimDigest", "cloudLeaseEpoch", "cloudTransitionCounter", "cloudLaneRevision",
      "cloudReviewRequestId",
    ];
    exactKeys(value, keys, "writer marker");
    return freeze({
      status: value.status === "review_ready" ? value.status : invalid("marker status"),
      epoch: integer(value.epoch, "marker epoch"),
      sessionId: text(value.sessionId, "marker session"),
      device: text(value.device, "marker device"),
      scope: text(value.scope, "marker scope"),
      branch: text(value.branch, "marker branch"),
      baseSha: sha(value.baseSha, "marker base"),
      fenceSha: sha(value.fenceSha, "marker fence"),
      reviewHeadSha: sha(value.reviewHeadSha, "marker review head"),
      admissionWriteSetDigest: digest(value.admissionWriteSetDigest, "marker write set"),
      admissionManifestDigest: digest(value.admissionManifestDigest, "marker manifest"),
      cloudClaimId: digest(value.cloudClaimId, "marker claim ID"),
      cloudClaimDigest: digest(value.cloudClaimDigest, "marker claim digest"),
      cloudLeaseEpoch: integer(value.cloudLeaseEpoch, "marker cloud epoch"),
      cloudTransitionCounter: integer(value.cloudTransitionCounter, "marker cloud transition"),
      cloudLaneRevision: sha(value.cloudLaneRevision, "marker lane revision"),
      cloudReviewRequestId: text(value.cloudReviewRequestId, "marker review request"),
    });
  }
  const admission = value?.admission;
  const cloud = value?.cloudAuthority;
  return freeze({
    status: value?.status === "review_ready" ? value.status : invalid("marker status"),
    epoch: integer(value?.epoch, "marker epoch"),
    sessionId: text(value?.sessionId, "marker session"),
    device: text(value?.device, "marker device"),
    scope: text(value?.scope, "marker scope"),
    branch: text(value?.branch, "marker branch"),
    baseSha: sha(value?.baseSha, "marker base"),
    fenceSha: sha(value?.fenceSha, "marker fence"),
    reviewHeadSha: sha(value?.reviewHeadSha, "marker review head"),
    admissionWriteSetDigest: digest(admission?.writeSetDigest, "marker write set"),
    admissionManifestDigest: digest(admission?.manifestDigest, "marker manifest"),
    cloudClaimId: digest(cloud?.claimId, "marker claim ID"),
    cloudClaimDigest: digest(cloud?.claimDigest, "marker claim digest"),
    cloudLeaseEpoch: integer(cloud?.leaseEpoch, "marker cloud epoch"),
    cloudTransitionCounter: integer(cloud?.transitionCounter, "marker cloud transition"),
    cloudLaneRevision: sha(cloud?.laneRevision, "marker lane revision"),
    cloudReviewRequestId: text(cloud?.reviewRequestId, "marker review request"),
  });
}

function assertJoined(source) {
  const { repository: repo, actor: owner, lease: writer, authority: cloud, claim: record,
    pullRequest: pull, protectedAdvance: advance } = source;
  const reviewRequestId = `github-pull-request:${pull.nodeId}`;
  const marker = pull.writerMarker;
  const recovery = source.sameClaimRecovery;
  const integratedReplay = record.recordedState === "integrated-preserved";
  const integratedAdvance = record.recovery ? 2 : 1;
  const claimAuthorityJoined = integratedReplay
    ? ["integrated-preserved", "dormant-preserved"].includes(record.state)
      && record.transitionCounter === cloud.transitionCounter + integratedAdvance
      && record.fenceRevision !== cloud.claimDigest
      && record.transitionDigest !== cloud.claimLedgerRevision
      && record.operationReceiptDigest !== cloud.operationReceiptDigest
      && (record.recovery
        ? record.integrationReceiptDigest !== record.operationReceiptDigest
        : record.integrationReceiptDigest === record.operationReceiptDigest)
      && record.integration?.candidateRevision === source.localHeadSha
      && record.integration?.reviewRequestId === reviewRequestId
      && record.integration?.focusedEvidenceDigest === cloud.focusedEvidenceDigest
    : record.recordedState === "reviewed"
      && cloud.claimDigest === record.fenceRevision
      && cloud.claimLedgerRevision === record.transitionDigest
      && cloud.operationReceiptDigest === record.operationReceiptDigest
      && cloud.transitionCounter === record.transitionCounter;
  const markerCloudJoined = recovery
    ? recovery.status === "completed"
      && recovery.claimId === cloud.claimId
      && recovery.claimId === record.claimId
      && recovery.predecessorClaimDigest === marker.cloudClaimDigest
      && recovery.predecessorTransitionCounter === marker.cloudTransitionCounter
      && recovery.recoveredClaimDigest === cloud.claimDigest
      && recovery.recoveredClaimDigest === record.fenceRevision
      && recovery.recoveredTransitionCounter === cloud.transitionCounter
      && recovery.recoveredTransitionCounter === record.transitionCounter
      && recovery.recoveredOperationReceiptDigest === cloud.operationReceiptDigest
      && recovery.recoveredOperationReceiptDigest === record.operationReceiptDigest
      && recovery.predecessorTransitionCounter + 1 === recovery.recoveredTransitionCounter
      && marker.cloudClaimDigest !== cloud.claimDigest
    : marker.cloudClaimDigest === cloud.claimDigest
      && marker.cloudTransitionCounter === cloud.transitionCounter;
  if (
    source.localHeadSha !== source.remoteHeadSha
    || source.localHeadSha !== writer.reviewHeadSha
    || source.localHeadSha !== cloud.laneRevision
    || source.localHeadSha !== record.laneRevision
    || source.localHeadSha !== pull.headSha
    || writer.baseSha !== cloud.canonicalBaseSha
    || writer.baseSha !== record.canonicalBaseRevision
    || writer.baseSha !== advance.sourceBaseSha
    || pull.baseSha !== advance.pullRequestBaseSha
    || (advance.changedWriteScope.length > 0
      && writeSetsOverlap(advance.changedWriteScope, writer.admission.declaredWriteSet))
    || writer.branch !== pull.headBranch
    || writer.scope !== writer.admission.semanticScope
    || writer.pullRequestUrl !== pull.url
    || pull.url !== `https://github.com/${repo.fullName}/pull/${pull.number}`
    || pull.headRepository !== repo.fullName
    || pull.baseRepository !== repo.fullName
    || pull.baseBranch !== "main"
    || pull.authorLogin !== owner.login
    || cloud.targetRepository !== repo.fullName
    || cloud.claimId !== record.claimId
    || cloud.leaseEpoch !== record.leaseEpoch
    || record.writeAuthority !== false
    || record.scopeReserved !== true
    || !claimAuthorityJoined
    || !markerCloudJoined
    || cloud.reviewRequestId !== reviewRequestId
    || record.reviewRequestId !== reviewRequestId
    || cloud.writeSetDigest !== writer.admission.writeSetDigest
    || record.writeSetDigest !== writer.admission.writeSetDigest
    || JSON.stringify(record.declaredWriteScope) !== JSON.stringify(writer.admission.declaredWriteSet)
    || record.actorId !== `github-user:${owner.id}`
    || record.repositoryId !== `github-repository:${repo.nodeId}`
    || record.deviceId !== pseudonymousIdentifier("device", writer.device)
    || record.sessionId !== pseudonymousIdentifier("session", writer.sessionId)
    || marker.status !== writer.status
    || marker.epoch !== writer.epoch
    || marker.sessionId !== writer.sessionId
    || marker.device !== writer.device
    || marker.scope !== writer.scope
    || marker.branch !== writer.branch
    || marker.baseSha !== writer.baseSha
    || marker.fenceSha !== writer.fenceSha
    || marker.reviewHeadSha !== writer.reviewHeadSha
    || marker.admissionWriteSetDigest !== writer.admission.writeSetDigest
    || marker.admissionManifestDigest !== writer.admission.manifestDigest
    || marker.cloudClaimId !== cloud.claimId
    || marker.cloudLeaseEpoch !== cloud.leaseEpoch
    || marker.cloudLaneRevision !== cloud.laneRevision
    || marker.cloudReviewRequestId !== cloud.reviewRequestId
  ) invalid("reviewed lane identity join");
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    invalid(`${label} shape`);
  }
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) invalid(label);
  return value;
}
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function sha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) invalid(label);
  return value;
}
function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) invalid(label);
  return value;
}
function optionalDigest(value, label) {
  return value === null ? null : digest(value, label);
}
function instant(value, label) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) invalid(label);
  return value;
}
function without(value, omittedKey) {
  return value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== omittedKey))
    : null;
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function invalid(label) { throw new Error(`Reviewed-lane source correction ${label} is invalid.`); }
