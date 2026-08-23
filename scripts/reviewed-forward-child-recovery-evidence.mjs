// Responsibility: Normalize path-free evidence for one reviewed lane and its empty forward child.
import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeAdaptiveClaimRecoveryDecision,
} from "./adaptive-claim-recovery-contract.mjs";

export const EVIDENCE_SCHEMA = "agentic-reviewed-forward-child-recovery-evidence/v2";
export const CHILD_SCHEMA = "agentic-reviewed-forward-child-candidate/v1";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export function buildReviewedForwardChildEvidence(input = {}) {
  const core = normalizeCore({
    schema: EVIDENCE_SCHEMA,
    repository: input.repository,
    actor: input.actor,
    source: input.source,
    lease: input.lease,
    claim: input.claim,
    pullRequest: input.pullRequest,
    protectedMainSha: input.protectedMainSha,
    refreshChain: input.refreshChain,
    adaptiveRecovery: input.adaptiveRecovery ?? null,
  });
  return freeze({ ...core, evidenceDigest: digestValue(core) });
}

export function normalizeReviewedForwardChildEvidence(value) {
  if (value?.schema !== EVIDENCE_SCHEMA) invalid("evidence schema");
  exact(value, [
    "schema", "repository", "actor", "source", "lease", "claim",
    "pullRequest", "protectedMainSha", "refreshChain", "adaptiveRecovery", "evidenceDigest",
  ], "evidence");
  const core = normalizeCore(value);
  if (digest(value.evidenceDigest, "evidence digest") !== digestValue(core)) {
    invalid("evidence digest");
  }
  return freeze({ ...core, evidenceDigest: value.evidenceDigest });
}

export function buildReviewedForwardChildCandidate({
  sourceHeadSha,
  sourceTreeSha,
  childHeadSha,
  childTreeSha,
  parentShas,
  subject,
} = {}) {
  const core = child({
    schema: CHILD_SCHEMA,
    sourceHeadSha,
    sourceTreeSha,
    childHeadSha,
    childTreeSha,
    parentShas,
    subject,
  });
  return freeze({ ...core, candidateDigest: digestValue(core) });
}

export function normalizeReviewedForwardChildCandidate(value) {
  if (value?.schema !== CHILD_SCHEMA) invalid("candidate schema");
  exact(value, [
    "schema", "sourceHeadSha", "sourceTreeSha", "childHeadSha", "childTreeSha",
    "parentShas", "subject", "candidateDigest",
  ], "candidate");
  const core = child(value);
  if (digest(value.candidateDigest, "candidate digest") !== digestValue(core)) {
    invalid("candidate digest");
  }
  return freeze({ ...core, candidateDigest: value.candidateDigest });
}

function normalizeCore(value) {
  const core = {
    schema: EVIDENCE_SCHEMA,
    repository: repository(value.repository),
    actor: actor(value.actor),
    source: source(value.source),
    lease: lease(value.lease),
    claim: claim(value.claim),
    pullRequest: pullRequest(value.pullRequest),
    protectedMainSha: sha(value.protectedMainSha, "protected main"),
    refreshChain: refreshChain(value.refreshChain),
    adaptiveRecovery: value.adaptiveRecovery === null
      ? null : normalizeAdaptiveClaimRecoveryDecision(value.adaptiveRecovery),
  };
  assertJoined(core);
  return freeze(core);
}

function repository(value) {
  const result = {
    fullName: text(value?.fullName, "repository name"),
    nodeId: text(value?.nodeId, "repository node ID"),
  };
  exact(value, Object.keys(result), "repository");
  if (!REPOSITORY.test(result.fullName)) invalid("repository name");
  return freeze(result);
}

function actor(value) {
  const result = { id: String(value?.id || ""), login: text(value?.login, "actor login") };
  exact(value, Object.keys(result), "actor");
  if (!/^[1-9]\d*$/u.test(result.id)) invalid("actor ID");
  return freeze(result);
}

function source(value) {
  const parents = Array.isArray(value?.parentShas)
    ? value.parentShas.map((entry, index) => sha(entry, `source parent ${index + 1}`))
    : invalid("source parents");
  if (parents.length < 1 || parents.length > 8 || new Set(parents).size !== parents.length) {
    invalid("source parents");
  }
  const result = {
    branch: text(value?.branch, "source branch"),
    sessionId: text(value?.sessionId, "source session"),
    headSha: sha(value?.headSha, "source head"),
    remoteHeadSha: sha(value?.remoteHeadSha, "source remote head"),
    providerHeadSha: sha(value?.providerHeadSha, "source provider head"),
    treeSha: sha(value?.treeSha, "source tree"),
    parentShas: parents,
    clean: value?.clean === true ? true : invalid("clean source"),
  };
  exact(value, Object.keys(result), "source");
  return freeze(result);
}

function lease(value) {
  const declaredWriteSet = normalizeWriteSet(value?.declaredWriteSet);
  const result = {
    status: value?.status === "review_ready" ? value.status : invalid("lease status"),
    epoch: integer(value?.epoch, "lease epoch"),
    leaseDigest: digest(value?.leaseDigest, "lease digest"),
    baseSha: sha(value?.baseSha, "lease base"),
    fenceSha: sha(value?.fenceSha, "lease fence"),
    reviewHeadSha: sha(value?.reviewHeadSha, "lease review head"),
    sessionId: text(value?.sessionId, "lease session"),
    device: text(value?.device, "lease device"),
    scope: text(value?.scope, "lease scope"),
    branch: text(value?.branch, "lease branch"),
    manifestDigest: digest(value?.manifestDigest, "manifest digest"),
    declaredWriteSet,
    writeSetDigest: digest(value?.writeSetDigest, "write-set digest"),
    focusedEvidenceDigest: digest(value?.focusedEvidenceDigest, "focused evidence digest"),
    pullRequestUrl: text(value?.pullRequestUrl, "lease pull-request URL"),
  };
  exact(value, Object.keys(result), "lease");
  if (digestValue(declaredWriteSet) !== result.writeSetDigest) invalid("lease write set");
  return freeze(result);
}

function claim(value) {
  const declaredWriteSet = normalizeWriteSet(value?.declaredWriteSet);
  const result = {
    claimId: digest(value?.claimId, "claim ID"),
    claimDigest: digest(value?.claimDigest, "claim digest"),
    transitionDigest: digest(value?.transitionDigest, "claim transition digest"),
    operationReceiptDigest: digest(value?.operationReceiptDigest, "claim operation receipt"),
    state: ["dormant-preserved", "integrated-preserved"].includes(value?.state)
      ? value.state : invalid("claim state"),
    writeAuthority: value?.writeAuthority === false ? false : invalid("claim write authority"),
    scopeReserved: value?.scopeReserved === true ? true : invalid("claim scope reservation"),
    actorId: text(value?.actorId, "claim actor"),
    repositoryId: text(value?.repositoryId, "claim repository"),
    workItemId: text(value?.workItemId, "claim work item"),
    canonicalBaseSha: sha(value?.canonicalBaseSha, "claim base"),
    laneRevision: sha(value?.laneRevision, "claim lane revision"),
    declaredWriteSet,
    writeSetDigest: digest(value?.writeSetDigest, "claim write set"),
    leaseEpoch: integer(value?.leaseEpoch, "claim epoch"),
    transitionCounter: integer(value?.transitionCounter, "claim transition"),
    reviewRequestId: text(value?.reviewRequestId, "claim review request"),
  };
  exact(value, Object.keys(result), "claim");
  if (digestValue(declaredWriteSet) !== result.writeSetDigest) invalid("claim write set");
  return freeze(result);
}

function pullRequest(value) {
  const autoMerge = value?.autoMergeRequest;
  const request = {
    mergeMethod: autoMerge?.mergeMethod === "SQUASH"
      ? autoMerge.mergeMethod : invalid("auto-merge method"),
    commitHeadline: text(autoMerge?.commitHeadline, "auto-merge headline"),
    commitBody: nullableText(autoMerge?.commitBody, "auto-merge body"),
    enabledAt: instant(autoMerge?.enabledAt, "auto-merge instant"),
    enabledByLogin: text(autoMerge?.enabledByLogin, "auto-merge actor"),
  };
  exact(autoMerge, Object.keys(request), "auto-merge request");
  const result = {
    number: integer(value?.number, "pull-request number"),
    nodeId: text(value?.nodeId, "pull-request node ID"),
    url: text(value?.url, "pull-request URL"),
    state: value?.state === "OPEN" ? value.state : invalid("pull-request state"),
    isDraft: value?.isDraft === false ? false : invalid("pull-request draft state"),
    headBranch: text(value?.headBranch, "pull-request branch"),
    headSha: sha(value?.headSha, "pull-request head"),
    baseBranch: value?.baseBranch === "main" ? value.baseBranch : invalid("pull-request base"),
    baseSha: sha(value?.baseSha, "pull-request base SHA"),
    headRepository: text(value?.headRepository, "head repository"),
    baseRepository: text(value?.baseRepository, "base repository"),
    authorLogin: text(value?.authorLogin, "pull-request author"),
    bodyDigest: digest(value?.bodyDigest, "pull-request body digest"),
    writerMarkerDigest: digest(value?.writerMarkerDigest, "writer marker digest"),
    autoMergeRequest: freeze(request),
    autoMergeDigest: digest(value?.autoMergeDigest, "auto-merge digest"),
    mergeQueueEntry: value?.mergeQueueEntry === null ? null : invalid("merge queue"),
  };
  exact(value, Object.keys(result), "pull request");
  if (result.autoMergeDigest !== digestValue(request)) invalid("auto-merge digest");
  return freeze(result);
}

function refreshChain(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalid("refresh chain");
  return freeze(value.map((entry, index) => {
    const result = {
      headSha: sha(entry?.headSha, `refresh ${index + 1} head`),
      treeSha: sha(entry?.treeSha, `refresh ${index + 1} tree`),
      parentShas: Array.isArray(entry?.parentShas)
        ? entry.parentShas.map((parent, parentIndex) => sha(
          parent, `refresh ${index + 1} parent ${parentIndex + 1}`,
        ))
        : invalid("refresh parents"),
    };
    exact(entry, Object.keys(result), `refresh ${index + 1}`);
    if (result.parentShas.length !== 2) invalid("refresh merge parents");
    return freeze(result);
  }));
}

function child(value) {
  const result = {
    schema: CHILD_SCHEMA,
    sourceHeadSha: sha(value?.sourceHeadSha, "candidate source head"),
    sourceTreeSha: sha(value?.sourceTreeSha, "candidate source tree"),
    childHeadSha: sha(value?.childHeadSha, "candidate head"),
    childTreeSha: sha(value?.childTreeSha, "candidate tree"),
    parentShas: Array.isArray(value?.parentShas)
      ? value.parentShas.map((parent, index) => sha(parent, `candidate parent ${index + 1}`))
      : invalid("candidate parents"),
    subject: text(value?.subject, "candidate subject"),
  };
  if (result.childHeadSha === result.sourceHeadSha
    || result.childTreeSha !== result.sourceTreeSha
    || result.parentShas.length !== 1
    || result.parentShas[0] !== result.sourceHeadSha) {
    invalid("single-parent empty forward child");
  }
  return freeze(result);
}

function assertJoined(value) {
  const { repository: repo, actor: owner, source: lane, lease: writer,
    claim: cloud, pullRequest: pull, refreshChain: chain, adaptiveRecovery } = value;
  const reviewRequestId = `github-pull-request:${pull.nodeId}`;
  if (lane.headSha !== lane.remoteHeadSha || lane.headSha !== lane.providerHeadSha
    || lane.headSha !== pull.headSha || lane.headSha !== chain.at(-1).headSha
    || lane.treeSha !== chain.at(-1).treeSha || lane.branch !== writer.branch
    || lane.branch !== pull.headBranch || lane.sessionId !== writer.sessionId
    || writer.reviewHeadSha !== chain[0].parentShas[0]
    || chain.some((entry, index) => index > 0 && entry.parentShas[0] !== chain[index - 1].headSha)
    || writer.baseSha !== cloud.canonicalBaseSha || pull.baseSha !== chain.at(-1).parentShas[1]
    || writer.writeSetDigest !== cloud.writeSetDigest
    || JSON.stringify(writer.declaredWriteSet) !== JSON.stringify(cloud.declaredWriteSet)
    || writer.pullRequestUrl !== pull.url
    || pull.url !== `https://github.com/${repo.fullName}/pull/${pull.number}`
    || pull.headRepository !== repo.fullName || pull.baseRepository !== repo.fullName
    || pull.authorLogin !== owner.login || cloud.actorId !== `github-user:${owner.id}`
    || cloud.repositoryId !== `github-repository:${repo.nodeId}`
    || cloud.reviewRequestId !== reviewRequestId || cloud.laneRevision !== writer.reviewHeadSha) {
    invalid("joined owner lane");
  }
  if (cloud.state === "dormant-preserved") {
    if (adaptiveRecovery !== null) invalid("unexpected adaptive recovery");
    return;
  }
  const adaptive = adaptiveRecovery?.evidence;
  if (adaptiveRecovery?.status !== "recoverable-now"
    || adaptiveRecovery.mutationAuthority !== false
    || adaptive?.subject.repositoryId !== cloud.repositoryId
    || adaptive?.subject.workItemId !== cloud.workItemId
    || adaptive?.subject.candidateHeadSha !== lane.headSha
    || adaptive?.subject.protectedMainSha !== value.protectedMainSha
    || adaptive?.claim.claimId !== cloud.claimId
    || adaptive?.claim.state !== cloud.state
    || adaptive?.claim.writeAuthority !== cloud.writeAuthority
    || adaptive?.claim.scopeReserved !== cloud.scopeReserved
    || adaptive?.claim.fenceRevision !== cloud.claimDigest
    || adaptive?.claim.transitionCounter !== cloud.transitionCounter) {
    invalid("adaptive recovery join");
  }
}

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) invalid(label);
}
function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0")) invalid(label);
  return value;
}
function nullableText(value, label) { return value === null ? null : text(value, label); }
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
function instant(value, label) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) invalid(label);
  return value;
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const childValue of Object.values(value)) freeze(childValue);
    Object.freeze(value);
  }
  return value;
}
function invalid(label) { throw new Error(`Reviewed forward-child recovery ${label} is invalid.`); }
