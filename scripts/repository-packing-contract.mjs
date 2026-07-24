#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const REPOSITORY_PACKING_INVOCATION = Object.freeze({
  skill: "repository.pack",
  command: "/repository.pack",
  semantic: "#repository-packing",
  binding: "@repository-root",
  proofBinding: "@runtime-proof",
  text: "/repository.pack #repository-packing @repository-root @runtime-proof",
  tool: "knowgrph.repository.pack",
});

export const REPOSITORY_PACKING_BOUNDS = Object.freeze({
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

const TOKEN_CONTRACTS = Object.freeze([
  {
    token: REPOSITORY_PACKING_INVOCATION.command,
    document: "DICTIONARY-COMMAND.md",
    truthField: "commands",
    sectionStart: "## Commands",
    sectionEnd: "## Command Shape",
    columns: 5,
  },
  {
    token: REPOSITORY_PACKING_INVOCATION.semantic,
    document: "DICTIONARY-SEMANTIC.md",
    truthField: "semantics",
    sectionStart: "## Tags",
    sectionEnd: "## Semantic Shape",
    columns: 4,
  },
  {
    token: REPOSITORY_PACKING_INVOCATION.binding,
    document: "DICTIONARY-BINDING.md",
    truthField: "bindings",
    sectionStart: "## Bindings",
    sectionEnd: "## Binding Shape",
    columns: 4,
  },
]);

export const REPOSITORY_PACKING_DOCUMENTS = Object.freeze([
  "REPOSITORY-PACKING.md",
  "DICTIONARY-COMMAND.md",
  "DICTIONARY-SEMANTIC.md",
  "DICTIONARY-BINDING.md",
  "FACTS.md",
  "SKILLS.md",
  "HARNESS-CONTRACTS.md",
  "MCP-GATEWAY.md",
  "RUNTIME-READINESS.md",
  "RUNTIME-PROOF.md",
  "VALIDATION-RUNBOOK.md",
  "README.md",
]);

const PLANNING_CONTEXT = "repository-packing-ai-friendly-single-file-runtime";
const ATTRIBUTION_URL = "https://github.com/yamadashy/repomix";

export function validateRepositoryPackingContractDocuments(documents) {
  const failures = [];
  const required = Object.fromEntries(REPOSITORY_PACKING_DOCUMENTS.map((name) => [
    name,
    requireDocument(documents, name, failures),
  ]));
  if (failures.length > 0) return failures;

  const facts = required["FACTS.md"];
  for (const contract of TOKEN_CONTRACTS) {
    const dictionary = required[contract.document];
    requireCount(
      dictionary,
      `  - "${contract.token}"`,
      1,
      `${contract.document}: dictionary entry ${contract.token}`,
      failures,
    );
    const rows = readSection(dictionary, contract.sectionStart, contract.sectionEnd)
      .split("\n")
      .filter((line) => line.startsWith(`| \`${contract.token}\` |`));
    if (rows.length !== 1) {
      failures.push(`${contract.document}: expected one owning row ${contract.token}, found ${rows.length}`);
    } else if (splitTableRow(rows[0]).length !== contract.columns) {
      failures.push(`${contract.document}: ${contract.token} row must have ${contract.columns} cells`);
    }
    requireCount(
      facts,
      `  "${contract.token}": "${contract.document}#${contract.token}"`,
      1,
      `FACTS.md: direct resolution ${contract.token}`,
      failures,
    );
    const truthTokens = readTruthTokens(facts, contract.truthField, failures);
    if (truthTokens.filter((token) => token === contract.token).length !== 1) {
      failures.push(`FACTS.md: truth_tokens.${contract.truthField} must contain ${contract.token} once`);
    }
  }
  requireMarkers(required["DICTIONARY-COMMAND.md"], "DICTIONARY-COMMAND.md repository tuple", [
    "exactly `@repository-root` and `@runtime-proof`",
    "exactly `#repository-packing`",
    "`knowgrph-repository-pack-result/v1`",
  ], failures);
  requireMarkers(required["DICTIONARY-BINDING.md"], "DICTIONARY-BINDING.md root isolation", [
    "Must equal Git's canonical worktree root after symlink-safe validation",
    "do not broaden `@working-directory`",
  ], failures);

  const owner = required["REPOSITORY-PACKING.md"];
  requireMarkers(owner, "REPOSITORY-PACKING.md", [
    'schema: "agentic-repository-packing-contract/v1"',
    'status: "spec-complete"',
    `invocation: "${REPOSITORY_PACKING_INVOCATION.text}"`,
    `skill_id: "${REPOSITORY_PACKING_INVOCATION.skill}"`,
    `mcp_tool: "${REPOSITORY_PACKING_INVOCATION.tool}"`,
    ATTRIBUTION_URL,
    'external_reference_policy: "attribution-only clean-room research"',
    'external_dependency: "forbidden"',
    "local stdio MCP only",
    "git rev-parse --show-toplevel",
    "git ls-files",
    "sort by UTF-8 bytes",
    "dynamically sized Markdown fence",
    "content-addressed",
    "exclusive temporary file plus atomic rename",
    "Sensitive path or high-confidence credential",
    "source files remain unchanged",
    "networkCalls: 0",
    "modelCalls: 0",
    "inputTokens: 0",
    "outputTokens: 0",
    "costUsd: 0",
    "No code, prose, prompt, schema, grammar, example, test, fixture,",
    "The automated dependency and reserved-name guard is not a similarity detector",
    "provenance and similarity review",
    "no Prod mirror mutation or Cloudflare deployment",
  ], failures);
  requireBoundMarkers(owner, failures);

  requireCount(
    readSection(required["DICTIONARY-BINDING.md"], "## Composition Rules", "## Direct Facts Link"),
    `| \`${REPOSITORY_PACKING_INVOCATION.text}\` |`,
    1,
    "DICTIONARY-BINDING.md: exact composition tuple",
    failures,
  );
  requireCount(
    readSection(required["DICTIONARY-SEMANTIC.md"], "## Composition Rules", "## Direct Facts Link"),
    `| \`${REPOSITORY_PACKING_INVOCATION.text}\` |`,
    1,
    "DICTIONARY-SEMANTIC.md: exact composition tuple",
    failures,
  );

  requireCount(
    required["MCP-GATEWAY.md"],
    `| \`${REPOSITORY_PACKING_INVOCATION.tool}\` |`,
    1,
    "MCP-GATEWAY.md: one repository pack tool",
    failures,
  );
  requireMarkers(required["MCP-GATEWAY.md"], "MCP repository owner boundary", [
    "## Repository Packing Capability",
    `${REPOSITORY_PACKING_INVOCATION.text}`,
    "local stdio MCP capability",
    "return verified metadata only",
    "zero-network",
    "zero-model",
  ], failures);

  requireCount(required["SKILLS.md"], `  - "${REPOSITORY_PACKING_INVOCATION.skill}"`, 1, "SKILLS.md: skill id", failures);
  requireMarkers(required["SKILLS.md"], "SKILLS.md repository route", [
    "| Repository packing | `REPOSITORY-PACKING.md` |",
    "`repository.pack`",
  ], failures);
  requireCount(required["HARNESS-CONTRACTS.md"], "| Repository Packing |", 1, "HARNESS-CONTRACTS.md: catalog row", failures);
  requireCount(required["RUNTIME-READINESS.md"], "| Repository packing contract |", 1, "RUNTIME-READINESS.md: row", failures);
  requireCount(required["RUNTIME-PROOF.md"], "| Repository packing contract |", 2, "RUNTIME-PROOF.md: scope and promotion rows", failures);
  requireCount(required["RUNTIME-PROOF.md"], "| Repository packing contract is executable |", 1, "RUNTIME-PROOF.md: executable row", failures);
  requireCount(required["VALIDATION-RUNBOOK.md"], "| Repository Packing |", 1, "VALIDATION-RUNBOOK.md: focused row", failures);
  requireCount(required["README.md"], "| `REPOSITORY-PACKING.md` |", 1, "README.md: document map row", failures);
  requireCount(facts, "| Repository packing |", 1, "FACTS.md: repository packing fact", failures);

  const dictionaryFrontmatters = [
    required["DICTIONARY-COMMAND.md"],
    required["DICTIONARY-SEMANTIC.md"],
    required["DICTIONARY-BINDING.md"],
  ].map(readFrontmatter);
  if (dictionaryFrontmatters.some((frontmatter) => /^\s+-\s+["'][\/#@]repomix\b/im.test(frontmatter))) {
    failures.push("invocation dictionaries: forbidden external compatibility alias");
  }
  if (/^\|\s+`knowgrph\.repomix[\w.-]*`\s+\|/im.test(required["MCP-GATEWAY.md"])) {
    failures.push("MCP-GATEWAY.md: forbidden external compatibility tool alias");
  }

  for (const [name, text] of documents) {
    const lineCount = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    if (lineCount >= 600) failures.push(`${name}: ${lineCount} lines exceeds the <600 line budget`);
  }
  return failures;
}

export function validateRepositoryPackingPlanningRow(planningText) {
  const failures = [];
  const rows = planningText.split("\n").filter((line) => line.startsWith("| ") && line.endsWith(" |"));
  const matches = rows.filter((line) => splitTableRow(line)[0] === PLANNING_CONTEXT);
  if (matches.length !== 1) {
    return [`todo/2026-07.md: expected one ${PLANNING_CONTEXT} row, found ${matches.length}`];
  }
  const cells = splitTableRow(matches[0]);
  if (cells.length !== 11) failures.push("todo/2026-07.md: repository packing row must have 11 cells");
  if (cells.some((cell) => cell.length === 0)) failures.push("todo/2026-07.md: repository packing row has an empty cell");
  if (cells[10] !== "2026-07-24") failures.push("todo/2026-07.md: Updated Date must be 2026-07-24");
  if ((cells[2] ?? "").split(/\s+/).filter(Boolean).length > 50) {
    failures.push("todo/2026-07.md: Directive exceeds 50 words");
  }
  return failures;
}

export function validateRepositoryPackingIndependence({
  packageText = "",
  lockText = "",
  sourceEntries = [],
}) {
  const failures = [];
  for (const [name, text] of [["package.json", packageText], ["package-lock.json", lockText]]) {
    if (/"(?:@[^"]+\/)?repomix"\s*:|github:yamadashy\/repomix|yamadashy\/repomix\.git/i.test(text)) {
      failures.push(`${name}: forbidden repository packing dependency or locator`);
    }
  }
  const forbiddenRuntime = [
    /\bfrom\s+["'][^"']*repomix[^"']*["']/i,
    /\bimport\s*\(\s*["'][^"']*repomix[^"']*["']\s*\)/i,
    /\b(?:execFile|spawn|exec)\s*\([^)]*["'`]repomix["'`]/i,
    /https?:\/\/(?:www\.)?repomix\./i,
    /\bknowgrph\.repomix[\w.-]*/i,
  ];
  for (const [name, text] of sourceEntries) {
    for (const pattern of forbiddenRuntime) {
      if (pattern.test(text)) failures.push(`${name}: forbidden external repository packing runtime reference`);
    }
  }
  return failures;
}

function requireBoundMarkers(text, failures) {
  for (const value of Object.values(REPOSITORY_PACKING_BOUNDS)) {
    requireMarkers(text, "REPOSITORY-PACKING.md hard bounds", [String(value)], failures);
  }
}

function requireDocument(documents, name, failures) {
  const text = documents.get(name);
  if (typeof text !== "string") {
    failures.push(`missing required document ${name}`);
    return "";
  }
  return text;
}

function requireMarkers(text, label, markers, failures) {
  for (const marker of markers) {
    if (!text.includes(marker)) failures.push(`${label}: missing ${marker}`);
  }
}

function requireCount(text, needle, expected, label, failures) {
  const count = text.split(needle).length - 1;
  if (count !== expected) failures.push(`${label}: expected ${expected}, found ${count}`);
}

function readSection(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return "";
  return text.slice(startIndex, endIndex);
}

function readFrontmatter(text) {
  const end = text.indexOf("\n---\n", 4);
  return text.startsWith("---\n") && end >= 0 ? text.slice(4, end) : "";
}

function readTruthTokens(facts, field, failures) {
  const match = facts.match(new RegExp(`^  ${field}: \\[(.*)\\]$`, "m"));
  if (!match) {
    failures.push(`FACTS.md: missing truth_tokens.${field}`);
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function splitTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

async function runCli() {
  const docs = new Map(await Promise.all(REPOSITORY_PACKING_DOCUMENTS.map(async (name) => [
    name,
    await readFile(new URL(`../docs/${name}`, import.meta.url), "utf8"),
  ])));
  const planning = await readFile(new URL("../todo/2026-07.md", import.meta.url), "utf8");
  const packageText = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const lockText = await readFile(new URL("../package-lock.json", import.meta.url), "utf8").catch(() => "");
  const failures = [
    ...validateRepositoryPackingContractDocuments(docs),
    ...validateRepositoryPackingPlanningRow(planning),
    ...validateRepositoryPackingIndependence({ packageText, lockText }),
  ];
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("repository packing contract ok");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runCli();
}
