import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  REQUIRED_PROMPT_PRESET_IDS,
  validatePromptPresetContractDocuments,
} from "../scripts/prompt-preset-contract.mjs";

const documentNames = ["PROMPT-PRESETS.md", "FACTS.md", "DICTIONARY-COMMAND.md", "SKILLS.md"];
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

test("repository prompt presets expose fourteen source-backed Chat and MCP routes", () => {
  assert.equal(REQUIRED_PROMPT_PRESET_IDS.length, 14);
  assert.deepEqual(validatePromptPresetContractDocuments(repositoryDocuments), []);
});

test("procedural asset creation cannot route through image admission or provider execution", () => {
  for (const [before, after] of [
    ["/asset.create @text #procedural-asset", "/asset.create @image-to-glb #image-to-glb"],
    ['runtime_command: "/asset.create"', 'runtime_command: "/image.to-glb"'],
    ['semantic_contract: "PROCEDURAL-ASSET-SKILL.md"', 'semantic_contract: "IMAGE-TO-GLB-SKILL.md"'],
    ['invocation_modes: ["native-chat-response", "mcp-invocation"]', 'invocation_modes: ["llm-chat-response", "mcp-invocation"]'],
  ]) {
    const failures = validatePromptPresetContractDocuments(withReplacement("PROMPT-PRESETS.md", before, after));
    assert.ok(failures.some(failure => failure.includes("procedural-asset")), before);
  }
});

test("procedural asset preset preserves executable-code, failure recovery and export boundaries", () => {
  for (const marker of [
    "Never execute supplied JavaScript", "last-valid asset and unapplied draft",
    "text-only validated evidence", "GLB alone does not preserve procedural logic",
  ]) {
    const failures = validatePromptPresetContractDocuments(withReplacement("PROMPT-PRESETS.md", marker, "removed boundary"));
    assert.ok(failures.some(failure => failure.includes("safety and editability")), marker);
  }
});

test("missing semantic extension preset fails closed", () => {
  const documents = withReplacement(
    "PROMPT-PRESETS.md",
    '  - id: "investment-plan-assessment"',
    '  - id: "investment-plan-assessment-disabled"',
  );
  const failures = validatePromptPresetContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("missing required preset investment-plan-assessment")), true);
});

test("Physics Playground keeps the existing native controller route", () => {
  const documents = withReplacement("PROMPT-PRESETS.md", "operation=develop-run mode=ball", "operation=generate mode=ball");
  assert.ok(validatePromptPresetContractDocuments(documents).some(failure => failure.includes("native Physics Playground controller")));
});

test("removing LLM Chat response mode fails closed", () => {
  const documents = withReplacement(
    "PROMPT-PRESETS.md",
    'invocation_modes: ["llm-chat-response", "mcp-invocation"]',
    'invocation_modes: ["mcp-invocation"]',
  );
  const failures = validatePromptPresetContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("invocation_modes")), true);
});

test("stale Chat routing fails the catalog contract", () => {
  const documents = withReplacement(
    "PROMPT-PRESETS.md",
    'chat_route: "active Chat provider, endpoint, and model"',
    'chat_route: "stale card-local model"',
  );
  const failures = validatePromptPresetContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("chat_route")), true);
});

test("MCP token must resolve the same runtime command", () => {
  const documents = withReplacement(
    "PROMPT-PRESETS.md",
    'mcp_token: "/video-agent"',
    'mcp_token: "/query"',
  );
  const failures = validatePromptPresetContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("mcp_token must equal runtime_command")), true);
});

test("unregistered runtime command fails MCP resolution", () => {
  const documents = withReplacement(
    "DICTIONARY-COMMAND.md",
    '  - "/sme-care-agent"',
    '  - "/sme-care-agent-disabled"',
  );
  const failures = validatePromptPresetContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("missing dictionary entry /sme-care-agent")), true);
});

test("semantic extension prompts cannot replace active context with a fixed query", () => {
  const documents = withReplacement(
    "PROMPT-PRESETS.md",
    "active request and workspace sources",
    "fixed plantation query",
  );
  const failures = validatePromptPresetContractDocuments(documents);
  assert.equal(failures.some((failure) => failure.includes("must remain generic")), true);
});

test("Launch Copilot selection cannot preselect drafting or publication", () => {
  for (const action of ["draft", "approve"]) {
    const documents = withReplacement("PROMPT-PRESETS.md", "/launch-copilot outline reference", `/launch-copilot ${action} reference`);
    assert.ok(validatePromptPresetContractDocuments(documents).some(failure => failure.includes("native reference-only outline")));
  }
});
