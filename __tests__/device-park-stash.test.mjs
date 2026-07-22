import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { completeSession, park, publish, resume } from "../scripts/device-branch-lib.mjs";
import { withParkStashLock } from "../scripts/device-park-lib.mjs";
import { parseWriterLeasePullRequestBody, renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

test("park stash lock never removes a live owner and safely takes over a dead stale owner", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "acos-park-lock-"));
  try {
    const gitDir = path.join(root, ".git");
    const lockDir = path.join(gitDir, "agentic-canvas-os");
    const lockPath = path.join(lockDir, "park-stash.lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(lockPath, `${process.pid}:live-owner`);
    assert.throws(() => withParkStashLock({ repo: root, gitText: () => gitDir }, () => {}));
    assert.equal(readFileSync(lockPath, "utf8"), `${process.pid}:live-owner`);
    writeFileSync(lockPath, "99999999:dead-owner");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);
    let entered = false;
    withParkStashLock({ repo: root, gitText: () => gitDir }, () => { entered = true; });
    assert.equal(entered, true);
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("interleaved worktree stashes retain immutable identity and restore exact same-session work", () => {
  const fixture = createFixture();
  try {
    const laneA = fixture.lanes[0];
    const laneB = fixture.lanes[1];
    let interruptPark = true;
    assert.throws(() => park(fixture.context(laneA, call => {
      if (call.slice(0, 3).join(" ") === "git stash push" && interruptPark) {
        interruptPark = false;
        throw new Error("lost stash response");
      }
    })), /lost stash response/);
    assert.equal(laneA.lease.status, "active");
    assert.equal(gitText(laneA.worktree, ["status", "--porcelain"]), "");

    const parkedA = park(fixture.context(laneA));
    const parkedB = park(fixture.context(laneB));
    assert.match(parkedA.stashRef, /^refs\/agentic-canvas-os\/parked\//);
    assert.match(parkedA.stashSha, /^[0-9a-f]{40}$/);
    assert.notEqual(parkedA.stashSha, parkedB.stashSha);
    assert.equal(gitText(fixture.canonical, ["rev-parse", parkedA.stashRef]), parkedA.stashSha);
    assert.equal(gitText(fixture.canonical, ["rev-parse", parkedB.stashRef]), parkedB.stashSha);
    assert.equal(gitText(fixture.canonical, ["rev-parse", "refs/stash"]), parkedB.stashSha);
    const foreignResume = fixture.context(laneB);
    foreignResume.sessionId = "session-foreign";
    assert.throws(() => resume(foreignResume), /dirty parked handoff can resume only in its exact same-session worktree/);

    let interruptPush = true;
    assert.throws(() => resume(fixture.context(laneA, call => {
      if (call.join(" ") === `git push origin ${laneA.branch}` && interruptPush) {
        interruptPush = false;
        throw new Error("lost push response");
      }
    })), /lost push response/);
    assert.equal(laneA.lease.status, "active");
    assert.equal(laneA.lease.baseSha, laneA.lease.parkBranchHeadSha);
    assert.equal(gitText(laneA.worktree, ["rev-parse", `origin/${laneA.branch}`]), laneA.lease.fenceSha);

    let interruptRestore = true;
    assert.throws(() => resume(fixture.context(laneA, call => {
      if (call.slice(0, 4).join(" ") === `git stash apply --index` && interruptRestore) {
        interruptRestore = false;
        throw new Error("lost restore response");
      }
    })), /lost restore response/);
    assert.equal(laneA.lease.parkStashStatus, "pending");
    const resumedA = resume(fixture.context(laneA));
    const resumedB = resume(fixture.context(laneB));

    assert.equal(resumedA.parkStashStatus, "restored");
    assert.equal(resumedB.parkStashStatus, "restored");
    assert.equal(readFileSync(path.join(laneA.worktree, "tracked.txt"), "utf8"), "lane-a\n");
    assert.equal(readFileSync(path.join(laneA.worktree, "only-a.txt"), "utf8"), "only-a\n");
    assert.notEqual(statSync(path.join(laneA.worktree, "only-a.txt")).mode & 0o111, 0);
    assert.equal(readFileSync(path.join(laneB.worktree, "tracked.txt"), "utf8"), "lane-b\n");
    assert.equal(readFileSync(path.join(laneB.worktree, "only-b.txt"), "utf8"), "only-b\n");
    assert.equal(parseWriterLeasePullRequestBody(laneA.body).parkStashStatus, "restored");
    assert.equal(parseWriterLeasePullRequestBody(laneB.body).parkStashStatus, "restored");
    assert.equal(gitText(fixture.canonical, ["rev-parse", parkedA.stashRef]), parkedA.stashSha);

    writeFileSync(path.join(laneA.worktree, "cycle-two.txt"), "cycle two\n");
    const parkedA2 = park(fixture.context(laneA));
    assert.notEqual(parkedA2.stashSha, parkedA.stashSha);
    assert.equal(gitOptional(fixture.canonical, ["show-ref", "--hash", "--verify", parkedA.stashRef]), "");
    assert.equal(gitText(fixture.canonical, ["stash", "list", "--format=%H"]).split("\n").includes(parkedA.stashSha), false);
    const resumedA2 = resume(fixture.context(laneA));
    assert.equal(resumedA2.parkStashStatus, "restored");
    assert.equal(readFileSync(path.join(laneA.worktree, "cycle-two.txt"), "utf8"), "cycle two\n");

    git(laneA.worktree, ["add", "-A"]);
    git(laneA.worktree, ["commit", "-m", "restore lane a"]);
    assert.equal(publish(fixture.context(laneA)), laneA.url);
    const taskHeadSha = gitText(laneA.worktree, ["rev-parse", "HEAD"]);
    git(fixture.canonical, ["merge", "--no-ff", laneA.branch, "-m", "merge lane a"]);
    const mergeCommitSha = gitText(fixture.canonical, ["rev-parse", "HEAD"]);
    git(fixture.canonical, ["push", "origin", "main"]);
    const lostIntentStore = leaseStore(laneA);
    const beginCompletion = lostIntentStore.beginCompletion;
    lostIntentStore.beginCompletion = input => {
      beginCompletion(input);
      throw new Error("lost completion intent response");
    };
    assert.throws(() => completeSession({
      invocationPath: laneA.worktree,
      repo: laneA.worktree,
      gitText: args => gitText(laneA.worktree, args),
      ghText: () => JSON.stringify({
        state: "MERGED", baseRefName: "main", url: laneA.url,
        mergeCommit: { oid: mergeCommitSha }, headRefOid: taskHeadSha,
      }),
      leaseStore: lostIntentStore,
      run: (command, args) => {
        if (command !== "git") throw new Error(`unexpected completion command: ${command}`);
        git(laneA.worktree, args);
      },
      log: () => {},
    }), /lost completion intent response/);
    assert.equal(laneA.lease.status, "completing");
    assert.equal(gitText(fixture.canonical, ["rev-parse", parkedA2.stashRef]), parkedA2.stashSha);

    writeFileSync(path.join(fixture.canonical, "main-advanced.txt"), "advanced after cleanup intent\n");
    git(fixture.canonical, ["add", "main-advanced.txt"]);
    git(fixture.canonical, ["commit", "-m", "advance main after completion intent"]);
    git(fixture.canonical, ["push", "origin", "main"]);
    const lostCompleteStore = leaseStore(laneA);
    const finishCompletion = lostCompleteStore.complete;
    lostCompleteStore.complete = input => {
      finishCompletion(input);
      throw new Error("lost completed response");
    };
    assert.throws(() => completeSession({
      invocationPath: laneA.worktree,
      repo: laneA.worktree,
      gitText: args => gitText(laneA.worktree, args),
      ghText: () => JSON.stringify({
        state: "MERGED", baseRefName: "main", url: laneA.url,
        mergeCommit: { oid: mergeCommitSha }, headRefOid: taskHeadSha,
      }),
      leaseStore: lostCompleteStore,
      run: (command, args) => {
        if (command !== "git") throw new Error(`unexpected completion command: ${command}`);
        git(laneA.worktree, args);
      },
      log: () => {},
    }), /lost completed response/);
    assert.equal(laneA.lease.status, "completed");
    assert.equal(gitText(laneA.worktree, ["branch", "--show-current"]), "");

    writeFileSync(path.join(fixture.canonical, "main-advanced-again.txt"), "advanced after completed response\n");
    git(fixture.canonical, ["add", "main-advanced-again.txt"]);
    git(fixture.canonical, ["commit", "-m", "advance main after completed response"]);
    git(fixture.canonical, ["push", "origin", "main"]);
    const finalMainSha = gitText(fixture.canonical, ["rev-parse", "HEAD"]);
    const completion = completeSession({
      invocationPath: laneA.worktree,
      repo: laneA.worktree,
      gitText: args => gitText(laneA.worktree, args),
      ghText: () => JSON.stringify({
        state: "MERGED", baseRefName: "main", url: laneA.url,
        mergeCommit: { oid: mergeCommitSha }, headRefOid: taskHeadSha,
      }),
      leaseStore: leaseStore(laneA),
      run: (command, args) => {
        if (command !== "git") throw new Error(`unexpected completion command: ${command}`);
        git(laneA.worktree, args);
      },
      log: () => {},
    });
    assert.equal(completion.status, "ok");
    assert.equal(completion.mainSha, finalMainSha);
    assert.equal(gitText(laneA.worktree, ["rev-parse", "HEAD"]), finalMainSha);
    assert.equal(gitOptional(fixture.canonical, ["show-ref", "--hash", "--verify", parkedA.stashRef]), "");
    assert.equal(gitOptional(fixture.canonical, ["show-ref", "--hash", "--verify", parkedA2.stashRef]), "");
    assert.equal(gitText(fixture.canonical, ["rev-parse", parkedB.stashRef]), parkedB.stashSha);
    assert.equal(gitText(fixture.canonical, ["rev-parse", "refs/stash"]), parkedB.stashSha);
    const remainingStashes = gitText(fixture.canonical, ["stash", "list", "--format=%H"]).split("\n");
    assert.equal(remainingStashes.includes(parkedA.stashSha), false);
    assert.equal(remainingStashes.includes(parkedA2.stashSha), false);
    assert.equal(remainingStashes.includes(parkedB.stashSha), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "acos-park-stash-"));
  const remote = path.join(root, "remote.git");
  const canonical = path.join(root, "canonical");
  git(root, ["init", "--bare", remote]);
  git(root, ["clone", remote, canonical]);
  git(canonical, ["config", "user.name", "ACOS Test"]);
  git(canonical, ["config", "user.email", "acos@example.test"]);
  git(canonical, ["config", "agentic.device", "device"]);
  writeFileSync(path.join(canonical, "tracked.txt"), "base\n");
  git(canonical, ["add", "tracked.txt"]);
  git(canonical, ["commit", "-m", "base"]);
  git(canonical, ["branch", "-M", "main"]);
  git(canonical, ["push", "-u", "origin", "main"]);
  const baseSha = gitText(canonical, ["rev-parse", "HEAD"]);
  const lanes = ["a", "b"].map((suffix, index) => {
    const branch = `agent/device/run-${suffix}`;
    const worktree = path.join(root, `lane-${suffix}`);
    git(canonical, ["worktree", "add", "-b", branch, worktree, "main"]);
    git(worktree, ["commit", "--allow-empty", "-m", `claim ${suffix}`]);
    git(worktree, ["push", "-u", "origin", branch]);
    const fenceSha = gitText(worktree, ["rev-parse", "HEAD"]);
    if (suffix === "a") {
      writeFileSync(path.join(worktree, "ahead-a.txt"), "committed ahead\n");
      git(worktree, ["add", "ahead-a.txt"]);
      git(worktree, ["commit", "-m", "local ahead"]);
    }
    writeFileSync(path.join(worktree, "tracked.txt"), `lane-${suffix}\n`);
    writeFileSync(path.join(worktree, `only-${suffix}.txt`), `only-${suffix}\n`);
    if (suffix === "a") chmodSync(path.join(worktree, "only-a.txt"), 0o755);
    const lane = {
      suffix,
      branch,
      worktree,
      url: `https://github.test/org/repo/pull/${index + 1}`,
      isDraft: true,
      lease: {
        schema: "agentic-writer-lease/v2",
        status: "active",
        epoch: index + 1,
        sessionId: `session-${suffix}`,
        device: "device",
        scope: `run-${suffix}`,
        branch,
        worktreePath: worktree,
        baseSha,
        fenceSha,
        pullRequestUrl: `https://github.test/org/repo/pull/${index + 1}`,
        acquiredAt: "2026-07-22T00:00:00.000Z",
        heartbeatAt: "2026-07-22T00:00:00.000Z",
        expiresAt: "2026-07-22T01:00:00.000Z",
      },
    };
    lane.body = renderWriterLeasePullRequestBody(lane.lease);
    return lane;
  });

  return {
    root,
    canonical,
    lanes,
    context(lane, afterGit = () => {}) {
      const gitOptional = args => {
        const result = spawnSync("git", args, { cwd: lane.worktree, encoding: "utf8" });
        return result.status === 0 ? result.stdout.trim() : "";
      };
      const run = (command, args) => {
        const call = [command, ...args];
        if (command === "git") git(lane.worktree, args);
        else if (command === "npm") return;
        else if (command === "gh" && args[0] === "pr" && args[1] === "edit") {
          lane.body = args[args.indexOf("--body") + 1];
        } else if (command === "gh" && args[0] === "pr" && args[1] === "ready") lane.isDraft = false;
        else if (!(command === "gh" && args[0] === "pr" && args[1] === "merge")) {
          throw new Error(`unexpected command: ${call.join(" ")}`);
        }
        afterGit(call);
      };
      return {
        branchName: lane.branch,
        invocationPath: lane.worktree,
        repo: lane.worktree,
        gitText: args => gitText(lane.worktree, args),
        gitOptional,
        ghText: args => args[1] === "list" ? JSON.stringify(lanes.map(item => ({
          number: Number(item.url.split("/").at(-1)), headRefName: item.branch, url: item.url, body: item.body,
        }))) : args.includes("--jq") ? lane.body : JSON.stringify({
          url: lane.url, state: "OPEN", isDraft: lane.isDraft,
          headRefName: lane.branch, baseRefName: "main", body: lane.body,
        }),
        ghOptional: () => lane.url,
        leaseStore: leaseStore(lane),
        sessionId: lane.lease.sessionId,
        leaseTtlMs: 1_800_000,
        run,
        log: () => {},
        now: () => new Date("2026-07-22T00:05:00.000Z"),
      };
    },
  };
}

function leaseStore(lane) {
  return {
    read: branch => branch ? lane.lease : { leases: { [lane.branch]: lane.lease } },
    verify: ({ sessionId, branch }) => {
      if (lane.lease.status !== "active" || lane.lease.sessionId !== sessionId || lane.lease.branch !== branch) {
        throw new Error("lease mismatch");
      }
      return lane.lease;
    },
    release: ({ status, timestamp, values }) => (lane.lease = {
      ...lane.lease, ...values, status,
      heartbeatAt: timestamp || "2026-07-22T00:06:00.000Z",
      expiresAt: timestamp || "2026-07-22T00:06:00.000Z",
    }),
    claim: input => (lane.lease = {
      schema: "agentic-writer-lease/v2",
      status: "active",
      epoch: input.previousEpoch + 1,
      sessionId: input.sessionId,
      device: input.device,
      scope: input.scope,
      branch: input.branch,
      worktreePath: input.worktreePath,
      baseSha: input.baseSha,
      fenceSha: null,
      pullRequestUrl: null,
      acquiredAt: "2026-07-22T00:05:00.000Z",
      heartbeatAt: "2026-07-22T00:05:00.000Z",
      expiresAt: "2026-07-22T00:35:00.000Z",
    }),
    annotate: ({ values }) => (lane.lease = { ...lane.lease, ...values }),
    beginCompletion: ({ pullRequestUrl, mergeCommitSha, mainSha }) => (lane.lease = {
      ...lane.lease, status: "completing", pullRequestUrl,
      completion: { mergeCommitSha, mainSha },
    }),
    complete: ({ pullRequestUrl, mergeCommitSha, mainSha }) => (lane.lease = {
      ...lane.lease, status: "completed", pullRequestUrl,
      completion: { mergeCommitSha, mainSha },
    }),
    rollbackClaim: () => { throw new Error("unexpected rollback"); },
  };
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitText(cwd, args) {
  return git(cwd, args).trim();
}

function gitOptional(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}
