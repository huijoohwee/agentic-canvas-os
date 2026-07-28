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

test("whole pipeline closes evidence only for explicit successful results", async () => {
  const rejected = [
    "FAIL",
    "failed",
    "exit 1",
    "false",
    "0 tests passed, 1 failed",
    "pending",
    "TBD",
    "skipped",
    "not executed",
    "inconclusive",
    "no result recorded",
    "0 tests run",
    "no tests found",
  ];
  const accepted = [
    "PASS",
    "passed",
    "successful",
    "exit 0",
    "exit code 0",
    "exit_code=0",
    "succeeded",
    "12 tests passed",
    "HTTP 200",
    "true",
    "0 violations",
    "report exists",
    "2 documents, 6 findings, boundary closed",
  ];

  for (const recordedResult of rejected) {
    for (const surface of ["local", "production"]) {
      const result = await execute(
        evidenceResultDocuments(recordedResult, surface),
        surface === "production"
          ? { operatorDeployInstruction: "operator-proof" }
          : {},
      );
      assertEvidenceResultState(result, recordedResult, false, surface);
    }
  }
  for (const recordedResult of accepted) {
    for (const surface of ["local", "production"]) {
      const result = await execute(
        evidenceResultDocuments(recordedResult, surface),
        surface === "production"
          ? { operatorDeployInstruction: "operator-proof" }
          : {},
      );
      assertEvidenceResultState(result, recordedResult, true, surface);
    }
  }
});

test("coordinator fails closed on a source mutation before report publication", async () => {
  let content = guidelineDocument();
  const descriptor = {
    readHandle: "mutable-guide",
    subject: "mutable-guide",
    auditSurface: "guideline",
    inputRole: "guide",
  };
  const reader = {
    async list() {
      return [descriptor];
    },
    async read(subject) {
      return {
        ...descriptor,
        ...subject,
        content,
        text: content,
        readState: "ok",
      };
    },
  };
  const durableSink = createInMemoryWriteSink();
  let writeCount = 0;
  const mutatingSink = {
    async listPublished() {
      return durableSink.listPublished();
    },
    async write(relativeName, output) {
      writeCount += 1;
      if (writeCount === 1) content += "\nsource changed during emit\n";
      return durableSink.write(relativeName, output);
    },
  };

  await assert.rejects(
    runAudit(resolvedConfig(), reader, mutatingSink),
    (error) => {
      assert.equal(error instanceof SourceIntegrityViolation, true);
      assert.deepEqual(
        error.integrity.mismatches.map((entry) => entry.subject),
        ["mutable-guide"],
      );
      return true;
    },
  );
  assert.equal(
    [...durableSink.files.keys()].some((name) =>
      name.startsWith("alignment-audit-report-")),
    false,
  );
  assert.deepEqual(await durableSink.listPublished(), []);
});

test("coordinator rejects a mutation caused by the final report write", async () => {
  let content = guidelineDocument();
  const descriptor = {
    readHandle: "mutable-guide",
    subject: "mutable-guide",
    auditSurface: "guideline",
    inputRole: "guide",
  };
  const reader = {
    async list() {
      return [descriptor];
    },
    async read(subject) {
      return { ...descriptor, ...subject, content, text: content, readState: "ok" };
    },
  };
  const durableSink = createInMemoryWriteSink();
  let writeCount = 0;
  const sink = {
    listPublished: () => durableSink.listPublished(),
    async write(relativeName, output) {
      writeCount += 1;
      if (writeCount === 3) content += "\nchanged by final write\n";
      return durableSink.write(relativeName, output);
    },
  };
  await assert.rejects(
    runAudit(resolvedConfig(), reader, sink),
    SourceIntegrityViolation,
  );
  assert.equal(writeCount, 3);
  assert.deepEqual(await durableSink.listPublished(), []);
  assert.equal(durableSink.files.size, 0);
});

test("coordinator detects a source added under a configured root during emission", async () => {
  const initial = {
    readHandle: "guide",
    subject: "guide",
    auditSurface: "guideline",
    inputRole: "guide",
  };
  const added = { ...initial, readHandle: "added", subject: "added" };
  let includeAdded = false;
  const reader = {
    async list() {
      return includeAdded ? [initial, added] : [initial];
    },
    async read(subject) {
      return {
        ...subject,
        content: guidelineDocument(),
        text: guidelineDocument(),
        readState: "ok",
      };
    },
  };
  const durableSink = createInMemoryWriteSink();
  const sink = {
    listPublished: () => durableSink.listPublished(),
    async write(relativeName, output) {
      includeAdded = true;
      return durableSink.write(relativeName, output);
    },
  };
  await assert.rejects(
    runAudit(resolvedConfig(), reader, sink),
    (error) => {
      assert.equal(error instanceof SourceIntegrityViolation, true);
      assert.deepEqual(
        error.integrity.mismatches.map(({ subject }) => subject),
        ["added"],
      );
      return true;
    },
  );
});

test("coordinator detects an unreadable source becoming readable during emission", async () => {
  const descriptor = {
    readHandle: "initially-unreadable",
    subject: "initially-unreadable",
    auditSurface: "runtime",
    inputRole: "runtime",
  };
  let readable = false;
  const reader = {
    async list() {
      return [descriptor];
    },
    async read(subject) {
      return readable
        ? {
            ...descriptor,
            ...subject,
            content: "newly readable source\n",
            text: "newly readable source\n",
            readState: "ok",
          }
        : {
            ...descriptor,
            ...subject,
            content: null,
            text: null,
            readState: "unreadable",
            error: "permission denied",
          };
    },
  };
  const durableSink = createInMemoryWriteSink();
  const sink = {
    listPublished: () => durableSink.listPublished(),
    async write(relativeName, output) {
      readable = true;
      return durableSink.write(relativeName, output);
    },
  };
  await assert.rejects(
    runAudit(resolvedConfig(), reader, sink),
    (error) => {
      assert.equal(error instanceof SourceIntegrityViolation, true);
      assert.deepEqual(
        error.integrity.mismatches.map(({ subject }) => subject),
        ["initially-unreadable"],
      );
      return true;
    },
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
