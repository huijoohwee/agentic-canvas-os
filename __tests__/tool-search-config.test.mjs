import test from "node:test";
import assert from "node:assert/strict";

import {
  createConfiguredToolSearchRuntime,
  upstreamToolSearchEnabled,
} from "../agent-api/src/tool-search-config.js";

const CAPABILITIES = Object.freeze({
  toolSearch: true,
  clientSearch: true,
  hostedSearch: false,
  namespaces: true,
});

const TOOLS = Object.freeze([
  Object.freeze({
    type: "function",
    name: "read_agentic_os_status",
    description: "Read the current status.",
    deferLoading: false,
    parameters: Object.freeze({ type: "object", properties: {}, required: [], additionalProperties: false }),
    strict: true,
    allowedCallers: Object.freeze(["direct"]),
  }),
  Object.freeze({
    type: "function",
    name: "update_agent_run_note",
    description: "Update the current run note.",
    deferLoading: true,
    parameters: Object.freeze({ type: "object", properties: {}, required: [], additionalProperties: false }),
    strict: true,
    allowedCallers: Object.freeze(["direct"]),
  }),
]);

test("upstream tool search stays disabled without a configured execution lane", () => {
  const enabled = upstreamToolSearchEnabled(
    { KNOWGRPH_MCP_ENDPOINT: "https://control.example/mcp" },
    { openAiFunctionConfig: { ready: false }, autonomousRuntimeEnvironment: { ready: false } },
  );
  const runtime = createConfiguredToolSearchRuntime(
    { KNOWGRPH_MCP_ENDPOINT: "https://control.example/mcp" },
    { openAiFunctionConfig: { ready: false }, autonomousRuntimeEnvironment: { ready: false } },
  );
  assert.equal(enabled, false);
  assert.equal(runtime.stats().clientSearchConfigured, false);
});

test("upstream tool search uses a deterministic session-catalog adapter once configured", async () => {
  const runtime = createConfiguredToolSearchRuntime(
    { KNOWGRPH_MCP_ENDPOINT: "https://control.example/mcp" },
    { openAiFunctionConfig: { ready: true }, autonomousRuntimeEnvironment: { ready: false } },
  );
  assert.equal(runtime.stats().clientSearchConfigured, true);

  const activation = runtime.open({
    sessionId: "session-1",
    catalogRevision: "catalog-v1",
    mode: "client",
    capabilities: CAPABILITIES,
    tools: TOOLS,
  });
  assert.equal(activation.status, "ready");

  const resolution = await runtime.resolveClient({
    sessionId: "session-1",
    eventId: "event-1",
    providerCallId: "provider-1",
    query: "run note update",
    limit: 1,
  });
  assert.equal(resolution.status, "completed");
  assert.deepEqual(resolution.output.tools.map((tool) => tool.name), ["update_agent_run_note"]);
});
