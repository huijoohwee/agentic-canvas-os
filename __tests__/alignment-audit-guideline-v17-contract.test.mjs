import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SEVERITY,
  FINDING_TYPES,
  makeFinding,
} from "../scripts/alignment-audit/finding.mjs";
import {
  normalizeNormativeElement,
  ruleIdFrom,
} from "../scripts/alignment-audit/guideline-model.mjs";
import { parseGuidelineSet } from "../scripts/alignment-audit/guideline-parser.mjs";
import { headingAnchor } from "../scripts/alignment-audit/normalize.mjs";
import { assignReadiness } from "../scripts/alignment-audit/readiness-evaluator.mjs";

const AUTHORING_FINDINGS = [
  "missing-frontmatter-key", "malformed-document", "unknown-status",
  "unproven-claim", "blended-status", "unimplemented-guideline",
  "unguided-artifact", "unresolvable-reference", "stale-evidence",
  "missing-companion", "duplicate-owner", "status-conflict",
  "gate-order-drift", "gate-sequence-violation", "vendor-coupling",
  "path-derived-claim", "non-modular-section", "missing-economics-metric",
  "blended-deployment-tco", "missing-foss-comparison", "unbounded-loop",
  "paid-read-path", "incomplete-delivery-reach", "orphan-route",
  "ambiguous-route", "unfederated-tool", "uncatalogued-tool", "missing-lane",
  "incomplete-lane-transition", "deploy-boundary-breach", "ungated-promotion",
  "incomplete-topology-node",
];

const EXECUTION_FINDINGS = [
  "self-graded-verdict", "unnamed-evaluator", "ungrounded-task",
  "unexecuted-condition", "task-cycle", "concurrent-write-conflict",
  "parallel-scope-collision", "stale-collaboration-fence",
  "delivery-authority-unjoined",
  "canonical-base-drift", "scope-admission-collision",
  "unattributed-lane-ambiguity", "admission-snapshot-stale",
  "unsafe-candidate-target", "local-only-cross-device-lease",
  "collateral-lane-mutation", "admission-runtime-conflation",
  "candidate-lane-orphaned",
  "state-without-reason", "oversized-task", "unsurfaced-result",
  "unenumerated-change", "self-escalated-capability", "out-of-scope-write",
  "ungated-irreversible-operation", "unbounded-task",
  "budget-raised-under-pressure", "unrecorded-consumption",
  "fix-without-witness", "unproven-property", "evidence-without-run",
  "unresumable-run", "assumed-operator-decision",
  "unreviewed-release-candidate", "dependency-closure-drift",
  "authorization-evidence-unjoined", "authorization-interaction-unjoined",
  "duplicate-release-controller", "production-authorization-drift",
  "post-authorization-rebuild", "state-reconciliation-unverified",
  "immutable-origin-unverified", "public-route-unverified",
  "client-cache-convergence-unverified",
  "publication-before-live-verification", "cleanup-ownership-unproven",
  "integration-order-cycle", "integration-before-dependency",
  "canonical-frontier-unverified", "duplicate-change-reintegrated",
  "stale-candidate-frontier", "runtime-readiness-unproven",
  "undesigned-criterion", "ungrounded-design-element",
  "requirement-introduced-downstream", "stale-downstream-artifact",
  "phase-advanced-without-approval", "seam-elided",
];

const frontmatter = [
  "---",
  "title: Guideline",
  "---",
  "",
];

test("v1.7 headings are fence-aware and rules carry canonical 1-based IDs", () => {
  const directive = "- Directive: The runtime must record a contract schema.";
  const parsed = parseGuidelineSet([{
    content: [
      ...frontmatter,
      "## Rule Identity & Classification",
      directive,
      directive,
      "```markdown",
      "## Fenced & Example",
      "```",
      "## PRD ↔ TAD Integration",
      "- Directive: The runtime must record an evidence report.",
      "## PRD ↔ TAD Integration",
      "- Directive: The runtime must record a second evidence report.",
      "",
    ].join("\n"),
  }]).value;

  const document = [...parsed.documents.values()][0];
  assert.deepEqual(document.sectionAnchors, [
    "rule-identity--classification",
    "prd--tad-integration",
    "prd--tad-integration-1",
  ]);
  assert.deepEqual(parsed.elements.map(({ ruleId }) => ruleId), [
    "rule-identity--classification#1",
    "rule-identity--classification#2",
    "prd--tad-integration#1",
    "prd--tad-integration-1#1",
  ]);
  assert.equal(parsed.elements[0].text.trim(), directive.replace("- Directive: ", ""));
  assert.notEqual(parsed.elements[0].ruleId, parsed.elements[1].ruleId);
  assert.equal(headingAnchor("Scope & Neutrality Contract"), "scope--neutrality-contract");
  assert.equal(ruleIdFrom("scope--neutrality-contract", 0), "scope--neutrality-contract#1");
});

test("bold rule contexts preserve imperative bullets and advisory guidance", () => {
  const parsed = parseGuidelineSet([{
    content: [
      ...frontmatter,
      "## Task Model",
      "### Task Identity",
      "- Assign each task exactly one Task ID.",
      "**Directives**:",
      "- Surface each recorded result through the evidence report.",
      "**Guidance**:",
      "- The runtime must record an illustrative report.",
      "### Guards",
      "- A forbidden operation overwrites the evidence report.",
      "",
    ].join("\n"),
  }]).value;

  assert.deepEqual(parsed.elements.map(({ ruleId, text, class: elementClass }) => ({
    ruleId,
    text: text.trim(),
    class: elementClass,
  })), [
    {
      ruleId: "task-model#1",
      text: "Assign each task exactly one Task ID.",
      class: "artifact-bearing",
    },
    {
      ruleId: "task-model#2",
      text: "Surface each recorded result through the evidence report.",
      class: "artifact-bearing",
    },
    {
      ruleId: "task-model#3",
      text: "The runtime must record an illustrative report.",
      class: "advisory",
    },
    {
      ruleId: "task-model#4",
      text: "A forbidden operation overwrites the evidence report.",
      class: "artifact-bearing",
    },
  ]);
});

test("Every verification obligation receives a Rule ID and artifact-bearing class", () => {
  const exactRules = [
    "Every code-bearing task adds or extends automated tests covering the behaviour it introduces",
    "Every bug-fixing task first adds a check that fails on the unfixed state; a fix with no failing-first check is a `fix-without-witness` finding",
  ];
  const parsed = parseGuidelineSet([{
    content: [
      ...frontmatter,
      "## Verification Strategy",
      "### Obligations Per Task",
      ...exactRules.map((rule) => `- ${rule}`),
      "",
    ].join("\n"),
  }]).value;

  assert.deepEqual(parsed.elements.map(({ ruleId, text, class: elementClass }) => ({
    ruleId,
    text: text.trim(),
    class: elementClass,
  })), exactRules.map((text, index) => ({
    ruleId: `verification-strategy#${index + 1}`,
    text,
    class: "artifact-bearing",
  })));
});

test("a supplied Rule ID cannot override section-and-ordinal derivation", () => {
  assert.throws(() => normalizeNormativeElement({
    sectionAnchor: "rules",
    ordinal: 0,
    ruleId: "rules#2",
    kind: "directive",
    class: "artifact-bearing",
    text: "The runtime must record a report.",
  }), /must be derived as rules#1/u);
});

test("bold phase gates coexist with structured gate declarations", () => {
  const parsed = parseGuidelineSet([{
    content: [
      ...frontmatter,
      "## Creation Process",
      "### Phase 0 — Problem Discovery",
      "1. Record an observable problem statement.",
      "**Gate**: proceed only when the problem is validated.",
      "### Phase 1 — PRD Authoring",
      "**Gate**: proceed only when every criterion is measurable.",
      "## Proof Gate",
      "Gate: `recorded-proof`",
      "Entry condition: implementation exists",
      "Exit condition: the check passes",
      "Required evidence type: recorded local result",
      "",
    ].join("\n"),
  }]).value;

  assert.deepEqual(parsed.gates.map(({ gateId }) => gateId), [
    "phase-0--problem-discovery",
    "phase-1--prd-authoring",
    "recorded-proof",
  ]);
  assert.equal(parsed.gates[0].exitCondition,
    "proceed only when the problem is validated.");
  assert.equal(parsed.gates[2].entryCondition, "implementation exists");
  assert.equal(parsed.gates[2].requiredEvidenceType, "recorded local result");
});

test("finding vocabulary is the exact authoring and execution union", () => {
  assert.deepEqual(FINDING_TYPES, [...AUTHORING_FINDINGS, ...EXECUTION_FINDINGS]);
  assert.equal(new Set(FINDING_TYPES).size, 90);
  assert.deepEqual(Object.keys(DEFAULT_SEVERITY), FINDING_TYPES);
  assert.equal(DEFAULT_SEVERITY["missing-frontmatter-key"], "minor");
  assert.equal(DEFAULT_SEVERITY["missing-lane"], "blocker");
  assert.equal(DEFAULT_SEVERITY["ungated-promotion"], "blocker");
  assert.equal(DEFAULT_SEVERITY["incomplete-topology-node"], "major");
  assert.equal(DEFAULT_SEVERITY["self-graded-verdict"], "blocker");
});

test("legacy internal names emit only canonical findings and Rule ID anchors", () => {
  const make = (findingType) => makeFinding({
    findingType,
    ruleId: "validation-checklist#1",
    evidenceExcerpt: "legacy checker input",
    remediation: { class: "documentation-change", statement: "Update the artifact." },
  });
  assert.equal(make("missing-delivery-statement").findingType,
    "incomplete-delivery-reach");
  assert.equal(make("unreadable-input").findingType, "malformed-document");
  assert.equal(make("scope-contradiction").findingType, "non-modular-section");
  assert.equal(make("unreadable-input").guidelineAnchor, "validation-checklist#1");
});

const condition = {
  conditionId: "vcc-1",
  endState: "The check passes.",
  statedCheck: "npm run focused",
  constraint: "No delivery mutation.",
};

function evidence(surface) {
  return {
    conditionId: "vcc-1",
    checkName: "npm run focused",
    recordedResult: "exit code 0; 1 test passed",
    surface,
  };
}

test("readiness derives separate authoring, mirror, and delivery rungs", () => {
  const local = assignReadiness({
    capabilityId: "alignment",
    entryIds: ["spec"],
    conditions: [condition],
    evidence: [evidence("authoring")],
  });
  assert.equal(local.localRung, "runtime-ready");
  assert.equal(local.deliveredRung, "undocumented");
  assert.equal(local.localReadiness, local.localRung);
  assert.equal(local.deployedReadiness, local.deliveredRung);

  const mirrored = assignReadiness({
    capabilityId: "alignment",
    entryIds: ["spec"],
    conditions: [condition],
    evidence: [evidence("authoring"), evidence("mirror")],
  });
  assert.equal(mirrored.localRung, "runtime-ready");
  assert.equal(mirrored.deliveredRung, "runtime-ready");

  const delivered = assignReadiness({
    capabilityId: "alignment",
    entryIds: ["spec"],
    conditions: [condition],
    evidence: [evidence("authoring"), evidence("delivery")],
  }, { reference: "operator-instruction-1" });
  assert.equal(delivered.localRung, "runtime-ready");
  assert.equal(delivered.deliveredRung, "production-verified");
});

test("legacy local and production names remain input aliases without crossing surfaces", () => {
  const assignment = assignReadiness({
    capabilityId: "legacy",
    entryIds: ["spec"],
    conditions: [condition],
    evidence: [
      { ...evidence(undefined), surface: undefined, reproducible: "local" },
      { ...evidence(undefined), surface: undefined, reproducible: "production" },
    ],
  }, "operator-instruction-legacy");
  assert.equal(assignment.localRung, "runtime-ready");
  assert.equal(assignment.deliveredRung, "production-verified");

  const productionOnly = assignReadiness({
    capabilityId: "legacy-production",
    entryIds: ["spec"],
    conditions: [condition],
    evidence: [
      { ...evidence(undefined), surface: undefined, reproducible: "production" },
    ],
  }, "operator-instruction-legacy");
  assert.equal(productionOnly.localRung, "spec-complete");
  assert.equal(productionOnly.deliveredRung, "runtime-ready");
  assert.equal(productionOnly.assignedLevel, "spec-complete");
});
