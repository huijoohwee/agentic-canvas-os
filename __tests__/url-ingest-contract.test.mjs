import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  URL_INGEST_INVOCATION,
  validateUrlIngestContractDocuments,
} from "../scripts/url-ingest-contract.mjs";

const documentNames = [
  "FACTS.md",
  "DICTIONARY-COMMAND.md",
  "DICTIONARY-SEMANTIC.md",
  "DICTIONARY-BINDING.md",
  "SKILLS.md",
  "MCP-GATEWAY.md",
  "RUNTIME-PROOF.md",
];

const repositoryDocuments = new Map(await Promise.all(documentNames.map(async (name) => [
  name,
  await readFile(new URL(`../docs/${name}`, import.meta.url), "utf8"),
])));

function withReplacement(name, before, after) {
  const documents = new Map(repositoryDocuments);
  const source = documents.get(name);
  assert.equal(source.includes(before), true, `${name} fixture is missing ${before}`);
  documents.set(name, source.replace(before, after));
  return documents;
}

test("repository keeps one canonical URL ingest invocation", () => {
  assert.deepEqual(URL_INGEST_INVOCATION, {
    command: "/ingest-url",
    bindings: ["@url:", "@reference-policy"],
    semantic: "#canvas",
    skill: "url.ingest",
    text: "/ingest-url @url:https://example.com @reference-policy #canvas",
    discoveryTool: "agenticgraph.agentic_canvas_os.docs.invoke",
    executionTool: "agenticgraph.control_local_import_url",
  });
  assert.deepEqual(validateUrlIngestContractDocuments(repositoryDocuments), []);
});

test("a missing canonical URL ingest command fails closed", () => {
  const documents = withReplacement("DICTIONARY-COMMAND.md", '  - "/ingest-url"\n', "");
  const failures = validateUrlIngestContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("dictionary entry")), true);
});

test("a missing URL ingest skill fails closed", () => {
  const documents = withReplacement("SKILLS.md", '  - "url.ingest"\n', "");
  const failures = validateUrlIngestContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("SKILLS.md skill id")), true);
});

test("the command requires exactly the URL, policy, and Canvas invocation tokens", () => {
  const missingPolicy = withReplacement(
    "DICTIONARY-COMMAND.md",
    "exactly one `@url:` value and `@reference-policy`",
    "exactly one `@url:` value",
  );
  const missingCanvas = withReplacement(
    "DICTIONARY-COMMAND.md",
    "exactly `#canvas`",
    "no semantic token",
  );
  const extraToken = withReplacement(
    "DICTIONARY-COMMAND.md",
    "exactly one `@url:` value and `@reference-policy`",
    "`@url:`, `@reference-policy`, and `@runtime-proof`",
  );
  for (const documents of [missingPolicy, missingCanvas, extraToken]) {
    const failures = validateUrlIngestContractDocuments(documents);
    assert.equal(failures.some((failure) => failure.includes("DICTIONARY-COMMAND.md /ingest-url")), true);
  }
});

test("the docs resolver cannot replace the guarded browser executor", () => {
  const documents = withReplacement(
    "DICTIONARY-COMMAND.md",
    "agenticgraph.control_local_import_url",
    "agenticgraph.agentic_canvas_os.docs.invoke",
  );
  const failures = validateUrlIngestContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("agenticgraph.control_local_import_url")), true);
});

test("Import URL aliases fail the single-route contract", () => {
  for (const alias of ["/import-url", "/url.import", "@import-url", "#url-import"]) {
    const documents = withReplacement(
      "DICTIONARY-COMMAND.md",
      '  - "/ingest-url"\n',
      `  - "/ingest-url"\n  - "${alias}"\n`,
    );
    const failures = validateUrlIngestContractDocuments(documents);
    assert.equal(
      failures.some((failure) => failure.includes(`forbids alias ${alias}`)),
      true,
      `expected ${alias} to fail`,
    );
  }
});

test("the URL binding retains its security boundary", () => {
  const documents = withReplacement(
    "DICTIONARY-BINDING.md",
    "and no credentials in the URL or headers",
    "and optional credentials in the URL",
  );
  const failures = validateUrlIngestContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("DICTIONARY-BINDING.md @url: row")), true);
});

test("the grammar MCP route remains discovery only", () => {
  const documents = withReplacement(
    "MCP-GATEWAY.md",
    "it never executes `/ingest-url` or another grammar command",
    "it executes `/ingest-url`",
  );
  const failures = validateUrlIngestContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("MCP discovery boundary")), true);
});
