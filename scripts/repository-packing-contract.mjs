#!/usr/bin/env node

import { readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRepositoryPackingIndependence } from "./repository-packing-independence.mjs";

export { validateRepositoryPackingIndependence };

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
  defaultMaxOutputBytes: 268_435_456,
  hardMaxOutputBytes: 536_870_912,
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
    expectedRow: "| `/repository.pack` | Pack the eligible text files in one exact local Git worktree into a deterministic content-addressed Markdown artifact. | exactly `@repository-root` and `@runtime-proof` | exactly `#repository-packing` | Knowgrph local stdio MCP returns `knowgrph-repository-pack-result/v1` with a verified repository-relative artifact path, source and artifact digests, typed counts, hard bounds, and exact zero network, model, token, and cost evidence. |",
  },
  {
    token: REPOSITORY_PACKING_INVOCATION.semantic,
    document: "DICTIONARY-SEMANTIC.md",
    truthField: "semantics",
    sectionStart: "## Tags",
    sectionEnd: "## Semantic Shape",
    columns: 4,
    expectedRow: "| `#repository-packing` | Deterministic, bounded conversion of one exact local Git worktree into one AI-friendly content-addressed Markdown artifact. | `/repository.pack #repository-packing @repository-root @runtime-proof` requests the local stdio MCP owner. | Canonical Git discovery, typed omissions, source and artifact digests, path containment, atomic publication, independence proof, and zero network, model, token, cost, Prod, and Cloudflare activity are explicit. |",
  },
  {
    token: REPOSITORY_PACKING_INVOCATION.binding,
    document: "DICTIONARY-BINDING.md",
    truthField: "bindings",
    sectionStart: "## Bindings",
    sectionEnd: "## Binding Shape",
    columns: 4,
    expectedRow: "| `@repository-root` | Exact local Git worktree root selected for deterministic repository packing. | Explicit operator path resolved under the configured Knowgrph local MCP root. | Must equal Git's canonical worktree root after symlink-safe validation; it grants reads only within that root and one content-addressed write under the approved output directory. |",
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

export const REPOSITORY_PACKING_SOURCE_ROOTS = Object.freeze([".githooks", ".github", "__tests__", "agent-api/src", "scripts", "src", "web", "worker"]);
export const REPOSITORY_PACKING_SOURCE_FILES = Object.freeze(["wrangler.jsonc"]);
const COMPOSITION_ROW = "| `/repository.pack #repository-packing @repository-root @runtime-proof` | Resolve one exact local Git worktree into the single `knowgrph.repository.pack` MCP request and bind only its verified content-addressed artifact metadata as proof. |";
const EXTERNAL_PROJECT = ["repo", "mix"].join("");
const PLANNING_CONTEXT = "repository-packing-ai-friendly-single-file-runtime";
const PLANNING_DATE = "2026-07-24";
const ATTRIBUTION_URL = ["https://github.com/yamadashy/", "repo", "mix"].join("");
const REQUEST_ROWS = Object.freeze([
  "| `repositoryPath` | string | `.` | Repository-relative path under the configured Knowgrph MCP root; it must resolve to an exact Git worktree root. |",
  "| `outputDirectory` | string | `data/outputs/repository-packs` | Repository-relative directory beneath the selected Git worktree; it must remain outside the packed inventory. |",
  "| `includePaths` | array of strings | `[]` | Optional repository-relative file or directory prefixes; empty means every eligible path. |",
  "| `excludePaths` | array of strings | `[]` | Optional repository-relative file or directory prefixes applied after inclusion. |",
  "| `maxFiles` | integer | `12000` | Positive selected-candidate limit applied after include/exclude policy; no greater than `20000`. |",
  "| `maxFileBytes` | integer | `2097152` | Positive and no greater than `8388608`. |",
  "| `maxTotalBytes` | integer | `134217728` | Positive and no greater than `268435456`. |",
]);
const HARD_BOUND_ROWS = Object.freeze([
  "| Selected candidate files | 12000 | 20000 |",
  "| Bytes per embedded file | 2097152 | 8388608 |",
  "| Total embedded source bytes | 134217728 | 268435456 |",
  "| Output artifact bytes | 268435456 | 536870912 |",
  "| Include prefixes | 0 | 256 |",
  "| Exclude prefixes | 0 | 256 |",
  "| Normalized path bytes | 1024 | 1024 |",
  "| Runtime | 60000 ms | 120000 ms |",
  "| MCP response bytes | 65536 | 65536 |",
]);

const PROJECTION_ROWS = Object.freeze([
  {
    document: "HARNESS-CONTRACTS.md",
    sectionStart: "## Harness Catalog",
    sectionEnd: "## Instruction Audit Harness Contract",
    key: "Repository Packing",
    columns: 5,
    markers: ["repositoryPath, outputDirectory, includePaths, excludePaths, maxFiles, maxFileBytes, maxTotalBytes", "knowgrph-repository-pack-result/v1", "secrets, escape, drift, overflow", "network, model, Prod, and Cloudflare"],
  },
  {
    document: "MCP-GATEWAY.md",
    sectionStart: "## Repository Packing Capability",
    sectionEnd: "## Managed Implementation Run Capabilities",
    key: "`knowgrph.repository.pack`",
    columns: 3,
    markers: ["return verified metadata only", "Local, idempotent, bounded, zero-network, zero-model, and zero-cost", "Prod, and Cloudflare fail before publication"],
  },
  {
    document: "SKILLS.md",
    sectionStart: "## Specialized Contracts",
    sectionEnd: "## Selection And Mutation",
    key: "Repository packing",
    columns: 2,
    markers: ["`REPOSITORY-PACKING.md`"],
  },
  {
    document: "RUNTIME-READINESS.md",
    sectionStart: "## Readiness Matrix",
    sectionEnd: "## External Runtime Gates",
    key: "Repository packing contract",
    columns: 4,
    markers: [REPOSITORY_PACKING_INVOCATION.text, REPOSITORY_PACKING_INVOCATION.tool, "contract/runtime/stdio/independence tests", "Runtime-ready for ACOS contract", "exact integrated Knowgrph revision and docs pin"],
  },
  {
    document: "RUNTIME-PROOF.md",
    sectionStart: "## Proof Scope",
    sectionEnd: "## Proof Ledger",
    key: "Repository packing contract",
    columns: 3,
    markers: [REPOSITORY_PACKING_INVOCATION.text, REPOSITORY_PACKING_INVOCATION.skill, REPOSITORY_PACKING_INVOCATION.tool, "exact Knowgrph proof", "Alternate aliases", "Prod, or Cloudflare"],
  },
  {
    document: "RUNTIME-PROOF.md",
    sectionStart: "## Proof Ledger",
    sectionEnd: "## Promotion Boundary",
    key: "Repository packing contract is executable",
    columns: 3,
    markers: ["npm run repository-packing-contract:check", "clean-room dependency/reserved-name guards", "separate provenance and similarity review remains required and is not automated", "combined runtime claim"],
  },
  {
    document: "RUNTIME-PROOF.md",
    sectionStart: "## Promotion Boundary",
    sectionEnd: "## Revalidation",
    key: "Repository packing contract",
    columns: 3,
    markers: ["Runtime-ready for ACOS contract", "exact protected Knowgrph tool proof", "exact Agentic Canvas OS docs revision pin"],
  },
  {
    document: "VALIDATION-RUNBOOK.md",
    sectionStart: "## Agentic OS VCC Checks",
    sectionEnd: "## Deploy Guard",
    key: "Repository Packing",
    columns: 2,
    markers: ["npm run repository-packing-contract:check", "exact Knowgrph focused `repository-pack` contract, runtime, stdio, and independence tests", "zero network/model/token/cost", "no Prod or Cloudflare action"],
  },
  {
    document: "README.md",
    sectionStart: "## Document Map",
    sectionEnd: "## Runtime Position",
    key: "`REPOSITORY-PACKING.md`",
    columns: 3,
    markers: [REPOSITORY_PACKING_INVOCATION.text, "one Knowgrph stdio MCP tool", "content-addressed Markdown", "clean-room independence"],
  },
  {
    document: "FACTS.md",
    sectionStart: "## Stateful Orchestration Facts",
    sectionEnd: "## Resolution Rules",
    key: "Repository packing",
    columns: 3,
    markers: [REPOSITORY_PACKING_INVOCATION.text, REPOSITORY_PACKING_INVOCATION.tool, "deterministic bounded content-addressed Markdown artifact", "zero network, model, token, cost, Prod, or Cloudflare activity"],
  },
]);

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
    } else if (rows[0] !== contract.expectedRow) {
      failures.push(`${contract.document}: ${contract.token} owning row drifted`);
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
    'runtime_owner: "$GITHUB_ROOT/knowgrph/mcp/repository-pack-contract.js; $GITHUB_ROOT/knowgrph/mcp/repository-pack-error.js; $GITHUB_ROOT/knowgrph/mcp/repository-pack-format.js; $GITHUB_ROOT/knowgrph/mcp/repository-pack-git.js; $GITHUB_ROOT/knowgrph/mcp/repository-pack-publisher.js; $GITHUB_ROOT/knowgrph/mcp/repository-pack-runtime.js; $GITHUB_ROOT/knowgrph/mcp/local-tool-contract.js; $GITHUB_ROOT/knowgrph/mcp/os-status-runtime.js; $GITHUB_ROOT/knowgrph/mcp/server.js"',
    ATTRIBUTION_URL,
    'external_reference_policy: "attribution-only clean-room research"',
    'external_dependency: "forbidden"',
    "local stdio MCP only",
    "git rev-parse --show-toplevel",
    "git ls-files",
    "sort by UTF-8 bytes",
    "selected-candidate limit after include/exclude policy",
    "counted in aggregate but never named",
    "never policy path values",
    "dynamically sized Markdown fence",
    "content-addressed",
    "exclusive temporary file plus atomic no-replace publication",
    "Sensitive path or high-confidence credential",
    "source files remain unchanged",
    "Only `maxFiles`, `maxFileBytes`, and `maxTotalBytes` are caller-lowerable",
    "output-artifact, runtime, and MCP-response limits",
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
  requireClosedRequest(owner, failures);
  requireBoundMarkers(owner, failures);

  requireCount(
    readSection(required["DICTIONARY-BINDING.md"], "## Composition Rules", "## Direct Facts Link"),
    COMPOSITION_ROW,
    1,
    "DICTIONARY-BINDING.md: exact composition tuple",
    failures,
  );
  requireCount(
    readSection(required["DICTIONARY-SEMANTIC.md"], "## Composition Rules", "## Direct Facts Link"),
    COMPOSITION_ROW,
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
  for (const projection of PROJECTION_ROWS) {
    requireProjectionRow(required[projection.document], projection, failures);
  }

  const externalInvocationAlias = new RegExp(`[\\/#@]${EXTERNAL_PROJECT}[\\w.-]*`, "i");
  const externalToolAlias = new RegExp(`\\bknowgrph\\.${EXTERNAL_PROJECT}[\\w.-]*\\b`, "i");
  for (const name of ["DICTIONARY-COMMAND.md", "DICTIONARY-SEMANTIC.md", "DICTIONARY-BINDING.md"]) {
    if (externalInvocationAlias.test(required[name])) {
      failures.push(`${name}: forbidden external compatibility alias`);
    }
  }
  const factsRegistration = [
    readSection(facts, "direct_resolution:", "truth_tokens:"),
    readSection(facts, "truth_tokens:", "\n---\n"),
    readDocumentBody(facts),
  ].join("\n");
  if (externalInvocationAlias.test(factsRegistration) || externalToolAlias.test(factsRegistration)) {
    failures.push("FACTS.md: forbidden external compatibility alias");
  }
  const skillsRegistration = [
    readSection(required["SKILLS.md"], "skill_contracts:", "---\n# Skills"),
    readDocumentBody(required["SKILLS.md"]),
  ].join("\n");
  if (
    new RegExp(`\\b${EXTERNAL_PROJECT}[\\w.-]*\\b`, "i").test(skillsRegistration)
    || externalInvocationAlias.test(skillsRegistration)
    || externalToolAlias.test(skillsRegistration)
  ) {
    failures.push("SKILLS.md: forbidden external compatibility skill id");
  }
  if (externalToolAlias.test(required["MCP-GATEWAY.md"])) {
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
  const ledgerRows = planningText.split("\n")
    .filter((line) => splitTableRow(line).length === 11);
  const ledgerMatches = ledgerRows.filter((line) => splitTableRow(line)[0] === PLANNING_CONTEXT);
  if (ledgerMatches.length !== 1) {
    return [`todo/2026-07.md: expected one ${PLANNING_CONTEXT} row across the ledger, found ${ledgerMatches.length}`];
  }
  const section = readDatedSection(planningText, PLANNING_DATE);
  if (!section) return [`todo/2026-07.md: missing ${PLANNING_DATE} section`];
  const rows = section.split("\n")
    .filter((line) => splitTableRow(line).length === 11);
  const matches = rows.filter((line) => splitTableRow(line)[0] === PLANNING_CONTEXT);
  if (matches.length !== 1 || matches[0] !== ledgerMatches[0]) {
    return [`todo/2026-07.md: ${PLANNING_CONTEXT} must occur in the ${PLANNING_DATE} section`];
  }
  const cells = splitTableRow(matches[0]);
  if (cells.length !== 11) failures.push("todo/2026-07.md: repository packing row must have 11 cells");
  if (cells.some((cell) => (
    cell.length === 0
    || /^(-|n\/a|x)$/i.test(cell)
    || /\b(?:tbd|placeholder|unknown)\b/i.test(cell)
  ))) {
    failures.push("todo/2026-07.md: repository packing row has an empty or placeholder cell");
  }
  if (cells[10] !== PLANNING_DATE) failures.push(`todo/2026-07.md: Updated Date must be ${PLANNING_DATE}`);
  if ((cells[2] ?? "").split(/\s+/).filter(Boolean).length > 50) {
    failures.push("todo/2026-07.md: Directive exceeds 50 words");
  }
  requireMarkers(matches[0], "todo/2026-07.md repository packing row", [
    REPOSITORY_PACKING_INVOCATION.text,
    `\`${REPOSITORY_PACKING_INVOCATION.skill}\``,
    `\`${REPOSITORY_PACKING_INVOCATION.tool}\``,
    "`runRepositoryPackTool`",
    "Agentic Canvas OS owns",
    "Knowgrph owns",
    "exact revision",
    "stdio",
    "protected integration",
  ], failures);
  return failures;
}

function requireBoundMarkers(text, failures) {
  const section = readSection(text, "## Hard Bounds", "## Clean-Room Boundary");
  const rows = section.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Dimension "));
  for (const expected of HARD_BOUND_ROWS) {
    if (!rows.includes(expected)) failures.push(`REPOSITORY-PACKING.md hard bounds: missing ${expected}`);
  }
  if (rows.length !== HARD_BOUND_ROWS.length) {
    failures.push("REPOSITORY-PACKING.md hard bounds: expected exactly nine bound rows");
  }
}

function requireClosedRequest(text, failures) {
  const section = readSection(text, "## Closed Request", "## Deterministic Pipeline");
  const rows = section.split("\n")
    .filter((line) => /^\| `[^`]+` \|/.test(line));
  for (const expected of REQUEST_ROWS) {
    if (!rows.includes(expected)) failures.push(`REPOSITORY-PACKING.md closed request: missing ${expected}`);
  }
  if (rows.length !== REQUEST_ROWS.length) {
    failures.push("REPOSITORY-PACKING.md closed request: expected exactly seven fields");
  }
}

function requireProjectionRow(text, contract, failures) {
  const section = readSection(text, contract.sectionStart, contract.sectionEnd);
  const rows = section.split("\n")
    .filter((line) => splitTableRow(line)[0] === contract.key);
  const label = `${contract.document}: ${contract.key} projection`;
  if (rows.length !== 1) {
    failures.push(`${label}: expected 1 row, found ${rows.length}`);
    return;
  }
  const cells = splitTableRow(rows[0]);
  if (cells.length !== contract.columns) {
    failures.push(`${label}: expected ${contract.columns} cells, found ${cells.length}`);
    return;
  }
  requireMarkers(rows[0], label, contract.markers, failures);
  if (/fully deployed to prod|prod[- ]ready|cloudflare deployed/i.test(rows[0])) {
    failures.push(`${label}: unsupported deployment promotion`);
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

function readDatedSection(text, date) {
  const heading = `## ${date}\n`;
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const remaining = text.slice(start + heading.length);
  const nextHeading = remaining.search(/^## [0-9]{4}-[0-9]{2}-[0-9]{2}\n/m);
  return nextHeading < 0 ? remaining : remaining.slice(0, nextHeading);
}

function readDocumentBody(text) {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  return end < 0 ? "" : text.slice(end + 5);
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
  if (!trimmed.includes("|")) return [];
  const withoutLeading = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutOuter = withoutLeading.endsWith("|") ? withoutLeading.slice(0, -1) : withoutLeading;
  return withoutOuter.split("|").map((cell) => cell.trim());
}

export async function readRepositoryPackingSourceEntries() {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const sourceNames = [];
  const symbolicLinks = new Set();
  const excludedDirectories = new Set(["coverage", "dist", "node_modules"]);
  const selfTest = "__tests__/repository-packing-contract.test.mjs";
  const walk = async (relativeDirectory) => {
    const directory = path.join(repositoryRoot, relativeDirectory);
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) {
      const relativeName = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) await walk(relativeName);
      } else if ((entry.isFile() || entry.isSymbolicLink()) && relativeName !== selfTest) {
        sourceNames.push(relativeName);
        if (entry.isSymbolicLink()) symbolicLinks.add(relativeName);
      }
    }
  };
  for (const root of REPOSITORY_PACKING_SOURCE_ROOTS) await walk(root);
  sourceNames.push(...REPOSITORY_PACKING_SOURCE_FILES);
  sourceNames.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  return Promise.all(sourceNames.map(async (name) => [
    name,
    symbolicLinks.has(name)
      ? await readlink(path.join(repositoryRoot, name))
      : await readFile(path.join(repositoryRoot, name), "utf8"),
  ]));
}

async function runCli() {
  const docs = new Map(await Promise.all(REPOSITORY_PACKING_DOCUMENTS.map(async (name) => [
    name,
    await readFile(new URL(`../docs/${name}`, import.meta.url), "utf8"),
  ])));
  const planning = await readFile(new URL("../todo/2026-07.md", import.meta.url), "utf8");
  const packageText = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const lockText = await readFile(new URL("../package-lock.json", import.meta.url), "utf8").catch(() => "");
  const sourceEntries = await readRepositoryPackingSourceEntries();
  const failures = [
    ...validateRepositoryPackingContractDocuments(docs),
    ...validateRepositoryPackingPlanningRow(planning),
    ...validateRepositoryPackingIndependence({ packageText, lockText, sourceEntries }),
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
