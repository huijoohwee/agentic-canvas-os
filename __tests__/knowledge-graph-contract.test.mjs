import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  KNOWLEDGE_GRAPH_MCP_TOOLS,
  KNOWLEDGE_GRAPH_TOOL_DEFINITIONS,
} from "../src/knowledge-graph/mcp-tools.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXPECTED_TOOLS = [
  "agentic_canvas_os.knowledge_graph.ingest",
  "agentic_canvas_os.knowledge_graph.query",
  "agentic_canvas_os.knowledge_graph.explain",
];
const EXPECTED_DISPATCH = [
  ["/knowledge.graph.ingest", EXPECTED_TOOLS[0]],
  ["/knowledge.graph.query", EXPECTED_TOOLS[1]],
  ["/knowledge.graph.explain", EXPECTED_TOOLS[2]],
];
const SOURCE_FILES = [
  "scripts/knowledge-graph-mcp.mjs",
  "src/knowledge-graph/canonical.js",
  "src/knowledge-graph/code-parser.js",
  "src/knowledge-graph/config-parser.js",
  "src/knowledge-graph/document-parser.js",
  "src/knowledge-graph/graph-builder.js",
  "src/knowledge-graph/ir.js",
  "src/knowledge-graph/mcp-tools.js",
  "src/knowledge-graph/parser-generator.js",
  "src/knowledge-graph/pdf-parser.js",
  "src/knowledge-graph/query-engine.js",
  "src/knowledge-graph/runtime.js",
  "src/knowledge-graph/snapshot-store.js",
  "src/knowledge-graph/source-admission.js",
  "src/knowledge-graph/sql-parser.js",
  "src/knowledge-graph/tokenizer.js",
];
const DOC_FILES = [
  "docs/KNOWLEDGE-GRAPH.md",
  "docs/DICTIONARY-COMMAND.md",
  "docs/DICTIONARY-SEMANTIC.md",
  "docs/DICTIONARY-BINDING.md",
  "docs/FACTS.md",
  "docs/MEMORY.md",
  "docs/MCP-GATEWAY.md",
  "docs/RUNTIME-PROOF.md",
  "docs/RUNTIME-READINESS.md",
  "docs/README.md",
];

test("the native MCP surface exposes exactly three closed tools", () => {
  assert.deepEqual(KNOWLEDGE_GRAPH_MCP_TOOLS, {
    ingest: EXPECTED_TOOLS[0],
    query: EXPECTED_TOOLS[1],
    explain: EXPECTED_TOOLS[2],
  });
  assert.deepEqual(
    KNOWLEDGE_GRAPH_TOOL_DEFINITIONS.map((definition) => definition.name),
    EXPECTED_TOOLS,
  );
  assert.equal(new Set(EXPECTED_TOOLS).size, 3);
  for (const definition of KNOWLEDGE_GRAPH_TOOL_DEFINITIONS) {
    assert.equal(definition.inputSchema.type, "object");
    assert.equal(definition.inputSchema.additionalProperties, false);
  }
});

test("the canonical document dispatches only to the three native tools", () => {
  const contract = read("docs/KNOWLEDGE-GRAPH.md");
  const frontmatter = readFrontmatter(contract);
  const dispatch = [...frontmatter.matchAll(
    /^  "(\/knowledge\.graph\.[a-z]+)": "(agentic_canvas_os\.knowledge_graph\.[a-z]+)"$/gm,
  )].map((match) => [match[1], match[2]]);
  assert.deepEqual(dispatch, EXPECTED_DISPATCH);
  assert.deepEqual(
    [...new Set(contract.match(/agentic_canvas_os\.knowledge_graph\.[a-z_]+/g) ?? [])],
    EXPECTED_TOOLS,
  );
  assert.doesNotMatch(contract, /\bknowgrph\.knowledge_graph\./);
  for (const file of [
    "docs/DICTIONARY-COMMAND.md",
    "docs/FACTS.md",
    "docs/MCP-GATEWAY.md",
  ]) {
    assert.deepEqual(
      [...new Set(read(file).match(/agentic_canvas_os\.knowledge_graph\.[a-z_]+/g) ?? [])],
      EXPECTED_TOOLS,
      `${file} native tool projection`,
    );
  }
});

test("all required native source and documentation files are present and bounded", () => {
  for (const file of SOURCE_FILES) {
    const source = read(file);
    assert.ok(source.trim(), `${file} must not be empty`);
    assert.ok(lineCount(source) < 600, `${file} must stay below 600 lines`);
  }
  for (const file of DOC_FILES) {
    const source = read(file);
    assert.ok(source.trim(), `${file} must not be empty`);
    assert.ok(lineCount(source) < 600, `${file} must stay below 600 lines`);
  }
});

test("package commands keep focused, complete, and stdio entry points distinct", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.equal(
    scripts["knowledge-graph-contract:check"],
    "node --test __tests__/knowledge-graph-contract.test.mjs",
  );
  assert.equal(
    scripts["knowledge-graph:check"],
    "node --test __tests__/knowledge-graph-*.test.mjs",
  );
  assert.equal(
    scripts["knowledge-graph:mcp"],
    "node ./scripts/knowledge-graph-mcp.mjs",
  );
});

test("runtime and documentation enforce local, vector-free, network-free operation", () => {
  const source = SOURCE_FILES.map(read).join("\n");
  const contract = read("docs/KNOWLEDGE-GRAPH.md");
  const graphBuilder = read("src/knowledge-graph/graph-builder.js");
  const queryEngine = read("src/knowledge-graph/query-engine.js");
  const runtime = read("src/knowledge-graph/runtime.js");

  for (const specifier of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    assert.match(specifier[1], /^(?:node:|\.\.?\/)/, `non-native import ${specifier[1]}`);
  }
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\bWebSocket\b/);
  assert.doesNotMatch(source, /\bnode:(?:http|https|net|tls|dns)\b/);
  assert.match(graphBuilder, /networkCalls:\s*0/);
  assert.match(graphBuilder, /embeddings:\s*0/);
  assert.match(graphBuilder, /vectorStores:\s*0/);
  assert.match(queryEngine, /vectorLookupUsed:\s*false/);
  assert.match(runtime, /networkCalls:\s*0/);
  assert.match(contract, /\b(?:local|localhost)\b/i);
  assert.match(contract, /(?:no|never|without|zero|does not use)[^.\n]{0,160}\bvector/i);
  assert.match(contract, /(?:no|never|without|zero|does not use)[^.\n]{0,160}\bnetwork/i);
});

test("repository-owned files contain zero blocked project names or URLs", () => {
  const firstName = ["tree", "sitter"].join("-");
  const secondName = ["graph", "ify"].join("");
  const blocked = [
    firstName,
    secondName,
    ["https:", "", "github.com", firstName, firstName].join("/"),
    [
      "https:",
      "",
      "github.com",
      [secondName, ["la", "bs"].join("")].join("-"),
      secondName,
    ].join("/"),
  ].map((value) => value.toLowerCase());

  for (const file of repositoryFiles()) {
    const source = repositoryFileText(file).toLowerCase();
    for (const needle of blocked) {
      assert.equal(source.includes(needle), false, `${file} contains a blocked occurrence`);
    }
  }
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

function repositoryFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  ).split("\0").filter(Boolean);
}

function repositoryFileText(file) {
  const absolute = path.join(ROOT, file);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) return readlinkSync(absolute);
  return stat.isFile() ? readFileSync(absolute).toString("utf8") : "";
}
