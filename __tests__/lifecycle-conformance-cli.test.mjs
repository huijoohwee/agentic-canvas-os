import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  LIFECYCLE_CONFORMANCE_ENFORCED_STAGES,
  LIFECYCLE_CONFORMANCE_UNEVALUATED_STAGES,
  formatLifecycleConformanceFailure,
  parseLifecycleConformanceArguments,
  runLifecycleConformance,
} from "../scripts/lifecycle-conformance.mjs";
import {
  LIFECYCLE_STAGES,
} from "../scripts/lifecycle-conformance-gate.mjs";
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

test("CLI fails closed while every consumer-run stage is unevaluated", async () => {
  await assert.rejects(
    runLifecycleConformance(
      ["--evidence", "evidence.json"],
      {
        currentDirectory: "/workspace",
        readText: async () => JSON.stringify({
          policy: lifecyclePolicyIdentity(),
        }),
      },
    ),
    (error) =>
      error?.code === "AGENTIC_SDLC_EVIDENCE_ADAPTER_UNAVAILABLE" &&
      error.locator === "/workspace/evidence.json" &&
      error.enforcedStages === LIFECYCLE_CONFORMANCE_ENFORCED_STAGES &&
      error.unevaluatedStages === LIFECYCLE_CONFORMANCE_UNEVALUATED_STAGES,
  );
  assert.deepEqual(LIFECYCLE_CONFORMANCE_ENFORCED_STAGES, []);
  assert.deepEqual(
    LIFECYCLE_CONFORMANCE_UNEVALUATED_STAGES,
    LIFECYCLE_STAGES,
  );
  assert.deepEqual(
    JSON.parse(formatLifecycleConformanceFailure({
      code: "AGENTIC_SDLC_EVIDENCE_ADAPTER_UNAVAILABLE",
      message: "unavailable",
      enforcedStages: LIFECYCLE_CONFORMANCE_ENFORCED_STAGES,
      unevaluatedStages: LIFECYCLE_CONFORMANCE_UNEVALUATED_STAGES,
    })),
    {
      schema: "agentic-sdlc-conformance-error/v1",
      status: "error",
      code: "AGENTIC_SDLC_EVIDENCE_ADAPTER_UNAVAILABLE",
      message: "unavailable",
      enforcedStages: [],
      unevaluatedStages: LIFECYCLE_STAGES,
    },
  );
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

test("executable CLI returns identity-unavailable exit 3 with explicit scope", () => {
  const executable = fileURLToPath(
    new URL("../scripts/lifecycle-conformance.mjs", import.meta.url),
  );
  const evidence = fileURLToPath(
    new URL("./fixtures/lifecycle-policy-only.json", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [executable, `--evidence=${evidence}`],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.stdout, "");
  const failure = JSON.parse(result.stderr);
  assert.equal(
    failure.code,
    "AGENTIC_SDLC_EVIDENCE_ADAPTER_UNAVAILABLE",
  );
  assert.deepEqual(failure.enforcedStages, []);
  assert.deepEqual(failure.unevaluatedStages, LIFECYCLE_STAGES);
});
