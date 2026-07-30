import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import {
  LIFECYCLE_POLICY_SOURCE,
  computeLifecyclePolicyDigest,
  lifecyclePolicyIdentity,
  verifyPinnedLifecyclePolicySource,
} from "../scripts/lifecycle-conformance-policy.mjs";

test("lifecycle policy identity is an immutable protected-source projection", () => {
  assert.match(LIFECYCLE_POLICY_SOURCE.revision, /^[0-9a-f]{40}$/u);
  assert.match(LIFECYCLE_POLICY_SOURCE.digest, /^[0-9a-f]{64}$/u);
  assert.equal(LIFECYCLE_POLICY_SOURCE.guidelineVersion, "1.8.0");
  assert.deepEqual(
    Object.keys(lifecyclePolicyIdentity()).sort(),
    ["digest", "guidelineVersion", "repository", "revision"],
  );
  assert.deepEqual(
    [...LIFECYCLE_POLICY_SOURCE.modules],
    [...LIFECYCLE_POLICY_SOURCE.modules].sort((left, right) =>
      left.localeCompare(right, "en")),
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

test("materialized policy source matches the pinned revision and byte digest", {
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
