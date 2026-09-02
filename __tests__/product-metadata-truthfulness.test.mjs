import assert from "node:assert/strict";
import test from "node:test";

import { validateProductMetadataTruthfulness } from "../scripts/docs-contract.mjs";

function artifact({
  status = "runtime-ready",
  runtimeProof = "RUNTIME-PROOF.md",
  body = "The bounded parser contract is runtime-ready with focused proof.",
} = {}) {
  const text = [
    "---",
    'title: "Fixture"',
    'graphId: "fixture:truthfulness"',
    'doc_type: "Product Contract"',
    'date: "2026-09-02"',
    'lang: "en-US"',
    'schema: "fixture/v1"',
    'frontmatter_contract: "required"',
    `status: "${status}"`,
    'runtime_claim: "bounded parser behavior only"',
    `runtime_proof: "${runtimeProof}"`,
    "---",
    "",
    body,
    "",
  ].join("\n");
  const end = text.indexOf("\n---\n", 4);
  return { text, frontmatter: text.slice(4, end) };
}

test("bounded runtime-ready metadata with positive proof language passes", () => {
  const input = artifact();
  assert.deepEqual(validateProductMetadataTruthfulness({
    relativePath: "positive.md",
    ...input,
  }), []);
});

test("runtime-ready metadata cannot contradict body readiness or proof", () => {
  const input = artifact({
    body: "This contract is not runtime-ready. Runtime proof remains unverified.",
  });
  const failures = validateProductMetadataTruthfulness({
    relativePath: "negative.md",
    ...input,
  });
  assert.equal(failures.length, 2);
  assert.ok(failures.every((failure) => failure.includes("runtime-ready frontmatter")));
});

test("runtime-ready metadata rejects a placeholder proof", () => {
  const input = artifact({ runtimeProof: "TBD" });
  assert.deepEqual(validateProductMetadataTruthfulness({
    relativePath: "placeholder.md",
    ...input,
  }), [
    'placeholder.md: runtime-ready frontmatter names unproven runtime_proof "TBD"',
  ]);
});

test("spec-complete metadata may state an explicit live-runtime gap", () => {
  const input = artifact({
    status: "spec-complete",
    body: "It does not claim current-guideline or protected runtime parity.",
  });
  assert.deepEqual(validateProductMetadataTruthfulness({
    relativePath: "spec.md",
    ...input,
  }), []);
});
