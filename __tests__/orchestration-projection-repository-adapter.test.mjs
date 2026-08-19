import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { readAuthoredAxis, resolveRoots, writeRawReceiptProjection } from "../scripts/orchestration-projection-repository-adapter.mjs";

test("repository adapter resolves runtime roots from workspace SSOT", () => {
  const repositoryRoot = path.resolve("/workspace/agentic-canvas-os");
  const roots = resolveRoots({
    repositoryRoot,
    env: {},
    git: () => ".git",
  });
  assert.equal(roots.workspaceRoot, path.resolve("/workspace"));
  assert.equal(roots.runtimeStateRoot, path.resolve("/workspace/.runtime-state/agentic-canvas-os"));
  assert.equal(roots.projectionOutputRoot, path.resolve("/workspace/.runtime-state/agentic-canvas-os/orchestration-projection"));
  assert.equal(roots.gitCommonDir, path.resolve("/workspace/agentic-canvas-os/.git"));
});

test("repository adapter uses the single projection state override", () => {
  const repositoryRoot = path.resolve("/workspace/agentic-canvas-os");
  const roots = resolveRoots({
    repositoryRoot,
    env: { AGENTIC_ORCHESTRATION_PROJECTION_STATE_ROOT: "/workspace/state/projection" },
    git: () => ".git",
  });
  assert.equal(roots.projectionOutputRoot, path.resolve("/workspace/state/projection"));
});

test("raw receipt writer emits the table JSON beside the document projection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestration-projection-"));
  try {
    const text = JSON.stringify([{ schema: "example/v1", evidence: { ready: true } }]) + "\n";
    const written = writeRawReceiptProjection({ projectionOutputRoot: root, text });
    assert.equal(written.path, path.join(root, "orchestration-projection-receipts.json"));
    assert.equal(readFileSync(written.path, "utf8"), text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository adapter reads stage axis and nested coordination TTL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestration-projection-"));
  try {
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs", "START-WORKFLOW.md"), [
      "---",
      "date: \"2026-08-19\"",
      "coordination:",
      "  writer_lease_ttl_seconds: 1800",
      "stage_order: [\"one\", \"two\"]",
      "---",
      "",
    ].join("\n"), "utf8");
    assert.deepEqual(readAuthoredAxis({ repositoryRoot: root }), {
      ok: true,
      stageAxis: ["one", "two"],
      stalenessBoundSeconds: 1800,
      authoredDate: "2026-08-19",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
