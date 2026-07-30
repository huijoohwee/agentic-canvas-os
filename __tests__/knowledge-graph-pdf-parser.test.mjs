import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";

import {
  PDF_EXTENSIONS,
  parsePdf,
  supportsPdfPath,
} from "../src/knowledge-graph/pdf-parser.js";

test("recognizes PDF paths and extracts plain text operands in byte order", () => {
  assert.deepEqual(PDF_EXTENSIONS, [".pdf"]);
  assert.equal(supportsPdfPath("notes.PDF"), true);
  assert.equal(supportsPdfPath("notes.txt"), false);

  const content = Buffer.from(
    "BT (Hello\\n\\(reader\\)\\040\\\\) Tj [(Hex: ) <486578> -20 ( array)] TJ (next) ' 2 3 (quoted) \" ET",
    "latin1",
  );
  const result = parsePdf({ path: "notes.pdf", bytes: makePdf([{ content }]) });

  assert.equal(result.schema, "agentic-parser-ir/v1");
  assert.equal(result.parser.id, "builtin.pdf.text");
  assert.equal(result.parser.version, "1.0.0");
  assert.deepEqual(result.entities.map((entity) => entity.properties.text), [
    "Hello\n(reader) \\",
    "Hex: Hex array",
    "next",
    "quoted",
  ]);
  assert.ok(result.entities.every((entity) => (
    entity.kind === "pdf-region"
    && entity.parentId === null
    && entity.properties.streamIndex === 0
    && Number.isInteger(entity.properties.sourceByteStart)
  )));
  assert.deepEqual(result.references, []);
  assert.equal(result.ast.children.length, 4);
});

test("expands one FlateDecode stream and decodes literal, octal, and hex strings", () => {
  const content = Buffer.from("BT (A\\101\\\nB) Tj <00430044> Tj ET", "latin1");
  const compressed = deflateSync(content);
  const pdf = makePdf([{ content: compressed, filter: "/FlateDecode" }]);

  const first = parsePdf({ path: "compressed.pdf", bytes: pdf });
  const second = parsePdf({ path: "compressed.pdf", bytes: new Uint8Array(pdf) });

  assert.deepEqual(first, second);
  assert.deepEqual(first.entities.map((entity) => entity.properties.text), ["AAB", "\0C\0D"]);
  assert.ok(first.entities.every((entity) => entity.properties.encoding === "flate"));
  assert.ok(Object.isFrozen(first));
});

test("rejects encrypted input and diagnoses unsupported, image-only, and malformed PDFs", () => {
  const invalidHeader = makePdf([{ content: Buffer.from("BT (must not escape) Tj ET") }]);
  invalidHeader.write("%NOPE", 0, "ascii");
  const omitted = parsePdf({ path: "disguised.pdf", bytes: invalidHeader });
  assert.equal(omitted.entities.length, 0);
  assert.equal(omitted.references.length, 0);
  assert.deepEqual(omitted.diagnostics.map((item) => item.code), ["pdf_malformed_header"]);

  const encrypted = makePdf([{ content: Buffer.from("BT (secret) Tj ET") }], {
    trailerEntries: "/Encrypt 99 0 R",
  });
  const rejected = parsePdf({ path: "locked.pdf", bytes: encrypted });
  assert.equal(rejected.entities.length, 0);
  assert.ok(rejected.diagnostics.some((item) => item.code === "pdf_encrypted" && item.severity === "error"));

  const unsupported = parsePdf({
    path: "filtered.pdf",
    bytes: makePdf([{ content: Buffer.from("2848692920546a"), filter: "/ASCIIHexDecode" }]),
  });
  assert.ok(unsupported.diagnostics.some((item) => item.code === "pdf_filter_unsupported"));

  const imageOnly = parsePdf({
    path: "scan.pdf",
    bytes: makePdf([{ content: Buffer.from([0, 1, 2]), extra: "/Subtype /Image" }]),
  });
  assert.ok(imageOnly.diagnostics.some((item) => item.code === "pdf_image_only"));

  const malformed = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Length 4 >>\nstream\nBT (", "latin1");
  const partial = parsePdf({ path: "broken.pdf", bytes: malformed });
  assert.ok(partial.diagnostics.some((item) => item.code === "pdf_stream_malformed"));
  assert.ok(partial.diagnostics.some((item) => item.code === "pdf_no_text"));
});

test("returns partial results with deterministic stream-count and expansion bounds", () => {
  const manyStreams = Array.from({ length: 513 }, (_, index) => ({
    content: Buffer.from(`BT (${index}) Tj ET`, "latin1"),
  }));
  const bounded = parsePdf({ path: "many.pdf", bytes: makePdf(manyStreams) });
  assert.equal(bounded.entities.length, 512);
  assert.ok(bounded.diagnostics.some((item) => item.code === "pdf_stream_limit"));

  const oversized = deflateSync(Buffer.alloc((1024 * 1024) + 1, 0x20));
  const perStream = parsePdf({
    path: "large.pdf",
    bytes: makePdf([{ content: oversized, filter: "/FlateDecode" }]),
  });
  assert.equal(perStream.entities.length, 0);
  assert.ok(perStream.diagnostics.some((item) => item.code === "pdf_stream_expansion_limit"));

  const oneMiB = deflateSync(Buffer.alloc(1024 * 1024, 0x20));
  const total = parsePdf({
    path: "total.pdf",
    bytes: makePdf(Array.from({ length: 9 }, () => ({ content: oneMiB, filter: "/FlateDecode" }))),
  });
  assert.ok(total.diagnostics.some((item) => item.code === "pdf_expanded_bytes_limit"));
});

test("bounds malformed operands, operand accumulation, content tokens, and regions", () => {
  const malformed = parsePdf({
    path: "malformed-operands.pdf",
    bytes: makePdf([{ content: Buffer.from("<x> ".repeat(6_000), "latin1") }]),
  });
  assert.equal(
    malformed.diagnostics.filter((item) => item.code === "pdf_text_operand_malformed").length,
    512,
  );
  assert.ok(malformed.diagnostics.some((item) => (
    item.code === "pdf_malformed_diagnostic_limit"
    && item.detail?.partial === true
  )));
  assert.ok(malformed.diagnostics.length < 520);

  const operands = parsePdf({
    path: "operands.pdf",
    bytes: makePdf([{ content: Buffer.from(`${"() ".repeat(4_097)}Tj`, "latin1") }]),
  });
  assert.ok(operands.diagnostics.some((item) => item.code === "pdf_text_operand_limit"));

  const regions = parsePdf({
    path: "regions.pdf",
    bytes: makePdf([{ content: Buffer.from("() Tj ".repeat(10_001), "latin1") }]),
  });
  assert.equal(regions.entities.length, 0);
  assert.ok(regions.diagnostics.some((item) => item.code === "pdf_text_region_limit"));

  const tokens = parsePdf({
    path: "tokens.pdf",
    bytes: makePdf([{ content: Buffer.from("<> ".repeat(200_001), "latin1") }]),
  });
  assert.ok(tokens.diagnostics.some((item) => (
    item.code === "pdf_content_token_limit"
    && item.detail?.limit === 200_000
  )));
});

test("treats an indirect Length entry as indirect metadata", () => {
  const result = parsePdf({
    path: "indirect-length.pdf",
    bytes: makePdf([{
      content: Buffer.from("BT (complete stream) Tj ET", "latin1"),
      length: "10 0 R",
    }]),
  });
  assert.deepEqual(result.entities.map((entity) => entity.properties.text), ["complete stream"]);
  assert.equal(result.diagnostics.some((item) => item.code === "pdf_stream_length_mismatch"), false);
});

function makePdf(streams, { trailerEntries = "" } = {}) {
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "ascii"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /Contents [${streams.map((_, index) => `${index + 4} 0 R`).join(" ")}] >>`, "ascii"),
    ...streams.map(({ content, filter = "", extra = "", length = content.length }) => {
      const dictionary = `<< /Length ${length}${filter ? ` /Filter ${filter}` : ""}${extra ? ` ${extra}` : ""} >>\nstream\n`;
      return Buffer.concat([
        Buffer.from(dictionary, "ascii"),
        content,
        Buffer.from("\nendstream", "ascii"),
      ]);
    }),
  ];
  const chunks = [Buffer.from("%PDF-1.7\n%\x80\x81\x82\x83\n", "latin1")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const object = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "ascii"),
      body,
      Buffer.from("\nendobj\n", "ascii"),
    ]);
    chunks.push(object);
    length += object.length;
  });
  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailerEntries ? ` ${trailerEntries}` : ""} >>\n`,
    `startxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  chunks.push(Buffer.from(xref, "ascii"));
  return Buffer.concat(chunks);
}
