// Tests for the platform-neutral Agent-API app core used by the Cloudflare
// Worker runtime. ZERO network — the MCP transport is injected.

import test from "node:test";
import assert from "node:assert/strict";

import { createAgentApiApp } from "../agent-api/src/app.js";

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

function mcpStub(structuredContent) {
  return async (req) => {
    if (req.body && req.body.method === "initialize") {
      return { status: 200, headers: { get: (n) => n.toLowerCase() === "mcp-session-id" ? "test-session-id" : "" }, text: async () => "" };
    }
    return {
      status: 200,
      headers: { get: (n) => (n.toLowerCase() === "content-type" ? "application/json" : "") },
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: req.body.id, result: { structuredContent } }),
    };
  };
}

test("createAgentApiApp wires auth + a forwarding run handler", async () => {
  const app = createAgentApiApp({
    env: ENV,
    fetchImpl: mcpStub({ state: "blocked", approvalGates: [1, 2, 3, 4, 5] }),
  });
  assert.equal(app.configured, true);
  assert.equal(app.readiness().modelProviders.configured, true);
  assert.equal(app.readiness().modelProviders.contractReady, true);
  assert.deepEqual(app.readiness().modelProviders.selectionPrecedence, [
    "agent",
    "run-default",
    "process-default",
    "provider-default",
  ]);
  assert.equal(app.readiness().modelProviders.environment.providerId, "workspace-provider");
  assert.equal(app.readiness().modelProviders.environment.modelId, "workspace-model");
  assert.equal(app.readiness().modelProviders.environment.transportId, "stream-channel");
  assert.equal(app.readiness().modelProviders.environment.apiKeyPresent, true);
  assert.equal(app.readiness().modelProviders.executionOwner, "running-agents-adapter");
  assert.equal(app.readiness().modelProviders.providerExecutionStatus, "unverified");
  assert.equal(JSON.stringify(app.readiness()).includes("server-side-model-key"), false);
  assert.equal(app.readiness().agentDefinitions.contractReady, true);
  assert.equal(app.readiness().agentDefinitions.configured, false);
  assert.equal(app.readiness().agentDefinitions.definitionOwner, "application-agent-registry");
  assert.deepEqual(app.readiness().agentDefinitions.requiredCore, ["model", "instructions"]);
  assert.deepEqual(app.readiness().agentDefinitions.optionalBehavior, [
    "tools",
    "guardrails",
    "mcp-servers",
    "handoffs",
    "structured-output",
  ]);
  assert.equal(app.readiness().agentDefinitions.capabilityPolicy, "reference-only-with-application-authorization");
  assert.equal(app.readiness().agentDefinitions.executionOwner, "running-agents-adapter");
  assert.equal(app.readiness().agentDefinitions.providerExecutionStatus, "unverified");
  assert.equal(app.readiness().agentOrchestration.contractReady, true);
  assert.equal(app.readiness().agentOrchestration.configured, false);
  assert.equal(app.readiness().agentOrchestration.topologyOwner, "application-orchestration-registry");
  assert.equal(app.readiness().agentOrchestration.definitionOwner, "agent-definitions");
  assert.equal(app.readiness().agentOrchestration.executionOwner, "running-agents-adapter");
  assert.equal(app.readiness().agentOrchestration.conversationOwnership, "branch-explicit");
  assert.equal(app.readiness().agentOrchestration.finalAnswerOwnership, "branch-explicit");
  assert.deepEqual(app.readiness().agentOrchestration.modes, ["delegate", "handoff"]);
  assert.equal(app.readiness().agentOrchestration.providerExecutionStatus, "unverified");
  assert.equal(app.readiness().cacheContext.configured, true);
  assert.equal(app.readiness().cacheContext.providerCacheStatus, "unverified");
  assert.equal(app.readiness().reasoningContinuity.configured, true);
  assert.equal(app.readiness().reasoningContinuity.stableMode, "all_turns-with-previous-response");
  assert.equal(app.readiness().reasoningContinuity.providerEffectiveContext, "unverified");
  assert.equal(app.readiness().functionCalling.contractReady, true);
  assert.equal(app.readiness().functionCalling.configured, false);
  assert.equal(app.readiness().functionCalling.executionOwner, "application-tool-gateway");
  assert.equal(app.readiness().functionCalling.schemaMode, "explicit-strict");
  assert.deepEqual(app.readiness().functionCalling.selectionModes, ["auto", "required", "none", "forced", "allowed"]);
  assert.equal(app.readiness().functionCalling.callIdentity, "function-call-output-preserves-call-id");
  assert.equal(app.readiness().functionCalling.providerExecutionStatus, "unverified");
  assert.equal(app.readiness().functionCalling.adapter.configured, false);
  assert.equal(app.readiness().functionCalling.adapter.apiKeyPresent, false);
  assert.equal(app.readiness().functionCalling.gateway.configured, false);
  assert.equal(app.readiness().programmaticToolCalling.contractReady, true);
  assert.equal(app.readiness().programmaticToolCalling.configured, false);
  assert.equal(app.readiness().programmaticToolCalling.localJavaScriptExecution, "forbidden");
  assert.equal(app.readiness().programmaticToolCalling.providerContextIsolation, "unverified");
  assert.deepEqual(app.readiness().programmaticToolCalling.continuationModes, ["stored", "stateless-replay"]);
  assert.equal(app.readiness().programmaticToolCalling.callerContract, "function-call-output-preserves-caller");
  assert.equal(app.readiness().runningAgents.contractReady, true);
  assert.equal(app.readiness().runningAgents.configured, false);
  assert.equal(app.readiness().runningAgents.loopOwner, "application-turn-controller");
  assert.equal(app.readiness().runningAgents.streamingOwner, "same-loop-event-channel");
  assert.equal(app.readiness().runningAgents.pauseSemantics, "resume-same-turn");
  assert.equal(app.readiness().runningAgents.continuationPolicy, "one-strategy-per-conversation");
  assert.deepEqual(app.readiness().runningAgents.continuationStrategies, [
    "application-history",
    "session",
    "conversation",
    "previous-response",
  ]);
  assert.equal(app.readiness().runningAgents.providerExecutionStatus, "unverified");
  assert.equal(app.readiness().sandboxAgents.contractReady, true);
  assert.equal(app.readiness().sandboxAgents.configured, false);
  assert.equal(app.readiness().sandboxAgents.controlPlaneOwner, "agentic-canvas-os");
  assert.equal(app.readiness().sandboxAgents.executionOwner, "injected-container-provider");
  assert.deepEqual(app.readiness().sandboxAgents.stateSurfaces, [
    "active-session",
    "resume-checkpoint",
    "workspace-snapshot",
  ]);
  assert.deepEqual(app.readiness().sandboxAgents.supportedCapabilities, [
    "files",
    "commands",
    "packages",
    "ports",
    "snapshots",
    "resume",
  ]);
  assert.equal(app.readiness().sandboxAgents.containerExecutionStatus, "unverified");
  assert.equal(app.readiness().sandboxAgents.independentContainmentProof, "unverified");
  assert.equal(app.readiness().sandboxAgents.containmentVerifierConfigured, false);
  assert.equal(app.readiness().sandboxAgents.liveContainerReady, false);
  assert.equal(app.readiness().toolSearch.contractReady, true);
  assert.equal(app.readiness().toolSearch.configured, false);
  assert.equal(app.readiness().toolSearch.initialExposure, "direct-definitions-and-deferred-metadata");
  assert.equal(app.readiness().toolSearch.loadedDefinitionPlacement, "append-only-search-output");
  assert.equal(app.readiness().toolSearch.programSearchPolicy, "top-level-before-hosted-program");
  assert.equal(app.readiness().toolSearch.providerContextReduction, "unverified");

  const session = await app.authSession({ body: { subject: "s1" } });
  assert.equal(session.statusCode, 200);
  const token = session.body.token;

  const run = await app.run({
    headers: { authorization: `Bearer ${token}` },
    body: { referenceUrl: "https://youtu.be/x", brief: "promo", budgetUsd: 25 },
  });
  assert.equal(run.statusCode, 200);
  assert.equal(run.body.state, "blocked");
  assert.ok(run.body.approvalGates.length >= 5);
});

test("createAgentApiApp wires an invoke handler for grammar queries", async () => {
  const app = createAgentApiApp({
    env: ENV,
    fetchImpl: mcpStub({
      ok: true,
      catalog: [{ token: "/soul.load", kind: "command", summary: "Resolved from knowgrph MCP." }],
    }),
  });
  assert.equal(app.configured, true);

  const session = await app.authSession({ body: { subject: "s1" } });
  const token = session.body.token;

  const invoke = await app.invoke({
    headers: { authorization: `Bearer ${token}` },
    body: { query: "/soul.load" },
  });
  assert.equal(invoke.statusCode, 200);
  assert.equal(invoke.body.ok, true);
  assert.equal(invoke.body.catalog[0].token, "/soul.load");
});

test("run fails closed (501) when no MCP endpoint is configured", async () => {
  const app = createAgentApiApp({ env: { AGENT_API_JWT_SECRET: "s" } });
  assert.equal(app.configured, false);
  const session = await app.authSession({ body: {} });
  const token = session.body.token;
  const run = await app.run({
    headers: { authorization: `Bearer ${token}` },
    body: { referenceUrl: "https://x", brief: "b", budgetUsd: 1 },
  });
  assert.equal(run.statusCode, 501);
});

test("invoke fails closed (501) when no MCP endpoint is configured", async () => {
  const app = createAgentApiApp({ env: { AGENT_API_JWT_SECRET: "s" } });
  const session = await app.authSession({ body: {} });
  const token = session.body.token;
  const invoke = await app.invoke({
    headers: { authorization: `Bearer ${token}` },
    body: { query: "/soul.load" },
  });
  assert.equal(invoke.statusCode, 501);
});

test("auth/session honors an env default expiry", async () => {
  const app = createAgentApiApp({ env: { ...ENV, AGENT_API_AUTH_EXPIRY: "900" }, fetchImpl: mcpStub({}) });
  const session = await app.authSession({ body: {} });
  assert.equal(session.statusCode, 200);
  const [, payloadB64] = session.body.token.split(".");
  const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  assert.equal(claims.exp - claims.iat, 900);
});
