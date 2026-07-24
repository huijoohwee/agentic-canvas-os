import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  REPOSITORY_PACKING_BOUNDS,
  REPOSITORY_PACKING_DOCUMENTS,
  REPOSITORY_PACKING_INVOCATION,
  REPOSITORY_PACKING_SOURCE_FILES,
  REPOSITORY_PACKING_SOURCE_ROOTS,
  readRepositoryPackingSourceEntries,
  validateRepositoryPackingContractDocuments,
  validateRepositoryPackingIndependence,
  validateRepositoryPackingPlanningRow,
} from "../scripts/repository-packing-contract.mjs";

const repositoryDocuments = new Map(await Promise.all(REPOSITORY_PACKING_DOCUMENTS.map(async (name) => [
  name,
  await readFile(new URL(`../docs/${name}`, import.meta.url), "utf8"),
])));
const repositoryPlanning = await readFile(new URL("../todo/2026-07.md", import.meta.url), "utf8");
const repositorySources = await readRepositoryPackingSourceEntries();

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
    defaultMaxOutputBytes: 268_435_456,
    hardMaxOutputBytes: 536_870_912,
    hardMaxPolicyPaths: 256,
    hardMaxPathBytes: 1_024,
    defaultRuntimeMs: 60_000,
    hardRuntimeMs: 120_000,
    hardMcpResponseBytes: 65_536,
  });
  assert.deepEqual(validateRepositoryPackingContractDocuments(repositoryDocuments), []);
  assert.deepEqual(validateRepositoryPackingPlanningRow(repositoryPlanning), []);
  assert.deepEqual(REPOSITORY_PACKING_SOURCE_ROOTS, [
    ".githooks",
    ".github",
    "__tests__",
    "agent-api/src",
    "scripts",
    "src",
    "web",
    "worker",
  ]);
  assert.deepEqual(REPOSITORY_PACKING_SOURCE_FILES, ["wrangler.jsonc"]);
  for (const root of REPOSITORY_PACKING_SOURCE_ROOTS) {
    assert.equal(repositorySources.some(([name]) => name.startsWith(`${root}/`)), true, `${root} must be scanned`);
  }
  assert.equal(repositorySources.some(([name]) => name === "scripts/docs-contract.mjs"), true);
  assert.equal(repositorySources.some(([name]) => name === "scripts/repository-packing-contract.mjs"), true);
  assert.equal(repositorySources.some(([name]) => name === "scripts/repository-packing-independence.mjs"), true);
  assert.equal(repositorySources.some(([name]) => name === ".githooks/pre-commit"), true);
  assert.equal(repositorySources.some(([name]) => name === "__tests__/agent-api-app.test.mjs"), true);
  assert.equal(repositorySources.some(([name]) => name === "__tests__/repository-packing-contract.test.mjs"), false);
  assert.equal(repositorySources.some(([name]) => name === "web/index.html"), true);
  assert.equal(repositorySources.some(([name]) => name === "wrangler.jsonc"), true);
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

  const driftedOwner = withReplacement(
    "DICTIONARY-COMMAND.md",
    "Pack the eligible text files in one exact local Git worktree",
    "Bundle an unspecified checkout",
  );
  assert.equal(
    validateRepositoryPackingContractDocuments(driftedOwner)
      .some((failure) => failure.includes("owning row drifted")),
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
    ["exclusive temporary file plus atomic no-replace publication", "exclusive temporary file plus atomic no-replace publication"],
    ["source files remain unchanged", "source files remain unchanged"],
    ["networkCalls: 0", "networkCalls: 0"],
    ["provenance and similarity review", "provenance and similarity review"],
    ["| Output artifact bytes | 268435456 | 536870912 |", "Output artifact bytes"],
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

  const expandedRequest = withReplacement(
    "REPOSITORY-PACKING.md",
    "| `maxTotalBytes` | integer | `134217728` | Positive and no greater than `268435456`. |",
    "| `maxTotalBytes` | integer | `134217728` | Positive and no greater than `268435456`. |\n| `timeoutMs` | integer | `60000` | Caller-controlled deadline. |",
  );
  assert.equal(
    validateRepositoryPackingContractDocuments(expandedRequest)
      .some((failure) => failure.includes("expected exactly seven fields")),
    true,
  );
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

  const tableAlias = withReplacement(
    "DICTIONARY-COMMAND.md",
    "## Command Shape",
    "| `/repomix.pack` | external alias | none | none | forbidden |\n\n## Command Shape",
  );
  assert.equal(
    validateRepositoryPackingContractDocuments(tableAlias)
      .some((failure) => failure.includes("forbidden external compatibility alias")),
    true,
  );

  const factsAlias = withReplacement(
    "FACTS.md",
    "truth_tokens:",
    '  "/repomix": "DICTIONARY-COMMAND.md#/repomix"\ntruth_tokens:',
  );
  assert.equal(
    validateRepositoryPackingContractDocuments(factsAlias)
      .some((failure) => failure.includes("FACTS.md: forbidden external compatibility alias")),
    true,
  );

  const factsBodyAlias = withReplacement(
    "FACTS.md",
    "## Resolution Rules",
    "| Unrelated alias | `/repomix` is registered elsewhere. | `knowgrph.repomix.pack`. |\n## Resolution Rules",
  );
  assert.equal(
    validateRepositoryPackingContractDocuments(factsBodyAlias)
      .some((failure) => failure.includes("FACTS.md: forbidden external compatibility alias")),
    true,
  );

  const skillsBodyAlias = withReplacement(
    "SKILLS.md",
    "## Selection And Mutation",
    "| External packing | `/repomix #repomix @repomix` |\n\n## Selection And Mutation",
  );
  assert.equal(
    validateRepositoryPackingContractDocuments(skillsBodyAlias)
      .some((failure) => failure.includes("SKILLS.md: forbidden external compatibility skill id")),
    true,
  );
});

test("clean-room guard rejects dependencies, locators, imports, binaries, and services", () => {
  assert.deepEqual(validateRepositoryPackingIndependence({
    packageText: '{"dependencies":{}}',
    lockText: "{}",
    sourceEntries: [["mcp/repository-pack-runtime.js", "export const local = true;"]],
  }), []);
  assert.deepEqual(validateRepositoryPackingIndependence({
    packageText: '{"dependencies":{}}',
    lockText: "{}",
    sourceEntries: repositorySources,
  }), []);

  for (const fixture of [
    { packageText: '{"dependencies":{"repomix":"1.0.0"}}' },
    { packageText: '{"dependencies":{"@scope/repomix":"1.0.0"}}' },
    { packageText: '{"dependencies":{"repomix-core":"1.0.0"}}' },
    { packageText: '{"dependencies":{"packer":"npm:repomix@1.0.0"}}' },
    { packageText: '{"dependencies":{"repo\\u006dix":"1.0.0"}}' },
    { packageText: '{"dependencies":{"packer":"npm:repo\\u006dix@1.0.0"}}' },
    { packageText: '{"dependencies":{"packer":"yamadashy/repomix#main"}}' },
    { packageText: '{"scripts":{"pack":"repomix ."}}' },
    { packageText: '{"scripts":{"pack":"npx repomix ."}}' },
    { lockText: '{"resolved":"github:yamadashy/repomix"}' },
    { lockText: '{"packages":{"node_modules/repomix":{}}}' },
    { lockText: '{"packages":{"node_modules/repo\\u006dix":{}}}' },
    { lockText: '{"packages":{"node_modules/@scope/repomix":{}}}' },
    { lockText: '{"resolved":"https://registry.npmjs.org/repomix/-/repomix.tgz"}' },
    { lockText: '{"resolved":"git+https://github.com/yamadashy/repomix.git"}' },
    { lockText: '{"resolved":"git+ssh://git@github.com/yamadashy/repomix.git"}' },
    { lockText: '{"resolved":"https://github.com/yamadashy/repomix"}' },
    { sourceEntries: [["runtime.js", 'import x from "repomix";']] },
    { sourceEntries: [["runtime.js", 'import "repomix";']] },
    { sourceEntries: [["runtime.js", 'const x = await import("repomix");']] },
    { sourceEntries: [["runtime.js", "const x = await import(`repomix`);"]] },
    { sourceEntries: [["runtime.js", 'const x = require("repomix");']] },
    { sourceEntries: [["runtime.js", "const x = require(`repomix`);"]] },
    { sourceEntries: [["runtime.js", 'const x = require.resolve("repomix");']] },
    { sourceEntries: [["runtime.js", 'const x = require("repo\\u006dix");']] },
    { sourceEntries: [["runtime.js", 'const x = require("repo\\x6dix");']] },
    { sourceEntries: [["runtime.js", 'import /* webpackIgnore */ ("repomix");']] },
    { sourceEntries: [["runtime.js", 'require(/* local */ "repomix");']] },
    { sourceEntries: [["runtime.js", 'const dependency = "repomix"; load(dependency);']] },
    { sourceEntries: [[".github/workflows/probe.yml", "run: npx repomix ."]] },
    { sourceEntries: [[".github/workflows/probe.yml", "run: git clone git@github.com:yamadashy/repomix.git"]] },
    { sourceEntries: [["scripts/probe.sh", "repomix ."]] },
    { sourceEntries: [["src/repomix/index.js", "export const local = true;"]] },
    { sourceEntries: [["src/vendor/repomix.js", "export const local = true;"]] },
    { sourceEntries: [[".github/actions/repomix/action.yml", "runs: using: node20"]] },
    { sourceEntries: [["runtime.js", 'execFile("repomix", ["pack"]);']] },
    { sourceEntries: [["runtime.js", 'spawn("/usr/local/bin/repomix", ["pack"]);']] },
    { sourceEntries: [["runtime.js", 'exec("npx repomix .");']] },
    { sourceEntries: [["runtime.js", 'exec("pnpm dlx repomix .");']] },
    { sourceEntries: [["runtime.js", 'exec("yarn dlx repomix .");']] },
    { sourceEntries: [["runtime.js", 'exec("bunx repomix .");']] },
    { sourceEntries: [["runtime.js", 'fetch("https://repomix.com/api");']] },
    { sourceEntries: [["runtime.js", 'fetch("https://github.com/yamadashy/repomix/archive/main.zip");']] },
    { sourceEntries: [["runtime.js", 'fetch("https://raw.githubusercontent.com/yamadashy/repomix/main/package.json");']] },
    { sourceEntries: [["runtime.js", 'fetch("https://codeload.github.com/yamadashy/repomix/tar.gz/main");']] },
    { sourceEntries: [["runtime.js", 'const upstream = "https://github.com/yamadashy/repomix"; await client(upstream);']] },
    { sourceEntries: [["runtime.js", 'const upstream = "https://github.com/yamadashy/repomix?raw=1";']] },
    { sourceEntries: [["runtime.js", 'const upstream = "//github.com/yamadashy/repomix";']] },
    { sourceEntries: [["runtime.js", "// https://github.com/yamadashy/repomix#readme"]] },
    { sourceEntries: [["runtime.js", '"knowgrph.repomix"']] },
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

test("every projection row proves its content instead of only its label", () => {
  for (const [name, prefix, selector, columns] of [
    ["HARNESS-CONTRACTS.md", "| Repository Packing |", "knowgrph-repository-pack-result/v1", 5],
    ["MCP-GATEWAY.md", "| `knowgrph.repository.pack` |", "return verified metadata only", 3],
    ["SKILLS.md", "| Repository packing |", "REPOSITORY-PACKING.md", 2],
    ["RUNTIME-READINESS.md", "| Repository packing contract |", "exact integrated Knowgrph revision", 4],
    ["RUNTIME-PROOF.md", "| Repository packing contract |", "single `knowgrph.repository.pack`", 3],
    ["RUNTIME-PROOF.md", "| Repository packing contract is executable |", "repository-packing-contract:check", 3],
    ["RUNTIME-PROOF.md", "| Repository packing contract |", "exact protected Knowgrph tool proof", 3],
    ["VALIDATION-RUNBOOK.md", "| Repository Packing |", "exact Knowgrph focused", 2],
    ["README.md", "| `REPOSITORY-PACKING.md` |", "Local repository packing contract", 3],
    ["FACTS.md", "| Repository packing |", "content-addressed Markdown artifact", 3],
  ]) {
    const source = repositoryDocuments.get(name);
    const row = source.split("\n").find((line) => line.startsWith(prefix) && line.includes(selector));
    assert.equal(typeof row, "string", `${name} fixture is missing ${selector}`);
    const key = row.trim().slice(1, -1).split("|")[0].trim();
    const bogus = `| ${[key, ...Array(columns - 2).fill("bogus"), "Fully deployed to Prod"].join(" | ")} |`;
    const documents = new Map(repositoryDocuments);
    documents.set(name, source.replace(row, bogus));
    assert.equal(
      validateRepositoryPackingContractDocuments(documents)
        .some((failure) => failure.includes("projection")),
      true,
      `${name} bogus projection should fail`,
    );
  }
});

test("planning row is unique, complete, dated, and directive-bounded", () => {
  const missing = repositoryPlanning.replace("repository-packing-ai-friendly-single-file-runtime", "wrong-context");
  assert.equal(validateRepositoryPackingPlanningRow(missing)[0].includes("expected one"), true);

  const row = repositoryPlanning.split("\n")
    .find((line) => line.includes("repository-packing-ai-friendly-single-file-runtime"));
  const compactRow = `|${row.trim().slice(1, -1).split("|").map((cell) => cell.trim()).join("|")}|`;
  const noOuterRow = row.trim().slice(1, -1);
  for (const duplicateRow of [row, compactRow, `   ${row}`, noOuterRow]) {
    const duplicate = repositoryPlanning.replace("## 2026-07-23\n", `## 2026-07-23\n${duplicateRow}\n`);
    assert.equal(validateRepositoryPackingPlanningRow(duplicate)[0].includes("found 2"), true);
  }

  const wrongSection = repositoryPlanning
    .replace(`${row}\n`, "")
    .replace("## 2026-07-23\n", `## 2026-07-23\n${row}\n`);
  assert.equal(validateRepositoryPackingPlanningRow(wrongSection)[0].includes("must occur"), true);

  const placeholder = `| ${[
    "repository-packing-ai-friendly-single-file-runtime",
    ...Array(9).fill("x"),
    "2026-07-24",
  ].join(" | ")} |`;
  assert.equal(
    validateRepositoryPackingPlanningRow(repositoryPlanning.replace(row, placeholder))
      .some((failure) => failure.includes("placeholder")),
    true,
  );
  assert.equal(
    validateRepositoryPackingPlanningRow(repositoryPlanning.replace(
      row,
      row.replace("Pack one complete local codebase", "TBD later"),
    )).some((failure) => failure.includes("placeholder")),
    true,
  );

  for (const [before, after, expected] of [
    ["/repository.pack #repository-packing @repository-root @runtime-proof", "generic invocation", "missing /repository.pack"],
    ["`knowgrph.repository.pack`", "`other.tool`", "missing `knowgrph.repository.pack`"],
    ["Agentic Canvas OS owns", "A owns", "missing Agentic Canvas OS owns"],
    ["Knowgrph owns", "B owns", "missing Knowgrph owns"],
  ]) {
    const changed = repositoryPlanning.replace(row, row.replace(before, after));
    assert.equal(
      validateRepositoryPackingPlanningRow(changed)
        .some((failure) => failure.includes(expected)),
      true,
    );
  }
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
