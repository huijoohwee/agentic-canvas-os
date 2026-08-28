// Responsibility: derive and verify one exact post-merge integrated-claim retirement.
import { execFileSync } from "node:child_process";
import {
  canonicalJson,
  digestValue,
  validateLedger,
} from "./cloud-collaboration-contract.mjs";
import { verifyProtectedMainRefreshChain } from "./protected-main-refresh-lib.mjs";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const DELIVERY_EVIDENCE_FIELDS = Object.freeze([
  "dependencyClosureDigest",
  "namedChecksDigest",
  "handoffEvidenceDigest",
  "operatorDecisionDigest",
  "integrationIntentDigest",
]);
export const POST_MERGE_CLOUD_AUTHORITY_VERIFICATION_SCHEMA =
  "agentic-post-merge-cloud-authority-verification/v1";
export const INTEGRATED_DELIVERY_TERMINAL_RETIREMENT_RUN_SCHEMA =
  "agentic-integrated-delivery-terminal-retirement-run/v1";
export function inspectIntegratedDeliveryTerminal({
  authority,
  branch,
  canonicalBaseSha,
  deliveryEvidence = null,
  headSha,
  ledger,
  ledgerRevision = null,
  protectedMainRefresh = null,
  pullRequest,
  gitText = repositoryGitText,
  validate = validateLedger,
} = {}) {
  requireAuthority(authority, { canonicalBaseSha, headSha });
  const subject = requireMergedPullRequest(pullRequest, {
    authority,
    branch,
    gitText,
    headSha,
    protectedMainRefresh,
  });
  requireValidLedger(ledger, validate);
  if (ledgerRevision !== null) requireSha(ledgerRevision, "ledger revision");
  const history = ledger.entries.filter(entry => entry?.claimId === authority.claimId);
  const integrationIndex = history.findLastIndex(entry => entry?.action === "integrate");
  const integration = history[integrationIndex];
  if (!integration) throw new Error("Claim history has no exact integration entry.");
  const localIndex = history.findIndex(entry => entry?.digest === authority.claimLedgerRevision
    && entry.claimDigest === authority.claimDigest
    && entry.claimCore?.transitionCounter === authority.transitionCounter);
  if (localIndex < 0) {
    throw new Error("Claim history has no exact local authority projection entry.");
  }
  requireIntegratedEntry(integration, authority, deliveryEvidence, headSha, subject.mergedAt);
  if (authority.state === "review_ready") {
    if (localIndex !== integrationIndex - 1) {
      throw new Error("Historical reviewed predecessor is not adjacent to integration.");
    }
    requireReviewReadyPredecessor(history[localIndex], authority);
  }
  const integrationReceiptDigest = integrationReceipt(integration);
  if (authority.state === "delivery_authorized"
    && integrationReceiptDigest !== authority.integrationReceiptDigest) {
    throw new Error("Historical integration receipt does not match local delivery authority.");
  }
  let previous = integration;
  const suffix = history.slice(integrationIndex + 1);
  const renewalEntries = suffix.at(-1)?.action === "retire" ? suffix.slice(0, -1) : suffix;
  for (const renewal of renewalEntries) {
    requireIntegratedPreservedContinuation(renewal, previous);
    previous = renewal;
  }
  const run = buildRetirementRun({
    authority,
    branch,
    headSha,
    integration,
    integrationReceiptDigest,
    protectedMainRefresh,
    subject,
  });
  const operation = buildRetirementOperation({
    authority,
    integrationReceiptDigest,
    run,
    subject,
  });
  const finalEntry = suffix.at(-1) || integration;
  const lastIntegratedIndex = finalEntry.action === "retire"
    ? history.length - 2
    : history.length - 1;
  if (authority.state === "delivery_authorized") {
    if (localIndex < integrationIndex || localIndex > lastIntegratedIndex) {
      throw new Error("Local delivery authority is not in the integrated-preserved lineage.");
    }
    requireDeliveryAuthorizedProjection(
      history[localIndex], authority, integration, integrationReceiptDigest,
    );
  }
  if (finalEntry.action === "retire") {
    if (finalEntry !== suffix.at(-1)) {
      throw new Error("Integrated retirement is not the terminal same-claim transition.");
    }
    const retirementBinding = requireRetiredEntry({
      authority,
      entry: finalEntry,
      headSha,
      integration,
      integrationReceiptDigest,
      operation,
      previous,
      subject,
    });
    return Object.freeze({
      state: "complete",
      authority,
      integration,
      integrationReceiptDigest,
      ledgerDigest: requireDigest(ledger.headDigest, "ledger digest"),
      ledgerRevision,
      retirement: finalEntry,
      retirementBinding,
      run,
      subject,
    });
  }
  if (finalEntry !== previous
    || !["integrate", "continue"].includes(finalEntry.action)
    || finalEntry.claimCore?.state !== "integrated-preserved") {
    throw new Error("Claim history is not pending one integrated retirement.");
  }
  const request = Object.freeze({
    targetRepository: authority.targetRepository,
    pullRequestNumber: subject.pullRequestNumber,
    claimId: authority.claimId,
    expectedFenceRevision: requireDigest(finalEntry.claimDigest, "current claim digest"),
    expectedTransitionCounter: positiveInteger(
      finalEntry.claimCore.transitionCounter,
      "current transition counter",
    ),
    expectedLedgerDigest: requireDigest(ledger.headDigest, "ledger digest"),
    deviceId: requiredText(finalEntry.claimCore.deviceId, "claim device ID"),
    sessionId: requiredText(finalEntry.claimCore.sessionId, "claim session ID"),
    reason: "integrated",
    finalRevision: headSha,
    reviewRequestId: subject.reviewRequestId,
    bytesDigest: operation.bytesDigest,
    namedChecksDigest: requireDigest(
      integration.claimCore.integration?.namedChecksDigest,
      "integration named checks digest",
    ),
    handoffEvidenceDigest: requireDigest(
      integration.claimCore.integration?.handoffEvidenceDigest,
      "integration handoff evidence digest",
    ),
    integrationReceiptDigest,
    idempotencyKey: operation.operationKey,
  });
  return Object.freeze({
    state: "pending",
    authority,
    integration,
    integrationReceiptDigest,
    ledgerDigest: request.expectedLedgerDigest,
    ledgerRevision,
    request,
    run,
    subject,
  });
}
export function verifyIntegratedRetirementEvidence(options = {}) {
  const inspected = inspectIntegratedDeliveryTerminal(options);
  if (inspected.state !== "complete") {
    throw new Error("Claim history does not end in an integrated retirement.");
  }
  return terminalVerification(inspected);
}
export function terminalVerification(inspected, additions = {}) {
  if (inspected?.state !== "complete") {
    throw new Error("Terminal verification requires a complete integrated retirement.");
  }
  return Object.freeze({
    ...additions,
    schema: POST_MERGE_CLOUD_AUTHORITY_VERIFICATION_SCHEMA,
    ok: true,
    configured: true,
    status: "integrated-retired",
    ledgerRepository: inspected.authority.ledgerRepository,
    targetRepository: inspected.authority.targetRepository,
    pullRequestNumber: inspected.subject.pullRequestNumber,
    pullRequestNodeId: inspected.subject.pullRequestNodeId,
    branch: inspected.subject.branch,
    headSha: inspected.subject.deliveredHeadSha,
    mergedHeadSha: inspected.subject.mergedHeadSha,
    mergeCommitSha: inspected.subject.mergeCommitSha,
    claimId: inspected.authority.claimId,
    integrationReceiptDigest: inspected.integrationReceiptDigest,
    integrationEntryDigest: inspected.integration.digest,
    retirementEntryDigest: inspected.retirement.digest,
    retirementBinding: inspected.retirementBinding,
    ledgerDigest: inspected.ledgerDigest,
    ledgerRevision: inspected.ledgerRevision,
    operationRunDigest: inspected.run.runDigest,
  });
}
function buildRetirementRun({ authority, branch, headSha, integration,
  integrationReceiptDigest, protectedMainRefresh, subject }) {
  const core = {
    schema: INTEGRATED_DELIVERY_TERMINAL_RETIREMENT_RUN_SCHEMA,
    controller: "post-merge-cloud-authority-controller",
    ledgerRepository: authority.ledgerRepository,
    targetRepository: authority.targetRepository,
    claimId: authority.claimId,
    integrationReceiptDigest,
    integrationEntryDigest: requireDigest(integration.digest, "integration entry digest"),
    pullRequestNumber: subject.pullRequestNumber,
    pullRequestNodeId: subject.pullRequestNodeId,
    reviewRequestId: subject.reviewRequestId,
    mergedAt: subject.mergedAt,
    branch,
    canonicalBaseSha: authority.canonicalBaseSha,
    deliveredHeadSha: headSha,
    mergedHeadSha: subject.mergedHeadSha,
    mergeCommitSha: subject.mergeCommitSha,
    protectedMainRefreshDigest: protectedMainRefresh
      ? digestValue(protectedMainRefresh)
      : null,
  };
  return Object.freeze({ ...core, runDigest: digestValue(core) });
}
function buildRetirementOperation({ authority, integrationReceiptDigest, run, subject }) {
  const operationKey = `integrated-delivery-terminal-retirement:${run.runDigest}`;
  const bytesDigest = digestValue({
    schema: "agentic-integrated-delivery-terminal-retirement-evidence/v1",
    operationKey,
    runDigest: run.runDigest,
    claimId: authority.claimId,
    integrationReceiptDigest,
    pullRequest: { number: subject.pullRequestNumber, nodeId: subject.pullRequestNodeId,
      mergeCommitSha: subject.mergeCommitSha },
  });
  const protectedPushOperationKey =
    `push-integrated-retire:${subject.mergeCommitSha}:${authority.claimId}`;
  const protectedPushBytesDigest = digestValue({
    schema: "agentic-cloud-integration-evidence/v1",
    repository: authority.targetRepository,
    pullRequestNumber: subject.pullRequestNumber,
    reviewRequestId: subject.reviewRequestId,
    laneRevision: authority.laneRevision,
    mergeCommitSha: subject.mergeCommitSha,
  });
  return Object.freeze({ operationKey, bytesDigest,
    protectedPushOperationKey, protectedPushBytesDigest });
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
  requireDigest(authority.writeSetDigest, "write-set digest");
  positiveInteger(authority.leaseEpoch, "lease epoch");
  positiveInteger(authority.transitionCounter, "transition counter");
  if (!Array.isArray(authority.cloudDeclaredWriteScope)
    || authority.cloudDeclaredWriteScope.length === 0) {
    throw new Error("Local delivery authority has no declared write scope.");
  }
  if (authority.canonicalBaseSha !== canonicalBaseSha || authority.laneRevision !== headSha) {
    throw new Error("Local delivery authority does not match the integration subject.");
  }
  if (authority.state === "delivery_authorized") {
    requireDigest(authority.integrationReceiptDigest, "integration receipt digest");
    if (!authority.integration || authority.integration.candidateRevision !== headSha) {
      throw new Error("Local delivery authority has no exact integration evidence.");
    }
  } else {
    requireDigest(authority.focusedEvidenceDigest, "review-ready focused evidence digest");
    if (authority.integration !== null || authority.integrationReceiptDigest !== null) {
      throw new Error("Review-ready local authority already contains terminal integration evidence.");
    }
  }
}
function requireMergedPullRequest(pullRequest, { authority, branch, gitText, headSha,
  protectedMainRefresh }) {
  const number = positiveInteger(pullRequest?.number, "merged pull request number");
  const nodeId = requiredText(pullRequest?.id ?? pullRequest?.nodeId, "merged pull request node ID");
  const reviewRequestId = `github-pull-request:${nodeId}`;
  if (pullRequest?.state !== "MERGED"
    || pullRequest.headRefName !== branch
    || pullRequest.baseRefName !== "main"
    || pullRequest.isCrossRepository !== false
    || reviewRequestId !== authority.reviewRequestId) {
    throw new Error("Pull request is not the exact merged integration subject.");
  }
  const urlSubject = parsePullRequestUrl(pullRequest.url);
  if (urlSubject.repository !== authority.targetRepository || urlSubject.number !== number) {
    throw new Error("Merged pull request URL does not match the delivery authority.");
  }
  const mergeCommitSha = requireSha(
    pullRequest.mergeCommit?.oid ?? pullRequest.mergeCommitSha,
    "merge commit",
  );
  const mergedAt = requiredInstant(pullRequest.mergedAt, "pull request merge time");
  const mergedHeadSha = requireMergedHead({
    deliveredHeadSha: headSha,
    gitText,
    protectedMainRefresh,
    pullRequestHeadSha: pullRequest.headRefOid,
  });
  return Object.freeze({
    branch,
    deliveredHeadSha: headSha,
    mergeCommitSha,
    mergedAt,
    mergedHeadSha,
    pullRequestNodeId: nodeId,
    pullRequestNumber: number,
    reviewRequestId,
  });
}
function requireMergedHead({ deliveredHeadSha, gitText, protectedMainRefresh,
  pullRequestHeadSha }) {
  requireSha(pullRequestHeadSha, "merged pull-request head");
  if (pullRequestHeadSha === deliveredHeadSha) {
    if (protectedMainRefresh !== null) {
      throw new Error(
        "Merged pull-request head equals the delivered head but carries a protected-main refresh receipt.",
      );
    }
    return pullRequestHeadSha;
  }
  if (!protectedMainRefresh || protectedMainRefresh.deliveredHeadSha !== deliveredHeadSha) {
    throw new Error("Merged pull-request head lacks its exact protected-main refresh receipt.");
  }
  if (typeof gitText !== "function") {
    throw new Error("Merged pull-request protected-main refresh requires a Git proof reader.");
  }
  const verified = verifyProtectedMainRefreshChain({
    expectedHeadSha: deliveredHeadSha,
    observedHeadSha: pullRequestHeadSha,
    gitText,
    mainRef: "origin/main",
  });
  if (!sameValue(verified, protectedMainRefresh)) {
    throw new Error("Merged pull-request refresh receipt does not match verified Git topology.");
  }
  return pullRequestHeadSha;
}
function repositoryGitText(args) {
  return execFileSync("git", args, {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function requireIntegratedEntry(entry, authority, deliveryEvidence, headSha, mergedAt) {
  const core = entry.claimCore;
  const responseLoss = authority.state === "review_ready";
  if (entry.schema !== "agentic-cloud-collaboration-entry/v2"
    || core?.state !== "integrated-preserved"
    || core.claimId !== authority.claimId
    || core.canonicalBaseRevision !== authority.canonicalBaseSha
    || core.laneRevision !== headSha
    || core.writeSetDigest !== authority.writeSetDigest
    || core.leaseEpoch !== authority.leaseEpoch
    || core.reviewRequestId !== authority.reviewRequestId
    || !sameValue(core.declaredWriteScope, authority.cloudDeclaredWriteScope)
    || (!responseLoss && !sameValue(core.integration, authority.integration))
    || Date.parse(requiredInstant(core.integration?.integratedAt, "integration time"))
      > Date.parse(mergedAt)) {
    throw new Error("Historical integration entry does not match local delivery authority.");
  }
  if (responseLoss) requireReviewReadyIntegration(core, authority, deliveryEvidence, headSha);
}
function requireDeliveryAuthorizedProjection(entry, authority, integration,
  integrationReceiptDigest) {
  const core = entry?.claimCore;
  if (entry?.schema !== "agentic-cloud-collaboration-entry/v2"
    || !["integrate", "continue"].includes(entry.action)
    || entry.claimId !== authority.claimId
    || entry.claimDigest !== authority.claimDigest
    || entry.digest !== authority.claimLedgerRevision
    || core?.state !== "integrated-preserved"
    || core.claimId !== authority.claimId
    || core.canonicalBaseRevision !== authority.canonicalBaseSha
    || core.laneRevision !== authority.laneRevision
    || core.writeSetDigest !== authority.writeSetDigest
    || core.leaseEpoch !== authority.leaseEpoch
    || core.transitionCounter !== authority.transitionCounter
    || core.reviewRequestId !== authority.reviewRequestId
    || core.evidenceDigest !== authority.focusedEvidenceDigest
    || !sameValue(core.declaredWriteScope, authority.cloudDeclaredWriteScope)
    || !sameValue(core.integration, integration.claimCore.integration)
    || !sameValue(core.integration, authority.integration)
    || integrationReceiptDigest !== authority.integrationReceiptDigest) {
    throw new Error("Historical integrated projection does not match local delivery authority.");
  }
}
function requireReviewReadyPredecessor(entry, authority) {
  const core = entry?.claimCore;
  if (entry?.schema !== "agentic-cloud-collaboration-entry/v2"
    || entry.action !== "continue"
    || entry.claimId !== authority.claimId
    || entry.claimDigest !== authority.claimDigest
    || entry.digest !== authority.claimLedgerRevision
    || core?.state !== "reviewed"
    || core.claimId !== authority.claimId
    || core.canonicalBaseRevision !== authority.canonicalBaseSha
    || core.laneRevision !== authority.laneRevision
    || core.writeSetDigest !== authority.writeSetDigest
    || core.leaseEpoch !== authority.leaseEpoch
    || core.transitionCounter !== authority.transitionCounter
    || core.reviewRequestId !== authority.reviewRequestId
    || core.evidenceDigest !== authority.focusedEvidenceDigest
    || core.integration !== undefined
    || !sameValue(core.declaredWriteScope, authority.cloudDeclaredWriteScope)) {
    throw new Error("Historical reviewed predecessor does not match local review-ready authority.");
  }
}
function requireReviewReadyIntegration(core, authority, deliveryEvidence, headSha) {
  if (!deliveryEvidence || typeof deliveryEvidence !== "object" || Array.isArray(deliveryEvidence)) {
    throw new Error("Review-ready terminal recovery requires exact local delivery evidence.");
  }
  for (const field of DELIVERY_EVIDENCE_FIELDS) {
    requireDigest(deliveryEvidence[field], `review-ready delivery evidence ${field}`);
  }
  const integration = core.integration;
  if (!integration
    || core.transitionCounter !== authority.transitionCounter + 1
    || integration.candidateRevision !== headSha
    || integration.reviewRequestId !== authority.reviewRequestId
    || integration.focusedEvidenceDigest !== authority.focusedEvidenceDigest
    || core.evidenceDigest !== authority.focusedEvidenceDigest
    || DELIVERY_EVIDENCE_FIELDS.some(field => integration[field] !== deliveryEvidence[field])) {
    throw new Error("Historical integration entry does not match local review-ready delivery evidence.");
  }
}
function requireIntegratedPreservedContinuation(entry, previous) {
  const core = entry?.claimCore;
  const previousCore = previous?.claimCore;
  if (entry?.schema !== "agentic-cloud-collaboration-entry/v2"
    || entry.action !== "continue"
    || entry.claimId !== previous.claimId
    || entry.repositoryId !== previous.repositoryId
    || core?.state !== "integrated-preserved"
    || core.transitionCounter !== previousCore?.transitionCounter + 1
    || previous.sequence >= entry.sequence
    || Date.parse(core.expiresAt) <= Date.parse(previousCore?.expiresAt)) {
    throw new Error("Integrated retirement history contains an invalid renewal transition.");
  }
  const stableCore = (value, { omitRecovery = false } = {}) => {
    const { expiresAt: _expiresAt, heartbeatCounter: _heartbeatCounter,
      transitionCounter: _transitionCounter, recovery, ...stable } = value;
    return omitRecovery ? stable : { ...stable, ...(recovery === undefined ? {} : { recovery }) };
  };
  const ordinary = core.heartbeatCounter === previousCore.heartbeatCounter + 1
    && Date.parse(entry.evaluationTime) < Date.parse(previousCore.expiresAt)
    && sameValue(stableCore(core), stableCore(previousCore));
  const recovered = core.heartbeatCounter === previousCore.heartbeatCounter
    && Date.parse(entry.evaluationTime) >= Date.parse(previousCore.expiresAt)
    && DIGEST_PATTERN.test(core.recovery?.evidenceDigest || "")
    && core.recovery?.recoveredAt === entry.evaluationTime
    && sameValue(stableCore(core, { omitRecovery: true }),
      stableCore(previousCore, { omitRecovery: true }));
  if (!ordinary && !recovered) {
    throw new Error("Integrated retirement history contains an invalid renewal transition.");
  }
}
function requireRetiredEntry({ authority, entry, headSha, integration,
  integrationReceiptDigest, operation, previous, subject }) {
  const core = entry.claimCore;
  const retirement = core?.retirement;
  const integratedEvidence = integration.claimCore?.integration;
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
    || retirement.integrationReceiptDigest !== integrationReceiptDigest
    || retirement.namedChecksDigest !== integratedEvidence?.namedChecksDigest
    || retirement.handoffEvidenceDigest !== integratedEvidence?.handoffEvidenceDigest) {
    throw new Error("Terminal claim entry is not the exact integrated retirement.");
  }
  const retiredAt = requiredInstant(retirement.retiredAt, "retirement time");
  const controllerBound = entry.idempotencyKey === digestValue(operation.operationKey)
    && retirement.bytesDigest === operation.bytesDigest;
  const protectedPushBound = entry.idempotencyKey
      === digestValue(operation.protectedPushOperationKey)
    && retirement.bytesDigest === operation.protectedPushBytesDigest;
  if (Date.parse(retiredAt) < Date.parse(subject.mergedAt)
    || (!controllerBound && !protectedPushBound)) {
    throw new Error("Terminal integrated retirement is not bound to the exact post-merge run.");
  }
  requireDigest(entry.digest, "retirement entry digest");
  return controllerBound ? "controller-run" : "protected-push-event";
}
function integrationReceipt(entry) {
  const core = {
    schema: "agentic-collaboration-integration-receipt/v1",
    operation: "integrate",
    status: "integrated-preserved",
    repositoryId: entry.repositoryId,
    claimId: entry.claimId,
    claimDigest: entry.claimDigest,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
    ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime,
  };
  return digestValue(core);
}
function requireValidLedger(ledger, validate) {
  if (!ledger || !Array.isArray(ledger.entries)) {
    throw new Error("Cloud collaboration ledger has no entries.");
  }
  if (typeof validate !== "function") throw new Error("Ledger validator is required.");
  const failures = validate(ledger);
  if (!Array.isArray(failures) || failures.length > 0) {
    throw new Error(`Cloud collaboration ledger is invalid${Array.isArray(failures) && failures.length
      ? `: ${failures.join("; ")}` : "."}`);
  }
  requireDigest(ledger.headDigest, "ledger digest");
}
function parsePullRequestUrl(value) {
  let url;
  try { url = new URL(requiredText(value, "pull request URL")); }
  catch { throw new Error("Pull request URL is invalid."); }
  const match = url.hostname === "github.com"
    ? url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/u)
    : null;
  if (!match) throw new Error("Pull request URL is not an exact GitHub pull request URL.");
  return { repository: `${match[1]}/${match[2]}`, number: Number(match[3]) };
}

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function requireRepository(value, label) {
  if (!REPOSITORY_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be owner/repository.`);
  }
  return value;
}

function requiredInstant(value, label) {
  const text = requiredText(value, label);
  const instant = new Date(text);
  const canonical = Number.isFinite(instant.valueOf()) ? instant.toISOString() : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(text)
    || (text !== canonical && `${text.slice(0, -1)}.000Z` !== canonical)) {
    throw new Error(`${label} must be an exact ISO instant.`);
  }
  return canonical;
}

function requiredText(value, label) {
  const text = String(value ?? "").normalize("NFC").trim();
  if (!text || text.length > 512 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new Error(`${label} is invalid.`);
  }
  return text;
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) throw new Error(`${label} must be an exact SHA.`);
  return value;
}

function requireDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} must be an exact digest.`);
  return value;
}
