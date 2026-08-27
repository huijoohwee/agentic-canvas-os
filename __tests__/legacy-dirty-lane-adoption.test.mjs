import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { adoptLegacyDirtyLane, CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  captureLegacyDirtyLane, MERGED_PULL_REQUEST_EVIDENCE_SCHEMA,
  SQUASH_INTEGRATED_TASK_LANE_CAPTURE_PROFILE,
  verifyLegacyRecoveryPackage } from "../scripts/legacy-dirty-lane-adoption-lib.mjs";
import { mapGitHubPullRequestPayload, normalizeGitHubOriginRepository,
  resolveGitHubRepository } from "../scripts/legacy-dirty-lane-adoption.mjs";
import {
  addTarget,
  capturedFixture,
  configureUser,
  createCanonicalRetentionFixture,
  createFixture,
  createSquashIntegratedFixture,
  createTargetLease,
  git,
  readManifest,
  refSnapshot,
  rewriteManifest,
  sourceSnapshot,
  status,
} from "./helpers/legacy-dirty-lane-fixtures.mjs";
test("canonical retention captures untracked bytes without changing source refs or objects", () => {
  const fixture = createCanonicalRetentionFixture();
  const before = sourceSnapshot(fixture.source);
  const recovery = captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.protectedTip,
    operatorSessionId: "retention-session",
    captureProfile: CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  });
  assert.deepEqual(sourceSnapshot(fixture.source), before);
  assert.equal(recovery.captureProfile, CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE);
  assert.equal(recovery.sourceBranch, "main");
  assert.equal(recovery.tracked.length, 0);
  assert.equal(recovery.untracked.length, 1);
  assert.equal(readFileSync(path.join(fixture.recovery, "files/retained/doc.md"), "utf8"), "retain me\n");
});
test("canonical retention rejects tracked changes and cannot become an adoption package", () => {
  const tracked = createCanonicalRetentionFixture();
  writeFileSync(path.join(tracked.source, "tracked.txt"), "changed\n");
  assert.throws(() => captureLegacyDirtyLane({
    sourceWorktree: tracked.source,
    recoveryDirectory: tracked.recovery,
    protectedTipSha: tracked.protectedTip,
    operatorSessionId: "retention-session",
    captureProfile: CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  }), /rejects tracked or staged/);
  const retained = createCanonicalRetentionFixture();
  captureLegacyDirtyLane({
    sourceWorktree: retained.source,
    recoveryDirectory: retained.recovery,
    protectedTipSha: retained.protectedTip,
    operatorSessionId: "retention-session",
    captureProfile: CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  });
  assert.throws(() => adoptLegacyDirtyLane({
    sourceWorktree: retained.source,
    recoveryDirectory: retained.recovery,
    targetWorktree: retained.source,
    operatorSessionId: "retention-session",
  }), /preservation-only/);
});
test("canonical retention rejects remote protected movement without updating local refs", () => {
  const fixture = createCanonicalRetentionFixture();
  const writer = path.join(fixture.root, "writer");
  git(fixture.root, ["clone", "--branch", "main", fixture.remote, writer]);
  configureUser(writer);
  writeFileSync(path.join(writer, "tracked.txt"), "advanced\n");
  git(writer, ["add", "tracked.txt"]);
  git(writer, ["commit", "-m", "advance"]);
  git(writer, ["push", "origin", "main"]);
  const refsBefore = refSnapshot(fixture.source);
  assert.throws(() => captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.protectedTip,
    operatorSessionId: "retention-session",
    captureProfile: CANONICAL_UNTRACKED_RETENTION_CAPTURE_PROFILE,
  }), /remote origin\/main/);
  assert.equal(refSnapshot(fixture.source), refsBefore);
});
test("task-lane capture preserves exact dirty source evidence and verifies its package", () => {
  const fixture = createFixture();
  const before = sourceSnapshot(fixture.source);
  const recovery = captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.baseSha,
    operatorSessionId: "session-a",
    now: () => new Date("2026-08-01T00:00:00.000Z"),
  });
  assert.deepEqual(sourceSnapshot(fixture.source), before);
  assert.equal(recovery.tracked.length, 1);
  assert.equal(recovery.untracked.length, 1);
  assert.equal(readFileSync(path.join(fixture.recovery, "files/new.txt"), "utf8"), "untracked\n");
  assert.equal(verifyLegacyRecoveryPackage({
    recoveryDirectory: fixture.recovery,
  }).packageDigest, recovery.packageDigest);
});
test("squash capture accepts a descendant protected tip, stale tracking ref, and mutates no source Git state", () => {
  const fixture = createSquashIntegratedFixture();
  const before = sourceSnapshot(fixture.source);
  assert.notEqual(fixture.protectedTip, fixture.mergeCommitSha);
  assert.equal(git(fixture.source, ["rev-parse", "origin/main"]).trim(), fixture.baseSha);
  git(fixture.source, ["merge-base", "--is-ancestor", fixture.mergeCommitSha, fixture.protectedTip]);
  const recovery = captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.protectedTip,
    operatorSessionId: "squash-session",
    captureProfile: SQUASH_INTEGRATED_TASK_LANE_CAPTURE_PROFILE,
    pullRequestEvidence: fixture.pullRequestEvidence,
  });
  assert.deepEqual(sourceSnapshot(fixture.source), before);
  assert.equal(recovery.squashIntegrationProof.pullRequest.pullRequestNumber, 96);
  assert.equal(recovery.squashIntegrationProof.sourceTreeSha, recovery.squashIntegrationProof.integratedTreeSha);
  const target = addTarget(fixture, "squash-adoption");
  const authority = createTargetLease({
    target,
    baseSha: fixture.protectedTip,
    sessionId: "squash-session",
  });
  const receipt = adoptLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    targetWorktree: target,
    operatorSessionId: "squash-session",
    reconciliationPaths: [".DS_Store"],
    ...authority.adoption,
  });
  assert.equal(receipt.status, "reconciliation-required");
  assert.equal(receipt.targetLeaseDigest, authority.expectedLeaseDigest);
  assert.equal(receipt.targetLeaseEpoch, authority.lease.epoch);
  assert.deepEqual(receipt.adoptedPaths, ["docs/documents/agentic-game-os-prd-tad-adr.md"]);
  assert.deepEqual(receipt.reconciliationPaths, [".DS_Store"]);
  assert.equal(readFileSync(path.join(target, ".DS_Store"), "utf8"), "protected\n");
  assert.equal(readFileSync(
    path.join(target, "docs/documents/agentic-game-os-prd-tad-adr.md"),
    "utf8",
  ), "# Agentic Game OS\n");
});
test("package verification rejects rehashed pull request semantic lies", () => {
  const fixture = createSquashIntegratedFixture();
  captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.protectedTip,
    operatorSessionId: "squash-session",
    captureProfile: SQUASH_INTEGRATED_TASK_LANE_CAPTURE_PROFILE,
    pullRequestEvidence: fixture.pullRequestEvidence,
  });
  const original = readManifest(fixture.recovery);
  const cases = [
    ["open state", (pullRequest) => { pullRequest.state = "open"; }, /authoritative merged/],
    ["draft", (pullRequest) => { pullRequest.draft = true; }, /authoritative merged/],
    ["unmerged", (pullRequest) => { pullRequest.merged = false; }, /authoritative merged/],
    ["fork", (pullRequest) => { pullRequest.headRepository = "fork/repository"; }, /same-repository/],
    ["base", (pullRequest) => { pullRequest.baseBranch = "release"; }, /protected base branch/],
    ["head branch", (pullRequest) => { pullRequest.headBranch = "agent/test/other"; }, /head does not match/],
    ["head SHA", (pullRequest) => { pullRequest.headSha = fixture.baseSha; }, /head does not match/],
  ];
  for (const [label, mutate, expected] of cases) {
    rewriteManifest(fixture.recovery, original, (manifest) => {
      mutate(manifest.squashIntegrationProof.pullRequest);
    });
    assert.throws(
      () => verifyLegacyRecoveryPackage({ recoveryDirectory: fixture.recovery }),
      expected,
      label,
    );
  }
});
test("adoption reruns repository ancestry and tree proof before target mutation", () => {
  const fixture = createSquashIntegratedFixture();
  captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.protectedTip,
    operatorSessionId: "squash-session",
    captureProfile: SQUASH_INTEGRATED_TASK_LANE_CAPTURE_PROFILE,
    pullRequestEvidence: fixture.pullRequestEvidence,
  });
  const original = readManifest(fixture.recovery);
  const target = addTarget(fixture, "topology-proof");
  const receiptPath = path.join(fixture.root, "adoption-receipt.json");
  const authority = createTargetLease({
    target,
    baseSha: fixture.protectedTip,
    sessionId: "squash-session",
  });
  const adopt = () => adoptLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    targetWorktree: target,
    operatorSessionId: "squash-session",
    receiptPath,
    ...authority.adoption,
  });
  rewriteManifest(fixture.recovery, original, (manifest) => {
    manifest.squashIntegrationProof.pullRequest.mergeCommitSha = fixture.topologyLieCommitSha;
  });
  assert.doesNotThrow(() => verifyLegacyRecoveryPackage({ recoveryDirectory: fixture.recovery }));
  assert.throws(adopt, /merge-base/);
  assert.equal(status(target), "");
  assert.equal(existsSync(receiptPath), false);
  rewriteManifest(fixture.recovery, original, (manifest) => {
    manifest.squashIntegrationProof.sourceTreeSha = fixture.baseTreeSha;
    manifest.squashIntegrationProof.integratedTreeSha = fixture.baseTreeSha;
  });
  assert.doesNotThrow(() => verifyLegacyRecoveryPackage({ recoveryDirectory: fixture.recovery }));
  assert.throws(adopt, /proof changed/);
  assert.equal(status(target), "");
  assert.equal(existsSync(receiptPath), false);
});
test("verification rejects changed recovery bytes", () => {
  const fixture = createFixture();
  captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.baseSha,
    operatorSessionId: "session-a",
  });
  writeFileSync(path.join(fixture.recovery, "files/new.txt"), "tampered\n");
  assert.throws(
    () => verifyLegacyRecoveryPackage({ recoveryDirectory: fixture.recovery }),
    /recovery file changed/,
  );
});
test("adoption requires the exact live registry lease and imports captured bytes", () => {
  const fixture = createFixture();
  captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.baseSha,
    operatorSessionId: "session-a",
  });
  const target = addTarget(fixture, "target-adoption");
  const authority = createTargetLease({
    target,
    baseSha: fixture.baseSha,
    sessionId: "session-a",
  });
  const receipt = adoptLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    targetWorktree: target,
    operatorSessionId: "session-a",
    ...authority.adoption,
  });
  assert.equal(readFileSync(path.join(target, "tracked.txt"), "utf8"), "changed\n");
  assert.equal(readFileSync(path.join(target, "new.txt"), "utf8"), "untracked\n");
  assert.deepEqual(receipt.adoptedPaths, ["new.txt", "tracked.txt"]);
  assert.equal(receipt.targetLeaseRegistryRevision, 2);
});
test("adoption accepts a target base descended through a disjoint protected advance", () => {
  const fixture = capturedFixture();
  writeFileSync(path.join(fixture.repository, "unrelated.txt"), "protected advance\n");
  git(fixture.repository, ["add", "unrelated.txt"]);
  git(fixture.repository, ["commit", "-m", "disjoint protected advance"]);
  const advancedBaseSha = git(fixture.repository, ["rev-parse", "HEAD"]).trim();
  const target = addTarget(fixture, "descendant-base-adoption", advancedBaseSha);
  const authority = createTargetLease({
    target,
    baseSha: advancedBaseSha,
    sessionId: "session-a",
  });
  const receipt = adoptLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    targetWorktree: target,
    operatorSessionId: "session-a",
    ...authority.adoption,
  });
  assert.equal(receipt.status, "complete");
  assert.equal(readFileSync(path.join(target, "tracked.txt"), "utf8"), "changed\n");
  assert.equal(readFileSync(path.join(target, "new.txt"), "utf8"), "untracked\n");
  assert.equal(readFileSync(path.join(target, "unrelated.txt"), "utf8"), "protected advance\n");
});
test("adoption rejects a target base advance that overlaps recovered paths", () => {
  const fixture = capturedFixture();
  writeFileSync(path.join(fixture.repository, "tracked.txt"), "protected advance\n");
  git(fixture.repository, ["add", "tracked.txt"]);
  git(fixture.repository, ["commit", "-m", "overlapping protected advance"]);
  const advancedBaseSha = git(fixture.repository, ["rev-parse", "HEAD"]).trim();
  const target = addTarget(fixture, "overlapping-base-adoption", advancedBaseSha);
  const authority = createTargetLease({
    target,
    baseSha: advancedBaseSha,
    sessionId: "session-a",
  });
  assert.throws(() => adoptLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    targetWorktree: target,
    operatorSessionId: "session-a",
    ...authority.adoption,
  }), /base advance overlaps/);
  assert.equal(status(target), "");
  assert.equal(readFileSync(path.join(target, "tracked.txt"), "utf8"), "protected advance\n");
  assert.equal(existsSync(path.join(target, "new.txt")), false);
});
test("adoption rejects an expired lease before target mutation or receipt", () => {
  const fixture = capturedFixture();
  const target = addTarget(fixture, "expired-adoption");
  const clock = { value: Date.parse("2026-08-08T00:00:00.000Z") };
  const authority = createTargetLease({
    target,
    baseSha: fixture.baseSha,
    sessionId: "session-a",
    clock,
  });
  clock.value += 60_001;
  const receiptPath = path.join(fixture.root, "expired-receipt.json");
  assert.throws(() => adoptLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    targetWorktree: target,
    operatorSessionId: "session-a",
    receiptPath,
    ...authority.adoption,
  }), /exact live target writer lease/);
  assert.equal(status(target), "");
  assert.equal(existsSync(receiptPath), false);
});
test("adoption rejects a replaced lease digest before target mutation or receipt", () => {
  const fixture = capturedFixture();
  const target = addTarget(fixture, "replaced-adoption");
  const clock = { value: Date.parse("2026-08-08T00:00:00.000Z") };
  const authority = createTargetLease({
    target,
    baseSha: fixture.baseSha,
    sessionId: "session-a",
    clock,
  });
  clock.value += 1_000;
  authority.leaseStore.release({
    sessionId: "session-a",
    branch: authority.lease.branch,
    expectedLease: authority.lease,
  });
  const replacement = authority.leaseStore.claim({
    sessionId: "replacement-session",
    device: "test",
    scope: "replaced-adoption",
    branch: authority.lease.branch,
    worktreePath: target,
    baseSha: fixture.baseSha,
    previousEpoch: authority.lease.epoch,
    ttlMs: 60_000,
  });
  authority.leaseStore.annotate({
    sessionId: replacement.sessionId,
    branch: replacement.branch,
    values: { fenceSha: fixture.baseSha },
  });
  const receiptPath = path.join(fixture.root, "replaced-receipt.json");
  assert.throws(() => adoptLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    targetWorktree: target,
    operatorSessionId: "session-a",
    receiptPath,
    ...authority.adoption,
  }), /exact live target writer lease/);
  assert.equal(status(target), "");
  assert.equal(existsSync(receiptPath), false);
});
test("adoption blocks target collisions while the live lease fence is held", () => {
  const fixture = capturedFixture();
  const target = addTarget(fixture, "collision-adoption");
  writeFileSync(path.join(target, "new.txt"), "collision\n");
  const authority = createTargetLease({
    target,
    baseSha: fixture.baseSha,
    sessionId: "session-a",
  });
  assert.throws(() => adoptLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    targetWorktree: target,
    operatorSessionId: "session-a",
    ...authority.adoption,
  }), /target must be clean/);
  assert.equal(readFileSync(path.join(target, "tracked.txt"), "utf8"), "base\n");
});
test("GitHub evidence derives normalized origin identity and maps the exact REST payload", () => {
  assert.equal(normalizeGitHubOriginRepository(
    "https://github.com/Owner/Repository.git",
  ), "Owner/Repository");
  assert.equal(normalizeGitHubOriginRepository(
    "git@github.com:Owner/Repository.git",
  ), "Owner/Repository");
  assert.equal(normalizeGitHubOriginRepository(
    "ssh://git@github.com/Owner/Repository.git",
  ), "Owner/Repository");
  assert.equal(resolveGitHubRepository({
    originUrl: "git@github.com:Owner/Repository.git",
    explicitRepository: "owner/repository",
  }), "Owner/Repository");
  assert.throws(() => resolveGitHubRepository({
    originUrl: "git@github.com:Owner/Repository.git",
    explicitRepository: "owner/other",
  }), /does not match/);
  for (const origin of ["http://github.com/Owner/Repository.git", "git://github.com/Owner/Repository.git",
    "git@gitlab.com:Owner/Repository.git"]) {
    assert.throws(() => normalizeGitHubOriginRepository(origin), /GitHub HTTPS, SSH, or SCP|github\.com/);
  }
  const payload = {
    number: 335,
    state: "closed",
    draft: false,
    merged: true,
    merged_at: "2026-08-08T01:02:03Z",
    merge_commit_sha: "1".repeat(40),
    head: {
      repo: { full_name: "Owner/Repository" },
      ref: "agent/test/source",
      sha: "2".repeat(40),
    },
    base: {
      repo: { full_name: "Owner/Repository" },
      ref: "main",
      sha: "3".repeat(40),
    },
  };
  assert.deepEqual(mapGitHubPullRequestPayload({
    repository: "Owner/Repository",
    pullRequestNumber: 335,
    payload,
  }), {
    schema: MERGED_PULL_REQUEST_EVIDENCE_SCHEMA,
    repository: "Owner/Repository",
    pullRequestNumber: 335,
    state: "closed",
    draft: false,
    merged: true,
    mergedAt: "2026-08-08T01:02:03Z",
    mergeCommitSha: "1".repeat(40),
    headRepository: "Owner/Repository",
    headBranch: "agent/test/source",
    headSha: "2".repeat(40),
    baseRepository: "Owner/Repository",
    baseBranch: "main",
    baseSha: "3".repeat(40),
  });
  assert.throws(() => mapGitHubPullRequestPayload({
    repository: "Owner/Repository",
    pullRequestNumber: 334,
    payload,
  }), /requested number/);
});
