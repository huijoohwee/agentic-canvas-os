// Responsibility: Verify exact authorization and the device-only recovery boundary.
import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizePlannedDeviceProjectionRecovery,
  buildPlannedDeviceProjectionRecoveryPlan,
} from "../scripts/planned-device-projection-recovery-contract.mjs";
import { createPlannedDeviceProjectionRecoveryController }
  from "../scripts/planned-device-projection-recovery-controller.mjs";
import { buildPlannedDeviceProjectionRecoveryEvidence }
  from "../scripts/planned-device-projection-recovery-evidence.mjs";
import { pseudonymousIdentifier }
  from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  renderWriterLeasePullRequestBody,
}
  from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest }
  from "../scripts/writer-lease-registry-cas.mjs";

const hash = label => digestValue({ label });
const sha = label => hash(label).slice(0, 40);
const SESSION = pseudonymousIdentifier("session", "session-1");
const SOURCE_DEVICE = pseudonymousIdentifier("device", "device.local");
const TARGET_DEVICE = pseudonymousIdentifier("device", "device");

test("plan seals a partial admission and requires exact authorization", () => {
  const plan = buildPlannedDeviceProjectionRecoveryPlan({ evidence: evidenceFixture() });
  assert.equal(plan.evidence.cloud.mismatch, "device-only");
  assert.equal(plan.allowedEffects.length, 3);
  assert.equal(plan.forbiddenEffects.includes("source-bytes"), true);
  assert.throws(
    () => authorizePlannedDeviceProjectionRecovery(plan, `${plan.exactAuthorization} `),
    /not exact/,
  );
  assert.equal(authorizePlannedDeviceProjectionRecovery(plan, plan.exactAuthorization)
    .planDigest, plan.planDigest);
});

test("evidence rejects a non-expired lane and a session mismatch", () => {
  const input = evidenceInput();
  const active = structuredClone(input);
  active.sourceLease.expiresAt = "2026-08-20T05:10:00.000Z";
  active.review = reviewFixture(active.sourceLease);
  assert.throws(
    () => buildPlannedDeviceProjectionRecoveryEvidence(active),
    /exact expired active planned/,
  );

  const wrongSession = structuredClone(input);
  wrongSession.claim.sessionId = pseudonymousIdentifier("session", "other");
  assert.throws(
    () => buildPlannedDeviceProjectionRecoveryEvidence(wrongSession),
    /partial planned admission/,
  );
});

test("controller projects only cloud, lease, and draft marker receipts", async () => {
  const evidence = evidenceFixture();
  const recoveredAuthority = {
    ...evidence.sourceLease.cloudAuthority,
    claimDigest: hash("recovered claim"),
    claimLedgerRevision: hash("recovered transition"),
    deviceId: TARGET_DEVICE,
    sessionId: SESSION,
    laneRevision: evidence.sourceLease.fenceSha,
    reviewRequestId: evidence.cloud.claim.reviewRequestId,
    transitionCounter: evidence.cloud.claim.transitionCounter + 1,
    state: "active",
    expiresAt: "2026-08-20T06:00:00.000Z",
  };
  const targetLease = {
    ...evidence.sourceLease,
    cloudAuthority: recoveredAuthority,
    heartbeatAt: "2026-08-20T05:30:00.000Z",
    expiresAt: recoveredAuthority.expiresAt,
  };
  const calls = [];
  const adapter = {
    readPlanEvidence: () => evidence,
    authorizeTask: () => { calls.push("task"); return hash("task receipt"); },
    recoverCloud: () => {
      calls.push("cloud");
      return { authority: recoveredAuthority, recoveredAt: targetLease.heartbeatAt,
        disposition: "projected" };
    },
    projectLease: () => { calls.push("lease"); return { lease: targetLease,
      disposition: "projected" }; },
    projectReview: () => { calls.push("review"); return { disposition: "projected" }; },
    verifyTerminal: (_plan, _recovery, taskAuthorityReceiptDigest, dispositions) => {
      calls.push("verify");
      assert.equal(taskAuthorityReceiptDigest, hash("task receipt"));
      assert.deepEqual(dispositions, ["projected", "projected"]);
      return {
        taskAuthorityReceiptDigest,
        recoveredAuthority,
        sourceLeaseDigest: evidence.sourceLeaseDigest,
        targetLeaseDigest: writerLeaseDigest(targetLease),
        sourceBodyDigest: evidence.review.bodyDigest,
        targetBodyDigest: hash("target body"),
        cloudVerificationReceiptDigest: hash("cloud verification"),
        disposition: "projected",
        completedAt: "2026-08-20T05:31:00.000Z",
      };
    },
  };
  const controller = createPlannedDeviceProjectionRecoveryController({ adapter });
  const plan = await controller.plan();
  const receipt = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.deepEqual(calls, ["task", "cloud", "lease", "review", "verify"]);
  assert.equal(receipt.admissionStatus, "planned");
  assert.equal(receipt.mutationAuthorityGranted, false);
  assert.equal(receipt.recoveredTransitionCounter, 3);
});

function evidenceFixture() {
  const input = evidenceInput();
  assert.deepEqual(
    parseWriterLeasePullRequestBody(input.review.body),
    projectWriterLeasePullRequestMarker(input.sourceLease),
  );
  return buildPlannedDeviceProjectionRecoveryEvidence(input);
}

function evidenceInput() {
  const baseSha = sha("base");
  const fenceSha = sha("fence");
  const declaredWriteSet = ["path:canvas/src/App.tsx", "semantic:pwa"];
  const sourceLease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 7,
    sessionId: SESSION,
    device: "device",
    scope: "pwa",
    branch: "agent/device/pwa",
    worktreePath: "/workspace/worktrees/pwa",
    baseSha,
    fenceSha,
    pullRequestUrl: "https://github.com/owner/repository/pull/10",
    autoDelivery: false,
    runtimeRequired: false,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "planned",
      semanticScope: "pwa",
      declaredWriteSet,
      writeSetDigest: digestValue(declaredWriteSet),
      manifestDigest: hash("manifest"),
      planReceiptDigest: hash("plan receipt"),
      admissionReceiptDigest: hash("admission receipt"),
      existingLaneStateDigest: hash("existing lanes"),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      provider: "github",
      ledgerRepository: "owner/controller",
      targetRepository: "owner/repository",
      claimId: hash("claim"),
      claimDigest: hash("source claim"),
      ledgerRevision: sha("ledger"),
      claimLedgerRevision: hash("source transition"),
      ledgerDigest: hash("source transition"),
      canonicalBaseSha: baseSha,
      laneRevision: baseSha,
      cloudDeclaredWriteScope: declaredWriteSet,
      writeSetDigest: digestValue(declaredWriteSet),
      deviceId: SOURCE_DEVICE,
      sessionId: SESSION,
      reviewRequestId: null,
      leaseEpoch: 1,
      transitionCounter: 1,
      expiresAt: "2026-08-20T04:58:00.000Z",
    },
    taskAuthority: {
      schema: "agentic-task-authority-binding/v1",
      authoritySubjectId: "urn:agentic-task:ecf23ead30c2e7eec477e154cdf127f2b6c623831c001952d0e1b280bb68e223",
      proofAdapterId: "urn:agentic-proof:ed25519-file:v1",
      generation: 1,
      publicKey: "MCowBQYDK2VwAyEAJrlc5A3roTL0OYnt/jrI1728OCMSpWD/lq/aKfx+aJE=",
      publicKeyDigest: "aeb38ccccd3cf43765aebbae57f7c74614dd3f0c96e675afbe670c844d302cb2",
      laneBindingDigest: "38b8a14c8f96a31247e800bb30a68255c6ff4eb7cf73a752c456303f966c069a",
      bindingMode: "claim",
      boundAt: "2026-08-20T04:38:06.377Z",
      transitionPlanDigest: null,
      priorBindingDigest: null,
      bindingDigest: "d45a2d7bc19788768393c82100518b30cecf0829bd78e95856558faecedf767b",
    },
    heartbeatAt: "2026-08-20T04:40:00.000Z",
    expiresAt: "2026-08-20T04:58:00.000Z",
  };
  const claim = {
    claimId: sourceLease.cloudAuthority.claimId,
    state: "dormant-preserved",
    writeAuthority: false,
    scopeReserved: true,
    actorId: "github-user:1",
    repositoryId: "github-repository:R_1",
    workItemId: "work-item:pwa",
    canonicalBaseRevision: baseSha,
    laneRevision: fenceSha,
    declaredWriteScope: declaredWriteSet,
    writeSetDigest: digestValue(declaredWriteSet),
    deviceId: SOURCE_DEVICE,
    sessionId: SESSION,
    leaseEpoch: 1,
    transitionCounter: 2,
    heartbeatCounter: 0,
    reviewRequestId: "github-pull-request:PR_10",
    fenceRevision: hash("bound claim"),
    transitionDigest: hash("bound transition"),
    operationReceiptDigest: hash("bound operation"),
  };
  return {
    observedAt: "2026-08-20T05:00:00.000Z",
    sourceLease,
    manifest: {
      declaredWriteSet,
      writeSetDigest: digestValue(declaredWriteSet),
      manifestDigest: sourceLease.admission.manifestDigest,
    },
    repository: {
      canonicalPath: "/workspace/repository",
      worktreePath: sourceLease.worktreePath,
      targetRepository: "owner/repository",
      branch: sourceLease.branch,
      baseSha,
      fenceSha,
      fenceTreeSha: sha("tree"),
      baseTreeSha: sha("tree"),
      headSha: fenceSha,
      remoteHeadSha: fenceSha,
      clean: true,
      canonicalHeadSha: baseSha,
      canonicalRemoteSha: baseSha,
      canonicalClean: true,
    },
    review: reviewFixture(sourceLease),
    claim,
    inventoryDigest: hash("inventory"),
  };
}

function reviewFixture(lease) {
  const body = renderWriterLeasePullRequestBody(lease);
  return {
    id: "PR_10",
    number: 10,
    url: lease.pullRequestUrl,
    state: "OPEN",
    isDraft: true,
    autoMergeAbsent: true,
    headRepository: "owner/repository",
    headBranch: lease.branch,
    headSha: lease.fenceSha,
    baseBranch: "main",
    body,
    bodyDigest: digestValue(body),
    markerDigest: digestValue(parseWriterLeasePullRequestBody(body)),
  };
}
