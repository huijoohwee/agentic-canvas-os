import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  bindControllerHooksEnvironment,
  bindDeviceStartCloudAuthority,
  exactPullRequestNumber,
  laneStateSignature,
  parseJsonObject,
  readOption,
  resolveResultBranch,
} from "../scripts/device-branch-command-support.mjs";

test("device command support binds one canonical hook source without overwriting peers", () => {
  const environment = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "/workspace/repository",
  };
  bindControllerHooksEnvironment("/workspace/controller", environment);
  assert.equal(environment.GIT_CONFIG_COUNT, "2");
  assert.equal(environment.GIT_CONFIG_KEY_0, "safe.directory");
  assert.equal(environment.GIT_CONFIG_KEY_1, "core.hooksPath");
  assert.equal(
    environment.GIT_CONFIG_VALUE_1,
    path.resolve("/workspace/controller/.githooks"),
  );
  bindControllerHooksEnvironment("/workspace/new-controller", environment);
  assert.equal(environment.GIT_CONFIG_COUNT, "2");
  assert.equal(
    environment.GIT_CONFIG_VALUE_1,
    path.resolve("/workspace/new-controller/.githooks"),
  );
  assert.throws(() => bindControllerHooksEnvironment("/workspace/controller", {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/canonical",
    GIT_CONFIG_KEY_1: "core.hooksPath",
    GIT_CONFIG_VALUE_1: "/attacker",
  }), /duplicate ambient core\.hooksPath/);
  assert.throws(() => bindControllerHooksEnvironment("/workspace/controller", {
    GIT_CONFIG_COUNT: "invalid",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "/peer",
  }), /valid ambient GIT_CONFIG_COUNT/);
});

test("device command support keeps exact branch, PR, and JSON identities", () => {
  assert.equal(resolveResultBranch("start", "agent/device/scope", () => ""),
    "agent/device/scope");
  assert.equal(resolveResultBranch("review", null, () => "agent/device/scope\n"),
    "agent/device/scope");
  assert.equal(exactPullRequestNumber("https://github.test/o/r/pull/276"), 276);
  assert.throws(() => exactPullRequestNumber("https://github.test/o/r/issues/276"),
    /exact HTTPS pull-request URL/);
  assert.throws(() => exactPullRequestNumber(
    "https://github.test/o/r/pull/276/files",
  ), /exact HTTPS pull-request URL/);
  assert.deepEqual(parseJsonObject('{"status":"ready"}', "proof"), {
    status: "ready",
  });
  assert.throws(() => parseJsonObject("[]", "proof"), /JSON object/);
  assert.equal(readOption(["--session=owner-session"], "session"), "owner-session");
  assert.equal(laneStateSignature([
    { path: "/workspace/z", stateDigest: "2" },
    { path: "/workspace/a", stateDigest: "1" },
  ]), JSON.stringify([
    { path: "/workspace/a", stateDigest: "1" },
    { path: "/workspace/z", stateDigest: "2" },
  ]));
});

test("cloud binding joins one exact HTTPS pull request", () => {
  const calls = [];
  const result = bindDeviceStartCloudAuthority({
    authority: { claimId: "claim", targetRepository: "o/r" },
    admission: { writeSetDigest: "scope" },
    branch: "agent/device/scope",
    headSha: "a".repeat(40),
    pullRequestUrl: "https://github.test/o/r/pull/276",
    device: "device",
    sessionId: "session",
    bind: input => {
      calls.push(input);
      return { status: "bound" };
    },
  });
  assert.deepEqual(result, { status: "bound" });
  assert.equal(calls[0].pullRequestNumber, 276);
  assert.equal(calls[0].sessionId, "session");
  assert.throws(() => bindDeviceStartCloudAuthority({
    pullRequestUrl: "http://github.test/o/r/pull/276",
    bind: () => null,
  }), /exact HTTPS pull-request URL/);
  assert.throws(() => bindDeviceStartCloudAuthority({
    authority: { targetRepository: "victim/repository" },
    pullRequestUrl: "https://github.test/attacker/other/pull/276",
    bind: () => null,
  }), /does not belong to the target repository/);
});
