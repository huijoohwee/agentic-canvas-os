#!/usr/bin/env node
// Prerequisite_Gate check for the native-skill-creation-harness feature.
//
// Reads scripts/native-skill-harness/prerequisite-gate.json, resolves each
// readiness pointer against a GET /api/ready body (computed offline from the
// app's own readiness(), or loaded from a file / URL argument), recomputes the
// gate state, and fails when the recorded state does not match the computed
// state. While blocked it also asserts wrangler.jsonc is byte-identical to the
// recorded pre-feature digest and that the three new readiness keys report
// configured:false.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAgentApiApp } from "../agent-api/src/app.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECORD_PATH = path.join(REPOSITORY_ROOT, "scripts/native-skill-harness/prerequisite-gate.json");
const WRANGLER_PATH = path.join(REPOSITORY_ROOT, "wrangler.jsonc");
const NEW_READINESS_KEYS = Object.freeze(["skillProposer", "skillRegistryGate", "adapterRegistration"]);

function resolvePointer(body, pointer) {
  let value = body;
  for (const token of pointer.split("/").slice(1)) {
    if (!value || typeof value !== "object" || !(token in value)) return null;
    value = value[token];
  }
  return value;
}

function observedMatchesExpected(observed, expected) {
  if (observed === null || observed === undefined) return false;
  const observedText = String(observed);
  if (expected.startsWith("not:")) return observedText !== expected.slice(4);
  return observedText === expected;
}

// State computation: satisfied iff every pointer resolves and matches;
// waived iff otherwise blocked, an operator reference is present, and
// accepted_unmet equals the computed unmet set exactly; blocked otherwise.
export function computeGateState(prerequisites, { acceptedUnmet = [], operatorInstructionReference = null } = {}) {
  const unmet = prerequisites
    .filter((prerequisite) => !observedMatchesExpected(prerequisite.observed, prerequisite.expected))
    .map((prerequisite) => prerequisite.name);
  if (unmet.length === 0) return { state: "satisfied", unmet };
  const accepted = [...acceptedUnmet].sort();
  const computedUnmet = [...unmet].sort();
  const waiverCoversExactly = accepted.length > 0
    && accepted.length === computedUnmet.length
    && accepted.every((name, index) => name === computedUnmet[index]);
  if (typeof operatorInstructionReference === "string" && operatorInstructionReference.trim() && waiverCoversExactly) {
    return { state: "waived", unmet };
  }
  return { state: "blocked", unmet };
}

async function loadReadinessBody(argument) {
  if (!argument) {
    const app = createAgentApiApp({ env: {} });
    return app.readiness();
  }
  if (argument.startsWith("http://") || argument.startsWith("https://")) {
    const response = await fetch(argument);
    if (!response.ok) throw new Error(`readiness fetch failed: ${response.status}`);
    return response.json();
  }
  return JSON.parse(await readFile(path.resolve(argument), "utf8"));
}

export function projectRecordForEmission(record) {
  return {
    schema: record.schema,
    feature: record.feature,
    state: record.state,
    prerequisites: record.prerequisites.map((prerequisite) => ({
      name: prerequisite.name,
      readiness_pointer: prerequisite.readiness_pointer,
      expected: prerequisite.expected,
      observed: prerequisite.observed,
      evidence_reference: prerequisite.evidence_reference,
      met: prerequisite.met,
    })),
    ...(record.state === "waived" ? { operator_instruction_reference: record.operator_instruction_reference } : {}),
  };
}

function emitRecordLine(record) {
  const summary = projectRecordForEmission(record);
  console.log(JSON.stringify(summary, null, 2));
}

export function evaluatePrerequisiteRecord(record, readinessBody, { wranglerDigest = null } = {}) {
  const evaluatedRecord = structuredClone(record);
  const failures = [];
  const unmetMessages = [];

  for (const prerequisite of evaluatedRecord.prerequisites) {
    const observed = resolvePointer(readinessBody, prerequisite.readiness_pointer);
    const met = observedMatchesExpected(observed, prerequisite.expected);
    prerequisite.observed = observed === null || observed === undefined ? null : String(observed);
    prerequisite.met = met;
    if (!met) {
      unmetMessages.push(
        `unmet prerequisite ${prerequisite.name}: pointer ${prerequisite.readiness_pointer} `
        + `observed ${prerequisite.observed} expected ${prerequisite.expected}`,
      );
    }
  }

  const computed = computeGateState(evaluatedRecord.prerequisites, {
    acceptedUnmet: evaluatedRecord.accepted_unmet,
    operatorInstructionReference: evaluatedRecord.operator_instruction_reference,
  });
  evaluatedRecord.unmet = computed.unmet;

  if (computed.state !== evaluatedRecord.state) {
    failures.push(`recorded state ${evaluatedRecord.state} does not match computed state ${computed.state}`);
  }
  if (evaluatedRecord.state === "waived" && !evaluatedRecord.operator_instruction_reference) {
    failures.push("waived state requires an operator_instruction_reference");
  }

  if (evaluatedRecord.state === "blocked") {
    failures.push(...unmetMessages);
    if (wranglerDigest !== null && wranglerDigest !== evaluatedRecord.pre_feature_wrangler_sha256) {
      failures.push("wrangler.jsonc differs from the recorded pre-feature digest; no binding change is permitted while the prerequisite gate is blocked");
    }
    for (const key of NEW_READINESS_KEYS) {
      const block = readinessBody[key];
      if (!block || typeof block !== "object") {
        failures.push(`readiness key ${key} is absent`);
      } else if (block.configured !== false) {
        failures.push(`readiness key ${key} must report configured:false while the prerequisite gate is blocked`);
      }
    }
  }
  return Object.freeze({ record: evaluatedRecord, failures: Object.freeze(failures), computedState: computed.state });
}

async function run() {
  const record = JSON.parse(await readFile(RECORD_PATH, "utf8"));
  const readinessBody = await loadReadinessBody(process.argv[2]);
  const wranglerDigest = createHash("sha256").update(await readFile(WRANGLER_PATH)).digest("hex");
  const evaluation = evaluatePrerequisiteRecord(record, readinessBody, { wranglerDigest });
  const { record: evaluatedRecord, failures } = evaluation;

  emitRecordLine(evaluatedRecord);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  if (evaluatedRecord.state === "blocked") {
    console.log(
      `prerequisite gate blocked (verified): ${evaluatedRecord.unmet.length} unmet prerequisites named; `
      + `wrangler.jsonc digest unchanged; ${NEW_READINESS_KEYS.length} readiness keys report configured:false`,
    );
    return;
  }
  console.log(`prerequisite gate ${evaluatedRecord.state} (verified)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
