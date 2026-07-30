import {
  isSkillEvolutionOperation,
  skillEvolutionResultValidationFields,
} from "./skill-evolution-result.js";

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

export const KNOWLEDGE_GRAPH_MCP_TOOLS = Object.freeze({
  ingest: "knowgrph.knowledge_graph.ingest",
  query: "knowgrph.knowledge_graph.query",
  explainEdge: "knowgrph.knowledge_graph.explain_edge",
});

const KNOWLEDGE_GRAPH_INVOCATION_SCHEMA = "knowgrph-knowledge-graph-invocation/v1";
const AGENTIC_CANVAS_OS_ROUTING_SCHEMA = "agentic-canvas-os-docs-routing/v1";
const KNOWLEDGE_GRAPH_TOOL_BY_OPERATION = Object.freeze({
  ingest: KNOWLEDGE_GRAPH_MCP_TOOLS.ingest,
  query: KNOWLEDGE_GRAPH_MCP_TOOLS.query,
  explain_edge: KNOWLEDGE_GRAPH_MCP_TOOLS.explainEdge,
});
const KNOWLEDGE_GRAPH_QUERY_MODES = new Set([
  "search",
  "path",
  "neighbors",
  "impact",
  "summary",
]);
const SHA256_DIGEST = /^[0-9a-f]{64}$/u;
const SOURCE_REVISION = /^[0-9a-f]{40}$/u;
const INVOCATION_TOKEN_TAIL = "[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?";
const INVOCATION_TOKEN = Object.freeze({
  action: new RegExp(`^/${INVOCATION_TOKEN_TAIL}$`, "u"),
  semantic: new RegExp(`^#${INVOCATION_TOKEN_TAIL}$`, "u"),
  binding: new RegExp(`^@${INVOCATION_TOKEN_TAIL}$`, "u"),
});
const KNOWLEDGE_GRAPH_PROJECTION_MAX_NODES = 2_000;
const KNOWLEDGE_GRAPH_PROJECTION_MAX_EDGES = 5_000;
const KNOWLEDGE_GRAPH_PROJECTION_MAX_BYTES = 2 * 1024 * 1024;
const PRIVATE_PATH_KEYS = /^(?:artifactPath|outputPath|rootPath|storePath|absolutePath|createdPaths|removedPaths)$/iu;

function hasText(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isUniqueTokenArray(value, pattern) {
  return Array.isArray(value)
    && value.length >= 1
    && value.length <= 12
    && value.every((token) => typeof token === "string" && pattern.test(token))
    && new Set(value).size === value.length;
}

function isKnowledgeGraphInvocationProof(operation, value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "action",
    "bindings",
    "catalogDigest",
    "routingDigest",
    "routingSchema",
    "schema",
    "semantics",
    "sourceRevision",
    "tool",
  ];
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index])
    && value.schema === KNOWLEDGE_GRAPH_INVOCATION_SCHEMA
    && value.tool === KNOWLEDGE_GRAPH_TOOL_BY_OPERATION[operation]
    && INVOCATION_TOKEN.action.test(value.action)
    && isUniqueTokenArray(value.semantics, INVOCATION_TOKEN.semantic)
    && isUniqueTokenArray(value.bindings, INVOCATION_TOKEN.binding)
    && SOURCE_REVISION.test(value.sourceRevision)
    && SHA256_DIGEST.test(value.catalogDigest)
    && value.routingSchema === AGENTIC_CANVAS_OS_ROUTING_SCHEMA
    && SHA256_DIGEST.test(value.routingDigest);
}

function isCanonicalRepositoryUrl(value) {
  if (!hasText(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:"
      || url.hostname !== "github.com"
      || url.username
      || url.password
      || url.port
      || url.search
      || url.hash
      || url.pathname.includes("%")) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    const segment = /^[A-Za-z0-9_.-]{1,100}$/u;
    const owner = parts[0] || "";
    const repository = String(parts[1] || "").replace(/\.git$/iu, "");
    const routeValid = parts.length === 2 || (
      parts[2] === "tree"
      && parts.length >= 4
      && parts.slice(3).every((part) => segment.test(part))
    );
    return segment.test(owner) && segment.test(repository) && routeValid;
  } catch {
    return false;
  }
}

function cloneKnowledgeGraphPayload(value, label) {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") throw new Error("not JSON");
    const maxBytes = label === "request" ? 1024 * 1024 : 4 * 1024 * 1024;
    if (new TextEncoder().encode(serialized).byteLength > maxBytes) throw new Error("too large");
    return JSON.parse(serialized);
  } catch {
    throw new KnowgrphMcpError(`invalid knowledge graph ${label}`, {
      code: `mcp_knowledge_graph_${label}_invalid`,
      data: { fields: [label] },
    });
  }
}

function privatePathFields(value, prefix = "", fields = [], depth = 0) {
  if (value === null || typeof value !== "object") return fields;
  if (depth > 24) {
    fields.push(`${prefix || "result"}.depth`);
    return fields;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      privatePathFields(value[index], `${prefix}[${index}]`, fields, depth + 1);
    }
    return fields;
  }
  for (const [key, nested] of Object.entries(value)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (PRIVATE_PATH_KEYS.test(key)) fields.push(field);
    privatePathFields(nested, field, fields, depth + 1);
  }
  return fields;
}

function validKnowledgeGraphCounts(value) {
  return isPlainObject(value)
    && ["sources", "nodes", "edges"].every((key) => (
      Number.isInteger(value[key]) && value[key] >= 0
    ));
}

function validateKnowledgeGraphProjection(value, counts, fields) {
  if (!isPlainObject(value)
    || !hasText(value.token)
    || value.readOnly !== true
    || typeof value.complete !== "boolean"
    || typeof value.truncated !== "boolean"
    || !Number.isInteger(value.limit)
    || value.limit < 1
    || value.limit > 1_000
    || !isPlainObject(value.graphData)
    || !Array.isArray(value.graphData.nodes)
    || !Array.isArray(value.graphData.edges)) {
    fields.push("projection");
    return;
  }
  if (value.graphData.nodes.length > KNOWLEDGE_GRAPH_PROJECTION_MAX_NODES
    || value.graphData.nodes.length > counts.nodes) fields.push("projection.graphData.nodes");
  if (value.graphData.edges.length > KNOWLEDGE_GRAPH_PROJECTION_MAX_EDGES
    || value.graphData.edges.length > counts.edges) fields.push("projection.graphData.edges");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > KNOWLEDGE_GRAPH_PROJECTION_MAX_BYTES) {
    fields.push("projection.bytes");
  }
}

/**
 * Validate the stable identity fields at the ACOS-to-Knowgrph boundary.
 * Knowgrph remains authoritative for optional operation-specific fields.
 */
export function validateKnowledgeGraphRequest(operation, input) {
  const fields = [];
  if (!isPlainObject(input)) {
    fields.push("input");
  } else if (operation === "ingest") {
    const hasRootPath = hasText(input.rootPath);
    const hasRepositoryUrl = isCanonicalRepositoryUrl(input.repositoryUrl);
    if (hasRootPath === hasRepositoryUrl) fields.push("source");
    if (Object.hasOwn(input, "repositoryUrl") && !hasRepositoryUrl) fields.push("repositoryUrl");
    if (Object.hasOwn(input, "outputPath")) fields.push("outputPath");
  } else if (operation === "query") {
    if (!hasText(input.graphId)) fields.push("graphId");
    if (!SHA256_DIGEST.test(input.expectedSnapshotDigest)) fields.push("expectedSnapshotDigest");
    if (!KNOWLEDGE_GRAPH_QUERY_MODES.has(input.mode)) fields.push("mode");
    if (Object.hasOwn(input, "artifactPath")) fields.push("artifactPath");
  } else if (operation === "explain_edge") {
    if (!hasText(input.graphId)) fields.push("graphId");
    if (!SHA256_DIGEST.test(input.expectedSnapshotDigest)) fields.push("expectedSnapshotDigest");
    if (!hasText(input.edgeId)) fields.push("edgeId");
    if (Object.hasOwn(input, "artifactPath")) fields.push("artifactPath");
  } else {
    fields.push("operation");
  }
  if (isPlainObject(input)
    && Object.hasOwn(input, "invocation")
    && !isKnowledgeGraphInvocationProof(operation, input.invocation)) {
    fields.push("invocation");
  }

  if (fields.length > 0) {
    throw new KnowgrphMcpError("invalid knowledge graph request", {
      code: "mcp_knowledge_graph_request_invalid",
      data: { operation, fields },
    });
  }
  return input;
}

/** Reject an ingest response that leaks store paths or omits Canvas handoff identity. */
export function validateKnowledgeGraphIngestResult(value) {
  const fields = [];
  if (!isPlainObject(value)) {
    fields.push("result");
  } else {
    if (value.ok !== true) fields.push("ok");
    if (value.operation !== "ingest") fields.push("operation");
    if (!hasText(value.graphId)) fields.push("graphId");
    if (!SHA256_DIGEST.test(value.snapshotDigest)) fields.push("snapshotDigest");
    if (typeof value.complete !== "boolean") fields.push("complete");
    if (!validKnowledgeGraphCounts(value.counts)) fields.push("counts");
    else validateKnowledgeGraphProjection(value.projection, value.counts, fields);
    fields.push(...privatePathFields(value));
  }

  if (fields.length > 0) {
    throw new KnowgrphMcpError("invalid knowledge graph ingest result", {
      code: "mcp_knowledge_graph_result_invalid",
      data: { operation: "ingest", fields },
    });
  }
  return value;
}

export function validateKnowledgeGraphReadResult(operation, request, value) {
  const fields = [];
  if (!isPlainObject(value)) {
    fields.push("result");
  } else {
    if (value.ok !== true) fields.push("ok");
    if (value.operation !== operation) fields.push("operation");
    if (value.graphId !== request.graphId) fields.push("graphId");
    if (value.snapshotDigest !== request.expectedSnapshotDigest) fields.push("snapshotDigest");
    if (operation === "explain_edge" && value.edge?.id !== request.edgeId) fields.push("edge.id");
    fields.push(...privatePathFields(value));
  }
  if (fields.length > 0) {
    throw new KnowgrphMcpError("invalid knowledge graph read result", {
      code: "mcp_knowledge_graph_result_invalid",
      data: { operation, fields: [...new Set(fields)] },
    });
  }
  return value;
}

/**
 * Bind the knowledge-graph API to a host-owned local MCP transport.
 * `callTool` must never route these filesystem-scoped calls to a remote control plane.
 */
export function createKnowgrphKnowledgeGraphClient({ callTool } = {}) {
  if (typeof callTool !== "function") {
    throw new KnowgrphMcpError("local Knowgrph MCP transport is required", {
      code: "mcp_knowledge_graph_local_transport_required",
    });
  }
  const invoke = async (operation, toolName, input, opts) => {
    const request = cloneKnowledgeGraphPayload(input, "request");
    validateKnowledgeGraphRequest(operation, request);
    const result = cloneKnowledgeGraphPayload(await callTool(toolName, request, opts), "result");
    if (operation === "ingest") return validateKnowledgeGraphIngestResult(result);
    return validateKnowledgeGraphReadResult(operation, request, result);
  };
  return Object.freeze({
    ingestKnowledgeGraph: (input, opts) => invoke("ingest", KNOWLEDGE_GRAPH_MCP_TOOLS.ingest, input, opts),
    queryKnowledgeGraph: (input, opts) => invoke("query", KNOWLEDGE_GRAPH_MCP_TOOLS.query, input, opts),
    explainKnowledgeGraphEdge: (input, opts) => (
      invoke("explain_edge", KNOWLEDGE_GRAPH_MCP_TOOLS.explainEdge, input, opts)
    ),
  });
}

/** Fail closed when a Skill Evolution MCP reply is incomplete or unsafe. */
export function validateSkillEvolutionResult(value, { expectedOperation } = {}) {
  const fields = skillEvolutionResultValidationFields(value, { expectedOperation });
  if (fields.length > 0) {
    throw new KnowgrphMcpError("invalid Skill Evolution result", {
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

  function localKnowledgeGraphCall(toolName, args, opts) {
    let parsed;
    try { parsed = new URL(url); } catch { parsed = null; }
    const hostname = parsed?.hostname?.toLowerCase() || "";
    const loopback = hostname === "localhost"
      || hostname === "::1"
      || hostname === "[::1]"
      || /^127(?:\.[0-9]{1,3}){3}$/u.test(hostname);
    if (!loopback) {
      throw new KnowgrphMcpError("knowledge graph calls require a local MCP endpoint", {
        code: "mcp_knowledge_graph_local_transport_required",
      });
    }
    return callTool(toolName, args, opts);
  }
  const knowledgeGraph = createKnowgrphKnowledgeGraphClient({ callTool: localKnowledgeGraphCall });

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
    ...knowledgeGraph,
    /** Call Skill Evolution and reject incomplete or unsafe result snapshots. */
    async evolveSkill(input, opts) {
      const expectedOperation = input?.operation;
      if (!isSkillEvolutionOperation(expectedOperation)) {
        throw new KnowgrphMcpError("invalid Skill Evolution request operation", {
          code: "mcp_skill_evolution_request_invalid",
          data: { fields: ["operation"] },
        });
      }
      const result = await callTool("knowgrph.skill.evolve", input, opts);
      return validateSkillEvolutionResult(result, { expectedOperation });
    },
  };
}
