import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { deepFreeze, sha256, stableStringify } from "./canonical.js";
import {
  EDGE_EVIDENCE_SCHEMA,
  GRAPH_SCHEMA,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
} from "./graph-builder.js";
import { ARTIFACT_SCHEMA, compileGrammar } from "./parser-generator.js";

const POINTER_SCHEMA = "agentic-knowledge-graph-pointer/v1";
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
let tempSequence = 0;

export function createSnapshotStore({ artifactRoot }) {
  const root = prepareRoot(artifactRoot);
  const graphsRoot = prepareDirectory(path.join(root, "graphs"));
  const parsersRoot = prepareDirectory(path.join(root, "parsers"));

  return deepFreeze({
    root,
    publishSnapshot,
    loadSnapshot,
    currentSnapshot,
    publishParser,
    loadParser,
  });

  function publishSnapshot(snapshot) {
    validateSnapshot(snapshot);
    const graphDirectory = prepareDirectory(path.join(graphsRoot, safeId(snapshot.graphId, "graphId")));
    const fileName = `${snapshot.graphDigest}.json`;
    const snapshotPath = path.join(graphDirectory, fileName);
    const bytes = `${stableStringify(snapshot)}\n`;
    if (Buffer.byteLength(bytes) > MAX_SNAPSHOT_BYTES) throw storeError("snapshot_too_large", "snapshot exceeds 64 MiB");
    publishImmutable(snapshotPath, bytes);
    const pointer = {
      schema: POINTER_SCHEMA,
      graphId: snapshot.graphId,
      graphDigest: snapshot.graphDigest,
      snapshot: fileName,
    };
    atomicReplace(path.join(graphDirectory, "current.json"), `${stableStringify(pointer)}\n`);
    return deepFreeze({
      graphId: snapshot.graphId,
      graphDigest: snapshot.graphDigest,
      artifactRef: `graphs/${snapshot.graphId}/${fileName}`,
      pointerRef: `graphs/${snapshot.graphId}/current.json`,
      bytes: Buffer.byteLength(bytes),
    });
  }

  function currentSnapshot(graphId) {
    const directory = existingChild(graphsRoot, safeId(graphId, "graphId"), "graph_not_found");
    const pointerPath = path.join(directory, "current.json");
    const pointer = readJson(pointerPath, "snapshot_pointer_invalid");
    if (pointer.schema !== POINTER_SCHEMA || pointer.graphId !== graphId
      || !isDigest(pointer.graphDigest) || pointer.snapshot !== `${pointer.graphDigest}.json`) {
      throw storeError("snapshot_pointer_invalid", "current snapshot pointer is invalid");
    }
    return deepFreeze(pointer);
  }

  function loadSnapshot({ graphId, expectedDigest }) {
    if (!isDigest(expectedDigest)) throw storeError("snapshot_digest_required", "expectedDigest must be a SHA-256 digest");
    const pointer = currentSnapshot(graphId);
    if (pointer.graphDigest !== expectedDigest) {
      throw storeError("snapshot_stale", "expected graph digest is not current", {
        graphId,
        expectedDigest,
        currentDigest: pointer.graphDigest,
      });
    }
    const directory = existingChild(graphsRoot, safeId(graphId, "graphId"), "graph_not_found");
    const snapshot = readJson(path.join(directory, pointer.snapshot), "snapshot_invalid");
    validateSnapshot(snapshot);
    if (snapshot.graphDigest !== expectedDigest) throw storeError("snapshot_invalid", "snapshot digest does not match pointer");
    return deepFreeze(snapshot);
  }

  function publishParser(artifact) {
    validateParserArtifact(artifact);
    const id = safeId(artifact.grammar?.id, "parser id");
    const directory = prepareDirectory(path.join(parsersRoot, id));
    const fileName = `${artifact.digest}.json`;
    const bytes = `${stableStringify(artifact)}\n`;
    publishImmutable(path.join(directory, fileName), bytes);
    return deepFreeze({
      parserId: id,
      parserDigest: artifact.digest,
      artifactRef: `parsers/${id}/${fileName}`,
      bytes: Buffer.byteLength(bytes),
    });
  }

  function loadParser({ parserId, parserDigest }) {
    const id = safeId(parserId, "parser id");
    if (!isDigest(parserDigest)) throw storeError("parser_digest_required", "parserDigest must be a SHA-256 digest");
    const directory = existingChild(parsersRoot, id, "parser_not_found");
    const artifact = readJson(path.join(directory, `${parserDigest}.json`), "parser_artifact_invalid");
    validateParserArtifact(artifact);
    if (artifact.digest !== parserDigest || artifact.grammar.id !== id) {
      throw storeError("parser_artifact_invalid", "stored parser artifact identity is invalid");
    }
    return deepFreeze(artifact);
  }
}

function validateParserArtifact(artifact) {
  try {
    if (!artifact || artifact.schema !== ARTIFACT_SCHEMA || !isDigest(artifact.digest)) throw new TypeError();
    const compiled = compileGrammar(artifact.grammar);
    if (stableStringify(compiled) !== stableStringify(artifact)) throw new TypeError();
  } catch {
    throw storeError("parser_artifact_invalid", "compiled parser artifact is invalid");
  }
}

export function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== GRAPH_SCHEMA || typeof snapshot.graphId !== "string"
    || !isDigest(snapshot.graphDigest) || !isDigest(snapshot.rootDigest)
    || !Array.isArray(snapshot.sourceManifest) || !Array.isArray(snapshot.parserManifest)
    || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)
    || !Array.isArray(snapshot.diagnostics) || snapshot.nodes.length > MAX_GRAPH_NODES
    || snapshot.edges.length > MAX_GRAPH_EDGES) {
    throw storeError("snapshot_invalid", "knowledge graph snapshot shape is invalid");
  }
  safeId(snapshot.graphId, "graphId");
  requireKeys(snapshot, [
    "schema", "graphId", "rootDigest", "sourceManifest", "parserManifest", "nodes",
    "edges", "diagnostics", "statistics", "economics", "graphDigest",
  ], "snapshot");
  const { graphDigest, ...body } = snapshot;
  let calculated;
  try {
    calculated = sha256(stableStringify(body));
  } catch {
    throw storeError("snapshot_invalid", "knowledge graph body is not canonical JSON");
  }
  if (calculated !== graphDigest) throw storeError("snapshot_invalid", "knowledge graph digest verification failed");
  const sourceByPath = validateSources(snapshot.sourceManifest);
  if (sha256(stableStringify(snapshot.sourceManifest)) !== snapshot.rootDigest) {
    throw storeError("snapshot_invalid", "knowledge graph source manifest digest is invalid");
  }
  const parsersByDigest = validateParsers(snapshot.parserManifest);
  const nodeById = validateNodes(snapshot.nodes, sourceByPath, parsersByDigest);
  const edgeIds = new Set();
  let previousEdge = null;
  for (const edge of snapshot.edges) {
    if (previousEdge !== null && compareText(previousEdge, edge.id) >= 0) {
      throw storeError("snapshot_invalid", "knowledge graph edges are unordered");
    }
    validateEdge(edge, nodeById, edgeIds, sourceByPath, parsersByDigest);
    previousEdge = edge.id;
  }
  requireKeys(snapshot.statistics, ["sources", "parsers", "nodes", "edges", "diagnostics"], "statistics");
  const expectedStatistics = {
    sources: snapshot.sourceManifest.length,
    parsers: snapshot.parserManifest.length,
    nodes: snapshot.nodes.length,
    edges: snapshot.edges.length,
    diagnostics: snapshot.diagnostics.length,
  };
  for (const [key, value] of Object.entries(expectedStatistics)) {
    if (snapshot.statistics[key] !== value) throw storeError("snapshot_invalid", `statistics.${key} is invalid`);
  }
  requireKeys(snapshot.economics, ["modelCalls", "networkCalls", "embeddings", "vectorStores", "estimatedCostUsd"], "economics");
  if (Object.values(snapshot.economics).some((value) => value !== 0)) {
    throw storeError("snapshot_invalid", "snapshot economics must report exact zero");
  }
  return snapshot;
}

function validateSources(values) {
  const records = new Map();
  let previous = null;
  for (const source of values) {
    requireKeys(source, ["path", "digest", "bytes"], "source manifest record");
    if (!text(source.path) || !isDigest(source.digest) || !Number.isInteger(source.bytes) || source.bytes < 0
      || records.has(source.path) || (previous !== null && compareText(previous, source.path) >= 0)) {
      throw storeError("snapshot_invalid", "source manifest record is invalid or unordered");
    }
    records.set(source.path, source);
    previous = source.path;
  }
  return records;
}

function validateParsers(values) {
  const records = new Map();
  let previous = null;
  for (const parser of values) {
    validateParser(parser);
    if (records.has(parser.digest) || (previous !== null && compareText(previous, parser.digest) >= 0)) {
      throw storeError("snapshot_invalid", "parser manifest is duplicated or unordered");
    }
    records.set(parser.digest, parser);
    previous = parser.digest;
  }
  return records;
}

function validateNodes(values, sourceByPath, parsersByDigest) {
  const records = new Map();
  let previous = null;
  for (const node of values) {
    requireKeys(node, ["id", "kind", "label", "source", "properties"], "node");
    if (!/^n:[a-f0-9]{32}$/.test(node.id) || records.has(node.id) || !text(node.kind) || !text(node.label)
      || (previous !== null && compareText(previous, node.id) >= 0) || !plainRecord(node.properties)) {
      throw storeError("snapshot_invalid", `node ${node.id ?? "unknown"} is invalid or unordered`);
    }
    if (node.source !== null) validateNodeSource(node.source, sourceByPath, parsersByDigest);
    records.set(node.id, node);
    previous = node.id;
  }
  return records;
}

function validateNodeSource(source, sourceByPath, parsersByDigest) {
  const keys = Object.keys(source).sort(compareText);
  const allowed = ["digest", "parser", "path", "ruleId", "span"];
  if (keys.some((key) => !allowed.includes(key)) || !text(source.path) || !isDigest(source.digest)) {
    throw storeError("snapshot_invalid", "node source is invalid");
  }
  const manifest = sourceByPath.get(source.path);
  if (!manifest || manifest.digest !== source.digest) throw storeError("snapshot_invalid", "node source is not in the manifest");
  validateParser(source.parser, parsersByDigest);
  if (source.span !== null) validateSpan(source.span, manifest.bytes);
  if (source.ruleId !== undefined && !text(source.ruleId)) throw storeError("snapshot_invalid", "node source rule is invalid");
}

function validateEdge(edge, nodeById, edgeIds, sourceByPath, parsersByDigest) {
  requireKeys(edge, ["id", "kind", "from", "to", "explanation", "evidence", "properties"], "edge");
  if (!/^e:[a-f0-9]{32}$/.test(edge.id) || edgeIds.has(edge.id) || !text(edge.kind)
    || !nodeById.has(edge.from) || !nodeById.has(edge.to) || !text(edge.explanation)
    || !plainRecord(edge.properties)) {
    throw storeError("snapshot_invalid", `edge ${edge.id ?? "unknown"} is invalid`);
  }
  const evidence = edge.evidence;
  requireKeys(evidence, [
    "schema", "path", "sourceDigest", "span", "excerpt", "excerptDigest", "parser",
    "ruleId", "certainty", "candidateIds",
  ], "edge evidence");
  const source = sourceByPath.get(evidence.path);
  if (evidence.schema !== EDGE_EVIDENCE_SCHEMA || !source || evidence.sourceDigest !== source.digest
    || typeof evidence.excerpt !== "string" || evidence.excerpt.length > 240
    || sha256(Buffer.from(evidence.excerpt, "utf8")) !== evidence.excerptDigest
    || !text(evidence.ruleId) || !["observed", "resolved", "ambiguous"].includes(evidence.certainty)
    || !Array.isArray(evidence.candidateIds)
    || new Set(evidence.candidateIds).size !== evidence.candidateIds.length
    || evidence.candidateIds.some((id, index, values) => index > 0 && compareText(values[index - 1], id) >= 0)
    || evidence.candidateIds.some((id) => !nodeById.has(id))
    || !validCandidateEvidence(edge, evidence, nodeById)) {
    throw storeError("snapshot_invalid", `edge ${edge.id} evidence is invalid`);
  }
  validateSpan(evidence.span, source.bytes);
  validateParser(evidence.parser, parsersByDigest);
  const identity = {
    relation: edge.kind,
    from: edge.from,
    to: edge.to,
    evidence: {
      path: evidence.path,
      sourceDigest: evidence.sourceDigest,
      span: evidence.span,
      parser: evidence.parser,
      ruleId: evidence.ruleId,
      certainty: evidence.certainty,
      candidateIds: evidence.candidateIds,
    },
  };
  if (edge.id !== `e:${sha256(stableStringify(identity)).slice(0, 32)}`) {
    throw storeError("snapshot_invalid", `edge ${edge.id} identity is invalid`);
  }
  edgeIds.add(edge.id);
}

function validCandidateEvidence(edge, evidence, nodeById) {
  if (evidence.certainty === "resolved") {
    return evidence.candidateIds.length === 1 && evidence.candidateIds[0] === edge.to;
  }
  if (evidence.certainty !== "ambiguous") {
    return evidence.candidateIds.length === 0
      || (evidence.candidateIds.length === 1 && evidence.candidateIds[0] === edge.to);
  }
  const target = nodeById.get(edge.to);
  return evidence.candidateIds.length > 1
    && target?.kind === "ambiguous-reference"
    && Array.isArray(target.properties?.candidateIds)
    && stableStringify(target.properties.candidateIds) === stableStringify(evidence.candidateIds);
}

function validateParser(parser, manifest = null) {
  requireKeys(parser, ["id", "version", "digest"], "parser identity");
  const canonical = manifest?.get(parser.digest);
  if (!text(parser.id) || !text(parser.version) || !isDigest(parser.digest)
    || (manifest && (!canonical
      || canonical.id !== parser.id
      || canonical.version !== parser.version
      || canonical.digest !== parser.digest))) {
    throw storeError("snapshot_invalid", "parser identity is invalid");
  }
}

function validateSpan(span, sourceBytes) {
  requireKeys(span, ["schema", "start", "end"], "source span");
  requireKeys(span.start, ["line", "column", "offset"], "source span start");
  requireKeys(span.end, ["line", "column", "offset"], "source span end");
  const points = [span.start, span.end];
  if (span.schema !== "agentic-source-span/v1"
    || points.some((point) => !Number.isInteger(point.line) || point.line < 1
      || !Number.isInteger(point.column) || point.column < 1
      || !Number.isInteger(point.offset) || point.offset < 0)
    || span.end.offset < span.start.offset || span.end.offset > sourceBytes) {
    throw storeError("snapshot_invalid", "source span is invalid");
  }
}

function requireKeys(value, expected, label) {
  if (!plainRecord(value)) throw storeError("snapshot_invalid", `${label} must be an object`);
  const keys = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw storeError("snapshot_invalid", `${label} fields are invalid`);
  }
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function compareText(left, right) {
  return Buffer.compare(Buffer.from(String(left), "utf8"), Buffer.from(String(right), "utf8"));
}

function prepareRoot(value) {
  if (typeof value !== "string" || !value.trim()) throw storeError("artifact_root_required", "artifactRoot is required");
  const absolute = path.resolve(value);
  mkdirSync(absolute, { recursive: true, mode: 0o700 });
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw storeError("artifact_root_invalid", "artifactRoot must be a real directory");
  return realpathSync(absolute);
}

function prepareDirectory(value) {
  mkdirSync(value, { recursive: true, mode: 0o700 });
  const stat = lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw storeError("artifact_path_invalid", "artifact directory must not be a symbolic link");
  return realpathSync(value);
}

function existingChild(parent, name, code) {
  const value = path.join(parent, name);
  const stat = lstatSync(value, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw storeError(code, `${name} was not found`);
  const real = realpathSync(value);
  if (!isDescendant(parent, real)) throw storeError("artifact_path_escape", "artifact path escaped its store");
  return real;
}

function publishImmutable(target, bytes) {
  if (existsSync(target)) {
    const existing = readFileSync(target, "utf8");
    if (existing !== bytes) throw storeError("artifact_collision", "content-addressed artifact bytes differ");
    return;
  }
  let descriptor;
  try {
    descriptor = openSync(target, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      const existing = readFileSync(target, "utf8");
      if (existing === bytes) return;
      throw storeError("artifact_collision", "content-addressed artifact bytes differ");
    }
    throw error;
  }
  try {
    writeFileSync(descriptor, bytes, "utf8");
    fsyncSync(descriptor);
  } catch (error) {
    try {
      closeSync(descriptor);
    } catch {
      // Preserve the original failure.
    }
    try {
      unlinkSync(target);
    } catch {
      // Preserve the publication failure.
    }
    throw error;
  }
  closeSync(descriptor);
}

function atomicReplace(target, bytes) {
  const temporary = `${target}.tmp-${process.pid}-${++tempSequence}`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, bytes, "utf8");
    fsyncSync(descriptor);
  } catch (error) {
    try {
      closeSync(descriptor);
    } catch {
      // Preserve the original failure.
    }
    try {
      unlinkSync(temporary);
    } catch {
      // Preserve the publication failure.
    }
    throw error;
  }
  closeSync(descriptor);
  renameSync(temporary, target);
}

function readJson(file, code) {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > MAX_SNAPSHOT_BYTES) {
    throw storeError(code, "artifact is missing, unsafe, or too large");
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw storeError(code, "artifact is not valid JSON");
  }
}

function safeId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(value)) {
    throw storeError("artifact_id_invalid", `${label} must be a safe 1-64 character identifier`);
  }
  return value;
}

function isDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isDescendant(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function storeError(code, message, data = undefined) {
  const error = new Error(message);
  error.name = "KnowledgeGraphStoreError";
  error.code = code;
  if (data !== undefined) error.data = data;
  return error;
}
