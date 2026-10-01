import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("CLI fails closed without exact bounded inputs", () => { const result = spawnSync(process.execPath,
  ["scripts/planned-admission-owner-release.mjs", "plan", "--json"], { encoding: "utf8" });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).ok, false); });
