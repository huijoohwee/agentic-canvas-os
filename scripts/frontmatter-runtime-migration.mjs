#!/usr/bin/env node
// Responsibility: Propose one reviewable, per-file-auditable frontmatter
// migration plan, and apply only what a reviewer can verify line by line.
//
// Rules owned by huijoohwee.github.io/guidelines/
//   agentic-sdlc-yaml-frontmatter-runtime-guidelines.md
// Conformance measured by scripts/frontmatter-runtime-contract.mjs.
//
// Safety properties, in the order they matter:
//
//   1. Derive, never invent. Every proposed value cites the exact rule that
//      produced it and the source it read. A file no rule covers is reported
//      `needs-decision` and is never written.
//   2. Additive only. The pass inserts absent keys. It never edits, reorders,
//      or removes an existing key or value, so reverting is deleting the
//      inserted lines.
//   3. Budget-aware. Inserting frontmatter lines grows the file. Five docs sit
//      at the 599-line ceiling `docs-contract.mjs` enforces, so any file whose
//      post-insert line count would breach its budget is refused, not
//      truncated and not silently skipped.
//   4. Plan first. Default output is a plan and a digest. Writing requires
//      --apply, and applying a plan whose digest no longer matches is refused.
//   5. Idempotent. A second run proposes nothing.
//
// Deliberately NOT derived: `owner` and `runtime_proof`. `runtime_owner` holds
// implementation paths, and the contract requires `owner` to name a role and
// forbids machine paths in any key, so a path cannot become an owner. A proof
// pointer that does not exist cannot be synthesised. Both are reported for a
// human decision instead of guessed.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateArtifact, parseFrontmatter } from "./frontmatter-runtime-contract.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_ROOT = path.join(REPOSITORY_ROOT, "docs");

export const LINE_BUDGET = 599;
export const BYTE_BUDGET = 500_000;
// The always-on harness header declares its own tighter budget.
export const DECLARED_BYTE_BUDGETS = Object.freeze({ "SYSTEM-PROMPT-RUNTIME.md": 1_000 });

// Every rule is auditable in isolation: it states what it reads, what it
// writes, and why that value is true rather than convenient.
export const DERIVATION_RULES = Object.freeze([
  Object.freeze({
    id: "delivered-rung-undocumented",
    key: "delivered_rung",
    reads: "repository delivery evidence",
    because: "no delivery or deployment receipt exists in this repository, so the "
      + "delivered rung is undocumented regardless of the local rung",
    derive: () => "undocumented",
  }),
  Object.freeze({
    id: "evaluator-from-named-test",
    key: "evaluator",
    reads: "runtime_proof",
    because: "runtime_proof names an exactly-invocable test, which is the "
      + "mechanism that judges this artifact independently of its author",
    derive: (frontmatter) => {
      const proof = frontmatter.get("runtime_proof") || frontmatter.get("proof") || "";
      const test = proof.split(/[;,]/).map((part) => part.trim())
        .find((part) => /(^|\/)__tests__\/[A-Za-z0-9._-]+\.test\.mjs$/.test(part.replace(/^\.\.\//, "")));
      return test ? `node --test ${test.replace(/^\.\.\//, "")}` : null;
    },
  }),
  Object.freeze({
    id: "evaluator-docs-contract",
    key: "evaluator",
    reads: "docs corpus membership",
    because: "every artifact under docs/ is judged by the deterministic docs "
      + "contract, which is distinct from whoever authored the artifact",
    derive: () => "npm run docs:check",
  }),
]);

// `owner` must name a role. That is a policy decision, not a fact readable from
// any existing key, so this pass never guesses one. It does make the decision
// cheap: one entry per doc_type converts every artifact of that type at once,
// which turns ~150 per-file decisions into ~10 reviewable lines. The map ships
// empty on purpose; an absent entry keeps its artifacts `needs-decision`.
export const OWNER_MAP_PATH = path.join(REPOSITORY_ROOT, "scripts", "frontmatter-owner-map.json");

export function ownerFor(ownerMap, frontmatter) {
  const docType = frontmatter.get("doc_type") || "";
  const value = ownerMap?.[docType];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function proposeForArtifact({ relativePath, text }, ownerMap = {}) {
  const evaluation = evaluateArtifact({ relativePath, text });
  if (evaluation.conformant) {
    return { relativePath, disposition: "conformant", insertions: [], blockers: [] };
  }
  const frontmatter = parseFrontmatter(text);
  if (!frontmatter) {
    return {
      relativePath,
      disposition: "needs-decision",
      insertions: [],
      blockers: [{ key: "frontmatter", reason: "absent or unterminated; no rule may author one" }],
    };
  }

  const absent = new Set(
    evaluation.findings.map((finding) => (
      finding.type === "rung-conflated" && finding.detail.includes("delivered_rung")
        ? "delivered_rung"
        : finding.type === "unnamed-evaluator" ? "evaluator"
          : finding.type === "runtime-readiness-unproven" ? "runtime_proof"
            : finding.detail
    )),
  );

  const insertions = [];
  const blockers = [];
  for (const key of [...absent].sort()) {
    if (frontmatter.get(key)) continue;
    if (key === "owner") {
      const owner = ownerFor(ownerMap, frontmatter);
      if (!owner) {
        blockers.push({ key, reason: noRuleReason(key, frontmatter.get("doc_type")) });
        continue;
      }
      insertions.push(Object.freeze({
        key: "owner",
        value: owner,
        ruleId: "owner-from-declared-doc-type-map",
        reads: `doc_type "${frontmatter.get("doc_type")}" in ${path.basename(OWNER_MAP_PATH)}`,
        because: "the operator declared the accountable role for this artifact class",
      }));
      continue;
    }
    const rule = DERIVATION_RULES.find((candidate) => (
      candidate.key === key && candidate.derive(frontmatter) !== null
    ));
    if (!rule) {
      blockers.push({ key, reason: noRuleReason(key) });
      continue;
    }
    insertions.push(Object.freeze({
      key,
      value: rule.derive(frontmatter),
      ruleId: rule.id,
      reads: rule.reads,
      because: rule.because,
    }));
  }

  const projected = projectBudgets({ relativePath, text, insertions });
  if (projected.blocker) blockers.push(projected.blocker);

  return {
    relativePath,
    disposition: blockers.length > 0
      ? (insertions.length > 0 && !projected.blocker ? "partial" : "needs-decision")
      : "ready",
    insertions: Object.freeze(projected.blocker ? [] : insertions),
    blockers: Object.freeze(blockers),
  };
}

function noRuleReason(key, docType) {
  if (key === "owner") {
    return "not derivable: runtime_owner holds implementation paths and the contract requires "
      + `a role; declare doc_type ${JSON.stringify(docType || "")} in `
      + `${path.basename(OWNER_MAP_PATH)} to cover every artifact of this class at once`;
  }
  if (key === "runtime_proof") {
    return "not derivable: no proof pointer exists and one cannot be synthesised; "
      + "a human must record the evidence or lower the declared rung";
  }
  return `not derivable: no declared rule produces ${key}`;
}

function projectBudgets({ relativePath, text, insertions }) {
  if (insertions.length === 0) return { blocker: null };
  const rendered = insertions.map((insertion) => `${insertion.key}: ${insertion.value}`).join("\n");
  const lines = countLines(text) + insertions.length;
  const bytes = Buffer.byteLength(text, "utf8") + Buffer.byteLength(`${rendered}\n`, "utf8");
  const byteBudget = DECLARED_BYTE_BUDGETS[relativePath] ?? BYTE_BUDGET;
  if (lines > LINE_BUDGET) {
    return { blocker: { key: "*", reason:
      `inserting ${insertions.length} lines reaches ${lines} lines against the `
      + `${LINE_BUDGET} budget; split the file by responsibility first` } };
  }
  if (bytes >= byteBudget) {
    return { blocker: { key: "*", reason:
      `inserting ${insertions.length} keys reaches ${bytes} bytes against the `
      + `${byteBudget} byte budget; reclaim bytes first` } };
  }
  return { blocker: null };
}

export function applyInsertions(text, insertions) {
  if (insertions.length === 0) return text;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("cannot insert into an unterminated frontmatter block");
  const rendered = insertions.map((insertion) => `${insertion.key}: ${insertion.value}`).join("\n");
  return `${text.slice(0, end)}\n${rendered}${text.slice(end)}`;
}

export function buildPlan(artifacts, ownerMap = {}) {
  const files = artifacts
    .map((artifact) => proposeForArtifact(artifact, ownerMap))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const counted = (disposition) => files.filter((file) => file.disposition === disposition).length;

  // Leverage: how many artifacts one undeclared doc_type entry would unlock.
  const pendingOwner = new Map();
  for (const artifact of artifacts) {
    const frontmatter = parseFrontmatter(artifact.text);
    if (!frontmatter) continue;
    const file = files.find((candidate) => candidate.relativePath === artifact.relativePath);
    if (!file?.blockers.some((blocker) => blocker.key === "owner")) continue;
    const docType = frontmatter.get("doc_type") || "(absent)";
    pendingOwner.set(docType, (pendingOwner.get(docType) ?? 0) + 1);
  }

  const core = {
    schema: "acos-frontmatter-migration-plan/v1",
    total: files.length,
    conformant: counted("conformant"),
    ready: counted("ready"),
    partial: counted("partial"),
    needsDecision: counted("needs-decision"),
    insertions: files.reduce((sum, file) => sum + file.insertions.length, 0),
    ownerDecisionsPending: [...pendingOwner.entries()]
      .map(([docType, artifacts_]) => ({ docType, artifacts: artifacts_ }))
      .sort((left, right) => right.artifacts - left.artifacts
        || left.docType.localeCompare(right.docType)),
    files: files.filter((file) => file.disposition !== "conformant"),
    mutation: false,
  };
  return Object.freeze({ ...core, planDigest: digest(core) });
}

export async function readOwnerMap() {
  try {
    return JSON.parse(await readFile(OWNER_MAP_PATH, "utf8")).ownerByDocType ?? {};
  } catch {
    return {};
  }
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function countLines(text) {
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

async function collect() {
  const artifacts = [];
  for (const entry of (await readdir(DOCS_ROOT, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    artifacts.push({
      relativePath: entry.name,
      text: await readFile(path.join(DOCS_ROOT, entry.name), "utf8"),
    });
  }
  return artifacts;
}

function renderReview(plan) {
  const lines = [
    `# Frontmatter migration plan`,
    ``,
    `Plan digest: \`${plan.planDigest}\``,
    ``,
    `| Disposition | Files |`,
    `|---|---:|`,
    `| conformant (no change) | ${plan.conformant} |`,
    `| ready (fully derivable) | ${plan.ready} |`,
    `| partial (some keys need a decision) | ${plan.partial} |`,
    `| needs-decision (nothing applied) | ${plan.needsDecision} |`,
    `| total proposed insertions | ${plan.insertions} |`,
    ``,
    `## Owner decisions`,
    ``,
    `\`owner\` names a role and is not readable from any existing key, so it is never`,
    `guessed. Declare one entry per \`doc_type\` in \`scripts/frontmatter-owner-map.json\``,
    `to cover every artifact of that class at once.`,
    ``,
    `| doc_type | artifacts unlocked |`,
    `|---|---:|`,
    ...plan.ownerDecisionsPending.map((p) => `| ${p.docType} | ${p.artifacts} |`),
    ``,
    `Every insertion below cites the rule that produced it and the source it read.`,
    `Nothing outside an insertion line is modified.`,
    ``,
  ];
  for (const file of plan.files) {
    lines.push(`## ${file.relativePath} — ${file.disposition}`);
    for (const insertion of file.insertions) {
      lines.push(`- \`+ ${insertion.key}: ${insertion.value}\``);
      lines.push(`  - rule \`${insertion.ruleId}\`, reads ${insertion.reads}`);
      lines.push(`  - ${insertion.because}`);
    }
    for (const blocker of file.blockers) {
      lines.push(`- **decision required** on \`${blocker.key}\`: ${blocker.reason}`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}

async function runCli() {
  const artifacts = await collect();
  const ownerMap = await readOwnerMap();
  const plan = buildPlan(artifacts, ownerMap);
  const apply = process.argv.includes("--apply");
  const expected = process.argv.find((argument) => argument.startsWith("--expect-digest="))
    ?.slice("--expect-digest=".length);

  if (process.argv.includes("--review")) {
    const target = path.join(REPOSITORY_ROOT, "frontmatter-migration-plan.md");
    await writeFile(target, `${renderReview(plan)}\n`, "utf8");
    console.log(`review written: frontmatter-migration-plan.md (digest ${plan.planDigest})`);
    return;
  }
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  console.log(
    `plan ${plan.planDigest.slice(0, 12)}: ${plan.total} artifacts; `
    + `${plan.conformant} conformant, ${plan.ready} ready, ${plan.partial} partial, `
    + `${plan.needsDecision} need a decision; ${plan.insertions} insertions proposed`,
  );

  if (plan.ownerDecisionsPending.length > 0) {
    const top = plan.ownerDecisionsPending.slice(0, 6);
    const covered = top.reduce((sum, pending) => sum + pending.artifacts, 0);
    console.log(
      `\nowner is undeclared for ${plan.ownerDecisionsPending.length} doc_type values. `
      + `The top ${top.length} cover ${covered} artifacts:`,
    );
    for (const pending of top) {
      console.log(`  ${String(pending.artifacts).padStart(3)}  ${pending.docType}`);
    }
    console.log(`Declare these in scripts/${path.basename(OWNER_MAP_PATH)} to convert them.`);
  }

  if (!apply) {
    console.log("\ndry run. Use --review for the auditable per-file plan, then --apply.");
    return;
  }
  if (expected && expected !== plan.planDigest) {
    console.error(`plan digest changed: expected ${expected}, computed ${plan.planDigest}`);
    process.exitCode = 1;
    return;
  }
  let written = 0;
  for (const file of plan.files) {
    if (file.insertions.length === 0) continue;
    const absolute = path.join(DOCS_ROOT, file.relativePath);
    const next = applyInsertions(await readFile(absolute, "utf8"), file.insertions);
    await writeFile(absolute, next, "utf8");
    written += 1;
  }
  console.log(`applied ${plan.insertions} insertions across ${written} files`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
