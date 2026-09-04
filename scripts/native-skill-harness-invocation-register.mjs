#!/usr/bin/env node
// Invocation Register token declaration count check for the native skill
// creation harness. Each token this feature declares must appear
// in exactly one register file with a declaration count of exactly 1.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTER_FILES = Object.freeze([
  "docs/DICTIONARY-COMMAND.md",
  "docs/DICTIONARY-SEMANTIC.md",
  "docs/DICTIONARY-BINDING.md",
  "docs/MCP-GATEWAY.md",
]);
const TOKENS = Object.freeze([
  "/propose-skill",
  "#skill-candidate",
  "@skill-registry",
  "acos.skill_proposer.propose",
  "acos.skill_registry.promote",
  "agentic-os.adapter.register",
  "#webmcp",
  "@webmcp-surface",
  "/goal.advance",
  "#goal-completion",
  "@goal-plan",
]);

// A declaration is the canonical form: a dictionary_entries list item or a
// first-column table row. Tokens mentioned in a later column of another
// token's row are cross-references, not declarations. A token is owned by
// exactly one register file, which is what the exactly-one rule checks; the
// list item and the table row inside that one file are one declaration.
const TOKEN_OWNER_FILE = Object.freeze({
  "/propose-skill": "docs/DICTIONARY-COMMAND.md",
  "#skill-candidate": "docs/DICTIONARY-SEMANTIC.md",
  "@skill-registry": "docs/DICTIONARY-BINDING.md",
  "acos.skill_proposer.propose": "docs/MCP-GATEWAY.md",
  "acos.skill_registry.promote": "docs/MCP-GATEWAY.md",
  "agentic-os.adapter.register": "docs/MCP-GATEWAY.md",
  "#webmcp": "docs/DICTIONARY-SEMANTIC.md",
  "@webmcp-surface": "docs/DICTIONARY-BINDING.md",
  "/goal.advance": "docs/DICTIONARY-COMMAND.md",
  "#goal-completion": "docs/DICTIONARY-SEMANTIC.md",
  "@goal-plan": "docs/DICTIONARY-BINDING.md",
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function declaresToken(token, text) {
  const listPattern = new RegExp(`^\\s*-\\s+"${escapeRegExp(token)}"\\s*$`, "m");
  const rowPattern = new RegExp(`^\\|\\s*\`${escapeRegExp(token)}\`\\s*\\|`, "m");
  return listPattern.test(text) || rowPattern.test(text);
}

async function run() {
  const failures = [];
  const texts = new Map();
  for (const relativePath of REGISTER_FILES) {
    texts.set(relativePath, await readFile(path.join(REPOSITORY_ROOT, relativePath), "utf8"));
  }

  for (const token of TOKENS) {
    const declaringFiles = [];
    for (const [relativePath, text] of texts) {
      if (declaresToken(token, text)) declaringFiles.push(relativePath);
    }
    if (declaringFiles.length !== 1) {
      failures.push(
        `token ${token} must be declared in exactly one register file; found ${declaringFiles.length} across: ${declaringFiles.join(", ") || "none"}`,
      );
    } else if (declaringFiles[0] !== TOKEN_OWNER_FILE[token]) {
      failures.push(
        `token ${token} is declared in ${declaringFiles[0]} but its owner register is ${TOKEN_OWNER_FILE[token]}`,
      );
    }
  }

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`invocation register ok: ${TOKENS.length} tokens each declared exactly once in exactly one owner register file`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
