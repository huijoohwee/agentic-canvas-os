import assert from "node:assert/strict";
import test from "node:test";

import {
  createCoordinationClaimRunAdapter,
  createDeviceChildProcessPolicy,
  TASK_AUTHORITY_LOCATOR_KEY,
} from "../scripts/device-child-process-policy.mjs";

const LOCATOR = "/external/task-authority.json";
const SUBJECT = "chore(coordination): claim portable-scope lease 7";

test("generic Git, provider, text, and validation children never receive the locator", () => {
  const { policy, calls } = harness();

  policy.gitText(["status", "--short"]);
  policy.gitOptional(["rev-parse", "HEAD"]);
  policy.ghText(["pr", "view", "7"]);
  policy.ghOptional(["run", "list"]);
  policy.run("git", ["commit", "-m", "ordinary source change"]);
  policy.run("git", ["commit", "--allow-empty", "-m", SUBJECT]);
  policy.run("node", ["scripts/validate.mjs"]);
  policy.runText("npm", ["run", "docs:check"]);
  policy.gitText(["commit", "--allow-empty", "-m", SUBJECT]);
  policy.runText("git", ["commit", "--allow-empty", "-m", SUBJECT]);
  policy.runText("node", ["scripts/check.mjs"], {
    env: { PATH: "/bin", [TASK_AUTHORITY_LOCATOR_KEY]: "/injected/lookalike.json" },
  });

  assert.equal(calls.length, 11);
  for (const call of calls) {
    assert.equal(call.options.env[TASK_AUTHORITY_LOCATOR_KEY], undefined);
  }
});

test("only exact coordination-claim commits receive the external locator", () => {
  const ordinary = harness();
  const preserving = harness();

  ordinary.policy.commitCoordinationClaim({ scope: "portable-scope", epoch: 7 });
  preserving.policy.commitCoordinationClaim({
    scope: "portable-scope",
    epoch: 7,
    preserveOwnedDirt: true,
  });

  assert.deepEqual(ordinary.calls[0].argumentsList, [
    "diff", "--cached", "--quiet", "--",
  ]);
  assert.equal(ordinary.calls[0].options.env[TASK_AUTHORITY_LOCATOR_KEY], undefined);
  assert.deepEqual(ordinary.calls[1].argumentsList, [
    "commit", "--allow-empty", "--only", "-m", SUBJECT,
  ]);
  assert.equal(ordinary.calls[1].options.env[TASK_AUTHORITY_LOCATOR_KEY], LOCATOR);
  assert.deepEqual(preserving.calls[0].argumentsList, [
    "commit", "--allow-empty", "--only", "-m", SUBJECT,
  ]);
  assert.equal(preserving.calls[0].options.env[TASK_AUTHORITY_LOCATOR_KEY], LOCATOR);
  for (const call of [ordinary.calls[1], preserving.calls[0]]) {
    assert.equal(call.command, "git");
    assert.equal(call.argumentsList.includes("--only"), true);
    assert.equal(call.argumentsList.includes("--no-verify"), false);
  }
});

test("the lifecycle adapter translates only trusted start and resume claim shapes", () => {
  const start = harness();
  const resume = harness();
  const heartbeat = harness();
  const startRun = createCoordinationClaimRunAdapter({
    action: "start",
    expectedScope: "portable-scope",
    verifyExpectedClaim: claim => claim.epoch === 7,
    run: start.policy.run,
    commitCoordinationClaim: start.policy.commitCoordinationClaim,
  });
  const resumeRun = createCoordinationClaimRunAdapter({
    action: "resume",
    expectedScope: "portable-scope",
    verifyExpectedClaim: claim => claim.epoch === 7,
    run: resume.policy.run,
    commitCoordinationClaim: resume.policy.commitCoordinationClaim,
  });
  const heartbeatRun = createCoordinationClaimRunAdapter({
    action: "heartbeat",
    run: heartbeat.policy.run,
    commitCoordinationClaim: heartbeat.policy.commitCoordinationClaim,
  });

  startRun("git", ["commit", "--allow-empty", "-m", SUBJECT]);
  resumeRun("git", ["commit", "--allow-empty", "--only", "-m", SUBJECT]);
  heartbeatRun("git", ["commit", "--allow-empty", "-m", SUBJECT]);

  assert.deepEqual(start.calls[0].argumentsList, ["diff", "--cached", "--quiet", "--"]);
  assert.equal(start.calls[0].options.env[TASK_AUTHORITY_LOCATOR_KEY], undefined);
  assert.equal(start.calls[1].options.env[TASK_AUTHORITY_LOCATOR_KEY], LOCATOR);
  assert.equal(resume.calls[0].options.env[TASK_AUTHORITY_LOCATOR_KEY], LOCATOR);
  assert.equal(heartbeat.calls[0].options.env[TASK_AUTHORITY_LOCATOR_KEY], undefined);
});

test("the lifecycle adapter keeps mismatched scope and lease claims unprivileged", () => {
  const { policy, calls } = harness();
  const adaptedRun = createCoordinationClaimRunAdapter({
    action: "start",
    expectedScope: "portable-scope",
    verifyExpectedClaim: claim => claim.epoch === 7,
    run: policy.run,
    commitCoordinationClaim: policy.commitCoordinationClaim,
  });

  adaptedRun("git", [
    "commit", "--allow-empty", "-m",
    "chore(coordination): claim different-scope lease 7",
  ]);
  adaptedRun("git", [
    "commit", "--allow-empty", "-m",
    "chore(coordination): claim portable-scope lease 8",
  ]);

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.env[TASK_AUTHORITY_LOCATOR_KEY], undefined);
  }
});

test("ordinary coordination claims fail closed on a staged or unreadable index", () => {
  for (const [status, message] of [
    [1, /empty staged index/u],
    [128, /could not verify/u],
  ]) {
    const { policy, calls } = harness(undefined, LOCATOR, [status]);
    assert.throws(
      () => policy.commitCoordinationClaim({ scope: "portable-scope", epoch: 7 }),
      message,
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].argumentsList, ["diff", "--cached", "--quiet", "--"]);
    assert.equal(calls[0].options.env[TASK_AUTHORITY_LOCATOR_KEY], undefined);
  }
});

test("typed coordination claims reject invalid fields before spawning", () => {
  const { policy, calls } = harness();
  const invalidInputs = [
    { scope: "Bad", epoch: 7 },
    { scope: "portable-scope", epoch: 0 },
    { scope: "portable-scope", epoch: Number.MAX_SAFE_INTEGER + 1 },
    { scope: "portable-scope", epoch: 7, preserveOwnedDirt: "yes" },
  ];

  for (const input of invalidInputs) {
    assert.throws(() => policy.commitCoordinationClaim(input));
  }
  const relative = harness(undefined, "relative/task-authority.json");
  assert.throws(
    () => relative.policy.commitCoordinationClaim({ scope: "portable-scope", epoch: 7 }),
    /absolute external/u,
  );

  assert.equal(calls.length, 0);
  assert.equal(relative.calls.length, 0);
});

test("coordination lookalikes remain unprivileged", () => {
  const lookalikes = [
    ["gh", ["commit", "--allow-empty", "-m", SUBJECT]],
    ["git", ["-C", "/workspace", "commit", "--allow-empty", "-m", SUBJECT]],
    ["git", ["commit", "--allow-empty", "--no-verify", "-m", SUBJECT]],
    ["git", ["commit", "--allow-empty", "-m", `${SUBJECT} `]],
    ["git", ["commit", "--allow-empty", "-m", "chore(coordination): claim Bad lease 7"]],
    ["git", ["commit", "--allow-empty", "-m", "chore(coordination): claim portable-scope lease 0"]],
  ];
  const { policy, calls } = harness();

  for (const [command, argumentsList] of lookalikes) {
    policy.run(command, argumentsList);
  }

  for (const call of calls) {
    assert.equal(call.options.env[TASK_AUTHORITY_LOCATOR_KEY], undefined);
  }
});

test("policy rejects malformed invocations without mutating caller state", () => {
  const environment = {
    PATH: "/bin",
    [TASK_AUTHORITY_LOCATOR_KEY]: "/ambient/authority.json",
  };
  const original = { ...environment };
  const { policy } = harness(environment);

  policy.run("git", ["status", "--short"]);
  policy.commitCoordinationClaim({ scope: "portable-scope", epoch: 7 });
  assert.throws(() => policy.run("", []), /non-empty string/u);
  assert.throws(() => policy.run("git", ["status", 7]), /array of strings/u);
  assert.deepEqual(environment, original);
});

function harness(environment, taskAuthorityFile = LOCATOR, spawnStatuses = []) {
  const sourceEnvironment = environment || {
    PATH: "/bin",
    [TASK_AUTHORITY_LOCATOR_KEY]: "/ambient/authority.json",
  };
  const calls = [];
  const record = (kind, command, argumentsList, options) => {
    calls.push({ kind, command, argumentsList, options });
    return kind === "spawn"
      ? { status: spawnStatuses.shift() ?? 0, stdout: "ok" }
      : "ok";
  };
  const policy = createDeviceChildProcessPolicy({
    taskAuthorityFile,
    environment: sourceEnvironment,
    execFile: (command, argumentsList, options) => (
      record("exec", command, argumentsList, options)
    ),
    spawn: (command, argumentsList, options) => (
      record("spawn", command, argumentsList, options)
    ),
  });
  return { policy, calls };
}
