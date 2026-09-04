import assert from "node:assert/strict";
import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AGENTIC_GRAPH_DEFAULT_PARSER_PROFILE,
  AGENTIC_GRAPH_MCP_TOOLS,
} from "../src/agentic-graph-mcp-client.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXPECTED_TOOLS = [
  "agentic-graph.agent_graph.ingest",
  "agentic-graph.agent_graph.parser_generate",
  "agentic-graph.agent_graph.query",
  "agentic-graph.agent_graph.explain_edge",
];
const EXPECTED_DISPATCH = [
  ["/agentic.graph.ingest", EXPECTED_TOOLS[0]],
  ["/agentic.graph.parser.generate", EXPECTED_TOOLS[1]],
  ["/agentic.graph.query", EXPECTED_TOOLS[2]],
  ["/agentic.graph.explain", EXPECTED_TOOLS[3]],
];
const EXPECTED_FACTS_RESOLUTION = [
  ["/agentic.graph.ingest", "DICTIONARY-COMMAND.md#/agentic.graph.ingest"],
  ["/agentic.graph.parser.generate", "DICTIONARY-COMMAND.md#/agentic.graph.parser.generate"],
  ["/agentic.graph.query", "DICTIONARY-COMMAND.md#/agentic.graph.query"],
  ["/agentic.graph.explain", "DICTIONARY-COMMAND.md#/agentic.graph.explain"],
  ["#agentic-graph", "DICTIONARY-SEMANTIC.md##agentic-graph"],
  ["#parser-generation", "DICTIONARY-SEMANTIC.md##parser-generation"],
  ["@agentic-graph", "DICTIONARY-BINDING.md#@agentic-graph"],
  ["@parser-specification", "DICTIONARY-BINDING.md#@parser-specification"],
];
const DOC_FILES = [
  "docs/AGENTIC-GRAPH.md",
  "docs/DICTIONARY-COMMAND.md",
  "docs/DICTIONARY-SEMANTIC.md",
  "docs/DICTIONARY-BINDING.md",
  "docs/FACTS.md",
  "docs/SKILLS.md",
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

test("canonical commands map to exactly four agentic-graph-owned MCP tools", () => {
  assert.deepEqual(AGENTIC_GRAPH_MCP_TOOLS, {
    ingest: EXPECTED_TOOLS[0],
    generateParser: EXPECTED_TOOLS[1],
    query: EXPECTED_TOOLS[2],
    explainEdge: EXPECTED_TOOLS[3],
  });

  const contract = read("docs/AGENTIC-GRAPH.md");
  const dispatch = [...readFrontmatter(contract).matchAll(
    /^  "(\/agentic\.graph(?:\.[a-z]+)+)": "(agentic-graph\.agent_graph\.[a-z_]+)"$/gmu,
  )].map((match) => [match[1], match[2]]);
  assert.deepEqual(dispatch, EXPECTED_DISPATCH);

  for (const file of [
    "docs/DICTIONARY-COMMAND.md",
    "docs/MCP-GATEWAY.md",
  ]) {
    assert.deepEqual(
      [...new Set(read(file).match(/agentic-graph\.agent_graph\.[a-z_]+/gu) ?? [])],
      EXPECTED_TOOLS,
      `${file} tool projection`,
    );
  }
});

test("FACTS resolves every agentic graph token exactly once", () => {
  const frontmatter = readFrontmatter(read("docs/FACTS.md"));
  const directResolution = readFrontmatterSection(
    frontmatter,
    "direct_resolution:",
    "truth_tokens:",
  );
  const resolvedTokens = [...directResolution.matchAll(
    /^  "([^"]+)": "([^"]+)"$/gmu,
  )]
    .map((match) => [match[1], match[2]])
    .filter(([token]) => token.includes("agentic.graph") || token === "#agentic-graph"
      || token === "#parser-generation" || token === "@agentic-graph"
      || token === "@parser-specification");
  assert.deepEqual(resolvedTokens, EXPECTED_FACTS_RESOLUTION);

  const truthTokens = Object.fromEntries(
    ["commands", "semantics", "bindings"].map((field) => {
      const match = frontmatter.match(new RegExp(`^  ${field}: (\\[[^\\n]+\\])$`, "mu"));
      assert.ok(match, `FACTS.md truth_tokens.${field}`);
      return [field, JSON.parse(match[1])];
    }),
  );
  assert.deepEqual(
    truthTokens.commands.filter((token) => token.startsWith("/agentic.graph.")),
    EXPECTED_DISPATCH.map(([command]) => command),
  );
  assert.deepEqual(
    truthTokens.semantics.filter((token) => ["#agentic-graph", "#parser-generation"].includes(token)),
    ["#agentic-graph", "#parser-generation"],
  );
  assert.deepEqual(
    truthTokens.bindings.filter((token) => ["@agentic-graph", "@parser-specification"].includes(token)),
    ["@agentic-graph", "@parser-specification"],
  );
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
    scripts["agentic-graph-contract:check"],
    "node --test __tests__/agentic-graph-client.test.mjs __tests__/agentic-graph-parser-client.test.mjs __tests__/agentic-graph-contract.test.mjs",
  );
  assert.equal(Object.hasOwn(scripts, "knowledge-graph:check"), false);
  assert.equal(Object.hasOwn(scripts, "knowledge-graph:mcp"), false);
});

test("agentic graph documentation remains bounded and contract/client-ready", () => {
  for (const file of DOC_FILES) {
    const source = read(file);
    assert.ok(source.trim(), `${file} must not be empty`);
    assert.ok(lineCount(source) < 600, `${file} must stay below 600 lines`);
  }

  const contract = read("docs/AGENTIC-GRAPH.md");
  assert.match(contract, /contract\/client-ready/iu);
  assert.match(contract, /agentic-graph owns (?:the )?executable/iu);
  assert.match(contract, /expectedSnapshotDigest/u);
  assert.match(contract, /FloatingPanel Skills & Commands/iu);
  assert.match(contract, /agentic-graph\.agentic_canvas_os\.docs\.invoke/u);
  assert.match(contract, /\/agentic\.graph\.parser\.generate/u);
  assert.match(contract, new RegExp(`profile: "${AGENTIC_GRAPH_DEFAULT_PARSER_PROFILE}"`, "u"));
  assert.match(contract, /alternative to `descriptors`/u);
  assert.match(contract, /parser generation is independently invocable/iu);
  assert.match(contract, /must not own a second catalog or a hardcoded semantic\/binding list/iu);
  assert.doesNotMatch(contract, /Agentic Canvas OS owns and executes/iu);
  assert.doesNotMatch(contract, /scripts\/knowledge-graph-mcp\.mjs/u);
  assert.doesNotMatch(contract, /src\/knowledge-graph\//u);

  const skills = read("docs/SKILLS.md");
  assert.match(skills, /agentic\.graph\.parser\.generate/u);
  assert.match(skills, /AGENTIC-GRAPH\.md/u);
});

test("agentic graph contracts retain deterministic, explained, vector-free semantics", () => {
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

function readFrontmatterSection(frontmatter, start, end) {
  const startIndex = frontmatter.indexOf(start);
  const endIndex = frontmatter.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `${start} section`);
  return frontmatter.slice(startIndex, endIndex);
}

function lineCount(source) {
  const count = source.split(/\r?\n/u).length;
  return source.endsWith("\n") ? count - 1 : count;
}
