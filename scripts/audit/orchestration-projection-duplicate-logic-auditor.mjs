#!/usr/bin/env node
// Responsibility: Advisory-only duplicate-logic audit over orchestration projection module function bodies.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DUPLICATE_LOGIC_AUDIT_SCHEMA = "agentic-orchestration-projection-duplicate-logic-audit/v1";
export const PROJECTOR_MODULE_PATHS = Object.freeze([
  "scripts/orchestration-projection-contract.mjs",
  "scripts/orchestration-projection-controller.mjs",
  "scripts/orchestration-projection-document.mjs",
  "scripts/orchestration-projection-evidence.mjs",
  "scripts/orchestration-projection-repository-adapter.mjs",
  "scripts/orchestration-projection.mjs",
]);
const MINIMUM_BODY_LENGTH = 80;

if (process.argv[1] && import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href) {
  process.stdout.write(JSON.stringify(runDuplicateLogicAudit()) + "\n");
}

export function runDuplicateLogicAudit({ repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), files } = {}) {
  const scopedFiles = files || PROJECTOR_MODULE_PATHS.map((modulePath) => ({ path: modulePath, text: readFileSync(path.join(repositoryRoot, modulePath), "utf8") }));
  const byBody = new Map();
  for (const file of scopedFiles) for (const body of extractFunctionBodies(file.text)) {
    if (body.normalized.length < MINIMUM_BODY_LENGTH) continue;
    const matches = byBody.get(body.normalized) || [];
    matches.push({ path: file.path, line: body.line });
    byBody.set(body.normalized, matches);
  }
  const findings = [...byBody.values()].filter((matches) => new Set(matches.map((match) => match.path)).size > 1).map((matches) => ({ kind: "identical-function-body", occurrences: matches }));
  return { schema: DUPLICATE_LOGIC_AUDIT_SCHEMA, mode: "advisory", status: "completed", findings, summary: { moduleCount: scopedFiles.length, duplicateGroupCount: findings.length } };
}

function extractFunctionBodies(text) {
  const source = String(text || "");
  const starts = /^(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/gmu;
  const bodies = [];
  for (let match; (match = starts.exec(source));) {
    const open = source.indexOf("{", match.index);
    const close = matchingBrace(source, open);
    if (close < 0) continue;
    bodies.push({ line: source.slice(0, open).split("\n").length, normalized: source.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "").replace(/\s+/gu, " ").trim() });
    starts.lastIndex = close + 1;
  }
  return bodies;
}
function matchingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return index;
  }
  return -1;
}
