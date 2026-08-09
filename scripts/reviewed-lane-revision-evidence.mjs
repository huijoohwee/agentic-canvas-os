import { createHash } from "node:crypto";

import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { requireProtectedSquashSubject } from "./protected-squash-subject.mjs";
import {
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
} from "./writer-lease-lib.mjs";
export const REVIEWED_LANE_REVISION_COMMIT_CANDIDATE_SCHEMA =
  "agentic-reviewed-lane-revision-commit-candidate/v1";
export const REVIEWED_LANE_REVISION_SOURCE_EVIDENCE_SCHEMA =
  "agentic-reviewed-lane-revision-source-evidence/v1";

const COMMIT_SNAPSHOT_SCHEMA = "agentic-reviewed-lane-raw-commit/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u, DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const WRITER_MARKER_PATTERN = /<!--\s*agentic-writer-lease\/v2\s+\{/gu;
const MAX_RAW_COMMIT_BYTES = 1024 * 1024;
export function buildReviewedLaneRevisionCommitCandidate({
  rawCommit,
  replacementSubject,
  hashCommit,
} = {}) {
  const source = inspectCommit(rawCommit, hashCommit, "source commit");
  const subject = requireProtectedSquashSubject(replacementSubject, {
    label: "Reviewed-lane replacement subject",
  });
  if (subject === source.subject) {
    throw new Error("Reviewed-lane replacement subject must change the reviewed commit bytes.");
  }
  const candidateRawCommit = [
    source.headerBlock,
    "\n\n",
    subject,
    source.message.slice(source.subject.length),
  ].join("");
  const candidate = inspectCommit(candidateRawCommit, hashCommit, "replacement commit");
  assertCommitRevision(source, candidate, subject);
  const core = {
    schema: REVIEWED_LANE_REVISION_COMMIT_CANDIDATE_SCHEMA,
    source,
    candidate,
    replacementSubject: subject,
  };
  return deepFreeze({ ...core, candidateDigest: digestValue(core) });
}
export function buildReviewedLaneRevisionSourceEvidence({
  repository,
  actor,
  lease,
  authority = lease?.cloudAuthority,
  claim,
  pullRequest,
  rawCommit,
  hashCommit,
  localHeadSha,
  remoteHeadSha,
  clean,
} = {}) {
  const repositoryIdentity = normalizeRepository(repository);
  const actorIdentity = normalizeActor(actor);
  const commit = inspectCommit(rawCommit, hashCommit, "reviewed source commit");
  const leaseSnapshot = normalizeLease(lease);
  const authoritySnapshot = normalizeAuthority(authority);
  const claimSnapshot = normalizeClaim(claim);
  const pull = assertReviewedLaneRevisionPullRequest({
    pullRequest,
    repository: repositoryIdentity,
    actor: actorIdentity,
    lease,
    authority,
    expectedHeadSha: commit.headSha,
  });
  const localHead = requiredSha(localHeadSha, "local head SHA");
  const remoteHead = requiredSha(remoteHeadSha, "remote head SHA");
  if (clean !== true) throw new Error("Reviewed-lane source worktree must be clean.");
  assertSourceJoin({
    repository: repositoryIdentity,
    actor: actorIdentity,
    lease: leaseSnapshot,
    authority: authoritySnapshot,
    claim: claimSnapshot,
    pullRequest: pull,
    commit,
    localHeadSha: localHead,
    remoteHeadSha: remoteHead,
  });
  requireInvalidSourceSubject(commit.subject);
  const core = {
    schema: REVIEWED_LANE_REVISION_SOURCE_EVIDENCE_SCHEMA,
    provider: "github",
    repository: repositoryIdentity,
    actor: actorIdentity,
    localHeadSha: localHead,
    remoteHeadSha: remoteHead,
    clean: true,
    lease: leaseSnapshot,
    authority: authoritySnapshot,
    claim: claimSnapshot,
    pullRequest: pull,
    commit,
  };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}
export function normalizeReviewedLaneRevisionSourceEvidence(value) {
  if (value?.schema !== REVIEWED_LANE_REVISION_SOURCE_EVIDENCE_SCHEMA) {
    throw new Error("Reviewed-lane source evidence is malformed.");
  }
  const core = {
    schema: REVIEWED_LANE_REVISION_SOURCE_EVIDENCE_SCHEMA,
    provider: value.provider === "github" ? "github" : invalid("provider"),
    repository: normalizeRepository(value.repository),
    actor: normalizeActor(value.actor),
    localHeadSha: requiredSha(value.localHeadSha, "local head SHA"),
    remoteHeadSha: requiredSha(value.remoteHeadSha, "remote head SHA"),
    clean: value.clean === true ? true : invalid("clean worktree evidence"),
    lease: normalizeLeaseSnapshot(value.lease),
    authority: normalizeAuthoritySnapshot(value.authority),
    claim: normalizeClaimSnapshot(value.claim),
    pullRequest: normalizePullRequestSnapshot(value.pullRequest),
    commit: normalizeCommitSnapshot(value.commit),
  };
  assertExactKeys(value, [...Object.keys(core), "evidenceDigest"], "source evidence");
  assertSourceJoin(core);
  requireInvalidSourceSubject(core.commit.subject);
  if (requiredDigest(value.evidenceDigest, "source evidence digest") !== digestValue(core)) {
    throw new Error("Reviewed-lane source evidence digest is invalid.");
  }
  return deepFreeze({ ...core, evidenceDigest: value.evidenceDigest });
}
export function assertReviewedLaneRevisionPullRequest({
  pullRequest,
  repository,
  actor,
  lease,
  authority,
  expectedHeadSha,
} = {}) {
  const target = normalizeRepository(repository);
  const authenticatedActor = normalizeActor(actor);
  const pull = normalizePullRequest(pullRequest);
  const expectedUrl = `https://github.com/${target.fullName}/pull/${pull.number}`;
  const expectedReviewRequestId = `github-pull-request:${pull.nodeId}`;
  const markerCount = [...pull.body.matchAll(WRITER_MARKER_PATTERN)].length;
  if (markerCount !== 1) {
    throw new Error("Reviewed-lane pull request must contain exactly one writer marker.");
  }
  const marker = parseWriterLeasePullRequestBody(pull.body);
  const expectedMarker = projectWriterLeasePullRequestMarker(lease);
  if (
    pull.state !== "OPEN"
    || pull.isDraft !== false
    || pull.url !== expectedUrl
    || pull.headRepository !== target.fullName
    || pull.baseRepository !== target.fullName
    || pull.headBranch !== lease?.branch
    || pull.baseBranch !== "main"
    || pull.headSha !== requiredSha(expectedHeadSha, "expected pull-request head")
    || pull.baseSha !== lease?.baseSha
    || pull.authorLogin !== authenticatedActor.login
    || pull.autoMergeRequest !== null
    || pull.isInMergeQueue !== false
    || pull.mergeQueueEntry !== null
    || (pull.reviewRequestId && pull.reviewRequestId !== expectedReviewRequestId)
    || authority?.reviewRequestId !== expectedReviewRequestId
    || digestValue(marker) !== digestValue(expectedMarker)
  ) {
    throw new Error("Reviewed-lane pull-request identity or writer projection drifted.");
  }
  return deepFreeze({ ...pull, reviewRequestId: expectedReviewRequestId });
}
export function normalizeReviewedLaneRevisionCommitCandidate(value) {
  if (value?.schema !== REVIEWED_LANE_REVISION_COMMIT_CANDIDATE_SCHEMA) {
    throw new Error("Reviewed-lane commit candidate is malformed.");
  }
  const core = {
    schema: REVIEWED_LANE_REVISION_COMMIT_CANDIDATE_SCHEMA,
    source: normalizeCommitSnapshot(value.source),
    candidate: normalizeCommitSnapshot(value.candidate),
    replacementSubject: requireProtectedSquashSubject(value.replacementSubject, {
      label: "Reviewed-lane replacement subject",
    }),
  };
  assertExactKeys(value, [...Object.keys(core), "candidateDigest"], "commit candidate");
  assertCommitRevision(core.source, core.candidate, core.replacementSubject);
  if (requiredDigest(value.candidateDigest, "candidate digest") !== digestValue(core)) {
    throw new Error("Reviewed-lane commit candidate digest is invalid.");
  }
  return deepFreeze({ ...core, candidateDigest: value.candidateDigest });
}
function assertCommitRevision(source, candidate, replacementSubject) {
  const sourceSuffix = source.message.slice(source.subject.length);
  const candidateSuffix = candidate.message.slice(candidate.subject.length);
  if (
    candidate.subject !== replacementSubject
    || source.subject === candidate.subject
    || source.rawCommit === candidate.rawCommit
    || source.headSha === candidate.headSha
    || source.treeSha !== candidate.treeSha
    || JSON.stringify(source.parentShas) !== JSON.stringify(candidate.parentShas)
    || source.headerBlock !== candidate.headerBlock
    || source.authorHeader !== candidate.authorHeader
    || source.committerHeader !== candidate.committerHeader
    || sourceSuffix !== candidateSuffix
  ) {
    throw new Error("Reviewed-lane candidate must change only the subject while preserving tree, parents, authorship, and remaining bytes.");
  }
}
function assertSourceJoin(source) {
  const { repository, actor, lease, authority, claim, pullRequest, commit } = source;
  const writeSet = normalizeWriteSet(lease.declaredWriteSet);
  const expectedDevice = pseudonymousIdentifier("device", lease.device);
  const expectedSession = pseudonymousIdentifier("session", lease.sessionId);
  if (
    source.localHeadSha !== commit.headSha
    || source.remoteHeadSha !== commit.headSha
    || pullRequest.headSha !== commit.headSha
    || lease.reviewHeadSha !== commit.headSha
    || authority.laneRevision !== commit.headSha
    || claim.laneRevision !== commit.headSha
    || lease.baseSha !== pullRequest.baseSha
    || lease.baseSha !== authority.canonicalBaseSha
    || lease.baseSha !== claim.canonicalBaseRevision
    || lease.pullRequestUrl !== pullRequest.url
    || lease.branch !== pullRequest.headBranch
    || lease.status !== "review_ready"
    || lease.admissionStatus !== "admitted"
    || authority.state !== "review_ready"
    || claim.state !== "reviewed"
    || lease.sessionId !== authority.sessionId
    || lease.device !== authority.deviceId
    || authority.claimId !== claim.claimId
    || authority.claimDigest !== claim.fenceRevision
    || authority.claimLedgerRevision !== claim.transitionDigest
    || authority.transitionCounter !== claim.transitionCounter
    || authority.leaseEpoch !== claim.leaseEpoch
    || authority.reviewRequestId !== pullRequest.reviewRequestId
    || claim.reviewRequestId !== pullRequest.reviewRequestId
    || authority.writeSetDigest !== lease.writeSetDigest
    || claim.writeSetDigest !== lease.writeSetDigest
    || digestValue(writeSet) !== lease.writeSetDigest
    || JSON.stringify(authority.declaredWriteSet) !== JSON.stringify(writeSet)
    || JSON.stringify(claim.declaredWriteSet) !== JSON.stringify(writeSet)
    || claim.actorId !== `github-user:${actor.id}`
    || claim.repositoryId !== `github-repository:${repository.nodeId}`
    || claim.deviceId !== expectedDevice
    || claim.sessionId !== expectedSession
    || pullRequest.authorLogin !== actor.login
  ) {
    throw new Error("Reviewed-lane lease, claim, pull request, or commit identity drifted.");
  }
}
function inspectCommit(rawValue, hashCommit, label) {
  const rawCommit = boundedRawCommit(rawValue, label);
  const separator = rawCommit.indexOf("\n\n");
  if (separator <= 0) throw new Error(`${label} has no exact header/message boundary.`);
  const headerBlock = rawCommit.slice(0, separator);
  const message = rawCommit.slice(separator + 2);
  if (!message || message.includes("\0")) throw new Error(`${label} message is malformed.`);
  const headers = parseCommitHeaders(headerBlock, label);
  const subject = message.split("\n", 1)[0];
  if (!subject) throw new Error(`${label} subject is empty.`);
  const headSha = gitCommitSha(rawCommit);
  if (typeof hashCommit === "function") {
    const adapterSha = requiredSha(hashCommit(rawCommit), `${label} adapter SHA`);
    if (adapterSha !== headSha) throw new Error(`${label} hash adapter disagrees with exact Git bytes.`);
  } else if (hashCommit !== undefined) {
    throw new Error("Reviewed-lane commit hash adapter must be a function.");
  }
  const core = {
    schema: COMMIT_SNAPSHOT_SCHEMA,
    rawCommit,
    rawCommitDigest: digestValue(rawCommit),
    headSha,
    treeSha: headers.treeSha,
    parentShas: headers.parentShas,
    authorHeader: headers.authorHeader,
    committerHeader: headers.committerHeader,
    headerBlock,
    message,
    messageDigest: digestValue(message),
    subject,
  };
  return deepFreeze(core);
}
function normalizeCommitSnapshot(value) {
  if (value?.schema !== COMMIT_SNAPSHOT_SCHEMA) throw new Error("Raw commit snapshot is malformed.");
  const inspected = inspectCommit(value.rawCommit, undefined, "raw commit snapshot");
  assertExactKeys(value, Object.keys(inspected), "raw commit snapshot");
  if (digestValue(value) !== digestValue(inspected)) {
    throw new Error("Raw commit snapshot fields drifted from its exact bytes.");
  }
  return inspected;
}

function parseCommitHeaders(headerBlock, label) {
  if (headerBlock.includes("\r")) throw new Error(`${label} headers must use LF bytes.`);
  const lines = headerBlock.split("\n");
  const topLevel = lines.filter(line => !line.startsWith(" "));
  const values = name => topLevel
    .filter(line => line.startsWith(`${name} `))
    .map(line => line.slice(name.length + 1));
  const trees = values("tree");
  const parents = values("parent");
  const authors = values("author");
  const committers = values("committer");
  if (trees.length !== 1 || parents.length < 1 || parents.length > 8
    || authors.length !== 1 || committers.length !== 1
    || topLevel.some(line => line.startsWith("gpgsig ") || line.startsWith("mergetag "))) {
    throw new Error(`${label} requires one unsigned tree/authorship identity and bounded parents.`);
  }
  return {
    treeSha: requiredSha(trees[0], `${label} tree SHA`),
    parentShas: parents.map((value, index) => requiredSha(value, `${label} parent ${index + 1}`)),
    authorHeader: requiredText(authors[0], `${label} author header`),
    committerHeader: requiredText(committers[0], `${label} committer header`),
  };
}

function normalizeLease(value) {
  const snapshot = {
    schema: value?.schema,
    status: value?.status,
    epoch: value?.epoch,
    sessionId: value?.sessionId,
    device: value?.device,
    scope: value?.scope,
    branch: value?.branch,
    worktreePath: value?.worktreePath,
    baseSha: value?.baseSha,
    fenceSha: value?.fenceSha,
    reviewHeadSha: value?.reviewHeadSha,
    pullRequestUrl: value?.pullRequestUrl,
    admissionStatus: value?.admission?.status,
    manifestDigest: value?.admission?.manifestDigest,
    writeSetDigest: value?.admission?.writeSetDigest,
    declaredWriteSet: value?.admission?.declaredWriteSet,
    focusedEvidenceDigest: value?.cloudAuthority?.focusedEvidenceDigest,
    leaseDigest: digestValue(value),
  };
  return normalizeLeaseSnapshot(snapshot);
}

function normalizeLeaseSnapshot(value) {
  const declaredWriteSet = normalizeWriteSet(value?.declaredWriteSet);
  const core = {
    schema: value?.schema === "agentic-writer-lease/v2" ? value.schema : invalid("lease schema"),
    status: value?.status === "review_ready" ? value.status : invalid("lease status"),
    epoch: positiveInteger(value?.epoch, "lease epoch"),
    sessionId: requiredText(value?.sessionId, "lease session"),
    device: requiredText(value?.device, "lease device"),
    scope: requiredText(value?.scope, "lease scope"),
    branch: requiredText(value?.branch, "lease branch"),
    worktreePath: requiredText(value?.worktreePath, "lease worktree"),
    baseSha: requiredSha(value?.baseSha, "lease base SHA"),
    fenceSha: requiredSha(value?.fenceSha, "lease fence SHA"),
    reviewHeadSha: requiredSha(value?.reviewHeadSha, "lease review head"),
    pullRequestUrl: requiredGitHubUrl(value?.pullRequestUrl, "lease pull-request URL"),
    admissionStatus: value?.admissionStatus === "admitted" ? value.admissionStatus : invalid("admission status"),
    manifestDigest: requiredDigest(value?.manifestDigest, "manifest digest"),
    writeSetDigest: requiredDigest(value?.writeSetDigest, "write-set digest"),
    declaredWriteSet,
    focusedEvidenceDigest: requiredDigest(value?.focusedEvidenceDigest, "focused evidence digest"),
    leaseDigest: requiredDigest(value?.leaseDigest, "lease digest"),
  };
  assertExactKeys(value, Object.keys(core), "lease snapshot");
  if (core.writeSetDigest !== digestValue(declaredWriteSet)) throw new Error("Lease write set digest is invalid.");
  return deepFreeze(core);
}

function normalizeAuthority(value) {
  return normalizeAuthoritySnapshot({
    schema: value?.schema,
    claimId: value?.claimId,
    claimDigest: value?.claimDigest,
    claimLedgerRevision: value?.claimLedgerRevision,
    ledgerRevision: value?.ledgerRevision,
    canonicalBaseSha: value?.canonicalBaseSha,
    laneRevision: value?.laneRevision,
    writeSetDigest: value?.writeSetDigest,
    declaredWriteSet: value?.cloudDeclaredWriteScope,
    deviceId: value?.deviceId,
    sessionId: value?.sessionId,
    reviewRequestId: value?.reviewRequestId,
    leaseEpoch: value?.leaseEpoch,
    transitionCounter: value?.transitionCounter,
    state: value?.state,
    focusedEvidenceDigest: value?.focusedEvidenceDigest,
    authorityDigest: digestValue(value),
  });
}

function normalizeAuthoritySnapshot(value) {
  const core = {
    schema: value?.schema === "agentic-lane-cloud-authority/v1" ? value.schema : invalid("authority schema"),
    claimId: requiredDigest(value?.claimId, "authority claim ID"),
    claimDigest: requiredDigest(value?.claimDigest, "authority claim digest"),
    claimLedgerRevision: requiredDigest(value?.claimLedgerRevision, "authority claim ledger revision"),
    ledgerRevision: requiredSha(value?.ledgerRevision, "authority ledger revision"),
    canonicalBaseSha: requiredSha(value?.canonicalBaseSha, "authority base SHA"),
    laneRevision: requiredSha(value?.laneRevision, "authority lane revision"),
    writeSetDigest: requiredDigest(value?.writeSetDigest, "authority write-set digest"),
    declaredWriteSet: normalizeWriteSet(value?.declaredWriteSet),
    deviceId: requiredText(value?.deviceId, "authority device"),
    sessionId: requiredText(value?.sessionId, "authority session"),
    reviewRequestId: requiredText(value?.reviewRequestId, "authority review request"),
    leaseEpoch: positiveInteger(value?.leaseEpoch, "authority lease epoch"),
    transitionCounter: positiveInteger(value?.transitionCounter, "authority transition counter"),
    state: value?.state === "review_ready" ? value.state : invalid("authority state"),
    focusedEvidenceDigest: requiredDigest(value?.focusedEvidenceDigest, "authority focused evidence"),
    authorityDigest: requiredDigest(value?.authorityDigest, "authority digest"),
  };
  assertExactKeys(value, Object.keys(core), "authority snapshot");
  return deepFreeze(core);
}

function normalizeClaim(value) {
  return normalizeClaimSnapshot({
    entrySchema: value?.entrySchema,
    claimId: value?.claimId,
    actorId: value?.actorId,
    repositoryId: value?.repositoryId,
    workItemId: value?.workItemId,
    deviceId: value?.deviceId,
    sessionId: value?.sessionId,
    canonicalBaseRevision: value?.canonicalBaseRevision,
    laneRevision: value?.laneRevision,
    declaredWriteSet: value?.declaredWriteScope,
    writeSetDigest: value?.writeSetDigest,
    leaseEpoch: value?.leaseEpoch,
    transitionCounter: value?.transitionCounter,
    reviewRequestId: value?.reviewRequestId,
    fenceRevision: value?.fenceRevision,
    transitionDigest: value?.transitionDigest,
    state: value?.state,
    claimRecordDigest: digestValue(value),
  });
}

function normalizeClaimSnapshot(value) {
  const core = {
    entrySchema: value?.entrySchema === "agentic-cloud-collaboration-entry/v2" ? value.entrySchema : invalid("claim schema"),
    claimId: requiredDigest(value?.claimId, "claim ID"),
    actorId: requiredText(value?.actorId, "claim actor"),
    repositoryId: requiredText(value?.repositoryId, "claim repository"),
    workItemId: requiredText(value?.workItemId, "claim work item"),
    deviceId: requiredText(value?.deviceId, "claim device"),
    sessionId: requiredText(value?.sessionId, "claim session"),
    canonicalBaseRevision: requiredSha(value?.canonicalBaseRevision, "claim base SHA"),
    laneRevision: requiredSha(value?.laneRevision, "claim lane revision"),
    declaredWriteSet: normalizeWriteSet(value?.declaredWriteSet),
    writeSetDigest: requiredDigest(value?.writeSetDigest, "claim write-set digest"),
    leaseEpoch: positiveInteger(value?.leaseEpoch, "claim lease epoch"),
    transitionCounter: positiveInteger(value?.transitionCounter, "claim transition counter"),
    reviewRequestId: requiredText(value?.reviewRequestId, "claim review request"),
    fenceRevision: requiredDigest(value?.fenceRevision, "claim fence revision"),
    transitionDigest: requiredDigest(value?.transitionDigest, "claim transition digest"),
    state: value?.state === "reviewed" ? value.state : invalid("claim state"),
    claimRecordDigest: requiredDigest(value?.claimRecordDigest, "claim record digest"),
  };
  assertExactKeys(value, Object.keys(core), "claim snapshot");
  return deepFreeze(core);
}

function normalizePullRequest(value) {
  const headRepository = value?.headRepository?.nameWithOwner || value?.headRepository?.fullName || value?.headRepository;
  const baseRepository = value?.baseRepository?.nameWithOwner || value?.baseRepository?.fullName || value?.baseRepository;
  return normalizePullRequestSnapshot({
    url: value?.url,
    number: value?.number,
    nodeId: value?.nodeId || value?.id,
    state: value?.state,
    isDraft: value?.isDraft,
    title: value?.title,
    body: value?.body,
    headRepository,
    baseRepository,
    headBranch: value?.headBranch || value?.headRefName,
    baseBranch: value?.baseBranch || value?.baseRefName,
    headSha: value?.headSha || value?.headRefOid,
    baseSha: value?.baseSha || value?.baseRefOid,
    authorLogin: value?.authorLogin || value?.author?.login,
    autoMergeRequest: value?.autoMergeRequest,
    isInMergeQueue: value?.isInMergeQueue,
    mergeQueueEntry: value?.mergeQueueEntry ?? null,
    reviewRequestId: value?.reviewRequestId || null,
  });
}

function normalizePullRequestSnapshot(value) {
  const core = {
    url: requiredGitHubUrl(value?.url, "pull-request URL"),
    number: positiveInteger(value?.number, "pull-request number"),
    nodeId: requiredText(value?.nodeId, "pull-request node ID"),
    state: requiredText(value?.state, "pull-request state").toUpperCase(),
    isDraft: value?.isDraft,
    title: requiredText(value?.title, "pull-request title"),
    body: boundedBody(value?.body),
    headRepository: requiredRepository(value?.headRepository),
    baseRepository: requiredRepository(value?.baseRepository),
    headBranch: requiredText(value?.headBranch, "pull-request head branch"),
    baseBranch: requiredText(value?.baseBranch, "pull-request base branch"),
    headSha: requiredSha(value?.headSha, "pull-request head SHA"),
    baseSha: requiredSha(value?.baseSha, "pull-request base SHA"),
    authorLogin: requiredText(value?.authorLogin, "pull-request author"),
    autoMergeRequest: value?.autoMergeRequest ?? null,
    isInMergeQueue: value?.isInMergeQueue,
    mergeQueueEntry: value?.mergeQueueEntry ?? null,
    reviewRequestId: value?.reviewRequestId || null,
  };
  assertExactKeys(value, Object.keys(core), "pull-request snapshot");
  if (core.isDraft !== false || core.autoMergeRequest !== null
    || core.isInMergeQueue !== false || core.mergeQueueEntry !== null) {
    throw new Error("Reviewed-lane pull request is not an exact ready, non-queued subject.");
  }
  return deepFreeze(core);
}

function normalizeRepository(value) {
  const fullName = requiredRepository(value?.fullName || value?.nameWithOwner || value?.full_name || value);
  const nodeId = requiredText(value?.nodeId || value?.node_id || (typeof value?.id === "string" ? value.id : ""), "repository node ID");
  return deepFreeze({ fullName, nodeId });
}

function normalizeActor(value) {
  return deepFreeze({ id: String(positiveInteger(value?.id, "actor ID")),
    login: requiredText(value?.login, "actor login") });
}
function requireInvalidSourceSubject(subject) {
  try {
    requireProtectedSquashSubject(subject, { label: "Reviewed source subject" });
  } catch {
    return;
  }
  throw new Error("Reviewed source subject already satisfies protected delivery policy.");
}
function gitCommitSha(rawCommit) {
  const bytes = Buffer.from(rawCommit, "utf8");
  const header = Buffer.from(`commit ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}
function boundedRawCommit(value, label) {
  if (typeof value !== "string" || value.includes("\0")) throw new Error(`${label} must be exact UTF-8 commit content.`);
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 1 || bytes > MAX_RAW_COMMIT_BYTES) throw new Error(`${label} exceeds its exact byte bound.`);
  return value;
}
function boundedBody(value) {
  const body = String(value ?? "");
  if (Buffer.byteLength(body, "utf8") > 65_536) throw new Error("Pull-request body exceeds its provider bound.");
  return body;
}
function requiredText(value, label) {
  const text = String(value ?? "");
  if (!text || text.trim() !== text || /\0/u.test(text)) throw new Error(`${label} is required and whitespace-exact.`);
  return text;
}
function requiredRepository(value) {
  const text = requiredText(value, "repository");
  if (!REPOSITORY_PATTERN.test(text)) throw new Error("Repository must use owner/name form.");
  return text;
}
function requiredGitHubUrl(value, label) {
  const text = requiredText(value, label);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/u.test(text))
    throw new Error(`${label} is not a canonical GitHub pull-request URL.`);
  return text;
}
function requiredSha(value, label) {
  const text = String(value || "");
  if (!SHA_PATTERN.test(text)) throw new Error(`${label} must be an exact SHA.`);
  return text;
}
function requiredDigest(value, label) {
  const text = String(value || "");
  if (!DIGEST_PATTERN.test(text)) throw new Error(`${label} must be an exact digest.`);
  return text;
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} must be a positive integer.`);
  return number;
}
function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value || {}).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${label} contains missing or arbitrary fields.`);
}
function invalid(label) {
  throw new Error(`Reviewed-lane ${label} is invalid.`);
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
