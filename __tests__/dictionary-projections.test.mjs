import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readUpstreamDictionaries, validateDictionaryProjections } from "../scripts/dictionary-projections.mjs";

test("published dictionary paths contain exactly the installed upstream snapshot", () => {
  const upstream = readUpstreamDictionaries();
  const projected = new Map([...upstream.keys()].map(name =>
    [name, readFileSync(new URL("../docs/" + name, import.meta.url), "utf8")]));
  assert.deepEqual(validateDictionaryProjections(projected), []);
});

test("projection gate rejects body-only drift, missing sources and missing projections", () => {
  const upstream = readUpstreamDictionaries();
  const projected = new Map(upstream);
  const name = [...upstream.keys()][0];
  projected.set(name, projected.get(name) + "\n<!-- independently edited -->\n");
  assert.equal(validateDictionaryProjections(projected, upstream).length, 1);
  projected.delete(name);
  assert.equal(validateDictionaryProjections(projected, upstream).length, 1);
  assert.equal(validateDictionaryProjections(new Map(), new Map()).length, 3);
});
