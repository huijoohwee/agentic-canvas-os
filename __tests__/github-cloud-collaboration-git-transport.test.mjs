import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createSmartGitLedgerCommit } from
  "../scripts/github-cloud-collaboration-git-transport.mjs";

test("smart Git ledger transport advances one exact parent by a normal push", async () => {
  const fixture = await createFixture();
  try {
    const content = "{\n  \"sequence\": 2\n}\n";
    const result = await createSmartGitLedgerCommit({
      ledgerRepository: "owner/ledger",
      ledgerRef: "agentic/collaboration-ledger",
      ledgerPath: ".agentic/collaboration-ledger.json",
      snapshot: { revision: fixture.initialRevision },
      content,
      action: "continue",
      repositoryUrl: fixture.remote,
    });
    assert.equal(git(fixture.remote, ["rev-parse", "refs/heads/agentic/collaboration-ledger"]), result.commitSha);
    assert.equal(git(fixture.remote, ["rev-parse", `${result.commitSha}^`]), fixture.initialRevision);
    assert.equal(git(fixture.remote, ["show", `${result.commitSha}:.agentic/collaboration-ledger.json`]), content.trim());
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("smart Git ledger transport rejects a stale exact parent before mutation", async () => {
  const fixture = await createFixture();
  try {
    await writeFile(path.join(fixture.source, ".agentic/collaboration-ledger.json"), "{\"sequence\":2}\n", "utf8");
    git(fixture.source, ["add", ".agentic/collaboration-ledger.json"]);
    git(fixture.source, ["commit", "-m", "advance fixture"]);
    git(fixture.source, ["push", "origin", "HEAD:refs/heads/agentic/collaboration-ledger"]);
    const advancedRevision = git(fixture.remote, ["rev-parse", "refs/heads/agentic/collaboration-ledger"]);
    await assert.rejects(createSmartGitLedgerCommit({
      ledgerRepository: "owner/ledger",
      ledgerRef: "agentic/collaboration-ledger",
      ledgerPath: ".agentic/collaboration-ledger.json",
      snapshot: { revision: fixture.initialRevision },
      content: "{\"sequence\":3}\n",
      action: "continue",
      repositoryUrl: fixture.remote,
    }), /changed before smart Git preparation/u);
    assert.equal(git(fixture.remote, ["rev-parse", "refs/heads/agentic/collaboration-ledger"]), advancedRevision);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agentic-ledger-transport-test-"));
  const remote = path.join(root, "remote.git");
  const source = path.join(root, "source");
  git(root, ["init", "--bare", remote]);
  git(root, ["init", source]);
  git(source, ["config", "user.name", "test"]);
  git(source, ["config", "user.email", "test@example.com"]);
  await mkdir(path.join(source, ".agentic"), { recursive: true });
  await writeFile(path.join(source, ".agentic/collaboration-ledger.json"), "{\"sequence\":1}\n", "utf8");
  git(source, ["add", ".agentic/collaboration-ledger.json"]);
  git(source, ["commit", "-m", "seed fixture"]);
  git(source, ["remote", "add", "origin", remote]);
  git(source, ["push", "origin", "HEAD:refs/heads/agentic/collaboration-ledger"]);
  return {
    root,
    remote,
    source,
    initialRevision: git(remote, ["rev-parse", "refs/heads/agentic/collaboration-ledger"]),
  };
}

function git(cwd, argumentsList) {
  return execFileSync("git", argumentsList, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
