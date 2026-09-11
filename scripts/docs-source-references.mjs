import { stat } from "node:fs/promises";
import path from "node:path";

const LEGACY_SOURCE_DOC_ALIASES = new Map([
  ["PRD-TAD.md", "PRD-TAD-ADR-MVP-GTM.md"],
]);

async function resolvesToFile(target) {
  return (await stat(target).catch(() => null))?.isFile() ?? false;
}

// Validate declared provenance without loading the referenced documents or starting services.
// Workspace references remain portable declarations; this check performs no cross-repo reads.
export async function validateDocsSourceReferences(documents, { repositoryRoot }) {
  const failures = [];
  const root = path.resolve(repositoryRoot);
  for (const [name, text] of documents) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
    if (!frontmatter) continue; // The existing frontmatter validator owns this failure.
    const block = /^source_docs:[ \t]*\r?\n((?:[ \t]+[^\n]*\n?)*)/m.exec(frontmatter)?.[1];
    const references = [];
    for (const line of block?.split("\n") ?? []) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const value = /^\s+-\s+("[^"\n]+"|'[^'\n]+'|[^\s#]+)\s*(?:#.*)?$/.exec(line)?.[1];
      if (!value) { failures.push(`${name}: source_docs requires one scalar path per list entry`); continue; }
      references.push(value.replace(/^["']|["']$/g, ""));
    }
    // These product memory pointers must resolve to the installed lifecycle owner.
    for (const match of frontmatter.matchAll(/^\s+(?:startup_gate|release_gate):\s+"([^"]+)"\s*$/gm)) {
      references.push(match[1]);
    }
    const seen = new Set();
    for (const reference of references) {
      if (seen.has(reference)) { failures.push(`${name}: duplicate source reference ${reference}`); continue; }
      seen.add(reference);
      if (/^https:\/\//.test(reference)) continue;
      if (/^\$[A-Z][A-Z0-9_]*\//.test(reference)) {
        const segments = reference.slice(reference.indexOf("/") + 1).split("/");
        if (segments.length < 1 || segments.some((part) => !part || part === ".." || part === ".")) {
          failures.push(`${name}: invalid workspace source reference ${reference}`);
        }
        continue;
      }
      const target = path.resolve(root, "docs", path.dirname(name), reference);
      if (path.isAbsolute(reference) || !target.startsWith(root + path.sep)) {
        failures.push(`${name}: source reference escapes repository ${reference}`);
      } else if (
        !(await resolvesToFile(target))
        && !(
          LEGACY_SOURCE_DOC_ALIASES.has(reference)
          && await resolvesToFile(path.resolve(root, "docs", path.dirname(name),
            LEGACY_SOURCE_DOC_ALIASES.get(reference)))
        )
      ) {
        failures.push(`${name}: missing source document ${reference}`);
      }
    }
  }
  return failures;
}
