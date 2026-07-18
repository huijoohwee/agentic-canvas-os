// Keyless MCP Streamable HTTP client for the agentic-canvas-os product tier.
//
// Calls the knowgrph control plane at `airvio.co/knowgrph/control-plane/mcp` over MCP
// Streamable HTTP (JSON-RPC 2.0 `tools/call`). This tier holds NO model provider
// keys — it forwards the hero tool `knowgrph.video_remix.run` (and stage tools)
// and returns the structured result (Run_Manifest + Demo_Pack). knowgrph owns
// all reasoning, spend, and approval gates.
//
// Transport mirrors knowgrph's `createFetchMcpTransport` seam: an injectable
// `fetch` (so tests are network-free), JSON + SSE (`text/event-stream`) reply
// parsing, and FAIL-CLOSED behavior on a non-2xx response or a JSON-RPC error.

/** Typed error for a failed MCP forward (non-2xx, parse failure, or RPC error). */
export class KnowgrphMcpError extends Error {
  constructor(message, { code, status, data } = {}) {
    super(message);
    this.name = "KnowgrphMcpError";
    this.code = code || "knowgrph_mcp_error";
    if (status !== undefined) this.status = status;
    if (data !== undefined) this.data = data;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeExecutionMetadata(value) {
  if (value === undefined) return undefined;
  const keys = ["schema", "receiptId", "idempotencyKey", "requestDigest"];
  if (!isPlainObject(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
    || value.schema !== "function-execution-receipt/v1"
    || keys.slice(1).some((key) => typeof value[key] !== "string" || !value[key].trim())) {
    throw new KnowgrphMcpError("invalid function execution metadata", { code: "mcp_execution_metadata_invalid" });
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, value[key].trim()])));
}

/**
 * Parse an MCP Streamable HTTP reply body. The endpoint may answer with a single
 * JSON document (`application/json`) or an SSE stream (`text/event-stream`) whose
 * `data:` lines carry JSON-RPC frames. Returns the parsed JSON-RPC response
 * object, or throws `KnowgrphMcpError` when no parseable frame is present.
 *
 * @param {string} bodyText raw response body
 * @param {string} contentType response content-type header (lowercased ok)
 */
export function parseMcpReply(bodyText, contentType = "") {
  const text = typeof bodyText === "string" ? bodyText : "";
  const ct = String(contentType).toLowerCase();

  if (ct.includes("text/event-stream") || /^\s*event:|^\s*data:/m.test(text)) {
    // Concatenate `data:` payloads; the last JSON frame is the RPC response.
    const frames = [];
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*data:\s?(.*)$/.exec(line);
      if (m && m[1].trim() && m[1].trim() !== "[DONE]") frames.push(m[1].trim());
    }
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(frames[i]);
      } catch {
        /* try the previous frame */
      }
    }
    throw new KnowgrphMcpError("no parseable SSE data frame in MCP reply", { code: "mcp_parse_error" });
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new KnowgrphMcpError("MCP reply was not valid JSON", { code: "mcp_parse_error" });
  }
}

/**
 * Extract the tool result payload from a JSON-RPC `tools/call` response. knowgrph
 * returns the Run_Manifest as structured content; this prefers
 * `result.structuredContent`, then a JSON-parsed text content block, then
 * `result` itself. Throws on a JSON-RPC `error`.
 */
export function extractToolResult(rpc) {
  if (!isPlainObject(rpc)) throw new KnowgrphMcpError("empty MCP response", { code: "mcp_empty" });
  if (rpc.error) {
    const err = rpc.error;
    throw new KnowgrphMcpError(err.message || "knowgrph MCP returned an error", {
      code: "mcp_rpc_error",
      data: err.data,
    });
  }
  const result = rpc.result;
  if (!isPlainObject(result)) return result;
  if (isPlainObject(result.structuredContent)) return result.structuredContent;
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (isPlainObject(block) && block.type === "text" && typeof block.text === "string") {
        try {
          return JSON.parse(block.text);
        } catch {
          return { text: block.text };
        }
      }
    }
  }
  return result;
}

/**
 * Create a knowgrph MCP client bound to an endpoint.
 *
 * @param {object} opts
 * @param {string} opts.endpoint knowgrph MCP Streamable HTTP endpoint
 * @param {(req: { url, method, headers, body }) => Promise<{ status, headers, text }>} [opts.fetchImpl]
 *   injectable transport returning `{ status, headers:{get}, text() }` or a
 *   plain `{ status, headers, body }`; defaults to global `fetch`.
 * @param {string} [opts.authToken] opaque caller bearer (Auth_Token) forwarded
 *   to the control plane; NEVER a model key.
 */
export function createKnowgrphMcpClient({ endpoint, fetchImpl, authToken } = {}) {
  if (typeof endpoint !== "string" || !endpoint.trim()) {
    throw new KnowgrphMcpError("knowgrph MCP endpoint is required", { code: "mcp_no_endpoint" });
  }
  const url = endpoint.trim();
  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) throw new KnowgrphMcpError("no fetch transport available", { code: "mcp_no_transport" });

  let nextId = 1;
  let mcpSessionId = null;

  async function ensureSession({ bearer } = {}) {
    if (mcpSessionId) return mcpSessionId;

    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    const token = bearer || authToken;
    if (token) headers.authorization = `Bearer ${token}`;

    const rpcRequest = {
      jsonrpc: "2.0",
      id: nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "agentic-canvas-os", version: "0.1.0" },
      },
    };

    const res = await doFetch({ url, method: "POST", headers, body: rpcRequest });
    const status = typeof res.status === "number" ? res.status : 0;

    if (status < 200 || status >= 300) {
      throw new KnowgrphMcpError(`knowgrph MCP init responded ${status}`, { code: "mcp_http_error", status });
    }

    const getHeader = (name) => {
      const lower = name.toLowerCase();
      if (res.headers && typeof res.headers.get === "function") {
        return res.headers.get(lower) || res.headers.get(name);
      }
      return (res.headers && (res.headers[lower] || res.headers[name])) || "";
    };

    mcpSessionId = getHeader("mcp-session-id");
    if (!mcpSessionId) {
      throw new KnowgrphMcpError("knowgrph MCP init missing mcp-session-id", { code: "mcp_protocol_error" });
    }

    if (typeof res.text === "function") await res.text();
    return mcpSessionId;
  }

  async function callTool(toolName, args = {}, { bearer, execution } = {}) {
    const sessionId = await ensureSession({ bearer });
    const executionMetadata = normalizeExecutionMetadata(execution);

    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    };
    const token = bearer || authToken;
    if (token) headers.authorization = `Bearer ${token}`;
    if (executionMetadata) headers["idempotency-key"] = executionMetadata.idempotencyKey;

    const rpcRequest = {
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
        ...(executionMetadata
          ? { _meta: { "io.agentic-canvas-os/execution": executionMetadata } }
          : {}),
      },
    };

    const res = await doFetch({ url, method: "POST", headers, body: rpcRequest });
    const status = typeof res.status === "number" ? res.status : 0;
    const getHeader = (name) =>
      res.headers && typeof res.headers.get === "function"
        ? res.headers.get(name)
        : (res.headers && res.headers[name]) || "";
    const bodyText =
      typeof res.text === "function" ? await res.text() : typeof res.body === "string" ? res.body : "";

    if (status < 200 || status >= 300) {
      // FAIL-CLOSED: never treat a non-2xx control-plane reply as success.
      throw new KnowgrphMcpError(`knowgrph MCP responded ${status}`, { code: "mcp_http_error", status });
    }

    const rpc = parseMcpReply(bodyText, getHeader("content-type"));
    return extractToolResult(rpc);
  }

  return {
    endpoint: url,
    callTool,
    /** Run the hero video-remix tool; returns the knowgrph Run_Manifest. */
    runVideoRemix(input, opts) {
      return callTool("knowgrph.video_remix.run", input, opts);
    },
    /** Invoke the Agentic Canvas OS command grammar (/, @, #). */
    invokeDocsGrammar(input, opts) {
      return callTool("knowgrph.agentic_canvas_os.docs.invoke", input, opts);
    },
  };
}
