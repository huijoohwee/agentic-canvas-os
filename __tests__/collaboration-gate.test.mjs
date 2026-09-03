import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertAgenticGraphCollaborationGate,
  readCollaborationProof,
  resolveAgenticGraphRoot,
  runCollaborationGate,
  validateCollaborationProof,
} from "../scripts/collaboration-gate.mjs";
import {
  createCollaborationGateSandbox,
  selectPortBlock,
} from "../scripts/collaboration-gate-sandbox.mjs";

const passingProof = {
  ok: true,
  runtimeIdentity: {
    status: "pass",
    observedDeviceCount: 2,
    requiredDeviceCount: 2,
    verificationDigest: "a".repeat(64),
    devices: ["owner", "guest"],
    agenticGraphRevision: "b".repeat(40),
    agenticCanvasOsRevision: "c".repeat(40),
    catalogRevision: "c".repeat(40),
    catalogHydrationStatus: "fresh",
    catalogHydrationAttempts: 1,
  },
};

function fakeSandbox() {
  const releases = [];
  return {
    sandbox: {
      runId: "run-1",
      runRoot: "/runtime/run-1",
      proofPath: "/runtime/run-1/proof.json",
      ports: { owner: 15174, guest: 15175, worker: 15176 },
      environment: { TEST_GATE: "isolated" },
      release: (options) => releases.push(options),
    },
    releases,
  };
}

test("collaboration gate resolves the sibling agentic-graph owner without machine paths", () => {
  assert.equal(
    resolveAgenticGraphRoot({ agenticCanvasOsRoot: "/repos/agentic-canvas-os", env: {} }),
    path.resolve("/repos/agentic-graph"),
  );
  assert.equal(
    resolveAgenticGraphRoot({ agenticCanvasOsRoot: "/repos/agentic-canvas-os", env: { AGENTIC_GRAPH_ROOT: "/work/agentic-graph" } }),
    path.resolve("/work/agentic-graph"),
  );
});

test("collaboration gate requires the canonical agentic-graph command owner", () => {
  const packageText = JSON.stringify({
    scripts: { "collaboration:readiness:check": "node ./scripts/check-collaboration-readiness.mjs" },
  });
  assert.equal(assertAgenticGraphCollaborationGate({
    agenticGraphRoot: "/repos/agentic-graph",
    fileExists: () => true,
    readText: () => packageText,
  }), "/repos/agentic-graph");
  assert.throws(() => assertAgenticGraphCollaborationGate({
    agenticGraphRoot: "/repos/agentic-graph",
    fileExists: () => true,
    readText: () => JSON.stringify({ scripts: {} }),
  }), /canonical collaboration:readiness:check/);
});

test("one command delegates to the complete agentic-graph collaboration readiness gate", () => {
  const calls = [];
  const { sandbox, releases } = fakeSandbox();
  const result = runCollaborationGate({
    agenticCanvasOsRoot: "/repos/agentic-canvas-os",
    env: {},
    validateOwner: ({ agenticGraphRoot }) => agenticGraphRoot,
    createSandbox: () => sandbox,
    readProof: () => passingProof,
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["run", "collaboration:readiness:check"]);
  assert.equal(calls[0].options.cwd, path.resolve("/repos/agentic-graph"));
  assert.equal(calls[0].options.stdio, "inherit");
  assert.equal(calls[0].options.env.TEST_GATE, "isolated");
  assert.equal(result.status, "passed");
  assert.equal(result.proof.verificationDigest, "a".repeat(64));
  assert.deepEqual(releases, [{ preserveArtifacts: false }]);
});

test("failed runtime proof remains scoped to parity and preserves diagnostics", () => {
  const { sandbox, releases } = fakeSandbox();
  assert.throws(() => runCollaborationGate({
    agenticCanvasOsRoot: "/repos/agentic-canvas-os",
    env: {},
    validateOwner: ({ agenticGraphRoot }) => agenticGraphRoot,
    createSandbox: () => sandbox,
    spawn: () => ({ status: 13 }),
  }), (error) => {
    assert.equal(error.gateResult.status, "blocked");
    assert.equal(error.gateResult.blockScope, "runtime-proof");
    assert.equal(error.gateResult.exitCode, 13);
    return true;
  });
  assert.deepEqual(releases, [{ preserveArtifacts: true }]);
});

test("parallel gate allocations skip ports reserved by another active run", () => {
  const first = selectPortBlock({ runId: "first", portsAvailable: () => true });
  const second = selectPortBlock({
    runId: "second",
    activeAllocations: [{ ports: first }],
    portsAvailable: () => true,
  });
  assert.equal(Object.values(second).some(port => Object.values(first).includes(port)), false);
});

test("parallel sandboxes use distinct resources and release only their own run", () => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), "agentic-collaboration-gate-"));
  const options = {
    agenticCanvasOsRoot: "/repos/agentic-canvas-os",
    agenticGraphRoot: "/repos/agentic-graph",
    env: { AGENTIC_COLLABORATION_STATE_ROOT: stateRoot },
    portsAvailable: () => true,
  };
  const first = createCollaborationGateSandbox({ ...options, runId: "first" });
  const second = createCollaborationGateSandbox({ ...options, runId: "second" });
  try {
    assert.equal(Object.values(second.ports).some(port => Object.values(first.ports).includes(port)), false);
    first.release();
    assert.equal(existsSync(first.runRoot), false);
    assert.equal(existsSync(second.runRoot), true);
    second.release();
    assert.equal(existsSync(second.runRoot), false);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("collaboration proof validation rejects stale or duplicate identity evidence", () => {
  assert.equal(typeof readCollaborationProof, "function");
  const stale = structuredClone(passingProof);
  stale.runtimeIdentity.catalogHydrationStatus = "stale";
  assert.throws(() => validateCollaborationProof(stale), /catalog hydration is not fresh/);
  const duplicate = structuredClone(passingProof);
  duplicate.runtimeIdentity.devices = ["same", "same"];
  assert.throws(() => validateCollaborationProof(duplicate), /runtime devices are not distinct/);
  assert.throws(
    () => readCollaborationProof("/missing-proof.json"),
    /proof artifact is missing/,
  );
});

test("validation contract forbids physical-device and manual JSON evidence", () => {
  const runbook = readFileSync(new URL("../docs/VALIDATION-RUNBOOK.md", import.meta.url), "utf8");
  assert.match(runbook, /npm run collaboration:gate/);
  assert.doesNotMatch(runbook, /RUNTIME_IDENTITY_FILES/);
  assert.match(runbook, /does not require two physical devices/);
  assert.match(runbook, /private run-scoped proof artifact is validator-owned/);
  assert.match(runbook, /without blocking ownership-qualified isolated authoring/);
});
