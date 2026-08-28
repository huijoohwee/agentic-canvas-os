import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createCrossRepositoryCoordinationTask,
  deriveCrossRepositoryWaves,
} from "../scripts/integration-order-contract.mjs";

const semanticScope = "git-guidelines-companion";
const authenticatedRepositoryIds = Object.freeze({
  "huijoohwee/huijoohwee.github.io": "github-repository:R_kgDOP3NVnQ",
  "huijoohwee/agentic-canvas-os": "github-repository:R_kgDOSr5-fA",
});
const sourceGuideline = Object.freeze({
  repository: "huijoohwee/huijoohwee.github.io",
  revision: "8a2e5e0711f7193535b9aac2aee285e0ee705111",
  tree: "63c13dcfb3ce01aa60213f4f6fa214bfa0e76778",
  guidelineDigest: "ff4f0dc41209bdacb05001b6fd5a450883736118f89fcff6fab331cedca8c2bd",
  companionDigest: "c8831f6c6642f89c3e5f51af55523e1e4db1ed08b118840daa0d4f28289806e5",
});

function unit({
  unitId,
  repository,
  worktree,
  branch = "agent/huis-macbook-pro-3.local/git-guidelines-companion",
  paths,
  claimId,
  fence,
  pullRequest,
  sourceRevision,
}) {
  const declaredWriteScope = normalizeWriteSet([
    ...paths.map((path) => `path:${path}`),
    `semantic:${semanticScope}`,
  ]);
  return {
    unitId,
    repository,
    repositoryId: authenticatedRepositoryIds[repository],
    branch,
    worktree,
    semanticScope,
    declaredWriteScope,
    writeSetDigest: digestValue(declaredWriteScope),
    claimId,
    authorityEpoch: 1,
    fence,
    pullRequest,
    sourceRevision,
    sourceDigest: digestValue({ repository, sourceRevision, declaredWriteScope }),
    namedChecks: [`${unitId}:focused`],
    handoffEvidenceDigest: digestValue({ unitId, sourceRevision, status: "preserved" }),
  };
}

function sourceUnit() {
  return unit({
    unitId: "jh-source",
    repository: sourceGuideline.repository,
    worktree: "$GITHUB_ROOT/.worktrees/huijoohwee.github.io/git-guidelines-companion",
    paths: [
      "guidelines/agentic-sdlc-guidelines.md",
      "docs/documents/git-guidelines.md",
      "package-lock.json",
      "package.json",
      "scripts/__pbt__",
      "scripts/__tests__",
      "scripts/check-agentic-sdlc-guideline.mjs",
      "scripts/check-git-guidelines.mjs",
      "scripts/lib/git-guidelines",
    ],
    claimId: "94044fa315b75fc51f2a8403e1189cb8bcb4b6067d6038486f530ed57e53f327",
    fence: "d7767bc036e5f9b618cc3807a87dcbf0a361d61b68b5492814e6d805be2f7565",
    pullRequest: "https://github.com/huijoohwee/huijoohwee.github.io/pull/97",
    sourceRevision: sourceGuideline.revision,
  });
}

function projectionUnit() {
  return unit({
    unitId: "acos-projection",
    repository: "huijoohwee/agentic-canvas-os",
    worktree: "$GITHUB_ROOT/.worktrees/agentic-canvas-os/git-guidelines-companion",
    paths: [
      ".github/workflows/cloud-collaboration.yml",
      "__tests__/cloud-collaboration-cli.test.mjs",
      "__tests__/cloud-collaboration-contract.test.mjs",
      "__tests__/cloud-collaboration-delivery-verifier.test.mjs",
      "__tests__/cloud-collaboration-projection.test.mjs",
      "__tests__/cross-repository-coordination-task.test.mjs",
      "__tests__/github-cloud-collaboration-adapter.test.mjs",
      "__tests__/integration-order-contract.test.mjs",
      "__tests__/scoped-lane-cloud-authority.test.mjs",
      "__tests__/workspace-parallelism.test.mjs",
      "docs/CLOUD-COLLABORATION.md",
      "docs/DICTIONARY-BINDING.md",
      "docs/DICTIONARY-COMMAND.md",
      "docs/DICTIONARY-SEMANTIC.md",
      "docs/FACTS.md",
      "docs/INTEGRATION-ORDER.md",
      "docs/README.md",
      "docs/WORKSPACE-PARALLELISM.md",
      "docs/schemas/cloud-collaboration-ledger.v1.schema.json",
      "docs/schemas/cross-repository-coordination-task.v1.schema.json",
      "scripts/cloud-collaboration-contract.mjs",
      "scripts/cloud-collaboration-delivery-verifier.mjs",
      "scripts/cloud-collaboration-primitives.mjs",
      "scripts/cloud-collaboration.mjs",
      "scripts/github-cloud-collaboration-adapter.mjs",
      "scripts/github-cloud-collaboration-mapping.mjs",
      "scripts/integration-order-contract.mjs",
      "scripts/scoped-lane-cloud-authority.mjs",
      "scripts/scoped-lane-cloud-reconciliation.mjs",
      "scripts/workspace-parallelism-guard.mjs",
      "scripts/workspace-parallelism-lib.mjs",
    ],
    claimId: "ac3d63b4b3c82ef5f24aec20ded414283c0e3f6e5c3a62e3ab76b533cda1a2a4",
    fence: "57376049741aa005e448a22dbd0f3ae4ef11aaa52cc34d343f7ced80433cc1e5",
    pullRequest: "https://github.com/huijoohwee/agentic-canvas-os/pull/261",
    sourceRevision: "18269c0a980f8a9d7ea58cf80fb6ed3c99caa574",
  });
}

function task(overrides = {}) {
  return createCrossRepositoryCoordinationTask({
    taskId: "git-guidelines-companion",
    semanticScope,
    sourceGuideline,
    units: [projectionUnit(), sourceUnit()],
    dependencyEdges: [{ from: "jh-source", to: "acos-projection" }],
    ...overrides,
  });
}

test("task is an immutable DAG of repository-owned work units", () => {
  const record = task();
  assert.deepEqual(record.units.map((entry) => entry.unitId), ["acos-projection", "jh-source"]);
  assert.equal(record.units.find((entry) => entry.unitId === "jh-source").writeSetDigest,
    "044ad54719ed8b377e11e03c8a9100679e36de001e38d1b1b548f954ad579c46");
  assert.equal(record.units.find((entry) => entry.unitId === "acos-projection").writeSetDigest,
    "dc222952ecac0427122dbfffe1f9903888fc8e0e4c951a42ce12a4bebcda8a8e");
  assert.deepEqual(deriveCrossRepositoryWaves(record), [["jh-source"], ["acos-projection"]]);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.units[0]), true);
  assert.equal(record.sourceGuideline.tree, "63c13dcfb3ce01aa60213f4f6fa214bfa0e76778");
  assert.match(record.taskDigest, /^[0-9a-f]{64}$/u);
});

test("shared worktrees, claims, stale write digests, and cycles fail closed", () => {
  const source = sourceUnit();
  const projection = projectionUnit();
  assert.throws(() => task({
    units: [source, { ...projection, worktree: source.worktree }],
  }), /worktree values must be unique/u);
  assert.throws(() => task({
    units: [source, { ...projection, claimId: source.claimId }],
  }), /claimId values must be unique/u);
  assert.throws(() => task({
    units: [source, { ...projection, writeSetDigest: "0".repeat(64) }],
  }), /writeSetDigest is stale/u);
  assert.throws(() => task({
    dependencyEdges: [
      { from: "jh-source", to: "acos-projection" },
      { from: "acos-projection", to: "jh-source" },
    ],
  }), /cycle/u);
});

test("deserialized tasks revalidate constructor identity even with a recomputed digest", () => {
  const forged = structuredClone(task());
  forged.units[0].worktree = forged.units[1].worktree;
  const { taskDigest: _taskDigest, ...unsigned } = forged;
  forged.taskDigest = digestValue(unsigned);
  assert.equal(forged.taskDigest, digestValue(unsigned));
  assert.throws(() => deriveCrossRepositoryWaves(forged), /worktree values must be unique/u);
});

test("source identity pins its tree and exactly one matching repository unit", () => {
  const alternateTree = task({ sourceGuideline: { ...sourceGuideline, tree: "a".repeat(40) } });
  assert.notEqual(alternateTree.taskDigest, task().taskDigest);
  assert.throws(() => task({
    sourceGuideline: { ...sourceGuideline, tree: "not-a-tree" },
  }), /sourceGuideline\.tree/u);
  assert.throws(() => task({
    sourceGuideline: { ...sourceGuideline, revision: "a".repeat(40) },
  }), /exactly one unit pinned/u);
});

test("authenticated repository authority identity is required and task-digest bound", () => {
  const source = sourceUnit();
  const changedAuthority = task({
    units: [{ ...source, repositoryId: projectionUnit().repositoryId }, projectionUnit()],
  });
  assert.notEqual(changedAuthority.taskDigest, task().taskDigest);
  const { repositoryId: _repositoryId, ...missingAuthority } = source;
  assert.throws(() => task({ units: [missingAuthority, projectionUnit()] }), /missing or unknown fields/u);
});

test("parent and child write paths cannot share an integration wave", async () => {
  const source = await readFile(
    new URL("../scripts/integration-order-contract.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /writeSetsOverlap\(scopes, unit\.writeScopes\)/u);
  assert.match(source, /peer\.repository === unit\.repository/u);
});

test("schema is closed and provider-neutral", async () => {
  const schema = JSON.parse(await readFile(
    new URL("../docs/schemas/cross-repository-coordination-task.v1.schema.json", import.meta.url),
    "utf8",
  ));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.$defs.unit.additionalProperties, false);
  assert.equal(schema.$defs.unit.required.includes("repositoryId"), true);
  assert.equal(schema.$defs.dependencyEdge.additionalProperties, false);
  assert.deepEqual(schema.$defs.sourceGuideline.required,
    ["repository", "revision", "tree", "guidelineDigest", "companionDigest"]);
  assert.equal(schema.$defs.sourceGuideline.properties.tree.$ref, "#/$defs/gitRevision");
  assert.doesNotMatch(JSON.stringify(schema), /github|cloudflare|yjs/iu);
});
