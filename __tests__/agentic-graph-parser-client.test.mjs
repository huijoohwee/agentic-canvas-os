import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  AGENTIC_GRAPH_DEFAULT_PARSER_PROFILE,
  AGENTIC_GRAPH_MCP_TOOLS,
  validateAgenticGraphParserResult,
  validateAgenticGraphRequest,
} from "../src/agentic-graph-mcp-client.js";

const DECLARATIVE_GRAMMAR = {
  schema: "agentic-graph-declarative-grammar/v1",
  start: "document",
  tokens: [
    { id: "word", kind: "identifier" },
    { id: "colon", literal: ":" },
    { id: "space", kind: "whitespace", skip: true },
  ],
  rules: [{
    id: "document",
    alternatives: [{
      sequence: [
        { token: "word", capture: "key", min: 1, max: 1 },
        { token: "colon", min: 1, max: 1 },
        { token: "word", capture: "value", min: 1, max: 1 },
      ],
    }],
  }],
};

const CANONICAL_DECLARATIVE_GRAMMAR = {
  ...DECLARATIVE_GRAMMAR,
  tokens: [...DECLARATIVE_GRAMMAR.tokens].sort(({ id: left }, { id: right }) => (
    left < right ? -1 : left > right ? 1 : 0
  )),
};
const stableValue = (value) => (
  Array.isArray(value)
    ? value.map(stableValue)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
      : value
);
const digestFor = (descriptors) => createHash("sha256")
  .update(`${JSON.stringify(stableValue(descriptors))}\n`)
  .digest("hex");
const registryResult = (descriptors) => {
  const digest = digestFor(descriptors);
  return {
    schema: "agentic-graph-knowledge-graph-parser-generate/v1",
    ok: true,
    operation: "parser_generate",
    parserRegistryDigest: digest,
    parserRegistry: {
      schema: "agentic-graph-knowledge-graph-parser-registry/v2",
      digest,
      descriptors,
    },
  };
};

test("parser generation validates a built-in profile or source-backed descriptors", () => {
  const invocation = {
    schema: "agentic-graph-knowledge-graph-invocation/v1",
    tool: AGENTIC_GRAPH_MCP_TOOLS.generateParser,
    action: "/agentic.graph.parser.generate",
    semantics: ["#agentic-graph", "#parser-generation", "#mcp"],
    bindings: ["@parser-specification", "@runtime-proof"],
    sourceRevision: "a".repeat(40),
    catalogDigest: "b".repeat(64),
    routingSchema: "agentic-canvas-os-docs-routing/v1",
    routingDigest: "c".repeat(64),
  };
  const fixed = {
    descriptors: [{
      id: "neutral-fixture",
      kind: "fixture",
      adapter: "inventory",
      fidelity: "inventory-only",
      extensions: [".fixture"],
    }],
    invocation,
  };
  const generated = {
    descriptors: [{
      id: "neutral-generated",
      kind: "generated",
      adapter: "declarative-grammar",
      fidelity: "ast",
      extensions: [".neutral"],
      grammar: DECLARATIVE_GRAMMAR,
    }],
  };
  const builtIn = {
    profile: AGENTIC_GRAPH_DEFAULT_PARSER_PROFILE,
    invocation,
  };
  assert.equal(validateAgenticGraphRequest("parser_generate", fixed), fixed);
  assert.equal(validateAgenticGraphRequest("parser_generate", generated), generated);
  assert.equal(validateAgenticGraphRequest("parser_generate", builtIn), builtIn);
  for (const invalid of [
    {},
    { ...fixed, descriptors: [] },
    { ...fixed, descriptors: [{ id: "fixture" }] },
    { descriptors: [{ ...generated.descriptors[0], grammar: undefined }] },
    { descriptors: [{ ...fixed.descriptors[0], grammar: DECLARATIVE_GRAMMAR }] },
    { ...builtIn, profile: "alternate-source" },
    { ...builtIn, descriptors: fixed.descriptors },
    { ...fixed, outputPath: "/private/parser" },
    { ...fixed, invocation: { ...invocation, tool: AGENTIC_GRAPH_MCP_TOOLS.ingest } },
  ]) {
    assert.throws(
      () => validateAgenticGraphRequest("parser_generate", invalid),
      (error) => error.code === "mcp_agentic_graph_request_invalid",
    );
  }
});

test("parser result requires one digest-bound v2 registry with inert grammar data", () => {
  const result = registryResult([{
    id: "fixture",
    kind: "fixture",
    adapter: "inventory",
    fidelity: "inventory-only",
    extensions: [".fixture"],
    basenames: [],
    basenameFamilies: [],
    priority: 10,
  }]);
  const generated = registryResult([{
    id: "neutral-generated",
    kind: "generated",
    adapter: "declarative-grammar",
    fidelity: "ast",
    extensions: [".neutral"],
    basenames: [],
    basenameFamilies: [],
    priority: 0,
    grammar: CANONICAL_DECLARATIVE_GRAMMAR,
  }]);
  assert.equal(validateAgenticGraphParserResult(result), result);
  assert.equal(validateAgenticGraphParserResult(generated), generated);
  for (const invalid of [
    { ...result, schema: "wrong" },
    { ...result, parserRegistryDigest: "c".repeat(63) },
    { ...result, parserRegistry: { ...result.parserRegistry, digest: "d".repeat(64) } },
    {
      ...generated,
      parserRegistry: {
        ...generated.parserRegistry,
        descriptors: [{
          ...generated.parserRegistry.descriptors[0],
          grammar: { ...CANONICAL_DECLARATIVE_GRAMMAR, executable: "return true" },
        }],
      },
    },
    { ...result, metadata: { artifactPath: "/private/parser.json" } },
    { ...result, metadata: { harmless: true } },
  ]) {
    assert.throws(
      () => validateAgenticGraphParserResult(invalid),
      (error) => error.code === "mcp_agentic_graph_result_invalid",
    );
  }
});

test("parser result recomputes canonical digest and rejects ambiguous or noncanonical registries", () => {
  const descriptors = [{
    id: "alpha",
    kind: "alpha",
    adapter: "inventory",
    fidelity: "inventory-only",
    extensions: [".alpha"],
    basenames: [],
    basenameFamilies: [],
    priority: 0,
  }, {
    id: "beta",
    kind: "beta",
    adapter: "inventory",
    fidelity: "inventory-only",
    extensions: [".beta"],
    basenames: [],
    basenameFamilies: [],
    priority: 0,
  }];
  assert.equal(validateAgenticGraphParserResult(registryResult(descriptors)).ok, true);

  const forged = registryResult(descriptors);
  forged.parserRegistryDigest = "f".repeat(64);
  forged.parserRegistry.digest = forged.parserRegistryDigest;
  const noncanonical = registryResult([...descriptors].reverse());
  const ambiguousDescriptors = descriptors.map((descriptor) => ({
    ...descriptor,
    extensions: [".shared"],
  }));
  const ambiguous = registryResult(ambiguousDescriptors);
  const ambiguousGrammar = registryResult([{
    ...generatedDescriptor(),
    grammar: {
      ...CANONICAL_DECLARATIVE_GRAMMAR,
      rules: [{
        id: "document",
        alternatives: [{ sequence: [{ token: "word", min: 1, max: 1 }] }, {
          sequence: [{ token: "word", min: 1, max: 2 }],
        }].sort((left, right) => JSON.stringify(stableValue(left)).localeCompare(JSON.stringify(stableValue(right)))),
      }],
    },
  }]);
  for (const invalid of [forged, noncanonical, ambiguous, ambiguousGrammar]) {
    assert.throws(
      () => validateAgenticGraphParserResult(invalid),
      (error) => error.code === "mcp_agentic_graph_result_invalid"
        && error.data.fields.includes("parserRegistry"),
    );
  }
});

function generatedDescriptor() {
  return {
    id: "neutral-generated",
    kind: "generated",
    adapter: "declarative-grammar",
    fidelity: "ast",
    extensions: [".neutral"],
    basenames: [],
    basenameFamilies: [],
    priority: 0,
  };
}
