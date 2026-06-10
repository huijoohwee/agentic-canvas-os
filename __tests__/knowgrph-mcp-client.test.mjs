// Tests for the keyless knowgrph MCP Streamable HTTP client (agentic-canvas-os).
// Injectable fetch → ZERO network. Covers JSON + SSE reply parsing, structured
// result extraction, fail-closed on non-2xx + JSON-RPC error, and bearer
// forwarding.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createKnowgrphMcpClient,
  parseMcpReply,
  extractToolResult,
  KnowgrphMcpError,
} from "../src/knowgrph-mcp-client.js";

const ENDPOINT = "https://airvio.co/knowgrph/mcp";

function jsonResponse(status, obj, contentType = "application/json") {
  return {
    status,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? contentType : "") },
    text: async () => (typeof obj === "string" ? obj : JSON.stringify(obj)),
  };
}

function rpcOk(id, structuredContent) {
  return { jsonrpc: "2.0", id, result: { structuredContent } };
}

test("requires an endpoint", () => {
  assert.throws(() => createKnowgrphMcpClient({}), KnowgrphMcpError);
});

test("forwards tools/call and returns the structured Run_Manifest", async () => {
  const seen = {};
  const fetchImpl = async (req) => {
    seen.req = req;
    return jsonResponse(200, rpcOk(req.body.id, { state: "blocked", approvalGates: [1, 2, 3, 4, 5] }));
  };
  const client = createKnowgrphMcpClient({ endpoint: ENDPOINT, fetchImpl });
  const manifest = await client.runVideoRemix({ referenceUrl: "https://x", brief: "b", budgetUsd: 25 });

  assert.equal(seen.req.url, ENDPOINT);
  assert.equal(seen.req.method, "POST");
  assert.equal(seen.req.body.method, "tools/call");
  assert.equal(seen.req.body.params.name, "knowgrph.video_remix.run");
  assert.equal(manifest.state, "blocked");
  assert.equal(manifest.approvalGates.length, 5);
});

test("forwards the caller bearer (Auth_Token) but never a model key", async () => {
  let authHeader;
  const fetchImpl = async (req) => {
    authHeader = req.headers.authorization;
    return jsonResponse(200, rpcOk(req.body.id, { state: "complete" }));
  };
  const client = createKnowgrphMcpClient({ endpoint: ENDPOINT, fetchImpl, authToken: "tok-123" });
  await client.runVideoRemix({ referenceUrl: "https://x", brief: "b", budgetUsd: 1 });
  assert.equal(authHeader, "Bearer tok-123");
});

test("parses an SSE reply and extracts the last JSON-RPC frame", () => {
  const sse = `event: message\ndata: ${JSON.stringify(rpcOk(1, { state: "complete" }))}\n\n`;
  const parsed = parseMcpReply(sse, "text/event-stream");
  assert.equal(extractToolResult(parsed).state, "complete");
});

test("extractToolResult reads a JSON text content block", () => {
  const rpc = { result: { content: [{ type: "text", text: JSON.stringify({ state: "completed" }) }] } };
  assert.equal(extractToolResult(rpc).state, "completed");
});

test("fail-closed on a non-2xx response", async () => {
  const client = createKnowgrphMcpClient({ endpoint: ENDPOINT, fetchImpl: async () => jsonResponse(503, "busy", "text/plain") });
  await assert.rejects(() => client.runVideoRemix({ referenceUrl: "https://x", brief: "b", budgetUsd: 1 }), (e) => {
    assert.equal(e.code, "mcp_http_error");
    assert.equal(e.status, 503);
    return true;
  });
});

test("fail-closed on a JSON-RPC error frame", async () => {
  const client = createKnowgrphMcpClient({
    endpoint: ENDPOINT,
    fetchImpl: async (req) => jsonResponse(200, { jsonrpc: "2.0", id: req.body.id, error: { code: -32000, message: "nope" } }),
  });
  await assert.rejects(() => client.runVideoRemix({ referenceUrl: "https://x", brief: "b", budgetUsd: 1 }), (e) => {
    assert.equal(e.code, "mcp_rpc_error");
    return true;
  });
});

test("fail-closed on an unparseable body", () => {
  assert.throws(() => parseMcpReply("<<not json>>", "application/json"), KnowgrphMcpError);
});
