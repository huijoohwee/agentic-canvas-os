import test from "node:test";
import assert from "node:assert/strict";

import { resolveModelProviderEnvironment } from "../agent-api/src/model-config.js";
import {
  ModelProviderBlock,
  createModelProviderRuntime,
} from "../agent-api/src/model-providers.js";

function provider(overrides = {}) {
  return {
    id: "primary-provider",
    revision: "provider-v1",
    adapterId: "primary-adapter",
    models: [
      { id: "balanced-model", features: ["tools", "structured-output"] },
      { id: "fast-model", features: ["tools"] },
    ],
    transports: [
      { id: "request", delivery: "complete", connection: "per-run" },
      { id: "socket", delivery: "incremental", connection: "reusable" },
    ],
    defaultModelId: "balanced-model",
    defaultTransportId: "request",
    ...overrides,
  };
}

test("resolves a revision-fenced process default without executing a provider", () => {
  const runtime = createModelProviderRuntime({
    processDefault: { providerId: "primary-provider" },
  });
  assert.equal(runtime.registerProvider(provider()).status, "registered");
  assert.equal(runtime.registerProvider(provider()).status, "already_registered");

  const result = runtime.resolve({ requirements: { features: ["tools"] } });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.provider, {
    id: "primary-provider",
    revision: "provider-v1",
    adapterId: "primary-adapter",
  });
  assert.deepEqual(result.model, {
    id: "balanced-model",
    features: ["tools", "structured-output"],
    source: "provider-default",
  });
  assert.deepEqual(result.transport, {
    id: "request",
    delivery: "complete",
    connection: "per-run",
    source: "provider-default",
  });
  assert.equal(result.evidence.providerExecutionStatus, "unverified");
  assert.equal(Object.isFrozen(result), true);
});

test("uses agent selection before run and process defaults", () => {
  const runtime = createModelProviderRuntime({
    processDefault: { providerId: "primary-provider", modelId: "balanced-model" },
  });
  runtime.registerProvider(provider());

  const agent = runtime.resolve({
    agentModel: { providerId: "primary-provider", modelId: "fast-model" },
    runDefault: { providerId: "primary-provider", modelId: "balanced-model" },
  });
  assert.equal(agent.model.id, "fast-model");
  assert.equal(agent.model.source, "agent");
  assert.equal(agent.evidence.providerSelectionSource, "agent");

  const run = runtime.resolve({
    runDefault: { providerId: "primary-provider", modelId: "fast-model" },
  });
  assert.equal(run.model.id, "fast-model");
  assert.equal(run.model.source, "run-default");
});

test("selects transport independently and enforces delivery and connection requirements", () => {
  const runtime = createModelProviderRuntime({
    processDefault: { providerId: "primary-provider", transportId: "request" },
  });
  runtime.registerProvider(provider());

  const result = runtime.resolve({
    agentModel: { providerId: "primary-provider", modelId: "fast-model" },
    runDefault: { providerId: "primary-provider", transportId: "socket" },
    requirements: { delivery: "incremental", connection: "reusable" },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.transport.id, "socket");
  assert.equal(result.transport.source, "run-default");

  const mismatch = runtime.resolve({
    agentModel: { providerId: "primary-provider", modelId: "fast-model", transportId: "request" },
    requirements: { delivery: "incremental" },
  });
  assert.equal(mismatch.status, "blocked");
  assert.equal(mismatch.reasonCode, "transport_delivery_mismatch");
});

test("blocks missing providers, models, defaults, and required model features", () => {
  const runtime = createModelProviderRuntime();
  assert.equal(runtime.resolve().reasonCode, "model_default_missing");
  runtime.registerProvider(provider());
  assert.equal(
    runtime.resolve({ agentModel: { providerId: "missing-provider", modelId: "fast-model" } }).reasonCode,
    "provider_missing",
  );
  assert.equal(
    runtime.resolve({ agentModel: { providerId: "primary-provider", modelId: "missing-model" } }).reasonCode,
    "model_missing",
  );
  assert.equal(runtime.resolve({
    agentModel: { providerId: "primary-provider", modelId: "fast-model" },
    requirements: { features: ["structured-output"] },
  }).reasonCode, "model_features_missing");
});

test("provider revisions, capacity, bounds, and removal fail closed", () => {
  const runtime = createModelProviderRuntime({ maxProviders: 1, maxModelsPerProvider: 2 });
  runtime.registerProvider(provider());
  assert.throws(
    () => runtime.registerProvider(provider({ adapterId: "changed-without-revision" })),
    (error) => error instanceof ModelProviderBlock && error.reasonCode === "provider_revision_conflict",
  );
  assert.throws(
    () => runtime.registerProvider(provider({ id: "second-provider", revision: "second-v1" })),
    (error) => error instanceof ModelProviderBlock && error.reasonCode === "provider_capacity",
  );
  assert.throws(
    () => runtime.registerProvider(provider({
      revision: "provider-v2",
      models: [
        { id: "one", features: [] },
        { id: "two", features: [] },
        { id: "three", features: [] },
      ],
      defaultModelId: "one",
    })),
    /at most 2 entries/,
  );
  assert.equal(runtime.registerProvider(provider({ revision: "provider-v2" })).status, "replaced");
  assert.throws(
    () => runtime.removeProvider({ providerId: "primary-provider", revision: "provider-v1" }),
    (error) => error instanceof ModelProviderBlock && error.reasonCode === "provider_revision_stale",
  );
  assert.equal(runtime.removeProvider({ providerId: "primary-provider", revision: "provider-v2" }), true);
  assert.equal(runtime.stats().processDefaultConfigured, false);
});

test("environment configuration requires neutral explicit fields and never returns credentials", () => {
  const empty = resolveModelProviderEnvironment({
    SEA_LION_MODEL: "legacy-alias-must-not-configure",
    HERMES_AGENT_MODEL_PROVIDER: "legacy-alias-must-not-configure",
  });
  assert.equal(empty.ready, false);
  assert.equal(empty.providerId, "");
  assert.ok(empty.issues.includes("providerId_missing"));

  const configured = resolveModelProviderEnvironment({
    AGENT_MODEL_PROVIDER: "primary-provider",
    AGENT_MODEL_PROVIDER_REVISION: "provider-v1",
    AGENT_MODEL_ADAPTER: "primary-adapter",
    AGENT_MODEL_ENDPOINT: "https://models.example/v1/run",
    AGENT_MODEL_ID: "balanced-model",
    AGENT_MODEL_API_KEY_ENV: "PRIMARY_PROVIDER_KEY",
    AGENT_MODEL_TRANSPORT: "request",
    AGENT_MODEL_TRANSPORT_DELIVERY: "complete",
    AGENT_MODEL_TRANSPORT_CONNECTION: "per-run",
    AGENT_MODEL_FEATURES: "tools, structured-output,tools",
    PRIMARY_PROVIDER_KEY: "server-side-secret",
  });
  assert.equal(configured.ready, true);
  assert.equal(configured.apiKeyPresent, true);
  assert.deepEqual(configured.features, ["tools", "structured-output"]);
  assert.equal(configured.providerDefinition.defaultModelId, "balanced-model");
  assert.equal(JSON.stringify(configured).includes("server-side-secret"), false);
});

test("environment endpoint and transport metadata reject unsafe or unsupported values", () => {
  const invalid = resolveModelProviderEnvironment({
    AGENT_MODEL_PROVIDER: "primary-provider",
    AGENT_MODEL_PROVIDER_REVISION: "provider-v1",
    AGENT_MODEL_ADAPTER: "primary-adapter",
    AGENT_MODEL_ENDPOINT: "http://models.example/v1/run",
    AGENT_MODEL_ID: "balanced-model",
    AGENT_MODEL_API_KEY_ENV: "PRIMARY_PROVIDER_KEY",
    AGENT_MODEL_TRANSPORT: "request",
    AGENT_MODEL_TRANSPORT_DELIVERY: "chunks",
    AGENT_MODEL_TRANSPORT_CONNECTION: "forever",
  });
  assert.equal(invalid.ready, false);
  assert.ok(invalid.issues.includes("endpoint_missing"));
  assert.ok(invalid.issues.includes("delivery_unsupported"));
  assert.ok(invalid.issues.includes("connection_unsupported"));

  const local = resolveModelProviderEnvironment({
    AGENT_MODEL_PROVIDER: "local-provider",
    AGENT_MODEL_PROVIDER_REVISION: "local-v1",
    AGENT_MODEL_ADAPTER: "local-adapter",
    AGENT_MODEL_ENDPOINT: "http://127.0.0.1:4040/run",
    AGENT_MODEL_ID: "local-model",
    AGENT_MODEL_API_KEY_ENV: "LOCAL_MODEL_KEY",
    AGENT_MODEL_TRANSPORT: "local-request",
    AGENT_MODEL_TRANSPORT_DELIVERY: "complete",
    AGENT_MODEL_TRANSPORT_CONNECTION: "per-run",
  });
  assert.equal(local.ready, true);
});
