import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateDocsSourceReferences } from "../scripts/docs-source-references.mjs";

async function fixture(t, source) {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "docs-source-reference-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  await mkdir(path.join(repositoryRoot, "docs"));
  await writeFile(path.join(repositoryRoot, "docs/OWNER.md"), "# Owner\n");
  await writeFile(path.join(repositoryRoot, "AGENTS.md"), "# Instructions\n");
  const documents = new Map([["INDEX.md", `---\ntitle: Index\n${source}\n---\n# Index\n`]]);
  return {
    repositoryRoot,
    check: () => validateDocsSourceReferences(documents, { repositoryRoot }),
  };
}

test("local owners resolve while workspace references require no sibling checkout", async (t) => {
  const { check } = await fixture(t, 'source_docs:\n  - "OWNER.md"\n  - "../AGENTS.md"\n  - "$GITHUB_ROOT/sibling/docs/OWNER.md"\n  - "$AGENTIC_GRAPH_ROOT/docs/OWNER.md"');
  assert.deepEqual(await check(), []);
});

test("retiring a declared owner fails closed", async (t) => {
  const { check } = await fixture(t, 'source_docs:\n  - "RETIRED.md"');
  assert.match((await check()).join("\n"), /missing source document RETIRED.md/);
});

test("legacy source references can resolve through the renamed prd-tad-adr-mvp-gtm owner", async (t) => {
  const { repositoryRoot, check } = await fixture(t, 'source_docs:\n  - "PRD-TAD.md"');
  await writeFile(path.join(repositoryRoot, "docs/PRD-TAD-ADR-MVP-GTM.md"), "# Owner\n");
  assert.deepEqual(await check(), []);
});

test("duplicate and malformed source declarations are reported", async (t) => {
  const { check } = await fixture(t, 'source_docs:\n  - "OWNER.md"\n  - "OWNER.md"\n  invalid mapping');
  const failures = await check();
  assert.equal(failures.length, 2);
  assert.match(failures.join("\n"), /duplicate source reference/);
});

test("lifecycle gates resolve through installed owners", async (t) => {
  const { check } = await fixture(t, 'memory_log:\n  startup_gate: "START-WORKFLOW.md"');
  assert.match((await check()).join("\n"), /missing source document START-WORKFLOW.md/);
});

test("declared local and workspace paths cannot escape their root", async (t) => {
  const { check } = await fixture(t, 'source_docs:\n  - "../../outside.md"\n  - "$GITHUB_ROOT/../outside.md"');
  assert.equal((await check()).length, 2);
});
