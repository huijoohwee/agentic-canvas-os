import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("repository adapter uses a distinct provider-deferred journal and preserves bytes", () => {
  const source = readFileSync(new URL(
    "../scripts/expired-descendant-untracked-scope-recovery-repository-adapter.mjs",
    import.meta.url), "utf8");
  assert.ok(source.split("\n").length < 600);
  assert.doesNotMatch(source, /runActiveDirtyScopeExpansion/u);
  assert.doesNotMatch(source, /allowTarget/u);
  assert.doesNotMatch(source, /scopeExpansionIntents/u);
  assert.match(source, /beginExpiredDescendantIntent/u);
  assert.match(source, /projectExpiredDescendantSuccessor/u);
  assert.match(source, /allowExpired: true/u);
  assert.match(source, /providerProjection: "deferred"/u);
  assert.match(source, /expectedLedgerDigest: guarded\.cloud\.ledgerDigest/u);
  assert.doesNotMatch(source, /"pr",\s*"edit"/u);
  assert.doesNotMatch(source, /\["(?:add|commit|push|reset|checkout)"/u);
  assert.doesNotMatch(source, /projectPullRequestMarker/u);
});

test("the controller never accepts a current source as dormant evidence", () => {
  const source = readFileSync(new URL(
    "../scripts/expired-descendant-untracked-scope-recovery-evidence.mjs",
    import.meta.url), "utf8");
  assert.match(source, /result\.state !== "dormant-preserved"/u);
  assert.match(source, /result\.writeAuthority !== false/u);
  assert.match(source, /result\.scopeReserved !== true/u);
});
