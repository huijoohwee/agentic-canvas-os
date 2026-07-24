#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT_TEAM_INVOCATION = Object.freeze({
  command: "/agent.team",
  semantic: "#role-based-agent-team",
  binding: "@agent-team",
  text: "/agent.team #role-based-agent-team @agent-team",
});

export const AGENT_TEAM_MCP_TOOLS = Object.freeze([
  "knowgrph.agent_team.plan",
  "knowgrph.agent_team.start",
  "knowgrph.agent_team.list",
  "knowgrph.agent_team.control",
]);

export const AGENT_TEAM_BOUNDS = Object.freeze({
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

const TOKEN_CONTRACTS = Object.freeze([
  {
    token: AGENT_TEAM_INVOCATION.command,
    document: "DICTIONARY-COMMAND.md",
    truthField: "commands",
    sectionStart: "## Commands",
    sectionEnd: "## Command Shape",
    columns: 5,
  },
  {
    token: AGENT_TEAM_INVOCATION.semantic,
    document: "DICTIONARY-SEMANTIC.md",
    truthField: "semantics",
    sectionStart: "## Tags",
    sectionEnd: "## Semantic Shape",
    columns: 4,
  },
  {
    token: AGENT_TEAM_INVOCATION.binding,
    document: "DICTIONARY-BINDING.md",
    truthField: "bindings",
    sectionStart: "## Bindings",
    sectionEnd: "## Binding Shape",
    columns: 4,
  },
]);

const REQUIRED_DOCUMENTS = Object.freeze([
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
]);

const RUNTIME_SOURCE_ROOTS = Object.freeze(["src", "agent-api", "worker", "web"]);
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const EXTERNAL_RUNTIME_PATTERN = /crewai/i;

export function validateAgentTeamContractDocuments(documents) {
  const failures = [];
  const required = Object.fromEntries(REQUIRED_DOCUMENTS.map((name) => [
    name,
    requireDocument(documents, name, failures),
  ]));
  if (failures.length > 0) return failures;

  const facts = required["FACTS.md"];
  for (const contract of TOKEN_CONTRACTS) {
    const dictionary = required[contract.document];
    requireCountByLine(
      dictionary,
      `  - "${contract.token}"`,
      1,
      `${contract.document}: canonical dictionary entry ${contract.token}`,
      failures,
    );
    const section = readSection(dictionary, contract.sectionStart, contract.sectionEnd);
    const rows = section.split("\n").filter((line) => line.startsWith(`| \`${contract.token}\` |`));
    if (rows.length !== 1) {
      failures.push(`${contract.document}: expected one owning row ${contract.token}, found ${rows.length}`);
    } else {
      requireTableColumns(rows[0], contract.columns, `${contract.document}: owning row ${contract.token}`, failures);
      requireCanonicalTokenCells(contract.token, splitMarkdownTableRow(rows[0]), failures);
    }
    requireCountByLine(
      facts,
      `  "${contract.token}": "${contract.document}#${contract.token}"`,
      1,
      `FACTS.md: direct resolution ${contract.token}`,
      failures,
    );
    const truthTokens = readTruthTokens(facts, contract.truthField, failures);
    if (truthTokens && truthTokens.filter((token) => token === contract.token).length !== 1) {
      failures.push(`FACTS.md: truth_tokens.${contract.truthField} must contain ${contract.token} exactly once`);
    }
  }

  const contract = required["AGENT-TEAM.md"];
  requireMarkers(contract, "AGENT-TEAM.md canonical contract", [
    'status: "spec-complete"',
    `invocation: "${AGENT_TEAM_INVOCATION.text}"`,
    'schema: "agent-team-invocation-contract/v1"',
    'external_dependency: "forbidden"',
    "https://github.com/crewaiinc/crewai",
    "Agent Definitions",
    "Agent Orchestration",
    "Progressive Agents",
    "Agent Swarm remains",
    "`role`, `goal`, and `persona`",
    "not facts, system instructions, identity, authorization, approval, model selection, capability grants, tool access, credentials, policy exceptions, or final-answer ownership",
    "`delegate`",
    "`handoff`",
    "Private specialist outputs",
    "The final answer owner comes only from successful Agent Orchestration ownership fields",
    "planDigest",
    "teamRevision",
    "stateVersion",
    "idempotencyKey",
    "Each transition atomically records",
    "Run ids, transition sequence numbers, and checkpoint ids form the bounded replay fence.",
    "Cancellation wins over queued continuation",
    "Human review is an explicit `review_pending` checkpoint",
    "deterministic fixture",
    "tokens: 0",
    "costUsd: 0",
    "No CrewAI code, prose, prompt, schema, workflow vocabulary set, example, test, fixture, default, package, service, CLI command, generated artifact, or repository layout is copied, imported, invoked, vendored, or required.",
    "Removing network access and the external repository changes neither this contract",
    "The automated clean-room check is a dependency and reference-name guard, not a similarity detector.",
    "A separate provenance and similarity review",
  ], failures);
  for (const tool of AGENT_TEAM_MCP_TOOLS) {
    requireMarkers(contract, "AGENT-TEAM.md MCP lifecycle", [`\`${tool}\``], failures);
  }
  requireBoundRows(contract, failures);
  requireAgentTeamStateAndOwnershipTables(contract, failures);

  const compositionSection = readSection(
    required["DICTIONARY-BINDING.md"],
    "## Composition Rules",
    "## Resolution Matrix",
  );
  const compositionRows = compositionSection.split("\n")
    .filter((line) => line.startsWith(`| \`${AGENT_TEAM_INVOCATION.text}\` |`));
  if (compositionRows.length !== 1) {
    failures.push(`DICTIONARY-BINDING.md: expected one exact ${AGENT_TEAM_INVOCATION.text} composition row, found ${compositionRows.length}`);
  } else {
    const cells = splitMarkdownTableRow(compositionRows[0]);
    if (
      cells.length !== 2
      || cells[0] !== `\`${AGENT_TEAM_INVOCATION.text}\``
      || !cells[1].includes("Knowgrph local stdio MCP runtime")
      || !cells[1].includes("without creating a second scheduler or broadening Agent Swarm")
    ) {
      failures.push("DICTIONARY-BINDING.md: exact Agent Team composition row is malformed");
    }
  }

  requireMarkers(required["AGENT-DEFINITIONS.md"], "Agent Definitions owner", [
    "Agent Definition Registry",
    "does not execute a model or grant itself any capability",
  ], failures);
  requireMarkers(required["AGENT-ORCHESTRATION.md"], "Agent Orchestration owner", [
    "| `delegate` |",
    "| `handoff` |",
    "final-answer ownership",
  ], failures);
  requireMarkers(required["PROGRESSIVE-AGENTS.md"], "Progressive Agents composition", [
    "`registerWorkflow` and `executeWorkflow` delegate to Agent Orchestration",
    "without exposing intermediate output",
  ], failures);
  requireMarkers(required["AGENT-SWARM.md"], "Agent Swarm separation", [
    "No caller supplies specialist roles, a branch catalog, or a handcrafted workflow.",
    "`roles`, `specialists`, `tasks`, `branches`, and `workflow` are unsupported caller fields.",
  ], failures);

  const mcp = required["MCP-GATEWAY.md"];
  const mcpSection = readSection(mcp, "## Agent Team Capabilities", "## Application Composition Capabilities");
  requireMarkers(mcpSection, "MCP Agent Team owner separation", [
    AGENT_TEAM_INVOCATION.text,
    "Agentic Canvas OS owns invocation",
    "Knowgrph owns durable supervision",
    "existing Agent Definitions, Progressive Agents, Agent Orchestration, models, tools, guardrails, and persistence owners retain their authority",
    "Roles, goals, personas, membership, call order, and last response never override registered ownership",
  ], failures);
  for (const tool of AGENT_TEAM_MCP_TOOLS) {
    requireCountByLinePrefix(mcpSection, `| \`${tool}\` |`, 1, `MCP-GATEWAY.md: ${tool}`, failures);
  }

  requireCountByLine(required["SKILLS.md"], '  - "agent.team"', 1, "SKILLS.md: agent.team skill", failures);
  requireMarkers(required["SKILLS.md"], "SKILLS.md Agent Team routing", [
    "| Agent Team | `AGENT-TEAM.md` |",
    "`agent.orchestrator` resolves role-based team requests through `/agent.team`",
  ], failures);
  requireCountByLinePrefix(
    required["FACTS.md"],
    "| Role-based Agent Team |",
    1,
    "FACTS.md: Role-based Agent Team fact",
    failures,
  );
  requireMarkers(findPlainTableRow(required["FACTS.md"], "Role-based Agent Team"), "FACTS.md Agent Team fact", [
    AGENT_TEAM_INVOCATION.text,
    "roles, goals, and personas grant no authority",
    ...AGENT_TEAM_MCP_TOOLS,
  ], failures);
  requireCountByLinePrefix(
    required["README.md"],
    "| `AGENT-TEAM.md` |",
    1,
    "README.md: Agent Team map entry",
    failures,
  );
  return failures;
}

export function validateAgentTeamCleanRoomSources({
  packageText = "",
  lockfileText = "",
  modules = new Map(),
} = {}) {
  const failures = [];
  if (EXTERNAL_RUNTIME_PATTERN.test(packageText)) {
    failures.push("package.json: forbidden CrewAI manifest reference");
  }
  if (EXTERNAL_RUNTIME_PATTERN.test(lockfileText)) {
    failures.push("package-lock.json: forbidden CrewAI manifest reference");
  }
  const entries = modules instanceof Map ? modules.entries() : Object.entries(modules);
  for (const [name, sourceValue] of entries) {
    const source = String(sourceValue);
    if (EXTERNAL_RUNTIME_PATTERN.test(name) || EXTERNAL_RUNTIME_PATTERN.test(source)) {
      failures.push(`${name}: forbidden CrewAI runtime source reference`);
    }
  }
  return failures;
}

export function validateAgentTeamDocumentLineBudgets(documents) {
  const failures = [];
  const entries = documents instanceof Map ? documents.entries() : Object.entries(documents || {});
  for (const [name, sourceValue] of entries) {
    const source = String(sourceValue);
    const lineCount = source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
    if (lineCount >= 600) failures.push(`${name}: ${lineCount} lines exceeds the <600 line budget`);
  }
  return failures;
}

export function validateAgentTeamPlanningRow(planningText) {
  const failures = [];
  const context = "Role-agent orchestration MCP and invocation runtime";
  const rows = String(planningText).split("\n").filter((line) => line.startsWith(`| ${context} |`));
  if (rows.length !== 1) {
    failures.push(`todo/2026-07.md: expected exactly one ${context} row, found ${rows.length}`);
    return failures;
  }
  const cells = splitMarkdownTableRow(rows[0]);
  requireTableColumns(rows[0], 11, "todo/2026-07.md: Agent Team planning row", failures);
  if (cells.some((cell) => cell.length === 0)) {
    failures.push("todo/2026-07.md: Agent Team planning row must fill all 11 cells");
  }
  const directiveWords = (cells[2] || "").split(/\s+/).filter(Boolean).length;
  if (directiveWords > 50) {
    failures.push(`todo/2026-07.md: Agent Team directive has ${directiveWords} words; maximum is 50`);
  }
  requireMarkers(rows[0], "todo/2026-07.md: Agent Team planning row", [
    AGENT_TEAM_INVOCATION.text,
    ...AGENT_TEAM_MCP_TOOLS,
    "2026-07-24",
  ], failures);
  const dateSection = readSection(String(planningText), "## 2026-07-24", "## 2026-07-25");
  if (!dateSection.includes(rows[0])) {
    failures.push("todo/2026-07.md: Agent Team planning row must remain under 2026-07-24");
  }
  return failures;
}

function requireBoundRows(contract, failures) {
  const rows = [
    ["Participants including manager", AGENT_TEAM_BOUNDS.participants],
    ["Turns per run", AGENT_TEAM_BOUNDS.turns],
    ["Delegation depth", AGENT_TEAM_BOUNDS.delegationDepth],
    ["Concurrent branch fanout", AGENT_TEAM_BOUNDS.fanout],
    ["Retries per turn", AGENT_TEAM_BOUNDS.retriesPerTurn],
    ["Time per authorization, resolution, agent, or review-settlement stage", "60,000 ms"],
    ["Total run time including retries and review-active execution", "900,000 ms"],
    ["Total reported input plus output tokens", "120,000"],
    ["Total cost", "USD 5.00"],
    ["Serialized task input", "100,000 characters"],
    ["Public final output", "200,000 characters"],
    ["Durable checkpoints", AGENT_TEAM_BOUNDS.checkpoints],
  ];
  for (const [label, value] of rows) {
    requireCountByLine(
      contract,
      `| ${label} | ${value} |`,
      1,
      `AGENT-TEAM.md: hard bound ${label}`,
      failures,
    );
  }
}

function requireCanonicalTokenCells(token, cells, failures) {
  if (token === AGENT_TEAM_INVOCATION.command && (
    cells[2] !== "exactly `@agent-team`"
    || cells[3] !== "exactly `#role-based-agent-team`"
    || !cells[4]?.includes(AGENT_TEAM_INVOCATION.text)
  )) {
    failures.push("DICTIONARY-COMMAND.md: exact owning row /agent.team has a non-canonical binding or semantic");
  }
  if (
    token === AGENT_TEAM_INVOCATION.semantic
    && !cells[3]?.includes(AGENT_TEAM_INVOCATION.text)
  ) {
    failures.push("DICTIONARY-SEMANTIC.md: exact owning row #role-based-agent-team lacks the canonical tuple");
  }
  if (token === AGENT_TEAM_INVOCATION.binding && (
    !cells[1]?.includes("Exact source URI and digest")
    || !cells[2]?.includes("Knowgrph local stdio MCP owns durable lifecycle state")
    || !cells[3]?.includes("cannot grant")
  )) {
    failures.push("DICTIONARY-BINDING.md: exact owning row @agent-team has non-canonical source or authority semantics");
  }
}

function requireAgentTeamStateAndOwnershipTables(contract, failures) {
  const stateSection = readSection(contract, "## Durable State And Control", "## Routing And Output Ownership");
  const stateRows = [
    ["`planned`", "Exact sources and bounds passed zero-mutation validation.", "`queued`, `canceled`, `blocked`"],
    ["`queued`", "One durable run awaits the supervisor claim.", "`running`, `paused`, `canceled`, `blocked`"],
    ["`running`", "The supervisor owns one bounded turn.", "`running`, `review_pending`, `paused`, `completed`, `failed`, `blocked`, `canceled`"],
    ["`review_pending`", "Continuation is durably stopped for a named human decision.", "`running`, `failed`, `canceled`"],
    ["`paused`", "No new turn starts; resumable checkpoint evidence is retained.", "`queued`, `canceled`"],
    ["`blocked`", "A typed policy, source, owner, or capability prerequisite is absent.", "`queued` after exact revalidation, `canceled`"],
    ["`failed`", "A bounded attempt ended with sanitized diagnostics.", "`queued` through an eligible fenced retry, `canceled`"],
    ["`completed`", "The exact final-answer owner settled one public answer.", "none"],
    ["`canceled`", "Cancellation is terminal and no later agent or tool work may start.", "none"],
  ];
  for (const cells of stateRows) {
    requireOneExactTableRow(stateSection, cells, `AGENT-TEAM.md: exact ${cells[0]} state transition`, failures);
  }

  const ownershipSection = readSection(contract, "## Routing And Output Ownership", "## Hard Bounds");
  const ownershipRows = [
    [
      "`delegate`",
      "Target output is private input to the source agent's synthesis.",
      "Source agent remains owner.",
      "Source agent produces the only public answer.",
    ],
    [
      "`handoff`",
      "Target runs as the user-facing owner.",
      "Target becomes owner only after successful completion.",
      "Target owns the public answer.",
    ],
  ];
  for (const cells of ownershipRows) {
    requireOneExactTableRow(ownershipSection, cells, `AGENT-TEAM.md: exact ${cells[0]} ownership`, failures);
  }
}

function requireDocument(documents, name, failures) {
  const value = documents instanceof Map ? documents.get(name) : documents?.[name];
  if (typeof value === "string") return value;
  failures.push(`${name}: required by Agent Team contract validation`);
  return "";
}

function readTruthTokens(facts, field, failures) {
  const match = facts.match(new RegExp(`^  ${field}:\\s*(\\[.*\\])$`, "m"));
  if (!match) {
    failures.push(`FACTS.md: missing truth_tokens.${field}`);
    return undefined;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    failures.push(`FACTS.md: truth_tokens.${field} must remain a JSON-compatible array`);
    return undefined;
  }
}

function readSection(source, startHeading, endHeading) {
  const start = source.indexOf(startHeading);
  if (start < 0) return "";
  const end = source.indexOf(endHeading, start + startHeading.length);
  return source.slice(start, end < 0 ? source.length : end);
}

function findPlainTableRow(source, label) {
  return source.split("\n").find((line) => line.startsWith(`| ${label} |`)) || "";
}

function requireMarkers(source, label, markers, failures) {
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${label}: missing ${marker}`);
  }
}

function requireCountByLine(source, line, expected, label, failures) {
  const actual = source.split("\n").filter((candidate) => candidate === line).length;
  if (actual !== expected) failures.push(`${label}: expected ${expected}, found ${actual}`);
}

function requireCountByLinePrefix(source, prefix, expected, label, failures) {
  const actual = source.split("\n").filter((line) => line.startsWith(prefix)).length;
  if (actual !== expected) failures.push(`${label}: expected ${expected}, found ${actual}`);
}

function requireTableColumns(row, expected, label, failures) {
  if (!row) return;
  const actual = splitMarkdownTableRow(row).length;
  if (actual !== expected) failures.push(`${label}: expected ${expected} columns, found ${actual}`);
}

function requireOneExactTableRow(section, expectedCells, label, failures) {
  const rows = section.split("\n").filter((line) => line.startsWith(`| ${expectedCells[0]} |`));
  if (rows.length !== 1) {
    failures.push(`${label}: expected 1 row, found ${rows.length}`);
    return;
  }
  if (JSON.stringify(splitMarkdownTableRow(rows[0])) !== JSON.stringify(expectedCells)) {
    failures.push(`${label}: cells do not match the canonical contract`);
  }
}

function splitMarkdownTableRow(row) {
  const cells = [];
  let cell = "";
  let escaped = false;
  for (const character of row.slice(1, -1)) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      cell += character;
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

async function readRepositoryDocuments(root) {
  const names = (await readdir(root)).filter((name) => name.endsWith(".md")).sort();
  return new Map(await Promise.all(names.map(async (name) => [
    name,
    await readFile(path.join(root, name), "utf8"),
  ])));
}

async function readRuntimeSources(repositoryRoot) {
  const modules = new Map();
  for (const relativeRoot of RUNTIME_SOURCE_ROOTS) {
    await visit(path.join(repositoryRoot, relativeRoot), relativeRoot);
  }
  return modules;

  async function visit(absolute, relative) {
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const childAbsolute = path.join(absolute, entry.name);
      const childRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(childAbsolute, childRelative);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        modules.set(childRelative, await readFile(childAbsolute, "utf8"));
      }
    }
  }
}

async function readOptional(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const repositoryRoot = path.resolve(".");
  const [documents, packageText, lockfileText, modules, planningText] = await Promise.all([
    readRepositoryDocuments(path.join(repositoryRoot, "docs")),
    readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    readOptional(path.join(repositoryRoot, "package-lock.json")),
    readRuntimeSources(repositoryRoot),
    readFile(path.join(repositoryRoot, "todo", "2026-07.md"), "utf8"),
  ]);
  const failures = [
    ...validateAgentTeamContractDocuments(documents),
    ...validateAgentTeamCleanRoomSources({ packageText, lockfileText, modules }),
    ...validateAgentTeamDocumentLineBudgets(documents),
    ...validateAgentTeamPlanningRow(planningText),
  ];
  if (failures.length > 0) fail(failures.join("\n"));
  else process.stdout.write("agent team contract ok\n");
}
