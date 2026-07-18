import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createAgentDefinitionRegistry } from "./agent-definitions.js";
import { createAgentOrchestrationRuntime } from "./agent-orchestration.js";
import { createAgentRuntimeComposition } from "./agent-runtime-composition.js";
import { createModelProviderRuntime } from "./model-providers.js";
import { createOpenAiResponsesAgentAdapter } from "./openai-responses-agent-adapter.js";

const MANAGER_URI = "workspace:/__tests__/fixtures/live-provider-manager.json";
const SPECIALIST_URI = "workspace:/__tests__/fixtures/live-provider-specialist.json";
const PROVIDER_ID = "openai-live-proof";
const PROVIDER_REVISION = "responses-v1";
const TRANSPORT_ID = "responses-complete";
const WORKFLOW_ID = "live-agent-provider-proof";
const WORKFLOW_REVISION = "live-agent-provider-proof-v1";
const CONVERSATION_ID = "live-agent-provider-proof-conversation";
const MAX_PROVIDER_CALLS = 3;

export class LiveAgentProviderProofError extends Error {
  constructor(message, adapter) {
    super(message, { cause: undefined });
    this.name = "LiveAgentProviderProofError";
    this.attemptedProviderCalls = adapter.stats().attemptedTurns;
    this.completedProviderCalls = adapter.stats().completedTurns;
    this.providerEvidence = adapter.evidence();
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertConfig(config) {
  if (!config?.ready) throw new TypeError("Complete OpenAI live-agent configuration is required.");
  if (!config.apiKeyPresent || !config.apiKey) throw new TypeError("OpenAI API key is required.");
}

function assertApprovalId(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("A live provider approval id is required.");
  }
  return value.trim();
}

async function loadProfile(url) {
  const text = await readFile(url, "utf8");
  return Object.freeze({ text, digest: sha256(text), profile: JSON.parse(text) });
}

function definition(profile, uri, digest, model) {
  return Object.freeze({
    ...profile,
    source: Object.freeze({ uri, digest }),
    model: Object.freeze({ providerId: PROVIDER_ID, modelId: model }),
  });
}

function workflow() {
  return Object.freeze({
    workflowId: WORKFLOW_ID,
    revision: WORKFLOW_REVISION,
    manager: Object.freeze({ agentId: "live-proof-manager", revision: "live-proof-manager-v1" }),
    specialists: Object.freeze([Object.freeze({
      agentId: "live-proof-specialist",
      revision: "live-proof-specialist-v1",
      responsibility: "Return one bounded provider-backed verification statement.",
    })]),
    branches: Object.freeze([
      Object.freeze({
        branchId: "delegate-specialist",
        sourceAgentId: "live-proof-manager",
        targetAgentId: "live-proof-specialist",
        mode: "delegate",
        conversationOwnerAgentId: "live-proof-manager",
        finalAnswerAgentId: "live-proof-manager",
      }),
      Object.freeze({
        branchId: "handoff-specialist",
        sourceAgentId: "live-proof-manager",
        targetAgentId: "live-proof-specialist",
        mode: "handoff",
        conversationOwnerAgentId: "live-proof-specialist",
        finalAnswerAgentId: "live-proof-specialist",
      }),
    ]),
  });
}

function request(runId, branchId, input) {
  return Object.freeze({
    runId,
    conversationId: CONVERSATION_ID,
    workflowId: WORKFLOW_ID,
    workflowRevision: WORKFLOW_REVISION,
    branchId,
    input: Object.freeze({ request: input }),
  });
}

function requireCompleted(result, expectedOwner, marker) {
  if (result?.status !== "completed") {
    throw new Error(`Live agent proof blocked at ${result?.reasonCode || result?.stage || "unknown"}.`);
  }
  if (result.finalAnswerOwner?.agentId !== expectedOwner) {
    throw new Error(`Live agent proof returned unexpected owner ${String(result.finalAnswerOwner?.agentId)}.`);
  }
  if (typeof result.output !== "string" || !result.output.startsWith(marker)) {
    throw new Error(`Live agent proof output did not begin with ${marker}.`);
  }
  if (result.cost?.status !== "reported") {
    throw new Error("Live agent proof did not return complete usage and cost evidence.");
  }
}

function aggregateUsage(records) {
  return Object.freeze({
    promptTokens: records.reduce((sum, record) => sum + record.promptTokens, 0),
    completionTokens: records.reduce((sum, record) => sum + record.completionTokens, 0),
    cacheHits: records.reduce((sum, record) => sum + record.cacheHits, 0),
    estimatedCostUsd: records.reduce((sum, record) => sum + record.estimatedCostUsd, 0),
  });
}

export async function runLiveAgentProviderProof({
  config,
  approvalId,
  fetchImpl,
  managerSourceUrl = new URL("../../__tests__/fixtures/live-provider-manager.json", import.meta.url),
  specialistSourceUrl = new URL("../../__tests__/fixtures/live-provider-specialist.json", import.meta.url),
} = {}) {
  assertConfig(config);
  const safeApprovalId = assertApprovalId(approvalId);
  const [managerSource, specialistSource] = await Promise.all([
    loadProfile(managerSourceUrl),
    loadProfile(specialistSourceUrl),
  ]);
  const sources = new Map([
    [MANAGER_URI, Object.freeze({ url: managerSourceUrl, digest: managerSource.digest })],
    [SPECIALIST_URI, Object.freeze({ url: specialistSourceUrl, digest: specialistSource.digest })],
  ]);
  const definitions = createAgentDefinitionRegistry({
    verifyDefinitionSource: async ({ source }) => {
      const record = sources.get(source.uri);
      if (!record) return { verified: false, uri: source.uri, digest: source.digest, verificationId: "source-missing" };
      const current = await readFile(record.url, "utf8");
      return Object.freeze({
        verified: sha256(current) === record.digest,
        uri: source.uri,
        digest: sha256(current),
        verificationId: `sha256:${record.digest}`,
      });
    },
  });
  definitions.register(definition(managerSource.profile, MANAGER_URI, managerSource.digest, config.model));
  definitions.register(definition(specialistSource.profile, SPECIALIST_URI, specialistSource.digest, config.model));

  const providers = createModelProviderRuntime();
  providers.registerProvider({
    id: PROVIDER_ID,
    revision: PROVIDER_REVISION,
    adapterId: "openai-responses-agent",
    models: [{ id: config.model, features: [] }],
    transports: [{ id: TRANSPORT_ID, delivery: "complete", connection: "per-run" }],
    defaultModelId: config.model,
    defaultTransportId: TRANSPORT_ID,
  });
  const adapter = createOpenAiResponsesAgentAdapter({ ...config, fetchImpl, maxTurns: MAX_PROVIDER_CALLS });
  const composition = createAgentRuntimeComposition({
    agentDefinitions: definitions,
    modelProviders: providers,
    executeAgentStep: adapter.advanceAgent,
    maxSteps: 1,
    maxConversations: 4,
    timeoutMs: 120_000,
  });
  const orchestration = createAgentOrchestrationRuntime({
    resolveAgent: composition.resolveAgent,
    runAgent: composition.runAgent,
    authorize: async ({ action }) => Object.freeze({
      allowed: action === "agent.delegate" || action === "conversation.handoff",
      approvalId: safeApprovalId,
    }),
    timeoutMs: 120_000,
    maxConversations: 4,
  });
  orchestration.register(workflow());

  let delegation;
  let handoff;
  try {
    delegation = await orchestration.run(request(
      "live-proof-delegation",
      "delegate-specialist",
      "Produce a minimal statement that the bounded delegation stage executed.",
    ));
    requireCompleted(delegation, "live-proof-manager", "MANAGER_FINAL:");

    handoff = await orchestration.run(request(
      "live-proof-handoff",
      "handoff-specialist",
      "Take ownership and confirm the bounded handoff stage using compatible prior context.",
    ));
    requireCompleted(handoff, "live-proof-specialist", "SPECIALIST_FINAL:");
  } catch (error) {
    throw new LiveAgentProviderProofError(error instanceof Error ? error.message : String(error), adapter);
  }

  const records = adapter.evidence();
  if (records.length !== MAX_PROVIDER_CALLS) {
    throw new LiveAgentProviderProofError(
      `Expected exactly ${MAX_PROVIDER_CALLS} provider calls; received ${records.length}.`,
      adapter,
    );
  }
  const [delegatedSpecialist, manager, handedOffSpecialist] = records;
  if (
    delegatedSpecialist.agentId !== "live-proof-specialist"
    || manager.agentId !== "live-proof-manager"
    || handedOffSpecialist.agentId !== "live-proof-specialist"
  ) throw new Error("Provider call sequence did not match specialist-manager-specialist ownership.");
  if (
    handedOffSpecialist.previousResponseIdUsed !== true
    || handedOffSpecialist.previousResponseIdDigest !== delegatedSpecialist.responseIdDigest
    || handedOffSpecialist.effectiveReasoningContext !== "all_turns"
  ) throw new Error("Specialist handoff did not confirm previous-response all-turn continuation.");

  return Object.freeze({
    schema: "agent-live-provider-proof/v1",
    status: "passed",
    provider: Object.freeze({
      id: "openai",
      protocol: "responses",
      model: config.model,
      reasoningEffort: config.reasoningEffort,
    }),
    bounds: Object.freeze({
      providerCalls: MAX_PROVIDER_CALLS,
      maxOutputTokensPerCall: config.maxOutputTokens,
      continuationStrategy: "previous-response",
      storedResponses: true,
    }),
    source: Object.freeze({
      managerDigest: managerSource.digest,
      specialistDigest: specialistSource.digest,
    }),
    execution: Object.freeze({
      delegation: Object.freeze({
        status: delegation.status,
        mode: delegation.branch.mode,
        finalAnswerOwner: delegation.finalAnswerOwner.agentId,
        providerCalls: delegation.evidence.agentCalls,
        outputDigest: sha256(delegation.output),
      }),
      handoff: Object.freeze({
        status: handoff.status,
        mode: handoff.branch.mode,
        finalAnswerOwner: handoff.finalAnswerOwner.agentId,
        providerCalls: handoff.evidence.agentCalls,
        outputDigest: sha256(handoff.output),
      }),
      continuation: Object.freeze({
        priorSpecialistResponseReused: true,
        requestedReasoningContext: handedOffSpecialist.requestedReasoningContext,
        effectiveReasoningContext: handedOffSpecialist.effectiveReasoningContext,
        responseLinkVerified: handedOffSpecialist.previousResponseIdDigest === delegatedSpecialist.responseIdDigest,
      }),
    }),
    usage: aggregateUsage(records),
    providerExecutionStatus: "verified-bounded-live",
  });
}

export const LIVE_AGENT_PROVIDER_PROOF_DEFAULTS = Object.freeze({
  providerCalls: MAX_PROVIDER_CALLS,
  workflowId: WORKFLOW_ID,
  workflowRevision: WORKFLOW_REVISION,
});
