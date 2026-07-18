const DELIVERY_MODES = new Set(["complete", "incremental"]);
const CONNECTION_MODES = new Set(["per-run", "reusable"]);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeEndpoint(value) {
  const text = cleanText(value);
  if (!text) return "";
  try {
    const endpoint = new URL(text);
    const localHttp = endpoint.protocol === "http:"
      && ["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname);
    return endpoint.protocol === "https:" || localHttp ? endpoint.toString() : "";
  } catch {
    return "";
  }
}

function featureList(value) {
  if (typeof value !== "string") return Object.freeze([]);
  const features = value.split(",").map((item) => item.trim()).filter(Boolean);
  return Object.freeze([...new Set(features)]);
}

export function resolveModelProviderEnvironment(env = {}) {
  const providerId = cleanText(env.AGENT_MODEL_PROVIDER);
  const providerRevision = cleanText(env.AGENT_MODEL_PROVIDER_REVISION);
  const adapterId = cleanText(env.AGENT_MODEL_ADAPTER);
  const endpoint = safeEndpoint(env.AGENT_MODEL_ENDPOINT);
  const modelId = cleanText(env.AGENT_MODEL_ID);
  const apiKeyEnv = cleanText(env.AGENT_MODEL_API_KEY_ENV);
  const transportId = cleanText(env.AGENT_MODEL_TRANSPORT);
  const delivery = cleanText(env.AGENT_MODEL_TRANSPORT_DELIVERY);
  const connection = cleanText(env.AGENT_MODEL_TRANSPORT_CONNECTION);
  const features = featureList(env.AGENT_MODEL_FEATURES);
  const apiKeyPresent = Boolean(apiKeyEnv && cleanText(env[apiKeyEnv]));
  const issues = [];
  for (const [field, value] of Object.entries({
    providerId,
    providerRevision,
    adapterId,
    endpoint,
    modelId,
    apiKeyEnv,
    transportId,
    delivery,
    connection,
  })) {
    if (!value) issues.push(`${field}_missing`);
  }
  if (delivery && !DELIVERY_MODES.has(delivery)) issues.push("delivery_unsupported");
  if (connection && !CONNECTION_MODES.has(connection)) issues.push("connection_unsupported");
  const ready = issues.length === 0;

  return Object.freeze({
    ready,
    providerId,
    providerRevision,
    adapterId,
    endpoint,
    modelId,
    apiKeyEnv,
    apiKeyPresent,
    transportId,
    delivery,
    connection,
    features,
    issues: Object.freeze(issues),
    ...(ready ? {
      providerDefinition: Object.freeze({
        id: providerId,
        revision: providerRevision,
        adapterId,
        models: Object.freeze([Object.freeze({ id: modelId, features })]),
        transports: Object.freeze([Object.freeze({ id: transportId, delivery, connection })]),
        defaultModelId: modelId,
        defaultTransportId: transportId,
      }),
      processDefault: Object.freeze({ providerId, modelId, transportId }),
    } : {}),
  });
}
