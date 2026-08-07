import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { heartbeat } from "../scripts/device-branch-ownership-lib.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { renderWriterLeasePullRequestBody, createWriterLeaseStore } from "../scripts/writer-lease-lib.mjs";
import { beginScopeExpansionIntent, writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const BRANCH = "agent/device/protected-head-refresh-controller";
const CLAIM = "a".repeat(64);
const FENCE = "b".repeat(40);
const PR_URL = "https://github.test/example/repo/pull/42";

test("device heartbeat reads the expansion fence before it can renew C1 remotely", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "scope-expansion-heartbeat-"));
  const repo = root;
  const store = createWriterLeaseStore({
    gitCommonDir: root,
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  });
  try {
    let lease = store.claim({
      sessionId: "session", device: "device", scope: "protected-head-refresh-controller",
      branch: BRANCH, worktreePath: repo, baseSha: "c".repeat(40), ttlMs: 1_800_000,
    });
    lease = store.annotate({
      sessionId: "session", branch: BRANCH,
      values: {
        fenceSha: FENCE, pullRequestUrl: PR_URL,
        cloudAuthority: { claimId: CLAIM },
      },
    });
    const planCore = {
      schema: "agentic-active-dirty-scope-expansion-plan/v1",
      sourceBranch: BRANCH,
      targetWriteSetDigest: "d".repeat(64),
      targetManifestDigest: "e".repeat(64),
      targetCanonicalBaseSha: "f".repeat(40),
    };
    beginScopeExpansionIntent({
      leaseStore: store, branch: BRANCH, expectedLeaseDigest: writerLeaseDigest(lease),
      expectedClaimId: CLAIM, plan: { ...planCore, planDigest: digestValue(planCore) },
    });
    let cloudRenewed = false;
    const calls = [];
    assert.throws(() => heartbeat({
      invocationPath: repo,
      repo,
      gitText: args => {
        const values = {
          "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${FENCE}\0branch refs/heads/${BRANCH}\0`,
          "diff --name-only --diff-filter=U": "",
          "ls-files -u": "",
          "branch --show-current": BRANCH,
        };
        const key = args.join(" ");
        if (!Object.hasOwn(values, key)) throw new Error(`unexpected git ${key}`);
        return values[key];
      },
      gitOptional: () => `${FENCE}\trefs/heads/${BRANCH}`,
      ghText: () => JSON.stringify({
        url: PR_URL, state: "OPEN", isDraft: true, headRefName: BRANCH,
        headRefOid: FENCE, baseRefName: "main", body: renderWriterLeasePullRequestBody(lease),
      }),
      leaseStore: store,
      sessionId: "session",
      leaseTtlMs: 1_800_000,
      heartbeatCloudAuthority: () => { cloudRenewed = true; throw new Error("unexpected cloud renewal"); },
      verifyActiveCloudAuthority: () => { throw new Error("unexpected cloud verifier"); },
      run: (command, args) => calls.push([command, ...args]),
    }), /fences this source heartbeat/);
    assert.equal(cloudRenewed, false);
    assert.deepEqual(calls, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
