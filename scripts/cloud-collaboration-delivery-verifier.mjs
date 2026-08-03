import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { protectedMainRefreshHeads } from "./protected-main-refresh-lib.mjs";

export const CLOUD_DELIVERY_VERIFICATION_SCHEMA =
  "agentic-cloud-delivery-verification/v1";

const CLOUD_RESULT_SCHEMA = "agentic-cloud-collaboration-result/v1";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const VERIFIER_PATH = fileURLToPath(new URL("./cloud-collaboration.mjs", import.meta.url));
const CLOUD_PROJECTION_ENVIRONMENT_KEYS = [
  "AGENTIC_CLOUD_CLAIM_ID",
  "AGENTIC_CLOUD_EXPECTED_CLAIM_DIGEST",
  "AGENTIC_CLOUD_EXPECTED_LEDGER_REVISION",
];

export function verifyCloudDeliveryAuthority({
  repository = "",
  pullRequestNumber = null,
  pullRequestUrl = "",
  branch,
  headSha,
  canonicalBaseSha = "",
  cloudAuthority = null,
  protectedMainRefresh = null,
  environment = process.env,
  invoke = invokeRepositoryCloudVerifier,
} = {}) {
  const authority = resolveCloudAuthority({ cloudAuthority, environment });
  if (!authority) {
    return {
      schema: CLOUD_DELIVERY_VERIFICATION_SCHEMA,
      ok: true,
      configured: false,
      status: "not-configured",
    };
  }

  const subject = normalizeSubject({
    repository,
    pullRequestNumber,
    pullRequestUrl,
    branch,
    headSha,
    canonicalBaseSha,
  });
  requireProjectedSubject(cloudAuthority, subject);
  const allowProtectedMainRefresh = allowProtectedMainRefreshVerification({
    subject,
    cloudAuthority,
    protectedMainRefresh,
  });
  const request = {
    targetRepository: subject.repository,
    pullRequestNumber: subject.pullRequestNumber,
    branch: subject.branch,
    headSha: subject.headSha,
    requireStatus: "delivery_authorized",
    ...(subject.canonicalBaseSha
      ? { canonicalBaseSha: subject.canonicalBaseSha }
      : {}),
    ...(authority.claimId ? { claimId: authority.claimId } : {}),
    ...(authority.expectedClaimDigest
      ? { expectedClaimDigest: authority.expectedClaimDigest }
      : {}),
    ...(authority.expectedLedgerRevision
      ? { expectedLedgerRevision: authority.expectedLedgerRevision }
      : {}),
    ...(allowProtectedMainRefresh ? { allowProtectedMainRefresh: true } : {}),
  };
  const result = invoke({
    ledgerRepository: authority.ledgerRepository,
    request,
    environment,
  });
  const verification = requireReadyVerification({
    result,
    subject,
    authority,
  });
  return {
    schema: CLOUD_DELIVERY_VERIFICATION_SCHEMA,
    ok: true,
    configured: true,
    status: "ready",
    ledgerRepository: authority.ledgerRepository,
    targetRepository: subject.repository,
    pullRequestNumber: subject.pullRequestNumber,
    branch: subject.branch,
    headSha: subject.headSha,
    claimId: verification.claimId,
    claimDigest: verification.claimDigest,
    ledgerRevision: verification.ledgerRevision,
  };
}

export function invokeRepositoryCloudVerifier({
  ledgerRepository,
  request,
  environment = process.env,
} = {}) {
  requireRepository(ledgerRepository, "ledger repository");
  const childEnvironment = { ...environment };
  delete childEnvironment.NODE_OPTIONS;
  delete childEnvironment.NODE_PATH;
  const result = spawnSync(process.execPath, [
    VERIFIER_PATH,
    "verify",
    `--ledger-repository=${ledgerRepository}`,
    `--request-json=${JSON.stringify(request)}`,
    "--json",
  ], {
    encoding: "utf8",
    env: childEnvironment,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
  if (result.error) {
    throw new Error(`Cloud collaboration verifier could not run: ${publicMessage(result.error.message)}`);
  }
  const output = parseVerifierOutput(result.stdout);
  if (result.status !== 0) {
    const message = output?.error?.message || result.stderr || "verification was blocked";
    throw new Error(`Cloud collaboration verification failed: ${publicMessage(message)}`);
  }
  return output;
}

function resolveCloudAuthority({ cloudAuthority, environment }) {
  if (!environment || typeof environment !== "object") {
    throw new Error("Cloud collaboration verification requires an environment object.");
  }
  if (
    cloudAuthority !== null
    && (typeof cloudAuthority !== "object" || Array.isArray(cloudAuthority))
  ) {
    throw new Error("Cloud collaboration authority must be an object when provided.");
  }
  const projection = cloudAuthority || {};
  const environmentProjectionConfigured = CLOUD_PROJECTION_ENVIRONMENT_KEYS
    .some((key) => present(environment[key]));
  const configured = cloudAuthority !== null
    || present(environment.AGENTIC_LEDGER_REPOSITORY)
    || environmentProjectionConfigured;
  if (!configured) return null;

  const ledgerRepository = exactConfigurationValue("ledger repository", [
    projection.ledgerRepository,
    environment.AGENTIC_LEDGER_REPOSITORY,
  ]);
  requireRepository(ledgerRepository, "ledger repository");
  const claimId = exactConfigurationValue("claim ID", [
    projection.claimId,
    environment.AGENTIC_CLOUD_CLAIM_ID,
  ], { optional: true });
  const expectedClaimDigest = exactConfigurationValue("claim digest", [
    projection.claimDigest,
    projection.expectedClaimDigest,
    projection.fenceRevision,
    environment.AGENTIC_CLOUD_EXPECTED_CLAIM_DIGEST,
  ], { optional: true });
  const expectedLedgerRevision = exactConfigurationValue("ledger revision", [
    projection.ledgerRevision,
    projection.expectedLedgerRevision,
    environment.AGENTIC_CLOUD_EXPECTED_LEDGER_REVISION,
  ], { optional: true });
  const projectionFields = [claimId, expectedClaimDigest, expectedLedgerRevision];
  if (projectionFields.some(present) && !projectionFields.every(present)) {
    throw new Error(
      "Cloud collaboration projection requires claim ID, claim digest, and ledger revision together.",
    );
  }
  if (claimId) requireDigest(claimId, "claim ID");
  if (expectedClaimDigest) requireDigest(expectedClaimDigest, "claim digest");
  if (expectedLedgerRevision) requireSha(expectedLedgerRevision, "ledger revision");
  return {
    ledgerRepository,
    claimId,
    expectedClaimDigest,
    expectedLedgerRevision,
  };
}

function normalizeSubject({
  repository,
  pullRequestNumber,
  pullRequestUrl,
  branch,
  headSha,
  canonicalBaseSha,
}) {
  const urlSubject = pullRequestUrl ? parsePullRequestUrl(pullRequestUrl) : null;
  const normalizedRepository = exactConfigurationValue("target repository", [
    repository,
    urlSubject?.repository,
  ]);
  requireRepository(normalizedRepository, "target repository");
  const normalizedNumber = exactPositiveInteger("pull request number", [
    pullRequestNumber,
    urlSubject?.pullRequestNumber,
  ]);
  const normalizedBranch = String(branch || "").trim();
  if (!normalizedBranch || normalizedBranch.length > 255 || /[\u0000-\u001f\u007f]/u.test(normalizedBranch)) {
    throw new Error("Cloud collaboration verification requires an exact bounded branch.");
  }
  requireSha(headSha, "pull-request head");
  if (canonicalBaseSha) requireSha(canonicalBaseSha, "canonical base");
  return {
    repository: normalizedRepository,
    pullRequestNumber: normalizedNumber,
    branch: normalizedBranch,
    headSha,
    canonicalBaseSha: canonicalBaseSha || null,
  };
}

function parsePullRequestUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Cloud collaboration verification requires an absolute pull-request URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Cloud collaboration verification requires a plain HTTPS pull-request URL.");
  }
  const match = url.pathname.match(
    /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)\/?$/u,
  );
  if (!match) {
    throw new Error("Cloud collaboration verification requires an owner/repository pull-request URL.");
  }
  return {
    repository: `${match[1]}/${match[2]}`,
    pullRequestNumber: Number(match[3]),
  };
}

function requireProjectedSubject(cloudAuthority, subject) {
  if (!cloudAuthority) return;
  const projectedRepository = cloudAuthority.targetRepository
    || cloudAuthority.repository?.fullName
    || cloudAuthority.repository;
  if (
    present(projectedRepository)
    && String(projectedRepository).toLowerCase() !== subject.repository.toLowerCase()
  ) {
    throw new Error("Cloud collaboration projection targets another repository.");
  }
  const projectedNumber = cloudAuthority.pullRequestNumber
    || cloudAuthority.pullRequest?.number;
  if (present(projectedNumber) && Number(projectedNumber) !== subject.pullRequestNumber) {
    throw new Error("Cloud collaboration projection targets another pull request.");
  }
  if (present(cloudAuthority.branch) && cloudAuthority.branch !== subject.branch) {
    throw new Error("Cloud collaboration projection targets another branch.");
  }
  if (present(cloudAuthority.headSha) && cloudAuthority.headSha !== subject.headSha) {
    throw new Error("Cloud collaboration projection targets another head SHA.");
  }
  if (
    present(cloudAuthority.canonicalBaseSha)
    && cloudAuthority.canonicalBaseSha !== subject.canonicalBaseSha
  ) {
    throw new Error("Cloud collaboration projection targets another canonical base.");
  }
}

function allowProtectedMainRefreshVerification({
  subject,
  cloudAuthority,
  protectedMainRefresh,
}) {
  if (!cloudAuthority || cloudAuthority.state !== "delivery_authorized") {
    return false;
  }
  if (cloudAuthority.laneRevision !== subject.headSha) {
    return false;
  }
  if (
    present(cloudAuthority.canonicalBaseSha)
    && subject.canonicalBaseSha
    && cloudAuthority.canonicalBaseSha !== subject.canonicalBaseSha
  ) {
    return false;
  }
  if (!protectedMainRefresh) {
    if (!present(cloudAuthority.claimId) || !present(cloudAuthority.reviewRequestId)) {
      return false;
    }
    return true;
  }
  const refreshedHeads = protectedMainRefreshHeads(protectedMainRefresh);
  if (!refreshedHeads.includes(subject.headSha)) {
    throw new Error(
      "Protected-main refresh verification requires the delivered head to match the preserved review subject.",
    );
  }
  if (protectedMainRefresh.deliveredHeadSha !== subject.headSha) {
    throw new Error(
      "Protected-main refresh verification requires the delivered head to remain the exact preserved subject.",
    );
  }
  if (cloudAuthority.laneRevision !== subject.headSha) {
    throw new Error(
      "Protected-main refresh verification requires the cloud authority lane revision to match the preserved subject.",
    );
  }
  return true;
}

function requireReadyVerification({ result, subject, authority }) {
  if (
    !result
    || typeof result !== "object"
    || Array.isArray(result)
    || result.schema !== CLOUD_RESULT_SCHEMA
    || result.action !== "verify"
    || result.ok !== true
    || result.status !== "ready"
  ) {
    throw new Error("Cloud collaboration verifier did not return an exact ready result.");
  }
  requireSha(result.ledgerRevision, "verified ledger revision");
  requireDigest(result.claimDigest, "verified claim digest");
  const claim = result.claim;
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
    throw new Error("Cloud collaboration verifier returned no current claim.");
  }
  requireDigest(claim.claimId, "verified claim ID");
  const state = String(claim.status || claim.state || "").replaceAll("-", "_");
  if (state !== "delivery_authorized") {
    throw new Error("Cloud collaboration claim is not delivery-authorized.");
  }
  const repository = claim.repository?.fullName
    || claim.repository?.full_name
    || claim.targetRepository
    || result.subject?.repository;
  if (
    !repository
    || String(repository).toLowerCase() !== subject.repository.toLowerCase()
  ) {
    throw new Error("Cloud collaboration claim repository does not match delivery.");
  }
  const pullRequestNumber = claim.pullRequest?.number
    || claim.pullRequestNumber
    || result.subject?.pullRequestNumber;
  if (Number(pullRequestNumber) !== subject.pullRequestNumber) {
    throw new Error("Cloud collaboration claim pull request does not match delivery.");
  }
  const branch = claim.branch || claim.pullRequest?.branch || result.subject?.branch;
  if (branch !== subject.branch) {
    throw new Error("Cloud collaboration claim branch does not match delivery.");
  }
  const headSha = claim.headSha
    || claim.pullRequest?.headSha
    || claim.laneRevision
    || result.subject?.headSha;
  if (headSha !== subject.headSha) {
    throw new Error("Cloud collaboration claim head does not match delivery.");
  }
  if (authority.claimId && claim.claimId !== authority.claimId) {
    throw new Error("Cloud collaboration claim ID changed from its projection.");
  }
  if (
    authority.expectedClaimDigest
    && result.claimDigest !== authority.expectedClaimDigest
  ) {
    throw new Error("Cloud collaboration claim digest changed from its projection.");
  }
  return {
    claimId: claim.claimId,
    claimDigest: result.claimDigest,
    ledgerRevision: result.ledgerRevision,
  };
}

function exactConfigurationValue(label, values, { optional = false } = {}) {
  const normalized = values.filter(present).map((value) => String(value).trim());
  if (normalized.length === 0) {
    if (optional) return null;
    throw new Error(`Cloud collaboration ${label} is required when authority is configured.`);
  }
  if (normalized.some((value) => value !== normalized[0])) {
    throw new Error(`Cloud collaboration ${label} configuration conflicts.`);
  }
  return normalized[0];
}

function exactPositiveInteger(label, values) {
  const normalized = values.filter(present).map(Number);
  if (
    normalized.length === 0
    || normalized.some((value) => !Number.isInteger(value) || value <= 0)
    || normalized.some((value) => value !== normalized[0])
  ) {
    throw new Error(`Cloud collaboration ${label} is missing, invalid, or conflicting.`);
  }
  return normalized[0];
}

function parseVerifierOutput(stdout) {
  const line = String(stdout || "")
    .trim()
    .split(/\r?\n/u)
    .reverse()
    .find((candidate) => candidate.trim().startsWith("{"));
  if (!line) throw new Error("Cloud collaboration verifier returned no JSON result.");
  try {
    return JSON.parse(line);
  } catch {
    throw new Error("Cloud collaboration verifier returned invalid JSON.");
  }
}

function requireRepository(value, label) {
  if (!REPOSITORY_PATTERN.test(String(value || ""))) {
    throw new Error(`Cloud collaboration ${label} must be an owner/repository name.`);
  }
}

function requireDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) {
    throw new Error(`Cloud collaboration ${label} must be a lowercase SHA-256 digest.`);
  }
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) {
    throw new Error(`Cloud collaboration ${label} must be a lowercase 40-character Git SHA.`);
  }
}

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function publicMessage(value) {
  return String(value || "verification failed")
    .replace(/(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 300);
}
