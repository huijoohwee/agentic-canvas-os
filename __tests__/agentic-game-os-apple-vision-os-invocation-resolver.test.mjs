// Responsibility: Verify exact dictionary routing and fail-closed outcomes for the Agentic Game OS invocation resolver.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  INVOCATION_RESOLUTION_SCHEMA,
  resolveInvocation,
} from "../scripts/invocation-resolve.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const docsRoot = path.join(repositoryRoot, "docs");
const dictionaryNames = [
  "DICTIONARY-COMMAND.md",
  "DICTIONARY-SEMANTIC.md",
  "DICTIONARY-BINDING.md",
];
const invocationTuple = [
  "/game.portability",
  "#game-portability",
  "@portability-layer",
];

const tableHeadings = { "/": "Commands", "#": "Tags", "@": "Bindings" };

const dictionaryDocument = (entries, summaries = {}) => `---
title: "Test dictionary"
prefix: "${entries[0]?.[0]}"
prefix_role: "test role"
dictionary_entries:
${entries.map((token) => `  - "${token}"`).join("\n")}
---

## ${tableHeadings[entries[0]?.[0]]}

| Token | Summary |
|---|---|
${entries.map((token) => `| \`${token}\` | ${summaries[token] ?? `Summary for ${token}`} |`).join("\n")}
`;

const readDictionaryBytes = async () => Object.fromEntries(await Promise.all(
  dictionaryNames.map(async (name) => [name, await readFile(path.join(docsRoot, name))]),
));

test("the Agentic Game OS Apple/visionOS tuple resolves from the three Invocation SSOT dictionaries", async () => {
  const before = await readDictionaryBytes();
  const result = await resolveInvocation(invocationTuple);
  const after = await readDictionaryBytes();

  assert.equal(result.schema, INVOCATION_RESOLUTION_SCHEMA);
  assert.equal(result.ok, true);
  assert.equal(result.status, "resolved");
  assert.equal(result.results.length, 3);
  assert.deepEqual(result.results.map(({ entry }) => entry.token), invocationTuple);
  assert.deepEqual(result.results.map(({ entry }) => entry.prefixRole), [
    "command route",
    "semantic filter or topic route",
    "source, actor, or runtime binding",
  ]);
  assert.deepEqual(result.results.map(({ entry }) => entry.sourceDocumentPath), [
    "agentic-canvas-os/docs/DICTIONARY-COMMAND.md",
    "agentic-canvas-os/docs/DICTIONARY-SEMANTIC.md",
    "agentic-canvas-os/docs/DICTIONARY-BINDING.md",
  ]);
  assert.ok(result.results.every(({ entry }) => entry.summary.length > 0));
  assert.ok(result.elapsedMilliseconds < 2_000);
  assert.deepEqual(result.costRecords, invocationTuple.map((token) => ({
    token,
    modelIdentity: null,
    promptTokenCount: 0,
    completionTokenCount: 0,
    estimatedCost: 0,
  })));
  assert.deepEqual(after, before);
});

test("a valid token consults only the dictionary selected by its prefix", async () => {
  const contents = await readDictionaryBytes();
  const reads = [];
  const result = await resolveInvocation("#game-portability", {
    dictionaryRoot: "/inert-test-root",
    readDictionary: async (absolutePath) => {
      const name = path.basename(absolutePath);
      reads.push(name);
      return contents[name];
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(reads, ["DICTIONARY-SEMANTIC.md"]);
  assert.equal(result.results[0].entry.token, "#game-portability");
});

test("malformed tokens fail closed without consulting a dictionary", async () => {
  for (const [token, violatedRule] of [
    ["game.portability", "invalid-prefix"],
    ["/", "empty-remainder"],
    ["/Game.portability", "invalid-remainder-character"],
    [`/${"a".repeat(129)}`, "remainder-too-long"],
  ]) {
    let reads = 0;
    const result = await resolveInvocation(token, {
      readDictionary: async () => {
        reads += 1;
        throw new Error("must not read");
      },
    });
    assert.equal(result.code, "malformed-token");
    assert.equal(result.error.token, token);
    assert.equal(result.error.violatedRule, violatedRule);
    assert.equal(reads, 0);
    assert.deepEqual(result.costRecords, []);
  }
});

test("duplicate prefixes and inputs over three tokens reject the whole input before reads", async () => {
  for (const tokens of [
    ["/game.portability", "/game.mode"],
    ["/one", "#two", "@three", "/four"],
  ]) {
    let reads = 0;
    const result = await resolveInvocation(tokens, {
      readDictionary: async () => {
        reads += 1;
        throw new Error("must not read");
      },
    });
    assert.equal(result.code, "duplicate-prefix");
    assert.deepEqual(result.error.duplicatedPrefixes[0], {
      prefix: "/",
      tokens: tokens.filter((token) => token.startsWith("/")),
    });
    assert.equal(reads, 0);
    assert.deepEqual(result.results, []);
  }
});

test("an absent token is unresolved without alias or nearest-match substitution", async () => {
  const semanticDocument = dictionaryDocument(["#game-portability"]);
  const reads = [];
  const result = await resolveInvocation("#game-portabilit", {
    dictionaryRoot: "/inert-test-root",
    readDictionary: async (absolutePath) => {
      reads.push(path.basename(absolutePath));
      return semanticDocument;
    },
  });

  assert.equal(result.status, "unresolved");
  assert.deepEqual(reads, ["DICTIONARY-SEMANTIC.md"]);
  assert.equal(result.results[0].code, "unresolved");
  assert.equal(result.results[0].reason, "absent");
  assert.equal(result.results[0].token, "#game-portabilit");
  assert.equal(result.results[0].entry, undefined);
  assert.equal(result.results[0].dictionaryPaths.length, 3);
  assert.equal(result.costRecords.length, 1);
});

test("an unreadable selected dictionary returns the typed unresolved result", async () => {
  const result = await resolveInvocation("@portability-layer", {
    readDictionary: async () => {
      throw new Error("unreadable");
    },
  });

  assert.equal(result.status, "unresolved");
  assert.equal(result.results[0].code, "unresolved");
  assert.equal(result.results[0].reason, "dictionary-unreadable");
  assert.equal(result.results[0].token, "@portability-layer");
  assert.equal(result.results[0].dictionaryPaths.length, 3);
  assert.equal(result.costRecords.length, 1);
});

test("a selected dictionary that misses the bounded read deadline fails unresolved", async () => {
  const startedAt = performance.now();
  const result = await resolveInvocation("@portability-layer", {
    deadlineMilliseconds: 5,
    readDictionary: async () => new Promise(() => {}),
  });

  assert.equal(result.status, "unresolved");
  assert.equal(result.results[0].reason, "dictionary-unreadable");
  assert.ok(performance.now() - startedAt < 2_000);
});

test("duplicate selected-dictionary entries return one ambiguous-entry rejection", async () => {
  const duplicateDocument = dictionaryDocument([
    "@portability-layer",
    "@portability-layer",
  ]);
  const result = await resolveInvocation("@portability-layer", {
    dictionaryRoot: "/inert-test-root",
    readDictionary: async () => duplicateDocument,
  });

  assert.equal(result.status, "rejected");
  assert.deepEqual(result.results[0], {
    status: "rejected",
    code: "ambiguous-entry",
    token: "@portability-layer",
    dictionaryPath: "agentic-canvas-os/docs/DICTIONARY-BINDING.md",
    count: 2,
  });
  assert.equal(result.costRecords.length, 1);
});

test("a listed token without its summary row treats the dictionary as unreadable", async () => {
  const malformedDictionary = `---
prefix: "/"
prefix_role: "command route"
dictionary_entries:
  - "/game.portability"
---
`;
  const result = await resolveInvocation("/game.portability", {
    dictionaryRoot: "/inert-test-root",
    readDictionary: async () => malformedDictionary,
  });

  assert.equal(result.status, "unresolved");
  assert.equal(result.results[0].reason, "dictionary-unreadable");
  assert.equal(result.results[0].entry, undefined);
});
