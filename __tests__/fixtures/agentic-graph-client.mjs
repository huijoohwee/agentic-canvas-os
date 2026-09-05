import { createHash } from "node:crypto";
import {
  createAgenticGraphMcpClient, AGENTIC_GRAPH_MCP_TOOLS,
} from "../../src/agentic-graph-mcp-client.js";

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

export { DIGEST, GRAPH_ID, OTHER_GRAPH_ID, PROJECTION_TOKEN, EDGE_ID, RESULT_SCHEMAS, queryPayload, createRecordingClient };
