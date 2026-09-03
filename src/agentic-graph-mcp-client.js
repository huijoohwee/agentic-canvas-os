import {
  isSkillEvolutionOperation,
  skillEvolutionResultValidationFields,
} from "./skill-evolution-result.js";
import {
  createAgenticGraphClient,
  AGENTIC_GRAPH_DEFAULT_PARSER_PROFILE,
  AGENTIC_GRAPH_MCP_TOOLS,
  AgenticGraphMcpError,
} from "./agentic-graph-mcp-contract.js";

export {
  createAgenticGraphClient,
  AGENTIC_GRAPH_DEFAULT_PARSER_PROFILE,
  AGENTIC_GRAPH_MCP_TOOLS,
  AgenticGraphMcpError,
  validateAgenticGraphIngestResult,
  validateAgenticGraphParserResult,
  validateAgenticGraphReadResult,
  validateAgenticGraphRequest,
} from "./agentic-graph-mcp-contract.js";

// Keyless MCP Streamable HTTP client for the agentic-canvas-os product tier.
// Transport is injectable for deterministic tests and fails closed on non-2xx,
// invalid JSON-RPC, incomplete session identity, or unverified tool results.

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Fail closed when a Skill Evolution MCP reply is incomplete or unsafe. */
export function validateSkillEvolutionResult(value, { expectedOperation } = {}) {
  const fields = skillEvolutionResultValidationFields(value, { expectedOperation });
  if (fields.length > 0) {
    throw new AgenticGraphMcpError("invalid Skill Evolution result", {
      code: "mcp_skill_evolution_result_invalid",
      data: { fields },
    });
  }
  return value;
}

function normalizeExecutionMetadata(value) {
  if (value === undefined) return undefined;
  const keys = ["schema", "receiptId", "idempotencyKey", "requestDigest"];
  if (!isPlainObject(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
    || value.schema !== "function-execution-receipt/v1"
    || keys.slice(1).some((key) => typeof value[key] !== "string" || !value[key].trim())) {
    throw new AgenticGraphMcpError(
      "invalid function execution metadata",
      { code: "mcp_execution_metadata_invalid" },
    );
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, value[key].trim()])));
}

/**
 * Parse a JSON or SSE MCP Streamable HTTP reply.
 */
export function parseMcpReply(bodyText, contentType = "") {
  const text = typeof bodyText === "string" ? bodyText : "";
  const ct = String(contentType).toLowerCase();

  if (ct.includes("text/event-stream") || /^\s*event:|^\s*data:/m.test(text)) {
    const frames = [];
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*data:\s?(.*)$/.exec(line);
      if (match && match[1].trim() && match[1].trim() !== "[DONE]") {
        frames.push(match[1].trim());
      }
    }
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(frames[index]);
      } catch {
        // Continue to the previous data frame.
      }
    }
    throw new AgenticGraphMcpError(
      "no parseable SSE data frame in MCP reply",
      { code: "mcp_parse_error" },
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AgenticGraphMcpError(
      "MCP reply was not valid JSON",
      { code: "mcp_parse_error" },
    );
  }
}

/**
 * Extract structured tool content from a JSON-RPC response.
 */
export function extractToolResult(rpc) {
  if (!isPlainObject(rpc)) {
    throw new AgenticGraphMcpError("empty MCP response", { code: "mcp_empty" });
  }
  if (rpc.error) {
    const error = rpc.error;
    throw new AgenticGraphMcpError(error.message || "agentic-graph MCP returned an error", {
      code: "mcp_rpc_error",
      data: error.data,
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
 * Create a agentic-graph MCP client bound to an endpoint.
 *
 * @param {object} opts
 * @param {string} opts.endpoint agentic-graph MCP Streamable HTTP endpoint
 * @param {(req: { url, method, headers, body }) => Promise<{ status, headers, text }>} [opts.fetchImpl]
 * @param {string} [opts.authToken] opaque caller bearer; never a model key
 */
export function createAgenticGraphMcpClient({ endpoint, fetchImpl, authToken } = {}) {
  if (typeof endpoint !== "string" || !endpoint.trim()) {
    throw new AgenticGraphMcpError(
      "agentic-graph MCP endpoint is required",
      { code: "mcp_no_endpoint" },
    );
  }
  const url = endpoint.trim();
  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) {
    throw new AgenticGraphMcpError(
      "no fetch transport available",
      { code: "mcp_no_transport" },
    );
  }

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
    const response = await doFetch({
      url,
      method: "POST",
      headers,
      body: rpcRequest,
    });
    const status = typeof response.status === "number" ? response.status : 0;
    if (status < 200 || status >= 300) {
      throw new AgenticGraphMcpError(
        `agentic-graph MCP init responded ${status}`,
        { code: "mcp_http_error", status },
      );
    }
    const getHeader = (name) => {
      const lower = name.toLowerCase();
      if (response.headers && typeof response.headers.get === "function") {
        return response.headers.get(lower) || response.headers.get(name);
      }
      return (response.headers && (response.headers[lower] || response.headers[name])) || "";
    };
    mcpSessionId = getHeader("mcp-session-id");
    if (!mcpSessionId) {
      throw new AgenticGraphMcpError(
        "agentic-graph MCP init missing mcp-session-id",
        { code: "mcp_protocol_error" },
      );
    }
    if (typeof response.text === "function") await response.text();
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
    const response = await doFetch({
      url,
      method: "POST",
      headers,
      body: rpcRequest,
    });
    const status = typeof response.status === "number" ? response.status : 0;
    const getHeader = (name) => (
      response.headers && typeof response.headers.get === "function"
        ? response.headers.get(name)
        : (response.headers && response.headers[name]) || ""
    );
    const bodyText = typeof response.text === "function"
      ? await response.text()
      : typeof response.body === "string" ? response.body : "";
    if (status < 200 || status >= 300) {
      throw new AgenticGraphMcpError(
        `agentic-graph MCP responded ${status}`,
        { code: "mcp_http_error", status },
      );
    }
    return extractToolResult(parseMcpReply(bodyText, getHeader("content-type")));
  }

  function localAgenticGraphCall(toolName, args, opts) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    const hostname = parsed?.hostname?.toLowerCase() || "";
    const loopback = hostname === "localhost"
      || hostname === "::1"
      || hostname === "[::1]"
      || /^127(?:\.[0-9]{1,3}){3}$/u.test(hostname);
    if (!loopback) {
      throw new AgenticGraphMcpError(
        "agentic graph calls require a local MCP endpoint",
        { code: "mcp_agentic_graph_local_transport_required" },
      );
    }
    return callTool(toolName, args, opts);
  }

  const agenticGraph = createAgenticGraphClient({
    callTool: localAgenticGraphCall,
  });
  return {
    endpoint: url,
    callTool,
    runVideoRemix(input, opts) {
      return callTool("agentic-graph.video_remix.run", input, opts);
    },
    invokeDocsGrammar(input, opts) {
      return callTool("agentic-graph.agentic_canvas_os.docs.invoke", input, opts);
    },
    ...agenticGraph,
    async evolveSkill(input, opts) {
      const expectedOperation = input?.operation;
      if (!isSkillEvolutionOperation(expectedOperation)) {
        throw new AgenticGraphMcpError("invalid Skill Evolution request operation", {
          code: "mcp_skill_evolution_request_invalid",
          data: { fields: ["operation"] },
        });
      }
      const result = await callTool("agentic-graph.skill.evolve", input, opts);
      return validateSkillEvolutionResult(result, { expectedOperation });
    },
  };
}
