import assert from "node:assert/strict";
import test from "node:test";

import {
  compareFindings,
  DEFAULT_SEVERITY,
  FINDING_TYPES,
  makeFinding,
  resolveSeverity,
} from "../scripts/alignment-audit/finding.mjs";

test("Finding_Type enumeration is closed and contains all documented types", () => {
  assert.equal(FINDING_TYPES.length, 34);
  assert.equal(new Set(FINDING_TYPES).size, 34);
  assert.deepEqual(Object.keys(DEFAULT_SEVERITY).sort(), [...FINDING_TYPES].sort());
});

for (const findingType of [
  "unproven-claim",
  "unbounded-loop",
  "deploy-boundary-breach",
]) {
  test(`${findingType} remains blocker when a lower default is supplied`, () => {
    assert.equal(
      resolveSeverity(findingType, undefined, {
        ...DEFAULT_SEVERITY,
        [findingType]: "minor",
      }),
      "blocker",
    );
  });
}

test("makeFinding fills explicit not-applicable references and validates remediation", () => {
  const finding = makeFinding({
    findingType: "unknown-status",
    evidenceExcerpt: "status: almost-ready",
    remediation: {
      class: "documentation-change",
      statement: "Declare a configured status.",
    },
  });
  assert.equal(finding.guidelineAnchor, "-");
  assert.equal(finding.artifactReference, "-");
  assert.equal(finding.severity, "major");
  assert.equal(finding.remediation.state, "proposed");
});

test("unknown Finding_Type is rejected", () => {
  assert.throws(
    () =>
      makeFinding({
        findingType: "invented-type",
        evidenceExcerpt: "bad",
        remediation: { class: "documentation-change", statement: "fix" },
      }),
    /unknown Finding_Type/u,
  );
});

test("canonical comparison orders blocker before major before minor", () => {
  const make = (findingType) =>
    makeFinding({
      findingType,
      evidenceExcerpt: findingType,
      remediation: { class: "documentation-change", statement: `Fix ${findingType}.` },
    });
  const findings = [
    make("unguided-artifact"),
    make("unknown-status"),
    make("unbounded-loop"),
  ].sort(compareFindings);
  assert.deepEqual(
    findings.map((finding) => finding.severity),
    ["blocker", "major", "minor"],
  );
});
