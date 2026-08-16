import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_SEVERITY,
  FINDING_TYPES,
  makeFinding,
} from "../scripts/alignment-audit/finding.mjs";
import { renderAuditReport } from "../scripts/alignment-audit/report-writer.mjs";
import {
  extractSourceFindingRegistry,
  parseArguments,
  verifyGuidelineBaseline,
} from "../scripts/agentic-sdlc-source.mjs";

test("source CLI accepts only one explicit manifest", () => {
  assert.deepEqual(parseArguments([]), {
    manifestPath: "docs/schemas/agentic-sdlc-guideline-baseline.v1.json",
  });
  assert.deepEqual(parseArguments(["--manifest=proof.json"]), {
    manifestPath: "proof.json",
  });
  assert.throws(() => parseArguments(["--unknown"]), /unsupported argument/u);
  assert.throws(() => parseArguments(["--manifest"]), /requires a value/u);
});

test("finding rows are read from the two owning sections", () => {
  const documents = makeGuidelineDocuments();
  const registry = extractSourceFindingRegistry(documents);
  assert.deepEqual([...registry.keys()], FINDING_TYPES);
  for (const [findingType, severity] of registry) {
    assert.equal(severity, DEFAULT_SEVERITY[findingType]);
  }
});

test("baseline proof binds revision, bytes, Rule IDs, classes, and closed boundary", async () => {
  const fixture = makeFixture();
  const beforeManifest = structuredClone(fixture.manifest);
  const revisionReads = [];
  const revisionResolutions = [];
  const result = await verifyGuidelineBaseline({
    currentDirectory: "/repo",
    environment: { GITHUB_ROOT: "/workspace" },
    manifestPath: "baseline.json",
    readText: async (locator) => fixture.files.get(locator),
    readRevisionText: async (request) => {
      revisionReads.push(request);
      return fixture.files.get(request.locator);
    },
    resolveRevision: async (repositoryLocator, revision) => {
      revisionResolutions.push({ repositoryLocator, revision });
      return revision;
    },
  });

  assert.equal(result.schema, "agentic-sdlc-guideline-source-proof/v1");
  assert.equal(result.totals.findingTypes, FINDING_TYPES.length);
  assert.equal(
    result.totals.executionRuleBindings,
    Object.keys(fixture.manifest.executionFindingRuleBindings).length,
  );
  assert.ok(result.totals.rules >= 2);
  assert.equal(
    result.totals.rules,
    result.totals.artifactBearing + result.totals.advisory,
  );
  assert.deepEqual(result.deployBoundary, { lane: "authoring", state: "closed" });
  assert.deepEqual(fixture.manifest, beforeManifest);
  assert.equal(revisionReads.length, 2);
  assert.deepEqual(revisionResolutions, [{
    repositoryLocator: "/workspace/source",
    revision: fixture.manifest.repository.revision,
  }]);
  assert.ok(revisionReads.every(({ repositoryLocator, revision }) =>
    repositoryLocator === "/workspace/source"
    && revision === fixture.manifest.repository.revision));
});

test("real source binds all execution findings to artifact-bearing rules", {
  skip: !process.env.GITHUB_ROOT,
}, async () => {
  const result = await verifyGuidelineBaseline({
    currentDirectory: process.cwd(),
    environment: process.env,
  });
  assert.equal(result.totals.executionRuleBindings, 58);
});

test("baseline proof fails closed on source drift", async () => {
  const fixture = makeFixture();
  fixture.manifest.documents[0].sha256 = "0".repeat(64);
  fixture.files.set("/repo/baseline.json", JSON.stringify(fixture.manifest));

  await assert.rejects(
    verifyGuidelineBaseline({
      currentDirectory: "/repo",
      environment: { GITHUB_ROOT: "/workspace" },
      manifestPath: "baseline.json",
      readText: async (locator) => fixture.files.get(locator),
      readRevisionText: async ({ locator }) => fixture.files.get(locator),
      resolveRevision: async () => fixture.manifest.repository.revision,
    }),
    /authoring guideline digest mismatch/u,
  );
});

test("baseline proof fails closed on execution finding Rule ID drift", async () => {
  const fixture = makeFixture();
  fixture.manifest.executionFindingRuleBindings["self-graded-verdict"].ruleId =
    "agent-roles--independence#2";
  fixture.files.set("/repo/baseline.json", JSON.stringify(fixture.manifest));

  await assert.rejects(
    verifyGuidelineBaseline({
      currentDirectory: "/repo",
      environment: { GITHUB_ROOT: "/workspace" },
      manifestPath: "baseline.json",
      readText: async (locator) => fixture.files.get(locator),
      readRevisionText: async ({ locator }) => fixture.files.get(locator),
      resolveRevision: async () => fixture.manifest.repository.revision,
    }),
    /does not resolve to an execution Rule ID/u,
  );
});

test("baseline proof rejects an advisory execution finding rule", async () => {
  const fixture = makeFixture();
  const locator = "/workspace/source/execution.md";
  const advisoryRule = "Prefer a readable conformance structure.";
  const text = fixture.files.get(locator).replace(
    "**Directives**:\n- The runtime must record a named conformance report.",
    `**Guidance**:\n- ${advisoryRule}`,
  );
  fixture.files.set(locator, text);
  fixture.manifest.documents.find(({ role }) => role === "execution").sha256 =
    sha256(text);
  for (const binding of Object.values(fixture.manifest.executionFindingRuleBindings)) {
    binding.ruleText = advisoryRule;
  }
  fixture.files.set("/repo/baseline.json", JSON.stringify(fixture.manifest));

  await assert.rejects(
    verifyGuidelineBaseline({
      currentDirectory: "/repo",
      environment: { GITHUB_ROOT: "/workspace" },
      manifestPath: "baseline.json",
      readText: async (path) => fixture.files.get(path),
      readRevisionText: async ({ locator }) => fixture.files.get(locator),
      resolveRevision: async () => fixture.manifest.repository.revision,
    }),
    /bound rule class mismatch: expected artifact-bearing, observed advisory/u,
  );
});

test("canonical run schema closes unknown fields and exposes all runtime records", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../docs/schemas/agentic-sdlc-run.v1.schema.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "schema",
    "runId",
    "authoringBaseline",
    "guidelineBaseline",
    "ruleBindings",
    "derivationRevision",
    "evaluator",
    "specTokenEstimate",
    "deployBoundary",
    "vccs",
    "tasks",
    "transitions",
    "dispatches",
    "returns",
    "evidence",
    "persistedTerminals",
    "persistence",
    "recoveryEvents",
    "humanGateEvents",
    "outboundTransmissions",
    "priorTasks",
    "priorFindings",
    "consumption",
    "guidelineLoadCost",
    "operatorDecisions",
  ]);
  assert.deepEqual(
    schema.$defs.ruleBindings.required.sort(),
    FINDING_TYPES.slice(FINDING_TYPES.indexOf("self-graded-verdict")).sort(),
  );
  assert.deepEqual(schema.$defs.ruleBinding.required, ["ruleId", "ruleText"]);
  for (const field of [
    "kind",
    "codeBearing",
    "observedChangedArtifacts",
    "capabilityEvents",
    "budgetEvents",
    "verdict",
  ]) {
    assert.ok(schema.$defs.task.required.includes(field), `task requires ${field}`);
  }
  for (const field of [
    "implementerMechanismId",
    "checkRunId",
    "automatedTests",
    "attempts",
    "failingFirstWitness",
    "propertyResults",
  ]) {
    assert.ok(
      schema.$defs.taskReturn.required.includes(field),
      `return requires ${field}`,
    );
  }
  assert.ok(schema.$defs.dispatch.required.includes("circuitBreaker"));
  assert.ok(schema.$defs.persistence.required.includes("storageReference"));
  assert.equal(schema.$defs.task.properties.lane.const, "authoring");
  assert.equal(schema.$defs.deployBoundary.properties.state.const, "closed");
  assert.equal(schema.$defs.circuitBreaker.properties.maxConsecutiveNoProgress.const, 2);
});

test("authoring report exposes advisory coverage and zero counts for every finding type", () => {
  const finding = makeFinding({
    findingType: "missing-frontmatter-key",
    ruleId: "frontmatter#1",
    artifactReference: "prd",
    evidenceExcerpt: "owner is missing",
    remediation: {
      class: "documentation-change",
      statement: "Declare owner.",
    },
  });
  const report = renderAuditReport({
    coverage: {
      artifactBearingTotal: 3,
      artifactBearingLinked: 2,
      linkedRatio: 2 / 3,
      advisoryCount: 4,
    },
    counts: {
      auditedDocuments: 1,
      normativeElements: 7,
      artifactEntries: 2,
    },
    findings: [finding],
    deployBoundaryState: "closed",
  }, { date: "2026-07-28" });

  assert.match(report, /\| advisory rules \| 4 \|/u);
  assert.match(report, /## Finding Type Counts/u);
  for (const findingType of FINDING_TYPES) {
    const expectedCount = findingType === "missing-frontmatter-key" ? 1 : 0;
    assert.ok(
      report.includes(`| ${findingType} | ${expectedCount} |`),
      `missing zero-count row for ${findingType}`,
    );
  }
});

function makeFixture() {
  const documents = makeGuidelineDocuments();
  const revision = "1".repeat(40);
  const manifest = {
    schema: "agentic-sdlc-guideline-baseline/v1",
    repository: {
      locator: "${GITHUB_ROOT}/source",
      identity: "example/guidelines",
      revision,
    },
    documents: documents.map((document) => ({
      role: document.role,
      locator: `\${GITHUB_ROOT}/source/${document.role}.md`,
      version: document.version,
      sha256: sha256(document.text),
    })),
    requiredFrontmatterKeys: ["title", "doc_type", "version", "date", "lang"],
    requiredSectionAnchors: {
      authoring: ["rule-identity--classification"],
      execution: ["agent-roles--independence"],
    },
    guidelineLoadProfiles: {
      authoring: {
        "phase-4": ["rule-identity--classification"],
      },
      execution: Object.fromEntries([
        "run-start",
        "task-derivation",
        "lane-admission",
        "dispatch",
        "implementation",
        "verification",
        "recovery",
        "escalation",
        "release-handoff",
      ].map((stage) => [stage, ["agent-roles--independence"]])),
    },
    executionFindingRuleBindings: Object.fromEntries(
      FINDING_TYPES.slice(FINDING_TYPES.indexOf("self-graded-verdict")).map(
        (findingType) => [
          findingType,
          {
            ruleId: "agent-roles--independence#1",
            ruleText: "The runtime must record a named conformance report.",
          },
        ],
      ),
    ),
    executionRuleCatalog: {
      "agent-roles--independence#1":
        "The runtime must record a named conformance report.",
    },
  };
  const files = new Map([
    ["/repo/baseline.json", JSON.stringify(manifest)],
    ...documents.map((document) => [
      `/workspace/source/${document.role}.md`,
      document.text,
    ]),
  ]);
  return { manifest, files };
}

function makeGuidelineDocuments() {
  const pivot = FINDING_TYPES.indexOf("self-graded-verdict");
  return [
    {
      role: "authoring",
      version: "1.7.0",
      text: guidelineText({
        title: "Authoring Guideline",
        version: "1.7.0",
        ruleHeading: "Rule Identity & Classification",
        findingHeading: "Conformance Findings",
        findingTypes: FINDING_TYPES.slice(0, pivot),
      }),
    },
    {
      role: "execution",
      version: "1.0.0",
      text: guidelineText({
        title: "Execution Guideline",
        version: "1.0.0",
        ruleHeading: "Agent Roles & Independence",
        findingHeading: "Execution Conformance Findings",
        findingTypes: FINDING_TYPES.slice(pivot),
      }),
    },
  ];
}

function guidelineText({
  title,
  version,
  ruleHeading,
  findingHeading,
  findingTypes,
}) {
  const rows = findingTypes
    .map(
      (findingType) =>
        `| Contract | \`${findingType}\` | \`${DEFAULT_SEVERITY[findingType]}\` |`,
    )
    .join("\n");
  return `---
title: "${title}"
doc_type: "Guidelines"
version: "${version}"
date: "2026-07-28"
lang: "en-US"
---

# ${title}

## ${ruleHeading}

**Directives**:
- The runtime must record a named conformance report.

## ${findingHeading}

| Rule family | Finding Type | Severity |
|---|---|---|
${rows}
`;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
