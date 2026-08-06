import test from "node:test";
import assert from "node:assert/strict";

import { start } from "../scripts/device-start-lib.mjs";
import { renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const repo = process.cwd();
const branch = "agent/device/managed-run";
const baseSha = "a".repeat(40);
const fenceSha = "b".repeat(40);
const pullRequestUrl = "https://github.test/org/repo/pull/42";

test("start reconciles a draft PR created before its response was lost", () => {
  const calls = [];
  let lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 3,
    sessionId: "session-a",
    device: "device",
    scope: "managed-run",
    branch,
    worktreePath: repo,
    baseSha,
    fenceSha,
    pullRequestUrl: null,
    acquiredAt: "2026-07-22T00:00:00.000Z",
    heartbeatAt: "2026-07-22T00:00:00.000Z",
    expiresAt: "2026-07-22T01:00:00.000Z",
  };
  let owner = null;
  const context = {
    scope: "managed-run",
    invocationPath: repo,
    repo,
    gitText: args => {
      const key = args.join(" ");
      const values = {
        "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${fenceSha}\0branch refs/heads/${branch}\0`,
        "diff --name-only --diff-filter=U": "",
        "ls-files -u": "",
        "status --porcelain": "",
        "branch --show-current": branch,
        "rev-parse HEAD": fenceSha,
        "rev-list --parents -n 1 HEAD": `${fenceSha} ${baseSha}`,
        "log -1 --pretty=%s": "chore(coordination): claim managed-run lease 3",
      };
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    gitOptional: args => (
      args[0] === "config" && args[2] === "agentic.device"
        ? "device"
        : ""
    ),
    ghText: args => {
      if (args[1] === "list") return JSON.stringify(owner ? [owner] : []);
      if (args[1] === "create") {
        owner = { number: 42, headRefName: branch, url: pullRequestUrl, body: renderWriterLeasePullRequestBody(lease), isDraft: true };
        throw new Error("response lost after draft creation");
      }
      if (args[1] === "view") return JSON.stringify({
        url: pullRequestUrl,
        state: "OPEN",
        isDraft: true,
        headRefName: branch,
        baseRefName: "main",
        body: owner.body,
      });
      throw new Error(`unexpected gh command: ${args.join(" ")}`);
    },
    leaseStore: {
      read: () => lease,
      heartbeat: () => lease,
      annotate: ({ values }) => (lease = { ...lease, ...values }),
    },
    sessionId: "session-a",
    leaseTtlMs: 60_000,
    run: (command, args) => calls.push([command, ...args]),
    log: () => {},
    now: () => new Date("2026-07-22T00:01:00.000Z"),
  };

  assert.throws(() => start(context), /response lost/);
  assert.equal(lease.pullRequestUrl, null);
  assert.equal(start(context), branch);
  assert.equal(lease.pullRequestUrl, pullRequestUrl);
  assert.equal(calls.filter(call => call.join(" ") === `git push --set-upstream origin ${branch}`).length, 2);
  assert.equal(calls.filter(call => call[0] === "gh" && call[1] === "pr" && call[2] === "edit").length, 1);
  assert.equal(calls.some(call => call[0] === "git" && ["switch", "commit"].includes(call[1])), false);
});

test("start rejects local and remote branch collisions before lease mutation", () => {
  for (const collision of ["local", "remote"]) {
    let claims = 0;
    assert.throws(() => start({
      scope: "managed-run",
      invocationPath: repo,
      repo,
      gitText: args => {
        const values = {
          "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${baseSha}\0detached\0`,
          "diff --name-only --diff-filter=U": "",
          "ls-files -u": "",
          "status --porcelain": "",
          "branch --show-current": "",
        };
        const key = args.join(" ");
        if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
        return values[key];
      },
      gitOptional: args => {
        if (args[0] === "config" && args[2] === "agentic.device") return "device";
        if (collision === "local" && args[0] === "show-ref") return fenceSha;
        if (collision === "remote" && args[0] === "ls-remote") return `${fenceSha}\trefs/heads/${branch}`;
        return "";
      },
      ghText: () => "[]",
      leaseStore: {
        read: () => null,
        claim: () => { claims += 1; },
      },
      sessionId: "session-a",
      leaseTtlMs: 60_000,
      run: () => {},
      log: () => {},
    }), /branch collision/);
    assert.equal(claims, 0, `${collision} collision`);
  }
});

test("start blocks fresh local-only claims in the root-source repository", () => {
  let claims = 0;
  assert.throws(() => start({
    scope: "managed-run",
    invocationPath: repo,
    repo,
    gitText: args => {
      const values = {
        "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${baseSha}\0detached\0`,
        "diff --name-only --diff-filter=U": "",
        "ls-files -u": "",
        "status --porcelain": "",
        "branch --show-current": "",
      };
      const key = args.join(" ");
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    gitOptional: args => {
      if (args[0] === "config" && args[2] === "agentic.device") return "device";
      if (args[0] === "config" && args[2] === "remote.origin.url") {
        return "git@github.com:huijoohwee/agentic-canvas-os.git";
      }
      return "";
    },
    ghText: () => "[]",
    leaseStore: {
      read: () => null,
      claim: () => {
        claims += 1;
      },
    },
    sessionId: "session-a",
    leaseTtlMs: 60_000,
    run: () => {},
    log: () => {},
  }), /requires provisioned device:start/);
  assert.equal(claims, 0);
});

test("start accepts a provisioned root-source claim with admission and cloud authority", () => {
  const calls = [];
  let lease = null;
  let owner = null;
  let currentHead = baseSha;
  const branchName = branch;
  const admission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "planned",
    semanticScope: "managed-run",
    declaredWriteSet: ["docs/START-WORKFLOW.md"],
    writeSetDigest: "1".repeat(64),
    manifestDigest: "2".repeat(64),
    planReceiptDigest: "3".repeat(64),
    admissionReceiptDigest: "4".repeat(64),
    existingLaneStateDigest: "5".repeat(64),
  };
  const cloudAuthority = {
    claimId: "claim-123",
    expiresAt: "2026-07-22T01:00:00.000Z",
  };
  const boundCloudAuthority = {
    ...cloudAuthority,
    branch: branchName,
    headSha: fenceSha,
    pullRequestUrl,
  };

  const result = start({
    scope: "managed-run",
    invocationPath: repo,
    repo,
    gitText: args => {
      const key = args.join(" ");
      const values = {
        "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${baseSha}\0detached\0`,
        "diff --name-only --diff-filter=U": "",
        "ls-files -u": "",
        "status --porcelain": "",
        "branch --show-current": "",
        "rev-parse HEAD": currentHead,
        "rev-parse origin/main": baseSha,
      };
      if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
      return values[key];
    },
    gitOptional: args => {
      if (args[0] === "config" && args[2] === "agentic.device") return "device";
      if (args[0] === "config" && args[2] === "remote.origin.url") {
        return "git@github.com:huijoohwee/agentic-canvas-os.git";
      }
      return "";
    },
    ghText: args => {
      if (args[1] === "list") return JSON.stringify(owner ? [owner] : []);
      if (args[1] === "create") {
        owner = {
          number: 42,
          headRefName: branchName,
          url: pullRequestUrl,
          body: renderWriterLeasePullRequestBody(lease),
          isDraft: true,
          state: "OPEN",
          headRefOid: currentHead,
        };
        return `${pullRequestUrl}\n`;
      }
      if (args[1] === "view") {
        return JSON.stringify({
          url: pullRequestUrl,
          state: "OPEN",
          isDraft: true,
          headRefName: branchName,
          headRefOid: currentHead,
          baseRefName: "main",
          body: owner?.body || "",
        });
      }
      throw new Error(`unexpected gh command: ${args.join(" ")}`);
    },
    leaseStore: {
      read: () => null,
      claim: input => {
        lease = {
          schema: "agentic-writer-lease/v2",
          status: "active",
          epoch: 3,
          sessionId: input.sessionId,
          device: input.device,
          scope: input.scope,
          branch: input.branch,
          worktreePath: input.worktreePath,
          baseSha: input.baseSha,
          fenceSha: null,
          pullRequestUrl: null,
          acquiredAt: "2026-07-22T00:00:00.000Z",
          heartbeatAt: "2026-07-22T00:00:00.000Z",
          expiresAt: "2026-07-22T01:00:00.000Z",
          admission: input.admission,
          cloudAuthority: input.cloudAuthority,
        };
        return lease;
      },
      annotate: ({ values }) => {
        lease = { ...lease, ...values };
        if (owner && values.pullRequestUrl) owner = { ...owner, url: values.pullRequestUrl };
        if (owner && values.fenceSha) owner = { ...owner, headRefOid: values.fenceSha };
        if (owner) owner = { ...owner, body: renderWriterLeasePullRequestBody(lease) };
        return lease;
      },
    },
    sessionId: "session-a",
    leaseTtlMs: 60_000,
    admission,
    cloudAuthority,
    bindCloudAuthority: ({ authority }) => {
      assert.deepEqual(authority, cloudAuthority);
      return boundCloudAuthority;
    },
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === "git" && args[0] === "switch" && args[1] === "--create") return;
      if (command === "git" && args[0] === "commit") {
        currentHead = fenceSha;
        return;
      }
      if (command === "git" && args[0] === "push") return;
      if (command === "gh" && args[0] === "pr" && args[1] === "edit" && owner) {
        owner = { ...owner, body: renderWriterLeasePullRequestBody(lease) };
      }
    },
    log: () => {},
    now: () => new Date("2026-07-22T00:01:00.000Z"),
  });

  assert.equal(result, branchName);
  assert.deepEqual(lease.admission, admission);
  assert.deepEqual(lease.cloudAuthority, boundCloudAuthority);
  assert.equal(
    calls.some(call => call.join(" ") === `git switch --create ${branchName} ${baseSha}`),
    true,
  );
  assert.equal(
    calls.some(call => call[0] === "gh" && call[1] === "pr" && call[2] === "edit"),
    true,
  );
});
