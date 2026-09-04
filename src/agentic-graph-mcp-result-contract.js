import {
  EDGE_ID,
  PROJECTION_TOKEN,
  SHA256_DIGEST,
  boundedText,
  hasExactKeys,
  isPlainObject,
} from "./agentic-graph-mcp-contract-utils.js";

const PRIVATE_PATH_KEYS = /^(?:artifactPath|outputPath|rootPath|storePath|absolutePath|createdPaths|removedPaths)$/iu;
const MAX_PROJECTION_NODES = 1_000;
const MAX_PROJECTION_EDGES = 1_000;
const MAX_PROJECTION_BYTES = 2 * 1024 * 1024;
const MAX_QUERY_RESULTS = 200;

export function privatePathFields(value, prefix = "", fields = [], depth = 0) {
  if (value === null || typeof value !== "object") return fields;
  if (depth > 24) {
    fields.push(`${prefix || "result"}.depth`);
    return fields;
  }
  if (Array.isArray(value)) {
    value.forEach((nested, index) => {
      privatePathFields(nested, `${prefix}[${index}]`, fields, depth + 1);
    });
    return fields;
  }
  for (const [key, nested] of Object.entries(value)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (PRIVATE_PATH_KEYS.test(key)) fields.push(field);
    privatePathFields(nested, field, fields, depth + 1);
  }
  return fields;
}

export function validAgenticGraphCounts(value) {
  return isPlainObject(value)
    && Object.values(value).every((count) => Number.isInteger(count) && count >= 0)
    && ["sources", "nodes", "edges"].every((key) => (
      Number.isInteger(value[key]) && value[key] >= 0
    ));
}

function validGraphNode(value) {
  return hasExactKeys(value, ["id", "label", "type", "properties", "metadata"], [
    "id", "label", "type", "properties",
  ])
    && boundedText(value.id)
    && typeof value.label === "string"
    && value.label.length <= 4_000
    && boundedText(value.type, 256)
    && isPlainObject(value.properties)
    && (!Object.hasOwn(value, "metadata") || isPlainObject(value.metadata));
}

function validGraphEdge(value) {
  return hasExactKeys(value, [
    "id", "source", "target", "label", "type", "properties", "metadata",
  ], ["id", "source", "target", "label", "properties"])
    && EDGE_ID.test(value.id)
    && boundedText(value.source)
    && boundedText(value.target)
    && boundedText(value.label, 512)
    && (!Object.hasOwn(value, "type") || boundedText(value.type, 512))
    && isPlainObject(value.properties)
    && (!Object.hasOwn(value, "metadata") || isPlainObject(value.metadata));
}

function validGraphData(value) {
  if (!hasExactKeys(value, ["context", "type", "nodes", "edges"])
    || value.context !== "agentic-graph-agent-graph-projection"
    || value.type !== "Graph"
    || !Array.isArray(value.nodes)
    || !Array.isArray(value.edges)
    || !value.nodes.every(validGraphNode)
    || !value.edges.every(validGraphEdge)) return false;
  const nodeIds = new Set(value.nodes.map(({ id }) => id));
  const edgeIds = new Set(value.edges.map(({ id }) => id));
  return nodeIds.size === value.nodes.length
    && edgeIds.size === value.edges.length
    && value.edges.every(({ source, target }) => nodeIds.has(source) && nodeIds.has(target));
}

function validCompleteness(value) {
  return isPlainObject(value)
    && typeof value.complete === "boolean"
    && typeof value.truncated === "boolean"
    && boundedText(value.reason, 200);
}

const validRetrieval = (value, expectedMode = "lexical-graph") => (
  hasExactKeys(value, ["mode", "vectorStore"])
  && value.mode === expectedMode
  && value.vectorStore === false
);
const validCost = (value) => (
  hasExactKeys(value, [
    "modelCalls", "promptTokens", "completionTokens", "estimatedCostUsd",
  ])
  && value.modelCalls === 0
  && value.promptTokens === 0
  && value.completionTokens === 0
  && value.estimatedCostUsd === 0
);
const validEvidence = (value) => (
  isPlainObject(value)
  && EDGE_ID.test(value.edgeId)
  && typeof value.sourcePath === "string"
  && SHA256_DIGEST.test(value.sourceDigest)
  && SHA256_DIGEST.test(value.parserDigest)
  && SHA256_DIGEST.test(value.excerptHash)
  && ["kind", "ruleId", "explanation", "parserId", "parserVersion", "confidence", "certainty"]
    .every((key) => boundedText(value[key], 2_000))
  && ["lineStart", "lineEnd", "columnStart", "columnEnd"]
    .every((key) => Number.isInteger(value[key]) && value[key] >= 1)
  && typeof value.excerpt === "string"
);
const validResolution = (value) => (
  isPlainObject(value)
  && boundedText(value.id)
  && ["id", "exact-label", "lexical"].includes(value.basis)
  && Array.isArray(value.candidates)
  && value.candidates.length >= 1
  && value.candidates.length <= 64
  && value.candidates.every((candidate) => boundedText(candidate))
);

export function validQuerySuccess(mode, value) {
  if (value.mode !== mode
    || !validRetrieval(value.retrieval)
    || !validCost(value.cost)
    || !validCompleteness(value.completeness)) return false;
  if (mode === "summary") {
    return isPlainObject(value.graph)
      && ["nodes", "edges"].every((key) => Number.isInteger(value.graph[key]) && value.graph[key] >= 0)
      && isPlainObject(value.nodeTypes)
      && isPlainObject(value.edgeLabels)
      && Number.isInteger(value.sources) && value.sources >= 0
      && Number.isInteger(value.repositories) && value.repositories >= 0
      && isPlainObject(value.parserCoverage)
      && Array.isArray(value.diagnostics);
  }
  if (mode === "search") {
    return typeof value.query === "string"
      && isPlainObject(value.results)
      && Array.isArray(value.results.nodes)
      && Array.isArray(value.results.edges)
      && value.results.nodes.length <= MAX_QUERY_RESULTS
      && value.results.edges.length <= MAX_QUERY_RESULTS
      && value.results.nodes.every((entry) => (
        hasExactKeys(entry, ["node", "score"])
        && validGraphNode(entry.node)
        && Number.isFinite(entry.score)
      ))
      && value.results.edges.every((entry) => (
        hasExactKeys(entry, ["edge", "score", "evidence"])
        && validGraphEdge(entry.edge)
        && Number.isFinite(entry.score)
        && validEvidence(entry.evidence)
      ))
      && Array.isArray(value.citations)
      && value.citations.length <= MAX_QUERY_RESULTS
      && value.citations.every(validEvidence);
  }
  if (mode === "path") {
    const validPath = value.path === null || (
      isPlainObject(value.path)
      && Array.isArray(value.path.nodeIds)
      && Array.isArray(value.path.edgeIds)
      && Array.isArray(value.path.nodes)
      && Array.isArray(value.path.edges)
      && value.path.nodeIds.length === value.path.nodes.length
      && value.path.edgeIds.length === value.path.edges.length
      && value.path.nodes.every(validGraphNode)
      && value.path.edges.every(validGraphEdge)
    );
    return typeof value.found === "boolean"
      && value.found === Boolean(value.path)
      && isPlainObject(value.resolution)
      && validResolution(value.resolution.from)
      && validResolution(value.resolution.to)
      && validPath
      && Array.isArray(value.citations)
      && value.citations.every(validEvidence);
  }
  const traversal = value.traversal;
  return ["incoming", "outgoing", "both"].includes(value.direction)
    && validResolution(value.resolution)
    && isPlainObject(traversal)
    && Array.isArray(traversal.nodeIds)
    && Array.isArray(traversal.edgeIds)
    && Array.isArray(traversal.nodes)
    && Array.isArray(traversal.edges)
    && traversal.nodeIds.length === traversal.nodes.length
    && traversal.edgeIds.length === traversal.edges.length
    && traversal.nodes.length <= MAX_QUERY_RESULTS + 1
    && traversal.edges.length <= MAX_QUERY_RESULTS
    && traversal.nodes.every(validGraphNode)
    && traversal.edges.every(validGraphEdge)
    && typeof traversal.limitTruncated === "boolean"
    && typeof traversal.depthLimited === "boolean"
    && Array.isArray(value.citations)
    && value.citations.every(validEvidence);
}

export function validExplainSuccess(request, value) {
  const evidence = value.evidence;
  return validGraphEdge(value.edge)
    && value.edge.id === request.edgeId
    && validGraphNode(value.source)
    && validGraphNode(value.target)
    && value.edge.source === value.source.id
    && value.edge.target === value.target.id
    && isPlainObject(evidence)
    && ["kind", "ruleId", "explanation", "parserId", "parserVersion", "sourcePath", "excerpt", "confidence", "certainty"]
      .every((key) => typeof evidence[key] === "string")
    && ["parserDigest", "sourceDigest", "excerptHash"].every((key) => SHA256_DIGEST.test(evidence[key]))
    && isPlainObject(evidence.sourceSpan)
    && ["lineStart", "lineEnd", "columnStart", "columnEnd"]
      .every((key) => Number.isInteger(evidence.sourceSpan[key]) && evidence.sourceSpan[key] >= 1)
    && Array.isArray(evidence.premiseEdgeIds)
    && evidence.premiseEdgeIds.every((id) => EDGE_ID.test(id))
    && Number.isInteger(evidence.candidateCount)
    && evidence.candidateCount >= 1
    && Array.isArray(evidence.candidateIds)
    && evidence.candidateIds.every((id) => boundedText(id))
    && validRetrieval(value.retrieval, "direct-edge-id")
    && validCost(value.cost);
}

export function validateAgenticGraphProjection(value, counts, fields) {
  const invalid = !isPlainObject(value)
    || !hasExactKeys(value, [
      "token", "readOnly", "graphData", "complete", "truncated", "limit", "reason",
    ], ["token", "readOnly", "graphData", "complete", "truncated", "limit"])
    || !PROJECTION_TOKEN.test(value.token)
    || value.readOnly !== true
    || typeof value.complete !== "boolean"
    || typeof value.truncated !== "boolean"
    || !Number.isInteger(value.limit)
    || value.limit < 1
    || value.limit > 1_000
    || !validGraphData(value.graphData)
    || (Object.hasOwn(value, "reason") && !boundedText(value.reason, 200));
  if (invalid) fields.push("projection");
  if (Array.isArray(value?.graphData?.nodes)
    && (value.graphData.nodes.length > MAX_PROJECTION_NODES
      || value.graphData.nodes.length > counts.nodes)) fields.push("projection.graphData.nodes");
  if (Array.isArray(value?.graphData?.edges)
    && (value.graphData.edges.length > MAX_PROJECTION_EDGES
      || value.graphData.edges.length > counts.edges)) fields.push("projection.graphData.edges");
  if (!isPlainObject(value)) return;
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_PROJECTION_BYTES) {
    fields.push("projection.bytes");
  }
}
