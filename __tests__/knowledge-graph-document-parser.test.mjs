import test from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENT_EXTENSIONS,
  parseDocument,
  supportsDocumentPath,
} from "../src/knowledge-graph/document-parser.js";

test("document paths are selected by a fixed case-insensitive extension set", () => {
  assert.deepEqual(DOCUMENT_EXTENSIONS, [".md", ".mdx", ".txt", ".rst", ".adoc"]);
  for (const path of ["README.MD", "guide.mdx", "notes.txt", "manual.rst", "book.adoc"]) {
    assert.equal(supportsDocumentPath(path), true, path);
  }
  assert.equal(supportsDocumentPath("image.png"), false);
  assert.equal(supportsDocumentPath(null), false);
  assert.throws(
    () => parseDocument({ path: "image.png", source: "" }),
    /unsupported document path/,
  );
});

test("Markdown sections, paragraphs, and AST children preserve heading hierarchy and spans", () => {
  const source = [
    "# Root",
    "",
    "Root prose.",
    "",
    "### Deep child",
    "Nested prose.",
    "",
    "## Sibling",
    "",
  ].join("\n");
  const parsed = parseDocument({ path: "docs/guide.md", source });
  const sections = parsed.entities.filter((entity) => entity.kind === "section");
  const paragraphs = parsed.entities.filter((entity) => entity.kind === "paragraph");

  assert.deepEqual(sections.map((entity) => entity.name), ["Root", "Deep child", "Sibling"]);
  assert.equal(sections[0].parentId, null);
  assert.equal(sections[1].parentId, sections[0].id);
  assert.equal(sections[2].parentId, sections[0].id);
  assert.equal(paragraphs[0].parentId, sections[0].id);
  assert.equal(paragraphs[1].parentId, sections[1].id);
  assert.equal(source.slice(sections[1].span.start.offset, sections[1].span.end.offset), "### Deep child");
  assert.equal(source.slice(paragraphs[1].span.start.offset, paragraphs[1].span.end.offset), "Nested prose.");

  assert.equal(parsed.ast.children[0].id, sections[0].id);
  assert.deepEqual(
    parsed.ast.children[0].children.filter((node) => node.type === "section").map((node) => node.id),
    [sections[1].id, sections[2].id],
  );
});

test("links, autolinks, and relative document targets are observed in their current section", () => {
  const source = [
    "# Sources",
    "",
    "Read [the guide](../guide.md#start), <https://example.test/reference>, <help@example.test>, and ./notes.rst.",
    "Ignore `inline.md` and ![an image](image.md).",
    "",
  ].join("\n");
  const parsed = parseDocument({ path: "docs/index.md", source });
  const section = parsed.entities.find((entity) => entity.kind === "section");

  assert.deepEqual(
    parsed.references.map((reference) => reference.target),
    ["../guide.md#start", "https://example.test/reference", "help@example.test", "./notes.rst"],
  );
  assert.deepEqual(
    parsed.references.map((reference) => reference.targetKind),
    ["document", "url", "url", "document"],
  );
  for (const reference of parsed.references) {
    assert.equal(reference.certainty, "observed");
    assert.equal(reference.sourceId, section.id);
    assert.equal(
      source.slice(reference.span.start.offset, reference.span.end.offset),
      reference.target,
    );
  }
});

test("many mixed links use deterministic bounded reference extraction with exact spans", () => {
  const series = (count, render) => Array.from(
    { length: count },
    (_, index) => render(String(index).padStart(5, "0")),
  ).join(" ");
  const markdown = series(4_000, (index) => `[linked-${index}](./linked/${index}.md)`);
  const autolinks = series(3_000, (index) => `<https://example.test/${index}>`);
  const relative = series(3_500, (index) => `./bare/${index}.rst`);
  const source = `# Stress\n\n${markdown}\n${autolinks}\n${relative}\n`;

  assert.ok(Buffer.byteLength(source) < 2 * 1024 * 1024);
  const parsed = parseDocument({ path: "stress.md", source });
  const repeated = parseDocument({ path: "stress.md", source });
  const partial = parsed.diagnostics.find(
    (item) => item.code === "document_references_truncated",
  );

  assert.equal(parsed.references.length, 10_000);
  assert.equal(parsed.references[0].target, "./linked/00000.md");
  assert.equal(parsed.references[3_999].target, "./linked/03999.md");
  assert.equal(parsed.references[4_000].target, "https://example.test/00000");
  assert.equal(parsed.references[6_999].target, "https://example.test/02999");
  assert.equal(parsed.references[7_000].target, "./bare/00000.rst");
  assert.equal(parsed.references.at(-1).target, "./bare/02999.rst");
  assert.deepEqual(partial.detail, { limit: 10_000, partial: true });
  assert.equal(partial.span.start.line, 5);
  assert.equal(
    source.slice(partial.span.start.offset, partial.span.end.offset),
    "./bare/03000.rst",
  );
  for (const reference of parsed.references) {
    assert.equal(
      source.slice(reference.span.start.offset, reference.span.end.offset),
      reference.target,
    );
  }
  assert.deepEqual(
    repeated.references.map((reference) => reference.id),
    parsed.references.map((reference) => reference.id),
  );
  assert.deepEqual(repeated.diagnostics, parsed.diagnostics);
});

test("fenced code blocks retain language metadata and do not emit prose links", () => {
  const source = [
    "## Example",
    "",
    "```javascript title=demo",
    "const path = \"[guide](./inside.md)\";",
    "```",
    "",
  ].join("\n");
  const parsed = parseDocument({ path: "example.md", source });
  const section = parsed.entities.find((entity) => entity.kind === "section");
  const block = parsed.entities.find((entity) => entity.kind === "code-block");

  assert.equal(block.parentId, section.id);
  assert.equal(block.properties.language, "javascript");
  assert.equal(
    source.slice(block.span.start.offset, block.span.end.offset),
    "```javascript title=demo\nconst path = \"[guide](./inside.md)\";\n```",
  );
  assert.deepEqual(parsed.references, []);
  assert.deepEqual(parsed.diagnostics, []);
});

test("malformed and unclosed fences return typed source-spanned diagnostics", () => {
  const source = ["````js", "const value = 1;", "~~~", "```"].join("\n");
  const parsed = parseDocument({ path: "broken.md", source });
  const codes = parsed.diagnostics.map((item) => item.code);

  assert.deepEqual(codes, [
    "document_fence_unclosed",
    "document_fence_malformed",
    "document_fence_malformed",
  ]);
  for (const item of parsed.diagnostics) {
    assert.equal(item.severity, "warning");
    assert.ok(item.span.start.offset >= 0);
    assert.ok(item.span.end.offset <= source.length);
  }
  assert.equal(parsed.entities.filter((entity) => entity.kind === "code-block").length, 1);
});

test("plain text is split into bounded normalized deterministic paragraph chunks", () => {
  const source = `${Array.from({ length: 240 }, (_, index) => `word${index}`).join(indexSeparator)}\n`;
  const first = parseDocument({ path: "notes.txt", source });
  const second = parseDocument({ path: "notes.txt", source });
  const paragraphs = first.entities.filter((entity) => entity.kind === "paragraph");

  assert.deepEqual(first, second);
  assert.ok(paragraphs.length > 1);
  for (const paragraph of paragraphs) {
    assert.ok(paragraph.properties.text.length <= 480);
    assert.doesNotMatch(paragraph.properties.text, /\s{2,}|\n/u);
    assert.ok(paragraph.span.start.offset < paragraph.span.end.offset);
    assert.equal(paragraph.parentId, null);
  }
});

test("underlined and AsciiDoc headings form sections while empty documents report a typed gap", () => {
  const rst = parseDocument({
    path: "manual.rst",
    source: "Manual\n======\n\nInstall\n-------\n\nSteps.",
  });
  const rstSections = rst.entities.filter((entity) => entity.kind === "section");
  assert.equal(rstSections[1].parentId, rstSections[0].id);

  const adoc = parseDocument({
    path: "manual.adoc",
    source: "= Manual\n\n== Install\n\nSteps.",
  });
  const adocSections = adoc.entities.filter((entity) => entity.kind === "section");
  assert.equal(adocSections[1].parentId, adocSections[0].id);

  const empty = parseDocument({ path: "empty.txt", source: " \n\t" });
  assert.deepEqual(empty.entities, []);
  assert.equal(empty.diagnostics[0].code, "document_empty");
  assert.equal(empty.diagnostics[0].severity, "info");
});

test("many-line documents stop with a deterministic partial diagnostic", () => {
  const source = "line\n".repeat(10_001);
  const first = parseDocument({ path: "bounded.txt", source });
  const second = parseDocument({ path: "bounded.txt", source });
  assert.deepEqual(first, second);
  const limit = first.diagnostics.find((record) => record.code === "document_line_limit");
  assert.deepEqual(limit.detail, { limit: 10_000, partial: true });
  assert.ok(first.entities.length <= 10_000);
});

const indexSeparator = " \n\t";
