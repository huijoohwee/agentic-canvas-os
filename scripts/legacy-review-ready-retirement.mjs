#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  buildCompletedReceipt,
  buildLocalReviewRetirementIntent,
  isRetiredPreservedLane,
  LOCAL_REVIEW_RETIREMENT_RECEIPT_SCHEMA,
  LOCAL_REVIEW_RETIREMENT_RESULT_SCHEMA,
  normalizeLocalReviewRetirementReceipt,
  normalizeLocalReviewRetirementRequest,
  normalizePullRequest,
  normalizeReviewReadySnapshot,
  parseLocalReviewRetirementMarker,
  prepareProviderCheckpoint,
  requireExactWriterMarker,
  renderLocalReviewRetirementMarker,
} from "./legacy-review-ready-retirement-lib.mjs";
import { collectScopedLaneState } from "./scoped-lane-admission-state.mjs";
import {
  verifyCurrentCloudInventory,
  verifyDormantPreservation,
} from "./scoped-lane-authority-state.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import {
  createWriterLeaseStore,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
  WRITER_LEASE_SCHEMA,
} from "./writer-lease-lib.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function retireLegacyReviewReadyLane(requestValue, adapterValue) {
  const request = normalizeLocalReviewRetirementRequest(requestValue);
  const adapter = requireAdapter(adapterValue);
  const first = adapter.capture();
  const second = adapter.capture();
  if (digestValue(first) !== digestValue(second)) {
    throw new Error("Lane, lease, remote branch, or pull request changed during inspection.");
  }
  if (second.lease?.status === "released") {
    return replayReleased({ request, snapshot: second, adapter });
  }

  const source = normalizeReviewReadySnapshot(second, request);
  const preservation = adapter.verifyPreservation(source);
  requirePreservation(preservation, source, request);
  const intent = buildLocalReviewRetirementIntent({ request, snapshot: source });
  const existingReceipt = adapter.readReceipt();
  if (existingReceipt) requirePreparedReceipt(existingReceipt, intent);
  else adapter.writeReceipt(preparedReceipt(intent, adapter.now()));

  const checkpoint = prepareProviderCheckpoint({ source, intent, adapter });
  if (source.pullRequest.state === "OPEN") {
    adapter.closePullRequest({
      expected: source.pullRequest,
      expectedLease: source.lease,
      body: checkpoint.body,
    });
  } else requireClosedCheckpoint(source.pullRequest, checkpoint);

  const providerClosed = adapter.capture();
  requireUnchangedSource(source, providerClosed);
  requireClosedCheckpoint(providerClosed.pullRequest, checkpoint);
  const freshPreservation = adapter.verifyPreservation(providerClosed);
  requirePreservation(freshPreservation, providerClosed, request);
  const receipt = buildCompletedReceipt({
    intent,
    preservation: freshPreservation,
    pullRequest: providerClosed.pullRequest,
    checkpoint,
  });
  const releasedLease = adapter.releaseLease({
    sessionId: source.lease.sessionId,
    branch: source.branch,
    expectedLease: source.lease,
    status: "released",
    timestamp: checkpoint.marker.retiredAt,
    values: { localReviewRetirement: receipt },
  });
  const finalSnapshot = adapter.capture();
  requireUnchangedSource(source, finalSnapshot, true);
  if (digestValue(finalSnapshot.lease) !== digestValue(releasedLease)) {
    throw new Error("Released writer lease changed before final verification.");
  }
  requireClosedCheckpoint(finalSnapshot.pullRequest, checkpoint);
  if (!isRetiredPreservedLane({ lane: finalSnapshot.lane, lease: finalSnapshot.lease })) {
    throw new Error("Released lane does not satisfy retired-preserved invariants.");
  }
  adapter.writeReceipt(receipt);
  return result(receipt, false);
}

export function createRepositoryRetirementAdapter({
  request,
  receiptPath,
  repository = request.repository,
} = {}) {
  const source = realpathSync(path.resolve(repository));
  const commonDirectory = realpathSync(path.resolve(
    source,
    gitText(source, ["rev-parse", "--git-common-dir"]).trim(),
  ));
  const output = path.resolve(receiptPath);
  if (within(output, source) || within(output, commonDirectory)) {
    throw new Error("Receipt must be outside the source worktree and Git common directory.");
  }
  const leaseStore = createWriterLeaseStore({ gitCommonDir: commonDirectory });
  const capture = () => captureRepositorySubject({ source, request });
  return {
    capture,
    now: () => new Date().toISOString(),
    readReceipt: () => readJson(output),
    writeReceipt: value => writeJson(output, value),
    projectWriterMarker: renderWriterMarker,
    updateWriterBody: updateWriterLeasePullRequestBody,
    closePullRequest: ({ expected, expectedLease, body }) =>
      closeProviderUnderLeaseFence({
        leaseStore,
        expectedLease,
        close: () => closePullRequest({
          repository: request.targetRepository, expected, body,
        }),
      }),
    releaseLease: input => leaseStore.release(input),
    verifyPreservation: snapshot => {
      const cloudVerification = verifyCurrentCloudInventory({
        ledgerRepository: request.ledgerRepository,
        targetRepository: request.targetRepository,
        inspect: invokeRepositoryCloudAction,
      });
      const dormantReceipt = verifyDormantPreservation({
        repository: source,
        targetRepository: request.targetRepository,
        lanes: [snapshot.lane],
        worktreePaths: [snapshot.lane.path],
        pullRequestReferences: [snapshot.pullRequest.url],
        operatorDecisionDigest: request.operatorDecisionDigest,
        sessionId: request.operatorSessionId,
        remoteAuthorityVerification: cloudVerification,
      });
      return { cloudVerification, dormantReceipt };
    },
  };
}

function replayReleased({ request, snapshot, adapter }) {
  const receipt = normalizeLocalReviewRetirementReceipt(
    snapshot.lease.localReviewRetirement,
  );
  requireRequestIntent(request, receipt.intent);
  if (!isRetiredPreservedLane({ lane: snapshot.lane, lease: snapshot.lease })) {
    throw new Error("Released lane has invalid retired-preserved evidence.");
  }
  requirePreservation(adapter.verifyPreservation(snapshot), snapshot, request);
  const markerText = renderLocalReviewRetirementMarker(receipt.provider.marker);
  const writerMarker = adapter.projectWriterMarker(snapshot.lease);
  const observedMarker = parseLocalReviewRetirementMarker(snapshot.pullRequest.body);
  requireExactWriterMarker(snapshot.pullRequest.body, writerMarker);
  if (
    !snapshot.pullRequest.body.includes(markerText)
    || digestValue(observedMarker) !== digestValue(receipt.provider.marker)
    || snapshot.pullRequest.state !== "CLOSED"
    || snapshot.pullRequest.merged
    || snapshot.pullRequest.headSha !== receipt.provider.headSha
    || digestValue(snapshot.pullRequest.body) !== receipt.provider.bodyDigest
  ) throw new Error("Released lane provider state no longer matches its receipt.");
  const existing = adapter.readReceipt();
  if (existing) {
    if (normalizeLocalReviewRetirementReceipt(existing).receiptDigest !== receipt.receiptDigest) {
      throw new Error("External retirement receipt conflicts with the released lease.");
    }
  } else adapter.writeReceipt(receipt);
  return result(receipt, true);
}

function captureRepositorySubject({ source, request }) {
  const state = collectScopedLaneState({ repository: source });
  const lane = state.lanes.find(item => path.resolve(item.path) === source);
  if (!lane) throw new Error(`Source is not a registered worktree: ${source}`);
  const origin = gitText(source, ["remote", "get-url", "origin"]).trim();
  if (normalizeGitHubRepository(origin).toLowerCase() !== request.targetRepository.toLowerCase()) {
    throw new Error("Source origin does not match --target-repository.");
  }
  const remoteHeadSha = readRemoteHead(source, request.branch);
  const pullRequest = readPullRequest({
    repository: request.targetRepository,
    number: request.expectedPullRequest,
  });
  return { lane, lease: lane.lease, pullRequest, remoteHeadSha };
}

function readPullRequest({ repository, number }) {
  const { payload: source, providerVersion } = ghIncludedJson([
    "api", "--include", `repos/${repository}/pulls/${number}`,
  ]);
  return normalizePullRequest({
    url: source.html_url,
    number: source.number,
    nodeId: source.node_id,
    providerVersion,
    state: String(source.state || "").toUpperCase(),
    draft: source.draft,
    merged: source.merged,
    closedAt: source.closed_at,
    body: source.body,
    headRepository: source.head?.repo?.full_name,
    headBranch: source.head?.ref,
    headSha: source.head?.sha,
    baseRepository: source.base?.repo?.full_name,
    baseBranch: source.base?.ref,
    baseSha: source.base?.sha,
  });
}

function closePullRequest({ repository, expected, body }) {
  const current = readPullRequest({ repository, number: expected.number });
  for (const field of [
    "url", "number", "nodeId", "state", "draft", "merged", "headRepository",
    "headBranch", "headSha", "baseRepository", "baseBranch", "baseSha", "body",
    "providerVersion",
  ]) {
    if (current[field] !== expected[field]) {
      throw new Error(`Pull request ${field} changed before provider closure.`);
    }
  }
  const mutation = buildConditionalPullRequestCloseRequest({ repository, expected, body });
  ghJson(mutation.args, mutation.input);
  return readPullRequest({ repository, number: expected.number });
}

export function closeProviderUnderLeaseFence({ leaseStore, expectedLease, close }) {
  if (typeof leaseStore?.withRegistryLock !== "function" || typeof close !== "function") {
    throw new Error("Provider closure requires the repository lease lock and transport.");
  }
  return leaseStore.withRegistryLock(registry => {
    const current = registry.leases?.[expectedLease.branch] || null;
    if (JSON.stringify(current) !== JSON.stringify(expectedLease)) {
      throw new Error("Writer lease changed before provider closure.");
    }
    return close();
  });
}

export function buildConditionalPullRequestCloseRequest({ repository, expected, body }) {
  return Object.freeze({
    args: [
      "api", "--method", "PATCH", `repos/${repository}/pulls/${expected.number}`,
      "--input", "-",
    ],
    input: JSON.stringify({ body, state: "closed" }),
  });
}

function requirePreservation(value, source, request) {
  const receipt = value?.dormantReceipt;
  if (
    !value?.cloudVerification || receipt?.status !== "dormant-preserved"
    || receipt.operatorDecisionDigest !== request.operatorDecisionDigest
    || receipt.sessionId !== request.operatorSessionId
    || !receipt.worktrees?.some(item => (
      item.path === source.lane.path && item.branch === source.lane.branch
      && item.headSha === source.lane.head && item.stateDigest === source.lane.stateDigest
    ))
    || !receipt.pullRequests?.some(item => (
      item.url === source.pullRequest.url && item.headSha === source.pullRequest.headSha
      && item.nodeId === source.pullRequest.nodeId
    ))
  ) throw new Error("Dormant preservation proof does not bind the exact local review lane.");
}

function requireUnchangedSource(source, observed, allowReleasedLease = false) {
  for (const field of [
    "path", "head", "treeSha", "branch", "dirty", "indexDigest", "workingTreeDigest",
  ]) {
    if (source.lane[field] !== observed.lane?.[field]) {
      throw new Error(`Preserved lane ${field} changed during retirement.`);
    }
  }
  if (source.remoteHeadSha !== observed.remoteHeadSha) {
    throw new Error("Preserved remote branch changed during retirement.");
  }
  for (const field of [
    "url", "number", "nodeId", "draft", "merged", "headRepository", "headBranch",
    "headSha", "baseRepository", "baseBranch", "baseSha",
  ]) {
    if (source.pullRequest[field] !== observed.pullRequest?.[field]) {
      throw new Error(`Preserved pull request ${field} changed during retirement.`);
    }
  }
  if (!allowReleasedLease && digestValue(source.lease) !== digestValue(observed.lease)) {
    throw new Error("Writer lease changed before provider completion.");
  }
}

function requireClosedCheckpoint(pullRequestValue, checkpoint) {
  const pullRequest = normalizePullRequest(pullRequestValue);
  const observedMarker = parseLocalReviewRetirementMarker(pullRequest.body);
  requireExactWriterMarker(pullRequest.body, checkpoint.writerMarker);
  if (
    pullRequest.state !== "CLOSED" || pullRequest.merged || !pullRequest.closedAt
    || !pullRequest.body.includes(checkpoint.markerText)
    || digestValue(observedMarker) !== digestValue(checkpoint.marker)
    || digestValue(projectWriterLeasePullRequestMarker(checkpoint.projectedLease))
      !== checkpoint.marker.releasedWriterMarkerDigest
  ) throw new Error("Pull request did not reach the exact closed, preserved checkpoint.");
}

function preparedReceipt(intent, preparedAt) {
  const core = {
    schema: LOCAL_REVIEW_RETIREMENT_RECEIPT_SCHEMA,
    status: "prepared",
    intent,
    intentDigest: intent.intentDigest,
    preparedAt: canonicalInstant(preparedAt, "preparedAt"),
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function requirePreparedReceipt(value, intent) {
  const { receiptDigest, ...core } = value || {};
  if (
    core.schema !== LOCAL_REVIEW_RETIREMENT_RECEIPT_SCHEMA || core.status !== "prepared"
    || core.intentDigest !== intent.intentDigest || digestValue(core) !== receiptDigest
  ) throw new Error("Existing prepared retirement receipt does not match this intent.");
}

function requireRequestIntent(request, intent) {
  if (
    request.targetRepository !== intent.targetRepository
    || request.ledgerRepository !== intent.ledgerRepository
    || request.operatorDecisionDigest !== intent.operatorDecisionDigest
    || request.branch !== intent.source.branch || request.expectedHead !== intent.source.headSha
    || request.expectedPullRequest !== intent.source.pullRequest.number
    || request.expectedPullRequestUrl !== intent.source.pullRequest.url
    || request.sourceSessionId !== intent.source.lease.sessionId
    || request.operatorSessionId !== intent.operatorSessionId
    || request.repository !== intent.source.worktreePath
  ) throw new Error("Requested replay does not match the released retirement intent.");
}

function requireAdapter(value) {
  for (const name of [
    "capture", "verifyPreservation", "readReceipt", "writeReceipt", "projectWriterMarker",
    "updateWriterBody", "closePullRequest", "releaseLease", "now",
  ]) {
    if (typeof value?.[name] !== "function") {
      throw new Error(`Retirement adapter method ${name} is required.`);
    }
  }
  return value;
}

function result(receipt, replayed) {
  return Object.freeze({
    schema: LOCAL_REVIEW_RETIREMENT_RESULT_SCHEMA,
    status: "retired-preserved",
    branch: receipt.intent.source.branch,
    headSha: receipt.intent.source.headSha,
    pullRequestUrl: receipt.intent.source.pullRequest.url,
    receiptDigest: receipt.receiptDigest,
    cleanupEligible: false,
    replayed,
  });
}

function renderWriterMarker(lease) {
  return `<!-- ${WRITER_LEASE_SCHEMA} ${JSON.stringify(projectWriterLeasePullRequestMarker(lease))} -->`;
}

function readRemoteHead(repository, branch) {
  const output = gitText(repository, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  const matches = output.trim().split(/\r?\n/u).filter(Boolean);
  if (matches.length !== 1) throw new Error(`Remote branch ${branch} is missing or ambiguous.`);
  const sha = matches[0].split(/\s+/u)[0];
  if (!SHA_PATTERN.test(sha)) throw new Error(`Remote branch ${branch} has no exact head SHA.`);
  return sha;
}

function normalizeGitHubRepository(origin) {
  const source = String(origin || "").trim();
  let repositoryPath = "";
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(source)) {
    const parsed = new URL(source);
    if (!["https:", "ssh:"].includes(parsed.protocol) || parsed.hostname !== "github.com") {
      throw new Error("Source origin must use GitHub HTTPS, SSH, or SCP.");
    }
    repositoryPath = parsed.pathname;
  } else {
    const match = source.match(/^(?:[^@\s]+@)?github\.com:(.+)$/iu);
    if (!match) throw new Error("Source origin must be an exact github.com repository URL.");
    repositoryPath = match[1];
  }
  const repository = repositoryPath.replace(/^\/+|\/+$/gu, "").replace(/\.git$/iu, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("Source origin must resolve to owner/repository.");
  }
  return repository;
}

function readJson(filePath) {
  return existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : null;
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, filePath);
}

function acquireReceiptLock(receiptPath) {
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  const lockPath = `${receiptPath}.lock`;
  const descriptor = openSync(lockPath, "wx", 0o600);
  return () => {
    closeSync(descriptor);
    unlinkSync(lockPath);
  };
}

function within(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function gitText(repository, args) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function ghJson(args, input = undefined) {
  return JSON.parse(execFileSync("gh", args, {
    encoding: "utf8",
    input,
    maxBuffer: 16 * 1024 * 1024,
  }));
}

export function parseGitHubIncludedResponse(response) {
  const separators = [...response.matchAll(/\r?\n\r?\n/gu)];
  const separator = separators.at(-1);
  if (!separator) throw new Error("GitHub response omitted provider headers.");
  const headerPrefix = response.slice(0, separator.index);
  const headers = headerPrefix.split(/\r?\n\r?\n/u).at(-1) || "";
  const providerVersion = headers.match(/^etag:\s*(.+)$/imu)?.[1]?.trim();
  if (!providerVersion) throw new Error("GitHub response omitted its exact ETag.");
  return {
    payload: JSON.parse(response.slice(separator.index + separator[0].length)),
    providerVersion,
  };
}

function ghIncludedJson(args) {
  const response = execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return parseGitHubIncludedResponse(response);
}

function canonicalInstant(value, label) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error(`${label} must be an ISO-8601 instant.`);
  return instant.toISOString();
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  try {
    if (!args.includes("--acknowledge-local-review-retirement")) {
      throw new Error("Explicit --acknowledge-local-review-retirement is required.");
    }
    const repository = path.resolve(option(args, "repository"));
    const targetRepository = option(args, "target-repository");
    const branch = gitText(repository, ["branch", "--show-current"]).trim();
    const expectedPullRequest = parsePullRequest(option(args, "expected-pr"), targetRepository);
    const request = normalizeLocalReviewRetirementRequest({
      repository,
      targetRepository,
      ledgerRepository: option(args, "ledger-repository"),
      branch,
      sourceSessionId: option(args, "source-session"),
      operatorSessionId: option(args, "operator-session"),
      expectedHead: option(args, "expected-head"),
      expectedPullRequest: expectedPullRequest.number,
      expectedPullRequestUrl: expectedPullRequest.url,
      operatorDecisionDigest: option(args, "operator-decision-digest"),
      evaluatedAt: new Date().toISOString(),
    });
    const receiptPath = path.resolve(option(args, "receipt"));
    const adapter = createRepositoryRetirementAdapter({ request, receiptPath });
    const releaseLock = acquireReceiptLock(receiptPath);
    try {
      const output = retireLegacyReviewReadyLane(request, adapter);
      process.stdout.write(`${json ? JSON.stringify(output) : render(output)}\n`);
    } finally {
      releaseLock();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const output = {
      schema: "agentic-local-review-retirement-error/v1",
      status: "blocked",
      message,
    };
    process.stderr.write(`${json ? JSON.stringify(output) : `[local-review-retirement] ${message}`}\n`);
    process.exitCode = 1;
  }
}

function option(args, name) {
  const prefix = `--${name}=`;
  const value = args.find(item => item.startsWith(prefix))?.slice(prefix.length) || "";
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}

function parsePullRequest(reference, repository) {
  const number = Number(reference);
  const urlMatch = reference.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/u);
  const parsedNumber = urlMatch ? Number(urlMatch[2]) : number;
  if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
    throw new Error("--expected-pr must be a positive number or exact GitHub pull request URL.");
  }
  if (urlMatch && urlMatch[1].toLowerCase() !== repository.toLowerCase()) {
    throw new Error("--expected-pr URL does not match --target-repository.");
  }
  return { number: parsedNumber, url: `https://github.com/${repository}/pull/${parsedNumber}` };
}

function render(output) {
  return `[local-review-retirement] ${output.status} ${output.branch}@${output.headSha}; receipt ${output.receiptDigest}`;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
