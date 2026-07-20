#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { validateProbeTreeContractDocuments } from "./probe-tree-contract.mjs";
import { validatePromptPresetContractDocuments } from "./prompt-preset-contract.mjs";
import { validateXrInvocationContractDocuments } from "./xr-invocation-contract.mjs";

const DOCS_ROOT = path.resolve("docs");
const REQUIRED_KEYS = [
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

const files = (await readdir(DOCS_ROOT))
  .filter((name) => name.endsWith(".md"))
  .sort();

if (files.length === 0) fail("docs contract found no Markdown files");

const failures = [];
const documents = new Map();
for (const name of files) {
  const file = path.join(DOCS_ROOT, name);
  const text = await readFile(file, "utf8");
  documents.set(name, text);
  const frontmatter = readFrontmatter(text, name);
  if (frontmatter) {
    for (const key of REQUIRED_KEYS) {
      if (!new RegExp(`^${escapeRegExp(key)}:\\s*\\S`, "m").test(frontmatter)) {
        failures.push(`${name}: missing frontmatter key ${key}`);
      }
    }
  }

  const lineCount = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  if (lineCount >= 600) failures.push(`${name}: ${lineCount} lines exceeds the <600 line budget`);

  for (const [index, line] of text.split("\n").entries()) {
    if (/[^\x00-\x7F]/.test(line)) failures.push(`${name}:${index + 1}: non-ASCII content`);
    for (const pattern of ARTIFACT_PATTERNS) {
      if (pattern.test(line)) failures.push(`${name}:${index + 1}: runtime artifact pattern ${pattern}`);
    }
  }
}

failures.push(...validateProbeTreeContractDocuments(documents));
failures.push(...validatePromptPresetContractDocuments(documents));
failures.push(...validateXrInvocationContractDocuments(documents));

if (failures.length > 0) fail(failures.join("\n"));
console.log(`docs contract ok (${files.length} files)`);

function readFrontmatter(text, name) {
  if (!text.startsWith("---\n")) {
    failures.push(`${name}: missing opening frontmatter delimiter`);
    return null;
  }
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) {
    failures.push(`${name}: missing closing frontmatter delimiter`);
    return null;
  }
  return text.slice(4, end);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
