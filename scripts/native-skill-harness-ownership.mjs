#!/usr/bin/env node
// Ownership audit for the native skill creation harness.
//
// Groups the declared proposal and promotion owners by their exported
// artifactType constant and asserts single-owner-per-contract across both the
// agent-definition lane and the pre-existing skill-text lane owned by the
// Skill Evolution contract.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PROMOTION_ARTIFACT_TYPE } from "../agent-api/src/skill-registry-gate.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The declared owner set. Each owner names its artifact type as an exported
// literal constant (the gate exports PROMOTION_ARTIFACT_TYPE); the skill-text
// owner's contract is a document whose persistence owner is /skill.manage.
const OWNERS = Object.freeze([
  Object.freeze({
    artifactType: PROMOTION_ARTIFACT_TYPE,
    proposalOwnerModule: "agent-api/src/skill-proposer.js",
    promotionOwnerModule: "agent-api/src/skill-registry-gate.js",
    promotionOwnerIdentity: "acos-skill-registry-gate",
  }),
  Object.freeze({
    artifactType: "skill-text",
    proposalOwnerModule: "docs/SKILL-EVOLUTION.md",
    promotionOwnerModule: "docs/SKILL-EVOLUTION.md",
    promotionOwnerIdentity: "/skill.manage",
  }),
]);

async function run() {
  const failures = [];
  const artifactTypes = OWNERS.map((owner) => owner.artifactType);

  const expectedTypes = new Set(["skill-text", "agent-definition"]);
  if (artifactTypes.length !== expectedTypes.size || !artifactTypes.every((type) => expectedTypes.has(type))) {
    failures.push(`the artifact type set must be exactly { skill-text, agent-definition }; found ${JSON.stringify([...new Set(artifactTypes)])}`);
  }

  const byType = new Map();
  for (const owner of OWNERS) {
    if (byType.has(owner.artifactType)) {
      failures.push(`artifact type ${owner.artifactType} is declared by more than one owner entry`);
    }
    byType.set(owner.artifactType, owner);
  }

  // The skill-text owner contract must still name /skill.manage as its
  // persistence owner, unchanged by this feature.
  const skillEvolution = await readFile(path.join(REPOSITORY_ROOT, "docs/SKILL-EVOLUTION.md"), "utf8");
  if (!skillEvolution.includes("/skill.manage")) {
    failures.push("docs/SKILL-EVOLUTION.md no longer names /skill.manage as the skill-text persistence owner");
  }
  if (!skillEvolution.includes("applied: false") && !skillEvolution.includes("`applied: false`")) {
    failures.push("docs/SKILL-EVOLUTION.md no longer declares the applied: false flag semantics");
  }

  // No second Agent Definition registry: the new modules receive the shared
  // registry by injection and never construct a parallel one.
  for (const modulePath of ["agent-api/src/skill-proposer.js", "agent-api/src/skill-registry-gate.js", "agent-api/src/adapter-registration.js"]) {
    const text = await readFile(path.join(REPOSITORY_ROOT, modulePath), "utf8");
    if (text.includes("createAgentDefinitionRegistry")) {
      failures.push(`${modulePath} constructs an Agent Definition registry instead of receiving the shared one by injection`);
    }
  }

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  const summary = OWNERS.map((owner) => `${owner.artifactType}: proposal ${owner.proposalOwnerModule}, promotion ${owner.promotionOwnerModule} (${owner.promotionOwnerIdentity})`);
  console.log(`ownership audit ok: exactly one proposal owner and one promotion owner per artifact type across ${OWNERS.length} types`);
  for (const line of summary) console.log(`  ${line}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
