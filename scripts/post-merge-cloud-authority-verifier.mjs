import { canonicalJson, validateLedger } from "./cloud-collaboration-contract.mjs";
import { verifyCloudDeliveryAuthority } from "./cloud-collaboration-delivery-verifier.mjs";
import {
  PROTECTED_MAIN_REFRESH_CHAIN_SCHEMA,
  PROTECTED_MAIN_REFRESH_SCHEMA,
} from "./protected-main-refresh-lib.mjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const LEDGER_REF = "agentic/collaboration-ledger";
const LEDGER_PATH = [".agentic", "collaboration-ledger.json"];
const DELIVERY_EVIDENCE_FIELDS = Object.freeze([
  "dependencyClosureDigest",
  "namedChecksDigest",
  "handoffEvidenceDigest",
  "operatorDecisionDigest",
  "integrationIntentDigest",
]);

export const POST_MERGE_CLOUD_AUTHORITY_VERIFICATION_SCHEMA =
  "agentic-post-merge-cloud-authority-verification/v1";

export function createPostMergeCloudAuthorityVerifier({
  verifyLive = verifyCloudDeliveryAuthority,
  readPullRequest,
  readLedger,
  validate = validateLedger,
  ghText,
} = {}) {
  const pullRequestReader = readPullRequest || (options => readGitHubPullRequest({
    pullRequestUrl: options.pullRequestUrl,
    ghText,
  }));
  const ledgerReader = readLedger || (ledgerRepository => readGitHubLedger({
    ledgerRepository,
    ghText,
  }));

  return options => {
    try {
      return verifyLive(options);
    } catch (liveError) {
      const pullRequest = pullRequestReader(options);
      if (pullRequest?.state !== "MERGED") throw liveError;
      try {
        const ledger = ledgerReader(options.cloudAuthority?.ledgerRepository);
        validate(ledger);
        return verifyIntegratedRetirementEvidence({
          authority: options.cloudAuthority,
          branch: options.branch,
          canonicalBaseSha: options.canonicalBaseSha,
          deliveryEvidence: options.deliveryEvidence,
          headSha: options.headSha,
          ledger,
          protectedMainRefresh: options.protectedMainRefresh,
          pullRequest,
        });
      } catch (retirementError) {
        throw new Error(
          `Post-merge cloud authority verification failed after live verification was unavailable: ${publicMessage(retirementError)}`,
        );
      }
    }
  };
}

export function verifyIntegratedRetirementEvidence({
  authority,
  branch,
  canonicalBaseSha,
  deliveryEvidence = null,
  headSha,
  ledger,
  protectedMainRefresh = null,
  pullRequest,
}) {
  requireAuthority(authority, { canonicalBaseSha, headSha });
  requireMergedPullRequest(pullRequest, { branch, headSha, protectedMainRefresh });
  if (!ledger || !Array.isArray(ledger.entries)) {
    throw new Error("Cloud collaboration ledger has no entries.");
  }
  const history = ledger.entries.filter(entry => entry?.claimId === authority.claimId);
  const integrationIndex = history.findLastIndex(entry => entry?.action === "integrate");
  const integration = history[integrationIndex];
  const terminalHistory = integrationIndex < 0 ? [] : history.slice(integrationIndex + 1);
  const retirement = history.at(-1);
  if (!integration || retirement?.action !== "retire") {
    throw new Error("Claim history does not end in an integrated retirement.");
  }
  requireIntegratedEntry(integration, authority, deliveryEvidence, headSha);
  let previous = integration;
  for (const renewal of terminalHistory.slice(0, -1)) {
    requireIntegratedPreservedContinuation(renewal, previous);
    previous = renewal;
  }
  requireRetiredEntry(retirement, previous, integration, authority, headSha);

  return Object.freeze({
    schema: POST_MERGE_CLOUD_AUTHORITY_VERIFICATION_SCHEMA,
    ok: true,
    configured: true,
    status: "integrated-retired",
    ledgerRepository: authority.ledgerRepository,
    targetRepository: authority.targetRepository,
    pullRequestNumber: pullRequest.number,
    branch,
    headSha,
    mergeCommitSha: pullRequest.mergeCommit.oid,
    claimId: authority.claimId,
    integrationEntryDigest: integration.digest,
    retirementEntryDigest: retirement.digest,
    ledgerDigest: ledger.headDigest,
  });
}

function requireAuthority(authority, { canonicalBaseSha, headSha }) {
  if (!authority || !["delivery_authorized", "review_ready"].includes(authority.state)) {
    throw new Error("Post-merge verification requires review-ready or delivery-authorized local authority.");
  }
  requireRepository(authority.ledgerRepository, "ledger repository");
  requireRepository(authority.targetRepository, "target repository");
  requireDigest(authority.claimId, "claim ID");
  requireDigest(authority.claimDigest, "claim digest");
  requireDigest(authority.claimLedgerRevision, "claim ledger revision");
  if (authority.canonicalBaseSha !== canonicalBaseSha || authority.laneRevision !== headSha) {
    throw new Error("Local delivery authority does not match the integration subject.");
  }
  if (authority.state === "delivery_authorized") {
    requireDigest(authority.integrationReceiptDigest, "integration receipt digest");
  }
  if (authority.state === "delivery_authorized"
    && (!authority.integration || authority.integration.candidateRevision !== headSha)) {
    throw new Error("Local delivery authority has no exact integration evidence.");
  }
  if (authority.state === "review_ready") {
    requireDigest(authority.focusedEvidenceDigest, "review-ready focused evidence digest");
    if (authority.integration !== null || authority.integrationReceiptDigest !== null) {
      throw new Error("Review-ready local authority already contains terminal integration evidence.");
    }
  }
}

function requireMergedPullRequest(pullRequest, { branch, headSha, protectedMainRefresh }) {
  if (pullRequest?.state !== "MERGED"
    || pullRequest.headRefName !== branch
    || !pullRequest.mergeCommit) {
    throw new Error("Pull request is not the exact merged integration subject.");
  }
  requireMergedHead({
    deliveredHeadSha: headSha,
    protectedMainRefresh,
    pullRequestHeadSha: pullRequest.headRefOid,
  });
  requireSha(pullRequest.mergeCommit.oid, "merge commit");
  if (!Number.isSafeInteger(pullRequest.number) || pullRequest.number < 1) {
    throw new Error("Merged pull request number is invalid.");
  }
}

function requireMergedHead({
  deliveredHeadSha,
  protectedMainRefresh,
  pullRequestHeadSha,
}) {
  requireSha(pullRequestHeadSha, "Merged pull-request head");
  if (pullRequestHeadSha === deliveredHeadSha) return;
  if (!protectedMainRefresh || protectedMainRefresh.deliveredHeadSha !== deliveredHeadSha) {
    throw new Error("Merged pull-request head lacks its exact protected-main refresh receipt.");
  }
  const steps = protectedMainRefresh.schema === PROTECTED_MAIN_REFRESH_SCHEMA
    ? [{
      previousHeadSha: protectedMainRefresh.deliveredHeadSha,
      refreshedHeadSha: protectedMainRefresh.refreshedHeadSha,
      mainParentSha: protectedMainRefresh.mainParentSha,
    }]
    : protectedMainRefresh.schema === PROTECTED_MAIN_REFRESH_CHAIN_SCHEMA
      && Array.isArray(protectedMainRefresh.refreshes)
      && protectedMainRefresh.refreshes.length >= 2
      && protectedMainRefresh.refreshCount === protectedMainRefresh.refreshes.length
      ? protectedMainRefresh.refreshes
      : null;
  if (!steps) {
    throw new Error("Merged pull-request protected-main refresh receipt is malformed.");
  }
  let expectedPreviousHeadSha = deliveredHeadSha;
  for (const step of steps) {
    requireSha(step?.previousHeadSha, "Protected-main refresh previous head");
    requireSha(step?.refreshedHeadSha, "Protected-main refresh head");
    requireSha(step?.mainParentSha, "Protected-main refresh main parent");
    if (step.previousHeadSha !== expectedPreviousHeadSha) {
      throw new Error("Merged pull-request protected-main refresh chain is discontinuous.");
    }
    expectedPreviousHeadSha = step.refreshedHeadSha;
  }
  if (
    protectedMainRefresh.refreshedHeadSha !== expectedPreviousHeadSha
    || pullRequestHeadSha !== expectedPreviousHeadSha
  ) {
    throw new Error("Merged pull-request head does not match its protected-main refresh receipt.");
  }
}

function requireIntegratedEntry(entry, authority, deliveryEvidence, headSha) {
  const core = entry.claimCore;
  const reviewReadyResponseLoss = authority.state === "review_ready";
  if (entry.schema !== "agentic-cloud-collaboration-entry/v2"
    || core?.state !== "integrated-preserved"
    || core.claimId !== authority.claimId
    || core.canonicalBaseRevision !== authority.canonicalBaseSha
    || core.laneRevision !== headSha
    || core.writeSetDigest !== authority.writeSetDigest
    || core.leaseEpoch !== authority.leaseEpoch
    || core.reviewRequestId !== authority.reviewRequestId
    || core.transitionCounter !== authority.transitionCounter + (reviewReadyResponseLoss ? 1 : 0)
    || !sameValue(core.declaredWriteScope, authority.cloudDeclaredWriteScope)
    || (!reviewReadyResponseLoss && entry.claimDigest !== authority.claimDigest)
    || (!reviewReadyResponseLoss && entry.digest !== authority.claimLedgerRevision)
    || (!reviewReadyResponseLoss && !sameValue(core.integration, authority.integration))) {
    throw new Error("Historical integration entry does not match local delivery authority.");
  }
  if (reviewReadyResponseLoss) {
    requireReviewReadyIntegration(core, authority, deliveryEvidence, headSha);
  }
}

function requireReviewReadyIntegration(core, authority, deliveryEvidence, headSha) {
  const integration = core.integration;
  if (!deliveryEvidence || typeof deliveryEvidence !== "object" || Array.isArray(deliveryEvidence)) {
    throw new Error("Review-ready terminal recovery requires exact local delivery evidence.");
  }
  for (const field of DELIVERY_EVIDENCE_FIELDS) {
    requireDigest(deliveryEvidence[field], `review-ready delivery evidence ${field}`);
  }
  if (!integration
    || integration.candidateRevision !== headSha
    || integration.reviewRequestId !== authority.reviewRequestId
    || integration.focusedEvidenceDigest !== authority.focusedEvidenceDigest
    || core.evidenceDigest !== authority.focusedEvidenceDigest
    || integration.dependencyClosureDigest !== deliveryEvidence.dependencyClosureDigest
    || integration.namedChecksDigest !== deliveryEvidence.namedChecksDigest
    || integration.handoffEvidenceDigest !== deliveryEvidence.handoffEvidenceDigest
    || integration.operatorDecisionDigest !== deliveryEvidence.operatorDecisionDigest
    || integration.integrationIntentDigest !== deliveryEvidence.integrationIntentDigest) {
    throw new Error("Historical integration entry does not match local review-ready delivery evidence.");
  }
}

function requireIntegratedPreservedContinuation(entry, previous) {
  const core = entry?.claimCore;
  const previousCore = previous?.claimCore;
  if (entry?.schema !== "agentic-cloud-collaboration-entry/v2"
    || entry.action !== "continue"
    || core?.state !== "integrated-preserved"
    || core.transitionCounter !== previousCore?.transitionCounter + 1
    || previous.sequence >= entry.sequence
    || Date.parse(core.expiresAt) <= Date.parse(previousCore?.expiresAt)) {
    throw new Error("Integrated retirement history contains an invalid renewal transition.");
  }
  const stableCore = (value, { omitRecovery = false } = {}) => {
    const {
      expiresAt: _expiresAt,
      heartbeatCounter: _heartbeatCounter,
      transitionCounter: _transitionCounter,
      recovery,
      ...stable
    } = value;
    return omitRecovery ? stable : {
      ...stable,
      ...(recovery === undefined ? {} : { recovery }),
    };
  };
  const ordinaryRenewal = (
    core.heartbeatCounter === previousCore.heartbeatCounter + 1
    && Date.parse(entry.evaluationTime) < Date.parse(previousCore.expiresAt)
    && canonicalJson(stableCore(core)) === canonicalJson(stableCore(previousCore))
  );
  const expiredRecovery = (
    core.heartbeatCounter === previousCore.heartbeatCounter
    && Date.parse(entry.evaluationTime) >= Date.parse(previousCore.expiresAt)
    && DIGEST_PATTERN.test(core.recovery?.evidenceDigest || "")
    && core.recovery?.recoveredAt === entry.evaluationTime
    && canonicalJson(stableCore(core, { omitRecovery: true }))
      === canonicalJson(stableCore(previousCore, { omitRecovery: true }))
  );
  if (!ordinaryRenewal && !expiredRecovery) {
    throw new Error("Integrated retirement history contains an invalid renewal transition.");
  }
}

function requireRetiredEntry(entry, previous, integration, authority, headSha) {
  const core = entry.claimCore;
  const integratedEvidence = integration.claimCore?.integration;
  const retirement = core?.retirement;
  if (entry.schema !== "agentic-cloud-collaboration-entry/v2"
    || core?.state !== "retired"
    || core.claimId !== authority.claimId
    || core.canonicalBaseRevision !== authority.canonicalBaseSha
    || core.laneRevision !== headSha
    || core.writeSetDigest !== authority.writeSetDigest
    || core.leaseEpoch !== authority.leaseEpoch
    || core.reviewRequestId !== authority.reviewRequestId
    || core.transitionCounter !== previous.claimCore.transitionCounter + 1
    || previous.sequence >= entry.sequence
    || !sameValue(core.declaredWriteScope, authority.cloudDeclaredWriteScope)
    || !sameValue(core.integration, integratedEvidence)
    || retirement?.reason !== "integrated"
    || retirement.finalRevision !== headSha
    || retirement.reviewRequestId !== authority.reviewRequestId
    || (authority.state === "delivery_authorized"
      && retirement.integrationReceiptDigest !== authority.integrationReceiptDigest)
    || retirement.namedChecksDigest !== integratedEvidence?.namedChecksDigest
    || retirement.handoffEvidenceDigest !== integratedEvidence?.handoffEvidenceDigest) {
    throw new Error("Terminal claim entry is not the exact integrated retirement.");
  }
  requireDigest(retirement.integrationReceiptDigest, "retirement integration receipt digest");
  requireDigest(entry.digest, "retirement entry digest");
}

function readGitHubPullRequest({ pullRequestUrl, ghText }) {
  requireFunction(ghText, "GitHub command reader");
  return JSON.parse(ghText([
    "pr", "view", pullRequestUrl,
    "--json", "number,state,headRefName,headRefOid,mergeCommit,url",
  ]));
}

function readGitHubLedger({ ledgerRepository, ghText }) {
  requireRepository(ledgerRepository, "ledger repository");
  requireFunction(ghText, "GitHub command reader");
  const reference = ghJson(ghText, `repos/${ledgerRepository}/git/ref/heads/${encodeURIComponent(LEDGER_REF)}`);
  const commitSha = requireSha(reference?.object?.sha, "ledger commit");
  const commit = ghJson(ghText, `repos/${ledgerRepository}/git/commits/${commitSha}`);
  let treeSha = requireSha(commit?.tree?.sha, "ledger root tree");
  for (const [index, segment] of LEDGER_PATH.entries()) {
    const tree = ghJson(ghText, `repos/${ledgerRepository}/git/trees/${treeSha}`);
    const item = tree?.tree?.find(candidate => candidate.path === segment);
    const expectedType = index === LEDGER_PATH.length - 1 ? "blob" : "tree";
    if (item?.type !== expectedType) {
      throw new Error(`Collaboration ledger path segment ${segment} is missing.`);
    }
    treeSha = requireSha(item.sha, `ledger ${expectedType}`);
  }
  const blob = ghJson(ghText, `repos/${ledgerRepository}/git/blobs/${treeSha}`);
  if (blob?.encoding !== "base64") {
    throw new Error("Collaboration ledger blob is not base64 encoded.");
  }
  const bytes = Buffer.from(String(blob.content || "").replace(/\s/gu, ""), "base64");
  if (bytes.length === 0) throw new Error("Collaboration ledger blob is empty.");
  return JSON.parse(bytes.toString("utf8"));
}

function ghJson(ghText, endpoint) {
  return JSON.parse(ghText([
    "api", "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2026-03-10", endpoint,
  ]));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireFunction(value, label) {
  if (typeof value !== "function") throw new Error(`${label} is required.`);
}

function requireRepository(value, label) {
  if (!REPOSITORY_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be owner/repository.`);
  }
  return value;
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) throw new Error(`${label} must be an exact SHA.`);
  return value;
}

function requireDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} must be an exact digest.`);
  return value;
}

function publicMessage(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 500);
}
