import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createAgenticGraphClient,
  createAgenticGraphMcpClient,
  AGENTIC_GRAPH_MCP_TOOLS,
  AgenticGraphMcpError,
  validateAgenticGraphIngestResult,
  validateAgenticGraphReadResult,
  validateAgenticGraphRequest,
} from "../src/agentic-graph-mcp-client.js";

const ENDPOINT = "http://127.0.0.1:31888/mcp";
const DIGEST = "a".repeat(64);
const GRAPH_ID = `kg:graph:${"1".repeat(32)}`;
const OTHER_GRAPH_ID = `kg:graph:${"2".repeat(32)}`;
const PROJECTION_TOKEN = `kg:projection:${"3".repeat(24)}`;
const EDGE_ID = `kg:edge:${"4".repeat(28)}`;
const SOURCE_NODE_ID = "kg:source-file:source";
const TARGET_NODE_ID = "kg:syntax-node:target";
const RESULT_SCHEMAS = {
  ingest: "agentic-graph-agent-graph-ingest/v1",
  parser_generate: "agentic-graph-agent-graph-parser-generate/v1",
  query: "agentic-graph-agent-graph-query/v1",
  explain_edge: "agentic-graph-agent-graph-explain-edge/v1",
};
const stableValue = (value) => (
  Array.isArray(value)
    ? value.map(stableValue)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
      : value
);
const parserDigest = (descriptors) => createHash("sha256")
  .update(`${JSON.stringify(stableValue(descriptors))}\n`)
  .digest("hex");
const sourceNode = () => ({
  id: SOURCE_NODE_ID,
  label: "source.ts",
  type: "SourceFile",
  properties: { "corpus:sourcePath": "source.ts" },
});
const targetNode = () => ({
  id: TARGET_NODE_ID,
  label: "target",
  type: "SyntaxNode",
  properties: { "corpus:sourcePath": "source.ts" },
});
const graphEdge = () => ({
  id: EDGE_ID,
  source: SOURCE_NODE_ID,
  target: TARGET_NODE_ID,
  label: "containsSyntaxNode",
  properties: { "evidence:sourcePath": "source.ts" },
});
const retrieval = (mode = "lexical-graph") => ({ mode, vectorStore: false });
const cost = () => ({ modelCalls: 0, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 });
const completeness = () => ({ complete: true, truncated: false, reason: "complete" });
const resolution = (id = SOURCE_NODE_ID) => ({ id, basis: "id", candidates: [id] });
const evidence = () => ({
  edgeId: EDGE_ID,
  sourcePath: "source.ts",
  lineStart: 1,
  lineEnd: 1,
  columnStart: 1,
  columnEnd: 2,
  excerpt: "x",
  excerptHash: "5".repeat(64),
  kind: "extracted",
  confidence: "high",
  certainty: "exact",
  ruleId: "fixture.rule",
  explanation: "Fixture evidence.",
  parserId: "fixture-parser",
  parserVersion: "1.0.0",
  parserDigest: "6".repeat(64),
  sourceDigest: "7".repeat(64),
});

function queryPayload(mode) {
  const common = { mode, snapshotDigest: DIGEST, retrieval: retrieval(), cost: cost(), completeness: completeness() };
  if (mode === "summary") {
    return {
      ...common,
      graph: { nodes: 2, edges: 1 },
      nodeTypes: { SourceFile: 1, SyntaxNode: 1 },
      edgeLabels: { containsSyntaxNode: 1 },
      sources: 1,
      repositories: 1,
      parserCoverage: { "fixture-parser": 1 },
      diagnostics: [],
    };
  }
  return {
    ...common,
    direction: "outgoing",
    resolution: resolution(),
    traversal: {
      nodeIds: [SOURCE_NODE_ID, TARGET_NODE_ID],
      edgeIds: [EDGE_ID],
      nodes: [sourceNode(), targetNode()],
      edges: [graphEdge()],
      limitTruncated: false,
      depthLimited: false,
    },
    citations: [evidence()],
  };
}

function response(body, sessionId = "") {
  return {
    status: 200,
    headers: {
      get(name) {
        if (name.toLowerCase() === "content-type") return "application/json";
        if (name.toLowerCase() === "mcp-session-id") return sessionId;
        return "";
      },
    },
    text: async () => JSON.stringify(body),
  };
}

function createRecordingClient() {
  const requests = [];
  const parserDescriptors = [{
    id: "fixture",
    kind: "fixture",
    adapter: "inventory",
    fidelity: "inventory-only",
    extensions: [".fixture"],
    basenames: [],
    basenameFamilies: [],
    priority: 10,
  }];
  const registryDigest = parserDigest(parserDescriptors);
  const client = createAgenticGraphMcpClient({
    endpoint: ENDPOINT,
    fetchImpl: async (request) => {
      requests.push(request);
      if (request.body.method === "initialize") {
        return response({ jsonrpc: "2.0", id: request.body.id, result: {} }, "kg-session");
      }
      const structuredContent = request.body.params.name === AGENTIC_GRAPH_MCP_TOOLS.ingest
        ? {
            schema: RESULT_SCHEMAS.ingest,
            ok: true,
            operation: "ingest",
            graphId: GRAPH_ID,
            snapshotDigest: DIGEST,
            parserRegistryDigest: "b".repeat(64),
            complete: true,
            counts: { sources: 8, nodes: 24, edges: 31 },
            projection: {
              token: PROJECTION_TOKEN,
              readOnly: true,
              complete: true,
              truncated: false,
              limit: 200,
              graphData: {
                context: "agentic-graph-agent-graph-projection",
                type: "Graph",
                nodes: [],
                edges: [],
              },
            },
          }
        : request.body.params.name === AGENTIC_GRAPH_MCP_TOOLS.generateParser ? {
            schema: RESULT_SCHEMAS.parser_generate,
            ok: true,
            operation: "parser_generate",
            parserRegistryDigest: registryDigest,
            parserRegistry: {
              schema: "agentic-graph-agent-graph-parser-registry/v2",
              digest: registryDigest,
              descriptors: parserDescriptors,
            },
          }
        : request.body.params.name === AGENTIC_GRAPH_MCP_TOOLS.query ? {
            schema: RESULT_SCHEMAS.query,
            ok: true,
            operation: "query",
            graphId: GRAPH_ID,
            ...queryPayload(request.body.params.arguments.mode),
          }
        : {
            schema: RESULT_SCHEMAS.explain_edge,
            ok: true,
            operation: "explain_edge",
            graphId: GRAPH_ID,
            snapshotDigest: DIGEST,
            edge: graphEdge(),
            source: sourceNode(),
            target: targetNode(),
            evidence: {
              kind: "extracted",
              ruleId: "fixture.rule",
              explanation: "Fixture evidence.",
              parserId: "fixture-parser",
              parserVersion: "1.0.0",
              parserDigest: "6".repeat(64),
              sourcePath: "source.ts",
              sourceDigest: "7".repeat(64),
              sourceSpan: { lineStart: 1, lineEnd: 1, columnStart: 1, columnEnd: 2 },
              excerpt: "x",
              excerptHash: "5".repeat(64),
              confidence: "high",
              certainty: "exact",
              premiseEdgeIds: [],
              candidateCount: 1,
              candidateIds: [],
            },
            retrieval: retrieval("direct-edge-id"),
            cost: cost(),
          };
      return response({
        jsonrpc: "2.0",
        id: request.body.id,
        result: { structuredContent },
      });
    },
  });
  return { client, requests };
}

test("agentic graph methods use the four exact agentic-graph tool identities", async () => {
  assert.deepEqual(AGENTIC_GRAPH_MCP_TOOLS, {
    ingest: "agentic-graph.agent_graph.ingest",
    generateParser: "agentic-graph.agent_graph.parser_generate",
    query: "agentic-graph.agent_graph.query",
    explainEdge: "agentic-graph.agent_graph.explain_edge",
  });

  const { client, requests } = createRecordingClient();
  const ingest = {
    rootPath: "/workspace",
    include: [".js", ".md"],
    maxDurationMs: 30_000,
    strict: true,
  };
  const query = {
    graphId: GRAPH_ID,
    expectedSnapshotDigest: DIGEST,
    mode: "neighbors",
    from: "node:entry",
    direction: "outgoing",
    maxDepth: 2,
  };
  const explain = {
    graphId: GRAPH_ID,
    expectedSnapshotDigest: DIGEST,
    edgeId: EDGE_ID,
  };
  const parser = {
    descriptors: [{
      id: "fixture",
      kind: "fixture",
      adapter: "inventory",
      fidelity: "inventory-only",
      extensions: [".fixture"],
    }],
  };

  await client.ingestAgenticGraph(ingest);
  await client.generateAgenticGraphParser(parser);
  await client.queryAgenticGraph(query);
  await client.explainAgenticGraphEdge(explain);

  const calls = requests
    .filter((request) => request.body.method === "tools/call")
    .map((request) => request.body.params);
  assert.deepEqual(
    calls.map((call) => call.name),
    [
      AGENTIC_GRAPH_MCP_TOOLS.ingest,
      AGENTIC_GRAPH_MCP_TOOLS.generateParser,
      AGENTIC_GRAPH_MCP_TOOLS.query,
      AGENTIC_GRAPH_MCP_TOOLS.explainEdge,
    ],
  );
  assert.deepEqual(calls.map((call) => call.arguments), [ingest, parser, query, explain]);
});

test("query and edge explanation require an exact lowercase SHA-256 digest", async () => {
  const { client, requests } = createRecordingClient();
  const query = {
    graphId: GRAPH_ID,
    mode: "summary",
  };
  const explain = {
    graphId: GRAPH_ID,
    edgeId: EDGE_ID,
  };

  for (const invoke of [
    () => client.queryAgenticGraph(query),
    () => client.queryAgenticGraph({ ...query, expectedSnapshotDigest: DIGEST.toUpperCase() }),
    () => client.explainAgenticGraphEdge(explain),
    () => client.explainAgenticGraphEdge({ ...explain, expectedSnapshotDigest: "b".repeat(63) }),
  ]) {
    await assert.rejects(
      async () => invoke(),
      (error) => error instanceof AgenticGraphMcpError
        && error.code === "mcp_agentic_graph_request_invalid"
        && error.data.fields.includes("expectedSnapshotDigest"),
    );
  }
  assert.equal(requests.length, 0, "invalid reads must fail before transport initialization");
});

test("agentic graph request validation keeps server-owned optional fields intact", () => {
  const invocation = {
    schema: "agentic-graph-agent-graph-invocation/v1",
    tool: "agentic-graph.agent_graph.ingest",
    action: "/source.resolved.ingest",
    semantics: ["#source-backed"],
    bindings: ["@working-directory"],
    sourceRevision: "a".repeat(40),
    catalogDigest: "b".repeat(64),
    routingSchema: "agentic-canvas-os-docs-routing/v1",
    routingDigest: "c".repeat(64),
  };
  const ingest = {
    rootPath: "/workspace",
    maxFiles: 100_000,
    useCache: false,
    invocation,
  };
  const query = {
    graphId: GRAPH_ID,
    expectedSnapshotDigest: DIGEST,
    mode: "search",
    query: "parser",
    limit: 20,
  };

  assert.equal(validateAgenticGraphRequest("ingest", ingest), ingest);
  assert.equal(validateAgenticGraphRequest("query", query), query);
  for (const invalidInvocation of [
    { ...invocation, tool: "agentic-graph.agent_graph.query" },
    { ...invocation, action: "#source.resolved.ingest" },
    { ...invocation, routingDigest: "c".repeat(63) },
    { ...invocation, extra: true },
  ]) {
    assert.throws(
      () => validateAgenticGraphRequest("ingest", {
        ...ingest,
        invocation: invalidInvocation,
      }),
      (error) => error.code === "mcp_agentic_graph_request_invalid"
        && error.data.fields.includes("invocation"),
    );
  }
  assert.throws(
    () => validateAgenticGraphRequest("query", { ...query, mode: "vector" }),
    (error) => error.code === "mcp_agentic_graph_request_invalid"
      && error.data.fields.includes("mode"),
  );
  assert.throws(
    () => validateAgenticGraphRequest("ingest", {
      rootPath: "/workspace",
      outputPath: "/private/store/graph.json",
    }),
    (error) => error.code === "mcp_agentic_graph_request_invalid"
      && error.data.fields.includes("outputPath"),
  );
  assert.throws(
    () => validateAgenticGraphRequest("query", {
      ...query,
      artifactPath: "/private/store/graph.json",
    }),
    (error) => error.code === "mcp_agentic_graph_request_invalid"
      && error.data.fields.includes("artifactPath"),
  );
  for (const repositoryUrl of [
    "https://code.example.test/group/project",
    "https://source.example.test/nested/group/project.git",
  ]) {
    assert.equal(validateAgenticGraphRequest("ingest", { repositoryUrl }).repositoryUrl, repositoryUrl);
  }
  for (const repositoryUrl of [
    "http://code.example.test/group/project",
    "https://code.example.test/group/project?ref=main",
    "https://user@code.example.test/group/project",
    "https://source.example.test:8443/nested/group/project.git",
    "https://code.example.test/group/project#readme",
    "https://code.example.test/",
    " https://code.example.test/group/project",
  ]) {
    assert.throws(
      () => validateAgenticGraphRequest("ingest", { repositoryUrl }),
      (error) => error.code === "mcp_agentic_graph_request_invalid"
        && error.data.fields.includes("repositoryUrl"),
    );
  }
});

test("agentic graph methods reject missing operation identities before transport", async () => {
  const { client, requests } = createRecordingClient();
  await assert.rejects(
    () => client.ingestAgenticGraph({}),
    AgenticGraphMcpError,
  );
  for (const invoke of [
    () => client.queryAgenticGraph({
      expectedSnapshotDigest: DIGEST,
      mode: "summary",
    }),
    () => client.explainAgenticGraphEdge({
      graphId: GRAPH_ID,
      expectedSnapshotDigest: DIGEST,
    }),
  ]) {
    await assert.rejects(async () => invoke(), AgenticGraphMcpError);
  }
  assert.equal(requests.length, 0);
});

test("ingest exposes canonical graph and Canvas projection identity without artifact paths", () => {
  const result = {
    schema: RESULT_SCHEMAS.ingest,
    ok: true,
    operation: "ingest",
    graphId: GRAPH_ID,
    snapshotDigest: DIGEST,
    parserRegistryDigest: "b".repeat(64),
    complete: false,
    counts: { sources: 100, nodes: 200, edges: 300, omitted: 2 },
    projection: {
      token: PROJECTION_TOKEN,
      readOnly: true,
      complete: true,
      truncated: false,
      limit: 200,
      graphData: {
        context: "agentic-graph-agent-graph-projection",
        type: "Graph",
        nodes: [],
        edges: [],
      },
    },
  };
  assert.equal(validateAgenticGraphIngestResult(result), result);

  for (const invalid of [
    { ...result, schema: "agentic-graph-agent-graph-ingest/v2" },
    { ...result, graphId: "workspace" },
    { ...result, projection: { ...result.projection, token: "projection:workspace" } },
    {
      ...result,
      projection: {
        ...result.projection,
        graphData: { ...result.projection.graphData, type: "DirectedGraph" },
      },
    },
  ]) {
    assert.throws(
      () => validateAgenticGraphIngestResult(invalid),
      (error) => error.code === "mcp_agentic_graph_result_invalid",
    );
  }

  assert.throws(
    () => validateAgenticGraphIngestResult({
      ...result,
      artifactPath: "/private/store/graph.json",
    }),
    (error) => error.code === "mcp_agentic_graph_result_invalid"
      && error.data.fields.includes("artifactPath"),
  );
  assert.throws(
    () => validateAgenticGraphIngestResult({
      ...result,
      projection: {
        ...result.projection,
        graphData: {
          ...result.projection.graphData,
          metadata: { storePath: "/private/store/graph" },
        },
      },
    }),
    (error) => error.code === "mcp_agentic_graph_result_invalid"
      && error.data.fields.includes("projection.graphData.metadata.storePath"),
  );
  assert.throws(
    () => validateAgenticGraphIngestResult({
      ...result,
      counts: { sources: 1, nodes: 2_001, edges: 0 },
      projection: {
        ...result.projection,
        graphData: {
          type: "Graph",
          context: "agentic-graph-agent-graph-projection",
          nodes: Array.from({ length: 2_001 }, (_, index) => ({ id: `node:${index}` })),
          edges: [],
        },
      },
    }),
    (error) => error.code === "mcp_agentic_graph_result_invalid"
      && error.data.fields.includes("projection.graphData.nodes"),
  );
  let nested = {};
  for (let depth = 0; depth < 26; depth += 1) nested = { nested };
  assert.throws(
    () => validateAgenticGraphIngestResult({
      ...result,
      projection: {
        ...result.projection,
        graphData: {
          ...result.projection.graphData,
          metadata: nested,
        },
      },
    }),
    (error) => error.code === "mcp_agentic_graph_result_invalid"
      && error.data.fields.some((field) => field.endsWith(".depth")),
  );
  assert.throws(
    () => validateAgenticGraphIngestResult({
      ...result,
      projection: {
        ...result.projection,
        graphData: {
          ...result.projection.graphData,
          metadata: { RootPath: "/private/store" },
        },
      },
    }),
    (error) => error.code === "mcp_agentic_graph_result_invalid"
      && error.data.fields.includes("projection.graphData.metadata.RootPath"),
  );
});

test("read results must echo the requested graph and snapshot identity", () => {
  const request = {
    graphId: GRAPH_ID,
    expectedSnapshotDigest: DIGEST,
    mode: "summary",
  };
  const result = {
    schema: RESULT_SCHEMAS.query,
    ok: true,
    operation: "query",
    graphId: request.graphId,
    ...queryPayload("summary"),
  };
  assert.equal(validateAgenticGraphReadResult("query", request, result), result);
  assert.throws(
    () => validateAgenticGraphReadResult("query", request, {
      ...result,
      graphId: OTHER_GRAPH_ID,
      snapshotDigest: "b".repeat(64),
      metadata: { artifactPath: "/private/graph.json" },
    }),
    (error) => error.code === "mcp_agentic_graph_result_invalid"
      && error.data.fields.includes("graphId")
      && error.data.fields.includes("snapshotDigest")
      && error.data.fields.includes("metadata.artifactPath"),
  );
});

test("read results require versioned operation-specific query and explanation payloads", () => {
  const summaryRequest = {
    graphId: GRAPH_ID,
    expectedSnapshotDigest: DIGEST,
    mode: "summary",
  };
  const validSummary = {
    schema: RESULT_SCHEMAS.query,
    ok: true,
    operation: "query",
    graphId: GRAPH_ID,
    ...queryPayload("summary"),
  };
  assert.equal(validateAgenticGraphReadResult("query", summaryRequest, validSummary), validSummary);
  for (const invalid of [
    { ...validSummary, schema: "agentic-graph-agent-graph-query/v2" },
    {
      schema: RESULT_SCHEMAS.query,
      ok: true,
      operation: "query",
      graphId: GRAPH_ID,
      snapshotDigest: DIGEST,
    },
    { ...validSummary, mode: "search" },
  ]) {
    assert.throws(
      () => validateAgenticGraphReadResult("query", summaryRequest, invalid),
      (error) => error.code === "mcp_agentic_graph_result_invalid"
        && error.data.fields.some((field) => ["schema", "payload"].includes(field)),
    );
  }

  const explainRequest = {
    graphId: GRAPH_ID,
    expectedSnapshotDigest: DIGEST,
    edgeId: EDGE_ID,
  };
  assert.throws(
    () => validateAgenticGraphReadResult("explain_edge", explainRequest, {
      schema: RESULT_SCHEMAS.explain_edge,
      ok: true,
      operation: "explain_edge",
      graphId: GRAPH_ID,
      snapshotDigest: DIGEST,
      edge: { id: EDGE_ID },
    }),
    (error) => error.code === "mcp_agentic_graph_result_invalid"
      && error.data.fields.includes("payload"),
  );
});

test("typed agentic graph failures preserve server code, message, and details", async () => {
  const failure = {
    schema: RESULT_SCHEMAS.query,
    ok: false,
    operation: "query",
    error: {
      code: "stale_snapshot_digest",
      message: "The snapshot digest is stale.",
      details: { expectedSnapshotDigest: DIGEST, actualSnapshotDigest: "b".repeat(64) },
    },
  };
  const client = createAgenticGraphClient({ callTool: async () => failure });
  await assert.rejects(
    () => client.queryAgenticGraph({
      graphId: GRAPH_ID,
      expectedSnapshotDigest: DIGEST,
      mode: "summary",
    }),
    (error) => error instanceof AgenticGraphMcpError
      && error.code === failure.error.code
      && error.message === failure.error.message
      && error.data.actualSnapshotDigest === failure.error.details.actualSnapshotDigest,
  );
  assert.throws(
    () => validateAgenticGraphReadResult("query", {
      graphId: GRAPH_ID,
      expectedSnapshotDigest: DIGEST,
      mode: "summary",
    }, { ...failure, schema: "wrong" }),
    (error) => error.code === "mcp_agentic_graph_result_invalid"
      && error.data.fields.includes("schema"),
  );
});

test("local client snapshots a request before the asynchronous transport boundary", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let sent;
  const client = createAgenticGraphClient({
    callTool: async (_name, input) => {
      await blocked;
      sent = input;
      return {
        schema: RESULT_SCHEMAS.query,
        ok: true,
        operation: "query",
        graphId: GRAPH_ID,
        ...queryPayload("summary"),
      };
    },
  });
  const input = {
    graphId: GRAPH_ID,
    expectedSnapshotDigest: DIGEST,
    mode: "summary",
  };
  const pending = client.queryAgenticGraph(input);
  input.expectedSnapshotDigest = "b".repeat(64);
  input.artifactPath = "/private/graph.json";
  release();
  await pending;
  assert.deepEqual(sent, {
    graphId: GRAPH_ID,
    expectedSnapshotDigest: DIGEST,
    mode: "summary",
  });
});

test("generic HTTP client refuses filesystem-scoped graph calls on a remote endpoint", async () => {
  let requests = 0;
  const client = createAgenticGraphMcpClient({
    endpoint: "https://control.example.test/mcp",
    fetchImpl: async () => {
      requests += 1;
      throw new Error("unexpected transport");
    },
  });
  await assert.rejects(
    () => client.ingestAgenticGraph({ rootPath: "/workspace" }),
    (error) => error.code === "mcp_agentic_graph_local_transport_required",
  );
  await assert.rejects(
    () => client.generateAgenticGraphParser({
      descriptors: [{
        id: "fixture",
        kind: "fixture",
        adapter: "inventory",
        fidelity: "inventory-only",
        extensions: [".fixture"],
      }],
    }),
    (error) => error.code === "mcp_agentic_graph_local_transport_required",
  );
  assert.equal(requests, 0);
});
