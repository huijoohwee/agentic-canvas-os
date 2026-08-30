import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { updateReanchorPullRequestBodyConditionally }
  from "../scripts/active-owned-dirt-current-base-reanchor-repository-adapter.mjs";
import { runActiveOwnedDirtCurrentBaseReanchorGitHubCli }
  from "../scripts/active-owned-dirt-current-base-reanchor-github.mjs";
import { digestValue }
  from "../scripts/cloud-collaboration-primitives.mjs";
import { createGitHubCooperativePullBodyProjectionPort }
  from "../scripts/github-cooperative-pull-body-projection.mjs";
import { createPrivateBodyFile }
  from "../scripts/github-cooperative-pull-body-projection.mjs";

const TARGET = "acme/example";
const NUMBER = 818;
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

function pull(body = "source body", overrides = {}) {
  return JSON.stringify({
    id: "PR_node",
    number: NUMBER,
    url: `https://github.com/${TARGET}/pull/${NUMBER}`,
    state: "OPEN",
    isDraft: true,
    headRefName: "agent/device/scope",
    headRefOid: HEAD,
    headRepository: { nameWithOwner: TARGET },
    baseRefName: "main",
    baseRefOid: BASE,
    body,
    ...overrides,
  });
}

function fixture(outputs, options = {}) {
  const calls = [];
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "cooperative-pull-test-"));
  const execute = (command, args) => {
    calls.push({ command, args: [...args] });
    const next = outputs.shift();
    if (next instanceof Error) throw next;
    assert.notEqual(next, undefined, "unexpected provider command");
    return next;
  };
  const port = createGitHubCooperativePullBodyProjectionPort({
    repository: "/workspace/repository",
    execute,
    temporaryRoot,
    bodyFileSystem: options.bodyFileSystem,
  });
  return {
    calls,
    port,
    temporaryRoot,
    cleanup() { rmSync(temporaryRoot, { recursive: true, force: true }); },
  };
}

test("stable cooperative projection performs one exact body edit and readback", () => {
  const value = fixture([
    pull(), pull(),
    pull(), pull(),
    "",
    pull("target body"), pull("target body"),
  ]);
  try {
    const before = value.port.readConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
    });
    const { etag, ...snapshot } = before;
    assert.equal(etag, `"agentic-snapshot-sha256:${digestValue({
      schema: "agentic-github-cooperative-pull-snapshot/v1",
      snapshot,
    })}"`);
    const result = value.port.patchConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
      expectedEtag: before.etag,
      body: "target body",
    });
    const edits = value.calls.filter(call => call.args[0] === "pr" && call.args[1] === "edit");
    assert.equal(edits.length, 1);
    assert.deepEqual(edits[0].args.slice(0, 6), [
      "pr", "edit", String(NUMBER), "--repo", TARGET, "--body-file",
    ]);
    assert.ok(!value.calls.flatMap(call => call.args).some(argument => (
      argument === "api" || argument.includes("If-Match")
    )));
    assert.equal(result.providerAtomicCompareAndSwap, false);
    assert.equal(result.cooperativeWriterFenceRequired, true);
    assert.equal(readdirSync(value.temporaryRoot).length, 0);
  } finally {
    value.cleanup();
  }
});

test("stable-read drift blocks before provider mutation", () => {
  const value = fixture([pull(), pull(), pull(), pull("foreign edit")]);
  try {
    const before = value.port.readConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
    });
    assert.throws(() => value.port.patchConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
      expectedEtag: before.etag,
      body: "target body",
    }), /stable cooperative pull-request snapshot/u);
    assert.ok(!value.calls.some(call => call.args[1] === "edit"));
  } finally {
    value.cleanup();
  }
});

test("foreign, stale, and malformed subjects never edit", () => {
  const stale = fixture([pull(), pull()]);
  try {
    stale.port.readConditionalPull({ targetRepository: TARGET, pullRequestNumber: NUMBER });
    assert.throws(() => stale.port.patchConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
      expectedEtag: '"agentic-snapshot-sha256:' + "0".repeat(64) + '"',
      body: "target body",
    }), /armed cooperative pull snapshot token/u);
    assert.equal(stale.calls.length, 2);
  } finally {
    stale.cleanup();
  }

  for (const output of [
    pull("source", { number: 819 }),
    pull("source", { headRepository: { nameWithOwner: "fork/example" } }),
    pull("source", { baseRefName: "release" }),
    "{",
  ]) {
    const value = fixture([output, output]);
    try {
      assert.throws(() => value.port.readConditionalPull({
        targetRepository: TARGET,
        pullRequestNumber: NUMBER,
      }), /Invalid/u);
      assert.ok(!value.calls.some(call => call.args[1] === "edit"));
    } finally {
      value.cleanup();
    }
  }
});

test("same-SHA main retarget blocks before provider mutation", () => {
  const value = fixture([
    pull(), pull(),
    pull("source body", { baseRefName: "release" }),
    pull("source body", { baseRefName: "release" }),
  ]);
  try {
    const before = value.port.readConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
    });
    assert.equal(before.baseBranch, "main");
    assert.equal(before.baseSha, BASE);
    assert.throws(() => value.port.patchConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
      expectedEtag: before.etag,
      body: "target body",
    }), /exact same-repository pull-request subject/u);
    assert.ok(!value.calls.some(call => call.args[1] === "edit"));
  } finally {
    value.cleanup();
  }
});

test("same-SHA main retarget after provider edit fails exact readback", () => {
  const value = fixture([
    pull(), pull(), pull(), pull(), "",
    pull("target body", { baseRefName: "release" }),
  ]);
  try {
    const before = value.port.readConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
    });
    assert.throws(() => value.port.patchConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
      expectedEtag: before.etag,
      body: "target body",
    }), /exact same-repository pull-request subject/u);
    assert.equal(value.calls.filter(call => call.args[1] === "edit").length, 1);
  } finally {
    value.cleanup();
  }
});

test("provider failure is attempted once and private body bytes are removed", () => {
  const value = fixture([pull(), pull(), pull(), pull(), new Error("provider unavailable")]);
  try {
    const before = value.port.readConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
    });
    assert.throws(() => value.port.patchConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
      expectedEtag: before.etag,
      body: "target body",
    }), /provider unavailable/u);
    assert.equal(value.calls.filter(call => call.args[1] === "edit").length, 1);
    assert.equal(readdirSync(value.temporaryRoot).length, 0);
  } finally {
    value.cleanup();
  }
});

test("existing reanchor adapter composes through the cooperative port", () => {
  const value = fixture([
    pull(), pull(),
    pull(), pull(),
    "",
    pull("target body"), pull("target body"),
    pull("target body"), pull("target body"),
  ]);
  try {
    const receipt = updateReanchorPullRequestBodyConditionally({
      read: () => value.port.readConditionalPull({
        targetRepository: TARGET,
        pullRequestNumber: NUMBER,
      }),
      patch: input => value.port.patchConditionalPull({
        targetRepository: TARGET,
        pullRequestNumber: NUMBER,
        ...input,
      }),
      expected: {
        id: "PR_node",
        number: NUMBER,
        url: `https://github.com/${TARGET}/pull/${NUMBER}`,
        state: "OPEN",
        isDraft: true,
        headBranch: "agent/device/scope",
        headSha: HEAD,
        headRepository: TARGET,
        baseSha: BASE,
        body: "source body",
      },
      body: "target body",
    });
    assert.match(receipt.beforeEtag, /^"agentic-snapshot-sha256:/u);
    assert.equal(value.calls.filter(call => call.args[1] === "edit").length, 1);
  } finally {
    value.cleanup();
  }
});

test("GitHub wrapper preserves argv and owns only the injected projection port", async () => {
  const calls = [];
  const createPullBodyPort = () => ({
    readConditionalPull() {},
    patchConditionalPull() {},
  });
  const result = await runActiveOwnedDirtCurrentBaseReanchorGitHubCli(
    ["run", "--json"],
    {
      createPullBodyPort,
      reanchorDependencies: { sentinel: true },
      runReanchorCli: async (argv, dependencies) => {
        calls.push({ argv, dependencies });
        return { ok: true };
      },
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls[0].argv, ["run", "--json"]);
  assert.equal(calls[0].dependencies.sentinel, true);
  assert.equal(calls[0].dependencies.createConditionalPullBodyPort, createPullBodyPort);

  await assert.rejects(() => runActiveOwnedDirtCurrentBaseReanchorGitHubCli([], {
    runReanchorCli: async () => assert.fail("conflict must block first"),
    reanchorDependencies: { createConditionalPullBodyPort() {} },
  }), /wrapper owns/u);
});

test("temporary body path is absent after a successful projection", () => {
  const value = fixture([
    pull(), pull(), pull(), pull(), "", pull("target"), pull("target"),
  ]);
  try {
    const before = value.port.readConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
    });
    value.port.patchConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
      expectedEtag: before.etag,
      body: "target",
    });
    const bodyPath = value.calls.find(call => call.args[1] === "edit")?.args.at(-1);
    assert.equal(existsSync(bodyPath), false);
  } finally {
    value.cleanup();
  }
});

test("private body creation is owner-only, idempotently removed, and cleans failures", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "private-pull-body-test-"));
  try {
    const temporary = createPrivateBodyFile(temporaryRoot, "private body");
    assert.equal(statSync(path.dirname(temporary.file)).mode & 0o777, 0o700);
    assert.equal(statSync(temporary.file).mode & 0o777, 0o600);
    temporary.remove();
    temporary.remove();
    assert.equal(readdirSync(temporaryRoot).length, 0);

    for (const operation of [
      "chmodSync", "openSync", "writeFileSync", "fsyncSync", "readFileSync",
    ]) {
      const primary = new Error(`injected ${operation} failure`);
      assert.throws(() => createPrivateBodyFile(temporaryRoot, "private body", {
        [operation]() { throw primary; },
      }), error => error === primary);
      assert.equal(readdirSync(temporaryRoot).length, 0);
    }

    assert.throws(() => createPrivateBodyFile(temporaryRoot, "private body", {
      readFileSync() { return "different bytes"; },
    }), /Invalid private pull body file/u);
    assert.equal(readdirSync(temporaryRoot).length, 0);

    const primary = new Error("primary write failure");
    let cleanupAttempts = 0;
    assert.throws(() => createPrivateBodyFile(temporaryRoot, "private body", {
      writeFileSync() { throw primary; },
      rmSync() {
        cleanupAttempts += 1;
        throw new Error("cleanup unavailable");
      },
    }), error => error === primary);
    assert.equal(cleanupAttempts, 1);
    rmSync(temporaryRoot, { recursive: true, force: true });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("private body cleanup retries after a transient removal failure", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "private-pull-retry-test-"));
  let removals = 0;
  try {
    const temporary = createPrivateBodyFile(temporaryRoot, "private body", {
      rmSync(...args) {
        removals += 1;
        if (removals === 1) throw new Error("transient cleanup failure");
        return rmSync(...args);
      },
    });
    temporary.remove();
    assert.equal(existsSync(temporary.file), true);
    temporary.remove();
    assert.equal(existsSync(temporary.file), false);
    assert.equal(removals, 2);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("cleanup failure never replaces provider success or failure", () => {
  for (const providerResult of ["", new Error("provider unavailable")]) {
    let cleanupAttempts = 0;
    const value = fixture([
      pull(), pull(), pull(), pull(), providerResult,
      ...(providerResult instanceof Error ? [] : [pull("target"), pull("target")]),
    ], {
      bodyFileSystem: {
        rmSync() {
          cleanupAttempts += 1;
          throw new Error("cleanup unavailable");
        },
      },
    });
    try {
      const before = value.port.readConditionalPull({
        targetRepository: TARGET,
        pullRequestNumber: NUMBER,
      });
      const project = () => value.port.patchConditionalPull({
        targetRepository: TARGET,
        pullRequestNumber: NUMBER,
        expectedEtag: before.etag,
        body: "target",
      });
      if (providerResult instanceof Error) {
        assert.throws(project, error => error === providerResult);
      } else {
        assert.equal(project().providerAtomicCompareAndSwap, false);
      }
      assert.equal(cleanupAttempts, 1);
    } finally {
      value.cleanup();
    }
  }
});
