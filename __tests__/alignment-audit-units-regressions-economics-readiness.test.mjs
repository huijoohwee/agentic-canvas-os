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

test("economics checker consumes prepared Markdown frontmatter flags", () => {
  const findings = checkEconomics([{
    documentKey: "frontmatter-capability",
    frontmatter: new Map([
      ["capability_id", "frontmatter-capability"],
      ["user_facing", "true"],
      ["ai_pipeline", "true"],
    ]),
    body: "Runtime contract.",
  }]);
  assert.equal(findings.filter(({ findingType }) =>
    findingType === "missing-economics-metric").length, 4);
  assert.equal(findings.filter(({ findingType }) =>
    findingType === "incomplete-delivery-reach").length, 3);
  assert.equal(findings.filter(({ findingType }) =>
    findingType === "unbounded-loop").length, 1);
});

test("explicit feature-bearing false overrides prose heuristics", () => {
  const falseFindings = checkEconomics([{
    documentKey: "not-a-feature",
    frontmatter: new Map([["feature_bearing", "false"]]),
    body: "This text explains the feature-bearing declaration.",
  }]);
  const trueFindings = checkEconomics([{
    documentKey: "feature",
    frontmatter: new Map([["feature_bearing", "true"]]),
    body: "",
  }]);
  assert.equal(falseFindings.filter(({ findingType }) =>
    findingType === "missing-economics-metric").length, 0);
  assert.equal(trueFindings.filter(({ findingType }) =>
    findingType === "missing-economics-metric").length, 4);
});

test("empty token_budget frontmatter remains a missing economics metric", () => {
  const findings = checkEconomics([{
    documentKey: "empty-token-budget",
    featureBearing: true,
    frontmatter: new Map([["token_budget", ""]]),
    body: [
      "Return on investment: positive at the target reach.",
      "12-month total cost of ownership: $0.",
      "Time-to-value: under five minutes.",
    ].join("\n"),
  }]);
  assert.deepEqual(findings
    .filter(({ findingType }) => findingType === "missing-economics-metric")
    .map(({ guidelineAnchor }) => guidelineAnchor), ["economics:token-budget"]);
});

test("TBD values leave all four economics statements missing", () => {
  const findings = checkEconomics([{
    documentKey: "placeholder-economics",
    featureBearing: true,
    body: [
      "Return on investment: TBD",
      "12-month total cost of ownership: TBD",
      "Token budget: TBD",
      "Time-to-value: TBD",
    ].join("\n"),
  }]);
  assert.deepEqual(findings
    .filter(({ findingType }) => findingType === "missing-economics-metric")
    .map(({ guidelineAnchor }) => guidelineAnchor)
    .sort(), DEFAULT_ECONOMICS_STATEMENTS.map((statement) => `economics:${statement}`).sort());
});

test("a GitHub and Gitea FOSS comparison does not satisfy a Stripe dependency", () => {
  const findings = checkEconomics([{
    documentKey: "stripe-with-unrelated-comparison",
    body: "Stripe API is required. GitHub is compared versus the open-source alternative Gitea.",
  }]);
  assert.equal(findings.filter(({ findingType }) =>
    findingType === "missing-foss-comparison").length, 1);
});

test("an uncatalogued PagerDuty service still requires a FOSS comparison", () => {
  const findings = checkEconomics([{
    documentKey: "uncatalogued-service",
    body: "PagerDuty service is required.",
  }]);
  assert.equal(findings.filter(({ findingType }) =>
    findingType === "missing-foss-comparison").length, 1);
});

test("explicit proprietary dependencies are detected in either word order", () => {
  const metrics = [
    "Return on investment: positive.",
    "12-month total cost of ownership: $0.",
    "Token budget: 1000.",
    "Time-to-value: five minutes.",
  ].join("\n");
  const findings = checkEconomics([
    {
      documentKey: "named-service",
      featureBearing: true,
      body: `${metrics}\nNimbus service is proprietary.`,
    },
    {
      documentKey: "reversed-service",
      featureBearing: true,
      body: `${metrics}\nService Nimbus is proprietary.`,
    },
  ]);
  assert.equal(findings.filter(({ findingType }) =>
    findingType === "missing-foss-comparison").length, 2);
});

test("named proprietary grammar resolves dependency-specific FOSS comparisons", () => {
  const declarations = [
    "Nimbus is a proprietary service.",
    "The proprietary service Nimbus is required.",
    "A proprietary service called Nimbus is required.",
  ];
  const compared = checkEconomics(declarations.map((declaration, index) => ({
    documentKey: `compared-nimbus-${index}`,
    body: `${declaration} Nimbus is compared versus open-source Prometheus.`,
  })));
  assert.equal(compared.some(({ findingType }) =>
    findingType === "missing-foss-comparison"), false);

  const missing = checkEconomics(declarations.map((body, index) => ({
    documentKey: `missing-nimbus-${index}`,
    body,
  })));
  assert.equal(missing.filter(({ findingType }) =>
    findingType === "missing-foss-comparison").length, declarations.length);
});

test("paid-read wording variants detect nonzero amounts and ignore zero", () => {
  const nonzero = [
    "Discovery view costs 1 token.",
    "The read view costs $0.02 per request.",
    "Discovery uses 10 tokens per read.",
    "The discovery token cost equals 2.",
  ];
  const zero = [
    "Discovery view costs 0 tokens.",
    "The read view costs $0.00 per request.",
    "Discovery uses 0 tokens per read.",
    "The discovery token cost equals 0.",
  ];
  const docs = [
    ...nonzero.map((body, index) => ({ documentKey: `paid-${index}`, body })),
    ...zero.map((body, index) => ({ documentKey: `free-${index}`, body })),
  ];
  assert.deepEqual(checkEconomics(docs)
    .filter(({ findingType }) => findingType === "paid-read-path")
    .map(({ artifactReference }) => artifactReference)
    .sort(), nonzero.map((_, index) => `paid-${index}`));
});

test("empty and placeholder delivery values remain missing", () => {
  const findings = checkEconomics([{
    documentKey: "placeholder-delivery",
    featureBearing: true,
    userFacing: true,
    body: [
      "Return on investment: positive.",
      "12-month total cost of ownership: $0.",
      "Token budget: 1000.",
      "Time-to-value: five minutes.",
      "browser reach:",
      "mobile reach: TBD",
      "offline behavior: TODO",
    ].join("\n"),
  }]);
  assert.deepEqual(findings
    .filter(({ findingType }) => findingType === "incomplete-delivery-reach")
    .map(({ guidelineAnchor }) => guidelineAnchor)
    .sort(), [
      "delivery:browser-reach",
      "delivery:mobile-reach",
      "delivery:offline-behavior",
    ]);
});

test("content-derived contract roles survive indexing and drive tool membership", () => {
  const document = (title, docType) => ({
    content: [
      "---",
      `title: ${title}`,
      `doc_type: ${docType}`,
      "---",
      "MCP tools: audit.tool",
    ].join("\n"),
  });
  const index = buildArtifactIndex([
    document("Registry A", "Federation Contract"),
    document("Registry B", "Capability Catalog"),
    document("Feature", "Runtime Contract"),
  ]).value;
  const result = checkInvocation(index);
  assert.equal(result.findings.some(({ findingType }) =>
    findingType === "unfederated-tool"), false);
  assert.equal(result.findings.some(({ findingType }) =>
    findingType === "uncatalogued-tool"), false);
  assert.deepEqual(index.entries
    .filter(({ entryKind }) => entryKind === "markdown-document")
    .map(({ contractRole }) => contractRole)
    .sort(), ["catalog", "document", "federation"]);
});

test("unnamed or unreproducible evidence cannot close readiness", () => {
  const condition = {
    conditionId: "runtime-proof",
    endState: "The runtime is ready.",
    statedCheck: "npm test",
    constraint: "local",
  };
  assert.equal(isEvidenceClosed([condition], [{
    conditionId: "runtime-proof",
    checkName: "",
    recordedResult: "pass",
    reproducible: "unproven",
  }]), false);

  const assignment = evaluateReadiness([{
    capabilityId: "runtime",
    entryIds: ["runtime"],
    conditions: [condition],
    evidence: [
      {
        conditionId: "runtime-proof",
        checkName: "npm test",
        recordedResult: "pass",
        reproducible: "local",
      },
      {
        conditionId: "runtime-proof",
        checkName: "",
        recordedResult: "pass",
        reproducible: "production",
      },
    ],
  }], "operator-instruction").assignments[0];
  assert.equal(assignment.assignedLevel, "runtime-ready");
  assert.equal(assignment.deployedReadiness, "undocumented");
});

test("one incomplete declared VCC prevents runtime-ready closure", () => {
  const element = {
    elementId: "runtime-proof",
    sectionAnchor: "proof",
    class: "artifact-bearing",
    text: "Record the runtime proof.",
  };
  const mapped = mapTraceability(
    { elements: [element] },
    { entries: [{
      entryId: "runtime",
      documentKey: "runtime",
      capabilityId: "runtime",
      declaredStatus: "runtime-ready",
      elementIds: [element.elementId],
      conditions: [
        {
          conditionId: "complete",
          endState: "Complete.",
          statedCheck: "npm test",
          constraint: "local",
        },
        {
          conditionId: "incomplete",
          endState: "Also complete.",
          statedCheck: "npm run second",
          constraint: "",
        },
      ],
      evidence: [{
        conditionId: "complete",
        checkName: "npm test",
        recordedResult: "pass",
        reproducible: "local",
      }],
    }] },
  );
  assert.equal(mapped.chains[0].conditions.length, 2);
  assert.equal(isEvidenceClosed(
    mapped.chains[0].conditions,
    mapped.chains[0].evidence,
  ), false);
  assert.equal(
    evaluateReadiness(mapped.chains).assignments[0].assignedLevel,
    "dev-proven",
  );
  assert.equal(mapped.findings.some(({ findingType }) =>
    findingType === "unproven-claim"), true);
});

test("every runtime stage-order declaration is evaluated", () => {
  const declaredGateIds = ["discover", "design", "prove"];
  const result = evaluateGates({
    gates: declaredGateIds.map((gateId, order) => ({
      gateId,
      order,
      entryCondition: `enter ${gateId}`,
      exitCondition: `exit ${gateId}`,
      requiredEvidenceType: `evidence ${gateId}`,
    })),
    elements: [],
  }, {
    entries: [
      { entryId: "doc-a", documentedStageOrder: declaredGateIds },
      { entryId: "doc-b", documentedStageOrder: [...declaredGateIds].reverse() },
    ],
  });
  assert.deepEqual(
    result.findings.filter(({ findingType }) => findingType === "gate-order-drift")
      .map(({ artifactReference }) => artifactReference),
    ["doc-b"],
  );
});

test("a guideline set without gate declarations fails closed", () => {
  const result = evaluateGates({
    documents: new Map([["guideline", { documentKey: "guideline" }]]),
    elements: [],
  }, { entries: [] }, []);
  assert.deepEqual(result.gates, []);
  assert.equal(result.findings.filter(({ findingType, artifactReference }) =>
    findingType === "malformed-document" &&
    artifactReference === "guideline-gate-model").length, 1);
});

test("a six-of-seven pipeline declaration fails closed", () => {
  const gateIds = [
    "problem-validation",
    "requirements-authoring",
    "architecture-authoring",
    "alignment-review",
    "implementation",
    "local-proof",
  ];
  const result = evaluateGates({
    documents: new Map([["guideline", { documentKey: "guideline" }]]),
    elements: [],
    gates: gateIds.map((gateId) => ({
      gateId,
      entryCondition: `enter ${gateId}`,
      exitCondition: `exit ${gateId}`,
      requiredEvidenceType: `evidence ${gateId}`,
    })),
  }, { entries: [] }, []);
  assert.equal(result.findings.filter(({ findingType, evidenceExcerpt }) =>
    findingType === "malformed-document" &&
    evidenceExcerpt.includes("release-readiness")).length, 1);
});

test("final reduction preserves vendor and missing-key counts", () => {
  const neutrality = checkNeutrality([{
    documentKey: "universal",
    inputRole: "guideline",
    universalScope: true,
    body: "Cloudflare and GitHub are required.",
  }]);
  const reducedVendors = finalizeFindings(neutrality.findings)
    .filter(({ findingType }) => findingType === "vendor-coupling");
  assert.equal(reducedVendors.length, 2);
  assert.equal(
    Object.values(neutrality.vendorCouplingCountByRole).reduce((sum, count) => sum + count, 0),
    reducedVendors.length,
  );

  const parsed = parseGuidelineSet([{
    content: "---\ntitle: Incomplete\n---\nBody.\n",
  }], ["title", "lang", "status"]);
  assert.equal(
    finalizeFindings(parsed.findings)
      .filter(({ findingType }) => findingType === "missing-frontmatter-key").length,
    2,
  );
});
