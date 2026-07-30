import assert from "node:assert/strict";
import test from "node:test";

import {
  createKnowgrphKnowledgeGraphClient,
  createKnowgrphMcpClient,
  KNOWLEDGE_GRAPH_MCP_TOOLS,
  KnowgrphMcpError,
  validateKnowledgeGraphIngestResult,
  validateKnowledgeGraphReadResult,
  validateKnowledgeGraphRequest,
} from "../src/knowgrph-mcp-client.js";

const ENDPOINT = "http://127.0.0.1:31888/mcp";
const DIGEST = "a".repeat(64);

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
  const client = createKnowgrphMcpClient({
    endpoint: ENDPOINT,
    fetchImpl: async (request) => {
      requests.push(request);
      if (request.body.method === "initialize") {
        return response({ jsonrpc: "2.0", id: request.body.id, result: {} }, "kg-session");
      }
      const structuredContent = request.body.params.name === KNOWLEDGE_GRAPH_MCP_TOOLS.ingest
        ? {
            ok: true,
            operation: "ingest",
            graphId: "workspace",
            snapshotDigest: DIGEST,
            complete: true,
            counts: { sources: 8, nodes: 24, edges: 31 },
            projection: {
              token: "projection:workspace",
              readOnly: true,
              complete: true,
              truncated: false,
              limit: 200,
              graphData: { type: "Graph", nodes: [], edges: [] },
            },
          }
        : request.body.params.name === KNOWLEDGE_GRAPH_MCP_TOOLS.query ? {
            ok: true,
            operation: "query",
            graphId: "workspace",
            snapshotDigest: DIGEST,
            results: { nodes: [], edges: [] },
          }
        : {
            ok: true,
            operation: "explain_edge",
            graphId: "workspace",
            snapshotDigest: DIGEST,
            edge: { id: "edge:entry-to-worker" },
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

test("knowledge graph methods use the three exact Knowgrph tool identities", async () => {
  assert.deepEqual(KNOWLEDGE_GRAPH_MCP_TOOLS, {
    ingest: "knowgrph.knowledge_graph.ingest",
    query: "knowgrph.knowledge_graph.query",
    explainEdge: "knowgrph.knowledge_graph.explain_edge",
  });

  const { client, requests } = createRecordingClient();
  const ingest = {
    rootPath: "/workspace",
    include: [".js", ".md"],
    maxDurationMs: 30_000,
    strict: true,
  };
  const query = {
    graphId: "workspace",
    expectedSnapshotDigest: DIGEST,
    mode: "neighbors",
    from: "node:entry",
    direction: "outgoing",
    maxDepth: 2,
  };
  const explain = {
    graphId: "workspace",
    expectedSnapshotDigest: DIGEST,
    edgeId: "edge:entry-to-worker",
  };

  await client.ingestKnowledgeGraph(ingest);
  await client.queryKnowledgeGraph(query);
  await client.explainKnowledgeGraphEdge(explain);

  const calls = requests
    .filter((request) => request.body.method === "tools/call")
    .map((request) => request.body.params);
  assert.deepEqual(
    calls.map((call) => call.name),
    [
      KNOWLEDGE_GRAPH_MCP_TOOLS.ingest,
      KNOWLEDGE_GRAPH_MCP_TOOLS.query,
      KNOWLEDGE_GRAPH_MCP_TOOLS.explainEdge,
    ],
  );
  assert.deepEqual(calls.map((call) => call.arguments), [ingest, query, explain]);
});

test("query and edge explanation require an exact lowercase SHA-256 digest", async () => {
  const { client, requests } = createRecordingClient();
  const query = {
    graphId: "workspace",
    mode: "summary",
  };
  const explain = {
    graphId: "workspace",
    edgeId: "edge:1",
  };

  for (const invoke of [
    () => client.queryKnowledgeGraph(query),
    () => client.queryKnowledgeGraph({ ...query, expectedSnapshotDigest: DIGEST.toUpperCase() }),
    () => client.explainKnowledgeGraphEdge(explain),
    () => client.explainKnowledgeGraphEdge({ ...explain, expectedSnapshotDigest: "b".repeat(63) }),
  ]) {
    await assert.rejects(
      async () => invoke(),
      (error) => error instanceof KnowgrphMcpError
        && error.code === "mcp_knowledge_graph_request_invalid"
        && error.data.fields.includes("expectedSnapshotDigest"),
    );
  }
  assert.equal(requests.length, 0, "invalid reads must fail before transport initialization");
});

test("knowledge graph request validation keeps server-owned optional fields intact", () => {
  const invocation = {
    schema: "knowgrph-knowledge-graph-invocation/v1",
    tool: "knowgrph.knowledge_graph.ingest",
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
    graphId: "workspace",
    expectedSnapshotDigest: DIGEST,
    mode: "search",
    query: "parser",
    limit: 20,
  };

  assert.equal(validateKnowledgeGraphRequest("ingest", ingest), ingest);
  assert.equal(validateKnowledgeGraphRequest("query", query), query);
  for (const invalidInvocation of [
    { ...invocation, tool: "knowgrph.knowledge_graph.query" },
    { ...invocation, action: "#source.resolved.ingest" },
    { ...invocation, routingDigest: "c".repeat(63) },
    { ...invocation, extra: true },
  ]) {
    assert.throws(
      () => validateKnowledgeGraphRequest("ingest", {
        ...ingest,
        invocation: invalidInvocation,
      }),
      (error) => error.code === "mcp_knowledge_graph_request_invalid"
        && error.data.fields.includes("invocation"),
    );
  }
  assert.throws(
    () => validateKnowledgeGraphRequest("query", { ...query, mode: "vector" }),
    (error) => error.code === "mcp_knowledge_graph_request_invalid"
      && error.data.fields.includes("mode"),
  );
  assert.throws(
    () => validateKnowledgeGraphRequest("ingest", {
      rootPath: "/workspace",
      outputPath: "/private/store/graph.json",
    }),
    (error) => error.code === "mcp_knowledge_graph_request_invalid"
      && error.data.fields.includes("outputPath"),
  );
  assert.throws(
    () => validateKnowledgeGraphRequest("query", {
      ...query,
      artifactPath: "/private/store/graph.json",
    }),
    (error) => error.code === "mcp_knowledge_graph_request_invalid"
      && error.data.fields.includes("artifactPath"),
  );
  for (const repositoryUrl of [
    "https://github.com/owner/repository/issues/1",
    "https://github.com/owner/repository?ref=main",
    "https://user@github.com/owner/repository",
    "https://github.com/owner/repository%2Fother",
  ]) {
    assert.throws(
      () => validateKnowledgeGraphRequest("ingest", { repositoryUrl }),
      (error) => error.code === "mcp_knowledge_graph_request_invalid"
        && error.data.fields.includes("repositoryUrl"),
    );
  }
});

test("knowledge graph methods reject missing operation identities before transport", async () => {
  const { client, requests } = createRecordingClient();
  await assert.rejects(
    () => client.ingestKnowledgeGraph({}),
    KnowgrphMcpError,
  );
  for (const invoke of [
    () => client.queryKnowledgeGraph({
      expectedSnapshotDigest: DIGEST,
      mode: "summary",
    }),
    () => client.explainKnowledgeGraphEdge({
      graphId: "workspace",
      expectedSnapshotDigest: DIGEST,
    }),
  ]) {
    await assert.rejects(async () => invoke(), KnowgrphMcpError);
  }
  assert.equal(requests.length, 0);
});

test("ingest exposes canonical graph and Canvas projection identity without artifact paths", () => {
  const result = {
    ok: true,
    operation: "ingest",
    graphId: "workspace",
    snapshotDigest: DIGEST,
    complete: false,
    counts: { sources: 100, nodes: 200, edges: 300, omitted: 2 },
    projection: {
      token: "projection:workspace",
      readOnly: true,
      complete: true,
      truncated: false,
      limit: 200,
      graphData: { type: "Graph", nodes: [], edges: [] },
    },
  };
  assert.equal(validateKnowledgeGraphIngestResult(result), result);

  assert.throws(
    () => validateKnowledgeGraphIngestResult({
      ...result,
      artifactPath: "/private/store/graph.json",
    }),
    (error) => error.code === "mcp_knowledge_graph_result_invalid"
      && error.data.fields.includes("artifactPath"),
  );
  assert.throws(
    () => validateKnowledgeGraphIngestResult({
      ...result,
      projection: {
        ...result.projection,
        graphData: {
          ...result.projection.graphData,
          metadata: { storePath: "/private/store/graph" },
        },
      },
    }),
    (error) => error.code === "mcp_knowledge_graph_result_invalid"
      && error.data.fields.includes("projection.graphData.metadata.storePath"),
  );
  assert.throws(
    () => validateKnowledgeGraphIngestResult({
      ...result,
      counts: { sources: 1, nodes: 2_001, edges: 0 },
      projection: {
        ...result.projection,
        graphData: {
          type: "Graph",
          nodes: Array.from({ length: 2_001 }, (_, index) => ({ id: `node:${index}` })),
          edges: [],
        },
      },
    }),
    (error) => error.code === "mcp_knowledge_graph_result_invalid"
      && error.data.fields.includes("projection.graphData.nodes"),
  );
  let nested = {};
  for (let depth = 0; depth < 26; depth += 1) nested = { nested };
  assert.throws(
    () => validateKnowledgeGraphIngestResult({
      ...result,
      projection: {
        ...result.projection,
        graphData: {
          ...result.projection.graphData,
          metadata: nested,
        },
      },
    }),
    (error) => error.code === "mcp_knowledge_graph_result_invalid"
      && error.data.fields.some((field) => field.endsWith(".depth")),
  );
  assert.throws(
    () => validateKnowledgeGraphIngestResult({
      ...result,
      projection: {
        ...result.projection,
        graphData: {
          ...result.projection.graphData,
          metadata: { RootPath: "/private/store" },
        },
      },
    }),
    (error) => error.code === "mcp_knowledge_graph_result_invalid"
      && error.data.fields.includes("projection.graphData.metadata.RootPath"),
  );
});

test("read results must echo the requested graph and snapshot identity", () => {
  const request = {
    graphId: "workspace",
    expectedSnapshotDigest: DIGEST,
    mode: "summary",
  };
  const result = {
    ok: true,
    operation: "query",
    graphId: request.graphId,
    snapshotDigest: request.expectedSnapshotDigest,
    graph: { nodes: 1, edges: 0 },
  };
  assert.equal(validateKnowledgeGraphReadResult("query", request, result), result);
  assert.throws(
    () => validateKnowledgeGraphReadResult("query", request, {
      ...result,
      graphId: "other",
      snapshotDigest: "b".repeat(64),
      metadata: { artifactPath: "/private/graph.json" },
    }),
    (error) => error.code === "mcp_knowledge_graph_result_invalid"
      && error.data.fields.includes("graphId")
      && error.data.fields.includes("snapshotDigest")
      && error.data.fields.includes("metadata.artifactPath"),
  );
});

test("local client snapshots a request before the asynchronous transport boundary", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let sent;
  const client = createKnowgrphKnowledgeGraphClient({
    callTool: async (_name, input) => {
      await blocked;
      sent = input;
      return {
        ok: true,
        operation: "query",
        graphId: "workspace",
        snapshotDigest: DIGEST,
      };
    },
  });
  const input = {
    graphId: "workspace",
    expectedSnapshotDigest: DIGEST,
    mode: "summary",
  };
  const pending = client.queryKnowledgeGraph(input);
  input.expectedSnapshotDigest = "b".repeat(64);
  input.artifactPath = "/private/graph.json";
  release();
  await pending;
  assert.deepEqual(sent, {
    graphId: "workspace",
    expectedSnapshotDigest: DIGEST,
    mode: "summary",
  });
});

test("generic HTTP client refuses filesystem-scoped graph calls on a remote endpoint", async () => {
  let requests = 0;
  const client = createKnowgrphMcpClient({
    endpoint: "https://control.example.test/mcp",
    fetchImpl: async () => {
      requests += 1;
      throw new Error("unexpected transport");
    },
  });
  await assert.rejects(
    () => client.ingestKnowledgeGraph({ rootPath: "/workspace" }),
    (error) => error.code === "mcp_knowledge_graph_local_transport_required",
  );
  assert.equal(requests, 0);
});
