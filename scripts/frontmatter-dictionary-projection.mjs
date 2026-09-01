#!/usr/bin/env node
// Responsibility: Project the frontmatter key dictionary into a human-browsable
// reference as generated, digest-fenced tables no hand edit can silently diverge
// from.
//
// The dictionary (docs/schemas/frontmatter-runtime-dictionary.v1.json) is the
// single source for the key vocabulary. Before this projector existed the same
// vocabulary was stated three times: as frozen arrays in the validator, as a
// tier table in the guidelines module, and as a key contract table beside it.
// The three had already diverged, and no check could see it, because prose is
// not a checkable surface.
//
// This projector removes the third statement's authority without removing its
// readability: the tables below are generated, fenced, digest-stamped, and
// verified by docs:check, so a reader gets prose and the checker gets data.
//
// Deliberately NOT projected: the reason a key exists. That is a rule, the
// guidelines module owns it, and restating it here would recreate the drift this
// file exists to end.
//
// Deterministic: no clock, no randomness, no network, no model call.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DICTIONARY, loadDictionary } from "./frontmatter-runtime-contract.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DICTIONARY_DOCS_PATH = "DICTIONARY-FRONTMATTER.md";
export const BEGIN_MARKER = "<!-- frontmatter-dictionary:begin";
export const END_MARKER = "<!-- frontmatter-dictionary:end -->";

export const TIER_COLUMNS = Object.freeze(["tier", "id", "keys", "trigger", "derived"]);
export const KEY_COLUMNS = Object.freeze(["key", "tier", "enforcement", "substitutes", "contract"]);

const ABSENT_FIELD = "none";

function renderTable(columns, rows) {
  return [
    `| ${columns.join(" | ")} |`,
    `|${columns.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${columns.map((column) => row[column]).join(" | ")} |`),
  ].join("\n");
}

export function projectTierRows(dictionary = DICTIONARY) {
  return dictionary.tiers.map((tier) => ({
    tier: String(tier.tier),
    id: `\`${tier.id}\``,
    keys: dictionary.keys
      .filter((entry) => entry.tier === tier.id)
      .map((entry) => `\`${entry.key}\``)
      .join(", ") || ABSENT_FIELD,
    trigger: tier.trigger,
    derived: tier.derived ? "yes" : "no",
  }));
}

export function projectKeyRows(dictionary = DICTIONARY) {
  return dictionary.keys.map((entry) => ({
    key: `\`${entry.key}\``,
    tier: `\`${entry.tier}\``,
    enforcement: `\`${entry.enforcement}\``,
    substitutes: (entry.substitutes ?? []).map((key) => `\`${key}\``).join(", ") || ABSENT_FIELD,
    contract: entry.contract,
  }));
}

export function renderProjection(dictionary = DICTIONARY) {
  const tierRows = projectTierRows(dictionary);
  const keyRows = projectKeyRows(dictionary);
  const required = dictionary.keys.filter((entry) => entry.enforcement === "required").length;
  const body = [
    "### Tiers",
    "",
    renderTable(TIER_COLUMNS, tierRows),
    "",
    "### Keys",
    "",
    renderTable(KEY_COLUMNS, keyRows),
    "",
    "### Forbidden Values",
    "",
    renderTable(
      ["id", "reason"],
      dictionary.forbiddenValuePatterns.map((entry) => ({ id: `\`${entry.id}\``, reason: entry.reason })),
    ),
  ].join("\n");
  const digest = createHash("sha256").update(body, "utf8").digest("hex");
  return {
    digest,
    keyCount: dictionary.keys.length,
    requiredCount: required,
    block: [
      `${BEGIN_MARKER} keys=${dictionary.keys.length} required=${required} digest=${digest} -->`,
      body,
      END_MARKER,
    ].join("\n"),
  };
}

export function replaceProjectionBlock(text, block) {
  const begin = text.indexOf(BEGIN_MARKER);
  const end = text.indexOf(END_MARKER);
  if (begin < 0 || end < 0 || end < begin) return null;
  return `${text.slice(0, begin)}${block}${text.slice(end + END_MARKER.length)}`;
}

function referenceScalar(text, key) {
  const end = text.indexOf("\n---\n", 4);
  const frontmatter = end < 0 ? "" : text.slice(4, end);
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return null;
  const raw = match[1].trim();
  const quoted = raw.match(/^(?:"([^"]*)"|'([^']*)')$/);
  return (quoted?.[1] ?? quoted?.[2] ?? raw).trim();
}

export function validateFrontmatterDictionaryProjection(documents, { dictionary } = {}) {
  const text = documents.get(DICTIONARY_DOCS_PATH);
  if (typeof text !== "string") {
    return [`${DICTIONARY_DOCS_PATH}: reference is absent from the docs artifact set`];
  }

  let resolved = dictionary;
  if (!resolved) {
    try {
      resolved = loadDictionary();
    } catch (error) {
      return [`${DICTIONARY_DOCS_PATH}: ${error.message}`];
    }
  }

  const { block, digest, keyCount, requiredCount } = renderProjection(resolved);
  const regenerated = replaceProjectionBlock(text, block);
  if (regenerated === null) {
    return [`${DICTIONARY_DOCS_PATH}: projection fence markers are missing or out of order`];
  }
  if (regenerated !== text) {
    return [
      `${DICTIONARY_DOCS_PATH}: projected tables have drifted from the dictionary; `
      + "regenerate with `npm run frontmatter-dictionary:project` "
      + `(expected ${keyCount} keys at digest ${digest})`,
    ];
  }

  const failures = [];
  const declared = {
    projection_owner: "scripts/frontmatter-dictionary-projection.mjs",
    projection_source: "schemas/frontmatter-runtime-dictionary.v1.json",
    projection_key_count: String(keyCount),
    projection_required_count: String(requiredCount),
    projection_digest: digest,
    dictionary_version: resolved.version,
  };
  for (const [key, value] of Object.entries(declared)) {
    if (referenceScalar(text, key) !== value) {
      failures.push(`${DICTIONARY_DOCS_PATH}: ${key} must be ${JSON.stringify(value)}`);
    }
  }
  return failures;
}

async function runCli() {
  const referencePath = path.join(REPOSITORY_ROOT, "docs", DICTIONARY_DOCS_PATH);
  const text = await readFile(referencePath, "utf8");
  const { block, digest, keyCount, requiredCount } = renderProjection();

  if (!process.argv.includes("--write")) {
    const failures = validateFrontmatterDictionaryProjection(new Map([[DICTIONARY_DOCS_PATH, text]]));
    if (failures.length > 0) {
      console.error(failures.join("\n"));
      process.exitCode = 1;
      return;
    }
    console.log(
      `frontmatter dictionary projection ok: ${keyCount} keys, ${requiredCount} enforced`,
    );
    return;
  }

  const replaced = replaceProjectionBlock(text, block);
  if (replaced === null) {
    console.error(`${DICTIONARY_DOCS_PATH}: projection fence markers are missing or out of order`);
    process.exitCode = 1;
    return;
  }
  const stamped = replaced
    .replace(/^projection_key_count: .*$/m, `projection_key_count: ${keyCount}`)
    .replace(/^projection_required_count: .*$/m, `projection_required_count: ${requiredCount}`)
    .replace(/^projection_digest: .*$/m, `projection_digest: "${digest}"`)
    .replace(/^dictionary_version: .*$/m, `dictionary_version: "${DICTIONARY.version}"`);
  await writeFile(referencePath, stamped, "utf8");
  console.log(`frontmatter dictionary projection written: ${keyCount} keys; digest ${digest}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
