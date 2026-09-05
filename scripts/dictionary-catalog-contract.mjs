#!/usr/bin/env node
// Responsibility: Prove the declared invocation-catalog count and digest against
// the three canonical dictionaries so count or digest drift fails closed before
// spend, mutation, or deploy.
//
// This is the enforcement owner for the claim in DICTIONARY-COMMAND.md
// frontmatter and in MCP-GATEWAY.md: "digest or count drift fails closed".
// Before this contract existed the count and the SHA-256 were hand-maintained
// prose that no check read.
//
// Canonical digest input, pinned as `catalog_digest_input` in the owner
// dictionary, is the SHA-256 of the canonical JSON array of every entry sorted
// by dictionary kind then token, each entry carrying exactly:
//   { token, kind, label, summary, sourcePath }
// where `label` is the token without its prefix sigil and `summary` is the
// second table cell with runs of whitespace collapsed to one space. Sorting
// makes the digest independent of authoring order, so a row moved without a
// content change does not churn the digest while any added, removed, or
// reworded entry still fails closed.
//
// The contract adds no dictionary, alias, runtime, or second registry. It reads
// the three existing files and recomputes what they already claim.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalCatalogInput,
  malformedInvocationRuleFor,
} from "agentic-os/invocation";

export { canonicalCatalogInput };

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CATALOG_DIGEST_INPUT =
  "sha256:canonical-json:sorted(kind,token):token,kind,label,summary,sourcePath";
export const CATALOG_DIGEST_OWNER = "DICTIONARY-COMMAND.md";

export const DICTIONARY_DESCRIPTORS = Object.freeze([
  Object.freeze({
    kind: "command",
    prefix: "/",
    docsPath: "DICTIONARY-COMMAND.md",
    tableHeading: "Commands",
    sourcePath: "agentic-canvas-os/docs/DICTIONARY-COMMAND.md",
  }),
  Object.freeze({
    kind: "semantic",
    prefix: "#",
    docsPath: "DICTIONARY-SEMANTIC.md",
    tableHeading: "Tags",
    sourcePath: "agentic-canvas-os/docs/DICTIONARY-SEMANTIC.md",
  }),
  Object.freeze({
    kind: "binding",
    prefix: "@",
    docsPath: "DICTIONARY-BINDING.md",
    tableHeading: "Bindings",
    sourcePath: "agentic-canvas-os/docs/DICTIONARY-BINDING.md",
  }),
]);

export function labelFromToken(token) {
  return token.slice(1);
}

export function computeCatalogDigest(entries) {
  return createHash("sha256").update(canonicalCatalogInput(entries), "utf8").digest("hex");
}

export function collectCatalogEntries(documents) {
  const failures = [];
  const entries = [];

  for (const descriptor of DICTIONARY_DESCRIPTORS) {
    const text = documents.get(descriptor.docsPath);
    if (typeof text !== "string") {
      failures.push(`${descriptor.docsPath}: dictionary is absent from the docs artifact set`);
      continue;
    }
    const frontmatter = readFrontmatterLines(descriptor.docsPath, text, failures);
    if (!frontmatter) continue;

    const declaredPrefix = singleScalar(frontmatter, "prefix");
    if (declaredPrefix !== descriptor.prefix) {
      failures.push(
        `${descriptor.docsPath}: prefix must be exactly ${JSON.stringify(descriptor.prefix)}`,
      );
    }
    if (!singleScalar(frontmatter, "prefix_role")) {
      failures.push(`${descriptor.docsPath}: prefix_role must be declared exactly once`);
    }

    const listed = listedTokens(descriptor.docsPath, frontmatter, failures);
    const rows = tableEntries(descriptor, text, failures);
    entries.push(...reconcile(descriptor, listed, rows, failures));
  }

  return { entries, failures };
}

export function validateDictionaryCatalogContract(documents) {
  const { entries, failures } = collectCatalogEntries(documents);
  if (failures.length > 0) return failures;

  const ownerText = documents.get(CATALOG_DIGEST_OWNER);
  const ownerFrontmatter = readFrontmatterLines(CATALOG_DIGEST_OWNER, ownerText, failures);
  if (!ownerFrontmatter) return failures;

  for (const descriptor of DICTIONARY_DESCRIPTORS) {
    if (descriptor.docsPath === CATALOG_DIGEST_OWNER) continue;
    const frontmatter = readFrontmatterLines(descriptor.docsPath, documents.get(descriptor.docsPath), failures);
    if (!frontmatter) continue;
    for (const key of ["catalog_digest", "catalog_entry_count", "catalog_digest_input"]) {
      if (singleScalar(frontmatter, key) !== null) {
        failures.push(
          `${descriptor.docsPath}: ${key} must be declared only in ${CATALOG_DIGEST_OWNER}`,
        );
      }
    }
  }

  const declaredInput = singleScalar(ownerFrontmatter, "catalog_digest_input");
  if (declaredInput !== CATALOG_DIGEST_INPUT) {
    failures.push(
      `${CATALOG_DIGEST_OWNER}: catalog_digest_input must be `
      + `${JSON.stringify(CATALOG_DIGEST_INPUT)}; found ${JSON.stringify(declaredInput)}`,
    );
  }

  const declaredCount = singleScalar(ownerFrontmatter, "catalog_entry_count");
  if (String(entries.length) !== declaredCount) {
    failures.push(
      `${CATALOG_DIGEST_OWNER}: catalog_entry_count declares ${declaredCount} `
      + `but the three dictionaries hold ${entries.length} entries`,
    );
  }

  const declaredDigest = singleScalar(ownerFrontmatter, "catalog_digest");
  const computedDigest = computeCatalogDigest(entries);
  if (declaredDigest !== computedDigest) {
    failures.push(
      `${CATALOG_DIGEST_OWNER}: catalog_digest declares ${declaredDigest} `
      + `but the recomputed ${CATALOG_DIGEST_INPUT} digest is ${computedDigest}`,
    );
  }

  return failures;
}

function reconcile(descriptor, listed, rows, failures) {
  const rowsByToken = new Map();
  for (const row of rows) {
    if (rowsByToken.has(row.token)) {
      failures.push(`${descriptor.docsPath}: token ${row.token} has more than one table row`);
      continue;
    }
    rowsByToken.set(row.token, row);
  }

  const seen = new Set();
  const entries = [];
  for (const token of listed) {
    if (seen.has(token)) {
      failures.push(`${descriptor.docsPath}: token ${token} is listed more than once`);
      continue;
    }
    seen.add(token);

    if (!token.startsWith(descriptor.prefix)) {
      failures.push(
        `${descriptor.docsPath}: token ${token} does not carry the ${descriptor.prefix} prefix`,
      );
      continue;
    }
    const violatedRule = malformedInvocationRuleFor(token);
    if (violatedRule) {
      failures.push(
        `${descriptor.docsPath}: token ${token} cannot resolve through the shared `
        + `invocation grammar (${violatedRule})`,
      );
      continue;
    }
    const row = rowsByToken.get(token);
    if (!row) {
      failures.push(`${descriptor.docsPath}: token ${token} is listed but has no table row`);
      continue;
    }
    if (!row.summary) {
      failures.push(`${descriptor.docsPath}: token ${token} has an empty summary cell`);
      continue;
    }
    entries.push(Object.freeze({
      token,
      kind: descriptor.kind,
      label: labelFromToken(token),
      summary: row.summary,
      sourcePath: descriptor.sourcePath,
    }));
  }

  for (const token of rowsByToken.keys()) {
    if (!seen.has(token)) {
      failures.push(`${descriptor.docsPath}: token ${token} has a table row but is not listed`);
    }
  }
  return entries;
}

function listedTokens(docsPath, frontmatter, failures) {
  const starts = frontmatter
    .map((line, index) => /^dictionary_entries:\s*$/.test(line) ? index : -1)
    .filter((index) => index >= 0);
  if (starts.length !== 1) {
    failures.push(`${docsPath}: dictionary_entries must be declared exactly once`);
    return [];
  }
  const tokens = [];
  for (const line of frontmatter.slice(starts[0] + 1)) {
    if (/^[A-Za-z0-9_-]+:/.test(line)) break;
    const match = line.match(/^\s{2}-\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/);
    const token = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
    if (token) tokens.push(token);
  }
  if (tokens.length === 0) failures.push(`${docsPath}: dictionary_entries is empty`);
  return tokens;
}

function tableEntries(descriptor, text, failures) {
  const lines = text.split(/\r?\n/);
  const headingIndexes = lines
    .map((line, index) => line.trim() === `## ${descriptor.tableHeading}` ? index : -1)
    .filter((index) => index >= 0);
  if (headingIndexes.length !== 1) {
    failures.push(
      `${descriptor.docsPath}: heading "## ${descriptor.tableHeading}" must appear exactly once`,
    );
    return [];
  }
  const headingIndex = headingIndexes[0];
  const offset = lines.slice(headingIndex + 1).findIndex((line) => /^##\s+/.test(line));
  const sectionEnd = offset < 0 ? lines.length : headingIndex + 1 + offset;

  const rows = [];
  for (const line of lines.slice(headingIndex + 1, sectionEnd)) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (!match) continue;
    const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");
    rows.push({
      token: match[1],
      summary: (cells[1] ?? "").replace(/\s+/g, " ").trim(),
      index: rows.length,
    });
  }
  return rows;
}

function readFrontmatterLines(docsPath, text, failures) {
  if (typeof text !== "string") {
    failures.push(`${docsPath}: dictionary is absent from the docs artifact set`);
    return null;
  }
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    failures.push(`${docsPath}: frontmatter is missing`);
    return null;
  }
  const end = lines.indexOf("---", 1);
  if (end < 0) {
    failures.push(`${docsPath}: frontmatter is unterminated`);
    return null;
  }
  return lines.slice(1, end);
}

function singleScalar(frontmatterLines, key) {
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.+)$`);
  const matches = frontmatterLines
    .map((line) => line.match(pattern))
    .filter((match) => match !== null);
  if (matches.length !== 1) return null;
  const raw = matches[0][1].trim();
  const quoted = raw.match(/^(?:"([^"]*)"|'([^']*)')$/);
  const value = (quoted?.[1] ?? quoted?.[2] ?? raw).trim();
  return value || null;
}

async function runCli() {
  const documents = new Map();
  for (const descriptor of DICTIONARY_DESCRIPTORS) {
    documents.set(
      descriptor.docsPath,
      await readFile(path.join(REPOSITORY_ROOT, "docs", descriptor.docsPath), "utf8"),
    );
  }
  const failures = validateDictionaryCatalogContract(documents);
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  const { entries } = collectCatalogEntries(documents);
  const perKind = DICTIONARY_DESCRIPTORS
    .map(({ kind, prefix }) => `${prefix} ${entries.filter((entry) => entry.kind === kind).length}`)
    .join(", ");
  console.log(
    `dictionary catalog ok: ${entries.length} entries (${perKind}); `
    + `digest ${computeCatalogDigest(entries)} recomputed from ${CATALOG_DIGEST_INPUT}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
