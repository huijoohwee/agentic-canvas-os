import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";

import {
  KNOWLEDGE_GRAPH_MCP_TOOLS,
  KNOWLEDGE_GRAPH_TOOL_DEFINITIONS,
  createKnowledgeGraphMcpHost,
} from "../src/knowledge-graph/mcp-tools.js";

test("stdio MCP exposes exactly three closed native tools backed by one runtime", async (context) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-knowledge-graph-mcp-"));
  const workspace = path.join(root, "workspace");
  const artifacts = path.join(root, "artifacts");
  mkdirSync(workspace);
  mkdirSync(artifacts);
  writeFileSync(path.join(workspace, "app.js"), "export function run() { return helper(); }\nfunction helper() { return 1; }\n");
  const client = createStdioClient(artifacts);
  context.after(() => client.close());

  await assert.rejects(
    client.request("tools/list", {}),
    (error) => error?.code === -32002,
  );
  const initialized = await client.request("initialize", {
    protocolVersion: "2099-01-01",
    capabilities: {},
    clientInfo: { name: "knowledge-graph-test", version: "1.0.0" },
  });
  assert.equal(initialized.protocolVersion, "2024-11-05");
  assert.equal(initialized.serverInfo.name, "agentic-canvas-os-knowledge-graph");
  await assert.rejects(
    client.request("tools/list", {}),
    (error) => error?.code === -32002,
  );
  client.notify("notifications/initialized", {});

  const listed = await client.request("tools/list", {});
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    Object.values(KNOWLEDGE_GRAPH_MCP_TOOLS),
  );
  assert.equal(listed.tools.length, 3);
  for (const tool of listed.tools) assert.equal(tool.inputSchema.additionalProperties, false);

  const ingested = await callTool(client, KNOWLEDGE_GRAPH_MCP_TOOLS.ingest, {
    graphId: "mcp-fixture",
    root: workspace,
  });
  assert.equal(ingested.schema, "agentic-knowledge-graph-ingest-result/v1");
  assert.match(ingested.graphDigest, /^[a-f0-9]{64}$/);

  const queried = await callTool(client, KNOWLEDGE_GRAPH_MCP_TOOLS.query, {
    graphId: ingested.graphId,
    expectedDigest: ingested.graphDigest,
    query: { operation: "match", limit: 50 },
  });
  assert.equal(queried.schema, "agentic-knowledge-graph-query-result/v1");
  assert.ok(queried.edges.length > 0);

  const explained = await callTool(client, KNOWLEDGE_GRAPH_MCP_TOOLS.explain, {
    graphId: ingested.graphId,
    expectedDigest: ingested.graphDigest,
    edgeId: queried.edges[0].id,
  });
  assert.equal(explained.edge.id, queried.edges[0].id);
  assert.equal(explained.edge.explanation, queried.edges[0].explanation);

  const failed = await client.request("tools/call", { name: "unknown.tool", arguments: {} });
  assert.equal(failed.isError, true);
  assert.equal(failed.structuredContent.code, "tool_not_found");
  assert.equal(client.stderr(), "");
});

test("tool definition export is immutable and contains no open top-level schema", () => {
  assert.equal(Object.isFrozen(KNOWLEDGE_GRAPH_TOOL_DEFINITIONS), true);
  assert.equal(KNOWLEDGE_GRAPH_TOOL_DEFINITIONS.length, 3);
  for (const definition of KNOWLEDGE_GRAPH_TOOL_DEFINITIONS) {
    assert.equal(definition.inputSchema.type, "object");
    assert.equal(definition.inputSchema.additionalProperties, false);
  }
});

test("MCP dispatch enforces every advertised closed top-level schema", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-knowledge-graph-schema-"));
  const host = createKnowledgeGraphMcpHost({ artifactRoot: root });
  const cases = [
    [KNOWLEDGE_GRAPH_MCP_TOOLS.ingest, { graphId: "fixture", root, extra: true }],
    [KNOWLEDGE_GRAPH_MCP_TOOLS.query, {
      graphId: "fixture",
      expectedDigest: "0".repeat(64),
      query: { operation: "summary" },
      extra: true,
    }],
    [KNOWLEDGE_GRAPH_MCP_TOOLS.explain, {
      graphId: "fixture",
      expectedDigest: "0".repeat(64),
      edgeId: `e:${"0".repeat(32)}`,
      extra: true,
    }],
  ];
  for (const [name, args] of cases) {
    assert.throws(
      () => host.callTool(name, args),
      (error) => error?.code === "arguments_invalid" && /unsupported fields/.test(error.message),
    );
  }
  assert.throws(
    () => host.callTool(KNOWLEDGE_GRAPH_MCP_TOOLS.ingest, {
      graphId: "fixture",
      root: "x".repeat(4097),
    }),
    (error) => error?.code === "arguments_invalid" && /too long/.test(error.message),
  );
});

async function callTool(client, name, args) {
  const result = await client.request("tools/call", { name, arguments: args });
  assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
}

function createStdioClient(artifactRoot) {
  const child = spawn(process.execPath, [
    "scripts/knowledge-graph-mcp.mjs",
    `--artifact-root=${artifactRoot}`,
  ], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity, terminal: false });
  const pending = new Map();
  let nextId = 1;
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const resolver = pending.get(message.id);
    if (!resolver) return;
    pending.delete(message.id);
    if (message.error) resolver.reject(Object.assign(new Error(message.error.message), message.error));
    else resolver.resolve(message.result);
  });
  return {
    request(method, params) {
      const id = nextId++;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return result;
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    stderr: () => stderr,
    close() {
      child.stdin.end();
      child.kill("SIGTERM");
    },
  };
}
