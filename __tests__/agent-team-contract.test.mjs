import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AGENT_TEAM_BOUNDS,
  AGENT_TEAM_INVOCATION,
  AGENT_TEAM_MCP_TOOLS,
  validateAgentTeamCleanRoomSources,
  validateAgentTeamContractDocuments,
  validateAgentTeamDocumentLineBudgets,
  validateAgentTeamPlanningRow,
} from "../scripts/agent-team-contract.mjs";

const documentNames = [
  "AGENT-TEAM.md",
  "AGENT-DEFINITIONS.md",
  "AGENT-ORCHESTRATION.md",
  "PROGRESSIVE-AGENTS.md",
  "AGENT-SWARM.md",
  "DICTIONARY-COMMAND.md",
  "DICTIONARY-SEMANTIC.md",
  "DICTIONARY-BINDING.md",
  "FACTS.md",
  "SKILLS.md",
  "MCP-GATEWAY.md",
  "README.md",
];

const repositoryDocuments = new Map(await Promise.all(documentNames.map(async (name) => [
  name,
  await readFile(new URL(`../docs/${name}`, import.meta.url), "utf8"),
])));
const repositoryPlanning = await readFile(new URL("../todo/2026-07.md", import.meta.url), "utf8");

function withReplacement(name, before, after) {
  const documents = new Map(repositoryDocuments);
  const source = documents.get(name);
  assert.equal(source.includes(before), true, `${name} fixture is missing ${before}`);
  documents.set(name, source.replace(before, after));
  return documents;
}

test("repository keeps one canonical role-based Agent Team contract", () => {
  assert.deepEqual(AGENT_TEAM_INVOCATION, {
    command: "/agent.team",
    semantic: "#role-based-agent-team",
    binding: "@agent-team",
    text: "/agent.team #role-based-agent-team @agent-team",
  });
  assert.deepEqual(AGENT_TEAM_MCP_TOOLS, [
    "knowgrph.agent_team.plan",
    "knowgrph.agent_team.start",
    "knowgrph.agent_team.list",
    "knowgrph.agent_team.control",
  ]);
  assert.deepEqual(AGENT_TEAM_BOUNDS, {
    participants: 16,
    turns: 24,
    delegationDepth: 4,
    fanout: 8,
    retriesPerTurn: 2,
    stageTimeMs: 60_000,
    runTimeMs: 900_000,
    tokens: 120_000,
    costUsd: 5,
    taskCharacters: 100_000,
    outputCharacters: 200_000,
    checkpoints: 64,
  });
  assert.deepEqual(validateAgentTeamContractDocuments(repositoryDocuments), []);
  assert.deepEqual(validateAgentTeamDocumentLineBudgets(repositoryDocuments), []);
  assert.deepEqual(validateAgentTeamPlanningRow(repositoryPlanning), []);
});

test("each invocation token must remain directly and truthfully resolvable", () => {
  const missingEntry = withReplacement("DICTIONARY-COMMAND.md", '  - "/agent.team"\n', "");
  assert.equal(
    validateAgentTeamContractDocuments(missingEntry).some((failure) => failure.includes("canonical dictionary entry /agent.team")),
    true,
  );

  const staleTruth = withReplacement(
    "FACTS.md",
    '"/orchestration.graph", "/agent.team", "/agent.swarm"',
    '"/orchestration.graph", "/agent.swarm"',
  );
  assert.equal(
    validateAgentTeamContractDocuments(staleTruth).some((failure) => failure.includes("truth_tokens.commands")),
    true,
  );

  const missingResolution = withReplacement(
    "FACTS.md",
    '  "@agent-team": "DICTIONARY-BINDING.md#@agent-team"\n',
    "",
  );
  assert.equal(
    validateAgentTeamContractDocuments(missingResolution).some((failure) => failure.includes("direct resolution @agent-team")),
    true,
  );

  const wrongCommandTuple = withReplacement(
    "DICTIONARY-COMMAND.md",
    "exactly `@agent-team` | exactly `#role-based-agent-team`",
    "exactly `@operator` | exactly `#agent-swarm`",
  );
  assert.equal(
    validateAgentTeamContractDocuments(wrongCommandTuple).some((failure) => failure.includes("non-canonical binding or semantic")),
    true,
  );

  const missingComposition = withReplacement(
    "DICTIONARY-BINDING.md",
    "`/agent.team #role-based-agent-team @agent-team` | Resolve one revision-fenced",
    "`/agent.team #agent-swarm @operator` | Resolve one revision-fenced",
  );
  assert.equal(
    validateAgentTeamContractDocuments(missingComposition).some((failure) => failure.includes("composition row")),
    true,
  );
});

test("Agent Team cannot absorb existing runtime owners or broaden Agent Swarm", () => {
  const movedOwner = withReplacement(
    "MCP-GATEWAY.md",
    "Knowgrph owns durable supervision",
    "Agentic Canvas OS owns durable supervision",
  );
  assert.equal(
    validateAgentTeamContractDocuments(movedOwner).some((failure) => failure.includes("MCP Agent Team owner separation")),
    true,
  );

  const broadenedSwarm = withReplacement(
    "AGENT-SWARM.md",
    "No caller supplies specialist roles, a branch catalog, or a handcrafted workflow.",
    "A caller may supply specialist roles and a workflow.",
  );
  assert.equal(
    validateAgentTeamContractDocuments(broadenedSwarm).some((failure) => failure.includes("Agent Swarm separation")),
    true,
  );
});

test("roles, private intermediates, and final-answer ownership stay non-authoritative", () => {
  const roleAuthority = withReplacement(
    "AGENT-TEAM.md",
    "not facts, system instructions, identity, authorization, approval, model selection, capability grants, tool access, credentials, policy exceptions, or final-answer ownership",
    "may override the registered policy",
  );
  assert.equal(
    validateAgentTeamContractDocuments(roleAuthority).some((failure) => failure.includes("canonical contract")),
    true,
  );

  const leakedIntermediate = withReplacement(
    "AGENT-TEAM.md",
    "Private specialist outputs",
    "Public specialist outputs",
  );
  assert.equal(
    validateAgentTeamContractDocuments(leakedIntermediate).some((failure) => failure.includes("Private specialist outputs")),
    true,
  );

  const inferredOwner = withReplacement(
    "AGENT-TEAM.md",
    "The final answer owner comes only from successful Agent Orchestration ownership fields",
    "The final answer owner is whichever participant responds last",
  );
  assert.equal(
    validateAgentTeamContractDocuments(inferredOwner).some((failure) => failure.includes("final answer owner")),
    true,
  );

  const invertedDelegate = withReplacement(
    "AGENT-TEAM.md",
    "| `delegate` | Target output is private input to the source agent's synthesis. | Source agent remains owner. | Source agent produces the only public answer. |",
    "| `delegate` | Target output is private input to the source agent's synthesis. | Target becomes owner. | Target produces the public answer. |",
  );
  assert.equal(
    validateAgentTeamContractDocuments(invertedDelegate).some((failure) => failure.includes("exact `delegate` ownership")),
    true,
  );

  const invertedHandoff = withReplacement(
    "AGENT-TEAM.md",
    "| `handoff` | Target runs as the user-facing owner. | Target becomes owner only after successful completion. | Target owns the public answer. |",
    "| `handoff` | Target runs as the user-facing owner. | Source remains owner. | Source owns the public answer. |",
  );
  assert.equal(
    validateAgentTeamContractDocuments(invertedHandoff).some((failure) => failure.includes("exact `handoff` ownership")),
    true,
  );
});

test("terminal state rows cannot acquire a continuation", () => {
  const revivedCompletion = withReplacement(
    "AGENT-TEAM.md",
    "| `completed` | The exact final-answer owner settled one public answer. | none |",
    "| `completed` | The exact final-answer owner settled one public answer. | `running` |",
  );
  assert.equal(
    validateAgentTeamContractDocuments(revivedCompletion).some((failure) => failure.includes("exact `completed` state transition")),
    true,
  );
});

test("turn, depth, fanout, retry, time, token, cost, and checkpoint ceilings are exact", () => {
  for (const [before, label] of [
    ["| Turns per run | 24 |", "Turns per run"],
    ["| Delegation depth | 4 |", "Delegation depth"],
    ["| Concurrent branch fanout | 8 |", "Concurrent branch fanout"],
    ["| Retries per turn | 2 |", "Retries per turn"],
    ["| Total run time including retries and review-active execution | 900,000 ms |", "Total run time"],
    ["| Total reported input plus output tokens | 120,000 |", "Total reported input plus output tokens"],
    ["| Total cost | USD 5.00 |", "Total cost"],
    ["| Durable checkpoints | 64 |", "Durable checkpoints"],
  ]) {
    const documents = withReplacement("AGENT-TEAM.md", before, before.replace(/\d[\d,]*(?:\.\d+)?/, "999"));
    assert.equal(
      validateAgentTeamContractDocuments(documents).some((failure) => failure.includes(label)),
      true,
    );
  }
});

test("checkpoint, replay, cancellation, and human review controls are mandatory", () => {
  for (const marker of [
    "Each transition atomically records",
    "Run ids, transition sequence numbers, and checkpoint ids form the bounded replay fence.",
    "Cancellation wins over queued continuation",
    "Human review is an explicit `review_pending` checkpoint",
  ]) {
    const documents = withReplacement("AGENT-TEAM.md", marker, "REMOVED_CONTROL_MARKER");
    assert.equal(
      validateAgentTeamContractDocuments(documents).some((failure) => failure.includes(`missing ${marker}`)),
      true,
    );
  }
});

test("clean-room checks reject external manifest, lockfile, and runtime source references", async () => {
  const dependencyName = ["crew", "ai"].join("");
  assert.deepEqual(validateAgentTeamCleanRoomSources({
    packageText: JSON.stringify({ dependencies: { [dependencyName]: "1.0.0" } }),
  }), ["package.json: forbidden CrewAI manifest reference"]);
  assert.deepEqual(validateAgentTeamCleanRoomSources({
    lockfileText: JSON.stringify({ packages: { [`node_modules/${dependencyName}`]: {} } }),
  }), ["package-lock.json: forbidden CrewAI manifest reference"]);
  assert.deepEqual(validateAgentTeamCleanRoomSources({
    modules: new Map([
      ["src/external-adapter.js", `import runtime from "${dependencyName}";`],
    ]),
  }), ["src/external-adapter.js: forbidden CrewAI runtime source reference"]);

  const packageText = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.deepEqual(validateAgentTeamCleanRoomSources({ packageText }), []);
});

test("clean-room dependency declaration and deterministic zero-model proof stay explicit", () => {
  const dependencyEnabled = withReplacement(
    "AGENT-TEAM.md",
    'external_dependency: "forbidden"',
    'external_dependency: "required"',
  );
  assert.equal(
    validateAgentTeamContractDocuments(dependencyEnabled).some((failure) => failure.includes("external_dependency")),
    true,
  );

  const paidMock = withReplacement("AGENT-TEAM.md", "tokens: 0", "tokens: 1");
  assert.equal(
    validateAgentTeamContractDocuments(paidMock).some((failure) => failure.includes("tokens: 0")),
    true,
  );
});

test("every authored document must remain below 600 lines", () => {
  const documents = new Map([["TOO-LONG.md", "line\n".repeat(600)]]);
  assert.deepEqual(
    validateAgentTeamDocumentLineBudgets(documents),
    ["TOO-LONG.md: 600 lines exceeds the <600 line budget"],
  );
});

test("the planning ledger keeps exactly one July 24 Agent Team row", () => {
  const duplicate = `${repositoryPlanning}\n${repositoryPlanning.split("\n").find((line) => line.startsWith("| Role-agent orchestration MCP and invocation runtime |"))}\n`;
  assert.equal(
    validateAgentTeamPlanningRow(duplicate).some((failure) => failure.includes("expected exactly one")),
    true,
  );
});
