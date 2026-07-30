import path from "node:path";

import { deepFreeze, sha256, stableStringify } from "./canonical.js";
import { excerptForSpan, IR_SCHEMA } from "./ir.js";

export const GRAPH_SCHEMA = "agentic-knowledge-graph/v1";
export const EDGE_EVIDENCE_SCHEMA = "agentic-edge-evidence/v1";
export const MAX_GRAPH_NODES = 200_000;
export const MAX_GRAPH_EDGES = 400_000;

const CODE_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".kt", ".kts", ".scala", ".cs", ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".swift", ".rb", ".php", ".sh", ".bash", ".zsh"];
const DOCUMENT_EXTENSIONS = [".md", ".mdx", ".txt", ".rst", ".adoc", ".json", ".yaml", ".yml", ".toml", ".ini", ".env", ".properties", ".conf", ".cfg", ".sql", ".ddl", ".dml"];

export function buildKnowledgeGraph({ graphId, admission, parseResults }) {
  requireGraphId(graphId);
  if (!admission || !Array.isArray(admission.sources) || !Array.isArray(parseResults)) {
    throw new TypeError("admission and parse results are required");
  }
  validateParseResults(admission.sources, parseResults);
  const sourcesByPath = new Map(admission.sources.map((source) => [source.path, source]));
  const resultByPath = new Map(parseResults.map((result) => [result.source?.path, result]));
  const nodes = [];
  const edges = [];
  const nodeById = new Map();
  const fileNodeByPath = new Map();
  const localNodeByKey = new Map();
  const entityIndexes = new Map();

  for (const source of admission.sources) {
    const node = createNode({
      kind: "file",
      key: `file:${source.path}`,
      label: source.path,
      source: {
        path: source.path,
        digest: source.digest,
        parser: parserRecord(resultByPath.get(source.path)?.parser),
        span: null,
      },
      properties: { bytes: source.bytes, extension: path.posix.extname(source.path).toLowerCase() || "none" },
    });
    addNode(node);
    fileNodeByPath.set(source.path, node);
  }

  for (const result of ordered(parseResults, (record) => record.source?.path ?? "")) {
    const sourcePath = result.source?.path;
    const fileNode = fileNodeByPath.get(sourcePath);
    if (!fileNode) continue;
    for (const entity of ordered(result.entities ?? [], entityOrderKey)) {
      const node = createNode({
        kind: entity.kind,
        key: `entity:${sourcePath}:${entity.id}`,
        label: entity.name,
        source: {
          path: sourcePath,
          digest: sourcesByPath.get(sourcePath)?.digest ?? result.source?.digest,
          parser: parserRecord(result.parser, result),
          span: entity.span,
          ruleId: entity.ruleId,
        },
        properties: entity.properties ?? {},
      });
      addNode(node);
      localNodeByKey.set(`${sourcePath}\0${entity.id}`, node);
      indexEntity(entity.kind, entity.name, node);
    }
  }

  for (const result of ordered(parseResults, (record) => record.source?.path ?? "")) {
    const sourcePath = result.source?.path;
    const source = sourcesByPath.get(sourcePath);
    const fileNode = fileNodeByPath.get(sourcePath);
    if (!source || !fileNode) continue;
    for (const entity of ordered(result.entities ?? [], entityOrderKey)) {
      const node = localNodeByKey.get(`${sourcePath}\0${entity.id}`);
      if (!node) continue;
      const parent = entity.parentId
        ? localNodeByKey.get(`${sourcePath}\0${entity.parentId}`)
        : fileNode;
      const actualParent = parent ?? fileNode;
      addEdge(createExplainedEdge({
        relation: "contains",
        from: actualParent,
        to: node,
        source,
        parser: parserRecord(result.parser, result),
        span: entity.span,
        ruleId: entity.ruleId,
        certainty: "observed",
        candidates: [node.id],
      }));
    }
  }

  for (const result of ordered(parseResults, (record) => record.source?.path ?? "")) {
    const sourcePath = result.source?.path;
    const source = sourcesByPath.get(sourcePath);
    const fileNode = fileNodeByPath.get(sourcePath);
    if (!source || !fileNode) continue;
    for (const reference of ordered(result.references ?? [], referenceOrderKey)) {
      const from = resolveSourceNode({ reference, sourcePath, fileNode, localNodeByKey, entityIndexes });
      const resolution = resolveTarget({
        reference,
        sourcePath,
        fileNodeByPath,
        entityIndexes,
        addExternal: (kind, target, properties = {}) => {
          const key = `external:${kind}:${normalizeLookup(target)}`;
          const id = nodeId(kind, key);
          if (nodeById.has(id)) return nodeById.get(id);
          const external = createNode({ kind: `external-${kind}`, key, label: target, source: null, properties });
          addNode(external);
          return external;
        },
        addAmbiguity: (target, candidates) => {
          const candidateIds = candidates.map((candidate) => candidate.id).sort(compareText);
          const key = `ambiguous:${reference.targetKind}:${normalizeLookup(target)}:${candidateIds.join(",")}`;
          const id = nodeId("ambiguous-reference", key);
          if (nodeById.has(id)) return nodeById.get(id);
          const ambiguous = createNode({
            kind: "ambiguous-reference",
            key,
            label: target,
            source: null,
            properties: { candidateIds, targetKind: reference.targetKind },
          });
          addNode(ambiguous);
          return ambiguous;
        },
      });
      addEdge(createExplainedEdge({
        relation: reference.relation,
        from,
        to: resolution.node,
        source,
        parser: parserRecord(result.parser, result),
        span: reference.span,
        ruleId: reference.ruleId,
        certainty: resolution.certainty,
        candidates: resolution.candidates.map((candidate) => candidate.id),
        properties: reference.properties,
      }));
      if (resolution.certainty === "ambiguous") {
        for (const candidate of ordered(resolution.candidates, (node) => node.id)) {
          addEdge(createExplainedEdge({
            relation: "candidate",
            from: resolution.node,
            to: candidate,
            source,
            parser: parserRecord(result.parser, result),
            span: reference.span,
            ruleId: reference.ruleId,
            certainty: "resolved",
            candidates: [candidate.id],
            properties: { target: reference.target, targetKind: reference.targetKind },
          }));
        }
      }
    }
  }

  const sortedNodes = ordered(nodes, (node) => node.id);
  const sortedEdges = ordered(uniqueById(edges), (edge) => edge.id);
  assertExplainedEdges(sortedEdges, nodeById);
  const sourceManifest = admission.sources.map((source) => ({
    path: source.path,
    digest: source.digest,
    bytes: source.bytes,
  })).sort((left, right) => compareText(left.path, right.path));
  const parserManifest = uniqueParsers(parseResults);
  const diagnostics = collectDiagnostics(admission, parseResults);
  const rootDigest = sha256(stableStringify(sourceManifest));
  const body = {
    schema: GRAPH_SCHEMA,
    graphId,
    rootDigest,
    sourceManifest,
    parserManifest,
    nodes: sortedNodes,
    edges: sortedEdges,
    diagnostics,
    statistics: {
      sources: sourceManifest.length,
      parsers: parserManifest.length,
      nodes: sortedNodes.length,
      edges: sortedEdges.length,
      diagnostics: diagnostics.length,
    },
    economics: { modelCalls: 0, networkCalls: 0, embeddings: 0, vectorStores: 0, estimatedCostUsd: 0 },
  };
  return deepFreeze({ ...body, graphDigest: sha256(stableStringify(body)) });

  function addNode(node) {
    if (nodeById.has(node.id)) return nodeById.get(node.id);
    if (nodes.length >= MAX_GRAPH_NODES) throw graphError("graph_node_limit", `graph exceeds ${MAX_GRAPH_NODES} nodes`);
    nodeById.set(node.id, node);
    nodes.push(node);
    return node;
  }

  function addEdge(edge) {
    if (edges.length >= MAX_GRAPH_EDGES) throw graphError("graph_edge_limit", `graph exceeds ${MAX_GRAPH_EDGES} edges`);
    edges.push(edge);
  }

  function indexEntity(kind, name, node) {
    for (const key of new Set([
      `${kind}\0${normalizeLookup(name)}`,
      `any\0${normalizeLookup(name)}`,
      `any\0${normalizeLookup(name).split(".").at(-1)}`,
    ])) {
      if (!entityIndexes.has(key)) entityIndexes.set(key, []);
      entityIndexes.get(key).push(node);
    }
  }
}

function createNode({ kind, key, label, source, properties }) {
  const normalizedProperties = normalizeProperties(properties);
  return deepFreeze({
    id: nodeId(kind, key),
    kind,
    label,
    source,
    properties: normalizedProperties,
  });
}

function nodeId(kind, key) {
  return `n:${sha256(stableStringify({ kind, key })).slice(0, 32)}`;
}

function createExplainedEdge({
  relation,
  from,
  to,
  source,
  parser,
  span,
  ruleId,
  certainty,
  candidates,
  properties = {},
}) {
  if (!from || !to) throw new TypeError("edge endpoints are required");
  const sourceText = source.source ?? "";
  const excerpt = typeof sourceText === "string" ? excerptForSpan(sourceText, span) : "";
  const evidence = deepFreeze({
    schema: EDGE_EVIDENCE_SCHEMA,
    path: source.path,
    sourceDigest: source.digest,
    span,
    excerpt: excerpt || fallbackExcerpt(to),
    excerptDigest: sha256(Buffer.from(excerpt || fallbackExcerpt(to), "utf8")),
    parser,
    ruleId,
    certainty,
    candidateIds: [...candidates].sort(compareText),
  });
  const explanation = explain({ relation, from, to, evidence });
  const identity = {
    relation,
    from: from.id,
    to: to.id,
    evidence: {
      path: evidence.path,
      sourceDigest: evidence.sourceDigest,
      span: evidence.span,
      parser: evidence.parser,
      ruleId,
      certainty,
      candidateIds: evidence.candidateIds,
    },
  };
  return deepFreeze({
    id: `e:${sha256(stableStringify(identity)).slice(0, 32)}`,
    kind: relation,
    from: from.id,
    to: to.id,
    explanation,
    evidence,
    properties: normalizeProperties(properties),
  });
}

function explain({ relation, from, to, evidence }) {
  const rule = evidence.ruleId || "parser rule";
  const location = evidence.span?.start
    ? `${evidence.path}:${evidence.span.start.line}:${evidence.span.start.column}`
    : evidence.path;
  const templates = {
    contains: `${from.label} contains ${to.label}; ${rule} observed the declaration at ${location}.`,
    imports: `${from.label} imports ${to.label}; ${rule} observed the import at ${location}.`,
    calls: `${from.label} calls ${to.label}; ${rule} observed the call expression at ${location}.`,
    inherits: `${from.label} inherits from ${to.label}; ${rule} observed the inheritance clause at ${location}.`,
    "foreign-key": `${from.label} references ${to.label} through a foreign key; ${rule} observed the constraint at ${location}.`,
    "reads-from": `${from.label} reads from ${to.label}; ${rule} observed the SQL source at ${location}.`,
    "depends-on": `${from.label} depends on ${to.label}; ${rule} observed the dependency entry at ${location}.`,
    "links-to": `${from.label} links to ${to.label}; ${rule} observed the document link at ${location}.`,
    "configures-from": `${from.label} is configured from ${to.label}; ${rule} observed the path reference at ${location}.`,
    "reads-config": `${from.label} reads configuration ${to.label}; ${rule} observed the interpolation at ${location}.`,
    "declares-package": `${from.label} declares package ${to.label}; ${rule} observed the package declaration at ${location}.`,
    indexes: `${from.label} indexes ${to.label}; ${rule} observed the index target at ${location}.`,
    candidate: `${to.label} is a candidate for ${from.label}; ${rule} preserved the ambiguous reference at ${location}.`,
  };
  return templates[relation]
    ?? `${from.label} has ${relation} relationship to ${to.label}; ${rule} observed it at ${location}.`;
}

function resolveSourceNode({ reference, sourcePath, fileNode, localNodeByKey, entityIndexes }) {
  if (!reference.sourceId) return fileNode;
  if (reference.sourceId.startsWith("deferred:")) {
    const name = reference.properties?.sourceName ?? reference.sourceId.slice("deferred:".length);
    const localMatches = (entityIndexes.get(`any\0${normalizeLookup(name)}`) ?? [])
      .filter((node) => node.source?.path === sourcePath);
    return localMatches.length === 1 ? localMatches[0] : fileNode;
  }
  return localNodeByKey.get(`${sourcePath}\0${reference.sourceId}`) ?? fileNode;
}

function resolveTarget({ reference, sourcePath, fileNodeByPath, entityIndexes, addExternal, addAmbiguity }) {
  const target = reference.target;
  const targetKind = reference.targetKind;
  if (["module", "document", "file"].includes(targetKind)) {
    const files = resolveFileTargets(sourcePath, target, fileNodeByPath);
    if (files.length === 1) return { node: files[0], certainty: "resolved", candidates: files };
    if (files.length > 1) {
      return { node: addAmbiguity(target, files), certainty: "ambiguous", candidates: files };
    }
    const external = addExternal(targetKind, target);
    return { node: external, certainty: "observed", candidates: [] };
  }
  if (targetKind === "url") {
    const external = addExternal("resource", target);
    return { node: external, certainty: "observed", candidates: [] };
  }
  const exact = entityIndexes.get(`${targetKind}\0${normalizeLookup(target)}`) ?? [];
  const candidates = exact.length > 0 ? exact : entityIndexes.get(`any\0${normalizeLookup(target)}`) ?? [];
  if (candidates.length === 1) return { node: candidates[0], certainty: "resolved", candidates };
  if (candidates.length > 1) return { node: addAmbiguity(target, candidates), certainty: "ambiguous", candidates };
  const external = addExternal(targetKind, target);
  return { node: external, certainty: "observed", candidates: [] };
}

function resolveFileTargets(sourcePath, target, fileNodeByPath) {
  const clean = target.replace(/[?#].*$/, "").replace(/\\/g, "/");
  const base = clean.startsWith(".")
    ? path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), clean))
    : clean.replace(/^\/+/, "");
  const candidates = [base];
  if (!path.posix.extname(base)) {
    for (const extension of [...CODE_EXTENSIONS, ...DOCUMENT_EXTENSIONS]) {
      candidates.push(`${base}${extension}`, `${base}/index${extension}`);
    }
  }
  return [...new Set(candidates)]
    .map((candidate) => fileNodeByPath.get(candidate))
    .filter(Boolean)
    .sort((left, right) => compareText(left.id, right.id));
}

function parserRecord(parser, result = {}) {
  if (!parser && !result.artifactDigest) return null;
  return deepFreeze({
    id: parser?.id ?? result.grammar?.id ?? "custom",
    version: parser?.version ?? result.grammar?.version ?? "unknown",
    digest: parser?.digest ?? result.artifactDigest,
  });
}

function uniqueParsers(results) {
  const records = new Map();
  for (const result of results) {
    const record = parserRecord(result.parser, result);
    if (record?.digest) records.set(record.digest, record);
  }
  return [...records.values()].sort((left, right) => compareText(left.digest, right.digest));
}

function collectDiagnostics(admission, results) {
  const values = [
    ...(admission.diagnostics ?? []).map((record) => ({ ...record, stage: "admission" })),
    ...results.flatMap((result) => (result.diagnostics ?? []).map((record) => ({
      ...record,
      path: result.source?.path,
      stage: "parse",
    }))),
  ];
  return values.sort((left, right) => compareText(`${left.path}\0${left.code}\0${left.message}`, `${right.path}\0${right.code}\0${right.message}`));
}

function assertExplainedEdges(edges, nodeById) {
  for (const edge of edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) throw new Error(`edge ${edge.id} has a missing endpoint`);
    if (!edge.explanation || !edge.evidence?.sourceDigest || !edge.evidence?.ruleId || !edge.evidence?.span) {
      throw new Error(`edge ${edge.id} is missing explanation evidence`);
    }
  }
}

function uniqueById(values) {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function normalizeProperties(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return deepFreeze(Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareText(left, right))));
}

function fallbackExcerpt(node) {
  return String(node.properties?.text ?? node.label ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function normalizeLookup(value) {
  return String(value).normalize("NFKC").trim().toLowerCase().replace(/\\/g, "/");
}

function entityOrderKey(entity) {
  return `${String(entity.span?.start?.offset ?? "").padStart(12, "0")}\0${entity.kind}\0${entity.name}\0${entity.id}`;
}

function referenceOrderKey(reference) {
  return `${String(reference.span?.start?.offset ?? "").padStart(12, "0")}\0${reference.relation}\0${reference.target}\0${reference.id}`;
}

function ordered(values, key) {
  return [...values].sort((left, right) => compareText(key(left), key(right)));
}

function compareText(left, right) {
  return Buffer.compare(Buffer.from(String(left), "utf8"), Buffer.from(String(right), "utf8"));
}

function validateParseResults(sources, results) {
  const sourcesByPath = new Map();
  for (const source of sources) {
    if (!source || typeof source.path !== "string" || sourcesByPath.has(source.path)) {
      throw new TypeError("admitted source paths must be unique");
    }
    sourcesByPath.set(source.path, source);
  }
  const seen = new Set();
  for (const result of results) {
    const sourcePath = result?.source?.path;
    const source = sourcesByPath.get(sourcePath);
    if (result?.schema !== IR_SCHEMA || !source || seen.has(sourcePath)) {
      throw new TypeError("parse results must map one-to-one to admitted sources");
    }
    if (result.source.digest !== source.digest || result.source.bytes !== source.bytes) {
      throw new TypeError(`parse result source identity mismatch: ${sourcePath}`);
    }
    seen.add(sourcePath);
  }
  if (seen.size !== sourcesByPath.size) {
    throw new TypeError("every admitted source requires one parse result");
  }
}

function requireGraphId(value) {
  if (typeof value !== "string" || !/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(value)) {
    throw new TypeError("graphId must be a safe 1-64 character identifier");
  }
}

function graphError(code, message) {
  const error = new Error(message);
  error.name = "KnowledgeGraphBuildError";
  error.code = code;
  return error;
}
