import assert from "node:assert/strict";
import test from "node:test";

import {
  parseLifecycleConformanceArguments,
  runLifecycleConformance,
} from "../scripts/lifecycle-conformance.mjs";
import {
  lifecyclePolicyIdentity,
} from "../scripts/lifecycle-conformance-policy.mjs";

test("CLI arguments require one evidence artifact", () => {
  assert.deepEqual(
    parseLifecycleConformanceArguments(["--evidence=run.json", "--pretty"]),
    { evidencePath: "run.json", pretty: true },
  );
  assert.throws(
    () => parseLifecycleConformanceArguments([]),
    /--evidence is required/u,
  );
  assert.throws(
    () => parseLifecycleConformanceArguments(["--latest"]),
    /unsupported argument/u,
  );
});

test("CLI emits one evaluator receipt and derives its exit from readiness", async () => {
  const writes = [];
  const receipt = {
    schema: "agentic-sdlc-stage-conformance/v1",
    ready: false,
  };
  const outcome = await runLifecycleConformance(
    ["--evidence", "evidence.json"],
    {
      currentDirectory: "/workspace",
      readText: async () => JSON.stringify({
        policy: lifecyclePolicyIdentity(),
      }),
      evaluate: () => receipt,
      write: (value) => writes.push(value),
    },
  );
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.locator, "/workspace/evidence.json");
  assert.deepEqual(JSON.parse(writes[0]), receipt);
});

test("CLI refuses policy revision or digest drift before evaluation", async () => {
  let evaluated = false;
  await assert.rejects(
    runLifecycleConformance(["--evidence=evidence.json"], {
      readText: async () => JSON.stringify({
        policy: {
          ...lifecyclePolicyIdentity(),
          revision: "0".repeat(40),
        },
      }),
      evaluate: () => {
        evaluated = true;
        return { ready: true };
      },
      write: () => {},
    }),
    (error) =>
      error?.code === "AGENTIC_SDLC_POLICY_IDENTITY_UNAVAILABLE" &&
      /repository-owned policy/u.test(error.message),
  );
  assert.equal(evaluated, false);
});
