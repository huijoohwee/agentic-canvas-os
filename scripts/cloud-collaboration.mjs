#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import {
  CLOUD_RESULT_SCHEMA,
  createGitHubCloudCollaborationAdapter,
} from "./github-cloud-collaboration-adapter.mjs";
import { digestValue } from "./cloud-collaboration-contract.mjs";
import { verifyProtectedMainRefreshChain } from "./protected-main-refresh-lib.mjs";

const MUTATIONS = new Set([
  "claim",
  "bind",
  "heartbeat",
  "review-ready",
  "delivery-authorize",
  "handoff",
  "release",
]);
const DISPATCH_ACTIONS = new Set(["status", "verify", "claim", "heartbeat", "review-ready", "delivery-authorize", "handoff", "release"]);
const ACTIONS = new Set(["status", "verify", ...MUTATIONS, "verify-event", "dispatch"]);
const [rawAction, ...argumentsList] = process.argv.slice(2);
const json = argumentsList.includes("--json");

try {
  if (!ACTIONS.has(rawAction)) usage();
  const action = resolveAction(rawAction);
  const ledgerRepository = option("ledger-repository") ||
    process.env.AGENTIC_LEDGER_REPOSITORY ||
    process.env.GITHUB_REPOSITORY ||
    "huijoohwee/agentic-canvas-os";
  const adapter = createGitHubCloudCollaborationAdapter({ ledgerRepository });
  const result = action === "verify-event"
    ? await verifyEvent({ adapter })
    : await adapter.execute(action, buildRequest(action));
  emit(result);
  if (result.ok === false) process.exitCode = 1;
} catch (error) {
  const result = {
    schema: CLOUD_RESULT_SCHEMA,
    ok: false,
    action: rawAction || null,
    status: "error",
    error: {
      code: "cloud_collaboration_failed",
      message: publicError(error),
    },
  };
  if (!json) throw error;
  console.log(JSON.stringify(result));
  process.exitCode = 1;
}

async function verifyEvent({ adapter }) {
  const eventPath = option("event-path") || process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("verify-event requires --event-path or GITHUB_EVENT_PATH.");
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  if (event.merge_group) {
    throw new Error("Merge-group cloud verification is unavailable until exact member claims can be joined.");
  }
  if (event.pull_request) {
    const pullRequest = event.pull_request;
    const targetRepository = requiredText(event.repository?.full_name, "event repository");
    const reviewRequestId = `github-pull-request:${requiredText(pullRequest.node_id, "event pull request node id")}`;
    const currentClaims = await adapter.execute("status", {
      targetRepository,
    });
    const deliveryClaim = currentClaims.claims?.find((claim) => (
      claim.reviewRequestId === reviewRequestId
      && claim.state === "delivery-authorized"
    )) || null;
    if (
      deliveryClaim
      && deliveryClaim.laneRevision !== requiredSha(pullRequest.head?.sha, "event head SHA")
    ) {
      verifyEventProtectedMainRefresh({
        pullRequestNumber: positiveInteger(pullRequest.number, "event pull request"),
        expectedHeadSha: requiredSha(deliveryClaim.laneRevision, "delivery-authorized lane revision"),
        observedHeadSha: requiredSha(pullRequest.head?.sha, "event head SHA"),
        observedBaseSha: requiredSha(pullRequest.base?.sha, "event base SHA"),
      });
      return adapter.execute("verify", {
        targetRepository,
        pullRequestNumber: positiveInteger(pullRequest.number, "event pull request"),
        branch: requiredText(pullRequest.head?.ref, "event head branch"),
        canonicalBaseSha: requiredSha(deliveryClaim.canonicalBaseRevision, "delivery-authorized canonical base"),
        headSha: requiredSha(deliveryClaim.laneRevision, "delivery-authorized lane revision"),
        requireStatus: "delivery_authorized",
        claimId: requiredText(deliveryClaim.claimId, "delivery-authorized claim id"),
        reviewRequestId,
        allowProtectedMainRefresh: true,
        actorId: process.env.GITHUB_ACTOR_ID,
        actorLogin: process.env.GITHUB_ACTOR,
      });
    }
    return adapter.execute("verify", {
      targetRepository,
      pullRequestNumber: positiveInteger(pullRequest.number, "event pull request"),
      branch: requiredText(pullRequest.head?.ref, "event head branch"),
      canonicalBaseSha: requiredSha(pullRequest.base?.sha, "event base SHA"),
      headSha: requiredSha(pullRequest.head?.sha, "event head SHA"),
      requireStatus: "review_ready",
      actorId: process.env.GITHUB_ACTOR_ID,
      actorLogin: process.env.GITHUB_ACTOR,
    });
  }
  if (event.ref === `refs/heads/${event.repository?.default_branch}`) {
    const targetRepository = requiredText(event.repository?.full_name, "event repository");
    const integratedRelease = await releaseIntegratedClaimForEvent({
      adapter,
      event,
      targetRepository,
    });
    if (integratedRelease) return integratedRelease;
    return adapter.execute("status", {
      targetRepository,
      actorId: process.env.GITHUB_ACTOR_ID,
      actorLogin: process.env.GITHUB_ACTOR,
    });
  }
  throw new Error("verify-event supports pull_request and protected default-branch push events only.");
}

function verifyEventProtectedMainRefresh({
  pullRequestNumber,
  expectedHeadSha,
  observedHeadSha,
  observedBaseSha,
  gitText = args => execFileSync("git", args, { encoding: "utf8" }).trim(),
  run = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
}) {
  const mainRef = "refs/remotes/origin/main";
  const pullRef = `refs/remotes/pull/${pullRequestNumber}/head`;
  fetchProtectedMainRefreshRefs({ pullRequestNumber, run });
  const fetchedHeadSha = requiredSha(gitText(["rev-parse", pullRef]), "fetched pull request head SHA");
  if (fetchedHeadSha !== observedHeadSha) {
    throw new Error("Fetched pull request head does not match the observed event head.");
  }
  const refresh = verifyProtectedMainRefreshWithRetry({
    expectedHeadSha,
    observedHeadSha,
    gitText,
    run,
    mainRef,
    pullRequestNumber,
  });
  const latestRefresh = Array.isArray(refresh?.refreshes)
    ? refresh.refreshes.at(-1)
    : refresh;
  if (latestRefresh?.mainParentSha !== observedBaseSha) {
    throw new Error("Observed pull request base does not match the protected-main refresh parent.");
  }
  return refresh;
}

function fetchProtectedMainRefreshRefs({ pullRequestNumber, run, unshallow = false }) {
  const fetchArguments = unshallow
    ? ["fetch", "--no-tags", "--unshallow", "origin"]
    : ["fetch", "--no-tags", "origin"];
  run("git", [
    ...fetchArguments,
    "+refs/heads/main:refs/remotes/origin/main",
    `+refs/pull/${pullRequestNumber}/head:refs/remotes/pull/${pullRequestNumber}/head`,
  ]);
}

function verifyProtectedMainRefreshWithRetry({
  expectedHeadSha,
  observedHeadSha,
  gitText,
  run,
  mainRef,
  pullRequestNumber,
}) {
  try {
    return verifyProtectedMainRefreshChain({
      expectedHeadSha,
      observedHeadSha,
      gitText,
      mainRef,
    });
  } catch (error) {
    if (!shouldRetryProtectedMainRefreshVerification(error, gitText)) throw error;
    fetchProtectedMainRefreshRefs({ pullRequestNumber, run, unshallow: true });
    return verifyProtectedMainRefreshChain({
      expectedHeadSha,
      observedHeadSha,
      gitText,
      mainRef,
    });
  }
}

function shouldRetryProtectedMainRefreshVerification(error, gitText) {
  const message = String(error instanceof Error ? error.message : error || "");
  if (!message) return false;
  const shallowRepository = gitText(["rev-parse", "--is-shallow-repository"]).trim() === "true";
  if (!shallowRepository) return false;
  return [
    "Protected pull-request head advanced beyond an exact protected-main refresh chain.",
    "Protected-main refresh tree is not equivalent to its exact parent merge.",
    "needs merge",
    "Not a valid object name",
    "unknown revision",
    "bad object",
    "no merge base",
  ].some(fragment => message.includes(fragment));
}

async function releaseIntegratedClaimForEvent({ adapter, event, targetRepository }) {
  const mergeCommitSha = requiredSha(
    first(event.after, event.head_commit?.id),
    "event merge commit SHA",
  );
  const pulls = await adapter.pullRequestsForCommit({
    targetRepository,
    commitSha: mergeCommitSha,
  });
  if (pulls.length !== 1 || pulls[0].state !== "closed") return null;
  const pullRequest = pulls[0];
  const reviewRequestId = `github-pull-request:${pullRequest.nodeId}`;
  const claim = (await adapter.listClaims({ targetRepository }))
    .find((candidate) => candidate.reviewRequestId === reviewRequestId);
  if (!claim || claim.state !== "delivery-authorized") return null;
  const evidenceDigest = digestValue({
    schema: "agentic-cloud-integration-evidence/v1",
    repository: targetRepository,
    pullRequestNumber: pullRequest.number,
    reviewRequestId,
    laneRevision: claim.laneRevision,
    mergeCommitSha,
  });
  const integrationReceiptDigest = digestValue({
    schema: "agentic-cloud-integration-receipt/v1",
    repository: targetRepository,
    pullRequestNumber: pullRequest.number,
    reviewRequestId,
    canonicalBaseRevision: claim.canonicalBaseRevision,
    laneRevision: claim.laneRevision,
    mergeCommitSha,
  });
  return adapter.execute("release", {
    targetRepository,
    pullRequestNumber: pullRequest.number,
    claimId: claim.claimId,
    expectedFenceRevision: claim.fenceRevision,
    expectedTransitionCounter: claim.transitionCounter,
    deviceId: claim.deviceId,
    sessionId: claim.sessionId,
    reason: "integrated",
    evidenceDigest,
    integrationReceiptDigest,
    idempotencyKey: `push-integrated-release:${mergeCommitSha}:${claim.claimId}`,
    actorId: process.env.GITHUB_ACTOR_ID,
    actorLogin: process.env.GITHUB_ACTOR,
  });
}

function buildRequest(action) {
  const source = parseRequestJson();
  const request = {
    ...source,
    targetRepository: first(
      option("target-repository"),
      process.env.AGENTIC_TARGET_REPOSITORY,
      source.targetRepository,
    ),
    workItemId: first(
      option("work-item"),
      process.env.AGENTIC_CLOUD_WORK_ITEM,
      source.workItemId,
      source.taskId,
    ),
    scopeId: first(option("scope"), process.env.AGENTIC_CLOUD_SCOPE, source.scopeId),
    branch: first(option("branch"), process.env.AGENTIC_CLOUD_BRANCH, source.branch),
    canonicalBaseRevision: first(
      option("base-sha"),
      process.env.AGENTIC_CLOUD_BASE_SHA,
      source.canonicalBaseRevision,
      source.canonicalBaseSha,
    ),
    laneRevision: first(
      option("head-sha"),
      process.env.AGENTIC_CLOUD_HEAD_SHA,
      source.laneRevision,
      source.headSha,
    ),
    branchFenceSha: first(
      option("fence-sha"),
      process.env.AGENTIC_CLOUD_FENCE_SHA,
      source.branchFenceSha,
    ),
    pullRequestNumber: first(
      option("pull-request"),
      process.env.AGENTIC_CLOUD_PULL_REQUEST_NUMBER,
      source.pullRequestNumber,
    ),
    deviceId: first(option("device-id"), process.env.AGENTIC_DEVICE_ID, source.deviceId),
    sessionId: first(option("session"), process.env.AGENTIC_SESSION_ID, source.sessionId),
    ttlSeconds: first(
      option("ttl-seconds"),
      process.env.AGENTIC_CLOUD_TTL_SECONDS,
      source.ttlSeconds,
    ),
    recipientMode: first(
      option("handoff-mode"),
      process.env.AGENTIC_CLOUD_HANDOFF_MODE,
      source.recipientMode,
      source.handoffMode,
    ),
    claimId: first(option("claim-id"), process.env.AGENTIC_CLOUD_CLAIM_ID, source.claimId),
    expectedFenceRevision: first(
      option("expected-claim-digest"),
      process.env.AGENTIC_CLOUD_EXPECTED_CLAIM_DIGEST,
      source.expectedFenceRevision,
      source.expectedClaimDigest,
    ),
    expectedLedgerRevision: first(
      option("expected-ledger-revision"),
      process.env.AGENTIC_CLOUD_EXPECTED_LEDGER_REVISION,
      source.expectedLedgerRevision,
    ),
    expectedTransitionCounter: first(
      option("expected-transition-counter"),
      process.env.AGENTIC_CLOUD_EXPECTED_TRANSITION_COUNTER,
      source.expectedTransitionCounter,
    ),
    leaseEpoch: first(
      option("lease-epoch"),
      process.env.AGENTIC_CLOUD_LEASE_EPOCH,
      source.leaseEpoch,
    ),
    predecessorClaimId: first(
      option("predecessor-claim-id"),
      process.env.AGENTIC_CLOUD_PREDECESSOR_CLAIM_ID,
      source.predecessorClaimId,
    ),
    evidenceDigest: first(
      option("evidence-digest"),
      process.env.AGENTIC_CLOUD_EVIDENCE_DIGEST,
      source.evidenceDigest,
    ),
    focusedEvidenceDigest: first(
      option("focused-evidence-digest"),
      process.env.AGENTIC_CLOUD_FOCUSED_EVIDENCE_DIGEST,
      source.focusedEvidenceDigest,
    ),
    operatorDecisionDigest: first(
      option("operator-decision-digest"),
      process.env.AGENTIC_CLOUD_OPERATOR_DECISION_DIGEST,
      source.operatorDecisionDigest,
    ),
    integrationIntentDigest: first(
      option("integration-intent-digest"),
      process.env.AGENTIC_CLOUD_INTEGRATION_INTENT_DIGEST,
      source.integrationIntentDigest,
    ),
    integrationReceiptDigest: first(
      option("integration-receipt-digest"),
      process.env.AGENTIC_CLOUD_INTEGRATION_RECEIPT_DIGEST,
      source.integrationReceiptDigest,
    ),
    reason: first(
      option("release-reason"),
      process.env.AGENTIC_CLOUD_RELEASE_REASON,
      source.reason,
      source.releaseReason,
    ),
    nextActorId: first(
      option("next-actor-id"),
      process.env.AGENTIC_CLOUD_NEXT_ACTOR_ID,
      source.nextActorId,
    ),
    requiredState: first(
      option("required-state"),
      process.env.AGENTIC_CLOUD_REQUIRED_STATE,
      source.requiredState,
      source.requireStatus,
    ),
    reviewRequestId: first(
      option("review-request-id"),
      process.env.AGENTIC_CLOUD_REVIEW_REQUEST_ID,
      source.reviewRequestId,
    ),
    idempotencyKey: first(
      option("idempotency-key"),
      process.env.AGENTIC_CLOUD_IDEMPOTENCY_KEY,
      source.idempotencyKey,
      process.env.GITHUB_RUN_ID ? `workflow-run:${process.env.GITHUB_RUN_ID}:${action}` : undefined,
    ),
    actorId: first(process.env.GITHUB_ACTOR_ID, source.actorId),
    actorLogin: first(process.env.GITHUB_ACTOR, source.actorLogin),
  };
  const writeScopes = first(
    option("write-scopes-json"),
    process.env.AGENTIC_CLOUD_WRITE_SCOPES_JSON,
    source.declaredWriteScope,
    source.declaredWriteSet,
  );
  if (writeScopes !== undefined) {
    request.declaredWriteScope = Array.isArray(writeScopes)
      ? writeScopes
      : parseJsonArray(writeScopes, "write scopes");
  }
  removeUndefined(request);
  if (MUTATIONS.has(action) && !request.idempotencyKey) {
    throw new Error(`${action} requires --idempotency-key or GITHUB_RUN_ID.`);
  }
  return request;
}

function resolveAction(action) {
  if (action !== "dispatch") return action;
  if (process.env.GITHUB_ACTIONS !== "true") {
    throw new Error("dispatch is available only inside the trusted cloud workflow.");
  }
  const dispatched = String(process.env.AGENTIC_CLOUD_ACTION || "").trim();
  if (!DISPATCH_ACTIONS.has(dispatched)) {
    throw new Error("AGENTIC_CLOUD_ACTION is not an exposed cloud collaboration action.");
  }
  return dispatched;
}

function parseRequestJson() {
  const raw = first(option("request-json"), process.env.AGENTIC_CLOUD_REQUEST_JSON);
  if (!raw) return {};
  const value = JSON.parse(raw);
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Cloud request JSON must be an object.");
  }
  return value;
}

function parseJsonArray(raw, label) {
  const value = JSON.parse(String(raw));
  if (!Array.isArray(value)) throw new Error(`${label} must be a JSON array.`);
  return value;
}

function option(name) {
  const prefix = `--${name}=`;
  const inline = argumentsList.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argumentsList.indexOf(`--${name}`);
  if (index >= 0) return argumentsList[index + 1];
  return undefined;
}

function emit(result) {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function removeUndefined(value) {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function requiredSha(value, label) {
  const sha = requiredText(value, label);
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error(`${label} must be a lowercase 40-character SHA.`);
  return sha;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}

function publicError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 500);
}

function usage() {
  throw new Error(
    "Usage: cloud-collaboration.mjs <claim|bind|heartbeat|review-ready|delivery-authorize|handoff|release|status|verify|verify-event|dispatch> [--request-json=<json>] [--json]",
  );
}
