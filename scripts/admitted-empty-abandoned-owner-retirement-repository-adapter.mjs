// Responsibility: Provide repository and cloud ports for empty admitted owner retirement.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { realpathSync } from "node:fs";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { projectRootState } from "./cloud-collaboration-state-projection.mjs";
import {
  buildConditionalPullRequestCloseRequest,
  closeProviderUnderLeaseFence,
  parseGitHubIncludedResponse,
} from "./legacy-review-ready-retirement.mjs";
import { collectScopedLaneState } from "./scoped-lane-admission-state.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { verifyCurrentCloudInventory } from "./scoped-lane-authority-state.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import { casWriterLeaseProjection, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export function createAdmittedEmptyAbandonedOwnerRetirementRepositoryAdapter({
  request,
  repository = request.repository,
} = {}) {
  const source = realpathSync(path.resolve(repository));
  const commonDirectory = realpathSync(path.resolve(
    source,
    gitText(source, ["rev-parse", "--git-common-dir"]).trim(),
  ));
  const leaseStore = createWriterLeaseStore({ gitCommonDir: commonDirectory });
  return Object.freeze({
    capture: () => captureRepositorySubject({ source, request }),
    inspectCloudClaim: ({ source, allowMissing = false }) => inspectCloudClaim({ request, source, allowMissing }),
    now: () => new Date().toISOString(),
    closePullRequest: ({ expected, expectedLease, body }) =>
      closeProviderUnderLeaseFence({
        leaseStore,
        expectedLease,
        close: () => closePullRequest({
          repository: request.targetRepository,
          expected,
          body,
        }),
      }),
    requireClosedPullRequest: ({ expected, body }) => {
      const current = readPullRequest({
        repository: request.targetRepository,
        number: expected.number,
      });
      requireMatchingPullRequest(current, expected);
      if (current.state !== "CLOSED" || current.merged || current.body !== body) {
        throw new Error("Pull request closed state does not match the expected retirement body.");
      }
      return current;
    },
    requireMissingClaimClosure: ({ expected }) => {
      const current = readPullRequest({
        repository: request.targetRepository,
        number: expected.number,
      });
      for (const field of [
        "url",
        "number",
        "nodeId",
        "draft",
        "merged",
        "headRepository",
        "headBranch",
        "headSha",
        "baseRepository",
        "baseBranch",
        "baseSha",
      ]) {
        if (current[field] !== expected[field]) {
          throw new Error(`Pull request ${field} changed before local retirement finalization.`);
        }
      }
      if (current.state !== "CLOSED" || current.merged || !current.closedAt) {
        throw new Error("Missing-claim retirement can only resume from a closed unmerged pull request.");
      }
      return current;
    },
    retireClaim: ({ request: normalizedRequest, source, claim, evidence }) =>
      retireClaim({
        request: normalizedRequest,
        source,
        claim,
        evidence,
      }),
    releaseLease: ({ branch, expectedLease, timestamp, values }) => casWriterLeaseProjection({
      leaseStore,
      branch,
      expectedLeaseDigest: writerLeaseDigest(expectedLease),
      expectedClaimId: expectedLease.cloudAuthority.claimId,
      values: {
        ...values,
        status: "released",
        heartbeatAt: timestamp,
        expiresAt: timestamp,
        taskAuthority: null,
      },
    }).lease,
  });
}

function captureRepositorySubject({ source, request }) {
  const state = collectScopedLaneState({ repository: source });
  const lane = state.lanes.find(item => path.resolve(item.path) === source);
  if (!lane) throw new Error(`Source is not a registered worktree: ${source}`);
  const origin = gitText(source, ["remote", "get-url", "origin"]).trim();
  if (normalizeGitHubRepository(origin).toLowerCase() !== request.targetRepository.toLowerCase()) {
    throw new Error("Source origin does not match --target-repository.");
  }
  return {
    lane,
    lease: lane.lease,
    remoteHeadSha: readRemoteHead(source, request.branch),
    pullRequest: readPullRequest({
      repository: request.targetRepository,
      number: request.expectedPullRequest,
    }),
  };
}

function inspectCloudClaim({ request, source, allowMissing }) {
  const verification = verifyCurrentCloudInventory({
    ledgerRepository: request.ledgerRepository,
    targetRepository: request.targetRepository,
    inspect: invokeRepositoryCloudAction,
  });
  const expectedClaimId = source?.lease?.cloudAuthority?.claimId || null;
  const claim = verification.inventory.claims.find(item => item.claimId === expectedClaimId) || null;
  if (!allowMissing && !claim) {
    throw new Error("Cloud inventory no longer contains the exact admitted owner claim.");
  }
  return { verification, claim };
}

function retireClaim({ request, source, claim, evidence }) {
  const result = invokeRepositoryCloudAction({
    action: "retire",
    ledgerRepository: request.ledgerRepository,
    request: {
      targetRepository: request.targetRepository,
      claimId: claim.claimId,
      expectedFenceRevision: claim.fenceRevision,
      expectedTransitionCounter: claim.transitionCounter,
      deviceId: source.lease.device,
      sessionId: source.lease.sessionId,
      reason: "abandoned",
      finalRevision: source.lane.head,
      reviewRequestId: claim.reviewRequestId,
      bytesDigest: digestValue({ ...evidence, operation: "retire-bytes" }),
      namedChecksDigest: digestValue({ ...evidence, operation: "retire-checks" }),
      handoffEvidenceDigest: digestValue({ ...evidence, operation: "retire-handoff" }),
      idempotencyKey: [
        "admitted-empty-abandoned-owner-retirement",
        claim.claimId,
        source.lane.head,
      ].join(":"),
    },
  });
  if (
    result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true
    || result.action !== "retire"
    || result.claim?.claimId !== claim.claimId
    || projectRootState(result.claim?.state) !== "released"
  ) {
    throw new Error("Cloud retirement did not retire the exact admitted owner.");
  }
  const verification = verifyCurrentCloudInventory({
    ledgerRepository: request.ledgerRepository,
    targetRepository: request.targetRepository,
    inspect: invokeRepositoryCloudAction,
  });
  const claimPresentAfter = verification.inventory.claims.some(item => item.claimId === claim.claimId);
  return {
    ledgerRevision: verification.ledgerRevision,
    ledgerDigest: verification.ledgerDigest,
    claimPresentAfter,
    retirementReceiptDigest: result.receipt?.receiptDigest || result.operationReceipt?.receiptDigest,
  };
}

function readPullRequest({ repository, number }) {
  const response = execFileSync("gh", [
    "api",
    "--include",
    `repos/${repository}/pulls/${number}`,
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const { payload: source, providerVersion } = parseGitHubIncludedResponse(response);
  return {
    url: source.html_url,
    number: source.number,
    nodeId: source.node_id,
    providerVersion,
    state: String(source.state || "").toUpperCase(),
    draft: source.draft === true,
    merged: source.merged === true,
    closedAt: source.closed_at ? new Date(source.closed_at).toISOString() : null,
    body: String(source.body || ""),
    headRepository: source.head?.repo?.full_name,
    headBranch: source.head?.ref,
    headSha: source.head?.sha,
    baseRepository: source.base?.repo?.full_name,
    baseBranch: source.base?.ref,
    baseSha: source.base?.sha,
  };
}

function closePullRequest({ repository, expected, body }) {
  const current = readPullRequest({ repository, number: expected.number });
  requireMatchingPullRequest(current, expected);
  const mutation = buildConditionalPullRequestCloseRequest({ repository, expected, body });
  execFileSync("gh", mutation.args, {
    encoding: "utf8",
    input: mutation.input,
    maxBuffer: 16 * 1024 * 1024,
  });
  return readPullRequest({ repository, number: expected.number });
}

function requireMatchingPullRequest(current, expected) {
  for (const field of [
    "url",
    "number",
    "nodeId",
    "state",
    "draft",
    "merged",
    "headRepository",
    "headBranch",
    "headSha",
    "baseRepository",
    "baseBranch",
    "baseSha",
    "providerVersion",
  ]) {
    if (current[field] !== expected[field]) {
      throw new Error(`Pull request ${field} changed before retirement.`);
    }
  }
}

function readRemoteHead(repository, branch) {
  const output = execFileSync("git", [
    "-C",
    repository,
    "ls-remote",
    "--heads",
    "origin",
    branch,
  ], { encoding: "utf8" }).trim();
  const lines = output.split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error("Source remote branch is missing or ambiguous.");
  const head = lines[0].split(/\s+/u)[0];
  if (!/^[0-9a-f]{40}$/u.test(head)) throw new Error("Source remote head is invalid.");
  return head;
}

function gitText(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function normalizeGitHubRepository(remote) {
  const source = String(remote || "").trim();
  const ssh = source.match(/^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/u);
  if (ssh) return ssh[1];
  const https = source.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/u);
  if (https) return https[1];
  return source.replace(/\.git$/u, "");
}
