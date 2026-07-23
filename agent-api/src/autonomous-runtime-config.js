import { createHash } from "node:crypto";

import { createAgentDefinitionRegistry } from "./agent-definitions.js";

const OPENAI_AGENT_ADAPTER_ID = "openai-responses-agent";
const MAX_PROVIDER_CALLS = 64;

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function parseSource(value) {
  const sourceText = typeof value === "string" ? value : "";
  if (!sourceText) return { sourceText, source: null, issue: "agent_source_missing" };
  let source;
  try {
    source = JSON.parse(sourceText);
  } catch {
    return { sourceText, source: null, issue: "agent_source_invalid" };
  }
  if (!exactKeys(source, ["name", "instructions"])) {
    return { sourceText, source: null, issue: "agent_source_invalid" };
  }
  if (typeof source.name !== "string" || !source.name.trim() || !Array.isArray(source.instructions)) {
    return { sourceText, source: null, issue: "agent_source_invalid" };
  }
  return { sourceText, source, issue: "" };
}

function boundedProviderCalls(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_PROVIDER_CALLS ? parsed : 0;
}

export function resolveAutonomousRuntimeEnvironment(
  env = {},
  { modelProviderEnvironment = {}, openAiAgentConfig = {} } = {},
) {
  const enabled = cleanText(env.AGENT_RUNTIME_ENABLED) === "true";
  const spendApproved = cleanText(env.AGENT_RUNTIME_SPEND_APPROVED) === "true";
  const agentId = cleanText(env.AGENT_RUNTIME_AGENT_ID);
  const agentRevision = cleanText(env.AGENT_RUNTIME_AGENT_REVISION);
  const sourceUri = cleanText(env.AGENT_RUNTIME_AGENT_SOURCE_URI);
  const controlPlaneConfigured = Boolean(cleanText(env.KNOWGRPH_MCP_ENDPOINT));
  const sourceDigest = cleanText(env.AGENT_RUNTIME_AGENT_SOURCE_SHA256).toLowerCase();
  const maxProviderCalls = boundedProviderCalls(env.AGENT_RUNTIME_MAX_PROVIDER_CALLS);
  const parsedSource = parseSource(env.AGENT_RUNTIME_AGENT_SOURCE);
  const computedSourceDigest = parsedSource.sourceText ? sha256(parsedSource.sourceText) : "";
  const issues = [];

  if (!enabled) issues.push("runtime_disabled");
  if (enabled && !spendApproved) issues.push("spend_approval_missing");
  if (enabled && !agentId) issues.push("agent_id_missing");
  if (enabled && !agentRevision) issues.push("agent_revision_missing");
  if (enabled && !sourceUri) issues.push("agent_source_uri_missing");
  if (enabled && !/^[a-f0-9]{64}$/.test(sourceDigest)) issues.push("agent_source_sha256_invalid");
  if (enabled && parsedSource.issue) issues.push(parsedSource.issue);
  if (enabled && sourceDigest && computedSourceDigest && sourceDigest !== computedSourceDigest) {
    issues.push("agent_source_sha256_mismatch");
  }
  if (enabled && !maxProviderCalls) issues.push("max_provider_calls_invalid");
  if (enabled && !controlPlaneConfigured) issues.push("control_plane_unconfigured");
  if (enabled && !(modelProviderEnvironment.ready && modelProviderEnvironment.apiKeyPresent)) {
    issues.push("model_provider_unconfigured");
  }
  if (enabled && !openAiAgentConfig.ready) issues.push("openai_agent_unconfigured");
  if (enabled && modelProviderEnvironment.providerId !== "openai") issues.push("provider_unsupported");
  if (enabled && modelProviderEnvironment.adapterId !== OPENAI_AGENT_ADAPTER_ID) issues.push("adapter_mismatch");
  if (enabled && modelProviderEnvironment.delivery !== "complete") issues.push("delivery_mismatch");
  if (enabled && modelProviderEnvironment.connection !== "per-run") issues.push("connection_mismatch");
  if (enabled && modelProviderEnvironment.modelId !== openAiAgentConfig.model) issues.push("model_mismatch");
  if (enabled && modelProviderEnvironment.endpoint !== openAiAgentConfig.endpoint) issues.push("endpoint_mismatch");
  if (enabled && modelProviderEnvironment.apiKeyEnv !== openAiAgentConfig.apiKeyEnv) issues.push("api_key_env_mismatch");

  let definition = enabled && issues.length === 0
    ? Object.freeze({
      id: agentId,
      revision: agentRevision,
      name: parsedSource.source.name,
      source: Object.freeze({ uri: sourceUri, digest: sourceDigest }),
      model: Object.freeze({
        providerId: modelProviderEnvironment.providerId,
        modelId: modelProviderEnvironment.modelId,
      }),
      instructions: parsedSource.source.instructions,
      output: Object.freeze({ mode: "text" }),
    })
    : null;
  if (definition) {
    try {
      createAgentDefinitionRegistry().register(definition);
    } catch {
      issues.push("agent_definition_invalid");
      definition = null;
    }
  }
  const ready = enabled && issues.length === 0 && Boolean(definition);

  return Object.freeze({
    ready,
    enabled,
    spendApproved,
    agentId,
    agentRevision,
    sourceUri,
    sourceDigestPresent: Boolean(sourceDigest),
    sourceDigestMatches: Boolean(sourceDigest && sourceDigest === computedSourceDigest),
    controlPlaneConfigured,
    sourceVerification: "server-side-sha256",
    maxProviderCalls,
    route: "/api/agent/run",
    auth: "session-token",
    provider: "openai",
    adapterId: OPENAI_AGENT_ADAPTER_ID,
    issues: Object.freeze([...new Set(issues)]),
    definition,
    sourceText: parsedSource.sourceText,
  });
}

export function createAutonomousAgentDefinitionRegistry(config = {}) {
  const registry = createAgentDefinitionRegistry({
    verifyDefinitionSource: config.ready
      ? async ({ source }) => {
        const digest = sha256(config.sourceText);
        return Object.freeze({
          verified: source.uri === config.sourceUri && digest === config.definition.source.digest,
          uri: config.sourceUri,
          digest,
          verificationId: `server-source-${digest.slice(0, 16)}`,
        });
      }
      : undefined,
  });
  if (config.ready) registry.register(config.definition);
  return registry;
}

export const AUTONOMOUS_RUNTIME_DEFAULTS = Object.freeze({
  adapterId: OPENAI_AGENT_ADAPTER_ID,
  maxProviderCalls: MAX_PROVIDER_CALLS,
});
