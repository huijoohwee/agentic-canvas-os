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

import { createKnowledgeGraphRuntime } from "../src/knowledge-graph/runtime.js";

test("SQL deferred sources stay file-local and ambiguity candidates are traversable", () => {
  const fixture = createFixture("agentic-kg-sql-resolution-");
  const sql = [
    "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    "CREATE TABLE posts (",
    "  user_id INTEGER,",
    "  FOREIGN KEY (user_id) REFERENCES users(id)",
    ");",
    "",
  ].join("\n");
  writeFileSync(path.join(fixture.workspace, "a.sql"), sql);
  writeFileSync(path.join(fixture.workspace, "b.sql"), sql);
  const runtime = createKnowledgeGraphRuntime({ artifactRoot: fixture.artifacts });
  const receipt = runtime.ingest({ graphId: "sql-resolution", root: fixture.workspace });
  const snapshot = JSON.parse(readFileSync(path.join(fixture.artifacts, receipt.artifactRef), "utf8"));
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));

  const reference = snapshot.edges.find((edge) => (
    edge.kind === "foreign-key" && edge.evidence.path === "b.sql"
  ));
  assert.ok(reference);
  assert.equal(nodeById.get(reference.from).source.path, "b.sql");
  assert.equal(nodeById.get(reference.to).kind, "ambiguous-reference");
  assert.equal(reference.evidence.certainty, "ambiguous");
  assert.equal(reference.evidence.candidateIds.length, 2);

  const candidates = snapshot.edges.filter((edge) => (
    edge.kind === "candidate"
    && edge.from === reference.to
    && edge.evidence.path === "b.sql"
  ));
  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map((edge) => nodeById.get(edge.to).source.path).sort(),
    ["a.sql", "b.sql"],
  );
  for (const edge of candidates) {
    assert.equal(edge.evidence.certainty, "resolved");
    assert.deepEqual(edge.evidence.candidateIds, [edge.to]);
    assert.equal(runtime.explain({
      graphId: receipt.graphId,
      expectedDigest: receipt.graphDigest,
      edgeId: edge.id,
    }).edge.id, edge.id);
  }
});

test("bare modules stay external and query node-kind filters are exact", () => {
  const fixture = createFixture("agentic-kg-module-resolution-");
  mkdirSync(path.join(fixture.workspace, "src"));
  mkdirSync(path.join(fixture.workspace, "lib"));
  writeFileSync(path.join(fixture.workspace, "src", "app.js"), [
    'import "utils";',
    'import "./choice";',
    "export function run() { return 1; }",
    "",
  ].join("\n"));
  writeFileSync(path.join(fixture.workspace, "src", "choice.js"), "export const jsChoice = 1;\n");
  writeFileSync(path.join(fixture.workspace, "src", "choice.ts"), "export const tsChoice = 1;\n");
  writeFileSync(path.join(fixture.workspace, "lib", "utils.js"), "export function helper() {}\n");
  const runtime = createKnowledgeGraphRuntime({ artifactRoot: fixture.artifacts });
  const receipt = runtime.ingest({ graphId: "module-resolution", root: fixture.workspace });
  const snapshot = JSON.parse(readFileSync(path.join(fixture.artifacts, receipt.artifactRef), "utf8"));
  const importEdge = snapshot.edges.find((edge) => (
    edge.kind === "imports" && snapshot.nodes.find((node) => node.id === edge.to)?.label === "utils"
  ));
  const target = snapshot.nodes.find((node) => node.id === importEdge.to);
  assert.equal(target.kind, "external-module");
  assert.equal(target.label, "utils");
  const ambiguousImport = snapshot.edges.find((edge) => (
    edge.kind === "imports"
    && snapshot.nodes.find((node) => node.id === edge.to)?.label === "./choice"
  ));
  assert.equal(snapshot.nodes.find((node) => node.id === ambiguousImport.to).kind, "ambiguous-reference");
  assert.equal(ambiguousImport.evidence.candidateIds.length, 2);

  const search = runtime.query({
    graphId: receipt.graphId,
    expectedDigest: receipt.graphDigest,
    query: { operation: "search", term: "app.js", nodeKinds: ["function"] },
  });
  assert.deepEqual(search.nodes, []);
  const absent = runtime.query({
    graphId: receipt.graphId,
    expectedDigest: receipt.graphDigest,
    query: { operation: "match", nodeKinds: ["absent-kind"], limit: 1 },
  });
  assert.equal(absent.truncated, false);
  assert.equal(absent.complete, true);
  assert.deepEqual(absent.nodes, []);
  assert.deepEqual(absent.edges, []);
});

function createFixture(prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const workspace = path.join(root, "workspace");
  const artifacts = path.join(root, "artifacts");
  mkdirSync(workspace);
  mkdirSync(artifacts);
  return { workspace, artifacts };
}
