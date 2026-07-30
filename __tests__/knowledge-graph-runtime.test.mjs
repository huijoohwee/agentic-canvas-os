import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createKnowledgeGraphRuntime } from "../src/knowledge-graph/runtime.js";

const GRAMMAR = {
  schema: "agentic-parser-grammar/v1",
  id: "fixture-language",
  version: "1.0.0",
  extensions: [".toy"],
  commentPrefixes: ["//"],
  rules: [
    {
      id: "fixture.entity",
      emit: "entity",
      kind: "component",
      sequence: [
        { literal: "entity" },
        { type: "identifier", capture: "name" },
        { literal: "{" },
      ],
      opensBlock: true,
    },
    {
      id: "fixture.uses",
      emit: "reference",
      relation: "uses",
      targetKind: "symbol",
      source: "enclosing",
      sequence: [
        { literal: "uses" },
        { type: "identifier", capture: "target" },
      ],
    },
  ],
};

test("ingests a mixed codebase into a byte-stable explained graph", () => {
  const fixture = createFixture();
  const runtime = createKnowledgeGraphRuntime({ artifactRoot: fixture.artifacts });
  const before = digestTree(fixture.workspace);
  const first = runtime.ingest({
    graphId: "mixed-fixture",
    root: fixture.workspace,
    grammars: [GRAMMAR],
  });
  const firstArtifact = readFileSync(path.join(fixture.artifacts, first.artifactRef));
  const second = runtime.ingest({
    graphId: "mixed-fixture",
    root: fixture.workspace,
    grammars: [GRAMMAR],
  });
  const secondArtifact = readFileSync(path.join(fixture.artifacts, second.artifactRef));

  assert.equal(first.graphDigest, second.graphDigest);
  assert.deepEqual(firstArtifact, secondArtifact);
  assert.equal(digestTree(fixture.workspace), before);
  assert.equal(first.economics.modelCalls, 0);
  assert.equal(first.economics.networkCalls, 0);
  assert.equal(first.economics.embeddings, 0);
  assert.equal(first.economics.vectorStores, 0);
  assert.ok(first.statistics.nodes > first.statistics.sources);
  assert.ok(first.statistics.edges > 0);
  assert.ok(first.parserManifest.some((parser) => parser.id === "fixture-language"));

  const graph = runtime.query({
    graphId: first.graphId,
    expectedDigest: first.graphDigest,
    query: { operation: "match", limit: 200 },
  });
  const kinds = new Set(graph.nodes.map((node) => node.kind));
  for (const kind of ["file", "function", "table", "column", "section", "config-key", "component", "pdf-region"]) {
    assert.ok(kinds.has(kind), `expected ${kind}`);
  }
  assert.ok(graph.edges.some((edge) => edge.kind === "foreign-key"));
  assert.ok(graph.edges.some((edge) => edge.kind === "imports"));
  assert.ok(graph.edges.some((edge) => edge.kind === "links-to"));
  for (const edge of graph.edges) {
    assert.match(edge.id, /^e:[a-f0-9]{32}$/);
    assert.ok(edge.explanation.length > 20);
    assert.ok(edge.evidence.sourceDigest);
    assert.ok(edge.evidence.parser.digest);
    assert.ok(edge.evidence.ruleId);
    assert.ok(edge.evidence.span);
    assert.equal(typeof edge.evidence.excerpt, "string");
  }
});

test("supports lexical, neighborhood, path, impact, and exact explanation operations", () => {
  const fixture = createFixture();
  const runtime = createKnowledgeGraphRuntime({ artifactRoot: fixture.artifacts });
  const receipt = runtime.ingest({ graphId: "queries", root: fixture.workspace, grammars: [GRAMMAR] });
  const search = runtime.query({
    graphId: receipt.graphId,
    expectedDigest: receipt.graphDigest,
    query: { operation: "search", term: "helper", limit: 20 },
  });
  assert.ok(search.nodes.some((node) => node.label.toLowerCase().includes("helper")));
  assert.equal(search.queryPlan.vectorLookupUsed, false);

  const helper = search.nodes.find((node) => node.kind === "function") ?? search.nodes[0];
  const neighbors = runtime.query({
    graphId: receipt.graphId,
    expectedDigest: receipt.graphDigest,
    query: { operation: "neighbors", node: helper.id, direction: "both", depth: 2, limit: 30 },
  });
  assert.ok(neighbors.nodes.some((node) => node.id === helper.id));
  assert.ok(neighbors.edges.length > 0);

  const target = neighbors.nodes.find((node) => node.id !== helper.id);
  const pathResult = runtime.query({
    graphId: receipt.graphId,
    expectedDigest: receipt.graphDigest,
    query: { operation: "path", from: helper.id, to: target.id, direction: "both", depth: 4 },
  });
  assert.equal(pathResult.queryPlan.found, true);

  const impact = runtime.query({
    graphId: receipt.graphId,
    expectedDigest: receipt.graphDigest,
    query: { operation: "impact", node: helper.id, depth: 3, limit: 30 },
  });
  assert.equal(impact.operation, "impact");

  const explained = runtime.explain({
    graphId: receipt.graphId,
    expectedDigest: receipt.graphDigest,
    edgeId: neighbors.edges[0].id,
  });
  assert.equal(explained.edge.id, neighbors.edges[0].id);
  assert.equal(explained.edge.explanation, neighbors.edges[0].explanation);
  assert.equal(explained.queryPlan.reparsed, false);
  assert.equal(explained.queryPlan.vectorLookupUsed, false);
});

test("atomically advances current digest and rejects stale readers", () => {
  const fixture = createFixture();
  const runtime = createKnowledgeGraphRuntime({ artifactRoot: fixture.artifacts });
  const first = runtime.ingest({ graphId: "stale-proof", root: fixture.workspace, grammars: [GRAMMAR] });
  writeFileSync(path.join(fixture.workspace, "src", "helper.ts"), "export function helper() { return 2; }\n", "utf8");
  const second = runtime.ingest({ graphId: "stale-proof", root: fixture.workspace, grammars: [GRAMMAR] });
  assert.notEqual(second.graphDigest, first.graphDigest);
  assert.throws(
    () => runtime.query({
      graphId: first.graphId,
      expectedDigest: first.graphDigest,
      query: { operation: "summary" },
    }),
    (error) => error?.code === "snapshot_stale",
  );
  assert.equal(runtime.current({ graphId: second.graphId }).graphDigest, second.graphDigest);
});

test("fails closed on unsafe bounds and reports symlink, binary, and unsupported inputs", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture.workspace, "binary.js"), Buffer.from([0, 1, 2, 3]));
  const outside = path.join(fixture.root, "outside.ts");
  writeFileSync(outside, "export const outside = true;\n", "utf8");
  symlinkSync(outside, path.join(fixture.workspace, "linked.ts"));
  writeFileSync(path.join(fixture.workspace, "notes.unknown"), "unparsed\n", "utf8");
  const runtime = createKnowledgeGraphRuntime({ artifactRoot: fixture.artifacts });

  const result = runtime.ingest({
    graphId: "bounded",
    root: fixture.workspace,
    grammars: [GRAMMAR],
    bounds: { maxFiles: 20, maxFileBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 },
  });
  const codes = new Set(result.diagnostics.map((entry) => entry.code));
  assert.ok(codes.has("binary_unsupported"));
  assert.ok(codes.has("symlink_ignored"));
  assert.ok(codes.has("extension_unsupported"));
  assert.throws(
    () => runtime.ingest({
      graphId: "invalid-bounds",
      root: fixture.workspace,
      bounds: { maxFiles: 2001 },
    }),
    (error) => error?.code === "admission_bounds_invalid",
  );
});

test("generates and persists inert parser artifacts without executable code", () => {
  const fixture = createFixture();
  const runtime = createKnowledgeGraphRuntime({ artifactRoot: fixture.artifacts });
  const generated = runtime.generateParser({ grammar: GRAMMAR });
  assert.match(generated.parserDigest, /^[a-f0-9]{64}$/);
  assert.equal(generated.parserId, "fixture-language");
  assert.equal(generated.persisted, true);
  const artifact = JSON.parse(readFileSync(path.join(fixture.artifacts, generated.artifactRef), "utf8"));
  assert.equal(artifact.digest, generated.parserDigest);
  assert.equal(JSON.stringify(artifact).includes("function"), false);
});

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-knowledge-graph-"));
  const workspace = path.join(root, "workspace");
  const artifacts = path.join(root, "artifacts");
  mkdirSync(path.join(workspace, "src"), { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(path.join(workspace, "src", "app.ts"), [
    'import { helper } from "./helper";',
    "export class Service extends BaseService {",
    "  run() { helper(); }",
    "}",
    "",
  ].join("\n"));
  writeFileSync(path.join(workspace, "src", "helper.ts"), "export function helper() { return 1; }\n");
  writeFileSync(path.join(workspace, "schema.sql"), [
    "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    "CREATE TABLE posts (",
    "  id INTEGER PRIMARY KEY,",
    "  user_id INTEGER REFERENCES users(id)",
    ");",
    "",
  ].join("\n"));
  writeFileSync(path.join(workspace, "README.md"), "# Service\n\nSee [the schema](schema.sql).\n");
  writeFileSync(path.join(workspace, "package.json"), JSON.stringify({
    name: "fixture",
    dependencies: { local_library: "1.0.0" },
    extends: "./config/base.json",
  }, null, 2));
  writeFileSync(path.join(workspace, "settings.yaml"), "database:\n  url: ${DB_URL}\n");
  writeFileSync(path.join(workspace, "model.toy"), "entity Widget {\n  uses helper\n}\n");
  writeFileSync(path.join(workspace, "manual.pdf"), minimalPdf("Runtime PDF Guide"));
  return { root, workspace, artifacts };
}

function minimalPdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  return Buffer.from([
    "%PDF-1.4",
    `1 0 obj << /Length ${Buffer.byteLength(stream)} >>`,
    "stream",
    stream,
    "endstream",
    "endobj",
    "trailer << /Root 1 0 R >>",
    "%%EOF",
    "",
  ].join("\n"), "latin1");
}

function digestTree(root) {
  const hash = createHash("sha256");
  for (const relative of [
    "README.md", "manual.pdf", "model.toy", "package.json", "schema.sql",
    "settings.yaml", "src/app.ts", "src/helper.ts",
  ]) {
    hash.update(relative);
    hash.update(readFileSync(path.join(root, relative)));
  }
  return hash.digest("hex");
}
