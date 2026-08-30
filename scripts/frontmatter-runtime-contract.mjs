#!/usr/bin/env node
// Responsibility: Derive each artifact's triggered frontmatter tiers from its own
// declared claims and report typed findings without mutating anything.
//
// Owner of the rules: huijoohwee.github.io/guidelines/
//   agentic-sdlc-yaml-frontmatter-runtime-guidelines.md
// Owner of the key vocabulary: docs/schemas/frontmatter-runtime-dictionary.v1.json
//
// This file defines no rule and no key of its own. Every tier membership, every
// substitute spelling, and every forbidden value pattern below is read from that
// dictionary at load time, because a vocabulary restated in code is a second
// source that drifts from the prose silently. It gates only the keys the
// dictionary marks `required`; a `recommended` key is documented, not enforced,
// so no table can promise a check that does not run.
//
// A survey of 295 authored artifacts across two corpora found only five shared
// keys: one corpus recorded evidence and no accountability, the other recorded
// accountability and no evidence. The dictionary encodes that unification.
//
// Migration is a ratchet, never a sweep. A 295-artifact rewrite is an
// unreviewable change, so the baseline records existing debt and this contract
// forbids regression: a new or touched artifact must satisfy its triggered
// tiers, and an artifact already conformant must not become less so.
//
// Deterministic: no clock, no randomness, no network, no model call, no write.

import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FINDING_KEY_ABSENT = "frontmatter-key-absent";
export const FINDING_RUNG_CONFLATED = "rung-conflated";
export const FINDING_UNPROVEN = "runtime-readiness-unproven";
export const FINDING_UNNAMED_EVALUATOR = "unnamed-evaluator";

export const DICTIONARY_PATH = fileURLToPath(
  new URL("../docs/schemas/frontmatter-runtime-dictionary.v1.json", import.meta.url),
);
export const DICTIONARY_SCHEMA = "agentic-frontmatter-runtime-dictionary/v1";

// Fail closed: an unreadable, unpinned, or structurally invalid dictionary must
// stop the check outright. Falling back to a built-in vocabulary would silently
// restore the drift this extraction removed.
export function loadDictionary(dictionaryPath = DICTIONARY_PATH) {
  let dictionary;
  try {
    dictionary = JSON.parse(readFileSync(dictionaryPath, "utf8"));
  } catch (error) {
    throw new Error(`frontmatter dictionary is unreadable: ${error.message}`);
  }
  if (dictionary.schema !== DICTIONARY_SCHEMA) {
    throw new Error(
      `frontmatter dictionary declares schema ${dictionary.schema}; expected ${DICTIONARY_SCHEMA}`,
    );
  }
  if (!Array.isArray(dictionary.keys) || dictionary.keys.length === 0) {
    throw new Error("frontmatter dictionary declares no keys");
  }
  for (const entry of dictionary.keys) {
    if (!entry.key || !entry.tier || !entry.enforcement) {
      throw new Error(`frontmatter dictionary entry is incomplete: ${JSON.stringify(entry)}`);
    }
    if (!dictionary.tiers.some((tier) => tier.id === entry.tier)) {
      throw new Error(`frontmatter dictionary key ${entry.key} names unknown tier ${entry.tier}`);
    }
    if (!["required", "recommended"].includes(entry.enforcement)) {
      throw new Error(`frontmatter dictionary key ${entry.key} declares unknown enforcement`);
    }
  }
  return Object.freeze(dictionary);
}

export const DICTIONARY = loadDictionary();

// Enforced tiers are the `required` slice. `recommended` keys stay visible in
// the dictionary and the projection without gating anything.
export function tierKeys(tierId, { enforcement = "required", dictionary = DICTIONARY } = {}) {
  return Object.freeze(dictionary.keys
    .filter((entry) => entry.tier === tierId
      && (enforcement === "any" || entry.enforcement === enforcement))
    .map((entry) => entry.key));
}

function substitutesFor(key, dictionary = DICTIONARY) {
  const entry = dictionary.keys.find((candidate) => candidate.key === key);
  return Object.freeze([key, ...(entry?.substitutes ?? [])]);
}

export const TIER_IDENTITY = tierKeys("identity");
export const TIER_ADDRESS = tierKeys("address");
export const TIER_ACCOUNTABILITY = tierKeys("accountability");
export const TIER_EVIDENCE = tierKeys("evidence");

// A rung above these two is a readiness claim and triggers Tier 4.
export const UNPROVEN_RUNGS = Object.freeze([...DICTIONARY.unprovenRungs]);
// `proof` is the permitted short form only under a declared byte budget.
export const PROOF_KEYS = substitutesFor("runtime_proof");
export const LOCAL_RUNG_KEYS = Object.freeze([...DICTIONARY.localRungKeys]);
export const ADDRESS_TRIGGER_KEYS = Object.freeze([...DICTIONARY.addressTriggerKeys]);

const DATE_PATTERN = new RegExp(DICTIONARY.valueForms.date.pattern);
const FORBIDDEN_VALUE_PATTERNS = Object.freeze(
  DICTIONARY.forbiddenValuePatterns.map((entry) => ({
    id: entry.id,
    pattern: new RegExp(entry.pattern, entry.flags ?? ""),
  })),
);

export function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return null;
  const entries = new Map();
  for (const line of text.slice(4, end).split("\n")) {
    if (/^[ \t]/.test(line) || !line.trim()) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_.-]*):\s*(.*)$/);
    if (!match) continue;
    const raw = match[2].trim();
    const quoted = raw.match(/^(?:"([^"]*)"|'([^']*)')$/);
    entries.set(match[1], (quoted?.[1] ?? quoted?.[2] ?? raw).trim());
  }
  return entries;
}

// The artifact's own declarations decide which tiers bind it. Nothing is
// inferred from a file name or directory, per the Agnosticity rule.
export function triggeredTiers(frontmatter) {
  const localRung = LOCAL_RUNG_KEYS.map((key) => frontmatter.get(key)).find(Boolean) ?? "";
  const claimsReadiness = Boolean(localRung) && !UNPROVEN_RUNGS.includes(localRung);
  return Object.freeze({
    identity: true,
    address: ADDRESS_TRIGGER_KEYS.some((key) => frontmatter.has(key)) || claimsReadiness,
    accountability: Boolean(localRung),
    evidence: claimsReadiness,
    claimsReadiness,
    localRung,
  });
}

export function evaluateArtifact({ relativePath, text }) {
  const frontmatter = parseFrontmatter(text);
  if (!frontmatter) {
    return { relativePath, conformant: false, findings: [
      { type: FINDING_KEY_ABSENT, detail: "frontmatter is absent or unterminated" },
    ] };
  }

  const tiers = triggeredTiers(frontmatter);
  const findings = [];
  const require = (key) => {
    if (!frontmatter.get(key)) findings.push({ type: FINDING_KEY_ABSENT, detail: key });
  };

  for (const key of TIER_IDENTITY) require(key);
  if (tiers.address) for (const key of TIER_ADDRESS) require(key);

  if (tiers.accountability) {
    if (!frontmatter.get("owner")) findings.push({ type: FINDING_KEY_ABSENT, detail: "owner" });
    // `status` may stand in for `local_rung`, but `delivered_rung` has no
    // substitute: without it a green local lane reads as a delivered claim.
    if (!frontmatter.get("delivered_rung")) {
      findings.push({ type: FINDING_RUNG_CONFLATED, detail: "delivered_rung absent" });
    } else if (LOCAL_RUNG_KEYS.every((key) => frontmatter.get(key))
      && new Set(LOCAL_RUNG_KEYS.map((key) => frontmatter.get(key))).size > 1) {
      findings.push({
        type: FINDING_RUNG_CONFLATED,
        detail: `${LOCAL_RUNG_KEYS.join(" and ")} disagree`,
      });
    }
  }

  if (tiers.evidence) {
    if (!PROOF_KEYS.some((key) => frontmatter.get(key))) {
      findings.push({ type: FINDING_UNPROVEN, detail: `${tiers.localRung} claims no runtime_proof` });
    }
    if (!frontmatter.get("evaluator")) {
      findings.push({ type: FINDING_UNNAMED_EVALUATOR, detail: tiers.localRung });
    }
  }

  const date = frontmatter.get("date");
  if (date && !DATE_PATTERN.test(date)) {
    findings.push({ type: FINDING_KEY_ABSENT, detail: `date is not YYYY-MM-DD: ${date}` });
  }
  for (const [key, value] of frontmatter) {
    for (const { id, pattern } of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        findings.push({
          type: FINDING_KEY_ABSENT,
          detail: `${key} carries a forbidden value (${id})`,
        });
      }
    }
  }

  return { relativePath, conformant: findings.length === 0, findings, tiers };
}

export function evaluateCorpus(artifacts) {
  const results = artifacts
    .map((artifact) => evaluateArtifact(artifact))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const conformant = results.filter((result) => result.conformant);
  return Object.freeze({
    total: results.length,
    conformant: conformant.length,
    nonConformant: results.length - conformant.length,
    // Permille keeps the ratio exact under integer arithmetic.
    conformancePermille: results.length === 0
      ? 1_000
      : Math.floor((1_000 * conformant.length) / results.length),
    results: Object.freeze(results),
    mutation: false,
  });
}

export function evaluateRatchet({ report, baseline }) {
  const failures = [];
  const nonConformant = new Set(
    report.results.filter((result) => !result.conformant).map((result) => result.relativePath),
  );
  for (const relativePath of nonConformant) {
    if (!baseline.includes(relativePath)) {
      failures.push(
        `${relativePath}: frontmatter is non-conformant and is not recorded debt; `
        + "satisfy its triggered tiers instead of extending the baseline",
      );
    }
  }
  for (const relativePath of baseline) {
    if (!nonConformant.has(relativePath)) {
      failures.push(
        `${relativePath}: now conformant or absent; remove its baseline entry with --write`,
      );
    }
  }
  return failures.sort((left, right) => left.localeCompare(right));
}

export async function collectMarkdown(root) {
  const artifacts = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  )) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    artifacts.push({
      relativePath: entry.name,
      text: await readFile(path.join(root, entry.name), "utf8"),
    });
  }
  return artifacts;
}

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(REPOSITORY_ROOT, "scripts", "frontmatter-runtime.baseline.json");

export async function runFrontmatterContract({ docsRoot = path.join(REPOSITORY_ROOT, "docs") } = {}) {
  const report = evaluateCorpus(await collectMarkdown(docsRoot));
  let baseline = [];
  try {
    baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8")).nonConformant ?? [];
  } catch { baseline = []; }
  return { report, failures: evaluateRatchet({ report, baseline }) };
}

async function runCli() {
  const { writeFile } = await import("node:fs/promises");
  const { report, failures } = await runFrontmatterContract();
  if (process.argv.includes("--write")) {
    const nonConformant = report.results
      .filter((result) => !result.conformant)
      .map((result) => result.relativePath);
    await writeFile(BASELINE_PATH, `${JSON.stringify({
      note: "Recorded frontmatter debt, not permission. Entries may only leave.",
      conformancePermille: report.conformancePermille,
      nonConformant,
    }, null, 2)}\n`, "utf8");
    console.log(`frontmatter baseline written: ${nonConformant.length} non-conformant of ${report.total}`);
    return;
  }
  if (process.argv.includes("--report")) {
    for (const result of report.results.filter((item) => !item.conformant)) {
      console.log(`${result.relativePath}: ${result.findings.map((f) => `${f.type}(${f.detail})`).join(", ")}`);
    }
  }
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(
    `frontmatter runtime contract ok: ${report.conformant}/${report.total} conformant `
    + `(${report.conformancePermille / 10}%); ${report.nonConformant} held at recorded debt`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
