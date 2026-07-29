#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SESSION_START_STATUS_SCHEMA = "agentic-session-start-status/v1";
const AUTHORING_GATES = ["fetch", "canonical", "scopeOwnership", "taskWorktree", "memory", "planning"];

export function classifySessionStart(input) {
  const normalized = normalizeInput(input);
  const failedAuthoringGates = AUTHORING_GATES.filter((gate) => normalized[gate] !== "passed");
  const authoringStatus = failedAuthoringGates.length === 0 ? "ready" : "blocked";
  const parityStatus = normalized.parity;
  const blockScope = resolveBlockScope({ failedAuthoringGates, parityStatus });
  return {
    schema: SESSION_START_STATUS_SCHEMA,
    authoringStatus,
    parityStatus,
    blockScope,
    failedAuthoringGates,
    continuation: {
      readOnly: true,
      isolatedAuthoring: authoringStatus === "ready",
      runtimeParityClaim: parityStatus === "passed",
      reviewOrIntegration: authoringStatus === "ready" && parityStatus === "passed",
    },
  };
}

function normalizeInput(input = {}) {
  const normalized = {};
  for (const gate of AUTHORING_GATES) {
    const value = input[gate];
    if (value !== "passed" && value !== "blocked") throw new Error(`${gate} must be passed or blocked.`);
    normalized[gate] = value;
  }
  if (!["passed", "blocked", "deferred"].includes(input.parity)) {
    throw new Error("parity must be passed, blocked, or deferred.");
  }
  normalized.parity = input.parity;
  return normalized;
}

function resolveBlockScope({ failedAuthoringGates, parityStatus }) {
  if (failedAuthoringGates.includes("scopeOwnership")) return "semantic-scope";
  if (failedAuthoringGates.length > 0) return "global";
  if (parityStatus !== "passed") return "runtime-proof";
  return null;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const raw = readFileSync(0, "utf8").trim();
    if (!raw) throw new Error("session:start:classify requires one JSON object on stdin.");
    process.stdout.write(`${JSON.stringify(classifySessionStart(JSON.parse(raw)))}\n`);
  } catch (error) {
    process.stderr.write(`[session-start-policy] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
