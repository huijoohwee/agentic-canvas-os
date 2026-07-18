import { runLiveAgentProviderProof } from "../agent-api/src/live-agent-provider-proof.js";
import { resolveOpenAiResponsesAgentConfig } from "../agent-api/src/openai-responses-agent-adapter.js";

function publicConfiguration(config) {
  return Object.freeze({
    ready: config.ready,
    provider: config.provider,
    protocol: config.protocol,
    endpoint: config.endpoint,
    model: config.model,
    apiKeyEnv: config.apiKeyEnv,
    apiKeyPresent: config.apiKeyPresent,
    pricingReady: config.pricingReady,
    reasoningEffort: config.reasoningEffort,
    maxOutputTokens: config.maxOutputTokens,
  });
}

const config = resolveOpenAiResponsesAgentConfig(process.env);
if (!config.ready) {
  process.stderr.write(`${JSON.stringify({
    status: "blocked",
    stage: "configuration",
    configuration: publicConfiguration(config),
  })}\n`);
  process.exitCode = 1;
} else {
  try {
    const proof = await runLiveAgentProviderProof({
      config,
      approvalId: process.env.OPENAI_AGENT_LIVE_PROOF_APPROVAL,
    });
    process.stdout.write(`${JSON.stringify(proof)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "blocked",
      stage: "live-proof",
      error: error instanceof Error ? error.message : String(error),
      ...(Number.isInteger(error?.attemptedProviderCalls) ? {
        attemptedProviderCalls: error.attemptedProviderCalls,
        completedProviderCalls: error.completedProviderCalls,
        providerEvidence: error.providerEvidence,
      } : {}),
      configuration: publicConfiguration(config),
    })}\n`);
    process.exitCode = 1;
  }
}
