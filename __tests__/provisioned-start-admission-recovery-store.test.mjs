import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProvisionedStartAdmissionRecoveryStore } from "../scripts/provisioned-start-admission-recovery-store.mjs";

test("intent store is sequential, idempotent, and preserves completion", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "start-recovery-store-"));
  mkdirSync(path.join(root, "objects"));
  const store = createProvisionedStartAdmissionRecoveryStore({ gitCommonDir: root, branch: "agent/device/scope" });
  const plan = { planDigest: "a".repeat(64), evidence: { value: 1 } };
  const authorization = { authorizationDigest: "b".repeat(64) };
  const first = store.begin({ plan, authorization, startedAt: "2026-08-14T00:00:00.000Z" });
  assert.equal(store.begin({ plan, authorization, startedAt: "later" }).intentDigest, first.intentDigest);
  let current = store.advance({ expectedPhase: "intent", phase: "local-projected", values: { lease: 1 },
    recordedAt: "2026-08-14T00:00:01.000Z" });
  current = store.advance({ expectedPhase: "local-projected", phase: "marker-projected", values: { body: 1 },
    recordedAt: "2026-08-14T00:00:02.000Z" });
  current = store.advance({ expectedPhase: "marker-projected", phase: "complete", values: { terminal: 1 },
    recordedAt: "2026-08-14T00:00:03.000Z" });
  assert.equal(current.phase, "complete");
  assert.equal(store.read().intentDigest, current.intentDigest);
  assert.throws(() => store.begin({ plan: { ...plan, planDigest: "c".repeat(64) }, authorization,
    startedAt: "later" }), /Another recovery intent/u);
});
