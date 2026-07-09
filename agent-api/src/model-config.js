// Server-side model config for the Hermes Agent-like runtime.
//
// This module stores provider routing metadata only. It never reads, exports, or
// serializes a model provider secret; deploy targets supply the key through the
// named environment variable.

const DEFAULT_PROVIDER = "sealion";
const DEFAULT_BASE_URL = "https://api.sea-lion.ai/v1";
const DEFAULT_MODEL = "aisingapore/Gemma-SEA-LION-v4-27B-IT";
const DEFAULT_API_KEY_ENV = "SEA_LION_API_KEY";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function readEnvValue(env, names, fallback = "") {
  const source = env && typeof env === "object" ? env : {};
  for (const name of names) {
    const value = cleanText(source[name]);
    if (value) return value;
  }
  return fallback;
}

function normalizeBaseUrl(value) {
  const text = cleanText(value);
  if (!text) return "";
  return trimTrailingSlash(text);
}

function endpointFromBaseUrl(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  return base ? `${base}/chat/completions` : "";
}

export function agentModelConfigReady(config) {
  return Boolean(
    config &&
      cleanText(config.provider) &&
      config.protocol === "openai-chat-completions" &&
      cleanText(config.endpoint) &&
      cleanText(config.model) &&
      cleanText(config.apiKeyEnv),
  );
}

/**
 * Resolve the Hermes Agent-like model config from server-side env.
 *
 * Supported overrides intentionally use neutral `AGENT_MODEL_*` names with
 * SEA-LION-specific aliases for operational clarity.
 */
export function resolveAgentModelConfig(env = {}) {
  const provider = readEnvValue(env, ["AGENT_MODEL_PROVIDER", "HERMES_AGENT_MODEL_PROVIDER"], DEFAULT_PROVIDER);
  const baseUrl = normalizeBaseUrl(
    readEnvValue(env, ["AGENT_MODEL_BASE_URL", "SEA_LION_BASE_URL", "HERMES_AGENT_MODEL_BASE_URL"], DEFAULT_BASE_URL),
  );
  const endpoint = normalizeBaseUrl(
    readEnvValue(
      env,
      ["AGENT_MODEL_ENDPOINT", "SEA_LION_CHAT_COMPLETIONS_ENDPOINT", "HERMES_AGENT_MODEL_ENDPOINT"],
      endpointFromBaseUrl(baseUrl),
    ),
  );
  const model = readEnvValue(env, ["AGENT_MODEL_ID", "SEA_LION_MODEL", "HERMES_AGENT_MODEL_ID"], DEFAULT_MODEL);
  const apiKeyEnv = readEnvValue(env, ["AGENT_MODEL_API_KEY_ENV", "SEA_LION_API_KEY_ENV"], DEFAULT_API_KEY_ENV);

  return Object.freeze({
    provider,
    protocol: "openai-chat-completions",
    baseUrl,
    endpoint,
    model,
    apiKeyEnv,
  });
}

export const AGENT_MODEL_CONFIG = resolveAgentModelConfig(
  typeof process !== "undefined" && process.env ? process.env : {},
);
