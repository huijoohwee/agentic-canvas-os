import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJson, digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  readPrivateOperationLock,
  withPrivateOperationLock,
} from "../scripts/private-operation-lock.mjs";

const SCHEMA = "agentic-private-operation-lock/v1";
const NOW = "2026-08-29T02:00:00.000Z";
const CURRENT_IDENTITY = "Sat Aug 29 10:00:00 2026";
const DEAD_PID = 2_147_483_647;

test("creates one durable private v1 lock and releases it after the action", async t => {
  const fixture = lockFixture(t);
  const context = { planDigest: "a".repeat(64), action: "run" };
  const result = await withPrivateOperationLock({
    file: fixture.file,
    context,
    action: owner => {
      const projected = readPrivateOperationLock(fixture.file);
      assert.deepEqual(projected, owner);
      assert.deepEqual(projected.context, context);
      assert.equal(projected.schema, SCHEMA);
      assert.equal(projected.processIdentity, CURRENT_IDENTITY);
      assert.equal(projected.contextDigest, digestValue(context));
      assert.equal(readFileSync(fixture.file, "utf8"), `${canonicalJson(projected)}\n`);
      return "complete";
    },
    now: () => new Date(NOW),
    processIdentity: () => CURRENT_IDENTITY,
    processExists: () => true,
  });
  assert.equal(result, "complete");
  assert.equal(existsSync(fixture.file), false);
});

test("atomically replaces an exact dead v1 owner and preserves action replay", async t => {
  const fixture = lockFixture(t);
  writeOwner(fixture.file, owner({ pid: DEAD_PID, processIdentity: "dead-start" }));
  let ran = false;
  await withPrivateOperationLock({
    file: fixture.file,
    context: { planDigest: "b".repeat(64) },
    action: () => { ran = true; },
    now: () => new Date(NOW),
    processIdentity: pid => pid === process.pid ? CURRENT_IDENTITY : null,
    processExists: pid => pid !== DEAD_PID,
  });
  assert.equal(ran, true);
  assert.equal(existsSync(fixture.file), false);
  assert.deepEqual(remainingCaptures(fixture.directory), []);
});

test("treats a reused pid with a different start identity as a dead owner", async t => {
  const fixture = lockFixture(t);
  writeOwner(fixture.file, owner({ pid: 42, processIdentity: "old-start" }));
  await withPrivateOperationLock({
    file: fixture.file,
    context: { action: "retry" },
    action: () => {},
    now: () => new Date(NOW),
    processIdentity: pid => pid === process.pid ? CURRENT_IDENTITY : "replacement-start",
    processExists: () => true,
  });
  assert.equal(existsSync(fixture.file), false);
});

test("rejects live and identity-ambiguous owners without changing their locks", async t => {
  const fixture = lockFixture(t);
  const live = owner({ pid: 42, processIdentity: "live-start", token: "live-owner" });
  writeOwner(fixture.file, live);
  await assert.rejects(withPrivateOperationLock({
    file: fixture.file,
    context: { action: "retry" },
    action: () => {},
    now: () => new Date(NOW),
    processIdentity: pid => pid === process.pid ? CURRENT_IDENTITY : "live-start",
    processExists: () => true,
  }), /owned by a live process/u);
  assert.equal(readPrivateOperationLock(fixture.file).token, live.token);

  const ambiguous = owner({ pid: 43, processIdentity: "unreadable-start", token: "ambiguous-owner" });
  writeOwner(fixture.file, ambiguous);
  await assert.rejects(withPrivateOperationLock({
    file: fixture.file,
    context: { action: "retry" },
    action: () => {},
    now: () => new Date(NOW),
    processIdentity: pid => pid === process.pid ? CURRENT_IDENTITY : null,
    processExists: () => true,
  }), /identity is ambiguous/u);
  assert.equal(readPrivateOperationLock(fixture.file).token, ambiguous.token);
});

test("fails closed on legacy, malformed, noncanonical, and non-private locks", async t => {
  const fixture = lockFixture(t);
  const run = () => withPrivateOperationLock({
    file: fixture.file,
    context: { action: "retry" },
    action: () => {},
    now: () => new Date(NOW),
    processIdentity: () => CURRENT_IDENTITY,
    processExists: () => false,
  });
  writeFileSync(fixture.file, `${JSON.stringify({ pid: DEAD_PID, token: "legacy", context: {} })}\n`, {
    mode: 0o600,
  });
  await assert.rejects(run(), /malformed/u);

  writeFileSync(fixture.file, "not-json\n", { mode: 0o600 });
  await assert.rejects(run(), /malformed/u);

  writeFileSync(fixture.file, `${JSON.stringify(owner({ pid: DEAD_PID }))}\n`, { mode: 0o600 });
  await assert.rejects(run(), /not canonical/u);

  writeOwner(fixture.file, owner({ pid: DEAD_PID }));
  chmodSync(fixture.file, 0o644);
  await assert.rejects(run(), /owner-private regular file/u);
});

test("restores a changed owner when dead-owner capture loses its exact identity", async t => {
  const fixture = lockFixture(t);
  const original = owner({ pid: DEAD_PID, processIdentity: "dead-start", token: "original" });
  const replacement = owner({ pid: DEAD_PID, processIdentity: "dead-start", token: "replacement" });
  writeOwner(fixture.file, original);
  await assert.rejects(withPrivateOperationLock({
    file: fixture.file,
    context: { action: "retry" },
    action: () => {},
    now: () => new Date(NOW),
    processIdentity: pid => {
      if (pid === process.pid) return CURRENT_IDENTITY;
      writeOwner(fixture.file, replacement);
      return null;
    },
    processExists: () => false,
  }), /changed during dead-owner capture/u);
  assert.equal(readPrivateOperationLock(fixture.file).token, replacement.token);
  assert.deepEqual(remainingCaptures(fixture.directory), []);
});

test("never removes a foreign owner that replaces the lock before release", async t => {
  const fixture = lockFixture(t);
  const foreign = owner({ pid: 44, processIdentity: "foreign-start", token: "foreign" });
  await assert.rejects(withPrivateOperationLock({
    file: fixture.file,
    context: { action: "run" },
    action: () => { writeOwner(fixture.file, foreign); },
    now: () => new Date(NOW),
    processIdentity: () => CURRENT_IDENTITY,
    processExists: () => true,
  }), /ownership changed before release/u);
  assert.equal(readPrivateOperationLock(fixture.file).token, foreign.token);
});

test("never removes an exact-byte replacement on a different inode", async t => {
  const fixture = lockFixture(t);
  const displaced = `${fixture.file}.displaced`;
  await assert.rejects(withPrivateOperationLock({
    file: fixture.file,
    context: { action: "run" },
    action: () => {
      const exactBytes = readFileSync(fixture.file, "utf8");
      renameSync(fixture.file, displaced);
      writeFileSync(fixture.file, exactBytes, { mode: 0o600 });
    },
    now: () => new Date(NOW),
    processIdentity: () => CURRENT_IDENTITY,
    processExists: () => true,
  }), /ownership changed before release/u);
  assert.deepEqual(readPrivateOperationLock(fixture.file), readPrivateOperationLock(displaced));
});

test("requires an absolute normalized path, object context, action, and current identity", async () => {
  await assert.rejects(withPrivateOperationLock({
    file: "relative.lock", context: {}, action: () => {},
  }), /absolute and normalized/u);
  await assert.rejects(withPrivateOperationLock({
    file: path.join(realpathSync(os.tmpdir()), "missing-context.lock"), context: null, action: () => {},
  }), /context must be an object/u);
  await assert.rejects(withPrivateOperationLock({
    file: path.join(realpathSync(os.tmpdir()), "missing-action.lock"), context: {}, action: null,
  }), /action is required/u);
  await assert.rejects(withPrivateOperationLock({
    file: path.join(realpathSync(os.tmpdir()), "missing-identity.lock"), context: {}, action: () => {},
    processIdentity: () => null,
  }), /cannot establish its process identity/u);
});

function lockFixture(t) {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "private-operation-lock-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, "operation.lock") };
}

function owner({
  pid = DEAD_PID,
  processIdentity = "dead-start",
  token = "dead-owner",
  context = { planDigest: "d".repeat(64) },
} = {}) {
  return {
    schema: SCHEMA,
    pid,
    processIdentity,
    token,
    acquiredAt: NOW,
    context,
    contextDigest: digestValue(context),
  };
}

function writeOwner(file, value) {
  writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function remainingCaptures(directory) {
  return readdirSync(directory).filter(name => name.includes(".stale.") || name.includes(".release."));
}
