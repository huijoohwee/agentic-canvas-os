import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)));

test("the property manifest contains exactly 25 independently tagged 100-run files", async () => {
  const names = (await readdir(TEST_ROOT))
    .filter((name) => /^alignment-audit-property-\d{2}\.test\.mjs$/u.test(name))
    .sort();
  assert.deepEqual(
    names,
    Array.from(
      { length: 25 },
      (_, index) =>
        `alignment-audit-property-${String(index + 1).padStart(2, "0")}.test.mjs`,
    ),
  );

  for (const [index, name] of names.entries()) {
    const content = await readFile(path.join(TEST_ROOT, name), "utf8");
    const tags = [...content.matchAll(
      /\/\/ Feature: guideline-runtime-alignment-audit, Property (\d+):/gu,
    )];
    const runDeclarations = [...content.matchAll(/\bnumRuns\s*:\s*100\b/gu)];
    assert.equal(tags.length, 1, `${name} must contain one Feature Property tag`);
    assert.equal(Number(tags[0][1]), index + 1, `${name} has the wrong Property number`);
    assert.equal(
      runDeclarations.length,
      1,
      `${name} must declare exactly one 100-run property check`,
    );
  }
});
