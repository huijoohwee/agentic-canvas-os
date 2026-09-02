#!/usr/bin/env node
// Responsibility: Fail on the first statically resolvable write target outside this repository.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRITE_CALL = /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|mkdirSync|mkdir|renameSync|rename|copyFileSync|copyFile|cpSync|cp|rmSync|rm)\s*\(/gu;

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const offender = firstOffender({ repositoryRoot });
  if (offender) {
    process.stderr.write(`${offender.file}:${offender.line}: write target escapes repository: ${offender.target}\n`);
    process.exitCode = 1;
  }
}

export function firstOffender({ repositoryRoot: root, files = trackedFiles(root), read = readFileSync }) {
  for (const file of [...files].sort()) {
    const source = read(path.join(root, file), "utf8");
    const findings = analyzeSource({ source, file, repositoryRoot: root });
    if (findings.length) return findings[0];
  }
  return null;
}

export function analyzeSource({ source, file, repositoryRoot: root }) {
  const constants = literalConstants(source, root);
  const findings = [];
  for (const match of writeCallArguments(source)) {
    const target = resolveExpression(match.expression, { constants, root });
    if (target && escapes(root, target)) findings.push({
      file, line: source.slice(0, match.index).split("\n").length, target, expression: match.expression.trim(),
    });
  }
  return findings.sort((left, right) => left.line - right.line);
}

export function writeCallArguments(source) {
  const results = [];
  for (const match of source.matchAll(WRITE_CALL)) {
    let quote = null; let escaped = false; let depth = 0; let cursor = match.index + match[0].length;
    const start = cursor;
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (escaped) { escaped = false; continue; }
      if (quote && character === "\\") { escaped = true; continue; }
      if (quote) { if (character === quote) quote = null; continue; }
      if (["\"", "'", "`"].includes(character)) { quote = character; continue; }
      if (character === "(") { depth += 1; continue; }
      if (character === ")" && depth > 0) { depth -= 1; continue; }
      if ((character === "," || character === ")") && depth === 0) break;
    }
    results.push({ index: match.index, expression: source.slice(start, cursor).trim() });
  }
  return results;
}

export function resolveExpression(raw, { constants = new Map(), root }) {
  const expression = String(raw).trim();
  if (constants.has(expression)) return constants.get(expression);
  if (/^os\.homedir\(\)$/u.test(expression)) return homedir();
  const literal = parseLiteral(expression);
  if (literal !== null) return path.resolve(root, literal);
  const call = expression.match(/^path\.(?:join|resolve)\((.*)\)$/su);
  if (!call) return null;
  const parts = splitArguments(call[1]).map(part => constants.get(part.trim()) || parseLiteral(part.trim()));
  if (parts.some(part => part === null || part === undefined)) return null;
  return path.resolve(root, ...parts);
}

function literalConstants(source, root) {
  const constants = new Map();
  for (const match of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)[;\n]/gu)) {
    const value = resolveExpression(match[2], { constants, root });
    if (value) constants.set(match[1], value);
  }
  return constants;
}
function parseLiteral(value) {
  const quoted = value.match(/^(["'])([\s\S]*)\1$/u);
  if (quoted) return quoted[2];
  const template = value.match(/^`([^$`]*)`$/u);
  return template ? template[1] : null;
}
function splitArguments(value) { return value.split(/,(?=(?:[^"'`]*["'`][^"'`]*["'`])*[^"'`]*$)/u).map(item => item.trim()); }
function escapes(root, target) { const relative = path.relative(path.resolve(root), path.resolve(target)); return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative); }
function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "--", "scripts"], { cwd: root, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(file => file && existsSync(path.join(root, file)));
}
