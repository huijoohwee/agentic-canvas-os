import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runAudit } from "../scripts/alignment-audit/alignment-auditor.mjs";
import { resolveAuditConfig } from "../scripts/alignment-audit/config.mjs";
import { createInMemoryWriteSink } from "../scripts/alignment-audit/output-boundary.mjs";
import { createNodeSourceReader } from "../scripts/alignment-audit/source-reader.mjs";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONFIG_PATH = path.join(
  REPOSITORY_ROOT,
  "scripts/alignment-audit/alignment-audit.config.json",
);
const FIXTURE_INVOCATION_ROUTES = Object.freeze([
  { surface: "slash", token: "/alignment.audit", owner: "alignment-audit-contract" },
  { surface: "hash", token: "#alignment-audit", owner: "alignment-audit-contract" },
  { surface: "at", token: "@alignment-audit", owner: "alignment-audit-contract" },
  { surface: "mcp", token: "alignment.audit", owner: "alignment-audit-contract" },
]);

test("committed fixture pair completes the non-mutating audit lane deterministically", async () => {
  const supplied = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const config = await resolveAuditConfig(supplied, { baseDirectory: REPOSITORY_ROOT });
  const reader = createNodeSourceReader();
  const sink = createInMemoryWriteSink();

  const first = await runAudit(config, reader, sink);
  assertRunInvariants(first);
  const auditedRoutes = new Map(
    first.artifactIndex.entries.flatMap((entry) => entry.invocationRoutes)
      .map((route) => [`${route.surface}\0${route.token}`, route]),
  );
  assert.deepEqual(
    [...auditedRoutes.values()].sort(compareRoutes),
    [...FIXTURE_INVOCATION_ROUTES].sort(compareRoutes),
  );
  assert.deepEqual(
    first.gates.gates.map(({ state }) => state),
    Array.from({ length: 7 }, () => "met"),
  );
  assert.equal(
    first.readiness.assignments.find(({ capabilityId }) =>
      capabilityId === "alignment-audit")?.assignedLevel,
    "runtime-ready",
  );
  assert.equal(
    first.findings.some(({ severity }) => severity === "blocker" || severity === "major"),
    false,
  );
  assert.deepEqual(
    first.artifacts.map((artifact) => artifact.relativeName),
    [
      "alignment-audit-report-v1.0.0.md",
      "guideline-digest-v1.0.0.md",
      "artifact-index-v1.0.0.md",
    ],
  );
  const retained = new Map(sink.files);

  const second = await runAudit(config, reader, sink);
  assertRunInvariants(second);
  assert.deepEqual(canonicalFindings(second.findings), canonicalFindings(first.findings));
  assert.equal(second.version, "1.0.1");
  for (const [name, content] of retained) assert.equal(sink.files.get(name), content);
  assert.equal(sink.files.size, 6);
});

function assertRunInvariants(result) {
  assert.equal(result.artifacts.length, 3);
  assert.equal(
    result.artifacts.filter((artifact) =>
      /^alignment-audit-report-v\d+\.\d+\.\d+\.md$/u.test(artifact.relativeName)).length,
    1,
  );
  assert.equal(
    result.artifacts.filter((artifact) =>
      /^guideline-digest-v\d+\.\d+\.\d+\.md$/u.test(artifact.relativeName)).length,
    1,
  );
  assert.equal(
    result.artifacts.filter((artifact) =>
      /^artifact-index-v\d+\.\d+\.\d+\.md$/u.test(artifact.relativeName)).length,
    1,
  );
  for (const artifact of result.artifacts) {
    assert.equal(path.posix.isAbsolute(artifact.relativeName), false);
    assert.equal(artifact.relativeName.split("/").includes(".."), false);
  }
  assert.equal(result.modifiedOutsideOutputCount, 0);
  assert.equal(result.baselineVerified, true);
  assert.equal(result.deployBoundaryState, "closed");
  assert.match(result.report, /^---\n/u);
  assert.match(result.report, /\n## Alignment Summary\n/u);
  assert.match(result.report, /\n## Readiness Gap Matrix\n/u);
  assert.match(result.report, /\n## Findings\n/u);
  assert.match(result.report, /\n## Pipeline Gate States\n/u);
}

function canonicalFindings(findings) {
  return JSON.parse(JSON.stringify(findings));
}

function compareRoutes(left, right) {
  return left.surface.localeCompare(right.surface, "en") ||
    left.token.localeCompare(right.token, "en");
}
