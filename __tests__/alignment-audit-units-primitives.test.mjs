import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildArtifactIndex } from "../scripts/alignment-audit/artifact-indexer.mjs";
import {
  missingFrontmatterKeys,
  scanFrontmatter,
} from "../scripts/alignment-audit/frontmatter.mjs";
import { parseGuidelineSet } from "../scripts/alignment-audit/guideline-parser.mjs";
import {
  contentDigest,
  documentKeyFrom,
  elementIdFrom,
  normalizeContent,
} from "../scripts/alignment-audit/normalize.mjs";

test("normalizeContent is idempotent and canonicalizes line endings and trailing space", () => {
  const source = "first  \r\nsecond\t\r\n\r\n";
  const normalized = "first\nsecond\n";
  assert.equal(normalizeContent(source), normalized);
  assert.equal(normalizeContent(normalized), normalized);
  assert.equal(contentDigest(source), contentDigest(normalized));
});

test("Element_Id depends only on the owning anchor and normalized text", () => {
  assert.equal(
    elementIdFrom("readiness", "MUST record proof.  \r\n"),
    elementIdFrom("readiness", "MUST record proof.\n"),
  );
  assert.notEqual(
    elementIdFrom("readiness", "MUST record proof."),
    elementIdFrom("release", "MUST record proof."),
  );
});

test("document identity ignores path-like properties", () => {
  const frontmatter = new Map([["title", "Runtime Contract"]]);
  assert.equal(
    documentKeyFrom({ frontmatter, path: "/runtime-ready/a.md" }, "same"),
    documentKeyFrom({ frontmatter, path: "/unknown-status/b.md" }, "same"),
  );
});

test("document identity is stable when a same-title document is added", () => {
  const frontmatter = new Map([["title", "Same"]]);
  const original = documentKeyFrom(frontmatter, "Stripe is required.");
  const added = documentKeyFrom(frontmatter, "A benign note.");
  assert.notEqual(original, added);
  assert.equal(
    documentKeyFrom(frontmatter, "Stripe is required.", [added]),
    original,
  );
});

test("frontmatter scanner reads the supported flat-key subset", () => {
  const result = scanFrontmatter(
    '---\r\ntitle: "Example: audit"\r\nstatus: runtime-ready\r\n---\r\n\r\n## Body\r\n',
    ["title", "status", "lang"],
  );
  assert.equal(result.readState, "ok");
  assert.equal(result.frontmatter.get("title"), "Example: audit");
  assert.equal(result.body, "\n## Body\n");
  assert.deepEqual(result.missingKeys, ["lang"]);
  assert.deepEqual(missingFrontmatterKeys(result.frontmatter, ["status"]), []);
});

for (const [name, source, error] of [
  ["missing opening delimiter", "title: Example\n", "missing opening"],
  ["missing closing delimiter", "---\ntitle: Example\n", "missing closing"],
  ["duplicated key", "---\ntitle: A\ntitle: B\n---\n", "duplicate"],
  ["invalid indentation", "---\n title: A\n---\n", "indentation"],
  ["unterminated fence", "---\ntitle: A\n---\n\n```js\nconst x = 1;\n", "unterminated"],
]) {
  test(`frontmatter scanner reports ${name} without throwing`, () => {
    const result = scanFrontmatter(source);
    assert.equal(result.readState, "malformed");
    assert.match(result.error, new RegExp(error, "i"));
    assert.equal(result.frontmatter, null);
  });
}

test("frontmatter with no body is valid", () => {
  const result = scanFrontmatter("---\ntitle: A\n---\n");
  assert.equal(result.readState, "ok");
  assert.equal(result.body, "");
});

test("committed fixtures expose seven gates and all invocation declarations", async () => {
  const guidelineText = await readFile(
    "scripts/alignment-audit/__fixtures__/guideline/portable-alignment-guideline.md",
    "utf8",
  );
  const guideline = parseGuidelineSet([{ text: guidelineText }], ["title"]);
  const expectedOrder = [
    "problem-validation",
    "requirements-authoring",
    "architecture-authoring",
    "alignment-review",
    "implementation",
    "local-proof",
    "release-readiness",
  ];
  assert.deepEqual(
    guideline.value.gates.map((gate) => gate.gateId),
    expectedOrder,
  );
  assert.equal(
    guideline.value.gates.every(
      (gate) =>
        gate.entryCondition && gate.exitCondition && gate.requiredEvidenceType,
    ),
    true,
  );
  assert.equal(
    guideline.value.elements.every((element) => element.gateId !== null),
    true,
  );

  const runtimeText = await readFile(
    "scripts/alignment-audit/__fixtures__/runtime/alignment-audit-runtime.md",
    "utf8",
  );
  const runtime = buildArtifactIndex(
    [{ text: runtimeText }],
    [
      "undocumented",
      "spec-complete",
      "dev-proven",
      "runtime-ready",
      "production-verified",
    ],
  );
  const documentEntry = runtime.value.entries.find(
    (entry) => entry.entryKind === "markdown-document",
  );
  assert.deepEqual(documentEntry.documentedStageOrder, expectedOrder);
  assert.equal(documentEntry.invocationRoutes.length, 4);
  assert.deepEqual(runtime.value.federatedToolIdentities, ["alignment.audit"]);
  assert.deepEqual(runtime.value.cataloguedToolIdentities, ["alignment.audit"]);
});
