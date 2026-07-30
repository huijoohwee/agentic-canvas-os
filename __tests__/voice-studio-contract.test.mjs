import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  VOICE_STUDIO_COMMAND,
  VOICE_STUDIO_MCP_TOOL,
  VOICE_STUDIO_OPERATIONS,
  VOICE_STUDIO_ROUTES,
  readVoiceStudioCleanRoomInputs,
  validateVoiceStudioCleanRoomSources,
  validateVoiceStudioContractDocuments,
  validateVoiceStudioPlanningRow,
} from "../scripts/voice-studio-contract.mjs";

const documentNames = [
  "VOICE-STUDIO.md",
  "FACTS.md",
  "DICTIONARY-COMMAND.md",
  "DICTIONARY-SEMANTIC.md",
  "DICTIONARY-BINDING.md",
  "SKILLS.md",
  "HARNESS-CONTRACTS.md",
  "MCP-GATEWAY.md",
  "RUNTIME-READINESS.md",
  "RUNTIME-PROOF.md",
  "VALIDATION-RUNBOOK.md",
];
const repositoryDocuments = new Map(await Promise.all(documentNames.map(async (name) => [
  name,
  await readFile(new URL(`../docs/${name}`, import.meta.url), "utf8"),
])));
const repositoryPlanning = await readFile(new URL("../todo/2026-07.md", import.meta.url), "utf8");
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function withReplacement(name, before, after) {
  const documents = new Map(repositoryDocuments);
  const source = documents.get(name);
  assert.equal(source.includes(before), true, `${name} fixture is missing ${before}`);
  documents.set(name, source.replace(before, after));
  return documents;
}

test("repository keeps one canonical AI Voice Studio contract", async () => {
  assert.equal(VOICE_STUDIO_COMMAND, "/voice.studio");
  assert.deepEqual(VOICE_STUDIO_OPERATIONS, ["clone", "dictate", "create"]);
  assert.equal(VOICE_STUDIO_MCP_TOOL, "knowgrph.voice.studio");
  assert.deepEqual(VOICE_STUDIO_ROUTES, {
    clone: "/voice.studio #voice-clone @audio @voice-profile @approval-gate @cost-log @runtime-proof",
    dictate: "/voice.studio #speech-to-text @audio @text @approval-gate @cost-log @runtime-proof",
    create: "/voice.studio #text-to-speech @text @voice-profile @audio @approval-gate @cost-log @runtime-proof",
  });
  assert.deepEqual(validateVoiceStudioContractDocuments(repositoryDocuments), []);
  assert.deepEqual(validateVoiceStudioPlanningRow(repositoryPlanning), []);
  const cleanRoomInputs = await readVoiceStudioCleanRoomInputs(repositoryRoot);
  assert.deepEqual(validateVoiceStudioCleanRoomSources(cleanRoomInputs), []);
});

test("new and reused route tokens remain singular and directly resolvable", () => {
  const missingCommand = withReplacement("DICTIONARY-COMMAND.md", '  - "/voice.studio"\n', "");
  assert.equal(
    validateVoiceStudioContractDocuments(missingCommand)
      .some((failure) => failure.includes("canonical dictionary entry /voice.studio")),
    true,
  );

  const duplicateTruth = withReplacement(
    "FACTS.md",
    '"#voice-clone", "#speech-to-text"',
    '"#voice-clone", "#voice-clone", "#speech-to-text"',
  );
  assert.equal(
    validateVoiceStudioContractDocuments(duplicateTruth)
      .some((failure) => failure.includes("truth_tokens.semantics must contain #voice-clone exactly once")),
    true,
  );

  const missingResolution = withReplacement(
    "FACTS.md",
    '  "@voice-profile": "DICTIONARY-BINDING.md#@voice-profile"\n',
    "",
  );
  assert.equal(
    validateVoiceStudioContractDocuments(missingResolution)
      .some((failure) => failure.includes("direct resolution @voice-profile")),
    true,
  );

  const duplicateAudio = withReplacement(
    "DICTIONARY-BINDING.md",
    '  - "@audio"\n',
    '  - "@audio"\n  - "@audio"\n',
  );
  assert.equal(
    validateVoiceStudioContractDocuments(duplicateAudio)
      .some((failure) => failure.includes("canonical dictionary entry @audio")),
    true,
  );
});

test("operation routes are exact and operation-specific slash aliases stay forbidden", () => {
  const weakenedRoute = withReplacement(
    "VOICE-STUDIO.md",
    `  clone: "${VOICE_STUDIO_ROUTES.clone}"`,
    '  clone: "/voice.studio #voice-clone @voice-profile"',
  );
  assert.equal(
    validateVoiceStudioContractDocuments(weakenedRoute)
      .some((failure) => failure.includes("frontmatter clone route")),
    true,
  );

  const aliasedCommand = withReplacement(
    "DICTIONARY-COMMAND.md",
    '  - "/voice.studio"\n',
    '  - "/voice.studio"\n  - "/voice.clone"\n',
  );
  assert.equal(
    validateVoiceStudioContractDocuments(aliasedCommand)
      .includes("Voice Studio contract forbids command alias /voice.clone"),
    true,
  );

  const missingComposition = withReplacement(
    "DICTIONARY-SEMANTIC.md",
    `| \`${VOICE_STUDIO_ROUTES.dictate}\` |`,
    "| `/voice.studio #speech-to-text @audio @text` |",
  );
  assert.equal(
    validateVoiceStudioContractDocuments(missingComposition)
      .some((failure) => failure.includes(`expected one exact ${VOICE_STUDIO_ROUTES.dictate}`)),
    true,
  );
});

test("operation vocabulary and safe promotion status fail closed on drift", () => {
  const extraOperation = withReplacement(
    "VOICE-STUDIO.md",
    'operations: ["clone", "dictate", "create"]',
    'operations: ["clone", "dictate", "create", "impersonate"]',
  );
  assert.equal(
    validateVoiceStudioContractDocuments(extraOperation)
      .some((failure) => failure.includes('operations: ["clone", "dictate", "create"]')),
    true,
  );

  const prematurePromotion = withReplacement(
    "VOICE-STUDIO.md",
    'status: "spec-complete"',
    'status: "runtime-ready"',
  );
  const failures = validateVoiceStudioContractDocuments(prematurePromotion);
  assert.equal(failures.some((failure) => failure.includes("runtime-ready status is forbidden")), true);
});

test("one MCP wire identity preserves ACOS metadata and Knowgrph execution ownership", () => {
  const duplicateTool = withReplacement(
    "MCP-GATEWAY.md",
    `| \`${VOICE_STUDIO_MCP_TOOL}\` |`,
    `| \`${VOICE_STUDIO_MCP_TOOL}\` |\n| \`${VOICE_STUDIO_MCP_TOOL}\` |`,
  );
  assert.equal(
    validateVoiceStudioContractDocuments(duplicateTool)
      .some((failure) => failure.includes(`MCP-GATEWAY.md: ${VOICE_STUDIO_MCP_TOOL}`)),
    true,
  );

  const movedOwner = withReplacement(
    "MCP-GATEWAY.md",
    "Knowgrph owns execution, media identity, persistence, and proof",
    "Agentic Canvas OS owns execution, media identity, persistence, and proof",
  );
  assert.equal(
    validateVoiceStudioContractDocuments(movedOwner)
      .some((failure) => failure.includes("Voice Studio owner separation")),
    true,
  );
});

test("consent, rights, revocation, disclosure, provenance, and pre-spend gates are mandatory", () => {
  for (const marker of [
    "Consent and `@approval-gate` are separate requirements.",
    "Revocation immediately blocks new `create` work",
    "Raw recordings, normalized audio, derived voice profiles, transcripts, requested text, and rendered audio remain separate immutable artifact kinds.",
    "fail-before-spend",
  ]) {
    const documents = withReplacement("VOICE-STUDIO.md", marker, "REMOVED_SAFETY_MARKER");
    assert.equal(
      validateVoiceStudioContractDocuments(documents)
        .some((failure) => failure.includes(`missing ${marker}`)),
      true,
    );
  }
});

test("clean-room guard rejects manifest, lockfile, source path, and source content references", async () => {
  const upstreamName = ["voice", "box"].join("");
  assert.deepEqual(validateVoiceStudioCleanRoomSources({
    packageText: JSON.stringify({ dependencies: { [upstreamName]: "1.0.0" } }),
  }), ["package.json: forbidden Voicebox manifest reference"]);
  assert.deepEqual(validateVoiceStudioCleanRoomSources({
    lockfileText: JSON.stringify({ packages: { [`node_modules/${upstreamName}`]: {} } }),
  }), ["package-lock.json: forbidden Voicebox manifest reference"]);
  assert.deepEqual(validateVoiceStudioCleanRoomSources({
    modules: new Map([[`src/${upstreamName}-adapter.js`, "export default {};"]]),
  }), [`src/${upstreamName}-adapter.js: forbidden Voicebox runtime source reference`]);
  assert.deepEqual(validateVoiceStudioCleanRoomSources({
    modules: new Map([["src/external-adapter.js", `import studio from "${upstreamName}";`]]),
  }), ["src/external-adapter.js: forbidden Voicebox runtime source reference"]);

  const cleanRoomInputs = await readVoiceStudioCleanRoomInputs(repositoryRoot);
  assert.deepEqual(validateVoiceStudioCleanRoomSources(cleanRoomInputs), []);
});

test("external dependency and similarity-review boundaries remain explicit", () => {
  const dependencyEnabled = withReplacement(
    "VOICE-STUDIO.md",
    'external_dependency: "forbidden"',
    'external_dependency: "required"',
  );
  assert.equal(
    validateVoiceStudioContractDocuments(dependencyEnabled)
      .some((failure) => failure.includes('external_dependency: "forbidden"')),
    true,
  );

  const missingReview = withReplacement(
    "VOICE-STUDIO.md",
    "A separate provenance and similarity review",
    "Automated scanning is sufficient",
  );
  assert.equal(
    validateVoiceStudioContractDocuments(missingReview)
      .some((failure) => failure.includes("A separate provenance and similarity review")),
    true,
  );
});

test("Markdown table shape rejects unescaped schema drift", () => {
  const malformedRow = withReplacement(
    "DICTIONARY-BINDING.md",
    "| `@voice-profile` | Bind one exact revision",
    "| `@voice-profile` | Bind one exact | revision",
  );
  assert.equal(
    validateVoiceStudioContractDocuments(malformedRow)
      .some((failure) => failure.includes("owning row @voice-profile: expected 4 columns")),
    true,
  );
});

test("planning ledger keeps one complete July 24 AI Voice Studio row", () => {
  const row = repositoryPlanning.split("\n")
    .find((line) => line.startsWith("| AI voice studio MCP invocation and clean-room runtime |"));
  const duplicate = `${repositoryPlanning}\n${row}\n`;
  assert.equal(
    validateVoiceStudioPlanningRow(duplicate).some((failure) => failure.includes("expected exactly one")),
    true,
  );

  const overlongDirective = repositoryPlanning.replace(
    "Define one `/voice.studio` command with clone, dictate, and create semantic routes;",
    `Define ${"bounded ".repeat(55)}voice studio routes;`,
  );
  assert.equal(
    validateVoiceStudioPlanningRow(overlongDirective).some((failure) => failure.includes("maximum is 50")),
    true,
  );
});
