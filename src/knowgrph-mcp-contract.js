import {
  EDGE_ID,
  GRAPH_ID,
  SHA256_DIGEST,
  SOURCE_REVISION,
  boundedText,
  hasExactKeys,
  hasText,
  isPlainObject,
  isUniqueStringArray,
} from "./knowgrph-mcp-contract-utils.js";
import {
  validParserDescriptors,
  validParserRegistry,
} from "./knowgrph-mcp-parser-contract.js";
import {
  privatePathFields,
  validExplainSuccess,
  validKnowledgeGraphCounts,
  validQuerySuccess,
  validateKnowledgeGraphProjection,
} from "./knowgrph-mcp-result-contract.js";

export class KnowgrphMcpError extends Error {
  constructor(message, { code, status, data } = {}) {
    super(message);
    this.name = "KnowgrphMcpError";
    this.code = code || "knowgrph_mcp_error";
    if (status !== undefined) this.status = status;
    if (data !== undefined) this.data = data;
  }
}

export const KNOWLEDGE_GRAPH_MCP_TOOLS = Object.freeze({
  ingest: "knowgrph.knowledge_graph.ingest",
  generateParser: "knowgrph.knowledge_graph.parser_generate",
  query: "knowgrph.knowledge_graph.query",
  explainEdge: "knowgrph.knowledge_graph.explain_edge",
});

const INVOCATION_SCHEMA = "knowgrph-knowledge-graph-invocation/v1";
const ROUTING_SCHEMA = "agentic-canvas-os-docs-routing/v1";
const RESULT_SCHEMAS = Object.freeze({
  ingest: "knowgrph-knowledge-graph-ingest/v1",
  parser_generate: "knowgrph-knowledge-graph-parser-generate/v1",
  query: "knowgrph-knowledge-graph-query/v1",
  explain_edge: "knowgrph-knowledge-graph-explain-edge/v1",
});
const TOOL_BY_OPERATION = Object.freeze({
  ingest: KNOWLEDGE_GRAPH_MCP_TOOLS.ingest,
  parser_generate: KNOWLEDGE_GRAPH_MCP_TOOLS.generateParser,
  query: KNOWLEDGE_GRAPH_MCP_TOOLS.query,
  explain_edge: KNOWLEDGE_GRAPH_MCP_TOOLS.explainEdge,
});
const QUERY_MODES = new Set(["search", "path", "neighbors", "impact", "summary"]);
const REPOSITORY_PATH_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._~-]{0,199})$/u;
const INVOCATION_TOKEN_TAIL = "[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?";
const INVOCATION_TOKEN = Object.freeze({
  action: new RegExp(`^/${INVOCATION_TOKEN_TAIL}$`, "u"),
  semantic: new RegExp(`^#${INVOCATION_TOKEN_TAIL}$`, "u"),
  binding: new RegExp(`^@${INVOCATION_TOKEN_TAIL}$`, "u"),
});

function isKnowledgeGraphInvocationProof(operation, value) {
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
  return hasExactKeys(value, expectedKeys)
    && value.schema === INVOCATION_SCHEMA
    && value.tool === TOOL_BY_OPERATION[operation]
    && INVOCATION_TOKEN.action.test(value.action)
    && isUniqueStringArray(value.semantics, INVOCATION_TOKEN.semantic, 12, { required: true })
    && isUniqueStringArray(value.bindings, INVOCATION_TOKEN.binding, 12, { required: true })
    && SOURCE_REVISION.test(value.sourceRevision)
    && SHA256_DIGEST.test(value.catalogDigest)
    && value.routingSchema === ROUTING_SCHEMA
    && SHA256_DIGEST.test(value.routingDigest);
}

function isCredentialFreeHttpsRepositoryUrl(value) {
  if (!hasText(value) || value !== value.trim() || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:"
      || !url.hostname
      || url.username
      || url.password
      || url.port
      || url.search
      || url.hash
      || url.pathname === "/") return false;
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts.length < 1 || parts.length > 32) return false;
    const repository = String(parts.at(-1) || "").replace(/\.git$/iu, "");
    return Boolean(repository)
      && [...parts.slice(0, -1), repository].every((part) => (
        part !== "." && part !== ".." && REPOSITORY_PATH_SEGMENT.test(part)
      ));
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

export function validateKnowledgeGraphRequest(operation, input) {
  const fields = [];
  if (!isPlainObject(input)) {
    fields.push("input");
  } else if (operation === "ingest") {
    const hasRootPath = hasText(input.rootPath);
    const hasRepositoryUrl = isCredentialFreeHttpsRepositoryUrl(input.repositoryUrl);
    if (hasRootPath === hasRepositoryUrl) fields.push("source");
    if (Object.hasOwn(input, "repositoryUrl") && !hasRepositoryUrl) fields.push("repositoryUrl");
    if (Object.hasOwn(input, "outputPath")) fields.push("outputPath");
  } else if (operation === "parser_generate") {
    if (!validParserDescriptors(input.descriptors, { generated: false })) fields.push("descriptors");
    if (Object.hasOwn(input, "outputPath")) fields.push("outputPath");
  } else if (operation === "query") {
    if (!GRAPH_ID.test(input.graphId)) fields.push("graphId");
    if (!SHA256_DIGEST.test(input.expectedSnapshotDigest)) fields.push("expectedSnapshotDigest");
    if (!QUERY_MODES.has(input.mode)) fields.push("mode");
    if (Object.hasOwn(input, "artifactPath")) fields.push("artifactPath");
  } else if (operation === "explain_edge") {
    if (!GRAPH_ID.test(input.graphId)) fields.push("graphId");
    if (!SHA256_DIGEST.test(input.expectedSnapshotDigest)) fields.push("expectedSnapshotDigest");
    if (!EDGE_ID.test(input.edgeId)) fields.push("edgeId");
    if (Object.hasOwn(input, "artifactPath")) fields.push("artifactPath");
  } else {
    fields.push("operation");
  }
  if (isPlainObject(input)
    && Object.hasOwn(input, "invocation")
    && !isKnowledgeGraphInvocationProof(operation, input.invocation)) fields.push("invocation");
  if (fields.length) {
    throw new KnowgrphMcpError("invalid knowledge graph request", {
      code: "mcp_knowledge_graph_request_invalid",
      data: { operation, fields },
    });
  }
  return input;
}

function invalidResult(operation, fields) {
  throw new KnowgrphMcpError(`invalid knowledge graph ${operation} result`, {
    code: "mcp_knowledge_graph_result_invalid",
    data: { operation, fields: [...new Set(fields)] },
  });
}

function validateResultEnvelope(operation, value, fields) {
  if (!isPlainObject(value)) {
    fields.push("result");
    return false;
  }
  if (value.schema !== RESULT_SCHEMAS[operation]) fields.push("schema");
  if (value.operation !== operation) fields.push("operation");
  fields.push(...privatePathFields(value));
  if (value.ok !== false) {
    if (Object.hasOwn(value, "error")) fields.push("error");
    return false;
  }
  if (!hasExactKeys(value, ["schema", "ok", "operation", "error"])
    || !hasExactKeys(value.error, ["code", "message", "details"], ["code", "message"])
    || !boundedText(value.error.code, 256)
    || !boundedText(value.error.message, 4_000)
    || (Object.hasOwn(value.error, "details") && !isPlainObject(value.error.details))) {
    fields.push("error");
  }
  if (fields.length) invalidResult(operation, fields);
  throw new KnowgrphMcpError(value.error.message, {
    code: value.error.code,
    data: value.error.details,
  });
}

export function validateKnowledgeGraphIngestResult(value) {
  const fields = [];
  const failure = validateResultEnvelope("ingest", value, fields);
  if (isPlainObject(value)) {
    if (value.ok !== true) fields.push("ok");
    if (!GRAPH_ID.test(value.graphId)) fields.push("graphId");
    if (!SHA256_DIGEST.test(value.snapshotDigest)) fields.push("snapshotDigest");
    if (!SHA256_DIGEST.test(value.parserRegistryDigest)) fields.push("parserRegistryDigest");
    if (typeof value.complete !== "boolean") fields.push("complete");
    if (!validKnowledgeGraphCounts(value.counts)) fields.push("counts");
    else validateKnowledgeGraphProjection(value.projection, value.counts, fields);
  }
  if (failure || fields.length) invalidResult("ingest", fields);
  return value;
}

export function validateKnowledgeGraphParserResult(value) {
  const fields = [];
  const failure = validateResultEnvelope("parser_generate", value, fields);
  if (isPlainObject(value)) {
    if (!hasExactKeys(value, [
      "schema", "ok", "operation", "parserRegistryDigest", "parserRegistry",
    ])) fields.push("result");
    if (value.ok !== true) fields.push("ok");
    if (!SHA256_DIGEST.test(value.parserRegistryDigest)) fields.push("parserRegistryDigest");
    if (!validParserRegistry(value.parserRegistry, value.parserRegistryDigest)) {
      fields.push("parserRegistry");
    }
  }
  if (failure || fields.length) invalidResult("parser_generate", fields);
  return value;
}

export function validateKnowledgeGraphReadResult(operation, request, value) {
  const fields = [];
  const failure = validateResultEnvelope(operation, value, fields);
  if (isPlainObject(value)) {
    if (value.ok !== true) fields.push("ok");
    if (!GRAPH_ID.test(value.graphId) || value.graphId !== request.graphId) fields.push("graphId");
    if (value.snapshotDigest !== request.expectedSnapshotDigest) fields.push("snapshotDigest");
    if (operation === "query" && !validQuerySuccess(request.mode, value)) fields.push("payload");
    if (operation === "explain_edge" && !validExplainSuccess(request, value)) fields.push("payload");
  }
  if (failure || fields.length) invalidResult(operation, fields);
  return value;
}

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
    if (operation === "parser_generate") return validateKnowledgeGraphParserResult(result);
    return validateKnowledgeGraphReadResult(operation, request, result);
  };
  return Object.freeze({
    ingestKnowledgeGraph: (input, opts) => (
      invoke("ingest", KNOWLEDGE_GRAPH_MCP_TOOLS.ingest, input, opts)
    ),
    generateKnowledgeGraphParser: (input, opts) => (
      invoke("parser_generate", KNOWLEDGE_GRAPH_MCP_TOOLS.generateParser, input, opts)
    ),
    queryKnowledgeGraph: (input, opts) => (
      invoke("query", KNOWLEDGE_GRAPH_MCP_TOOLS.query, input, opts)
    ),
    explainKnowledgeGraphEdge: (input, opts) => (
      invoke("explain_edge", KNOWLEDGE_GRAPH_MCP_TOOLS.explainEdge, input, opts)
    ),
  });
}
