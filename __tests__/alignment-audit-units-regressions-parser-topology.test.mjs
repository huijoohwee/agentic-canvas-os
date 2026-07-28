import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactIndexesEqual,
  createArtifactIndex,
} from "../scripts/alignment-audit/artifact-index.mjs";
import {
  buildArtifactIndex,
  parseArtifactIndexMarkdown,
} from "../scripts/alignment-audit/artifact-indexer.mjs";
import { printArtifactIndex } from "../scripts/alignment-audit/artifact-printer.mjs";
import {
  checkEconomics,
  DEFAULT_ECONOMICS_STATEMENTS,
} from "../scripts/alignment-audit/economics-checker.mjs";
import { detectDrift } from "../scripts/alignment-audit/drift-detector.mjs";
import { finalizeFindings } from "../scripts/alignment-audit/finding-pipeline.mjs";
import { evaluateGates } from "../scripts/alignment-audit/gate-evaluator.mjs";
import { guidelineModelsEqual } from "../scripts/alignment-audit/guideline-model.mjs";
import {
  parseGuidelineDigest,
  parseGuidelineSet,
} from "../scripts/alignment-audit/guideline-parser.mjs";
import { printGuidelineModel } from "../scripts/alignment-audit/guideline-printer.mjs";
import { checkInvocation } from "../scripts/alignment-audit/invocation-checker.mjs";
import { checkNeutrality } from "../scripts/alignment-audit/neutrality-checker.mjs";
import { evaluateReadiness } from "../scripts/alignment-audit/readiness-evaluator.mjs";
import { createSuppliedReferenceInventory } from "../scripts/alignment-audit/reference-inventory.mjs";
import { checkTopology } from "../scripts/alignment-audit/topology-checker.mjs";
import {
  isEvidenceClosed,
  mapTraceability,
} from "../scripts/alignment-audit/traceability-mapper.mjs";

test("preamble elements survive the guideline digest round trip", () => {
  const parsed = parseGuidelineSet([{
    content: "---\ntitle: Guide\n---\nThe runtime SHALL record a security document.\n",
  }]);
  assert.equal(parsed.value.elements.length, 1);
  const reparsed = parseGuidelineDigest(printGuidelineModel(parsed.value));
  assert.equal(guidelineModelsEqual(reparsed.value, parsed.value), true);
});

test("frontmatter directives become complete Normative Elements", () => {
  const parsed = parseGuidelineSet([{
    content: [
      "---",
      "title: Frontmatter Directive",
      "directive: Must record an audit report",
      "---",
      "",
    ].join("\n"),
  }]);
  assert.equal(parsed.value.elements.length, 1);
  assert.deepEqual(
    {
      sectionAnchor: parsed.value.elements[0].sectionAnchor,
      kind: parsed.value.elements[0].kind,
      class: parsed.value.elements[0].class,
      ordinal: parsed.value.elements[0].ordinal,
      text: parsed.value.elements[0].text,
    },
    {
      sectionAnchor: "frontmatter",
      kind: "directive",
      class: "artifact-bearing",
      ordinal: 0,
      text: "Must record an audit report\n",
    },
  );
  assert.ok(parsed.value.elements[0].elementId);
  assert.ok(parsed.value.elements[0].documentKey);
});

test("wrapped checklist and directive lines form one complete element each", () => {
  const checklist = parseGuidelineSet([{
    content: [
      "---",
      "title: Wrapped Checklist",
      "---",
      "",
      "## Checklist",
      "",
      "- [ ] first",
      "  continued required check details",
      "- [ ] second",
      "",
    ].join("\n"),
  }]).value.elements;
  assert.equal(checklist.length, 2);
  assert.deepEqual(
    checklist.map(({ kind, text }) => ({ kind, text: text.trim() })),
    [
      {
        kind: "checklist-item",
        text: "first continued required check details",
      },
      { kind: "checklist-item", text: "second" },
    ],
  );

  for (const firstLine of [
    "- Directive: The runtime must record",
    "- The runtime must record",
  ]) {
    const elements = parseGuidelineSet([{
      content: [
        "---",
        "title: Wrapped Directive",
        "---",
        "",
        "## Directives",
        "",
        firstLine,
        "  required evidence details",
        "",
      ].join("\n"),
    }]).value.elements;
    assert.equal(elements.length, 1);
    assert.equal(
      elements[0].text.trim(),
      "The runtime must record required evidence details",
    );
  }

  for (const body of [
    [
      "The runtime must record a report.",
      "The runtime must validate a check.",
    ].join("\n"),
    "The runtime must record a report. The runtime must validate a check.",
    [
      "- The runtime must record a report.",
      "The runtime must validate a check.",
    ].join("\n"),
  ]) {
    const elements = parseGuidelineSet([{
      content: [
        "---",
        "title: Adjacent Directives",
        "---",
        "",
        "## Rules",
        "",
        body,
        "",
      ].join("\n"),
    }]).value.elements;
    assert.deepEqual(
      elements.map(({ text }) => text.trim()),
      [
        "The runtime must record a report.",
        "The runtime must validate a check.",
      ],
    );
  }
});

test("required template extraction skips headers and retains blank fields", () => {
  const table = parseGuidelineSet([{
    content: [
      "---",
      "title: Table Template",
      "---",
      "",
      "## Required Template",
      "",
      "| Field | Required |",
      "|---|---|",
      "| owner | yes |",
      "",
    ].join("\n"),
  }]).value.elements;
  assert.deepEqual(
    table.map(({ kind, text }) => ({ kind, text: text.trim() })),
    [{ kind: "required-template-field", text: "owner: required" }],
  );

  for (const field of ["Owner:", "- Owner:"]) {
    const elements = parseGuidelineSet([{
      content: [
        "---",
        "title: Blank Template",
        "---",
        "",
        "## Required Template",
        "",
        field,
        "",
      ].join("\n"),
    }]).value.elements;
    assert.deepEqual(
      elements.map(({ kind, text }) => ({ kind, text: text.trim() })),
      [{ kind: "required-template-field", text: "Owner: (empty)" }],
    );
  }
});

test("gate parser accepts the required evidence type label", () => {
  const parsed = parseGuidelineSet([{
    content: [
      "---",
      "title: Gate Labels",
      "---",
      "",
      "## Proof Gate",
      "",
      "Gate: proof",
      "Entry condition: implementation exists",
      "Exit condition: the check passes",
      "Required evidence type: recorded local result",
      "",
    ].join("\n"),
  }]).value;
  assert.equal(parsed.gates.length, 1);
  assert.equal(parsed.gates[0].exitCondition, "the check passes");
  assert.equal(parsed.gates[0].requiredEvidenceType, "recorded local result");
});

test("an explicit universal-scope false declaration overrides prose inference", () => {
  const parse = (frontmatterLine) => parseGuidelineSet([{
    content: [
      "---",
      "title: Scope",
      ...(frontmatterLine ? [frontmatterLine] : []),
      "---",
      "This document discusses universal scope.",
      "",
    ].join("\n"),
  }]).value;
  assert.equal([...parse("universal_scope: false").documents.values()][0].universalScope, false);
  assert.equal([...parse("universal_scope: true").documents.values()][0].universalScope, true);
  assert.equal([...parse(null).documents.values()][0].universalScope, true);
});

test("neutrality rules do not indict their own exclusions and metarules", () => {
  const result = checkNeutrality([{
    documentKey: "checker-source",
    body: [
      'const tokens = ["Cloudflare", "GitHub"];',
      "Derive the normative claim from parsed content rather than a path or directory name.",
      "WHEN an audited document states that a claim derives from a file path, record a Finding_Type.",
      "`path-derived-claim`, quoting the statement, when a document states that a normative claim derives from a file path segment or a directory name.",
      "Document states that a normative claim derives from a file path segment or directory name.",
      "No normative behavior derives from a file path segment or a directory name.",
    ].join("\n"),
    universalScope: false,
  }]);
  assert.equal(result.findings.some(({ findingType }) =>
    findingType === "vendor-coupling" || findingType === "path-derived-claim"), false);
});

test("contextually declared brands and vendors are detected without a fixed catalog", () => {
  for (const body of [
    "The vendor Linear is required.",
    "Use the Linear product.",
    "Linear is the required SaaS vendor.",
    "The vendor Nimbus must be used.",
    "Brand: Linear",
    "Vendor: Linear",
  ]) {
    const result = checkNeutrality([{
      documentKey: "universal",
      universalScope: true,
      body,
    }]);
    assert.equal(result.findings.filter(({ findingType }) =>
      findingType === "vendor-coupling").length, 1);
  }

  const referenceOnly = checkNeutrality([{
    documentKey: "reference-only",
    universalScope: true,
    body: [
      "## Reference Implementation",
      "",
      "The vendor Linear is a replaceable example.",
      "",
      "## Portable Contract",
      "",
      "Use a replaceable issue-tracking capability.",
    ].join("\n"),
  }]);
  assert.equal(referenceOnly.findings.some(({ findingType }) =>
    findingType === "vendor-coupling"), false);
});

test("any language or runtime declarations establish universal scope", () => {
  for (const scope of ["language", "runtime"]) {
    const result = checkNeutrality([{
      documentKey: `universal-${scope}`,
      body: `This document applies to any ${scope}. Stripe is required.`,
    }]);
    assert.equal(result.findings.filter(({ findingType }) =>
      findingType === "vendor-coupling").length, 1);
  }
});

test("deploy breach parsing spans sections, plurals, and scoped negation", () => {
  const topology = {
    documentKey: "topology",
    lanes: ["development", "production-mirror", "edge-delivery"],
    transitions: [{
      id: "dev-to-mirror",
      deployBoundary: "release-gate",
      evidenceReference: "release-proof",
      rollback: "restore prior revision",
      operatorApproval: "required",
    }],
    topologyNodes: [{
      id: "component",
      connectionType: "async",
      dataResidency: "local",
    }],
  };
  for (const body of [
    "## Development command\n\nDeploys to production.",
    "## Development commands\n\ndeploy-edge publishes to the edge surface.",
    "## Dev scripts\n\nThe release task writes to the production mirror.",
    "Development command does not log; it deploys production.",
    "Development command deletes production records",
    "Development command creates an edge deployment",
    "Development command removes production data",
  ]) {
    const result = checkTopology([{ ...topology, body }], {}, null);
    assert.equal(result.findings.filter(({ findingType }) =>
      findingType === "deploy-boundary-breach").length, 1);
  }
  for (const body of [
    "## Development command\n\nMust not deploy to production.",
    "WHEN an audited document describes a development command as mutating production, record a deploy-boundary-breach Finding.",
    '"Development command deploys to production" is a generated test example.',
  ]) {
    const result = checkTopology([{ ...topology, body }], {}, null);
    assert.equal(result.findings.some(({ findingType }) =>
      findingType === "deploy-boundary-breach"), false);
  }
});

test("negated, automatic, and optional approval statements do not gate promotion", () => {
  const topology = {
    documentKey: "topology",
    lanes: ["development", "production-mirror", "edge-delivery"],
    topologyNodes: [{
      id: "component",
      connectionType: "async",
      dataResidency: "local",
    }],
  };
  for (const operatorApproval of [
    "Operator approval is not required for this transition.",
    "automatic operator approval",
    "optional operator approval",
    "Operator approval must never be required",
    "Operator approval shall not be required",
    "Explicit operator approval is waived",
    "Operator instruction must be absent",
    "Approval must be automatic",
    "Operator approval is never required",
  ]) {
    const result = checkTopology([{
      ...topology,
      transitions: [{
        id: "dev-to-mirror",
        deployBoundary: "release-gate",
        evidenceReference: "release-proof",
        rollback: "restore prior revision",
        operatorApproval,
      }],
    }], {}, null);
    assert.equal(result.findings.filter(({ findingType }) =>
      findingType === "ungated-promotion").length, 1);
  }
});

test("documented runtime components must appear in a complete topology table row", () => {
  const lanes = [
    "Development Lane.",
    "Production mirror Lane.",
    "Edge delivery Lane.",
  ].join("\n");
  for (const declaration of [
    "Runtime component: API Worker",
    "Component: API Worker",
    "The API Worker is a runtime component.",
  ]) {
    const result = checkTopology([{
      documentKey: "topology",
      body: `${lanes}\n${declaration}`,
    }], {}, null);
    const findings = result.findings.filter(({ findingType }) =>
      findingType === "incomplete-topology-node");
    assert.equal(findings.length, 1);
    assert.match(findings[0].evidenceExcerpt, /absent from the topology table/u);
  }

  const partial = checkTopology([{
    documentKey: "partial-topology",
    body: [
      lanes,
      "Runtime component: API Worker",
      "",
      "| component | connection_type | data_residency |",
      "|---|---|---|",
      "| API Worker | async | |",
    ].join("\n"),
  }], {}, null);
  const partialFindings = partial.findings.filter(({ findingType }) =>
    findingType === "incomplete-topology-node");
  assert.equal(partialFindings.length, 1);
  assert.match(partialFindings[0].evidenceExcerpt, /data residency/u);
});

test("documented lane transitions require boundary evidence rollback and approval", () => {
  const result = checkTopology([{
    documentKey: "topology",
    body: [
      "Development Lane.",
      "Production mirror Lane.",
      "Edge delivery Lane.",
      "Lane transition: development -> production mirror",
    ].join("\n"),
  }], {}, null);
  assert.equal(result.findings.filter(({ findingType }) =>
    findingType === "incomplete-lane-transition").length, 1);
  assert.equal(result.findings.filter(({ findingType }) =>
    findingType === "ungated-promotion").length, 1);
});

test("semantic denials do not become deploy-boundary breaches", () => {
  for (const body of [
    "Development commands are prohibited from updating the production surface.",
    "Development commands cannot update the production surface.",
    "Development commands are prevented from mutating the edge surface.",
    "Development commands refuse to deploy to production.",
    "No development command updates the production surface.",
  ]) {
    const result = checkTopology([{ documentKey: "topology", body }], {}, null);
    assert.equal(result.findings.some(({ findingType }) =>
      findingType === "deploy-boundary-breach"), false);
  }
});

test("deploy words in headings do not turn a negated requirement into a breach", () => {
  const result = checkTopology([{
    documentKey: "requirements",
    body: [
      "## Requirement 11: Environment Topology And Deploy Boundary Conformance",
      "",
      "I want explicit gates, so that no development command can silently reach a production mirror.",
    ].join("\n"),
  }], {}, null);
  assert.equal(result.findings.some(({ findingType }) =>
    findingType === "deploy-boundary-breach"), false);
});

