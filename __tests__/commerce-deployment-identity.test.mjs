import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMERCE_DEPLOYMENT_IDENTITY_SCHEMA,
  productionVersionTag,
  readCommerceDeploymentIdentity,
  resolveCommerceDeploymentIdentity,
} from "../agent-api/src/commerce-deployment-identity.js";

const sourceRevision = "a".repeat(40);
const candidateDigest = "b".repeat(64);
const versionId = "8f031f1e-ec20-4c55-9f04-1fdc77c68f6e";
const versionTimestamp = "2026-09-03T04:05:06.123Z";

function identity() {
  return {
    schema: COMMERCE_DEPLOYMENT_IDENTITY_SCHEMA,
    sourceRevision,
    candidateDigest,
    versionId,
    versionTag: productionVersionTag(candidateDigest),
    versionTimestamp,
  };
}

test("the exact production identity binds source, candidate, UUID, digest tag, and timestamp", () => {
  assert.deepEqual(readCommerceDeploymentIdentity(identity()), identity());
  assert.deepEqual(resolveCommerceDeploymentIdentity({
    ACOS_SOURCE_REVISION: sourceRevision,
    ACOS_CANDIDATE_DIGEST: candidateDigest,
    CF_VERSION_METADATA: {
      id: versionId,
      tag: productionVersionTag(candidateDigest),
      timestamp: versionTimestamp,
    },
  }), identity());
});

for (const [name, mutate] of [
  ["source revision", (value) => { value.sourceRevision = "c".repeat(40); value.sourceRevision += "0"; }],
  ["candidate digest", (value) => { value.candidateDigest = "d".repeat(63); }],
  ["version UUID", (value) => { value.versionId = "not-a-uuid"; }],
  ["version tag", (value) => { value.versionTag = `acos-prod-${"c".repeat(64)}`; }],
  ["version timestamp", (value) => { value.versionTimestamp = "2026-09-03"; }],
  ["unknown key", (value) => { value.extra = true; }],
]) {
  test(`deployment identity rejects ${name} drift`, () => {
    const value = identity();
    mutate(value);
    assert.equal(readCommerceDeploymentIdentity(value), null);
  });
}

test("missing, partial, and placeholder Worker bindings have no accepted deployment identity", () => {
  assert.equal(resolveCommerceDeploymentIdentity({}), null);
  assert.deepEqual(resolveCommerceDeploymentIdentity({
    ACOS_SOURCE_REVISION: "__PROTECTED_RELEASE_SOURCE_REVISION__",
    ACOS_CANDIDATE_DIGEST: "__PROTECTED_RELEASE_CANDIDATE_DIGEST__",
    CF_VERSION_METADATA: { id: versionId, tag: "placeholder", timestamp: versionTimestamp },
  }), null);
  assert.equal(readCommerceDeploymentIdentity({ ...identity(), ready: true }), null);
});
