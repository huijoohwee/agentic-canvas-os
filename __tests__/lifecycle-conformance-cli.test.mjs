import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  LIFECYCLE_CONFORMANCE_ENFORCED_STAGES,
  LIFECYCLE_CONFORMANCE_UNEVALUATED_STAGES,
  formatLifecycleConformanceFailure,
  lifecycleConformanceFailureExitCode,
  parseLifecycleConformanceArguments,
  runLifecycleConformance,
} from "../scripts/lifecycle-conformance.mjs";
import {
  LIFECYCLE_STAGES,
} from "../scripts/lifecycle-conformance-gate.mjs";

const identities = Object.freeze({
  policy: Object.freeze({
    repository: "huijoohwee/huijoohwee.github.io",
    revision: "a".repeat(40),
    digest: "b".repeat(64),
    guidelineVersion: "1.8.0",
  }),
  evaluator: Object.freeze({
    repository: "huijoohwee/agentic-canvas-os",
    revision: "c".repeat(40),
    digest: "d".repeat(64),
    mechanismId: "agentic-canvas-os:lifecycle-conformance:admission/v1",
  }),
  schema: Object.freeze({
    repository: "huijoohwee/agentic-canvas-os",
    revision: "c".repeat(40),
    digest: "e".repeat(64),
  }),
});

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

test("CLI classifies every identity mismatch as exit 3", () => {
  for (const code of [
    "AGENTIC_SDLC_POLICY_IDENTITY_UNAVAILABLE",
    "AGENTIC_SDLC_EVALUATOR_IDENTITY_UNAVAILABLE",
    "AGENTIC_SDLC_SCHEMA_IDENTITY_UNAVAILABLE",
    "AGENTIC_SDLC_SOURCE_IDENTITY_UNAVAILABLE",
    "AGENTIC_SDLC_DEPENDENCY_IDENTITY_UNAVAILABLE",
  ]) {
    assert.equal(lifecycleConformanceFailureExitCode({ code }), 3, code);
  }
  assert.equal(
    lifecycleConformanceFailureExitCode({
      code: "AGENTIC_SDLC_EVALUATOR_FAILURE",
    }),
    2,
  );
});

test("CLI evaluates admission and leaves every later stage unevaluated", async () => {
  let output = "";
  const receipt = {
    schema: "agentic-sdlc-admission-stage-receipt/v1",
    ready: false,
    verdict: "blocked",
  };
  const result = await runLifecycleConformance(
    ["--evidence", "evidence.json"],
    {
      currentDirectory: "/workspace",
      readText: async () => JSON.stringify({ schema: "input/v1" }),
      resolveIdentities: () => identities,
      evaluate: (operation, resolvedIdentities) => {
        assert.equal(operation.schema, "input/v1");
        assert.equal(resolvedIdentities, identities);
        return receipt;
      },
      write: (value) => {
        output += value;
      },
    },
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.locator, "/workspace/evidence.json");
  assert.equal(result.receipt, receipt);
  assert.deepEqual(JSON.parse(output), receipt);
  assert.deepEqual(LIFECYCLE_CONFORMANCE_ENFORCED_STAGES, ["admission"]);
  assert.deepEqual(
    LIFECYCLE_CONFORMANCE_UNEVALUATED_STAGES,
    LIFECYCLE_STAGES.slice(1),
  );
  assert.deepEqual(
    JSON.parse(formatLifecycleConformanceFailure({
      code: "AGENTIC_SDLC_EVALUATOR_FAILURE",
      message: "unavailable",
    })),
    {
      schema: "agentic-sdlc-conformance-error/v1",
      status: "error",
      code: "AGENTIC_SDLC_EVALUATOR_FAILURE",
      message: "unavailable",
      enforcedStages: ["admission"],
      unevaluatedStages: LIFECYCLE_STAGES.slice(1),
    },
  );
});

test("CLI surfaces typed identity failures before a domain verdict", async () => {
  let evaluated = false;
  await assert.rejects(
    runLifecycleConformance(["--evidence=evidence.json"], {
      readText: async () => JSON.stringify({ schema: "input/v1" }),
      resolveIdentities: () => identities,
      evaluate: () => {
        evaluated = true;
        const error = new Error("policy drift");
        error.code = "AGENTIC_SDLC_POLICY_IDENTITY_UNAVAILABLE";
        throw error;
      },
      write: () => {},
    }),
    (error) =>
      error?.code === "AGENTIC_SDLC_POLICY_IDENTITY_UNAVAILABLE"
      && /policy drift/u.test(error.message),
  );
  assert.equal(evaluated, true);
});

test("executable CLI returns identity-unavailable exit 3 with admission scope", () => {
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
  assert.match(failure.code, /^AGENTIC_SDLC_.*IDENTITY_UNAVAILABLE$/u);
  assert.deepEqual(failure.enforcedStages, ["admission"]);
  assert.deepEqual(failure.unevaluatedStages, LIFECYCLE_STAGES.slice(1));
});
