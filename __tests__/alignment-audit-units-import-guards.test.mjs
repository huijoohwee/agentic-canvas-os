import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const CORE_ROOT = path.resolve("scripts/alignment-audit");
const WRITE_EXPORTS = new Set([
  "appendFile",
  "chmod",
  "chown",
  "copyFile",
  "cp",
  "link",
  "lchmod",
  "lchown",
  "lutimes",
  "mkdir",
  "mkdtemp",
  "open",
  "rename",
  "rm",
  "rmdir",
  "symlink",
  "truncate",
  "unlink",
  "utimes",
  "writeFile",
]);
const NETWORK_MODULE = /from\s+["']node:(?:child_process|http|https|net)["']/u;

test("core keeps writes behind output-boundary and has no process or network surface", async () => {
  const violations = [];
  for (const file of await moduleFiles(CORE_ROOT)) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(CORE_ROOT, file);
    if (NETWORK_MODULE.test(source)) violations.push(`${relative}: imports a prohibited process or network module`);
    if (/\bfetch\b/u.test(source)) violations.push(`${relative}: references fetch`);
    if (relative !== "output-boundary.mjs") {
      const imported = importedFileSystemNames(source);
      for (const name of imported) {
        if (WRITE_EXPORTS.has(name)) violations.push(`${relative}: imports filesystem writer ${name}`);
      }
      if (/import\s+\*\s+as\s+\w+\s+from\s+["']node:fs(?:\/promises)?["']/u.test(source)) {
        violations.push(`${relative}: namespace filesystem import can reach write APIs`);
      }
      if (/import\s+\w+\s+from\s+["']node:fs(?:\/promises)?["']/u.test(source)) {
        violations.push(`${relative}: default filesystem import can reach write APIs`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

function importedFileSystemNames(source) {
  const names = new Set();
  const pattern = /import\s*\{([^}]+)\}\s*from\s*["']node:fs(?:\/promises)?["']/gu;
  for (const match of source.matchAll(pattern)) {
    for (const item of match[1].split(",")) names.add(item.trim().split(/\s+as\s+/u)[0]);
  }
  return names;
}

async function moduleFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? moduleFiles(target) : entry.name.endsWith(".mjs") ? [target] : [];
    }),
  );
  return nested.flat().sort((left, right) => left.localeCompare(right, "en"));
}
