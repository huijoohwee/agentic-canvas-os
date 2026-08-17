import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { recoverExpiredCommittedHeartbeat } from "../scripts/expired-committed-heartbeat-recovery-lib.mjs";
import {
  EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  LEGACY_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  PRE_PUSHED_PREFIX_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  parseWriterLeasePullRequestBody,
  renderWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";
import {
  advanceReviewedLaneSourceCorrectionIntent,
  buildReviewedLaneSourceCorrectionPlan,
  createReviewedLaneSourceCorrectionIntent,
} from "../scripts/reviewed-lane-source-correction-contract.mjs";
import {
  buildReviewedLaneSourceCorrectionEvidence,
} from "../scripts/reviewed-lane-source-correction-evidence.mjs";

const repo = process.cwd();
const branch = "agent/device/expired-heartbeat";
const pullRequestUrl = "https://github.com/org/repo/pull/81";
const baseSha = "a".repeat(40);
const fenceSha = "b".repeat(40);
const headSha = "c".repeat(40);
const treeSha = "d".repeat(40);
const pushedRemoteHeadSha = "6".repeat(40);
const sourceRemoteTreeSha = "7".repeat(40);
const protectedMainSha = "1".repeat(40);
const protectedMainTreeSha = "2".repeat(40);
const sharedAncestorSha = "4".repeat(40);
const sharedAncestorTreeSha = "5".repeat(40);
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
  assert.equal(result.recovery.sourceRemoteTreeSha, sourceRemoteTreeSha);
  assert.equal(result.recovery.sourceRemoteChangedPathCount, 0);
  assert.equal(
    result.recovery.sourceRemoteChangedPathsDigest,
    digestValue([]),
  );
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
  const mismatchedPrefixEquivalence = {
    ...result.recovery.sourceRemoteSharedAncestorEquivalence,
    protectedMainSha: "9".repeat(40),
    protectedMainTreeSha: "a".repeat(40),
  };
  const mismatchedProtectedMainSubjects = {
    ...result.recovery,
    sourceRemoteSharedAncestorEquivalence: mismatchedPrefixEquivalence,
    sourceRemoteSharedAncestorEquivalenceDigest:
      digestValue(mismatchedPrefixEquivalence),
  };
  const {
    sharedAncestorTreeSha: _missingSharedAncestorTreeSha,
    ...missingSharedAncestorTree
  } = result.recovery.sourceRemoteSharedAncestorEquivalence;
  const malformedSharedAncestorEvidence = {
    ...result.recovery,
    sourceRemoteSharedAncestorEquivalence: missingSharedAncestorTree,
    sourceRemoteSharedAncestorEquivalenceDigest:
      digestValue(missingSharedAncestorTree),
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
    { ...result.recovery, sourceRemoteTreeSha: "0".repeat(40) },
    { ...result.recovery, sourceRemoteChangedPathCount: 1 },
    mismatchedProtectedMainSubjects,
    malformedSharedAncestorEvidence,
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

test("v3 recovers and replays one exact pushed remote/PR prefix", () => {
  const source = expiredCloudLease();
  const renewedAuthority = renewedAuthorityFor(source);
  let saved = source;
  let remoteBody = renderWriterLeasePullRequestBody(source);
  let markerWrites = 0;
  let fetches = 0;
  let instant = new Date("2026-08-04T12:00:00.000Z");
  const common = {
    invocationPath: repo,
    repo,
    gitText: recoveryGitText({
      sourceRemoteHeadSha: pushedRemoteHeadSha,
      sourceRemotePaths: ["scripts/recovery/check.mjs"],
    }),
    gitOptional: () =>
      `${pushedRemoteHeadSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(remoteBody, {
      headRefOid: pushedRemoteHeadSha,
    }),
    leaseStore: {
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
    },
    sessionId: source.sessionId,
    leaseTtlMs: 1_800_000,
    heartbeatCloudAuthority: () => ({
      authority: renewedAuthority,
      verification: { status: "ready" },
    }),
    verifyActiveCloudAuthority: () => ({
      authority: saved.cloudAuthority,
      verification: { status: "ready" },
    }),
    assertMutationAuthority: () => ({ status: "ready" }),
    run: (command, args) => {
      if (command === "git") {
        fetches += 1;
        return;
      }
      markerWrites += 1;
      remoteBody = args[args.indexOf("--body") + 1];
    },
    log: () => {},
    now: () => instant,
  };

  const recovered = recoverExpiredCommittedHeartbeat(common);
  assert.equal(
    recovered.recovery.schema,
    EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  );
  assert.equal(
    recovered.recovery.sourceRemoteHeadSha,
    pushedRemoteHeadSha,
  );
  assert.equal(recovered.recovery.sourceRemoteTreeSha, sourceRemoteTreeSha);
  assert.equal(recovered.recovery.sourceRemoteChangedPathCount, 1);
  assert.equal(
    recovered.recovery.sourceRemoteDeclaredChangedPathCount,
    1,
  );
  assert.equal(recovered.lease.fenceSha, fenceSha);
  assert.equal(recovered.lease.cloudAuthority.laneRevision, fenceSha);
  assert.equal(markerWrites, 1);

  instant = new Date("2026-08-04T12:01:00.000Z");
  const replay = recoverExpiredCommittedHeartbeat({
    ...common,
    heartbeatCloudAuthority: () => {
      throw new Error("v3 replay must not renew cloud authority again");
    },
  });
  assert.equal(replay.replayed, true);
  assert.equal(fetches, 2);
  assert.equal(markerWrites, 1);

  const exactRecoveredLease = saved;
  const exactRecoveredBody = remoteBody;
  saved = {
    ...saved,
    expiredCommittedHeartbeatRecovery: {
      ...saved.expiredCommittedHeartbeatRecovery,
      sourceRemoteRangeDiffDigest: "0".repeat(64),
    },
  };
  remoteBody = renderWriterLeasePullRequestBody(saved);
  assert.throws(() => recoverExpiredCommittedHeartbeat({
    ...common,
    heartbeatCloudAuthority: () => {
      throw new Error("v3 replay must not renew cloud authority again");
    },
  }), /replay evidence changed from its exact recovered subject/);
  saved = exactRecoveredLease;
  remoteBody = exactRecoveredBody;

  const tamperedSharedAncestorEquivalence = {
    ...saved.expiredCommittedHeartbeatRecovery
      .sourceRemoteSharedAncestorEquivalence,
    sharedAncestorSha: "0".repeat(40),
  };
  saved = {
    ...saved,
    expiredCommittedHeartbeatRecovery: {
      ...saved.expiredCommittedHeartbeatRecovery,
      sourceRemoteSharedAncestorEquivalence:
        tamperedSharedAncestorEquivalence,
      sourceRemoteSharedAncestorEquivalenceDigest:
        digestValue(tamperedSharedAncestorEquivalence),
    },
  };
  remoteBody = renderWriterLeasePullRequestBody(saved);
  assert.throws(() => recoverExpiredCommittedHeartbeat({
    ...common,
    heartbeatCloudAuthority: () => {
      throw new Error("v3 replay must not renew cloud authority again");
    },
  }), /replay evidence changed from its exact recovered subject/);
  saved = exactRecoveredLease;
  remoteBody = exactRecoveredBody;

  const driftedRemoteHeadSha = "0".repeat(40);
  assert.throws(() => recoverExpiredCommittedHeartbeat({
    ...common,
    gitOptional: () =>
      `${driftedRemoteHeadSha}\trefs/heads/${branch}`,
  }), /exact stored remote and pull-request head/);
  assert.throws(() => recoverExpiredCommittedHeartbeat({
    ...common,
    ghText: () => pullRequestJson(remoteBody, {
      headRefOid: driftedRemoteHeadSha,
    }),
  }), /exact open draft ownership pull request/);
});

test("v3 accepts an exact one-transition stale pull-request marker", () => {
  const publicKey = "MCowBQYDK2VwAyEACSrUbV3AI2B2uelp0lzOksMlP46mRe78kmyFteCHu6E=";
  const taskAuthorityCore = {
    schema: "agentic-task-authority-binding/v1",
    authoritySubjectId: `urn:agentic-task:${"4".repeat(64)}`,
    proofAdapterId: "urn:agentic-proof:ed25519-file:v1",
    generation: 1,
    publicKey,
    publicKeyDigest: digestValue(publicKey),
    laneBindingDigest: "2".repeat(64),
    bindingMode: "claim",
    boundAt: "2026-08-04T10:00:00.000Z",
    transitionPlanDigest: null,
    priorBindingDigest: null,
  };
  const taskAuthority = {
    ...taskAuthorityCore,
    bindingDigest: digestValue(taskAuthorityCore),
  };
  const sourceMarker = { ...expiredCloudLease(), taskAuthority };
  const source = {
    ...sourceMarker,
    cloudAuthority: renewedAuthorityFor(sourceMarker),
  };
  const renewedAuthority = renewedAuthorityFor(source);
  let saved = source;
  let remoteBody = renderWriterLeasePullRequestBody(sourceMarker);
  let markerWrites = 0;

  const result = recoverExpiredCommittedHeartbeat({
    invocationPath: repo,
    repo,
    gitText: recoveryGitText({
      sourceRemoteHeadSha: pushedRemoteHeadSha,
      sourceRemotePaths: ["scripts/recovery/check.mjs"],
    }),
    gitOptional: () =>
      `${pushedRemoteHeadSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(remoteBody, {
      headRefOid: pushedRemoteHeadSha,
    }),
    leaseStore: {
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
    },
    sessionId: source.sessionId,
    leaseTtlMs: 1_800_000,
    heartbeatCloudAuthority: () => ({
      authority: renewedAuthority,
      verification: { status: "ready" },
    }),
    verifyActiveCloudAuthority: () => ({
      authority: saved.cloudAuthority,
      verification: { status: "ready" },
    }),
    assertMutationAuthority: () => ({ status: "ready" }),
    run: (command, args) => {
      if (command === "git") return;
      markerWrites += 1;
      remoteBody = args[args.indexOf("--body") + 1];
    },
    log: () => {},
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  });

  assert.equal(result.status, "recovered");
  assert.equal(result.lease.cloudAuthority.transitionCounter, 4);
  assert.equal(result.recovery.sourceCloudTransitionCounter, 3);
  assert.equal(markerWrites, 1);
});

test("v3 accepts only a completed source-correction fence lineage", () => {
  const priorFenceSha = "8".repeat(40);
  const source = expiredCloudLease();
  const renewedAuthority = renewedAuthorityFor(source);
  let saved = source;
  let remoteBody = renderWriterLeasePullRequestBody(source);
  let markerWrites = 0;
  const gitCommonDir = mkdtempSync(path.join(
    tmpdir(),
    "acos-source-correction-lineage-",
  ));
  writeSourceCorrectionJournal({
    gitCommonDir,
    source,
    priorFenceSha,
  });

  const result = recoverExpiredCommittedHeartbeat({
    invocationPath: repo,
    repo,
    gitText: recoveryGitText({
      gitCommonDir,
      fenceParentSha: priorFenceSha,
      sourceRemoteHeadSha: pushedRemoteHeadSha,
      sourceRemotePaths: ["scripts/recovery/check.mjs"],
    }),
    gitOptional: () =>
      `${pushedRemoteHeadSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(remoteBody, {
      headRefOid: pushedRemoteHeadSha,
    }),
    leaseStore: {
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
    },
    sessionId: source.sessionId,
    leaseTtlMs: 1_800_000,
    heartbeatCloudAuthority: () => ({
      authority: renewedAuthority,
      verification: { status: "ready" },
    }),
    verifyActiveCloudAuthority: () => ({
      authority: saved.cloudAuthority,
      verification: { status: "ready" },
    }),
    assertMutationAuthority: () => ({ status: "ready" }),
    run: (command, args) => {
      if (command === "git") return;
      markerWrites += 1;
      remoteBody = args[args.indexOf("--body") + 1];
    },
    log: () => {},
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  });

  assert.equal(result.status, "recovered");
  assert.equal(result.recovery.sourceRemoteHeadSha, pushedRemoteHeadSha);
  assert.equal(markerWrites, 1);

  const mismatchedGitCommonDir = mkdtempSync(path.join(
    tmpdir(),
    "acos-source-correction-lineage-mismatch-",
  ));
  writeSourceCorrectionJournal({
    gitCommonDir: mismatchedGitCommonDir,
    source: {
      ...source,
      cloudAuthority: {
        ...source.cloudAuthority,
        claimId: "0".repeat(64),
      },
    },
    priorFenceSha,
  });
  assert.throws(() => recoverExpiredCommittedHeartbeat({
    invocationPath: repo,
    repo,
    gitText: recoveryGitText({
      gitCommonDir: mismatchedGitCommonDir,
      fenceParentSha: priorFenceSha,
      sourceRemoteHeadSha: pushedRemoteHeadSha,
      sourceRemotePaths: ["scripts/recovery/check.mjs"],
    }),
    gitOptional: () =>
      `${pushedRemoteHeadSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(renderWriterLeasePullRequestBody(source), {
      headRefOid: pushedRemoteHeadSha,
    }),
    leaseStore: { read: () => source },
    sessionId: source.sessionId,
    leaseTtlMs: 1_800_000,
    heartbeatCloudAuthority: () => {
      throw new Error("mismatched source-correction receipt must not CAS cloud");
    },
    assertMutationAuthority: () => ({ status: "ready" }),
    run: () => {},
    log: () => {},
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  }), /exact single-parent fence/);
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

test("v2 replay stays exact-fence and cannot adopt a pushed prefix", () => {
  const source = expiredCloudLease();
  const renewedAuthority = renewedAuthorityFor(source);
  let saved = source;
  let remoteBody = renderWriterLeasePullRequestBody(source);
  const base = {
    invocationPath: repo,
    repo,
    gitText: recoveryGitText(),
    gitOptional: () => `${fenceSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(remoteBody),
    leaseStore: {
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
    },
    sessionId: source.sessionId,
    leaseTtlMs: 1_800_000,
    heartbeatCloudAuthority: () => ({
      authority: renewedAuthority,
      verification: { status: "ready" },
    }),
    verifyActiveCloudAuthority: () => ({
      authority: saved.cloudAuthority,
      verification: { status: "ready" },
    }),
    assertMutationAuthority: () => ({ status: "ready" }),
    run: (command, args) => {
      if (command === "gh") {
        remoteBody = args[args.indexOf("--body") + 1];
      }
    },
    log: () => {},
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  };
  recoverExpiredCommittedHeartbeat(base);
  const {
    sourceRemoteHeadSha: _sourceRemoteHeadSha,
    sourceRemoteTreeSha: _sourceRemoteTreeSha,
    sourceRemoteChangedPathCount: _sourceRemoteChangedPathCount,
    sourceRemoteChangedPathsDigest: _sourceRemoteChangedPathsDigest,
    sourceRemoteDeclaredChangedPathCount:
      _sourceRemoteDeclaredChangedPathCount,
    sourceRemoteDeclaredChangedPathsDigest:
      _sourceRemoteDeclaredChangedPathsDigest,
    sourceRemoteProtectedEquivalentPathCount:
      _sourceRemoteProtectedEquivalentPathCount,
    sourceRemoteProtectedEquivalentPathsDigest:
      _sourceRemoteProtectedEquivalentPathsDigest,
    sourceRemoteSharedAncestorEquivalence:
      _sourceRemoteSharedAncestorEquivalence,
    sourceRemoteSharedAncestorEquivalenceDigest:
      _sourceRemoteSharedAncestorEquivalenceDigest,
    sourceRemoteRangeDiffDigest: _sourceRemoteRangeDiffDigest,
    ...v2Evidence
  } = saved.expiredCommittedHeartbeatRecovery;
  saved = {
    ...saved,
    expiredCommittedHeartbeatRecovery: {
      ...v2Evidence,
      schema:
        PRE_PUSHED_PREFIX_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
    },
  };
  remoteBody = renderWriterLeasePullRequestBody(saved);

  const replay = recoverExpiredCommittedHeartbeat({
    ...base,
    heartbeatCloudAuthority: () => {
      throw new Error("v2 replay must not renew cloud authority again");
    },
    now: () => new Date("2026-08-04T12:01:00.000Z"),
  });
  assert.equal(replay.replayed, true);
  assert.equal(
    replay.recovery.schema,
    PRE_PUSHED_PREFIX_EXPIRED_COMMITTED_HEARTBEAT_RECOVERY_SCHEMA,
  );

  assert.throws(() => recoverExpiredCommittedHeartbeat({
    ...base,
    gitText: recoveryGitText({
      sourceRemoteHeadSha: pushedRemoteHeadSha,
    }),
    gitOptional: () =>
      `${pushedRemoteHeadSha}\trefs/heads/${branch}`,
    ghText: () => pullRequestJson(remoteBody, {
      headRefOid: pushedRemoteHeadSha,
    }),
  }), /exact open draft ownership pull request/);
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
  fenceParentSha = baseSha,
  gitCommonDir = repo,
  sourceRemoteHeadSha = fenceSha,
  remoteTreeSha = sourceRemoteTreeSha,
  sourceRemotePaths = [],
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
      "rev-parse --git-common-dir": gitCommonDir,
      [`rev-parse ${headSha}^{tree}`]: treeSha,
      [`rev-parse ${sourceRemoteHeadSha}^{tree}`]: remoteTreeSha,
      [`rev-parse ${sharedAncestorSha}^{tree}`]: sharedAncestorTreeSha,
      "rev-parse refs/remotes/origin/main": protectedMainSha,
      [`rev-parse ${protectedMainSha}^{tree}`]: protectedMainTreeSha,
      [`rev-list --parents -n 1 ${fenceSha}`]: `${fenceSha} ${fenceParentSha}`,
      [`merge-base --is-ancestor ${fenceSha} ${headSha}`]: "",
      [`merge-base --is-ancestor ${baseSha} ${protectedMainSha}`]: "",
      [`merge-base --all ${sourceRemoteHeadSha} ${protectedMainSha}`]:
        sharedAncestorSha,
      [`merge-base --is-ancestor ${baseSha} ${sharedAncestorSha}`]: "",
      [`merge-base --is-ancestor ${sharedAncestorSha} ${protectedMainSha}`]: "",
      [`merge-base --is-ancestor ${sharedAncestorSha} ${sourceRemoteHeadSha}`]: "",
      [`diff --name-only -z --no-renames ${fenceSha} ${headSha} --`]:
        `${paths.join("\0")}\0`,
      [`diff --binary --no-renames ${fenceSha} ${headSha} --`]:
        "binary committed range",
      [`diff --name-only -z --no-renames ${fenceSha} ${sourceRemoteHeadSha} --`]:
        sourceRemotePaths.length ? `${sourceRemotePaths.join("\0")}\0` : "",
      [`diff --binary --no-renames ${fenceSha} ${sourceRemoteHeadSha} --`]:
        sourceRemotePaths.length ? "binary published prefix" : "",
    };
    if (sourceRemoteHeadSha !== fenceSha) {
      values[
        `merge-base --is-ancestor ${fenceSha} ${sourceRemoteHeadSha}`
      ] = "";
    }
    if (sourceRemoteHeadSha !== headSha) {
      values[
        `merge-base --is-ancestor ${sourceRemoteHeadSha} ${headSha}`
      ] = "";
    }
    if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
    return values[key];
  };
}

function writeSourceCorrectionJournal({ gitCommonDir, source, priorFenceSha }) {
  const directory = path.join(
    gitCommonDir,
    "agentic-canvas-os",
    "reviewed-lane-source-correction",
  );
  mkdirSync(directory, { recursive: true });
  const sourceEvidence = sourceCorrectionEvidence({ source, priorFenceSha });
  const plan = buildReviewedLaneSourceCorrectionPlan({
    source: sourceEvidence,
    operatorSessionId: "operator-session",
  });
  const intent = createReviewedLaneSourceCorrectionIntent(
    plan,
    plan.exactAuthorization,
  );
  let current = intent;
  for (const status of [
    "successor_waiting",
    "source_retired",
    "successor_current",
    "lease_activated",
    "pr_drafted",
    "verified",
  ]) {
    current = advanceReviewedLaneSourceCorrectionIntent(current, {
      status,
      values: { status },
    });
  }
  current = advanceReviewedLaneSourceCorrectionIntent(current, {
    status: "complete",
    values: {
      receipt: {
        successorClaimId: source.cloudAuthority.claimId,
        successorClaimDigest: "a".repeat(64),
        leaseDigest: "b".repeat(64),
        pullRequestDigest: "c".repeat(64),
        verificationDigest: "d".repeat(64),
      },
    },
  });
  writeFileSync(
    path.join(directory, `${current.intentDigest}.json`),
    JSON.stringify(current, null, 2),
  );
}

function sourceCorrectionEvidence({ source, priorFenceSha }) {
  const sourceLease = {
    ...source,
    status: "review_ready",
    fenceSha: priorFenceSha,
    reviewHeadSha: source.fenceSha,
  };
  const authority = {
    ...source.cloudAuthority,
    operationReceiptDigest: "e".repeat(64),
    laneRevision: source.fenceSha,
    state: "review_ready",
    reviewRequestId: "github-pull-request:PR_kwDOTest81",
    focusedEvidenceDigest: "f".repeat(64),
  };
  const pullRequest = {
    number: 81,
    nodeId: "PR_kwDOTest81",
    url: source.pullRequestUrl,
    state: "OPEN",
    isDraft: false,
    headBranch: source.branch,
    headSha: source.fenceSha,
    baseBranch: "main",
    baseSha: protectedMainSha,
    headRepository: "org/repo",
    baseRepository: "org/repo",
    authorLogin: "device-user",
    body: renderWriterLeasePullRequestBody({
      ...sourceLease,
      cloudAuthority: authority,
    }),
    autoMergeRequest: null,
    mergeQueueEntry: null,
  };
  const protectedAdvance = {
    schema: "agentic-reviewed-lane-protected-advance/v2",
    sourceBaseSha: source.baseSha,
    pullRequestBaseSha: protectedMainSha,
    currentBaseSha: source.baseSha,
    changedWriteScope: [],
    changedWriteScopeDigest: digestValue([]),
    disposition: "unchanged",
  };
  return buildReviewedLaneSourceCorrectionEvidence({
    repository: { fullName: "org/repo", nodeId: "R_test" },
    actor: { id: "123", login: "device-user" },
    localHeadSha: source.fenceSha,
    remoteHeadSha: source.fenceSha,
    clean: true,
    lease: sourceLease,
    authority,
    claim: {
      claimId: authority.claimId,
      state: "reviewed",
      recordedState: "reviewed",
      writeAuthority: false,
      scopeReserved: true,
      actorId: "github-user:123",
      repositoryId: "github-repository:R_test",
      workItemId: "github-pull-request:PR_kwDOTest81",
      canonicalBaseRevision: source.baseSha,
      laneRevision: source.fenceSha,
      declaredWriteScope: source.admission.declaredWriteSet,
      writeSetDigest: source.admission.writeSetDigest,
      leaseEpoch: authority.leaseEpoch,
      transitionCounter: authority.transitionCounter,
      reviewRequestId: "github-pull-request:PR_kwDOTest81",
      fenceRevision: authority.claimDigest,
      transitionDigest: authority.claimLedgerRevision,
      operationReceiptDigest: authority.operationReceiptDigest,
      integrationReceiptDigest: null,
      integration: null,
      recovery: null,
      deviceId: "device:28d199ac79168e492c4fe9e97101b214905f0cab712f574913c37beac373c43f",
      sessionId: "session:769de96255c8bf13e8338edf82dcde7e7456cab405c5f9ee91ead15baff336e8",
    },
    pullRequest,
    protectedAdvance: {
      ...protectedAdvance,
      receiptDigest: digestValue(protectedAdvance),
    },
  });
}

function pullRequestJson(body, { headRefOid = fenceSha } = {}) {
  return JSON.stringify({
    url: pullRequestUrl,
    state: "OPEN",
    isDraft: true,
    headRefName: branch,
    headRefOid,
    headRepository: { nameWithOwner: "org/repo" },
    baseRefName: "main",
    body,
  });
}
