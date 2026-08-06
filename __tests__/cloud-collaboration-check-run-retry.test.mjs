import assert from "node:assert/strict";
import test from "node:test";

import {
  protectedRefreshUnshallowArguments,
  runVerificationWithShallowRecovery,
} from "../scripts/cloud-collaboration-check-run-retry.mjs";

const unrelatedHistoryFailure = {
  child: { status: 1 },
  result: {
    ok: false,
    error: {
      message: "Command failed: git merge-tree fatal: refusing to merge unrelated histories.",
    },
  },
};
const successfulVerification = {
  child: { status: 0 },
  result: { ok: true, status: "ready" },
};

test("unshallow fetch is fixed to protected main and the validated pull-request ref", () => {
  assert.deepEqual(protectedRefreshUnshallowArguments(262), [
    "fetch",
    "--no-tags",
    "--unshallow",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
    "+refs/pull/262/head:refs/remotes/pull/262/head",
  ]);
  assert.throws(
    () => protectedRefreshUnshallowArguments(0),
    /positive pull-request number/u,
  );
});

test("retries an unrelated-history verification once after a successful unshallow", () => {
  const attempts = [unrelatedHistoryFailure, successfulVerification];
  const trace = [];
  const result = runVerificationWithShallowRecovery({
    verify: () => {
      trace.push("verify");
      return attempts.shift();
    },
    isShallowRepository: () => {
      trace.push("shallow");
      return true;
    },
    unshallowRepository: () => {
      trace.push("unshallow");
      return true;
    },
  });

  assert.equal(result, successfulVerification);
  assert.deepEqual(trace, ["verify", "shallow", "unshallow", "verify"]);
});

test("preserves the first failure when full history cannot be retrieved", () => {
  let verificationCalls = 0;
  const result = runVerificationWithShallowRecovery({
    verify: () => {
      verificationCalls += 1;
      return unrelatedHistoryFailure;
    },
    isShallowRepository: () => true,
    unshallowRepository: () => false,
  });

  assert.equal(result, unrelatedHistoryFailure);
  assert.equal(verificationCalls, 1);
});

test("does not retry unrelated-history failures from a full repository", () => {
  let unshallowCalls = 0;
  const result = runVerificationWithShallowRecovery({
    verify: () => unrelatedHistoryFailure,
    isShallowRepository: () => false,
    unshallowRepository: () => {
      unshallowCalls += 1;
      return true;
    },
  });

  assert.equal(result, unrelatedHistoryFailure);
  assert.equal(unshallowCalls, 0);
});

test("does not inspect repository history for other verification outcomes", () => {
  for (const attempt of [
    successfulVerification,
    {
      child: { status: 1 },
      result: { ok: false, error: { message: "cloud claim expired" } },
    },
  ]) {
    const result = runVerificationWithShallowRecovery({
      verify: () => attempt,
      isShallowRepository: () => {
        throw new Error("unexpected shallow inspection");
      },
      unshallowRepository: () => {
        throw new Error("unexpected history mutation");
      },
    });
    assert.equal(result, attempt);
  }
});
