import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SKILL_EVOLUTION_INVOCATION,
  SKILL_EVOLUTION_MCP_TOOL,
  SKILL_EVOLUTION_OPERATIONS,
  validateSkillEvolutionCleanRoomSources,
  validateSkillEvolutionContractDocuments,
} from "../scripts/skill-evolution-contract.mjs";

const documentNames = [
  "SKILL-EVOLUTION.md",
  "SKILLS.md",
  "DICTIONARY-COMMAND.md",
  "DICTIONARY-SEMANTIC.md",
  "DICTIONARY-BINDING.md",
  "FACTS.md",
  "HARNESS-CONTRACTS.md",
  "MCP-GATEWAY.md",
  "RUNTIME-READINESS.md",
  "RUNTIME-PROOF.md",
];

const repositoryDocuments = new Map(await Promise.all(documentNames.map(async (name) => [
  name,
  await readFile(new URL(`../docs/${name}`, import.meta.url), "utf8"),
])));

function withReplacement(name, before, after) {
  const documents = new Map(repositoryDocuments);
  const source = documents.get(name);
  assert.equal(source.includes(before), true, `${name} fixture is missing ${before}`);
  documents.set(name, source.replaceAll(before, after));
  return documents;
}

test("repository keeps one canonical resumable Skill Evolution contract", () => {
  assert.deepEqual(SKILL_EVOLUTION_INVOCATION, {
    command: "/skill.evolve",
    semantic: "#skill-evolution",
    bindings: ["@skill-catalog", "@skill-policy", "@runtime-proof", "@operator"],
    text: "/skill.evolve #skill-evolution @skill-catalog @skill-policy @runtime-proof @operator",
  });
  assert.equal(SKILL_EVOLUTION_MCP_TOOL, "knowgrph.skill.evolve");
  assert.deepEqual(SKILL_EVOLUTION_OPERATIONS, ["plan", "start", "step", "status", "cancel"]);
  assert.deepEqual(validateSkillEvolutionContractDocuments(repositoryDocuments), []);
});

test("missing Skill Evolution policy binding fails closed", () => {
  const documents = withReplacement(
    "DICTIONARY-COMMAND.md",
    "`@skill-catalog`, `@skill-policy`, `@runtime-proof`, `@operator`",
    "`@skill-catalog`, `@runtime-proof`, `@operator`",
  );
  const failures = validateSkillEvolutionContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("Skill Evolution command: missing @skill-policy")), true);
});

test("a training alias fails the single-route contract", () => {
  const documents = withReplacement(
    "DICTIONARY-COMMAND.md",
    '  - "/skill.evolve"\n',
    '  - "/skill.evolve"\n  - "/skill.train"\n',
  );
  const failures = validateSkillEvolutionContractDocuments(documents);
  assert.equal(failures.includes("DICTIONARY-COMMAND.md: forbidden duplicate Skill Evolution alias /skill.train"), true);
});

test("mini-batch and source-revision gates are mandatory", () => {
  const noMiniBatch = withReplacement("SKILL-EVOLUTION.md", "miniBatchSize", "candidateChunkSize");
  assert.equal(
    validateSkillEvolutionContractDocuments(noMiniBatch).some((failure) => failure.includes("missing miniBatchSize")),
    true,
  );

  const noRevision = withReplacement("SKILL-EVOLUTION.md", "sourceRevision", "sourceCommit");
  assert.equal(
    validateSkillEvolutionContractDocuments(noRevision).some((failure) => failure.includes("missing sourceRevision")),
    true,
  );

  const noCandidateAdapter = withReplacement("SKILL-EVOLUTION.md", "candidateAdapter", "candidateGenerator");
  assert.equal(
    validateSkillEvolutionContractDocuments(noCandidateAdapter).some((failure) => failure.includes("missing candidateAdapter")),
    true,
  );

  const noNormalizedChars = withReplacement("SKILL-EVOLUTION.md", "normalizedChars", "characterCount");
  assert.equal(
    validateSkillEvolutionContractDocuments(noNormalizedChars).some((failure) => failure.includes("missing normalizedChars")),
    true,
  );
});

test("review-only and frozen-model result flags are mandatory", () => {
  const documents = withReplacement("SKILL-EVOLUTION.md", "modelWeightsMutated: false", "modelWeightsMutated: true");
  const failures = validateSkillEvolutionContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("missing modelWeightsMutated: false")), true);
});

test("learning rate remains an epoch-decayed text schedule", () => {
  const documents = withReplacement(
    "SKILL-EVOLUTION.md",
    "learningRate: { initial, decay, floor }",
    "learningRate: number",
  );
  const failures = validateSkillEvolutionContractDocuments(documents);
  assert.equal(
    failures.some((failure) => failure.includes("missing learningRate: { initial, decay, floor }")),
    true,
  );
});

test("planning separates exact structural ceilings from metered run caps", () => {
  for (const marker of [
    "exact structural, candidate, call, or mutation ceiling",
    "not precomputed worst-case estimates",
    "hard run caps enforced at adapter-call boundaries",
  ]) {
    const documents = withReplacement("SKILL-EVOLUTION.md", marker, "REMOVED_MARKER");
    assert.equal(
      validateSkillEvolutionContractDocuments(documents).some((failure) => failure.includes(`missing ${marker}`)),
      true,
    );
  }
});

test("runtime hardening remains part of the canonical contract", () => {
  for (const marker of [
    "source-bound per-call usage envelopes",
    "independently computes operation count",
    "materialize the canonical parent and candidate artifacts",
    "restricted by contract to inference-only execution",
    "deterministic transition id, call id",
    "distinct sanitized subprocesses",
    "canonicalized to 12 decimal places",
  ]) {
    const documents = withReplacement("SKILL-EVOLUTION.md", marker, "REMOVED_MARKER");
    assert.equal(
      validateSkillEvolutionContractDocuments(documents).some((failure) => failure.includes(`missing ${marker}`)),
      true,
    );
  }
});

test("shared harness redirects to the canonical owner instead of defining a legacy shape", () => {
  const documents = withReplacement(
    "HARNESS-CONTRACTS.md",
    "Load the canonical request from `SKILL-EVOLUTION.md`.",
    "`{ skillId, evalPacket, candidateDiff }`",
  );
  const failures = validateSkillEvolutionContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("must redirect")), true);
});

test("strict directional metrics, candidate roles, and validation isolation are mandatory", () => {
  for (const marker of [
    "workingScore > championScore",
    "workingScore < championScore",
    "workingCandidate",
    "champion",
    "promotedCandidate",
    "candidate adapter receives no validation",
    "validation: { adapterCalls, tokens, costUsd, durationMs }",
  ]) {
    const documents = withReplacement("SKILL-EVOLUTION.md", marker, "REMOVED_MARKER");
    assert.equal(
      validateSkillEvolutionContractDocuments(documents).some((failure) => failure.includes(`missing ${marker}`)),
      true,
    );
  }
});

test("ACOS contract cannot claim runtime-ready before integrated Knowgrph proof", () => {
  const documents = withReplacement(
    "SKILL-EVOLUTION.md",
    'status: "spec-complete"',
    'status: "runtime-ready"',
  );
  const failures = validateSkillEvolutionContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes('missing status: "spec-complete"')), true);
});

test("clean-room source may not become a dependency", async () => {
  const documents = withReplacement(
    "SKILL-EVOLUTION.md",
    'external_dependency: "forbidden"',
    'external_dependency: "required"',
  );
  const failures = validateSkillEvolutionContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("clean-room dependency boundary")), true);

  const forbiddenName = ["skill", "opt"].join("");
  const specifier = `@microsoft/${forbiddenName}`;
  assert.deepEqual(validateSkillEvolutionCleanRoomSources({
    packageText: JSON.stringify({ dependencies: { [specifier]: "1.0.0" } }),
  }), ["package.json: forbidden SkillOpt dependency reference"]);
  assert.deepEqual(validateSkillEvolutionCleanRoomSources({
    lockfileText: JSON.stringify({ packages: { [`node_modules/${specifier}`]: {} } }),
  }), ["package-lock.json: forbidden SkillOpt dependency reference"]);
  assert.deepEqual(validateSkillEvolutionCleanRoomSources({
    modules: new Map([
      ["src/static.js", `import optimizer from "${specifier}";`],
      ["src/dynamic.js", `const optimizer = await import("${specifier}");`],
      ["src/common.cjs", `const optimizer = require("${specifier}");`],
    ]),
  }), [
    `src/static.js: forbidden SkillOpt import ${specifier}`,
    `src/dynamic.js: forbidden SkillOpt import ${specifier}`,
    `src/common.cjs: forbidden SkillOpt import ${specifier}`,
  ]);

  const packageText = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.deepEqual(validateSkillEvolutionCleanRoomSources({ packageText }), []);
});
