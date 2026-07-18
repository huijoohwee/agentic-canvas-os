import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  PROBE_TREE_CLARIFICATION_TOPICS,
  validateProbeTreeContractDocuments,
} from "../scripts/probe-tree-contract.mjs";

const documentNames = [
  "PROBE-TREE.md",
  "PROMPT-PRESETS.md",
  "FACTS.md",
  "DICTIONARY-COMMAND.md",
  "DICTIONARY-SEMANTIC.md",
  "DICTIONARY-BINDING.md",
];

const repositoryDocuments = new Map(await Promise.all(documentNames.map(async (name) => [
  name,
  await readFile(new URL(`../docs/${name}`, import.meta.url), "utf8"),
])));

function withReplacement(name, before, after) {
  const documents = new Map(repositoryDocuments);
  const source = documents.get(name);
  assert.equal(source.includes(before), true, `${name} fixture is missing ${before}`);
  documents.set(name, source.replace(before, after));
  return documents;
}

test("repository Probe-Tree contract keeps action topics semantic and bounded", () => {
  assert.deepEqual(PROBE_TREE_CLARIFICATION_TOPICS, ["RECOMMEND", "COMPARE", "ASSESS", "PLAN"]);
  assert.deepEqual(validateProbeTreeContractDocuments(repositoryDocuments), []);
});

test("removing an action-topic class fails the contract", () => {
  const documents = withReplacement(
    "PROBE-TREE.md",
    '["RECOMMEND", "COMPARE", "ASSESS", "PLAN"]',
    '["RECOMMEND", "COMPARE", "ASSESS"]',
  );
  const failures = validateProbeTreeContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("PROBE-TREE.md: clarification_topics")), true);
});

test("mechanical action-verb terminal classification fails the contract", () => {
  const documents = withReplacement(
    "PROBE-TREE.md",
    '"runtime-recognized selected-child terminal continuation only"',
    '"root action verb or selected-child terminal continuation"',
  );
  const failures = validateProbeTreeContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("terminal_bypass")), true);
});

test("mechanical clarification cards fail the contract", () => {
  const documents = withReplacement(
    "PROBE-TREE.md",
    'clarification_card_kind: "semantic"',
    'clarification_card_kind: "mechanical"',
  );
  const failures = validateProbeTreeContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("clarification_card_kind")), true);
});

test("stale card-local routing fails the contract", () => {
  const documents = withReplacement(
    "PROBE-TREE.md",
    'model_route: "active Chat provider, endpoint, and model"',
    'model_route: "card-local provider and model"',
  );
  const failures = validateProbeTreeContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("model_route")), true);
});

test("hardcoded or zero-model fallback permission fails the contract", () => {
  const documents = withReplacement(
    "PROBE-TREE.md",
    '"fail closed; query-specific hardcoding and zero-model fallback cards are forbidden"',
    '"fallback cards are permitted"',
  );
  const failures = validateProbeTreeContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("fallback_policy")), true);
});

test("preset projection drift fails the canonical Probe-Tree contract", () => {
  const documents = withReplacement(
    "PROMPT-PRESETS.md",
    'clarification_action_topics: ["RECOMMEND", "COMPARE", "ASSESS", "PLAN"]',
    'clarification_action_topics: ["RECOMMEND", "COMPARE", "ASSESS"]',
  );
  const failures = validateProbeTreeContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("clarification_action_topics")), true);
});

test("keyword-only matching fails the semantic case-insensitive contract", () => {
  const documents = withReplacement(
    "PROBE-TREE.md",
    'clarification_topic_match: "semantic and case-insensitive"',
    'clarification_topic_match: "case-sensitive keyword only"',
  );
  const failures = validateProbeTreeContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("clarification_topic_match")), true);
});
