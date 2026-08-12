import assert from "node:assert/strict";
import test from "node:test";
import { runProvisionedStartAdmissionRecoveryCli } from "../scripts/provisioned-start-admission-recovery.mjs";

test("CLI plan returns the exact digest-bound authorization without mutation", () => {
  let executed = 0;
  const plan = { schema: "plan", planDigest: "a".repeat(64) };
  const result = runProvisionedStartAdmissionRecoveryCli([
    "plan", "--repository=/tmp/repo", "--session=session", "--task-authority=/tmp/capability",
  ], { branch: "agent/device/scope", createAdapter: () => ({ gitCommonDir: "/tmp" }),
    createStore: () => ({}), createController: () => ({ plan: () => plan,
      execute: () => { executed += 1; } }) });
  assert.equal(result.authorization, `authorize provisioned-start-admission-recovery ${plan.planDigest}`);
  assert.equal(executed, 0);
});

test("CLI rejects repository-owned plan artifacts", () => {
  assert.throws(() => runProvisionedStartAdmissionRecoveryCli([
    "plan", "--repository=/tmp/repo", "--session=session", "--task-authority=/tmp/capability",
    "--output=/tmp/repo/plan.json",
  ], { branch: "agent/device/scope", createAdapter: () => ({ gitCommonDir: "/tmp" }),
    createStore: () => ({}), createController: () => ({ plan: () => ({ planDigest: "a".repeat(64) }) }) }),
  /outside the repository/u);
});
