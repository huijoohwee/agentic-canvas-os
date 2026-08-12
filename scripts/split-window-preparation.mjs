#!/usr/bin/env node
// Responsibility: expose split-window verbs without embedding provider authority.
import fs from "node:fs";
import { createSplitWindowStore } from "./split-window-preparation-store.mjs";

const [verb, ...argv] = process.argv.slice(2); const options = parse(argv);
if (!new Set(["inspect-object", "inspect-operation"]).has(verb)) {
  throw new Error("Usage: split-window-preparation.mjs inspect-object|inspect-operation --store=<absolute-path> --id=<digest-or-operation-id> [--json]");
}
const store = createSplitWindowStore({ root: required(options.store, "store") });
const result = verb === "inspect-object" ? store.readBundle(required(options.id, "id")) : store.readOperation(required(options.id, "id"));
process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 0)}\n`);

function parse(values) { const result = {}; for (const value of values) { if (value === "--json") { if (result.json) throw new Error("Duplicate --json."); result.json = true; continue; }
  const match = /^--([a-z-]+)=(.*)$/u.exec(value); if (!match || !new Set(["store", "id"]).has(match[1]) || Object.hasOwn(result, match[1])) throw new Error(`Unknown or duplicate option: ${value}`); result[match[1]] = match[2]; } return result; }
function required(value, label) { if (!value) throw new Error(`${label} is required.`); return value; }
