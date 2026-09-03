import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectDocsArtifacts,
  MAX_DOCS_ARTIFACT_BYTES,
  validateJsonArtifact,
  validateMarkdownArtifact,
} from "../scripts/docs-contract.mjs";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DOCS_ROOT = path.join(REPOSITORY_ROOT, "docs");
const SEED_RELATIVE_PATH = "workspace-seeds/agentic-graph-physics-playground-demo.md";
const SEED_PATH = path.join(DOCS_ROOT, ...SEED_RELATIVE_PATH.split("/"));

test("recursive discovery includes the protected runtime-ready workspace seed", async () => {
  const artifacts = await collectDocsArtifacts(DOCS_ROOT);
  assert.equal(
    artifacts.some(({ relativePath }) => relativePath === SEED_RELATIVE_PATH),
    true,
  );
  assert.equal(artifacts.every(({ extension }) => [".md", ".json"].includes(extension)), true);
});

test("the existing workspace seed passes the projection frontmatter contract", async () => {
  const text = await readFile(SEED_PATH, "utf8");
  assert.deepEqual(
    validateMarkdownArtifact({ relativePath: SEED_RELATIVE_PATH, text }),
    [],
  );
});

test("a projection missing source_root fails closed", async () => {
  const text = (await readFile(SEED_PATH, "utf8"))
    .replace(/^\s+source_root:.*\n/mu, "");
  const failures = validateMarkdownArtifact({ relativePath: SEED_RELATIVE_PATH, text });
  assert.equal(failures.some((failure) => failure.includes("missing projection marker source_root")), true);
});

test("a projection with a mismatched canonical_source_file fails closed", async () => {
  const text = (await readFile(SEED_PATH, "utf8"))
    .replace(
      /^\s+canonical_source_file:.*$/mu,
      '  canonical_source_file: "/docs/workspace-seeds/not-the-source.md"',
    );
  const failures = validateMarkdownArtifact({ relativePath: SEED_RELATIVE_PATH, text });
  assert.equal(
    failures.some((failure) => failure.includes("projection marker canonical_source_file must be")),
    true,
  );
});

test("a nested authored document still requires all authored frontmatter keys", () => {
  const text = "---\ntitle: Nested\nstatus: draft\n---\n\n# Nested\n";
  const failures = validateMarkdownArtifact({ relativePath: "nested/example.md", text });
  assert.equal(failures.some((failure) => failure.includes("missing frontmatter key graphId")), true);
  assert.equal(failures.some((failure) => failure.includes("missing frontmatter key schema")), true);
});

test("nested JSON must parse", () => {
  const failures = validateJsonArtifact({
    relativePath: "schemas/nested/invalid.schema.json",
    text: '{"schema":',
  });
  assert.equal(failures.some((failure) => failure.includes("invalid JSON")), true);
});

test("all artifacts remain below 500000 bytes", () => {
  const failures = validateJsonArtifact({
    relativePath: "schemas/oversized.json",
    text: "x".repeat(MAX_DOCS_ARTIFACT_BYTES),
  });
  assert.equal(failures.some((failure) => failure.includes("byte budget")), true);
});

test("nested Markdown still enforces the 600-line boundary", () => {
  const text = validAuthoredDocument() + "line\n".repeat(600);
  const failures = validateMarkdownArtifact({ relativePath: "nested/too-long.md", text });
  assert.equal(failures.some((failure) => failure.includes("<600 line budget")), true);
});

test("artifact ordering is deterministic and POSIX-relative", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "docs-contract-recursive-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "nested"), { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, "z.json"), "{}\n"),
    writeFile(path.join(directory, "nested", "a.md"), validAuthoredDocument()),
  ]);

  const artifacts = await collectDocsArtifacts(directory);
  assert.deepEqual(
    artifacts.map(({ relativePath }) => relativePath),
    ["nested/a.md", "z.json"],
  );
  assert.equal(artifacts.some(({ relativePath }) => relativePath.includes("\\")), false);
});

function validAuthoredDocument() {
  return [
    "---",
    'title: "Fixture"',
    'graphId: "fixture:docs-contract"',
    'doc_type: "Runtime Contract"',
    'date: "2026-08-12"',
    'lang: "en-US"',
    'schema: "fixture/v1"',
    'frontmatter_contract: "required"',
    'status: "focused-tested"',
    "---",
    "",
    "# Fixture",
    "",
  ].join("\n");
}
