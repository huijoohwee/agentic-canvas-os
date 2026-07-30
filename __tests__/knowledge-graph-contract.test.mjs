import assert from "node:assert/strict";
import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import { KNOWLEDGE_GRAPH_MCP_TOOLS } from "../src/knowgrph-mcp-client.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXPECTED_TOOLS = [
  "knowgrph.knowledge_graph.ingest",
  "knowgrph.knowledge_graph.query",
  "knowgrph.knowledge_graph.explain_edge",
];
const EXPECTED_DISPATCH = [
  ["/knowledge.graph.ingest", EXPECTED_TOOLS[0]],
  ["/knowledge.graph.query", EXPECTED_TOOLS[1]],
  ["/knowledge.graph.explain", EXPECTED_TOOLS[2]],
];
const DOC_FILES = [
  "docs/KNOWLEDGE-GRAPH.md",
  "docs/DICTIONARY-COMMAND.md",
  "docs/DICTIONARY-SEMANTIC.md",
  "docs/DICTIONARY-BINDING.md",
  "docs/FACTS.md",
  "docs/MCP-GATEWAY.md",
  "docs/RUNTIME-PROOF.md",
  "docs/RUNTIME-READINESS.md",
  "docs/README.md",
];
const RETIRED_RUNTIME_PATHS = [
  "scripts/knowledge-graph-mcp.mjs",
  "__tests__/knowledge-graph-mcp.test.mjs",
  "__tests__/knowledge-graph-runtime.test.mjs",
  "__tests__/knowledge-graph-parser-generator.test.mjs",
];

test("canonical commands map to exactly three Knowgrph-owned MCP tools", () => {
  assert.deepEqual(KNOWLEDGE_GRAPH_MCP_TOOLS, {
    ingest: EXPECTED_TOOLS[0],
    query: EXPECTED_TOOLS[1],
    explainEdge: EXPECTED_TOOLS[2],
  });

  const contract = read("docs/KNOWLEDGE-GRAPH.md");
  const dispatch = [...readFrontmatter(contract).matchAll(
    /^  "(\/knowledge\.graph\.[a-z]+)": "(knowgrph\.knowledge_graph\.[a-z_]+)"$/gmu,
  )].map((match) => [match[1], match[2]]);
  assert.deepEqual(dispatch, EXPECTED_DISPATCH);

  for (const file of [
    "docs/DICTIONARY-COMMAND.md",
    "docs/MCP-GATEWAY.md",
  ]) {
    assert.deepEqual(
      [...new Set(read(file).match(/knowgrph\.knowledge_graph\.[a-z_]+/gu) ?? [])],
      EXPECTED_TOOLS,
      `${file} tool projection`,
    );
  }
});

test("Agentic Canvas OS retains contracts and client code, not a second graph runtime", () => {
  for (const file of RETIRED_RUNTIME_PATHS) {
    assert.equal(existsSync(path.join(ROOT, file)), false, `${file} must stay retired`);
  }
  const runtimeDirectory = path.join(ROOT, "src/knowledge-graph");
  assert.deepEqual(
    existsSync(runtimeDirectory) ? readdirSync(runtimeDirectory) : [],
    [],
    "src/knowledge-graph must contain no executable runtime",
  );

  const scripts = JSON.parse(read("package.json")).scripts;
  assert.equal(
    scripts["knowledge-graph-contract:check"],
    "node --test __tests__/knowledge-graph-client.test.mjs __tests__/knowledge-graph-contract.test.mjs",
  );
  assert.equal(Object.hasOwn(scripts, "knowledge-graph:check"), false);
  assert.equal(Object.hasOwn(scripts, "knowledge-graph:mcp"), false);
});

test("knowledge graph documentation remains bounded and contract/client-ready", () => {
  for (const file of DOC_FILES) {
    const source = read(file);
    assert.ok(source.trim(), `${file} must not be empty`);
    assert.ok(lineCount(source) < 600, `${file} must stay below 600 lines`);
  }

  const contract = read("docs/KNOWLEDGE-GRAPH.md");
  assert.match(contract, /contract\/client-ready/iu);
  assert.match(contract, /Knowgrph owns (?:the )?executable/iu);
  assert.match(contract, /expectedSnapshotDigest/u);
  assert.match(contract, /FloatingPanel Skills & Commands/iu);
  assert.match(contract, /knowgrph\.agentic_canvas_os\.docs\.invoke/u);
  assert.match(contract, /must not own a second catalog or a hardcoded semantic\/binding list/iu);
  assert.doesNotMatch(contract, /Agentic Canvas OS owns and executes/iu);
  assert.doesNotMatch(contract, /scripts\/knowledge-graph-mcp\.mjs/u);
  assert.doesNotMatch(contract, /src\/knowledge-graph\//u);
});

test("knowledge graph contracts retain deterministic, explained, vector-free semantics", () => {
  const contract = DOC_FILES.map(read).join("\n");
  assert.match(contract, /deterministic/iu);
  assert.match(contract, /every edge/iu);
  assert.match(contract, /source evidence/iu);
  assert.match(contract, /(?:no|never|without|zero|does not use)[^.\n]{0,180}\bvector/iu);
  assert.match(contract, /(?:no|never|without|zero|does not use)[^.\n]{0,180}\bmodel/iu);
});

function read(file) {
  return readFileSync(path.join(ROOT, file), "utf8");
}

function readFrontmatter(source) {
  const end = source.indexOf("\n---\n", 4);
  assert.ok(source.startsWith("---\n") && end > 4, "canonical document frontmatter");
  return source.slice(4, end);
}

function lineCount(source) {
  const count = source.split(/\r?\n/u).length;
  return source.endsWith("\n") ? count - 1 : count;
}
