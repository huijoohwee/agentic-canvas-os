import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { LANE_CLAIM_STATES, PROJECTION_SCHEMA_ID, observationTimestampFor, validateRedactedFields, validateStructural } from "../scripts/orchestration-projection-contract.mjs";
import { buildProjection, deriveLaneAxis } from "../scripts/orchestration-projection-controller.mjs";
import { projectionDigestSubject, readProjectionCanonicalValue, renderProjectionDocument } from "../scripts/orchestration-projection-document.mjs";
import { renderRawReceiptProjection } from "../scripts/orchestration-projection-receipt-table.mjs";
import { readAuthoredAxis } from "../scripts/orchestration-projection-repository-adapter.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectorModulePaths = [
  "orchestration-projection-contract.mjs",
  "orchestration-projection-controller.mjs",
  "orchestration-projection-document.mjs",
  "orchestration-projection-evidence.mjs",
  "orchestration-projection-receipt-table.mjs",
  "orchestration-projection-repository-adapter.mjs",
  "orchestration-projection.mjs",
].map((file) => path.join(repositoryRoot, "scripts", file));
const workspaceParallelismEmitterPath = path.join(repositoryRoot, "scripts", "workspace-parallelism-lib.mjs");
const projectionContractPath = path.join(repositoryRoot, "docs", "ORCHESTRATION-PROJECTION.md");
const dashboardCanvasRoot = path.join(path.dirname(repositoryRoot), "knowgrph", "canvas");
const dashboardMetricProgram = [
  "import { readFileSync } from 'node:fs';",
  "import { buildDashboardCanvasModel } from './src/components/DashboardCanvas/dashboardModel.ts';",
  "const graph = JSON.parse(readFileSync(0, 'utf8'));",
  "const nodesMetric = buildDashboardCanvasModel(graph, undefined).metrics.find(({ id }) => id === 'nodes');",
  "process.stdout.write(JSON.stringify(nodesMetric));",
].join("\n");

function dashboardProjectionGraph(text) {
  const projection = readProjectionCanonicalValue(text);
  return {
    type: "OrchestrationProjection",
    metadata: { frontmatterMeta: { title: projection.title, sourceKind: "orchestration-projection" } },
    nodes: projection.nodes,
    edges: [],
  };
}

function readDashboardNodesMetric(graph) {
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", dashboardMetricProgram], {
    cwd: dashboardCanvasRoot,
    encoding: "utf8",
    input: JSON.stringify(graph),
  }));
}

function quotedLiteralPattern(value) {
  return new RegExp(String.raw`["']${value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}["']`, "u");
}

function multiplicationProducts(source) {
  return [...source.matchAll(/\b\d+(?:_\d+)?(?:\s*\*\s*\d+(?:_\d+)?)+\b/gu)]
    .map(([expression]) => expression.split("*").map((factor) => Number(factor.trim().replaceAll("_", ""))))
    .map((factors) => factors.reduce((product, factor) => product * factor, 1));
}

const receipts = {
  "agentic-worktree-lifecycle-report/v1": { schema: "agentic-worktree-lifecycle-report/v1", repository: "knowgrph", canonicalSha: "a".repeat(40), status: "ready", worktrees: [{ repository: "knowgrph", scope: "alpha", branch: "refs/heads/agent/a/alpha", path: "redacted" }] },
  "agentic-workspace-parallelism-report/v1": { schema: "agentic-workspace-parallelism-report/v1", generatedAt: "2026-08-19T00:00:00.000Z", repositories: [], lanes: [{ repository: "knowgrph", scope: "beta", branch: "refs/heads/agent/a/beta", worktree: "redacted" }], summary: {} },
  "agentic-writer-lease-registry/v2": { schema: "agentic-writer-lease-registry/v2", leases: [{ repository: "knowgrph", scope: "alpha", state: "current", heartbeatAt: "2026-08-19T00:00:00.000Z", sessionId: "[redacted]", ownershipTokenDigest: "[redacted]" }] },
  "agentic-local-runtime-readiness/v1": { schema: "agentic-local-runtime-readiness/v1", status: "runtime-ready", verifiedAt: "2026-08-19T00:00:00.000Z", startedAt: "2026-08-19T00:00:00.000Z", source: {}, agenticCanvasOs: {} },
  "agentic-coordination-scheduler-report/v1": { schema: "agentic-coordination-scheduler-report/v1", summary: {}, waves: [], ready: [], waiting: [], blocked: [] },
  "agentic-collaboration-gate-result/v2": { schema: "agentic-collaboration-gate-result/v2", status: "passed" },
};

test("projection contract constants are stable", () => {
  assert.match(PROJECTION_SCHEMA_ID, /^agentic-orchestration-projection\/v\d+$/u);
  assert.deepEqual(LANE_CLAIM_STATES, ["current", "waiting-successor", "reviewed", "integrated-preserved", "dormant-preserved", "retired"]);
});

test("projection contract claim-state vocabulary tracks the workspace-parallelism emitter", () => {
  const emitterSource = readFileSync(workspaceParallelismEmitterPath, "utf8");
  const declaration = emitterSource.match(/const\s+CURRENT_CLAIM_STATES\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)\s*;/u);
  assert.ok(declaration, "workspace-parallelism must declare CURRENT_CLAIM_STATES as a Set literal");

  const emitterStates = [...declaration[1].matchAll(/(["'])([a-z][a-z-]*)\1/gu)].map(([, , state]) => state);
  const residual = declaration[1]
    .replace(/(["'])([a-z][a-z-]*)\1/gu, "")
    .replace(/[\s,]/gu, "");
  assert.equal(residual, "", "CURRENT_CLAIM_STATES must contain only string literals");
  assert.equal(new Set(emitterStates).size, emitterStates.length, "emitter claim states must be unique");
  assert.equal(new Set(LANE_CLAIM_STATES).size, LANE_CLAIM_STATES.length, "projection claim states must be unique");
  assert.deepEqual([...new Set(LANE_CLAIM_STATES)].sort(), [...new Set(emitterStates)].sort());
});

test("structural validation rejects schema and redaction drift", () => {
  assert.equal(validateStructural("agentic-worktree-lifecycle-report/v1", { schema: "wrong" }).reason, "schema-id-mismatch");
  assert.equal(validateStructural("agentic-writer-lease-registry/v2", { schema: "agentic-writer-lease-registry/v2", leases: [{ state: "active", sessionId: "abc" }] }).reason, "schema-validation-failed");
  assert.equal(validateRedactedFields("agentic-local-runtime-readiness/v1", { ownershipTokenDigest: "a".repeat(64) }).reason, "schema-validation-failed");
});

test("raw receipt projection retains exact source fields", () => {
  const sourceRecords = Object.values(receipts).reverse();
  const parsed = JSON.parse(renderRawReceiptProjection(sourceRecords));
  const expected = [...sourceRecords].sort((left, right) => left.schema.localeCompare(right.schema));
  assert.deepEqual(parsed, expected);
  for (const record of parsed) {
    const source = sourceRecords.find((candidate) => candidate.schema === record.schema);
    assert.deepEqual(Object.keys(record).sort(), Object.keys(source).sort());
    assert.equal(observationTimestampFor(record.schema, record), observationTimestampFor(source.schema, source));
  }
});

test("Feature: orchestration-projection-visualization, Property 15: Raw receipt projection fidelity", () => {
  const receiptSet = Object.values(receipts);
  const permutations = fc.shuffledSubarray(receiptSet, { minLength: receiptSet.length, maxLength: receiptSet.length });
  fc.assert(fc.property(permutations, (sourceRecords) => {
    const parsed = JSON.parse(renderRawReceiptProjection(sourceRecords));
    assert.equal(parsed.length, sourceRecords.length);
    assert.deepEqual(parsed.map((record) => record.schema), sourceRecords.map((record) => record.schema).sort());
    for (const record of parsed) {
      const source = sourceRecords.find((candidate) => candidate.schema === record.schema);
      assert.deepEqual(Object.keys(record).sort(), Object.keys(source).sort());
      assert.deepEqual(record, source);
      assert.equal(observationTimestampFor(record.schema, record), observationTimestampFor(source.schema, source));
    }
  }), { numRuns: 100 });
});

test("Feature: orchestration-projection-visualization, Property 8: Projection shape", () => {
  const scopeName = fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-"), { minLength: 1, maxLength: 9 })
    .filter((value) => /^[a-z][a-z0-9-]*$/u.test(value));
  fc.assert(fc.property(fc.uniqueArray(scopeName, { minLength: 1, maxLength: 4 }), (scopes) => {
    const laneReceipts = { ...receipts["agentic-workspace-parallelism-report/v1"], lanes: scopes.map((scope) => ({ repository: "repo", scope })) };
    const lanes = deriveLaneAxis({ workspaceParallelism: laneReceipts });
    assert.deepEqual(lanes.map((lane) => lane.lane), scopes.map((scope) => "repo::" + scope).sort());
    const projected = buildProjection({ receipts: Object.values({ ...receipts, "agentic-workspace-parallelism-report/v1": laneReceipts }), stageAxis: ["a", "b", "c"], stalenessBoundSeconds: 1800 });
    assert.equal(projected.ok, true);
    assert.equal(projected.value.nodes.length, projected.value.lanes.length * 3);
    assert.ok(projected.value.nodes.every((node) => LANE_CLAIM_STATES.includes(node.properties.claimState)));
  }), { numRuns: 100 });
});

test("Feature: orchestration-projection-visualization, Property 5: Stage position consistency", () => {
  const projected = buildProjection({ receipts: Object.values(receipts), stageAxis: ["discover", "fetch", "inspect"], stalenessBoundSeconds: 1800 });
  assert.equal(projected.ok, true);
  for (const node of projected.value.nodes) assert.equal(projected.value.stageAxis[node.properties.order], node.properties.step);
});

test("Dashboard boundary reads generated projection node counts without renderer changes", () => {
  const projected = buildProjection({ receipts: Object.values(receipts), stageAxis: ["discover", "fetch"], stalenessBoundSeconds: 1800 });
  assert.equal(projected.ok, true);
  const text = renderProjectionDocument(projected.value, projected.digest);
  const nodesMetric = readDashboardNodesMetric(dashboardProjectionGraph(text));
  assert.equal(nodesMetric.id, "nodes");
  assert.equal(nodesMetric.value, String(projected.value.nodes.length));
});

test("Feature: orchestration-projection-visualization, Property 16: Dashboard node metric tracks node count", () => {
  const scopeName = fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-"), { minLength: 1, maxLength: 9 })
    .filter((value) => /^[a-z][a-z0-9-]*$/u.test(value));
  const stageName = fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), { minLength: 1, maxLength: 8 });
  fc.assert(fc.property(
    fc.uniqueArray(scopeName, { minLength: 1, maxLength: 3 }),
    fc.uniqueArray(stageName, { minLength: 1, maxLength: 4 }),
    (scopes, stageAxis) => {
      const laneReceipt = {
        ...receipts["agentic-workspace-parallelism-report/v1"],
        lanes: scopes.map((scope) => ({ repository: "repo", scope })),
      };
      const projected = buildProjection({
        receipts: Object.values({ ...receipts, "agentic-workspace-parallelism-report/v1": laneReceipt }),
        stageAxis,
        stalenessBoundSeconds: 1800,
      });
      assert.equal(projected.ok, true);
      const text = renderProjectionDocument(projected.value, projected.digest);
      const nodesMetric = readDashboardNodesMetric(dashboardProjectionGraph(text));
      assert.equal(nodesMetric.value, String(projected.value.nodes.length));
    },
  ), { numRuns: 20 });
});

test("Dashboard metric semantics document each fixed metric without inventing rollups", () => {
  const source = readFileSync(projectionContractPath, "utf8");
  const [, afterHeading] = source.split("## Dashboard rollup semantics\n");
  const section = afterHeading?.split("\n## ")[0];
  assert.ok(section, "the authored contract must contain a Dashboard rollup section");
  assert.match(section, /`nodes`\s*-\s*\*\*Orchestration meaning\.\*\*/u);
  for (const metric of ["edges", "density", "signals", "grid"]) {
    assert.match(section, new RegExp("`" + metric + "`\\s*-\\s*\\*\\*Generic only\\.\\*\\*", "u"));
  }
  assert.match(section, /does not select a Dashboard renderer|does not .*renderer mode/u);
});

test("digest round-trip, Storyboard preset, and non-leakage", () => {
  const projected = buildProjection({ receipts: Object.values(receipts), stageAxis: ["discover", "fetch"], stalenessBoundSeconds: 1800 });
  assert.equal(projected.ok, true);
  const text = renderProjectionDocument(projected.value, projected.digest);
  assert.equal(digestValue(projectionDigestSubject(text)), projected.digest);
  assert.equal(readProjectionCanonicalValue(text).kgCanvas2dRenderer, "storyboard");
  assert.match(text, /^kgCanvas2dRenderer: "storyboard"$/mu);
  assert.doesNotMatch(text, /sessionId|ownershipTokenDigest|localhost|127\.0\.0\.1/u);
});

test("staleness and budget failures are typed", () => {
  const stale = { ...receipts["agentic-workspace-parallelism-report/v1"], generatedAt: "2026-08-18T00:00:00.000Z" };
  const staleResult = buildProjection({ receipts: Object.values({ ...receipts, "agentic-workspace-parallelism-report/v1": stale }), stageAxis: ["a"], stalenessBoundSeconds: 1 });
  assert.equal(staleResult.reason, "stale-observation");
  const budgetReceipts = {
    ...receipts,
    "agentic-workspace-parallelism-report/v1": {
      ...receipts["agentic-workspace-parallelism-report/v1"],
      lanes: Array.from({ length: 120 }, (_, index) => ({ repository: "repo", scope: "scope-" + index })),
    },
  };
  const budgetResult = buildProjection({ receipts: Object.values(budgetReceipts), stageAxis: ["a", "b", "c", "d", "e", "f"], stalenessBoundSeconds: 1800 });
  assert.equal(budgetResult.reason, "budget-exceeded");
});


test("literal/source cross-checks keep projection vocabulary and bounds authored once", () => {
  const authored = readAuthoredAxis({ repositoryRoot });
  assert.equal(authored.ok, true);

  const sources = projectorModulePaths.map((modulePath) => ({
    modulePath,
    text: readFileSync(modulePath, "utf8"),
  }));
  const schemaOccurrences = sources
    .flatMap(({ modulePath, text }) => [...text.matchAll(new RegExp(PROJECTION_SCHEMA_ID, "gu"))]
      .map((match) => modulePath + ":" + match.index));
  assert.equal(schemaOccurrences.length, 1, "the projection schema literal must have one production declaration");

  for (const stage of authored.stageAxis) {
    const offenders = sources
      .filter(({ text }) => quotedLiteralPattern(stage).test(text))
      .map(({ modulePath }) => modulePath);
    assert.deepEqual(offenders, [], "stage " + stage + " must remain authored only in docs/START-WORKFLOW.md");
  }

  const forbiddenBounds = new Set([
    authored.stalenessBoundSeconds,
    authored.stalenessBoundSeconds * 1000,
  ]);
  for (const { modulePath, text } of sources) {
    const numericLiterals = [...text.matchAll(/\b\d+(?:_\d+)?\b/gu)]
      .map(([literal]) => Number(literal.replaceAll("_", "")));
    const forbiddenLiteral = numericLiterals.find((value) => forbiddenBounds.has(value));
    assert.equal(forbiddenLiteral, undefined, `${modulePath} hardcodes the authored staleness bound`);
    const forbiddenProduct = multiplicationProducts(text).find((value) => forbiddenBounds.has(value));
    assert.equal(forbiddenProduct, undefined, `${modulePath} computes the authored staleness bound from literals`);
  }
});