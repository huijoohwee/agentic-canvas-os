import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  FACTS_COMPACTED_CONTRACTS,
  XR_INVOCATION_BINDINGS,
  XR_INVOCATION_COMMANDS,
  XR_INVOCATION_SEMANTICS,
  validateXrInvocationContractDocuments,
} from "../scripts/xr-invocation-contract.mjs";

const documentNames = [
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

test("repository keeps the source-backed Camera and XR invocation catalog exact", () => {
  assert.equal(FACTS_COMPACTED_CONTRACTS.layer_contract.dictionaries, "direct token definitions for /, #, and @ invocation grammar");
  assert.equal(FACTS_COMPACTED_CONTRACTS.prompt_preset_contract.semantic_contract_authority, "PROBE-TREE.md");
  assert.deepEqual(XR_INVOCATION_COMMANDS, [
    "/camera.select",
    "/xr.stage",
    "/xr.place",
    "/xr.transform",
    "/xr.label",
    "/xr.remove",
    "/xr.physics",
    "/xr.present",
  ]);
  assert.deepEqual(XR_INVOCATION_SEMANTICS, ["#transform", "#world", "#body", "#impulse", "#controller", "#reticle"]);
  assert.deepEqual(XR_INVOCATION_BINDINGS, ["@scene"]);
  assert.deepEqual(validateXrInvocationContractDocuments(repositoryDocuments), []);
});

test("FACTS compacted contracts fail on parsed-value drift", () => {
  const documents = withReplacement(
    "FACTS.md",
    'semantic_contract_authority: "PROBE-TREE.md"',
    'semantic_contract_authority: "DICTIONARY-COMMAND.md"',
  );
  const failures = validateXrInvocationContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("compacted prompt_preset_contract")), true);
});

test("a missing FACTS truth token fails the contract", () => {
  const documents = withReplacement(
    "FACTS.md",
    '"/xr.physics", "/xr.present", "/animation.control"',
    '"/xr.physics", "/animation.control"',
  );
  const failures = validateXrInvocationContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("truth_tokens.commands missing /xr.present")), true);
});

test("a missing canonical XR command fails the contract", () => {
  const documents = withReplacement("DICTIONARY-COMMAND.md", '  - "/xr.present"\n', "");
  const failures = validateXrInvocationContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("missing dictionary entry /xr.present")), true);
});

test("routing XR physics through Agentic ECS fails the ownership contract", () => {
  const documents = withReplacement(
    "DICTIONARY-SEMANTIC.md",
    "Agentic ECS remains a separate composition lane",
    "Agentic ECS owns the rendered physics body",
  );
  const failures = validateXrInvocationContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("#body row")), true);
});

test("granting camera access through the XR scene binding fails the boundary contract", () => {
  const documents = withReplacement(
    "DICTIONARY-BINDING.md",
    "Carries no camera or sensor grant",
    "Carries camera and sensor grants",
  );
  const failures = validateXrInvocationContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("@scene row")), true);
});
