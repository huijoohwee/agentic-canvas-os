#!/usr/bin/env node
// Responsibility: Read-only CLI shim over the goal completion runtime contract.
// It prints one advance decision and exits non-zero only when the goal cannot
// continue. It dispatches nothing and mutates nothing.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GOAL_RECEIPT_SCHEMA, planGoalAdvance } from "./goal-completion-runtime-contract.mjs";

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
    || null;
}

async function run() {
  const input = option("input");
  if (process.argv[2] !== "plan" || !input) {
    console.error("Usage: goal-completion-runtime.mjs plan --input=<goal.json> [--json]");
    process.exit(2);
  }
  const receipt = planGoalAdvance(JSON.parse(await readFile(path.resolve(input), "utf8")));
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } else {
    const { progress: p } = receipt;
    console.log(
      `goal ${receipt.goalId}: ${receipt.state} `
      + `(${p.completedPermille / 10}% terminal; ${p.ready} ready, `
      + `${p.waiting} waiting, ${p.blocked} blocked)`,
    );
    if (receipt.nextUnitIds.length > 0) console.log(`next: ${receipt.nextUnitIds.join(", ")}`);
    for (const unit of receipt.blockedUnits) {
      console.log(`blocked ${unit.unitId}: ${unit.reason}`);
    }
  }
  // Continuable is the success condition: blocked units elsewhere in the goal
  // never fail the run while any ready unit remains.
  if (!receipt.continuable && receipt.state !== "complete") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (GOAL_RECEIPT_SCHEMA) await run();
}
