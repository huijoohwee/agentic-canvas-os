import assert from "node:assert/strict";
import test from "node:test";

import { stableStringify } from "../src/knowledge-graph/canonical.js";
import { parseCode } from "../src/knowledge-graph/code-parser.js";
import { parseConfig } from "../src/knowledge-graph/config-parser.js";
import { parseSql } from "../src/knowledge-graph/sql-parser.js";

test("code parser emits deterministic declarations, imports, calls, and inheritance", () => {
  const source = [
    'import { helper } from "./helper";',
    "export class Service extends BaseService {",
    "  run() { helper(); }",
    "}",
    "export function boot() { return helper(); }",
    "",
  ].join("\n");
  const first = parseCode({ path: "src/service.ts", source });
  const second = parseCode({ path: "src/service.ts", source });
  assert.equal(stableStringify(first), stableStringify(second));
  assert.ok(first.entities.some((entity) => entity.kind === "class" && entity.name === "Service"));
  assert.ok(first.entities.some((entity) => entity.kind === "function" && entity.name === "run"));
  assert.ok(first.entities.some((entity) => entity.kind === "function" && entity.name === "boot"));
  assert.ok(first.references.some((reference) => reference.relation === "imports" && reference.target === "./helper"));
  assert.ok(first.references.some((reference) => reference.relation === "inherits" && reference.target === "BaseService"));
  assert.ok(first.references.some((reference) => reference.relation === "calls" && reference.target === "helper"));
  assert.equal(first.references.some((reference) => reference.relation === "calls" && reference.target === "run"), false);
  assertSourceSpans(first);
});

test("code parser distinguishes brace methods and Go receiver declarations from calls", () => {
  const oneLineClass = parseCode({
    path: "src/one-line.js",
    source: "class A { method() {} }\n",
  });
  assert.equal(
    oneLineClass.references.some((reference) => (
      reference.relation === "calls" && reference.target === "method"
    )),
    false,
  );

  const go = parseCode({
    path: "receiver.go",
    source: "package x\nfunc (r Receiver) Work() { helper() }\n",
  });
  assert.deepEqual(
    go.entities.filter((entity) => entity.kind === "function").map((entity) => entity.name),
    ["Work"],
  );
  assert.deepEqual(
    go.references.filter((reference) => reference.relation === "calls").map((reference) => reference.target),
    ["helper"],
  );
  assertSourceSpans(go);
});

test("code parser closes balanced scopes and masks Python docstrings and escaped regex openers", () => {
  const scoped = parseCode({
    path: "scope.js",
    source: "function f(){g();}\nh();\nfunction later(){}\n",
  });
  const f = scoped.entities.find((entity) => entity.name === "f");
  const later = scoped.entities.find((entity) => entity.name === "later");
  const g = scoped.references.find((reference) => reference.target === "g");
  const h = scoped.references.find((reference) => reference.target === "h");
  assert.equal(f.parentId, null);
  assert.equal(later.parentId, null);
  assert.equal(g.sourceId, f.id);
  assert.equal(h.sourceId, null);

  const python = parseCode({
    path: "docstring.py",
    source: 'def real():\n    """def fake():\n        ghost()\n    """\n    helper()\n',
  });
  assert.deepEqual(python.entities.map((entity) => entity.name), ["real"]);
  assert.deepEqual(
    python.references.filter((reference) => reference.relation === "calls").map((reference) => reference.target),
    ["helper"],
  );

  const regex = parseCode({
    path: "regex.js",
    source: String.raw`const matcher = /\/*foo/;
function real() { helper(); }
`,
  });
  assert.ok(regex.entities.some((entity) => entity.name === "real"));
  assert.ok(regex.references.some((reference) => reference.target === "helper"));

  const regexClass = parseCode({
    path: "regex-class.js",
    source: "const re=/[/*]/; function real(){safe();}\n",
  });
  assert.ok(regexClass.entities.some((entity) => entity.name === "real"));
  assert.ok(regexClass.references.some((reference) => reference.target === "safe"));
});

test("code parser binds next-line braces for class, function, and typed method scopes", () => {
  const js = parseCode({
    path: "next-line.js",
    source: "class A\n{\n  function f()\n  {\n    g();\n  }\n}\n",
  });
  const klass = js.entities.find((entity) => entity.name === "A");
  const fn = js.entities.find((entity) => entity.name === "f");
  assert.equal(fn.parentId, klass.id);
  assert.equal(js.references.find((reference) => reference.target === "g").sourceId, fn.id);

  const jvm = parseCode({ path: "NextLine.java", source: "class A\n{\n  void run()\n  {\n    helper();\n  }\n}\n" });
  const run = jvm.entities.find((entity) => entity.name === "run");
  assert.ok(run);
  assert.equal(jvm.references.some((reference) => reference.target === "run"), false);
  assert.equal(jvm.references.find((reference) => reference.target === "helper").sourceId, run.id);
});

test("indentation parser binds nested Python declarations and observed references", () => {
  const source = [
    "from helpers import render",
    "class Report(BaseReport):",
    "    def build(self):",
    "        return render()",
    "",
  ].join("\n");
  const result = parseCode({ path: "report.py", source });
  const report = result.entities.find((entity) => entity.name === "Report");
  const build = result.entities.find((entity) => entity.name === "build");
  assert.equal(build.parentId, report.id);
  assert.ok(result.references.some((reference) => reference.relation === "imports" && reference.target === "helpers"));
  assert.ok(result.references.some((reference) => reference.relation === "inherits" && reference.target === "BaseReport"));
  assert.ok(result.references.some((reference) => reference.relation === "calls" && reference.target === "render"));
});

test("SQL parser builds table, column, view, index, and foreign-key facts", () => {
  const source = [
    "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    "CREATE TABLE posts (",
    "  id INTEGER PRIMARY KEY,",
    "  user_id INTEGER,",
    "  CONSTRAINT posts_user FOREIGN KEY (user_id) REFERENCES users(id)",
    ");",
    "CREATE VIEW post_users AS SELECT * FROM posts JOIN users ON posts.user_id = users.id;",
    "CREATE INDEX posts_user_idx ON posts(user_id);",
    "",
  ].join("\n");
  const result = parseSql({ path: "schema.sql", source });
  for (const name of ["users", "posts", "users.id", "posts.id", "posts.user_id", "post_users", "posts_user_idx"]) {
    assert.ok(result.entities.some((entity) => entity.name === name), `missing ${name}`);
  }
  assert.ok(result.references.some((reference) => reference.relation === "foreign-key" && reference.target === "users.id"));
  assert.equal(result.references.filter((reference) => reference.relation === "reads-from").length, 2);
  assert.ok(result.references.some((reference) => reference.relation === "indexes" && reference.target === "posts"));
  assertSourceSpans(result);
});

test("JSON and line config parsers expose key hierarchy and exact references", () => {
  const json = parseConfig({
    path: "package.json",
    source: JSON.stringify({
      dependencies: { local_library: "1.2.3" },
      extends: "./base.json",
      service: { url: "${SERVICE_URL}" },
    }, null, 2),
  });
  assert.ok(json.entities.some((entity) => entity.name === "/dependencies/local_library"));
  assert.ok(json.references.some((reference) => reference.relation === "depends-on" && reference.target === "local_library"));
  assert.ok(json.references.some((reference) => reference.relation === "configures-from" && reference.target === "./base.json"));
  assert.ok(json.references.some((reference) => reference.relation === "reads-config" && reference.target === "SERVICE_URL"));

  const yaml = parseConfig({
    path: "service.yaml",
    source: "service:\n  host: localhost\n  token: ${SERVICE_TOKEN}\n",
  });
  const service = yaml.entities.find((entity) => entity.name === "service");
  const token = yaml.entities.find((entity) => entity.name === "service.token");
  assert.equal(token.parentId, service.id);
  assert.ok(yaml.references.some((reference) => reference.target === "SERVICE_TOKEN"));
  assertSourceSpans(json);
  assertSourceSpans(yaml);
});

test("malformed JSON is a typed omission rather than guessed structure", () => {
  for (const source of ['{"a": ', "{'notJson': 1}", '{"hex": 0x10}', '{"trailing": true,}']) {
    const result = parseConfig({ path: "broken.json", source });
    assert.equal(result.entities.length, 0);
    assert.equal(result.references.length, 0);
    assert.ok(result.diagnostics.some((entry) => entry.code === "config_json_invalid" && entry.severity === "error"));
  }
});

test("JSONC normalization preserves spans while accepting comments and trailing commas", () => {
  const source = '{\n  // local configuration\n  "extends": "./base.json",\n}\n';
  const result = parseConfig({ path: "config.jsonc", source });
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.entities[0].name, "/extends");
  assert.equal(source.slice(result.entities[0].span.start.offset, result.entities[0].span.end.offset), '"extends": "./base.json"');
  assert.ok(result.references.some((entry) => entry.relation === "configures-from"));
});

test("JSON config keys use unambiguous pointers and bound valid nesting", () => {
  const keyed = parseConfig({
    path: "keys.json",
    source: '{"":1,"a.b":2,"a":{"b":3},"a/b":4,"a~b":5}',
  });
  assert.equal(keyed.diagnostics.length, 0);
  assert.deepEqual(keyed.entities.map((entity) => entity.name), [
    "/", "/a.b", "/a", "/a/b", "/a~1b", "/a~0b",
  ]);

  const depth = 257;
  const nested = parseConfig({
    path: "nested.json",
    source: `${'{"a":'.repeat(depth)}0${"}".repeat(depth)}`,
  });
  assert.equal(nested.entities.length, 0);
  assert.equal(nested.references.length, 0);
  assert.ok(nested.diagnostics.some((entry) => (
    entry.code === "config_json_invalid"
    && entry.message === "JSON nesting exceeds 256 levels"
  )));
});

test("YAML block scalar bodies are opaque to structural extraction", () => {
  const result = parseConfig({
    path: "workflow.yaml",
    source: [
      "script: |",
      "  dependencies:",
      "    hidden: 1.0.0",
      "visible: true",
      "",
    ].join("\n"),
  });
  assert.deepEqual(result.entities.map((entity) => entity.name), ["script", "visible"]);
  assert.equal(result.references.length, 0);
});

test("standard Dockerfile directives emit facts and a FROM dependency", () => {
  const result = parseConfig({
    path: "Dockerfile",
    source: [
      "FROM --platform=linux/amd64 node:22-alpine AS build",
      "COPY package.json ./",
      "RUN npm ci",
      "ENV NODE_ENV=production",
      "",
    ].join("\n"),
  });
  assert.deepEqual(result.entities.map((entity) => entity.name), ["from", "copy", "run", "env"]);
  assert.ok(result.references.some((reference) => (
    reference.relation === "depends-on"
    && reference.target === "node:22-alpine"
    && reference.ruleId === "config.dockerfile.from"
  )));
});

test("many-line config extraction stops at the deterministic record budget", () => {
  const source = Array.from({ length: 10_050 }, (_, index) => `key_${index}=value`).join("\n");
  const result = parseConfig({ path: "large.properties", source });
  assert.equal(result.entities.length, 10_000);
  assert.equal(result.entities.at(-1).span.start.line, 10_000);
  assert.ok(result.diagnostics.some((entry) => (
    entry.code === "config_record_limit"
    && entry.detail?.limit === 10_000
    && entry.detail?.partial === true
  )));

  const lines = parseConfig({ path: "blank.properties", source: "\n".repeat(50_001) });
  assert.equal(lines.entities.length, 0);
  assert.ok(lines.diagnostics.some((entry) => (
    entry.code === "config_line_limit"
    && entry.detail?.limit === 50_000
    && entry.detail?.partial === true
  )));
});

function assertSourceSpans(result) {
  for (const record of [...result.entities, ...result.references]) {
    assert.equal(record.span.schema, "agentic-source-span/v1");
    assert.ok(record.span.start.offset >= 0);
    assert.ok(record.span.end.offset >= record.span.start.offset);
    assert.ok(record.ruleId);
  }
}
