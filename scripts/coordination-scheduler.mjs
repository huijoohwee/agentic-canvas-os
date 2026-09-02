#!/usr/bin/env node
// Responsibility: Expose the read-only coordination scheduler contract.
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildCoordinationSchedule } from "./coordination-scheduler-contract.mjs";

const [command, ...argumentsList] = process.argv.slice(2);
const json = argumentsList.includes("--json");
try {
  if (command !== "plan") throw new Error("Usage: coordination-scheduler.mjs plan --input=<external.json> [--json]");
  const input = option("input");
  if (!input) throw new Error("--input=<external.json> is required.");
  const report = buildCoordinationSchedule(JSON.parse(readFileSync(path.resolve(input), "utf8")));
  process.stdout.write(`${JSON.stringify(report, null, json ? 0 : 2)}\n`);
} catch (error) {
  if (!json) throw error;
  process.stdout.write(`${JSON.stringify({
    schema: "agentic-coordination-scheduler-error/v1",
    ok: false,
    mutation: false,
    error: { message: String(error?.message || error).slice(0, 500) },
  })}\n`);
  process.exitCode = 1;
}

function option(name) {
  const prefix = `--${name}=`;
  return argumentsList.find(value => value.startsWith(prefix))?.slice(prefix.length) || "";
}
