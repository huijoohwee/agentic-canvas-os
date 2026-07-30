import path from "node:path";
import { lstatSync, realpathSync } from "node:fs";

import { deepFreeze } from "./canonical.js";
import { CODE_EXTENSIONS, parseCode, supportsCodePath } from "./code-parser.js";
import { CONFIG_EXTENSIONS, parseConfig, supportsConfigPath } from "./config-parser.js";
import { DOCUMENT_EXTENSIONS, parseDocument, supportsDocumentPath } from "./document-parser.js";
import { buildKnowledgeGraph, MAX_GRAPH_EDGES, MAX_GRAPH_NODES } from "./graph-builder.js";
import { createIr, diagnostic, parserIdentity } from "./ir.js";
import { compileGrammar, parseWithGrammar } from "./parser-generator.js";
import { PDF_EXTENSIONS, parsePdf, supportsPdfPath } from "./pdf-parser.js";
import { explainEdge, querySnapshot } from "./query-engine.js";
import { admitWorkspace } from "./source-admission.js";
import { createSnapshotStore } from "./snapshot-store.js";
import { parseSql, SQL_EXTENSIONS, supportsSqlPath } from "./sql-parser.js";

export const INGEST_RESULT_SCHEMA = "agentic-knowledge-graph-ingest-result/v1";
export const PARSER_RESULT_SCHEMA = "agentic-parser-generation-result/v1";

const BUILTIN_EXTENSIONS = Object.freeze([
  ...new Set([
    ...CODE_EXTENSIONS,
    ...CONFIG_EXTENSIONS,
    ...DOCUMENT_EXTENSIONS,
    ...PDF_EXTENSIONS,
    ...SQL_EXTENSIONS,
  ]),
].sort(compareText));

export function createKnowledgeGraphRuntime({ artifactRoot }) {
  const store = createSnapshotStore({ artifactRoot });

  return deepFreeze({
    artifactRoot: store.root,
    generateParser,
    ingest,
    query,
    explain,
    current,
  });

  function generateParser({ grammar, persist = true } = {}) {
    const artifact = compileGrammar(grammar);
    const publication = persist ? store.publishParser(artifact) : null;
    return deepFreeze({
      schema: PARSER_RESULT_SCHEMA,
      parserId: artifact.grammar.id,
      parserVersion: artifact.grammar.version,
      parserDigest: artifact.digest,
      extensions: artifact.grammar.extensions,
      artifactRef: publication?.artifactRef ?? null,
      persisted: Boolean(publication),
      diagnostics: [],
      economics: zeroEconomics(),
    });
  }

  function ingest({
    graphId,
    root,
    grammars = [],
    parserArtifacts = [],
    bounds = {},
    exclude = [],
  } = {}) {
    const workspaceRoot = resolveWorkspaceRoot(root);
    if (pathsOverlap(workspaceRoot, store.root)) {
      throw runtimeError("artifact_workspace_overlap", "artifactRoot and ingest root must be disjoint");
    }
    const customArtifacts = resolveArtifacts({ grammars, parserArtifacts, store });
    const customByExtension = indexCustomParsers(customArtifacts);
    const admission = admitWorkspace({
      root: workspaceRoot,
      supportedExtensions: [...BUILTIN_EXTENSIONS, ...customByExtension.keys()],
      bounds,
      exclude,
    });
    const parseResults = parseAdmittedSources(admission.sources, customByExtension);
    const snapshot = buildKnowledgeGraph({ graphId, admission, parseResults });
    const publication = store.publishSnapshot(snapshot);
    return deepFreeze({
      schema: INGEST_RESULT_SCHEMA,
      graphId: snapshot.graphId,
      graphDigest: snapshot.graphDigest,
      rootDigest: snapshot.rootDigest,
      artifactRef: publication.artifactRef,
      pointerRef: publication.pointerRef,
      statistics: snapshot.statistics,
      sourceManifest: snapshot.sourceManifest,
      parserManifest: snapshot.parserManifest,
      diagnostics: snapshot.diagnostics,
      admission: admission.manifest,
      economics: zeroEconomics(),
    });
  }

  function query({ graphId, expectedDigest, query: request } = {}) {
    const snapshot = store.loadSnapshot({ graphId, expectedDigest });
    return querySnapshot(snapshot, request);
  }

  function explain({ graphId, expectedDigest, edgeId } = {}) {
    const snapshot = store.loadSnapshot({ graphId, expectedDigest });
    return explainEdge(snapshot, { edgeId });
  }

  function current({ graphId } = {}) {
    return store.currentSnapshot(graphId);
  }
}

function parseAdmittedSources(sources, customByExtension) {
  const results = [];
  let entities = 0;
  let references = 0;
  let diagnostics = 0;
  for (const source of sources) {
    const result = parseSource({ source, customByExtension });
    entities += result.entities.length;
    references += result.references.length;
    diagnostics += result.diagnostics.length;
    if (sources.length + entities > MAX_GRAPH_NODES || references > MAX_GRAPH_EDGES || diagnostics > 100_000) {
      throw runtimeError("parse_record_limit", "parsed source records exceed the graph publication bounds");
    }
    results.push(result);
  }
  return results;
}

function resolveArtifacts({ grammars, parserArtifacts, store }) {
  if (!Array.isArray(grammars) || grammars.length > 32) throw runtimeError("grammar_list_invalid", "grammars must be an array of at most 32 definitions");
  if (!Array.isArray(parserArtifacts) || parserArtifacts.length > 32) {
    throw runtimeError("parser_artifact_list_invalid", "parserArtifacts must be an array of at most 32 references");
  }
  const artifacts = grammars.map((grammar) => {
    const artifact = compileGrammar(grammar);
    store.publishParser(artifact);
    return artifact;
  });
  for (const reference of parserArtifacts) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)
      || Object.keys(reference).some((key) => !["parserId", "parserDigest"].includes(key))) {
      throw runtimeError("parser_artifact_reference_invalid", "parser artifact references require parserId and parserDigest");
    }
    artifacts.push(store.loadParser(reference));
  }
  const byDigest = new Map();
  for (const artifact of artifacts) {
    if (byDigest.has(artifact.digest)) continue;
    byDigest.set(artifact.digest, artifact);
  }
  return [...byDigest.values()].sort((left, right) => compareText(left.digest, right.digest));
}

function indexCustomParsers(artifacts) {
  const result = new Map();
  for (const artifact of artifacts) {
    for (const extension of artifact.grammar.extensions) {
      const normalized = extension.toLowerCase();
      if (BUILTIN_EXTENSIONS.includes(normalized)) {
        throw runtimeError("parser_extension_collision", `custom parser ${artifact.grammar.id} collides with built-in extension ${normalized}`);
      }
      if (result.has(normalized)) throw runtimeError("parser_extension_collision", `multiple custom parsers claim ${normalized}`);
      result.set(normalized, artifact);
    }
  }
  return result;
}

function parseSource({ source, customByExtension }) {
  try {
    const extension = path.posix.extname(source.path).toLowerCase();
    const fileName = path.posix.basename(source.path).toLowerCase();
    const custom = customByExtension.get(extension) ?? customByExtension.get(fileName);
    if (custom) return parseWithGrammar(custom, { source: source.source, path: source.path });
    if (supportsPdfPath(source.path)) return parsePdf({ path: source.path, bytes: sourceBytes(source) });
    if (supportsSqlPath(source.path)) return parseSql({ path: source.path, source: source.source });
    if (supportsConfigPath(source.path)) return parseConfig({ path: source.path, source: source.source });
    if (supportsDocumentPath(source.path)) return parseDocument({ path: source.path, source: source.source });
    if (supportsCodePath(source.path)) return parseCode({ path: source.path, source: source.source });
    return omission(source, "parser_unavailable", "No parser accepted the admitted source.");
  } catch (error) {
    return omission(
      source,
      error?.code ?? "parser_failed",
      error instanceof Error ? error.message : String(error),
      "error",
    );
  }
}

function omission(source, code, message, severity = "warning") {
  const text = source.source ?? sourceBytes(source).toString("latin1");
  return createIr({
    path: source.path,
    source: text,
    sourceDigest: source.digest,
    sourceBytes: source.bytes,
    parser: parserIdentity("builtin.typed-omission", "1.0.0", {}),
    diagnostics: [diagnostic({ code, message, severity })],
  });
}

function sourceBytes(source) {
  if (typeof source.contentBase64 !== "string") throw runtimeError("source_bytes_missing", `binary bytes are missing for ${source.path}`);
  const bytes = Buffer.from(source.contentBase64, "base64");
  if (bytes.length !== source.bytes) throw runtimeError("source_bytes_invalid", `binary byte length drifted for ${source.path}`);
  return bytes;
}

function resolveWorkspaceRoot(value) {
  if (typeof value !== "string" || !value.trim()) throw runtimeError("workspace_root_required", "workspace root is required");
  const absolute = path.resolve(value);
  const stat = lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw runtimeError("workspace_root_invalid", "workspace root must be a real directory");
  }
  return realpathSync(absolute);
}

function pathsOverlap(left, right) {
  return isWithin(left, right) || isWithin(right, left);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function zeroEconomics() {
  return deepFreeze({
    modelCalls: 0,
    networkCalls: 0,
    embeddings: 0,
    vectorStores: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
  });
}

function compareText(left, right) {
  return Buffer.compare(Buffer.from(String(left), "utf8"), Buffer.from(String(right), "utf8"));
}

function runtimeError(code, message) {
  const error = new Error(message);
  error.name = "KnowledgeGraphRuntimeError";
  error.code = code;
  return error;
}
