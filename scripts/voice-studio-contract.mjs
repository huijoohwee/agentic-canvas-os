#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VOICE_STUDIO_COMMAND = "/voice.studio";
export const VOICE_STUDIO_OPERATIONS = Object.freeze(["clone", "dictate", "create"]);
export const VOICE_STUDIO_MCP_TOOL = "knowgrph.voice.studio";
export const VOICE_STUDIO_ROUTES = Object.freeze({
  clone: "/voice.studio #voice-clone @audio @voice-profile @approval-gate @cost-log @runtime-proof",
  dictate: "/voice.studio #speech-to-text @audio @text @approval-gate @cost-log @runtime-proof",
  create: "/voice.studio #text-to-speech @text @voice-profile @audio @approval-gate @cost-log @runtime-proof",
});

const TOKEN_CONTRACTS = Object.freeze([
  {
    token: VOICE_STUDIO_COMMAND,
    document: "DICTIONARY-COMMAND.md",
    truthField: "commands",
    sectionStart: "## Commands",
    sectionEnd: "## Command Shape",
    columns: 5,
  },
  {
    token: "#voice-clone",
    document: "DICTIONARY-SEMANTIC.md",
    truthField: "semantics",
    sectionStart: "## Tags",
    sectionEnd: "## Semantic Shape",
    columns: 4,
  },
  {
    token: "#speech-to-text",
    document: "DICTIONARY-SEMANTIC.md",
    truthField: "semantics",
    sectionStart: "## Tags",
    sectionEnd: "## Semantic Shape",
    columns: 4,
  },
  {
    token: "#text-to-speech",
    document: "DICTIONARY-SEMANTIC.md",
    truthField: "semantics",
    sectionStart: "## Tags",
    sectionEnd: "## Semantic Shape",
    columns: 4,
  },
  {
    token: "@voice-profile",
    document: "DICTIONARY-BINDING.md",
    truthField: "bindings",
    sectionStart: "## Bindings",
    sectionEnd: "## Binding Shape",
    columns: 4,
  },
  {
    token: "@audio",
    document: "DICTIONARY-BINDING.md",
    truthField: "bindings",
    sectionStart: "## Bindings",
    sectionEnd: "## Binding Shape",
    columns: 4,
  },
  {
    token: "@text",
    document: "DICTIONARY-BINDING.md",
    truthField: "bindings",
    sectionStart: "## Bindings",
    sectionEnd: "## Binding Shape",
    columns: 4,
  },
  {
    token: "@runtime-proof",
    document: "DICTIONARY-BINDING.md",
    truthField: "bindings",
    sectionStart: "## Bindings",
    sectionEnd: "## Binding Shape",
    columns: 4,
  },
]);

const SHARED_ROUTE_BINDINGS = Object.freeze(["@approval-gate", "@cost-log"]);
const FORBIDDEN_COMMAND_ALIASES = Object.freeze([
  "/voice.clone",
  "/voice.dictate",
  "/voice.create",
]);
const REQUIRED_DOCUMENTS = Object.freeze([
  "VOICE-STUDIO.md",
  "FACTS.md",
  "DICTIONARY-COMMAND.md",
  "DICTIONARY-SEMANTIC.md",
  "DICTIONARY-BINDING.md",
  "SKILLS.md",
  "HARNESS-CONTRACTS.md",
  "MCP-GATEWAY.md",
  "RUNTIME-READINESS.md",
  "RUNTIME-PROOF.md",
  "VALIDATION-RUNBOOK.md",
]);
const RUNTIME_SOURCE_ROOTS = Object.freeze(["src", "agent-api", "worker", "web"]);
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const EXTERNAL_RUNTIME_PATTERN = /voicebox/i;

export function validateVoiceStudioContractDocuments(documents) {
  const failures = [];
  const required = Object.fromEntries(REQUIRED_DOCUMENTS.map((name) => [
    name,
    requireDocument(documents, name, failures),
  ]));
  if (failures.length > 0) return failures;

  const facts = required["FACTS.md"];
  for (const tokenContract of TOKEN_CONTRACTS) {
    validateCanonicalToken(tokenContract, required, facts, failures);
  }
  for (const token of SHARED_ROUTE_BINDINGS) {
    const binding = required["DICTIONARY-BINDING.md"];
    requireCountByLine(
      binding,
      `  - "${token}"`,
      1,
      `DICTIONARY-BINDING.md: shared route binding ${token}`,
      failures,
    );
    const rows = readSection(binding, "## Bindings", "## Binding Shape")
      .split("\n")
      .filter((line) => line.startsWith(`| \`${token}\` |`));
    if (rows.length !== 1) {
      failures.push(`DICTIONARY-BINDING.md: expected one owning row ${token}, found ${rows.length}`);
    } else {
      requireTableColumns(rows[0], 4, `DICTIONARY-BINDING.md: owning row ${token}`, failures);
    }
  }

  const command = required["DICTIONARY-COMMAND.md"];
  const commandRow = findTokenRow(
    readSection(command, "## Commands", "## Command Shape"),
    VOICE_STUDIO_COMMAND,
  );
  requireMarkers(commandRow, "DICTIONARY-COMMAND.md /voice.studio row", [
    "Route-dependent `@audio`, `@text`, `@voice-profile`, `@approval-gate`, `@cost-log`, and `@runtime-proof`",
    "Exactly one of `#voice-clone`, `#speech-to-text`, or `#text-to-speech`",
    VOICE_STUDIO_MCP_TOOL,
    "host route resolves metadata",
    "consent and approval remain separate",
    "fails before audio read, adapter work, spend, or persistence",
  ], failures);
  for (const alias of FORBIDDEN_COMMAND_ALIASES) {
    if (
      command.split("\n").some((line) => line === `  - "${alias}"`)
      || command.split("\n").some((line) => line.startsWith(`| \`${alias}\` |`))
      || facts.split("\n").some((line) => line.trimStart().startsWith(`"${alias}":`))
    ) {
      failures.push(`Voice Studio contract forbids command alias ${alias}`);
    }
  }

  const semantic = required["DICTIONARY-SEMANTIC.md"];
  requireMarkers(findTokenRow(semantic, "#voice-clone"), "DICTIONARY-SEMANTIC.md #voice-clone row", [
    VOICE_STUDIO_COMMAND,
    "`clone`",
    "@audio",
    "@voice-profile",
    "speaker consent",
    "recording rights",
    "revocation",
  ], failures);
  requireMarkers(findTokenRow(semantic, "#speech-to-text"), "DICTIONARY-SEMANTIC.md #speech-to-text row", [
    VOICE_STUDIO_COMMAND,
    "`dictate`",
    "@audio",
    "@text",
    "Recording rights",
    "uncertainty posture",
  ], failures);
  requireMarkers(findTokenRow(semantic, "#text-to-speech"), "DICTIONARY-SEMANTIC.md #text-to-speech row", [
    VOICE_STUDIO_COMMAND,
    "`create`",
    "@voice-profile",
    "disclosure",
    "provenance",
    "revocation",
  ], failures);

  const binding = required["DICTIONARY-BINDING.md"];
  requireMarkers(findTokenRow(binding, "@voice-profile"), "DICTIONARY-BINDING.md @voice-profile row", [
    "exact revision",
    "speaker authorization",
    "permitted uses",
    "retention",
    "disclosure",
    "revocation state",
    "no voice embedding, raw audio, credential, mutable provider alias, or implicit consent",
  ], failures);

  for (const route of Object.values(VOICE_STUDIO_ROUTES)) {
    requireExactCompositionRoute(
      semantic,
      "DICTIONARY-SEMANTIC.md",
      route,
      "## Composition Rules",
      "## Direct Facts Link",
      failures,
    );
    requireExactCompositionRoute(
      binding,
      "DICTIONARY-BINDING.md",
      route,
      "## Composition Rules",
      "## Direct Facts Link",
      failures,
    );
  }

  const contract = required["VOICE-STUDIO.md"];
  requireMarkers(contract, "VOICE-STUDIO.md canonical contract", [
    'status: "spec-complete"',
    'schema: "voice-studio-invocation-contract/v1"',
    `invocation: "${VOICE_STUDIO_COMMAND}"`,
    'operations: ["clone", "dictate", "create"]',
    `mcp_tool: "${VOICE_STUDIO_MCP_TOOL}"`,
    'external_pattern_source: "https://github.com/jamiepine/voicebox"',
    'external_dependency: "forbidden"',
    "host discovery and handoff metadata",
    "dictionary match never executes audio processing",
    "Exactly one semantic route is accepted per request.",
    "Consent and `@approval-gate` are separate requirements.",
    "Revocation immediately blocks new `create` work",
    "Raw recordings, normalized audio, derived voice profiles, transcripts, requested text, and rendered audio remain separate immutable artifact kinds.",
    "fail-before-spend",
    "tokens: 0",
    "costUsd: 0",
    "The contract remains `spec-complete` until an exact integrated Knowgrph revision proves",
    "No Voicebox code, prose, prompt, schema, API shape, tool name, test, fixture, asset, UI layout, style, package, dependency, model stack, provider configuration, generated artifact, or repository structure is copied, imported, invoked, vendored, or required.",
    "Removing network access and the external repository changes neither this contract nor its deterministic validation.",
    "The automated guard detects dependency and runtime reference names; it is not a similarity detector.",
    "A separate provenance and similarity review",
  ], failures);
  for (const [operation, route] of Object.entries(VOICE_STUDIO_ROUTES)) {
    requireCountByLine(
      contract,
      `  ${operation}: "${route}"`,
      1,
      `VOICE-STUDIO.md: frontmatter ${operation} route`,
      failures,
    );
    requireCountByLinePrefix(
      contract,
      `| \`${operation}\` | \`${route}\` |`,
      1,
      `VOICE-STUDIO.md: exact ${operation} route row`,
      failures,
    );
  }
  if (/^status:\s*"runtime-ready(?:-dev)?"\s*$/m.test(contract)) {
    failures.push("VOICE-STUDIO.md: runtime-ready status is forbidden without exact combined Knowgrph proof");
  }

  const skills = required["SKILLS.md"];
  requireCountByLine(skills, '  - "voice.studio"', 1, "SKILLS.md: voice.studio skill", failures);
  requireCountByLinePrefix(
    skills,
    "| AI Voice Studio | `VOICE-STUDIO.md` |",
    1,
    "SKILLS.md: AI Voice Studio specialized contract",
    failures,
  );

  const mcp = required["MCP-GATEWAY.md"];
  const mcpSection = readSection(mcp, "## Voice Studio Capability", "## Soul Identity Capabilities");
  requireMarkers(mcpSection, "MCP-GATEWAY.md Voice Studio owner separation", [
    "host metadata, not MCP wire methods",
    "Agentic Canvas OS owns the canonical operation and safety contract",
    "Knowgrph owns execution, media identity, persistence, and proof",
    "exactly one discriminated `clone`, `dictate`, or `create` request",
    "fails before audio read, adapter work, spend, or persistence",
  ], failures);
  requireCountByLinePrefix(
    mcpSection,
    `| \`${VOICE_STUDIO_MCP_TOOL}\` |`,
    1,
    `MCP-GATEWAY.md: ${VOICE_STUDIO_MCP_TOOL}`,
    failures,
  );

  const factRow = findPlainTableRow(facts, "AI Voice Studio invocation");
  requireTableColumns(factRow, 3, "FACTS.md: AI Voice Studio invocation row", failures);
  requireMarkers(factRow, "FACTS.md: AI Voice Studio invocation row", [
    VOICE_STUDIO_COMMAND,
    "`clone`, `dictate`, or `create`",
    "consent",
    "revocation",
    "disclosure",
    VOICE_STUDIO_MCP_TOOL,
    "inspiration only and is not copied or required",
  ], failures);

  requireMarkers(required["HARNESS-CONTRACTS.md"], "HARNESS-CONTRACTS.md Voice and speech guard", [
    "| Voice and speech |",
    "`VOICE-STUDIO.md` owns clone, speech-to-text, and text-to-speech detail",
    "consent or recording rights",
    "revocation checks",
  ], failures);
  requireCountByLinePrefix(
    required["RUNTIME-READINESS.md"],
    "| AI Voice Studio contract |",
    1,
    "RUNTIME-READINESS.md: AI Voice Studio projection",
    failures,
  );
  requireMarkers(findPlainTableRow(required["RUNTIME-READINESS.md"], "AI Voice Studio contract"), "RUNTIME-READINESS.md: AI Voice Studio projection", [
    "Spec-complete",
    "exact integrated Knowgrph local stdio MCP",
    "fail-before-spend proof required",
  ], failures);

  const proof = required["RUNTIME-PROOF.md"];
  requireCountByLinePrefix(
    proof,
    "| AI Voice Studio ACOS contract is executable |",
    1,
    "RUNTIME-PROOF.md: AI Voice Studio evidence",
    failures,
  );
  const promotionSection = readSection(proof, "## Promotion Boundary", "## Revalidation");
  requireCountByLinePrefix(
    promotionSection,
    "| AI Voice Studio contract |",
    1,
    "RUNTIME-PROOF.md: AI Voice Studio promotion boundary",
    failures,
  );
  requireMarkers(promotionSection, "RUNTIME-PROOF.md: AI Voice Studio promotion boundary", [
    "| AI Voice Studio contract | Spec-complete |",
    "Runtime-ready promotion requires exact integrated Knowgrph revisions",
    "live cloning",
    "biometric deletion",
  ], failures);
  requireMarkers(required["VALIDATION-RUNBOOK.md"], "VALIDATION-RUNBOOK.md Voice Studio projection", [
    'run voice-studio-contract:check',
    "exact clone, dictate, and create metadata routes",
    "one `knowgrph.voice.studio` wire identity",
  ], failures);
  return failures;
}

export function validateVoiceStudioCleanRoomSources({
  packageText = "",
  lockfileText = "",
  modules = new Map(),
} = {}) {
  const failures = [];
  if (EXTERNAL_RUNTIME_PATTERN.test(packageText)) {
    failures.push("package.json: forbidden Voicebox manifest reference");
  }
  if (EXTERNAL_RUNTIME_PATTERN.test(lockfileText)) {
    failures.push("package-lock.json: forbidden Voicebox manifest reference");
  }
  const entries = modules instanceof Map ? modules.entries() : Object.entries(modules);
  for (const [name, sourceValue] of entries) {
    if (EXTERNAL_RUNTIME_PATTERN.test(String(name)) || EXTERNAL_RUNTIME_PATTERN.test(String(sourceValue))) {
      failures.push(`${name}: forbidden Voicebox runtime source reference`);
    }
  }
  return failures;
}

export function validateVoiceStudioPlanningRow(planningText) {
  const failures = [];
  const context = "AI voice studio MCP invocation and clean-room runtime";
  const rows = String(planningText).split("\n").filter((line) => line.startsWith(`| ${context} |`));
  if (rows.length !== 1) {
    failures.push(`todo/2026-07.md: expected exactly one ${context} row, found ${rows.length}`);
    return failures;
  }
  const cells = splitMarkdownTableRow(rows[0]);
  requireTableColumns(rows[0], 11, "todo/2026-07.md: AI Voice Studio planning row", failures);
  if (cells.some((cell) => cell.length === 0)) {
    failures.push("todo/2026-07.md: AI Voice Studio planning row must fill all 11 cells");
  }
  const directiveWords = (cells[2] || "").split(/\s+/).filter(Boolean).length;
  if (directiveWords > 50) {
    failures.push(`todo/2026-07.md: AI Voice Studio directive has ${directiveWords} words; maximum is 50`);
  }
  requireMarkers(rows[0], "todo/2026-07.md: AI Voice Studio planning row", [
    VOICE_STUDIO_COMMAND,
    VOICE_STUDIO_MCP_TOOL,
    "speaker consent",
    "recording rights",
    "no copied Voicebox artifact or dependency",
    "2026-07-24",
  ], failures);
  const dateSection = readSection(String(planningText), "## 2026-07-24", "## 2026-07-25");
  if (!dateSection.includes(rows[0])) {
    failures.push("todo/2026-07.md: AI Voice Studio planning row must remain under 2026-07-24");
  }
  return failures;
}

export async function readVoiceStudioCleanRoomInputs(repositoryRoot = path.resolve(".")) {
  const [packageText, lockfileText, modules] = await Promise.all([
    readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    readOptional(path.join(repositoryRoot, "package-lock.json")),
    readRuntimeSources(repositoryRoot),
  ]);
  return { packageText, lockfileText, modules };
}

function validateCanonicalToken(contract, required, facts, failures) {
  const dictionary = required[contract.document];
  requireCountByLine(
    dictionary,
    `  - "${contract.token}"`,
    1,
    `${contract.document}: canonical dictionary entry ${contract.token}`,
    failures,
  );
  const rows = readSection(dictionary, contract.sectionStart, contract.sectionEnd)
    .split("\n")
    .filter((line) => line.startsWith(`| \`${contract.token}\` |`));
  if (rows.length !== 1) {
    failures.push(`${contract.document}: expected one owning row ${contract.token}, found ${rows.length}`);
  } else {
    requireTableColumns(rows[0], contract.columns, `${contract.document}: owning row ${contract.token}`, failures);
  }
  requireCountByLine(
    facts,
    `  "${contract.token}": "${contract.document}#${contract.token}"`,
    1,
    `FACTS.md: direct resolution ${contract.token}`,
    failures,
  );
  const truthTokens = readTruthTokens(facts, contract.truthField, failures);
  if (truthTokens && truthTokens.filter((token) => token === contract.token).length !== 1) {
    failures.push(`FACTS.md: truth_tokens.${contract.truthField} must contain ${contract.token} exactly once`);
  }
}

function requireExactCompositionRoute(source, documentName, route, startHeading, endHeading, failures) {
  const section = readSection(source, startHeading, endHeading);
  const rows = section.split("\n").filter((line) => line.startsWith(`| \`${route}\` |`));
  if (rows.length !== 1) {
    failures.push(`${documentName}: expected one exact ${route} composition row, found ${rows.length}`);
  } else {
    requireTableColumns(rows[0], 2, `${documentName}: ${route} composition row`, failures);
    requireMarkers(rows[0], `${documentName}: ${route} composition row`, [
      VOICE_STUDIO_MCP_TOOL,
      "metadata-only",
    ], failures);
  }
}

function requireDocument(documents, name, failures) {
  const value = documents instanceof Map ? documents.get(name) : documents?.[name];
  if (typeof value === "string") return value;
  failures.push(`${name}: required by Voice Studio contract validation`);
  return "";
}

function readTruthTokens(facts, field, failures) {
  const match = facts.match(new RegExp(`^  ${field}:\\s*(\\[.*\\])$`, "m"));
  if (!match) {
    failures.push(`FACTS.md: missing truth_tokens.${field}`);
    return undefined;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    failures.push(`FACTS.md: truth_tokens.${field} must remain a JSON-compatible array`);
    return undefined;
  }
}

function readSection(source, startHeading, endHeading) {
  const start = source.indexOf(startHeading);
  if (start < 0) return "";
  const end = source.indexOf(endHeading, start + startHeading.length);
  return source.slice(start, end < 0 ? source.length : end);
}

function findTokenRow(source, token) {
  return source.split("\n").find((line) => line.startsWith(`| \`${token}\` |`)) || "";
}

function findPlainTableRow(source, label) {
  return source.split("\n").find((line) => line.startsWith(`| ${label} |`)) || "";
}

function requireMarkers(source, label, markers, failures) {
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${label}: missing ${marker}`);
  }
}

function requireCountByLine(source, line, expected, label, failures) {
  const actual = source.split("\n").filter((candidate) => candidate === line).length;
  if (actual !== expected) failures.push(`${label}: expected ${expected}, found ${actual}`);
}

function requireCountByLinePrefix(source, prefix, expected, label, failures) {
  const actual = source.split("\n").filter((line) => line.startsWith(prefix)).length;
  if (actual !== expected) failures.push(`${label}: expected ${expected}, found ${actual}`);
}

function requireTableColumns(row, expected, label, failures) {
  if (!row) return;
  const actual = splitMarkdownTableRow(row).length;
  if (actual !== expected) failures.push(`${label}: expected ${expected} columns, found ${actual}`);
}

function splitMarkdownTableRow(row) {
  const cells = [];
  let cell = "";
  let escaped = false;
  for (const character of row.slice(1, -1)) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      cell += character;
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

async function readRepositoryDocuments(root) {
  const names = (await readdir(root)).filter((name) => name.endsWith(".md")).sort();
  return new Map(await Promise.all(names.map(async (name) => [
    name,
    await readFile(path.join(root, name), "utf8"),
  ])));
}

async function readRuntimeSources(repositoryRoot) {
  const modules = new Map();
  for (const relativeRoot of RUNTIME_SOURCE_ROOTS) {
    await visit(path.join(repositoryRoot, relativeRoot), relativeRoot);
  }
  return modules;

  async function visit(absolute, relative) {
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const childAbsolute = path.join(absolute, entry.name);
      const childRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(childAbsolute, childRelative);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        modules.set(childRelative, await readFile(childAbsolute, "utf8"));
      }
    }
  }
}

async function readOptional(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const repositoryRoot = path.resolve(".");
  const [documents, cleanRoomInputs, planningText] = await Promise.all([
    readRepositoryDocuments(path.join(repositoryRoot, "docs")),
    readVoiceStudioCleanRoomInputs(repositoryRoot),
    readFile(path.join(repositoryRoot, "todo", "2026-07.md"), "utf8"),
  ]);
  const failures = [
    ...validateVoiceStudioContractDocuments(documents),
    ...validateVoiceStudioCleanRoomSources(cleanRoomInputs),
    ...validateVoiceStudioPlanningRow(planningText),
  ];
  if (failures.length > 0) fail(failures.join("\n"));
  else process.stdout.write("voice studio contract ok\n");
}
