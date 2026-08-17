#!/usr/bin/env node
// Responsibility: Expose one-subject recovery artifact plan, run, and observe commands.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRecoveryArtifactRetirementController } from "./recovery-artifact-retirement-controller.mjs";
import { createRecoveryArtifactRetirementRepositoryAdapter } from "./recovery-artifact-retirement-repository-adapter.mjs";

const MODES = new Set(["plan", "run", "observe"]);
const COMMON = new Set(["repository", "source", "archive-root", "subject-repository", "json"]);

export function parseRecoveryArtifactRetirementArguments(argv) {
  const [mode, ...args] = argv;
  if (!MODES.has(mode)) throw new Error("Recovery artifact retirement mode must be plan, run, or observe.");
  const allowed = new Set([...COMMON, ...(mode === "observe" ? ["plan-digest"]
    : ["session", "operator-decision-digest", "acknowledge-drift",
      ...(mode === "run" ? ["plan-digest", "authorize"] : [])])]);
  const values = new Map(); let json = false;
  for (const argument of args) {
    if (argument === "--json") { if (json) duplicate("json"); json = true; continue; }
    const match = /^--([a-z][a-z-]*)=(.*)$/u.exec(argument);
    if (!match || !allowed.has(match[1])) throw new Error(`Unsupported ${mode} argument: ${argument}`);
    if (values.has(match[1])) duplicate(match[1]); values.set(match[1], match[2]);
  }
  const input = {
    repository: absolute(values, "repository"), source: absolute(values, "source"),
    archiveRoot: absolute(values, "archive-root"), subjectRepository: absolute(values, "subject-repository"),
    sessionId: values.get("session") || "", operatorDecisionDigest: values.get("operator-decision-digest") || "",
    acknowledgedDriftDigest: values.get("acknowledge-drift") || null,
    planDigest: values.get("plan-digest") || "", authorization: values.get("authorize") || "",
  };
  if (mode !== "observe" && (!input.sessionId || !input.operatorDecisionDigest)) throw new Error(`${mode} requires session and operator decision digest.`);
  if (mode === "run" && (!input.planDigest || !input.authorization)) throw new Error("run requires plan digest and exact authorization.");
  return Object.freeze({ mode, input, json });
}

export function runRecoveryArtifactRetirementCli(argv = process.argv.slice(2), dependencies = {}) {
  const parsed = parseRecoveryArtifactRetirementArguments(argv);
  const adapter = dependencies.adapter || createRecoveryArtifactRetirementRepositoryAdapter(parsed.input);
  const controller = dependencies.controller || createRecoveryArtifactRetirementController({ adapter });
  const result = controller[parsed.mode](parsed.input);
  (dependencies.write || (value => process.stdout.write(value)))(`${JSON.stringify(result, null, parsed.json ? 2 : 0)}\n`);
  return result;
}
function absolute(values, name) { const value = values.get(name); if (!value || !path.isAbsolute(value) || path.normalize(value) !== value || value === path.parse(value).root) throw new Error(`--${name} requires a normalized non-root absolute path.`); return value; }
function duplicate(name) { throw new Error(`Duplicate recovery artifact retirement argument: ${name}.`); }
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try { runRecoveryArtifactRetirementCli(); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
