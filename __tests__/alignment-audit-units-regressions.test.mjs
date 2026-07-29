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

test("ABSENT runtime scope remains a valid invocation-checker input", () => {
  const index = createArtifactIndex([{
    entryId: "runtime-document",
    documentKey: "runtime-document",
    entryKind: "markdown-document",
    excerpt: "No invocation routes are declared.",
  }]);
  assert.doesNotThrow(() => checkInvocation(index));
  assert.deepEqual(checkInvocation(index).routeCounts, {
    documented: 0,
    resolved: 0,
    orphan: 0,
    ambiguous: 0,
  });
});

test("declared guideline element links survive Artifact_Index round trips", () => {
  const built = buildArtifactIndex([{
    content: [
      "---",
      "title: Linked runtime",
      "status: dev-proven",
      "---",
      "guideline_element_ids: `element-b`, `element-a`",
      "",
    ].join("\n"),
  }], ["dev-proven"]);
  const documentEntry = built.value.entries.find(({ entryKind }) =>
    entryKind === "markdown-document");
  assert.deepEqual(documentEntry.elementIds, ["element-a", "element-b"]);
  const reparsed = parseArtifactIndexMarkdown(printArtifactIndex(built.value));
  assert.equal(artifactIndexesEqual(reparsed.value, built.value), true);
});

test("body-only ambient artifact declarations survive indexing", () => {
  const built = buildArtifactIndex([{
    content: [
      "---",
      "title: Body Declarations",
      "---",
      "",
      "Capability: body-capability",
      "Owner: body-owner",
      "Runtime scope: body-scope",
      "Proof reference: docs/body-proof.mjs",
      "",
    ].join("\n"),
  }]);
  const entry = built.value.entries.find(({ entryKind }) =>
    entryKind === "markdown-document");
  assert.equal(entry.capabilityId, "body-capability");
  assert.equal(entry.declaredOwner, "body-owner");
  assert.equal(entry.declaredRuntimeScope, "body-scope");
  assert.equal(entry.declaredProofReference, "docs/body-proof.mjs");
});

test("Finding reduction preserves per-metric and per-lane multiplicity", () => {
  const economics = checkEconomics([{
    documentKey: "feature",
    featureBearing: true,
    userFacing: false,
    body: "",
  }]).filter(({ findingType }) => findingType === "missing-economics-metric");
  assert.equal(economics.length, DEFAULT_ECONOMICS_STATEMENTS.length);
  assert.equal(finalizeFindings(economics).length, DEFAULT_ECONOMICS_STATEMENTS.length);

  const lanes = checkTopology([], {}, null).findings
    .filter(({ findingType }) => findingType === "missing-lane");
  assert.equal(lanes.length, 3);
  assert.equal(finalizeFindings(lanes).length, 3);
});

test("generic runtime prose and unrelated evidence do not close traceability", () => {
  const element = {
    elementId: "security-model",
    documentKey: "guideline",
    sectionAnchor: "security",
    kind: "directive",
    class: "artifact-bearing",
    gateId: "security",
    ordinal: 0,
    text: "The runtime must record a security threat model document.",
  };
  const mapped = mapTraceability(
    { elements: [element] },
    { entries: [
      {
        entryId: "metrics",
        documentKey: "metrics",
        entryKind: "markdown-document",
        capabilityId: "metrics",
        excerpt: "Runtime metrics inventory only.",
        conditions: [{
          conditionId: "latency",
          endState: "Latency is measured.",
          statedCheck: "npm run latency",
          constraint: "local",
        }],
        evidence: [{
          conditionId: "latency",
          checkName: "npm run latency",
          recordedResult: "pass",
          reproducible: "local",
        }],
      },
      {
        entryId: "billing-security",
        documentKey: "billing-security",
        entryKind: "markdown-document",
        capabilityId: "billing",
        excerpt: "Billing security model cost estimates.",
      },
    ] },
  );
  assert.equal(mapped.coverage.artifactBearingLinked, 0);
  assert.equal(mapped.links.length, 0);
  assert.equal(mapped.findings.some(({ findingType }) =>
    findingType === "unimplemented-guideline"), true);
});

test("path references resolve only against supplied-root paths", () => {
  const owner = {
    entryId: "owner",
    documentKey: "owner",
    capabilityId: "owner",
    declaredProofReference: "docs/missing.md",
    excerpt: "Owner contract.",
  };
  const misleadingIdentity = {
    entryId: "misleading",
    documentKey: "missing-0123456789ab",
    capabilityId: "misleading",
    excerpt: "Unrelated document.",
  };
  const absent = mapTraceability({}, {
    entries: [owner, misleadingIdentity],
  }, {
    referenceInventory: createSuppliedReferenceInventory([
      {
        documentKey: "owner",
        relativeName: "owner.md",
        readState: "ok",
      },
      {
        documentKey: "missing-0123456789ab",
        relativeName: "docs/unrelated.md",
        readState: "ok",
      },
    ]),
  });
  assert.equal(absent.findings.filter(({ findingType }) =>
    findingType === "unresolvable-reference").length, 1);

  const proof = {
    entryId: "proof",
    documentKey: "evidence-packet-0123456789ab",
    capabilityId: "proof",
    excerpt: "Proof packet.",
  };
  const present = mapTraceability({}, {
    entries: [{ ...owner, declaredProofReference: "docs/proof.md" }, proof],
  }, {
    referenceInventory: createSuppliedReferenceInventory([
      { documentKey: "owner", relativeName: "owner.md", readState: "ok" },
      {
        documentKey: "evidence-packet-0123456789ab",
        relativeName: "docs/proof.md",
        readState: "ok",
      },
    ]),
  });
  assert.equal(present.findings.some(({ findingType }) =>
    findingType === "unresolvable-reference"), false);
});

test("script and text proof paths resolve only from the supplied inventory", () => {
  const owner = {
    entryId: "owner",
    documentKey: "owner",
    capabilityId: "owner",
    declaredProofReference: "missing/proof.mjs",
    excerpt: "Owner contract.",
  };
  const absent = mapTraceability({}, { entries: [owner] }, {
    referenceInventory: createSuppliedReferenceInventory([
      { documentKey: "owner", relativeName: "owner.md", readState: "ok" },
    ]),
  });
  assert.equal(absent.findings.filter(({ findingType }) =>
    findingType === "unresolvable-reference").length, 1);

  const proof = {
    entryId: "proof",
    documentKey: "proof-script",
    capabilityId: "proof",
    excerpt: "Proof script.",
  };
  const present = mapTraceability({}, { entries: [owner, proof] }, {
    referenceInventory: createSuppliedReferenceInventory([
      { documentKey: "owner", relativeName: "owner.md", readState: "ok" },
      {
        documentKey: "proof-script",
        relativeName: "missing/proof.mjs",
        readState: "ok",
      },
    ]),
  });
  assert.equal(present.findings.some(({ findingType }) =>
    findingType === "unresolvable-reference"), false);
});

test("a supplied guideline path is resolvable without becoming runtime proof", () => {
  const mapped = mapTraceability({}, {
    entries: [{
      entryId: "runtime-owner",
      documentKey: "runtime-owner",
      capabilityId: "runtime-owner",
      declaredProofReference: "proof.mjs",
      excerpt: "Runtime owner.",
    }],
  }, {
    referenceInventory: createSuppliedReferenceInventory([
      {
        documentKey: "runtime-owner",
        relativeName: "runtime-owner.md",
        readState: "ok",
      },
      {
        documentKey: "guideline-key",
        relativeName: "proof.mjs",
        readState: "ok",
      },
    ]),
  });
  assert.equal(mapped.findings.some(({ findingType }) =>
    findingType === "unresolvable-reference"), false);
  assert.deepEqual(mapped.chains[0].conditions, []);
  assert.deepEqual(mapped.chains[0].evidence, []);
});

test("traceability reads VCC and evidence tables after unrelated tables", () => {
  const element = {
    elementId: "runtime-proof-element",
    sectionAnchor: "proof",
    class: "artifact-bearing",
    text: "Record the runtime proof.",
  };
  const excerpt = [
    "| surface | token | owner |",
    "|---|---|---|",
    "| slash | /audit | audit-owner |",
    "",
    "| condition_id | end_state | stated_check | constraint |",
    "|---|---|---|---|",
    "| ready | Runtime is ready | npm test | local |",
    "",
    "| condition_id | check_name | recorded_result | reproducible |",
    "|---|---|---|---|",
    "| ready | npm test | pass | local |",
  ].join("\n");
  const mapped = mapTraceability(
    { elements: [element] },
    { entries: [{
      entryId: "runtime",
      documentKey: "runtime",
      capabilityId: "runtime",
      declaredStatus: "runtime-ready",
      elementIds: [element.elementId],
      excerpt,
    }] },
  );
  assert.equal(mapped.chains[0].conditions.length, 1);
  assert.equal(mapped.chains[0].evidence.length, 1);
  assert.equal(isEvidenceClosed(
    mapped.chains[0].conditions,
    mapped.chains[0].evidence,
  ), true);
  assert.equal(mapped.findings.some(({ findingType }) =>
    findingType === "unproven-claim"), false);
});

test("evidence tables without reproducibility cannot close readiness or gates", () => {
  const element = {
    elementId: "runtime-proof-element",
    sectionAnchor: "proof",
    gateId: "proof",
    class: "artifact-bearing",
    text: "Record the runtime proof.",
  };
  const excerpt = [
    "| condition_id | end_state | stated_check | constraint |",
    "|---|---|---|---|",
    "| ready | Runtime is ready | npm test | local |",
    "",
    "| condition_id | check_name | recorded_result |",
    "|---|---|---|",
    "| ready | npm test | pass |",
  ].join("\n");
  const model = {
    elements: [element],
    gates: [{
      gateId: "proof",
      entryCondition: "A runtime artifact exists.",
      exitCondition: "The runtime proof is reproducible.",
      requiredEvidenceType: "A recorded local check.",
      mappedElements: [element.elementId],
    }],
  };
  const mapped = mapTraceability(model, {
    entries: [{
      entryId: "runtime",
      documentKey: "runtime",
      capabilityId: "runtime",
      declaredStatus: "runtime-ready",
      elementIds: [element.elementId],
      excerpt,
    }],
  });
  assert.equal(mapped.chains[0].evidence[0].reproducible, "unproven");
  assert.equal(mapped.findings.some(({ findingType }) =>
    findingType === "unproven-claim"), true);
  assert.notEqual(
    evaluateReadiness(mapped.chains).assignments[0].assignedLevel,
    "runtime-ready",
  );
  assert.equal(
    evaluateGates(model, {}, mapped.chains).gates[0].state,
    "unmet",
  );
});

test("entry element links cannot launder unrelated passing evidence into a gate", () => {
  const element = {
    elementId: "billing-contract-proof",
    sectionAnchor: "billing-proof",
    gateId: "billing-proof",
    class: "artifact-bearing",
    text: "The runtime must record billing contract proof.",
  };
  const condition = {
    conditionId: "billing-proof",
    endState: "Billing contract proof is complete.",
    statedCheck: "npm run billing-contract-proof",
    constraint: "configured local scope",
  };
  const model = {
    elements: [element],
    gates: [{
      gateId: "billing-proof",
      entryCondition: "Billing runtime exists.",
      exitCondition: "Billing proof passes.",
      requiredEvidenceType: "Recorded local billing proof.",
      mappedElements: [element.elementId],
    }],
  };
  const entry = {
    entryId: "billing-runtime",
    documentKey: "billing-runtime",
    capabilityId: "billing",
    declaredStatus: "runtime-ready",
    elementIds: [element.elementId],
    conditions: [condition],
    evidence: [{
      conditionId: "latency-proof",
      checkName: "npm run latency",
      recordedResult: "pass",
      reproducible: "local",
    }],
  };
  const unrelated = mapTraceability(model, { entries: [entry] });
  assert.equal(unrelated.links[0].evidenceReference, null);
  assert.equal(
    evaluateGates(model, {}, unrelated.chains).gates[0].state,
    "unmet",
  );
  assert.equal(unrelated.findings.some(({ findingType }) =>
    findingType === "unproven-claim"), true);

  const correctEvidence = {
    conditionId: condition.conditionId,
    checkName: condition.statedCheck,
    recordedResult: "pass",
    reproducible: "local",
    elementIds: [element.elementId],
  };
  const failedEvidence = {
    ...correctEvidence,
    recordedResult: "failed",
  };
  for (const evidence of [
    [failedEvidence, correctEvidence],
    [correctEvidence, failedEvidence],
  ]) {
    const explicit = mapTraceability(model, {
      entries: [{ ...entry, evidence }],
    });
    assert.deepEqual(explicit.links[0].evidenceReference.elementIds, [element.elementId]);
    assert.equal(explicit.links[0].evidenceReference.recordedResult, "pass");
    assert.equal(evaluateGates(model, {}, explicit.chains).gates[0].state, "met");
    assert.equal(explicit.findings.some(({ findingType }) =>
      findingType === "unproven-claim"), false);
  }
});

test("a resolved companion proof can evidence its owner's element link", () => {
  const element = {
    elementId: "companion-proof-element",
    sectionAnchor: "companion-proof",
    gateId: "companion-proof",
    class: "artifact-bearing",
    text: "The runtime must record companion verification proof.",
  };
  const condition = {
    conditionId: "companion-proof",
    endState: "Companion verification proof is complete.",
    statedCheck: "npm run companion-proof",
    constraint: "configured local scope",
  };
  const evidence = {
    conditionId: condition.conditionId,
    checkName: condition.statedCheck,
    recordedResult: "pass",
    reproducible: "local",
    elementIds: [element.elementId],
  };
  const model = {
    elements: [element],
    gates: [{
      gateId: "companion-proof",
      entryCondition: "The runtime owner exists.",
      exitCondition: "The companion proof passes.",
      requiredEvidenceType: "Recorded companion proof.",
      mappedElements: [element.elementId],
    }],
  };
  const owner = {
    entryId: "runtime-owner",
    documentKey: "runtime-owner",
    capabilityId: "companion-runtime",
    declaredStatus: "runtime-ready",
    declaredProofReference: "proof.md",
    elementIds: [element.elementId],
    excerpt: "Runtime owner.",
  };
  const proof = {
    entryId: "proof-entry",
    documentKey: "proof-key",
    capabilityId: "proof-only",
    conditions: [condition],
    evidence: [evidence],
    excerpt: "Companion verification packet.",
  };
  const mapped = mapTraceability(model, { entries: [owner, proof] }, {
    referenceInventory: createSuppliedReferenceInventory([
      {
        documentKey: owner.documentKey,
        relativeName: "runtime.md",
        readState: "ok",
      },
      {
        documentKey: proof.documentKey,
        relativeName: "proof.md",
        readState: "ok",
      },
    ]),
  });
  const ownerLink = mapped.links.find(({ artifactReference }) =>
    artifactReference === owner.entryId);
  assert.equal(ownerLink.evidenceReference.recordedResult, "pass");
  assert.equal(evaluateGates(model, {}, mapped.chains).gates[0].state, "met");
  assert.equal(
    evaluateReadiness(mapped.chains).assignments.find(({ capabilityId }) =>
      capabilityId === owner.capabilityId).assignedLevel,
    "runtime-ready",
  );
  assert.equal(mapped.findings.some(({ findingType, artifactReference }) =>
    findingType === "unproven-claim" &&
    artifactReference === owner.entryId), false);
});

test("parsed-shape validation evidence can become stale", () => {
  const findings = detectDrift(
    {},
    { entries: [{
      entryId: "command",
      documentKey: "runtime",
      entryKind: "validation-command",
      commandText: "npm test",
      capabilityId: "audit",
    }] },
    [{
      capabilityId: "audit",
      links: [],
      evidence: [{
        checkName: "npm run missing",
        recordedResult: "pass",
        reproducible: "local",
      }],
    }],
  );
  assert.equal(findings.some(({ findingType }) => findingType === "stale-evidence"), true);
});

test("status conflict requires distinct audited documents", () => {
  const findings = detectDrift({}, {
    entries: [
      {
        entryId: "document-entry",
        documentKey: "one-document",
        capabilityId: "capability",
        declaredStatus: "dev-proven",
      },
      {
        entryId: "status-entry",
        documentKey: "one-document",
        capabilityId: "capability",
        declaredStatus: "runtime-ready",
      },
    ],
  });
  assert.equal(findings.some(({ findingType }) =>
    findingType === "status-conflict"), false);
});

test("two owner documents with one owner label make a route ambiguous", () => {
  const entries = ["document-a", "document-b"].map((documentKey) => ({
    entryId: documentKey,
    documentKey,
    entryKind: "markdown-document",
    declaredOwner: "same-owner",
    invocationRoutes: [],
    toolIdentities: [],
    excerpt: "",
  }));
  entries.push({
    entryId: "route-catalogue",
    documentKey: "route-catalogue",
    entryKind: "markdown-document",
    invocationRoutes: [{ surface: "slash", token: "/audit", owner: "same-owner" }],
    toolIdentities: [],
    excerpt: "",
  });
  const result = checkInvocation({ entries });
  assert.equal(result.routeCounts.ambiguous, 1);
  assert.equal(result.findings.some(({ findingType }) => findingType === "ambiguous-route"), true);
});

