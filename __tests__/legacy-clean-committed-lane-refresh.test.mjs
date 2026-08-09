import test from "node:test";
import assert from "node:assert/strict";

import { buildRefreshResult } from "../scripts/legacy-clean-committed-lane-refresh.mjs";

test("public refresh result excludes the session identifier", () => {
  const result = buildRefreshResult({
    branch: "agent/device/release-lane",
    pullRequestUrl: "https://github.com/example/repo/pull/1",
    previousHeadSha: "a".repeat(40),
    refreshedHeadSha: "b".repeat(40),
    epoch: 7,
    merged: true,
    sessionId: "should-not-appear",
  });

  assert.equal(result.schema, "agentic-legacy-clean-committed-lane-refresh-result/v1");
  assert.equal(result.status, "refreshed");
  assert.equal("sessionId" in result, false);
  assert.equal(JSON.stringify(result).includes("should-not-appear"), false);
});
