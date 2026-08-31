import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertActiveDescendantUntrackedIncidentShape,
  normalizeActiveDescendantUntrackedOwnerStopReceipt,
} from "../scripts/active-descendant-untracked-scope-recovery-repository-adapter.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const HEAD = "1".repeat(40);
const FENCE = "2".repeat(40);
const STOPPED = ["scripts/new-a.mjs", "scripts/new-b.mjs"];

function ownerStop(overrides = {}) {
  const core = {
    schema: "agentic-active-descendant-untracked-owner-stop/v1",
    sourceSessionId: "session:owner",
    sourceBranch: "agent/device.local/scope",
    sourceHeadSha: HEAD,
    sourceFenceSha: FENCE,
    untrackedPaths: STOPPED,
    stoppedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
  return { ...core, receiptDigest: digestValue(core) };
}

function incident(overrides = {}) {
  return {
    lease: { admission: { declaredWriteSet: ["path:scripts/tracked.mjs"] } },
    lane: { headSha: HEAD, remoteFenceSha: FENCE },
    dirt: { entries: [
      { path: "scripts/tracked.mjs", untracked: false },
      { path: STOPPED[0], untracked: true },
      { path: STOPPED[1], untracked: true },
    ] },
    stop: ownerStop(),
    target: { declaredWriteSet: [
      "path:scripts/tracked.mjs", `path:${STOPPED[0]}`, `path:${STOPPED[1]}`,
      "path:scripts/future-adapter.mjs",
    ] },
    ...overrides,
  };
}

test("owner-stop receipt is exact, sorted, and self-digesting", () => {
  const receipt = normalizeActiveDescendantUntrackedOwnerStopReceipt(ownerStop());
  assert.deepEqual(receipt.untrackedPaths, STOPPED);
  const { receiptDigest, ...core } = receipt;
  assert.equal(receiptDigest, digestValue(core));

  const extra = { ...ownerStop(), inferredExpiry: "2026-09-01T00:00:00.000Z" };
  assert.throws(() => normalizeActiveDescendantUntrackedOwnerStopReceipt(extra), /schema/u);
  assert.throws(
    () => normalizeActiveDescendantUntrackedOwnerStopReceipt({ ...ownerStop(), receiptDigest: "0".repeat(64) }),
    /receipt digest/u,
  );
});

test("incident admits only the exact stopped untracked partition and a strict superset", () => {
  assert.doesNotThrow(() => assertActiveDescendantUntrackedIncidentShape(incident()));
  const wrongFence = incident({ lane: { headSha: HEAD, remoteFenceSha: "3".repeat(40) } });
  assert.throws(() => assertActiveDescendantUntrackedIncidentShape(wrongFence), /revision identity/u);

  const unstopped = incident();
  unstopped.dirt.entries.push({ path: "scripts/foreign.mjs", untracked: true });
  assert.throws(() => assertActiveDescendantUntrackedIncidentShape(unstopped), /scope partition/u);

  const notStrict = incident({ target: { declaredWriteSet: ["path:scripts/tracked.mjs"] } });
  assert.throws(() => assertActiveDescendantUntrackedIncidentShape(notStrict), /scope partition|strict-superset/u);
});

test("adapter stays bounded and contains no provider or Git authoring mutation", () => {
  const source = readFileSync(new URL("../scripts/active-descendant-untracked-scope-recovery-repository-adapter.mjs", import.meta.url), "utf8");
  assert.ok(source.split("\n").length < 600);
  assert.doesNotMatch(source, /\["pr",\s*"edit"/u);
  assert.doesNotMatch(source, /\b(?:add|commit|push|reset|checkout)\b[^\n]*\(\[/u);
  assert.doesNotMatch(source, /verifyPullRequestPreserved/u);
  assert.match(source, /pullRequestMutation:\s*false/u);
  assert.match(source, /providerProjection:\s*"deferred"/u);
});
