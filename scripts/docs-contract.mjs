#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateProbeTreeContractDocuments } from "./probe-tree-contract.mjs";
import { validatePromptPresetContractDocuments } from "./prompt-preset-contract.mjs";
import { validateXrInvocationContractDocuments } from "./xr-invocation-contract.mjs";
import { validateGameModeInvocationContractDocuments } from "./game-mode-invocation-contract.mjs";
import { validateVoiceStudioContractDocuments } from "./voice-studio-contract.mjs";
import { validateSkillEvolutionContractDocuments } from "./skill-evolution-contract.mjs";
import {
  validateAgentTeamContractDocuments,
  validateAgentTeamDocumentLineBudgets,
} from "./agent-team-contract.mjs";
import { validateRepositoryPackingContractDocuments } from "./repository-packing-contract.mjs";
import { validateAlignmentAuditContractDocuments } from "./alignment-audit-contract.mjs";
import { validateUrlIngestContractDocuments } from "./url-ingest-contract.mjs";
import { validatePlanningContextRecordContract } from "./planning-context-record-contract.mjs";
import { validateDictionaryCatalogContract } from "./dictionary-catalog-contract.mjs";
import { validateKanbanProjection } from "./kanban-projection.mjs";

export const MAX_DOCS_ARTIFACT_BYTES = 500_000;
// The always-on harness header is loaded every session, so it carries a much
// tighter budget than a normal owner document.

const REQUIRED_AUTHORED_KEYS = [
  "title",
  "graphId",
  "doc_type",
  "date",
  "lang",
  "schema",
  "frontmatter_contract",
  "status",
];
const ARTIFACT_PATTERNS = [
  /https?:\/\/localhost[:/]/i,
  /kg_media_token/i,
  /data:image/i,
  /VIDEO_DB_API_KEY/,
  /SENSENOVA_API_KEY/,
  /generation_job_id/,
  /index_job_id/,
  /upload-[0-9a-f]/i,
  /airvio\/runs/i,
];
const RUNTIME_READY_STATUS = "runtime-ready";
const UNPROVEN_RUNTIME_PROOF = /^(?:none|n\/a|tbd|todo|missing|absent|unproven|unverified|unclaimed)$/iu;
const RUNTIME_READINESS_CONTRADICTIONS = [
  /\b(?:this (?:document|contract|artifact)|runtime readiness)\s+(?:is|remains)\s+(?:not runtime-ready|unproven|unverified|unclaimed)\b/iu,
  /\bdoes not claim\b[^\n]{0,160}\bruntime parity\b/iu,
  /\b(?:runtime proof|proof for (?:this|the) (?:document|contract|artifact))\s+(?:is|remains)\s+(?:absent|missing|unproven|unverified|unclaimed)\b/iu,
];

export async function collectDocsArtifacts(docsRoot) {
  const artifacts = [];
  await collectDirectory(path.resolve(docsRoot), "", artifacts);
  return artifacts.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function validateMarkdownArtifact({ relativePath, text }) {
  const failures = validateArtifactSize({ relativePath, text });
  const sourceOwnedProjection = isWorkspaceSeedProjection(relativePath);
  const frontmatter = readFrontmatter(text, relativePath, failures);
  if (frontmatter) {
    if (sourceOwnedProjection) {
      validateWorkspaceSeedProjection({ relativePath, frontmatter, failures });
    } else {
      validateAuthoredFrontmatter({ relativePath, frontmatter, failures });
      failures.push(...validateProductMetadataTruthfulness({
        relativePath,
        text,
        frontmatter,
      }));
    }
  }

  const lineCount = countLines(text);
  if (lineCount >= 600) {
    failures.push(`${relativePath}: ${lineCount} lines exceeds the <600 line budget`);
  }

  for (const [index, line] of text.split("\n").entries()) {
    if (!sourceOwnedProjection && /[^\x00-\x7F]/.test(line)) {
      failures.push(`${relativePath}:${index + 1}: non-ASCII content`);
    }
    for (const pattern of ARTIFACT_PATTERNS) {
      if (pattern.test(line)) {
        failures.push(`${relativePath}:${index + 1}: runtime artifact pattern ${pattern}`);
      }
    }
  }
  return failures;
}

// Product metadata may describe a bounded proof while excluding unrelated
// runtime layers. It may not, however, claim runtime-ready while the same
// artifact denies that readiness or names a placeholder as its proof.
export function validateProductMetadataTruthfulness({ relativePath, text, frontmatter }) {
  if (topLevelScalar(frontmatter, "status") !== RUNTIME_READY_STATUS) return [];

  const failures = [];
  const runtimeProof = topLevelScalar(frontmatter, "runtime_proof");
  if (runtimeProof && UNPROVEN_RUNTIME_PROOF.test(runtimeProof)) {
    failures.push(
      `${relativePath}: runtime-ready frontmatter names unproven runtime_proof ${JSON.stringify(runtimeProof)}`,
    );
  }

  const frontmatterEnd = text.indexOf("\n---\n", 4);
  const body = frontmatterEnd < 0 ? "" : text.slice(frontmatterEnd + 5);
  for (const contradiction of RUNTIME_READINESS_CONTRADICTIONS) {
    if (contradiction.test(body)) {
      failures.push(
        `${relativePath}: runtime-ready frontmatter contradicts the document body (${contradiction})`,
      );
    }
  }
  return failures;
}

export function validateJsonArtifact({ relativePath, text }) {
  const failures = validateArtifactSize({ relativePath, text });
  try {
    JSON.parse(text);
  } catch (error) {
    failures.push(`${relativePath}: invalid JSON: ${error.message}`);
  }
  return failures;
}

export async function runDocsContract({
  docsRoot = path.resolve("docs"),
  repositoryRoot = path.resolve("."),
} = {}) {
  const artifacts = await collectDocsArtifacts(docsRoot);
  if (artifacts.length === 0) throw new Error("docs contract found no Markdown or JSON artifacts");

  const failures = [];
  const documents = new Map();
  let markdownCount = 0;
  let jsonCount = 0;
  let projectionCount = 0;

  for (const artifact of artifacts) {
    const text = await readFile(artifact.absolutePath, "utf8");
    if (artifact.extension === ".md") {
      markdownCount += 1;
      if (isWorkspaceSeedProjection(artifact.relativePath)) projectionCount += 1;
      documents.set(artifact.relativePath, text);
      failures.push(...validateMarkdownArtifact({
        relativePath: artifact.relativePath,
        text,
      }));
    } else {
      jsonCount += 1;
      failures.push(...validateJsonArtifact({
        relativePath: artifact.relativePath,
        text,
      }));
    }
  }

  failures.push(...validateProbeTreeContractDocuments(documents));
  failures.push(...validatePromptPresetContractDocuments(documents));
  failures.push(...validateXrInvocationContractDocuments(documents));
  failures.push(...validateGameModeInvocationContractDocuments(documents));
  failures.push(...validateVoiceStudioContractDocuments(documents));
  failures.push(...validateSkillEvolutionContractDocuments(documents));
  failures.push(...validateAgentTeamContractDocuments(documents));
  failures.push(...validateAgentTeamDocumentLineBudgets(documents));
  failures.push(...validateRepositoryPackingContractDocuments(documents));
  failures.push(...validateAlignmentAuditContractDocuments(documents));
  failures.push(...validateUrlIngestContractDocuments(documents));
  failures.push(...validateDictionaryCatalogContract(documents));
  failures.push(...validateKanbanProjection(documents, { repository: repositoryRoot }));
  failures.push(...validatePlanningContextRecordContract({ repository: repositoryRoot }).failures);

  if (failures.length > 0) throw new Error(failures.join("\n"));
  return Object.freeze({
    markdownCount,
    jsonCount,
    projectionCount,
    artifactCount: artifacts.length,
  });
}

async function collectDirectory(absoluteDirectory, relativeDirectory, artifacts) {
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? path.posix.join(relativeDirectory, entry.name)
      : entry.name;
    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      await collectDirectory(absolutePath, relativePath, artifacts);
      continue;
    }
    const extension = path.extname(entry.name).toLowerCase();
    if (!entry.isFile() || ![".md", ".json"].includes(extension)) continue;
    artifacts.push(Object.freeze({ relativePath, absolutePath, extension }));
  }
}

function validateArtifactSize({ relativePath, text }) {
  const size = Buffer.byteLength(text, "utf8");
  const budget = MAX_DOCS_ARTIFACT_BYTES;
  return size < budget
    ? []
    : [`${relativePath}: ${size} bytes exceeds the <${budget} byte budget`];
}

function validateAuthoredFrontmatter({ relativePath, frontmatter, failures }) {
  for (const key of REQUIRED_AUTHORED_KEYS) {
    if (topLevelScalar(frontmatter, key) === null) {
      failures.push(`${relativePath}: missing frontmatter key ${key}`);
    }
  }
}

function validateWorkspaceSeedProjection({ relativePath, frontmatter, failures }) {
  for (const key of ["title", "doc_type"]) {
    if (topLevelScalar(frontmatter, key) === null) {
      failures.push(`${relativePath}: missing projection frontmatter key ${key}`);
    }
  }
  requireScalar({
    relativePath,
    frontmatter,
    key: "status",
    expected: "runtime-ready",
    topLevel: true,
    failures,
  });
  requireScalar({
    relativePath,
    frontmatter,
    key: "runtime_status",
    expected: "runtime-ready",
    topLevel: true,
    failures,
  });
  requireScalar({
    relativePath,
    frontmatter,
    key: "publish_scope",
    expected: "local-only",
    topLevel: true,
    failures,
  });
  requireScalar({
    relativePath,
    frontmatter,
    key: "canonical_source_file",
    expected: `/docs/${relativePath}`,
    failures,
  });
  requireScalar({
    relativePath,
    frontmatter,
    key: "source_root",
    expected: "agentic-graph/docs",
    failures,
  });
  requireScalar({
    relativePath,
    frontmatter,
    key: "source_backed",
    expected: "true",
    failures,
  });
}

function requireScalar({
  relativePath,
  frontmatter,
  key,
  expected,
  topLevel = false,
  failures,
}) {
  const actual = topLevel
    ? topLevelScalar(frontmatter, key)
    : anyScalar(frontmatter, key);
  if (actual === null) {
    failures.push(`${relativePath}: missing projection marker ${key}`);
  } else if (actual !== expected) {
    failures.push(
      `${relativePath}: projection marker ${key} must be ${JSON.stringify(expected)}`,
    );
  }
}

function readFrontmatter(text, relativePath, failures) {
  if (!text.startsWith("---\n")) {
    failures.push(`${relativePath}: missing opening frontmatter delimiter`);
    return null;
  }
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) {
    failures.push(`${relativePath}: missing closing frontmatter delimiter`);
    return null;
  }
  return text.slice(4, end);
}

function topLevelScalar(frontmatter, key) {
  return scalarMatch(frontmatter, new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, "m"));
}

function anyScalar(frontmatter, key) {
  return scalarMatch(frontmatter, new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(.+)$`, "m"));
}

function scalarMatch(frontmatter, pattern) {
  const match = frontmatter.match(pattern);
  if (!match || !match[1].trim()) return null;
  const value = match[1].trim();
  if (
    value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isWorkspaceSeedProjection(relativePath) {
  return relativePath.startsWith("workspace-seeds/");
}

function countLines(text) {
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDirectExecution() {
  return Boolean(
    process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url),
  );
}

if (isDirectExecution()) {
  try {
    const result = await runDocsContract();
    console.log(
      `docs contract ok (${result.markdownCount} Markdown, `
      + `${result.jsonCount} JSON, ${result.projectionCount} projection; `
      + `${result.artifactCount} artifacts)`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
