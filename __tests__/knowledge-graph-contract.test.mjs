import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = read("docs/KNOWLEDGE-GRAPH.md");
const commands = read("docs/DICTIONARY-COMMAND.md");
const semantics = read("docs/DICTIONARY-SEMANTIC.md");
const bindings = read("docs/DICTIONARY-BINDING.md");
const facts = read("docs/FACTS.md");
const gateway = read("docs/MCP-GATEWAY.md");
const memory = read("docs/MEMORY.md");
const proof = read("docs/RUNTIME-PROOF.md");
const readiness = read("docs/RUNTIME-READINESS.md");
const docsReadme = read("docs/README.md");
const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));

const dispatch = new Map([
  ["/knowledge.graph.ingest", "knowgrph.knowledge_graph.ingest"],
  ["/knowledge.graph.query", "knowgrph.knowledge_graph.query"],
  ["/knowledge.graph.explain", "knowgrph.knowledge_graph.explain_edge"],
]);

const invocationTuples = new Map([
  ["/knowledge.graph.ingest", {
    semantics: ["#knowledge-graph", "#mcp", "#runtime-ready"],
    bindings: ["@working-directory", "@knowledge-graph", "@operator", "@runtime-proof"],
  }],
  ["/knowledge.graph.query", {
    semantics: ["#knowledge-graph", "#mcp", "#vcc"],
    bindings: ["@knowledge-graph", "@runtime-proof"],
  }],
  ["/knowledge.graph.explain", {
    semantics: ["#knowledge-graph", "#mcp", "#vcc"],
    bindings: ["@knowledge-graph", "@runtime-proof"],
  }],
]);

const dictionaryRoutes = [
  ...[...dispatch.keys()].map((token) => ["docs/DICTIONARY-COMMAND.md", commands, token]),
  ["docs/DICTIONARY-SEMANTIC.md", semantics, "#knowledge-graph"],
  ["docs/DICTIONARY-BINDING.md", bindings, "@knowledge-graph"],
];

test("knowledge graph invocation tokens have one canonical dictionary and facts identity", () => {
  for (const [file, source, token] of dictionaryRoutes) {
    assert.equal(matches(source, `^  - "${escapeRegExp(token)}"$`).length, 1, `${file} frontmatter ${token}`);
    assert.ok(matches(source, `^\\| \`${escapeRegExp(token)}\` \\|`).length >= 1, `${file} table ${token}`);
    assert.equal(matches(facts, `^  "${escapeRegExp(token)}":`).length, 1, `FACTS direct_resolution ${token}`);
  }

  for (const token of dispatch.keys()) assert.match(facts, new RegExp(`commands: \\[.*"${escapeRegExp(token)}"`));
  assert.match(facts, /semantics: \[.*"#knowledge-graph"/);
  assert.match(facts, /bindings: \[.*"@knowledge-graph"/);
});

test("host actions dispatch to exactly three explicit Knowgrph local MCP tools", () => {
  const frontmatter = readFrontmatter(contract);
  assert.deepEqual(
    [...frontmatter.matchAll(/^  "(\/knowledge\.graph\.[^"]+)": "([^"]+)"$/gm)].map((match) => [match[1], match[2]]),
    [...dispatch],
  );

  for (const [action, tool] of dispatch) {
    const tuple = invocationTuples.get(action);
    const inline = `{action: "${action}", semantics: [${tuple.semantics.map((token) => `"${token}"`).join(", ")}], bindings: [${tuple.bindings.map((token) => `"${token}"`).join(", ")}]}`;
    assert.equal(frontmatter.split(inline).length - 1, 1, `${action} exact invocation declaration`);
    assert.equal(matches(gateway, `^\\| \`${escapeRegExp(tool)}\` \\|`).length, 1, `${tool} gateway capability`);
    assert.match(commands, new RegExp(`^\\| \`${escapeRegExp(action)}\` .*\`${escapeRegExp(tool)}\``, "m"));
    const renderedTuple = [action, ...tuple.semantics, ...tuple.bindings].join(" ");
    const tupleRow = new RegExp("^\\| `" + escapeRegExp(renderedTuple) + "` \\|", "m");
    assert.match(contract, tupleRow);
    assert.match(semantics, tupleRow);
    assert.match(bindings, tupleRow);
  }
  assert.equal(dispatch.size, 3);
});

test("dictionary lookup is metadata-only and execution remains an explicit tool call", () => {
  assert.match(contract, /The three dictionaries remain the only authority for `\/`, `#`, and `@` token identity/);
  assert.match(contract, /`knowgrph\.agentic_canvas_os\.docs\.invoke` performs dictionary lookup only/);
  assert.match(contract, /A successful lookup must not be reported as tool execution/);
  assert.match(gateway, /`#knowledge-graph` and `@knowledge-graph`, resolve from the canonical dictionaries as metadata/);
  assert.match(gateway, /does not execute them/);
  assert.match(gateway, /explicitly call the corresponding local stdio tool/);
  assert.match(gateway, /no token-to-tool name inference or duplicate registry/);
});

test("source, graph, query, and explanation contracts are deterministic and auditable", () => {
  for (const expected of [
    /parser-supported source code, authored documentation, SQL definitions, structured configuration, and text-bearing PDFs/,
    /orders admitted workspace-relative paths by a locale-independent ordinal comparator/,
    /Every admitted file is bound to its byte digest/,
    /Every edge has a non-empty deterministic explanation/,
    /source evidence is rejected before snapshot publication/,
    /Re-ingesting unchanged admitted bytes and parser revisions yields the same graph digest and record order/,
    /bounded normalized lexical search, exact id or label node selection, exact edge-label traversal filters, neighborhoods, impact traversal, shortest paths, and graph summaries/,
    /Explanation performs no file scan, parser run, inference, model call, network request, or artifact mutation/,
  ]) assert.match(contract, expected);

  assert.match(contract, /does not use embeddings, similarity vectors, a vector store, a language model, generated Cypher, or an external graph service/);
  assert.match(contract, /Encrypted, malformed, image-only, or extraction-unavailable input returns a typed gap/);
  assert.match(contract, /regex guesses do not masquerade as AST facts/);
});

test("Graphify remains inspiration-only with no copied runtime or dependency", () => {
  assert.match(contract, /external_pattern_sources: \["https:\/\/github\.com\/Graphify-Labs\/graphify"\]/);
  assert.match(contract, /external_dependency: "forbidden"/);
  assert.match(contract, /This subsystem is clean-room work/);
  assert.match(contract, /Copying or adapting Graphify code, prose, prompts, APIs, schemas, algorithms, parser tables, fixtures, tests, examples, package conventions, generated layouts, or dependency choices is forbidden/);
  assert.match(contract, /must not import, invoke, install, download, vendor, or require Graphify, its CLI, its packages, or its services/);

  const dependencyNames = collectDependencyNames(packageJson, packageLock);
  assert.deepEqual(dependencyNames.filter((name) => /graphify/i.test(name)), []);
});

test("contract projections, focused proof command, and line budgets stay current", () => {
  for (const [name, source, pattern] of [
    ["MEMORY.md", memory, /deterministic_knowledge_graph:/],
    ["MCP-GATEWAY.md", gateway, /## Deterministic Knowledge Graph Capabilities/],
    ["RUNTIME-PROOF.md", proof, /Deterministic knowledge graph contract is executable/],
    ["RUNTIME-READINESS.md", readiness, /\| Deterministic knowledge graph contract \|/],
    ["docs README", docsReadme, /\| `KNOWLEDGE-GRAPH\.md` \|/],
  ]) assert.match(source, pattern, name);

  assert.equal(
    packageJson.scripts["knowledge-graph-contract:check"],
    "node --test __tests__/knowledge-graph-contract.test.mjs",
  );
  for (const file of [
    "docs/KNOWLEDGE-GRAPH.md",
    "docs/FACTS.md",
    "docs/MEMORY.md",
    "docs/MCP-GATEWAY.md",
    "docs/RUNTIME-PROOF.md",
  ]) assert.ok(read(file).split("\n").length - 1 < 600, `${file} stays below 600 lines`);
});

function read(file) {
  return readFileSync(file, "utf8");
}

function readFrontmatter(source) {
  const end = source.indexOf("\n---\n", 4);
  assert.ok(source.startsWith("---\n") && end > 4, "frontmatter");
  return source.slice(4, end);
}

function matches(source, pattern) {
  return [...source.matchAll(new RegExp(pattern, "gm"))];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectDependencyNames(manifest, lock) {
  const names = new Set();
  const collect = (record) => {
    if (!record || typeof record !== "object") return;
    for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      for (const name of Object.keys(record[key] || {})) names.add(name);
    }
  };
  collect(manifest);
  collect(lock);
  for (const [path, record] of Object.entries(lock.packages || {})) {
    collect(record);
    const marker = "node_modules/";
    const index = path.lastIndexOf(marker);
    if (index >= 0) names.add(path.slice(index + marker.length));
  }
  return [...names].sort();
}
