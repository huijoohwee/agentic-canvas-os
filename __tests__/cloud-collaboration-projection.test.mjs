import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ROOT_OPERATIONS } from "../scripts/cloud-collaboration-primitives.mjs";
import { projectPublicClaim } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  projectRootState,
  rootStateForProjection,
} from "../scripts/scoped-lane-cloud-reconciliation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootOperations = ["claim", "continue", "integrate", "retire"];
const historicalOperations = [
  "bind",
  "heartbeat",
  "review-ready",
  "delivery-authorize",
  "handoff",
  "release",
];

function valuesFromSet(source, name) {
  const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`, "u"));
  assert.ok(match, `${name} set must be declared explicitly`);
  return [...match[1].matchAll(/"([^"]+)"/gu)].map((entry) => entry[1]);
}

function exportedFunction(source, name) {
  const start = source.indexOf(`export function ${name}`);
  assert.notEqual(start, -1, `${name} must remain an explicit projection owner`);
  const next = source.indexOf("\nexport function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }));
  return nested.flat();
}

test("public claim projection preserves bounded recovery evidence", () => {
  const recovery = {
    evidenceDigest: "a".repeat(64),
    recoveredAt: "2026-08-20T11:00:00.000Z",
  };

  assert.deepEqual(projectPublicClaim({ recovery }).recovery, recovery);
  assert.equal(projectPublicClaim({}).recovery, null);
});

test("public mutation projections expose exactly the four provider-neutral root operations", async () => {
  assert.deepEqual([...ROOT_OPERATIONS], rootOperations);

  const [primitives, adapter, cli, workflow] = await Promise.all([
    source("scripts/cloud-collaboration-primitives.mjs"),
    source("scripts/github-cloud-collaboration-adapter.mjs"),
    source("scripts/cloud-collaboration.mjs"),
    source(".github/workflows/cloud-collaboration.yml"),
  ]);
  assert.match(primitives, /export const MUTATING_ACTIONS = new Set\(ROOT_OPERATIONS\)/u);
  assert.deepEqual(valuesFromSet(adapter, "MUTATING_ACTIONS"), rootOperations);
  assert.deepEqual(valuesFromSet(cli, "MUTATIONS"), rootOperations);

  const options = workflow.match(/^\s+options:\s*\n((?:\s+-\s+[^\n]+\n)+)/mu);
  assert.ok(options, "workflow dispatch action options must be present");
  const workflowActions = [...options[1].matchAll(/^\s+-\s+([^\s]+)\s*$/gmu)]
    .map((entry) => entry[1]);
  assert.deepEqual(workflowActions, ["status", "verify", ...rootOperations]);

  for (const historical of historicalOperations) {
    assert.equal(valuesFromSet(adapter, "MUTATING_ACTIONS").includes(historical), false);
    assert.equal(valuesFromSet(cli, "MUTATIONS").includes(historical), false);
    assert.equal(workflowActions.includes(historical), false);
  }
});

test("cloud collaboration workflow stays within the dispatch input cap", async () => {
  const workflow = await source(".github/workflows/cloud-collaboration.yml");
  const dispatch = workflow.match(
    /^  workflow_dispatch:\s*\n    inputs:\s*\n([\s\S]*?)(?=^permissions:)/mu,
  );
  assert.ok(dispatch, "workflow_dispatch inputs must be declared explicitly");

  const declaredInputs = [...dispatch[1].matchAll(/^      ([a-z0-9_]+):\s*$/gmu)]
    .map((entry) => entry[1]);
  assert.ok(
    declaredInputs.length <= 25,
    `workflow_dispatch declares ${declaredInputs.length} inputs; GitHub permits at most 25`,
  );
  assert.equal(new Set(declaredInputs).size, declaredInputs.length);
  assert.ok(declaredInputs.includes("request_json"));

  const referencedInputs = [...workflow.matchAll(/\binputs\.([a-z0-9_]+)/gu)]
    .map((entry) => entry[1]);
  const undeclaredInputs = [...new Set(referencedInputs)]
    .filter((name) => !declaredInputs.includes(name));
  assert.deepEqual(undeclaredInputs, []);

  const requestJsonMapping = /AGENTIC_CLOUD_REQUEST_JSON:\s*\$\{\{\s*inputs\.request_json\s*\}\}/u;
  const dispatchJobs = [
    ["read", workflow.match(/^  read:\s*\n([\s\S]*?)(?=^  mutate:)/mu)?.[1]],
    ["mutate", workflow.match(/^  mutate:\s*\n([\s\S]*)$/mu)?.[1]],
  ];
  for (const [jobName, job] of dispatchJobs) {
    assert.ok(job, `${jobName} job must remain declared`);
    assert.match(
      job,
      requestJsonMapping,
      `${jobName} job must project request_json into the existing CLI pathway`,
    );
  }
});

test("scoped lifecycle helper names are replaceable projections, not semantic aliases", async () => {
  const authority = await source("scripts/scoped-lane-cloud-authority.mjs");
  const projectionCases = [
    ["bindAdmissionCloudAuthority", "continue", "projection"],
    ["heartbeatAdmissionCloudAuthority", "continue", "renewal"],
    ["reviewReadyAdmissionCloudAuthority", "continue", "review"],
  ];
  for (const [name, operation, mode] of projectionCases) {
    const owner = exportedFunction(authority, name);
    assert.match(owner, new RegExp(`action:\\s*"${operation}"`, "u"));
    assert.match(owner, new RegExp(`mode:\\s*"${mode}"`, "u"));
  }
  const integrationProjection = exportedFunction(
    authority,
    "authorizeDeliveryAdmissionCloudAuthority",
  );
  assert.match(integrationProjection, /action:\s*"integrate"/u);
  assert.match(integrationProjection, /requiredDigest\(\s*operatorDecisionDigest/u);
  assert.match(integrationProjection, /requiredDigest\(\s*integrationIntentDigest/u);
  assert.doesNotMatch(
    authority,
    /action:\s*"(?:bind|heartbeat|review-ready|delivery-authorize|handoff|release)"/u,
  );

  assert.deepEqual(rootOperations.map(projectRootState), [
    "claim",
    "continue",
    "integrate",
    "retire",
  ]);
  assert.deepEqual(
    ["current", "reviewed", "integrated-preserved", "dormant-preserved", "retired"]
      .map(projectRootState),
    ["active", "review_ready", "delivery_authorized", "parked", "released"],
  );
  assert.deepEqual(
    ["active", "review_ready", "delivery_authorized", "parked", "released"]
      .map(rootStateForProjection),
    ["current", "reviewed", "integrated-preserved", "dormant-preserved", "retired"],
  );
});

test("ledger and cross-repository schemas are closed and version-branched", async () => {
  const [ledger, coordination] = await Promise.all([
    source("docs/schemas/cloud-collaboration-ledger.v1.schema.json").then(JSON.parse),
    source("docs/schemas/cross-repository-coordination-task.v1.schema.json").then(JSON.parse),
  ]);
  assert.equal(ledger.additionalProperties, false);
  assert.equal(ledger.$defs.legacyClaimCore.additionalProperties, false);
  assert.equal(ledger.$defs.currentClaimCore.additionalProperties, false);
  assert.deepEqual(
    ledger.$defs.currentEntryBase.allOf[1].properties.action.enum,
    rootOperations,
  );
  assert.deepEqual(ledger.$defs.typedOperationReceipt.properties.operation.enum, rootOperations);
  assert.deepEqual(
    ledger.$defs.entry.oneOf.slice(1).map((entry) => entry.$ref),
    [
      "#/$defs/currentClaimEntry",
      "#/$defs/currentContinuationEntry",
      "#/$defs/currentIntegrationEntry",
      "#/$defs/currentRetirementEntry",
    ],
  );
  assert.equal(coordination.additionalProperties, false);
  assert.equal(coordination.$defs.unit.additionalProperties, false);
  assert.equal(coordination.$defs.dependencyEdge.additionalProperties, false);
  assert.deepEqual(coordination.required, [
    "schema",
    "taskId",
    "semanticScope",
    "sourceGuideline",
    "units",
    "dependencyEdges",
    "taskDigest",
  ]);
});

test("Yjs remains one delimited inspiration-only reference with no dependency or runtime", async () => {
  const [packageSource, lockSource, documentationFiles, runtimeFiles] = await Promise.all([
    source("package.json"),
    source("package-lock.json"),
    filesBelow(path.join(repositoryRoot, "docs")),
    Promise.all([
      filesBelow(path.join(repositoryRoot, "scripts")),
      filesBelow(path.join(repositoryRoot, "agent-api", "src")),
      filesBelow(path.join(repositoryRoot, ".github", "workflows")),
    ]).then((groups) => groups.flat()),
  ]);
  assert.doesNotMatch(packageSource, /(?:"|\/)yjs(?:"|\/)/iu);
  assert.doesNotMatch(lockSource, /(?:"|\/)yjs(?:"|\/)/iu);

  const executableExtensions = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx", ".yaml", ".yml"]);
  const executableSources = await Promise.all(runtimeFiles
    .filter((file) => executableExtensions.has(path.extname(file)))
    .map((file) => readFile(file, "utf8")));
  assert.doesNotMatch(
    executableSources.join("\n"),
    /github\.com\/yjs\/yjs|(?:from\s+|require\(\s*|import\(\s*)["'](?:yjs|@yjs\/)/iu,
  );

  const markdownSources = await Promise.all(documentationFiles
    .filter((file) => path.extname(file) === ".md")
    .map((file) => readFile(file, "utf8")));
  const documentation = markdownSources.join("\n");
  assert.equal((documentation.match(/https:\/\/github\.com\/yjs\/yjs/giu) ?? []).length, 1);
  const advisory = await source("docs/CLOUD-COLLABORATION.md");
  assert.match(advisory, /## Inspiration-Only Advisory/u);
  assert.match(advisory, /\[[^\]]+\]\(https:\/\/github\.com\/yjs\/yjs\)/u);
  assert.match(advisory, /dependencies, imports, or\s+runtime behavior is forbidden/u);
});
