import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  deepFreeze,
  sha256,
  stableStringify,
} from "../src/knowledge-graph/canonical.js";
import {
  ARTIFACT_SCHEMA,
  GRAMMAR_SCHEMA,
  IR_SCHEMA,
  PARSER_LIMITS,
  compileGrammar,
  parseWithGrammar,
} from "../src/knowledge-graph/parser-generator.js";
import { tokenize } from "../src/knowledge-graph/tokenizer.js";

function grammar(overrides = {}) {
  return {
    schema: GRAMMAR_SCHEMA,
    id: "fixture-language",
    version: "1",
    extensions: [".fixture"],
    commentPrefixes: ["//"],
    rules: [
      {
        id: "module",
        emit: "entity",
        kind: "module",
        opensBlock: true,
        sequence: [
          { literal: "module" },
          { type: "identifier", capture: "name" },
          { literal: "{" },
        ],
      },
      {
        id: "use-identifier",
        emit: "reference",
        relation: "uses",
        targetKind: "module",
        sequence: [
          { literal: "use" },
          { type: "identifier", capture: "target" },
        ],
      },
      {
        id: "use-string",
        emit: "reference",
        relation: "uses",
        targetKind: "module",
        sequence: [
          { literal: "use" },
          { type: "string", capture: "target" },
        ],
      },
    ],
    ...overrides,
  };
}

function artifactFor(rule) {
  return compileGrammar(grammar({ rules: [rule] }));
}

function limitRecord(result, code) {
  const record = result.diagnostics.find((candidate) => candidate.code === code);
  assert.ok(record, `expected ${code}`);
  assert.equal(record.severity, "warning");
  assert.equal(record.detail.partial, true);
  return record;
}

test("grammar compilation is canonical, deterministic, frozen, and digest-bound", () => {
  const first = compileGrammar(grammar({
    extensions: [".z", ".a"],
    commentPrefixes: ["#", "//"],
  }));
  const second = compileGrammar(grammar({
    commentPrefixes: ["//", "#"],
    extensions: [".a", ".z"],
  }));

  assert.equal(first.schema, ARTIFACT_SCHEMA);
  assert.deepEqual(first, second);
  assert.equal(
    first.digest,
    sha256(stableStringify({ schema: first.schema, grammar: first.grammar })),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.grammar.rules[0].sequence), true);

  const bytes = Buffer.from("deterministic");
  assert.equal(sha256(bytes), sha256("deterministic"));
  const record = deepFreeze({ bytes });
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(bytes), false);
});

test("parsing emits exact spans, stable IDs, and enclosing brace relationships", () => {
  const source = [
    "module Outer {",
    "  module Inner {",
    "    use \"Dependency\" // ignored",
    "  }",
    "  use Final",
    "}",
  ].join("\n");
  const artifact = compileGrammar(grammar());
  const first = parseWithGrammar(artifact, { source, path: "src/sample.fixture" });
  const second = parseWithGrammar(artifact, { source, path: "src/sample.fixture" });

  assert.equal(first.schema, IR_SCHEMA);
  assert.deepEqual(first, second);
  assert.deepEqual(first.parser, {
    id: "fixture-language",
    version: "1",
    digest: artifact.digest,
  });
  assert.equal(first.source.digest, sha256(source));
  assert.equal(first.entities.length, 2);
  assert.equal(first.references.length, 2);

  const [outer, inner] = first.entities;
  assert.equal(outer.name, "Outer");
  assert.equal(inner.name, "Inner");
  assert.equal(inner.parentId, outer.id);
  assert.deepEqual(outer.nameSpan, {
    schema: "agentic-source-span/v1",
    start: { line: 1, column: 8, offset: source.indexOf("Outer") },
    end: { line: 1, column: 13, offset: source.indexOf("Outer") + 5 },
  });
  assert.equal(outer.span.start.offset, 0);
  assert.equal(outer.span.end.offset, source.indexOf("{") + 1);

  const [dependency, final] = first.references;
  assert.equal(dependency.target, "Dependency");
  assert.equal(dependency.sourceId, inner.id);
  assert.equal(final.target, "Final");
  assert.equal(final.sourceId, outer.id);
  assert.equal(dependency.targetSpan.start.offset, source.indexOf("\"Dependency\""));
  assert.equal(dependency.targetSpan.end.offset, source.indexOf("\"Dependency\"") + 12);
  assert.ok(first.ast.children.every((node) => (
    node.ruleId && node.span.start.offset < node.span.end.offset
  )));
  assert.ok(first.diagnostics.some((record) => record.span.start.line === 4));
  assert.equal(Object.isFrozen(first), true);
});

test("invalid grammar keys, duplicates, captures, bounds, and artifacts fail closed", () => {
  assert.throws(() => compileGrammar({ ...grammar(), unexpected: true }), /unknown key/);
  assert.throws(() => compileGrammar(grammar({ extensions: [".x", ".x"] })), /duplicate/);
  assert.throws(() => compileGrammar(grammar({
    rules: Array.from({ length: 65 }, (_, index) => ({
      id: `rule-${index}`,
      emit: "entity",
      kind: "item",
      sequence: [{ type: "identifier", capture: "name" }],
    })),
  })), /between 1 and 64/);
  assert.throws(() => compileGrammar(grammar({
    rules: [{
      id: "wide",
      emit: "entity",
      kind: "item",
      sequence: [
        { type: "identifier", capture: "name" },
        ...Array.from({ length: 24 }, () => ({ type: "symbol" })),
      ],
    }],
  })), /between 1 and 24/);
  assert.throws(() => compileGrammar(grammar({
    rules: [{
      id: "duplicate-capture",
      emit: "entity",
      kind: "item",
      sequence: [
        { type: "identifier", capture: "name" },
        { type: "identifier", capture: "name" },
      ],
    }],
  })), /duplicate/);
  assert.throws(() => compileGrammar(grammar({
    rules: [{
      id: "missing-target",
      emit: "reference",
      relation: "uses",
      targetKind: "item",
      sequence: [{ literal: "use" }],
    }],
  })), /target/);
  assert.throws(() => compileGrammar(grammar({ id: "x".repeat(129) })), /at most 128/);
  assert.throws(() => compileGrammar(grammar({ id: "../unsafe" })), /safe ASCII identifier/);
  assert.throws(() => compileGrammar(grammar({
    rules: [{
      id: "unsafe\nrule",
      emit: "entity",
      kind: "item",
      sequence: [{ type: "identifier", capture: "name" }],
    }],
  })), /safe ASCII identifier/);
  assert.throws(() => compileGrammar(grammar({
    rules: [{
      id: "unsafe-kind",
      emit: "entity",
      kind: "../item",
      sequence: [{ type: "identifier", capture: "name" }],
    }],
  })), /safe ASCII identifier/);
  assert.throws(() => compileGrammar(grammar({
    rules: [{
      id: "unbound-block",
      emit: "entity",
      kind: "item",
      opensBlock: true,
      sequence: [{ literal: "item" }, { type: "identifier", capture: "name" }],
    }],
  })), /requires a literal/);

  const artifact = compileGrammar(grammar());
  const tampered = { ...artifact, digest: "0".repeat(64) };
  assert.throws(
    () => parseWithGrammar(tampered, { source: "module A {", path: "a.fixture" }),
    /digest mismatch/,
  );
});

test("tokenization preserves positions and newlines while comments do not escape strings", () => {
  const source = "USE \"text // value\" // comment\r\nnext 0x2a -> Target";
  const tokens = tokenize(source, {
    commentPrefixes: ["//"],
    caseSensitive: false,
  });

  assert.deepEqual(tokens.map(({ type, value }) => [type, value]), [
    ["identifier", "use"],
    ["string", "text // value"],
    ["symbol", "\n"],
    ["identifier", "next"],
    ["number", "0x2a"],
    ["symbol", "->"],
    ["identifier", "target"],
  ]);
  assert.deepEqual(tokens[2], {
    type: "symbol",
    value: "\n",
    raw: "\r\n",
    line: 1,
    column: 31,
    start: 30,
    end: 32,
  });
  assert.equal(tokens[3].line, 2);
  assert.equal(tokens[3].column, 1);
});

test("source and line limits are typed, byte-aware, and deterministic", () => {
  const artifact = compileGrammar(grammar());
  const cases = [
    {
      source: "a".repeat(PARSER_LIMITS.sourceChars + 1),
      code: "parser_source_character_limit",
      limit: PARSER_LIMITS.sourceChars,
    },
    {
      source: "é".repeat(Math.floor(PARSER_LIMITS.sourceBytes / 2) + 1),
      code: "parser_source_byte_limit",
      limit: PARSER_LIMITS.sourceBytes,
    },
  ];

  for (const fixture of cases) {
    const observed = fixture.code.includes("byte")
      ? Buffer.byteLength(fixture.source, "utf8")
      : fixture.source.length;
    assert.throws(
      () => parseWithGrammar(artifact, { source: fixture.source, path: "large.fixture" }),
      (error) => {
        assert.equal(error.name, "RangeError");
        assert.equal(error.code, fixture.code);
        assert.deepEqual(error.detail, {
          limit: fixture.limit,
          observed,
          partial: false,
        });
        return true;
      },
    );
  }

  const source = "x".repeat(PARSER_LIMITS.lineChars + 1);
  const first = parseWithGrammar(artifact, { source, path: "wide.fixture" });
  const second = parseWithGrammar(artifact, { source, path: "wide.fixture" });
  assert.deepEqual(first, second);
  assert.equal(first.entities.length, 0);
  assert.equal(first.references.length, 0);
  assert.deepEqual(limitRecord(first, "parser_line_limit").detail, {
    limit: PARSER_LIMITS.lineChars,
    observed: PARSER_LIMITS.lineChars + 1,
    partial: true,
  });
});

test("token, work, and diagnostic exhaustion return bounded partial IR", () => {
  const unmatched = artifactFor({
    id: "never",
    emit: "entity",
    kind: "item",
    sequence: [{ literal: "never" }, { type: "identifier", capture: "name" }],
  });
  const tokenSource = [
    ";".repeat(60_000),
    ";".repeat(60_000),
    ";".repeat(60_000),
    ";".repeat(30_000),
  ].join("\n");
  const tokenResult = parseWithGrammar(unmatched, {
    source: tokenSource,
    path: "tokens.fixture",
  });
  assert.equal(tokenResult.entities.length, 0);
  assert.deepEqual(limitRecord(tokenResult, "parser_token_limit").detail, {
    limit: PARSER_LIMITS.tokens,
    observed: 210_003,
    partial: true,
  });

  const workArtifact = compileGrammar(grammar({
    rules: Array.from({ length: 64 }, (_, index) => ({
      id: `never-${index}`,
      emit: "entity",
      kind: "item",
      sequence: [{ literal: `never${index}` }, { type: "identifier", capture: "name" }],
    })),
  }));
  const workSource = [
    "x ".repeat(8_000),
    "x ".repeat(8_000),
  ].join("\n");
  const workResult = parseWithGrammar(workArtifact, {
    source: workSource,
    path: "work.fixture",
  });
  assert.equal(workResult.entities.length, 0);
  assert.deepEqual(limitRecord(workResult, "parser_work_limit").detail, {
    limit: PARSER_LIMITS.workUnits,
    observed: PARSER_LIMITS.workUnits + 1,
    partial: true,
  });

  const diagnosticSource = Array.from(
    { length: PARSER_LIMITS.diagnostics + 1 },
    () => "?",
  ).join("\n");
  const diagnosticResult = parseWithGrammar(unmatched, {
    source: diagnosticSource,
    path: "diagnostics.fixture",
  });
  assert.equal(diagnosticResult.diagnostics.length, PARSER_LIMITS.diagnostics);
  assert.equal(
    diagnosticResult.diagnostics.filter(({ code }) => code === "no_match").length,
    PARSER_LIMITS.diagnostics - 1,
  );
  assert.deepEqual(limitRecord(diagnosticResult, "parser_diagnostic_limit").detail, {
    limit: PARSER_LIMITS.diagnostics,
    observed: PARSER_LIMITS.diagnostics,
    partial: true,
  });
});

test("entity, reference, and total-match caps stop before the next fact hash", () => {
  const entityArtifact = artifactFor({
    id: "item",
    emit: "entity",
    kind: "item",
    sequence: [{ type: "identifier", capture: "name" }],
  });
  const entityResult = parseWithGrammar(entityArtifact, {
    source: "x ".repeat(PARSER_LIMITS.entities + 1),
    path: "entities.fixture",
  });
  assert.equal(entityResult.entities.length, PARSER_LIMITS.entities);
  assert.equal(entityResult.ast.children.length, PARSER_LIMITS.entities);
  assert.equal(
    limitRecord(entityResult, "parser_entity_limit").detail.observed,
    PARSER_LIMITS.entities + 1,
  );

  const referenceArtifact = artifactFor({
    id: "dependency",
    emit: "reference",
    relation: "uses",
    targetKind: "item",
    source: "file",
    sequence: [{ type: "identifier", capture: "target" }],
  });
  const referenceResult = parseWithGrammar(referenceArtifact, {
    source: "x ".repeat(PARSER_LIMITS.references + 1),
    path: "references.fixture",
  });
  assert.equal(referenceResult.references.length, PARSER_LIMITS.references);
  assert.equal(referenceResult.ast.children.length, PARSER_LIMITS.references);
  assert.equal(
    limitRecord(referenceResult, "parser_reference_limit").detail.observed,
    PARSER_LIMITS.references + 1,
  );

  const matchArtifact = compileGrammar(grammar({
    rules: [
      {
        id: "entity",
        emit: "entity",
        kind: "item",
        sequence: [{ literal: "e" }, { type: "identifier", capture: "name" }],
      },
      {
        id: "reference",
        emit: "reference",
        relation: "uses",
        targetKind: "item",
        source: "file",
        sequence: [{ literal: "r" }, { type: "identifier", capture: "target" }],
      },
    ],
  }));
  const half = PARSER_LIMITS.matches / 2;
  const matchResult = parseWithGrammar(matchArtifact, {
    source: ["e x ".repeat(half), "r x ".repeat(half + 1)].join("\n"),
    path: "matches.fixture",
  });
  assert.equal(matchResult.entities.length, half);
  assert.equal(matchResult.references.length, half);
  assert.equal(matchResult.ast.children.length, PARSER_LIMITS.matches);
  assert.deepEqual(limitRecord(matchResult, "parser_match_limit").detail, {
    limit: PARSER_LIMITS.matches,
    observed: PARSER_LIMITS.matches + 1,
    partial: true,
  });
});

test("parser core remains local data processing with no package imports", () => {
  for (const file of [
    "src/knowledge-graph/canonical.js",
    "src/knowledge-graph/tokenizer.js",
    "src/knowledge-graph/parser-generator.js",
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'](?!node:|\.)/);
    assert.doesNotMatch(source, /https?:\/\//);
    assert.doesNotMatch(source, /\b(?:Date|performance|setTimeout|setInterval)\b/);
    assert.ok(source.split("\n").length - 1 < 600, `${file} stays below 600 lines`);
  }
});
