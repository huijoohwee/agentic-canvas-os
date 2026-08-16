import assert from "node:assert/strict";
import test from "node:test";

import { readGitHubLedger } from "../scripts/expired-committed-heartbeat-replay-evidence.mjs";

const SHA = char => char.repeat(40);
const LEDGER = {
  schema: "agentic-cloud-collaboration-ledger/v1",
  ledgerRepositoryId: "github-repository:ledger",
  entries: [],
  headDigest: "0".repeat(64),
};

test("replay ledger reader resolves Git tree/blob bytes without contents transport", () => {
  const calls = [];
  const encoded = Buffer.from(JSON.stringify(LEDGER), "utf8").toString("base64");
  const execFile = (command, args) => {
    assert.equal(command, "gh");
    const path = args.at(1);
    calls.push(path);
    if (path.includes("/contents/")) throw new Error("contents transport must not be used");
    if (path.endsWith("/git/ref/heads/agentic%2Fcollaboration-ledger")) {
      return JSON.stringify({ object: { sha: SHA("1") } });
    }
    if (path.endsWith(`/git/commits/${SHA("1")}`)) {
      return JSON.stringify({ tree: { sha: SHA("2") } });
    }
    if (path.endsWith(`/git/trees/${SHA("2")}`)) {
      return JSON.stringify({ tree: [{ path: ".agentic", type: "tree", sha: SHA("3") }] });
    }
    if (path.endsWith(`/git/trees/${SHA("3")}`)) {
      return JSON.stringify({ tree: [{ path: "collaboration-ledger.json", type: "blob", sha: SHA("4") }] });
    }
    if (path.endsWith(`/git/blobs/${SHA("4")}`)) {
      return JSON.stringify({ encoding: "base64", content: encoded });
    }
    throw new Error(`unexpected gh path ${path}`);
  };

  const snapshot = readGitHubLedger({
    repository: "owner/repo",
    environment: {},
    execFile,
  });

  assert.equal(snapshot.revision, SHA("1"));
  assert.deepEqual(snapshot.ledger, LEDGER);
  assert.ok(calls.some(path => path.includes(`/git/trees/${SHA("2")}`)));
  assert.ok(calls.some(path => path.includes(`/git/blobs/${SHA("4")}`)));
});
