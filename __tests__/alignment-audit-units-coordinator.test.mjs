import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareAuditDocuments,
  runAudit,
  SourceIntegrityViolation,
} from "../scripts/alignment-audit/alignment-auditor.mjs";
import { elementIdFrom } from "../scripts/alignment-audit/normalize.mjs";
import { createInMemoryWriteSink } from "../scripts/alignment-audit/output-boundary.mjs";
import { createInMemorySourceReader } from "../scripts/alignment-audit/source-reader.mjs";

test("coordinator completes and writes a report for an empty input set", async () => {
  const result = await execute([]);
  assert.equal(result.counts.auditedDocuments, 0);
  assert.deepEqual(
    result.findings.map(({ findingType }) => findingType),
    ["missing-lane", "missing-lane", "missing-lane"],
  );
  assert.deepEqual(
    result.findings.map(({ guidelineAnchor }) => guidelineAnchor).sort(),
    ["lane:development", "lane:edge-delivery", "lane:production-mirror"],
  );
  assert.equal(result.coverage.linkedRatio, 1);
  assert.equal(result.deployBoundaryState, "closed");
  assert.equal(result.baselineVerified, true);
  assert.equal(result.artifacts.length, 3);
  assert.match(result.report, /## Findings/u);
});

test("coordinator completes and writes a report for a single document", async () => {
  const result = await execute([
    {
      readHandle: "guide-1",
      subject: "configured-guide",
      auditSurface: "guideline",
      inputRole: "guide",
      content: guidelineDocument(),
    },
  ]);
  assert.equal(result.counts.auditedDocuments, 1);
  assert.ok(result.counts.normativeElements >= 1);
  assert.equal(result.baselineVerified, true);
  assert.equal(result.modifiedOutsideOutputCount, 0);
  assert.equal(result.artifacts.length, 3);
});

test("coordinator reports every unreadable document and still emits a report", async () => {
  const result = await execute([
    {
      readHandle: "guide-unreadable",
      subject: "guide-unreadable",
      auditSurface: "guideline",
      inputRole: "guide",
      unreadable: true,
      error: "permission denied",
    },
    {
      readHandle: "runtime-unreadable",
      subject: "runtime-unreadable",
      auditSurface: "runtime",
      inputRole: "runtime",
      unreadable: true,
      error: "permission denied",
    },
  ]);
  assert.equal(result.counts.auditedDocuments, 2);
  assert.equal(
    result.findings.filter((finding) => finding.findingType === "unreadable-input")
      .length,
    2,
  );
  assert.equal(result.counts.normativeElements, 0);
  assert.equal(result.counts.artifactEntries, 0);
  assert.equal(result.artifacts.length, 3);
});

test("coordinator converts a rejected read into an unreadable Finding", async () => {
  const descriptor = {
    readHandle: "rejected-read",
    subject: "rejected-read",
    auditSurface: "runtime",
    inputRole: "runtime",
  };
  const reader = {
    async list() {
      return [descriptor];
    },
    async read() {
      throw new Error("permission denied");
    },
  };
  const result = await runAudit(
    resolvedConfig(),
    reader,
    createInMemoryWriteSink(),
  );
  assert.equal(result.counts.auditedDocuments, 1);
  assert.equal(result.findings.filter(({ findingType, artifactReference }) =>
    findingType === "unreadable-input" &&
    artifactReference === "rejected-read").length, 1);
  assert.equal(result.baselineVerified, true);
  assert.equal(result.modifiedOutsideOutputCount, 0);
  assert.equal(result.artifacts.length, 3);
});

test("a SourceReader may return unchanged source text directly", async () => {
  const descriptor = {
    readHandle: "string-guide",
    subject: "string-guide",
    auditSurface: "guideline",
    inputRole: "guide",
  };
  const reader = {
    async list() {
      return [descriptor];
    },
    async read() {
      return guidelineDocument();
    },
  };
  const result = await runAudit(
    resolvedConfig(),
    reader,
    createInMemoryWriteSink(),
  );
  assert.equal(result.baselineVerified, true);
  assert.equal(result.modifiedOutsideOutputCount, 0);
  assert.ok(result.counts.normativeElements > 0);
  assert.equal(result.artifacts.length, 3);
});

test("an invalid readable payload is isolated to its named input", async () => {
  const descriptors = [
    {
      readHandle: "healthy-guide",
      subject: "healthy-guide",
      auditSurface: "guideline",
      inputRole: "guide",
    },
    {
      readHandle: "healthy-runtime",
      subject: "healthy-runtime",
      auditSurface: "runtime",
      inputRole: "runtime",
    },
    {
      readHandle: "broken-runtime",
      subject: "broken-runtime",
      auditSurface: "runtime",
      inputRole: "runtime",
    },
  ];
  const results = new Map([
    ["healthy-guide", {
      content: guidelineDocument(),
      readState: "ok",
    }],
    ["healthy-runtime", {
      content: [
        "---",
        "title: Healthy Runtime",
        "status: spec-complete",
        "capability_id: healthy-runtime",
        "---",
        "",
        "Runtime contract document.",
      ].join("\n"),
      readState: "ok",
    }],
    ["broken-runtime", {
      content: null,
      text: null,
      readState: "ok",
    }],
  ]);
  const reader = {
    async list() {
      return descriptors;
    },
    async read(descriptor) {
      return {
        ...descriptor,
        ...results.get(descriptor.readHandle),
      };
    },
  };
  const result = await runAudit(
    resolvedConfig(),
    reader,
    createInMemoryWriteSink(),
  );
  assert.equal(result.findings.filter(({ findingType, artifactReference }) =>
    findingType === "malformed-document" &&
    artifactReference === "broken-runtime").length, 1);
  assert.equal(result.findings.some(({ findingType, artifactReference }) =>
    findingType === "malformed-document" &&
    ["Guideline_Parser", "Artifact_Indexer"].includes(artifactReference)), false);
  assert.ok(result.counts.normativeElements > 0);
  assert.ok(result.counts.artifactEntries > 0);
  assert.equal(
    result.sourceDocuments.find(({ subject }) => subject === "broken-runtime")
      .documentKey,
    null,
  );
});

test("frontmatter directives survive the whole coordinator", async () => {
  const result = await execute([{
    readHandle: "frontmatter-directive",
    subject: "frontmatter-directive",
    auditSurface: "guideline",
    inputRole: "guide",
    content: [
      "---",
      "title: Frontmatter Directive",
      "doc_type: Guideline",
      "owner: audit-test",
      "directive: Must record an audit report",
      "---",
      "",
    ].join("\n"),
  }]);
  assert.equal(result.counts.normativeElements, 1);
  assert.equal(result.findings.some(({ findingType, artifactReference }) =>
    findingType === "malformed-document" &&
    artifactReference === "Guideline_Parser"), false);
});

test("an empty-body runtime yields unguided Findings without checker failure", async () => {
  const result = await execute([
    {
      readHandle: "guide",
      subject: "guide",
      auditSurface: "guideline",
      inputRole: "guide",
      content: guidelineDocument(),
    },
    {
      readHandle: "empty-runtime",
      subject: "empty-runtime",
      auditSurface: "runtime",
      inputRole: "runtime",
      content: [
        "---",
        "title: Empty Runtime",
        "doc_type: Runtime Contract",
        "owner: audit-test",
        "capability_id: empty-runtime",
        "---",
        "",
      ].join("\n"),
    },
  ]);
  assert.equal(result.findings.some(({ findingType }) =>
    findingType === "unguided-artifact"), true);
  assert.equal(result.findings.some(({ findingType, artifactReference }) =>
    findingType === "malformed-document" &&
    artifactReference === "Traceability_Mapper"), false);
});

test("coordinator converts malformed structure into one typed finding", async () => {
  const result = await execute([
    {
      readHandle: "broken-guide",
      subject: "broken-guide",
      auditSurface: "guideline",
      content: "---\ntitle: Broken\n",
    },
  ]);
  assert.equal(
    result.findings.filter((finding) => finding.findingType === "malformed-document")
      .length,
    1,
  );
  assert.equal(result.counts.normativeElements, 0);
  assert.equal(result.artifacts.length, 3);
});

test("configured defaults adapt raw source but never mask malformed frontmatter", () => {
  const defaults = { title: "Adapted source", doc_type: "Runtime Source" };
  const prepared = prepareAuditDocuments([
    {
      readHandle: "raw-source.mjs",
      subject: "raw-source.mjs",
      auditSurface: "runtime",
      readState: "ok",
      content: "export const value = 1;\n",
      documentDefaults: defaults,
    },
    {
      readHandle: "broken.md",
      subject: "broken.md",
      auditSurface: "runtime",
      readState: "ok",
      content: "---\ntitle: Broken\n",
      documentDefaults: defaults,
    },
  ]);
  assert.equal(
    prepared.documents.find(({ subject }) => subject === "raw-source.mjs")
      .contentAdaptedFromConfiguredDefaults,
    true,
  );
  assert.equal(
    prepared.documents.find(({ subject }) => subject === "broken.md").readState,
    "malformed",
  );
  assert.equal(
    prepared.findings.some(({ findingType, artifactReference }) =>
      findingType === "malformed-document" && artifactReference === "broken.md"),
    true,
  );
});

async function execute(documents, configOverrides = {}) {
  return runAudit(
    { ...resolvedConfig(), ...configOverrides },
    createInMemorySourceReader(documents),
    createInMemoryWriteSink(),
  );
}

function resolvedConfig() {
  return {
    resolved: true,
    guidelineRoots: [
      {
        roleLabel: "guide",
        locator: "/virtual/guide",
        includeGlobs: ["**/*"],
        excludeGlobs: [],
        revisionIdentifier: "guide-r1",
      },
    ],
    runtimeRoots: [
      {
        roleLabel: "runtime",
        locator: "/virtual/runtime",
        includeGlobs: ["**/*"],
        excludeGlobs: [],
        revisionIdentifier: "runtime-r1",
      },
    ],
    auditOutputDirectory: "/virtual/output",
    operatorDeployInstruction: null,
    readinessLadder: [
      "undocumented",
      "spec-complete",
      "dev-proven",
      "runtime-ready",
      "production-verified",
    ],
    requiredFrontmatterKeys: ["title"],
    economicsStatements: ["token-budget"],
  };
}

function guidelineDocument() {
  return [
    "---",
    "title: Guide",
    "status: spec-complete",
    "---",
    "",
    "## Requirements",
    "",
    "- Directive: The runtime must record a contract document.",
    "",
  ].join("\n");
}

function evidenceResultDocuments(recordedResult, surface) {
  const check = "gate result-proof entry condition ready exit done result proof";
  const elementIds = [
    "Gate: result-proof",
    "Entry condition: ready",
    "Exit condition: done",
    "Required evidence: result",
    "The runtime must record result proof artifact.",
  ].map((text) => elementIdFrom("proof-gate", text));
  return [
    {
      readHandle: "result-guide",
      subject: "result-guide",
      auditSurface: "guideline",
      inputRole: "guide",
      content: [
        "---",
        "title: Result Guideline",
        "status: spec-complete",
        "---",
        "",
        "## Proof Gate",
        "",
        "Gate: result-proof",
        "",
        "Entry condition: ready",
        "",
        "Exit condition: done",
        "",
        "Required evidence: result",
        "",
        "- Directive: The runtime must record result proof artifact.",
        "",
      ].join("\n"),
    },
    {
      readHandle: "result-runtime",
      subject: "result-runtime",
      auditSurface: "runtime",
      inputRole: "runtime",
      content: [
        "---",
        "title: Result Runtime",
        "status: runtime-ready",
        "capability_id: evidence-result",
        "---",
        "",
        `guideline_element_ids: ${elementIds.map((id) => `\`${id}\``).join(", ")}`,
        "",
        "Gate result-proof entry condition ready exit done result proof artifact.",
        "",
        "condition_id: result-proof",
        "",
        "end_state: result proof is complete",
        "",
        `stated_check: ${check}`,
        "",
        `constraint: configured ${surface} scope`,
        "",
        "condition_id: result-proof",
        "",
        `evidence_check: ${check}`,
        "",
        `recorded_result: ${recordedResult}`,
        "",
        `reproducible: ${surface}`,
        "",
        "| condition_id | check_name | recorded_result | reproducible | element_ids |",
        "|---|---|---|---|---|",
        `| result-proof | ${check} | ${recordedResult} | ${surface} | ${elementIds.map((id) => `\`${id}\``).join(", ")} |`,
        "",
      ].join("\n"),
    },
  ];
}

function assertEvidenceResultState(result, recordedResult, accepted, surface) {
  const assignment = result.readiness.assignments.find(({ capabilityId }) =>
    capabilityId === "evidence-result");
  const gate = result.gates.gates.find(({ gateId }) => gateId === "result-proof");
  assert.ok(assignment, `missing readiness assignment for ${recordedResult}`);
  assert.ok(gate, `missing gate for ${recordedResult}`);
  assert.equal(
    assignment.assignedLevel,
    accepted
      ? surface === "production"
        ? "production-verified"
        : "runtime-ready"
      : "spec-complete",
    `${surface}: ${recordedResult}`,
  );
  assert.equal(
    assignment.deployedReadiness,
    accepted && surface === "production"
      ? "production-verified"
      : "undocumented",
    `${surface}: ${recordedResult}`,
  );
  assert.equal(gate.state, accepted ? "met" : "unmet", `${surface}: ${recordedResult}`);
  assert.equal(
    result.findings.some(({ findingType, artifactReference }) =>
      findingType === "unproven-claim" &&
      String(artifactReference).includes("result-runtime")),
    !accepted,
    `${surface}: ${recordedResult}`,
  );
}
