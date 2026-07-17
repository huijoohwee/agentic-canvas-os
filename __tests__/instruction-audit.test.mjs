import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  auditInstructionDocuments,
  DEFAULT_INSTRUCTION_POLICIES,
  INSTRUCTION_AUDIT_SCHEMA,
} from "../scripts/instruction-audit-lib.mjs";

const SURFACES = Object.keys(DEFAULT_INSTRUCTION_POLICIES);

async function repositoryDocuments() {
  return Object.fromEntries(await Promise.all(SURFACES.map(async (file) => [
    file,
    await readFile(new URL(`../${file}`, import.meta.url), "utf8"),
  ])));
}

test("repository instruction surfaces pass the bounded audit", async () => {
  const report = auditInstructionDocuments({ documents: await repositoryDocuments() });

  assert.equal(report.schema, INSTRUCTION_AUDIT_SCHEMA);
  assert.equal(report.status, "passed");
  assert.equal(report.summary.auditedFiles, 2);
  assert.equal(report.summary.duplicateInstructions, 0);
  assert.deepEqual(report.costLog, {
    model: "not-run",
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_hits: 0,
    estimated_cost_usd: 0,
  });
  assert.equal(report.deployBoundary.prodMirrorAttempted, false);
  assert.equal(report.deployBoundary.cloudflareAttempted, false);
});

test("fails when required durable intent is removed", async () => {
  const documents = await repositoryDocuments();
  documents["docs/AGENTS.md"] = documents["docs/AGENTS.md"].replaceAll("START-WORKFLOW.md", "session guide");
  const report = auditInstructionDocuments({ documents });

  assert.equal(report.status, "failed");
  assert.equal(report.violations.some(({ code, message }) => code === "missing-intent" && message.includes("START-WORKFLOW.md")), true);
});

test("fails on duplicated instructions and excessive directive context", async () => {
  const documents = await repositoryDocuments();
  const repeated = "\n- Always validate the canonical owner before changing shared runtime behavior.";
  documents["docs/AGENTS.md"] += repeated.repeat(50);
  const report = auditInstructionDocuments({ documents });

  assert.equal(report.status, "failed");
  assert.equal(report.violations.some(({ code }) => code === "duplicate-instruction"), true);
  assert.equal(report.violations.some(({ code }) => code === "instruction-unit-budget"), true);
});

test("fails when delegated workflow mechanics leak back into always-on guidance", async () => {
  const documents = await repositoryDocuments();
  documents["docs/AGENTS.md"] += "\nRun device:start and persist the writer-lease fencing SHA.";
  const report = auditInstructionDocuments({ documents });

  assert.equal(report.status, "failed");
  assert.equal(report.violations.some(({ code }) => code === "canonical-owner-leakage"), true);
});

test("fails when the skill catalog embeds a procedure instead of a reference", async () => {
  const documents = await repositoryDocuments();
  documents["docs/SKILLS.md"] += "\n## Soul Contract\n\n```yaml\nsteps: [load, mutate]\n```\n";
  const report = auditInstructionDocuments({ documents });

  assert.equal(report.status, "failed");
  assert.equal(report.violations.some(({ code }) => code === "embedded-procedure"), true);
  assert.equal(report.violations.some(({ code }) => code === "canonical-owner-leakage"), true);
});

test("reports deterministic context reduction against a supplied baseline", async () => {
  const documents = await repositoryDocuments();
  const baselineDocuments = Object.fromEntries(Object.entries(documents).map(([file, text]) => [file, `${text}\n${"legacy detail ".repeat(100)}`]));
  const report = auditInstructionDocuments({ documents, baselineDocuments });

  assert.equal(report.status, "passed");
  assert.ok(report.baseline.reducedCharacters > 0);
  assert.ok(report.baseline.reductionPercent > 0);
  assert.equal(report.baseline.currentCharacters, report.summary.characters);
});

test("instruction audit routes remain source-backed across the shared owners", async () => {
  const expectedByFile = {
    "../docs/DICTIONARY-COMMAND.md": ["/instruction.audit", "@instruction-source", "#instruction-audit"],
    "../docs/DICTIONARY-SEMANTIC.md": ["#instruction-audit"],
    "../docs/DICTIONARY-BINDING.md": ["@instruction-source"],
    "../docs/FACTS.md": ["/instruction.audit", "#instruction-audit", "@instruction-source"],
    "../docs/SKILLS.md": ["instruction.audit", "INSTRUCTION-AUDIT.md"],
    "../docs/HARNESS-CONTRACTS.md": ["Instruction Audit", "agentic-instruction-audit/v1"],
  };

  for (const [file, markers] of Object.entries(expectedByFile)) {
    const text = await readFile(new URL(file, import.meta.url), "utf8");
    for (const marker of markers) assert.match(text, new RegExp(marker.split(".").join("\\.")));
  }
});
