import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256, stableStringify } from "../src/knowledge-graph/canonical.js";
import { parseCode } from "../src/knowledge-graph/code-parser.js";
import { buildKnowledgeGraph } from "../src/knowledge-graph/graph-builder.js";
import { createKnowledgeGraphRuntime } from "../src/knowledge-graph/runtime.js";
import { validateSnapshot } from "../src/knowledge-graph/snapshot-store.js";
import { admitWorkspace } from "../src/knowledge-graph/source-admission.js";
import { tokenize, TOKENIZER_TOKEN_LIMIT } from "../src/knowledge-graph/tokenizer.js";

test("graph construction rejects parse output from different source bytes", () => {
  const source = "function safe() {}\n";
  const admitted = {
    path: "app.js",
    absolutePath: "/not-read-by-builder/app.js",
    digest: sha256(Buffer.from(source)),
    bytes: Buffer.byteLength(source),
    source,
    contentBase64: null,
  };
  const injected = parseCode({ path: admitted.path, source: "function injected() {}\n" });
  assert.throws(
    () => buildKnowledgeGraph({
      graphId: "source-binding",
      admission: { sources: [admitted], diagnostics: [] },
      parseResults: [injected],
    }),
    /parse result source identity mismatch/,
  );
});

test("artifact and workspace roots must be disjoint", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-kg-overlap-"));
  const workspace = path.join(root, "workspace");
  mkdirSync(workspace);
  writeFileSync(path.join(workspace, "app.js"), "export const value = 1;\n");
  const runtime = createKnowledgeGraphRuntime({ artifactRoot: path.join(workspace, "artifacts") });
  assert.throws(
    () => runtime.ingest({ graphId: "overlap", root: workspace }),
    (error) => error?.code === "artifact_workspace_overlap",
  );
});

test("shared source tokenization fails before unbounded token allocation", () => {
  const source = "x ".repeat(TOKENIZER_TOKEN_LIMIT + 1);
  assert.throws(
    () => tokenize(source),
    (error) => error?.code === "tokenizer_token_limit"
      && error.detail?.limit === TOKENIZER_TOKEN_LIMIT
      && error.detail?.partial === false,
  );
});

test("admission exposes immutable text or encoded byte values, not mutable buffers", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-kg-admit-"));
  writeFileSync(path.join(root, "app.js"), "export const value = 1;\n");
  writeFileSync(path.join(root, "manual.pdf"), minimalPdf("Immutable bytes"));
  const admission = admitWorkspace({ root, supportedExtensions: [".js", ".pdf"] });
  const code = admission.sources.find((source) => source.path === "app.js");
  const pdf = admission.sources.find((source) => source.path === "manual.pdf");

  assert.equal(Object.isFrozen(code), true);
  assert.equal(Object.hasOwn(code, "buffer"), false);
  assert.equal(code.contentBase64, null);
  assert.equal(typeof pdf.contentBase64, "string");
  const copy = Buffer.from(pdf.contentBase64, "base64");
  copy[0] = 0;
  assert.equal(sha256(Buffer.from(pdf.contentBase64, "base64")), pdf.digest);
});

test("filename parsers and custom filename grammars survive admission and dispatch", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-kg-filename-"));
  const workspace = path.join(root, "workspace");
  const artifacts = path.join(root, "artifacts");
  mkdirSync(workspace);
  mkdirSync(artifacts);
  writeFileSync(path.join(workspace, "Dockerfile"), "BASE_IMAGE=node\n");
  writeFileSync(path.join(workspace, "manifest"), "entity Local\n");
  const runtime = createKnowledgeGraphRuntime({ artifactRoot: artifacts });
  const receipt = runtime.ingest({
    graphId: "filenames",
    root: workspace,
    grammars: [{
      schema: "agentic-parser-grammar/v1",
      id: "manifest-parser",
      version: "1",
      extensions: ["manifest"],
      rules: [{
        id: "manifest.entity",
        emit: "entity",
        kind: "component",
        sequence: [{ literal: "entity" }, { type: "identifier", capture: "name" }],
      }],
    }],
  });

  assert.ok(receipt.sourceManifest.some((source) => source.path === "Dockerfile"));
  assert.ok(receipt.parserManifest.some((parser) => parser.id === "builtin.config.dockerfile"));
  assert.ok(receipt.parserManifest.some((parser) => parser.id === "manifest-parser"));
});

test("stored snapshot validation rejects digest-consistent forged evidence", () => {
  const fixture = runtimeFixture();
  const runtime = createKnowledgeGraphRuntime({ artifactRoot: fixture.artifacts });
  const receipt = runtime.ingest({ graphId: "forged-evidence", root: fixture.workspace });
  const snapshot = JSON.parse(readFileSync(path.join(fixture.artifacts, receipt.artifactRef), "utf8"));
  snapshot.edges[0].evidence.sourceDigest = "0".repeat(64);
  const { graphDigest: ignored, ...body } = snapshot;
  snapshot.graphDigest = sha256(stableStringify(body));

  assert.throws(
    () => validateSnapshot(snapshot),
    (error) => error?.code === "snapshot_invalid",
  );
});

test("snapshot validation binds parser identity and ambiguity cardinality", () => {
  const fixture = runtimeFixture();
  const runtime = createKnowledgeGraphRuntime({ artifactRoot: fixture.artifacts });
  const receipt = runtime.ingest({ graphId: "forged-parser", root: fixture.workspace });
  const original = JSON.parse(readFileSync(path.join(fixture.artifacts, receipt.artifactRef), "utf8"));

  const parserForgery = structuredClone(original);
  parserForgery.nodes.find((node) => node.source?.parser).source.parser.id = "forged-parser";
  parserForgery.graphDigest = digestSnapshot(parserForgery);
  assert.throws(
    () => validateSnapshot(parserForgery),
    (error) => error?.code === "snapshot_invalid",
  );

  const evidenceForgery = structuredClone(original);
  const edge = evidenceForgery.edges[0];
  edge.evidence.certainty = "ambiguous";
  edge.evidence.candidateIds = [];
  edge.id = edgeIdentity(edge);
  evidenceForgery.edges.sort((left, right) => Buffer.compare(Buffer.from(left.id), Buffer.from(right.id)));
  evidenceForgery.graphDigest = digestSnapshot(evidenceForgery);
  assert.throws(
    () => validateSnapshot(evidenceForgery),
    (error) => error?.code === "snapshot_invalid",
  );
});

test("traversal bounds ambiguous starts and shortest-path work", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-kg-query-bounds-"));
  const workspace = path.join(root, "workspace");
  const artifacts = path.join(root, "artifacts");
  mkdirSync(workspace);
  mkdirSync(artifacts);
  for (let index = 0; index < 8; index += 1) {
    writeFileSync(path.join(workspace, `part-${index}.js`), "export function same() { return 1; }\n");
  }
  const runtime = createKnowledgeGraphRuntime({ artifactRoot: artifacts });
  const receipt = runtime.ingest({ graphId: "query-bounds", root: workspace });
  const all = runtime.query({
    graphId: receipt.graphId,
    expectedDigest: receipt.graphDigest,
    query: { operation: "search", term: "same", limit: 20 },
  });
  const functions = all.nodes.filter((node) => node.kind === "function");
  assert.equal(functions.length, 8);

  const neighbors = runtime.query({
    graphId: receipt.graphId,
    expectedDigest: receipt.graphDigest,
    query: { operation: "neighbors", node: "same", direction: "both", depth: 2, limit: 1 },
  });
  assert.equal(neighbors.queryPlan.startCandidates, 8);
  assert.equal(neighbors.truncated, true);
  assert.ok(neighbors.nodes.length <= 2);

  const pathResult = runtime.query({
    graphId: receipt.graphId,
    expectedDigest: receipt.graphDigest,
    query: {
      operation: "path",
      from: functions[0].id,
      to: functions.at(-1).id,
      direction: "both",
      depth: 6,
      limit: 1,
    },
  });
  assert.equal(pathResult.queryPlan.found, false);
  assert.equal(pathResult.truncated, true);
  assert.ok(pathResult.queryPlan.inspectedEdges <= 1);
});

function runtimeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-kg-integrity-"));
  const workspace = path.join(root, "workspace");
  const artifacts = path.join(root, "artifacts");
  mkdirSync(workspace);
  mkdirSync(artifacts);
  writeFileSync(path.join(workspace, "app.js"), [
    "export function run() { return helper(); }",
    "function helper() { return 1; }",
    "",
  ].join("\n"));
  return { workspace, artifacts };
}

function minimalPdf(text) {
  const stream = `BT (${text}) Tj ET`;
  return Buffer.from([
    "%PDF-1.4",
    `1 0 obj << /Length ${Buffer.byteLength(stream)} >>`,
    "stream",
    stream,
    "endstream",
    "endobj",
    "%%EOF",
    "",
  ].join("\n"), "latin1");
}

function digestSnapshot(snapshot) {
  const { graphDigest: ignored, ...body } = snapshot;
  return sha256(stableStringify(body));
}

function edgeIdentity(edge) {
  return `e:${sha256(stableStringify({
    relation: edge.kind,
    from: edge.from,
    to: edge.to,
    evidence: {
      path: edge.evidence.path,
      sourceDigest: edge.evidence.sourceDigest,
      span: edge.evidence.span,
      parser: edge.evidence.parser,
      ruleId: edge.evidence.ruleId,
      certainty: edge.evidence.certainty,
      candidateIds: edge.evidence.candidateIds,
    },
  })).slice(0, 32)}`;
}
