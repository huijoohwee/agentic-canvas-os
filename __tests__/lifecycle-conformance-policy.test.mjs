import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import path from "node:path";

import { parseGuidelineSet } from "../scripts/alignment-audit/guideline-parser.mjs";
import {
  LIFECYCLE_POLICY_RULE_CATALOG,
  LIFECYCLE_POLICY_SOURCE,
  computeLifecyclePolicyDigest,
  lifecyclePolicyIdentity,
  verifyPinnedLifecyclePolicySource,
} from "../scripts/lifecycle-conformance-policy.mjs";

test("lifecycle policy identity is an immutable protected-source projection", () => {
  assert.match(LIFECYCLE_POLICY_SOURCE.revision, /^[0-9a-f]{40}$/u);
  assert.match(LIFECYCLE_POLICY_SOURCE.digest, /^[0-9a-f]{64}$/u);
  assert.equal(LIFECYCLE_POLICY_SOURCE.guidelineVersion, "1.9.0");
  assert.deepEqual(
    Object.keys(lifecyclePolicyIdentity()).sort(),
    ["digest", "guidelineVersion", "repository", "revision"],
  );
  assert.deepEqual(
    [...LIFECYCLE_POLICY_SOURCE.modules],
    [...LIFECYCLE_POLICY_SOURCE.modules].sort(),
  );
});

test("policy digest is deterministic and length-delimited", () => {
  const modules = [
    { id: "b", bytes: Buffer.from("c") },
    { id: "a", bytes: Buffer.from("bc") },
  ];
  const digest = computeLifecyclePolicyDigest(modules);
  assert.equal(digest, computeLifecyclePolicyDigest([...modules].reverse()));
  assert.notEqual(digest, computeLifecyclePolicyDigest([
    { id: "ab", bytes: Buffer.from("c") },
    { id: "", bytes: Buffer.from("bc") },
  ]));
});

test("available pinned policy Git objects match the recorded byte digest", {
  skip: !process.env.GITHUB_ROOT,
}, () => {
  const sourceRoot = path.join(
    path.resolve(process.env.GITHUB_ROOT),
    "huijoohwee.github.io",
  );
  assert.deepEqual(
    verifyPinnedLifecyclePolicySource(sourceRoot),
    lifecyclePolicyIdentity(),
  );
});

test("admission finding anchors match the pinned v1.9 rule ordinals", {
  skip: !process.env.GITHUB_ROOT,
}, () => {
  const sourceRoot = path.join(
    path.resolve(process.env.GITHUB_ROOT),
    "huijoohwee.github.io",
  );
  const modulePath = "guidelines/agentic-sdlc-guidelines.md";
  const sourceText = execFileSync(
    "git",
    ["show", `${LIFECYCLE_POLICY_SOURCE.revision}:${modulePath}`],
    { cwd: sourceRoot, encoding: "utf8" },
  );
  const parsed = parseGuidelineSet([{
    documentKey: modulePath,
    text: sourceText,
  }]);
  assert.deepEqual(parsed.findings, []);
  const requiredSections = new Set(
    Object.keys(LIFECYCLE_POLICY_RULE_CATALOG)
      .map((ruleId) => ruleId.split("#", 1)[0]),
  );
  const derivedCatalog = {};
  for (const section of requiredSections) {
    parsed.value.elements
      .filter((element) => element.sectionAnchor === section)
      .forEach((element, index) => {
        derivedCatalog[`${section}#${index + 1}`] = element.text.trim();
      });
  }
  for (const [ruleId, ruleText] of Object.entries(
    LIFECYCLE_POLICY_RULE_CATALOG,
  )) {
    assert.equal(derivedCatalog[ruleId], ruleText.trim(), ruleId);
  }
});
