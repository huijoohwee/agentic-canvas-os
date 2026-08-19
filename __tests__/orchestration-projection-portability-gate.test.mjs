import assert from "node:assert/strict";
import test from "node:test";
import { runPathPortabilityGate } from "../scripts/audit/path-portability-gate.mjs";

test("portability gate maps passed status to success", () => {
  const receipt = runPathPortabilityGate({ githubRoot: process.cwd(), extraFiles: [{ path: "agentic-canvas-os/__tests__/fixture.mjs", text: "const value = 'portable';\n" }] });
  assert.equal(receipt.status, "passed");
});

test("portability gate maps failed status to non-success", () => {
  const nonPortablePath = "/" + "tmp/not-portable";
  const receipt = runPathPortabilityGate({ githubRoot: process.cwd(), extraFiles: [{ path: "agentic-canvas-os/__tests__/fixture.mjs", text: "const value = '" + nonPortablePath + "';\n" }] });
  assert.equal(receipt.status, "failed");
});
