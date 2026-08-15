import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  continueActivePublishTaskAuthoritySuccessor,
} from "../scripts/active-publish-task-authority-successor.mjs";
import {
  authorizeTaskBoundLeaseMutation,
  createTaskAuthorityLeaseBinding,
  writeTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-store.mjs";
import { assertTaskAuthorityBinding }
  from "../scripts/task-bound-lane-authority-contract.mjs";

const D = value => value.repeat(64).slice(0, 64);
const SOURCE_BASE = "1".repeat(40);
const SOURCE_HEAD = "2".repeat(40);
const TARGET_BASE = "3".repeat(40);
const TARGET_HEAD = "4".repeat(40);

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "active-publish-task-authority-")));
  const capabilityPath = path.join(root, "capability.json");
  writeTaskAuthorityCapability({
    outputPath: capabilityPath,
    issuedAt: "2026-08-15T00:00:00.000Z",
  });
  const admission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: "active-publish-task-authority-successor",
    declaredWriteSet: ["path:scripts/active-publish-task-authority-successor.mjs"],
    writeSetDigest: D("a"),
    manifestDigest: D("b"),
    admissionReceiptDigest: D("c"),
  };
  const sourceAuthority = {
    claimId: D("1"), canonicalBaseSha: SOURCE_BASE, laneRevision: SOURCE_HEAD,
    leaseEpoch: 1, deviceId: "device", sessionId: "session",
    reviewRequestId: "review", writeSetDigest: admission.writeSetDigest,
    operationReceiptDigest: D("d"),
  };
  const sourceCore = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 7,
    sessionId: "session", device: "device",
    scope: admission.semanticScope,
    branch: "agent/device/active-publish-task-authority-successor",
    worktreePath: "/tmp/task", pullRequestUrl: "https://example.test/pull/1",
    baseSha: SOURCE_BASE, fenceSha: SOURCE_HEAD,
    admission, cloudAuthority: sourceAuthority,
  };
  const sourceLease = {
    ...sourceCore,
    taskAuthority: createTaskAuthorityLeaseBinding({
      lease: sourceCore,
      capabilityPath,
      boundAt: "2026-08-15T00:00:01.000Z",
    }),
  };
  const targetAdmission = { ...admission, admissionReceiptDigest: D("e") };
  const targetLease = {
    ...sourceLease,
    baseSha: TARGET_BASE,
    fenceSha: TARGET_HEAD,
    admission: targetAdmission,
    cloudAuthority: {
      ...sourceAuthority,
      claimId: D("2"), canonicalBaseSha: TARGET_BASE, laneRevision: TARGET_HEAD,
      leaseEpoch: 2, operationReceiptDigest: D("f"),
    },
  };
  return { capabilityPath, sourceLease, targetLease };
}

test("continues the same task capability across one exact active-publish successor", () => {
  const { capabilityPath, sourceLease, targetLease } = fixture();
  const result = continueActivePublishTaskAuthoritySuccessor({
    sourceLease,
    targetLease,
    cloudOperationReceiptDigest: D("f"),
    cloudVerificationReceiptDigest: D("e"),
    boundAt: "2026-08-15T00:01:00.000Z",
  });
  assert.equal(result.binding.bindingMode, "continuation");
  assert.equal(result.binding.priorBindingDigest, sourceLease.taskAuthority.bindingDigest);
  assert.equal(result.receipt.sourceClaimId, D("1"));
  assert.equal(result.receipt.targetClaimId, D("2"));
  const rebound = { ...targetLease, taskAuthority: result.binding };
  assert.doesNotThrow(() => assertTaskAuthorityBinding({
    binding: result.binding,
    lease: rebound,
  }));
  assert.doesNotThrow(() => authorizeTaskBoundLeaseMutation({
    lease: rebound,
    capabilityPath,
    operation: "device:review",
    now: new Date("2026-08-15T00:01:01.000Z"),
  }));
});

test("rejects owner, write-scope, and cloud-operation drift", () => {
  const { sourceLease, targetLease } = fixture();
  const attempt = changes => () => continueActivePublishTaskAuthoritySuccessor({
    sourceLease,
    targetLease: { ...targetLease, ...changes },
    cloudOperationReceiptDigest: D("f"),
    cloudVerificationReceiptDigest: D("e"),
    boundAt: "2026-08-15T00:01:00.000Z",
  });
  assert.throws(attempt({ sessionId: "another-session" }), /stable lane owner/);
  assert.throws(attempt({ admission: {
    ...targetLease.admission,
    writeSetDigest: D("9"),
  } }), /admitted write authority/);
  assert.throws(() => continueActivePublishTaskAuthoritySuccessor({
    sourceLease,
    targetLease,
    cloudOperationReceiptDigest: D("0"),
    cloudVerificationReceiptDigest: D("e"),
    boundAt: "2026-08-15T00:01:00.000Z",
  }), /cloud operation subject/);
});

test("device integration projects binding and receipt in the successor CAS", async () => {
  const source = await import("node:fs").then(({ readFileSync }) =>
    readFileSync(new URL("../scripts/device-integrate-lib.mjs", import.meta.url), "utf8"));
  assert.match(source, /continueActivePublishTaskAuthoritySuccessor/u);
  assert.match(source, /taskAuthority: taskAuthoritySuccessor\.binding/u);
  assert.match(source, /activePublishTaskAuthoritySuccessor: taskAuthoritySuccessor\.receipt/u);
});
