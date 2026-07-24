import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  REPOSITORY_PACKING_BOUNDS,
  REPOSITORY_PACKING_DOCUMENTS,
  REPOSITORY_PACKING_INVOCATION,
  validateRepositoryPackingContractDocuments,
  validateRepositoryPackingIndependence,
  validateRepositoryPackingPlanningRow,
} from "../scripts/repository-packing-contract.mjs";

const repositoryDocuments = new Map(await Promise.all(REPOSITORY_PACKING_DOCUMENTS.map(async (name) => [
  name,
  await readFile(new URL(`../docs/${name}`, import.meta.url), "utf8"),
])));
const repositoryPlanning = await readFile(new URL("../todo/2026-07.md", import.meta.url), "utf8");

function withReplacement(name, before, after) {
  const documents = new Map(repositoryDocuments);
  const source = documents.get(name);
  assert.equal(source.includes(before), true, `${name} fixture is missing ${before}`);
  documents.set(name, source.replace(before, after));
  return documents;
}

test("repository packing keeps one canonical invocation and bounded contract", () => {
  assert.deepEqual(REPOSITORY_PACKING_INVOCATION, {
    skill: "repository.pack",
    command: "/repository.pack",
    semantic: "#repository-packing",
    binding: "@repository-root",
    proofBinding: "@runtime-proof",
    text: "/repository.pack #repository-packing @repository-root @runtime-proof",
    tool: "knowgrph.repository.pack",
  });
  assert.deepEqual(REPOSITORY_PACKING_BOUNDS, {
    defaultMaxFiles: 12_000,
    hardMaxFiles: 20_000,
    defaultMaxFileBytes: 2_097_152,
    hardMaxFileBytes: 8_388_608,
    defaultMaxTotalBytes: 134_217_728,
    hardMaxTotalBytes: 268_435_456,
    hardMaxPolicyPaths: 256,
    hardMaxPathBytes: 1_024,
    defaultRuntimeMs: 60_000,
    hardRuntimeMs: 120_000,
    hardMcpResponseBytes: 65_536,
  });
  assert.deepEqual(validateRepositoryPackingContractDocuments(repositoryDocuments), []);
  assert.deepEqual(validateRepositoryPackingPlanningRow(repositoryPlanning), []);
});

test("slash, hash, and at tokens must remain directly resolvable", () => {
  for (const [name, line, expected] of [
    ["DICTIONARY-COMMAND.md", '  - "/repository.pack"\n', "dictionary entry /repository.pack"],
    ["DICTIONARY-SEMANTIC.md", '  - "#repository-packing"\n', "dictionary entry #repository-packing"],
    ["DICTIONARY-BINDING.md", '  - "@repository-root"\n', "dictionary entry @repository-root"],
  ]) {
    const failures = validateRepositoryPackingContractDocuments(withReplacement(name, line, ""));
    assert.equal(failures.some((failure) => failure.includes(expected)), true);
  }

  const missingResolution = withReplacement(
    "FACTS.md",
    '  "/repository.pack": "DICTIONARY-COMMAND.md#/repository.pack"\n',
    "",
  );
  assert.equal(
    validateRepositoryPackingContractDocuments(missingResolution)
      .some((failure) => failure.includes("direct resolution /repository.pack")),
    true,
  );

  const staleTruth = withReplacement(
    "FACTS.md",
    '"/file.sync", "/repository.pack", "/prd-tad.create"',
    '"/file.sync", "/prd-tad.create"',
  );
  assert.equal(
    validateRepositoryPackingContractDocuments(staleTruth)
      .some((failure) => failure.includes("truth_tokens.commands")),
    true,
  );
});

test("repository root cannot broaden context or browser Git bindings", () => {
  const broadened = withReplacement(
    "DICTIONARY-COMMAND.md",
    "exactly `@repository-root` and `@runtime-proof`",
    "`@working-directory`, `@local-git-repository`",
  );
  const failures = validateRepositoryPackingContractDocuments(broadened);
  assert.equal(failures.some((failure) => failure.includes("repository tuple")), true);
  assert.equal(
    repositoryDocuments.get("DICTIONARY-BINDING.md")
      .includes("`@working-directory` | Current startup or tool-call working directory used for context discovery."),
    true,
  );
});

test("owner boundary, deterministic grammar, and safety claims are required", () => {
  for (const [before, expected] of [
    ["local stdio MCP only", "local stdio MCP only"],
    ["sort by UTF-8 bytes", "sort by UTF-8 bytes"],
    ["exclusive temporary file plus atomic rename", "exclusive temporary file plus atomic rename"],
    ["source files remain unchanged", "source files remain unchanged"],
    ["networkCalls: 0", "networkCalls: 0"],
    ["provenance and similarity review", "provenance and similarity review"],
  ]) {
    const changed = new Map(repositoryDocuments);
    changed.set(
      "REPOSITORY-PACKING.md",
      repositoryDocuments.get("REPOSITORY-PACKING.md").replaceAll(before, "omitted requirement"),
    );
    assert.equal(
      validateRepositoryPackingContractDocuments(changed)
        .some((failure) => failure.includes(expected)),
      true,
    );
  }
});

test("MCP gateway exposes exactly one canonical local tool", () => {
  const duplicate = new Map(repositoryDocuments);
  duplicate.set(
    "MCP-GATEWAY.md",
    `${duplicate.get("MCP-GATEWAY.md")}\n| \`knowgrph.repository.pack\` | duplicate | duplicate |\n`,
  );
  assert.equal(
    validateRepositoryPackingContractDocuments(duplicate)
      .some((failure) => failure.includes("one repository pack tool")),
    true,
  );

  const renamed = withReplacement(
    "MCP-GATEWAY.md",
    "`knowgrph.repository.pack`",
    "`knowgrph.repomix.pack`",
  );
  assert.equal(
    validateRepositoryPackingContractDocuments(renamed)
      .some((failure) => failure.includes("one repository pack tool")),
    true,
  );

  const alias = withReplacement(
    "DICTIONARY-COMMAND.md",
    '  - "/repository.pack"\n',
    '  - "/repository.pack"\n  - "/repomix.pack"\n',
  );
  assert.equal(
    validateRepositoryPackingContractDocuments(alias)
      .some((failure) => failure.includes("compatibility alias")),
    true,
  );
});

test("clean-room guard rejects dependencies, locators, imports, binaries, and services", () => {
  assert.deepEqual(validateRepositoryPackingIndependence({
    packageText: '{"dependencies":{}}',
    lockText: "{}",
    sourceEntries: [["mcp/repository-pack-runtime.js", "export const local = true;"]],
  }), []);

  for (const fixture of [
    { packageText: '{"dependencies":{"repomix":"1.0.0"}}' },
    { lockText: '{"resolved":"github:yamadashy/repomix"}' },
    { sourceEntries: [["runtime.js", 'import x from "repomix";']] },
    { sourceEntries: [["runtime.js", 'execFile("repomix", ["pack"]);']] },
    { sourceEntries: [["runtime.js", 'fetch("https://repomix.com/api");']] },
    { sourceEntries: [["runtime.js", '"knowgrph.repomix.pack"']] },
  ]) {
    const failures = validateRepositoryPackingIndependence({
      packageText: fixture.packageText ?? "{}",
      lockText: fixture.lockText ?? "{}",
      sourceEntries: fixture.sourceEntries ?? [],
    });
    assert.equal(failures.length > 0, true);
  }
});

test("planning row is unique, complete, dated, and directive-bounded", () => {
  const missing = repositoryPlanning.replace("repository-packing-ai-friendly-single-file-runtime", "wrong-context");
  assert.equal(validateRepositoryPackingPlanningRow(missing)[0].includes("expected one"), true);

  const duplicate = `${repositoryPlanning}${repositoryPlanning.split("\n")
    .find((line) => line.includes("repository-packing-ai-friendly-single-file-runtime"))}\n`;
  assert.equal(validateRepositoryPackingPlanningRow(duplicate)[0].includes("found 2"), true);
});

test("all touched contract documents retain the repository line budget", () => {
  const oversized = new Map(repositoryDocuments);
  oversized.set("REPOSITORY-PACKING.md", `${"line\n".repeat(600)}`);
  assert.equal(
    validateRepositoryPackingContractDocuments(oversized)
      .some((failure) => failure.includes("exceeds the <600 line budget")),
    true,
  );
});
