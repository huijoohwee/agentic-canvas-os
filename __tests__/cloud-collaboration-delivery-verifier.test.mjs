import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CLOUD_DELIVERY_VERIFICATION_SCHEMA,
  verifyCloudDeliveryAuthority,
} from "../scripts/cloud-collaboration-delivery-verifier.mjs";
import { publish } from "../scripts/device-branch-lib.mjs";
import { integrateSession } from "../scripts/device-integrate-lib.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = "owner/repo";
const ledgerRepository = "owner/agentic-canvas-os";
const branch = "agent/device/cloud-fence";
const baseSha = "a".repeat(40);
const fenceSha = "b".repeat(40);
const headSha = "c".repeat(40);
const claimId = "1".repeat(64);
const claimDigest = "2".repeat(64);
const ledgerRevision = "d".repeat(40);
const pullRequestNumber = 17;
const pullRequestUrl = `https://github.test/${repository}/pull/${pullRequestNumber}`;

test("explicitly unconfigured delivery preserves the migration path without invoking cloud", () => {
  let invoked = false;
  const result = verifyCloudDeliveryAuthority({
    pullRequestUrl: "legacy-local-value",
    branch: "",
    headSha: "",
    environment: {},
    invoke: () => {
      invoked = true;
      throw new Error("must not run");
    },
  });

  assert.deepEqual(result, {
    schema: CLOUD_DELIVERY_VERIFICATION_SCHEMA,
    ok: true,
    configured: false,
    status: "not-configured",
  });
  assert.equal(invoked, false);
});

test("configured delivery sends the exact repository, PR, branch, head, and fence projection", () => {
  let observed = null;
  const result = verifyCloudDeliveryAuthority({
    pullRequestUrl,
    branch,
    headSha,
    canonicalBaseSha: baseSha,
    cloudAuthority: {
      ledgerRepository,
      targetRepository: repository,
      pullRequestNumber,
      branch,
      headSha,
      claimId,
      claimDigest,
      ledgerRevision,
    },
    environment: {},
    invoke: (input) => {
      observed = input;
      return readyResult();
    },
  });

  assert.deepEqual(observed, {
    ledgerRepository,
    environment: {},
    request: {
      targetRepository: repository,
      pullRequestNumber,
      branch,
      headSha,
      canonicalBaseSha: baseSha,
      requireStatus: "integrated-preserved",
      claimId,
      expectedClaimDigest: claimDigest,
      expectedLedgerRevision: ledgerRevision,
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.claimDigest, claimDigest);
  assert.equal(result.ledgerRevision, ledgerRevision);
});

test("configured delivery marks protected-main refresh verification only for the preserved reviewed subject", () => {
  let observed = null;
  verifyCloudDeliveryAuthority({
    pullRequestUrl,
    branch,
    headSha,
    canonicalBaseSha: baseSha,
    protectedMainRefresh: {
      schema: "agentic-protected-main-refresh/v1",
      deliveredHeadSha: headSha,
      refreshedHeadSha: "e".repeat(40),
      mainParentSha: "f".repeat(40),
    },
    cloudAuthority: {
      ledgerRepository,
      targetRepository: repository,
      claimId,
      claimDigest,
      ledgerRevision,
      canonicalBaseSha: baseSha,
      laneRevision: headSha,
      state: "delivery_authorized",
    },
    environment: {},
    invoke: (input) => {
      observed = input;
      return readyResult();
    },
  });

  assert.equal(observed.request.allowProtectedMainRefresh, true);
});

test("delivery-authorized cloud projections reuse the preserved reviewed subject for refreshed verification", () => {
  let observed = null;
  verifyCloudDeliveryAuthority({
    pullRequestUrl,
    branch,
    headSha,
    canonicalBaseSha: baseSha,
    cloudAuthority: {
      ledgerRepository,
      targetRepository: repository,
      claimId,
      claimDigest,
      ledgerRevision,
      canonicalBaseSha: baseSha,
      laneRevision: headSha,
      reviewRequestId: "github-pull-request:PR_17",
      state: "delivery_authorized",
    },
    environment: {},
    invoke: (input) => {
      observed = input;
      return readyResult();
    },
  });

  assert.equal(observed.request.allowProtectedMainRefresh, true);
});

test("provider-neutral claims may carry their exact GitHub subject beside the claim", () => {
  const result = verifyCloudDeliveryAuthority({
    repository,
    pullRequestNumber,
    branch,
    headSha,
    environment: { AGENTIC_LEDGER_REPOSITORY: ledgerRepository },
    invoke: () => ({
      schema: "agentic-cloud-collaboration-result/v1",
      ok: true,
      action: "verify",
      status: "ready",
      ledgerRevision,
      claimDigest,
      subject: { repository, pullRequestNumber, branch, headSha },
      claim: {
        claimId,
        state: "integrated-preserved",
        laneRevision: headSha,
      },
    }),
  });

  assert.equal(result.status, "ready");
  assert.equal(result.claimId, claimId);
});

test("partial configuration and mismatched verifier subjects fail closed", () => {
  assert.throws(() => verifyCloudDeliveryAuthority({
    repository,
    pullRequestNumber,
    branch,
    headSha,
    environment: {
      AGENTIC_CLOUD_CLAIM_ID: claimId,
    },
    invoke: () => readyResult(),
  }), /ledger repository is required/u);

  assert.throws(() => verifyCloudDeliveryAuthority({
    repository,
    pullRequestNumber,
    branch,
    headSha,
    environment: {
      AGENTIC_LEDGER_REPOSITORY: ledgerRepository,
      AGENTIC_CLOUD_CLAIM_ID: claimId,
    },
    invoke: () => readyResult(),
  }), /claim ID, claim digest, and ledger revision together/u);

  for (const result of [
    readyResult({ repository: "other/repo" }),
    readyResult({ pullRequestNumber: 99 }),
    readyResult({ branch: "agent/other/scope" }),
    readyResult({ headSha: "e".repeat(40) }),
    readyResult({ claimDigest: "3".repeat(64) }),
    { ...readyResult(), status: "blocked" },
  ]) {
    assert.throws(() => verifyCloudDeliveryAuthority({
      repository,
      pullRequestNumber,
      branch,
      headSha,
      cloudAuthority: {
        ledgerRepository,
        claimId,
        claimDigest,
        ledgerRevision,
      },
      environment: {},
      invoke: () => result,
    }), /Cloud collaboration/u);
  }
});

test("device publish verifies cloud authority immediately before enabling auto-merge", () => {
  const trace = [];
  let isDraft = true;
  let released = false;
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 1,
    sessionId: "session-a",
    device: "device",
    scope: "cloud-fence",
    branch,
    worktreePath: repositoryRoot,
    baseSha,
    fenceSha,
    pullRequestUrl,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      state: "active",
      canonicalBaseSha: baseSha,
    },
  };
  assert.throws(() => publish({
    invocationPath: repositoryRoot,
    repo: repositoryRoot,
    gitText: createGitText(),
    ghText: (argumentsList) => {
      if (argumentsList[1] === "list") {
        return JSON.stringify([{ number: pullRequestNumber, headRefName: branch, url: pullRequestUrl }]);
      }
      return JSON.stringify({
        url: pullRequestUrl,
        state: "OPEN",
        isDraft,
        headRefName: branch,
        headRefOid: headSha,
        baseRefName: "main",
        body: "",
      });
    },
    ghOptional: () => pullRequestUrl,
    leaseStore: {
      verify: () => lease,
      annotate: () => lease,
      release: () => {
        released = true;
        return lease;
      },
    },
    sessionId: "session-a",
    run: (command, argumentsList) => {
      trace.push([command, ...argumentsList]);
      if (command === "gh" && argumentsList[0] === "pr" && argumentsList[1] === "ready") {
        isDraft = false;
      }
    },
    verifyCloudAuthority: (subject) => {
      trace.push(["cloud", "verify", subject.headSha]);
      throw new Error("cloud fence blocked");
    },
    reviewReadyCloudAuthority: () => {
      trace.push(["cloud", "review-ready", headSha]);
      return { authority: { ...lease.cloudAuthority, state: "review_ready" } };
    },
    authorizeCloudDelivery: ({ authority }) => {
      trace.push(["cloud", "delivery-authorize", headSha]);
      return { authority: { ...authority, state: "delivery_authorized" } };
    },
    log: () => {},
  }), /cloud fence blocked/u);

  assert.equal(released, false);
  assert.equal(
    trace.some((call) => call[0] === "gh" && call[1] === "pr" && call[2] === "merge"),
    false,
  );
  assert.deepEqual(
    trace.filter((call) => call[0] === "cloud").map((call) => call[1]),
    ["review-ready", "delivery-authorize", "verify"],
  );
});

test("device integration blocks before accepting a protected merged head", () => {
  let pullRequestRead = false;
  let completed = false;
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "delivery",
    epoch: 1,
    sessionId: "session-a",
    device: "device",
    scope: "cloud-fence",
    branch,
    worktreePath: repositoryRoot,
    baseSha,
    fenceSha,
    pullRequestUrl,
    deliveryHeadSha: headSha,
    integration: { commitSha: headSha },
  };
  assert.throws(() => integrateSession({
    invocationPath: repositoryRoot,
    repo: repositoryRoot,
    gitText: (argumentsList) => {
      const key = argumentsList.join(" ");
      if (key === "branch --show-current") return branch;
      if (key === "worktree list --porcelain -z") {
        return [
          `worktree ${repositoryRoot}/canonical\0HEAD ${baseSha}\0branch refs/heads/main`,
          `worktree ${repositoryRoot}\0HEAD ${headSha}\0branch refs/heads/${branch}`,
          "",
        ].join("\0\0");
      }
      throw new Error(`unexpected git command: ${key}`);
    },
    ghText: () => {
      pullRequestRead = true;
      return "";
    },
    leaseStore: {
      read: (requestedBranch) => requestedBranch ? lease : { leases: { [branch]: lease } },
    },
    sessionId: "session-a",
    run: () => {},
    runText: () => "",
    publishTask: () => {},
    completeTask: () => {
      completed = true;
    },
    verifyCloudAuthority: () => {
      throw new Error("cloud fence blocked");
    },
    waitSeconds: 1,
    pollSeconds: 0.1,
    log: () => {},
  }), /cloud fence blocked/u);
  assert.equal(pullRequestRead, false);
  assert.equal(completed, false);
});

test("auto-delivery controller verifies before its exact-head merge command", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "scripts", "sync-open-pr.mjs"),
    "utf8",
  );
  const verificationIndex = source.indexOf("verifyCloudDeliveryAuthority({");
  const mergeIndex = source.indexOf("const auto = gh([", verificationIndex);
  assert.ok(verificationIndex >= 0);
  assert.ok(mergeIndex > verificationIndex);
  assert.match(source.slice(verificationIndex, mergeIndex), /headSha/u);
  assert.match(source.slice(verificationIndex, mergeIndex), /pullRequestNumber: number/u);
});

test("delivery verifier uses an absolute no-shell child with bounded output and hardened environment", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "scripts", "cloud-collaboration-delivery-verifier.mjs"),
    "utf8",
  );
  assert.match(source, /spawnSync\(process\.execPath, \[/u);
  assert.match(source, /maxBuffer: 1024 \* 1024/u);
  assert.match(source, /timeout: 60_000/u);
  assert.match(source, /delete childEnvironment\.NODE_OPTIONS/u);
  assert.match(source, /delete childEnvironment\.NODE_PATH/u);
  assert.doesNotMatch(source, /shell:\s*true/u);
});

function readyResult(overrides = {}) {
  const resultClaimDigest = overrides.claimDigest || claimDigest;
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "verify",
    status: "ready",
    ledgerRevision,
    claimDigest: resultClaimDigest,
    claim: {
      claimId,
      status: "integrated_preserved",
      repository: { fullName: overrides.repository || repository },
      pullRequest: {
        number: overrides.pullRequestNumber || pullRequestNumber,
        branch: overrides.branch || branch,
        headSha: overrides.headSha || headSha,
      },
      branch: overrides.branch || branch,
      headSha: overrides.headSha || headSha,
    },
  };
}

function createGitText() {
  const responses = {
    "worktree list --porcelain -z":
      `worktree ${repositoryRoot}\0HEAD ${headSha}\0branch refs/heads/${branch}\0`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "status --porcelain": "",
    "branch --show-current": branch,
    "rev-parse HEAD": headSha,
    "log -1 --pretty=%s": "feat: cloud delivery fence",
  };
  return (argumentsList) => {
    const key = argumentsList.join(" ");
    if (!(key in responses)) throw new Error(`unexpected git command: ${key}`);
    return responses[key];
  };
}
