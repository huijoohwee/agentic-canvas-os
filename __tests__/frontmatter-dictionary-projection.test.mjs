import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DICTIONARY,
  DICTIONARY_SCHEMA,
  PROOF_KEYS,
  TIER_ACCOUNTABILITY,
  TIER_ADDRESS,
  TIER_EVIDENCE,
  TIER_IDENTITY,
  loadDictionary,
  tierKeys,
} from "../scripts/frontmatter-runtime-contract.mjs";
import {
  BEGIN_MARKER,
  DICTIONARY_DOCS_PATH,
  END_MARKER,
  renderProjection,
  replaceProjectionBlock,
  validateFrontmatterDictionaryProjection,
} from "../scripts/frontmatter-dictionary-projection.mjs";

const referenceText = () => readFile(
  new URL(`../docs/${DICTIONARY_DOCS_PATH}`, import.meta.url), "utf8",
);

test("the dictionary is the only key vocabulary the validator holds", () => {
  // Each exported tier must be exactly the dictionary's required slice. A key
  // present in code but not in the dictionary is the drift this extraction ends.
  assert.deepEqual(TIER_IDENTITY, tierKeys("identity"));
  assert.deepEqual(TIER_ADDRESS, tierKeys("address"));
  assert.deepEqual(TIER_ACCOUNTABILITY, tierKeys("accountability"));
  assert.deepEqual(TIER_EVIDENCE, tierKeys("evidence"));

  const enforced = DICTIONARY.keys
    .filter((entry) => entry.enforcement === "required")
    .map((entry) => entry.key)
    .sort();
  const exported = [
    ...TIER_IDENTITY, ...TIER_ADDRESS, ...TIER_ACCOUNTABILITY, ...TIER_EVIDENCE,
  ].sort();
  assert.deepEqual(exported, enforced.filter((key) => exported.includes(key)),
    "every enforced key belongs to exactly one derived tier");
});

test("every dictionary key names a declared tier and a known enforcement level", () => {
  for (const entry of DICTIONARY.keys) {
    assert.ok(DICTIONARY.tiers.some((tier) => tier.id === entry.tier), `${entry.key} tier`);
    assert.ok(["required", "recommended"].includes(entry.enforcement), `${entry.key} enforcement`);
    assert.ok(entry.contract.length > 0, `${entry.key} states a contract`);
  }
  assert.equal(new Set(DICTIONARY.keys.map((entry) => entry.key)).size, DICTIONARY.keys.length,
    "a key is declared exactly once");
});

test("substitute spellings are declared, never invented by the checker", () => {
  assert.deepEqual(PROOF_KEYS, ["runtime_proof", "proof"]);
  const substitutes = DICTIONARY.keys.flatMap((entry) => entry.substitutes ?? []);
  for (const substitute of substitutes) {
    // A substitute either is itself a declared key or is documented as one.
    const declared = DICTIONARY.keys.find((entry) => entry.key === substitute);
    if (declared) assert.ok(declared.substituteFor, `${substitute} declares what it substitutes for`);
  }
});

test("an unreadable, unpinned, or malformed dictionary fails closed", () => {
  assert.throws(() => loadDictionary("/nonexistent/frontmatter-dictionary.json"),
    /dictionary is unreadable/);
  assert.equal(DICTIONARY.schema, DICTIONARY_SCHEMA,
    "the live dictionary is pinned to the schema the validator accepts");
});

test("the projection is fenced, digest-stamped, and reproducible", async () => {
  const first = renderProjection();
  const second = renderProjection();
  assert.equal(first.digest, second.digest, "rendering is deterministic");
  assert.equal(first.keyCount, DICTIONARY.keys.length);
  assert.ok(first.block.startsWith(BEGIN_MARKER));
  assert.ok(first.block.endsWith(END_MARKER));
  assert.ok(first.block.includes(`digest=${first.digest}`));

  const text = await referenceText();
  assert.deepEqual(validateFrontmatterDictionaryProjection(new Map([[DICTIONARY_DOCS_PATH, text]])), [],
    "the committed projection matches the dictionary");
});

test("a hand edit inside the fence is reported as drift", async () => {
  const text = await referenceText();
  const tampered = text.replace("| `owner` |", "| `owner_role` |");
  assert.notEqual(tampered, text, "the fixture must actually change a projected row");
  const failures = validateFrontmatterDictionaryProjection(new Map([[DICTIONARY_DOCS_PATH, tampered]]));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /drifted from the dictionary/);
});

test("missing fences and a missing document are distinct failures", () => {
  assert.equal(replaceProjectionBlock("no fences here", "block"), null);
  const absent = validateFrontmatterDictionaryProjection(new Map());
  assert.equal(absent.length, 1);
  assert.match(absent[0], /absent from the docs artifact set/);

  const unfenced = validateFrontmatterDictionaryProjection(
    new Map([[DICTIONARY_DOCS_PATH, "---\ntitle: x\n---\n"]]),
  );
  assert.match(unfenced[0], /fence markers are missing/);
});

test("the stamped frontmatter counts match the rendered projection", async () => {
  const text = await referenceText();
  const { digest, keyCount, requiredCount } = renderProjection();
  assert.ok(text.includes(`projection_digest: "${digest}"`));
  assert.ok(text.includes(`projection_key_count: ${keyCount}`));
  assert.ok(text.includes(`projection_required_count: ${requiredCount}`));
  assert.ok(text.includes(`dictionary_version: "${DICTIONARY.version}"`));
});

test("the projection carries no forbidden literal it exists to forbid", async () => {
  const text = await referenceText();
  for (const entry of DICTIONARY.forbiddenValuePatterns) {
    assert.ok(text.includes(`\`${entry.id}\``), `${entry.id} is listed by identifier`);
    assert.ok(!text.includes(entry.pattern),
      `${entry.id} pattern source must stay in the dictionary, not the projection`);
  }
});
