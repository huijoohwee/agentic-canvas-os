import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const application = read("docs/APPLICATION-COMPOSITION.md");
const facts = read("docs/FACTS.md");
const gateway = read("docs/MCP-GATEWAY.md");
const packageJson = JSON.parse(read("package.json"));
const invocation = "/application.compose #application-composition @application-manifest @component-catalog @integration-profile @runtime-proof";
const tools = [
  "knowgrph.application.catalog",
  "knowgrph.application.plan",
  "knowgrph.application.execute",
];
const routes = [
  ["docs/DICTIONARY-COMMAND.md", "/application.compose"],
  ["docs/DICTIONARY-SEMANTIC.md", "#application-composition"],
  ["docs/DICTIONARY-BINDING.md", "@application-manifest"],
  ["docs/DICTIONARY-BINDING.md", "@component-catalog"],
  ["docs/DICTIONARY-BINDING.md", "@integration-profile"],
];

test("application composition invocation tokens are canonical dictionary facts", () => {
  for (const [file, token] of routes) {
    const source = read(file);
    assert.equal(matches(source, `^  - "${escapeRegExp(token)}"$`).length, 1, `${token} frontmatter`);
    assert.ok(matches(source, "^\\| `" + escapeRegExp(token) + "`").length >= 1, `${token} table`);
    assert.equal(matches(facts, `^  "${escapeRegExp(token)}":`).length, 1, `${token} facts resolution`);
  }

  for (const file of [
    "docs/APPLICATION-COMPOSITION.md",
    "docs/DICTIONARY-SEMANTIC.md",
    "docs/DICTIONARY-BINDING.md",
    "docs/MCP-GATEWAY.md",
  ]) {
    assert.match(read(file), new RegExp(escapeRegExp(invocation)), `${file} exact invocation`);
  }
  assert.match(application, /`@operator` is required only when execution can spend, mutate/);
});

test("application composition exposes exactly three owner-bounded MCP tools", () => {
  const block = application.match(/mcp_tools:\n((?:  - "[^"]+"\n)+)/);
  assert.ok(block, "mcp_tools frontmatter block");
  assert.deepEqual([...block[1].matchAll(/  - "([^"]+)"/g)].map((match) => match[1]), tools);

  for (const tool of tools) {
    assert.equal(matches(gateway, "`" + escapeRegExp(tool) + "`").length, 1, `${tool} gateway row`);
  }
  assert.match(application, /host-side invocation aliases and metadata, never MCP wire methods/);
  assert.match(application, /negotiate and persist the exact mutually supported protocol revision and capability set/);
  assert.match(application, /absent capability is unsupported/);
  assert.match(application, /does not hard-code a future protocol revision/);
});

test("plans are exact, deterministic, immutable, and fail closed", () => {
  for (const required of [
    /exact `revision`/,
    /source digest/,
    /schema digests/,
    /required capabilities/,
    /Deterministically ordered dependency DAG/,
    /application-composition-plan\/v1/,
    /SHA-256 plan digest/,
    /Equivalent JSON object key order cannot change the plan digest/,
    /Cycles, orphan required inputs, unreachable outputs, ambiguous producers, or unknown owners block/,
  ]) {
    assert.match(application, required);
  }
  assert.match(application, /Loops remain inside their existing lifecycle or orchestration owner/);
  assert.match(application, /A newer record never changes an existing plan/);
});

test("integration and migration boundaries prevent hidden coupling", () => {
  assert.match(application, /opaque host-owned binding/);
  assert.match(application, /packages, commands, endpoints, headers, environment maps, and credentials are invalid/);
  assert.match(application, /Transport, executable, arguments, endpoint, headers, secret bindings, credentials, session objects, and provider payloads stay with the integration owner/);
  assert.match(application, /`compatible`, `migration_required`, or `blocked`/);
  assert.match(application, /leave the current plan unchanged/);
  assert.match(application, /No candidate is downloaded, installed, selected, persisted, or executed automatically/);
  assert.match(application, /not an agent loop, provider adapter, tool gateway, integration proxy, package manager, workflow engine, or deployment controller/);
  assert.match(application, /No automatic retry, migration, provider fallback, deploy, or continuation beyond the plan bounds/);
});

test("documentation projections, checks, line budgets, and no-copy dependency boundary hold", () => {
  const projections = [
    ["docs/HARNESS-CONTRACTS.md", /\| Application Composition \|/],
    ["docs/RUNTIME-PROOF.md", /Application composition contract is executable/],
    ["docs/RUNTIME-READINESS.md", /\| Application composition contract \|/],
    ["docs/VALIDATION-RUNBOOK.md", /npm run application-composition-contract:check/],
    ["README.md", /docs\/APPLICATION-COMPOSITION\.md/],
  ];
  for (const [file, pattern] of projections) assert.match(read(file), pattern, file);

  assert.equal(
    packageJson.scripts["application-composition-contract:check"],
    "node --test __tests__/application-composition-contract.test.mjs",
  );
  assert.doesNotMatch(JSON.stringify({
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
  }), /symphony/i);
  assert.match(application, /external_dependency: "none"/);
  assert.match(application, /No Symphony code, prose, prompts, APIs, schemas, fixtures, tests, package, service, or runtime dependency is copied or required/);

  for (const file of [
    "docs/APPLICATION-COMPOSITION.md",
    "docs/FACTS.md",
    "docs/HARNESS-CONTRACTS.md",
    "docs/VALIDATION-RUNBOOK.md",
  ]) {
    assert.ok(read(file).split("\n").length - 1 < 600, `${file} stays below 600 lines`);
  }
});

function read(file) {
  return readFileSync(file, "utf8");
}

function matches(source, pattern) {
  return [...source.matchAll(new RegExp(pattern, "gm"))];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
