import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMISSION_EVALUATOR_MECHANISM_ID,
  ADMISSION_EVALUATOR_MODULES,
  ADMISSION_SCHEMA_MODULES,
  computeArtifactClosureDigest,
  resolveLifecycleConformanceIdentities,
} from "../scripts/lifecycle-conformance-identity.mjs";
import {
  lifecyclePolicyIdentity,
} from "../scripts/lifecycle-conformance-policy.mjs";

test("evaluator and schema closure digests are ordered and length-delimited", () => {
  const left = computeArtifactClosureDigest([
    { id: "b", bytes: Buffer.from("two") },
    { id: "a", bytes: Buffer.from("one") },
  ]);
  const reordered = computeArtifactClosureDigest([
    { id: "a", bytes: Buffer.from("one") },
    { id: "b", bytes: Buffer.from("two") },
  ]);
  const ambiguousConcatenation = computeArtifactClosureDigest([
    { id: "a", bytes: Buffer.from("onet") },
    { id: "b", bytes: Buffer.from("wo") },
  ]);
  assert.equal(left, reordered);
  assert.notEqual(left, ambiguousConcatenation);
  assert.match(left, /^[0-9a-f]{64}$/u);
});

test("identity resolution binds one checked-out revision to explicit closures", () => {
  const revision = "a".repeat(40);
  const readBytes = (artifactPath) => Buffer.from(`bytes:${artifactPath}`);
  const identities = resolveLifecycleConformanceIdentities({
    repositoryRoot: "/workspace/agentic-canvas-os",
    readBytes,
    gitText: (arguments_) => {
      if (arguments_[0] === "rev-parse") return `${revision}\n`;
      if (arguments_[0] === "status") return "";
      if (arguments_[0] === "ls-files") return `${arguments_.at(-1)}\n`;
      throw new Error(`unexpected git invocation: ${arguments_.join(" ")}`);
    },
  });
  assert.deepEqual(identities.policy, lifecyclePolicyIdentity());
  assert.equal(identities.evaluator.revision, revision);
  assert.equal(
    identities.evaluator.mechanismId,
    ADMISSION_EVALUATOR_MECHANISM_ID,
  );
  assert.equal(
    identities.evaluator.digest,
    computeArtifactClosureDigest(ADMISSION_EVALUATOR_MODULES.map(
      (artifactPath) => ({ id: artifactPath, bytes: readBytes(artifactPath) }),
    )),
  );
  assert.equal(
    identities.schema.digest,
    computeArtifactClosureDigest(ADMISSION_SCHEMA_MODULES.map(
      (artifactPath) => ({ id: artifactPath, bytes: readBytes(artifactPath) }),
    )),
  );
  assert.equal(Object.isFrozen(identities), true);
});

test("dirty or untracked evaluator closure cannot create identity", () => {
  assert.throws(
    () => resolveLifecycleConformanceIdentities({
      repositoryRoot: "/workspace/agentic-canvas-os",
      readBytes: () => Buffer.from("bytes"),
      gitText: (arguments_) => {
        if (arguments_[0] === "rev-parse") return `${"a".repeat(40)}\n`;
        if (arguments_[0] === "status") return " M scripts/lifecycle-conformance.mjs\n";
        throw new Error("unexpected");
      },
    }),
    (error) =>
      error?.code === "AGENTIC_SDLC_EVALUATOR_IDENTITY_UNAVAILABLE"
      && /byte-identical/u.test(error.message),
  );
});
