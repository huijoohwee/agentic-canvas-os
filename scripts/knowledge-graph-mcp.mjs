#!/usr/bin/env node

import { createInterface } from "node:readline";

import { createKnowledgeGraphMcpHost } from "../src/knowledge-graph/mcp-tools.js";

const artifactRoot = resolveArtifactRoot(process.argv.slice(2), process.env);
const host = createKnowledgeGraphMcpHost({ artifactRoot });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
let queue = Promise.resolve();
let phase = "new";

input.on("line", (line) => {
  if (!line.trim()) return;
  queue = queue.then(() => handleLine(line)).catch((error) => {
    process.stderr.write(`[knowledge-graph-mcp] ${safeMessage(error)}\n`);
  });
});

input.on("close", () => {
  queue.catch(() => {
    process.exitCode = 1;
  });
});

async function handleLine(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    write(errorResponse(null, -32700, "Parse error"));
    return;
  }
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    write(errorResponse(request?.id ?? null, -32600, "Invalid Request"));
    return;
  }
  if (request.method === "notifications/initialized") {
    if (phase === "negotiated") phase = "ready";
    return;
  }
  if (request.method.startsWith("notifications/")) return;
  if (request.id === undefined) return;
  try {
    const result = await dispatch(request);
    write({ jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    if (request.method === "tools/call") {
      write({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(safeError(error)) }],
          structuredContent: safeError(error),
        },
      });
    } else {
      const code = Number.isInteger(error?.code) ? error.code : -32602;
      write(errorResponse(request.id, code, safeMessage(error), safeError(error)));
    }
  }
}

function dispatch(request) {
  if (request.method === "initialize") {
    if (phase !== "new") throw protocolError("Server is already initialized", -32600);
    phase = "negotiated";
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "agentic-canvas-os-knowledge-graph", version: "1.0.0" },
      instructions: "Local deterministic knowledge graph tools. Filesystem access is bounded to explicit ingest roots.",
    };
  }
  if (request.method === "ping") return {};
  if (phase !== "ready") throw protocolError("Server is not initialized", -32002);
  if (request.method === "tools/list") return { tools: host.listTools() };
  if (request.method === "tools/call") {
    const name = request.params?.name;
    const args = request.params?.arguments ?? {};
    if (typeof name !== "string" || !name) throw protocolError("tool name is required");
    const result = host.callTool(name, args);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      isError: false,
    };
  }
  throw protocolError(`Method not found: ${request.method}`, -32601);
}

function resolveArtifactRoot(args, env) {
  const option = args.find((value) => value.startsWith("--artifact-root="));
  const root = option?.slice("--artifact-root=".length) || env.AGENTIC_CANVAS_OS_KNOWLEDGE_GRAPH_ROOT;
  if (!root) {
    process.stderr.write("[knowledge-graph-mcp] --artifact-root or AGENTIC_CANVAS_OS_KNOWLEDGE_GRAPH_ROOT is required\n");
    process.exit(2);
  }
  return root;
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function errorResponse(id, code, message, data = undefined) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function safeError(error) {
  return {
    schema: "agentic-knowledge-graph-error/v1",
    code: typeof error?.code === "string" ? error.code : "knowledge_graph_error",
    message: safeMessage(error),
  };
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function protocolError(message, code = -32602) {
  const error = new Error(message);
  error.code = code;
  return error;
}
