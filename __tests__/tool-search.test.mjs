import test from "node:test";
import assert from "node:assert/strict";

import { createToolSearchRuntime, TOOL_SEARCH_DEFAULTS } from "../agent-api/src/tool-search.js";

const CLIENT_CAPABILITIES = Object.freeze({
  toolSearch: true,
  clientSearch: true,
  hostedSearch: false,
  namespaces: true,
});

const HOSTED_CAPABILITIES = Object.freeze({
  toolSearch: true,
  clientSearch: false,
  hostedSearch: true,
  namespaces: true,
});

const ZERO_COST = Object.freeze({
  model: "none",
  prompt_tokens: 0,
  completion_tokens: 0,
  cache_hits: 0,
  estimated_cost_usd: 0,
});

function tool(name, overrides = {}) {
  return {
    type: "function",
    name,
    description: `Use ${name} for granted records.`,
    deferLoading: true,
    parameters: {
      type: "object",
      properties: { record_id: { type: "string" } },
      required: ["record_id"],
      additionalProperties: false,
    },
    strict: true,
    allowedCallers: ["direct", "programmatic"],
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    sessionId: "session-a",
    catalogRevision: "catalog-v1",
    mode: "client",
    capabilities: CLIENT_CAPABILITIES,
    namespaces: [{ name: "records", description: "Read granted record sources." }],
    tools: [
      tool("health_check", {
        description: "Read runtime health.",
        deferLoading: false,
        namespace: undefined,
        parameters: { type: "object", properties: {}, additionalProperties: false },
        allowedCallers: ["direct"],
      }),
      tool("read_record", { namespace: "records" }),
      tool("list_records", { namespace: "records" }),
      tool("lookup_owner", { namespace: undefined }),
    ],
    ...overrides,
  };
}

function definition(source) {
  return {
    type: source.type,
    name: source.name,
    description: source.description,
    ...(source.namespace ? { namespace: source.namespace } : {}),
    parameters: source.parameters,
    strict: source.strict,
    allowedCallers: source.allowedCallers,
  };
}

test("loads only selected deferred definitions and leaves the initial context stable", async () => {
  const adapterCalls = [];
  const runtime = createToolSearchRuntime({
    searchDeferredTools: async (input) => {
      adapterCalls.push(input);
      return { toolNames: ["read_record"], costLog: ZERO_COST };
    },
  });
  const opened = runtime.open(request());

  assert.equal(opened.status, "ready");
  assert.deepEqual(opened.initialContext.directTools.map((item) => item.name), ["health_check"]);
  assert.deepEqual(opened.initialContext.deferredSurfaces, [
    { type: "namespace", name: "records", description: "Read granted record sources.", toolCount: 2 },
    { type: "function", name: "lookup_owner", description: "Use lookup_owner for granted records." },
  ]);
  assert.equal(JSON.stringify(opened.initialContext.deferredSurfaces).includes("properties"), false);
  assert.deepEqual(opened.adapterRequest.tools.map((item) => item.name), ["health_check"]);
  const prefixBefore = runtime.initialContext({ sessionId: "session-a" });

  const resolved = await runtime.resolveClient({
    sessionId: "session-a",
    eventId: "search-event-1",
    providerCallId: "provider-call-1",
    query: "find one record",
    limit: 2,
  });

  assert.equal(resolved.status, "completed");
  assert.deepEqual(resolved.evidence.loadedToolNames, ["read_record"]);
  assert.equal(resolved.output.tools[0].parameters.properties.record_id.type, "string");
  assert.equal(resolved.evidence.initialPrefixMutation, false);
  assert.equal(runtime.initialContext({ sessionId: "session-a" }), prefixBefore);
  assert.equal(adapterCalls[0].candidates.every((candidate) => !("parameters" in candidate)), true);
  assert.deepEqual(adapterCalls[0].candidates.map((candidate) => candidate.name), [
    "read_record",
    "list_records",
    "lookup_owner",
  ]);
  assert.equal(runtime.authorize({ sessionId: "session-a", toolName: "read_record", caller: "direct" }).authorized, true);
  assert.deepEqual(
    runtime.authorize({ sessionId: "session-a", toolName: "list_records", caller: "direct" }),
    { authorized: false, reasonCode: "tool_not_loaded" },
  );
  assert.equal(runtime.authorize({ sessionId: "session-a", toolName: "health_check", caller: "direct" }).authorized, true);
});

test("requires top-level search before a programmatic caller can use a deferred tool", async () => {
  let adapterCalls = 0;
  const runtime = createToolSearchRuntime({
    searchDeferredTools: async () => {
      adapterCalls += 1;
      return { toolNames: ["read_record"], costLog: ZERO_COST };
    },
  });
  runtime.open(request());

  const prematureSearch = await runtime.resolveClient({
    sessionId: "session-a",
    eventId: "program-search",
    providerCallId: "provider-program-search",
    query: "record",
    caller: "programmatic",
  });
  assert.equal(prematureSearch.reasonCode, "top_level_search_required");
  assert.equal(adapterCalls, 0);
  assert.deepEqual(
    runtime.authorize({ sessionId: "session-a", toolName: "read_record", caller: "programmatic" }),
    { authorized: false, reasonCode: "tool_not_loaded" },
  );

  await runtime.resolveClient({
    sessionId: "session-a",
    eventId: "model-search",
    providerCallId: "provider-model-search",
    query: "record",
  });
  assert.equal(runtime.authorize({ sessionId: "session-a", toolName: "read_record", caller: "programmatic" }).authorized, true);
});

test("accepts canonical hosted output and rejects provider-invented definitions", () => {
  const runtime = createToolSearchRuntime();
  const hostedRequest = request({
    mode: "hosted",
    capabilities: HOSTED_CAPABILITIES,
  });
  const opened = runtime.open(hostedRequest);
  assert.equal(opened.status, "ready");
  assert.deepEqual(opened.adapterRequest.tools.map((item) => item.deferLoading), [false, true, true, true]);
  assert.equal(opened.adapterRequest.tools[1].parameters.properties.record_id.type, "string");
  const selected = hostedRequest.tools.find((item) => item.name === "read_record");

  const loaded = runtime.acceptHosted({
    sessionId: "session-a",
    eventId: "hosted-event-1",
    providerCallId: null,
    execution: "server",
    toolDefinitions: [definition(selected)],
    costLog: { ...ZERO_COST, model: "provider-reported-model" },
  });
  assert.equal(loaded.status, "completed");
  assert.equal(loaded.output.providerCallId, null);
  assert.equal(loaded.costLog.model, "provider-reported-model");

  const invented = runtime.acceptHosted({
    sessionId: "session-a",
    eventId: "hosted-event-2",
    providerCallId: null,
    execution: "server",
    toolDefinitions: [definition(tool("invented_tool"))],
    costLog: ZERO_COST,
  });
  assert.equal(invented.reasonCode, "definition_mismatch");
  assert.equal(invented.costLog.model, "none");
});

test("fails closed on absent capabilities or an unconfigured client adapter", () => {
  const runtime = createToolSearchRuntime();
  const unconfigured = runtime.open(request());
  assert.equal(unconfigured.reasonCode, "runtime_unconfigured");
  assert.equal(unconfigured.costLog.model, "not-run");

  const unsupported = runtime.open(request({
    sessionId: "session-b",
    capabilities: { ...CLIENT_CAPABILITIES, toolSearch: false },
  }));
  assert.equal(unsupported.reasonCode, "capability_unsupported");
  assert.equal(runtime.stats().activeSessions, 0);
});

test("bounds namespace size, result count, replay, and session lifetime", async () => {
  const oversizedNamespaceTools = Array.from(
    { length: TOOL_SEARCH_DEFAULTS.maxToolsPerNamespace + 1 },
    (_, index) => tool(`read_record_${index}`, { namespace: "records" }),
  );
  const runtime = createToolSearchRuntime({
    searchDeferredTools: async () => ({ toolNames: [], costLog: ZERO_COST }),
  });
  assert.throws(
    () => runtime.open(request({ tools: oversizedNamespaceTools })),
    /exceeds 9 tools/,
  );

  const bounded = createToolSearchRuntime({
    searchDeferredTools: async () => ({ toolNames: [], costLog: ZERO_COST }),
  });
  bounded.open(request());
  const first = await bounded.resolveClient({
    sessionId: "session-a",
    eventId: "one-use-event",
    providerCallId: "provider-one",
    query: "no match",
  });
  assert.equal(first.status, "completed");
  const replay = await bounded.resolveClient({
    sessionId: "session-a",
    eventId: "one-use-event",
    providerCallId: "provider-two",
    query: "no match",
  });
  assert.equal(replay.reasonCode, "search_replayed");
  assert.equal(bounded.close({ sessionId: "session-a" }), true);
  assert.equal(bounded.stats().activeSessions, 0);
  assert.equal(bounded.stats().closedSessions, 1);
});

test("rejects stale, duplicate, or over-limit client results", async () => {
  const cases = [
    { expected: "tool_not_deferred", toolNames: ["health_check"] },
    { expected: "search_result_invalid", toolNames: ["read_record", "read_record"] },
    { expected: "search_result_limit", toolNames: ["read_record", "list_records"] },
  ];
  for (const [index, scenario] of cases.entries()) {
    const runtime = createToolSearchRuntime({
      searchDeferredTools: async () => ({ toolNames: scenario.toolNames, costLog: ZERO_COST }),
    });
    runtime.open(request({ sessionId: `session-${index}` }));
    const result = await runtime.resolveClient({
      sessionId: `session-${index}`,
      eventId: `event-${index}`,
      providerCallId: `provider-${index}`,
      query: "bounded lookup",
      limit: index === 2 ? 1 : 2,
    });
    assert.equal(result.reasonCode, scenario.expected);
  }
});

test("does not report false zero cost after an attempted search omits usage", async () => {
  const client = createToolSearchRuntime({
    searchDeferredTools: async () => ({ toolNames: ["read_record"] }),
  });
  client.open(request());
  const missingClientCost = await client.resolveClient({
    sessionId: "session-a",
    eventId: "missing-client-cost",
    providerCallId: "provider-missing-client-cost",
    query: "record",
  });
  assert.equal(missingClientCost.reasonCode, "cost_log_missing");
  assert.equal(missingClientCost.costLog.model, "unreported");
  assert.equal(missingClientCost.costLog.prompt_tokens, null);

  const hosted = createToolSearchRuntime();
  hosted.open(request({ mode: "hosted", capabilities: HOSTED_CAPABILITIES }));
  const missingHostedCost = hosted.acceptHosted({
    sessionId: "session-a",
    eventId: "missing-hosted-cost",
    execution: "server",
    toolDefinitions: [],
  });
  assert.equal(missingHostedCost.reasonCode, "cost_log_missing");
  assert.equal(missingHostedCost.costLog.model, "unreported");
});

test("aborts a client search at the configured timeout", async () => {
  const runtime = createToolSearchRuntime({
    timeoutMs: 1,
    searchDeferredTools: async () => new Promise(() => {}),
  });
  runtime.open(request());
  const result = await runtime.resolveClient({
    sessionId: "session-a",
    eventId: "timeout-event",
    providerCallId: "provider-timeout",
    query: "record",
  });

  assert.equal(result.reasonCode, "search_timeout");
  assert.equal(result.costLog.model, "unreported");
});
