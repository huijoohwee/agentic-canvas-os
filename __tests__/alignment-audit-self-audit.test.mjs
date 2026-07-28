import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runAudit } from "../scripts/alignment-audit/alignment-auditor.mjs";
import { resolveAuditConfig } from "../scripts/alignment-audit/config.mjs";
import { createInMemoryWriteSink } from "../scripts/alignment-audit/output-boundary.mjs";
import {
  createInMemorySourceReader,
  createNodeSourceReader,
} from "../scripts/alignment-audit/source-reader.mjs";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SELF_CONFIG = path.join(
  REPOSITORY_ROOT,
  "scripts/alignment-audit/self-audit.config.json",
);
const SPEC_RELATIVE = ".kiro/specs/guideline-runtime-alignment-audit";

test("the alignment auditor satisfies its relocation-safe self-audit invariants", async () => {
  const supplied = JSON.parse(await readFile(SELF_CONFIG, "utf8"));
  const githubRoot = await findSpecificationWorkspace();
  if (githubRoot === null) {
    supplied.guidelineRoots = supplied.guidelineRoots.filter(({ roleLabel }) =>
      roleLabel !== "alignment-audit-specification");
  }
  const config = await resolveAuditConfig(supplied, {
    baseDirectory: REPOSITORY_ROOT,
    environment: {
      ...process.env,
      AGENTIC_CANVAS_OS_ROOT: REPOSITORY_ROOT,
      GITHUB_ROOT: githubRoot ?? path.dirname(REPOSITORY_ROOT),
    },
  });
  const nodeReader = createNodeSourceReader();
  const first = await runAudit(config, nodeReader, createInMemoryWriteSink());

  assert.ok(first.counts.auditedDocuments > 0);
  assert.equal(first.deployBoundaryState, "closed");
  assert.equal(first.modifiedOutsideOutputCount, 0);
  assert.equal(first.baselineVerified, true);
  for (const forbidden of [
    "path-derived-claim",
    "vendor-coupling",
    "non-modular-section",
  ]) {
    assert.deepEqual(
      first.findings.filter(({ findingType }) => findingType === forbidden),
      [],
    );
  }

  const relocatedDocuments = await relocateInputs(config, nodeReader);
  const relocated = await runAudit(
    config,
    createInMemorySourceReader(relocatedDocuments),
    createInMemoryWriteSink(),
  );
  assert.equal(relocated.modifiedOutsideOutputCount, 0);
  assert.equal(relocated.baselineVerified, true);
  assert.deepEqual(
    canonicalFindings(relocated.findings),
    canonicalFindings(first.findings),
  );
});

async function relocateInputs(config, reader) {
  const roots = [
    ...config.guidelineRoots.map((root) => ({
      ...root,
      auditSurface: "guideline",
      inputRole: root.roleLabel,
    })),
    ...config.runtimeRoots.map((root) => ({
      ...root,
      auditSurface: "runtime",
      inputRole: root.roleLabel,
    })),
  ];
  const descriptors = await reader.list(roots);
  return Promise.all(descriptors.map(async (descriptor, index) => {
    const result = await reader.read(descriptor);
    return {
      ...descriptor,
      ...result,
      readHandle: `/renamed-container/depth-${index}/renamed-${index}.source`,
      subject: `relocated-surface:renamed-${index}.source`,
      content: result.content,
      text: result.content,
    };
  }));
}

async function findSpecificationWorkspace() {
  const candidates = [
    process.env.GITHUB_ROOT,
    path.resolve(REPOSITORY_ROOT, "../../.."),
    path.dirname(REPOSITORY_ROOT),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, SPEC_RELATIVE, "requirements.md"));
      return candidate;
    } catch {
      // Try the next workspace layout.
    }
  }
  return null;
}

function canonicalFindings(findings) {
  return JSON.parse(JSON.stringify(findings));
}
