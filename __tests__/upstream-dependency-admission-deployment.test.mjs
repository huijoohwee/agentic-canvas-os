import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDevUpstreamDependencyAdmissionDeployArgs,
} from "../scripts/deploy-dev-upstream-dependency-admission.mjs";

test("Dev deployment is pinned to the Dev environment and preserves remote configuration", () => {
  const revision = "a".repeat(40);
  assert.deepEqual(buildDevUpstreamDependencyAdmissionDeployArgs(revision), [
    "exec",
    "--",
    "wrangler",
    "deploy",
    "--env",
    "dev",
    "--keep-vars",
    "--strict",
    "--message",
    `upstream-dependency-admission:${revision}`,
  ]);
});

test("Dev deployment requires a full canonical revision", () => {
  assert.throws(
    () => buildDevUpstreamDependencyAdmissionDeployArgs("local"),
    /40-character canonical revision/,
  );
});
