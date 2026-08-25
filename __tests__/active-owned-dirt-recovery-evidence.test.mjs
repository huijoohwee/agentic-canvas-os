import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  assertActiveOwnedDirtWithinWriteSet,
  captureActiveOwnedDirtEvidence,
  createActiveOwnedDirtSnapshot,
  normalizeActiveOwnedDirtEvidence,
  verifyActiveOwnedDirtSnapshot,
} from "../scripts/active-owned-dirt-recovery-evidence.mjs";

test("snapshot preserves staged, unstaged, untracked, deletion, executable, and symlink bytes", () => {
  const repository = mkdtempSync(path.join(os.tmpdir(), "active-owned-dirt-evidence-"));
  const git = (args, options = {}) => execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    ...options,
  }).trim();
  try {
    git(["init", "-q"]);
    git(["config", "user.name", "Test"]);
    git(["config", "user.email", "test@example.test"]);
    git(["config", "core.filemode", "true"]);
    writeFileSync(path.join(repository, "staged.txt"), "base\n");
    writeFileSync(path.join(repository, "mixed.txt"), "base\n");
    writeFileSync(path.join(repository, "deleted.txt"), "delete me\n");
    writeFileSync(path.join(repository, "mode.sh"), "#!/bin/sh\nexit 0\n");
    symlinkSync("staged.txt", path.join(repository, "link"));
    git(["add", "."]);
    git(["commit", "-qm", "base"]);

    writeFileSync(path.join(repository, "staged.txt"), "staged bytes\n");
    git(["add", "staged.txt"]);
    writeFileSync(path.join(repository, "mixed.txt"), "index bytes\n");
    git(["add", "mixed.txt"]);
    writeFileSync(path.join(repository, "mixed.txt"), "worktree bytes\n");
    unlinkSync(path.join(repository, "deleted.txt"));
    git(["add", "-u", "deleted.txt"]);
    chmodSync(path.join(repository, "mode.sh"), 0o755);
    unlinkSync(path.join(repository, "link"));
    symlinkSync("mixed.txt", path.join(repository, "link"));
    writeFileSync(path.join(repository, "new file.txt"), "untracked bytes\n");

    const before = {
      head: git(["rev-parse", "HEAD"]),
      index: git(["ls-files", "--stage", "-z"]),
      status: git(["status", "--porcelain=v2", "-z", "--untracked-files=all"]),
    };
    const evidence = captureActiveOwnedDirtEvidence({ repository });
    assert.equal(evidence.pathCount, 6);
    assert.equal(evidence.untrackedPathCount, 1);
    assert.equal(evidence.entries.find(entry => entry.path === "deleted.txt").worktreeType, "deleted");
    assert.equal(evidence.entries.find(entry => entry.path === "mode.sh").worktreeMode, "100755");
    assert.equal(evidence.entries.find(entry => entry.path === "link").worktreeType, "symlink");
    assertActiveOwnedDirtWithinWriteSet({
      evidence,
      declaredWriteSet: ["path:deleted.txt", "path:link", "path:mixed.txt", "path:mode.sh", "path:new file.txt", "path:staged.txt", "semantic:test"],
    });

    const snapshot = createActiveOwnedDirtSnapshot({
      repository,
      evidence,
      claimId: "a".repeat(64),
      planDigest: "b".repeat(64),
      timestamp: "2026-08-09T00:00:00.000Z",
    });
    assert.deepEqual(verifyActiveOwnedDirtSnapshot({ repository, snapshot }), snapshot);
    assert.deepEqual(createActiveOwnedDirtSnapshot({ repository, evidence,
      claimId: "a".repeat(64), planDigest: "b".repeat(64),
      timestamp: "2026-08-09T00:00:00.000Z" }), snapshot);
    assert.equal(git(["show", `${snapshot.commitSha}:new file.txt`]), "untracked bytes");
    assert.equal(git(["show", `${snapshot.commitSha}:mixed.txt`]), "worktree bytes");
    assert.equal(git(["show", `${snapshot.indexCommitSha}:mixed.txt`]), "index bytes");
    git(["gc", "--prune=now"]);
    assert.deepEqual(verifyActiveOwnedDirtSnapshot({ repository, snapshot }), snapshot);
    assert.equal(git(["cat-file", "-t", snapshot.indexCommitSha]), "commit");
    assert.equal(git(["show", `${snapshot.indexCommitSha}:mixed.txt`]), "index bytes");
    assert.equal(git(["rev-parse", "HEAD"]), before.head);
    assert.equal(git(["ls-files", "--stage", "-z"]), before.index);
    assert.equal(git(["status", "--porcelain=v2", "-z", "--untracked-files=all"]), before.status);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

for (const staged of [false, true]) {
  test(`snapshot preserves ${staged ? "a staged" : "an unstaged"} tracked deletion whose parent is absent`, () => {
    const repository = mkdtempSync(path.join(os.tmpdir(), "active-owned-dirt-missing-parent-"));
    const git = gitCommand(repository);
    try {
      git(["init", "-q"]);
      git(["config", "user.name", "Test"]);
      git(["config", "user.email", "test@example.test"]);
      mkdirSync(path.join(repository, "gone", "nested"), { recursive: true });
      writeFileSync(path.join(repository, "gone", "nested", "file.txt"), "base bytes\n");
      git(["add", "."]);
      git(["commit", "-qm", "base"]);
      rmSync(path.join(repository, "gone"), { recursive: true });
      if (staged) git(["add", "-u", "--", "gone/nested/file.txt"]);

      const before = { head: git(["rev-parse", "HEAD"]),
        index: git(["ls-files", "--stage", "-z"]),
        status: git(["status", "--porcelain=v2", "-z", "--untracked-files=all"]) };
      const evidence = captureActiveOwnedDirtEvidence({ repository });
      const entry = evidence.entries[0];
      assert.equal(evidence.pathCount, 1);
      assert.equal(entry.path, "gone/nested/file.txt");
      assert.equal(entry.staged, staged);
      assert.equal(entry.unstaged, !staged);
      assert.equal(entry.untracked, false);
      assert.equal(entry.headMode, "100644");
      assert.equal(entry.indexMode, staged ? null : "100644");
      assert.equal(entry.indexBlob, staged ? null : entry.headBlob);
      assert.equal(entry.worktreeType, "deleted");
      assert.equal(entry.worktreeMode, null);
      assert.equal(entry.worktreeBlob, null);

      const snapshot = createActiveOwnedDirtSnapshot({ repository, evidence,
        claimId: "c".repeat(64), planDigest: "d".repeat(64),
        timestamp: "2026-08-09T00:00:00.000Z" });
      assert.deepEqual(verifyActiveOwnedDirtSnapshot({ repository, snapshot }), snapshot);
      assert.equal(git(["show", "-s", "--format=%P", snapshot.indexCommitSha]),
        snapshot.headSha);
      assert.equal(git(["show", "-s", "--format=%P", snapshot.commitSha]),
        `${snapshot.headSha} ${snapshot.indexCommitSha}`);
      if (staged) assert.throws(() => git(["cat-file", "-e",
        `${snapshot.indexCommitSha}:gone/nested/file.txt`]));
      else assert.equal(git(["show", `${snapshot.indexCommitSha}:gone/nested/file.txt`]),
        "base bytes");
      assert.throws(() => git(["cat-file", "-e", `${snapshot.commitSha}:gone/nested/file.txt`]));
      assert.equal(git(["rev-parse", "HEAD"]), before.head);
      assert.equal(git(["ls-files", "--stage", "-z"]), before.index);
      assert.equal(git(["status", "--porcelain=v2", "-z", "--untracked-files=all"]), before.status);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
}

test("snapshot preflight rejects replacement of an absent ancestor before Git writes", () => {
  const fixture = dirtyRepository({ relativePath: "gone/nested/file.txt" });
  try {
    rmSync(path.join(fixture.repository, "gone"), { recursive: true });
    const evidence = captureActiveOwnedDirtEvidence({ repository: fixture.repository });
    for (const replacement of ["file", "symlink"]) {
      const ancestor = path.join(fixture.repository, "gone");
      if (replacement === "file") writeFileSync(ancestor, "replacement\n");
      else symlinkSync(fixture.repository, ancestor, "dir");
      let gitCalls = 0;
      assert.throws(() => createActiveOwnedDirtSnapshot({ repository: fixture.repository,
        evidence, claimId: "e".repeat(64), planDigest: "f".repeat(64),
        timestamp: "2026-08-09T00:00:00.000Z",
        git: () => { gitCalls += 1; } }), /symlink or non-directory ancestor/u);
      assert.equal(gitCalls, 0);
      rmSync(ancestor, { recursive: true, force: true });
    }
  } finally {
    fixture.cleanup();
  }
});

test("evidence rejects paths outside the admitted write set", () => {
  const core = {
    schema: "agentic-active-owned-dirt-evidence/v1",
    headSha: "a".repeat(40),
    entries: [{
      path: "outside.txt", staged: false, unstaged: false, untracked: true,
      headMode: null, headBlob: null, indexMode: null, indexBlob: null,
      worktreeType: "file", worktreeMode: "100644", worktreeBlob: "b".repeat(40),
    }],
    pathCount: 1,
    stagedPathCount: 0,
    unstagedPathCount: 0,
    untrackedPathCount: 1,
  };
  const evidence = { ...core, evidenceDigest: digestValue(core) };
  assert.throws(() => assertActiveOwnedDirtWithinWriteSet({
    evidence,
    declaredWriteSet: ["path:inside", "semantic:test"],
  }), /outside the admitted write set/);
});

test("capture and normalization share locale-independent UTF-8 path ordering", () => {
  const repository = mkdtempSync(path.join(os.tmpdir(), "active-owned-dirt-order-"));
  const git = gitCommand(repository);
  try {
    git(["init", "-q"]);
    git(["config", "user.name", "Test"]);
    git(["config", "user.email", "test@example.test"]);
    writeFileSync(path.join(repository, "anchor"), "anchor\n");
    git(["add", "anchor"]);
    git(["commit", "-qm", "base"]);
    const expected = ["z.txt", "\uE000.txt", "😀.txt"];
    for (const entryPath of [...expected].reverse()) {
      writeFileSync(path.join(repository, entryPath), `${entryPath}\n`);
    }
    const evidence = captureActiveOwnedDirtEvidence({ repository });
    assert.deepEqual(evidence.entries.map(entry => entry.path), expected);
    assert.deepEqual(normalizeActiveOwnedDirtEvidence({
      ...evidence, entries: [...evidence.entries].reverse(),
    }), evidence);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("snapshot rejects self-consistent receipts and refs around forged trees", () => {
  const fixture = dirtyRepository();
  const git = gitCommand(fixture.repository);
  try {
    const evidence = captureActiveOwnedDirtEvidence({ repository: fixture.repository });
    const snapshot = createActiveOwnedDirtSnapshot({ repository: fixture.repository, evidence,
      claimId: "1".repeat(64), planDigest: "2".repeat(64),
      timestamp: "2026-08-09T00:00:00.000Z" });
    const forgedIndexTree = addTreePath({ git, tree: snapshot.indexTreeSha,
      indexPath: path.join(fixture.repository, ".git", "forged-index"),
      entryPath: "forged-index.txt" });
    const forgedWorktreeTree = addTreePath({ git, tree: snapshot.worktreeTreeSha,
      indexPath: path.join(fixture.repository, ".git", "forged-worktree-index"),
      entryPath: "forged-worktree.txt" });
    const indexCore = { schema: "agentic-active-owned-dirt-index-snapshot/v1",
      planDigest: snapshot.planDigest, claimId: snapshot.claimId,
      headSha: snapshot.headSha, indexTreeSha: forgedIndexTree,
      evidenceDigest: evidence.evidenceDigest };
    const indexReceipt = { ...indexCore, indexReceiptDigest: digestValue(indexCore) };
    const indexCommitSha = git(["commit-tree", forgedIndexTree, "-p", snapshot.headSha], {
      input: `${indexCore.schema}\n\n${JSON.stringify(indexReceipt)}\n`,
    });
    const receiptCore = { schema: snapshot.schema, planDigest: snapshot.planDigest,
      claimId: snapshot.claimId, headSha: snapshot.headSha,
      indexTreeSha: forgedIndexTree, indexCommitSha,
      worktreeTreeSha: forgedWorktreeTree, evidence };
    const receipt = { ...receiptCore, snapshotReceiptDigest: digestValue(receiptCore) };
    const forged = { ...receipt, snapshotRef: snapshot.snapshotRef };
    forged.commitSha = git(["commit-tree", forgedWorktreeTree, "-p", snapshot.headSha,
      "-p", indexCommitSha], { input: `${forged.schema}\n\n${JSON.stringify(receipt)}\n` });
    git(["update-ref", snapshot.snapshotRef, forged.commitSha, snapshot.commitSha]);
    assert.throws(() => verifyActiveOwnedDirtSnapshot({
      repository: fixture.repository, snapshot: forged,
    }), /trees do not encode declared evidence/u);
  } finally {
    fixture.cleanup();
  }
});

test("snapshot rejects undecodable paths and oversized manifests before Git writes", () => {
  const invalidPath = evidenceFromEntries([deletedEntry("bad\uFFFDname")]);
  assert.throws(() => createActiveOwnedDirtSnapshot({
    repository: "/not-used", evidence: invalidPath,
    claimId: "a".repeat(64), planDigest: "b".repeat(64),
    timestamp: "2026-08-09T00:00:00.000Z", git: () => { throw new Error("Git ran"); },
  }), /literal path/);
  const oversized = evidenceFromEntries(Array.from({ length: 1_500 }, (_, index) =>
    deletedEntry(`oversized/${String(index).padStart(4, "0")}-${"x".repeat(96)}`)));
  let gitCalls = 0;
  assert.throws(() => createActiveOwnedDirtSnapshot({
    repository: "/not-used", evidence: oversized,
    claimId: "c".repeat(64), planDigest: "d".repeat(64),
    timestamp: "2026-08-09T00:00:00.000Z", git: () => { gitCalls += 1; },
  }), /exceeds 256 KiB/);
  assert.equal(gitCalls, 0);
});

test("evidence rejects symlink, non-directory, and symlinked-root ancestors", () => {
  for (const ancestorType of ["symlink", "file"]) {
    const fixture = dirtyRepository({ relativePath: "nested/file.txt" });
    const external = mkdtempSync(path.join(os.tmpdir(), "active-owned-dirt-external-"));
    try {
      writeFileSync(path.join(external, "file.txt"), "external bytes\n");
      rmSync(path.join(fixture.repository, "nested"), { recursive: true });
      if (ancestorType === "symlink") {
        symlinkSync(external, path.join(fixture.repository, "nested"), "dir");
      } else {
        writeFileSync(path.join(fixture.repository, "nested"), "not a directory\n");
      }
      assert.throws(() => captureActiveOwnedDirtEvidence({
        repository: fixture.repository,
        git: gitWithoutUntrackedEntries(fixture.repository),
      }), /symlink or non-directory ancestor/u);
    } finally {
      fixture.cleanup();
      rmSync(external, { recursive: true, force: true });
    }
  }

  const fixture = dirtyRepository();
  const aliasRoot = `${fixture.repository}-alias`;
  try {
    symlinkSync(fixture.repository, aliasRoot, "dir");
    assert.throws(() => captureActiveOwnedDirtEvidence({
      repository: aliasRoot,
    }), /symlink or non-directory ancestor/u);
  } finally {
    rmSync(aliasRoot, { force: true });
    fixture.cleanup();
  }
});

test("evidence fails closed when a regular file changes during its no-follow read", () => {
  const fixture = dirtyRepository();
  let raced = false;
  const git = gitCommand(fixture.repository, args => {
    if (!raced && isNoWriteHash(args)) {
      raced = true;
      writeFileSync(fixture.absolutePath, "raced bytes\n");
    }
  });
  try {
    assert.throws(() => captureActiveOwnedDirtEvidence({
      repository: fixture.repository,
      git,
    }), /changed during secure read/u);
    assert.equal(raced, true);
  } finally {
    fixture.cleanup();
  }
});

test("snapshot prehashes securely before object writes and writes nothing after observed drift", () => {
  const successful = dirtyRepository();
  try {
    const evidence = captureActiveOwnedDirtEvidence({ repository: successful.repository });
    const sequence = [];
    createActiveOwnedDirtSnapshot({
      repository: successful.repository,
      evidence,
      claimId: "c".repeat(64),
      planDigest: "d".repeat(64),
      timestamp: "2026-08-09T00:00:00.000Z",
      git: gitCommand(successful.repository, args => {
        if (isNoWriteHash(args)) sequence.push("prehash");
        if (isWriteHash(args)) sequence.push("write");
      }),
    });
    assert.deepEqual(sequence, ["prehash", "prehash", "write"]);
  } finally {
    successful.cleanup();
  }

  const raced = dirtyRepository();
  try {
    const evidence = captureActiveOwnedDirtEvidence({ repository: raced.repository });
    let writes = 0;
    let changed = false;
    const git = gitCommand(raced.repository, args => {
      if (!changed && isNoWriteHash(args)) {
        changed = true;
        writeFileSync(raced.absolutePath, "changed between prehash and write\n");
      }
      if (isWriteHash(args)) writes += 1;
    });
    assert.throws(() => createActiveOwnedDirtSnapshot({
      repository: raced.repository,
      evidence,
      claimId: "e".repeat(64),
      planDigest: "f".repeat(64),
      timestamp: "2026-08-09T00:00:00.000Z",
      git,
    }), /changed during secure read/u);
    assert.equal(changed, true);
    assert.equal(writes, 0);
  } finally {
    raced.cleanup();
  }
});

function dirtyRepository({ relativePath = "file.txt" } = {}) {
  const repository = mkdtempSync(path.join(os.tmpdir(), "active-owned-dirt-secure-"));
  const absolutePath = path.join(repository, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const git = gitCommand(repository);
  git(["init", "-q"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@example.test"]);
  writeFileSync(absolutePath, "base bytes\n");
  git(["add", "--", relativePath]);
  git(["commit", "-qm", "base"]);
  writeFileSync(absolutePath, "dirty bytes\n");
  return {
    repository,
    absolutePath,
    cleanup: () => rmSync(repository, { recursive: true, force: true }),
  };
}

function addTreePath({ git, tree, indexPath, entryPath }) {
  const env = { GIT_INDEX_FILE: indexPath };
  git(["read-tree", tree], { env });
  const blob = git(["hash-object", "-w", "--stdin"], { input: "forged bytes\n" });
  git(["update-index", "--add", "--cacheinfo", "100644", blob, entryPath], { env });
  return git(["write-tree"], { env });
}

function deletedEntry(entryPath) {
  return { path: entryPath, staged: true, unstaged: false, untracked: false,
    headMode: "100644", headBlob: "a".repeat(40), indexMode: null,
    indexBlob: null, worktreeType: "deleted", worktreeMode: null,
    worktreeBlob: null };
}

function evidenceFromEntries(entries) {
  const core = { schema: "agentic-active-owned-dirt-evidence/v1",
    headSha: "b".repeat(40), entries, pathCount: entries.length,
    stagedPathCount: entries.length, unstagedPathCount: 0, untrackedPathCount: 0 };
  return { ...core, evidenceDigest: digestValue(core) };
}

function gitCommand(repository, before = () => {}) {
  const invoke = (args, options = {}) => {
    before(args, options);
    const result = execFileSync("git", args, {
      cwd: repository,
      encoding: options.input === undefined ? "utf8" : undefined,
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
      env: { ...process.env, ...(options.env || {}) },
    });
    return Buffer.isBuffer(result) ? result.toString("utf8").trim() : String(result).trim();
  };
  invoke.optional = (args, options = {}) => {
    try {
      return invoke(args, options);
    } catch {
      return "";
    }
  };
  return invoke;
}

function gitWithoutUntrackedEntries(repository) {
  const base = gitCommand(repository);
  const invoke = (args, options = {}) => (
    args[0] === "ls-files" && args.includes("--others") ? "" : base(args, options)
  );
  invoke.optional = (args, options = {}) => {
    try {
      return invoke(args, options);
    } catch {
      return "";
    }
  };
  return invoke;
}

function isNoWriteHash(args) {
  return args[0] === "hash-object" && !args.includes("-w");
}

function isWriteHash(args) {
  return args[0] === "hash-object" && args.includes("-w");
}
