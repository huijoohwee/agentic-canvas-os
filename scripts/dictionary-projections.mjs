#!/usr/bin/env node
// Published Markdown compatibility paths are exact projections, never another dictionary owner.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DICTIONARY_DESCRIPTORS, DICTIONARY_LIMITS } from "agentic-os/invocation";
import { readBoundedFile } from "agentic-os/frontmatter";
import { validateDictionaryCatalogContract } from "./dictionary-catalog-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const utf8 = new TextDecoder("utf-8", { fatal: true });
const read = target => utf8.decode(readBoundedFile(target, DICTIONARY_LIMITS.bytesPerFile, "dictionary"));

export function readUpstreamDictionaries() {
  const documents = new Map(DICTIONARY_DESCRIPTORS.map(({ docsPath }) => [
    docsPath, read(fileURLToPath(import.meta.resolve(`agentic-os/dictionaries/${docsPath}`))),
  ]));
  const failures = validateDictionaryCatalogContract(documents);
  if (failures.length) throw new Error(failures.join("\n"));
  return documents;
}

export function validateDictionaryProjections(documents, upstream = readUpstreamDictionaries()) {
  return DICTIONARY_DESCRIPTORS.flatMap(({ docsPath }) =>
    typeof upstream.get(docsPath) !== "string" || documents.get(docsPath) !== upstream.get(docsPath)
      ? [`${docsPath}: differs from the locked agentic-os asset; run npm run dictionary:project`]
      : []);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--write") || process.argv.length > 3) {
    throw new Error("usage: dictionary-projections.mjs [--write]");
  }
  const upstream = readUpstreamDictionaries(); // Verify all inputs before writing any projection.
  const documents = new Map(DICTIONARY_DESCRIPTORS.map(({ docsPath }) =>
    [docsPath, read(path.join(root, "docs", docsPath))]));
  if (process.argv.includes("--write")) {
    for (const [name, text] of upstream) {
      if (documents.get(name) !== text) writeFileSync(path.join(root, "docs", name), text, "utf8");
    }
    console.log("Refreshed the three dictionary projections from the locked agentic-os assets.");
  } else {
    const failures = validateDictionaryProjections(documents, upstream);
    if (failures.length) throw new Error(failures.join("\n"));
    console.log("Dictionary projections match the locked agentic-os assets byte for byte.");
  }
}
