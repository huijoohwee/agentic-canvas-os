import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  adoptLegacyDirtyLane,
  CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  captureLegacyDirtyLane,
  verifyLegacyRecoveryPackage,
} from "../scripts/legacy-dirty-lane-adoption-lib.mjs";

test("canonical retention captures only untracked bytes from exact fetched primary main", () => {
  const fixture = createCanonicalRetentionFixture();
  const before = status(fixture.source);
  const recovery = captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.protectedTip,
    operatorSessionId: "retention-session",
    captureProfile: CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  });

  assert.equal(status(fixture.source), before);
  assert.equal(recovery.captureProfile, CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE);
  assert.equal(recovery.sourceBranch, "main");
  assert.equal(recovery.tracked.length, 0);
  assert.equal(recovery.untracked.length, 1);
  assert.equal(readFileSync(path.join(fixture.recovery, "files/retained/doc.md"), "utf8"), "retain me\n");
});

test("canonical retention rejects tracked changes and cannot become an adoption package", () => {
  const tracked = createCanonicalRetentionFixture();
  writeFileSync(path.join(tracked.source, "tracked.txt"), "changed\n");
  assert.throws(() => captureLegacyDirtyLane({
    sourceWorktree: tracked.source,
    recoveryDirectory: tracked.recovery,
    protectedTipSha: tracked.protectedTip,
    operatorSessionId: "retention-session",
    captureProfile: CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  }), /rejects tracked or staged/);

  const retained = createCanonicalRetentionFixture();
  captureLegacyDirtyLane({
    sourceWorktree: retained.source,
    recoveryDirectory: retained.recovery,
    protectedTipSha: retained.protectedTip,
    operatorSessionId: "retention-session",
    captureProfile: CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  });
  assert.throws(() => adoptLegacyDirtyLane({
    sourceWorktree: retained.source,
    recoveryDirectory: retained.recovery,
    targetWorktree: retained.source,
    operatorSessionId: "retention-session",
    lease: null,
  }), /preservation-only/);
});

test("canonical retention rejects fetched protected movement", () => {
  const fixture = createCanonicalRetentionFixture();
  const writer = path.join(fixture.root, "writer");
  git(fixture.root, ["clone", "--branch", "main", fixture.remote, writer]);
  git(writer, ["config", "user.email", "writer@example.com"]);
  git(writer, ["config", "user.name", "Writer"]);
  writeFileSync(path.join(writer, "tracked.txt"), "advanced\n");
  git(writer, ["add", "tracked.txt"]);
  git(writer, ["commit", "-m", "advance"]);
  git(writer, ["push", "origin", "main"]);

  assert.throws(() => captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.protectedTip,
    operatorSessionId: "retention-session",
    captureProfile: CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  }), /fetched origin\/main/);
});

test("capture preserves exact dirty source evidence and verifies the recovery package", () => {
  const fixture = createFixture();
  const before = status(fixture.source);
  const recovery = captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.baseSha,
    operatorSessionId: "session-a",
    now: () => new Date("2026-08-01T00:00:00.000Z"),
  });

  assert.equal(status(fixture.source), before);
  assert.equal(recovery.tracked.length, 1);
  assert.equal(recovery.untracked.length, 1);
  assert.equal(readFileSync(path.join(fixture.recovery, "files/new.txt"), "utf8"), "untracked\n");
  assert.equal(verifyLegacyRecoveryPackage({ recoveryDirectory: fixture.recovery }).packageDigest, recovery.packageDigest);
});

test("verification rejects changed recovery bytes", () => {
  const fixture = createFixture();
  captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.baseSha,
    operatorSessionId: "session-a",
  });
  writeFileSync(path.join(fixture.recovery, "files/new.txt"), "tampered\n");
  assert.throws(
    () => verifyLegacyRecoveryPackage({ recoveryDirectory: fixture.recovery }),
    /recovery file changed/,
  );
});

test("adoption requires the exact active lease and imports the captured bytes", () => {
  const fixture = createFixture();
  captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.baseSha,
    operatorSessionId: "session-a",
  });
  const target = path.join(fixture.root, "target");
  git(fixture.repository, ["worktree", "add", "-b", "agent/test/target-adoption", target, fixture.baseSha]);
  const lease = {
    status: "active",
    sessionId: "session-a",
    branch: "agent/test/target-adoption",
    worktreePath: target,
    baseSha: fixture.baseSha,
    fenceSha: git(target, ["rev-parse", "HEAD"]).trim(),
  };

  const receipt = adoptLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    targetWorktree: target,
    operatorSessionId: "session-a",
    lease,
  });
  assert.equal(readFileSync(path.join(target, "tracked.txt"), "utf8"), "changed\n");
  assert.equal(readFileSync(path.join(target, "new.txt"), "utf8"), "untracked\n");
  assert.deepEqual(receipt.adoptedPaths, ["new.txt", "tracked.txt"]);
});

test("adoption blocks target collisions before applying the tracked patch", () => {
  const fixture = createFixture();
  captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.baseSha,
    operatorSessionId: "session-a",
  });
  const target = path.join(fixture.root, "collision-target");
  git(fixture.repository, ["worktree", "add", "-b", "agent/test/collision-adoption", target, fixture.baseSha]);
  writeFileSync(path.join(target, "new.txt"), "collision\n");
  const lease = {
    status: "active",
    sessionId: "session-a",
    branch: "agent/test/collision-adoption",
    worktreePath: target,
    baseSha: fixture.baseSha,
    fenceSha: git(target, ["rev-parse", "HEAD"]).trim(),
  };
  assert.throws(
    () => adoptLegacyDirtyLane({
      sourceWorktree: fixture.source,
      recoveryDirectory: fixture.recovery,
      targetWorktree: target,
      operatorSessionId: "session-a",
      lease,
    }),
    /target must be clean/,
  );
  assert.equal(readFileSync(path.join(target, "tracked.txt"), "utf8"), "base\n");
});

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "legacy-adoption-"));
  const repository = path.join(root, "repository");
  const source = path.join(root, "source");
  const recovery = path.join(root, "recovery");
  mkdirSync(repository);
  git(repository, ["init", "-b", "main"]);
  git(repository, ["config", "user.email", "test@example.com"]);
  git(repository, ["config", "user.name", "Test"]);
  writeFileSync(path.join(repository, "tracked.txt"), "base\n");
  git(repository, ["add", "tracked.txt"]);
  git(repository, ["commit", "-m", "base"]);
  const baseSha = git(repository, ["rev-parse", "HEAD"]).trim();
  git(repository, ["worktree", "add", "-b", "agent/test/legacy-payments", source, baseSha]);
  writeFileSync(path.join(source, "tracked.txt"), "changed\n");
  writeFileSync(path.join(source, "new.txt"), "untracked\n");
  return { root, repository, source, recovery, baseSha };
}

function createCanonicalRetentionFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "canonical-retention-"));
  const remote = path.join(root, "remote.git");
  const source = path.join(root, "source");
  const recovery = path.join(root, "recovery");
  git(root, ["init", "--bare", remote]);
  git(root, ["clone", remote, source]);
  git(source, ["config", "user.email", "test@example.com"]);
  git(source, ["config", "user.name", "Test"]);
  git(source, ["switch", "-c", "main"]);
  writeFileSync(path.join(source, "tracked.txt"), "base\n");
  git(source, ["add", "tracked.txt"]);
  git(source, ["commit", "-m", "base"]);
  git(source, ["push", "-u", "origin", "main"]);
  const protectedTip = git(source, ["rev-parse", "HEAD"]).trim();
  mkdirSync(path.join(source, "retained"));
  writeFileSync(path.join(source, "retained/doc.md"), "retain me\n");
  return { root, remote, source, recovery, protectedTip };
}

function status(worktree) {
  return git(worktree, ["status", "--porcelain=v1", "--untracked-files=all"]);
}

function git(worktree, args) {
  return execFileSync("git", args, { cwd: worktree, encoding: "utf8" });
}
