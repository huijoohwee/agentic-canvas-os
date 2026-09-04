// Tests for the platform-neutral Agent-API app core used by the Cloudflare
// Worker runtime. ZERO network — the MCP transport is injected.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createAgentApiApp } from "../agent-api/src/app.js";
import { createAgentSwarmRuntime } from "../agent-api/src/agent-swarm.js";

const ENV = Object.freeze({
  AGENT_API_JWT_SECRET: "server-side-secret",
  AGENTIC_OS_MCP_ENDPOINT: "https://airvio.co/agentic-os/control-plane/mcp",
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

const UPSTREAM_RUNTIME_SOURCE = JSON.stringify({
  name: "Operator Runtime Agent",
  instructions: [{ name: "purpose", content: "Return one bounded answer for the authenticated caller." }],
});
const UPSTREAM_RUNTIME_SOURCE_DIGEST = createHash("sha256").update(UPSTREAM_RUNTIME_SOURCE).digest("hex");

const UPSTREAM_RUNTIME_ENV = Object.freeze({
  AGENT_API_JWT_SECRET: "server-side-secret",
  AGENTIC_OS_MCP_ENDPOINT: "https://airvio.co/agentic-os/control-plane/mcp",
  AGENTIC_OS_FUNCTION_TOOL_ALLOWLIST: "update_agent_run_note",
  AGENTIC_OS_FUNCTION_REVIEW_REQUIRED: "update_agent_run_note",
  OPENAI_FUNCTION_CALLING_ENDPOINT: "https://api.openai.com/v1/responses",
  OPENAI_FUNCTION_CALLING_API_KEY_ENV: "OPENAI_API_KEY",
  OPENAI_FUNCTION_CALLING_MODEL: "gpt-5.6-luna",
  OPENAI_FUNCTION_CALLING_INPUT_USD_PER_MILLION: "1",
  OPENAI_FUNCTION_CALLING_CACHED_INPUT_USD_PER_MILLION: "0.1",
  OPENAI_FUNCTION_CALLING_CACHE_WRITE_USD_PER_MILLION: "1.25",
  OPENAI_FUNCTION_CALLING_OUTPUT_USD_PER_MILLION: "2",
  OPENAI_FUNCTION_CALLING_REASONING_EFFORT: "low",
  OPENAI_FUNCTION_CALLING_MAX_OUTPUT_TOKENS: "256",
  AGENT_MODEL_PROVIDER: "openai",
  AGENT_MODEL_PROVIDER_REVISION: "openai-agent-v1",
  AGENT_MODEL_ADAPTER: "openai-responses-agent",
  AGENT_MODEL_ENDPOINT: "https://api.openai.com/v1/responses",
  AGENT_MODEL_ID: "gpt-5.6-sol",
  AGENT_MODEL_API_KEY_ENV: "OPENAI_API_KEY",
  AGENT_MODEL_TRANSPORT: "responses-http",
  AGENT_MODEL_TRANSPORT_DELIVERY: "complete",
  AGENT_MODEL_TRANSPORT_CONNECTION: "per-run",
  AGENT_MODEL_FEATURES: "tool-calling,structured-output",
  OPENAI_API_KEY: "server-side-openai-key",
  OPENAI_AGENT_MODEL: "gpt-5.6-sol",
  OPENAI_AGENT_ENDPOINT: "https://api.openai.com/v1/responses",
  OPENAI_AGENT_INPUT_USD_PER_MILLION: "5",
  OPENAI_AGENT_CACHED_INPUT_USD_PER_MILLION: "0.5",
  OPENAI_AGENT_OUTPUT_USD_PER_MILLION: "30",
  OPENAI_AGENT_MAX_OUTPUT_TOKENS: "128",
  AGENT_RUNTIME_ENABLED: "true",
  AGENT_RUNTIME_SPEND_APPROVED: "true",
  AGENT_RUNTIME_AGENT_ID: "operator-runtime-agent",
  AGENT_RUNTIME_AGENT_REVISION: "operator-runtime-agent-v1",
  AGENT_RUNTIME_AGENT_SOURCE_URI: "operator-source:/agent/runtime.json",
  AGENT_RUNTIME_AGENT_SOURCE_SHA256: UPSTREAM_RUNTIME_SOURCE_DIGEST,
  AGENT_RUNTIME_AGENT_SOURCE: UPSTREAM_RUNTIME_SOURCE,
  AGENT_RUNTIME_MAX_PROVIDER_CALLS: "4",
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
  assert.deepEqual(app.readiness().agentDefinitions.requiredCore, ["source", "model", "instructions"]);
  assert.equal(app.readiness().agentDefinitions.sourcePolicy, "application-verified-uri-and-sha256");
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
  assert.deepEqual(app.readiness().agentDefinitions.statusCounts, {
    proposed: 0,
    active: 0,
    deprecated: 0,
  });
  assert.equal(app.readiness().agentDefinitions.snapshotDigestAlgorithm, "sha-256");
  assert.equal(
    app.readiness().agentDefinitions.statusCounts.proposed
      + app.readiness().agentDefinitions.statusCounts.active
      + app.readiness().agentDefinitions.statusCounts.deprecated,
    app.readiness().agentDefinitions.agents,
  );
  assert.equal(app.readiness().guardrailsHumanReview.contractReady, true);
  assert.equal(app.readiness().guardrailsHumanReview.configured, false);
  assert.equal(app.readiness().guardrailsHumanReview.reviewStoreConfigured, true);
  assert.deepEqual(app.readiness().guardrailsHumanReview.automaticStages, [
    "input",
    "output",
    "tool-input",
    "tool-output",
  ]);
  assert.deepEqual(app.readiness().guardrailsHumanReview.reviewDecisions, ["approve", "reject", "edit"]);
  assert.equal(app.readiness().guardrailsHumanReview.interruptionOwner, "running-agents-same-turn-state");
  assert.equal(app.readiness().guardrailsHumanReview.reviewStatePolicy, "atomic-single-consume-bounded-expiry");
  assert.equal(app.readiness().guardrailsHumanReview.reviewerEvidencePolicy, "purpose-scoped-signed-token");
  assert.equal(app.readiness().guardrailsHumanReview.providerExecutionStatus, "unverified");
  assert.equal(app.readiness().agentOrchestration.contractReady, true);
  assert.equal(app.readiness().agentOrchestration.configured, false);
  assert.equal(app.readiness().agentOrchestration.topologyOwner, "application-orchestration-registry");
  assert.equal(app.readiness().agentOrchestration.definitionOwner, "agent-definitions");
  assert.equal(app.readiness().agentOrchestration.executionOwner, "running-agents-adapter");
  assert.equal(app.readiness().agentOrchestration.conversationOwnership, "branch-explicit");
  assert.equal(app.readiness().agentOrchestration.finalAnswerOwnership, "branch-explicit");
  assert.deepEqual(app.readiness().agentOrchestration.modes, ["delegate", "handoff"]);
  assert.equal(app.readiness().agentOrchestration.providerExecutionStatus, "unverified");
  assert.equal(app.readiness().agentOrchestration.agentResolverConfigured, true);
  assert.equal(app.readiness().agentOrchestration.agentRunnerConfigured, true);
  assert.equal(app.readiness().agentRuntimeComposition.contractReady, true);
  assert.equal(app.readiness().agentRuntimeComposition.configured, false);
  assert.equal(app.readiness().agentRuntimeComposition.sourceOwner, "agent-definitions");
  assert.equal(app.readiness().agentRuntimeComposition.selectionOwner, "models-and-providers");
  assert.equal(app.readiness().agentRuntimeComposition.lifecycleOwner, "running-agents");
  assert.deepEqual(app.readiness().agentRuntimeComposition.orchestrationInterfaces, ["resolve-agent", "run-agent"]);
  assert.equal(app.readiness().agentRuntimeComposition.outputValidationOwner, "agent-definitions");
  assert.equal(app.readiness().agentRuntimeComposition.guardrailRuntimeConfigured, true);
  assert.equal(app.readiness().agentRuntimeComposition.executionAdapterConfigured, false);
  assert.equal(app.readiness().agentRuntimeComposition.providerExecutionStatus, "unverified");
  assert.equal(app.readiness().agentSwarm.contractReady, true);
  assert.equal(app.readiness().agentSwarm.configured, false);
  assert.equal(app.readiness().agentSwarm.coordinationOwner, "agent-swarm-durable-ledger");
  assert.equal(app.readiness().agentSwarm.taskModel, "runtime-generated-objectives-and-dependencies");
  assert.equal(app.readiness().agentSwarm.workerModel, "stateless-ephemeral-claims");
  assert.equal(app.readiness().agentSwarm.definitionResolutionOwner, "application-injected-agent-resolver");
  assert.equal(app.readiness().agentSwarm.synthesisOwner, "base-agent");
  assert.equal(app.readiness().agentSwarm.receiptVerificationOwner, "application-injected-durable-receipt-verifier");
  assert.equal(app.readiness().agentSwarm.mutationPolicy, "read-only-or-idempotent-with-verified-stable-key-receipt");
  assert.equal(app.readiness().agentSwarm.runOwnership, "authenticated-session-principal");
  assert.equal(app.readiness().agentSwarm.runDeadlinePolicy, "fixed-from-admission-with-full-lease-window");
  assert.equal(app.readiness().agentSwarm.sessionLifetimePolicy, "must-cover-fixed-run-deadline");
  assert.equal(app.readiness().agentSwarm.externalRuntimeDependency, false);
  assert.equal(app.readiness().agentSwarm.stateStore.persistence, "isolate-memory");
  assert.equal(app.readiness().agentSwarm.stateStore.atomicClaims, true);
  assert.equal(app.readiness().agentSwarm.stateStore.horizontalRecovery, false);
  assert.equal(app.readiness().agentSwarm.recursiveFanOut, false);
  assert.equal(app.readiness().agentSwarm.providerExecutionStatus, "unverified");
  assert.equal(app.readiness().progressiveAgents.contractReady, true);
  assert.equal(app.readiness().progressiveAgents.configured, false);
  assert.equal(app.readiness().progressiveAgents.progressionPolicy, "single-agent-then-tools-then-specialists");
  assert.deepEqual(app.readiness().progressiveAgents.growthStages, [
    "single-agent",
    "tool-enabled-agent",
    "specialist-workflow",
  ]);
  assert.equal(app.readiness().progressiveAgents.definitionOwner, "agent-definitions");
  assert.equal(app.readiness().progressiveAgents.toolExecutionOwner, "function-calling-through-application-adapter");
  assert.equal(app.readiness().progressiveAgents.specialistOwner, "agent-orchestration");
  assert.equal(app.readiness().progressiveAgents.externalSdkDependency, false);
  assert.equal(app.readiness().progressiveAgents.providerExecutionStatus, "unverified");
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
  assert.equal(app.readiness().functionCalling.reviewedExecutionPolicy, "durable-receipt-before-side-effect");
  assert.equal(app.readiness().functionCalling.idempotencyPolicy, "stable-key-with-upstream-echo-for-mutations");
  assert.equal(app.readiness().functionCalling.gateway.executionReceipts.persistence, "isolate-memory");
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
  assert.equal(app.readiness().runningAgents.recoveryPolicy, "atomic-claim-resume-commit");
  assert.equal(app.readiness().runningAgents.pausedTurnStoreConfigured, false);
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
  assert.equal(app.readiness().skillProposer.contractReady, true);
  assert.equal(app.readiness().skillProposer.configured, false);
  assert.equal(app.readiness().skillProposer.proposalOwner, "acos-skill-proposer");
  assert.equal(app.readiness().skillProposer.registryWriteCapability, false);
  assert.equal(app.readiness().skillProposer.iterationBound, 5);
  assert.equal(app.readiness().skillProposer.circuitBreakerConsecutiveNoCandidate, 2);
  assert.equal(app.readiness().skillProposer.p95GapToDraftMs, 12000);
  assert.equal(app.readiness().skillProposer.providerExecutionStatus, "unverified");
  assert.equal(app.readiness().skillRegistryGate.contractReady, true);
  assert.equal(app.readiness().skillRegistryGate.configured, false);
  assert.equal(app.readiness().skillRegistryGate.boundaryState, "closed");
  assert.equal(app.readiness().skillRegistryGate.promotionOwner, "acos-skill-registry-gate");
  assert.equal(app.readiness().skillRegistryGate.artifactType, "agent-definition");
  assert.equal(app.readiness().skillRegistryGate.modelCallCapability, false);
  assert.equal(app.readiness().skillRegistryGate.registryConfigured, true);
  assert.equal(app.readiness().skillRegistryGate.providerExecutionStatus, "unverified");
  assert.equal(app.readiness().adapterRegistration.contractReady, true);
  assert.equal(app.readiness().adapterRegistration.configured, false);
  assert.equal(app.readiness().adapterRegistration.registrationOwner, "agentic-os-adapter-registration");
  assert.equal(app.readiness().adapterRegistration.sharedEntrypointAdapterNames, 0);
  assert.equal(app.readiness().adapterRegistration.requestScopedState, false);
  assert.equal(app.readiness().adapterRegistration.registryConfigured, true);
  assert.equal(app.readiness().adapterRegistration.providerExecutionStatus, "unverified");

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

test("retired runtime endpoint names do not configure the application", () => {
  const { AGENTIC_OS_MCP_ENDPOINT: _endpoint, ...withoutRuntimeEndpoint } = ENV;
  const retiredRuntimeEndpoint = ["AGENTIC", "GRAPH_MCP_ENDPOINT"].join("");
  const app = createAgentApiApp({
    env: {
      ...withoutRuntimeEndpoint,
      [retiredRuntimeEndpoint]: "https://airvio.co/agentic-os/control-plane/mcp",
    },
  });
  assert.equal(app.configured, false);
});

test("createAgentApiApp wires an invoke handler for grammar queries", async () => {
  const app = createAgentApiApp({
    env: ENV,
    fetchImpl: mcpStub({
      ok: true,
      catalog: [{ token: "/soul.load", kind: "command", summary: "Resolved from agentic-graph MCP." }],
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

test("createAgentApiApp configures the upstream runtime surfaces when the full env is present", () => {
  const app = createAgentApiApp({
    env: UPSTREAM_RUNTIME_ENV,
    fetchImpl: mcpStub({ state: "blocked", approvalGates: [1, 2, 3, 4, 5] }),
  });
  const readiness = app.readiness();
  assert.equal(app.configured, true);
  assert.equal(readiness.modelProviders.configured, true);
  assert.equal(readiness.modelProviders.environment.providerId, "openai");
  assert.equal(readiness.agentDefinitions.configured, true);
  assert.deepEqual(readiness.agentDefinitions.statusCounts, {
    proposed: 0,
    active: 1,
    deprecated: 0,
  });
  assert.equal(readiness.functionCalling.configured, true);
  assert.equal(readiness.functionCalling.adapter.configured, true);
  assert.equal(readiness.functionCalling.adapter.apiKeyPresent, true);
  assert.equal(readiness.functionCalling.gateway.configured, true);
  assert.equal(readiness.toolSearch.configured, true);
  assert.equal(readiness.toolSearch.clientSearchConfigured, true);
  assert.equal(readiness.autonomousRuntime.configured, true);
  assert.equal(readiness.agentRuntimeComposition.configured, true);
  assert.equal(readiness.runningAgents.configured, true);
  assert.equal(readiness.progressiveAgents.configured, true);
  assert.equal(readiness.functionCalling.providerExecutionStatus, "unverified");
  assert.equal(readiness.agentDefinitions.providerExecutionStatus, "unverified");
  assert.equal(readiness.autonomousRuntime.providerExecutionStatus, "unverified");
  assert.equal(JSON.stringify(readiness).includes("server-side-openai-key"), false);
  assert.equal(JSON.stringify(readiness).includes(UPSTREAM_RUNTIME_SOURCE), false);
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

test("Agent Swarm handlers authenticate and delegate only to the configured native owner", async () => {
  const calls = [];
  const agentSwarm = Object.freeze({
    stats: () => Object.freeze({ configured: true }),
    start: async (body, context) => {
      calls.push(["start", body, context]);
      return { status: "running", stage: "agent-swarm", runId: body.runId };
    },
    work: async (body) => ({ status: "idle", stage: "agent-swarm-worker", runId: body.runId }),
    settle: async (body) => ({ status: "pending", stage: "agent-swarm-synthesis", runId: body.runId }),
    status: async (runId) => ({ status: "running", stage: "agent-swarm", runId }),
    cancel: async (body) => ({ status: "canceled", stage: "agent-swarm", runId: body.runId }),
  });
  const app = createAgentApiApp({ env: { AGENT_API_JWT_SECRET: "swarm-secret" }, agentSwarm });
  const unauthorized = await app.agentSwarmStart({ body: { runId: "swarm-http-run" } });
  assert.equal(unauthorized.statusCode, 401);
  const session = await app.authSession({ body: {} });
  const headers = { authorization: `Bearer ${session.body.token}` };
  const body = { runId: "swarm-http-run", goal: "Dynamic goal only." };
  const started = await app.agentSwarmStart({ headers, body });
  assert.equal(started.statusCode, 202);
  const [, sessionPayload] = session.body.token.split(".");
  const sessionClaims = JSON.parse(Buffer.from(sessionPayload, "base64url").toString("utf8"));
  const accessContext = { principalId: sessionClaims.sub, principalExpiresAt: sessionClaims.exp * 1000 };
  assert.deepEqual(calls, [["start", body, accessContext]]);
  const serverAbort = new AbortController();
  const signaledBody = { runId: "swarm-http-signaled", goal: "Server-owned abort only." };
  assert.equal((await app.agentSwarmStart({
    headers,
    body: signaledBody,
    signal: serverAbort.signal,
  })).statusCode, 202);
  assert.equal(calls[1][1].signal, serverAbort.signal);
  assert.deepEqual({ ...calls[1][1], signal: undefined }, { ...signaledBody, signal: undefined });
  assert.deepEqual(calls[1][2], accessContext);
  const status = await app.agentSwarmStatus({ headers, body: { runId: body.runId } });
  assert.equal(status.statusCode, 202);
  assert.equal(status.body.runId, body.runId);
  const invalidStatus = await app.agentSwarmStatus({ headers, body: { runId: body.runId, roles: ["invented"] } });
  assert.equal(invalidStatus.statusCode, 400);
  const canceled = await app.agentSwarmCancel({ headers, body: { runId: body.runId } });
  assert.equal(canceled.statusCode, 200);

  const costLog = {
    model: "offline-swarm-model",
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_hits: 0,
    estimated_cost_usd: 0,
  };
  const ownedRuntime = createAgentSwarmRuntime({
    resolveAgent: async ({ agent }) => ({ status: "ready", ...agent }),
    authorize: async () => ({ allowed: true, approvalId: "http-owner-approval" }),
    planTasks: async () => ({
      status: "completed",
      planId: "http-owner-plan",
      tasks: [{ taskId: "owned-task", objective: "Complete owned work.", dependencies: [], context: null }],
      costLog,
    }),
    executeTask: async () => ({ status: "completed", output: "private", effect: "read-only", costLog }),
    synthesize: async () => ({ status: "completed", output: "public", costLog }),
    verifyReceipt: async ({ receipt }) => ({ verified: true, ...receipt }),
  });
  const ownedApp = createAgentApiApp({
    env: { AGENT_API_JWT_SECRET: "owned-swarm-secret" },
    agentSwarm: ownedRuntime,
  });
  const ownerSession = await ownedApp.authSession({ body: {} });
  const otherSession = await ownedApp.authSession({ body: {} });
  const shortSession = await ownedApp.authSession({ body: { expiryWindowSeconds: 300 } });
  const ownerHeaders = { authorization: `Bearer ${ownerSession.body.token}` };
  const otherHeaders = { authorization: `Bearer ${otherSession.body.token}` };
  const ownedRequest = {
    runId: "http-principal-owned-run",
    conversationId: "http-principal-conversation",
    agent: { agentId: "http-base-agent", revision: "http-base-v1" },
    goal: "Complete the owned goal.",
    input: null,
    maxParallel: 1,
  };
  const shortStart = await ownedApp.agentSwarmStart({
    headers: { authorization: `Bearer ${shortSession.body.token}` },
    body: { ...ownedRequest, runId: "http-short-session-run" },
  });
  assert.equal(shortStart.statusCode, 409);
  assert.equal(shortStart.body.code, "session_too_short");
  assert.equal((await ownedApp.agentSwarmStart({ headers: ownerHeaders, body: ownedRequest })).statusCode, 202);
  const forbiddenStatus = await ownedApp.agentSwarmStatus({
    headers: otherHeaders,
    body: { runId: ownedRequest.runId },
  });
  assert.equal(forbiddenStatus.statusCode, 403);
  assert.equal(forbiddenStatus.body.reasonCode, "run_forbidden");
  assert.equal((await ownedApp.agentSwarmCancel({
    headers: otherHeaders,
    body: { runId: ownedRequest.runId, operationId: "foreign-http-cancel" },
  })).statusCode, 403);
  assert.equal((await ownedApp.agentSwarmStart({
    headers: ownerHeaders,
    body: { ...ownedRequest, runId: "http-signal-spoof", signal: { aborted: false } },
  })).statusCode, 400);
  assert.equal((await ownedApp.agentSwarmCancel({
    headers: ownerHeaders,
    body: { runId: ownedRequest.runId, operationId: "owner-http-cancel" },
  })).statusCode, 200);
});
