import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAudit } from "../scripts/alignment-audit/alignment-auditor.mjs";
import { resolveAuditConfig } from "../scripts/alignment-audit/config.mjs";
import { createWriteSink } from "../scripts/alignment-audit/output-boundary.mjs";
import { createNodeSourceReader } from "../scripts/alignment-audit/source-reader.mjs";

test("real ports retain versions inside output and preserve every source byte", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "alignment-integration-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const guidelineRoot = path.join(temporaryRoot, "guideline");
  const runtimeRoot = path.join(temporaryRoot, "runtime");
  const outputRoot = path.join(temporaryRoot, "output");
  const guidelinePath = path.join(guidelineRoot, "guide.md");
  const runtimePath = path.join(runtimeRoot, "runtime.md");
  await Promise.all([
    writeFixture(guidelinePath, guidelineDocument()),
    writeFixture(runtimePath, runtimeDocument()),
  ]);
  const before = new Map([
    [guidelinePath, await readFile(guidelinePath)],
    [runtimePath, await readFile(runtimePath)],
  ]);

  const config = await resolveAuditConfig({
    guidelineRoots: [
      {
        roleLabel: "guide",
        locator: guidelineRoot,
        includeGlobs: ["**/*.md"],
        revisionIdentifier: "guide-r1",
      },
    ],
    runtimeRoots: [
      {
        roleLabel: "runtime",
        locator: runtimeRoot,
        includeGlobs: ["**/*.md"],
        revisionIdentifier: "runtime-r1",
      },
    ],
    auditOutputDirectory: outputRoot,
    operatorDeployInstruction: null,
    readinessLadder: [
      "undocumented",
      "spec-complete",
      "dev-proven",
      "runtime-ready",
      "production-verified",
    ],
    requiredFrontmatterKeys: ["title", "status"],
    economicsStatements: ["token-budget"],
  });
  const reader = createNodeSourceReader();
  const sink = await createWriteSink(config.auditOutputDirectory);
  const first = await runAudit(config, reader, sink);
  const second = await runAudit(config, reader, sink);
  const canonicalOutputRoot = await realpath(outputRoot);

  assert.equal(first.version, "1.0.0");
  assert.equal(second.version, "1.0.1");
  assert.equal(first.baselineVerified, true);
  assert.equal(second.baselineVerified, true);
  assert.equal(first.modifiedOutsideOutputCount, 0);
  assert.equal(second.modifiedOutsideOutputCount, 0);
  assert.equal((await readdir(outputRoot)).length, 6);
  for (const artifact of [...first.artifacts, ...second.artifacts]) {
    const relative = path.relative(canonicalOutputRoot, artifact.absolutePath);
    assert.ok(relative.length > 0);
    assert.equal(relative.startsWith(".."), false);
    assert.equal(path.isAbsolute(relative), false);
  }
  for (const [sourcePath, originalBytes] of before) {
    assert.deepEqual(await readFile(sourcePath), originalBytes);
  }
});

async function writeFixture(file, content) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

function guidelineDocument() {
  return [
    "---",
    "title: Portable Guide",
    "status: spec-complete",
    "---",
    "",
    "## Requirements",
    "",
    "- Directive: The runtime must record a contract schema.",
    "",
  ].join("\n");
}

function runtimeDocument() {
  return [
    "---",
    "title: Portable Runtime",
    "status: dev-proven",
    "runtime_scope: portable",
    "owner: runtime-owner",
    "proof_reference: local-proof",
    "---",
    "",
    "Contract schema: `portable/v1`",
    "",
    "Validation command: `node --test`",
    "",
    "token-budget: 0",
    "",
  ].join("\n");
}
