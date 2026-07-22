import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
  const frontmatterBindings = readInvocationList(application, "bindings");
  assert.deepEqual(frontmatterBindings, [
    "@application-manifest",
    "@component-catalog",
    "@integration-profile",
    "@runtime-proof",
  ]);
  assert.equal(frontmatterBindings.includes("@operator"), false);

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

test("source-bound host component packs are bounded, deterministic, and inert", () => {
  for (const required of [
    /at most 16 component packs/,
    /pure JSON data with a pack id, exact pack revision/,
    /no more than 16 component records/,
    /at most 100 components/,
    /`workspace:\/`, `kgdoc:`, and `urn:knowgrph:`/,
    /`source\.sha256` field containing exactly 64 lowercase hexadecimal characters/,
    /after removing only `source\.sha256`/,
    /packs by `\(pack id, exact revision, source URI\)`/,
    /components by `\(component id, exact revision\)`/,
    /composite `catalogDigest` covers the complete normalized catalog/,
    /exactly one revision per pack id/,
  ]) {
    assert.match(application, required);
  }
  assert.match(application, /Let `SEG` be the exact lowercase ASCII grammar `\[a-z0-9\]\+\(\?:\[\._-\]\[a-z0-9\]\+\)\*`/);
  assert.match(application, /`workspace:\/SEG\[\/SEG\.\.\.\]`, `kgdoc:SEG\[\/SEG\.\.\.\]`, and `urn:knowgrph:SEG\[:SEG\.\.\.\]`/);
  assert.match(application, /first URN segment cannot be `http`, `https`, `file`, `ftp`, `ws`, or `wss`/);
  assert.match(application, /dot-only, traversal, consecutive or trailing punctuation, uppercase, tilde, backslash, authority, query, fragment, percent-encoded, nested-scheme, and network-shaped values are invalid/);
  assert.match(application, /never dereferenced by the composition subsystem/);
  assert.match(application, /MCP callers and application manifests cannot provide, select, or override packs/);
  assert.match(application, /pack-content digest mismatch is admission drift/);
  assert.match(application, /none of the three tools becomes available for that rejected set/);
  assert.match(application, /`knowgrph\.application\.catalog` returns its current digests, while plan and execute reject the stale proof/);
  assert.match(application, /does not claim a persisted cross-process baseline/);
  assert.match(application, /definition digests cover its normalized component definition independently of unrelated members/);
  assert.match(application, /requires explicit proof refresh and replanning/);
  assert.match(application, /no last-known-good fallback, partial acceptance, or silent replacement/);
  for (const rule of [
    /`stableApplicationJson\/v1`/,
    /finite numbers serialized with ECMAScript `JSON\.stringify`/,
    /object keys recursively sorted by ascending UTF-16 code units/,
    /SHA-256 hashes the UTF-8 bytes/,
    /accessors, symbols, custom prototypes, cycles, sparse arrays, hidden properties, non-finite numbers, and non-JSON values rejected/,
  ]) assert.match(application, rule);
});

test("host-only resolvers add interoperability without execution authority", () => {
  assert.match(application, /Runtime adapters and owner resolvers are supplied privately and process-locally by the embedding host/);
  assert.match(application, /never through MCP arguments, manifests, source URIs, URLs, environment paths, filesystem scans, package discovery, or pack fields/);
  assert.match(application, /performs no discovery, download, install, upgrade, migration, or fallback/);
  assert.match(application, /grants no execution authority/);
  assert.match(application, /delegates only to an already-injected existing runtime owner/);
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
    optionalDependencies: packageJson.optionalDependencies,
    peerDependencies: packageJson.peerDependencies,
  }), /langchain/i);
  assert.deepEqual(forbiddenLockDependencies(JSON.parse(read("package-lock.json"))), []);
  assert.match(application, /external_pattern_sources: \["https:\/\/github\.com\/langchain-ai\/langchain"\]/);
  assert.match(application, /external_dependency: "forbidden"/);
  assert.match(application, /clean-room work/);
  assert.match(application, /Copying its code, prose, prompts, APIs, schemas, fixtures, tests, package conventions, services, or dependencies is forbidden/);
  assert.match(application, /composition-subsystem boundary, not a claim about separately owned optional integrations/);
  assert.match(application, /catalog, plan, and bounded offline proof must pass with network access unavailable and without any LangChain package or service/);
  for (const [file, source] of trackedTextSources()) {
    assert.equal(hasHashedWordWindow(source, 35, "b8d9788fdce0dc5681d4fa3bd666357b9fa3c35b4ec07a6dc8806741c08b1fdb"), false, `${file} must not persist the external README tagline`);
  }

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

function hasHashedWordWindow(source, size, expectedDigest) {
  const words = source.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase().split(" ");
  for (let index = 0; index + size <= words.length; index += 1) {
    const digest = createHash("sha256").update(words.slice(index, index + size).join(" ")).digest("hex");
    if (digest === expectedDigest) return true;
  }
  return false;
}

function trackedTextSources() {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  return files.flatMap((file) => {
    const bytes = readFileSync(file);
    return bytes.includes(0) ? [] : [[file, bytes.toString("utf8")]];
  });
}

function forbiddenLockDependencies(lock) {
  const names = new Set();
  const collect = (record) => {
    if (!record || typeof record !== "object") return;
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      if (record[section] && typeof record[section] === "object") for (const name of Object.keys(record[section])) names.add(name);
    }
  };
  collect(lock);
  for (const [path, record] of Object.entries(lock.packages || {})) {
    collect(record);
    const marker = "node_modules/";
    const index = path.lastIndexOf(marker);
    if (index >= 0) names.add(path.slice(index + marker.length));
  }
  return [...names].filter((name) => /^(?:langchain(?:[-_].*)?|@langchain\/|langgraph(?:[-_].*)?|langsmith(?:[-_].*)?|langserve(?:[-_].*)?|deepagents(?:[-_].*)?)/i.test(name)).sort();
}

function matches(source, pattern) {
  return [...source.matchAll(new RegExp(pattern, "gm"))];
}

function readInvocationList(source, key) {
  const frontmatterEnd = source.indexOf("\n---\n", 4);
  assert.ok(source.startsWith("---\n") && frontmatterEnd > 4, "frontmatter");
  const frontmatter = source.slice(4, frontmatterEnd);
  const invocation = frontmatter.match(/^invocation:\n((?:  .+\n?)+)/m);
  assert.ok(invocation, "invocation frontmatter");
  const line = invocation[1].match(new RegExp(`^  ${escapeRegExp(key)}: \\[(.*)\\]$`, "m"));
  assert.ok(line, `invocation.${key}`);
  return [...line[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
