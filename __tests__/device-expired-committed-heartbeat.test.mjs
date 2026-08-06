import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { recoverExpiredCommittedHeartbeat } from "../scripts/expired-committed-heartbeat-recovery-lib.mjs";
import {
  EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  parseWriterLeasePullRequestBody,
  renderWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";

const repo = process.cwd();
const branch = "agent/device/expired-heartbeat";
const pullRequestUrl = "https://github.com/org/repo/pull/81";
const baseSha = "a".repeat(40);
const fenceSha = "b".repeat(40);
const headSha = "c".repeat(40);
const treeSha = "d".repeat(40);
const protectedMainSha = "1".repeat(40);
const protectedMainTreeSha = "2".repeat(40);
const LEGACY_V1_PULL_REQUEST_BODY = String.raw`---
action: /change
scope: "#expired-heartbeat"
actor: "@device"
base_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
---

Device branch claimed for protected, scope-aware delivery.

<!-- agentic-writer-lease/v2 {"schema":"agentic-writer-lease/v2","status":"active","epoch":415,"sessionId":"session-a","device":"device","scope":"expired-heartbeat","branch":"agent/device/expired-heartbeat","baseSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","fenceSha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","autoDelivery":false,"runtimeRequired":false,"heartbeatAt":"2026-08-04T12:00:00.000Z","expiresAt":"2026-08-04T12:30:00.000Z","expiredCommittedHeartbeatRecovery":{"schema":"agentic-expired-committed-heartbeat-recovery/v1","status":"recovered","sourceEpoch":415,"sourceSessionId":"session-a","sourceDevice":"device","sourceScope":"expired-heartbeat","sourceBranch":"agent/device/expired-heartbeat","sourceBaseSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sourceFenceSha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","sourcePullRequestUrl":"https://github.com/org/repo/pull/81","sourceClaimId":"7777777777777777777777777777777777777777777777777777777777777777","sourceClaimDigest":"8888888888888888888888888888888888888888888888888888888888888888","sourceLedgerRevision":"9999999999999999999999999999999999999999","sourceClaimLedgerRevision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sourceCloudTransitionCounter":1,"renewedClaimDigest":"8888888888888888888888888888888888888888888888888888888888888888","renewedLedgerRevision":"9999999999999999999999999999999999999999","renewedClaimLedgerRevision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","renewedCloudTransitionCounter":2,"headSha":"cccccccccccccccccccccccccccccccccccccccc","treeSha":"dddddddddddddddddddddddddddddddddddddddd","changedPathCount":2,"changedPathsDigest":"f1bcdad8cf65097729310d0d512eebad52c0273cbc9d8cbfaa39bf34ad74c4f2","sourceMarkerDigest":"3333333333333333333333333333333333333333333333333333333333333333","pullRequestBodyDigest":"4444444444444444444444444444444444444444444444444444444444444444","rangeDiffDigest":"d6bf22a2ab5caf32665e8a2c4edd89d793dc3ab17ed3fa4a0045a012d9147013","recoveredAt":"2026-08-04T12:00:00.000Z"},"admission":{"schema":"agentic-lane-admission-lease/v1","status":"admitted","semanticScope":"expired-heartbeat","declaredWriteSet":["path:docs/runtime.md","path:scripts/recovery","semantic:expired-heartbeat"],"writeSetDigest":"2b329d52aabb71c612d9142121cb451db1bcdc7cbe738bd370f09855a9522486","manifestDigest":"1111111111111111111111111111111111111111111111111111111111111111","planReceiptDigest":"2222222222222222222222222222222222222222222222222222222222222222","admissionReceiptDigest":"3333333333333333333333333333333333333333333333333333333333333333","existingLaneStateDigest":"4444444444444444444444444444444444444444444444444444444444444444","admittedReportDigest":"5555555555555555555555555555555555555555555555555555555555555555","preservationReceiptDigest":"6666666666666666666666666666666666666666666666666666666666666666"},"cloudAuthority":{"schema":"agentic-lane-cloud-authority/v1","provider":"github","ledgerRepository":"org/ledger","targetRepository":"org/repo","claimId":"7777777777777777777777777777777777777777777777777777777777777777","claimDigest":"8888888888888888888888888888888888888888888888888888888888888888","ledgerRevision":"9999999999999999999999999999999999999999","claimLedgerRevision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","canonicalBaseSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","laneRevision":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","cloudDeclaredWriteScope":["path:docs/runtime.md","path:scripts/recovery","semantic:expired-heartbeat"],"writeSetDigest":"2b329d52aabb71c612d9142121cb451db1bcdc7cbe738bd370f09855a9522486","deviceId":"device","sessionId":"session-a","reviewRequestId":"github-pull-request:81","leaseEpoch":1,"transitionCounter":2,"state":"active","manifestDigest":"1111111111111111111111111111111111111111111111111111111111111111","expiresAt":"2026-08-04T13:00:00.000Z"}} -->`;

test("dedicated recovery orders cloud, revalidation, atomic local CAS, and marker last", () => {
  const events = [];
  const source = expiredCloudLease();
  const renewedAuthority = {
    ...source.cloudAuthority,
    transitionCounter: source.cloudAuthority.transitionCounter + 1,
    ledgerRevision: "e".repeat(40),
    claimLedgerRevision: "f".repeat(64),
    expiresAt: "2026-08-04T13:30:00.000Z",
  };
  let saved = source;
  let remoteBody = renderWriterLeasePullRequestBody(source);
  const runCalls = [];

  const result = recoverExpiredCommittedHeartbeat({
    invocationPath: repo,
    repo,
    gitText: recoveryGitText(),
    gitOptional: () => `${fenceSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(remoteBody),
    leaseStore: {
      read: () => saved,
      recoverExpiredCommittedHeartbeat: input => {
        events.push("local-cas");
        assert.deepEqual(input.expectedLease, source);
        saved = recoveredLease({
          source,
          renewedAuthority,
          evidence: input.recoveryEvidence,
          recoveredAt: input.recoveredAt,
        });
        return saved;
      },
    },
    sessionId: source.sessionId,
    leaseTtlMs: 1_800_000,
    heartbeatCloudAuthority: () => {
      events.push("cloud-cas");
      return { authority: renewedAuthority, verification: { status: "ready" } };
    },
    assertMutationAuthority: ({ lease, cloudAuthority }) => {
      events.push("joined-authority");
      assert.equal(lease.cloudAuthority, cloudAuthority);
      return { schema: "agentic-admission-mutation-authority/v1", status: "ready" };
    },
    run: (command, args) => {
      if (command === "git") {
        events.push("protected-main-fetch");
        runCalls.push([command, ...args]);
        return;
      }
      events.push("marker-edit");
      runCalls.push([command, ...args]);
      remoteBody = args[args.indexOf("--body") + 1];
    },
    log: () => {},
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  });

  assert.deepEqual(events, [
    "protected-main-fetch",
    "cloud-cas",
    "joined-authority",
    "local-cas",
    "joined-authority",
    "marker-edit",
  ]);
  assert.equal(result.status, "recovered");
  assert.equal(result.replayed, false);
  assert.equal(result.deployment, false);
  assert.equal(result.lease.epoch, source.epoch);
  assert.equal(result.lease.fenceSha, source.fenceSha);
  assert.equal(result.lease.cloudAuthority.claimId, source.cloudAuthority.claimId);
  assert.equal(result.headSha, headSha);
  assert.equal(result.recovery.changedPathCount, 2);
  assert.equal(result.recovery.changedPathsDigest, digestValue([
    "docs/runtime.md",
    "scripts/recovery/check.mjs",
  ]));
  assert.equal("changedPaths" in result.recovery, false);
  assert.equal("worktreePathDigest" in result.recovery, false);
  assert.equal("sourceLeaseDigest" in result.recovery, false);
  const recoveryPaths = ["docs/runtime.md", "scripts/recovery/check.mjs"];
  const protectedEntries = recoveryPaths.map((entryPath, index) => ({
    path: entryPath, headMode: "100644", protectedMode: "100644",
    headBlobSha: String(index + 3).repeat(40),
    protectedBlobSha: String(index + 3).repeat(40),
  }));
  const protectedMainEquivalence = {
    ...result.recovery.protectedMainEquivalence,
    exemptPathCount: recoveryPaths.length,
    exemptPathsDigest: digestValue(recoveryPaths), entries: protectedEntries,
  };
  const allProtectedRecovery = {
    ...result.recovery,
    declaredChangedPathCount: 0, declaredChangedPathsDigest: digestValue([]),
    protectedEquivalentPathCount: recoveryPaths.length,
    protectedEquivalentPathsDigest: digestValue(recoveryPaths),
    protectedMainEquivalence,
    protectedMainEquivalenceDigest: digestValue(protectedMainEquivalence),
  };
  const marker = parseWriterLeasePullRequestBody(remoteBody);
  const replaceRecovery = recovery => remoteBody.replace(
    /<!--\s*agentic-writer-lease\/v2\s+\{.*\}\s*-->/s,
    `<!-- agentic-writer-lease/v2 ${JSON.stringify({
      ...marker, expiredCommittedHeartbeatRecovery: recovery,
    })} -->`,
  );
  assert.deepEqual(parseWriterLeasePullRequestBody(
    replaceRecovery(allProtectedRecovery),
  ).expiredCommittedHeartbeatRecovery, allProtectedRecovery);
  for (const malformed of [
    { ...result.recovery, changedPathsDigest: "0".repeat(64) },
    { ...result.recovery, changedPathCount: 129, declaredChangedPathCount: 129 },
    { ...allProtectedRecovery, declaredChangedPathsDigest: "0".repeat(64) },
    { ...allProtectedRecovery, changedPathsDigest: "0".repeat(64) },
  ]) assert.equal(parseWriterLeasePullRequestBody(replaceRecovery(malformed)), null);
  assert.deepEqual(runCalls, [
    [
      "git",
      "fetch",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ],
    ["gh", "pr", "edit", pullRequestUrl, "--body", remoteBody],
  ]);
});

test("cloud or post-cloud snapshot failure cannot mutate the local lease or marker", () => {
  const source = expiredCloudLease();
  let localWrites = 0;
  let markerWrites = 0;
  const base = {
    invocationPath: repo,
    repo,
    gitText: recoveryGitText(),
    gitOptional: () => `${fenceSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(renderWriterLeasePullRequestBody(source)),
    sessionId: source.sessionId,
    leaseTtlMs: 1_800_000,
    assertMutationAuthority: () => ({ status: "ready" }),
    run: command => {
      if (command === "gh") markerWrites += 1;
    },
    log: () => {},
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  };

  assert.throws(() => recoverExpiredCommittedHeartbeat({
    ...base,
    leaseStore: {
      read: () => source,
      recoverExpiredCommittedHeartbeat: () => { localWrites += 1; },
    },
    heartbeatCloudAuthority: () => { throw new Error("cloud CAS rejected"); },
  }), /cloud CAS rejected/);
  assert.equal(localWrites, 0);
  assert.equal(markerWrites, 0);

  assert.throws(() => recoverExpiredCommittedHeartbeat({
    ...base,
    leaseStore: {
      read: () => source,
      recoverExpiredCommittedHeartbeat: () => { localWrites += 1; },
    },
    heartbeatCloudAuthority: () => ({
      authority: renewedAuthorityFor(source),
      verification: { status: "malformed" },
    }),
    assertMutationAuthority: () => {
      throw new Error("joined authority rejected");
    },
  }), /joined authority rejected/);
  assert.equal(localWrites, 0);
  assert.equal(markerWrites, 0);

  let reads = 0;
  assert.throws(() => recoverExpiredCommittedHeartbeat({
    ...base,
    leaseStore: {
      read: () => (++reads === 1 ? source : { ...source, epoch: 416 }),
      recoverExpiredCommittedHeartbeat: () => { localWrites += 1; },
    },
    heartbeatCloudAuthority: () => ({
      authority: {
        ...source.cloudAuthority,
        transitionCounter: source.cloudAuthority.transitionCounter + 1,
        ledgerRevision: "e".repeat(40),
        claimLedgerRevision: "f".repeat(64),
        expiresAt: "2026-08-04T13:30:00.000Z",
      },
      verification: { status: "ready" },
    }),
  }), /marker differs|state drifted/);
  assert.equal(localWrites, 0);
  assert.equal(markerWrites, 0);
});

test("replay finishes the local-CAS and both marker crash windows", async t => {
  for (const crashWindow of [
    "after-local-cas",
    "before-marker-write",
    "after-marker-write",
  ]) {
    await t.test(crashWindow, () => {
      const source = expiredCloudLease();
      const renewedAuthority = renewedAuthorityFor(source);
      let saved = source;
      let remoteBody = renderWriterLeasePullRequestBody(source);
      let instant = new Date("2026-08-04T12:00:00.000Z");
      let confirmationFailurePending = false;
      let markerCalls = 0;
      let fetchCalls = 0;
      let cloudCalls = 0;
      let authorityAssertions = 0;
      const leaseStore = {
        read: () => saved,
        recoverExpiredCommittedHeartbeat: input => {
          saved = recoveredLease({
            source,
            renewedAuthority,
            evidence: input.recoveryEvidence,
            recoveredAt: input.recoveredAt,
          });
          return saved;
        },
      };
      const common = {
        invocationPath: repo,
        repo,
        gitText: recoveryGitText(),
        gitOptional: () => `${fenceSha}\trefs/heads/${branch}`,
        ghText: () => {
          if (confirmationFailurePending) {
            confirmationFailurePending = false;
            throw new Error("confirmation response lost");
          }
          return pullRequestJson(remoteBody);
        },
        leaseStore,
        sessionId: source.sessionId,
        leaseTtlMs: 1_800_000,
        heartbeatCloudAuthority: () => {
          cloudCalls += 1;
          return {
            authority: renewedAuthority,
            verification: { status: "ready" },
          };
        },
        verifyActiveCloudAuthority: () => ({
          authority: saved.cloudAuthority,
          verification: { status: "ready" },
        }),
        assertMutationAuthority: () => {
          authorityAssertions += 1;
          if (crashWindow === "after-local-cas" && authorityAssertions === 2) {
            throw new Error("post-CAS joined receipt lost");
          }
          return {
            schema: "agentic-admission-mutation-authority/v1",
            status: "ready",
          };
        },
        run: (command, args) => {
          if (command === "git") {
            fetchCalls += 1;
            return;
          }
          markerCalls += 1;
          if (crashWindow === "before-marker-write" && markerCalls === 1) {
            throw new Error("marker write unavailable");
          }
          remoteBody = args[args.indexOf("--body") + 1];
          if (crashWindow === "after-marker-write" && markerCalls === 1) {
            confirmationFailurePending = true;
          }
        },
        log: () => {},
        now: () => instant,
      };

      assert.throws(
        () => recoverExpiredCommittedHeartbeat(common),
        /post-CAS joined receipt lost|marker write unavailable|confirmation response lost/,
      );
      assert.equal(saved.expiredCommittedHeartbeatRecovery.status, "recovered");
      instant = new Date("2026-08-04T12:01:00.000Z");
      const replay = recoverExpiredCommittedHeartbeat({
        ...common,
        heartbeatCloudAuthority: () => {
          throw new Error("replay must not renew cloud authority again");
        },
      });
      assert.equal(replay.replayed, true);
      assert.equal(cloudCalls, 1);
      assert.equal(fetchCalls, 2);
      assert.deepEqual(
        remoteBody,
        renderWriterLeasePullRequestBody(saved),
      );
      assert.equal(
        markerCalls,
        crashWindow === "before-marker-write" ? 2 : 1,
      );
    });
  }
});

test("legacy v1 replay stays fetch-free and cannot gain protected-main exemptions", () => {
  const lease = legacyRecoveredLease();
  const body = LEGACY_V1_PULL_REQUEST_BODY;
  assert.deepEqual(parseWriterLeasePullRequestBody(body)
    .expiredCommittedHeartbeatRecovery,
  lease.expiredCommittedHeartbeatRecovery);
  const input = {
    invocationPath: repo,
    repo,
    gitText: recoveryGitText(),
    gitOptional: () => `${fenceSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(body),
    leaseStore: { read: () => lease },
    sessionId: lease.sessionId,
    leaseTtlMs: 1_800_000,
    heartbeatCloudAuthority: () => {
      throw new Error("legacy replay must not renew cloud authority");
    },
    verifyActiveCloudAuthority: () => ({
      authority: lease.cloudAuthority,
      verification: { status: "ready" },
    }),
    assertMutationAuthority: () => ({ status: "ready" }),
    run: () => {
      throw new Error("legacy replay must not fetch or edit its current marker");
    },
    log: () => {},
    now: () => new Date("2026-08-04T12:01:00.000Z"),
  };

  const result = recoverExpiredCommittedHeartbeat(input);
  assert.equal(result.replayed, true);
  assert.equal(
    result.recovery.schema,
    LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  );
  assert.equal(parseWriterLeasePullRequestBody(body.replace(
    '"recoveredAt":',
    '"protectedEquivalentPathCount":0,"recoveredAt":',
  )), null);
  assert.throws(() => recoverExpiredCommittedHeartbeat({
    ...input,
    gitText: recoveryGitText({
      paths: ["docs/runtime.md", "outside.txt"],
    }),
  }), /outside declared write scope/);
});

test("dedicated CLI emits a no-deployment JSON failure before repository mutation", () => {
  const script = path.resolve("scripts/device-expired-committed-heartbeat.mjs");
  const result = spawnSync(process.execPath, [
    script,
    `--repository=${process.cwd()}`,
    "--ttl-seconds=1",
    "--json",
  ], { encoding: "utf8" });
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.deployment, false);
  assert.match(payload.error.message, /between 60 and 86400/);
});

function legacyRecoveredLease() {
  const source = expiredCloudLease();
  const recoveredAt = "2026-08-04T12:00:00.000Z";
  return {
    ...source,
    heartbeatAt: recoveredAt,
    expiresAt: "2026-08-04T12:30:00.000Z",
    expiredCommittedHeartbeatRecovery: {
      schema: LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
      status: "recovered",
      sourceEpoch: source.epoch,
      sourceSessionId: source.sessionId,
      sourceDevice: source.device,
      sourceScope: source.scope,
      sourceBranch: source.branch,
      sourceBaseSha: source.baseSha,
      sourceFenceSha: source.fenceSha,
      sourcePullRequestUrl: source.pullRequestUrl,
      sourceClaimId: source.cloudAuthority.claimId,
      sourceClaimDigest: source.cloudAuthority.claimDigest,
      sourceLedgerRevision: source.cloudAuthority.ledgerRevision,
      sourceClaimLedgerRevision: source.cloudAuthority.claimLedgerRevision,
      sourceCloudTransitionCounter:
        source.cloudAuthority.transitionCounter - 1,
      renewedClaimDigest: source.cloudAuthority.claimDigest,
      renewedLedgerRevision: source.cloudAuthority.ledgerRevision,
      renewedClaimLedgerRevision:
        source.cloudAuthority.claimLedgerRevision,
      renewedCloudTransitionCounter:
        source.cloudAuthority.transitionCounter,
      headSha,
      treeSha,
      changedPathCount: 2,
      changedPathsDigest: digestValue([
        "docs/runtime.md",
        "scripts/recovery/check.mjs",
      ]),
      sourceMarkerDigest: "3".repeat(64),
      pullRequestBodyDigest: "4".repeat(64),
      rangeDiffDigest: createHash("sha256")
        .update("binary committed range")
        .digest("hex"),
      recoveredAt,
    },
  };
}

function recoveredLease({ source, renewedAuthority, evidence, recoveredAt }) {
  return {
    ...source,
    cloudAuthority: renewedAuthority,
    heartbeatAt: recoveredAt,
    expiresAt: "2026-08-04T12:30:00.000Z",
    expiredCommittedHeartbeatRecovery: {
      schema: EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
      status: "recovered",
      ...evidence,
      renewedClaimDigest: renewedAuthority.claimDigest,
      renewedLedgerRevision: renewedAuthority.ledgerRevision,
      renewedClaimLedgerRevision: renewedAuthority.claimLedgerRevision,
      renewedCloudTransitionCounter: renewedAuthority.transitionCounter,
      recoveredAt,
    },
  };
}

function expiredCloudLease() {
  const declaredWriteSet = [
    "path:docs/runtime.md",
    "path:scripts/recovery",
    "semantic:expired-heartbeat",
  ];
  const writeSetDigest = digestValue(declaredWriteSet);
  return {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 415,
    sessionId: "session-a",
    device: "device",
    scope: "expired-heartbeat",
    branch,
    worktreePath: repo,
    baseSha,
    fenceSha,
    pullRequestUrl,
    autoDelivery: false,
    runtimeRequired: false,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: "expired-heartbeat",
      declaredWriteSet,
      writeSetDigest,
      manifestDigest: "1".repeat(64),
      planReceiptDigest: "2".repeat(64),
      admissionReceiptDigest: "3".repeat(64),
      existingLaneStateDigest: "4".repeat(64),
      admittedReportDigest: "5".repeat(64),
      preservationReceiptDigest: "6".repeat(64),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      provider: "github",
      ledgerRepository: "org/ledger",
      targetRepository: "org/repo",
      claimId: "7".repeat(64),
      claimDigest: "8".repeat(64),
      ledgerRevision: "9".repeat(40),
      claimLedgerRevision: "a".repeat(64),
      canonicalBaseSha: baseSha,
      laneRevision: fenceSha,
      cloudDeclaredWriteScope: declaredWriteSet,
      writeSetDigest,
      deviceId: "device",
      sessionId: "session-a",
      reviewRequestId: "github-pull-request:81",
      leaseEpoch: 1,
      transitionCounter: 2,
      state: "active",
      manifestDigest: "1".repeat(64),
      expiresAt: "2026-08-04T13:00:00.000Z",
    },
    acquiredAt: "2026-08-04T10:00:00.000Z",
    heartbeatAt: "2026-08-04T10:00:00.000Z",
    expiresAt: "2026-08-04T10:30:00.000Z",
  };
}

function renewedAuthorityFor(source) {
  return {
    ...source.cloudAuthority,
    transitionCounter: source.cloudAuthority.transitionCounter + 1,
    ledgerRevision: "e".repeat(40),
    claimLedgerRevision: "f".repeat(64),
    expiresAt: "2026-08-04T13:30:00.000Z",
  };
}

function recoveryGitText({
  paths = ["docs/runtime.md", "scripts/recovery/check.mjs"],
} = {}) {
  return args => {
    const key = args.join(" ");
    const values = {
      "worktree list --porcelain -z": `worktree ${repo}\0HEAD ${headSha}\0branch refs/heads/${branch}\0`,
      "diff --name-only --diff-filter=U": "",
      "ls-files -u": "",
      "status --porcelain": "",
      "status --porcelain=v1 -z --untracked-files=all": "",
      "branch --show-current": branch,
      "rev-parse HEAD": headSha,
      [`rev-parse ${headSha}^{tree}`]: treeSha,
      "rev-parse refs/remotes/origin/main": protectedMainSha,
      [`rev-parse ${protectedMainSha}^{tree}`]: protectedMainTreeSha,
      [`rev-list --parents -n 1 ${fenceSha}`]: `${fenceSha} ${baseSha}`,
      [`merge-base --is-ancestor ${fenceSha} ${headSha}`]: "",
      [`merge-base --is-ancestor ${baseSha} ${protectedMainSha}`]: "",
      [`diff --name-only -z --no-renames ${fenceSha} ${headSha} --`]:
        `${paths.join("\0")}\0`,
      [`diff --binary --no-renames ${fenceSha} ${headSha} --`]:
        "binary committed range",
    };
    if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
    return values[key];
  };
}

function pullRequestJson(body) {
  return JSON.stringify({
    url: pullRequestUrl,
    state: "OPEN",
    isDraft: true,
    headRefName: branch,
    headRefOid: fenceSha,
    headRepository: { nameWithOwner: "org/repo" },
    baseRefName: "main",
    body,
  });
}
