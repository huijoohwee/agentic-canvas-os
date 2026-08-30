#!/usr/bin/env node
// Responsibility: Derive each artifact's triggered frontmatter tiers from its own
// declared claims and report typed findings without mutating anything.
//
// Owner of the rules: huijoohwee.github.io/guidelines/
//   agentic-sdlc-yaml-frontmatter-runtime-guidelines.md
// This file is that module's reference implementation. It defines no rule of its
// own and no finding name the guidelines set does not own.
//
// A survey of 295 authored artifacts across two corpora found only five shared
// keys: one corpus recorded evidence and no accountability, the other recorded
// accountability and no evidence. Tiers below encode that unification.
//
// Migration is a ratchet, never a sweep. A 295-artifact rewrite is an
// unreviewable change, so the baseline records existing debt and this contract
// forbids regression: a new or touched artifact must satisfy its triggered
// tiers, and an artifact already conformant must not become less so.
//
// Deterministic: no clock, no randomness, no network, no model call, no write.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FINDING_KEY_ABSENT = "frontmatter-key-absent";
export const FINDING_RUNG_CONFLATED = "rung-conflated";
export const FINDING_UNPROVEN = "runtime-readiness-unproven";
export const FINDING_UNNAMED_EVALUATOR = "unnamed-evaluator";

export const TIER_IDENTITY = Object.freeze([
  "title", "doc_type", "date", "lang", "frontmatter_contract",
]);
export const TIER_ADDRESS = Object.freeze(["schema"]);
export const TIER_ACCOUNTABILITY = Object.freeze(["owner", "local_rung", "delivered_rung"]);
export const TIER_EVIDENCE = Object.freeze(["runtime_proof", "evaluator"]);

// A rung above these two is a readiness claim and triggers Tier 4.
export const UNPROVEN_RUNGS = Object.freeze(["draft", "undocumented"]);
// `proof` is the permitted short form only under a declared byte budget.
export const PROOF_KEYS = Object.freeze(["runtime_proof", "proof"]);

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const FORBIDDEN_VALUE_PATTERNS = Object.freeze([
  /\/Users\//, /\/home\/[a-z]/, /C:\\/,
  /(?:api[_-]?key|secret|token|password)\s*[:=]/i,
]);

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
  const localRung = frontmatter.get("local_rung") ?? frontmatter.get("status") ?? "";
  const claimsReadiness = Boolean(localRung) && !UNPROVEN_RUNGS.includes(localRung);
  return Object.freeze({
    identity: true,
    address: frontmatter.has("schema") || frontmatter.has("graphId") || claimsReadiness,
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
    } else if (frontmatter.get("local_rung") && frontmatter.get("status")
      && frontmatter.get("local_rung") !== frontmatter.get("status")) {
      findings.push({ type: FINDING_RUNG_CONFLATED, detail: "local_rung and status disagree" });
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
    for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        findings.push({ type: FINDING_KEY_ABSENT, detail: `${key} carries a forbidden value` });
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
