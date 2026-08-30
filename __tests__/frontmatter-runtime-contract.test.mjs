import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  FINDING_KEY_ABSENT,
  FINDING_RUNG_CONFLATED,
  FINDING_UNNAMED_EVALUATOR,
  FINDING_UNPROVEN,
  TIER_IDENTITY,
  evaluateArtifact,
  evaluateCorpus,
  evaluateRatchet,
  parseFrontmatter,
  runFrontmatterContract,
  triggeredTiers,
} from "../scripts/frontmatter-runtime-contract.mjs";

const build = (keys) => `---\n${Object.entries(keys)
  .map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n\nbody\n`;

const identity = {
  title: '"T"', doc_type: '"Runtime Contract"', date: "2026-08-30",
  lang: '"en-US"', frontmatter_contract: '"required"',
};
const conformant = {
  ...identity, schema: '"x/v1"', owner: "harness",
  local_rung: "spec-complete", delivered_rung: "undocumented",
  runtime_proof: "P.md", evaluator: "npm run check",
};

const typesOf = (result) => result.findings.map((finding) => finding.type);

test("a fully populated artifact conforms", () => {
  const result = evaluateArtifact({ relativePath: "a.md", text: build(conformant) });
  assert.deepEqual(result.findings, []);
  assert.equal(result.conformant, true);
});

test("tiers derive from the artifact's own claims, never its path", () => {
  const draft = triggeredTiers(parseFrontmatter(build({ ...identity, local_rung: "draft" })));
  assert.equal(draft.claimsReadiness, false, "draft claims nothing, so Tier 4 is untriggered");
  assert.equal(draft.evidence, false);
  assert.equal(draft.accountability, true, "a declared rung still requires accountability");

  const ready = triggeredTiers(parseFrontmatter(build({ ...identity, local_rung: "runtime-ready" })));
  assert.equal(ready.claimsReadiness, true);
  assert.equal(ready.evidence, true);

  const bare = triggeredTiers(parseFrontmatter(build(identity)));
  assert.equal(bare.accountability, false, "no rung means no accountability tier");
  assert.equal(bare.identity, true, "Tier 1 always binds");
});

test("status stands in for local_rung, because one corpus already requires it", () => {
  const tiers = triggeredTiers(parseFrontmatter(build({ ...identity, status: '"runtime-ready"' })));
  assert.equal(tiers.localRung, "runtime-ready");
  assert.equal(tiers.claimsReadiness, true);
});

test("every Tier 1 key is required and reported by name", () => {
  for (const key of TIER_IDENTITY) {
    const partial = { ...conformant };
    delete partial[key];
    const result = evaluateArtifact({ relativePath: "a.md", text: build(partial) });
    assert.ok(
      result.findings.some((f) => f.type === FINDING_KEY_ABSENT && f.detail === key),
      `${key} must be reported absent by name`,
    );
  }
});

test("an absent delivered_rung is rung-conflated, not merely a missing key", () => {
  const partial = { ...conformant };
  delete partial.delivered_rung;
  const result = evaluateArtifact({ relativePath: "a.md", text: build(partial) });
  assert.ok(typesOf(result).includes(FINDING_RUNG_CONFLATED));
});

test("local_rung disagreeing with status is conflated", () => {
  const result = evaluateArtifact({
    relativePath: "a.md",
    text: build({ ...conformant, status: '"runtime-ready"' }),
  });
  assert.ok(result.findings.some((f) => f.type === FINDING_RUNG_CONFLATED
    && f.detail.includes("disagree")));
});

test("a readiness claim without proof or evaluator fails closed", () => {
  const partial = { ...conformant };
  delete partial.runtime_proof;
  delete partial.evaluator;
  const result = evaluateArtifact({ relativePath: "a.md", text: build(partial) });
  assert.ok(typesOf(result).includes(FINDING_UNPROVEN));
  assert.ok(typesOf(result).includes(FINDING_UNNAMED_EVALUATOR));
});

test("the proof short form is accepted only as a substitute for runtime_proof", () => {
  const short = { ...conformant };
  delete short.runtime_proof;
  short.proof = "P.md";
  assert.deepEqual(evaluateArtifact({ relativePath: "a.md", text: build(short) }).findings, []);
});

test("an undocumented delivered rung does not itself trigger evidence", () => {
  const tiers = triggeredTiers(parseFrontmatter(build({ ...identity, local_rung: "undocumented" })));
  assert.equal(tiers.claimsReadiness, false);
});

test("malformed dates and forbidden values are reported", () => {
  const badDate = evaluateArtifact({
    relativePath: "a.md", text: build({ ...conformant, date: "30-08-2026" }),
  });
  assert.ok(badDate.findings.some((f) => f.detail.includes("not YYYY-MM-DD")));

  const leak = evaluateArtifact({
    relativePath: "a.md", text: build({ ...conformant, owner: "/Users/someone/repo" }),
  });
  assert.ok(leak.findings.some((f) => f.detail.includes("forbidden value")));
});

test("absent frontmatter is a single typed finding, never a crash", () => {
  const result = evaluateArtifact({ relativePath: "a.md", text: "no frontmatter here\n" });
  assert.equal(result.conformant, false);
  assert.equal(result.findings.length, 1);
  assert.equal(parseFrontmatter("nope"), null);
});

// An identity-only artifact claims nothing and is conformant by design, so a
// non-conformant fixture must actually claim readiness it cannot support.
const claimsWithoutEvidence = { ...identity, local_rung: "runtime-ready" };

test("an artifact that claims nothing is conformant on Tier 1 alone", () => {
  assert.deepEqual(evaluateArtifact({ relativePath: "a.md", text: build(identity) }).findings, []);
});

test("corpus conformance is exact under integer arithmetic", () => {
  const report = evaluateCorpus([
    { relativePath: "good.md", text: build(conformant) },
    { relativePath: "bad.md", text: build(claimsWithoutEvidence) },
  ]);
  assert.equal(report.total, 2);
  assert.equal(report.conformant, 1);
  assert.equal(report.conformancePermille, 500);
  assert.equal(report.mutation, false);
  assert.equal(evaluateCorpus([]).conformancePermille, 1_000);
});

test("the ratchet blocks new debt and requires resolved debt to leave", () => {
  const report = evaluateCorpus([{ relativePath: "bad.md", text: build(claimsWithoutEvidence) }]);
  assert.deepEqual(evaluateRatchet({ report, baseline: ["bad.md"] }), [],
    "recorded debt is held, not failed");

  const undeclared = evaluateRatchet({ report, baseline: [] });
  assert.equal(undeclared.length, 1);
  assert.match(undeclared[0], /not recorded debt/);

  const stale = evaluateRatchet({
    report: evaluateCorpus([{ relativePath: "good.md", text: build(conformant) }]),
    baseline: ["good.md"],
  });
  assert.equal(stale.length, 1);
  assert.match(stale[0], /remove its baseline entry/);
});

test("the live corpus satisfies its recorded baseline", async () => {
  const { failures } = await runFrontmatterContract();
  assert.deepEqual(failures, []);
});

test("the reference artifact conforms, and the guidelines owner is self-conformant", async () => {
  const reference = await readFile(
    new URL("../docs/SYSTEM-PROMPT-RUNTIME.md", import.meta.url), "utf8",
  );
  assert.deepEqual(
    evaluateArtifact({ relativePath: "SYSTEM-PROMPT-RUNTIME.md", text: reference }).findings,
    [], "the declared reference shape must satisfy the contract it references",
  );
});
