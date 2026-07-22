#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_EVOLUTION_INVOCATION = Object.freeze({
  command: "/skill.evolve",
  semantic: "#skill-evolution",
  bindings: Object.freeze([
    "@skill-catalog",
    "@skill-policy",
    "@runtime-proof",
    "@operator",
  ]),
  text: "/skill.evolve #skill-evolution @skill-catalog @skill-policy @runtime-proof @operator",
});

export const SKILL_EVOLUTION_MCP_TOOL = "knowgrph.skill.evolve";
export const SKILL_EVOLUTION_OPERATIONS = Object.freeze([
  "plan",
  "start",
  "step",
  "status",
  "cancel",
]);

const TOKEN_DOCUMENTS = Object.freeze({
  [SKILL_EVOLUTION_INVOCATION.command]: "DICTIONARY-COMMAND.md",
  [SKILL_EVOLUTION_INVOCATION.semantic]: "DICTIONARY-SEMANTIC.md",
  "@skill-catalog": "DICTIONARY-BINDING.md",
  "@skill-policy": "DICTIONARY-BINDING.md",
  "@runtime-proof": "DICTIONARY-BINDING.md",
  "@operator": "DICTIONARY-BINDING.md",
});

const FORBIDDEN_DICTIONARY_ALIASES = Object.freeze([
  "/skill.train",
  "#skill-training",
  "@skill-training",
]);
const IMPORT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const IMPORT_SOURCE_ROOTS = Object.freeze(["src", "agent-api", "worker", "web", "scripts", "__tests__"]);

export function validateSkillEvolutionContractDocuments(documents) {
  const failures = [];
  const requiredNames = [
    "SKILL-EVOLUTION.md",
    "SKILLS.md",
    "DICTIONARY-COMMAND.md",
    "DICTIONARY-SEMANTIC.md",
    "DICTIONARY-BINDING.md",
    "FACTS.md",
    "HARNESS-CONTRACTS.md",
    "MCP-GATEWAY.md",
    "RUNTIME-READINESS.md",
    "RUNTIME-PROOF.md",
  ];
  const required = Object.fromEntries(requiredNames.map((name) => [
    name,
    requireDocument(documents, name, failures),
  ]));
  if (failures.length > 0) return failures;

  for (const [token, name] of Object.entries(TOKEN_DOCUMENTS)) {
    const dictionary = required[name];
    requireCount(dictionary, `  - "${token}"`, 1, `${name}: canonical entry ${token}`, failures);
    requireCountByLinePrefix(dictionary, `| \`${token}\` |`, 1, `${name}: canonical row ${token}`, failures);
    requireCountByLinePrefix(
      required["FACTS.md"],
      `  "${token}":`,
      1,
      `FACTS.md: direct resolution ${token}`,
      failures,
    );
  }

  for (const [name, source] of [
    ["DICTIONARY-COMMAND.md", required["DICTIONARY-COMMAND.md"]],
    ["DICTIONARY-SEMANTIC.md", required["DICTIONARY-SEMANTIC.md"]],
    ["DICTIONARY-BINDING.md", required["DICTIONARY-BINDING.md"]],
  ]) {
    for (const alias of FORBIDDEN_DICTIONARY_ALIASES) {
      if (source.includes(`  - "${alias}"`) || source.includes(`| \`${alias}\` |`)) {
        failures.push(`${name}: forbidden duplicate Skill Evolution alias ${alias}`);
      }
    }
  }

  requireMarkers(findTableRow(required["DICTIONARY-COMMAND.md"], SKILL_EVOLUTION_INVOCATION.command), "Skill Evolution command", [
    ...SKILL_EVOLUTION_INVOCATION.bindings,
    "epochs",
    "mini-batches",
    "text-mutation",
    "review-pending",
  ], failures);
  requireMarkers(findTableRow(required["DICTIONARY-SEMANTIC.md"], SKILL_EVOLUTION_INVOCATION.semantic), "Skill Evolution semantic", [
    "held-out validation",
    "model weights",
    "review-pending",
  ], failures);
  requireMarkers(findTableRow(required["DICTIONARY-BINDING.md"], SKILL_EVOLUTION_INVOCATION.text), "Skill Evolution binding route", [
    SKILL_EVOLUTION_INVOCATION.text,
    SKILL_EVOLUTION_MCP_TOOL,
  ], failures);

  requireCountByLinePrefix(required["SKILLS.md"], "  - \"skill.evolve\"", 1, "SKILLS.md: skill.evolve id", failures);
  requireMarkers(required["SKILLS.md"], "Skill Evolution owner routing", [
    "SKILL-EVOLUTION.md",
    "Skill Evolution",
  ], failures);
  const harnessRow = findPlainTableRow(required["HARNESS-CONTRACTS.md"], "Skill evolution");
  requireMarkers(harnessRow, "Learning Harness Skill Evolution redirect", [
    "SKILL-EVOLUTION.md",
    "knowgrph-skill-evolution-result/v1",
    "exclusively defines",
    "no alternate input contract",
  ], failures);
  if (harnessRow.includes("{ skillId, evalPacket, candidateDiff }") || harnessRow.includes("sourceRevision")) {
    failures.push("HARNESS-CONTRACTS.md: Skill evolution row must redirect instead of defining another request shape");
  }
  requireMarkers(findTableRow(required["MCP-GATEWAY.md"], SKILL_EVOLUTION_MCP_TOOL), "Skill Evolution MCP row", [
    SKILL_EVOLUTION_MCP_TOOL,
    "plan/start/step/status/cancel",
    "review-pending",
  ], failures);

  const contract = required["SKILL-EVOLUTION.md"];
  requireMarkers(contract, "SKILL-EVOLUTION.md", [
    'status: "spec-complete"',
    SKILL_EVOLUTION_INVOCATION.text,
    SKILL_EVOLUTION_MCP_TOOL,
    "knowgrph-skill-evolution-request/v1",
    "knowgrph-skill-evolution-result/v1",
    "sourceRevision",
    "candidateAdapter",
    "normalizedChars",
    "epochs",
    "batchSize",
    "miniBatchSize",
    "learningRate: { initial, decay, floor }",
    "initial * decay^epoch",
    "workingCandidate",
    "champion",
    "promotedCandidate",
    "retain exactly their source-bound request shapes",
    "Candidate snapshots use one exact shape",
    "pre-admission or not-found",
    "workingScore >= threshold",
    "workingScore > championScore",
    "workingScore <= threshold",
    "workingScore < championScore",
    "equality never promotes",
    "Held-out evaluator",
    "candidate adapter receives no validation",
    "validation: { adapterCalls, tokens, costUsd, durationMs }",
    "Total adapter calls, tokens, cost, and duration equal",
    "minDelta",
    "patience",
    "requiredGates",
    "maxCandidates",
    "maxAdapterCalls",
    "maxMutationOperations",
    "maxChangedChars",
    "maxTokens",
    "maxCostUsd",
    "maxDurationMs",
    "exact structural, candidate, call, or mutation ceiling",
    "not precomputed worst-case estimates",
    "hard run caps enforced at adapter-call boundaries",
    "source-bound per-call usage envelopes",
    "independently computes operation count",
    "materialize the canonical parent and candidate artifacts",
    "restricted by contract to inference-only execution",
    "deterministic transition id, call id",
    "distinct sanitized subprocesses",
    "canonicalized to 12 decimal places",
    "expectedRevision",
    "runId: null",
    "review_pending",
    "applied: false",
    "modelWeightsMutated: false",
    "deploymentAttempted: false",
    "https://github.com/microsoft/SkillOpt",
    "No SkillOpt code, prose, prompt, schema, algorithm, test, fixture, example, default, package, service, generated artifact, or repository layout is copied or required.",
  ], failures);
  for (const operation of SKILL_EVOLUTION_OPERATIONS) {
    requireMarkers(contract, "SKILL-EVOLUTION.md operation surface", [`\`${operation}\``], failures);
  }
  requireCount(contract, "external_dependency: \"forbidden\"", 1, "SKILL-EVOLUTION.md clean-room dependency boundary", failures);

  requireMarkers(required["RUNTIME-READINESS.md"], "Skill Evolution readiness boundary", [
    "SKILL-EVOLUTION.md",
    SKILL_EVOLUTION_MCP_TOOL,
    "Knowgrph",
  ], failures);
  requireMarkers(required["RUNTIME-PROOF.md"], "Skill Evolution proof boundary", [
    "skill-evolution:check",
    "model-free",
    "Knowgrph",
    "no Knowgrph runtime-readiness claim",
  ], failures);
  return failures;
}

export function validateSkillEvolutionCleanRoomSources({
  packageText = "",
  lockfileText = "",
  modules = new Map(),
} = {}) {
  const failures = [];
  if (/skillopt/i.test(packageText)) {
    failures.push("package.json: forbidden SkillOpt dependency reference");
  }
  if (/skillopt/i.test(lockfileText)) {
    failures.push("package-lock.json: forbidden SkillOpt dependency reference");
  }

  const entries = modules instanceof Map ? modules.entries() : Object.entries(modules);
  for (const [name, source] of entries) {
    for (const specifier of readImportSpecifiers(String(source))) {
      if (/skillopt/i.test(specifier)) {
        failures.push(`${name}: forbidden SkillOpt import ${specifier}`);
      }
    }
  }
  return failures;
}

function requireDocument(documents, name, failures) {
  const value = documents instanceof Map ? documents.get(name) : documents?.[name];
  if (typeof value === "string") return value;
  failures.push(`${name}: required by Skill Evolution contract validation`);
  return "";
}

function requireMarkers(source, label, markers, failures) {
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${label}: missing ${marker}`);
  }
}

function requireCount(source, value, expected, label, failures) {
  const actual = source.split(value).length - 1;
  if (actual !== expected) failures.push(`${label}: expected ${expected}, found ${actual}`);
}

function requireCountByLinePrefix(source, prefix, expected, label, failures) {
  const actual = source.split("\n").filter((line) => line.startsWith(prefix)).length;
  if (actual !== expected) failures.push(`${label}: expected ${expected}, found ${actual}`);
}

function findTableRow(source, token) {
  return source.split("\n").find((line) => line.startsWith(`| \`${token}\` |`)) || "";
}

function findPlainTableRow(source, label) {
  return source.split("\n").find((line) => line.startsWith(`| ${label} |`)) || "";
}

async function readRepositoryDocuments(root) {
  const names = (await readdir(root)).filter((name) => name.endsWith(".md"));
  return new Map(await Promise.all(names.map(async (name) => [
    name,
    await readFile(path.join(root, name), "utf8"),
  ])));
}

function readImportSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /(?:^|[;\n])\s*import\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/gm,
    /(?:^|[;\n])\s*export\s+[^"'()]*?\s+from\s+["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

async function readImportSources(repositoryRoot) {
  const modules = new Map();
  for (const relativeRoot of IMPORT_SOURCE_ROOTS) {
    const absoluteRoot = path.join(repositoryRoot, relativeRoot);
    await visit(absoluteRoot, relativeRoot);
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
      else if (entry.isFile() && IMPORT_EXTENSIONS.has(path.extname(entry.name))) {
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
  const [documents, packageText, lockfileText, modules] = await Promise.all([
    readRepositoryDocuments(path.join(repositoryRoot, "docs")),
    readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    readOptional(path.join(repositoryRoot, "package-lock.json")),
    readImportSources(repositoryRoot),
  ]);
  const failures = [
    ...validateSkillEvolutionContractDocuments(documents),
    ...validateSkillEvolutionCleanRoomSources({ packageText, lockfileText, modules }),
  ];
  if (failures.length > 0) fail(failures.join("\n"));
  else process.stdout.write("skill evolution contract ok\n");
}
