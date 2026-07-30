import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { recoverCanonicalMain } from "../scripts/canonical-main-recovery-lib.mjs";
import { textCommandOptions } from "../scripts/command-text-options.mjs";

test("equivalence-proven recovery preserves every dirty class and replays exactly", () => {
  const fixture = createFixture({ equivalent: true });
  try {
    writeFileSync(path.join(fixture.canonical, "tracked.txt"), "unstaged\n");
    writeFileSync(path.join(fixture.canonical, "staged.txt"), "staged\n");
    git(fixture.canonical, ["add", "staged.txt"]);
    git(fixture.canonical, ["mv", "rename-me.txt", "renamed.txt"]);
    rmSync(path.join(fixture.canonical, "delete-me.txt"));
    writeFileSync(path.join(fixture.canonical, "untracked.sh"), "#!/bin/sh\nexit 0\n");
    chmodSync(path.join(fixture.canonical, "untracked.sh"), 0o755);
    symlinkSync("tracked.txt", path.join(fixture.canonical, "untracked-link"));
    writeFileSync(path.join(fixture.canonical, "ignored-private.txt"), "private local bytes\n");

    const first = recover(fixture);
    assert.equal(first.status, "completed");
    assert.equal(first.replayed, false);
    assert.equal(first.headSha, fixture.originHead);
    assert.equal(gitText(fixture.canonical, ["branch", "--show-current"]), "main");
    assert.equal(gitText(fixture.canonical, ["rev-parse", "HEAD"]), fixture.originHead);
    assert.equal(gitText(fixture.canonical, ["status", "--porcelain"]), "");
    assert.equal(gitText(fixture.canonical, ["rev-parse", first.preservedHeadRef]), fixture.localHead);
    assert.equal(gitText(fixture.canonical, ["rev-parse", first.stashRef]), first.stashSha);
    assert.equal(gitText(fixture.canonical, ["rev-parse", `${first.stashSha}^1`]), fixture.localHead);
    assert.match(
      gitText(fixture.canonical, ["log", "-1", "--pretty=%s", first.stashSha]),
      /^On main: recovery: canonical main recovery-/,
    );

    const journal = JSON.parse(readFileSync(first.receiptPath, "utf8"));
    assert.equal(journal.schema, "agentic-canonical-main-recovery/v1");
    assert.equal(journal.state, "completed");
    assert.equal(journal.manifestDigest, first.manifestDigest);
    assert.deepEqual(
      new Set(journal.manifest.map(entry => entry.status)),
      new Set([" M", "M ", "R ", " D", "??"]),
    );
    assert.equal(journal.manifest.some(entry =>
      entry.path === "untracked.sh" &&
      entry.worktree.mode === "100755" &&
      entry.worktree.kind === "file"), true);
    assert.equal(journal.manifest.some(entry =>
      entry.path === "untracked-link" &&
      entry.worktree.mode === "120000" &&
      entry.worktree.kind === "symlink"), true);
    assert.match(journal.stash.trees.worktree, /^[0-9a-f]{40}$/);
    assert.match(journal.stash.trees.index, /^[0-9a-f]{40}$/);
    assert.match(journal.stash.trees.untracked, /^[0-9a-f]{40}$/);
    assert.equal(first.ignoredDisposition, "retained-in-place");
    assert.equal(first.ignoredPathCount, 1);
    assert.match(first.ignoredPathsDigest, /^[0-9a-f]{64}$/);
    assert.equal(readFileSync(path.join(fixture.canonical, "ignored-private.txt"), "utf8"), "private local bytes\n");
    for (const receipt of [first.preparedReceipt, first.captureReceipt, first.completionReceipt]) {
      assert.equal(gitText(fixture.canonical, ["rev-parse", receipt.ref]), receipt.oid);
      assert.equal(gitText(fixture.canonical, ["cat-file", "-t", receipt.oid]), "blob");
    }

    const restore = path.join(fixture.root, "restore");
    git(fixture.canonical, ["worktree", "add", "--detach", restore, first.preservedHeadRef]);
    git(restore, ["stash", "apply", "--index", first.stashSha]);
    assert.equal(readFileSync(path.join(restore, "tracked.txt"), "utf8"), "unstaged\n");
    assert.equal(readFileSync(path.join(restore, "staged.txt"), "utf8"), "staged\n");
    assert.equal(readFileSync(path.join(restore, "untracked.sh"), "utf8"), "#!/bin/sh\nexit 0\n");
    assert.notEqual(lstatMode(path.join(restore, "untracked.sh")) & 0o111, 0);
    assert.equal(readFileSync(path.join(restore, "untracked-link"), "utf8"), "unstaged\n");

    const replay = recover(fixture);
    assert.equal(replay.replayed, true);
    assert.deepEqual(
      {
        recoveryId: replay.recoveryId,
        headSha: replay.headSha,
        stashRef: replay.stashRef,
        stashSha: replay.stashSha,
        manifestDigest: replay.manifestDigest,
        preparedReceipt: replay.preparedReceipt,
        captureReceipt: replay.captureReceipt,
        completionReceipt: replay.completionReceipt,
      },
      {
        recoveryId: first.recoveryId,
        headSha: first.headSha,
        stashRef: first.stashRef,
        stashSha: first.stashSha,
        manifestDigest: first.manifestDigest,
        preparedReceipt: first.preparedReceipt,
        captureReceipt: first.captureReceipt,
        completionReceipt: first.completionReceipt,
      },
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("lost detach response resumes from exact detached target without another stash", () => {
  const fixture = createFixture({ equivalent: true });
  try {
    writeFileSync(path.join(fixture.canonical, "tracked.txt"), "recover me\n");
    let interrupt = true;
    const context = recoveryContext(fixture);
    const baseRun = context.run;
    context.run = (command, args) => {
      baseRun(command, args);
      if (interrupt && command === "git" && args[0] === "switch" && args.includes("--detach")) {
        interrupt = false;
        throw new Error("lost detach response");
      }
    };
    assert.throws(() => recoverCanonicalMain(context), /lost detach response/);
    assert.equal(gitText(fixture.canonical, ["branch", "--show-current"]), "");
    assert.equal(gitText(fixture.canonical, ["rev-parse", "HEAD"]), fixture.originHead);
    assert.equal(gitText(fixture.canonical, ["rev-parse", "refs/heads/main"]), fixture.localHead);
    const stashBefore = readLines(gitText(fixture.canonical, ["stash", "list", "--format=%H"]));
    assert.equal(stashBefore.length, 1);

    const replay = recover(fixture);
    assert.equal(replay.status, "completed");
    assert.equal(gitText(fixture.canonical, ["rev-parse", "HEAD"]), fixture.originHead);
    assert.deepEqual(readLines(gitText(fixture.canonical, ["stash", "list", "--format=%H"])), stashBefore);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("lost stash response resolves and pins the one exact captured object on replay", () => {
  const fixture = createFixture({ equivalent: true });
  try {
    writeFileSync(path.join(fixture.canonical, "tracked.txt"), "recover exact stash\n");
    let interrupt = true;
    const context = recoveryContext(fixture);
    const baseRun = context.run;
    context.run = (command, args) => {
      baseRun(command, args);
      if (interrupt && command === "git" && args[0] === "stash" && args[1] === "push") {
        interrupt = false;
        throw new Error("lost stash response");
      }
    };
    assert.throws(() => recoverCanonicalMain(context), /lost stash response/);
    assert.equal(gitText(fixture.canonical, ["status", "--porcelain"]), "");
    const stashSha = gitText(fixture.canonical, ["rev-parse", "refs/stash"]);

    const replay = recover(fixture);
    assert.equal(replay.status, "completed");
    assert.equal(replay.stashSha, stashSha);
    assert.equal(gitText(fixture.canonical, ["rev-parse", replay.stashRef]), stashSha);
    assert.deepEqual(readLines(gitText(fixture.canonical, ["stash", "list", "--format=%H"])), [stashSha]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("new dirt after a prepared receipt blocks replay instead of widening capture", () => {
  const fixture = createFixture({ equivalent: true });
  try {
    writeFileSync(path.join(fixture.canonical, "tracked.txt"), "prepared state\n");
    let interrupt = true;
    const context = recoveryContext(fixture);
    const baseRun = context.run;
    context.run = (command, args) => {
      baseRun(command, args);
      if (interrupt && command === "git" && args[0] === "update-ref" && args[1].endsWith("/prepared")) {
        interrupt = false;
        throw new Error("lost prepared receipt response");
      }
    };
    assert.throws(() => recoverCanonicalMain(context), /lost prepared receipt response/);
    writeFileSync(path.join(fixture.canonical, "tracked.txt"), "new unapproved state\n");
    assert.throws(() => recover(fixture), /Working state changed after the prepared canonical recovery receipt/);
    assert.equal(gitText(fixture.canonical, ["rev-parse", "HEAD"]), fixture.localHead);
    assert.equal(gitText(fixture.canonical, ["stash", "list", "--format=%H"]), "");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("case-folded ignored bytes that collide with the protected target block before preservation", () => {
  const fixture = createFixture({ equivalent: true });
  try {
    git(fixture.canonical, ["config", "core.ignorecase", "true"]);
    writeFileSync(path.join(fixture.canonical, "ignored-private.txt"), "private local bytes\n");
    writeFileSync(path.join(fixture.publisher, "IGNORED-PRIVATE.TXT"), "protected bytes\n");
    git(fixture.publisher, ["add", "-f", "IGNORED-PRIVATE.TXT"]);
    git(fixture.publisher, ["commit", "-m", "protect formerly ignored path"]);
    git(fixture.publisher, ["push", "origin", "main"]);
    fixture.originHead = gitText(fixture.publisher, ["rev-parse", "HEAD"]);

    assert.throws(() => recover(fixture), /Ignored local state collides with protected target paths/);
    assert.equal(readFileSync(path.join(fixture.canonical, "ignored-private.txt"), "utf8"), "private local bytes\n");
    assert.equal(gitText(fixture.canonical, ["rev-parse", "HEAD"]), fixture.localHead);
    assert.equal(gitText(fixture.canonical, ["stash", "list", "--format=%H"]), "");
    assert.equal(
      gitText(fixture.canonical, [
        "for-each-ref",
        "--format=%(refname)",
        "refs/agentic-canvas-os/recovery/canonical-main/",
      ]),
      "",
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("expanded Unicode case-fold aliases collide before preservation", () => {
  const fixture = createFixture({ equivalent: true });
  try {
    git(fixture.canonical, ["config", "core.ignorecase", "true"]);
    writeFileSync(path.join(fixture.canonical, "ignored-straße.txt"), "private local bytes\n");
    writeFileSync(path.join(fixture.publisher, "IGNORED-STRASSE.TXT"), "protected bytes\n");
    git(fixture.publisher, ["add", "-f", "IGNORED-STRASSE.TXT"]);
    git(fixture.publisher, ["commit", "-m", "protect Unicode case-fold alias"]);
    git(fixture.publisher, ["push", "origin", "main"]);
    fixture.originHead = gitText(fixture.publisher, ["rev-parse", "HEAD"]);

    assert.throws(() => recover(fixture), /Ignored local state collides with protected target paths/);
    assert.equal(
      readFileSync(path.join(fixture.canonical, "ignored-straße.txt"), "utf8"),
      "private local bytes\n",
    );
    assert.equal(gitText(fixture.canonical, ["rev-parse", "HEAD"]), fixture.localHead);
    assert.equal(gitText(fixture.canonical, ["stash", "list", "--format=%H"]), "");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("case-folded protected ancestor of an ignored path blocks before preservation", () => {
  const fixture = createFixture({ equivalent: true });
  try {
    git(fixture.canonical, ["config", "core.ignorecase", "true"]);
    mkdirSync(path.join(fixture.canonical, "ignored-dir"));
    writeFileSync(path.join(fixture.canonical, "ignored-dir", "private.txt"), "private local bytes\n");
    writeFileSync(path.join(fixture.publisher, "IGNORED-DIR"), "protected ancestor bytes\n");
    git(fixture.publisher, ["add", "-f", "IGNORED-DIR"]);
    git(fixture.publisher, ["commit", "-m", "protect formerly ignored ancestor"]);
    git(fixture.publisher, ["push", "origin", "main"]);
    fixture.originHead = gitText(fixture.publisher, ["rev-parse", "HEAD"]);

    assert.throws(() => recover(fixture), /Ignored local state collides with protected target paths/);
    assert.equal(
      readFileSync(path.join(fixture.canonical, "ignored-dir", "private.txt"), "utf8"),
      "private local bytes\n",
    );
    assert.equal(gitText(fixture.canonical, ["rev-parse", "HEAD"]), fixture.localHead);
    assert.equal(gitText(fixture.canonical, ["stash", "list", "--format=%H"]), "");
    assert.equal(
      gitText(fixture.canonical, [
        "for-each-ref",
        "--format=%(refname)",
        "refs/agentic-canvas-os/recovery/canonical-main/",
      ]),
      "",
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ignored bytes block when protected history changes their ignore rules", () => {
  const fixture = createFixture({ equivalent: true });
  try {
    writeFileSync(path.join(fixture.canonical, "ignored-private.txt"), "private local bytes\n");
    writeFileSync(path.join(fixture.publisher, ".gitignore"), "other*.txt\n");
    git(fixture.publisher, ["add", ".gitignore"]);
    git(fixture.publisher, ["commit", "-m", "change protected ignore rules"]);
    git(fixture.publisher, ["push", "origin", "main"]);
    fixture.originHead = gitText(fixture.publisher, ["rev-parse", "HEAD"]);

    assert.throws(() => recover(fixture), /protected history changes ignore rules/);
    assert.equal(readFileSync(path.join(fixture.canonical, "ignored-private.txt"), "utf8"), "private local bytes\n");
    assert.equal(gitText(fixture.canonical, ["rev-parse", "HEAD"]), fixture.localHead);
    assert.equal(gitText(fixture.canonical, ["stash", "list", "--format=%H"]), "");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ignored state added during receipt capture blocks before detach", () => {
  const fixture = createFixture({ equivalent: true });
  try {
    let injectIgnoredState = true;
    const context = recoveryContext(fixture);
    const baseRun = context.run;
    context.run = (command, args) => {
      baseRun(command, args);
      if (injectIgnoredState &&
          command === "git" &&
          args[0] === "update-ref" &&
          args[1].endsWith("/capture")) {
        injectIgnoredState = false;
        writeFileSync(path.join(fixture.canonical, "ignored-late.txt"), "late local bytes\n");
      }
    };

    assert.throws(
      () => recoverCanonicalMain(context),
      /Ignored local state changed after the prepared canonical recovery receipt/,
    );
    assert.equal(gitText(fixture.canonical, ["branch", "--show-current"]), "main");
    assert.equal(gitText(fixture.canonical, ["rev-parse", "HEAD"]), fixture.localHead);
    assert.equal(readFileSync(path.join(fixture.canonical, "ignored-late.txt"), "utf8"), "late local bytes\n");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("switch atomically refuses an ignored target collision introduced after the final proof", () => {
  const fixture = createFixture({ equivalent: true });
  try {
    writeFileSync(path.join(fixture.publisher, "ignored-late.txt"), "protected bytes\n");
    git(fixture.publisher, ["add", "-f", "ignored-late.txt"]);
    git(fixture.publisher, ["commit", "-m", "protect late ignored path"]);
    git(fixture.publisher, ["push", "origin", "main"]);
    fixture.originHead = gitText(fixture.publisher, ["rev-parse", "HEAD"]);

    let injectCollision = true;
    const context = recoveryContext(fixture);
    const baseRun = context.run;
    context.run = (command, args) => {
      if (injectCollision &&
          command === "git" &&
          args[0] === "switch" &&
          args.includes("--detach")) {
        injectCollision = false;
        writeFileSync(path.join(fixture.canonical, "ignored-late.txt"), "late local bytes\n");
      }
      baseRun(command, args);
    };

    assert.throws(() => recoverCanonicalMain(context));
    assert.equal(gitText(fixture.canonical, ["branch", "--show-current"]), "main");
    assert.equal(gitText(fixture.canonical, ["rev-parse", "HEAD"]), fixture.localHead);
    assert.equal(readFileSync(path.join(fixture.canonical, "ignored-late.txt"), "utf8"), "late local bytes\n");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("non-equivalent local-only commits fail before preservation or worktree mutation", () => {
  const fixture = createFixture({ equivalent: false });
  try {
    writeFileSync(path.join(fixture.canonical, "tracked.txt"), "must remain\n");
    const beforeStatus = gitText(fixture.canonical, ["status", "--porcelain=v1"]);
    assert.throws(() => recover(fixture), /not patch-equivalent/);
    assert.equal(gitText(fixture.canonical, ["rev-parse", "HEAD"]), fixture.localHead);
    assert.equal(gitText(fixture.canonical, ["status", "--porcelain=v1"]), beforeStatus);
    assert.equal(
      gitText(fixture.canonical, [
        "for-each-ref",
        "--format=%(refname)",
        "refs/agentic-canvas-os/recovery/canonical-main/",
      ]),
      "",
    );
    assert.equal(gitText(fixture.canonical, ["stash", "list", "--format=%H"]), "");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("explicit authority and primary-worktree restrictions fail before fetch or preservation", () => {
  const fixture = createFixture({ equivalent: true });
  try {
    let mutations = 0;
    const context = recoveryContext(fixture);
    context.acknowledged = false;
    context.run = () => { mutations += 1; };
    assert.throws(() => recoverCanonicalMain(context), /--acknowledge-equivalent-realignment/);
    assert.equal(mutations, 0);

    git(fixture.canonical, ["switch", "--detach", fixture.localHead]);
    const linked = path.join(fixture.root, "linked-main");
    git(fixture.canonical, ["worktree", "add", linked, "main"]);
    const linkedContext = recoveryContext({ ...fixture, canonical: linked });
    assert.throws(() => recoverCanonicalMain(linkedContext), /primary registered worktree/);
    assert.equal(gitText(linked, ["rev-parse", "HEAD"]), fixture.localHead);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("completed journal tampering blocks replay while preserved refs remain intact", () => {
  const fixture = createFixture({ equivalent: true });
  try {
    writeFileSync(path.join(fixture.canonical, "tracked.txt"), "captured\n");
    const result = recover(fixture);
    const journal = JSON.parse(readFileSync(result.receiptPath, "utf8"));
    journal.manifestDigest = "0".repeat(64);
    writeFileSync(result.receiptPath, `${JSON.stringify(journal)}\n`);
    assert.throws(() => recover(fixture), /journal digest is invalid/);
    assert.equal(gitText(fixture.canonical, ["rev-parse", result.preservedHeadRef]), fixture.localHead);
    assert.equal(gitText(fixture.canonical, ["rev-parse", result.stashRef]), result.stashSha);
    assert.equal(gitText(fixture.canonical, ["rev-parse", "HEAD"]), fixture.originHead);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function recover(fixture) {
  return recoverCanonicalMain(recoveryContext(fixture));
}

function recoveryContext(fixture) {
  return {
    acknowledged: true,
    invocationPath: fixture.canonical,
    repo: fixture.canonical,
    sessionId: "session-canonical-main-recovery",
    expectedLocalHead: fixture.localHead,
    expectedOriginHead: fixture.originHead,
    gitText: args => gitText(fixture.canonical, args, false),
    gitOptional: args => gitOptional(fixture.canonical, args),
    gitSucceeds: args => gitSucceeds(fixture.canonical, args),
    gitPatchId: commit => gitPatchId(fixture.canonical, commit),
    gitHashObject: payload => gitHashObject(fixture.canonical, payload),
    run: (command, args) => {
      if (command !== "git") throw new Error(`Unexpected recovery command ${command}.`);
      git(fixture.canonical, args);
    },
    log: () => {},
    now: () => new Date("2026-07-30T00:00:00.000Z"),
  };
}

function createFixture({ equivalent }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "acos-canonical-recovery-"));
  const remote = path.join(root, "remote.git");
  const canonical = path.join(root, "canonical");
  const publisher = path.join(root, "publisher");
  git(root, ["init", "--bare", remote]);
  git(root, ["clone", remote, canonical]);
  configureIdentity(canonical);
  for (const [name, contents] of [
    ["tracked.txt", "base\n"],
    ["staged.txt", "base staged\n"],
    ["rename-me.txt", "rename base\n"],
    ["delete-me.txt", "delete base\n"],
    [".gitignore", "ignored*.txt\nignored-dir/\n"],
  ]) {
    writeFileSync(path.join(canonical, name), contents);
  }
  git(canonical, ["add", "."]);
  git(canonical, ["commit", "-m", "base"]);
  git(canonical, ["branch", "-M", "main"]);
  git(canonical, ["push", "-u", "origin", "main"]);
  const base = gitText(canonical, ["rev-parse", "HEAD"]);

  writeFileSync(path.join(canonical, "equivalent.txt"), "same protected change\n");
  git(canonical, ["add", "equivalent.txt"]);
  git(canonical, ["commit", "-m", "local canonical cleanup"]);
  const localHead = gitText(canonical, ["rev-parse", "HEAD"]);

  git(root, ["clone", "--branch", "main", remote, publisher]);
  configureIdentity(publisher);
  if (equivalent) {
    writeFileSync(path.join(publisher, "equivalent.txt"), "same protected change\n");
  } else {
    writeFileSync(path.join(publisher, "different.txt"), "different protected change\n");
  }
  git(publisher, ["add", "."]);
  git(publisher, ["commit", "-m", equivalent ? "squash-equivalent protected change" : "unrelated protected change"]);
  git(publisher, ["push", "origin", "main"]);
  const originHead = gitText(publisher, ["rev-parse", "HEAD"]);
  assert.notEqual(localHead, originHead);

  return { root, remote, canonical, publisher, base, localHead, originHead };
}

function configureIdentity(repo) {
  git(repo, ["config", "user.name", "ACOS Recovery Test"]);
  git(repo, ["config", "user.email", "recovery@example.test"]);
}

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function gitText(cwd, args, trim = true) {
  const output = execFileSync("git", args, textCommandOptions({ cwd }));
  return trim ? output.trim() : output;
}

function gitOptional(cwd, args) {
  const result = spawnSync("git", args, textCommandOptions({ cwd }));
  return result.status === 0 ? result.stdout : "";
}

function gitSucceeds(cwd, args) {
  return spawnSync("git", args, { cwd, stdio: "ignore" }).status === 0;
}

function gitPatchId(cwd, commit) {
  const patch = execFileSync(
    "git",
    ["show", "--pretty=medium", "--binary", "--full-index", "--no-ext-diff", commit],
    textCommandOptions({ cwd }),
  );
  return execFileSync(
    "git",
    ["patch-id", "--stable"],
    textCommandOptions({ cwd, input: patch }),
  ).trim();
}

function gitHashObject(cwd, payload) {
  return execFileSync(
    "git",
    ["hash-object", "-w", "--stdin"],
    textCommandOptions({ cwd, input: payload }),
  ).trim();
}

function readLines(value) {
  return String(value || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function lstatMode(filePath) {
  return lstatSync(filePath).mode;
}
