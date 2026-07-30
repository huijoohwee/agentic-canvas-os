#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
  CLOUD_RESULT_SCHEMA,
  createGitHubCloudCollaborationAdapter,
} from "./github-cloud-collaboration-adapter.mjs";

const MUTATIONS = new Set([
  "claim",
  "bind",
  "heartbeat",
  "review-ready",
  "handoff",
  "release",
]);
const DISPATCH_ACTIONS = new Set(["status", "verify", "claim", "heartbeat", "review-ready", "handoff", "release"]);
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
    return adapter.execute("verify", {
      targetRepository: requiredText(event.repository?.full_name, "event repository"),
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
    return adapter.execute("status", {
      targetRepository: requiredText(event.repository?.full_name, "event repository"),
      actorId: process.env.GITHUB_ACTOR_ID,
      actorLogin: process.env.GITHUB_ACTOR,
    });
  }
  throw new Error("verify-event supports pull_request and protected default-branch push events only.");
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
    "Usage: cloud-collaboration.mjs <claim|bind|heartbeat|review-ready|handoff|release|status|verify|verify-event|dispatch> [--request-json=<json>] [--json]",
  );
}
