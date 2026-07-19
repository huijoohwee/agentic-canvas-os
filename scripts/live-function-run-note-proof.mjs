import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { mintReviewerToken } from "../agent-api/src/auth.js";
import { createKnowgrphMcpClient } from "../src/knowgrph-mcp-client.js";

const APPROVAL = "I_APPROVE_ONE_BOUNDED_DEV_PROVIDER_RUN";
const FUNCTION_NAME = "update_agent_run_note";

function required(env, name) {
  const value = typeof env[name] === "string" ? env[name].trim() : "";
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function devUrl(value, name) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".workers.dev") || !url.hostname.includes("-dev.")) {
    throw new Error(`${name} must be an HTTPS Dev workers.dev URL.`);
  }
  return url;
}

async function jsonRequest(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${new URL(url).pathname} returned invalid JSON.`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${new URL(url).pathname} returned ${response.status}: ${body.error || body.reasonCode || "request failed"}.`);
  }
  return { status: response.status, body };
}

function mcpTransport(fetchImpl) {
  return ({ url, method, headers, body, signal }) => fetchImpl(url, {
    method, headers, body: JSON.stringify(body), signal,
  });
}

export function reviewStateFromPause(paused) {
  const interruption = paused?.interruptions?.[0];
  const action = interruption?.metadata?.action;
  if (paused?.status !== "paused" || paused?.stage !== "review" || !paused.resumeToken
    || !interruption?.id || !action || action.name !== FUNCTION_NAME) {
    throw new Error("Function run did not return the expected run-note review interruption.");
  }
  return Object.freeze({
    reviewId: interruption.id,
    runId: paused.runId,
    conversationId: paused.runId,
    actionDigest: createHash("sha256").update(JSON.stringify({
      actionId: action.actionId,
      kind: action.kind,
      name: action.name,
      riskClass: action.riskClass,
      payload: action.payload,
    })).digest("hex"),
  });
}

function proofReceipt(result) {
  const records = result?.evidence?.executionReceipts;
  if (!Array.isArray(records) || records.length !== 1 || records[0].toolName !== FUNCTION_NAME) {
    throw new Error("Completed function run did not expose exactly one execution receipt.");
  }
  const receipt = records[0].receipt;
  if (receipt?.schema !== "function-execution-receipt/v1" || receipt.phase !== "completed"
    || receipt.upstreamReceipt?.schema !== "knowgrph-tool-execution-receipt/v1"
    || !["applied", "replayed"].includes(receipt.upstreamReceipt.status)) {
    throw new Error("Completed function run did not expose matching native Knowgrph receipt evidence.");
  }
  return receipt;
}

export async function runLiveFunctionRunNoteProof({ env = process.env, fetchImpl = fetch } = {}) {
  if (required(env, "AGENTIC_LIVE_PROVIDER_APPROVAL") !== APPROVAL) {
    throw new Error(`AGENTIC_LIVE_PROVIDER_APPROVAL must equal ${APPROVAL}.`);
  }
  const agenticBase = devUrl(required(env, "AGENTIC_DEV_URL"), "AGENTIC_DEV_URL");
  const mcpEndpoint = devUrl(required(env, "KNOWGRPH_DEV_MCP_ENDPOINT"), "KNOWGRPH_DEV_MCP_ENDPOINT");
  const mcpBearer = required(env, "KNOWGRPH_AGENT_RUNTIME_BEARER_TOKEN");
  const reviewSecret = required(env, "AGENT_REVIEW_JWT_SECRET");
  const suffix = typeof env.AGENTIC_LIVE_PROOF_SUFFIX === "string" && env.AGENTIC_LIVE_PROOF_SUFFIX.trim()
    ? env.AGENTIC_LIVE_PROOF_SUFFIX.trim()
    : Date.now().toString(36);
  const targetRunId = `dev-provider-proof-manifest-${suffix}`;
  const functionRunId = `dev-provider-proof-function-${suffix}`;
  const note = `Reviewed Dev provider proof ${suffix}.`;
  const recoverContinuation = env.AGENTIC_LIVE_PROOF_RECOVER === "1";

  const ready = (await jsonRequest(fetchImpl, new URL("/api/ready", agenticBase))).body;
  if (!ready.functionCalling?.configured || !ready.guardrailsHumanReview?.configured
    || ready.functionCalling.manager?.persistence !== "durable-object"
    || ready.functionCalling.gateway?.executionReceipts?.persistence !== "durable-object") {
    throw new Error("Dev Agentic Worker is not ready for durable reviewed function calling.");
  }

  const mcpClient = createKnowgrphMcpClient({
    endpoint: mcpEndpoint.toString(),
    authToken: mcpBearer,
    fetchImpl: mcpTransport(fetchImpl),
  });
  if (!recoverContinuation) {
    const seeded = await mcpClient.runVideoRemix({
      runId: targetRunId,
      referenceUrl: "https://example.com/dev-provider-proof.mp4",
      brief: "Create one deterministic dry-run manifest for reviewed Dev receipt proof.",
      mode: "dry-run",
      budgetUsd: 0.01,
      shotCount: 1,
    });
    if (seeded?.runId !== targetRunId || seeded?.persistence?.persisted !== true) {
      throw new Error("Knowgrph Dev Worker did not persist the proof manifest.");
    }
  }

  const session = (await jsonRequest(fetchImpl, new URL("/api/auth/session", agenticBase), {
    method: "POST", body: {},
  })).body;
  const authorization = { authorization: `Bearer ${session.token}` };
  const paused = (await jsonRequest(fetchImpl, new URL(
    recoverContinuation ? "/api/function-call/recover" : "/api/function-call",
    agenticBase,
  ), {
    method: "POST",
    headers: authorization,
    body: recoverContinuation
      ? { runId: functionRunId }
      : {
          runId: functionRunId,
          prompt: `Set run ${targetRunId} operator note to exactly: ${note}`,
          toolChoice: { mode: "forced", name: FUNCTION_NAME },
          parallelToolCalls: false,
        },
  })).body;
  const reviewState = reviewStateFromPause(paused);
  const reviewerToken = mintReviewerToken({
    secret: reviewSecret,
    subject: "dev-proof-operator",
    ...reviewState,
  });
  const completed = (await jsonRequest(fetchImpl, new URL("/api/function-call/resume", agenticBase), {
    method: "POST",
    headers: authorization,
    body: {
      runId: functionRunId,
      resumeToken: paused.resumeToken,
      decision: "approve",
      reviewerToken,
      reason: "Explicitly authorized bounded Dev provider proof.",
    },
  })).body;
  if (completed.status !== "completed" || completed.evidence?.modelTurns !== 2
    || completed.evidence?.toolCalls !== 1) {
    throw new Error("Reviewed function run did not complete in exactly two model turns and one tool call.");
  }
  const receipt = proofReceipt(completed);
  const readBackUrl = new URL(`./runs/${encodeURIComponent(targetRunId)}`, mcpEndpoint.toString().replace(/\/?$/, "/"));
  const readBack = (await jsonRequest(fetchImpl, readBackUrl, {
    headers: { authorization: `Bearer ${mcpBearer}` },
  })).body;
  if (readBack.manifest?.operatorNote?.text !== note || readBack.manifest?.operatorNote?.revision !== 1) {
    throw new Error("Persisted Knowgrph operator note does not match the reviewed function result.");
  }

  return Object.freeze({
    schema: "agentic-live-function-run-note-proof/v1",
    ok: true,
    environment: "dev",
    logicalProviderRuns: 1,
    providerRequests: completed.evidence.modelTurns,
    functionCalls: completed.evidence.toolCalls,
    recoveredContinuation: recoverContinuation,
    review: Object.freeze({ required: true, decision: "approve", signedEvidence: true }),
    functionRunId,
    targetRunId,
    providerResponseIds: completed.evidence.providerResponseIds,
    usage: completed.costLog,
    applicationReceipt: Object.freeze({
      schema: receipt.schema,
      receiptId: receipt.receiptId,
      idempotencyKey: receipt.idempotencyKey,
      requestDigest: receipt.requestDigest,
      phase: receipt.phase,
      replayed: receipt.replayed,
    }),
    nativeReceipt: receipt.upstreamReceipt,
    persistedNote: Object.freeze({ revision: 1, text: note }),
    productionDeploymentPerformed: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const proof = await runLiveFunctionRunNoteProof();
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
}

export const LIVE_FUNCTION_RUN_NOTE_APPROVAL = APPROVAL;
