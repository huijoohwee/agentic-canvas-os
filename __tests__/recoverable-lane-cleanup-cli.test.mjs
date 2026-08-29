import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRecoverableLaneCleanupArguments,
  runRecoverableLaneCleanupCli,
} from "../scripts/recoverable-lane-cleanup.mjs";

const digest = "7".repeat(64);

test("CLI parses one explicit target and repeated preservation receipts", () => {
  const parsed = parseRecoverableLaneCleanupArguments([
    "plan",
    "--repository=/repo",
    "--worktree=/tasks/lane",
    "--recovery-directory=/recovery/lane",
    "--session=session-cleanup",
    `--operator-decision-digest=${digest}`,
    `--supersede-preservation=${"1".repeat(64)}`,
    `--supersede-preservation=${"2".repeat(64)}`,
    "--ledger-repository=authority/ledger",
    "--json",
  ]);
  assert.equal(parsed.mode, "plan");
  assert.equal(parsed.json, true);
  assert.deepEqual(parsed.input.supersededPreservationDigests, [
    "1".repeat(64), "2".repeat(64),
  ]);
  assert.equal(parsed.input.ledgerRepository, "authority/ledger");
});

test("CLI refuses broad, relative, duplicated, and incomplete arguments", () => {
  assert.throws(() => parseRecoverableLaneCleanupArguments(["plan"]), /repository/);
  assert.throws(() => parseRecoverableLaneCleanupArguments([
    "plan", "--repository=repo", "--worktree=/tasks/lane",
    "--recovery-directory=/recovery/lane", "--session=s",
    `--operator-decision-digest=${digest}`,
  ]), /normalized absolute/);
  assert.throws(() => parseRecoverableLaneCleanupArguments([
    "plan", "--repository=/repo", "--repository=/other", "--worktree=/tasks/lane",
    "--recovery-directory=/recovery/lane", "--session=s",
    `--operator-decision-digest=${digest}`,
  ]), /Duplicate/);
  for (const repository of ["authority", "authority/ledger/extra", " authority/ledger", "authority/ledger "]) {
    assert.throws(() => parseRecoverableLaneCleanupArguments([
      "plan", "--repository=/repo", "--worktree=/tasks/lane",
      "--recovery-directory=/recovery/lane", "--session=s",
      `--operator-decision-digest=${digest}`,
      `--ledger-repository=${repository}`,
    ]), /ledger-repository.*owner\/name/);
  }
  assert.throws(() => parseRecoverableLaneCleanupArguments([
    "run", "--repository=/repo", "--worktree=/tasks/lane",
    "--recovery-directory=/recovery/lane", "--session=s",
    `--operator-decision-digest=${digest}`,
  ]), /plan digest/);
  assert.throws(() => parseRecoverableLaneCleanupArguments([
    "plan", "--repository=/repo", "--worktree=/tasks/lane",
    "--recovery-directory=/recovery/lane", "--session=s",
    `--operator-decision-digest=${digest}`, "--unknown=value",
  ]), /Unsupported plan argument/);
  assert.throws(() => parseRecoverableLaneCleanupArguments([
    "plan", "--repository=/repo", "--worktree=/tasks/lane",
    "--recovery-directory=/recovery/lane", "--session=s",
    `--operator-decision-digest=${digest}`, `--authorize=authorize recoverable-lane-cleanup ${digest}`,
  ]), /Unsupported plan argument/);
  assert.throws(() => parseRecoverableLaneCleanupArguments([
    "plan", "--repository=/repo", "--worktree=/tasks/lane",
    "--recovery-directory=/recovery/lane", "--session=s",
    `--operator-decision-digest=${digest}`, "--json", "--json",
  ]), /Duplicate/);
});

test("CLI delegates without adding branch, provider, force, or prune effects", () => {
  const calls = [];
  let output = "";
  const expected = { schema: "test-result/v1", status: "planned" };
  const result = runRecoverableLaneCleanupCli([
    "plan", "--repository=/repo", "--worktree=/tasks/lane",
    "--recovery-directory=/recovery/lane", "--session=s",
    `--operator-decision-digest=${digest}`, "--json",
  ], {
    adapter: {},
    controller: {
      plan(input) { calls.push(input); return expected; },
    },
    write(text) { output += text; },
  });
  assert.deepEqual(result, expected);
  assert.equal(calls.length, 1);
  assert.match(output, /"status": "planned"/u);
  assert.doesNotMatch(output, /force|push|prune|delete-branch/u);
});

test("CLI passes the explicit ledger repository into its repository adapter", () => {
  const calls = [];
  runRecoverableLaneCleanupCli([
    "plan", "--repository=/repo", "--worktree=/tasks/lane",
    "--recovery-directory=/recovery/lane", "--session=s",
    `--operator-decision-digest=${digest}`,
    "--ledger-repository=authority/ledger",
  ], {
    createAdapter(options) {
      calls.push(options);
      return {};
    },
    controller: { plan() { return { status: "planned" }; } },
    write() {},
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ledgerRepository, "authority/ledger");
});

test("CLI accepts the same explicit ledger identity for run and observe", () => {
  const common = [
    "--repository=/repo", "--worktree=/tasks/lane",
    "--recovery-directory=/recovery/lane",
    "--ledger-repository=authority/ledger",
  ];
  const run = parseRecoverableLaneCleanupArguments([
    "run", ...common, "--session=s",
    `--operator-decision-digest=${digest}`,
    `--plan-digest=${digest}`,
    `--authorize=authorize recoverable-lane-cleanup ${digest}`,
  ]);
  const observe = parseRecoverableLaneCleanupArguments([
    "observe", ...common, `--plan-digest=${digest}`,
  ]);
  assert.equal(run.input.ledgerRepository, "authority/ledger");
  assert.equal(observe.input.ledgerRepository, "authority/ledger");
});
