import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createAdmissionLeaseProjection } from "../scripts/scoped-lane-admission-lib.mjs";
import {
  assertNoSymlinkAncestors,
  assertPreservationReceiptIntegrity,
  deriveTaskWorktreeRoot,
  requireCanonicalTaskSource,
  verifyCandidateProvisionEvidence,
} from "../scripts/task-worktree-evidence.mjs";

const baseSha = "a".repeat(40);
const fenceSha = "b".repeat(40);
const treeSha = "c".repeat(40);
const digest = value => String(value).repeat(64).slice(0, 64);

function fixture() {
  const targetPath = "/workspace/.worktrees/repository/scoped-runtime";
  const declaredWriteSet = [
    "path:scripts/scoped-runtime.mjs",
    "semantic:scoped-runtime",
  ];
  const report = {
    schema: "agentic-lane-admission-report/v1",
    canonicalBaseSha: baseSha,
    authoringAdmission: { status: "planned" },
    candidate: {
      targetPath,
      branch: "agent/device/scoped-runtime",
      semanticScope: "scoped-runtime",
      declaredWriteSet,
      writeSetDigest: digestValue(declaredWriteSet),
      manifestDigest: digest("1"),
    },
    reportDigest: digest("2"),
    admissionReceipt: {
      receiptDigest: digest("3"),
      targetObservationDigest: digest("4"),
    },
    existingLaneStateDigest: digest("5"),
  };
  const admission = createAdmissionLeaseProjection(report);
  const cloudAuthority = { deviceId: "device", sessionId: "session" };
  const lease = {
    sessionId: "session",
    device: "device",
    scope: "scoped-runtime",
    branch: report.candidate.branch,
    worktreePath: targetPath,
    baseSha,
    fenceSha,
    admission,
    cloudAuthority,
  };
  const beforeRegistrationInventoryDigest = digest("6");
  const afterRegistrationInventoryDigest = digest("7");
  const operationCore = {
    schema: "agentic-candidate-create-register-result/v1",
    status: "created",
    operationId: digestValue({
      target: targetPath,
      baseSha,
      baseTreeSha: treeSha,
      expectedTargetObservationDigest: report.admissionReceipt.targetObservationDigest,
      beforeRegistrationInventoryDigest,
      afterRegistrationInventoryDigest,
    }),
    targetPath,
    baseSha,
    baseTreeSha: treeSha,
    candidateRegistrationDigest: digest("8"),
    expectedTargetObservationDigest: report.admissionReceipt.targetObservationDigest,
    beforeRegistrationInventoryDigest,
    afterRegistrationInventoryDigest,
    mutationSet: ["candidate-registration"],
  };
  const operation = { ...operationCore, resultDigest: digestValue(operationCore) };
  const candidateCore = {
    branch: `refs/heads/${lease.branch}`,
    head: fenceSha,
    treeSha,
    dirty: false,
    workingTreeDigest: digestValue({ status: "", workingFiles: [] }),
    lease,
  };
  const candidate = {
    ...candidateCore,
    stateDigest: digestValue(candidateCore),
  };
  return { candidate, lease, operation, report };
}

test("candidate evidence joins admission, registration, bytes, and lease", () => {
  const value = fixture();
  const evidence = verifyCandidateProvisionEvidence(value);
  assert.equal(evidence.leaseDigest, digestValue(value.lease));
  assert.equal(evidence.admissionDigest, digestValue(value.lease.admission));
  assert.throws(() => verifyCandidateProvisionEvidence({
    ...value,
    candidate: { ...value.candidate, dirty: true },
  }), /pre-authoring bytes/);
});

test("preservation receipt joins the exact plan, lease, cloud, and final inventory", () => {
  const { lease, report } = fixture();
  report.lanes = [{ path: "/workspace/existing" }];
  const verification = {
    remoteClaimInventoryDigest: digest("9"),
    ledgerRevision: "d".repeat(40),
    ledgerDigest: digest("a"),
    receiptDigest: digest("b"),
  };
  const core = {
    schema: "agentic-lane-preservation-result/v1",
    status: "preserved",
    admissionReceiptDigest: report.admissionReceipt.receiptDigest,
    candidateCreateRegisterResultDigest: digest("c"),
    existingLaneStateDigest: report.existingLaneStateDigest,
    candidateStateDigest: digest("d"),
    candidateLeaseDigest: digestValue(lease),
    finalRemoteClaimInventoryDigest: verification.remoteClaimInventoryDigest,
    finalLedgerRevision: verification.ledgerRevision,
    finalLedgerDigest: verification.ledgerDigest,
    cloudVerificationReceiptDigest: verification.receiptDigest,
    preservedPaths: ["/workspace/existing"],
    peerDisposition: "unchanged",
    causality: "candidate-only",
  };
  const receipt = { ...core, receiptDigest: digestValue(core) };
  assert.doesNotThrow(() => assertPreservationReceiptIntegrity({
    receipt,
    report,
    lease,
    cloudAuthority: lease.cloudAuthority,
    verification,
  }));
  assert.throws(() => assertPreservationReceiptIntegrity({
    receipt: { ...receipt, finalLedgerRevision: "e".repeat(40) },
    report,
    lease,
    cloudAuthority: lease.cloudAuthority,
    verification,
  }), /cryptographically joined current Preservation Receipt/);
});

test("task source permits exact or clean ancestor and rejects divergence", () => {
  assert.equal(requireCanonicalTaskSource({
    gitText: () => "",
    status: "",
    headSha: baseSha,
    baseSha,
  }), "exact");
  assert.equal(requireCanonicalTaskSource({
    gitText: args => {
      assert.deepEqual(args, ["merge-base", "--is-ancestor", fenceSha, baseSha]);
      return "";
    },
    status: "",
    headSha: fenceSha,
    baseSha,
  }), "preserved-behind");
  assert.throws(() => requireCanonicalTaskSource({
    gitText: () => { throw new Error("not ancestor"); },
    status: "",
    headSha: fenceSha,
    baseSha,
  }), /must be an ancestor/);
  assert.throws(() => requireCanonicalTaskSource({
    gitText: () => "",
    status: "?? authored",
    headSha: baseSha,
    baseSha,
  }), /must be clean/);
});

test("task worktree roots are repository-owned and reject symlink ancestors", () => {
  assert.equal(
    deriveTaskWorktreeRoot("/workspace/repository", "/workspace/repository/.git"),
    "/workspace/.worktrees/repository",
  );
  const link = path.resolve("/workspace/.worktrees");
  assert.throws(() => assertNoSymlinkAncestors({
    workspaceRoot: "/workspace",
    target: "/workspace/.worktrees/repository/task",
    pathExists: candidate => candidate === link,
    pathStat: () => ({ isSymbolicLink: () => true }),
  }), /cannot traverse a symbolic link/);
});
