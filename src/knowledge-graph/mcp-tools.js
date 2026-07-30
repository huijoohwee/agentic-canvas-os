import { deepFreeze } from "./canonical.js";
import { createKnowledgeGraphRuntime } from "./runtime.js";

export const KNOWLEDGE_GRAPH_MCP_TOOLS = deepFreeze({
  ingest: "agentic_canvas_os.knowledge_graph.ingest",
  query: "agentic_canvas_os.knowledge_graph.query",
  explain: "agentic_canvas_os.knowledge_graph.explain",
});

const DIGEST_SCHEMA = { type: "string", pattern: "^[a-f0-9]{64}$" };
const GRAPH_ID_SCHEMA = { type: "string", pattern: "^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$" };

export const KNOWLEDGE_GRAPH_TOOL_DEFINITIONS = deepFreeze([
  {
    name: KNOWLEDGE_GRAPH_MCP_TOOLS.ingest,
    description: "Compile one bounded local workspace into a deterministic explained knowledge graph snapshot.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["graphId", "root"],
      properties: {
        graphId: GRAPH_ID_SCHEMA,
        root: { type: "string", minLength: 1, maxLength: 4096 },
        grammars: { type: "array", maxItems: 32, items: { type: "object" } },
        parserArtifacts: {
          type: "array",
          maxItems: 32,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["parserId", "parserDigest"],
            properties: { parserId: GRAPH_ID_SCHEMA, parserDigest: DIGEST_SCHEMA },
          },
        },
        bounds: {
          type: "object",
          additionalProperties: false,
          properties: {
            maxEntries: { type: "integer", minimum: 1, maximum: 20000 },
            maxFiles: { type: "integer", minimum: 1, maximum: 2000 },
            maxFileBytes: { type: "integer", minimum: 1, maximum: 2097152 },
            maxTotalBytes: { type: "integer", minimum: 1, maximum: 52428800 },
            maxDepth: { type: "integer", minimum: 1, maximum: 32 },
            maxDurationMs: { type: "integer", minimum: 1, maximum: 20000 },
          },
        },
        exclude: { type: "array", maxItems: 128, items: { type: "string", minLength: 1, maxLength: 512 } },
      },
    },
  },
  {
    name: KNOWLEDGE_GRAPH_MCP_TOOLS.query,
    description: "Run one bounded lexical or structural query against an exact local graph snapshot.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["graphId", "expectedDigest", "query"],
      properties: {
        graphId: GRAPH_ID_SCHEMA,
        expectedDigest: DIGEST_SCHEMA,
        query: {
          type: "object",
          additionalProperties: false,
          required: ["operation"],
          properties: {
            operation: { enum: ["summary", "search", "node", "neighbors", "impact", "path", "match"] },
            term: { type: "string", minLength: 1, maxLength: 512 },
            node: { type: "string", minLength: 1, maxLength: 512 },
            from: { type: "string", minLength: 1, maxLength: 512 },
            to: { type: "string", minLength: 1, maxLength: 512 },
            direction: { enum: ["in", "out", "both"] },
            edgeKinds: { type: "array", maxItems: 32, items: { type: "string", minLength: 1, maxLength: 128 } },
            nodeKinds: { type: "array", maxItems: 32, items: { type: "string", minLength: 1, maxLength: 128 } },
            depth: { type: "integer", minimum: 1, maximum: 6 },
            limit: { type: "integer", minimum: 1, maximum: 200 },
          },
        },
      },
    },
  },
  {
    name: KNOWLEDGE_GRAPH_MCP_TOOLS.explain,
    description: "Return the stored explanation and source evidence for one exact graph edge.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["graphId", "expectedDigest", "edgeId"],
      properties: {
        graphId: GRAPH_ID_SCHEMA,
        expectedDigest: DIGEST_SCHEMA,
        edgeId: { type: "string", pattern: "^e:[a-f0-9]{32}$" },
      },
    },
  },
]);

export function createKnowledgeGraphMcpHost({ artifactRoot }) {
  const runtime = createKnowledgeGraphRuntime({ artifactRoot });
  const definitions = new Map(KNOWLEDGE_GRAPH_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));
  return deepFreeze({
    listTools() {
      return KNOWLEDGE_GRAPH_TOOL_DEFINITIONS;
    },
    callTool(name, args = {}) {
      const definition = definitions.get(name);
      if (!definition) throw toolError("tool_not_found", `Unknown knowledge graph tool: ${name}`);
      validateSchema(definition.inputSchema, args, "arguments");
      if (name === KNOWLEDGE_GRAPH_MCP_TOOLS.ingest) return runtime.ingest(args);
      if (name === KNOWLEDGE_GRAPH_MCP_TOOLS.query) return runtime.query(args);
      return runtime.explain(args);
    },
  });
}

function validateSchema(schema, value, label) {
  if (schema.enum && !schema.enum.includes(value)) invalid(`${label} must be one of ${schema.enum.join(", ")}`);
  if (schema.type === "object") {
    if (!plainObject(value)) invalid(`${label} must be an object`);
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) invalid(`${label}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).filter((key) => !Object.hasOwn(properties, key));
      if (unknown.length > 0) invalid(`${label} has unsupported fields: ${unknown.join(", ")}`);
    }
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateSchema(child, value[key], `${label}.${key}`);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) invalid(`${label} must be an array`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) invalid(`${label} exceeds ${schema.maxItems} items`);
    value.forEach((item, index) => validateSchema(schema.items, item, `${label}[${index}]`));
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") invalid(`${label} must be a string`);
    if (schema.minLength !== undefined && value.length < schema.minLength) invalid(`${label} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) invalid(`${label} is too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) invalid(`${label} has an invalid format`);
    return;
  }
  if (schema.type === "integer") {
    if (!Number.isInteger(value)) invalid(`${label} must be an integer`);
    if (schema.minimum !== undefined && value < schema.minimum) invalid(`${label} is below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) invalid(`${label} exceeds ${schema.maximum}`);
  }
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message) {
  throw toolError("arguments_invalid", message);
}

function toolError(code, message) {
  const error = new Error(message);
  error.name = "KnowledgeGraphToolError";
  error.code = code;
  return error;
}
