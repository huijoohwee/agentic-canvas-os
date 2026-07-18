import { createHash } from "node:crypto";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_API_KEY_ENV = "OPENAI_API_KEY";
const DEFAULT_MAX_OUTPUT_TOKENS = 256;
const DEFAULT_MAX_TURNS = 64;
const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);

export class OpenAiResponsesAgentAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OpenAiResponsesAgentAdapterError";
    this.code = code;
  }
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeEndpoint(value) {
  const endpoint = cleanText(value) || DEFAULT_ENDPOINT;
  try {
    const parsed = new URL(endpoint);
    const localHttp = parsed.protocol === "http:"
      && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
    return parsed.protocol === "https:" || localHttp ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function responseIdDigest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function tokenCount(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new OpenAiResponsesAgentAdapterError("usage_invalid", `OpenAI usage.${field} is missing or invalid.`);
  }
  return value;
}

function responseText(payload) {
  if (cleanText(payload.output_text)) return payload.output_text.trim();
  if (!Array.isArray(payload.output)) return "";
  return payload.output.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("")
    .trim();
}

function costLog(payload, pricing) {
  const usage = payload.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    throw new OpenAiResponsesAgentAdapterError("usage_missing", "OpenAI response did not include usage.");
  }
  const promptTokens = tokenCount(usage.input_tokens, "input_tokens");
  const completionTokens = tokenCount(usage.output_tokens, "output_tokens");
  const cachedTokens = usage.input_tokens_details?.cached_tokens === undefined
    ? 0
    : tokenCount(usage.input_tokens_details.cached_tokens, "input_tokens_details.cached_tokens");
  if (cachedTokens > promptTokens) {
    throw new OpenAiResponsesAgentAdapterError("usage_invalid", "Cached input tokens exceed total input tokens.");
  }
  const estimatedCostUsd = (
    ((promptTokens - cachedTokens) * pricing.inputUsdPerMillion)
    + (cachedTokens * pricing.cachedInputUsdPerMillion)
    + (completionTokens * pricing.outputUsdPerMillion)
  ) / 1_000_000;
  return Object.freeze({
    model: cleanText(payload.model) || "openai-responses",
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cache_hits: cachedTokens > 0 ? 1 : 0,
    estimated_cost_usd: estimatedCostUsd,
  });
}

function defaultTransport(request) {
  if (typeof fetch !== "function") {
    throw new OpenAiResponsesAgentAdapterError("transport_missing", "No OpenAI transport is available.");
  }
  return fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: request.signal,
  });
}

async function responseJson(response) {
  const text = typeof response?.text === "function"
    ? await response.text()
    : typeof response?.body === "string"
      ? response.body
      : JSON.stringify(response?.body ?? {});
  try {
    return JSON.parse(text);
  } catch {
    throw new OpenAiResponsesAgentAdapterError("response_invalid", "OpenAI returned invalid JSON.");
  }
}

function stableInstructions(preparedAgent) {
  const instructions = preparedAgent?.instructions;
  if (!Array.isArray(instructions) || instructions.length === 0) {
    throw new OpenAiResponsesAgentAdapterError("agent_invalid", "Prepared agent instructions are required.");
  }
  return instructions.map(({ name, content }) => `[${name}]\n${content}`).join("\n\n");
}

function dynamicInput(call) {
  return [{
    role: "user",
    content: [{
      type: "input_text",
      text: JSON.stringify({
        role: call.role,
        workflow: call.workflow,
        branch: call.branch,
        task: call.input,
      }),
    }],
  }];
}

export function resolveOpenAiResponsesAgentConfig(env = {}) {
  const apiKeyEnv = cleanText(env.OPENAI_AGENT_API_KEY_ENV) || DEFAULT_API_KEY_ENV;
  const endpoint = safeEndpoint(env.OPENAI_AGENT_ENDPOINT);
  const model = cleanText(env.OPENAI_AGENT_MODEL);
  const apiKey = cleanText(env[apiKeyEnv]);
  const reasoningEffort = cleanText(env.OPENAI_AGENT_REASONING_EFFORT) || "low";
  const pricing = Object.freeze({
    inputUsdPerMillion: parseRate(env.OPENAI_AGENT_INPUT_USD_PER_MILLION),
    cachedInputUsdPerMillion: parseRate(env.OPENAI_AGENT_CACHED_INPUT_USD_PER_MILLION),
    outputUsdPerMillion: parseRate(env.OPENAI_AGENT_OUTPUT_USD_PER_MILLION),
  });
  const pricingReady = Object.values(pricing).every((rate) => rate !== null);
  const ready = Boolean(
    apiKey
    && model
    && endpoint
    && REASONING_EFFORTS.has(reasoningEffort)
    && pricingReady
  );
  return Object.freeze({
    ready,
    provider: "openai",
    protocol: "responses",
    endpoint,
    model,
    apiKeyEnv,
    apiKeyPresent: Boolean(apiKey),
    apiKey,
    pricing,
    pricingReady,
    reasoningEffort,
    maxOutputTokens: parsePositiveInteger(env.OPENAI_AGENT_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS),
  });
}

export function createOpenAiResponsesAgentAdapter({
  apiKey,
  model,
  endpoint = DEFAULT_ENDPOINT,
  pricing,
  reasoningEffort = "low",
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  maxTurns = DEFAULT_MAX_TURNS,
  fetchImpl = defaultTransport,
} = {}) {
  if (!cleanText(apiKey)) throw new TypeError("OpenAI API key is required.");
  if (!cleanText(model)) throw new TypeError("OpenAI agent model is required.");
  if (!safeEndpoint(endpoint)) throw new TypeError("OpenAI Responses endpoint must be HTTPS or local HTTP.");
  if (!pricing || Object.values(pricing).some((rate) => !Number.isFinite(rate) || rate < 0)) {
    throw new TypeError("OpenAI input, cached-input, and output pricing is required.");
  }
  if (!REASONING_EFFORTS.has(reasoningEffort)) throw new TypeError("Unsupported OpenAI reasoning effort.");
  if (!Number.isInteger(maxTurns) || maxTurns <= 0) throw new TypeError("OpenAI agent max turns must be a positive integer.");
  const evidence = [];
  let attemptedTurns = 0;
  let completedTurns = 0;

  async function advanceAgent(call = {}) {
    if (attemptedTurns >= maxTurns) {
      throw new OpenAiResponsesAgentAdapterError(
        "turn_limit_exceeded",
        `OpenAI agent turn limit of ${maxTurns} was reached.`,
      );
    }
    attemptedTurns += 1;
    if (call.modelProvider?.model?.id !== model) {
      throw new OpenAiResponsesAgentAdapterError("model_mismatch", "Resolved model does not match the configured OpenAI adapter model.");
    }
    if (call.continuation?.strategy !== "previous-response") {
      throw new OpenAiResponsesAgentAdapterError("continuation_unsupported", "OpenAI live proof requires previous-response continuation.");
    }
    const previousResponseId = cleanText(call.continuation.previousResponseId);
    const requestedContext = previousResponseId ? "all_turns" : "current_turn";
    const body = {
      model,
      instructions: stableInstructions(call.preparedAgent),
      input: dynamicInput(call),
      reasoning: { effort: reasoningEffort, context: requestedContext },
      max_output_tokens: maxOutputTokens,
      store: true,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    };
    const response = await fetchImpl({
      url: safeEndpoint(endpoint),
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body,
      signal: call.signal,
    });
    const status = Number(response?.status) || 0;
    if (status < 200 || status >= 300) {
      throw new OpenAiResponsesAgentAdapterError(
        "provider_http_error",
        `OpenAI Responses request failed with status ${status}.`,
      );
    }
    const payload = await responseJson(response);
    if (payload.status !== "completed") {
      throw new OpenAiResponsesAgentAdapterError("response_incomplete", `OpenAI response ended with ${String(payload.status)}.`);
    }
    const responseId = cleanText(payload.id);
    if (!responseId) throw new OpenAiResponsesAgentAdapterError("response_id_missing", "OpenAI response id is missing.");
    const output = responseText(payload);
    if (!output) throw new OpenAiResponsesAgentAdapterError("output_missing", "OpenAI returned no final text.");
    const usage = costLog(payload, pricing);
    const effectiveContext = cleanText(payload.reasoning?.context);
    if (effectiveContext !== requestedContext) {
      throw new OpenAiResponsesAgentAdapterError(
        "reasoning_context_mismatch",
        "OpenAI did not confirm the requested reasoning context.",
      );
    }
    completedTurns += 1;
    evidence.push(Object.freeze({
      sequence: completedTurns,
      agentId: call.agent,
      role: call.role,
      branchId: call.branch?.branchId,
      model: cleanText(payload.model) || model,
      responseIdDigest: responseIdDigest(responseId),
      previousResponseIdUsed: Boolean(previousResponseId),
      ...(previousResponseId ? { previousResponseIdDigest: responseIdDigest(previousResponseId) } : {}),
      requestedReasoningContext: requestedContext,
      effectiveReasoningContext: effectiveContext,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      cacheHits: usage.cache_hits,
      estimatedCostUsd: usage.estimated_cost_usd,
      outputDigest: responseIdDigest(output),
      outputChars: output.length,
    }));
    return Object.freeze({ status: "completed", output, responseId, costLog: usage });
  }

  return Object.freeze({
    advanceAgent,
    evidence: () => Object.freeze([...evidence]),
    stats: () => Object.freeze({
      configured: true,
      provider: "openai",
      protocol: "responses",
      model,
      endpoint: safeEndpoint(endpoint),
      reasoningEffort,
      maxOutputTokens,
      maxTurns,
      attemptedTurns,
      completedTurns,
    }),
  });
}

export const OPENAI_AGENT_DEFAULTS = Object.freeze({
  endpoint: DEFAULT_ENDPOINT,
  apiKeyEnv: DEFAULT_API_KEY_ENV,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  maxTurns: DEFAULT_MAX_TURNS,
});
