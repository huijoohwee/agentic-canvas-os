import { deepFreeze } from "./canonical.js";
import { validateSnapshot } from "./snapshot-store.js";

export const QUERY_RESULT_SCHEMA = "agentic-knowledge-graph-query-result/v1";
export const EXPLANATION_RESULT_SCHEMA = "agentic-knowledge-graph-explanation/v1";

const OPERATIONS = new Set(["summary", "search", "node", "neighbors", "impact", "path", "match"]);
const DIRECTIONS = new Set(["in", "out", "both"]);
const MAX_LIMIT = 200;
const MAX_DEPTH = 6;

export function querySnapshot(snapshot, request) {
  validateSnapshot(snapshot);
  const query = normalizeRequest(request);
  const graph = indexSnapshot(snapshot);
  let selected;
  if (query.operation === "summary") selected = summary(graph, query);
  else if (query.operation === "search") selected = lexicalSearch(graph, query);
  else if (query.operation === "node") selected = selectNode(graph, query);
  else if (query.operation === "neighbors") selected = traverse(graph, query, "both");
  else if (query.operation === "impact") selected = traverse(graph, query, "in");
  else if (query.operation === "path") selected = shortestPath(graph, query);
  else selected = matchGraph(graph, query);

  const nodes = [...selected.nodeIds].map((id) => graph.nodeById.get(id)).filter(Boolean).sort(compareById);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [...selected.edgeIds].map((id) => graph.edgeById.get(id))
    .filter((edge) => edge && nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .sort(compareById);
  return deepFreeze({
    schema: QUERY_RESULT_SCHEMA,
    graphId: snapshot.graphId,
    graphDigest: snapshot.graphDigest,
    operation: query.operation,
    queryPlan: selected.plan,
    nodes,
    edges,
    complete: !selected.truncated,
    truncated: selected.truncated,
    statistics: { nodes: nodes.length, edges: edges.length },
    economics: { modelCalls: 0, embeddings: 0, vectorLookups: 0, networkCalls: 0, estimatedCostUsd: 0 },
  });
}

export function explainEdge(snapshot, { edgeId } = {}) {
  validateSnapshot(snapshot);
  if (typeof edgeId !== "string" || !/^e:[a-f0-9]{32}$/.test(edgeId)) {
    throw queryError("edge_id_invalid", "edgeId must be an exact edge identity");
  }
  const edge = snapshot.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) throw queryError("edge_not_found", `edge ${edgeId} was not found`);
  const from = snapshot.nodes.find((node) => node.id === edge.from);
  const to = snapshot.nodes.find((node) => node.id === edge.to);
  if (!from || !to) throw queryError("snapshot_invalid", "edge endpoint is missing");
  return deepFreeze({
    schema: EXPLANATION_RESULT_SCHEMA,
    graphId: snapshot.graphId,
    graphDigest: snapshot.graphDigest,
    edge: {
      id: edge.id,
      kind: edge.kind,
      from,
      to,
      explanation: edge.explanation,
      evidence: edge.evidence,
      properties: edge.properties,
    },
    queryPlan: {
      algorithm: "exact-edge-id",
      reparsed: false,
      inferred: false,
      modelUsed: false,
      vectorLookupUsed: false,
    },
    economics: { modelCalls: 0, embeddings: 0, vectorLookups: 0, networkCalls: 0, estimatedCostUsd: 0 },
  });
}

function normalizeRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw queryError("query_invalid", "query must be an object");
  const allowed = new Set([
    "operation", "term", "node", "from", "to", "direction", "edgeKinds",
    "nodeKinds", "depth", "limit",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw queryError("query_invalid", `unsupported query fields: ${unknown.join(", ")}`);
  if (!OPERATIONS.has(value.operation)) throw queryError("query_invalid", `operation must be one of ${[...OPERATIONS].join(", ")}`);
  const limit = boundedInteger(value.limit, 50, 1, MAX_LIMIT, "limit");
  const depth = boundedInteger(value.depth, 1, 1, MAX_DEPTH, "depth");
  const direction = value.direction ?? "both";
  if (!DIRECTIONS.has(direction)) throw queryError("query_invalid", "direction must be in, out, or both");
  const result = {
    operation: value.operation,
    term: optionalText(value.term, "term"),
    node: optionalText(value.node, "node"),
    from: optionalText(value.from, "from"),
    to: optionalText(value.to, "to"),
    direction,
    edgeKinds: normalizeFilter(value.edgeKinds, "edgeKinds"),
    nodeKinds: normalizeFilter(value.nodeKinds, "nodeKinds"),
    depth,
    limit,
  };
  if (result.operation === "search" && !result.term) throw queryError("query_invalid", "search requires term");
  if (["node", "neighbors", "impact"].includes(result.operation) && !result.node) {
    throw queryError("query_invalid", `${result.operation} requires node`);
  }
  if (result.operation === "path" && (!result.from || !result.to)) throw queryError("query_invalid", "path requires from and to");
  return deepFreeze(result);
}

function indexSnapshot(snapshot) {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(snapshot.edges.map((edge) => [edge.id, edge]));
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of snapshot.edges) {
    push(outgoing, edge.from, edge);
    push(incoming, edge.to, edge);
  }
  return { snapshot, nodeById, edgeById, outgoing, incoming };
}

function summary(graph) {
  const nodeCounts = countBy(graph.snapshot.nodes, (node) => node.kind);
  const edgeCounts = countBy(graph.snapshot.edges, (edge) => edge.kind);
  return {
    nodeIds: new Set(),
    edgeIds: new Set(),
    truncated: false,
    plan: {
      algorithm: "manifest-count",
      nodeCounts,
      edgeCounts,
      sourceCount: graph.snapshot.sourceManifest.length,
      diagnosticCount: graph.snapshot.diagnostics.length,
      vectorLookupUsed: false,
    },
  };
}

function lexicalSearch(graph, query) {
  const terms = tokenizeQuery(query.term);
  const ranked = graph.snapshot.nodes
    .filter((node) => query.nodeKinds.length === 0 || query.nodeKinds.includes(node.kind))
    .map((node) => ({
    node,
    score: lexicalScore(node, terms),
  })).filter((record) => record.score > 0)
    .sort((left, right) => right.score - left.score || compareText(left.node.id, right.node.id));
  const selected = ranked.slice(0, query.limit);
  const nodeIds = new Set(selected.map((record) => record.node.id));
  const edgeIds = incidentEdges(graph, nodeIds, query.edgeKinds, query.limit);
  return {
    nodeIds,
    edgeIds,
    truncated: ranked.length > selected.length,
    plan: {
      algorithm: "normalized-lexical-scan",
      terms,
      candidates: ranked.length,
      limit: query.limit,
      vectorLookupUsed: false,
    },
  };
}

function selectNode(graph, query) {
  const matches = resolveNodes(graph, query.node, query.nodeKinds);
  const selected = matches.slice(0, query.limit);
  return {
    nodeIds: new Set(selected.map((node) => node.id)),
    edgeIds: new Set(),
    truncated: matches.length > selected.length,
    plan: { algorithm: "exact-id-or-label", candidates: matches.length, limit: query.limit, vectorLookupUsed: false },
  };
}

function traverse(graph, query, forcedDirection) {
  const starts = resolveNodes(graph, query.node, query.nodeKinds);
  if (starts.length === 0) throw queryError("node_not_found", `node ${query.node} was not found`);
  const selectedStarts = starts.slice(0, query.limit);
  const direction = query.operation === "neighbors" ? query.direction : forcedDirection;
  const nodeIds = new Set(selectedStarts.map((node) => node.id));
  const edgeIds = new Set();
  const queue = selectedStarts.map((node) => ({ id: node.id, depth: 0 }));
  let edgeTruncated = false;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.depth >= query.depth) continue;
    for (const edge of adjacentEdges(graph, current.id, direction, query.edgeKinds)) {
      if (edgeIds.has(edge.id)) continue;
      if (edgeIds.size >= query.limit) {
        edgeTruncated = true;
        break;
      }
      edgeIds.add(edge.id);
      const next = edge.from === current.id ? edge.to : edge.from;
      if (!nodeIds.has(next)) {
        nodeIds.add(next);
        queue.push({ id: next, depth: current.depth + 1 });
      }
    }
    if (edgeTruncated) break;
  }
  const truncated = starts.length > selectedStarts.length || edgeTruncated;
  return {
    nodeIds,
    edgeIds,
    truncated,
    plan: {
      algorithm: "bounded-breadth-first-traversal",
      direction,
      maxDepth: query.depth,
      startCandidates: starts.length,
      edgeLimit: query.limit,
      edgeKinds: query.edgeKinds,
      vectorLookupUsed: false,
    },
  };
}

function shortestPath(graph, query) {
  const from = requireUniqueNode(graph, query.from, "from");
  const to = requireUniqueNode(graph, query.to, "to");
  const queue = [{ id: from.id, depth: 0 }];
  const parent = new Map([[from.id, null]]);
  const via = new Map();
  let found = from.id === to.id;
  let truncated = false;
  let inspectedEdges = 0;
  while (queue.length > 0 && !found) {
    const current = queue.shift();
    if (current.depth >= query.depth) continue;
    for (const edge of adjacentEdges(graph, current.id, query.direction, query.edgeKinds)) {
      if (inspectedEdges >= query.limit) {
        truncated = true;
        break;
      }
      inspectedEdges += 1;
      const next = edge.from === current.id ? edge.to : edge.from;
      if (parent.has(next)) continue;
      if (parent.size >= query.limit) {
        truncated = true;
        break;
      }
      parent.set(next, current.id);
      via.set(next, edge.id);
      if (next === to.id) {
        found = true;
        break;
      }
      queue.push({ id: next, depth: current.depth + 1 });
    }
    if (truncated) break;
  }
  if (!found) {
    return {
      nodeIds: new Set(),
      edgeIds: new Set(),
      truncated,
      plan: {
        algorithm: "bounded-shortest-path",
        found: false,
        maxDepth: query.depth,
        workLimit: query.limit,
        inspectedEdges,
        vectorLookupUsed: false,
      },
    };
  }
  const nodeIds = new Set([to.id]);
  const edgeIds = new Set();
  let cursor = to.id;
  while (parent.get(cursor) !== null) {
    edgeIds.add(via.get(cursor));
    cursor = parent.get(cursor);
    nodeIds.add(cursor);
  }
  return {
    nodeIds,
    edgeIds,
    truncated: false,
    plan: {
      algorithm: "bounded-shortest-path",
      found: true,
      maxDepth: query.depth,
      workLimit: query.limit,
      inspectedEdges,
      hops: edgeIds.size,
      vectorLookupUsed: false,
    },
  };
}

function matchGraph(graph, query) {
  const eligibleNodes = graph.snapshot.nodes
    .filter((node) => query.nodeKinds.length === 0 || query.nodeKinds.includes(node.kind));
  const eligibleNodeIds = new Set(eligibleNodes.map((node) => node.id));
  const matchingNodes = eligibleNodes
    .slice(0, query.limit);
  const nodeIds = new Set(matchingNodes.map((node) => node.id));
  const eligibleEdges = graph.snapshot.edges
    .filter((edge) => (query.edgeKinds.length === 0 || query.edgeKinds.includes(edge.kind))
      && (query.nodeKinds.length === 0 || eligibleNodeIds.has(edge.from) || eligibleNodeIds.has(edge.to)));
  const matchingEdges = eligibleEdges
    .slice(0, query.limit);
  for (const edge of matchingEdges) {
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  }
  const possibleNodes = eligibleNodes.length;
  const possibleEdges = eligibleEdges.length;
  return {
    nodeIds,
    edgeIds: new Set(matchingEdges.map((edge) => edge.id)),
    truncated: possibleNodes > matchingNodes.length || possibleEdges > matchingEdges.length,
    plan: { algorithm: "typed-record-filter", nodeKinds: query.nodeKinds, edgeKinds: query.edgeKinds, limit: query.limit, vectorLookupUsed: false },
  };
}

function resolveNodes(graph, selector, kinds = []) {
  const normalized = normalize(selector);
  return graph.snapshot.nodes.filter((node) => {
    if (kinds.length > 0 && !kinds.includes(node.kind)) return false;
    return node.id === selector || normalize(node.label) === normalized;
  }).sort(compareById);
}

function requireUniqueNode(graph, selector, field) {
  const matches = resolveNodes(graph, selector);
  if (matches.length === 0) throw queryError("node_not_found", `${field} node ${selector} was not found`);
  if (matches.length > 1) throw queryError("node_ambiguous", `${field} node ${selector} matched ${matches.length} nodes`);
  return matches[0];
}

function adjacentEdges(graph, nodeId, direction, kinds) {
  const values = [
    ...(direction === "out" || direction === "both" ? graph.outgoing.get(nodeId) ?? [] : []),
    ...(direction === "in" || direction === "both" ? graph.incoming.get(nodeId) ?? [] : []),
  ];
  return [...new Map(values.map((edge) => [edge.id, edge])).values()]
    .filter((edge) => kinds.length === 0 || kinds.includes(edge.kind))
    .sort(compareById);
}

function incidentEdges(graph, nodeIds, kinds, limit) {
  const originalNodeIds = new Set(nodeIds);
  const values = graph.snapshot.edges.filter((edge) => (originalNodeIds.has(edge.from) || originalNodeIds.has(edge.to))
    && (kinds.length === 0 || kinds.includes(edge.kind))).slice(0, limit);
  for (const edge of values) {
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  }
  return new Set(values.map((edge) => edge.id));
}

function lexicalScore(node, terms) {
  const label = normalize(node.label);
  const haystack = normalize([node.label, node.kind, ...flattenValues(node.properties)].join(" "));
  let score = 0;
  for (const term of terms) {
    if (label === term) score += 100;
    else if (label.startsWith(term)) score += 25;
    else if (label.includes(term)) score += 10;
    else if (haystack.includes(term)) score += 2;
    else return 0;
  }
  return score;
}

function flattenValues(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(flattenValues);
  if (typeof value === "object") return Object.values(value).flatMap(flattenValues);
  return [String(value)];
}

function tokenizeQuery(value) {
  const terms = normalize(value).split(/[^\p{L}\p{N}_.:/-]+/u).filter(Boolean).slice(0, 16);
  if (terms.length === 0) throw queryError("query_invalid", "term must contain searchable text");
  return terms;
}

function normalizeFilter(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32 || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw queryError("query_invalid", `${field} must be an array of at most 32 non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))].sort(compareText);
}

function optionalText(value, field) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value.trim() || value.length > 512) throw queryError("query_invalid", `${field} must be a non-empty string`);
  return value.trim();
}

function boundedInteger(value, fallback, minimum, maximum, field) {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) {
    throw queryError("query_invalid", `${field} must be an integer from ${minimum} to ${maximum}`);
  }
  return selected;
}

function countBy(values, key) {
  const counts = {};
  for (const value of values) counts[key(value)] = (counts[key(value)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => compareText(left, right)));
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function normalize(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}

function compareById(left, right) {
  return compareText(left.id, right.id);
}

function compareText(left, right) {
  return Buffer.compare(Buffer.from(String(left), "utf8"), Buffer.from(String(right), "utf8"));
}

function queryError(code, message) {
  const error = new Error(message);
  error.name = "KnowledgeGraphQueryError";
  error.code = code;
  return error;
}
