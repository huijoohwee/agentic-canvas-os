import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CATALOG_DIGEST_INPUT,
  CATALOG_DIGEST_OWNER,
  DICTIONARY_DESCRIPTORS,
  collectCatalogEntries,
  computeCatalogDigest,
  labelFromToken,
  validateDictionaryCatalogContract,
} from "../scripts/dictionary-catalog-contract.mjs";

async function liveDocuments() {
  const documents = new Map();
  for (const { docsPath } of DICTIONARY_DESCRIPTORS) {
    documents.set(
      docsPath,
      await readFile(new URL(`../docs/${docsPath}`, import.meta.url), "utf8"),
    );
  }
  return documents;
}

test("the three canonical dictionaries satisfy the catalog contract", async () => {
  assert.deepEqual(validateDictionaryCatalogContract(await liveDocuments()), []);
});

test("every declared entry carries a kind, a derived label, and a non-empty summary", async () => {
  const { entries, failures } = collectCatalogEntries(await liveDocuments());
  assert.deepEqual(failures, []);
  assert.ok(entries.length > 400);
  for (const entry of entries) {
    assert.ok(["command", "semantic", "binding"].includes(entry.kind));
    assert.equal(entry.label, labelFromToken(entry.token));
    assert.notEqual(entry.summary, "");
    assert.match(entry.sourcePath, /^agentic-canvas-os\/docs\/DICTIONARY-[A-Z]+\.md$/);
  }
});

test("the WebMCP surface is a first-class register entry in both dictionaries", async () => {
  const { entries } = collectCatalogEntries(await liveDocuments());
  const semantic = entries.find((entry) => entry.token === "#webmcp");
  const binding = entries.find((entry) => entry.token === "@webmcp-surface");
  assert.ok(semantic, "#webmcp must be declared in the semantic dictionary");
  assert.ok(binding, "@webmcp-surface must be declared in the binding dictionary");
  assert.equal(semantic.kind, "semantic");
  assert.equal(binding.kind, "binding");
  // The recorded W3C API revision must be named so a spec rename fails a check
  // instead of leaving the declared browser tools describing an absent API.
  assert.match(binding.summary, /navigator\.modelContext\.registerTool/);
  assert.match(binding.summary, /getTools\(\{ fromOrigins \}\)/);
  assert.match(binding.summary, /origin-trial/);
});

test("the digest is order-independent but content-sensitive", async () => {
  const { entries } = collectCatalogEntries(await liveDocuments());
  const reversed = [...entries].reverse();
  assert.equal(computeCatalogDigest(reversed), computeCatalogDigest(entries));

  const reworded = entries.map((entry, index) => index === 0
    ? { ...entry, summary: `${entry.summary} drift` }
    : entry);
  assert.notEqual(computeCatalogDigest(reworded), computeCatalogDigest(entries));

  const removed = entries.slice(1);
  assert.notEqual(computeCatalogDigest(removed), computeCatalogDigest(entries));
});

test("count drift, digest drift, and a duplicate owner field each fail closed", async () => {
  const documents = await liveDocuments();
  const owner = documents.get(CATALOG_DIGEST_OWNER);

  const countDrift = new Map(documents);
  countDrift.set(CATALOG_DIGEST_OWNER, owner.replace(/^catalog_entry_count: \d+$/m, "catalog_entry_count: 9"));
  assert.ok(
    validateDictionaryCatalogContract(countDrift).some((failure) => failure.includes("catalog_entry_count declares 9")),
  );

  const digestDrift = new Map(documents);
  digestDrift.set(
    CATALOG_DIGEST_OWNER,
    owner.replace(/^catalog_digest: ".*"$/m, `catalog_digest: "${"0".repeat(64)}"`),
  );
  assert.ok(
    validateDictionaryCatalogContract(digestDrift).some((failure) => failure.includes("catalog_digest declares")),
  );

  const inputDrift = new Map(documents);
  inputDrift.set(
    CATALOG_DIGEST_OWNER,
    owner.replace(/^catalog_digest_input: ".*"$/m, 'catalog_digest_input: "sha256:unpinned"'),
  );
  assert.ok(
    validateDictionaryCatalogContract(inputDrift).some((failure) => failure.includes("catalog_digest_input must be")),
  );
  assert.equal(CATALOG_DIGEST_INPUT.startsWith("sha256:canonical-json:sorted"), true);
});

test("a second dictionary declaring the digest is refused as a competing owner", async () => {
  const documents = await liveDocuments();
  const semanticPath = "DICTIONARY-SEMANTIC.md";
  documents.set(
    semanticPath,
    documents.get(semanticPath).replace(
      /^prefix: "#"$/m,
      'prefix: "#"\ncatalog_digest: "abc"',
    ),
  );
  assert.ok(
    validateDictionaryCatalogContract(documents).some(
      (failure) => failure.includes(`${semanticPath}: catalog_digest must be declared only in`),
    ),
  );
});

test("a listed token without a table row and a row without a listing both fail", async () => {
  const documents = await liveDocuments();
  const bindingPath = "DICTIONARY-BINDING.md";
  const text = documents.get(bindingPath);

  const listedOnly = new Map(documents);
  listedOnly.set(bindingPath, text.replace(/^  - "@webmcp-surface"$/m, '  - "@webmcp-surface"\n  - "@ghost-binding"'));
  assert.ok(
    validateDictionaryCatalogContract(listedOnly).some(
      (failure) => failure.includes("@ghost-binding is listed but has no table row"),
    ),
  );

  const rowOnly = new Map(documents);
  rowOnly.set(bindingPath, text.replace(/^  - "@webmcp-surface"\n/m, ""));
  assert.ok(
    validateDictionaryCatalogContract(rowOnly).some(
      (failure) => failure.includes("@webmcp-surface has a table row but is not listed"),
    ),
  );
});

test("a declared token that cannot pass the shared invocation grammar fails", async () => {
  const documents = await liveDocuments();
  const semanticPath = "DICTIONARY-SEMANTIC.md";
  documents.set(
    semanticPath,
    documents.get(semanticPath).replace(/^  - "#webmcp"$/m, '  - "#WebMCP"'),
  );
  assert.ok(
    validateDictionaryCatalogContract(documents).some(
      (failure) => failure.includes("cannot resolve through the shared invocation grammar"),
    ),
  );
});
