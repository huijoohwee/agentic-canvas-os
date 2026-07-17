import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assertKnowgrphCollaborationGate,
  resolveKnowgrphRoot,
  runCollaborationGate,
} from "../scripts/collaboration-gate.mjs";

test("collaboration gate resolves the sibling Knowgrph owner without machine paths", () => {
  assert.equal(
    resolveKnowgrphRoot({ agenticCanvasOsRoot: "/repos/agentic-canvas-os", env: {} }),
    path.resolve("/repos/knowgrph"),
  );
  assert.equal(
    resolveKnowgrphRoot({ agenticCanvasOsRoot: "/repos/agentic-canvas-os", env: { KNOWGRPH_ROOT: "/work/knowgrph" } }),
    path.resolve("/work/knowgrph"),
  );
});

test("collaboration gate requires the canonical Knowgrph command owner", () => {
  const packageText = JSON.stringify({
    scripts: { "collaboration:readiness:check": "node ./scripts/check-collaboration-readiness.mjs" },
  });
  assert.equal(assertKnowgrphCollaborationGate({
    knowgrphRoot: "/repos/knowgrph",
    fileExists: () => true,
    readText: () => packageText,
  }), "/repos/knowgrph");
  assert.throws(() => assertKnowgrphCollaborationGate({
    knowgrphRoot: "/repos/knowgrph",
    fileExists: () => true,
    readText: () => JSON.stringify({ scripts: {} }),
  }), /canonical collaboration:readiness:check/);
});

test("one command delegates to the complete Knowgrph collaboration readiness gate", () => {
  const calls = [];
  runCollaborationGate({
    agenticCanvasOsRoot: "/repos/agentic-canvas-os",
    env: {},
    validateOwner: ({ knowgrphRoot }) => knowgrphRoot,
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["run", "collaboration:readiness:check"]);
  assert.equal(calls[0].options.cwd, path.resolve("/repos/knowgrph"));
  assert.equal(calls[0].options.stdio, "inherit");
});

test("validation contract forbids physical-device and manual JSON evidence", () => {
  const runbook = readFileSync(new URL("../docs/VALIDATION-RUNBOOK.md", import.meta.url), "utf8");
  assert.match(runbook, /npm run collaboration:gate/);
  assert.doesNotMatch(runbook, /RUNTIME_IDENTITY_FILES/);
  assert.match(runbook, /does not require two physical devices/);
  assert.match(runbook, /does not export runtime-identity JSON/);
});
