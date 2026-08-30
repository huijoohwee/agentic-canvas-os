import test from "node:test";
import assert from "node:assert/strict";

import {
  LINE_BUDGET,
  applyInsertions,
  buildPlan,
  ownerFor,
  proposeForArtifact,
} from "../scripts/frontmatter-runtime-migration.mjs";
import { evaluateArtifact, parseFrontmatter } from "../scripts/frontmatter-runtime-contract.mjs";

const build = (keys, bodyLines = 1) => `---\n${Object.entries(keys)
  .map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n${"\nbody".repeat(bodyLines)}\n`;

const claiming = {
  title: '"T"', doc_type: '"Runtime Contract"', date: "2026-08-30",
  lang: '"en-US"', frontmatter_contract: '"required"', schema: '"x/v1"',
  status: '"runtime-ready"', runtime_proof: '"../__tests__/x.test.mjs"',
};

test("a conformant artifact is proposed no change", () => {
  const conformant = {
    ...claiming, owner: "role", local_rung: "spec-complete",
    delivered_rung: "undocumented", evaluator: "npm run docs:check",
  };
  delete conformant.status;
  const proposal = proposeForArtifact({ relativePath: "a.md", text: build(conformant) });
  assert.equal(proposal.disposition, "conformant");
  assert.deepEqual(proposal.insertions, []);
});

test("every insertion cites the rule, the source it read, and why the value is true", () => {
  const proposal = proposeForArtifact({ relativePath: "a.md", text: build(claiming) });
  assert.ok(proposal.insertions.length > 0);
  for (const insertion of proposal.insertions) {
    assert.ok(insertion.ruleId, "an insertion without a rule id is unauditable");
    assert.ok(insertion.reads, "an insertion must name what it read");
    assert.ok(insertion.because && insertion.because.length > 20);
    assert.notEqual(insertion.value, undefined);
  }
});

test("evaluator derives from a named test when runtime_proof provides one", () => {
  const proposal = proposeForArtifact({ relativePath: "a.md", text: build(claiming) });
  const evaluator = proposal.insertions.find((insertion) => insertion.key === "evaluator");
  assert.equal(evaluator.value, "node --test __tests__/x.test.mjs");
  assert.equal(evaluator.ruleId, "evaluator-from-named-test");
});

test("evaluator falls back to the docs contract when no test is named", () => {
  const proposal = proposeForArtifact({
    relativePath: "a.md",
    text: build({ ...claiming, runtime_proof: '"RUNTIME-PROOF.md"' }),
  });
  const evaluator = proposal.insertions.find((insertion) => insertion.key === "evaluator");
  assert.equal(evaluator.value, "npm run docs:check");
  assert.equal(evaluator.ruleId, "evaluator-docs-contract");
});

test("delivered_rung is undocumented because no delivery receipt exists", () => {
  const proposal = proposeForArtifact({ relativePath: "a.md", text: build(claiming) });
  const rung = proposal.insertions.find((insertion) => insertion.key === "delivered_rung");
  assert.equal(rung.value, "undocumented");
  assert.match(rung.because, /no delivery or deployment receipt/);
});

test("owner is never invented, and names the doc_type that would unlock it", () => {
  const proposal = proposeForArtifact({ relativePath: "a.md", text: build(claiming) });
  assert.ok(!proposal.insertions.some((insertion) => insertion.key === "owner"));
  const blocker = proposal.blockers.find((item) => item.key === "owner");
  assert.match(blocker.reason, /not derivable/);
  assert.match(blocker.reason, /Runtime Contract/);
});

test("a declared doc_type entry supplies owner and cites the operator decision", () => {
  const map = { "Runtime Contract": "docs harness layer" };
  assert.equal(ownerFor(map, parseFrontmatter(build(claiming))), "docs harness layer");
  const proposal = proposeForArtifact({ relativePath: "a.md", text: build(claiming) }, map);
  const owner = proposal.insertions.find((insertion) => insertion.key === "owner");
  assert.equal(owner.value, "docs harness layer");
  assert.match(owner.because, /operator declared/);
  assert.ok(!proposal.blockers.some((item) => item.key === "owner"));
});

test("an absent runtime_proof is a decision, never a synthesised pointer", () => {
  const noProof = { ...claiming };
  delete noProof.runtime_proof;
  const proposal = proposeForArtifact({ relativePath: "a.md", text: build(noProof) });
  assert.ok(!proposal.insertions.some((insertion) => insertion.key === "runtime_proof"));
  assert.ok(proposal.blockers.some((item) => item.key === "runtime_proof"
    && /cannot be synthesised/.test(item.reason)));
});

test("a file at its line ceiling is refused whole, never partially written", () => {
  const atCeiling = build(claiming, LINE_BUDGET);
  const proposal = proposeForArtifact({ relativePath: "big.md", text: atCeiling });
  assert.equal(proposal.disposition, "needs-decision");
  assert.deepEqual(proposal.insertions, [], "no insertion may be applied to an over-budget file");
  assert.ok(proposal.blockers.some((item) => /against the 599 budget/.test(item.reason)));
});

test("the declared tighter byte budget is honoured", () => {
  const proposal = proposeForArtifact({
    relativePath: "SYSTEM-PROMPT-RUNTIME.md",
    text: build({ ...claiming, filler: `"${"x".repeat(900)}"` }),
  });
  assert.equal(proposal.insertions.length, 0);
  assert.ok(proposal.blockers.some((item) => /1000 byte budget/.test(item.reason)));
});

test("insertion is additive: existing keys, order, and body are untouched", () => {
  const original = build(claiming);
  const proposal = proposeForArtifact({ relativePath: "a.md", text: original });
  const next = applyInsertions(original, proposal.insertions);
  const before = parseFrontmatter(original);
  const after = parseFrontmatter(next);
  for (const [key, value] of before) assert.equal(after.get(key), value, `${key} must be unchanged`);
  assert.equal(next.slice(next.indexOf("\n---\n")), original.slice(original.indexOf("\n---\n")),
    "the body must be byte-identical");
  assert.ok(next.length > original.length);
});

test("applying the proposal makes the artifact more conformant, never less", () => {
  const map = { "Runtime Contract": "docs harness layer" };
  const original = build(claiming);
  const proposal = proposeForArtifact({ relativePath: "a.md", text: original }, map);
  const next = applyInsertions(original, proposal.insertions);
  const before = evaluateArtifact({ relativePath: "a.md", text: original }).findings.length;
  const after = evaluateArtifact({ relativePath: "a.md", text: next }).findings.length;
  assert.ok(after < before, `findings must decrease: ${before} -> ${after}`);
  assert.equal(after, 0, "a fully declared doc_type should reach conformance");
});

test("the pass is idempotent", () => {
  const map = { "Runtime Contract": "docs harness layer" };
  const original = build(claiming);
  const once = applyInsertions(
    original, proposeForArtifact({ relativePath: "a.md", text: original }, map).insertions,
  );
  const second = proposeForArtifact({ relativePath: "a.md", text: once }, map);
  assert.deepEqual(second.insertions, []);
  assert.equal(applyInsertions(once, second.insertions), once);
});

test("the plan is deterministic, digest-bound, and reports owner leverage", () => {
  const artifacts = [
    { relativePath: "b.md", text: build(claiming) },
    { relativePath: "a.md", text: build({ ...claiming, doc_type: '"Lifecycle Capability"' }) },
  ];
  const first = buildPlan(artifacts);
  const second = buildPlan([...artifacts].reverse());
  assert.equal(first.planDigest, second.planDigest, "file order must not change the digest");
  assert.equal(first.mutation, false);
  assert.deepEqual(first.files.map((file) => file.relativePath), ["a.md", "b.md"]);
  assert.equal(first.ownerDecisionsPending.length, 2);
  assert.equal(first.ownerDecisionsPending[0].artifacts, 1);
});

test("frontmatter is never authored where none exists", () => {
  const proposal = proposeForArtifact({ relativePath: "a.md", text: "no frontmatter\n" });
  assert.equal(proposal.disposition, "needs-decision");
  assert.deepEqual(proposal.insertions, []);
  assert.throws(() => applyInsertions("no frontmatter\n", [{ key: "k", value: "v" }]),
    /unterminated frontmatter/);
});
