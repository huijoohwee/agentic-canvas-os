// Tests for the Cloudflare Worker runtime adapter. ZERO network: the knowgrph
// MCP transport and static assets binding are injected.

import test from "node:test";
import assert from "node:assert/strict";

import { mintSessionToken, verifySessionToken } from "../agent-api/src/auth.js";
import { createAgentToolkitHandlers } from "../agent-api/src/agent-toolkit-handler.js";
import { createWorkerFetch, handleCloudflareRequest } from "../worker/index.js";

const ENV = Object.freeze({
  AGENT_API_JWT_SECRET: "server-side-secret",
  KNOWGRPH_MCP_ENDPOINT: "https://airvio.co/knowgrph/control-plane/mcp",
  AGENT_MODEL_PROVIDER: "workspace-provider",
  AGENT_MODEL_PROVIDER_REVISION: "workspace-provider-v1",
  AGENT_MODEL_ADAPTER: "workspace-adapter",
  AGENT_MODEL_ENDPOINT: "https://models.example/v1",
  AGENT_MODEL_ID: "workspace-model",
  AGENT_MODEL_API_KEY_ENV: "WORKSPACE_MODEL_KEY",
  AGENT_MODEL_TRANSPORT: "stream-channel",
  AGENT_MODEL_TRANSPORT_DELIVERY: "incremental",
  AGENT_MODEL_TRANSPORT_CONNECTION: "reusable",
  AGENT_MODEL_FEATURES: "tool-calling,structured-output",
  WORKSPACE_MODEL_KEY: "server-side-model-key",
});

const DURABLE_ENV = Object.freeze({
  ...ENV,
  AGENT_REVIEW_JWT_SECRET: "review-signing-secret",
  AGENT_STATE: Object.freeze({
    idFromName: (name) => name,
    get: () => Object.freeze({ fetch: async () => new Response("{}", { status: 200 }) }),
  }),
});

const TOOLKIT_PROFILE = Object.freeze({
  evaluator: Object.freeze({ id: "worker-evaluator", revision: "eval-v1", digest: "3".repeat(64) }),
  dataset: Object.freeze({ id: "worker-dataset", revision: "dataset-v1", digest: "4".repeat(64) }),
  metric: Object.freeze({
    id: "worker-quality",
    revision: "metric-v1",
    digest: "5".repeat(64),
    direction: "maximize",
  }),
});

function toolkitStartRequest(runId, cohortId = "worker-toolkit-cohort") {
  return {
    runId,
    cohortId,
    target: { kind: "team", id: "worker-team", revision: "team-v1", digest: "1".repeat(64) },
    candidate: { id: "worker-policy", revision: "policy-v1", digest: "a".repeat(64) },
    adapter: { id: "worker-adapter", revision: "adapter-v1", digest: "2".repeat(64) },
    operation: "worker-observe",
    profile: TOOLKIT_PROFILE,
  };
}

function request(path, { method = "GET", headers = {}, body } = {}) {
  return new Request(`https://agentic-canvas-os.example${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function json(res) {
  return JSON.parse(await res.text());
}

test("Worker transport uses the Dev service binding only for the configured MCP origin", async () => {
  const serviceRequests = [];
  const publicRequests = [];
  const transport = createWorkerFetch({
    KNOWGRPH_MCP_ENDPOINT: "https://knowgrph-mcp-dev.example.workers.dev/knowgrph/control-plane/mcp",
    KNOWGRPH_MCP_SERVICE: {
      fetch: async (request) => {
        serviceRequests.push(request);
        return Response.json({ owner: "service-binding" });
      },
    },
  }, async (url, init) => {
    publicRequests.push({ url, init });
    return Response.json({ owner: "public-fetch" });
  });
  const mcpResponse = await transport({
    url: "https://knowgrph-mcp-dev.example.workers.dev/knowgrph/control-plane/mcp",
    method: "POST",
    headers: { authorization: "Bearer secret" },
    body: { jsonrpc: "2.0" },
  });
  const providerResponse = await transport({
    url: "https://api.openai.com/v1/responses",
    method: "POST",
    headers: { authorization: "Bearer provider-secret" },
    body: { model: "test" },
  });
  assert.equal((await mcpResponse.json()).owner, "service-binding");
  assert.equal((await providerResponse.json()).owner, "public-fetch");
  assert.equal(serviceRequests.length, 1);
  assert.equal(new URL(serviceRequests[0].url).pathname, "/knowgrph/control-plane/mcp");
  assert.equal(publicRequests.length, 1);
  assert.equal(publicRequests[0].url, "https://api.openai.com/v1/responses");
});

async function withMockedFetch(mockFetch, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("GET /api/ready reports provider-neutral runtime readiness without leaking the key", async () => {
  const res = await handleCloudflareRequest(request("/api/ready"), ENV);
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.configured, true);
  assert.equal(body.modelProviders.configured, true);
  assert.equal(body.modelProviders.contractReady, true);
  assert.deepEqual(body.modelProviders.selectionPrecedence, [
    "agent",
    "run-default",
    "process-default",
    "provider-default",
  ]);
  assert.equal(body.modelProviders.environment.providerId, "workspace-provider");
  assert.equal(body.modelProviders.environment.modelId, "workspace-model");
  assert.equal(body.modelProviders.environment.transportId, "stream-channel");
  assert.equal(body.modelProviders.environment.apiKeyPresent, true);
  assert.equal(body.modelProviders.executionOwner, "running-agents-adapter");
  assert.equal(body.modelProviders.providerExecutionStatus, "unverified");
  assert.equal(body.agentDefinitions.contractReady, true);
  assert.equal(body.agentDefinitions.configured, false);
  assert.equal(body.agentDefinitions.definitionOwner, "application-agent-registry");
  assert.deepEqual(body.agentDefinitions.requiredCore, ["source", "model", "instructions"]);
  assert.equal(body.agentDefinitions.sourcePolicy, "application-verified-uri-and-sha256");
  assert.deepEqual(body.agentDefinitions.optionalBehavior, [
    "tools",
    "guardrails",
    "mcp-servers",
    "handoffs",
    "structured-output",
  ]);
  assert.equal(body.agentDefinitions.capabilityPolicy, "reference-only-with-application-authorization");
  assert.equal(body.agentDefinitions.executionOwner, "running-agents-adapter");
  assert.equal(body.agentDefinitions.providerExecutionStatus, "unverified");
  assert.equal(body.guardrailsHumanReview.contractReady, true);
  assert.equal(body.guardrailsHumanReview.configured, false);
  assert.equal(body.guardrailsHumanReview.reviewStoreConfigured, true);
  assert.deepEqual(body.guardrailsHumanReview.automaticStages, [
    "input",
    "output",
    "tool-input",
    "tool-output",
  ]);
  assert.deepEqual(body.guardrailsHumanReview.reviewDecisions, ["approve", "reject", "edit"]);
  assert.equal(body.guardrailsHumanReview.interruptionOwner, "running-agents-same-turn-state");
  assert.equal(body.guardrailsHumanReview.reviewStatePolicy, "atomic-single-consume-bounded-expiry");
  assert.equal(body.guardrailsHumanReview.reviewerEvidencePolicy, "purpose-scoped-signed-token");
  assert.equal(body.guardrailsHumanReview.providerExecutionStatus, "unverified");
  assert.equal(body.agentOrchestration.contractReady, true);
  assert.equal(body.agentOrchestration.configured, false);
  assert.equal(body.agentOrchestration.topologyOwner, "application-orchestration-registry");
  assert.equal(body.agentOrchestration.definitionOwner, "agent-definitions");
  assert.equal(body.agentOrchestration.executionOwner, "running-agents-adapter");
  assert.equal(body.agentOrchestration.conversationOwnership, "branch-explicit");
  assert.equal(body.agentOrchestration.finalAnswerOwnership, "branch-explicit");
  assert.deepEqual(body.agentOrchestration.modes, ["delegate", "handoff"]);
  assert.equal(body.agentOrchestration.providerExecutionStatus, "unverified");
  assert.equal(body.agentOrchestration.agentResolverConfigured, true);
  assert.equal(body.agentOrchestration.agentRunnerConfigured, true);
  assert.equal(body.agentRuntimeComposition.contractReady, true);
  assert.equal(body.agentRuntimeComposition.configured, false);
  assert.equal(body.agentRuntimeComposition.sourceOwner, "agent-definitions");
  assert.equal(body.agentRuntimeComposition.selectionOwner, "models-and-providers");
  assert.equal(body.agentRuntimeComposition.lifecycleOwner, "running-agents");
  assert.deepEqual(body.agentRuntimeComposition.orchestrationInterfaces, ["resolve-agent", "run-agent"]);
  assert.equal(body.agentRuntimeComposition.outputValidationOwner, "agent-definitions");
  assert.equal(body.agentRuntimeComposition.guardrailRuntimeConfigured, true);
  assert.equal(body.agentRuntimeComposition.executionAdapterConfigured, false);
  assert.equal(body.agentRuntimeComposition.providerExecutionStatus, "unverified");
  assert.equal(body.agentSwarm.contractReady, true);
  assert.equal(body.agentSwarm.configured, false);
  assert.equal(body.agentSwarm.coordinationOwner, "agent-swarm-durable-ledger");
  assert.equal(body.agentSwarm.taskModel, "runtime-generated-objectives-and-dependencies");
  assert.equal(body.agentSwarm.workerModel, "stateless-ephemeral-claims");
  assert.equal(body.agentSwarm.definitionResolutionOwner, "application-injected-agent-resolver");
  assert.equal(body.agentSwarm.synthesisOwner, "base-agent");
  assert.equal(body.agentSwarm.receiptVerificationOwner, "application-injected-durable-receipt-verifier");
  assert.equal(body.agentSwarm.runOwnership, "authenticated-session-principal");
  assert.equal(body.agentSwarm.runDeadlinePolicy, "fixed-from-admission-with-full-lease-window");
  assert.equal(body.agentSwarm.sessionLifetimePolicy, "must-cover-fixed-run-deadline");
  assert.equal(body.agentSwarm.externalRuntimeDependency, false);
  assert.equal(body.agentSwarm.stateStore.persistence, "isolate-memory");
  assert.equal(body.agentSwarm.stateStore.horizontalRecovery, false);
  assert.equal(body.agentSwarm.providerExecutionStatus, "unverified");
  assert.equal(body.agentToolkit.contractReady, true);
  assert.equal(body.agentToolkit.configured, true);
  assert.equal(body.agentToolkit.instrumentation, "server-timed-metadata-only");
  assert.equal(body.agentToolkit.learning, "review-pending-proposal-only");
  assert.equal(body.agentToolkit.defaultEgress, false);
  assert.equal(body.agentToolkit.externalRuntimeDependency, false);
  assert.equal(body.agentToolkit.measuredImprovementStatus, "unverified");
  assert.equal(body.agentToolkit.stateStore.persistence, "isolate-memory");
  assert.equal(body.agentToolkit.stateStore.horizontalRecovery, false);
  assert.equal(body.progressiveAgents.contractReady, true);
  assert.equal(body.progressiveAgents.configured, false);
  assert.equal(body.progressiveAgents.progressionPolicy, "single-agent-then-tools-then-specialists");
  assert.deepEqual(body.progressiveAgents.growthStages, [
    "single-agent",
    "tool-enabled-agent",
    "specialist-workflow",
  ]);
  assert.equal(body.progressiveAgents.definitionOwner, "agent-definitions");
  assert.equal(body.progressiveAgents.toolExecutionOwner, "function-calling-through-application-adapter");
  assert.equal(body.progressiveAgents.specialistOwner, "agent-orchestration");
  assert.equal(body.progressiveAgents.externalSdkDependency, false);
  assert.equal(body.progressiveAgents.providerExecutionStatus, "unverified");
  assert.equal(body.cacheContext.stablePrefixOrder, "static-first-dynamic-last");
  assert.equal(body.cacheContext.providerCacheStatus, "unverified");
  assert.equal(body.reasoningContinuity.invariantPolicy, "goals-assumptions-priorities");
  assert.equal(body.reasoningContinuity.driftMode, "current_turn");
  assert.equal(body.reasoningContinuity.providerEffectiveContext, "unverified");
  assert.equal(body.functionCalling.contractReady, true);
  assert.equal(body.functionCalling.configured, false);
  assert.equal(body.functionCalling.executionOwner, "application-tool-gateway");
  assert.equal(body.functionCalling.schemaMode, "explicit-strict");
  assert.deepEqual(body.functionCalling.selectionModes, ["auto", "required", "none", "forced", "allowed"]);
  assert.equal(body.functionCalling.parallelPolicy, "capability-and-request-bounded");
  assert.equal(body.functionCalling.providerExecutionStatus, "unverified");
  assert.equal(body.functionCalling.adapter.configured, false);
  assert.equal(body.functionCalling.gateway.configured, false);
  assert.equal(body.functionCalling.reviewContinuation, "manager-owned-durable-same-run");
  assert.equal(body.functionCalling.reviewStateExposure, "resume-token-only");
  assert.equal(body.functionCalling.reviewedExecutionPolicy, "durable-receipt-before-side-effect");
  assert.equal(body.functionCalling.idempotencyPolicy, "stable-key-with-upstream-echo-for-mutations");
  assert.equal(body.functionCalling.gateway.executionReceipts.persistence, "isolate-memory");
  assert.equal(body.programmaticToolCalling.contractReady, true);
  assert.equal(body.programmaticToolCalling.configured, false);
  assert.equal(body.programmaticToolCalling.executionOwner, "downstream-hosted-sandbox");
  assert.equal(body.programmaticToolCalling.localJavaScriptExecution, "forbidden");
  assert.equal(body.programmaticToolCalling.providerContextIsolation, "unverified");
  assert.deepEqual(body.programmaticToolCalling.continuationModes, ["stored", "stateless-replay"]);
  assert.equal(body.programmaticToolCalling.callerContract, "function-call-output-preserves-caller");
  assert.equal(body.runningAgents.contractReady, true);
  assert.equal(body.runningAgents.configured, false);
  assert.equal(body.runningAgents.loopOwner, "application-turn-controller");
  assert.equal(body.runningAgents.streamingOwner, "same-loop-event-channel");
  assert.equal(body.runningAgents.pauseSemantics, "resume-same-turn");
  assert.equal(body.runningAgents.recoveryPolicy, "atomic-claim-resume-commit");
  assert.equal(body.runningAgents.pausedTurnStoreConfigured, false);
  assert.equal(body.runningAgents.continuationPolicy, "one-strategy-per-conversation");
  assert.deepEqual(body.runningAgents.continuationStrategies, [
    "application-history",
    "session",
    "conversation",
    "previous-response",
  ]);
  assert.equal(body.runningAgents.providerExecutionStatus, "unverified");
  assert.equal(body.sandboxAgents.contractReady, true);
  assert.equal(body.sandboxAgents.configured, false);
  assert.equal(body.sandboxAgents.controlPlaneOwner, "agentic-canvas-os");
  assert.equal(body.sandboxAgents.executionOwner, "injected-container-provider");
  assert.deepEqual(body.sandboxAgents.stateSurfaces, [
    "active-session",
    "resume-checkpoint",
    "workspace-snapshot",
  ]);
  assert.deepEqual(body.sandboxAgents.supportedCapabilities, [
    "files",
    "commands",
    "packages",
    "ports",
    "snapshots",
    "resume",
  ]);
  assert.equal(body.sandboxAgents.containerExecutionStatus, "unverified");
  assert.equal(body.sandboxAgents.independentContainmentProof, "unverified");
  assert.equal(body.sandboxAgents.containmentVerifierConfigured, false);
  assert.equal(body.sandboxAgents.liveContainerReady, false);
  assert.equal(body.toolSearch.contractReady, true);
  assert.equal(body.toolSearch.configured, false);
  assert.equal(body.toolSearch.catalogScope, "active-session-grants");
  assert.equal(body.toolSearch.initialExposure, "direct-definitions-and-deferred-metadata");
  assert.equal(body.toolSearch.loadedDefinitionPlacement, "append-only-search-output");
  assert.equal(body.toolSearch.programSearchPolicy, "top-level-before-hosted-program");
  assert.equal(body.toolSearch.providerContextReduction, "unverified");
  assert.equal(JSON.stringify(body).includes("server-side-model-key"), false);
});

test("GET /api/ready exposes durable review and paused-turn recovery bindings", async () => {
  const res = await handleCloudflareRequest(request("/api/ready"), DURABLE_ENV);
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.guardrailsHumanReview.configured, true);
  assert.equal(body.guardrailsHumanReview.reviewerAuthenticatorConfigured, true);
  assert.equal(body.guardrailsHumanReview.persistence, "durable-object");
  assert.equal(body.guardrailsHumanReview.atomicConsume, true);
  assert.equal(body.runningAgents.pausedTurnStoreConfigured, true);
  assert.equal(body.runningAgents.persistence, "durable-object");
  assert.equal(body.runningAgents.atomicClaims, true);
  assert.equal(body.runningAgents.recovery, "cross-isolate");
  assert.equal(body.functionCalling.manager.persistence, "durable-object");
  assert.equal(body.functionCalling.manager.atomicClaims, true);
  assert.equal(body.functionCalling.manager.recovery, "cross-isolate");
  assert.equal(body.functionCalling.gateway.executionReceipts.persistence, "durable-object");
  assert.equal(body.functionCalling.gateway.executionReceipts.atomicClaims, true);
  assert.equal(body.functionCalling.gateway.executionReceipts.recovery, "cross-isolate");
  assert.equal(body.agentSwarm.stateStore.persistence, "durable-object");
  assert.equal(body.agentSwarm.stateStore.atomicClaims, true);
  assert.equal(body.agentSwarm.stateStore.horizontalRecovery, true);
  assert.equal(body.agentSwarm.stateStore.owner, "agent-swarm");
  assert.equal(body.agentToolkit.stateStore.persistence, "durable-object");
  assert.equal(body.agentToolkit.stateStore.atomicClaims, true);
  assert.equal(body.agentToolkit.stateStore.horizontalRecovery, true);
  assert.equal(body.agentToolkit.stateStore.owner, "agent-toolkit");
});

test("POST /api/auth/session mints a session token", async () => {
  const res = await handleCloudflareRequest(request("/api/auth/session", { method: "POST", body: {} }), ENV);
  assert.equal(res.status, 200);
  assert.equal(typeof (await json(res)).token, "string");
});

test("POST /api/auth/session rejects caller identity and guessable room scope", async () => {
  const rejected = await handleCloudflareRequest(request("/api/auth/session", {
    method: "POST",
    body: { subject: "spoofed-admin", roomIds: ["victim-room"] },
  }), ENV);
  assert.equal(rejected.status, 400);

  const roomId = "a".repeat(32);
  const accepted = await handleCloudflareRequest(request("/api/auth/session", {
    method: "POST",
    body: { subject: "spoofed-admin", roomIds: [roomId] },
  }), ENV);
  assert.equal(accepted.status, 200);
  const verdict = verifySessionToken((await json(accepted)).token, ENV.AGENT_API_JWT_SECRET);
  assert.equal(verdict.valid, true);
  assert.notEqual(verdict.claims.sub, "spoofed-admin");
  assert.deepEqual(verdict.claims.roomIds, [roomId]);
});

test("POST /api/run without auth is 401 before any control-plane forward", async () => {
  const res = await handleCloudflareRequest(
    request("/api/run", { method: "POST", body: { referenceUrl: "https://x", brief: "b", budgetUsd: 1 } }),
    ENV,
  );
  assert.equal(res.status, 401);
});

test("Agent Toolkit Worker routes require authentication and POST", async () => {
  const unauthorized = await handleCloudflareRequest(request("/api/agent-toolkit/start", {
    method: "POST",
    body: {},
  }), ENV);
  assert.equal(unauthorized.status, 401);
  const wrongMethod = await handleCloudflareRequest(request("/api/agent-toolkit/status"), ENV);
  assert.equal(wrongMethod.status, 405);
});

test("Agent Toolkit handlers preserve outcome semantics and mark HTTP telemetry unverified", async () => {
  const secret = "toolkit-handler-secret";
  const token = mintSessionToken({ secret, subject: "toolkit-handler-owner" });
  let result = { status: "blocked", reasonCode: "run_not_found" };
  let observedContext;
  const handlers = createAgentToolkitHandlers({
    secret,
    agentToolkit: {
      stats: () => ({ configured: true }),
      start: async (_body, context) => {
        observedContext = context;
        return result;
      },
    },
  });
  const requestContext = { headers: { authorization: `Bearer ${token}` }, body: {} };
  const cases = [
    [{ status: "blocked", reasonCode: "run_not_found" }, 404],
    [{ status: "blocked", reasonCode: "cohort_not_found" }, 404],
    [{ status: "blocked", reasonCode: "toolkit_denied" }, 403],
    [{ status: "blocked", reasonCode: "run_forbidden" }, 403],
    [{ status: "blocked", reasonCode: "evaluator_unconfigured" }, 501],
    [{ status: "blocked", reasonCode: "runtime_unconfigured" }, 501],
    [{ status: "blocked", reasonCode: "cohort_unavailable" }, 503],
    [{ status: "insufficient-evidence", reasonCode: "trusted_sample_count" }, 200],
    [{ status: "review_pending" }, 202],
  ];
  for (const [outcome, expectedStatus] of cases) {
    result = outcome;
    assert.equal((await handlers.start(requestContext)).statusCode, expectedStatus);
  }
  assert.equal(observedContext.principalId, "toolkit-handler-owner");
  assert.equal(observedContext.telemetryTrust, "remote-unverified");
});

test("Agent Toolkit Worker accepts an authenticated metadata-only lifecycle", async () => {
  const session = await handleCloudflareRequest(request("/api/auth/session", { method: "POST", body: {} }), ENV);
  const token = (await json(session)).token;
  const headers = { authorization: `Bearer ${token}` };
  const runId = "worker-toolkit-lifecycle";
  const started = await handleCloudflareRequest(request("/api/agent-toolkit/start", {
    method: "POST",
    headers,
    body: toolkitStartRequest(runId),
  }), ENV);
  assert.equal(started.status, 202);
  const startBody = await json(started);
  assert.equal(startBody.status, "running");
  assert.equal(startBody.telemetryTrust, "remote-unverified");

  const running = await handleCloudflareRequest(request("/api/agent-toolkit/status", {
    method: "POST",
    headers,
    body: { runId },
  }), ENV);
  assert.equal(running.status, 202);
  assert.equal((await json(running)).runId, runId);

  const completed = await handleCloudflareRequest(request("/api/agent-toolkit/complete", {
    method: "POST",
    headers,
    body: { runId, operationId: "worker-complete", status: "completed" },
  }), ENV);
  assert.equal(completed.status, 200);
  const completeBody = await json(completed);
  assert.equal(completeBody.status, "completed");
  assert.equal(completeBody.completion.cost.status, "unreported");

  const terminal = await handleCloudflareRequest(request("/api/agent-toolkit/status", {
    method: "POST",
    headers,
    body: { runId },
  }), ENV);
  assert.equal(terminal.status, 200);
  assert.equal((await json(terminal)).status, "completed");
});

test("Worker rejects JSON request bodies above the bounded ingestion limit", async () => {
  const response = await handleCloudflareRequest(request("/api/auth/session", {
    method: "POST",
    body: JSON.stringify({ value: "x".repeat(512 * 1024) }),
  }), ENV);
  assert.equal(response.status, 413);
  assert.equal((await json(response)).code, "request_body_too_large");
});

test("POST /api/invoke forwards an authed grammar query through the worker", async () => {
  await withMockedFetch(async (_url, init) => {
    const rpc = JSON.parse(String(init.body || "{}"));
    if (rpc.method === "initialize") {
      return new Response("", {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "mcp-session-id": "test-session-id",
        },
      });
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          structuredContent: {
            ok: true,
            catalog: [{ token: rpc.params.arguments.query, kind: "command" }],
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }, async () => {
    const session = await handleCloudflareRequest(request("/api/auth/session", { method: "POST", body: {} }), ENV);
    const token = (await json(session)).token;
    const res = await handleCloudflareRequest(
      request("/api/invoke", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: { query: "/soul.load" },
      }),
      ENV,
    );

    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.ok, true);
    assert.equal(body.catalog[0].token, "/soul.load");
  });
});

test("POST /api/invoke without auth is 401 before any control-plane forward", async () => {
  let called = false;
  await withMockedFetch(async () => {
    called = true;
    throw new Error("should not forward without auth");
  }, async () => {
    const res = await handleCloudflareRequest(
      request("/api/invoke", { method: "POST", body: { query: "/soul.load" } }),
      ENV,
    );
    assert.equal(res.status, 401);
    assert.equal(called, false);
  });
});

test("POST /api/function-call requires auth before adapter or gateway configuration", async () => {
  const res = await handleCloudflareRequest(
    request("/api/function-call", { method: "POST", body: { runId: "x", prompt: "x" } }),
    ENV,
  );
  assert.equal(res.status, 401);
});

test("POST /api/agent-swarm/start requires auth before runtime configuration", async () => {
  const unauthorized = await handleCloudflareRequest(
    request("/api/agent-swarm/start", { method: "POST", body: { runId: "swarm-run" } }),
    ENV,
  );
  assert.equal(unauthorized.status, 401);
  const session = await handleCloudflareRequest(request("/api/auth/session", { method: "POST", body: {} }), ENV);
  const token = (await json(session)).token;
  const unconfigured = await handleCloudflareRequest(
    request("/api/agent-swarm/start", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: { runId: "swarm-run" },
    }),
    ENV,
  );
  assert.equal(unconfigured.status, 501);
  assert.deepEqual(await json(unconfigured), { error: "agent swarm not configured" });
});

test("POST /api/function-call/resume requires session authentication", async () => {
  const res = await handleCloudflareRequest(request("/api/function-call/resume", {
    method: "POST",
    body: { runId: "run-1", resumeToken: "resume-1", decision: "approve", reviewerToken: "review-1" },
  }), ENV);
  assert.equal(res.status, 401);
});

test("POST /api/function-call/recover requires session authentication", async () => {
  const res = await handleCloudflareRequest(request("/api/function-call/recover", {
    method: "POST",
    body: { runId: "run-1" },
  }), ENV);
  assert.equal(res.status, 401);
});

test("non-API requests delegate to the Cloudflare assets binding", async () => {
  const env = {
    ...ENV,
    ASSETS: {
      fetch: async (req) => new Response(`asset:${new URL(req.url).pathname}`, { status: 200 }),
    },
  };
  const res = await handleCloudflareRequest(request("/"), env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "asset:/");
});

test("API methods fail closed", async () => {
  const ready = await handleCloudflareRequest(request("/api/ready", { method: "POST" }), ENV);
  assert.equal(ready.status, 405);
  const run = await handleCloudflareRequest(request("/api/run", { method: "GET" }), ENV);
  assert.equal(run.status, 405);
});
