import assert from "node:assert/strict";
import test from "node:test";

import { buildDevFunctionGatewayDeployArgs } from "../scripts/deploy-dev-function-gateway.mjs";
import {
  LIVE_FUNCTION_RUN_NOTE_APPROVAL,
  reviewStateFromPause,
  runLiveFunctionRunNoteProof,
} from "../scripts/live-function-run-note-proof.mjs";

const DEPLOY_ENV = Object.freeze({
  OPENAI_FUNCTION_CALLING_MODEL: "gpt-test",
  OPENAI_FUNCTION_CALLING_INPUT_USD_PER_MILLION: "1",
  OPENAI_FUNCTION_CALLING_CACHED_INPUT_USD_PER_MILLION: "0.1",
  OPENAI_FUNCTION_CALLING_CACHE_WRITE_USD_PER_MILLION: "1.25",
  OPENAI_FUNCTION_CALLING_OUTPUT_USD_PER_MILLION: "2",
  OPENAI_API_KEY: "must-not-enter-command-line",
});

test("Dev deploy args are complete, environment-scoped, and secret-free", () => {
  const args = buildDevFunctionGatewayDeployArgs(DEPLOY_ENV);
  assert.deepEqual(args.slice(0, 3), ["deploy", "--env", "dev"]);
  assert.equal(args.includes("OPENAI_FUNCTION_CALLING_MODEL:gpt-test"), true);
  assert.equal(args.join(" ").includes(DEPLOY_ENV.OPENAI_API_KEY), false);
  assert.throws(
    () => buildDevFunctionGatewayDeployArgs({ ...DEPLOY_ENV, OPENAI_FUNCTION_CALLING_MODEL: "" }),
    /OPENAI_FUNCTION_CALLING_MODEL is required/,
  );
});

test("review state is derived from the exact public interruption", () => {
  const state = reviewStateFromPause({
    status: "paused",
    stage: "review",
    runId: "run-1",
    resumeToken: "resume-1",
    interruptions: [{
      id: "review-1",
      metadata: {
        action: {
          actionId: "call-1",
          kind: "function-tool",
          name: "update_agent_run_note",
          riskClass: "mutation",
          payload: { run_id: "manifest-1", note: "Reviewed." },
        },
      },
    }],
  });
  assert.equal(state.reviewId, "review-1");
  assert.equal(state.conversationId, "run-1");
  assert.match(state.actionDigest, /^[a-f0-9]{64}$/);
});

test("live proof composes seed, pause, signed resume, receipt, and read-back without exposing secrets", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method: init.method || "GET", body });
    if (url.pathname === "/api/ready") {
      return Response.json({
        functionCalling: {
          configured: true,
          manager: { persistence: "durable-object" },
          gateway: { executionReceipts: { persistence: "durable-object" } },
        },
        guardrailsHumanReview: { configured: true },
      });
    }
    if (url.pathname === "/knowgrph/control-plane/mcp" && body?.method === "initialize") {
      return new Response("", { status: 200, headers: { "mcp-session-id": "session-1" } });
    }
    if (url.pathname === "/knowgrph/control-plane/mcp" && body?.method === "tools/call") {
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          structuredContent: {
            runId: body.params.arguments.runId,
            persistence: { persisted: true },
          },
        },
      });
    }
    if (url.pathname === "/api/auth/session") return Response.json({ token: "session-token" });
    if (url.pathname === "/api/function-call" || url.pathname === "/api/function-call/recover") {
      return Response.json({
        status: "paused",
        stage: "review",
        runId: body.runId,
        resumeToken: "resume-token",
        interruptions: [{
          id: "review-id",
          metadata: {
            action: {
              actionId: "call-id",
              kind: "function-tool",
              name: "update_agent_run_note",
              riskClass: "mutation",
              payload: { run_id: "dev-provider-proof-manifest-test", note: "Reviewed Dev provider proof test." },
            },
          },
        }],
      }, { status: 202 });
    }
    if (url.pathname === "/api/function-call/resume") {
      return Response.json({
        status: "completed",
        evidence: {
          modelTurns: 2,
          toolCalls: 1,
          providerResponseIds: ["resp-1", "resp-2"],
          executionReceipts: [{
            toolName: "update_agent_run_note",
            receipt: {
              schema: "function-execution-receipt/v1",
              receiptId: "receipt-1",
              idempotencyKey: "a".repeat(64),
              requestDigest: "b".repeat(64),
              phase: "completed",
              replayed: false,
              upstreamReceipt: {
                schema: "knowgrph-tool-execution-receipt/v1",
                idempotencyKey: "a".repeat(64),
                requestDigest: "c".repeat(64),
                status: "applied",
              },
            },
          }],
        },
        costLog: {
          model: "gpt-test",
          prompt_tokens: 100,
          completion_tokens: 20,
          cache_hits: 0,
          cached_tokens: 0,
          cache_write_tokens: 0,
          provider_cache_status: "miss",
          estimated_cost_usd: 0.00014,
        },
      });
    }
    if (url.pathname.endsWith("/runs/dev-provider-proof-manifest-test")) {
      return Response.json({
        manifest: { operatorNote: { text: "Reviewed Dev provider proof test.", revision: 1 } },
      });
    }
    return Response.json({ error: "unexpected" }, { status: 500 });
  };
  const proof = await runLiveFunctionRunNoteProof({
    fetchImpl,
    env: {
      AGENTIC_LIVE_PROVIDER_APPROVAL: LIVE_FUNCTION_RUN_NOTE_APPROVAL,
      AGENTIC_DEV_URL: "https://agentic-canvas-os-dev.example.workers.dev",
      KNOWGRPH_DEV_MCP_ENDPOINT: "https://knowgrph-mcp-dev.example.workers.dev/knowgrph/control-plane/mcp",
      KNOWGRPH_AGENT_RUNTIME_BEARER_TOKEN: "mcp-secret",
      AGENT_REVIEW_JWT_SECRET: "review-secret",
      AGENTIC_LIVE_PROOF_SUFFIX: "test",
    },
  });
  assert.equal(proof.logicalProviderRuns, 1);
  assert.equal(proof.providerRequests, 2);
  assert.equal(proof.nativeReceipt.status, "applied");
  assert.equal(proof.persistedNote.revision, 1);
  assert.equal(JSON.stringify(proof).includes("mcp-secret"), false);
  assert.equal(JSON.stringify(proof).includes("review-secret"), false);
  assert.deepEqual(calls.map((call) => call.path), [
    "/api/ready",
    "/knowgrph/control-plane/mcp",
    "/knowgrph/control-plane/mcp",
    "/api/auth/session",
    "/api/function-call",
    "/api/function-call/resume",
    "/knowgrph/control-plane/mcp/runs/dev-provider-proof-manifest-test",
  ]);

  calls.length = 0;
  const recoveredProof = await runLiveFunctionRunNoteProof({
    fetchImpl,
    env: {
      AGENTIC_LIVE_PROVIDER_APPROVAL: LIVE_FUNCTION_RUN_NOTE_APPROVAL,
      AGENTIC_DEV_URL: "https://agentic-canvas-os-dev.example.workers.dev",
      KNOWGRPH_DEV_MCP_ENDPOINT: "https://knowgrph-mcp-dev.example.workers.dev/knowgrph/control-plane/mcp",
      KNOWGRPH_AGENT_RUNTIME_BEARER_TOKEN: "mcp-secret",
      AGENT_REVIEW_JWT_SECRET: "review-secret",
      AGENTIC_LIVE_PROOF_SUFFIX: "test",
      AGENTIC_LIVE_PROOF_RECOVER: "1",
    },
  });
  assert.equal(recoveredProof.recoveredContinuation, true);
  assert.deepEqual(calls.map((call) => call.path), [
    "/api/ready",
    "/api/auth/session",
    "/api/function-call/recover",
    "/api/function-call/resume",
    "/knowgrph/control-plane/mcp/runs/dev-provider-proof-manifest-test",
  ]);
});
