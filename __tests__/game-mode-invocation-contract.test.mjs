import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  GAME_MODE_INVOCATION,
  GAME_MODE_WEB_MCP_TOOLS,
  validateGameModeInvocationContractDocuments,
} from "../scripts/game-mode-invocation-contract.mjs";

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

test("repository keeps one canonical Game Mode invocation tuple", () => {
  assert.deepEqual(GAME_MODE_INVOCATION, {
    command: "/game.mode",
    semantic: "#gameplay",
    binding: "@canvas",
    invocation: "/game.mode @canvas #gameplay",
  });
  assert.deepEqual(GAME_MODE_WEB_MCP_TOOLS, [
    "knowgrph.inspect_local_game_mode",
    "knowgrph.control_local_game_mode",
  ]);
  assert.deepEqual(validateGameModeInvocationContractDocuments(repositoryDocuments), []);
});

test("a missing canonical Game Mode command fails closed", () => {
  const documents = withReplacement("DICTIONARY-COMMAND.md", '  - "/game.mode"\n', "");
  const failures = validateGameModeInvocationContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("dictionary entry /game.mode")), true);
});

test("a Game Mode command alias fails the single-route contract", () => {
  const documents = withReplacement(
    "DICTIONARY-COMMAND.md",
    '  - "/game.mode"\n',
    '  - "/game.mode"\n  - "/game.fps"\n',
  );
  const failures = validateGameModeInvocationContractDocuments(documents);
  assert.equal(failures.includes("Game Mode invocation contract forbids alias /game.fps"), true);
});

test("a missing gameplay truth token fails the FACTS catalog", () => {
  const documents = withReplacement("FACTS.md", '"#pose", "#gameplay", "#action-path"', '"#pose", "#action-path"');
  const failures = validateGameModeInvocationContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("truth token catalog missing #gameplay")), true);
});

test("the shared Canvas binding requires one FACTS direct resolution", () => {
  const documents = withReplacement(
    "FACTS.md",
    '  "@canvas": "DICTIONARY-BINDING.md#@canvas"\n',
    "",
  );
  const failures = validateGameModeInvocationContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("direct resolution @canvas")), true);
});

test("Game Mode cannot move browser runtime ownership into the dictionary", () => {
  const documents = withReplacement(
    "DICTIONARY-COMMAND.md",
    "Knowgrph remains the single game, ECS, renderer, camera/input, and Decision-persistence owner",
    "Agentic Canvas OS becomes the game and renderer owner",
  );
  const failures = validateGameModeInvocationContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("DICTIONARY-COMMAND.md /game.mode row")), true);
});

test("Game Mode FACTS must preserve the exact Dev-only handoff", () => {
  const documents = withReplacement(
    "FACTS.md",
    "/game.mode @canvas #gameplay",
    "/game.mode #gameplay",
  );
  const failures = validateGameModeInvocationContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("FACTS.md Game Mode invocation catalog row")), true);
});
