import { normalizeJson, serializedJsonLength } from "./json-contract.js";

const DEFAULT_MAX_PROVIDERS = 32;
const DEFAULT_MAX_MODELS_PER_PROVIDER = 64;
const DEFAULT_MAX_TRANSPORTS_PER_PROVIDER = 16;
const DEFAULT_MAX_PROVIDER_CHARS = 200_000;
const DELIVERY_MODES = new Set(["complete", "incremental"]);
const CONNECTION_MODES = new Set(["per-run", "reusable"]);

export class ModelProviderBlock extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = "ModelProviderBlock";
    this.reasonCode = reasonCode;
  }
}

function assertPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
  return value;
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > 256) throw new RangeError(`${field} exceeds 256 characters.`);
  return normalized;
}

function assertExactKeys(value, allowedKeys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new TypeError(`${field} contains unsupported fields: ${unknown.join(", ")}.`);
}

function normalizeIdentifierList(value, field) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  const identifiers = value.map((item, index) => assertIdentifier(item, `${field}[${index}]`));
  if (new Set(identifiers).size !== identifiers.length) throw new TypeError(`${field} contains a duplicate.`);
  return Object.freeze(identifiers);
}

function normalizeModels(value, maxModels) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("provider.models must be a non-empty array.");
  if (value.length > maxModels) throw new RangeError(`provider.models must contain at most ${maxModels} entries.`);
  const ids = new Set();
  return Object.freeze(value.map((model, index) => {
    const field = `provider.models[${index}]`;
    assertExactKeys(model, ["id", "features"], field);
    const id = assertIdentifier(model.id, `${field}.id`);
    if (ids.has(id)) throw new TypeError(`Duplicate provider model id: ${id}.`);
    ids.add(id);
    return Object.freeze({ id, features: normalizeIdentifierList(model.features, `${field}.features`) });
  }));
}

function normalizeTransports(value, maxTransports) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("provider.transports must be a non-empty array.");
  if (value.length > maxTransports) {
    throw new RangeError(`provider.transports must contain at most ${maxTransports} entries.`);
  }
  const ids = new Set();
  return Object.freeze(value.map((transport, index) => {
    const field = `provider.transports[${index}]`;
    assertExactKeys(transport, ["id", "delivery", "connection"], field);
    const id = assertIdentifier(transport.id, `${field}.id`);
    if (ids.has(id)) throw new TypeError(`Duplicate provider transport id: ${id}.`);
    ids.add(id);
    if (!DELIVERY_MODES.has(transport.delivery)) throw new TypeError(`${field}.delivery is unsupported.`);
    if (!CONNECTION_MODES.has(transport.connection)) throw new TypeError(`${field}.connection is unsupported.`);
    return Object.freeze({ id, delivery: transport.delivery, connection: transport.connection });
  }));
}

function normalizeProvider(value, limits) {
  assertExactKeys(
    value,
    ["id", "revision", "adapterId", "models", "transports", "defaultModelId", "defaultTransportId"],
    "provider",
  );
  const models = normalizeModels(value.models, limits.maxModelsPerProvider);
  const transports = normalizeTransports(value.transports, limits.maxTransportsPerProvider);
  const defaultModelId = value.defaultModelId === undefined
    ? ""
    : assertIdentifier(value.defaultModelId, "provider.defaultModelId");
  const defaultTransportId = assertIdentifier(value.defaultTransportId, "provider.defaultTransportId");
  if (defaultModelId && !models.some((model) => model.id === defaultModelId)) {
    throw new TypeError("provider.defaultModelId must name a registered model.");
  }
  if (!transports.some((transport) => transport.id === defaultTransportId)) {
    throw new TypeError("provider.defaultTransportId must name a registered transport.");
  }
  const provider = normalizeJson({
    id: assertIdentifier(value.id, "provider.id"),
    revision: assertIdentifier(value.revision, "provider.revision"),
    adapterId: assertIdentifier(value.adapterId, "provider.adapterId"),
    models,
    transports,
    ...(defaultModelId ? { defaultModelId } : {}),
    defaultTransportId,
  }, "provider");
  if (serializedJsonLength(provider) > limits.maxProviderChars) {
    throw new RangeError(`provider exceeds ${limits.maxProviderChars} characters.`);
  }
  return provider;
}

function normalizeSelection(value, field) {
  if (value === undefined) return undefined;
  assertExactKeys(value, ["providerId", "modelId", "transportId"], field);
  return Object.freeze({
    providerId: assertIdentifier(value.providerId, `${field}.providerId`),
    ...(value.modelId === undefined ? {} : { modelId: assertIdentifier(value.modelId, `${field}.modelId`) }),
    ...(value.transportId === undefined
      ? {}
      : { transportId: assertIdentifier(value.transportId, `${field}.transportId`) }),
  });
}

function normalizeRequirements(value = {}) {
  assertExactKeys(value, ["features", "delivery", "connection"], "requirements");
  if (value.delivery !== undefined && !DELIVERY_MODES.has(value.delivery)) {
    throw new TypeError("requirements.delivery is unsupported.");
  }
  if (value.connection !== undefined && !CONNECTION_MODES.has(value.connection)) {
    throw new TypeError("requirements.connection is unsupported.");
  }
  return Object.freeze({
    features: normalizeIdentifierList(value.features, "requirements.features"),
    ...(value.delivery === undefined ? {} : { delivery: value.delivery }),
    ...(value.connection === undefined ? {} : { connection: value.connection }),
  });
}

function blocked(stage, error) {
  return Object.freeze({
    status: "blocked",
    stage,
    reasonCode: error.reasonCode || "model_provider_invalid",
    message: error.message,
  });
}

function requireProvider(providers, providerId) {
  const provider = providers.get(providerId);
  if (!provider) throw new ModelProviderBlock("provider_missing", `Model provider ${providerId} is not registered.`);
  return provider;
}

function matchingTransportSelection(selections, providerId) {
  for (const [source, selection] of selections) {
    if (selection?.providerId === providerId && selection.transportId) return { source, transportId: selection.transportId };
  }
  return null;
}

export function createModelProviderRuntime({
  processDefault,
  maxProviders = DEFAULT_MAX_PROVIDERS,
  maxModelsPerProvider = DEFAULT_MAX_MODELS_PER_PROVIDER,
  maxTransportsPerProvider = DEFAULT_MAX_TRANSPORTS_PER_PROVIDER,
  maxProviderChars = DEFAULT_MAX_PROVIDER_CHARS,
} = {}) {
  const limits = { maxProviders, maxModelsPerProvider, maxTransportsPerProvider, maxProviderChars };
  for (const [field, value] of Object.entries(limits)) assertPositiveInteger(value, field);

  const providers = new Map();
  let currentProcessDefault = normalizeSelection(processDefault, "processDefault");
  let registrationCount = 0;
  let replacementCount = 0;
  let resolutionCount = 0;
  let blockedResolutionCount = 0;

  function registerProvider(value) {
    const provider = normalizeProvider(value, limits);
    const existing = providers.get(provider.id);
    if (existing) {
      if (existing.revision === provider.revision) {
        if (JSON.stringify(existing) !== JSON.stringify(provider)) {
          throw new ModelProviderBlock(
            "provider_revision_conflict",
            `Provider revision ${provider.revision} is already registered with different content.`,
          );
        }
        return Object.freeze({ id: provider.id, revision: provider.revision, status: "already_registered" });
      }
      replacementCount += 1;
    } else if (providers.size >= maxProviders) {
      throw new ModelProviderBlock("provider_capacity", `Model provider registry is limited to ${maxProviders} entries.`);
    }
    providers.set(provider.id, provider);
    registrationCount += 1;
    return Object.freeze({
      id: provider.id,
      revision: provider.revision,
      status: existing ? "replaced" : "registered",
    });
  }

  function configureProcessDefault(value) {
    currentProcessDefault = normalizeSelection(value, "processDefault");
    return currentProcessDefault;
  }

  function resolve({ agentModel, runDefault, requirements = {} } = {}) {
    try {
      const selections = [
        ["agent", normalizeSelection(agentModel, "agentModel")],
        ["run-default", normalizeSelection(runDefault, "runDefault")],
        ["process-default", currentProcessDefault],
      ];
      const modelSelection = selections.find(([, selection]) => selection);
      if (!modelSelection) {
        throw new ModelProviderBlock("model_default_missing", "No agent, run, or process model selection is configured.");
      }
      const [selectionSource, selection] = modelSelection;
      const provider = requireProvider(providers, selection.providerId);
      const modelId = selection.modelId || provider.defaultModelId;
      if (!modelId) {
        throw new ModelProviderBlock("model_default_missing", `Provider ${provider.id} has no default model.`);
      }
      const model = provider.models.find((candidate) => candidate.id === modelId);
      if (!model) throw new ModelProviderBlock("model_missing", `Model ${provider.id}:${modelId} is not registered.`);

      const safeRequirements = normalizeRequirements(requirements);
      const missingFeatures = safeRequirements.features.filter((feature) => !model.features.includes(feature));
      if (missingFeatures.length) {
        throw new ModelProviderBlock(
          "model_features_missing",
          `Model ${provider.id}:${model.id} lacks required features: ${missingFeatures.join(", ")}.`,
        );
      }

      const explicitTransport = matchingTransportSelection(selections, provider.id);
      const transportId = explicitTransport?.transportId || provider.defaultTransportId;
      const transport = provider.transports.find((candidate) => candidate.id === transportId);
      if (!transport) {
        throw new ModelProviderBlock("transport_missing", `Transport ${provider.id}:${transportId} is not registered.`);
      }
      if (safeRequirements.delivery && safeRequirements.delivery !== transport.delivery) {
        throw new ModelProviderBlock(
          "transport_delivery_mismatch",
          `Transport ${provider.id}:${transport.id} does not provide ${safeRequirements.delivery} delivery.`,
        );
      }
      if (safeRequirements.connection && safeRequirements.connection !== transport.connection) {
        throw new ModelProviderBlock(
          "transport_connection_mismatch",
          `Transport ${provider.id}:${transport.id} does not provide a ${safeRequirements.connection} connection.`,
        );
      }

      resolutionCount += 1;
      return Object.freeze({
        status: "ready",
        provider: Object.freeze({
          id: provider.id,
          revision: provider.revision,
          adapterId: provider.adapterId,
        }),
        model: Object.freeze({
          id: model.id,
          features: model.features,
          source: selection.modelId ? selectionSource : "provider-default",
        }),
        transport: Object.freeze({
          id: transport.id,
          delivery: transport.delivery,
          connection: transport.connection,
          source: explicitTransport?.source || "provider-default",
        }),
        evidence: Object.freeze({
          providerSelectionSource: selectionSource,
          requiredFeatures: safeRequirements.features,
          executionOwner: "running-agents-adapter",
          providerExecutionStatus: "unverified",
        }),
      });
    } catch (error) {
      blockedResolutionCount += 1;
      const failure = error instanceof ModelProviderBlock
        ? error
        : new ModelProviderBlock("model_provider_invalid", error instanceof Error ? error.message : String(error));
      return blocked("resolve", failure);
    }
  }

  function removeProvider({ providerId, revision } = {}) {
    const safeProviderId = assertIdentifier(providerId, "providerId");
    const provider = requireProvider(providers, safeProviderId);
    if (revision !== undefined && assertIdentifier(revision, "revision") !== provider.revision) {
      throw new ModelProviderBlock("provider_revision_stale", `Provider ${safeProviderId} is not at the requested revision.`);
    }
    const removed = providers.delete(safeProviderId);
    if (currentProcessDefault?.providerId === safeProviderId) currentProcessDefault = undefined;
    return removed;
  }

  function stats() {
    return Object.freeze({
      providers: providers.size,
      processDefaultConfigured: Boolean(currentProcessDefault),
      registrationCount,
      replacementCount,
      resolutionCount,
      blockedResolutionCount,
      ...limits,
    });
  }

  return Object.freeze({ registerProvider, configureProcessDefault, resolve, removeProvider, stats });
}

export const MODEL_PROVIDER_DEFAULTS = Object.freeze({
  maxProviders: DEFAULT_MAX_PROVIDERS,
  maxModelsPerProvider: DEFAULT_MAX_MODELS_PER_PROVIDER,
  maxTransportsPerProvider: DEFAULT_MAX_TRANSPORTS_PER_PROVIDER,
  maxProviderChars: DEFAULT_MAX_PROVIDER_CHARS,
});
