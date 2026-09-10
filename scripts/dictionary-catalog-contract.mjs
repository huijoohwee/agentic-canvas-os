#!/usr/bin/env node
// Product CLI adapter. Dictionary definitions and catalog validation are upstream-owned.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalCatalogInput, CATALOG_DIGEST_INPUT, CATALOG_DIGEST_OWNER,
  DICTIONARY_DESCRIPTORS, collectCatalogEntries, labelFromToken,
  validateDictionaryCatalogContract as validateUpstream,
} from "agentic-os/invocation";

export {
  canonicalCatalogInput, CATALOG_DIGEST_INPUT, CATALOG_DIGEST_OWNER,
  DICTIONARY_DESCRIPTORS, collectCatalogEntries, labelFromToken,
};
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digestForInput = input => createHash("sha256").update(input, "utf8").digest("hex");
export const computeCatalogDigest = entries => digestForInput(canonicalCatalogInput(entries));
export const validateDictionaryCatalogContract = documents => validateUpstream(documents, digestForInput);

async function runCli() {
  const documents = new Map();
  for (const descriptor of DICTIONARY_DESCRIPTORS) {
    documents.set(
      descriptor.docsPath,
      await readFile(path.join(REPOSITORY_ROOT, "docs", descriptor.docsPath), "utf8"),
    );
  }
  const failures = validateDictionaryCatalogContract(documents);
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  const { entries } = collectCatalogEntries(documents);
  const perKind = DICTIONARY_DESCRIPTORS
    .map(({ kind, prefix }) => `${prefix} ${entries.filter((entry) => entry.kind === kind).length}`)
    .join(", ");
  console.log(
    `dictionary catalog ok: ${entries.length} entries (${perKind}); `
    + `digest ${computeCatalogDigest(entries)} recomputed from ${CATALOG_DIGEST_INPUT}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
