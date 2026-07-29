import assert from "node:assert/strict";
import test from "node:test";

import {
  main,
  parseArguments,
} from "../scripts/agentic-sdlc.mjs";

test("execution CLI requires one explicit run locator", () => {
  assert.deepEqual(parseArguments(["--run", "run.json"]), {
    pretty: false,
    runPath: "run.json",
  });
  assert.deepEqual(parseArguments(["--run=run.json", "--pretty"]), {
    pretty: true,
    runPath: "run.json",
  });
  assert.throws(() => parseArguments([]), /--run is required/u);
  assert.throws(() => parseArguments(["--unknown"]), /unsupported argument/u);
});

test("execution CLI returns zero only for a runtime-ready result", async () => {
  const outputs = [];
  const ready = await main(["--run", "run.json"], {
    currentDirectory: "/workspace",
    readText: async (locator) => {
      assert.equal(locator, "/workspace/run.json");
      return JSON.stringify({ schema: "agentic-sdlc-run/v1" });
    },
    validateRun: (artifact) => ({
      runtimeReady: artifact.schema === "agentic-sdlc-run/v1",
    }),
    writeOutput: (value) => outputs.push(value),
  });
  assert.equal(ready.exitCode, 0);
  assert.deepEqual(JSON.parse(outputs[0]), { runtimeReady: true });

  const notReady = await main(["--run=run.json"], {
    currentDirectory: "/workspace",
    readText: async () => "{}",
    validateRun: () => ({ runtimeReady: false, findings: ["blocked"] }),
    writeOutput: () => {},
  });
  assert.equal(notReady.exitCode, 1);
});
