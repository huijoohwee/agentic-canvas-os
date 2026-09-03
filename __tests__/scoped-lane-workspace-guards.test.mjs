import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { assertWorkspaceGuardsReady } from "../scripts/scoped-lane-workspace-guards.mjs";

test("workspace guards require the exact executable controller hook source", () => {
  const root = path.join(os.tmpdir(), `workspace-guards-${process.pid}`);
  const controller = path.join(root, "controller");
  const hooks = path.join(controller, ".githooks");
  try {
    mkdirSync(hooks, { recursive: true });
    for (const hook of [
      "git-guarded",
      "pre-commit",
      "pre-push",
      "reference-transaction",
    ]) {
      writeFileSync(path.join(hooks, hook), "#!/bin/sh\nexit 0\n", {
        mode: 0o755,
      });
    }
    const ready = assertWorkspaceGuardsReady({
      repository: root,
      controllerRoot: controller,
      git: () => hooks,
    });
    assert.equal(ready.status, "ready");
    assert.equal(ready.hooksPath, hooks);

    assert.throws(() => assertWorkspaceGuardsReady({
      repository: root,
      controllerRoot: controller,
      git: () => path.join(root, "copied-hooks"),
    }), /canonical controller hook source/);
    assert.throws(() => assertWorkspaceGuardsReady({
      repository: root,
      controllerRoot: controller,
      git: () => "",
    }), /core\.hooksPath is unset/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
